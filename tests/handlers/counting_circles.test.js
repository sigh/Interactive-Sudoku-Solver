import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, createCellExclusions, valueMask, valueMask0 } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { CountingCircles } = await import('../../js/solver/handlers.js');

// CountingCircles uses exclusion groups to limit values. With allUnique: false,
// each cell gets its own exclusion group (no mutual exclusions).
const noExclusions = (numCells) => createCellExclusions({ numCells, allUnique: false });

await runTest('init restricts to valid combinations', () => {
  // 3 cells, numValues=4. Combos with sum=3: {1,2}(1+2=3), {3}(3).
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountingCircles([0, 1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  // Value 4 cannot be in any combo with sum 3.
  for (let i = 0; i < 3; i++) {
    assert.equal(grid[i] & valueMask(4), 0, `cell ${i} should not contain value 4`);
  }
});

await runTest('fixed values filter combinations', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountingCircles([0, 1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Only combo {1,2} survives (contains 1). With 3 singleton exclusion groups,
  // value 2 must appear in each unfixed cell's group → both fixed to {2}.
  assert.equal(grid[1], valueMask(2));
  assert.equal(grid[2], valueMask(2));
});

await runTest('fail when no valid combination', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountingCircles([0, 1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask(4);
  grid[1] = valueMask(4);
  grid[2] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('exact count fixes cells', () => {
  // 2 cells, sum=2. Only combo: {2}. Both cells must be 2.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountingCircles([0, 1]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(2));
});

// Offset (0-indexed) tests
// =============================================================================

const { GridShape } = await import('../../js/grid_shape.js');

await runTest('offset: init excludes external 0 and shifts combinations', () => {
  // 2 cells, offset=-1, numValues=4: external 0-3.
  // External 0 can't appear. Valid external values: {1,2,3}.
  // Combos with external sum=2: {2} → both cells must be 2.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new CountingCircles([0, 1]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask0(2));
  assert.equal(grid[1], valueMask0(2));
});

await runTest('offset: enforceConsistency uses shifted counts', () => {
  // 3 cells, offset=-1. Fix cell 0 to 1 → only combo {1, 2} survives.
  // Value 2 must appear twice.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new CountingCircles([0, 1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask0(1); // Fix to 1

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[1], valueMask0(2));
  assert.equal(grid[2], valueMask0(2));
});

await runTest('offset: too many of a value fails', () => {
  // External 1 should appear exactly 1 time.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new CountingCircles([0, 1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask0(1);
  grid[1] = valueMask0(1);
  grid[2] = valueMask0(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('offset=0: unchanged behavior', () => {
  // Same as the non-offset "exact count" test. 2 cells, sum=2, combo: {2}.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountingCircles([0, 1]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(2));
});

logSuiteComplete('counting_circles.test.js');
