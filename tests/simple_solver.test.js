import assert from 'node:assert/strict';

import { runTest, logSuiteComplete } from './helpers/test_runner.js';

const { SimpleSolver, Solution, SolverStats } = await import('../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { DISPLAYED_EXAMPLES } = await import('../data/example_puzzles.js' + self.VERSION_PARAM);

// Get puzzles by name from the examples
const getPuzzle = (name) => DISPLAYED_EXAMPLES.find(p => p.name === name);

const CLASSIC_SUDOKU = getPuzzle('Classic sudoku');
const THERMOSUDOKU = getPuzzle('Thermosudoku');
const KILLER_SUDOKU = getPuzzle('Killer sudoku');
const JIGSAW = getPuzzle('Jigsaw');

// A 4x4 puzzle with multiple solutions (small enough to count quickly)
const MULTI_SOLUTIONS = '.Shape~4x4.~R1C1_1';

// ============================================================================
// Solution class tests
// ============================================================================

await runTest('Solution.valueAt with cell ID', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution, 'Should find a solution');
  assert.equal(solution.valueAt('R1C1'), 5);
  assert.equal(solution.valueAt('R1C3'), 4);
  assert.equal(solution.valueAt('R9C9'), 9);
});

await runTest('Solution.valueAt with row/col', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution, 'Should find a solution');
  // Row/col are 1-indexed
  assert.equal(solution.valueAt(1, 1), 5);
  assert.equal(solution.valueAt(1, 3), 4);
  assert.equal(solution.valueAt(9, 9), 9);
});

await runTest('Solution.toString returns short solution string', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution, 'Should find a solution');
  assert.equal(solution.toString(), CLASSIC_SUDOKU.solution);
});

await runTest('Solution.equals with string', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution, 'Should find a solution');
  assert.ok(solution.equals(CLASSIC_SUDOKU.solution));
  assert.ok(!solution.equals(CLASSIC_SUDOKU.solution.slice(0, -1) + '1'));
});

await runTest('Solution.equals with Solution', async () => {
  const solver = new SimpleSolver();
  const solution1 = await solver.solution(CLASSIC_SUDOKU.input);
  const solution2 = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution1.equals(solution2));
});

await runTest('Solution iterator yields all cells', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution, 'Should find a solution');

  const cells = [];
  for (const { cell, value } of solution) {
    cells.push({ cell, value });
  }
  assert.equal(cells.length, 81, 'Should have 81 cells for 9x9');
  assert.equal(cells[0].cell, 'R1C1');
  assert.equal(cells[0].value, 5);
  assert.equal(cells[80].cell, 'R9C9');
  assert.equal(cells[80].value, 9);
});

await runTest('Solution.getArray returns typed array', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution, 'Should find a solution');
  const arr = solution.getArray();
  assert.ok(ArrayBuffer.isView(arr), 'Should be a typed array');
  assert.equal(arr.length, 81);
  assert.equal(arr[0], 5);
});

// ============================================================================
// SimpleSolver.solution tests
// ============================================================================

await runTest('solution() returns Solution for valid puzzle', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(solution instanceof Solution);
  assert.equal(solution.toString(), CLASSIC_SUDOKU.solution);
});

await runTest('solution() works for thermo sudoku', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(THERMOSUDOKU.input);
  assert.ok(solution);
  assert.equal(solution.toString(), THERMOSUDOKU.solution);
});

await runTest('solution() works for killer sudoku', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(KILLER_SUDOKU.input);
  assert.ok(solution);
  assert.equal(solution.toString(), KILLER_SUDOKU.solution);
});

await runTest('solution() works for jigsaw sudoku', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution(JIGSAW.input);
  assert.ok(solution);
  assert.equal(solution.toString(), JIGSAW.solution);
});

