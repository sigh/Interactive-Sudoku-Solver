import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  createCellExclusions,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { HandlerUtil } = await import('../../js/solver/handlers.js');

// ─── cellsAllValues ────────────────────────────────────────────────

await runTest('cellsAllValues should union all cell candidates', () => {
  const grid = [valueMask(1, 2), valueMask(3, 4), valueMask(4, 5)];
  const result = HandlerUtil.cellsAllValues(grid, [0, 1, 2]);
  assert.equal(result, valueMask(1, 2, 3, 4, 5));
});

await runTest('cellsAllValues should return 0 for empty cell list', () => {
  const grid = [valueMask(1, 2, 3)];
  assert.equal(HandlerUtil.cellsAllValues(grid, []), 0);
});

await runTest('cellsAllValues should handle a subset of cells', () => {
  const grid = [valueMask(1), valueMask(2), valueMask(3), valueMask(4)];
  assert.equal(HandlerUtil.cellsAllValues(grid, [0, 3]), valueMask(1, 4));
});

// ─── exposeHiddenSingles ───────────────────────────────────────────

await runTest('exposeHiddenSingles should fix cells with a hidden single', () => {
  const grid = [valueMask(1, 2, 3), valueMask(2, 3), valueMask(2, 3)];
  const cells = [0, 1, 2];
  // Value 1 is a hidden single in cell 0.
  const result = HandlerUtil.exposeHiddenSingles(grid, cells, valueMask(1));
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1));
  // Other cells unmodified.
  assert.equal(grid[1], valueMask(2, 3));
  assert.equal(grid[2], valueMask(2, 3));
});

await runTest('exposeHiddenSingles should not modify cells without the hidden single', () => {
  const grid = [valueMask(2, 3), valueMask(2, 3), valueMask(1, 4)];
  const cells = [0, 1, 2];
  const result = HandlerUtil.exposeHiddenSingles(grid, cells, valueMask(1));
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2, 3));
  assert.equal(grid[1], valueMask(2, 3));
  assert.equal(grid[2], valueMask(1));
});

await runTest('exposeHiddenSingles should fail if a cell has two hidden singles', () => {
  // Cell 0 has both hidden single 1 and hidden single 4.
  const grid = [valueMask(1, 2, 4), valueMask(2, 3), valueMask(2, 3)];
  const cells = [0, 1, 2];
  const result = HandlerUtil.exposeHiddenSingles(grid, cells, valueMask(1, 4));
  assert.equal(result, false);
});

await runTest('exposeHiddenSingles should handle no hidden singles', () => {
  const grid = [valueMask(2, 3), valueMask(2, 3)];
  const cells = [0, 1];
  const result = HandlerUtil.exposeHiddenSingles(grid, cells, 0);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2, 3));
  assert.equal(grid[1], valueMask(2, 3));
});

// ─── removeRequiredValueExclusions ─────────────────────────────────

await runTest('removeRequiredValueExclusions should remove value from exclusion cells', () => {
  const grid = [valueMask(1, 2, 3), valueMask(1, 2), valueMask(3, 4)];
  const acc = createAccumulator();
  const result = HandlerUtil.removeRequiredValueExclusions(
    grid, [0, 1], valueMask(1), acc);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2, 3));
  assert.equal(grid[1], valueMask(2));
  assert.equal(grid[2], valueMask(3, 4), 'unrelated cell untouched');
  assert.ok(acc.touched.has(0));
  assert.ok(acc.touched.has(1));
});

await runTest('removeRequiredValueExclusions should fail if removal empties a cell', () => {
  const grid = [valueMask(1)];
  const acc = createAccumulator();
  const result = HandlerUtil.removeRequiredValueExclusions(
    grid, [0], valueMask(1), acc);
  assert.equal(result, false);
});

await runTest('removeRequiredValueExclusions should skip cells without the value', () => {
  const grid = [valueMask(2, 3), valueMask(1, 4)];
  const acc = createAccumulator();
  const result = HandlerUtil.removeRequiredValueExclusions(
    grid, [0, 1], valueMask(1), acc);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2, 3));
  assert.equal(grid[1], valueMask(4));
  assert.ok(!acc.touched.has(0));
  assert.ok(acc.touched.has(1));
});

await runTest('removeRequiredValueExclusions should work with null accumulator', () => {
  const grid = [valueMask(1, 2)];
  const result = HandlerUtil.removeRequiredValueExclusions(
    grid, [0], valueMask(1), null);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
});

// ─── enforceRequiredValueExclusions ────────────────────────────────

