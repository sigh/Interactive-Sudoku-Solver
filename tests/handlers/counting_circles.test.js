import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, createCellExclusions, valueMask } from '../helpers/grid_test_utils.js';

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

logSuiteComplete('counting_circles.test.js');
