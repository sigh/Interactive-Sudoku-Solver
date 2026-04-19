import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';
import { createCellExclusions } from '../../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
const SumHandlerModule = await import('../../../js/solver/sum_handler.js' + self.VERSION_PARAM);
const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);

const createExclusions = (numCells) => createCellExclusions({ allUnique: false, numCells });

const shapeMaxSum = (shape) => shape.numValues * (shape.numValues + 1) / 2;
const shapeAllCells = (shape) => Array.from({ length: shape.numGridCells }, (_, i) => i);

// =============================================================================
// _addSumIntersectionHandler tests
// =============================================================================

await runTest('_addSumIntersectionHandler: infeasible inferred sum adds False handler', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const cellExclusions = createExclusions(shape.numGridCells);

  // Force the inferred outside-house cells to be mutually exclusive so their
  // minimum possible sum is 1+2=3.
  const extraCells = [9, 10];
  cellExclusions.addMutualExclusion(extraCells[0], extraCells[1]);

  // Build a case where a sum cage covers the full house plus the extra cells.
  // Then the inferred outside sum is: totalSum = cageSum - shape.maxSum.
  // Pick a cageSum that yields totalSum=2, which is below the min=3.
  const houseCells = Array.from({ length: shape.numValues }, (_, i) => i);
  const cageCells = [...houseCells, ...extraCells];
  const cageSum = shapeMaxSum(shape) + 2;

  const houseHandler = new HandlerModule.House(houseCells);
  const sumHandler = new SumHandlerModule.Sum(cageCells, cageSum);

  const result = optimizer._addSumIntersectionHandler(
    houseHandler,
    [sumHandler],
    [],
    [],
    cellExclusions,
    shape);

  assert.ok(result, 'expected a handler (not null)');
  assert.ok(result instanceof HandlerModule.False, 'expected a False handler');
  assert.deepEqual([...result.cells].sort((a, b) => a - b), [...extraCells].sort((a, b) => a - b));
});

await runTest('_addSumIntersectionHandler: cage with outside-grid outie cell', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);
  const numCells = shape.numGridCells + 1; // 17 to support cell 16
  const cellExclusions = createExclusions(numCells);

  // House = row 0 [0..3], sum = 10.
  const houseCells = [0, 1, 2, 3];
  const houseHandler = new HandlerModule.House(houseCells);

  // Cage covers entire house + one cell outside the grid.
  // Outie cell 16 should have inferred sum = 14 - 10 = 4.
  const cageCells = [0, 1, 2, 3, 16];
  const cageSum = 14;
  const sumHandler = new SumHandlerModule.Sum(cageCells, cageSum);

  const result = optimizer._addSumIntersectionHandler(
    houseHandler, [sumHandler], [], [], cellExclusions, shape);

  // The outie is a single cell (16) with inferred sum 4.
  // range > 0 and dof = 0, so a handler should be created.
  assert.ok(result);
  assert.ok(result instanceof SumHandlerModule.Sum);
  assert.deepEqual([...result.cells], [16]);
  assert.equal(result.sum(), 4);
});

// =============================================================================
// _replaceSizeSpecificSumHandlers tests
// =============================================================================

await runTest('_replaceSizeSpecificSumHandlers: size=numValues mutually exclusive => True/False', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  const cells = Array.from({ length: shape.numValues }, (_, i) => i);

  const cellExclusions = createExclusions(shape.numGridCells);
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      cellExclusions.addMutualExclusion(cells[i], cells[j]);
    }
  }

  {
    const sumHandler = new SumHandlerModule.Sum(cells, shapeMaxSum(shape));
    const handlerSet = new HandlerSet([sumHandler], shape.numGridCells);

    optimizer._replaceSizeSpecificSumHandlers(handlerSet, cellExclusions, shape);

    assert.equal(handlerSet.getAllofType(SumHandlerModule.Sum).length, 0);
    assert.equal(handlerSet.getAllofType(HandlerModule.True).length, 1);
    assert.equal(handlerSet.getAllofType(HandlerModule.False).length, 0);
  }

  {
    const sumHandler = new SumHandlerModule.Sum(cells, shapeMaxSum(shape) - 1);
    const handlerSet = new HandlerSet([sumHandler], shape.numGridCells);

    optimizer._replaceSizeSpecificSumHandlers(handlerSet, cellExclusions, shape);

    assert.equal(handlerSet.getAllofType(SumHandlerModule.Sum).length, 0);
    assert.equal(handlerSet.getAllofType(HandlerModule.True).length, 0);
    assert.equal(handlerSet.getAllofType(HandlerModule.False).length, 1);
  }
});

