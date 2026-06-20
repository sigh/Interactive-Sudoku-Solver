import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createCellExclusions,
  createAccumulator,
  valueMask,
  applyCandidates,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Sum } = await import('../../js/solver/sum_handler.js');
const { GridShape } = await import('../../js/grid_shape.js');

const uniqueCells = () => createCellExclusions({ allUnique: true });
const nonUniqueCells = () => createCellExclusions({ allUnique: false });

const initializeSum = (options = {}) => {
  const {
    numCells,
    sum,
    coeffs,
    context,
    cellExclusions = uniqueCells(),
    valueOffset,
  } = options;

  const resolvedContext = context ?? new GridTestContext(
    valueOffset != null ? { shape: GridShape.fromGridSize(9, 9, null, valueOffset) } : undefined);

  const cells = resolvedContext.cells(numCells);
  const handler = new Sum(cells, sum, coeffs);
  assert.equal(
    resolvedContext.initializeHandler(handler, { cellExclusions }),
    true,
    'constraint handler should initialize'
  );
  return { handler, context: resolvedContext };
};

await runTest('Sum priority can be computed before initialization', () => {
  const shape = GridShape.fromGridSize(4);
  const handler = new Sum([0, 1, 2], 6);

  assert.equal(handler.priority(shape), 5);
});

await runTest('Sum should force a unique combination once candidates align', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 14 });
  const grid = applyCandidates(context.grid, {
    0: [1, 2],
    1: [2, 3],
    2: [3, 4],
    3: [4, 5],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(3));
  assert.equal(grid[2], valueMask(4));
  assert.equal(grid[3], valueMask(5));
});

await runTest('Sum should reject impossible cages', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 30 });
  const grid = applyCandidates(context.grid, {
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
  const grid = applyCandidates(context.grid, {
    0: [3, 4],
    1: [1, 2],
    2: [2],
    3: [3],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should solve the linear equation');
  assert.equal(grid[0], valueMask(4), 'first cell forced by coefficient scaling');
  assert.equal(grid[1], valueMask(1), 'second cell forced by negative coefficient');
  assert.equal(grid[2], valueMask(2), 'fixed term should remain consistent');
  assert.equal(grid[3], valueMask(3), 'final cell resolved by remaining balance');
});

await runTest('Sum should resolve cages with more than three unfixed cells', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 22 });
  const grid = applyCandidates(context.grid, {
    0: [1, 8],
    1: [2, 7],
    2: [3, 6],
    3: [4, 5],
  });

  const accumulator = createAccumulator();
  const result = handler.enforceConsistency(grid, accumulator);

  assert.equal(result, true, 'handler should keep solvable cages valid');
  assert.equal(grid[0], valueMask(8));
  assert.equal(grid[1], valueMask(7));
  assert.equal(grid[2], valueMask(3));
  assert.equal(grid[3], valueMask(4));
});

await runTest('Sum should handle cages longer than fifteen cells', () => {
  const longContext = new GridTestContext({ gridSize: [2, 16] });
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
  const grid = applyCandidates(context.grid, assignments);

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should solve long cages');
  assert.equal(grid[12], valueMask(13));
  assert.equal(grid[13], valueMask(14));
  assert.equal(grid[14], valueMask(15));
});

await runTest('Sum should split a 16-cell exclusion group correctly', () => {
  // 16 mutually-exclusive cells form a single exclusion group of size 16,
  // which must be split (MAX_GROUP_SIZE = 15). This exercises the path where
  // the last exclusion group is too large and must be spliced.
  const longContext = new GridTestContext({ gridSize: [2, 16] });
  const numCells = longContext.shape.numGridCells;
  const { handler, context } = initializeSum({
    numCells: 16,
    sum: 136,
    context: longContext,
    cellExclusions: createCellExclusions({ allUnique: true, numCells }),
  });
  const assignments = {};
  for (let i = 0; i < 12; i++) {
    assignments[i] = [i + 1];
  }
  assignments[12] = [13, 14];
  assignments[13] = [14, 15];
  assignments[14] = [15, 16];
  assignments[15] = [16];
  const grid = applyCandidates(context.grid, assignments);

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should solve with split exclusion group');
  assert.equal(grid[12], valueMask(13));
  assert.equal(grid[13], valueMask(14));
  assert.equal(grid[14], valueMask(15));
});

