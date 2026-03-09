import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { EqualSizePartitions } = await import('../../js/solver/handlers.js');

await runTest('EqualSizePartitions should restrict cells to partition values on init', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells(4);
  const handler = new EqualSizePartitions(cells, [1, 2], [3, 4]);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  for (let i = 0; i < 4; i++) {
    assert.equal(grid[i], valueMask(1, 2, 3, 4));
  }
});

await runTest('EqualSizePartitions should force remaining cells when one partition is full', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const cells = context.cells(4);
  const handler = new EqualSizePartitions(cells, [1, 2], [3, 4]);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(1, 2, 3, 4);
  grid[3] = valueMask(1, 2, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[2], valueMask(3, 4));
  assert.equal(grid[3], valueMask(3, 4));
});

await runTest('EqualSizePartitions should pass when both partitions satisfied', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const cells = context.cells(4);
  const handler = new EqualSizePartitions(cells, [1, 2], [3, 4]);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);
  grid[3] = valueMask(4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('EqualSizePartitions should fail when too many in one partition', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const cells = context.cells(4);
  const handler = new EqualSizePartitions(cells, [1, 2], [3, 4]);

  const grid = context.grid;
  context.initializeHandler(handler);

  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(1);
  grid[3] = valueMask(3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

logSuiteComplete('equal_size_partitions.test.js');