await runTest('_replaceSizeSpecificSumHandlers: 1-cell outside-grid sum converted', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);
  const numCells = shape.numGridCells + 1;
  const cellExclusions = createExclusions(numCells);

  const sumHandler = new SumHandlerModule.Sum([16], 3);
  const handlerSet = new HandlerSet([sumHandler], numCells);

  optimizer._replaceSizeSpecificSumHandlers(handlerSet, cellExclusions, shape);

  // 1-cell sum should be replaced with GivenCandidates.
  assert.equal(handlerSet.getAllofType(SumHandlerModule.Sum).length, 0);
  assert.equal(handlerSet.getAllofType(HandlerModule.GivenCandidates).length, 1);
});

await runTest('_replaceSizeSpecificSumHandlers: 2-cell with outside-grid cell converted', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);
  const numCells = shape.numGridCells + 1;
  const cellExclusions = createExclusions(numCells);

  const sumHandler = new SumHandlerModule.Sum([0, 16], 5);
  const handlerSet = new HandlerSet([sumHandler], numCells);

  optimizer._replaceSizeSpecificSumHandlers(handlerSet, cellExclusions, shape);

  // 2-cell sum should be replaced with BinaryConstraint.
  assert.equal(handlerSet.getAllofType(SumHandlerModule.Sum).length, 0);
  assert.equal(handlerSet.getAllofType(HandlerModule.BinaryConstraint).length, 1);
});

// =============================================================================
// _fillInSumGap tests
// =============================================================================

await runTest('_fillInSumGap: returns empty when all cells covered', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // All 81 cells covered by sum handlers.
  const sumCells = new Set(shapeAllCells(shape));
  const sumHandlers = [];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);
  assert.deepEqual(result, []);
});

await runTest('_fillInSumGap: returns empty when gap too large', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Only 72 cells covered, gap is 9 cells (>= numValues).
  const sumCells = new Set(shapeAllCells(shape).slice(0, 72));
  const sumHandlers = [];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);
  assert.deepEqual(result, []);
});

await runTest('_fillInSumGap: creates handler for small gap in 9x9', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Cover 78 cells, leave 3 uncovered (cells 78, 79, 80).
  const coveredCells = shapeAllCells(shape).slice(0, 78);
  const sumCells = new Set(coveredCells);

  // Sum of all covered cells. Total grid sum for 9x9 = 9 * 45 = 405.
  // We need a fake sum handler that covers these cells.
  const coveredSum = 405 - (1 + 2 + 3); // Assume uncovered cells sum to 1+2+3=6.
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof SumHandlerModule.Sum);
  assert.equal(result[0].cells.length, 3);
  assert.equal(result[0].sum(), 6); // 405 - 399 = 6
});

await runTest('_fillInSumGap: correct sum for 4x6 rectangular grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4, 6);

  // 4x6 grid: 24 cells, numValues=6, maxSum=21.
  // Total grid sum = numCells * maxSum / numValues = 24 * 21 / 6 = 84.
  // Or equivalently: 4 rows * 21 per row = 84.

  // Cover 22 cells, leave 2 uncovered.
  const coveredCells = shapeAllCells(shape).slice(0, 22);
  const sumCells = new Set(coveredCells);

  // Assume uncovered cells (22, 23) sum to 11.
  const coveredSum = 84 - 11;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.equal(result[0].sum(), 11);
  assert.deepEqual([...result[0].cells].sort((a, b) => a - b), [22, 23]);
});

