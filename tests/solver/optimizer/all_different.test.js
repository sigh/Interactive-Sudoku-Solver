import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { SudokuConstraintBase } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);

// =============================================================================
// _addPerfectAllDifferentHandlers tests
// =============================================================================

await runTest('_addPerfectAllDifferentHandlers: promotes AllDifferent to PerfectAllDifferent with restricted values', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // 6x6 grid with numValues=10 (values 1-10).
  const shape = GridShape.fromGridSize(6, 6, 10);
  const numCells = shape.numGridCells;

  // Restrict all 36 grid cells to values 1-6 via GivenCandidates.
  const valueMap = new Map();
  for (let i = 0; i < numCells; i++) {
    valueMap.set(i, [1, 2, 3, 4, 5, 6]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  // Add a 6-cell AllDifferent (a row).
  const rowCells = [0, 1, 2, 3, 4, 5];
  const allDiffHandler = new HandlerModule.AllDifferent(rowCells);

  const handlerSet = new HandlerSet(
    [givenHandler, allDiffHandler], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));

  // PerfectAllDifferent should fire (6 cells, 6 effective values).
  const perfect = handlerSet.getAllofType(HandlerModule.PerfectAllDifferent);
  assert.equal(perfect.length, 1);
  assert.deepEqual([...perfect[0].cells], rowCells);
});

await runTest('_addPerfectAllDifferentHandlers: promotes grid-house sized region to PerfectAllDifferent', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  const rowCells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const allDiffHandler = new HandlerModule.AllDifferent(rowCells);

  const handlerSet = new HandlerSet([allDiffHandler], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));

  const perfect = handlerSet.getAllofType(HandlerModule.PerfectAllDifferent);
  assert.equal(perfect.length, 1);
  assert.deepEqual([...perfect[0].cells], rowCells);
});

await runTest('_addPerfectAllDifferentHandlers: skips when cell values exceed cell count', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // 6x6 grid with numValues=10.
  const shape = GridShape.fromGridSize(6, 6, 10);
  const numCells = shape.numGridCells;

  // Restrict cells to values 1-8 (8 values > 6 cells — not a house).
  const valueMap = new Map();
  for (let i = 0; i < numCells; i++) {
    valueMap.set(i, [1, 2, 3, 4, 5, 6, 7, 8]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  const rowCells = [0, 1, 2, 3, 4, 5];
  const allDiffHandler = new HandlerModule.AllDifferent(rowCells);

  const handlerSet = new HandlerSet(
    [givenHandler, allDiffHandler], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));
  assert.equal(
    handlerSet.getAllofType(HandlerModule.PerfectAllDifferent).length, 0);
});

await runTest('_addPerfectAllDifferentHandlers: promotes subset AllDifferent on standard grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // Standard 9x9 grid.
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  // 4 cells restricted to {1,2,3,4} via GivenCandidates.
  const subsetCells = [0, 1, 2, 3];
  const valueMap = new Map();
  for (const c of subsetCells) {
    valueMap.set(c, [1, 2, 3, 4]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);
  const allDiffHandler = new HandlerModule.AllDifferent(subsetCells);

  const handlerSet = new HandlerSet(
    [givenHandler, allDiffHandler], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));
  const perfect = handlerSet.getAllofType(HandlerModule.PerfectAllDifferent);
  assert.equal(perfect.length, 1);
  assert.deepEqual([...perfect[0].cells], subsetCells);
});

await runTest('_addPerfectAllDifferentHandlers: skips AllDifferent with 2 or fewer cells', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numCells = shape.numGridCells;

  // 2 cells restricted to {1,2} — would match but too small to be useful.
  const smallCells = [0, 1];
  const valueMap = new Map();
  for (const c of smallCells) {
    valueMap.set(c, [1, 2]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);
  const allDiffHandler = new HandlerModule.AllDifferent(smallCells);

  const handlerSet = new HandlerSet(
    [givenHandler, allDiffHandler], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));
  assert.equal(
    handlerSet.getAllofType(HandlerModule.PerfectAllDifferent).length, 0);
});

// =============================================================================
// _addGridHouseIntersections tests
// =============================================================================

await runTest('_addGridHouseIntersections: creates intersections for restricted grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // 6x6 grid with numValues=10 (values 0-9).
  const shape = GridShape.fromGridSize(6, 6, 10);
  const numCells = shape.numGridCells;

  // Restrict all cells to values 1-6 via GivenCandidates.
  const valueMap = new Map();
  for (let i = 0; i < numCells; i++) {
    valueMap.set(i, [1, 2, 3, 4, 5, 6]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  // Box regions for 6x6: 2x3 boxes.
  const boxRegions = SudokuConstraintBase.boxRegions(shape);

  // Add AllDifferent for row 0, row 1, box 0, and box 1.
  const row0 = [0, 1, 2, 3, 4, 5];
  const row1 = [6, 7, 8, 9, 10, 11];
  const handlers = [
    givenHandler,
    new HandlerModule.AllDifferent(row0),
    new HandlerModule.AllDifferent(row1),
    new HandlerModule.AllDifferent(boxRegions[0]),
    new HandlerModule.AllDifferent(boxRegions[1]),
  ];

  const handlerSet = new HandlerSet(handlers, numCells);

  // First promote to PerfectAllDifferent.
  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));
  assert.equal(
    handlerSet.getAllofType(HandlerModule.PerfectAllDifferent).length, 4);

  // Now test intersections with 2x3 box regions.
  optimizer._addGridHouseIntersections(handlerSet, boxRegions, shape);

  const sameValues = handlerSet.getAllofType(
    HandlerModule.SameValuesIgnoreCount);
  assert.ok(sameValues.length > 0,
    'should create SameValuesIgnoreCount for restricted grid');
});

await runTest('_addGridHouseIntersections: skips pairing handlers with different value masks', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(6, 6, 10);
  const numCells = shape.numGridCells;

  // Row 0 cells restricted to {1,2,3,4,5,6}.
  // Row 1 cells restricted to {4,5,6,7,8,9}.
  const valueMap = new Map();
  for (let i = 0; i < 6; i++) {
    valueMap.set(i, [1, 2, 3, 4, 5, 6]);
  }
  for (let i = 6; i < 12; i++) {
    valueMap.set(i, [4, 5, 6, 7, 8, 9]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  const row0 = [0, 1, 2, 3, 4, 5];
  const row1 = [6, 7, 8, 9, 10, 11];
  const allDiff0 = new HandlerModule.AllDifferent(row0);
  const allDiff1 = new HandlerModule.AllDifferent(row1);

  const handlerSet = new HandlerSet(
    [givenHandler, allDiff0, allDiff1], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, shape, optimizer._computeEffectiveValues(handlerSet, shape));
  const perfects = handlerSet.getAllofType(
    HandlerModule.PerfectAllDifferent);
  assert.equal(perfects.length, 2);
  // Verify they have different value masks.
  assert.notEqual(perfects[0].valueMask(), perfects[1].valueMask());

  const boxRegions = SudokuConstraintBase.boxRegions(shape);
  optimizer._addGridHouseIntersections(handlerSet, boxRegions, shape);

  // No SameValuesIgnoreCount should be created (different value masks).
  const sameValues = handlerSet.getAllofType(
    HandlerModule.SameValuesIgnoreCount);
  assert.equal(sameValues.length, 0,
    'should not pair handlers with different value masks');
});

logSuiteComplete('optimizer/all_different');