await runTest('Sum should split more than 16 singleton exclusion groups', () => {
  const longContext = new GridTestContext({ gridSize: [2, 16] });
  const numCells = longContext.shape.numGridCells;
  const { handler, context } = initializeSum({
    numCells: 17,
    sum: 17,
    context: longContext,
    cellExclusions: createCellExclusions({ allUnique: false, numCells }),
  });

  assert.ok(handler._coeffGroups.every(g => g.cells.length <= 15));
  assert.ok(handler._coeffGroups.every(g => g.exclusionGroups.length <= 15));

  const assignments = {};
  for (const cell of context.cells(17)) assignments[cell] = [1];
  const grid = applyCandidates(context.grid, assignments);

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'handler should solve after splitting singleton groups');
});

await runTest('Sum should restrict values based on complement cells', () => {
  const context = new GridTestContext();
  const complementCells = context.cells(10).slice(2);
  const { handler } = initializeSum({ numCells: 2, sum: 10, context });
  handler.setComplementCells(complementCells, context.lookupTables.allValues);

  const assignments = {
    0: [1, 2, 8, 9],
    1: [1, 2, 8, 9],
  };
  for (const complementCell of complementCells) {
    assignments[complementCell] = [1, 2, 3, 4, 5, 6, 7, 8];
  }
  const grid = applyCandidates(context.grid, assignments);

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should remain consistent with complement data');
  assert.equal(grid[0], valueMask(1, 9), 'only digits paired with complement availability should remain');
  assert.equal(grid[1], valueMask(1, 9));
});