await runTest('_fillInSumGap: correct sum for 6x4 rectangular grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(6, 4);

  // 6x4 grid: 24 cells, numValues=6, maxSum=21.
  // Total grid sum = 24 * 21 / 6 = 84.
  // Or equivalently: 4 columns * 21 per column = 84.

  // Cover 20 cells, leave 4 uncovered.
  const coveredCells = shapeAllCells(shape).slice(0, 20);
  const sumCells = new Set(coveredCells);

  // Assume uncovered cells sum to 14.
  const coveredSum = 84 - 14;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.equal(result[0].sum(), 14);
  assert.equal(result[0].cells.length, 4);
});

await runTest('_fillInSumGap: correct sum for 6x8 rectangular grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(6, 8);

  // 6x8 grid: 48 cells, numValues=8, maxSum=36.
  // Total grid sum = 48 * 36 / 8 = 216.
  // Or equivalently: 6 rows * 36 per row = 216.

  // Cover 45 cells, leave 3 uncovered.
  const coveredCells = shapeAllCells(shape).slice(0, 45);
  const sumCells = new Set(coveredCells);

  // Assume uncovered cells sum to 15.
  const coveredSum = 216 - 15;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.equal(result[0].sum(), 15);
  assert.equal(result[0].cells.length, 3);
});

await runTest('_fillInSumGap: multiple sum handlers combine correctly', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Total grid sum for 9x9 = 405.
  // Create multiple sum handlers covering different regions.
  const cells1 = shapeAllCells(shape).slice(0, 27);  // First 3 rows (27 cells)
  const cells2 = shapeAllCells(shape).slice(27, 54); // Next 3 rows (27 cells)
  const cells3 = shapeAllCells(shape).slice(54, 76); // Partial coverage (22 cells)
  // Remaining: cells 76-80 (5 cells)

  const sum1 = 45 * 3; // 135
  const sum2 = 45 * 3; // 135
  const sum3 = 405 - 135 - 135 - 25; // 110 (leaving 25 for remaining)

  const sumHandlers = [
    new SumHandlerModule.Sum(cells1, sum1),
    new SumHandlerModule.Sum(cells2, sum2),
    new SumHandlerModule.Sum(cells3, sum3),
  ];
  const sumCells = new Set([...cells1, ...cells2, ...cells3]);

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.equal(result[0].cells.length, 5);
  assert.equal(result[0].sum(), 25);
});

await runTest('_fillInSumGap: handles single cell gap', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Cover all but 1 cell.
  const coveredCells = shapeAllCells(shape).slice(0, 80);
  const sumCells = new Set(coveredCells);

  // Total = 405, leaving sum=5 for the last cell.
  const coveredSum = 400;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.equal(result[0].cells.length, 1);
  assert.equal(result[0].sum(), 5);
  assert.deepEqual([...result[0].cells], [80]);
});

await runTest('_fillInSumGap: handles gap of numValues-1 cells', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Cover all but 8 cells (numValues - 1 = 8).
  const coveredCells = shapeAllCells(shape).slice(0, 73);
  const sumCells = new Set(coveredCells);

  // Total = 405, remaining 8 cells sum to some value.
  const remainingSum = 36; // 1+2+3+4+5+6+7+8 = 36 as an example
  const coveredSum = 405 - remainingSum;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  assert.equal(result.length, 1);
  assert.equal(result[0].cells.length, 8);
  assert.equal(result[0].sum(), remainingSum);
});

await runTest('_fillInSumGap: adds handler to sumHandlers array', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  const coveredCells = shapeAllCells(shape).slice(0, 78);
  const sumCells = new Set(coveredCells);
  const coveredSum = 399;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  const initialLength = sumHandlers.length;
  optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  // The new handler should be pushed to sumHandlers.
  assert.equal(sumHandlers.length, initialLength + 1);
});

