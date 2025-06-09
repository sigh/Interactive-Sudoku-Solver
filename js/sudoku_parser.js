const { SudokuConstraint, CompositeConstraintBase } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const { GridShape, SHAPE_9x9 } = await import('./grid_shape.js' + self.VERSION_PARAM);

export class SudokuParser {
  static parseShortKillerFormat(text) {
    // Reference for format:
    // http://forum.enjoysudoku.com/understandable-snarfable-killer-cages-t6119.html

    const shape = SHAPE_9x9;
    const numCells = shape.numCells;
    const gridSize = shape.gridSize;

    if (text.length != numCells) return null;
    // Note: The second ` is just there so my syntax highlighter is happy.
    if (!text.match(/[<v>^`',`]/)) return null;
    if (!text.match(/^[0-9A-Za-j^<v>`'',.`]*$/)) return null;

    // Determine the cell directions.
    let cellDirections = [];
    for (let i = 0; i < numCells; i++) {
      switch (text[i]) {
        case 'v':
          cellDirections.push(i + gridSize);
          break;
        case '^':
          cellDirections.push(i - gridSize);
          break;
        case '<':
          cellDirections.push(i - 1);
          break;
        case '>':
          cellDirections.push(i + 1);
          break;
        case '`':
          cellDirections.push(i - gridSize - 1);
          break;
        case '\'':
          cellDirections.push(i - gridSize + 1);
          break;
        case ',':
          cellDirections.push(i + gridSize - 1);
          break;
        case '.':
          cellDirections.push(i + gridSize + 1);
          break;
        default:
          cellDirections.push(i);
      }
    }

    let cages = new Map();
    for (let i = 0; i < numCells; i++) {
      let cageCell = i;
      let count = 0;
      while (cellDirections[cageCell] != cageCell) {
        cageCell = cellDirections[cageCell];
        count++;
        if (count > gridSize) {
          throw ('Loop in Killer Sudoku input.');
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
    return new SudokuConstraint.Set(constraints);
  }

  static parseLongKillerFormat(text) {
    // Reference to format definition:
    // http://www.sudocue.net/forum/viewtopic.php?f=1&t=519

    if (!text.startsWith('3x3:')) return null;

    const shape = SHAPE_9x9;
    const numCells = shape.numCells;

    let parts = text.split(':');
    if (parts[2] != 'k') return null;
    if (parts.length != numCells + 4) return null;

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
    if (parts[1] == 'd') {
      constraints.push(new SudokuConstraint.Diagonal(1));
      constraints.push(new SudokuConstraint.Diagonal(-1));
    }
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Cage(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Set(constraints);
  }

  static parsePlainSudoku(text) {
    const shape = GridShape.fromNumCells(text.length);
    if (!shape) return null;

    const numCells = shape.numCells;
    const gridSize = shape.gridSize;

    const baseCharCode = GridShape.baseCharCode(shape);
    if (!baseCharCode) return null;

    let fixedValues = [];
    let nonValueCharacters = [];
    for (let i = 0; i < numCells; i++) {
      let c = text.charCodeAt(i);
      if (c >= baseCharCode && c <= baseCharCode + gridSize - 1) {
        fixedValues.push(shape.makeValueId(i, c - baseCharCode + 1));
      } else {
        nonValueCharacters.push(c);
      }
    }
    if (new Set(nonValueCharacters).size > 1) return null;
    return new SudokuConstraint.Set([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Given.makeFromArgs(...fixedValues),
    ]);
  }

  static parseJigsawLayout(text) {
    const shape = GridShape.fromNumCells(text.length);
    if (!shape) return null;

    const numCells = shape.numCells;
    const gridSize = shape.gridSize;

    const chars = new Set(text);
    if (chars.size != gridSize) return null;

    const counter = {};
    chars.forEach(c => counter[c] = 0);
    for (let i = 0; i < numCells; i++) {
      counter[text[i]]++;
    }

    if (Object.values(counter).some(c => c != gridSize)) return null;

    return new SudokuConstraint.Set([
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
    if (layout == null) return null;

    const fixedValues = this.parsePlainSudoku(text.substr(0, numCells));
    if (fixedValues == null) return null;

    return new SudokuConstraint.Set([layout, fixedValues]);
  }

  static parseGridLayout(rawText) {
    // Only allow digits, dots, spaces and separators.
    if (rawText.search(/[^\d\s.|_-]/) != -1) return null;

    const parts = [...rawText.matchAll(/[.]|\d+/g)];
    const numParts = parts.length;

    const shape = GridShape.fromNumCells(numParts);
    if (!shape) return null;

    let fixedValues = [];
    for (let i = 0; i < numParts; i++) {
      const cell = parts[i];
      if (cell == '.') continue;
      fixedValues.push(shape.makeValueId(i, cell));
    }

    return new SudokuConstraint.Set([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Given.makeFromArgs(...fixedValues),
    ]);
  }

  static parsePencilmarks(text) {
    const shape = GridShape.fromNumPencilmarks(text.length);
    if (!shape) return null;

    // Only allow digits, and dots.
    if (text.search(/[^\d.]/) != -1) return null;

    const numValues = shape.numValues;

    // Split into segments of 9 characters.
    const pencilmarks = [];
    for (let i = 0; i < shape.numCells; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      const values = (
        text.substr(i * numValues, numValues)
          .split('')
          .filter(c => c != '.')
          .join('_'));
      pencilmarks.push(`${cellId}_${values}`);
    }

    return new SudokuConstraint.Set([
      new SudokuConstraint.Shape(shape.name),
      ...SudokuConstraint.Given.makeFromArgs(...pencilmarks),
    ]);
  }

  static parseTextLine(rawText) {
    // Remove all whitespace.
    const text = rawText.replace(/\s+/g, '');

    let constraint;

    // Need this to void parsing this as a 1x1 grid.
    if (text.length === 1) return null;

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
    // Parse sections separated by a blank line separately,
    // and then merge their constraints.
    for (const part of rawText.split(/\n\s*\n/)) {
      let constraint = this.parseTextLine(part);
      if (!constraint) {
        constraint = this.parseString(part);
      }
      constraints.push(constraint);
    }
    if (constraints.length == 1) return constraints[0];
    return new SudokuConstraint.Set(constraints);
  }

  static _resolveCompositeConstraints(revConstraints, compositeClass) {
    // NOTE: The constraints are reversed so we can efficiently pop them off the
    // end. The result will be that everything is in the original order.

    const items = [];

    while (revConstraints.length) {
      const c = revConstraints.pop();
      if (c.type === 'End') break;

      if (c.constructor.IS_COMPOSITE) {
        const resolvedComposite = this._resolveCompositeConstraints(
          revConstraints, c.constructor);
        if (compositeClass.CAN_ABSORB.includes(c.constructor.name)) {
          // We can directly add the sub-constraints to this composite.
          items.push(...resolvedComposite.constraints);
        } else {
          items.push(resolvedComposite);
        }
      } else {
        items.push(c);
      }
    }
    return new compositeClass(items);
  }

  static parseString(rawStr) {
    const str = rawStr.replace(/\s+/g, '');
    let items = str.split('.');
    if (items[0]) throw (
      'Invalid constraint string: Constraint must start with a ".".\n' +
      rawStr);
    items.shift();

    const constraints = [];
    for (const item of items) {
      const args = item.split('~');
      const type = args.shift() || SudokuConstraint.Given.name;
      const cls = SudokuConstraint[type];
      if (!cls) {
        throw ('Unknown constraint type: ' + type);
      }
      const constraintParts = [...cls.makeFromArgs(...args)];
      if (constraintParts.length > 1
        && CompositeConstraintBase.allowedConstraintClass(cls)) {
        // If this item was split into multiple constraints, then we wrap it
        // in an 'And' constraint, since they may need to be treated as a unit
        // when nested in an 'Or'.
        // We only need to do this for constraints that are allowed inside
        // composite constraints.
        constraints.push(
          new SudokuConstraint.And(),
          ...constraintParts,
          new SudokuConstraint.End());
      } else {
        constraints.push(...constraintParts);
      }
    }

    return this._resolveCompositeConstraints(
      constraints.reverse(), SudokuConstraint.Set);
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