class SudokuConstraint {
  constructor(args) {
    this.args = args ? [...args] : [];
    this.type = SudokuConstraint.TYPES.get(this.constructor);
  }

  _type() {
    for (const [name,  type] of Object.entries(SudokuConstraint)) {
      if (type == this.constructor) return name;
    }
    throw('Unknown constraint');
  }

  static fromString(str) {
    let items = str.split('.');
    if (items[0]) throw('Invalid constraint string: ' + str);
    items.shift();

    let constraints = [];
    for (const item of items) {
      let args = item.split('~');
      let type = args.shift();
      constraints.push(new SudokuConstraint[type](...args));
    }
    return new SudokuConstraint.Set(constraints);
  }

  toString() {
    let arr = [this.type, ...this.args];
    return '.' + arr.join('~');
  }

  static _parseKillerFormat(text) {
    if (text.length != 81) return null;
    if (!text.match(/[^<V>]/)) return null;
    if (!text.match(/^[0-9A-Za-j^<V>]*$/)) return null;

    // Determine the cell directions.
    let cellDirections = [];
    for (let i = 0; i < 81; i++) {
      switch (text[i]) {
        case 'v':
          cellDirections.push(i+9);
          break;
        case '^':
          cellDirections.push(i-9);
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
    for (let i = 0; i < 81; i++) {
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
      cages.get(cageCell).cells.push(`R${(i/9|0)+1}C${i%9+1}`);
    }

    let constraints = [];
    for (const config of cages.values()) {
      constraints.push(new SudokuConstraint.Sum(config.sum, ...config.cells));
    }
    return new SudokuConstraint.Set(constraints);
  }

  static _parsePlainSudoku(text) {
    if (text.length != 81) return null;

    let fixedValues = [];
    let nonDigitCharacters = [];
    for (let i = 0; i < 81; i++) {
      let charCode = text.charCodeAt(i);
      if (charCode > CHAR_0 && charCode <= CHAR_9) {
        fixedValues.push(valueId(i/9|0, i%9, text[i]-1));
      } else {
        nonDigitCharacters.push(charCode);
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

  static Set = class extends SudokuConstraint {
    constructor(constraints) {
      super(arguments);
      this.constraints = constraints;
    }

    toString() {
      return this.constraints.map(c => c.toString()).join('');
    }
  }

  static Thermo = class extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static AntiKnight = class extends SudokuConstraint {}

  static AntiKing = class extends SudokuConstraint {}

  static AntiConsecutive = class extends SudokuConstraint {}

  static Diagonal = class extends SudokuConstraint {
    constructor(direction) {
      super(arguments);
      this.direction = direction;
    }
  }

  static Sum = class extends SudokuConstraint {
    constructor(sum, ...cells) {
      super(arguments);
      this.cells = cells;
      this.sum = sum;
    }
  }

  static AllDifferent = class extends SudokuConstraint {
    constructor(...cells) {
      super(arguments);
      this.cells = cells;
    }
  }

  static FixedValues = class extends SudokuConstraint {
    constructor(...values) {
      super(arguments);
      this.values = values;
      this._type = this.type;
    }

    toString() {
      this.type = '';
      let str = super.toString();
      this.type = this._type;
      return str;
    }
  }

  static TYPES = (() => {
    let map = new Map();
    for (const [key, value] of Object.entries(SudokuConstraint)) {
      map.set(value, key);
    }
    return map;
  })();
}
// Make FixedValues the default.
SudokuConstraint[''] = SudokuConstraint.FixedValues;
