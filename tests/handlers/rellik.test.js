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
  context.initializeHandler(handler);

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
  context.initializeHandler(handler);

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
  context.initializeHandler(handler);

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
  context.initializeHandler(handler);

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

// =============================================================================
// Offset (0-indexed) tests
// The handler works in external-value space: it subtracts external values
// (toValue + valueOffset) from the external sum.
// =============================================================================

const { GridShape } = await import('../../js/grid_shape.js');

await runTest('offset: forbidden external sum detected', () => {
  // 2 cells, external forbidden sum = 3, offset = -1.
  // Cells: ext 1 + ext 2 = 3 → forbidden.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new Rellik([0, 1], 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);  // internal 2 (ext 1)
  grid[1] = valueMask(3);  // internal 3 (ext 2)

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('offset: non-forbidden external sum passes', () => {
  // 2 cells, external forbidden sum = 3, offset = -1.
  // Cells: ext 0 + ext 1 = 1 ≠ 3 → pass.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new Rellik([0, 1], 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);  // internal 1 (ext 0)
  grid[1] = valueMask(2);  // internal 2 (ext 1)

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('offset: removes dangerous external value from unfixed cells', () => {
  // 3 cells, external forbidden sum = 5, offset = -1.
  // Cell 0 fixed to ext 3 (int 4). Cell 1 fixed to ext 1 (int 2).
  // Remainder after cell 0: ext 3 subtracted → remainder 2.
  // Ext 2 (int 3) should be removed from unfixed cell 2.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new Rellik([0, 1, 2], 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(4);           // fixed: ext 3
  grid[1] = valueMask(2);           // fixed: ext 1
  grid[2] = valueMask(1, 2, 3);    // unfixed: ext {0,1,2}

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Ext 2 (int 3) completes forbidden sum with cell 0: ext 3 + ext 2 = 5.
  assert.equal(grid[2] & valueMask(3), 0, 'ext 2 (int 3) should be removed');
});

await runTest('offset=0: unchanged behavior', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Rellik([0, 1], 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

logSuiteComplete('rellik.test.js');
