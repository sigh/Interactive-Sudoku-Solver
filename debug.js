const addBinaryConstraint = (solver, id, cell1, cell2, fn) => {
  let value = new Map();
  let set1 = [];
  let set2 = [];
  for (let i = 1; i < 10; i++) {
    set1.push(`${cell1}#${i}`);
    set2.push(`${cell2}#${i}`);
    value.set(`${cell1}#${i}`, i);
    value.set(`${cell2}#${i}`, i);
  }
  let constraintFn = (a, b) => fn(value.get(a), value.get(b));
  solver.addBinaryConstraint(id, set1, set2, constraintFn);
}

const testBinaryConstraints = () => {
  let solver = SudokuSolver._makeBaseSudokuConstraints();
  addBinaryConstraint(solver, 'test', 'R1C1', 'R1C2', (a, b) => a > b);
  addBinaryConstraint(solver, 'test', 'R1C2', 'R1C3', (a, b) => a > b);
  solver._enforceArcConsistency(null, solver._allBinaryConstraintColumns());

  grid.setSolution(solver.remainingRows());
  return solver;
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

const testBadThermo = () => {
  // The thermo in https://www.youtube.com/watch?v=ySPrdlfPHZs with mods.
  // This showed a bug in the search (now fixed).
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

// Slow thermo ~1.14 seconds.
const testSlowThermo = () => {
  grid.setCellValues(["R4C6#1", "R5C3#2", "R9C5#1"]);
  constraintManager.addConstraint(["R7C5", "R7C6", "R7C7", "R6C7", "R5C7", "R4C7"]);
  constraintManager.addConstraint(["R4C8", "R3C8", "R3C7", "R3C6", "R3C5"]);
  constraintManager.addConstraint(["R2C5", "R2C4", "R3C4", "R4C4", "R5C4"]);
  constraintManager.addConstraint(["R2C1", "R2C2", "R2C3"]);
  grid.runUpdateCallback();
}
