import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Rellik } = await import('../../js/solver/handlers.js');

await runTest('Rellik should remove forbidden sum value from unfixed cells', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Rellik([0, 1, 2], 5);

  const grid = context.grid;
  grid[0] = valueMask(2);        // fixed
  grid[1] = valueMask(1, 3, 4);
  grid[2] = valueMask(1, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // 2+3=5 (forbidden), so value 3 removed from unfixed cells.
  assert.equal(grid[1] & valueMask(3), 0, 'value 3 should be removed from cell 1');
  assert.equal(grid[2] & valueMask(3), 0, 'value 3 should be removed from cell 2');
});

await runTest('Rellik should pass when no dangerous values exist', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Rellik([0, 1, 2], 9);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2);
  grid[2] = valueMask(1, 2);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Rellik should fail when fixed cells achieve forbidden sum', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Rellik([0, 1], 5);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(3);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('Rellik should track multiple fixed values correctly', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Rellik([0, 1, 2], 6);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(1, 2, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // 1+2=3, which is a sub-sum of 6, so value 3 should be removed from cell 2.
  assert.equal(grid[2] & valueMask(3), 0, 'value 3 should be removed');
});

logSuiteComplete('rellik.test.js');
