const { SudokuConstraint, CompositeConstraintBase } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const { GridShape, SHAPE_9x9 } = await import('./grid_shape.js' + self.VERSION_PARAM);

class AstNode {
  constructor(cls, args) {
    this.cls = cls;
    this.args = args;
    this.children = cls.IS_COMPOSITE ? [] : null;
  }
}

export class SudokuParser {
  static parseShortKillerFormat(text) {
    // Reference for format:
    // http://forum.enjoysudoku.com/understandable-snarfable-killer-cages-t6119.html

    const shape = SHAPE_9x9;
    const numCells = shape.numCells;
    const numCols = shape.numCols;

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
      cages.get(cageCell).cells.push(shape.makeCellIdFromIndex(i));
    }

    let constraints = [];
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Cage(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Container(constraints);
  }

  static parseLongKillerFormat(text) {
    // Reference to format definition:
    // http://www.sudocue.net/forum/viewtopic.php?f=1&t=519

    if (!text.startsWith('3x3:')) return null;

    const shape = SHAPE_9x9;
    const numCells = shape.numCells;

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
      cages.get(cageId).cells.push(shape.makeCellIdFromIndex(i));
    }

    let constraints = [];
    if (parts[1] === 'd') {
      constraints.push(new SudokuConstraint.Diagonal(1));
      constraints.push(new SudokuConstraint.Diagonal(-1));
    }
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Cage(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Container(constraints);
  }

  static parsePlainSudoku(text) {
    const shape = GridShape.fromNumCells(text.length);
    if (!shape) return null;

    const numCells = shape.numCells;
    const numValues = shape.numValues;

    const baseCharCode = GridShape.baseCharCode(shape);
    if (!baseCharCode) return null;

    let fixedValues = [];
    let nonValueCharacters = [];
    for (let i = 0; i < numCells; i++) {
      let c = text.charCodeAt(i);
      if (c >= baseCharCode && c <= baseCharCode + numValues - 1) {
        fixedValues.push(shape.makeValueId(i, c - baseCharCode + 1));
      } else {
        nonValueCharacters.push(c);
      }
    }
    if (new Set(nonValueCharacters).size > 1) return null;
    return new SudokuConstraint.Container([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Given.makeFromArgs(...fixedValues),
    ]);
  }

  static parseJigsawLayout(text) {
    const shape = GridShape.fromNumCells(text.length);
    if (!shape) return null;

    const numCells = shape.numCells;
    const numValues = shape.numValues;

    const chars = new Set(text);
    if (chars.size !== numValues) return null;

    const counter = {};
    chars.forEach(c => counter[c] = 0);
    for (let i = 0; i < numCells; i++) {
      counter[text[i]]++;
    }

    if (Object.values(counter).some(c => c !== numValues)) return null;

    return new SudokuConstraint.Container([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Jigsaw.makeFromArgs(text),
      new SudokuConstraint.NoBoxes(),
    ]);
  }

  static parseJigsaw(text) {
    if (text.length % 2 !== 0) return null;

    const shape = GridShape.fromNumCells(text.length / 2);
    if (!shape) return null;

    const numCells = shape.numCells;

    const layout = this.parseJigsawLayout(text.substr(numCells));
    if (layout === null) return null;

    const fixedValues = this.parsePlainSudoku(text.substr(0, numCells));
    if (fixedValues === null) return null;

    return new SudokuConstraint.Container([layout, fixedValues]);
  }

  static parseSolution(text) {
    if (!text.startsWith('=')) return null;
    return this.parsePlainSudoku(text.substring(1));
  }

  static parseGridLayout(rawText) {
    // Only allow digits, dots, spaces and separators.
    if (rawText.search(/[^\d\s.|_-]/) !== -1) return null;

    const parts = [...rawText.matchAll(/[.]|\d+/g)];
    const numParts = parts.length;

    const shape = GridShape.fromNumCells(numParts);
    if (!shape) return null;

    let fixedValues = [];
    for (let i = 0; i < numParts; i++) {
      const cell = parts[i][0];
      if (cell === '.') continue;
      fixedValues.push(shape.makeValueId(i, cell));
    }

    return new SudokuConstraint.Container([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Given.makeFromArgs(...fixedValues),
    ]);
  }

  static parsePencilmarks(text) {
    const shape = GridShape.fromNumPencilmarks(text.length);
    if (!shape) return null;

    // Only allow digits, and dots.
    if (text.search(/[^\d.]/) !== -1) return null;

    const numValues = shape.numValues;

    // Split into segments of 9 characters.
    const pencilmarks = [];
    for (let i = 0; i < shape.numCells; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      const values = (
        text.substr(i * numValues, numValues)
          .split('')
          .filter(c => c !== '.')
          .join('_'));
      pencilmarks.push(`${cellId}_${values}`);
    }

    return new SudokuConstraint.Container([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Given.makeFromArgs(...pencilmarks),
    ]);
  }

