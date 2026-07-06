const { SudokuConstraint } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const { CellGeometry, GEOMETRY_9x9 } = await import('./cell_geometry.js' + self.VERSION_PARAM);

const FIRST_LETTER_CODE = 'A'.charCodeAt(0);

export const valueToShortChar = (value, maxValue) => {
  if (value === 0) return '0';
  if (maxValue < 10) return String(value);

  return String.fromCharCode(FIRST_LETTER_CODE + value - 1);
}

const shortCharToValue = (char, maxValue) => {
  if (maxValue < 10) return char >= '0' && char <= '9' ? +char : null;
  if (char === '0') return 0;
  if (char >= 'A' && char <= 'Z') return 1 + char.charCodeAt(0) - FIRST_LETTER_CODE;
  return null;
}

class AstNode {
  constructor(cls, args = null) {
    this.cls = cls;
    this.args = args === null ? [] : args;
    this.children = cls.IS_COMPOSITE ? [] : null;
  }

  static makeRoot(...children) {
    const root = new AstNode(SudokuConstraint.Container);

    // Robustness:
    // Allow callers to pass other root ASTs (i.e. Container nodes)
    // and merge their children into this root.
    for (const child of children) {
      if (child.cls === SudokuConstraint.Container) {
        root.children.push(...child.children);
      } else {
        root.children.push(child);
      }
    }
    return root;
  }
}

export class SudokuParser {
  static _resolveAst(astRoot) {
    let geometry = null;
    for (const n of astRoot.children) {
      if (n.cls !== SudokuConstraint.Shape) continue;

      const spec = n.args.join('~');
      geometry = spec ? CellGeometry.fromShapeSpec(spec) : CellGeometry.newDefault();
      break;
    }
    if (!geometry) geometry = CellGeometry.newDefault();

    const constraints = this._resolveNodes(astRoot.children, astRoot.cls, geometry);
    return new astRoot.cls(constraints);
  }

  static _resolveNodes(nodes, parentCompositeClass, geometry) {
    const result = [];

    for (const n of nodes) {
      const cls = n.cls;

      if (!parentCompositeClass.allowedConstraintClass(cls)) {
        throw new Error(
          `Constraint ${cls.name} is not allowed in ${parentCompositeClass.name}.`);
      }

      if (cls.IS_COMPOSITE) {
        const childConstraints = this._resolveNodes(n.children, cls, geometry);
        result.push(new cls(childConstraints, ...n.args));
        continue;
      }

      const constraintParts = [...cls.makeFromArgs(n.args, geometry)];
      if (constraintParts.length > 1 && parentCompositeClass === SudokuConstraint.Or) {
        // If a single token expands into multiple constraints, wrap them in
        // an And so they behave as a unit inside Or.
        result.push(new SudokuConstraint.And(constraintParts));
      } else {
        result.push(...constraintParts);
      }
    }

    // Merge constraints that share a uniqueness key (e.g. multiple Givens
    // for the same cell are intersected). Skip for Or composites where
    // branches are alternatives, not additive.
    if (parentCompositeClass !== SudokuConstraint.Or) {
      return this._mergeByUniqueness(result);
    }
    return result;
  }

  static _mergeByUniqueness(constraints) {
    const keyToIndex = new Map();
    const result = [];

    for (const constraint of constraints) {
      const field = constraint.constructor.UNIQUENESS_KEY_FIELD;
      if (field === null) {
        result.push(constraint);
        continue;
      }

      const mapKey = `${constraint.type}:${constraint[field]}`;
      if (keyToIndex.has(mapKey)) {
        const existingIndex = keyToIndex.get(mapKey);
        result[existingIndex] = constraint.constructor.mergeConstraints(
          result[existingIndex], constraint);
      } else {
        keyToIndex.set(mapKey, result.length);
        result.push(constraint);
      }
    }

    return result;
  }

