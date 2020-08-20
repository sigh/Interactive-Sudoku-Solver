const valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}#${n+1}`;
};

class SudokuConstraint {
  constructor(args) {
    this.args = args || {};
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

  *handlers() {
    for (const constraint of this._constraints) {
      yield* constraint.handlers();
    }
  }
}

SudokuConstraint.Binary = class extends SudokuConstraint {
  constructor({cells: [cell1,  cell2], fn}) {
    super(arguments[0]);
    this._cells = cells;
    this._fn = fn;
  }

  *handler() {
    yield new SudokuSolver.BinaryConstraintHandler(...this._cells, this._fn);
  }
}

SudokuConstraint.Thermo = class extends SudokuConstraint {
  constructor({cells}) {
    super(arguments[0]);
    this._cells = cells.map(SudokuConstraint.parseCellId);
  }

  *handlers() {
    let constraints = [];
    let cells = this._cells;
    for (let i = 1; i < cells.length; i++) {
      yield new SudokuSolver.BinaryConstraintHandler(
        cells[i-1], cells[i], (a, b) => a < b);
    }
  }
}

SudokuConstraint._Anti = class extends SudokuConstraint {
  constructor() {
    super();
  }

  *handlers() {
    let constraints = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 1; c < GRID_SIZE; c++) {
        let cell = r*GRID_SIZE+c;
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        let conflicts = this.cellConflicts(r, c);
        for (const [rr, cc] of this.cellConflicts(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = rr*GRID_SIZE+cc;
          yield new SudokuSolver.AllDifferentHandler([cell, conflict]);
        }
      }
    }
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

  *handlers() {
    let cells = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      let c = this._direction > 0 ? GRID_SIZE-r-1 : r;
      cells.push(r*GRID_SIZE+c);
    }

    yield new SudokuSolver.NonetHandler(cells);
  }
}

SudokuConstraint.Sum = class extends SudokuConstraint {
  constructor({cells, sum}) {
    super(arguments[0]);
    this._cells = cells.map(SudokuConstraint.parseCellId);
    this._sum = sum;
  }

  *handlers() {
    yield new SudokuSolver.SumHandler(this._cells, this._sum);
  }
}

SudokuConstraint.FixedCells = class extends SudokuConstraint {
  constructor({values}) {
    super(arguments[0]);
    this._valueIds = values;
  }

  *handlers() {
    let valueMap = new Map();
    for (const valueId of this._valueIds) {
      let {cell, value} = SudokuConstraint.parseValueId(valueId);
      valueMap.set(cell, value);
    }
    yield new SudokuSolver.FixedCellsHandler(valueMap);
  }
}

SudokuConstraint.AllDifferent = class extends SudokuConstraint {
  constructor({cells}) {
    super(arguments[0]);
    this._cells = cells;
  }

  *handlers() {
    yield new SudokuSolver.AllDifferentHandler(this._cells);
    if (this._cells.length == 9) {
      yield new SudokuSolver.NonetHandler(this._cells);
    }
  }
}

class SudokuBuilder {
  constructor() {
    this._constraints = [];
    this._makeBaseSudokuConstraints();
  }

  addConstraint(constraint) {
    this._constraints.push(constraint);
  }

  build() {
    let constraint = new SudokuConstraint.Set(
      {constraints: this._constraints});
    return new SudokuSolver(constraint.handlers());
  }

  _makeBaseSudokuConstraints() {
    // Row constraints.
    for (let row = 0; row < GRID_SIZE; row++) {
      let cells = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cells.push(row*GRID_SIZE+col);
      }
      this.addConstraint(new SudokuConstraint.AllDifferent({cells: cells}));
    }

    // Column constraints.
    for (let col = 0; col < GRID_SIZE; col++) {
      let cells = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        cells.push(row*GRID_SIZE+col);
      }
      this.addConstraint(new SudokuConstraint.AllDifferent({cells: cells}));
    }

    // Box constraints.
    for (let b = 0; b < GRID_SIZE; b++) {
      let bi = b/3|0;
      let bj = b%3;
      let cells = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let row = BOX_SIZE*bi+(c%3|0);
        let col = BOX_SIZE*bj+(c/3|0);
        cells.push(row*GRID_SIZE+col);
      }
      this.addConstraint(new SudokuConstraint.AllDifferent({cells: cells}));
    }
  }
}
