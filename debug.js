class SudokuGridGenerator {
  constructor() {
    this.allValues = SudokuGridGenerator._allValues();
  }

  randomGrid(numSquares) {
    SudokuGridGenerator._shuffle(this.allValues);
    return this.allValues.slice(0, numSquares);
  }

  static _allValues() {
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

  static _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

// Test example from https://en.wikipedia.org/wiki/Knuth%27s_Algorithm_X
const makeTestMatrix = () => {
  let matrix = new ConstraintSolver(['A', 'B', 'C', 'D', 'E', 'F']);
  matrix.addConstraint(1, ['A', 'B']);
  matrix.addConstraint(2, ['E', 'F']);
  matrix.addConstraint(3, ['D', 'E']);
  matrix.addConstraint(4, ['A', 'B', 'C']);
  matrix.addConstraint(5, ['C', 'D']);
  matrix.addConstraint(6, ['D', 'E']);
  matrix.addConstraint(7, ['A', 'E', 'F']);
  return matrix;
}

const sampleGrids = ({
  // Adding "R7C2#7" breaks it.
  a: ["R1C1#8", "R1C2#4", "R1C5#6", "R1C7#5", "R1C9#1", "R2C6#3", "R2C8#4",
  "R3C3#6", "R3C4#9", "R3C9#7", "R4C2#2", "R4C4#7", "R4C5#1", "R4C9#6",
  "R5C4#6", "R5C5#3", "R6C1#9", "R6C8#5", "R7C5#4", "R7C8#6", "R8C1#2",
  "R8C7#1", "R8C8#8"],
  // Unique solution:
  b: ["R1C1#4", "R1C3#5", "R1C4#7", "R2C1#9", "R2C2#2", "R3C7#1", "R3C8#5",
  "R3C9#8", "R4C8#6", "R4C9#9", "R5C2#8", "R5C6#6", "R5C7#7", "R6C2#9",
  "R6C9#1", "R7C1#6", "R7C5#9", "R7C9#3", "R8C6#7", "R8C7#6", "R9C1#5",
  "R9C4#1", "R9C9#2"],
  // Very hard (2s+) from norvig.com/sudoku to find all values.
  // Requires ~4.2M nodes searched to solveAll.
  c: ["R1C6#6", "R2C2#5", "R2C3#9", "R2C9#8", "R3C1#2", "R3C6#8", "R4C2#4",
      "R4C3#5", "R5C3#3", "R6C3#6", "R6C6#3", "R6C8#5", "R6C9#4", "R7C4#3",
      "R7C5#2", "R7C6#5", "R7C9#6"],
  // Very hard (2s+)
  // Requires ~4.4M nodes searched to solveAll.
  d: ["R1C6#5", "R1C8#8", "R2C4#6", "R2C6#1", "R2C8#4", "R2C9#3", "R4C2#1",
      "R4C4#5", "R5C4#1", "R5C6#6", "R6C1#3", "R6C9#5", "R7C1#5", "R7C2#3",
      "R7C8#9", "R7C9#1", "R8C9#4"] ,
});

const benchmarkSolve = (squares, iterations) => {
  let generator = new SudokuGridGenerator();
  let totalTime = 0;
  let totalSolved = 0;
  let totalBacktracks = 0;
  for (let i = 0; i < iterations; i++) {
    let values = generator.randomGrid(squares);
    let result = (new SudokuSolver()).solve(values);
    totalTime += result.timeMs;
    totalSolved += (result.values.length > 0);
    totalBacktracks += result.numBacktracks;
  }

  return {
    averageTime: totalTime/iterations,
    averageBacktracks: totalBacktracks/iterations,
    fractionSolved: totalSolved/iterations,
  };
};

const benchmarkSolveAll = (squares, iterations) => {
  let generator = new SudokuGridGenerator();
  let totalTime = 0;
  let totalSolved = 0;
  let totalBacktracks = 0;
  let totalRowsExplored = 0;
  for (let i = 0; i < iterations; i++) {
    let values = generator.randomGrid(squares);
    let result = (new SudokuSolver()).solveAllPossibilities(values);
    totalTime += result.timeMs;
    totalSolved += (result.values.length > 0);
    totalBacktracks += result.numBacktracks;
    totalRowsExplored += result.rowsExplored;
  }

  return {
    averageTime: totalTime/iterations,
    averageBacktracks: totalBacktracks/iterations,
    averageRowsExplored: totalRowsExplored/iterations,
    fractionSolved: totalSolved/iterations,
  };
}

const testBadThermo2 = () => {
  // The thermo in https://www.youtube.com/watch?v=lgJYOuVk910 with mods.
  // This showed a bug in the search (now fixed).
  constraintManager.clear();
  grid.setCellValues(["R1C2#4", "R2C1#2", "R8C1#9", "R9C2#1"]);
  constraintManager.addConstraint(["R9C4", "R8C3", "R7C2", "R6C1", "R5C2", "R4C3"]);
  constraintManager.addConstraint(["R4C1", "R3C2", "R2C3", "R1C4", "R2C5", "R3C6"]);
  constraintManager.addConstraint(["R1C6", "R2C7", "R3C8", "R4C9", "R5C8", "R6C7"]);
  constraintManager.addConstraint(["R6C9", "R7C8", "R8C7", "R9C6", "R8C5", "R7C4"]);
  constraintManager.addConstraint(["R5C4", "R5C5"]);
  grid.runUpdateCallback();

  // Note: https://www.youtube.com/watch?v=ySPrdlfPHZs also causes a long search
  // when partially filled in.
}

const testBadThermo = () => {
  // The thermo in https://www.youtube.com/watch?v=lgJYOuVk910.
  // This showed a bug in search.
  constraintManager.clear();
  grid.setCellValues(["R1C2#4", "R1C8#1", "R2C1#2", "R2C9#6", "R8C1#9", "R8C9#2", "R9C2#1", "R9C8#9"]);
  constraintManager.addConstraint(["R9C4", "R8C3", "R7C2", "R6C1", "R5C2", "R4C3"]);
  constraintManager.addConstraint(["R4C1", "R3C2", "R2C3", "R1C4", "R2C5", "R3C6"]);
  constraintManager.addConstraint(["R1C6", "R2C7", "R3C8", "R4C9", "R5C8", "R6C7"]);
  constraintManager.addConstraint(["R6C9", "R7C8", "R8C7", "R9C6", "R8C5", "R7C4"]);
  constraintManager.addConstraint(["R5C4", "R5C5"]);
  grid.runUpdateCallback();
}

const testBrokenKiller = () => {
  // Partial taken from https://en.wikipedia.org/wiki/Killer_sudoku
  // If you remove the constraint R7C1#8 it fails to find a solution!
  grid.setCellValues(["R2C1#3","R6C1#9","R7C1#8"]);
  constraintManager.addConstraint(["R1C1","R1C2"], 3);
  constraintManager.addConstraint(["R1C3","R1C4","R1C5"], 15);
  constraintManager.addConstraint(["R2C1","R2C2","R3C1","R3C2"], 25);
  constraintManager.addConstraint(["R2C3","R2C4"], 17);
  constraintManager.addConstraint(["R3C3","R3C4","R4C4"], 9);
  constraintManager.addConstraint(["R1C6","R2C5","R2C6","R3C5"], 22);
  constraintManager.addConstraint(["R1C7","R2C7"], 4);
  constraintManager.addConstraint(["R1C8","R2C8"], 16);
  constraintManager.addConstraint(["R1C9","R2C9","R3C9","R4C9"], 15);
  constraintManager.addConstraint(["R3C7","R3C8","R4C7"], 20);
  constraintManager.addConstraint(["R3C6","R4C6","R5C6"], 8);
  constraintManager.addConstraint(["R4C5","R5C5","R6C5"], 17);
  constraintManager.addConstraint(["R5C4","R6C4","R7C4"], 20);
  constraintManager.addConstraint(["R4C2","R4C3"], 14);
  constraintManager.addConstraint(["R4C1","R5C1"], 6);
  constraintManager.addConstraint(["R5C2","R5C3","R6C2"], 13);
  constraintManager.addConstraint(["R6C3","R7C2","R7C3"], 6);
  constraintManager.addConstraint(["R4C8","R5C7","R5C8"], 17);
  constraintManager.addConstraint(["R6C1","R7C1","R8C1","R9C1"], 27);
  grid.updateCallback();
}


// Slow thermo ~1.14 seconds.
const testSlowThermo = () => {
  constraintManager.clear();
  grid.setCellValues(["R4C6#1", "R5C3#2", "R9C5#1"]);
  constraintManager.addConstraint(["R7C5", "R7C6", "R7C7", "R6C7", "R5C7", "R4C7"]);
  constraintManager.addConstraint(["R4C8", "R3C8", "R3C7", "R3C6", "R3C5"]);
  constraintManager.addConstraint(["R2C5", "R2C4", "R3C4", "R4C4", "R5C4"]);
  constraintManager.addConstraint(["R2C1", "R2C2", "R2C3"]);
  grid.runUpdateCallback();
}

const loadSlowKnight = () => {
  // Slow ambiguous anti-knight:
  let config = '{"type":"Set","constraints":[{"type":"AntiKnight"},{"type":"FixedCells","values":["R1C2#3","R1C9#7","R3C6#9","R3C7#2","R4C1#6","R4C4#4","R5C9#5","R6C2#4","R7C1#3","R8C5#6","R8C8#5","R9C2#6","R9C3#4","R9C4#3"]}]}';
  constraintManager.loadFromText(config);
}

const testCases = [
  {  // 0: From https://www.youtube.com/watch?v=lgJYOuVk910
    name: 'Thermo 1',
    input:
      '{"type":"Set","constraints":[{"type":"FixedCells","values":["R1C2#4","R1C8#1","R2C1#2","R2C9#6","R8C1#9","R8C9#2","R9C2#1","R9C8#9"]},{"type":"Thermo","cells":["R9C4","R8C3","R7C2","R6C1","R5C2","R4C3"]},{"type":"Thermo","cells":["R4C1","R3C2","R2C3","R1C4","R2C5","R3C6"]},{"type":"Thermo","cells":["R1C6","R2C7","R3C8","R4C9","R5C8","R6C7"]},{"type":"Thermo", "cells":["R6C9","R7C8","R8C7","R9C6","R8C5","R7C4"]}]}',
    expected:
      ["R1C4#6","R3C1#6","R4C3#9","R5C2#8","R1C6#2","R2C7#3","R3C8#4","R4C9#5","R6C1#7","R1C1#8","R1C3#7","R1C9#9","R1C7#5","R1C5#3","R2C2#9","R3C7#2","R8C2#7","R2C5#7","R2C8#8","R3C9#7","R2C4#4","R2C6#1","R8C4#1","R6C5#1","R7C4#9","R7C8#5","R7C2#6","R4C2#2","R6C2#5","R8C5#8","R8C7#6","R8C8#3","R8C3#4","R7C1#3","R5C1#4","R8C6#5","R9C1#5","R9C6#7","R7C6#4","R7C5#2","R7C3#8","R7C9#1","R5C9#3","R5C3#6","R5C6#9","R3C6#8","R3C4#5","R3C5#9","R5C4#2","R5C5#5","R5C8#7","R4C8#6","R4C5#4","R4C6#3","R4C7#8","R4C4#7","R5C7#1","R6C3#3","R6C4#8","R6C6#6","R6C7#9","R6C8#2","R6C9#4","R7C7#7","R9C3#2","R9C4#3","R9C5#6","R9C7#4","R9C9#8","R1C2#4","R1C8#1","R2C1#2","R2C9#6","R2C3#5","R3C2#3","R4C1#1","R8C1#9","R8C9#2","R9C2#1","R3C3#1","R9C8#9"]
  },
  { // 1: From https://en.wikipedia.org/wiki/Sudoku
    name: 'Classic sudoku, no backtrack',
    input:
      '{"type":"Set","constraints":[{"type":"FixedCells","values":["R1C1#5","R1C2#3","R1C5#7","R2C1#6","R2C4#1","R2C5#9","R2C6#5","R3C2#9","R3C3#8","R3C8#6","R4C1#8","R4C5#6","R4C9#3","R5C1#4","R5C4#8","R5C6#3","R5C9#1","R6C1#7","R6C5#2","R6C9#6","R7C2#6","R7C7#2","R7C8#8","R8C4#4","R8C5#1","R8C6#9","R8C9#5","R9C5#8","R9C8#7","R9C9#9"]}]}',
    expected:
      ["R1C1#5","R1C2#3","R1C5#7","R2C1#6","R2C4#1","R2C5#9","R2C6#5","R3C2#9","R3C3#8","R3C8#6","R4C1#8","R4C5#6","R4C9#3","R5C1#4","R5C4#8","R1C6#8","R1C4#6","R5C6#3","R5C9#1","R6C1#7","R6C3#3","R6C5#2","R5C5#5","R6C9#6","R7C2#6","R5C2#2","R5C3#6","R4C3#9","R7C7#2","R4C8#2","R7C8#8","R6C7#8","R2C9#8","R2C3#2","R3C1#1","R1C3#4","R2C2#7","R1C9#2","R8C4#4","R4C4#7","R6C4#9","R7C9#4","R9C2#4","R9C5#8","R8C2#8","R3C5#4","R3C6#2","R3C4#3","R7C4#5","R9C4#2","R8C1#2","R8C5#1","R7C5#3","R7C1#9","R7C6#7","R7C3#1","R9C1#3","R8C6#9","R9C6#6","R8C7#6","R8C8#3","R2C8#4","R2C7#3","R6C8#5","R4C7#4","R4C6#1","R4C2#5","R6C2#1","R6C6#4","R9C9#9","R8C9#5","R3C9#7","R3C7#5","R8C3#7","R9C3#5","R9C8#7","R5C8#9","R1C8#1","R1C7#9","R5C7#7","R9C7#1"]
  },
  { // 2: From https://www.telegraph.co.uk/news/science/science-news/9359579/Worlds-hardest-sudoku-can-you-crack-it.html
    name: 'Classic sudoku, hard',
    input:
      '{"type":"Set","constraints":[{"type":"FixedCells","values":["R1C1#8","R2C3#3","R2C4#6","R3C2#7","R3C5#9","R3C7#2","R4C2#5","R4C6#7","R5C5#4","R5C6#5","R5C7#7","R6C4#1","R6C8#3","R7C3#1","R7C8#6","R7C9#8","R8C3#8","R8C4#5","R8C8#1","R9C2#9","R9C7#4"]}]}',
    expected: ["R8C7#9","R7C7#3","R7C1#5","R7C2#2","R7C5#7","R1C4#7","R2C2#4","R8C1#4","R8C9#7","R2C8#7","R1C2#1","R3C1#6","R3C3#5","R1C3#2","R2C1#9","R1C5#5","R1C7#6","R9C8#5","R9C9#2","R1C6#3","R3C9#3","R3C6#1","R9C5#1","R7C6#4","R7C4#9","R3C4#4","R3C8#8","R6C6#9","R1C8#4","R1C9#9","R2C5#8","R2C6#2","R8C6#6","R8C2#3","R8C5#2","R6C5#6","R4C5#3","R6C2#8","R5C2#6","R5C3#9","R4C3#4","R5C8#2","R4C8#9","R5C4#8","R4C4#2","R4C1#1","R4C7#8","R4C9#6","R5C1#3","R5C9#1","R2C9#5","R2C7#1","R6C3#7","R6C1#2","R6C7#5","R6C9#4","R9C1#7","R9C3#6","R9C4#3","R9C6#8","R1C1#8","R2C3#3","R2C4#6","R3C2#7","R3C5#9","R3C7#2","R4C2#5","R4C6#7","R5C5#4","R5C6#5","R5C7#7","R6C4#1","R6C8#3","R7C3#1","R7C8#6","R7C9#8","R8C3#8","R8C4#5","R8C8#1","R9C2#9","R9C7#4"]
  },
  { // 3: https://www.youtube.com/watch?v=mTdhTfAhOI8
    name: 'Anti knights move',
    input:
      '{"type":"Set","constraints":[{"type":"AntiKnight"},{"type":"FixedCells","values":["R1C2#3","R1C5#4","R1C6#1","R1C9#7","R2C4#5","R3C4#8","R3C6#9","R4C1#6","R4C8#7","R5C9#4","R6C2#4","R7C1#3","R8C5#6","R8C8#5","R9C2#6","R9C3#4","R9C4#3"]}]}',
    expected: ["R1C2#3","R1C5#4","R1C6#1","R1C9#7","R2C4#5","R3C4#8","R3C6#9","R4C1#6","R4C8#7","R5C9#4","R6C2#4","R7C1#3","R8C5#6","R8C8#5","R9C2#6","R9C3#4","R2C8#4","R3C1#4","R9C4#3","R1C4#2","R5C4#6","R2C6#6","R1C3#6","R1C7#8","R1C8#9","R1C1#5","R9C5#5","R2C5#3","R3C5#7","R3C3#1","R3C2#2","R3C8#3","R2C2#7","R2C1#9","R2C3#8","R2C7#2","R2C9#1","R3C7#6","R3C9#5","R5C7#5","R4C2#1","R4C4#4","R4C6#5","R6C3#5","R7C2#5","R4C7#9","R9C9#9","R4C3#3","R5C6#3","R6C1#2","R8C3#2","R4C5#8","R4C9#2","R6C6#7","R5C5#2","R5C8#1","R6C7#3","R7C8#2","R7C9#6","R6C9#8","R6C8#6","R8C6#4","R7C5#9","R6C5#1","R5C2#8","R5C1#7","R5C3#9","R6C4#9","R7C3#7","R7C4#1","R7C6#8","R7C7#4","R8C2#9","R8C4#7","R8C7#1","R8C1#8","R8C9#3","R9C1#1","R9C6#2","R9C7#7","R9C8#8"]
  },
  { // 4: https://en.wikipedia.org/wiki/Killer_sudoku
    name: 'Easy killer',
    input:
      '{"type":"Set","constraints":[{"type":"FixedCells","values":[]},{"type":"Sum","cells":["R1C1","R1C2"],"sum":3},{"type":"Sum","cells":["R1C3","R1C4","R1C5"],"sum":15},{"type":"Sum","cells":["R2C1","R2C2","R3C1","R3C2"],"sum":25},{"type":"Sum","cells":["R2C3","R2C4"],"sum":17},{"type":"Sum","cells":["R3C3","R3C4","R4C4"],"sum":9},{"type":"Sum","cells":["R1C6","R2C5","R2C6","R3C5"],"sum":22},{"type":"Sum","cells":["R1C7","R2C7"],"sum":4},{"type":"Sum","cells":["R1C8","R2C8"],"sum":16},{"type":"Sum","cells":["R1C9","R2C9","R3C9","R4C9"],"sum":15},{"type":"Sum","cells":["R3C7","R3C8","R4C7"],"sum":20},{"type":"Sum","cells":["R3C6","R4C6","R5C6"],"sum":8},{"type":"Sum","cells":["R4C5","R5C5","R6C5"],"sum":17},{"type":"Sum","cells":["R5C4","R6C4","R7C4"],"sum":20},{"type":"Sum","cells":["R4C2","R4C3"],"sum":14},{"type":"Sum","cells":["R4C1","R5C1"],"sum":6},{"type":"Sum","cells":["R5C2","R5C3","R6C2"],"sum":13},{"type":"Sum","cells":["R6C3","R7C2","R7C3"],"sum":6},{"type":"Sum","cells":["R4C8","R5C7","R5C8"],"sum":17},{"type":"Sum","cells":["R6C1","R7C1","R8C1","R9C1"],"sum":27},{"type":"Sum","cells":["R8C2","R9C2"],"sum":8},{"type":"Sum","cells":["R8C3","R9C3"],"sum":16},{"type":"Sum","cells":["R7C5","R8C4","R8C5","R9C4"],"sum":10},{"type":"Sum","cells":["R5C9","R6C9"],"sum":12},{"type":"Sum","cells":["R6C7","R6C8"],"sum":6},{"type":"Sum","cells":["R6C6","R7C6","R7C7"],"sum":20},{"type":"Sum","cells":["R8C6","R8C7"],"sum":15},{"type":"Sum","cells":["R7C8","R7C9","R8C8","R8C9"],"sum":14},{"type":"Sum","cells":["R9C5","R9C6","R9C7"],"sum":13},{"type":"Sum","cells":["R9C8","R9C9"],"sum":17}]}',
    expected: ["R9C8#8","R9C9#9","R8C7#7","R8C6#8","R7C1#8","R8C3#9","R9C3#7","R7C4#7","R7C6#9","R8C2#5","R9C2#3","R7C5#3","R8C9#3","R7C7#5","R6C6#6","R7C8#4","R7C9#6","R8C8#1","R9C7#2","R7C2#2","R7C3#1","R6C3#3","R8C1#6","R9C1#4","R6C1#9","R9C6#5","R9C5#6","R9C4#1","R8C4#4","R8C5#2","R6C7#4","R6C8#2","R6C4#8","R5C4#5","R6C9#5","R5C9#7","R5C1#1","R6C2#7","R6C5#1","R4C1#5","R5C5#9","R4C5#7","R4C4#2","R5C3#2","R5C2#4","R5C6#3","R4C6#4","R5C8#6","R5C7#8","R4C9#1","R4C8#3","R4C7#9","R3C6#1","R4C2#8","R4C3#6","R3C7#6","R3C2#9","R3C4#3","R3C8#5","R3C1#7","R3C9#2","R3C3#4","R3C5#8","R1C9#8","R1C3#5","R1C5#4","R2C3#8","R2C5#5","R2C9#4","R2C4#9","R1C4#6","R1C2#1","R1C7#3","R1C1#2","R1C6#7","R1C8#9","R2C1#3","R2C2#6","R2C6#2","R2C7#1","R2C8#7"]
  },
  { // 5: http://forum.enjoysudoku.com/the-hardest-sudokus-new-thread-t6539-645.html (2061 backtracks)
    name: 'Hard sudoku x',
    input:
      '{"type":"Set","constraints":[{"type":"Diagonal","direction":1},{"type":"Diagonal","direction":-1},{"type":"FixedCells","values":["R1C3#1","R1C7#2","R2C3#2","R2C4#3","R2C9#4","R3C1#4","R4C1#5","R4C3#3","R4C8#6","R5C2#1","R5C9#5","R6C3#6","R7C5#7","R7C6#8","R8C5#9","R9C2#7","R9C6#1","R9C8#9"]}]}',
    expected: ["R1C3#1","R1C7#2","R2C3#2","R2C4#3","R2C9#4","R3C1#4","R4C1#5","R4C3#3","R4C8#6","R5C2#1","R5C9#5","R6C3#6","R7C5#7","R7C6#8","R8C5#9","R9C2#7","R9C6#1","R9C8#9","R8C1#1","R5C3#7","R2C1#7","R7C3#9","R3C3#5","R8C3#8","R9C3#4","R6C5#5","R9C4#5","R1C6#5","R2C6#6","R1C5#4","R2C2#9","R1C4#9","R3C9#9","R4C7#9","R6C1#9","R5C6#9","R2C5#1","R2C7#5","R2C8#8","R8C2#5","R7C8#5","R1C8#3","R1C9#7","R3C8#1","R3C7#6","R3C2#3","R4C4#7","R3C6#7","R4C9#1","R5C4#6","R6C4#1","R7C7#1","R7C4#4","R8C4#2","R3C4#8","R3C5#2","R4C5#8","R5C5#3","R8C6#3","R8C8#4","R5C8#2","R5C1#8","R1C1#6","R1C2#8","R5C7#4","R6C6#2","R4C6#4","R4C2#2","R6C2#4","R6C8#7","R7C2#6","R8C7#7","R8C9#6","R9C1#2","R7C1#3","R7C9#2","R9C5#6","R9C9#8","R6C9#3","R6C7#8","R9C7#3"],
  },
];

const arrayEquals = (a, b) => {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

const runTestCases = () => {
  for (const tc of testCases) {
    let constraint = SudokuConstraintConfig.fromJSON(tc.input);
    let solver = new SudokuSolver();
    solver.addConstraint(constraint);
    let result = solver.solveAllPossibilities();

    result.values.sort();
    tc.expected.sort();
    if (!arrayEquals(result.values, tc.expected)) {
      console.log('Expected', tc.expected);
      console.log('Got', result.values);
      throw('Test failed: ' + tc.name);
    }
  }
  console.log('Tests passed');
};

let listener;
const stepThroughSolver = (numSteps) => {
  document.removeEventListener('keydown', listener);
  let steps = [];
  debugCallback = (solver, node, stack, column) => {
    steps.push({
      stack: stack.map(e => e.row.id),
      columnId: column ? column.id : null,
      count: column ? column.count : null,
      options: solver.remainingRows(),
    });
    if (steps.length > numSteps) throw('Reached step limit');
  }
  let solver = new SudokuSolver();
  let cs = getCurrentConstraints();
  solver.addConstraint(cs);

  try {
    solver.solve();
  } catch (e) {
    console.log('Cause exception: ' + e);
  }

  let i = 0;
  const renderStep = () => {
    let s = steps[i];
    console.log(`Step: ${i} - depth: ${s.stack.length} - ${s.columnId} #options: ${s.count}`);
    grid.setSolution(s.stack.concat(s.options));
    grid.selection.updateSelection([
      document.getElementById(s.stack[s.stack.length-1].substring(0, 4))
    ]);
  };

  listener = document.addEventListener('keydown', event => {
    switch (event.key) {
      // Arrow keys.
      case 'ArrowLeft':
        if (i > 0) i--;
        break;
      case 'ArrowRight':
        if (i < numSteps) i++;
        break;
      case 'ArrowUp':
        i = 0;
        break;
      case 'ArrowDown':
        i = numSteps - 1;
        break;
      case 'Esc':
        document.removeEventListener('keydown', listener);
        return;
    }
    renderStep();
  });

  console.log('Use arrow keys to navigate');
  renderStep();
};