  static _parseShortKillerFormatToAst(text) {
    // Reference for format:
    // http://forum.enjoysudoku.com/understandable-snarfable-killer-cages-t6119.html

    const geometry = GEOMETRY_9x9;
    const numCells = geometry.numGridCells;
    const numCols = geometry.numCols;

    if (text.length !== numCells) return null;
    // Note: The second ` is just there so my syntax highlighter is happy.
    if (!text.match(/[<v>^`',`]/)) return null;
    if (!text.match(/^[0-9A-Za-j^<v>`'',.`]*$/)) return null;

    // Determine the cell directions.
    let cellDirections = [];
    for (let i = 0; i < numCells; i++) {
      switch (text[i]) {
        case 'v':
          cellDirections.push(i + numCols);
          break;
        case '^':
          cellDirections.push(i - numCols);
          break;
        case '<':
          cellDirections.push(i - 1);
          break;
        case '>':
          cellDirections.push(i + 1);
          break;
        case '`':
          cellDirections.push(i - numCols - 1);
          break;
        case '\'':
          cellDirections.push(i - numCols + 1);
          break;
        case ',':
          cellDirections.push(i + numCols - 1);
          break;
        case '.':
          cellDirections.push(i + numCols + 1);
          break;
        default:
          cellDirections.push(i);
      }
    }

    let cages = new Map();
    for (let i = 0; i < numCells; i++) {
      let cageCell = i;
      let count = 0;
      while (cellDirections[cageCell] !== cageCell) {
        cageCell = cellDirections[cageCell];
        count++;
        if (count > numCols) {
          throw new Error('Loop in Killer Sudoku input.');
        }
      }
      if (!cages.has(cageCell)) {
        let c = text[cageCell];
        let sum;
        if (c >= '0' && c <= '9') {
          sum = +c;
        } else if (c >= 'A' && c <= 'Z') {
          sum = c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
        } else if (c >= 'a' && c <= 'j') {
          sum = c.charCodeAt(0) - 'a'.charCodeAt(0) + 36;
        } else {
          // Not a valid cage, ignore.
          continue;
        }
        cages.set(cageCell, {
          sum: sum,
          cells: [],
        });
      }
      cages.get(cageCell).cells.push(geometry.makeCellIdFromIndex(i));
    }

    const root = AstNode.makeRoot();
    for (const config of cages.values()) {
      root.children.push(new AstNode(
        SudokuConstraint.Cage,
        [String(config.sum), ...config.cells]));
    }
    return root;
  }

  static _parseLongKillerFormatToAst(text) {
    // Reference to format definition:
    // http://www.sudocue.net/forum/viewtopic.php?f=1&t=519

    if (!text.startsWith('3x3:')) return null;

    const geometry = GEOMETRY_9x9;
    const numCells = geometry.numGridCells;

    let parts = text.split(':');
    if (parts[2] !== 'k') return null;
    if (parts.length !== numCells + 4) return null;

    let cages = new Map();
    for (let i = 0; i < numCells; i++) {
      let value = +parts[i + 3];
      let cageId = value % 256;
      let cageSum = value / 256 | 0;

      if (!cageSum) continue;

      if (!cages.has(cageId)) {
        cages.set(cageId, { sum: cageSum, cells: [] });
      }
      cages.get(cageId).cells.push(geometry.makeCellIdFromIndex(i));
    }

    const root = AstNode.makeRoot();
    if (parts[1] === 'd') {
      root.children.push(new AstNode(SudokuConstraint.Diagonal, ['1']));
      root.children.push(new AstNode(SudokuConstraint.Diagonal, ['-1']));
    }
    for (const config of cages.values()) {
      root.children.push(new AstNode(
        SudokuConstraint.Cage,
        [String(config.sum), ...config.cells]));
    }
    return root;
  }

  static _parsePlainSudokuToAst(text) {
    const geometry = CellGeometry.fromNumCells(text.length);
    if (!geometry) return null;

    const numCells = geometry.numGridCells;
    const minValue = geometry.minValue();
    const maxValue = geometry.maxValue();

    let fixedValues = [];
    let nonValueCharacters = [];
    for (let i = 0; i < numCells; i++) {
      const char = text[i];
      const value = shortCharToValue(char, maxValue);
      if (value !== null && value >= minValue && value <= maxValue) {
        fixedValues.push(geometry.makeValueId(i, value));
      } else {
        nonValueCharacters.push(char);
      }
    }
    if (new Set(nonValueCharacters).size > 1) return null;

    return AstNode.makeRoot(
      new AstNode(SudokuConstraint.Shape, [geometry.name]),

      new AstNode(SudokuConstraint.Given, fixedValues)
    );
  }

