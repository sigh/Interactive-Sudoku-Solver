import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape, SHAPE_9x9, SHAPE_MAX } = await import('../js/grid_shape.js');

// ============================================================================
// GridShape.fromGridSize
// ============================================================================

await runTest('fromGridSize creates valid shape for size 9', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.gridSize, 9);
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
  assert.equal(shape.numValues, 9);
  assert.equal(shape.numCells, 81);
  assert.equal(shape.numPencilmarks, 729);
});

await runTest('fromGridSize creates valid shape for size 4', () => {
  const shape = GridShape.fromGridSize(4);
  assert.equal(shape.gridSize, 4);
  assert.equal(shape.numRows, 4);
  assert.equal(shape.numCols, 4);
  assert.equal(shape.numValues, 4);
  assert.equal(shape.numCells, 16);
});

await runTest('fromGridSize creates valid shape for size 16', () => {
  const shape = GridShape.fromGridSize(16);
  assert.equal(shape.gridSize, 16);
  assert.equal(shape.numRows, 16);
  assert.equal(shape.numCols, 16);
  assert.equal(shape.numValues, 16);
  assert.equal(shape.numCells, 256);
});

await runTest('fromGridSize returns null for invalid sizes', () => {
  assert.equal(GridShape.fromGridSize(0), null);
  assert.equal(GridShape.fromGridSize(-1), null);
  assert.equal(GridShape.fromGridSize(17), null);
  assert.equal(GridShape.fromGridSize(1.5), null);
});

await runTest('fromGridSize is memoized', () => {
  const shape1 = GridShape.fromGridSize(9);
  const shape2 = GridShape.fromGridSize(9);
  assert.strictEqual(shape1, shape2);
});

// ============================================================================
// GridShape.fromGridSpec
// ============================================================================

await runTest('fromGridSpec parses square grid specs', () => {
  const shape = GridShape.fromGridSpec('9x9');
  assert.equal(shape.gridSize, 9);
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
});

await runTest('fromGridSpec throws on non-square specs', () => {
  assert.throws(() => GridShape.fromGridSpec('6x8'));
  assert.throws(() => GridShape.fromGridSpec('8x6'));
});

await runTest('fromGridSpec throws on invalid format', () => {
  assert.throws(() => GridShape.fromGridSpec('9'));
  assert.throws(() => GridShape.fromGridSpec('9x9x9'));
  assert.throws(() => GridShape.fromGridSpec('abc'));
});

// ============================================================================
// Cell indexing
// ============================================================================

await runTest('cellIndex computes correct index for 9x9', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.cellIndex(0, 0), 0);
  assert.equal(shape.cellIndex(0, 8), 8);
  assert.equal(shape.cellIndex(1, 0), 9);
  assert.equal(shape.cellIndex(8, 8), 80);
});

await runTest('splitCellIndex is inverse of cellIndex', () => {
  const shape = GridShape.fromGridSize(9);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const idx = shape.cellIndex(r, c);
      const [row, col] = shape.splitCellIndex(idx);
      assert.equal(row, r);
      assert.equal(col, c);
    }
  }
});

// ============================================================================
// Box dimensions
// ============================================================================

await runTest('box dimensions are correct for common sizes', () => {
  assert.deepEqual([GridShape.fromGridSize(4).boxHeight, GridShape.fromGridSize(4).boxWidth], [2, 2]);
  assert.deepEqual([GridShape.fromGridSize(6).boxHeight, GridShape.fromGridSize(6).boxWidth], [2, 3]);
  assert.deepEqual([GridShape.fromGridSize(9).boxHeight, GridShape.fromGridSize(9).boxWidth], [3, 3]);
  assert.deepEqual([GridShape.fromGridSize(12).boxHeight, GridShape.fromGridSize(12).boxWidth], [3, 4]);
  assert.deepEqual([GridShape.fromGridSize(16).boxHeight, GridShape.fromGridSize(16).boxWidth], [4, 4]);
});

// ============================================================================
// Exported constants
// ============================================================================

await runTest('SHAPE_9x9 is correct', () => {
  assert.equal(SHAPE_9x9.gridSize, 9);
  assert.equal(SHAPE_9x9.numRows, 9);
  assert.equal(SHAPE_9x9.numCols, 9);
});

await runTest('SHAPE_MAX is correct', () => {
  assert.equal(SHAPE_MAX.gridSize, 16);
  assert.equal(SHAPE_MAX.numRows, 16);
  assert.equal(SHAPE_MAX.numCols, 16);
});

// ============================================================================
// Cell ID generation and parsing
// ============================================================================

await runTest('makeCellId generates correct format', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.makeCellId(0, 0), 'R1C1');
  assert.equal(shape.makeCellId(0, 8), 'R1C9');
  assert.equal(shape.makeCellId(8, 8), 'R9C9');
});

await runTest('parseCellId is inverse of makeCellId', () => {
  const shape = GridShape.fromGridSize(9);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cellId = shape.makeCellId(r, c);
      const parsed = shape.parseCellId(cellId);
      assert.equal(parsed.row, r);
      assert.equal(parsed.col, c);
      assert.equal(parsed.cell, shape.cellIndex(r, c));
    }
  }
});

// ============================================================================
// Invariant: numRows and numCols are consistent with gridSize (for now)
// ============================================================================

await runTest('numRows * numCols equals numCells', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const shape = GridShape.fromGridSize(size);
    assert.equal(shape.numRows * shape.numCols, shape.numCells);
  }
});

await runTest('numValues equals max(numRows, numCols) for square grids', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const shape = GridShape.fromGridSize(size);
    assert.equal(shape.numValues, Math.max(shape.numRows, shape.numCols));
  }
});

logSuiteComplete();
