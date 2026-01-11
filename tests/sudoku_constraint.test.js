import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../js/grid_shape.js');
const { SudokuConstraintBase } = await import('../js/sudoku_constraint.js');

// ============================================================================
// Region generation
// ============================================================================

await runTest('rowRegions returns correct number of regions', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.rowRegions(shape);
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('rowRegions contains correct cells', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.rowRegions(shape);
  // First row should be cells 0-8
  assert.deepEqual(regions[0], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // Second row should be cells 9-17
  assert.deepEqual(regions[1], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

await runTest('colRegions returns correct number of regions', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.colRegions(shape);
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('colRegions contains correct cells', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.colRegions(shape);
  // First column should be cells 0, 9, 18, ...
  assert.deepEqual(regions[0], [0, 9, 18, 27, 36, 45, 54, 63, 72]);
  // Second column should be cells 1, 10, 19, ...
  assert.deepEqual(regions[1], [1, 10, 19, 28, 37, 46, 55, 64, 73]);
});

await runTest('boxRegions returns correct number of regions', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.boxRegions(shape);
  assert.equal(regions.length, 9);
  for (const region of regions) {
    assert.equal(region.length, 9);
  }
});

await runTest('boxRegions contains correct cells for 9x9', () => {
  const shape = GridShape.fromGridSize(9);
  const regions = SudokuConstraintBase.boxRegions(shape);
  // First box (top-left) should contain cells in rows 0-2, cols 0-2
  assert.deepEqual(regions[0].sort((a, b) => a - b), [0, 1, 2, 9, 10, 11, 18, 19, 20]);
});

await runTest('boxRegions works for 6x6', () => {
  const shape = GridShape.fromGridSize(6);
  const regions = SudokuConstraintBase.boxRegions(shape);
  assert.equal(regions.length, 6);
  for (const region of regions) {
    assert.equal(region.length, 6);
  }
  // First box is 2 rows x 3 cols for 6x6
  assert.deepEqual(regions[0].sort((a, b) => a - b), [0, 1, 2, 6, 7, 8]);
});

// Rectangular grid tests for boxRegions
await runTest('boxRegions for 4x6 grid has correct structure', () => {
  const shape = GridShape.fromGridSize(4, 6);
  // 4 rows, 6 cols, numValues=6, boxes are 2x3
  assert.equal(shape.boxHeight, 2);
  assert.equal(shape.boxWidth, 3);

  const regions = SudokuConstraintBase.boxRegions(shape);
  // 4 boxes: (4/2) * (6/3) = 2 * 2 = 4
  assert.equal(regions.length, 4);
  for (const region of regions) {
    assert.equal(region.length, 6, 'Each box should have 6 cells');
  }
});

await runTest('boxRegions for 4x6 grid cells are in bounds', () => {
  const shape = GridShape.fromGridSize(4, 6);
  const regions = SudokuConstraintBase.boxRegions(shape);

  for (const region of regions) {
    for (const cell of region) {
      assert.ok(cell >= 0 && cell < shape.numCells,
        `Cell ${cell} out of bounds [0, ${shape.numCells})`);
    }
  }
});

await runTest('boxRegions for 4x6 grid first box is correct', () => {
  const shape = GridShape.fromGridSize(4, 6);
  const regions = SudokuConstraintBase.boxRegions(shape);
  // Box 0 (top-left): rows 0-1, cols 0-2 => cells 0,1,2,6,7,8
  assert.deepEqual(regions[0].sort((a, b) => a - b), [0, 1, 2, 6, 7, 8]);
});

await runTest('boxRegions for 4x6 grid second box is correct', () => {
  const shape = GridShape.fromGridSize(4, 6);
  const regions = SudokuConstraintBase.boxRegions(shape);
  // Box 1 (top-right): rows 0-1, cols 3-5 => cells 3,4,5,9,10,11
  assert.deepEqual(regions[1].sort((a, b) => a - b), [3, 4, 5, 9, 10, 11]);
});

await runTest('boxRegions for 6x4 grid has correct structure', () => {
  const shape = GridShape.fromGridSize(6, 4);
  // 6 rows, 4 cols, numValues=6, boxes are 3x2
  assert.equal(shape.boxHeight, 3);
  assert.equal(shape.boxWidth, 2);

  const regions = SudokuConstraintBase.boxRegions(shape);
  // 4 boxes: (6/3) * (4/2) = 2 * 2 = 4
  assert.equal(regions.length, 4);
  for (const region of regions) {
    assert.equal(region.length, 6, 'Each box should have 6 cells');
  }
});

await runTest('boxRegions for 6x4 grid cells are in bounds', () => {
  const shape = GridShape.fromGridSize(6, 4);
  const regions = SudokuConstraintBase.boxRegions(shape);

  for (const region of regions) {
    for (const cell of region) {
      assert.ok(cell >= 0 && cell < shape.numCells,
        `Cell ${cell} out of bounds [0, ${shape.numCells})`);
    }
  }
});

await runTest('boxRegions for rectangular grids cover all cells exactly once', () => {
  for (const [rows, cols] of [[4, 6], [6, 4], [6, 8], [8, 6]]) {
    const shape = GridShape.fromGridSize(rows, cols);
    if (shape.noDefaultBoxes) continue;

    const regions = SudokuConstraintBase.boxRegions(shape);
    const allCells = regions.flat().sort((a, b) => a - b);
    const expected = Array.from({ length: shape.numCells }, (_, i) => i);
    assert.deepEqual(allCells, expected, `boxRegions for ${rows}x${cols}`);
  }
});

await runTest('all regions cover all cells exactly once', () => {
  for (const size of [4, 6, 9]) {
    const shape = GridShape.fromGridSize(size);
    for (const regionFn of [
      SudokuConstraintBase.rowRegions,
      SudokuConstraintBase.colRegions,
      SudokuConstraintBase.boxRegions
    ]) {
      const regions = regionFn(shape);
      const allCells = regions.flat().sort((a, b) => a - b);
      const expected = Array.from({ length: shape.numCells }, (_, i) => i);
      assert.deepEqual(allCells, expected, `${regionFn.name} for size ${size}`);
    }
  }
});

logSuiteComplete('SudokuConstraintBase');
