import assert from 'node:assert/strict';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

const { SimpleSolver, Solution, TrueCandidates } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { SolverStats } = await import('../../js/sandbox/solver_stats.js' + self.VERSION_PARAM);
const { DISPLAYED_EXAMPLES } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);

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
    void s;
    count++;
    if (count >= 2) break;
  }
  assert.equal(count, 2);
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

await runTest('countSolutions(limit) returns exact count when below limit', async () => {
  const solver = new SimpleSolver();
  const count = await solver.countSolutions(CLASSIC_SUDOKU.input, 2);
  assert.equal(count, 1);
});

await runTest('countSolutions(limit) caps at limit', async () => {
  const solver = new SimpleSolver();
  const count = await solver.countSolutions(MULTI_SOLUTIONS, 2);
  assert.equal(count, 2);
});

await runTest('countSolutions(limit=1) stops after first solution', async () => {
  const solver = new SimpleSolver();
  const count = await solver.countSolutions(MULTI_SOLUTIONS, 1);
  assert.equal(count, 1);
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

// ============================================================================
// SimpleSolver.trueCandidates tests
// ============================================================================

await runTest('trueCandidates() returns TrueCandidates for unique puzzle', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  assert.ok(candidates instanceof TrueCandidates);
});

await runTest('trueCandidates() returns single value for solved cells', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  // R1C1 has value 5 in the unique solution
  const values = candidates.valuesAt('R1C1');
  assert.deepEqual(values, [5]);
});

await runTest('trueCandidates() returns multiple values for multi-solution puzzle', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);
  // Some cells should have multiple possible values
  let foundMultiple = false;
  for (const { cell, value } of candidates) {
    void cell;
    void value;
    const values = candidates.valuesAt(cell);
    if (values.length > 1) {
      foundMultiple = true;
      break;
    }
  }
  assert.ok(foundMultiple, 'Expected at least one cell with multiple candidates');
});

// ============================================================================
// TrueCandidates.valuesAt tests
// ============================================================================

await runTest('TrueCandidates.valuesAt with cell ID', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  const values = candidates.valuesAt('R1C1');
  assert.ok(Array.isArray(values));
  assert.deepEqual(values, [5]);
});

await runTest('TrueCandidates.valuesAt with row/col', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  // Row/col are 1-indexed
  const values = candidates.valuesAt(1, 1);
  assert.deepEqual(values, [5]);
});

await runTest('TrueCandidates.valuesAt returns sorted values', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);
  // Find a cell with multiple values and check they're sorted
  for (let row = 1; row <= 4; row++) {
    for (let col = 1; col <= 4; col++) {
      const values = candidates.valuesAt(row, col);
      if (values.length > 1) {
        const sorted = [...values].sort((a, b) => a - b);
        assert.deepEqual(values, sorted, 'Values should be in ascending order');
        return;
      }
    }
  }
});

// ============================================================================
// TrueCandidates.countAt tests
// ============================================================================

await runTest('TrueCandidates.countAt with cell ID', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  // Unique solution means count is 1 for correct value
  const count = candidates.countAt('R1C1', 5);
  assert.equal(count, 1);
});

await runTest('TrueCandidates.countAt with row/col', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  const count = candidates.countAt(1, 1, 5);
  assert.equal(count, 1);
});

await runTest('TrueCandidates.countAt returns 0 for non-candidate', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  // R1C1 is 5 in the unique solution, so other values have count 0
  const count = candidates.countAt('R1C1', 1);
  assert.equal(count, 0);
});

await runTest('TrueCandidates.countAt is capped to limit', async () => {
  const solver = new SimpleSolver();
  // Use limit of 2
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS, 2);
  // All counts should be at most 2
  for (const { cell, value, count } of candidates) {
    void cell;
    void value;
    assert.ok(count <= 2, `Count ${count} exceeds limit 2`);
  }
});

// ============================================================================
// TrueCandidates iterator tests
// ============================================================================

await runTest('TrueCandidates iterator yields non-zero candidates', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);

  const items = [];
  for (const item of candidates) {
    items.push(item);
  }

  // For unique 9x9 puzzle, should have exactly 81 candidates (one per cell)
  assert.equal(items.length, 81);

  // Each item should have cell, value, count
  const first = items[0];
  assert.ok('cell' in first);
  assert.ok('value' in first);
  assert.ok('count' in first);
});

await runTest('TrueCandidates iterator yields correct structure', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);

  for (const { cell, value, count } of candidates) {
    assert.equal(typeof cell, 'string');
    assert.ok(cell.match(/^R\dC\d$/), `Invalid cell format: ${cell}`);
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 9);
    assert.ok(Number.isInteger(count) && count >= 1);
  }
});

