import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { BinaryPairwise } = await import('../../js/solver/handlers.js');
const { fnToBinaryKey } = await import('../../js/sudoku_constraint.js');

function allDiffKey(numValues) {
  return fnToBinaryKey((a, b) => a !== b, numValues);
}

await runTest('prefix suffix prunes values', () => {
  const numValues = 4;
  const key = allDiffKey(numValues);
  const context = new GridTestContext({ gridSize: [1, 4], numValues });
  const handler = new BinaryPairwise(key, ...[0, 1, 2]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Cell 1 and cell 2 should lose value 1.
  assert.equal(grid[1] & valueMask(1), 0);
  assert.equal(grid[2] & valueMask(1), 0);
});

await runTest('all different filters combinations', () => {
  const numValues = 3;
  const key = allDiffKey(numValues);
  const context = new GridTestContext({ gridSize: [1, 3], numValues });
  const handler = new BinaryPairwise(key, ...[0, 1, 2]);
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // With 3 cells and 3 values all-different, all values remain.
  assert.equal(grid[0], valueMask(1, 2, 3));
});

await runTest('fail when no valid assignment', () => {
  // 3 cells all-different but only 2 possible values → impossible.
  const numValues = 3;
  const key = allDiffKey(numValues);
  const context = new GridTestContext({ gridSize: [1, 3], numValues });
  const handler = new BinaryPairwise(key, ...[0, 1, 2]);
  context.initializeHandler(handler);

  const grid = context.grid;
  // Restrict all cells to only values 1 and 2.
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2);
  grid[2] = valueMask(1, 2);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('non all different key', () => {
  const numValues = 4;
  const key = fnToBinaryKey((a, b) => a + b <= 5, numValues);
  const context = new GridTestContext({ gridSize: [1, 4], numValues });
  const handler = new BinaryPairwise(key, ...[0, 1]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[1], valueMask(1));
});

await runTest('backward pass prunes last cell', () => {
  const numValues = 4;
  const key = allDiffKey(numValues);
  const context = new GridTestContext({ gridSize: [1, 4], numValues });
  const handler = new BinaryPairwise(key, ...[0, 1]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[1] = valueMask(3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0] & valueMask(3), 0);
});

await runTest('validCombinationInfo is zero when no valid subset exists', () => {
  // Entropic key: values must be from different groups of 3.
  // Groups: {1,2,3}, {4,5,6}, {7,8,9}.
  // With numCells=3, selecting 3 from {1,2,3,4} has no valid 3-cell subset
  // (every triple includes two values from group 0).
  // The table entry for valueMask(1,2,3,4) must be 0.
  // Regression: an operator precedence bug left stale required-value bits.
  const numValues = 9;
  const key = fnToBinaryKey(
    (a, b) => (((a - 1) / 3) | 0) !== (((b - 1) / 3) | 0), numValues);
  const table = BinaryPairwise._validCombinationInfoTable(key, numValues, 3);
  assert.equal(table[valueMask(1, 2, 3, 4)], 0);
});

logSuiteComplete('binary_pairwise.test.js');
