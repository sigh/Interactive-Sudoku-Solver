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
const { CellGeometry } = await import('../../js/cell_geometry.js');

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
  const geometry = CellGeometry.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ geometry });
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

const withExclusionPairs = () => {
  const context = new GridTestContext({ gridSize: 4 });
  const handler = new CountDistinct(0, [1, 2, 3, 4, 5]);
  const exclusions = noExclusions(16);
  exclusions.addMutualExclusion(1, 2);
  exclusions.addMutualExclusion(3, 4);
  assert(context.initializeHandler(handler, { cellExclusions: exclusions }));
  return { handler, grid: context.grid };
};

await runTest('saturated exclusion groups restrict every counted cell', () => {
  const { handler, grid } = withExclusionPairs();
  grid[0] = valueMask(3);
  grid[1] = grid[2] = valueMask(1, 2, 3);
  grid[3] = grid[4] = valueMask(2, 3, 4);
  const acc = createAccumulator();
  assert(handler.enforceConsistency(grid, acc));
  assert.equal(grid[5], valueMask(1, 2, 3, 4));

  // Once only two values are allowed, both pairs use the entire value set.
  grid[0] = valueMask(2);
  assert(handler.enforceConsistency(grid, acc));
  for (let c = 1; c <= 5; c++) assert.equal(grid[c], valueMask(2, 3));
});

await runTest('saturated groups reject an intersection smaller than the count', () => {
  const { handler, grid } = withExclusionPairs();
  grid[0] = valueMask(2);
  grid[1] = grid[2] = valueMask(1, 2);
  grid[3] = grid[4] = valueMask(2, 3);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('saturated group propagation does not retain branch candidates', () => {
  const { handler, grid } = withExclusionPairs();
  grid[0] = valueMask(2);
  for (const mask of [valueMask(1, 2), valueMask(3, 4)]) {
    const branch = grid.slice();
    branch[1] = branch[2] = mask;
    assert(handler.enforceConsistency(branch, createAccumulator()));
    for (let c = 1; c <= 5; c++) assert.equal(branch[c], mask);
  }
});

await runTest('initialization discovers overlapping groups from pairwise exclusions', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const handler = new CountDistinct(0, [1, 2, 3, 4, 5]);
  const exclusions = noExclusions(16);
  for (const group of [[1, 2, 3], [3, 4, 5]]) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      exclusions.addMutualExclusion(group[i], group[j]);
    }
  }
  assert(context.initializeHandler(handler, { cellExclusions: exclusions }));
  const grid = context.grid;
  grid[0] = valueMask(3);
  grid[1] = grid[2] = valueMask(1, 2, 3, 4);
  grid[3] = grid[4] = grid[5] = valueMask(2, 3);
  // The disjoint partition picks {1,2,3} and {4,5}, neither of which fails.
  // The overlapping triple {3,4,5} needs three different values but has two.
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('exclusion propagation preserves exhaustive assignment supports', () => {
  // Enumerate assignments independently of the propagator, with arbitrary
  // exclusion graphs, both value offsets, and sometimes a counted control.
  let seed = 29389;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  let supportedStates = 0;
  for (const offset of [0, -1]) for (let trial = 0; trial < 300; trial++) {
    const geometry = CellGeometry.fromGridSize(4, 4, 4, offset);
    const context = new GridTestContext({ geometry });
    const control = trial % 3 === 0 ? 3 : 4;
    const handler = new CountDistinct(control, [0, 1, 2, 3]);
    const exclusions = noExclusions(16);
    const edges = [];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      if (random(3) !== 0) continue;
      edges.push([a, b]);
      exclusions.addMutualExclusion(a, b);
    }
    const initialized = context.initializeHandler(handler, { cellExclusions: exclusions });
    const grid = context.grid;
    for (let c = 0; c < 5; c++) grid[c] &= 1 + random(15);
    const supports = new Uint16Array(5);
    const values = [];
    let solutions = 0;
    const enumerate = i => {
      if (i === 4) {
        const count = new Set(values).size;
        if (count > 4 + offset || !(grid[control] & (1 << (count - offset - 1)))) return;
        if (control < 4 && values[control] !== count) return;
        solutions++;
        for (let c = 0; c < 4; c++) supports[c] |= 1 << (values[c] - offset - 1);
        supports[control] |= 1 << (count - offset - 1);
        return;
      }
      for (let value = 1 + offset; value <= 4 + offset; value++) {
        if (!(grid[i] & (1 << (value - offset - 1)))) continue;
        if (edges.some(([a, b]) => b === i && values[a] === value)) continue;
        values[i] = value;
        enumerate(i + 1);
      }
    };
    enumerate(0);
    const valid = initialized && handler.enforceConsistency(grid, createAccumulator());
    if (!solutions) continue;
    supportedStates++;
    assert(valid, 'must not reject a satisfying assignment');
    for (let c = 0; c < 5; c++) assert.equal(supports[c] & ~grid[c], 0);
  }
  assert(supportedStates > 50, 'exercise satisfiable states as well as conflicts');
});

logSuiteComplete('count_distinct.test.js');