await runTest('solution() accepts constraint array', async () => {
  const { SudokuConstraint } = await import('../js/sudoku_constraint.js' + self.VERSION_PARAM);
  const solver = new SimpleSolver();
  const constraints = [
    new SudokuConstraint.Given('R1C1', 5),
    new SudokuConstraint.Given('R1C2', 3),
  ];
  const solution = await solver.solution(constraints);
  assert.ok(solution, 'Should find a solution');
  assert.equal(solution.valueAt('R1C1'), 5);
  assert.equal(solution.valueAt('R1C2'), 3);
});

// ============================================================================
// SimpleSolver.uniqueSolution tests
// ============================================================================

await runTest('uniqueSolution() returns solution when exactly one exists', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.uniqueSolution(CLASSIC_SUDOKU.input);
  assert.ok(solution instanceof Solution);
  assert.equal(solution.toString(), CLASSIC_SUDOKU.solution);
});

await runTest('uniqueSolution() returns null when multiple solutions exist', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.uniqueSolution(MULTI_SOLUTIONS);
  assert.equal(solution, null);
});

// ============================================================================
// SimpleSolver.solutions iterator tests
// ============================================================================

await runTest('solutions() yields all solutions for unique puzzle', async () => {
  const solver = new SimpleSolver();
  const solutions = [];
  for await (const s of solver.solutions(CLASSIC_SUDOKU.input)) {
    solutions.push(s);
  }
  assert.equal(solutions.length, 1);
  assert.equal(solutions[0].toString(), CLASSIC_SUDOKU.solution);
});

await runTest('solutions() yields all solutions for multi-solution puzzle', async () => {
  const solver = new SimpleSolver();
  const solutions = [];
  for await (const s of solver.solutions(MULTI_SOLUTIONS)) {
    solutions.push(s);
  }
  // Should find multiple distinct solutions
  assert.ok(solutions.length > 1, `Expected multiple solutions, got ${solutions.length}`);
  const uniqueStrs = new Set(solutions.map(s => s.toString()));
  assert.equal(uniqueStrs.size, solutions.length, 'All solutions should be unique');
});

await runTest('solutions() respects limit parameter', async () => {
  const solver = new SimpleSolver();
  const solutions = [];
  for await (const s of solver.solutions(MULTI_SOLUTIONS, 3)) {
    solutions.push(s);
  }
  assert.equal(solutions.length, 3);
  // All solutions should be different
  const uniqueStrs = new Set(solutions.map(s => s.toString()));
  assert.equal(uniqueStrs.size, 3);
});

await runTest('solutions() can break early', async () => {
  const solver = new SimpleSolver();
  let count = 0;
  for await (const s of solver.solutions(MULTI_SOLUTIONS)) {
    count++;
    if (count >= 2) break;
  }
  assert.equal(count, 2);
});

// ============================================================================
// SimpleSolver.solutionArray tests
// ============================================================================

await runTest('solutionArray() returns array of solutions', async () => {
  const solver = new SimpleSolver();
  const solutions = await solver.solutionArray(CLASSIC_SUDOKU.input);
  assert.ok(Array.isArray(solutions));
  assert.equal(solutions.length, 1);
  assert.ok(solutions[0] instanceof Solution);
});

await runTest('solutionArray() returns all solutions', async () => {
  const solver = new SimpleSolver();
  const solutions = await solver.solutionArray(MULTI_SOLUTIONS);
  assert.ok(solutions.length > 1, 'Should find multiple solutions');
  // Verify count matches countSolutions
  const count = await solver.countSolutions(MULTI_SOLUTIONS);
  assert.equal(solutions.length, count, 'solutionArray and countSolutions should agree');
});

await runTest('solutionArray() respects limit', async () => {
  const solver = new SimpleSolver();
  const solutions = await solver.solutionArray(MULTI_SOLUTIONS, 5);
  assert.equal(solutions.length, 5);
});

// ============================================================================
// SimpleSolver.countSolutions tests
// ============================================================================

