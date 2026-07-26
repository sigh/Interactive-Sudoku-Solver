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

const { CellGeometry } = await import('../../js/cell_geometry.js');

await runTest('offset: init excludes external 0 and shifts combinations', () => {
  // 2 cells, offset=-1, numValues=4: external 0-3.
  // External 0 can't appear. Valid external values: {1,2,3}.
  // Combos with external sum=2: {2} → both cells must be 2.
  const geometry = CellGeometry.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ geometry });
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
  const geometry = CellGeometry.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ geometry });
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
  const geometry = CellGeometry.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ geometry });
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

// =============================================================================
// Per-cell numValues tests
// =============================================================================

await runTest('CountingCircles works when cells have fewer values than numValues', () => {
  // 2 cells in a numValues=9 grid, but restricted to values 1-4.
  // Sum must equal 2, so only combo {2} works → both cells must be 2.
  const context = new GridTestContext({ gridSize: [1, 9], numValues: 9 });
  const handler = new CountingCircles([0, 1]);

  // Restrict cells to values 1-4 before initialization.
  const restricted = valueMask(1, 2, 3, 4);
  context.grid[0] = restricted;
  context.grid[1] = restricted;

  context.initializeHandler(handler, { cellExclusions: noExclusions(9) });

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(2));
});

// =============================================================================
// Exclusion groups beyond the old 16-group limit
// =============================================================================

await runTest('works with more than 16 exclusion groups', () => {
  // 17 cells (own singleton exclusion groups), numValues=16. The only combo
  // summing to numCells=17 restricted to {1, 16} is {1, 16}: value 16 must
  // occur 16 times and value 1 once. 16 cells are already fixed to 16; the
  // 17th still allows {1, 16} and should be forced down to 1.
  const geometry = CellGeometry.fromGridSize(2, 9, 16);
  const context = new GridTestContext({ geometry });
  const cells = Array.from({ length: 17 }, (_, i) => i);
  const handler = new CountingCircles(cells);

  for (let i = 0; i < 16; i++) {
    context.grid[i] = valueMask(16);
  }
  context.grid[16] = valueMask(1, 16);

  context.initializeHandler(
    handler, { cellExclusions: noExclusions(context.geometry.numGridCells) });

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[16], valueMask(1));
});

await runTest('failed init still rejects rather than throwing', () => {
  // A handler that returns false from initialize stays in the handler set -- the
  // grid is invalidated, the handler is not removed -- so enforceConsistency is
  // still called on it. It must reject, not throw on state initialize never set.
  // Here there is no combination of 5 distinct values summing to 5, so init fails.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountingCircles([0, 1, 2, 3, 4]);
  assert.equal(
    context.initializeHandler(handler, { cellExclusions: noExclusions(5) }),
    false, 'this cell count should be unsatisfiable');

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(context.grid, acc), false);
});

logSuiteComplete('counting_circles.test.js');
