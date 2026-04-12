import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { House } = await import('../../js/solver/handlers.js');

await runTest('House should detect and fix hidden singles', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new House(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  // Value 1 only appears in cell 0.
  grid[0] = valueMask(1, 2, 3);
  grid[1] = valueMask(2, 3);
  grid[2] = valueMask(2, 3);
  for (let i = 3; i < 9; i++) {
    grid[i] = valueMask(4, 5, 6, 7, 8, 9);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1), 'cell 0 should be fixed to hidden single');
});

await runTest('House should fail when required value missing from all cells', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new House(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  // Only values 1-8, value 9 is missing.
  for (let i = 0; i < 9; i++) {
    grid[i] = valueMask(1, 2, 3, 4, 5, 6, 7, 8);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when a value cannot be placed');
});

await runTest('House should not modify cells when no hidden singles exist', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new House(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  // All cells have all values — no hidden singles, no issues.
  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  for (let i = 0; i < 9; i++) {
    assert.equal(grid[i], valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9));
  }
});

await runTest('House should pass when all cells have distinct fixed values', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new House(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  for (let i = 0; i < 9; i++) {
    grid[i] = valueMask(i + 1);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('House allValues should reflect cell candidates, not shape.numValues', () => {
  // 6 cells in a grid with numValues=9, but cells only have values 1-6.
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 9 });
  const cells = context.cells(6);
  const handler = new House(cells);

  const grid = context.grid;
  for (let i = 0; i < 6; i++) {
    grid[i] = valueMask(1, 2, 3, 4, 5, 6);
  }
  context.initializeHandler(handler);

  // Each cell has a distinct fixed value from 1-6.
  for (let i = 0; i < 6; i++) {
    grid[i] = valueMask(i + 1);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  // With the fix, allValues is {1..6}, so all values are present → pass.
  // Old code would use shape.numValues=9, requiring values 7,8,9 too → fail.
  assert.equal(result, true, 'house should pass when all cell-available values are present');
});

await runTest('House should detect hidden singles with non-default value set', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const cells = context.cells(4);
  const handler = new House(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  // Value 1 only in cell 0.
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(2, 3);
  grid[2] = valueMask(3, 4);
  grid[3] = valueMask(2, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1), 'cell 0 should be fixed to hidden single 1');
});

logSuiteComplete('house.test.js');