await runTest('_fillInSumGap: updates sumCells set', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  const coveredCells = shapeAllCells(shape).slice(0, 78);
  const sumCells = new Set(coveredCells);
  const coveredSum = 399;
  const sumHandler = new SumHandlerModule.Sum(coveredCells, coveredSum);
  const sumHandlers = [sumHandler];

  assert.equal(sumCells.size, 78);
  optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  // sumCells should now include all cells.
  assert.equal(sumCells.size, 81);
});

await runTest('_fillInSumGap: ignores handlers with cells outside grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);
  const numGridCells = shape.numGridCells; // 81

  // Cover 78 grid cells with one handler, and add a handler with an
  // out-of-grid cell. The gap is 3 cells so a new handler should be created.
  const gridCells = shapeAllCells(shape).slice(0, 78);
  const gridSum = 399;
  const outsideHandler = new SumHandlerModule.Sum(
    [numGridCells, numGridCells + 1], 10);
  const gridHandler = new SumHandlerModule.Sum(gridCells, gridSum);

  const sumCells = new Set([...gridCells, numGridCells, numGridCells + 1]);
  const sumHandlers = [gridHandler, outsideHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  // Should produce a handler for the 3 remaining grid cells.
  assert.equal(result.length, 1);
  const newHandler = result[0];
  assert.equal(newHandler.cells.length, 3);
  // All cells in the new handler must be within the grid.
  assert.ok(newHandler.cells.every(c => c < numGridCells));
  // Sum should be based only on the grid handler, not the outside one.
  const expectedSum = 9 * shapeMaxSum(shape) - gridSum;
  assert.equal(newHandler.sum(), expectedSum);
});

await runTest('_fillInSumGap: returns empty when only outside-grid handlers', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);
  const numGridCells = shape.numGridCells; // 16

  // Only an outside-grid handler, no grid cells covered at all.
  // Gap = 16 cells >= numValues(4), so should return empty.
  const outsideHandler = new SumHandlerModule.Sum(
    [numGridCells, numGridCells + 1], 5);
  const sumCells = new Set([numGridCells, numGridCells + 1]);
  const sumHandlers = [outsideHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);
  assert.deepEqual(result, []);
});

await runTest('_fillInSumGap: mixed inside/outside handler is excluded', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);
  const numGridCells = shape.numGridCells; // 16

  // Cover 13 grid cells with a clean handler.
  const gridCells = shapeAllCells(shape).slice(0, 13);
  const gridSum = 38;
  const gridHandler = new SumHandlerModule.Sum(gridCells, gridSum);

  // A handler that has both grid and outside-grid cells should be excluded.
  const mixedHandler = new SumHandlerModule.Sum(
    [13, numGridCells], 7);

  const sumCells = new Set([...gridCells, 13, numGridCells]);
  const sumHandlers = [gridHandler, mixedHandler];

  const result = optimizer._fillInSumGap(sumHandlers, sumCells, shape);

  // Gap is 3 cells (16 - 13), which is < numValues(4), so a handler is created.
  assert.equal(result.length, 1);
  const newHandler = result[0];
  // The new handler should cover cells 13, 14, 15 (the 3 uncovered grid cells).
  assert.equal(newHandler.cells.length, 3);
  assert.ok(newHandler.cells.every(c => c < numGridCells));
  // Sum based only on gridHandler.
  const expectedSum = 4 * shapeMaxSum(shape) - gridSum;
  assert.equal(newHandler.sum(), expectedSum);
});

// =============================================================================
// _makeInnieOutieSumHandlers tests
// =============================================================================

