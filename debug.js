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
    let result = (new SudokuBuilder()).build().solve(values);
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
    let result = (new SudokuBuilder()).build().solveAllPossibilities(values);
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
  let config = '{"type":"Set","constraints":[{"type":"AntiKnight"},{"type":"Givens","values":["R1C2_3","R1C9_7","R3C6_9","R3C7_2","R4C1_6","R4C4_4","R5C9_5","R6C2_4","R7C1_3","R8C5_6","R8C8_5","R9C2_6","R9C3_4","R9C4_3"]}]}';
  constraintManager.loadFromText(config);
}

const testCases = [
  {  // 0: From https://www.youtube.com/watch?v=lgJYOuVk910
    name: 'Thermo 1',
    input:
      '.Givens~R1C2_4~R1C8_1~R2C1_2~R2C9_6~R8C1_9~R8C9_2~R9C2_1~R9C8_9.Thermo~R9C4~R8C3~R7C2~R6C1~R5C2~R4C3.Thermo~R4C1~R3C2~R2C3~R1C4~R2C5~R3C6.Thermo~R1C6~R2C7~R3C8~R4C9~R5C8~R6C7.Thermo~R6C9~R7C8~R8C7~R9C6~R8C5~R7C4',
    expected:
      ["R1C4_6","R3C1_6","R4C3_9","R5C2_8","R1C6_2","R2C7_3","R3C8_4","R4C9_5","R6C1_7","R1C1_8","R1C3_7","R1C9_9","R1C7_5","R1C5_3","R2C2_9","R3C7_2","R8C2_7","R2C5_7","R2C8_8","R3C9_7","R2C4_4","R2C6_1","R8C4_1","R6C5_1","R7C4_9","R7C8_5","R7C2_6","R4C2_2","R6C2_5","R8C5_8","R8C7_6","R8C8_3","R8C3_4","R7C1_3","R5C1_4","R8C6_5","R9C1_5","R9C6_7","R7C6_4","R7C5_2","R7C3_8","R7C9_1","R5C9_3","R5C3_6","R5C6_9","R3C6_8","R3C4_5","R3C5_9","R5C4_2","R5C5_5","R5C8_7","R4C8_6","R4C5_4","R4C6_3","R4C7_8","R4C4_7","R5C7_1","R6C3_3","R6C4_8","R6C6_6","R6C7_9","R6C8_2","R6C9_4","R7C7_7","R9C3_2","R9C4_3","R9C5_6","R9C7_4","R9C9_8","R1C2_4","R1C8_1","R2C1_2","R2C9_6","R2C3_5","R3C2_3","R4C1_1","R8C1_9","R8C9_2","R9C2_1","R3C3_1","R9C8_9"]
  },
  { // 1: From https://en.wikipedia.org/wiki/Sudoku
    name: 'Classic sudoku, no backtrack',
    input:
      '.Givens~R1C1_5~R1C2_3~R1C5_7~R2C1_6~R2C4_1~R2C5_9~R2C6_5~R3C2_9~R3C3_8~R3C8_6~R4C1_8~R4C5_6~R4C9_3~R5C1_4~R5C4_8~R5C6_3~R5C9_1~R6C1_7~R6C5_2~R6C9_6~R7C2_6~R7C7_2~R7C8_8~R8C4_4~R8C5_1~R8C6_9~R8C9_5~R9C5_8~R9C8_7~R9C9_9',
    expected:
      ["R1C1_5","R1C2_3","R1C5_7","R2C1_6","R2C4_1","R2C5_9","R2C6_5","R3C2_9","R3C3_8","R3C8_6","R4C1_8","R4C5_6","R4C9_3","R5C1_4","R5C4_8","R1C6_8","R1C4_6","R5C6_3","R5C9_1","R6C1_7","R6C3_3","R6C5_2","R5C5_5","R6C9_6","R7C2_6","R5C2_2","R5C3_6","R4C3_9","R7C7_2","R4C8_2","R7C8_8","R6C7_8","R2C9_8","R2C3_2","R3C1_1","R1C3_4","R2C2_7","R1C9_2","R8C4_4","R4C4_7","R6C4_9","R7C9_4","R9C2_4","R9C5_8","R8C2_8","R3C5_4","R3C6_2","R3C4_3","R7C4_5","R9C4_2","R8C1_2","R8C5_1","R7C5_3","R7C1_9","R7C6_7","R7C3_1","R9C1_3","R8C6_9","R9C6_6","R8C7_6","R8C8_3","R2C8_4","R2C7_3","R6C8_5","R4C7_4","R4C6_1","R4C2_5","R6C2_1","R6C6_4","R9C9_9","R8C9_5","R3C9_7","R3C7_5","R8C3_7","R9C3_5","R9C8_7","R5C8_9","R1C8_1","R1C7_9","R5C7_7","R9C7_1"]
  },
  { // 2: From https://www.telegraph.co.uk/news/science/science-news/9359579/Worlds-hardest-sudoku-can-you-crack-it.html
    name: 'Classic sudoku, hard',
    input:
      '.Givens~R1C1_8~R2C3_3~R2C4_6~R3C2_7~R3C5_9~R3C7_2~R4C2_5~R4C6_7~R5C5_4~R5C6_5~R5C7_7~R6C4_1~R6C8_3~R7C3_1~R7C8_6~R7C9_8~R8C3_8~R8C4_5~R8C8_1~R9C2_9~R9C7_4',
    expected: ["R8C7_9","R7C7_3","R7C1_5","R7C2_2","R7C5_7","R1C4_7","R2C2_4","R8C1_4","R8C9_7","R2C8_7","R1C2_1","R3C1_6","R3C3_5","R1C3_2","R2C1_9","R1C5_5","R1C7_6","R9C8_5","R9C9_2","R1C6_3","R3C9_3","R3C6_1","R9C5_1","R7C6_4","R7C4_9","R3C4_4","R3C8_8","R6C6_9","R1C8_4","R1C9_9","R2C5_8","R2C6_2","R8C6_6","R8C2_3","R8C5_2","R6C5_6","R4C5_3","R6C2_8","R5C2_6","R5C3_9","R4C3_4","R5C8_2","R4C8_9","R5C4_8","R4C4_2","R4C1_1","R4C7_8","R4C9_6","R5C1_3","R5C9_1","R2C9_5","R2C7_1","R6C3_7","R6C1_2","R6C7_5","R6C9_4","R9C1_7","R9C3_6","R9C4_3","R9C6_8","R1C1_8","R2C3_3","R2C4_6","R3C2_7","R3C5_9","R3C7_2","R4C2_5","R4C6_7","R5C5_4","R5C6_5","R5C7_7","R6C4_1","R6C8_3","R7C3_1","R7C8_6","R7C9_8","R8C3_8","R8C4_5","R8C8_1","R9C2_9","R9C7_4"]
  },
  { // 3: https://www.youtube.com/watch?v=mTdhTfAhOI8
    name: 'Anti knights move',
    input:
      '.AntiKnight.Givens~R1C2_3~R1C5_4~R1C6_1~R1C9_7~R2C4_5~R3C4_8~R3C6_9~R4C1_6~R4C8_7~R5C9_4~R6C2_4~R7C1_3~R8C5_6~R8C8_5~R9C2_6~R9C3_4~R9C4_3',
    expected: ["R1C2_3","R1C5_4","R1C6_1","R1C9_7","R2C4_5","R3C4_8","R3C6_9","R4C1_6","R4C8_7","R5C9_4","R6C2_4","R7C1_3","R8C5_6","R8C8_5","R9C2_6","R9C3_4","R2C8_4","R3C1_4","R9C4_3","R1C4_2","R5C4_6","R2C6_6","R1C3_6","R1C7_8","R1C8_9","R1C1_5","R9C5_5","R2C5_3","R3C5_7","R3C3_1","R3C2_2","R3C8_3","R2C2_7","R2C1_9","R2C3_8","R2C7_2","R2C9_1","R3C7_6","R3C9_5","R5C7_5","R4C2_1","R4C4_4","R4C6_5","R6C3_5","R7C2_5","R4C7_9","R9C9_9","R4C3_3","R5C6_3","R6C1_2","R8C3_2","R4C5_8","R4C9_2","R6C6_7","R5C5_2","R5C8_1","R6C7_3","R7C8_2","R7C9_6","R6C9_8","R6C8_6","R8C6_4","R7C5_9","R6C5_1","R5C2_8","R5C1_7","R5C3_9","R6C4_9","R7C3_7","R7C4_1","R7C6_8","R7C7_4","R8C2_9","R8C4_7","R8C7_1","R8C1_8","R8C9_3","R9C1_1","R9C6_2","R9C7_7","R9C8_8"]
  },
  { // 4: https://en.wikipedia.org/wiki/Killer_sudoku
    name: 'Easy killer',
    input:
      '.Sum~3~R1C1~R1C2.Sum~15~R1C3~R1C4~R1C5.Sum~25~R2C1~R2C2~R3C1~R3C2.Sum~17~R2C3~R2C4.Sum~9~R3C3~R3C4~R4C4.Sum~22~R1C6~R2C5~R2C6~R3C5.Sum~4~R1C7~R2C7.Sum~16~R1C8~R2C8.Sum~15~R1C9~R2C9~R3C9~R4C9.Sum~20~R3C7~R3C8~R4C7.Sum~8~R3C6~R4C6~R5C6.Sum~17~R4C5~R5C5~R6C5.Sum~20~R5C4~R6C4~R7C4.Sum~14~R4C2~R4C3.Sum~6~R4C1~R5C1.Sum~13~R5C2~R5C3~R6C2.Sum~6~R6C3~R7C2~R7C3.Sum~17~R4C8~R5C7~R5C8.Sum~27~R6C1~R7C1~R8C1~R9C1.Sum~8~R8C2~R9C2.Sum~16~R8C3~R9C3.Sum~10~R7C5~R8C4~R8C5~R9C4.Sum~12~R5C9~R6C9.Sum~6~R6C7~R6C8.Sum~20~R6C6~R7C6~R7C7.Sum~15~R8C6~R8C7.Sum~14~R7C8~R7C9~R8C8~R8C9.Sum~13~R9C5~R9C6~R9C7.Sum~17~R9C8~R9C9',
    expected: ["R9C8_8","R9C9_9","R8C7_7","R8C6_8","R7C1_8","R8C3_9","R9C3_7","R7C4_7","R7C6_9","R8C2_5","R9C2_3","R7C5_3","R8C9_3","R7C7_5","R6C6_6","R7C8_4","R7C9_6","R8C8_1","R9C7_2","R7C2_2","R7C3_1","R6C3_3","R8C1_6","R9C1_4","R6C1_9","R9C6_5","R9C5_6","R9C4_1","R8C4_4","R8C5_2","R6C7_4","R6C8_2","R6C4_8","R5C4_5","R6C9_5","R5C9_7","R5C1_1","R6C2_7","R6C5_1","R4C1_5","R5C5_9","R4C5_7","R4C4_2","R5C3_2","R5C2_4","R5C6_3","R4C6_4","R5C8_6","R5C7_8","R4C9_1","R4C8_3","R4C7_9","R3C6_1","R4C2_8","R4C3_6","R3C7_6","R3C2_9","R3C4_3","R3C8_5","R3C1_7","R3C9_2","R3C3_4","R3C5_8","R1C9_8","R1C3_5","R1C5_4","R2C3_8","R2C5_5","R2C9_4","R2C4_9","R1C4_6","R1C2_1","R1C7_3","R1C1_2","R1C6_7","R1C8_9","R2C1_3","R2C2_6","R2C6_2","R2C7_1","R2C8_7"]
  },
  { // 5: http://forum.enjoysudoku.com/the-hardest-sudokus-new-thread-t6539-645.html (2061 backtracks)
    name: 'Hard sudoku x',
    input:
      '.Diagonal~1.Diagonal~-1.Givens~R1C3_1~R1C7_2~R2C3_2~R2C4_3~R2C9_4~R3C1_4~R4C1_5~R4C3_3~R4C8_6~R5C2_1~R5C9_5~R6C3_6~R7C5_7~R7C6_8~R8C5_9~R9C2_7~R9C6_1~R9C8_9',
    expected: ["R1C3_1","R1C7_2","R2C3_2","R2C4_3","R2C9_4","R3C1_4","R4C1_5","R4C3_3","R4C8_6","R5C2_1","R5C9_5","R6C3_6","R7C5_7","R7C6_8","R8C5_9","R9C2_7","R9C6_1","R9C8_9","R8C1_1","R5C3_7","R2C1_7","R7C3_9","R3C3_5","R8C3_8","R9C3_4","R6C5_5","R9C4_5","R1C6_5","R2C6_6","R1C5_4","R2C2_9","R1C4_9","R3C9_9","R4C7_9","R6C1_9","R5C6_9","R2C5_1","R2C7_5","R2C8_8","R8C2_5","R7C8_5","R1C8_3","R1C9_7","R3C8_1","R3C7_6","R3C2_3","R4C4_7","R3C6_7","R4C9_1","R5C4_6","R6C4_1","R7C7_1","R7C4_4","R8C4_2","R3C4_8","R3C5_2","R4C5_8","R5C5_3","R8C6_3","R8C8_4","R5C8_2","R5C1_8","R1C1_6","R1C2_8","R5C7_4","R6C6_2","R4C6_4","R4C2_2","R6C2_4","R6C8_7","R7C2_6","R8C7_7","R8C9_6","R9C1_2","R7C1_3","R7C9_2","R9C5_6","R9C9_8","R6C9_3","R6C7_8","R9C7_3"],
  },
  {  // 6: https://www.reddit.com/r/sudoku/comments/gk8si6/antiking_antiknight_sudoku_to_compliment_the/
    name: 'Anti-knight Anti-king',
    input:
      '.AntiKnight.AntiKing.Givens~R1C1_1~R1C7_5~R1C8_6~R1C9_7~R2C1_2~R2C2_3~R2C3_4~R2C9_8',
    expected: ["R1C1_1", "R1C7_5", "R1C8_6", "R1C9_7", "R2C1_2", "R2C2_3", "R2C3_4", "R1C6_4", "R1C5_3", "R1C4_2", "R2C4_5", "R2C5_6", "R2C6_7", "R3C1_5", "R3C2_6", "R3C3_7", "R4C8_7", "R2C9_8", "R1C2_9", "R1C3_8", "R2C7_1", "R2C8_9", "R3C6_8", "R3C5_9", "R3C4_1", "R4C2_8", "R4C3_2", "R4C4_3", "R4C5_4", "R4C1_9", "R4C6_5", "R4C7_6", "R4C9_1", "R5C3_5", "R5C4_6", "R5C5_7", "R6C3_1", "R5C2_4", "R5C1_3", "R6C2_7", "R6C1_6", "R7C1_8", "R7C2_2", "R7C5_5", "R8C1_4", "R8C2_5", "R9C1_7", "R9C2_1", "R5C6_1", "R5C8_8", "R7C8_1", "R7C7_7", "R8C5_1", "R8C4_7", "R8C7_8", "R9C5_2", "R6C5_8", "R6C4_9", "R6C6_2", "R5C7_9", "R5C9_2", "R7C3_3", "R7C4_4", "R7C6_6", "R7C9_9", "R8C3_6", "R8C9_3", "R3C9_4", "R3C8_3", "R3C7_2", "R6C9_5", "R6C8_4", "R6C7_3", "R8C6_9", "R8C8_2", "R9C3_9", "R9C4_8", "R9C6_3", "R9C7_4", "R9C8_5", "R9C9_6"],
  }
];

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const loadInput = (input) => {
  constraintManager.loadFromText(input);
}

const arrayEquals = (a, b) => {
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

const runTestCases = () => {
  for (const tc of testCases) {
    let constraint = SudokuConstraint.fromString(tc.input);
    let builder = new SudokuBuilder();
    builder.addConstraint(constraint);
    let result = builder.build().solveAllPossibilities();

    result.sort();
    tc.expected.sort();
    if (!arrayEquals(result, tc.expected)) {
      console.log('Expected', tc.expected);
      console.log('Got', result);
      throw('Test failed: ' + tc.name);
    }
  }
  console.log('Tests passed');
};
