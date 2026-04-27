import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';
import { createCellExclusions } from '../../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../../js/solver/lookup_tables.js' + self.VERSION_PARAM);

const createTaxicabHandler = (cell, numValues) => {
  const valueMap = Array.from({ length: numValues }, () => []);
  return new HandlerModule.ValueDependentUniqueValueExclusion(cell, valueMap);
};

const createExclusions = (numCells) => createCellExclusions({ allUnique: false, numCells });

await runTest('_optimizeTaxicab: creates region handler for House', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const houseCells = Array.from({ length: 9 }, (_, i) => i);
  const houseHandler = new HandlerModule.House(houseCells);
  const taxicabHandler = createTaxicabHandler(0, shape.numValues);

  const handlerSet = new HandlerSet(
    [houseHandler, taxicabHandler], numCells);

  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandlers = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent);
  assert.equal(regionHandlers.length, 1);
  assert.deepEqual([...regionHandlers[0].cells], houseCells);
});

await runTest('_optimizeTaxicab: no-op when no taxicab handlers are present', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const houseCells = Array.from({ length: 9 }, (_, i) => i);
  const houseHandler = new HandlerModule.House(houseCells);
  const padHandler = new HandlerModule.PerfectAllDifferent([9, 10, 11, 12], 0b1111);

  const handlerSet = new HandlerSet(
    [houseHandler, padHandler], numCells);

  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandlers = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent);
  assert.equal(regionHandlers.length, 0);
});

await runTest('_optimizeTaxicab: ignores plain AllDifferent handlers', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  // _optimizeTaxicab should only target House + PerfectAllDifferent.
  const allDifferent = new HandlerModule.AllDifferent([0, 1, 2, 3]);
  const taxicabHandler = createTaxicabHandler(0, shape.numValues);

  const handlerSet = new HandlerSet(
    [allDifferent, taxicabHandler], numCells);

  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandlers = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent);
  assert.equal(regionHandlers.length, 0);
});

await runTest('_optimizeTaxicab: creates region handler for PerfectAllDifferent', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const padCells = [0, 1, 2, 3];
  const valueMask = 0b1111;
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, valueMask);
  const taxicabHandler = createTaxicabHandler(0, shape.numValues);

  const handlerSet = new HandlerSet(
    [padHandler, taxicabHandler], numCells);

  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandlers = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent);
  assert.equal(regionHandlers.length, 1);
  assert.deepEqual([...regionHandlers[0].cells], padCells);
});

await runTest('_optimizeTaxicab: creates region handlers for mixed House and PerfectAllDifferent', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const houseCells = Array.from({ length: 9 }, (_, i) => i);
  const houseHandler = new HandlerModule.House(houseCells);

  const padCells = [9, 10, 11, 12];
  const valueMask = 0b1111;
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, valueMask);

  const taxicabHandler = createTaxicabHandler(0, shape.numValues);

  const handlerSet = new HandlerSet(
    [houseHandler, padHandler, taxicabHandler], numCells);

  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandlers = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent);
  assert.equal(regionHandlers.length, 2);

  const actual = regionHandlers
    .map(h => [...h.cells].sort((a, b) => a - b).join(','))
    .sort();
  const expected = [houseCells, padCells]
    .map(cells => [...cells].sort((a, b) => a - b).join(','))
    .sort();
  assert.deepEqual(actual, expected);
});

