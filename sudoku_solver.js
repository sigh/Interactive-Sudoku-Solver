const valueId = (row, col, n) => {
  return id = `R${row+1}C${col+1}#${n+1}`;
};

class SudokuSolver {
  solve(valueIds) {
    let matrix = this._makeBaseSudokuConstraints();
    this._addFixedSquares(matrix, valueIds);
    return matrix.solve();
  }

  _addFixedSquares(baseContraints, fixedValues) {
    for (const valueId of fixedValues) {
      baseContraints.addConstraint(`fixed_${valueId}`, [valueId]);
    }
  }

  _makeBaseSudokuConstraints() {
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

    let constraints = new ContraintMatrix(Object.keys(valueMap));

    // Add constraints.

    // Each cell can only have one value.
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        let values = [];
        for (let n = 0; n < 9; n++) {
          values.push(valueId(i, j, n));
        }
        constraints.addConstraint(`R${i}C${j}`, values);
      }
    }

    // Each row can only have one of each value.
    for (let i = 0; i < 9; i++) {
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let j = 0; j < 9; j++) {
          values.push(valueId(i, j, n));
        }
        constraints.addConstraint(`R${i}#${n}`, values);
      }
    }

    // Each column can only have one of each value.
    for (let j = 0; j < 9; j++) {
      for (let n = 0; n < 9; n++) {
        let values = [];
        for (let i = 0; i < 9; i++) {
          values.push(valueId(i, j, n));
        }
        constraints.addConstraint(`C${j}#${n}`, values);
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
        constraints.addConstraint(`B${i}${j}#${n}`, values);
      }
    }

    return constraints;
  }
}

class SudokuGridGenerator {
  constructor() {
    this.allValues = this._allValues();
  }

  randomGrid(numSquares) {
    this._shuffle(this.allValues);
    return this.allValues.slice(0, numSquares);
  }

  _allValues() {
    let values = [];

    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        for (let n = 0; n < 9; n++) {
          values.push(valueId(i, j, n));
        }
      }
    }

    return values;
  }

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

const benchmarkSudoku = (squares, iterations) => {
  let generator = new SudokuGridGenerator();
  let totalTime = 0;
  let totalSolved = 0;
  let totalBacktracks = 0;
  for (let i = 0; i < iterations; i++) {
    let values = generator.randomGrid(squares);
    let solution = (new SudokuSolver()).solve(values);
    totalTime += solution.timeMs;
    totalSolved += (solution.values != null);
    totalBacktracks += solution.numBacktracks;
  }

  return {
    averageTime: totalTime/iterations,
    averageBacktracks: totalBacktracks/iterations,
    fractionSolved: totalSolved/iterations,
  };
}

let badSolve = () => {
  // Bad count
  // let badValues = ["R4C6#2", "R8C2#2", "R3C9#3", "R8C6#4", "R2C2#2"];
  // Inf loop
  // let badValues = ["R5C8#8", "R1C3#9", "R4C7#5", "R5C5#2", "R2C9#6"];
  // Inf loop
  // let badValues = ["R7C7#9", "R6C5#9", "R1C3#1", "R7C3#7", "R7C9#1"];
  // Bad count
  let badValues = ["R6C7#6", "R2C9#3", "R8C2#1", "R3C5#7", "R1C2#3"];
  let solver = (new SudokuSolver());
  return solver.solve(badValues);
}
