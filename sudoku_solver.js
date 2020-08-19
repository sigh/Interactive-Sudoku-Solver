const valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}#${n+1}`;
};

class SudokuConstraint {
  constructor(args) {
    this.args = args || {};
  }

  toConstraint() {
    throw('Unimplemented');
  }

  type() {
    for (const [name,  type] of Object.entries(SudokuConstraint)) {
      if (type == this.constructor) return name;
    }
    throw('Unknown constraint');
  }

  toJSON() {
    let type = this.type();  // Ensure type comes first.
    return {type: type, ...this.args};
  }

  static fromJSON(json) {
    return JSON.parse(json, (key, value) => {
      if (typeof value === 'object') {
        if (value.type) {
          let type = SudokuConstraint[value.type];
          return new type(value);
        }
      }
      return value;
    });
  }

  static _parseKillerFormat(text) {
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
      constraints.push(new SudokuConstraint.Sum(config));
    }
    return new SudokuConstraint.Set({constraints: constraints});
  }

  static fromText(text) {
    text = text.trim();

    if (text.length == 81 && text.match(/[^<V>]/)) {
      return this._parseKillerFormat(text);
    }

    if (text.length == 81) {
      let fixedValues = [];
      for (let i = 0; i < 81; i++) {
        let charCode = text.charCodeAt(i);
        if (charCode > CHAR_0 && charCode <= CHAR_9) {
          fixedValues.push(valueId(i/9|0, i%9, text[i]-1));
        }
      }
      return new SudokuConstraint.FixedCells({values: fixedValues});
    }

    try {
      return SudokuConstraint.fromJSON(text);
      this.loadConstraint(constraint);
    } catch (e) {
      console.log(`Unrecognised input type (${e})`);
      return null;
    }
  }

  static parseValueId(valueId) {
    return {
      cell: this.parseCellId(valueId),
      value: +valueId[5],
    };
  }

  static parseCellId(cellId) {
    let row = +cellId[1]-1;
    let col = +cellId[3]-1;
    return row*GRID_SIZE+col;
  }
}

SudokuConstraint.Set = class extends SudokuConstraint {
  constructor({constraints}) {
    super(arguments[0]);
    this._constraints = constraints || [];
  }

  add(constraint) {
    this._constraints.push(constraint);
  }

  toConstraint(solv) {
    return new SudokuSolver.ConstraintSet(
      this._constraints.map(c => c.toConstraint()));
  }
}

SudokuConstraint.Binary = class extends SudokuConstraint {
  constructor({cells: [cell1,  cell2], fn}) {
    super(arguments[0]);
    this._cells = cells;
    this._fn = fn;
  }

  toConstraint() {
    return new SudokuSolver.BinaryConstraint(...this._cells[0], fn);
  }
}

SudokuConstraint.Thermo = class extends SudokuConstraint {
  constructor({cells}) {
    super(arguments[0]);
    this._cells = cells.map(SudokuConstraint.parseCellId);
  }

  toConstraint() {
    let constraints = [];
    let cells = this._cells;
    for (let i = 1; i < cells.length; i++) {
      constraints.push(
        new SudokuSolver.BinaryConstraint(
          cells[i-1], cells[i], (a, b) => a < b));
    }
    return new SudokuSolver.ConstraintSet(constraints);
  }
}

SudokuConstraint._Anti = class extends SudokuConstraint {
  constructor() {
    super();
  }

  toConstraint() {
    let constraints = [];

    for (let r = 0; r < 10; r++) {
      for (let c = 1; c < 10; c++) {
        let cell = r*GRID_SIZE+c;
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        let conflicts = this.cellConflicts(r, c);
        for (const [cr, cc] of this.cellConflicts(r, c)) {
          let conflict = cr*GRID_SIZE+cc;
          if (conflict >=0 && conflict < NUM_CELLS) {
            constraints.push(new SudokuSolver.AllDifferent([cell, conflict]));
          }
        }
      }
    }

    return new SudokuSolver.ConstraintSet(constraints);
  }

  cellConflicts(r, c) {
    throw('Not implemented');
  }
}

SudokuConstraint.AntiKnight = class extends SudokuConstraint._Anti {
  cellConflicts(r, c) {
    return [[r+1, c+2], [r+2, c+1], [r+1, c-2], [r+2, c-1]];
  }
}

SudokuConstraint.AntiKing = class extends SudokuConstraint._Anti {
  cellConflicts(r, c) {
    return [[r+1, c+1], [r+1, c-1]];
  }
}

SudokuConstraint.Diagonal = class extends SudokuConstraint {
  constructor({direction}) {
    super(arguments[0]);
    this._direction = direction;
  }

  toConstraint() {
    let cells = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      let c = this._direction > 0 ? GRID_SIZE-r-1 : r;
      cells.push(r*GRID_SIZE+c);
    }

    return new SudokuSolver.AllDifferent(cells);
  }
}

SudokuConstraint.Sum = class extends SudokuConstraint {
  constructor({cells, sum}) {
    super(arguments[0]);
    this._cells = cells.map(SudokuConstraint.parseCellId);
    this._sum = sum;
  }

  toConstraint() {
    return new SudokuSolver.Sum(this._cells, this._sum);
  }
}


SudokuConstraint.FixedCells = class extends SudokuConstraint {
  constructor({values}) {
    super(arguments[0]);
    this._values = values;
  }

  toConstraint() {
    return new SudokuSolver.FixedCells(this._values);
  }
}

class SudokuBuilder {
  constructor() {
    this._solverConstraints = [];
    this._makeBaseSudokuConstraints();
  }

  addConstraint(config) {
    this._solverConstraints.push(config.toConstraint());
  }

  build() {
    return new SudokuSolver(
      new SudokuSolver.ConstraintSet(this._solverConstraints));
  }

  _makeBaseSudokuConstraints() {
    let constraints = this._solverConstraints;

    // Row constraints.
    for (let row = 0; row < GRID_SIZE; row++) {
      let cellIds = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cellIds.push(row*GRID_SIZE+col);
      }
      constraints.push(new SudokuSolver.AllDifferent(cellIds));
    }

    // Column constraints.
    for (let col = 0; col < GRID_SIZE; col++) {
      let cellIds = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        cellIds.push(row*GRID_SIZE+col);
      }
      constraints.push(new SudokuSolver.AllDifferent(cellIds));
    }

    // Box constraints.
    for (let b = 0; b < GRID_SIZE; b++) {
      let bi = b/3|0;
      let bj = b%3;
      let cellIds = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let row = BOX_SIZE*bi+(c%3|0);
        let col = BOX_SIZE*bj+(c/3|0);
        cellIds.push(row*GRID_SIZE+col);
      }
      constraints.push(new SudokuSolver.AllDifferent(cellIds));
    }

    return constraints;
  }
}
