import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../js/solver/optimizer.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { BitSet } = await import('../js/util.js' + self.VERSION_PARAM);
const HandlerModule = await import('../js/solver/handlers.js' + self.VERSION_PARAM);

class MockCellExclusions {
  constructor(numCells) {
    this.bitsets = new Array(numCells).fill(0).map(() => new BitSet(numCells));
  }
  addMutualExclusion(c1, c2) {
    this.bitsets[c1].add(c2);
    this.bitsets[c2].add(c1);
  }
  isMutuallyExclusive(c1, c2) {
    return this.bitsets[c1].has(c2);
  }
  getBitSet(cell) {
    return this.bitsets[cell];
  }
}

await runTest('_findKnownRequiredValues: simple exclusion', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // Cells 0 and 1 cannot be the same value.
  cellExclusions.addMutualExclusion(0, 1);

  const cells = [0, 1, 2];
  const value = 1;
  const count = 2;
  const restrictions = new Map();

  // We need to choose 2 cells out of {0, 1, 2} to have value 1.
  // {0, 1} is invalid because they are exclusive.
  // {0, 2} is valid.
  // {1, 2} is valid.
  //
  // Cell 2 is in both valid combinations.
  // Cell 0 is in one.
  // Cell 1 is in one.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  const v = LookupTables.fromValue(value);

  // Cell 2 must be restricted to v.
  assert.equal(restrictions.get(2), v);

  // Cells 0 and 1 are not restricted.
  assert.equal(restrictions.has(0), false);
  assert.equal(restrictions.has(1), false);
});

await runTest('_findKnownRequiredValues: forced values', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // 0-1 exclusive, 1-2 exclusive.
  cellExclusions.addMutualExclusion(0, 1);
  cellExclusions.addMutualExclusion(1, 2);

  const cells = [0, 1, 2];
  const value = 1;
  const count = 2;
  const restrictions = new Map();

  // We need 2 cells.
  // {0, 1} invalid.
  // {1, 2} invalid.
  // {0, 2} valid.
  //
  // Only {0, 2} is possible.
  // 0 must be v.
  // 2 must be v.
  // 1 must NOT be v.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  const v = LookupTables.fromValue(value);

  assert.equal(restrictions.get(0), v);
  assert.equal(restrictions.get(2), v);
  assert.equal(restrictions.get(1), ~v);
});

await runTest('_findKnownRequiredValues: no restrictions found', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // No exclusions.
  const cells = [0, 1, 2];
  const value = 1;
  const count = 2;
  const restrictions = new Map();

  // Any pair is valid.
  // {0, 1}, {0, 2}, {1, 2}
  // Each cell appears in 2 out of 3 combinations.
  // No cell is required in ALL.
  // No cell is required in NONE.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  assert.equal(restrictions.size, 0);
});

await runTest('_findKnownRequiredValues: all required', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // No exclusions.
  const cells = [0, 1, 2];
  const value = 1;
  const count = 3;
  const restrictions = new Map();

  // Must pick 3 cells. Only {0, 1, 2} is possible.
  // All cells required.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  const v = LookupTables.fromValue(value);
  assert.equal(restrictions.get(0), v);
  assert.equal(restrictions.get(1), v);
  assert.equal(restrictions.get(2), v);
});

await runTest('_findKnownRequiredValues: impossible combination', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // All mutually exclusive.
  cellExclusions.addMutualExclusion(0, 1);
  cellExclusions.addMutualExclusion(1, 2);
  cellExclusions.addMutualExclusion(0, 2);

  const cells = [0, 1, 2];
  const value = 1;
  const count = 2; // Cannot pick 2 from 3 mutually exclusive cells.
  const restrictions = new Map();

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, false);
});

await runTest('_findKnownRequiredValues: max iterations exceeded', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 12;
  const cellExclusions = new MockCellExclusions(numCells);

  // No exclusions to maximize combinations.
  const cells = Array.from({ length: numCells }, (_, i) => i);
  const value = 1;
  const count = 6; // 12C6 = 924 > 720
  const restrictions = new Map();

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  // Should abort and return true, adding no restrictions.
  assert.equal(restrictions.size, 0);
});

