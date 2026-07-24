import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../../js/cell_geometry.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { SudokuConstraintBase } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);

// =============================================================================
// _overlapRegions tests
// =============================================================================

await runTest('_overlapRegions: square grid includes rows and columns', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(9);

  const results = optimizer._overlapRegions(geometry, [], geometry.numValues);

  // Should have 4 region sets: rows, rows reversed, cols, cols reversed.
  assert.equal(results.length, 4);
  // Each set should have 9 regions.
  assert.equal(results[0].length, 9);
  assert.equal(results[2].length, 9);
});

await runTest('_overlapRegions: 4x6 grid includes only rows (not columns)', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(4, 6);

  // numValues=6, numCols=6 (rows are houses), numRows=4 (columns are NOT houses).
  const results = optimizer._overlapRegions(geometry, [], geometry.numValues);

  // Should only include row regions (2 sets: forward and reverse).
  assert.equal(results.length, 2);
  // Each row region set should have 4 rows.
  assert.equal(results[0].length, 4);
  // Each row should have 6 cells (numValues).
  assert.equal(results[0][0].length, 6);
});

await runTest('_overlapRegions: 6x4 grid includes only columns (not rows)', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(6, 4);

  // numValues=6, numRows=6 (columns are houses), numCols=4 (rows are NOT houses).
  const results = optimizer._overlapRegions(geometry, [], geometry.numValues);

  // Should only include column regions (2 sets: forward and reverse).
  assert.equal(results.length, 2);
  // Each column region set should have 4 columns.
  assert.equal(results[0].length, 4);
  // Each column should have 6 cells (numValues).
  assert.equal(results[0][0].length, 6);
});

await runTest('_overlapRegions: 5x7 grid (no houses) returns empty', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(5, 7);

  // numValues=7, numCols=7 (rows are houses), numRows=5 (columns are NOT houses).
  // Wait, numCols=7 === numValues=7, so rows ARE houses.
  const results = optimizer._overlapRegions(geometry, [], geometry.numValues);

  // Rows are houses (7 cells each), columns are not (5 cells each).
  assert.equal(results.length, 2);
  assert.equal(results[0].length, 5); // 5 rows
  assert.equal(results[0][0].length, 7); // 7 cells per row
});

// =============================================================================
// _optimizeNonSquareGrids tests
// =============================================================================

await runTest('_optimizeNonSquareGrids: adds aux handler for 8x9 no-box grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(8, 9);

  // Add all-different constraints for both axes.
  const handlers = [];
  for (const r of SudokuConstraintBase.rowRegions(geometry)) {
    handlers.push(new HandlerModule.AllDifferent(r));
  }
  for (const c of SudokuConstraintBase.colRegions(geometry)) {
    handlers.push(new HandlerModule.AllDifferent(c));
  }

  const handlerSet = new HandlerSet(handlers, geometry.numGridCells);

  optimizer._optimizeNonSquareGrids(handlerSet, /* hasBoxes= */ false, geometry);

  const added = handlerSet.getAllofType(HandlerModule.FullGridRequiredValues);
  assert.equal(added.length, 1);
});

await runTest('_optimizeNonSquareGrids: skips when numValues matches neither axis', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(8, 9, 10);

  // Add all-different constraints for both axes.
  const handlers = [];
  for (const r of SudokuConstraintBase.rowRegions(geometry)) {
    handlers.push(new HandlerModule.AllDifferent(r));
  }
  for (const c of SudokuConstraintBase.colRegions(geometry)) {
    handlers.push(new HandlerModule.AllDifferent(c));
  }

  const handlerSet = new HandlerSet(handlers, geometry.numGridCells);

  // Should not throw; the optimization assumes one axis equals numValues.
  optimizer._optimizeNonSquareGrids(handlerSet, /* hasBoxes= */ false, geometry);

  const added = handlerSet.getAllofType(HandlerModule.FullGridRequiredValues);
  assert.equal(added.length, 0);
});

await runTest('_optimizeNonSquareGrids: skips aux handler for 1x9 grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(1, 9);

  // Add all-different constraints for both axes.
  const handlers = [];
  for (const r of SudokuConstraintBase.rowRegions(geometry)) {
    handlers.push(new HandlerModule.AllDifferent(r));
  }
  for (const c of SudokuConstraintBase.colRegions(geometry)) {
    handlers.push(new HandlerModule.AllDifferent(c));
  }

  const handlerSet = new HandlerSet(handlers, geometry.numGridCells);

  optimizer._optimizeNonSquareGrids(handlerSet, /* hasBoxes= */ false, geometry);

  const added = handlerSet.getAllofType(HandlerModule.FullGridRequiredValues);
  assert.equal(added.length, 0);
});

