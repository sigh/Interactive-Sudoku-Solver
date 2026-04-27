import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  createCellExclusions,
  valueMask,
  assertTouched,
  assertCandidates,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const {
  ValueDependentUniqueValueExclusionForPerfectAllDifferent,
} = await import('../../js/solver/handlers.js');

// Build a valueCellExclusions array of length numValues.
// `pairExclusionsByValueIndex` maps value index → [{cells: [c0, c1], excludes: [...]}]
// For each pair entry, the two cells in `cells` will both mutually exclude each cell in `excludes`.
const buildExclusions = (numValues, numCells, pairExclusionsByValueIndex) => {
  return Array.from({ length: numValues }, (_, vi) => {
    const ex = createCellExclusions({ allUnique: false, numCells });
    const pairs = pairExclusionsByValueIndex[vi] ?? [];
    for (const { cells, excludes } of pairs) {
      for (const c of cells) {
        for (const e of excludes) {
          ex.addMutualExclusion(c, e);
        }
      }
    }
    return ex;
  });
};

// =============================================================================
// ValueDependentUniqueValueExclusionForPerfectAllDifferent tests
// =============================================================================

await runTest('removes value from pair-exclusion cells when value appears in exactly two region cells', () => {
  // Region cells [0,1,2,3]; value 1 (index 0) in cells 0 and 1.
  // Cells 0 and 1 both mutually-exclude cell 20 for value 1.
  // Expect: value 1 removed from cell 20.
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  grid[20] = valueMask(1, 4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 20: valueMask(4) });
});

await runTest('no-op when value does not appear in any region cell', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  // Value 1 absent from all region cells.
  grid[0] = valueMask(2, 3);
  grid[1] = valueMask(2, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  grid[20] = valueMask(1, 4);

  const before = grid[20];
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[20], before);
});

await runTest('no-op when value appears in exactly one region cell', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0], excludes: [20] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  // Value 1 only in cell 0.
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(2, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  grid[20] = valueMask(1, 4);

  const before = grid[20];
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[20], before);
});

await runTest('no-op when value appears in three or more region cells', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  // Value 1 in three region cells.
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(1, 3);
  grid[3] = valueMask(2, 3);
  grid[20] = valueMask(1, 4);

  const before = grid[20];
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[20], before);
});

await runTest('returns false when value removal empties an exclusion cell', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  // Cell 20 holds only value 1 — removal will empty it.
  grid[20] = valueMask(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('handles multiple values independently — each fires its own exclusions', () => {
  // Value 1 in cells 0,1 → excludes cell 20.
  // Value 2 in cells 2,3 → excludes cell 21.
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20] }],
    1: [{ cells: [2, 3], excludes: [21] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[0] = valueMask(1, 3);
  grid[1] = valueMask(1, 4);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 4);
  grid[20] = valueMask(1, 5);
  grid[21] = valueMask(2, 5);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 20: valueMask(5), 21: valueMask(5) });
});

await runTest('reports touched cells in the accumulator', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20, 21] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  grid[20] = valueMask(1, 4);
  grid[21] = valueMask(1, 5);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertTouched(acc, [20, 21]);
});

await runTest('no grid changes when pair has no registered exclusions', () => {
  // Value 1 appears in exactly 2 region cells, but the exclusions map for
  // value 1 has no exclusions → nothing to prune.
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  // Empty exclusions for all values.
  const valueCellExclusions = buildExclusions(9, 81, {});
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  grid[20] = valueMask(1, 4);

  const before = grid[20];
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[20], before);
  assertTouched(acc, []);
});

await runTest('fires for non-consecutive region cells using correct pairIndex encoding', () => {
  // Region has non-consecutive cells [5, 10, 15, 20].
  // Value 3 (index 2) in cells 5 and 10 → should exclude cell 50.
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [5, 10, 15, 20];
  const valueCellExclusions = buildExclusions(9, 81, {
    2: [{ cells: [5, 10], excludes: [50] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[5] = valueMask(3, 4);
  grid[10] = valueMask(3, 5);
  grid[15] = valueMask(4, 5);
  grid[20] = valueMask(4, 5);
  grid[50] = valueMask(3, 6);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 50: valueMask(6) });
});

await runTest('does not touch exclusion cell when it does not hold the value', () => {
  // Pair-exclusion registered but target cell already lacks the value.
  const context = new GridTestContext({ gridSize: 9 });
  const regionCells = [0, 1, 2, 3];
  const valueCellExclusions = buildExclusions(9, 81, {
    0: [{ cells: [0, 1], excludes: [20] }],
  });
  const handler = new ValueDependentUniqueValueExclusionForPerfectAllDifferent(
    regionCells, valueCellExclusions);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  // Cell 20 already does not contain value 1.
  grid[20] = valueMask(4, 5);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 20: valueMask(4, 5) });
  assertTouched(acc, []);
});

logSuiteComplete('value_dependent_exclusion_for_perfect_all_different.test.js');