await runTest('_findKnownRequiredValues: merge existing restrictions', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // 0-1 exclusive, 1-2 exclusive.
  cellExclusions.addMutualExclusion(0, 1);
  cellExclusions.addMutualExclusion(1, 2);

  const cells = [0, 1, 2];
  const value = 1;
  const count = 2;
  const restrictions = new Map();

  const v = LookupTables.fromValue(value);
  const otherVal = LookupTables.fromValue(2);

  // Pre-existing restriction on cell 0: can be 'value' or 'otherVal'.
  restrictions.set(0, v | otherVal);
  // Pre-existing restriction on cell 2: can only be 'otherVal' (which contradicts the new requirement).
  restrictions.set(2, otherVal);

  // We know from 'forced values' test that:
  // 0 must be v.
  // 2 must be v.
  // 1 must NOT be v.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  // Cell 0: (v | otherVal) & v => v.
  assert.equal(restrictions.get(0), v);

  // Cell 2: otherVal & v => 0 (impossible).
  assert.equal(restrictions.get(2), 0);

  // Cell 1: undefined & ~v => ~v.
  assert.equal(restrictions.get(1), ~v);
});

await runTest('_findKnownRequiredValues: partial overlap', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 4;
  const cellExclusions = new MockCellExclusions(numCells);

  // 0-1 exclusive.
  cellExclusions.addMutualExclusion(0, 1);

  const cells = [0, 1, 2, 3];
  const value = 1;
  const count = 3;
  const restrictions = new Map();

  // Need 3 cells.
  // Cannot have both 0 and 1.
  // Possible: {0, 2, 3}, {1, 2, 3}.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  const v = LookupTables.fromValue(value);

  assert.equal(restrictions.get(2), v);
  assert.equal(restrictions.get(3), v);
  assert.equal(restrictions.has(0), false);
  assert.equal(restrictions.has(1), false);
});

await runTest('_findKnownRequiredValues: count greater than numCells', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  const cells = [0, 1, 2];
  const value = 1;
  const count = 4;
  const restrictions = new Map();

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, false);
});

await runTest('_findKnownRequiredValues: count greater than exclusion groups', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 4;
  const cellExclusions = new MockCellExclusions(numCells);

  // 0-1 exclusive.
  cellExclusions.addMutualExclusion(0, 1);
  // 2-3 exclusive.
  cellExclusions.addMutualExclusion(2, 3);

  const cells = [0, 1, 2, 3];
  const value = 1;
  const count = 3;
  const restrictions = new Map();

  // We have 2 exclusion groups: {0, 1} and {2, 3}.
  // We can pick at most 1 from each group.
  // Max pickable is 2.
  // Requested count is 3.
  // Should return false.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, false);
});

await runTest('_findKnownRequiredValues: must pick from all groups', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // No exclusions between cells, so each is its own group.
  const cells = [0, 1, 2];
  const value = 1;
  const count = 3;
  const restrictions = new Map();

  // Must pick 3. Groups are {0}, {1}, {2}.
  // Logic should force picking from {0}, then {1}, then {2}.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, HandlerModule.HandlerUtil.findMappedExclusionGroups(cells, cellExclusions));
  assert.equal(result, true);

  const v = LookupTables.fromValue(value);
  assert.equal(restrictions.get(0), v);
  assert.equal(restrictions.get(1), v);
  assert.equal(restrictions.get(2), v);
});

await runTest('_findKnownRequiredValues: suboptimal grouping (backtracking with skip)', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 3;
  const cellExclusions = new MockCellExclusions(numCells);

  // 1 and 2 are mutually exclusive.
  cellExclusions.addMutualExclusion(1, 2);

  const cells = [0, 1, 2];
  const value = 1;
  const count = 2;
  const restrictions = new Map();

  // Manually provide suboptimal groups: {0}, {1}, {2}.
  // Optimal would be {0}, {1, 2}.
  const exclusionGroups = [[0], [1], [2]];

  // Execution flow:
  // 1. Try Skip {0}. Need 2 from {1}, {2}.
  //    Pick {1}. Pick {2}.
  //    Check 1-2 exclusion. Fail.
  //    Backtrack.
  // 2. Pick {0}. Need 1 from {1}, {2}.
  //    Skip {1}. Pick {2}. Valid {0, 2}.
  //    Pick {1}. Skip {2}. Valid {0, 1}.
  // Result: 0 required.

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, exclusionGroups);
  assert.equal(result, true);

  const v = LookupTables.fromValue(value);
  assert.equal(restrictions.get(0), v);
  assert.equal(restrictions.has(1), false);
  assert.equal(restrictions.has(2), false);
});

await runTest('_findKnownRequiredValues: empty group', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const numCells = 2;
  const cellExclusions = new MockCellExclusions(numCells);
  const cells = [0, 1];
  const value = 1;
  const count = 1;
  const restrictions = new Map();

  // Manually provide an empty group.
  const exclusionGroups = [[0], [], [1]];
  // Groups: {0}, {}, {1}.
  // Count 1.
  // Empty group acts as "must skip".

  const result = optimizer._findKnownRequiredValues(cells, value, count, cellExclusions, restrictions, exclusionGroups);
  assert.equal(result, true);
  assert.equal(restrictions.size, 0);
});

logSuiteComplete('optimizer');