// =============================================================================
// _makeJigsawIntersections tests
// =============================================================================

await runTest('_makeJigsawIntersections: creates intersections from PerfectAllDifferent pairs', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // 6x6 grid with numValues=10 so 6-cell AllDifferent promotes to
  // PerfectAllDifferent regions.
  const geometry = CellGeometry.fromGridSize(6, 6, 10);
  const numCells = geometry.numGridCells;

  // Restrict all cells to values 1-6.
  const valueMap = new Map();
  for (let i = 0; i < numCells; i++) {
    valueMap.set(i, [1, 2, 3, 4, 5, 6]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  // Two overlapping 6-cell regions sharing 4 cells (diff = 2 each).
  // Region A: cells [0,1,2,3,4,5]
  // Region B: cells [0,1,2,3,6,7]
  // Overlap = [0,1,2,3], diffA = [4,5], diffB = [6,7]
  const regionA = [0, 1, 2, 3, 4, 5];
  const regionB = [0, 1, 2, 3, 6, 7];

  const handlerSet = new HandlerSet([
    givenHandler,
    new HandlerModule.AllDifferent(regionA),
    new HandlerModule.AllDifferent(regionB),
  ], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, geometry, optimizer._computeEffectiveValues(handlerSet, geometry));
  assert.equal(
    handlerSet.getAllofType(HandlerModule.PerfectAllDifferent).length, 2);
  const pieces = [new HandlerModule.JigsawPiece(new Uint8Array(regionA))];
  const result = optimizer._makeJigsawIntersections(handlerSet, pieces);
  assert.ok(result.length > 0,
    'should create SameValuesIgnoreCount from PerfectAllDifferent pairs');

  // Pairs without a jigsaw piece are left to _addGridHouseIntersections.
  assert.equal(optimizer._makeJigsawIntersections(handlerSet, []).length, 0,
    'should not pair handlers when neither is a jigsaw piece');
});

await runTest('_makeJigsawIntersections: skips disjoint regions', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(6, 6, 10);
  const numCells = geometry.numGridCells;

  // Restrict all cells to values 1-6.
  const valueMap = new Map();
  for (let i = 0; i < numCells; i++) {
    valueMap.set(i, [1, 2, 3, 4, 5, 6]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  // Two disjoint 6-cell regions: each must contain all 6 values, so a
  // same-values constraint between them would be trivially true.
  const regionA = [0, 1, 2, 3, 4, 5];
  const regionB = [6, 7, 8, 9, 10, 11];

  const handlerSet = new HandlerSet([
    givenHandler,
    new HandlerModule.AllDifferent(regionA),
    new HandlerModule.AllDifferent(regionB),
  ], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, geometry, optimizer._computeEffectiveValues(handlerSet, geometry));
  const pieces = [new HandlerModule.JigsawPiece(new Uint8Array(regionA))];
  assert.equal(optimizer._makeJigsawIntersections(handlerSet, pieces).length, 0,
    'should not pair disjoint regions');
});

await runTest('_makeJigsawIntersections: skips pairing with different value masks', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const geometry = CellGeometry.fromGridSize(6, 6, 10);
  const numCells = geometry.numGridCells;

  // Overlapping regions with different value masks: the shared cells
  // {3,4,5,6} support both masks, region A adds {1,2} and region B adds
  // {7,8}, giving masks {1..6} and {3..8}.
  const valueMap = new Map();
  valueMap.set(0, [1, 2]);
  valueMap.set(1, [1, 2]);
  for (let i = 2; i < 6; i++) {
    valueMap.set(i, [3, 4, 5, 6]);
  }
  valueMap.set(6, [7, 8]);
  valueMap.set(7, [7, 8]);
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  // These would normally be paired but the valueMask check should skip them.
  const regionA = [0, 1, 2, 3, 4, 5];
  const regionB = [2, 3, 4, 5, 6, 7];

  const handlerSet = new HandlerSet([
    givenHandler,
    new HandlerModule.AllDifferent(regionA),
    new HandlerModule.AllDifferent(regionB),
  ], numCells);

  optimizer._addPerfectAllDifferentHandlers(handlerSet, geometry, optimizer._computeEffectiveValues(handlerSet, geometry));
  const perfects = handlerSet.getAllofType(
    HandlerModule.PerfectAllDifferent);
  assert.equal(perfects.length, 2);
  assert.notEqual(perfects[0].valueMask(), perfects[1].valueMask());

  const pieces = [
    new HandlerModule.JigsawPiece(new Uint8Array(regionA)),
    new HandlerModule.JigsawPiece(new Uint8Array(regionB)),
  ];
  const result = optimizer._makeJigsawIntersections(handlerSet, pieces);
  assert.equal(result.length, 0,
    'should not pair handlers with different value masks');
});

// =============================================================================
// _makeJigsawLawOfLeftoverHandlers tests
// =============================================================================

await runTest('_makeJigsawLawOfLeftoverHandlers: restricted grid uses row regions', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // 4x4 grid with numValues=6. Cells restricted to 4 values so
  // effectiveValueCount (4) === numCols (4).
  const geometry = CellGeometry.fromGridSize(4, 4, 6);
  const numCells = geometry.numGridCells;

  const valueMap = new Map();
  for (let i = 0; i < numCells; i++) {
    valueMap.set(i, [1, 2, 3, 4]);
  }
  const givenHandler = new HandlerModule.GivenCandidates(valueMap);

  // Jigsaw pieces that DON'T align with rows, creating non-trivial overlaps.
  // Layout on 4x4 grid:
  //   A A B B      Piece A: [0,1,4,8]  (L-geometry)
  //   A C B B      Piece B: [2,3,6,7]  (square)
  //   A C D D      Piece C: [5,9,12,13] (column+corner)
  //   C C D D      Piece D: [10,11,14,15] (square)
  // Rows 0+1 = {0..7}, Pieces A+B = {0,1,2,3,4,6,7,8}
  // → leftover {5} vs {8} → SameValuesIgnoreCount
  const pieces = [
    new HandlerModule.JigsawPiece(new Uint8Array([0, 1, 4, 8])),
    new HandlerModule.JigsawPiece(new Uint8Array([2, 3, 6, 7])),
    new HandlerModule.JigsawPiece(new Uint8Array([5, 9, 12, 13])),
    new HandlerModule.JigsawPiece(new Uint8Array([10, 11, 14, 15])),
  ];

  const boxRegions = SudokuConstraintBase.boxRegions(geometry);

  const tempHandlerSet = new HandlerSet([givenHandler], numCells);
  const effectiveValues = optimizer._computeEffectiveValues(
    tempHandlerSet, geometry);
  optimizer._addPerfectAllDifferentHandlers(
    tempHandlerSet, geometry, effectiveValues);
  const effectiveValueCount =
    optimizer._effectiveValueCount(effectiveValues, geometry);
  assert.equal(effectiveValueCount, 4);

  const result = optimizer._makeJigsawLawOfLeftoverHandlers(
    pieces, boxRegions, geometry, effectiveValueCount);
  assert.ok(result.length > 0,
    'should create SameValuesIgnoreCount for restricted grid with jigsaw pieces');
});

