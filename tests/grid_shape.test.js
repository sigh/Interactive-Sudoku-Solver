import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape, SHAPE_9x9, SHAPE_MAX } = await import('../js/grid_shape.js');

// ============================================================================
// GridShape.fromGridSize (square grids)
// ============================================================================

await runTest('fromGridSize creates valid shape for size 9', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
  assert.equal(shape.numValues, 9);
  assert.equal(shape.numCells, 81);
  assert.equal(shape.numPencilmarks, 729);
});

await runTest('fromGridSize creates valid shape for size 4', () => {
  const shape = GridShape.fromGridSize(4);
  assert.equal(shape.numRows, 4);
  assert.equal(shape.numCols, 4);
  assert.equal(shape.numValues, 4);
  assert.equal(shape.numCells, 16);
});

await runTest('fromGridSize creates valid shape for size 16', () => {
  const shape = GridShape.fromGridSize(16);
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
// GridShape.fromGridSize with two arguments (rectangular grids)
// ============================================================================

await runTest('fromGridSize creates rectangular 6x8 grid', () => {
  const shape = GridShape.fromGridSize(6, 8);
  assert.equal(shape.numRows, 6);
  assert.equal(shape.numCols, 8);
  assert.equal(shape.numValues, 8); // max(6, 8)
  assert.equal(shape.numCells, 48);
  assert.equal(shape.name, '6x8');
});

await runTest('fromGridSize creates rectangular 8x6 grid', () => {
  const shape = GridShape.fromGridSize(8, 6);
  assert.equal(shape.numRows, 8);
  assert.equal(shape.numCols, 6);
  assert.equal(shape.numValues, 8); // max(8, 6)
  assert.equal(shape.numCells, 48);
  assert.equal(shape.name, '8x6');
});

await runTest('fromGridSize(9,9) is same object as fromGridSize(9)', () => {
  const shape1 = GridShape.fromGridSize(9, 9);
  const shape2 = GridShape.fromGridSize(9);
  assert.strictEqual(shape1, shape2);
});

await runTest('fromGridSize returns null for invalid dimensions', () => {
  assert.equal(GridShape.fromGridSize(0, 9), null);
  assert.equal(GridShape.fromGridSize(9, 0), null);
  assert.equal(GridShape.fromGridSize(17, 9), null);
  assert.equal(GridShape.fromGridSize(9, 17), null);
});

await runTest('fromGridSize is memoized for rectangular grids', () => {
  const shape1 = GridShape.fromGridSize(6, 8);
  const shape2 = GridShape.fromGridSize(6, 8);
  assert.strictEqual(shape1, shape2);
});

// ============================================================================
// GridShape.fromGridSpec
// ============================================================================

await runTest('fromGridSpec parses square grid specs', () => {
  const shape = GridShape.fromGridSpec('9x9');
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
});

await runTest('fromGridSpec parses rectangular grid specs', () => {
  const shape = GridShape.fromGridSpec('6x8');
  assert.equal(shape.numRows, 6);
  assert.equal(shape.numCols, 8);
  assert.equal(shape.numValues, 8);
});

await runTest('fromGridSpec parses 4x6 grid spec', () => {
  const shape = GridShape.fromGridSpec('4x6');
  assert.equal(shape.numRows, 4);
  assert.equal(shape.numCols, 6);
  assert.equal(shape.numValues, 6);
});

await runTest('fromGridSpec parses ~numValues when non-default', () => {
  const shape = GridShape.fromGridSpec('9x9~10');
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
  assert.equal(shape.numValues, 10);
  assert.equal(shape.name, '9x9~10');
});

await runTest('fromGridSpec canonicalizes default ~numValues', () => {
  const shape = GridShape.fromGridSpec('9x9~9');
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
  assert.equal(shape.numValues, 9);
  assert.equal(shape.name, '9x9');
});

await runTest('fromGridSpec throws when ~numValues is too small', () => {
  assert.throws(() => GridShape.fromGridSpec('9x9~8'));
});

await runTest('fromGridSpec throws when ~numValues is too large', () => {
  assert.throws(() => GridShape.fromGridSpec('9x9~17'));
});

await runTest('fromGridSpec throws on invalid format', () => {
  assert.throws(() => GridShape.fromGridSpec('9'));
  assert.throws(() => GridShape.fromGridSpec('9x9x9'));
  assert.throws(() => GridShape.fromGridSpec('abc'));
  assert.throws(() => GridShape.fromGridSpec('axb'));
});

await runTest('fromGridSpec throws on invalid dimensions', () => {
  assert.throws(() => GridShape.fromGridSpec('0x9'));
  assert.throws(() => GridShape.fromGridSpec('9x0'));
  assert.throws(() => GridShape.fromGridSpec('17x9'));
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

await runTest('cellIndex computes correct index for rectangular 6x8', () => {
  const shape = GridShape.fromGridSize(6, 8);
  assert.equal(shape.cellIndex(0, 0), 0);
  assert.equal(shape.cellIndex(0, 7), 7);  // last col of first row
  assert.equal(shape.cellIndex(1, 0), 8);  // first col of second row
  assert.equal(shape.cellIndex(5, 7), 47); // last cell
});

await runTest('splitCellIndex is inverse of cellIndex for 9x9', () => {
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

await runTest('splitCellIndex is inverse of cellIndex for rectangular 6x8', () => {
  const shape = GridShape.fromGridSize(6, 8);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 8; c++) {
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

await runTest('boxDimsForSize is correct for common square sizes', () => {
  assert.deepEqual(GridShape.boxDimsForSize(4, 4, 4), [2, 2]);
  assert.deepEqual(GridShape.boxDimsForSize(6, 6, 6), [2, 3]);
  assert.deepEqual(GridShape.boxDimsForSize(9, 9, 9), [3, 3]);
  assert.deepEqual(GridShape.boxDimsForSize(12, 12, 12), [3, 4]);
  assert.deepEqual(GridShape.boxDimsForSize(16, 16, 16), [4, 4]);
});

await runTest('boxDimsForSize for rectangular grids', () => {
  // 6x8 grid with size 8: boxes must have 8 cells
  const [h68, w68] = GridShape.boxDimsForSize(6, 8, 8);
  assert.equal(h68 * w68, 8);
  assert.equal(6 % h68, 0);
  assert.equal(8 % w68, 0);

  // 4x6 grid with size 6: boxes must have 6 cells
  const [h46, w46] = GridShape.boxDimsForSize(4, 6, 6);
  assert.equal(h46 * w46, 6);
  assert.equal(4 % h46, 0);
  assert.equal(6 % w46, 0);
});

await runTest('boxDimsForSize for square grids have correct cells', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const [h, w] = GridShape.boxDimsForSize(size, size, size);
    assert.equal(h * w, size, `${size}x${size} box should have ${size} cells`);
  }
});

await runTest('boxDimsForSize prefers squarer boxes', () => {
  // 9x9: should be 3x3, not 1x9
  assert.deepEqual(GridShape.boxDimsForSize(9, 9, 9), [3, 3]);

  // 6x6: should be 2x3, not 1x6
  assert.deepEqual(GridShape.boxDimsForSize(6, 6, 6), [2, 3]);

  // 6x8 with size 8: should be 2x4, not 1x8 or 8x1
  assert.deepEqual(GridShape.boxDimsForSize(6, 8, 8), [2, 4]);

  // 8x6 with size 8: should be 4x2, not 1x8 or 8x1
  assert.deepEqual(GridShape.boxDimsForSize(8, 6, 8), [4, 2]);
});

await runTest('boxDimsForSize returns null for invalid sizes', () => {
  // 5x7 grid cannot have 7-cell boxes that tile evenly
  assert.deepEqual(GridShape.boxDimsForSize(5, 7, 7), [null, null]);

  // 3x5 grid cannot have 5-cell boxes
  assert.deepEqual(GridShape.boxDimsForSize(3, 5, 5), [null, null]);
});

// ============================================================================
// Exported constants
// ============================================================================

await runTest('SHAPE_9x9 is correct', () => {
  assert.equal(SHAPE_9x9.numRows, 9);
  assert.equal(SHAPE_9x9.numCols, 9);
  assert.equal(SHAPE_9x9.numValues, 9);
});

await runTest('SHAPE_MAX is correct', () => {
  assert.equal(SHAPE_MAX.numRows, 16);
  assert.equal(SHAPE_MAX.numCols, 16);
  assert.equal(SHAPE_MAX.numValues, 16);
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

await runTest('makeCellId works for rectangular grids', () => {
  const shape = GridShape.fromGridSize(6, 8);
  assert.equal(shape.makeCellId(0, 0), 'R1C1');
  assert.equal(shape.makeCellId(0, 7), 'R1C8');
  assert.equal(shape.makeCellId(5, 7), 'R6C8');
});

// ============================================================================
// Invariants
// ============================================================================

await runTest('numRows * numCols equals numCells', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const shape = GridShape.fromGridSize(size);
    assert.equal(shape.numRows * shape.numCols, shape.numCells);
  }
  // Also test rectangular
  const rect = GridShape.fromGridSize(6, 8);
  assert.equal(rect.numRows * rect.numCols, rect.numCells);
});

await runTest('numValues equals max(numRows, numCols)', () => {
  // Square grids
  for (const size of [4, 6, 9, 12, 16]) {
    const shape = GridShape.fromGridSize(size);
    assert.equal(shape.numValues, Math.max(shape.numRows, shape.numCols));
  }
  // Rectangular grids
  assert.equal(GridShape.fromGridSize(6, 8).numValues, 8);
  assert.equal(GridShape.fromGridSize(8, 6).numValues, 8);
  assert.equal(GridShape.fromGridSize(4, 6).numValues, 6);
});

await runTest('gridSize property no longer exists', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.gridSize, undefined);
});

// ============================================================================
// isSquare()
// ============================================================================

await runTest('isSquare returns true for square grids', () => {
  for (const size of [4, 6, 9, 16]) {
    const shape = GridShape.fromGridSize(size);
    assert.ok(shape.isSquare(), `${size}x${size} should be square`);
  }
});

await runTest('isSquare returns false for rectangular grids', () => {
  for (const [rows, cols] of [[4, 6], [6, 4], [6, 8], [8, 6]]) {
    const shape = GridShape.fromGridSize(rows, cols);
    assert.ok(!shape.isSquare(), `${rows}x${cols} should not be square`);
  }
});

logSuiteComplete();