await runTest('Sum complement cells with restricted valueMask', () => {
  // Simulate a PerfectAllDifferent with valueMask={1,2,3,4} containing a
  // 2-cell Sum with sum=3. Complement cells get the remaining 2 cells.
  // The complement values are {1,2,3,4} minus the sum's values.
  const context = new GridTestContext({ gridSize: 4 });
  const allCells = context.cells(4);
  const restrictedValueMask = valueMask(1, 2, 3, 4);

  // Sum cells: cells 0,1 with sum=3. Complement cells: cells 2,3.
  const { handler } = initializeSum({ numCells: 2, sum: 3, context });
  handler.setComplementCells(allCells.slice(2), restrictedValueMask);

  const grid = applyCandidates(context.grid, {
    0: [1, 2, 3],
    1: [1, 2, 3],
    2: [1, 2, 3, 4],
    3: [1, 2, 3, 4],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());

  assert.equal(result, true, 'handler should remain consistent');
  // sum=3 with 2 cells from {1,2,3,4}: only option is {1,2}.
  assert.equal(grid[0], valueMask(1, 2), 'set0 restricted to {1,2}');
  assert.equal(grid[1], valueMask(1, 2), 'set0 restricted to {1,2}');
  // Complement within {1,2,3,4} is {3,4}.
  assert.equal(grid[2], valueMask(3, 4), 'set1 restricted to {3,4}');
  assert.equal(grid[3], valueMask(3, 4), 'set1 restricted to {3,4}');
});

await runTest('Sum should prohibit repeated digits when cells are mutually exclusive', () => {
  const { handler, context } = initializeSum({
    numCells: 4,
    sum: 15,
    cellExclusions: uniqueCells(),
  });
  const grid = applyCandidates(context.grid, {
    0: [1, 2, 3],
    1: [1, 2, 3],
    2: [5],
    3: [6],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'handler should remain consistent under uniqueness constraints');
  assert.equal(grid[0], valueMask(1, 3));
  assert.equal(grid[1], valueMask(1, 3));
  assert.equal(grid[2], valueMask(5));
  assert.equal(grid[3], valueMask(6));
});

await runTest('Sum should allow repeated digits when cells are non-exclusive', () => {
  const { handler, context } = initializeSum({
    numCells: 4,
    sum: 15,
    cellExclusions: nonUniqueCells(),
  });
  const grid = applyCandidates(context.grid, {
    0: [1, 2, 3],
    1: [1, 2, 3],
    2: [5],
    3: [6],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'non-exclusive cages can reuse digits');
  assert.equal(grid[0], valueMask(1, 2, 3));
  assert.equal(grid[1], valueMask(1, 2, 3));
  assert.equal(grid[2], valueMask(5));
  assert.equal(grid[3], valueMask(6));
});

await runTest('Sum should reject cages with sums above the maximum', () => {
  const context = new GridTestContext();
  const handler = new Sum(context.cells(4), 100);
  const initialized = context.initializeHandler(handler, { cellExclusions: uniqueCells() });
  assert.equal(initialized, false, 'handler should refuse impossible cage sums');
});

await runTest('Sum should reject non-integer totals during initialization', () => {
  const context = new GridTestContext();
  const handler = new Sum(context.cells(4), 4.5);
  const initialized = context.initializeHandler(handler, { cellExclusions: uniqueCells() });
  assert.equal(initialized, false, 'handler should require integer sums');
});

await runTest('Sum should detect impossible bounds when minimum exceeds the target', () => {
  const { handler, context } = initializeSum({ numCells: 4, sum: 5 });
  const grid = applyCandidates(context.grid, {
    0: [8, 9],
    1: [7, 9],
    2: [7, 8],
    3: [6, 9],
  });

  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, false, 'handler should fail when even the min sum is too large');
});

// =============================================================================
// valueOffset
// =============================================================================

await runTest('Sum initialize adjusts internal sum by valueOffset', () => {
  // External sum=6 with offset=-1 means external values 0,1,2,...,8.
  // Internal values are 1-9. Adjustment: sum -= offset * numCells = 6 - (-1)*3 = 9.
  const { handler, context } = initializeSum({ numCells: 3, sum: 6, valueOffset: -1 });

  // idStr should use the original (external) sum for deduplication.
  assert.ok(handler.idStr.includes('|6|'), 'idStr should use external sum');

  // The adjusted internal sum is 9, which is 1+2+6, 1+3+5, or 2+3+4.
  // If we set cells to [2,3,4] (internal), the handler should accept.
  const grid = applyCandidates(context.grid, {
    0: [2], 1: [3], 2: [4],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'adjusted sum should accept valid internal values');
});

await runTest('Sum constructor with no offset does not adjust sum', () => {
  const { handler, context } = initializeSum({ numCells: 3, sum: 9 });

  // Internal sum should remain 9.
  const grid = applyCandidates(context.grid, {
    0: [2], 1: [3], 2: [4],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true);
});

await runTest('Sum.makeEqual adjusts for valueOffset', () => {
  const context = new GridTestContext({ shape: GridShape.fromGridSize(1, 6, null, -1) });
  // makeEqual with offset=-1: cells0=[0,1], cells1=[2].
  // sum=0, coeffs=[1,1,-1]. coeffSum = 1*2 + (-1)*1 = 1.
  // adjustment in initialize: sum -= (-1)*1 = 1. Internal sum becomes 1.
  // So cells0 sum - cells1 value = 1 internally,
  // meaning external sums are equal (each shifted by offset).
  const handler = Sum.makeEqual([0, 1], [2]);
  context.initializeHandler(handler, { cellExclusions: createCellExclusions({ allUnique: false }) });

  const grid = applyCandidates(context.grid, {
    // Internal: 2+4=6, and cell2=6. The internal equation is 2+4-6=0,
    // but we need internal sum=1. Try: 2+5=7, cell2=6 → 7-6=1. ✓
    0: [2], 1: [5], 2: [6],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'makeEqual with offset should enforce equal external sums');
});

// =============================================================================
// makeEqual with same/overlapping cells
// =============================================================================

await runTest('Sum.makeEqual with same array reference produces trivially true handler', () => {
  const context = new GridTestContext();
  const cells = [0, 1, 2];
  const handler = Sum.makeEqual(cells, cells);

  assert.equal(handler.cells.length, 0, 'handler should have no cells after cancellation');
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [3], 1: [5], 2: [9],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'identical sets are always equal');
});

await runTest('Sum.makeEqual with identical contents (different arrays) produces trivially true handler', () => {
  const context = new GridTestContext();
  const handler = Sum.makeEqual([0, 1, 2], [0, 1, 2]);

  assert.equal(handler.cells.length, 0, 'handler should have no cells after cancellation');
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [1], 1: [2], 2: [7],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true, 'identical cell sets are always equal');
});

await runTest('Sum.makeEqual with partially overlapping cells constrains only non-overlapping cells', () => {
  const context = new GridTestContext();
  // cells0=[0,1,2], cells1=[1,2,3]
  // After cancellation: cell 0 coeff +1, cell 3 coeff -1. (cells 1,2 cancel)
  // Constraint: value(0) = value(3).
  const handler = Sum.makeEqual([0, 1, 2], [1, 2, 3]);

  assert.equal(handler.cells.length, 2, 'only non-overlapping cells should remain');
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [3, 5],
    1: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    3: [5, 7],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(5), 'cell 0 should be restricted to match cell 3');
  assert.equal(grid[3], valueMask(5), 'cell 3 should be restricted to match cell 0');
});

await runTest('Sum.makeEqual with single overlapping cell cancels it', () => {
  const context = new GridTestContext();
  // cells0=[0,1], cells1=[1,2]. Cell 1 cancels out.
  // Constraint: value(0) = value(2).
  const handler = Sum.makeEqual([0, 1], [1, 2]);

  assert.equal(handler.cells.length, 2, 'overlapping cell should be removed');
  context.initializeHandler(handler, { cellExclusions: nonUniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [4],
    1: [7],
    2: [3, 4, 6],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true);
  assert.equal(grid[2], valueMask(4), 'cell 2 should equal cell 0');
});

await runTest('Sum constructor filters explicitly passed zero coefficients', () => {
  const context = new GridTestContext();
  // Cell 1 has coeff 0, so it should be removed.
  const handler = new Sum([0, 1, 2], 7, [1, 0, 1]);

  assert.equal(handler.cells.length, 2, 'zero-coeff cell should be removed');
  context.initializeHandler(handler, { cellExclusions: uniqueCells() });

  const grid = applyCandidates(context.grid, {
    0: [3],
    1: [9],
    2: [1, 4, 5],
  });
  const result = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(result, true);
  assert.equal(grid[2], valueMask(4), 'cell 2 should be 4 to sum to 7 with cell 0');
});

await runTest('Sum with 0 cells and sum=0 initializes successfully', () => {
  const context = new GridTestContext();
  const handler = new Sum([], 0);
  assert.equal(handler.cells.length, 0);

  const initialized = context.initializeHandler(handler, { cellExclusions: uniqueCells() });
  assert.equal(initialized, true, '0-cell sum with sum=0 is trivially satisfiable');

  const result = handler.enforceConsistency(context.grid, createAccumulator());
  assert.equal(result, true);
});

await runTest('Sum with 0 cells and nonzero sum fails initialization', () => {
  const context = new GridTestContext();
  const handler = new Sum([], 5);
  assert.equal(handler.cells.length, 0);

  const initialized = context.initializeHandler(handler, { cellExclusions: uniqueCells() });
  assert.equal(initialized, false, '0-cell sum with nonzero sum is impossible');
});

// =============================================================================
// Extended cells: a cell index spans grid + var cells and can exceed 255. The
// handler must propagate identically regardless of where its cells sit, and its
// within-handler position map (0..numCells-1, which exceeds 255 for a Sum over
// > 255 cells) must not wrap.
// =============================================================================

// Narrow a 3-cell distinct cage summing to 24 whose cells start at `base`.
// 7+8+9 is the only distinct triple, so each cell must end up as {7,8,9}.
const narrowCageAt = (base) => {
  const numCells = base + 3;
  const cells = [base, base + 1, base + 2];
  const handler = new Sum(cells, 24);
  const shape = GridShape.fromGridSize(9);
  const allValues = valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9);
  const grid = new Array(numCells).fill(allValues);
  const noopState = { allocate: () => 0 };
  assert.equal(
    handler.initialize(
      grid, createCellExclusions({ allUnique: true, numCells }), shape, noopState),
    true, 'Sum should initialize');
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  return cells.map(c => grid[c]);
};

await runTest('Sum cage propagates identically for cells at low and high (> 255) indices', () => {
  const expected = [valueMask(7, 8, 9), valueMask(7, 8, 9), valueMask(7, 8, 9)];
  assert.deepEqual(narrowCageAt(0), expected, 'low-index cage');
  // A Uint8 cell store would truncate 256/257/258 and touch the wrong cells,
  // leaving these high cells unchanged.
  assert.deepEqual(narrowCageAt(256), expected, 'high-index cage');
});

await runTest('Sum over > 255 cells maps every cell to its exclusion group', () => {
  // The position map assigns each cell its within-handler index (0..259). Under
  // a Uint8 map, indices >= 256 wrap and those cells never receive a group id.
  const numCells = 260;
  const cells = Array.from({ length: numCells }, (_, i) => i);
  const handler = new Sum(cells, 260);   // min possible sum: forces every cell to 1.

  const shape = GridShape.fromGridSize(9);
  const grid = new Array(numCells).fill(valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9));
  const noopState = { allocate: () => 0 };
  assert.equal(
    handler.initialize(
      grid, createCellExclusions({ allUnique: false, numCells }), shape, noopState),
    true, 'Sum should initialize');

  // Every cell belongs to a unit-coeff group, so every within-handler position
  // must hold a non-zero group id; a wrapped position map leaves the tail at 0.
  assert.equal(handler._exclusionGroupIds.length, numCells);
  assert.ok(
    handler._exclusionGroupIds.every(id => id !== 0),
    'every within-handler position must be assigned a group id');

  // And it must still propagate correctly end-to-end: sum 260 over 260 cells
  // (each >= 1) forces every cell to 1, including the high-position tail.
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.ok(
    cells.every(c => grid[c] === valueMask(1)),
    'every cell must be forced to value 1');
});

logSuiteComplete('Sum handler');
