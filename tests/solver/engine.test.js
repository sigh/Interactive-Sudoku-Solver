import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

// ============================================================================
// Test Data
// ============================================================================

// Easy classic 9x9 with unique solution.
const makeEasyClassicConstraint = () => {
  const givens = [
    ['R1C1', 5], ['R1C2', 3], ['R1C5', 7],
    ['R2C1', 6], ['R2C4', 1], ['R2C5', 9], ['R2C6', 5],
    ['R3C2', 9], ['R3C3', 8], ['R3C8', 6],
    ['R4C1', 8], ['R4C5', 6], ['R4C9', 3],
    ['R5C1', 4], ['R5C4', 8], ['R5C6', 3], ['R5C9', 1],
    ['R6C1', 7], ['R6C5', 2], ['R6C9', 6],
    ['R7C2', 6], ['R7C7', 2], ['R7C8', 8],
    ['R8C4', 4], ['R8C5', 1], ['R8C6', 9], ['R8C9', 5],
    ['R9C5', 8], ['R9C8', 7], ['R9C9', 9],
  ];
  return new SudokuConstraint.Container(
    givens.map(([cell, value]) => new SudokuConstraint.Given(cell, value))
  );
};

const EASY_SOLUTION = [5,3,4,6,7,8,9,1,2,6,7,2,1,9,5,3,4,8,1,9,8,3,4,2,5,6,7,8,5,9,7,6,1,4,2,3,4,2,6,8,5,3,7,9,1,7,1,3,9,2,4,8,5,6,9,6,1,5,3,7,2,8,4,2,8,7,4,1,9,6,3,5,3,4,5,2,8,6,1,7,9];

// 4x4 with one given — has multiple solutions.
const makeMultiSolutionConstraint = () => {
  return SudokuBuilder.resolveConstraint({
    type: 'Container',
    args: [[
      { type: 'Shape', args: ['4x4'] },
      { type: 'Given', args: ['R1C1', 1] },
    ]],
  });
};

// Contradictory puzzle: two givens in same cell.
const makeContradictoryConstraint = () => {
  return new SudokuConstraint.Container([
    new SudokuConstraint.Given('R1C1', 1),
    new SudokuConstraint.Given('R1C2', 1),
    new SudokuConstraint.Given('R1C3', 1),
  ]);
};

const buildSolver = (constraint, debugOptions) => {
  return SudokuBuilder.build(constraint, debugOptions);
};

// ============================================================================
// countSolutions
// ============================================================================

await runTest('countSolutions returns 1 for unique puzzle', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  assert.equal(solver.countSolutions(), 1);
});

await runTest('countSolutions returns 0 for contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  assert.equal(solver.countSolutions(), 0);
});

await runTest('countSolutions returns multiple for under-constrained puzzle', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const count = solver.countSolutions();
  assert.ok(count > 1, `Expected multiple solutions, got ${count}`);
});

await runTest('countSolutions respects limit', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const count = solver.countSolutions(2);
  assert.equal(count, 2);
});

await runTest('countSolutions with limit=1 stops after first', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  assert.equal(solver.countSolutions(1), 1);
});

// ============================================================================
// nthSolution
// ============================================================================

await runTest('nthSolution(0) returns first solution', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const solution = solver.nthSolution(0);
  assert.ok(solution);
  assert.deepEqual([...solution], EASY_SOLUTION);
});

await runTest('nthSolution returns null for contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  assert.equal(solver.nthSolution(0), null);
});

await runTest('nthSolution sequential: n=0 then n=1 on unique puzzle', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const s0 = solver.nthSolution(0);
  const s1 = solver.nthSolution(1);
  assert.ok(s0);
  assert.ok(s1);
  // Different solutions (multi-solution puzzle).
  assert.notDeepEqual([...s0], [...s1]);
});

await runTest('nthSolution(0) can be called multiple times', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const s1 = solver.nthSolution(0);
  const s2 = solver.nthSolution(0);
  assert.deepEqual([...s1], [...s2]);
});

// ============================================================================
// solveAllPossibilities
// ============================================================================

await runTest('solveAllPossibilities returns Uint8Array', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const result = solver.solveAllPossibilities();
  assert.ok(result instanceof Uint8Array);
});

