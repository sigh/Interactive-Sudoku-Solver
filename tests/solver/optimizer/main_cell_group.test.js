import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../../js/cell_geometry.js' + self.VERSION_PARAM);

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

await runTest('a cell group shape suppresses FullGridRequiredValues', () => {
  const names = optimizedHandlerNames(
    '.Shape~VA~6.Var~A~~4x6.');
  assert.ok(!names.includes('FullGridRequiredValues'));
});

// =============================================================================
// Sum derivations (_fillInSumGap, _makeInnieOutieSumHandlers) gating
// =============================================================================

// Cages covering all but two cells of a boxless 4x4: triggers both the
// fill-in-sum-gap and the row/col innie-outie derivations.
const CAGES_4X4_GRID =
  '.Cage~6~R1C1~R1C2~R1C3.Cage~7~R2C1~R2C2~R2C3.' +
  'Cage~7~R3C1~R3C2~R3C3.Cage~6~R4C1~R4C2~R4C3.Cage~5~R1C4~R2C4';
// The same cages on a 4x4 var group (R{r}C{c} -> VA{(r-1)*4+c}).
const CAGES_4X4_VAR =
  '.Cage~6~VA1~VA2~VA3.Cage~7~VA5~VA6~VA7.' +
  'Cage~7~VA9~VA10~VA11.Cage~6~VA13~VA14~VA15.Cage~5~VA4~VA8';

await runTest('boxless cage puzzle derives sums from rows/cols and grid total', () => {
  const locs = optimizerLocs(`.Shape~4x4.NoBoxes${CAGES_4X4_GRID}`);
  assert.ok(locs.has('_fillInSumGap'));
  assert.ok(locs.has('_makeInnieOutieSumHandlers'));
});

await runTest('a cell group shape suppresses grid-total and innie-outie sums', () => {
  const locs = optimizerLocs(
    `.Shape~VA~4.Var~A~~4x4${CAGES_4X4_VAR}`);
  assert.ok(!locs.has('_fillInSumGap'));
  assert.ok(!locs.has('_makeInnieOutieSumHandlers'));
  assert.ok(!locs.has('_addFullGridRequiredValues'));
});

// =============================================================================
// _overlapRegions gating
// =============================================================================

await runTest('_overlapRegions with a cell group shape returns only boxes', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromShapeSpec('VA~9');
  const boxRegions = [Array.from({ length: 9 }, (_, i) => i)];

  assert.equal(
    optimizer._overlapRegions(geometry, [], geometry.numValues).length, 0);
  assert.deepEqual(
    optimizer._overlapRegions(geometry, boxRegions, 9),
    [boxRegions]);
});

logSuiteComplete('optimizer/main_cell_group.test.js');