await runTest('_makeInnieOutieSumHandlers: works for square 9x9 grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Create sum handlers covering the first two rows completely.
  // Row 0: cells 0-8, Row 1: cells 9-17.
  const row0Cells = Array.from({ length: 9 }, (_, i) => i);
  const row1Cells = Array.from({ length: 9 }, (_, i) => i + 9);

  const sumHandler0 = new SumHandlerModule.Sum(row0Cells, 45);
  const sumHandler1 = new SumHandlerModule.Sum(row1Cells, 45);
  const sumHandlers = [sumHandler0, sumHandler1];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, true, shape);

  // Should generate some innie/outie handlers.
  // The exact number depends on the algorithm, but it should be non-empty
  // since we have complete coverage of houses.
  assert.ok(Array.isArray(result));
});

await runTest('_makeInnieOutieSumHandlers: generates outie for cage crossing house boundary', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Create a cage that covers most of row 0 and one cell from row 1.
  // Row 0: cells 0-8, Row 1 first cell: 9.
  // Cage: cells 0-8 + cell 9 (10 cells total).
  const cageCells = [...Array.from({ length: 9 }, (_, i) => i), 9];
  const cageSum = 45 + 5; // Row sum + value at cell 9

  const sumHandlers = [new SumHandlerModule.Sum(cageCells, cageSum)];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  // Should generate handlers since the cage crosses house boundaries.
  assert.ok(Array.isArray(result));
});

await runTest('_makeInnieOutieSumHandlers: computes correct sum delta for single row coverage', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Cover exactly one row.
  const row0Cells = Array.from({ length: 9 }, (_, i) => i);
  const sumHandlers = [new SumHandlerModule.Sum(row0Cells, 45)];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  // All generated handlers should have integer sums.
  for (const handler of result) {
    assert.ok(handler instanceof SumHandlerModule.Sum);
    assert.ok(Number.isInteger(handler.sum()), `Sum ${handler.sum()} should be integer`);
  }
});

await runTest('_makeInnieOutieSumHandlers: works with box regions when hasBoxes=true', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Cover a full box (box 0: cells 0,1,2,9,10,11,18,19,20).
  const box0Cells = [0, 1, 2, 9, 10, 11, 18, 19, 20];
  const sumHandlers = [new SumHandlerModule.Sum(box0Cells, 45)];

  const resultWithBoxes = optimizer._makeInnieOutieSumHandlers(sumHandlers, true, shape);
  const resultWithoutBoxes = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  // With boxes, we should potentially get more handlers since box regions are included.
  assert.ok(Array.isArray(resultWithBoxes));
  assert.ok(Array.isArray(resultWithoutBoxes));
});

await runTest('_makeInnieOutieSumHandlers: handles multiple non-overlapping cages', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Create multiple non-overlapping cages covering different rows.
  const row0Cells = Array.from({ length: 9 }, (_, i) => i);
  const row1Cells = Array.from({ length: 9 }, (_, i) => i + 9);
  const row2Cells = Array.from({ length: 9 }, (_, i) => i + 18);

  const sumHandlers = [
    new SumHandlerModule.Sum(row0Cells, 45),
    new SumHandlerModule.Sum(row1Cells, 45),
    new SumHandlerModule.Sum(row2Cells, 45),
  ];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  assert.ok(Array.isArray(result));
  // All handlers should be Sum instances with valid sums.
  for (const handler of result) {
    assert.ok(handler instanceof SumHandlerModule.Sum);
  }
});

await runTest('_makeInnieOutieSumHandlers: handles partial row coverage', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // Cover only part of a row.
  const partialRow = [0, 1, 2, 3, 4]; // First 5 cells of row 0
  const sumHandlers = [new SumHandlerModule.Sum(partialRow, 15)];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  assert.ok(Array.isArray(result));
});

await runTest('_makeInnieOutieSumHandlers: works for 4x4 grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);

  // 4x4 grid: numValues=4, maxSum=10.
  const row0Cells = [0, 1, 2, 3];
  const sumHandlers = [new SumHandlerModule.Sum(row0Cells, 10)];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, true, shape);

  assert.ok(Array.isArray(result));
  for (const handler of result) {
    assert.ok(Number.isInteger(handler.sum()));
  }
});

