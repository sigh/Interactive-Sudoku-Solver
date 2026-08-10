import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../../js/cell_geometry.js' + self.VERSION_PARAM);

// The optimizations below derive facts from the grid's rows and columns being
// Sudoku houses, so they must not fire on a Raw grid.

// Build a solver with debug logs enabled and return the set of optimizer
// locations which added handlers.
const optimizerLocs = (input) => {
  const constraint = SudokuParser.parseString(input);
  const solver = SudokuBuilder.build(constraint, { logLevel: 1 });
  const logs = solver._debugLogger.getDebugState()?.logs ?? [];
  return new Set(logs.map(log => log.loc));
};

const optimizedHandlerNames = (input) => {
  const constraint = SudokuParser.parseString(input);
  const solver = SudokuBuilder.build(constraint);
  return solver._internalSolver._handlerSet.getAll().map(
    h => h.constructor.name);
};

// =============================================================================
// _optimizeNonSquareGrids gating
// =============================================================================

await runTest('non-square boxless grid adds FullGridRequiredValues', () => {
  const names = optimizedHandlerNames('.Shape~4x6.NoBoxes.');
  assert.ok(names.includes('FullGridRequiredValues'));
});

await runTest('a Raw grid suppresses FullGridRequiredValues', () => {
  const names = optimizedHandlerNames('.Shape~4x6~~Raw.');
  assert.ok(!names.includes('FullGridRequiredValues'));
});

// =============================================================================
// Sum derivations (_fillInSumGap, _makeInnieOutieSumHandlers) gating
// =============================================================================

// Cages covering all but two cells of a boxless 4x4: triggers both the
// fill-in-sum-gap and the row/col innie-outie derivations.
const CAGES_4X4 =
  '.Cage~6~R1C1~R1C2~R1C3.Cage~7~R2C1~R2C2~R2C3.' +
  'Cage~7~R3C1~R3C2~R3C3.Cage~6~R4C1~R4C2~R4C3.Cage~5~R1C4~R2C4';

await runTest('boxless cage puzzle derives sums from rows/cols and grid total', () => {
  const locs = optimizerLocs(`.Shape~4x4.NoBoxes${CAGES_4X4}`);
  assert.ok(locs.has('_fillInSumGap'));
  assert.ok(locs.has('_makeInnieOutieSumHandlers'));
});

await runTest('a Raw grid suppresses grid-total and innie-outie sums', () => {
  const locs = optimizerLocs(`.Shape~4x4~~Raw${CAGES_4X4}`);
  assert.ok(!locs.has('_fillInSumGap'));
  assert.ok(!locs.has('_makeInnieOutieSumHandlers'));
  assert.ok(!locs.has('_addFullGridRequiredValues'));
});

// =============================================================================
// _overlapRegions gating
// =============================================================================

await runTest('_overlapRegions on a Raw grid returns only boxes', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromShapeSpec('9x9~~Raw');
  const boxRegions = [Array.from({ length: 9 }, (_, i) => i)];

  assert.equal(
    optimizer._overlapRegions(geometry, [], geometry.numValues).length, 0);
  assert.deepEqual(
    optimizer._overlapRegions(geometry, boxRegions, 9),
    [boxRegions]);
});

logSuiteComplete('optimizer/raw_grid.test.js');