await runTest('countSolutions() returns correct count', async () => {
  const solver = new SimpleSolver();
  const count = await solver.countSolutions(CLASSIC_SUDOKU.input);
  assert.equal(count, 1);
});

await runTest('countSolutions() counts multiple solutions', async () => {
  const solver = new SimpleSolver();
  // 4x4 with one given - has multiple solutions but countable quickly
  const count = await solver.countSolutions(MULTI_SOLUTIONS);
  assert.ok(count > 1, `Expected multiple solutions, got ${count}`);
});

// ============================================================================
// SimpleSolver.validateLayout tests
// ============================================================================

await runTest('validateLayout() returns solution for valid layout', async () => {
  const solver = new SimpleSolver();
  // Standard 9x9 layout with no extra constraints
  const solution = await solver.validateLayout('');
  assert.ok(solution instanceof Solution);
});

await runTest('validateLayout() returns solution for valid jigsaw', async () => {
  const solver = new SimpleSolver();
  // Valid jigsaw from the test puzzle
  const layout = '.NoBoxes.Jigsaw~000000021453303021453333221453322221455566121445666111445566667488887777888887777';
  const solution = await solver.validateLayout(layout);
  assert.ok(solution instanceof Solution);
});

// ============================================================================
// SimpleSolver.latestStats tests
// ============================================================================

await runTest('latestStats() returns SolverStats', async () => {
  const solver = new SimpleSolver();
  await solver.solution(CLASSIC_SUDOKU.input);
  const stats = solver.latestStats();
  assert.ok(stats instanceof SolverStats);
});

await runTest('latestStats() contains timing info', async () => {
  const solver = new SimpleSolver();
  await solver.solution(CLASSIC_SUDOKU.input);
  const stats = solver.latestStats();
  assert.equal(typeof stats.setupTimeMs, 'number');
  assert.equal(typeof stats.runtimeMs, 'number');
});

await runTest('latestStats() contains counters', async () => {
  const solver = new SimpleSolver();
  await solver.solution(CLASSIC_SUDOKU.input);
  const stats = solver.latestStats();
  assert.equal(typeof stats.solutions, 'number');
  assert.equal(typeof stats.guesses, 'number');
  assert.equal(typeof stats.backtracks, 'number');
  assert.equal(typeof stats.nodesSearched, 'number');
  assert.equal(typeof stats.constraintsProcessed, 'number');
});

await runTest('latestStats() updates after each solve', async () => {
  const solver = new SimpleSolver();

  await solver.solution(CLASSIC_SUDOKU.input);
  const stats1 = solver.latestStats();
  assert.equal(stats1.solutions, 1);

  await solver.solution(THERMOSUDOKU.input);
  const stats2 = solver.latestStats();
  assert.equal(stats2.solutions, 1);
  // Stats should be from the new solve, not accumulated
  assert.ok(stats2.constraintsProcessed > 0);
});

// ============================================================================
// SimpleSolver reuse tests
// ============================================================================

await runTest('solver can be reused for multiple puzzles', async () => {
  const solver = new SimpleSolver();

  const sol1 = await solver.solution(CLASSIC_SUDOKU.input);
  assert.ok(sol1);
  assert.equal(sol1.toString(), CLASSIC_SUDOKU.solution);

  const sol2 = await solver.solution(THERMOSUDOKU.input);
  assert.ok(sol2);
  assert.equal(sol2.toString(), THERMOSUDOKU.solution);
});

// ============================================================================
// Edge cases
// ============================================================================

await runTest('empty constraint string uses default 9x9', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution('');
  assert.ok(solution);
  assert.equal(solution.toString().length, 81);
});

await runTest('handles constraint with shape', async () => {
  const solver = new SimpleSolver();
  const solution = await solver.solution('.Shape~6x6');
  assert.ok(solution);
  assert.equal(solution.toString().length, 36);
});

logSuiteComplete('SimpleSolver');
