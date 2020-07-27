const valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}#${n+1}`;
};

class SudokuConstraint {
  constructor(args) {
    this.args = args || {};
  }

  apply(constraintSolver) {
    throw('Unimplemented');
  }

  _getType() {
    for (const [name,  type] of Object.entries(SudokuConstraint)) {
      if (type == this.constructor) return name;
    }
    throw('Unknown constraint');
  }

  toJSON() {
    let type = this._getType();  // Ensure type comes first.
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
}

class ConstraintSet extends SudokuConstraint {
  constructor(args) {
    args = args || {};
    super(args);
    this._constraints = args.constraints || [];
  }

  add(constraint) {
    this._constraints.push(constraint);
  }

  apply(constraintSolver) {
    this._constraints.forEach(c => c.apply(constraintSolver));
  }
}

class BinaryConstraint extends SudokuConstraint {
  constructor(args) {
    super(args);
    this.cell1 = args.cells[0];
    this.cell2 = args.cells[1];
    this.rawFn = args.fn;
    this.fn = BinaryConstraint._makeMappedFn(this.cell1, this.cell2, this.rawFn);
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
  constructor(args) {
    super(args);
    this._cells = args.cells;
    this._constraints = ThermoConstraint._makeBinaryConstraints(args.cells);
  }

  static _makeBinaryConstraints(cells) {
    let constraints = [];
    for (let i = 1; i < cells.length; i++) {
      constraints.push(
        new BinaryConstraint({cells: [cells[i-1], cells[i]], fn: (a, b) => a < b}));
    }
    return constraints;
  }

  apply(constraintSolver) {
    for (const c of this._constraints) {
      c.apply(constraintSolver);
    }
  }
}

class FixedCellsConstraint extends SudokuConstraint {
  constructor(args) {
    super(args);
    this._valueIds = args.values;
  }

  apply(constraintSolver) {
    for (const valueId of this._valueIds) {
      constraintSolver.addConstraint(`fixed_${valueId}`, [valueId]);
    }
  }
}

class AntiKnightConstraint extends SudokuConstraint {
  constructor(args) {
    super(args);
    this._constraints = AntiKnightConstraint._makeBinaryConstraints();
  }

  static _cellId(r, c) {
    return `R${r}C${c}`;
  }

  static _makeBinaryConstraints() {
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
                new BinaryConstraint({cells: [cell, conflict], fn: (a, b) => a != b}));
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
}

class SumConstraint extends SudokuConstraint {
  constructor(args) {
    super(args);
    this._cellIds = args.cells;
    this._sum = args.sum;
  }

  apply(constraintSolver) {
    constraintSolver.addSumConstraint(`sum_${this._sum}`, this._cellIds, this._sum);
  }
}

SudokuConstraint.Set = ConstraintSet;
SudokuConstraint.Binary = BinaryConstraint;
SudokuConstraint.Thermo = ThermoConstraint;
SudokuConstraint.AntiKnight = AntiKnightConstraint;
SudokuConstraint.Sum = SumConstraint;
SudokuConstraint.FixedCells = FixedCellsConstraint;

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

  solveAllPossibilities(valueIds, constraints) {
    return this._constraintSolver.solveAllPossibilities();
  }

  static _makeBaseSudokuConstraints() {
    // Create constrained values.
    let valueMap = new Map();
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        for (let n = 0; n < 9; n++) {
          valueMap.set(valueId(i, j, n), n+1);
        }
      }
    }

    let constraints = new ConstraintSolver([...valueMap.keys()]);
    constraints.setWeights(valueMap);

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
