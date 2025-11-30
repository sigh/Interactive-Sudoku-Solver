import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';
import {
  setupConstraintTest,
  createCellExclusions,
  createAccumulator,
  mask,
  applyCandidates,
  initializeConstraintHandler,
} from './helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { Sum } = await import('../js/solver/sum_handler.js');

const defaultContext = setupConstraintTest();
const uniqueCells = () => createCellExclusions({ allUnique: true });
const nonUniqueCells = () => createCellExclusions({ allUnique: false });

const initializeSum = (options = {}) => {
  const {
    numCells,
    sum,
    coeffs,
    context = defaultContext,
    cellExclusions = uniqueCells(),
  } = options;

  const cells = Array.from({ length: numCells }, (_, i) => i);
  return initializeConstraintHandler(Sum, {
    args: [cells, sum, coeffs],
    context,
    cellExclusions,
  });
};

await runTest('Sum should force a unique combination once candidates align', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 14 });
  const grid = applyCandidates(context.createGrid(), {
    0: [1, 2],
    1: [2, 3],
    2: [3, 4],
    3: [4, 5],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true);
  assert.equal(grid[0], mask(2));
  assert.equal(grid[1], mask(3));
  assert.equal(grid[2], mask(4));
  assert.equal(grid[3], mask(5));
});

await runTest('Sum should reject impossible cages', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 30 });
  const grid = applyCandidates(context.createGrid(), {
    0: [1, 2],
    1: [2, 3],
    2: [3, 4],
    3: [4, 5],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, false, 'handler should detect unsatisfiable sums');
});

await runTest('Sum should solve mixed coefficient cages with negative terms', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 12, coeffs: [2, -1, 1, 1] });
  const grid = applyCandidates(context.createGrid(), {
    0: [3, 4],
    1: [1, 2],
    2: [2],
    3: [3],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should solve the linear equation');
  assert.equal(grid[0], mask(4), 'first cell forced by coefficient scaling');
  assert.equal(grid[1], mask(1), 'second cell forced by negative coefficient');
  assert.equal(grid[2], mask(2), 'fixed term should remain consistent');
  assert.equal(grid[3], mask(3), 'final cell resolved by remaining balance');
});

await runTest('Sum should resolve cages with more than three unfixed cells', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 22 });
  const grid = applyCandidates(context.createGrid(), {
    0: [1, 8],
    1: [2, 7],
    2: [3, 6],
    3: [4, 5],
  });

  const accumulator = createAccumulator();
  const result = handler.enforceConsistency(grid, accumulator);

  assert.equal(result, true, 'handler should keep solvable cages valid');
  assert.equal(grid[0], mask(8));
  assert.equal(grid[1], mask(7));
  assert.equal(grid[2], mask(3));
  assert.equal(grid[3], mask(4));
});

await runTest('Sum should handle cages longer than fifteen cells', () => {
  const longContext = setupConstraintTest({ numValues: 16, numCells: 32 });
  const { handler, context } = initializeSum({
    numCells: 16,
    sum: 136,
    context: longContext,
    cellExclusions: nonUniqueCells(),
  });
  const assignments = {};
  for (let i = 0; i < 12; i++) {
    assignments[i] = [i + 1];
  }
  assignments[12] = [13, 14];
  assignments[13] = [14, 15];
  assignments[14] = [15, 16];
  assignments[15] = [16];
  const grid = applyCandidates(context.createGrid(), assignments);

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should solve long cages');
  assert.equal(grid[12], mask(13));
  assert.equal(grid[13], mask(14));
  assert.equal(grid[14], mask(15));
});

await runTest('Sum should restrict values based on complement cells', () => {
  const complementCells = [2, 3, 4, 5, 6, 7, 8, 9];
  const { handler, context } = initializeSum({ numCells: 2, sum: 10 });
  handler.setComplementCells(complementCells);

  const assignments = {
    0: [1, 2, 8, 9],
    1: [1, 2, 8, 9],
  };
  for (const complementCell of complementCells) {
    assignments[complementCell] = [1, 2, 3, 4, 5, 6, 7, 8];
  }
  const grid = applyCandidates(context.createGrid(), assignments);

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should remain consistent with complement data');
  assert.equal(grid[0], mask(1, 9), 'only digits paired with complement availability should remain');
  assert.equal(grid[1], mask(1, 9));
});

await runTest('Sum should prohibit repeated digits when cells are mutually exclusive', () => {
  const { handler, context } = initializeSum({
    numCells: 4,
    sum: 15,
    cellExclusions: uniqueCells(),
  });
  const grid = applyCandidates(context.createGrid(), {
    0: [1, 2, 3],
    1: [1, 2, 3],
    2: [5],
    3: [6],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'handler should remain consistent under uniqueness constraints');
  assert.equal(grid[0], mask(1, 3));
  assert.equal(grid[1], mask(1, 3));
  assert.equal(grid[2], mask(5));
  assert.equal(grid[3], mask(6));
});

await runTest('Sum should allow repeated digits when cells are non-exclusive', () => {
  const { handler, context } = initializeSum({
    numCells: 4,
    sum: 15,
    cellExclusions: nonUniqueCells(),
  });
  const grid = applyCandidates(context.createGrid(), {
    0: [1, 2, 3],
    1: [1, 2, 3],
    2: [5],
    3: [6],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'non-exclusive cages can reuse digits');
  assert.equal(grid[0], mask(1, 2, 3));
  assert.equal(grid[1], mask(1, 2, 3));
  assert.equal(grid[2], mask(5));
  assert.equal(grid[3], mask(6));
});

await runTest('Sum should reject cages with sums above the maximum', () => {
  const handler = new Sum([0, 1, 2, 3], 100);
  const initialized = handler.initialize(
    defaultContext.createGrid(),
    uniqueCells(),
    defaultContext.shape,
    {},
  );
  assert.equal(initialized, false, 'handler should refuse impossible cage sums');
});

await runTest('Sum should reject non-integer totals during initialization', () => {
  const handler = new Sum([0, 1, 2, 3], 4.5);
  const initialized = handler.initialize(
    defaultContext.createGrid(),
    uniqueCells(),
    defaultContext.shape,
    {},
  );
  assert.equal(initialized, false, 'handler should require integer sums');
});

await runTest('Sum should detect impossible bounds when minimum exceeds the target', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 5 });
  const grid = applyCandidates(context.createGrid(), {
    0: [8, 9],
    1: [7, 9],
    2: [7, 8],
    3: [6, 9],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, false, 'handler should fail when even the min sum is too large');
});

logSuiteComplete('Sum handler');
