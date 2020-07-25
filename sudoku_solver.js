valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}#${n+1}`;
};

class SudokuConstraint {
  apply(constraintSolver) {
    throw('Unimplemented');
  }
}

class ConstraintSet extends SudokuConstraint {
  constructor(constraints) {
    super();
    this._constraints = constraints || [];
  }

  add(constraint) {
    this._constraints.push(constraint);
  }

  apply(constraintSolver) {
    this._constraints.forEach(c => c.apply(constraintSolver));
  }

  toString() {
    let children = this._constraints.map(c => c.toString());
    return `new ${this.constructor.name}([${children.join(",")}])`;
  }
}

class BinaryConstraint extends SudokuConstraint {
  constructor(cell1, cell2, rawFn) {
    super();
    this.cell1 = cell1;
    this.cell2 = cell2;
    this.rawFn = rawFn;
    this.fn = BinaryConstraint._makeMappedFn(cell1, cell2, rawFn);
  }

  static _makeMappedFn(cell1, cell2, fn) {
    let value = new Map();
    for (let i = 1; i < 10; i++) {
      value.set(`${cell1}#${i}`, i);
      value.set(`${cell2}#${i}`, i);
    }
    return (a, b) => fn(value.get(a), value.get(b));
  }

  apply(constraintSolver) {
    constraintSolver.addBinaryConstraint(this.cell1, this.cell2, this.fn);
  }
}

class ThermoConstraint extends SudokuConstraint {
  constructor(cells) {
    super();
    this._cells = cells;
    this._constraints = ThermoConstraint._makeBinaryConstraints(cells);
  }

  static _makeBinaryConstraints(cells) {
    let constraints = [];
    for (let i = 1; i < cells.length; i++) {
      constraints.push(
        new BinaryConstraint(cells[i-1], cells[i], (a, b) => a < b));
    }
    return constraints;
  }

  apply(constraintSolver) {
    for (const c of this._constraints) {
      c.apply(constraintSolver);
    }
  }

  toString() {
    let input = JSON.stringify(this._cells);
    return `new ${this.constructor.name}(${input})`;
  }
}

class FixedCellsConstraint extends SudokuConstraint {
  constructor(valueIds) {
    super();
    this._valueIds = valueIds;
  }

  apply(constraintSolver) {
    for (const valueId of this._valueIds) {
      constraintSolver.addConstraint(`fixed_${valueId}`, [valueId]);
    }
  }

  toString() {
    let input = JSON.stringify(this._valueIds);
    return `new ${this.constructor.name}(${input})`;
  }
}

class AntiKnightConstraint extends SudokuConstraint {
  constructor(cells) {
    super();
    this._constraints = AntiKnightConstraint._makeBinaryConstraints();
  }

  static _cellId(r, c) {
    return `R${r}C${c}`;
  }

  static _makeBinaryConstraints(cells) {
    let constraints = [];
    const boxNumber = (r, c) => ((r-1)/3|0)*3 + c%3;
    for (let r = 1; r < 10; r++) {
      for (let c = 1; c < 10; c++) {
        let cell = AntiKnightConstraint._cellId(r, c);
        let box = boxNumber(r, c);
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        let conflicts = [[r+1, c+2], [r+2, c+1], [r+1, c-2], [r+2, c-1]];
        for (const [cr, cc] of conflicts) {
          // Skip any invalid cells or any in the same box as (r, c).
          if (cr > 0 && cr < 10 && cc > 0 && cc < 10) {
            if (boxNumber(cr, cc) != box) {
              let conflict = AntiKnightConstraint._cellId(cr, cc);
              constraints.push(
                new BinaryConstraint(cell, conflict, (a, b) => a != b));
            }
          }
        }
      }
    }
    return constraints;
  }

  apply(constraintSolver) {
    for (const c of this._constraints) {
      c.apply(constraintSolver);
    }
  }

  toString() {
    return `new ${this.constructor.name}()`;
  }
}

class SudokuSolver {
  constructor() {
    this._constraintSolver = SudokuSolver._makeBaseSudokuConstraints();
    this._constraints = [];
  }

  addConstraint(constraint) {
    constraint.apply(this._constraintSolver);
    this._constraints.push(constraint);
  }

  solve() {
    return this._constraintSolver.solve();
  }

  solveAllPossibilities(valueIds, constraints) { return this._constraintSolver.solveAllPossibilities();
  }

  static _makeBaseSudokuConstraints() {
    // Create constrained values.
    let valueMap = {};
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        for (let n = 0; n < 9; n++) {
          let id = valueId(i, j, n);
          valueMap[id] = [i, j, n];
        }
      }
    }

    let constraints = new ConstraintSolver(Object.keys(valueMap));

    // Add constraints.

    // Each cell can only have one value.
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        let values = [];
        for (let n = 0; n < 9; n++) {
          values.push(valueId(i, j, n));
        }
        constraints.addConstraint(`R${i+1}C${j+1}`, values);
      }
    }

    // Each row can only have one of each value.
    for (let i = 0; i < 9; i++) {
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let j = 0; j < 9; j++) {
          values.push(valueId(i, j, n));
        }
        constraints.addConstraint(`R${i+1}#${n+1}`, values);
      }
    }

    // Each column can only have one of each value.
    for (let j = 0; j < 9; j++) {
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let i = 0; i < 9; i++) {
          values.push(valueId(i, j, n));
        }
        constraints.addConstraint(`C${j+1}#${n+1}`, values);
      }
    }

    // Each box can only have one value.
    for (let b = 0; b < 9; b++) {
      let i = b/3|0;
      let j = b%3;
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let c = 0; c < 9; c++) {
          values.push(valueId(3*i+c%3, 3*j+(c/3|0), n));
        }
        constraints.addConstraint(`B${i+1}${j+1}#${n+1}`, values);
      }
    }

    return constraints;
  }
}