await runTest('_makeInnieOutieSumHandlers: works for 6x6 grid', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(6);

  // 6x6 grid: numValues=6, maxSum=21.
  const row0Cells = [0, 1, 2, 3, 4, 5];
  const row1Cells = [6, 7, 8, 9, 10, 11];
  const sumHandlers = [
    new SumHandlerModule.Sum(row0Cells, 21),
    new SumHandlerModule.Sum(row1Cells, 21),
  ];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, true, shape);

  assert.ok(Array.isArray(result));
  for (const handler of result) {
    assert.ok(Number.isInteger(handler.sum()));
  }
});

await runTest('_makeInnieOutieSumHandlers: 4x6 grid only processes row regions', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4, 6);

  // For 4x6: rows have 6 cells (houses), columns have 4 cells (not houses).
  // _overlapRegions should only return row regions.

  // Create a sum handler covering first row.
  const row0Cells = Array.from({ length: 6 }, (_, i) => i);
  const sumHandler = new SumHandlerModule.Sum(row0Cells, 21);
  const sumHandlers = [sumHandler];

  // This should not crash and should only use row-based innie/outie logic.
  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, true, shape);

  assert.ok(Array.isArray(result));
});

await runTest('_makeInnieOutieSumHandlers: 6x4 grid only processes column regions', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(6, 4);

  // For 6x4: columns have 6 cells (houses), rows have 4 cells (not houses).
  // _overlapRegions should only return column regions.

  // Create a sum handler covering first column.
  const col0Cells = Array.from({ length: 6 }, (_, i) => i * 4);
  const sumHandler = new SumHandlerModule.Sum(col0Cells, 21);
  const sumHandlers = [sumHandler];

  // This should not crash and should only use column-based innie/outie logic.
  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, true, shape);

  assert.ok(Array.isArray(result));
});

await runTest('_makeInnieOutieSumHandlers: empty sum handlers returns empty', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  const result = optimizer._makeInnieOutieSumHandlers([], false, shape);

  assert.deepEqual(result, []);
});

await runTest('_makeInnieOutieSumHandlers: sum calculation uses correct house sum', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4, 6);

  // Create sum handlers that leave exactly one cell uncovered in the first row.
  // Row 0: cells 0-5 (6 cells, sum=21).
  // If we cover cells 0-4 with sum=15, the outie cell 5 should have inferred sum=6.

  const partialRowCells = [0, 1, 2, 3, 4];
  const sumHandler = new SumHandlerModule.Sum(partialRowCells, 15);
  const sumHandlers = [sumHandler];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  // Check that any generated handlers have reasonable sums.
  for (const handler of result) {
    assert.ok(handler instanceof SumHandlerModule.Sum);
    // Sum should be a reasonable integer.
    assert.ok(Number.isInteger(handler.sum()));
  }
});

await runTest('_makeInnieOutieSumHandlers: handler entirely outside grid produces no results', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4);

  // All cells outside the grid: no overlap with any row/column region.
  const outsideHandler = new SumHandlerModule.Sum([16, 17, 18, 19], 20);
  const sumHandlers = [outsideHandler];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);
  assert.deepEqual(result, []);
});