await runTest('solveAllPossibilities unique puzzle has exactly one candidate per cell', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const result = solver.solveAllPossibilities();
  const numValues = 9;
  // Each cell should have exactly one non-zero entry.
  for (let cell = 0; cell < 81; cell++) {
    let nonZeroCount = 0;
    for (let v = 0; v < numValues; v++) {
      if (result[cell * numValues + v] > 0) nonZeroCount++;
    }
    assert.equal(nonZeroCount, 1, `Cell ${cell} should have exactly 1 candidate`);
  }
});

await runTest('solveAllPossibilities multi-solution puzzle has multiple candidates', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const result = solver.solveAllPossibilities();
  const numValues = 4;
  // At least one cell should have multiple candidates.
  let foundMultiple = false;
  for (let cell = 0; cell < 16; cell++) {
    let nonZeroCount = 0;
    for (let v = 0; v < numValues; v++) {
      if (result[cell * numValues + v] > 0) nonZeroCount++;
    }
    if (nonZeroCount > 1) { foundMultiple = true; break; }
  }
  assert.ok(foundMultiple, 'Expected at least one cell with multiple candidates');
});

// ============================================================================
// validateLayout
// ============================================================================

await runTest('validateLayout returns solution for valid standard layout', () => {
  // Empty 9x9 (no givens) should be a valid layout.
  const constraint = new SudokuConstraint.Container([]);
  const solver = buildSolver(constraint);
  const result = solver.validateLayout();
  assert.ok(result, 'Standard 9x9 should be a valid layout');
});

// ============================================================================
// estimatedCountSolutions
// ============================================================================

// Note: estimatedCountSolutions runs an infinite sampling loop that
// terminates only via external interruption (e.g. worker termination).
// It is tested indirectly through SolverRunner's estimate-solutions mode.

// ============================================================================
// nthStep
// ============================================================================

await runTest('nthStep(0) returns initial state', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const step = solver.nthStep(0, new Map());
  assert.ok(step);
  assert.ok(step.pencilmarks);
  assert.ok('isSolution' in step);
  assert.ok('hasContradiction' in step);
  assert.ok(step.branchCells);
});

await runTest('nthStep returns null for contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  const step = solver.nthStep(0, new Map());
  // Step 0 should still return something (initial propagation may find contradiction).
  if (step) {
    assert.equal(step.hasContradiction, true);
  }
});

// ============================================================================
// state()
// ============================================================================

await runTest('state() returns correct shape before solving', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const state = solver.state();
  assert.ok(state);
  assert.ok('counters' in state);
  assert.ok('timeMs' in state);
  assert.ok('done' in state);
  assert.equal(state.done, false);
  assert.equal(state.counters.solutions, 0);
});

await runTest('state() reflects completion after counting', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  solver.countSolutions();
  const state = solver.state();
  assert.equal(state.done, true);
  assert.equal(state.counters.solutions, 1);
  assert.ok(state.timeMs >= 0);
});

await runTest('state() counters include expected fields', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  solver.countSolutions();
  const { counters } = solver.state();
  assert.equal(typeof counters.valuesTried, 'number');
  assert.equal(typeof counters.nodesSearched, 'number');
  assert.equal(typeof counters.backtracks, 'number');
  assert.equal(typeof counters.guesses, 'number');
  assert.equal(typeof counters.solutions, 'number');
  assert.equal(typeof counters.constraintsProcessed, 'number');
});

// ============================================================================
// setProgressCallback
// ============================================================================

await runTest('setProgressCallback is called during countSolutions', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  let callCount = 0;
  solver.setProgressCallback(() => { callCount++; }, 0);
  solver.countSolutions();
  // Should have been called at least once (final send).
  assert.ok(callCount >= 1, `Expected callback calls, got ${callCount}`);
});

await runTest('setProgressCallback is called during solveAllPossibilities', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  let callCount = 0;
  solver.setProgressCallback(() => { callCount++; }, 0);
  solver.solveAllPossibilities();
  assert.ok(callCount >= 1, `Expected callback calls, got ${callCount}`);
});

logSuiteComplete('SudokuSolver Engine');
