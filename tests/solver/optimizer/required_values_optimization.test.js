import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';
import {
  GridTestContext,
  applyCandidates,
  createAccumulator,
  createCellExclusions,
} from '../../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);

// Run `_optimizeRequiredValues` over a single handler on a 4x4 grid (values
// 1-4, so restriction sets stay small enough to assert on directly).
// `exclusions` are the mutual exclusions to add on top of an otherwise
// exclusion-free grid, so each scenario controls the search exactly.
const optimizeSingle = ({ cells, values, exclusions = [] }, strict) => {
  const context = new GridTestContext({ gridSize: 4 });
  const numCells = context.geometry.numGridCells;

  const cellExclusions = createCellExclusions({ allUnique: false, numCells });
  for (const [a, b] of exclusions) cellExclusions.addMutualExclusion(a, b);

  const handler = new HandlerModule.RequiredValues(cells, values, strict);
  const handlerSet = new HandlerSet([handler], numCells);

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._optimizeRequiredValues(handlerSet, cellExclusions, context.geometry);

  const given = handlerSet.getAllofType(HandlerModule.GivenCandidates);
  return {
    context,
    cellExclusions,
    original: handler,
    required: handlerSet.getAllofType(HandlerModule.RequiredValues),
    falseHandlers: handlerSet.getAllofType(HandlerModule.False),
    // The candidates the optimizer pinned, as a plain {cell: [values]} object.
    candidates: given.length ?
      Object.fromEntries(given[0]._valueMap.entries()) : null,
    numGivenHandlers: given.length,
  };
};

// Each scenario covers one outcome of `_optimizeRequiredValues`. The optimizer
// never reads the strict flag, so every scenario is run under both settings:
// the rewrite must carry the flag through unchanged, and must otherwise make
// the same deductions either way.
const SCENARIOS = [
  {
    // Cells 0 and 1 are mutually exclusive, so one of the two 2s must be in
    // cell 2. That pins cell 2, letting it (and one 2) drop out of the handler.
    name: 'rewrites the handler when a cell is pinned',
    input: { cells: [0, 1, 2], values: [1, 2, 2], exclusions: [[0, 1]] },
    expect: { cells: [0, 1], values: [1, 2], candidates: { 2: [2] } },
  },
  {
    // Cell 3 is exclusive with all the others, so it can never be part of a
    // valid pair of 2s. It keeps every value except 2, and leaves the handler.
    name: 'drops cells which cannot hold a required value',
    input: { cells: [0, 1, 2, 3], values: [2, 2], exclusions: [[3, 0], [3, 1], [3, 2]] },
    expect: { cells: [0, 1, 2], values: [2, 2], candidates: { 3: [1, 3, 4] } },
  },
  {
    // Cell 2 is exclusive with both others, so the only pair of 1s is {0, 1}.
    // Both 1s become givens, and cell 2 loses the value, so nothing is left for
    // the handler to enforce under either setting.
    name: 'deletes the handler once every value is pinned',
    input: { cells: [0, 1, 2], values: [1, 1], exclusions: [[0, 2], [1, 2]] },
    expect: { deleted: true, candidates: { 0: [1], 1: [1], 2: [2, 3, 4] } },
  },
  {
    // Three 1s cannot fit in two cells, whether or not the count is exact.
    name: 'replaces an unsatisfiable handler with False',
    input: { cells: [0, 1], values: [1, 1, 1] },
    expect: { falseCells: [0, 1] },
  },
  {
    // Without exclusions the two 2s can go anywhere, so no cell is restricted.
    name: 'leaves the handler alone when nothing is forced',
    input: { cells: [0, 1, 2], values: [2, 2] },
    expect: { unchanged: true },
  },
  {
    name: 'ignores handlers with no repeated values',
    input: { cells: [0, 1, 2], values: [1, 2], exclusions: [[0, 1]] },
    expect: { unchanged: true },
  },
];

const assertOutcome = (result, expect, strict) => {
  if (expect.unchanged) {
    assert.equal(result.required.length, 1);
    assert.equal(result.required[0], result.original);
    assert.equal(result.numGivenHandlers, 0);
    return;
  }

  if (expect.falseCells) {
    assert.equal(result.falseHandlers.length, 1);
    assert.deepEqual([...result.falseHandlers[0].cells], expect.falseCells);
    assert.equal(result.required.length, 0);
    assert.equal(result.numGivenHandlers, 0);
    return;
  }

  assert.deepEqual(result.candidates, expect.candidates);

  if (expect.deleted) {
    assert.equal(result.required.length, 0);
    return;
  }

  assert.equal(result.required.length, 1);
  assert.deepEqual([...result.required[0].cells], expect.cells);
  assert.deepEqual(result.required[0].values(), expect.values);
  assert.equal(result.required[0].isStrict(), strict);
};

for (const strict of [true, false]) {
  const label = strict ? 'ContainExact' : 'ContainAtLeast';
  for (const { name, input, expect } of SCENARIOS) {
    await runTest(`_optimizeRequiredValues (${label}): ${name}`, () => {
      assertOutcome(optimizeSingle(input, strict), expect, strict);
    });
  }
}

// ============================================================================
// Behaviour of the rewritten handler
//
// The structural tests above check what the optimizer emits. These check that
// what it emits still enforces the right constraint: an exact count must
// reject a surplus copy of a required value, a lower bound must accept it.
// ============================================================================

// Two 2s over cells [0,1,2,3], where cell 3 is exclusive with the rest. The
// optimizer drops cell 3, leaving three cells to hold exactly (or at least)
// two 2s — so the rewritten handler still has room for a surplus 2.
const SURPLUS_CASE = {
  cells: [0, 1, 2, 3], values: [2, 2], exclusions: [[3, 0], [3, 1], [3, 2]],
};

const enforceOnRewrittenHandler = (strict, assignments) => {
  const result = optimizeSingle(SURPLUS_CASE, strict);
  assert.equal(result.required.length, 1, 'expected the handler to be rewritten');
  const handler = result.required[0];

  assert.equal(
    result.context.initializeHandler(
      handler, { cellExclusions: result.cellExclusions }),
    true);

  applyCandidates(result.context.grid, assignments);
  return handler.enforceConsistency(result.context.grid, createAccumulator());
};

await runTest('rewritten handler (ContainExact): rejects a surplus value', () => {
  // Three 2s where exactly two are required.
  assert.equal(
    enforceOnRewrittenHandler(true, { 0: [2], 1: [2], 2: [2] }), false);
});

await runTest('rewritten handler (ContainAtLeast): accepts a surplus value', () => {
  assert.equal(
    enforceOnRewrittenHandler(false, { 0: [2], 1: [2], 2: [2] }), true);
});

await runTest('rewritten handler: rejects too few values either way', () => {
  // Only one cell can hold a 2, but two are required.
  const assignments = { 0: [2], 1: [1], 2: [3] };
  assert.equal(enforceOnRewrittenHandler(true, assignments), false);
  assert.equal(enforceOnRewrittenHandler(false, assignments), false);
});

await runTest('rewritten handler: accepts the exact count either way', () => {
  const assignments = { 0: [2], 1: [2], 2: [3] };
  assert.equal(enforceOnRewrittenHandler(true, assignments), true);
  assert.equal(enforceOnRewrittenHandler(false, assignments), true);
});

logSuiteComplete('optimizer/required_values_optimization');