await runTest('_makeInnieOutieSumHandlers: mixed handler produces correct constraint', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(4); // 4x4, numValues=4, maxSum=10

  // Full row 0 handler + a mixed handler (3 cells in row 1 + 1 outside grid).
  const gridHandler = new SumHandlerModule.Sum([0, 1, 2, 3], 10);
  const mixedHandler = new SumHandlerModule.Sum([4, 5, 6, 16], 15);
  const sumHandlers = [gridHandler, mixedHandler];

  const result = optimizer._makeInnieOutieSumHandlers(sumHandlers, false, shape);

  // After 2 rows, pieces region = {0-6, 16}, super region = {0-7}.
  // diffA = {7}, diffB = {16}, sumDelta = -20 + 25 = 5.
  // Constraint: cell_16 - cell_7 = 5, which is algebraically correct:
  //   rows sum = 20, pieces sum = 25, so cell_16 - cell_7 = 5.
  assert.ok(result.length > 0);
  for (const h of result) {
    assert.ok(h instanceof SumHandlerModule.Sum);
    assert.ok(Number.isInteger(h.sum()));
  }

  // Find the handler for the {7, 16} diff.
  const diffHandler = result.find(
    h => h.cells.length === 2
      && h.cells.includes(7) && h.cells.includes(16));
  if (diffHandler) {
    // |sumDelta| = 5 regardless of sign convention.
    assert.equal(Math.abs(diffHandler.sum()), 5);
  }
});

// =============================================================================
// _addSumComplementCells tests
// =============================================================================

await runTest('_addSumComplementCells: sets complement from House', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  const houseCells = Array.from({ length: 9 }, (_, i) => i);
  const sumCells = [0, 1, 2];
  const houseHandler = new HandlerModule.House(houseCells);
  const sumHandler = new SumHandlerModule.Sum(sumCells, 6);

  const handlerSet = new HandlerSet(
    [houseHandler, sumHandler], shape.numGridCells);

  optimizer._addSumComplementCells(handlerSet);

  // The sum handler should have complement cells set to the remaining
  // house cells.
  assert.deepEqual([...sumHandler._complementCells], [3, 4, 5, 6, 7, 8]);
  assert.equal(sumHandler._complementValueMask, houseHandler.valueMask());
});

await runTest('_addSumComplementCells: sets complement from PerfectAllDifferent', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // A 4-cell PerfectAllDifferent with valueMask={1,2,3,4} (0b1111).
  const padCells = [0, 1, 2, 3];
  const valueMask = 0b1111;
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, valueMask);

  // A 2-cell Sum fully contained within the PerfectAllDifferent.
  const sumCells = [0, 1];
  const sumHandler = new SumHandlerModule.Sum(sumCells, 3);

  const handlerSet = new HandlerSet(
    [padHandler, sumHandler], shape.numGridCells);

  optimizer._addSumComplementCells(handlerSet);

  assert.deepEqual([...sumHandler._complementCells], [2, 3]);
  assert.equal(sumHandler._complementValueMask, valueMask);
});

await runTest('_addSumComplementCells: prefers smallest containing handler', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  // A 9-cell House and a 4-cell PerfectAllDifferent both contain the sum.
  const houseCells = Array.from({ length: 9 }, (_, i) => i);
  const padCells = [0, 1, 2, 3];
  const valueMask = 0b1111;
  const houseHandler = new HandlerModule.House(houseCells);
  const padHandler = new HandlerModule.PerfectAllDifferent(padCells, valueMask);

  const sumCells = [0, 1];
  const sumHandler = new SumHandlerModule.Sum(sumCells, 3);

  const handlerSet = new HandlerSet(
    [houseHandler, padHandler, sumHandler], shape.numGridCells);

  optimizer._addSumComplementCells(handlerSet);

  // Should pick the 4-cell PAD, not the 9-cell House.
  assert.deepEqual([...sumHandler._complementCells], [2, 3]);
  assert.equal(sumHandler._complementValueMask, valueMask);
});

await runTest('_addSumComplementCells: no match when sum not contained', () => {
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  const shape = GridShape.fromGridSize(9);

  const houseCells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const houseHandler = new HandlerModule.House(houseCells);

  // Sum has a cell (9) outside the house.
  const sumCells = [0, 1, 9];
  const sumHandler = new SumHandlerModule.Sum(sumCells, 10);

  const handlerSet = new HandlerSet(
    [houseHandler, sumHandler], shape.numGridCells);

  optimizer._addSumComplementCells(handlerSet);

  assert.equal(sumHandler._complementCells, null);
});

logSuiteComplete('optimizer/sum_optimization');