  static _parseJigsawLayoutToAst(text) {
    const geometry = CellGeometry.fromNumCells(text.length);
    if (!geometry) return null;

    const numCells = geometry.numGridCells;
    const numValues = geometry.numValues;

    const chars = new Set(text);
    if (chars.size !== numValues) return null;

    const counter = {};
    chars.forEach(c => counter[c] = 0);
    for (let i = 0; i < numCells; i++) {
      counter[text[i]]++;
    }

    if (Object.values(counter).some(c => c !== numValues)) return null;

    return AstNode.makeRoot(
      new AstNode(SudokuConstraint.Shape, [geometry.name]),
      new AstNode(SudokuConstraint.Jigsaw, [text]),
      new AstNode(SudokuConstraint.NoBoxes)
    );
  }

  static _parseJigsawToAst(text) {
    if (text.length % 2 !== 0) return null;

    const geometry = CellGeometry.fromNumCells(text.length / 2);
    if (!geometry) return null;

    const numCells = geometry.numGridCells;

    const layout = this._parseJigsawLayoutToAst(text.substr(numCells));
    if (layout === null) return null;

    const fixedValues = this._parsePlainSudokuToAst(text.substr(0, numCells));
    if (fixedValues === null) return null;

    return AstNode.makeRoot(layout, fixedValues);
  }

  static _parseGridLayoutToAst(rawText) {
    // Only allow digits, dots, spaces and separators.
    if (rawText.search(/[^\d\s.|_-]/) !== -1) return null;

    const parts = [...rawText.matchAll(/[.]|\d+/g)];
    const numParts = parts.length;

    const geometry = CellGeometry.fromNumCells(numParts);
    if (!geometry) return null;

    let fixedValues = [];
    for (let i = 0; i < numParts; i++) {
      const value = parts[i][0];
      if (value === '.') continue;
      fixedValues.push(geometry.makeValueId(i, value));
    }

    return AstNode.makeRoot(
      new AstNode(SudokuConstraint.Shape, [geometry.name]),
      new AstNode(SudokuConstraint.Given, fixedValues)
    );
  }

  static _parsePencilmarksToAst(text) {
    const geometry = CellGeometry.fromNumPencilmarks(text.length);
    if (!geometry) return null;

    // Only allow digits, and dots.
    if (text.search(/[^\d.]/) !== -1) return null;

    const numValues = geometry.numValues;

    // Split into segments of numValues characters.
    const pencilmarks = [];
    for (let i = 0; i < geometry.numGridCells; i++) {
      const cellId = geometry.makeCellIdFromIndex(i);
      const values = (
        text.substr(i * numValues, numValues)
          .split('')
          .filter(c => c !== '.')
          .join('_'));
      pencilmarks.push(`${cellId}_${values}`);
    }

    return AstNode.makeRoot(
      new AstNode(SudokuConstraint.Shape, [geometry.name]),
      new AstNode(SudokuConstraint.Given, pencilmarks)
    );
  }

  static _parseStringToAst(rawStr) {
    const str = rawStr.replace(/\s+/g, '');
    const [unexpectedItem, ...items] = str.split('.');
    if (unexpectedItem !== '') throw new Error(
      'Invalid constraint string: Constraint must start with a ".".\n' +
      rawStr);

    const root = AstNode.makeRoot();
    const stack = [root];

    for (const item of items) {
      let [type, ...parts] = item.split('~');
      type ||= SudokuConstraint.Given.name;

      // A root-level `.End` is invalid.
      if (type === SudokuConstraint.End.name) {
        if (stack.length === 1) {
          throw new Error('Unmatched .End');
        }
        stack.pop();
        continue;
      }

      const cls = SudokuConstraint[type];
      if (!cls) {
        throw new Error('Unknown constraint type: ' + type);
      }

      const node = new AstNode(cls, parts);
      stack[stack.length - 1].children.push(node);

      if (cls.IS_COMPOSITE) {
        stack.push(node);
      }
    }

    if (stack.length !== 1) {
      throw new Error('Unterminated composite constraint: '
        + stack[stack.length - 1].cls.name);
    }

    return root;
  }

