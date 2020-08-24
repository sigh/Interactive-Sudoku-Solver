const BOX_SIZE = 3;
const GRID_SIZE = BOX_SIZE*BOX_SIZE;
const NUM_CELLS = GRID_SIZE*GRID_SIZE;

const toValueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}_${n}`;
};

const toCellId = (row, col) => {
  return id = `R${row+1}C${col+1}`;
};

const toCellIndex = (row, col) => {
  return row*GRID_SIZE+col;
};

const toRowCol = (cell) => {
  return [cell/GRID_SIZE|0, cell%GRID_SIZE|0];
};

const parseValueId = (valueId) => {
  let cellId = valueId.substr(0, 4);
  return {
    value: +valueId[5],
    cellId: cellId,
    ...parseCellId(cellId),
  };
};

const parseCellId = (cellId) => {
  let row = +cellId[1]-1;
  let col = +cellId[3]-1;
  return {
    cell: toCellIndex(row, col),
    row: row,
    col: col,
  };
};

class SudokuConstraint {
  constructor(args) {
    this.args = args ? [...args] : [];
    this.type = this.constructor.name;
  }

  static fromString(str) {
    let items = str.split('.');
    if (items[0]) throw('Invalid constraint string: ' + str);
    items.shift();

    let constraints = [];
    for (const item of items) {
      let args = item.split('~');
      let type = args.shift();
      if (!type) type = this.DEFAULT.name;
      constraints.push(new SudokuConstraint[type](...args));
    }
    return new SudokuConstraint.Set(constraints);
  }

  toString(replaceType) {
    let type = this.type;
    if (this.constructor == this.constructor.DEFAULT) type = '';
    let arr = [type, ...this.args];
    return '.' + arr.join('~');
  }

  static _parseKillerFormat(text) {
    if (text.length != NUM_CELLS) return null;
    if (!text.match(/[^<V>]/)) return null;
    if (!text.match(/^[0-9A-Za-j^<V>]*$/)) return null;

    // Determine the cell directions.
    let cellDirections = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      switch (text[i]) {
        case 'v':
          cellDirections.push(i+GRID_SIZE);
          break;
        case '^':
          cellDirections.push(i-GRID_SIZE);
          break;
        case '<':
          cellDirections.push(i-1);
          break;
        case '>':
          cellDirections.push(i+1);
          break;
        default:
          cellDirections.push(i);
      }
    }

    let cages = new Map();
    for (let i = 0; i < NUM_CELLS; i++) {
      let cageCell = i;
      while (cellDirections[cageCell] != cageCell) {
        cageCell = cellDirections[cageCell];
      }
      if (!cages.has(cageCell)) {
        let c = text[cageCell];
        let sum;
        if (c >= '1' && c <= '9') {
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
      cages.get(cageCell).cells.push(toCellId(...toRowCol(i)));
    }

    let constraints = [];
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Sum(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Set(constraints);
  }

  static _parsePlainSudoku(text) {
    if (text.length != NUM_CELLS) return null;

    let fixedValues = [];
    let nonDigitCharacters = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      let c = text[i];
      if (c >= '1' && c <= '9') {
        fixedValues.push(toValueId(...toRowCol(i), c));
      } else {
        nonDigitCharacters.push(c);
      }
    }
    if (new Set(nonDigitCharacters).size > 1) return null;
    return new SudokuConstraint.FixedValues(...fixedValues);
  }

  static fromText(text) {
    // Remove all whitespace.
    text = text.replace(/\s+/g, '');

    let constraint;

    constraint = this._parseKillerFormat(text);
    if (constraint) return constraint;

    constraint = this._parsePlainSudoku(text);
    if (constraint) return constraint;

    try {
      return SudokuConstraint.fromString(text);
    } catch (e) {
      console.log(`Unrecognised input type (${e})`);
      return null;
    }
  }

  static Set = class Set extends SudokuConstraint {
    constructor(constraints) {
      super(arguments);
      this.constraints = constraints;
    }

    toString() {
      return this.constraints.map(c => c.toString()).join('');
    }
  }

  static Thermo = class Thermo extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static AntiKnight = class AntiKnight extends SudokuConstraint {}

  static AntiKing = class AntiKing extends SudokuConstraint {}

  static AntiConsecutive = class AntiConsecutive extends SudokuConstraint {}

  static Diagonal = class Diagonal extends SudokuConstraint {
    constructor(direction) {
      super(arguments);
      this.direction = direction;
    }
  }

  static Sum = class Sum extends SudokuConstraint {
    constructor(sum, ...cells) {
      super(arguments);
      this.cells = cells;
      this.sum = sum;
    }
  }

  static AllDifferent = class AllDifferent extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static FixedValues = class FixedValues extends SudokuConstraint {
    constructor(...values) {
      super(arguments);
      this.values = values;
    }
  }

  static DEFAULT = this.FixedValues;
}
