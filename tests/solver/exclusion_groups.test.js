import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { createCellExclusions } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { HandlerUtil } = await import('../../js/solver/handlers.js' + self.VERSION_PARAM);
const { BitSet } = await import('../../js/util.js' + self.VERSION_PARAM);

// Creates a mock cellExclusions object that supports self-exclusions for testing.
const createMockCellExclusions = (numCells, exclusionMap) => {
  const cache = new Array(numCells);

  return {
    isMutuallyExclusive: (a, b) => exclusionMap.get(a)?.has(b) ?? false,
    getBitSet: (cell) => {
      let bs = cache[cell];
      if (!bs) {
        bs = new BitSet(numCells);
        const exclusions = exclusionMap.get(cell);
        if (exclusions) {
          for (const excluded of exclusions) {
            bs.add(excluded);
          }
        }
        cache[cell] = bs;
      }
      return bs;
    },
  };
};

await runTest('findExclusionGroupsGreedy handles self-exclusion without crashing', () => {
  // Create a scenario where cell 0 is mutually exclusive with itself.
  // This is an invalid state but should not cause a crash.
  const exclusionMap = new Map([
    [0, new Set([0, 1])],  // Cell 0 excludes itself and cell 1
    [1, new Set([0])],     // Cell 1 excludes cell 0
    [2, new Set()],        // Cell 2 has no exclusions
  ]);

  const cellExclusions = createMockCellExclusions(3, exclusionMap);
  const cells = [0, 1, 2];

  // This should not throw an error.
  const result = HandlerUtil.findExclusionGroupsGreedy(
    cells, cellExclusions, HandlerUtil.GREEDY_STRATEGY_FIRST);

  assert.ok(result, 'Should return a result');
  assert.ok(Array.isArray(result.groups), 'Result should have groups array');
  assert.ok(result.groups.length > 0, 'Should have at least one group');

  // All cells should be assigned to groups.
  const allCells = result.groups.flat();
  assert.equal(allCells.length, cells.length, 'All cells should be in groups');
});

await runTest('findExclusionGroupsGreedy BEST strategy handles self-exclusion', () => {
  // Cell 0 excludes itself.
  const exclusionMap = new Map([
    [0, new Set([0])],
    [1, new Set()],
  ]);

  const cellExclusions = createMockCellExclusions(2, exclusionMap);
  const cells = [0, 1];

  // This should not throw an error.
  const result = HandlerUtil.findExclusionGroupsGreedy(
    cells, cellExclusions, HandlerUtil.GREEDY_STRATEGY_BEST);

  assert.ok(result, 'Should return a result');
  assert.ok(Array.isArray(result.groups), 'Result should have groups array');
});

await runTest('Contradictory constraints (RegionSumLine + Palindrome) do not crash', async () => {
  // This puzzle has a RegionSumLine and Palindrome on the same cells.
  // The constraints imply cells must be both equal and different,
  // which creates self-exclusions via areSameValue.
  const constraintStr = '.RegionSumLine~R6C1~R7C2~R8C3~R9C4.Palindrome~R6C1~R7C2~R8C3~R9C4';

  const solver = new SimpleSolver();
  // This should not throw an error during setup, and should find no solutions.
  const result = await solver.solution(constraintStr);
  assert.equal(result, null, 'Contradictory constraints should have no solution');
});

await runTest('findOverlappingExclusionGroups handles empty and singleton inputs', () => {
  const exclusions = createCellExclusions({ numCells: 1, allUnique: false });
  assert.deepEqual(HandlerUtil.findOverlappingExclusionGroups([], exclusions), []);
  assert.deepEqual(HandlerUtil.findOverlappingExclusionGroups([0], exclusions), []);
});

await runTest('findOverlappingExclusionGroups returns no groups without exclusions', () => {
  const exclusions = createCellExclusions({ numCells: 8, allUnique: false });
  assert.deepEqual(
    HandlerUtil.findOverlappingExclusionGroups([0, 1, 2, 3, 4, 5, 6, 7], exclusions), []);
});

await runTest('findOverlappingExclusionGroups returns a complete graph only once', () => {
  const cells = Array.from({ length: 12 }, (_, i) => i);
  const exclusions = createCellExclusions({ numCells: cells.length });
  const groups = HandlerUtil.findOverlappingExclusionGroups(cells, exclusions);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, cells.length);
  assert.deepEqual(new Set(groups[0]), new Set(cells));
});

await runTest('findOverlappingExclusionGroups finds overlapping groups without duplicates', () => {
  const exclusions = createCellExclusions({ numCells: 4, allUnique: false });
  for (const [a, b] of [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]]) {
    exclusions.addMutualExclusion(a, b);
  }
  const groups = HandlerUtil.findOverlappingExclusionGroups([0, 1, 2, 3], exclusions);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    new Set(groups.map(group => group.slice().sort((a, b) => a - b).join(','))),
    new Set(['0,1,2', '1,2,3']));
});

await runTest('findOverlappingExclusionGroups supports unordered nonconsecutive cell indices', () => {
  const cells = [95, 2, 64, 31, 8, 47];
  const exclusions = createCellExclusions({ numCells: 96, allUnique: false });
  for (const [a, b] of [[95, 2], [95, 64], [2, 64], [64, 31], [64, 8], [31, 8]]) {
    exclusions.addMutualExclusion(a, b);
  }
  // An excluded cell outside the input must not enter a discovered group.
  for (const cell of cells) exclusions.addMutualExclusion(cell, 33);
  const before = cells.map(cell => exclusions.getBitSet(cell).toSortedArray());
  const groups = HandlerUtil.findOverlappingExclusionGroups(cells, exclusions);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    new Set(groups.map(group => group.slice().sort((a, b) => a - b).join(','))),
    new Set(['2,64,95', '8,31,64']));
  assert.deepEqual(cells, [95, 2, 64, 31, 8, 47]);
  assert.deepEqual(cells.map(cell => exclusions.getBitSet(cell).toSortedArray()), before);
});

await runTest('overlapping group discovery is bounded on a dense triangle-free graph', () => {
  const cells = Array.from({ length: 12 }, (_, i) => i);
  const exclusions = createCellExclusions({ numCells: 12, allUnique: false });
  for (let a = 0; a < 6; a++) for (let b = 6; b < 12; b++) {
    exclusions.addMutualExclusion(a, b);
  }
  const groups = HandlerUtil.findOverlappingExclusionGroups(cells, exclusions);
  assert.equal(groups.length, cells.length);
  for (const group of groups) {
    assert.equal(group.length, 2);
    assert(exclusions.areMutuallyExclusive(group));
  }
});

logSuiteComplete('Exclusion Groups');