await runTest('_optimizeTaxicab: PerfectAllDifferent region handler propagates removals', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const padCells = [0, 1, 2, 3];
  const valueMask = 0b1111;
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, valueMask);

  // For value 1, make both cells 0 and 1 exclude cell 20.
  const valueMap0 = Array.from({ length: shape.numValues }, () => []);
  valueMap0[0] = [20];
  const valueMap1 = Array.from({ length: shape.numValues }, () => []);
  valueMap1[0] = [20];

  const taxicab0 = new HandlerModule.ValueDependentUniqueValueExclusion(0, valueMap0);
  const taxicab1 = new HandlerModule.ValueDependentUniqueValueExclusion(1, valueMap1);

  const handlerSet = new HandlerSet(
    [padHandler, taxicab0, taxicab1], numCells);

  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandlers = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent);
  assert.equal(regionHandlers.length, 1);

  const allValues = LookupTables.allValues(shape.numValues);
  const v1 = 1 << 0;
  const v2 = 1 << 1;
  const v3 = 1 << 2;
  const v4 = 1 << 3;
  const grid = new Uint16Array(numCells);
  grid.fill(allValues);

  // Ensure value 1 appears in exactly two cells in the PAD region (0 and 1).
  grid[0] = v1 | v2;
  grid[1] = v1 | v3;
  grid[2] = v2 | v3;
  grid[3] = v2 | v3;
  // Target cell where value 1 should be removed.
  grid[20] = v1 | v4;

  const acc = { addForCell() { } };
  const ok = regionHandlers[0].enforceConsistency(grid, acc);

  assert.equal(ok, true);
  assert.equal(grid[20], v4);
});

await runTest('_optimizeTaxicab: propagation works for non-1 values', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const padCells = [0, 1, 2, 3];
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, 0b1111);

  // For value 3 (index 2), make both cells 0 and 1 exclude cell 21.
  const valueMap0 = Array.from({ length: shape.numValues }, () => []);
  valueMap0[2] = [21];
  const valueMap1 = Array.from({ length: shape.numValues }, () => []);
  valueMap1[2] = [21];
  const taxicab0 = new HandlerModule.ValueDependentUniqueValueExclusion(0, valueMap0);
  const taxicab1 = new HandlerModule.ValueDependentUniqueValueExclusion(1, valueMap1);

  const handlerSet = new HandlerSet(
    [padHandler, taxicab0, taxicab1], numCells);
  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandler = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent)[0];
  assert.ok(regionHandler);

  const allValues = LookupTables.allValues(shape.numValues);
  const v1 = 1 << 0;
  const v2 = 1 << 1;
  const v3 = 1 << 2;
  const v4 = 1 << 3;
  const grid = new Uint16Array(numCells);
  grid.fill(allValues);

  // Ensure value 3 appears in exactly two cells (0 and 1).
  grid[0] = v1 | v3;
  grid[1] = v2 | v3;
  grid[2] = v1 | v2;
  grid[3] = v1 | v2;
  grid[21] = v3 | v4;

  const acc = { addForCell() { } };
  const ok = regionHandler.enforceConsistency(grid, acc);

  assert.equal(ok, true);
  assert.equal(grid[21], v4);
});

await runTest('_optimizeTaxicab: does not modify grid when no value appears exactly twice', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const padCells = [0, 1, 2, 3];
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, 0b1111);

  const valueMap = Array.from({ length: shape.numValues }, () => []);
  valueMap[0] = [20];
  const taxicab = new HandlerModule.ValueDependentUniqueValueExclusion(0, valueMap);

  const handlerSet = new HandlerSet([padHandler, taxicab], numCells);
  optimizer._optimizeTaxicab(handlerSet, createExclusions(numCells), shape);

  const regionHandler = handlerSet.getAllofType(
    HandlerModule.ValueDependentUniqueValueExclusionForPerfectAllDifferent)[0];
  assert.ok(regionHandler);

  const allValues = LookupTables.allValues(shape.numValues);
  const v1 = 1 << 0;
  const v2 = 1 << 1;
  const v3 = 1 << 2;
  const grid = new Uint16Array(numCells);
  grid.fill(allValues);

  // Value 1 appears in 3 cells, so this handler should not enforce for v1.
  grid[0] = v1 | v2;
  grid[1] = v1 | v3;
  grid[2] = v1 | v2;
  grid[3] = v2 | v3;
  grid[20] = v1 | v2;

  const before = grid[20];
  const acc = { addForCell() { } };
  const ok = regionHandler.enforceConsistency(grid, acc);

  assert.equal(ok, true);
  assert.equal(grid[20], before);
});

logSuiteComplete('optimizer/taxicab_optimization');
