const valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}_${n+1}`;
};

const cellId = (row, col) => {
  return id = `R${row+1}C${col+1}`;
};

const parseValueId = (valueId) => {
  return {
    cell: parseCellId(valueId),
    value: +valueId[5],
  };
};

const parseCellId = (cellId) => {
  let row = +cellId[1]-1;
  let col = +cellId[3]-1;
  return row*GRID_SIZE+col;
};

class SudokuBuilder {
  constructor() {
    this._constraints = [];
    this._makeBaseSudokuConstraints();
  }

  addConstraint(constraint) {
    this._constraints.push(constraint);
  }

  build() {
    let constraintSet = new SudokuConstraint.Set(this._constraints);
    let handlers = SudokuBuilder._handlers(constraintSet);
    return new SudokuSolver(handlers);
  }

  _makeBaseSudokuConstraints() {
    // Row constraints.
    for (let row = 0; row < GRID_SIZE; row++) {
      let cells = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cells.push(cellId(row, col));
      }
      this.addConstraint(new SudokuConstraint.AllDifferent(...cells));
    }

    // Column constraints.
    for (let col = 0; col < GRID_SIZE; col++) {
      let cells = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        cells.push(cellId(row, col));
      }
      this.addConstraint(new SudokuConstraint.AllDifferent(...cells));
    }

    // Box constraints.
    for (let b = 0; b < GRID_SIZE; b++) {
      let bi = b/3|0;
      let bj = b%3;
      let cells = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let row = BOX_SIZE*bi+(c%3|0);
        let col = BOX_SIZE*bj+(c/3|0);
        cells.push(cellId(row, col));
      }
      this.addConstraint(new SudokuConstraint.AllDifferent(...cells));
    }
  }

  static *_handlers(constraint) {
    let cells;
    switch (constraint.type) {
      case 'AntiKnight':
        yield* this._antiHandlers(
          (r, c) => [[r+1, c+2], [r+2, c+1], [r+1, c-2], [r+2, c-1]]);
        break;

      case 'AntiKing':
        yield* this._antiHandlers((r, c) => [[r+1, c+1], [r+1, c-1]]);
        break;

      case 'Diagonal':
        cells = [];
        for (let r = 0; r < GRID_SIZE; r++) {
          let c = constraint.direction > 0 ? GRID_SIZE-r-1 : r;
          cells.push(r*GRID_SIZE+c);
        }
        yield *this._allDifferentHandlers(cells);
        break;

      case 'Sum':
        cells = constraint.cells.map(parseCellId);
        yield new SudokuSolver.SumHandler(cells, constraint.sum);
        break;

      case 'AllDifferent':
        cells = constraint.cells.map(parseCellId);
        yield *this._allDifferentHandlers(cells);
        break;

      case 'FixedValues':
        let valueMap = new Map();
        for (const valueId of constraint.values) {
          let {cell, value} = parseValueId(valueId);
          valueMap.set(cell, value);
        }
        yield new SudokuSolver.FixedCellsHandler(valueMap);
        break;

      case 'Thermo':
        cells = constraint.cells.map(parseCellId);
        for (let i = 1; i < cells.length; i++) {
          yield new SudokuSolver.BinaryConstraintHandler(
            cells[i-1], cells[i], (a, b) => a < b);
        }
        break;

      case 'Set':
        for (const c of constraint.constraints) {
          yield* this._handlers(c);
        }
        break;

      default:
        throw('Unknown constraint type: ' + constraint.type);
    }
  }

  static *_allDifferentHandlers(cells) {
    cells.sort((a, b) => a-b);
    if (cells.length > GRID_SIZE) throw('Too many cells for AllDifferent');
    if (cells.length < GRID_SIZE) {
      yield new SudokuSolver.AllDifferentHandler(cells);
      return;
    }

    // Exactly 9 cells.
    yield new SudokuSolver.NonetHandler(cells);
  }

  static *_antiHandlers(conflictFn) {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 1; c < GRID_SIZE; c++) {
        let cell = r*GRID_SIZE+c;
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        for (const [rr, cc] of conflictFn(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = rr*GRID_SIZE+cc;
          yield new SudokuSolver.AllDifferentHandler([cell, conflict]);
        }
      }
    }
  }
}