  static parseTextLine(rawText) {
    // Remove all whitespace.
    const text = rawText.replace(/\s+/g, '');

    let constraint;

    // Need this to avoid parsing this as a 1x1 grid.
    if (text.length === 1) return null;

    constraint = this.parseSolution(text);
    if (constraint) return constraint;

    constraint = this.parseShortKillerFormat(text);
    if (constraint) return constraint;

    constraint = this.parseLongKillerFormat(text);
    if (constraint) return constraint;

    constraint = this.parseJigsaw(text);
    if (constraint) return constraint;

    constraint = this.parseJigsawLayout(text);
    if (constraint) return constraint;

    constraint = this.parsePlainSudoku(text);
    if (constraint) return constraint;

    constraint = this.parseGridLayout(rawText);
    if (constraint) return constraint;

    constraint = this.parsePencilmarks(text);
    if (constraint) return constraint;

    return null;
  }

  static parseText(rawText) {
    const constraints = [];
    // Replace comment lines starting with #
    const uncommentedText = rawText.replace(/^#.*$/gm, '');

    // Parse sections separated by a blank line separately,
    // and then merge their constraints.
    for (const part of uncommentedText.split(/\n\s*\n/)) {
      let constraint = this.parseTextLine(part);
      if (!constraint) {
        constraint = this.parseString(part);
      }
      constraints.push(constraint);
    }
    if (constraints.length === 1) return constraints[0];
    return new SudokuConstraint.Container(constraints);
  }

  static parseString(rawStr) {
    const str = rawStr.replace(/\s+/g, '');
    let items = str.split('.');
    if (items[0]) throw new Error(
      'Invalid constraint string: Constraint must start with a ".".\n' +
      rawStr);
    items.shift();

    // Parse to a simple AST.
    const root = new AstNode(SudokuConstraint.Container, []);

    const stack = [root];
    for (const item of items) {
      const parts = item.split('~');
      const type = parts.shift() || SudokuConstraint.Given.name;

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

      // Attach to current parent.
      stack[stack.length - 1].children.push(node);

      // Composite constraints consume subsequent constraints until `.End`.
      if (cls.IS_COMPOSITE) {
        stack.push(node);
      }
    }

    if (stack.length !== 1) {
      throw new Error('Unterminated composite constraint: '
        + stack[stack.length - 1].cls.name);
    }

    // Resolve the AST into constraint instances.
    const resolveNodes = (nodes, parentCompositeClass) => {
      const result = [];
      const canAbsorb = parentCompositeClass.CAN_ABSORB();

      const addConstraint = (constraint) => {
        if (constraint.constructor.IS_COMPOSITE
          && canAbsorb.includes(constraint.constructor)) {
          for (const subConstraint of constraint.constraints) {
            addConstraint(subConstraint);
          }
        } else {
          result.push(constraint);
        }
      };

      for (const n of nodes) {
        const cls = n.cls;

        if (!parentCompositeClass.allowedConstraintClass(cls)) {
          throw new Error(`Constraint of type ${cls.name} `
            + `is not allowed inside ${parentCompositeClass.name}.`);
        }

        if (cls.IS_COMPOSITE) {
          const childConstraints = resolveNodes(n.children, cls);
          addConstraint(new cls(childConstraints));
          continue;
        }

        const constraintParts = cls.makeFromArgs(...n.args);
        if (constraintParts.length > 1) {
          // If a single token expands into multiple constraints, wrap them in
          // an And so they behave as a unit inside Or.
          addConstraint(new SudokuConstraint.And(constraintParts));
        } else {
          for (const c of constraintParts) addConstraint(c);
        }
      }

      return result;
    };

    const constraints = resolveNodes(root.children, root.cls);
    return new root.cls(constraints);
  }

  static extractConstraintTypes(str) {
    const types = str.matchAll(/[.]([^.~]+)/g);
    const uniqueTypes = new Set();
    for (const type of types) {
      const value = type[1].trim();
      if (SudokuConstraint[value]) {
        uniqueTypes.add(value);
      }
    }
    return [...uniqueTypes];
  }
}

export const toShortSolution = (solution, shape) => {
  const baseCharCode = GridShape.baseCharCode(shape);
  const DEFAULT_VALUE = '.';

  const result = new Array(solution.length).fill(DEFAULT_VALUE);

  for (let i = 0; i < solution.length; i++) {
    result[i] = String.fromCharCode(baseCharCode + solution[i] - 1);
  }
  return result.join('');
}