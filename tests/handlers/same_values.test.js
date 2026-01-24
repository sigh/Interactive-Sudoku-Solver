import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  setupConstraintTest,
  createCellExclusions,
  createAccumulator,
  valueMask,
  applyCandidates,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { SameValues, InvalidConstraintError } = await import('../../js/solver/handlers.js');

const sameValuesExclusions = (allUnique) => {
  const base = createCellExclusions({ allUnique });
  return {
    ...base,
    areMutuallyExclusive(set) {
      if (!allUnique) return false;
      return set.length > 1;
    },
  };
};

const uniqueCells = () => sameValuesExclusions(true);
const nonUniqueCells = () => sameValuesExclusions(false);

await runTest('SameValues should reject uneven set sizes', () => {
  assert.throws(
    () => new SameValues([0, 1], [2]),
    InvalidConstraintError,
    'constructor should reject sets with different lengths'
  );
});

await runTest('SameValues should normalize set ordering in idStr', () => {
  const handler = new SameValues([2, 0], [3, 1]);

  assert.ok(handler.idStr.includes('0,2'));
  assert.ok(handler.idStr.includes('1,3'));
});

await runTest('SameValues should enforce shared value intersection', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1, 2],
    1: [2, 3],
    2: [2, 3],
    3: [2, 4],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(2, 3));
  assert.equal(grid[2], valueMask(2, 3));
  assert.equal(grid[3], valueMask(2));
  assert.ok(acc.touched.has(0));
  assert.ok(acc.touched.has(3));
});

await runTest('SameValues should be idempotent when no changes are needed', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [2, 3],
    1: [2, 3],
    2: [2, 3],
    3: [2, 3],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2, 3));
  assert.equal(grid[1], valueMask(2, 3));
  assert.equal(grid[2], valueMask(2, 3));
  assert.equal(grid[3], valueMask(2, 3));
  assert.equal(acc.touched.size, 0);
});

await runTest('SameValues should fail when intersection is too small', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1, 2],
    1: [2, 3],
    2: [1, 4],
    3: [4],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, false);
});

await runTest('SameValues should fail when maxRequired exceeds minCount', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1],
    1: [1],
    2: [1, 2],
    3: [2],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, false);
});

await runTest('SameValues should prune non-fixed values when counts exceed required', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1],
    1: [2],
    2: [1],
    3: [1, 2],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[3], valueMask(2));
  assert.ok(acc.touched.has(3));
});

await runTest('SameValues should fix values when count matches required limit', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1],
    1: [2],
    2: [1, 2],
    3: [2],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[2], valueMask(1));
  assert.ok(acc.touched.has(2));
});

await runTest('SameValues should fail when minTotals cannot fill the set', () => {
  const context = setupConstraintTest({ gridSize: [1, 9], numValues: 9 });
  const handler = new SameValues([0, 1, 2], [3, 4, 5], [6, 7, 8]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1],
    1: [2],
    2: [2],
    3: [1],
    4: [1],
    5: [2],
    6: [1, 2],
    7: [1, 2],
    8: [1, 2],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, false);
});

await runTest('SameValues should enforce intersection across three sets', () => {
  const context = setupConstraintTest({ gridSize: [1, 6], numValues: 6 });
  const handler = new SameValues([0, 1], [2, 3], [4, 5]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1, 2, 3],
    1: [2, 3],
    2: [2, 3, 4],
    3: [2, 4],
    4: [2, 5, 6],
    5: [2, 6],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  for (let i = 0; i < 6; i++) {
    assert.equal(grid[i], valueMask(2));
  }
  assert.equal(acc.touched.size, 6);
});

await runTest('SameValues should fail when intersection is smaller than max exclusion size for unique cells', () => {
  const context = setupConstraintTest({ gridSize: [1, 6], numValues: 6 });
  const handler = new SameValues([0, 1, 2], [3, 4, 5]);
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [4, 5],
    1: [5],
    2: [3, 5],
    3: [5, 6],
    4: [5, 6],
    5: [5],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('SameValues should allow intersection size equal to max exclusion size for unique cells', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [2, 3],
    1: [2, 3],
    2: [2, 3],
    3: [2, 3],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  for (let i = 0; i < 4; i++) {
    assert.equal(grid[i], valueMask(2, 3));
  }
  assert.equal(acc.touched.size, 0);
});

await runTest('SameValues should force values when counts are required', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1],
    1: [2, 3],
    2: [1, 2],
    3: [2, 4],
  });
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[2], valueMask(1));
  assert.equal(grid[3], valueMask(2));
  assert.ok(acc.touched.has(2));
  assert.ok(acc.touched.has(3));
});

await runTest('SameValues should short-circuit after all values are fixed', () => {
  const context = setupConstraintTest({ gridSize: [1, 9], numValues: 9 });
  const handler = new SameValues([0, 1, 2], [3, 4, 5], [6, 7, 8]);

  const state = {
    allocate(values) {
      const offset = context.grid.length;
      context.grid.push(...values);
      return offset;
    }
  };

  context.initializeHandler(handler, { cellExclusions: uniqueCells(), state });

  const grid = applyCandidates(context.grid, {
    0: [1, 2, 3],
    1: [1, 2, 3],
    2: [1, 2, 3],
    3: [1, 2, 3],
    4: [1, 2, 3],
    5: [1, 2, 3],
    6: [1, 2, 3],
    7: [1, 2, 3],
    8: [1, 2, 3],
  });

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[context.shape.numCells], 1, 'state offset should be set once values fixed');

  const secondAcc = createAccumulator();
  const secondResult = handler.enforceConsistency(grid, secondAcc);
  assert.equal(secondResult, true);
  assert.equal(secondAcc.touched.size, 0);
});

await runTest('SameValues should be reusable across multiple calls', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  let grid = applyCandidates(context.grid, {
    0: [1, 2],
    1: [2, 3],
    2: [2, 3],
    3: [2, 4],
  });
  let acc = createAccumulator();
  let result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[3], valueMask(2));

  grid = applyCandidates(context.createGrid(), {
    0: [1, 2],
    1: [1, 2],
    2: [2, 3],
    3: [2, 3],
  });
  acc = createAccumulator();
  result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(2));
  assert.equal(grid[2], valueMask(2));
  assert.equal(grid[3], valueMask(2));
});

await runTest('SameValues should fail when required counts are impossible', () => {
  const context = setupConstraintTest({ gridSize: [1, 4], numValues: 4 });
  const handler = new SameValues([0, 1], [2, 3]);
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1],
    1: [1],
    2: [1],
    3: [2],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, false);
});

logSuiteComplete('SameValues handler');
