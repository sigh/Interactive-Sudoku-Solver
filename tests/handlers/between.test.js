import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, createCellExclusions, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Between } = await import('../../js/solver/handlers.js');

await runTest('enforce clamps mids between endpoints', () => {
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 6 });
  const handler = new Between([0, 1, 2, 3, 4, 5]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[5] = valueMask(6);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);
  assert.equal(result, true);
  for (let i = 1; i < 5; i++) {
    assert.equal(grid[i] & valueMask(1), 0, `mid cell ${i} should not contain 1`);
    assert.equal(grid[i] & valueMask(6), 0, `mid cell ${i} should not contain 6`);
  }
});

await runTest('fail when no valid intermediate range', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Between([0, 1, 2, 3]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(3);
  grid[3] = valueMask(3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('fixed mid constrains endpoints', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Between([0, 1, 2]);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4);
  grid[1] = valueMask(3);
  grid[2] = valueMask(1, 2, 3, 4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0] & valueMask(3), 0, 'endpoint 0 should not contain 3');
  assert.equal(grid[2] & valueMask(3), 0, 'endpoint 2 should not contain 3');
});

await runTest('init constrains endpoints via binary with exclusion groups', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Between([0, 1, 2, 3]);
  const ce = createCellExclusions({ allUnique: true, numCells: 4 });
  context.initializeHandler(handler, { cellExclusions: ce });

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Mids are mutually exclusive (group of 2) → min_ends_delta=3 → only (1,4)/(4,1).
  assert.equal(grid[0], valueMask(1, 4));
  assert.equal(grid[3], valueMask(1, 4));
});

logSuiteComplete('between.test.js');
