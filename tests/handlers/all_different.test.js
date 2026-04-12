import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { AllDifferent } = await import('../../js/solver/handlers.js');

await runTest('AllDifferent should remove fixed value from other cells', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new AllDifferent(
    [0, 1, 2], AllDifferent.PROPAGATE_WITH_ENFORCER);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(5);
  grid[1] = valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9);
  grid[2] = valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1] & valueMask(5), 0, 'cell 1 should not contain 5');
  assert.equal(grid[2] & valueMask(5), 0, 'cell 2 should not contain 5');
});

await runTest('AllDifferent should fail when two cells forced to same value', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new AllDifferent(
    [0, 1, 2], AllDifferent.PROPAGATE_WITH_ENFORCER);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(5);
  grid[1] = valueMask(5);
  grid[2] = valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('AllDifferent should pass when all cells have distinct fixed values', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new AllDifferent(
    [0, 1, 2], AllDifferent.PROPAGATE_WITH_ENFORCER);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1));
  assert.equal(grid[1], valueMask(2));
  assert.equal(grid[2], valueMask(3));
});

await runTest('AllDifferent should not prune when no cell is fixed', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new AllDifferent(
    [0, 1, 2], AllDifferent.PROPAGATE_WITH_ENFORCER);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(1, 2, 3);
  grid[1] = valueMask(1, 2, 3);
  grid[2] = valueMask(1, 2, 3);

  const before = [grid[0], grid[1], grid[2]];
  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], before[0]);
  assert.equal(grid[1], before[1]);
  assert.equal(grid[2], before[2]);
});

await runTest('AllDifferent should fail init when cells have fewer distinct values than cells', () => {
  // 5 cells, but restrict to only 4 values available.
  const context = new GridTestContext({ gridSize: [1, 5], numValues: 9 });
  const handler = new AllDifferent(
    [0, 1, 2, 3, 4], AllDifferent.PROPAGATE_WITH_ENFORCER);

  const grid = context.grid;
  for (let i = 0; i < 5; i++) {
    grid[i] = valueMask(1, 2, 3, 4);
  }

  const result = context.initializeHandler(handler);
  assert.equal(result, false, '5 cells with only 4 available values is impossible');
});

await runTest('AllDifferent should pass init when cells have enough distinct values', () => {
  // 5 cells with 5 values available — feasible.
  const context = new GridTestContext({ gridSize: [1, 5], numValues: 9 });
  const handler = new AllDifferent(
    [0, 1, 2, 3, 4], AllDifferent.PROPAGATE_WITH_ENFORCER);

  const grid = context.grid;
  for (let i = 0; i < 5; i++) {
    grid[i] = valueMask(1, 2, 3, 4, 5);
  }

  const result = context.initializeHandler(handler);
  assert.equal(result, true, '5 cells with 5 available values is feasible');
});

logSuiteComplete('all_different.test.js');
