import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  createCellExclusions,
  valueMask,
  valueMask0,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { CountDistinct } = await import('../../js/solver/handlers.js');
const { GridShape } = await import('../../js/grid_shape.js');

const noExclusions = (numCells) => createCellExclusions({ numCells, allUnique: false });

await runTest('control restricted to [1, numCounted] on init', () => {
  // Control = cell 0, counted = cells 1..3 (all values 1-4 available).
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  // At most 3 distinct values across 3 cells, so value 4 is removed.
  assert.equal(context.grid[0], valueMask(1, 2, 3));
});

await runTest('mutually exclusive counted cells raise the minimum on init', () => {
  // All counted cells share an all-different region, so they must be distinct:
  // the distinct count is forced to exactly the number of counted cells.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(
    handler, { cellExclusions: createCellExclusions({ numCells: 4 }) });

  // 3 mutually exclusive counted cells → at least and at most 3 distinct.
  assert.equal(context.grid[0], valueMask(3));
});

await runTest('fixed counted cells determine the exact distinct count', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[1] = valueMask(1);
  grid[2] = valueMask(1);
  grid[3] = valueMask(2);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Distinct values = {1, 2} → control must be 2.
  assert.equal(grid[0], valueMask(2));
});

await runTest('disjoint candidate masks raise the minimum distinct count', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  // Three pairwise-disjoint cells force at least 3 distinct values.
  grid[1] = valueMask(1);
  grid[2] = valueMask(2);
  grid[3] = valueMask(3, 4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[0], valueMask(3));
});

await runTest('control fixed to the fixed-distinct count collapses counted cells', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask(1);          // control = 1 distinct value
  grid[1] = valueMask(1);          // fixed to 1
  grid[2] = valueMask(1, 2, 3);
  grid[3] = valueMask(1, 4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // No new distinct values allowed → every cell collapses to 1.
  assert.equal(grid[1], valueMask(1));
  assert.equal(grid[2], valueMask(1));
  assert.equal(grid[3], valueMask(1));
});

await runTest('GAC: repeated fixed value tightens the control max exactly', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[1] = valueMask(1);
  grid[2] = valueMask(1);
  grid[3] = valueMask(1, 2, 3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Two cells pinned to 1 means the distinct count is 1 or 2, never 3 — the
  // cheap popcount bound would leave value 3 in place.
  assert.equal(grid[0], valueMask(1, 2));
});

await runTest('GAC: control forces the only value that adds a new distinct', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask(3);          // exactly 3 distinct required
  grid[1] = valueMask(1);
  grid[2] = valueMask(2);
  grid[3] = valueMask(1, 2, 3);    // must supply the 3rd distinct value

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Only value 3 keeps a third distinct value reachable.
  assert.equal(grid[3], valueMask(3));
  assert.equal(grid[1], valueMask(1));
  assert.equal(grid[2], valueMask(2));
});

await runTest('GAC: control pinned to the minimum collapses onto a shared value', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask(1);          // exactly 1 distinct value
  grid[1] = valueMask(1, 2);
  grid[2] = valueMask(2, 3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // One distinct value forces both cells onto their only shared value, 2.
  assert.equal(grid[1], valueMask(2));
  assert.equal(grid[2], valueMask(2));
});

await runTest('fails when the control value is unreachable', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new CountDistinct(0, [1, 2, 3]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  const grid = context.grid;
  grid[0] = valueMask(1);  // claims 1 distinct value...
  grid[1] = valueMask(1);  // ...but three disjoint cells force 3.
  grid[2] = valueMask(2);
  grid[3] = valueMask(3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('offset: control counts distinct values in a 0-indexed grid', () => {
  // numValues=4, values 0-3. 2 counted cells → at most 2 distinct.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new CountDistinct(0, [1, 2]);
  context.initializeHandler(handler, { cellExclusions: noExclusions(4) });

  // Counts 1..2 are representable as digits 1..2.
  assert.equal(context.grid[0], valueMask0(1, 2));

  const grid = context.grid;
  grid[1] = valueMask0(0);
  grid[2] = valueMask0(3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Two distinct values → control digit is 2.
  assert.equal(grid[0], valueMask0(2));
});

logSuiteComplete('count_distinct.test.js');
