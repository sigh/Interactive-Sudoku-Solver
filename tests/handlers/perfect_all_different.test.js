import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { PerfectAllDifferent } = await import('../../js/solver/handlers.js');

await runTest('PerfectAllDifferent should detect and fix hidden singles', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new PerfectAllDifferent(cells);

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

await runTest('PerfectAllDifferent should fail when required value missing from all cells', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new PerfectAllDifferent(cells);

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

await runTest('PerfectAllDifferent should not modify cells when no hidden singles exist', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new PerfectAllDifferent(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  for (let i = 0; i < 9; i++) {
    assert.equal(grid[i], valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9));
  }
});

await runTest('PerfectAllDifferent should pass when all cells have distinct fixed values', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cells = context.cells(9);
  const handler = new PerfectAllDifferent(cells);

  const grid = context.grid;
  context.initializeHandler(handler);

  for (let i = 0; i < 9; i++) {
    grid[i] = valueMask(i + 1);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('PerfectAllDifferent allValues should reflect cell candidates, not shape.numValues', () => {
  // 6 cells in a grid with numValues=9, but cells only have values 1-6.
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 9 });
  const cells = context.cells(6);
  const handler = new PerfectAllDifferent(cells);

  const grid = context.grid;
  for (let i = 0; i < 6; i++) {
    grid[i] = valueMask(1, 2, 3, 4, 5, 6);
  }
  context.initializeHandler(handler);

  for (let i = 0; i < 6; i++) {
    grid[i] = valueMask(i + 1);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should pass when all cell-available values are present');
});

await runTest('PerfectAllDifferent should detect hidden singles with non-default value set', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const cells = context.cells(4);
  const handler = new PerfectAllDifferent(cells);

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

await runTest('PerfectAllDifferent should handle restricted value sets', () => {
  const context = new GridTestContext({ gridSize: [1, 6], numValues: 10 });
  const cells = context.cells(6);
  const handler = new PerfectAllDifferent(cells);

  const grid = context.grid;
  for (let i = 0; i < 6; i++) {
    grid[i] = valueMask(1, 2, 3, 4, 5, 6);
  }
  context.initializeHandler(handler);

  // Value 1 only in cell 0.
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(2, 3);
  grid[2] = valueMask(3, 4);
  grid[3] = valueMask(4, 5);
  grid[4] = valueMask(5, 6);
  grid[5] = valueMask(2, 6);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1), 'cell 0 should be fixed to hidden single');
});

await runTest('PerfectAllDifferent should fail when required value is missing', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 10 });
  const cells = context.cells(4);
  const handler = new PerfectAllDifferent(cells);

  const grid = context.grid;
  for (let i = 0; i < 4; i++) {
    grid[i] = valueMask(1, 2, 3, 4);
  }
  context.initializeHandler(handler);

  for (let i = 0; i < 4; i++) {
    grid[i] = valueMask(1, 2, 3);
  }

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when a required value is missing');
});

await runTest('PerfectAllDifferent stores valueMask from constructor', () => {
  const h1 = new PerfectAllDifferent([0, 1, 2], 0b1110);
  assert.equal(h1.valueMask(), 0b1110);

  const h2 = new PerfectAllDifferent([0, 1, 2]);
  assert.equal(h2.valueMask(), 0, 'default valueMask should be 0');
});

logSuiteComplete('perfect_all_different.test.js');