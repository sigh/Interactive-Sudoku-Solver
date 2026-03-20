import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask, valueMask0 } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SumLine } = await import('../../js/solver/handlers.js');

await runTest('backward pass prunes invalid combos', () => {
  // 2 cells, sum=3, non-loop. Valid: 1+2=3, 2+1=3.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new SumLine([0, 1], false, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Both values participate in valid combos.
  assert.equal(grid[0], valueMask(1, 2));
  assert.equal(grid[1], valueMask(1, 2));
});

await runTest('non-loop requires zero start - single cell', () => {
  // 1 cell, sum=3, non-loop. Only value 3 makes partial sum = 3.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new SumLine([0], false, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask(3), 'only value 3 makes partial sum = 3');
});

await runTest('fail when partial sum impossible', () => {
  // 2 cells, sum=5, non-loop. Both fixed to 1. 1+1=2 ≠ multiple of 5.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new SumLine([0, 1], false, 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('loop mode allows any starting sum', () => {
  // In loop mode, initial_state = (1<<sum)-1, so any partial sum is valid.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new SumLine([0, 1], true, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 3);
  grid[1] = valueMask(1, 3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('forward pass propagation', () => {
  // 3 cells, sum=5, non-loop. Cell 0 fixed=2, cell 1={1,2,3}, cell 2={1,2,3,4}.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new SumLine([0, 1, 2], false, 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(1, 2, 3);
  grid[2] = valueMask(1, 2, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);
  assert.equal(result, true);
  // Cell 0 stays fixed.
  assert.equal(grid[0], valueMask(2));
});

// =============================================================================
// Offset (0-indexed) tests
// =============================================================================

const { GridShape } = await import('../../js/grid_shape.js');

await runTest('offset: external values used for partial sums', () => {
  // 2 cells, sum=3, offset=-1. External values 0-3.
  // External 0 contributes 0 to sum, external 3 contributes 3.
  // Valid: 0+3=3, 3+0=3, 1+2=3, 2+1=3.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new SumLine([0, 1], false, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask0(0, 3);
  grid[1] = valueMask0(0, 3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Both are valid: 0+3 and 3+0.
  assert.equal(grid[0], valueMask0(0, 3));
  assert.equal(grid[1], valueMask0(0, 3));
});

await runTest('offset: constrains cell to correct external value', () => {
  // 2 cells, sum=3, offset=-1. Cell 0 fixed to 1.
  // Cell 1 must contribute so total = multiple of 3.
  // 0→total 1 (no), 1→total 2 (no), 2→total 3 (yes), 3→total 4 (no).
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new SumLine([0, 1], false, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask0(1);           // fixed to 1
  grid[1] = valueMask0(0, 1, 2, 3); // all candidates

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[1], valueMask0(2), 'only 2 gives total 3');
});

await runTest('offset: non-multiple external sum fails', () => {
  // 2 cells, sum=3, offset=-1. Cell 0 = 0, Cell 1 = 1.
  // Total = 0+1 = 1. 1 mod 3 ≠ 0 → fail.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new SumLine([0, 1], false, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask0(0);
  grid[1] = valueMask0(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('offset=0: unchanged behavior', () => {
  // Same as existing "backward pass prunes" test to confirm offset=0 is a no-op.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new SumLine([0, 1], false, 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask(1, 2));
  assert.equal(grid[1], valueMask(1, 2));
});

logSuiteComplete('sum_line.test.js');
