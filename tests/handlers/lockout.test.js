import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Lockout } = await import('../../js/solver/handlers.js');

await runTest('enforce constrains endpoints by min_diff', () => {
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 6 });
  const handler = new Lockout(4, [0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // min_diff=4, numValues=6: valid pairs (1,5)(1,6)(2,6)(5,1)(6,1)(6,2)
  assert.equal(grid[0], valueMask(1, 2, 5, 6));
  assert.equal(grid[3], valueMask(1, 2, 5, 6));
});

await runTest('mids exclude lockout range', () => {
  const context = new GridTestContext({ gridSize: [2, 4], numValues: 8 });
  const handler = new Lockout(4, [0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(6);
  grid[3] = valueMask(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Mids get values < 1 or values > 6 → only {7, 8}.
  assert.equal(grid[1], valueMask(7, 8));
  assert.equal(grid[2], valueMask(7, 8));
});

await runTest('fail when lockout covers all values', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Lockout(3, [0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[3] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('short line endpoints only', () => {
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 6 });
  const handler = new Lockout(3, [0, 1]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('overlapping ranges no mid pruning', () => {
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 6 });
  const handler = new Lockout(2, [0, 1, 2]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4);
  grid[2] = valueMask(2, 3, 4, 5);
  const beforeMid = grid[1];

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[1], beforeMid, 'mid should not be pruned when ranges overlap');
});

logSuiteComplete('lockout.test.js');