  static _parseTextLineToAst(rawText) {
    // Remove all whitespace.
    const text = rawText.replace(/\s+/g, '');

    // Need this to avoid parsing this as a 1x1 grid.
    if (text.length === 1) return null;

    if (text.startsWith('=')) {
      return this._parsePlainSudokuToAst(text.substring(1));
    }

    return (
      this._parseShortKillerFormatToAst(text)
      || this._parseLongKillerFormatToAst(text)
      || this._parseJigsawToAst(text)
      || this._parseJigsawLayoutToAst(text)
      || this._parsePlainSudokuToAst(text)
      || this._parseGridLayoutToAst(rawText)
      || this._parsePencilmarksToAst(text)
      || null
    );
  }

  static _parseTextToAst(rawText) {
    // Replace comment lines starting with #
    const uncommentedText = rawText.replace(/^#.*$/gm, '');

    // Parse sections separated by a blank line separately,
    // and then merge their constraints.
    const root = AstNode.makeRoot();
    for (const part of uncommentedText.split(/\n\s*\n/)) {
      const partAst = this._parseTextLineToAst(part) || this._parseStringToAst(part);
      root.children.push(...partAst.children);
    }
    return root;
  }

  static parseShortKillerFormat(text) {
    const ast = this._parseShortKillerFormatToAst(text);
    return ast ? this._resolveAst(ast) : null;
  }

  static parseLongKillerFormat(text) {
    const ast = this._parseLongKillerFormatToAst(text);
    return ast ? this._resolveAst(ast) : null;
  }

  static parsePlainSudoku(text) {
    const ast = this._parsePlainSudokuToAst(text);
    return ast ? this._resolveAst(ast) : null;
  }

  static parseJigsawLayout(text) {
    const ast = this._parseJigsawLayoutToAst(text);
    return ast ? this._resolveAst(ast) : null;
  }

  static parseJigsaw(text) {
    const ast = this._parseJigsawToAst(text);
    return ast ? this._resolveAst(ast) : null;
  }

  static parseSolution(text) {
    if (!text.startsWith('=')) return null;
    return this.parsePlainSudoku(text.substring(1));
  }

  static parseGridLayout(rawText) {
    const ast = this._parseGridLayoutToAst(rawText);
    return ast ? this._resolveAst(ast) : null;
  }

  static parsePencilmarks(text) {
    const ast = this._parsePencilmarksToAst(text);
    return ast ? this._resolveAst(ast) : null;
  }

  static parseText(rawText) {
    return this._resolveAst(this._parseTextToAst(rawText));
  }

  static parseString(rawStr) {
    return this._resolveAst(this._parseStringToAst(rawStr));
  }

  static extractConstraintTypes(str) {
    const uniqueTypes = new Set();
    for (const type of str.matchAll(/[.]([^.~]+)/g)) {
      const value = type[1].trim();
      if (SudokuConstraint[value]) {
        uniqueTypes.add(value);
      }
    }
    uniqueTypes.delete('End');  // End is not a real constraint

    const shapeMatch = uniqueTypes.delete('Shape') && str.match(/[.]Shape~([^.\s]+)/);
    if (!shapeMatch) return [...uniqueTypes];

    // Surface Shape as its grid dimensions and/or value range (separate leading
    // entries), omitting whichever matches the default 9x9 / 1-9 grid.
    const geometry = CellGeometry.fromShapeSpec(shapeMatch[1]);
    const shapeTypes = [];
    if (geometry.gridDimsStr !== GEOMETRY_9x9.gridDimsStr) {
      shapeTypes.push(geometry.gridDimsStr);
    }
    if (!geometry.isDefaultNumValues() || geometry.valueOffset !== 0) {
      shapeTypes.push(`${geometry.minValue()}-${geometry.maxValue()}`);
    }
    return [...shapeTypes, ...uniqueTypes];
  }
}

export const toShortSolution = (solution, geometry) => {
  const DEFAULT_VALUE = '.';

  const length = Math.min(solution.length, geometry.numGridCells);
  const result = new Array(length).fill(DEFAULT_VALUE);
  const minValue = geometry.minValue();
  let maxValue = minValue;
  for (let i = 0; i < length; i++) {
    if (solution[i] != null) maxValue = Math.max(maxValue, solution[i]);
  }

  for (let i = 0; i < length; i++) {
    if (solution[i] != null) {
      result[i] = valueToShortChar(solution[i], maxValue) ?? DEFAULT_VALUE;
    }
  }
  return result.join('');
}