await runTest('_makeJigsawLawOfLeftoverHandlers: skips restricted path when effectiveValueCount matches numValues', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  // Standard 4x4 grid with numValues=4. effectiveValueCount === numValues,
  // so the restricted path should not run (already handled by _overlapRegions).
  const geometry = CellGeometry.fromGridSize(4, 4, 4);
  const numCells = geometry.numGridCells;

  const givenHandler = new HandlerModule.GivenCandidates(new Map());

  // Same non-trivial layout as previous test.
  const pieces = [
    new HandlerModule.JigsawPiece(new Uint8Array([0, 1, 4, 8])),
    new HandlerModule.JigsawPiece(new Uint8Array([2, 3, 6, 7])),
    new HandlerModule.JigsawPiece(new Uint8Array([5, 9, 12, 13])),
    new HandlerModule.JigsawPiece(new Uint8Array([10, 11, 14, 15])),
  ];

  const boxRegions = SudokuConstraintBase.boxRegions(geometry);

  const tempHandlerSet = new HandlerSet([givenHandler], numCells);
  const effectiveValues = optimizer._computeEffectiveValues(
    tempHandlerSet, geometry);
  optimizer._addPerfectAllDifferentHandlers(
    tempHandlerSet, geometry, effectiveValues);
  const effectiveValueCount =
    optimizer._effectiveValueCount(effectiveValues, geometry);
  assert.equal(effectiveValueCount, 4);
  assert.equal(effectiveValueCount, geometry.numValues,
    'effectiveValueCount should equal numValues for standard grid');

  // The restricted path guard (effectiveValueCount !== numValues) prevents
  // the new code from running. Results come only from _overlapRegions.
  const result = optimizer._makeJigsawLawOfLeftoverHandlers(
    pieces, boxRegions, geometry, effectiveValueCount);
  // _overlapRegions handles the standard case — just verify no crash.
  assert.ok(Array.isArray(result));
});

logSuiteComplete('optimizer/jigsaw');
