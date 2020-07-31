const valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}#${n+1}`;
};

class SudokuConstraintConfig {
  constructor(args) {
    this.args = args || {};
  }

  toConstraint() {
    throw('Unimplemented');
  }

  type() {
    for (const [name,  type] of Object.entries(SudokuConstraintConfig)) {
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
          let type = SudokuConstraintConfig[value.type];
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
      constraints.push(new SudokuConstraintConfig.Sum(config));
    }
    return new SudokuConstraintConfig.Set({constraints: constraints});
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
      return new SudokuConstraintConfig.FixedCells({values: fixedValues});
    }

    try {
      return SudokuConstraintConfig.fromJSON(text);
      this.loadConstraint(constraint);
    } catch (e) {
      console.log(`Unrecognised input type (${e})`);
      return null;
    }
  }
}

SudokuConstraintConfig.Set = class extends SudokuConstraintConfig {
  constructor({constraints}) {
    super(arguments[0]);
    this._constraints = constraints || [];
  }

  add(constraint) {
    this._constraints.push(constraint);
  }

  toConstraint(solv) {
    return new ConstraintSolver.ConstraintSet(
      this._constraints.map(c => c.toConstraint()));
  }
}

SudokuConstraintConfig.Binary = class extends SudokuConstraintConfig {
  constructor({cells: [cell1,  cell2], fn}) {
    super(arguments[0]);
    this._constraint = new ConstraintSolver.BinaryConstraint(cell1, cell2, fn);
  }

  toConstraint() {
    return this._constraint;
  }
}

SudokuConstraintConfig.Thermo = class extends SudokuConstraintConfig {
  constructor({cells}) {
    super(arguments[0]);
    this._constraint = new ConstraintSolver.ConstraintSet(
      SudokuConstraintConfig.Thermo._makeBinaryConstraints(cells));
  }

  static _makeBinaryConstraints(cells) {
    let constraints = [];
    for (let i = 1; i < cells.length; i++) {
      constraints.push(
        new ConstraintSolver.BinaryConstraint(
          cells[i-1], cells[i], (a, b) => a < b));
    }
    return constraints;
  }

  toConstraint() {
    return this._constraint;
  }
}

SudokuConstraintConfig.AntiKnight = class extends SudokuConstraintConfig {
  constructor() {
    super();
    this._constraint = new ConstraintSolver.ConstraintSet(
      SudokuConstraintConfig.AntiKnight._makeBinaryConstraints());
  }

  static _cellId(r, c) {
    return `R${r}C${c}`;
  }

  static _makeBinaryConstraints() {
    let constraints = [];
    const boxNumber = (r, c) => ((r-1)/3|0)*3 + c%3;
    for (let r = 1; r < 10; r++) {
      for (let c = 1; c < 10; c++) {
        let cell = SudokuConstraintConfig.AntiKnight._cellId(r, c);
        let box = boxNumber(r, c);
        // We only need half the constraints, as the other half will be
        // added by the conflict cell.
        let conflicts = [[r+1, c+2], [r+2, c+1], [r+1, c-2], [r+2, c-1]];
        for (const [cr, cc] of conflicts) {
          // Skip any invalid cells or any in the same box as (r, c).
          if (cr > 0 && cr < 10 && cc > 0 && cc < 10) {
            if (boxNumber(cr, cc) != box) {
              let conflict = SudokuConstraintConfig.AntiKnight._cellId(cr, cc);
              constraints.push(
                new ConstraintSolver.BinaryConstraint(
                  cell, conflict, ((a, b) => a != b), true));
            }
          }
        }
      }
    }
    return constraints;
  }

  toConstraint() {
    return this._constraint;
  }
}

SudokuConstraintConfig.Diagonal = class extends SudokuConstraintConfig {
  constructor({direction}) {
    super(arguments[0]);
    this._constraint = new ConstraintSolver.ConstraintSet(
      SudokuConstraintConfig.Diagonal._makeConstraints(direction));
  }

  static _makeConstraints(direction) {
    let constraints = [];
    for (let n = 0; n < 9; n++) {
      let values = [];
      for (let i = 0; i < 9; i++) {
        values.push(valueId(i, direction > 0 ? 8-i : i, n));
      }
      let id = `diagonal_${direction > 0 ? '+' : '-'}_${n+1}`;
      constraints.push(new ConstraintSolver.OneOfConstraint(id, values));
    }

    return constraints;
  }

  toConstraint() {
    return this._constraint;
  }
}


SudokuConstraintConfig.Sum = class extends SudokuConstraintConfig {
  constructor({cells, sum}) {
    super(arguments[0]);
    this._constraint = new ConstraintSolver.SumConstraint(cells, sum);
  }

  toConstraint() {
    return this._constraint;
  }
}


SudokuConstraintConfig.FixedCells = class extends SudokuConstraintConfig {
  constructor({values}) {
    super(arguments[0]);
    this._constraint = new ConstraintSolver.ConstraintSet(
      values.map(
        v => new ConstraintSolver.OneOfConstraint(`fixed_${v}`, [v])));
  }

  toConstraint() {
    return this._constraint;
  }
}

class SudokuSolverBuilder {
  constructor() {
    this._valueMap = new Map();
    this._solverConstraints = [];
    this._makeBaseSudokuConstraints();
  }

  addConstraint(config) {
    this._solverConstraints.push(config.toConstraint());
  }

  build() {
    return new ConstraintSolver(
      this._solverConstraints,
      [...this._valueMap.keys()],
      this._valueMap);
  }

  _makeBaseSudokuConstraints() {
    let constraints = this._solverConstraints;

    // Create constrained values.
    let valueMap = this._valueMap;
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        for (let n = 0; n < 9; n++) {
          valueMap.set(valueId(i, j, n), n+1);
        }
      }
    }

    // Add constraints.

    // Each cell can only have one value.
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        let values = [];
        for (let n = 0; n < 9; n++) {
          values.push(valueId(i, j, n));
        }
        constraints.push(
          new ConstraintSolver.OneOfConstraint(`R${i+1}C${j+1}`, values));
      }
    }

    // Each row can only have one of each value.
    for (let i = 0; i < 9; i++) {
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let j = 0; j < 9; j++) {
          values.push(valueId(i, j, n));
        }
        constraints.push(
          new ConstraintSolver.OneOfConstraint(`R${i+1}#${n+1}`, values));
      }
    }

    // Each column can only have one of each value.
    for (let j = 0; j < 9; j++) {
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let i = 0; i < 9; i++) {
          values.push(valueId(i, j, n));
        }
        constraints.push(
          new ConstraintSolver.OneOfConstraint(`C${j+1}#${n+1}`, values));
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
        constraints.push(
          new ConstraintSolver.OneOfConstraint(`B${i+1}${j+1}#${n+1}`, values));
      }
    }

    return constraints;
  }
}