await runTest('enforceRequiredValueExclusions should remove value from pair exclusion cells', () => {
  // Cells 0 and 1 both have value 3. Cell 2 is excluded by both (pair exclusion).
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const grid = context.grid;
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  // Make cells 0 and 1 exclude cell 2.
  cellExclusions.addMutualExclusion(0, 2);
  cellExclusions.addMutualExclusion(1, 2);

  grid[0] = valueMask(3, 4);
  grid[1] = valueMask(3, 4);
  grid[2] = valueMask(1, 2, 3);
  grid[3] = valueMask(1, 2, 3, 4);

  const acc = createAccumulator();
  const result = HandlerUtil.enforceRequiredValueExclusions(
    grid, [0, 1], valueMask(3), cellExclusions, acc);
  assert.equal(result, true);
  assert.equal(grid[2] & valueMask(3), 0, 'value 3 removed from cell 2');
});

await runTest('enforceRequiredValueExclusions should handle single-cell value', () => {
  // Value 5 only in cell 0. Cell 3 is excluded by cell 0.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 9 });
  const grid = context.grid;
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  cellExclusions.addMutualExclusion(0, 3);

  grid[0] = valueMask(5);
  grid[1] = valueMask(1, 2);
  grid[2] = valueMask(1, 2);
  grid[3] = valueMask(4, 5, 6);

  const acc = createAccumulator();
  const result = HandlerUtil.enforceRequiredValueExclusions(
    grid, [0, 1, 2], valueMask(5), cellExclusions, acc);
  assert.equal(result, true);
  assert.equal(grid[3] & valueMask(5), 0, 'value 5 removed from cell 3');
});

// ─── exclusionGroupSumInfo ─────────────────────────────────────────

await runTest('exclusionGroupSumInfo should compute range and min for single group', () => {
  // One group of 3 cells, numValues=9: min sum = 1+2+3 = 6, max = 7+8+9 = 24.
  const groups = [[0, 1, 2]];
  const info = HandlerUtil.exclusionGroupSumInfo(groups, 9);
  assert.equal(info.min, 6);
  assert.equal(info.max, 24);
  assert.equal(info.range, 18);
});

await runTest('exclusionGroupSumInfo should sum ranges across multiple groups', () => {
  // Two groups of 2, numValues=9.
  // Each: min = 1+2 = 3, range = (9-2)*2 = 14, so max = 17.
  // Total: min = 6, range = 28, max = 34.
  const groups = [[0, 1], [2, 3]];
  const info = HandlerUtil.exclusionGroupSumInfo(groups, 9);
  assert.equal(info.min, 6);
  assert.equal(info.range, 28);
  assert.equal(info.max, 34);
});

await runTest('exclusionGroupSumInfo should account for valueOffset', () => {
  // 3 cells, numValues=9, valueOffset=-1 (values 0-8).
  // min = (3*4/2) + 3*(-1) = 6 - 3 = 3.
  const groups = [[0, 1, 2]];
  const info = HandlerUtil.exclusionGroupSumInfo(groups, 9, -1);
  assert.equal(info.min, 3);
  assert.equal(info.range, 18);
  assert.equal(info.max, 21);
});

await runTest('exclusionGroupSumInfo should handle single-cell group', () => {
  const groups = [[0]];
  const info = HandlerUtil.exclusionGroupSumInfo(groups, 9);
  // min = 1, range = (9-1)*1 = 8, max = 9.
  assert.equal(info.min, 1);
  assert.equal(info.range, 8);
  assert.equal(info.max, 9);
});

// ─── findMappedExclusionGroups ─────────────────────────────────────

await runTest('findMappedExclusionGroups should return index-mapped groups', () => {
  const cellExclusions = createCellExclusions({ allUnique: true, numCells: 9 });
  // Cells 3,4,5 are all mutually exclusive (via allUnique).
  const cells = [3, 4, 5];
  const result = HandlerUtil.findMappedExclusionGroups(cells, cellExclusions);
  // Should get one group containing all cells, mapped to indices 0,1,2.
  assert.equal(result.groups.length, 1);
  const group = result.groups[0].slice().sort();
  assert.deepEqual(group, [0, 1, 2]);
});

await runTest('findMappedExclusionGroups should split non-exclusive cells into groups', () => {
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 9 });
  // Make 0 and 1 exclusive, but 2 independent.
  cellExclusions.addMutualExclusion(0, 1);
  const cells = [0, 1, 2];
  const result = HandlerUtil.findMappedExclusionGroups(cells, cellExclusions);

  // Should have at least 2 groups.
  assert.ok(result.groups.length >= 2);

  // All indices should be present exactly once.
  const allIndices = result.groups.flat().sort();
  assert.deepEqual(allIndices, [0, 1, 2]);
});

logSuiteComplete('handler_util.test.js');
