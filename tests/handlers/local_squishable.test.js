import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { LocalEntropy, LocalMod3 } = await import('../../js/solver/handlers.js');

await runTest('entropy basic squish - all triads covered', () => {
  const context = new GridTestContext({ gridSize: [2, 2], numValues: 9 });
  const handler = new LocalEntropy([0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(4);
  grid[2] = valueMask(7);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('entropy hidden single', () => {
  const context = new GridTestContext({ gridSize: [2, 2], numValues: 9 });
  const handler = new LocalEntropy([0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(4, 5);
  grid[2] = valueMask(4, 5);
  grid[3] = valueMask(7, 8);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Cell 0 is only cell with triad {1,2,3}, stays {1,2}.
  assert.equal(grid[0], valueMask(1, 2));
  // Cell 3 is only cell with triad {7,8,9}, stays {7,8}.
  assert.equal(grid[3], valueMask(7, 8));
});

await runTest('entropy fail missing triad', () => {
  const context = new GridTestContext({ gridSize: [2, 2], numValues: 9 });
  const handler = new LocalEntropy([0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(4);
  grid[3] = valueMask(5);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('mod3 basic - all triads covered', () => {
  const context = new GridTestContext({ gridSize: [2, 2], numValues: 9 });
  const handler = new LocalMod3([0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

logSuiteComplete('local_squishable.test.js');