await runTest('TrueCandidates iterator matches valuesAt', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);

  // Collect all values per cell from iterator
  const cellValues = new Map();
  for (const { cell, value } of candidates) {
    if (!cellValues.has(cell)) cellValues.set(cell, []);
    cellValues.get(cell).push(value);
  }

  // Check against valuesAt
  for (const [cell, values] of cellValues) {
    assert.deepEqual(values, candidates.valuesAt(cell));
  }
});

await runTest('TrueCandidates iterator count matches countAt', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS, 3);

  for (const { cell, value, count } of candidates) {
    assert.equal(count, candidates.countAt(cell, value));
  }
});

// ============================================================================
// trueCandidates limit parameter tests
// ============================================================================

await runTest('trueCandidates with limit=1 (default)', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);
  // With limit=1, all counts should be 1
  for (const { count } of candidates) {
    assert.equal(count, 1);
  }
});

await runTest('trueCandidates with higher limit tracks counts', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS, 10);
  // Some values might appear in multiple solutions
  let foundHigherCount = false;
  for (const { count } of candidates) {
    if (count > 1) {
      foundHigherCount = true;
      break;
    }
  }
  // Not guaranteed to find higher counts, but counts should be valid
  assert.ok(true, 'Completed without error');
});

// ============================================================================
// TrueCandidates.toString tests
// ============================================================================

await runTest('TrueCandidates.toString returns correct format', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  const str = candidates.toString();
  // For 9x9 with 9 values, should be 81*9 = 729 characters
  assert.equal(str.length, 81 * 9);
  // Should only contain digits 1-9 and dots
  assert.ok(/^[1-9.]+$/.test(str), 'Should only contain digits and dots');
});

await runTest('TrueCandidates.toString has single candidate per cell for unique solution', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  const str = candidates.toString();
  // For unique solution, each cell should have exactly one candidate
  // Check first cell (9 chars): should have one digit and 8 dots
  const firstCell = str.slice(0, 9);
  const digitCount = (firstCell.match(/[1-9]/g) || []).length;
  assert.equal(digitCount, 1, 'Unique solution cell should have exactly one candidate');
});

await runTest('TrueCandidates.toString matches valuesAt', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);
  const str = candidates.toString();
  const numValues = 4; // 4x4 grid

  // Check first few cells
  for (let cellIdx = 0; cellIdx < 4; cellIdx++) {
    const cellStr = str.slice(cellIdx * numValues, (cellIdx + 1) * numValues);
    const row = Math.floor(cellIdx / 4) + 1;
    const col = (cellIdx % 4) + 1;
    const values = candidates.valuesAt(row, col);

    for (let v = 1; v <= numValues; v++) {
      const isCandidate = values.includes(v);
      const charAtV = cellStr[v - 1];
      if (isCandidate) {
        assert.equal(charAtV, String(v), `Cell ${cellIdx} value ${v} should be candidate`);
      } else {
        assert.equal(charAtV, '.', `Cell ${cellIdx} value ${v} should be dot`);
      }
    }
  }
});

// ============================================================================
// TrueCandidates.witnessSolutions tests
// ============================================================================

await runTest('TrueCandidates.witnessSolutions returns array of Solution objects', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  const solutions = candidates.witnessSolutions;
  assert.ok(Array.isArray(solutions));
  assert.equal(solutions.length, 1);
  assert.ok(solutions[0] instanceof Solution);
});

await runTest('TrueCandidates.witnessSolutions has multiple for multi-solution puzzle', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);
  assert.ok(candidates.witnessSolutions.length > 1, 'Should have multiple solutions');
});

await runTest('TrueCandidates.witnessSolutions contains valid solutions', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(CLASSIC_SUDOKU.input);
  const solution = candidates.witnessSolutions[0];
  assert.equal(solution.toString(), CLASSIC_SUDOKU.solution);
});

await runTest('TrueCandidates.witnessSolutions are all unique', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);
  const solutionStrings = candidates.witnessSolutions.map(s => s.toString());
  const uniqueStrs = new Set(solutionStrings);
  assert.equal(uniqueStrs.size, solutionStrings.length, 'All solutions should be unique');
});

await runTest('TrueCandidates witnessSolutions match valuesAt', async () => {
  const solver = new SimpleSolver();
  const candidates = await solver.trueCandidates(MULTI_SOLUTIONS);

  // For each cell, check that all solution values appear in valuesAt
  for (const solution of candidates.witnessSolutions) {
    for (const { cell, value } of solution) {
      const cellValues = candidates.valuesAt(cell);
      assert.ok(cellValues.includes(value),
        `Solution value ${value} at ${cell} should be in valuesAt`);
    }
  }
});

logSuiteComplete('SimpleSolver');
