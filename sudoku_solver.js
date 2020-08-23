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
  static build(constraint) {
    return new SudokuSolver(SudokuBuilder._handlers(constraint));
  }

  static *_handlers(constraint) {
    yield* SudokuBuilder._baseHandlers();
    yield* SudokuBuilder._constraintHandlers(constraint);
  }

  static *_baseHandlers() {
    // Row constraints.
    for (let row = 0; row < GRID_SIZE; row++) {
      let cells = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cells.push(row*GRID_SIZE+col);
      }
      yield new SudokuSolver.NonetHandler(cells);
    }

    // Column constraints.
    for (let col = 0; col < GRID_SIZE; col++) {
      let cells = [];
      for (let row = 0; row < GRID_SIZE; row++) {
        cells.push(row*GRID_SIZE+col);
      }
      yield new SudokuSolver.NonetHandler(cells);
    }

    // Box constraints.
    for (let b = 0; b < GRID_SIZE; b++) {
      let bi = b/BOX_SIZE|0;
      let bj = b%BOX_SIZE|0;
      let cells = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let row = BOX_SIZE*bi+(c%BOX_SIZE|0);
        let col = BOX_SIZE*bj+(c/BOX_SIZE|0);
        cells.push(row*GRID_SIZE+col);
      }
      yield new SudokuSolver.NonetHandler(cells);
    }
  }

  static *_constraintHandlers(constraint) {
    let cells;
    switch (constraint.type) {
      case 'AntiKnight':
        yield* this._antiHandlers(
          (r, c) => [[r+1, c+2], [r+2, c+1], [r+1, c-2], [r+2, c-1]]);
        break;

      case 'AntiKing':
        yield* this._antiHandlers((r, c) => [[r+1, c+1], [r+1, c-1]]);
        break;

      case 'AntiConsecutive':
        yield* this._antiConsecutiveHandlers();
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
          yield* this._constraintHandlers(c);
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
      for (let c = 0; c < GRID_SIZE; c++) {
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

  static *_antiConsecutiveHandlers() {
    const adjacentCellsFn = (r, c) => [[r+1, c], [r, c+1]];
    const constraintFn = (a, b) => (a != b+1 && a != b-1 && a != b);

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        let cell = r*GRID_SIZE+c;
        for (const [rr, cc] of adjacentCellsFn(r, c)) {
          if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
          let conflict = rr*GRID_SIZE+cc;
          yield new SudokuSolver.BinaryConstraintHandler(
            cell, conflict, constraintFn);
        }
      }
    }
  }
}
