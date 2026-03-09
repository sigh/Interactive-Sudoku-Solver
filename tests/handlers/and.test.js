import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { And, True, False } = await import('../../js/solver/handlers.js');

await runTest('all pass returns true', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new And(new True(), new True());
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('first failure short circuits', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new And(new False([0]), new True());
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('init short circuits on failure', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new And(new False([0]), new True());
  const result = context.initializeHandler(handler);
  assert.equal(result, false);
});

await runTest('cells is union of sub handlers', () => {
  const handler = new And(new True(), new True());
  // True has no cells, so And should have no cells either.
  assert.equal(handler.cells.length, 0);
});

logSuiteComplete('and.test.js');
