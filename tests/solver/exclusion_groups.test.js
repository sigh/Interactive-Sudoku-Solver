import assert from 'node:assert/strict';
import { performance as perf } from 'node:perf_hooks';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: undefined,
  locationValue: { search: '' },
  performance: perf,
});

// Load debug module to ensure all constraint types are registered.
const debugModule = await import('../../js/debug/debug.js' + self.VERSION_PARAM);
await debugModule.debugFilesLoaded;

const { CellExclusions, HandlerSet } = await import('../../js/solver/engine.js' + self.VERSION_PARAM);
const { HandlerUtil } = await import('../../js/solver/handlers.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { BitSet } = await import('../../js/util.js' + self.VERSION_PARAM);

const SHAPE_9x9 = {
  numCells: 81,
  numValues: 9,
  gridSize: 9,
  boxWidth: 3,
  boxHeight: 3,
};

const makeEmptyExclusions = () => {
  const handlerSet = new HandlerSet([], SHAPE_9x9);
  return new CellExclusions(handlerSet, SHAPE_9x9);
};

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

  // This should not throw an error during setup.
  let solver;
  assert.doesNotThrow(() => {
    const parsed = SudokuParser.parseString(constraintStr);
    const resolved = SudokuBuilder.resolveConstraint(parsed);
    solver = SudokuBuilder.build(resolved);
  }, 'Building solver with contradictory constraints should not crash');

  // The solver should find no solutions (the grid is invalid).
  const result = solver.nthSolution(1);
  assert.equal(result, null, 'Contradictory constraints should have no solution');
});

logSuiteComplete('Exclusion Groups');
