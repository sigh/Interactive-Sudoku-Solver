import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { CellGeometry, CellGraph, GEOMETRY_9x9, GEOMETRY_MAX } = await import('../../js/cell_geometry.js');

// ============================================================================
// CellGeometry.fromGridSize (square grids)
// ============================================================================

await runTest('fromGridSize creates valid geometry for size 9', () => {
  const geometry = CellGeometry.fromGridSize(9);
  assert.equal(geometry.numRows, 9);
  assert.equal(geometry.numCols, 9);
  assert.equal(geometry.numValues, 9);
  assert.equal(geometry.numGridCells, 81);
});

await runTest('fromGridSize creates valid geometry for size 4', () => {
  const geometry = CellGeometry.fromGridSize(4);
  assert.equal(geometry.numRows, 4);
  assert.equal(geometry.numCols, 4);
  assert.equal(geometry.numValues, 4);
  assert.equal(geometry.numGridCells, 16);
});

await runTest('fromGridSize creates valid geometry for size 16', () => {
  const geometry = CellGeometry.fromGridSize(16);
  assert.equal(geometry.numRows, 16);
  assert.equal(geometry.numCols, 16);
  assert.equal(geometry.numValues, 16);
  assert.equal(geometry.numGridCells, 256);
});

await runTest('fromGridSize returns null for invalid sizes', () => {
  assert.equal(CellGeometry.fromGridSize(0), null);
  assert.equal(CellGeometry.fromGridSize(-1), null);
  assert.equal(CellGeometry.fromGridSize(17), null);
  assert.equal(CellGeometry.fromGridSize(1.5), null);
});


await runTest('fromGridSize creates rectangular 6x8 grid', () => {
  const geometry = CellGeometry.fromGridSize(6, 8);
  assert.equal(geometry.numRows, 6);
  assert.equal(geometry.numCols, 8);
  assert.equal(geometry.numValues, 8); // max(6, 8)
  assert.equal(geometry.numGridCells, 48);
  assert.equal(geometry.name, '6x8');
});

await runTest('fromGridSize creates rectangular 8x6 grid', () => {
  const geometry = CellGeometry.fromGridSize(8, 6);
  assert.equal(geometry.numRows, 8);
  assert.equal(geometry.numCols, 6);
  assert.equal(geometry.numValues, 8); // max(8, 6)
  assert.equal(geometry.numGridCells, 48);
  assert.equal(geometry.name, '8x6');
});

await runTest('fromGridSize returns null for invalid dimensions', () => {
  assert.equal(CellGeometry.fromGridSize(0, 9), null);
  assert.equal(CellGeometry.fromGridSize(9, 0), null);
  assert.equal(CellGeometry.fromGridSize(17, 9), null);
  assert.equal(CellGeometry.fromGridSize(9, 17), null);
});

// ============================================================================
// CellGeometry.fromShapeSpec
// ============================================================================

await runTest('fromShapeSpec parses square shape specs', () => {
  const geometry = CellGeometry.fromShapeSpec('9x9');
  assert.equal(geometry.numRows, 9);
  assert.equal(geometry.numCols, 9);
});

await runTest('fromShapeSpec parses rectangular shape specs', () => {
  const geometry = CellGeometry.fromShapeSpec('6x8');
  assert.equal(geometry.numRows, 6);
  assert.equal(geometry.numCols, 8);
  assert.equal(geometry.numValues, 8);
});

await runTest('fromShapeSpec parses 4x6 shape spec', () => {
  const geometry = CellGeometry.fromShapeSpec('4x6');
  assert.equal(geometry.numRows, 4);
  assert.equal(geometry.numCols, 6);
  assert.equal(geometry.numValues, 6);
});

await runTest('fromShapeSpec parses ~numValues when non-default', () => {
  const geometry = CellGeometry.fromShapeSpec('9x9~10');
  assert.equal(geometry.numRows, 9);
  assert.equal(geometry.numCols, 9);
  assert.equal(geometry.numValues, 10);
  assert.equal(geometry.name, '9x9~10');
});

await runTest('fromShapeSpec canonicalizes default ~numValues', () => {
  const geometry = CellGeometry.fromShapeSpec('9x9~9');
  assert.equal(geometry.numRows, 9);
  assert.equal(geometry.numCols, 9);
  assert.equal(geometry.numValues, 9);
  assert.equal(geometry.name, '9x9');
});

await runTest('fromShapeSpec throws when ~numValues is too small', () => {
  assert.throws(() => CellGeometry.fromShapeSpec('9x9~8'));
});

await runTest('fromShapeSpec throws when ~numValues is too large', () => {
  assert.throws(() => CellGeometry.fromShapeSpec('9x9~17'));
});

await runTest('fromShapeSpec throws on invalid format', () => {
  assert.throws(() => CellGeometry.fromShapeSpec('9'));
  assert.throws(() => CellGeometry.fromShapeSpec('9x9x9'));
  assert.throws(() => CellGeometry.fromShapeSpec('abc'));
  assert.throws(() => CellGeometry.fromShapeSpec('axb'));
});

await runTest('fromShapeSpec throws on invalid dimensions', () => {
  assert.throws(() => CellGeometry.fromShapeSpec('0x9'));
  assert.throws(() => CellGeometry.fromShapeSpec('9x0'));
  assert.throws(() => CellGeometry.fromShapeSpec('17x9'));
});

// ============================================================================
// Cell indexing
// ============================================================================

await runTest('cellIndex computes correct index for 9x9', () => {
  const geometry = CellGeometry.fromGridSize(9);
  assert.equal(geometry.cellIndex(0, 0), 0);
  assert.equal(geometry.cellIndex(0, 8), 8);
  assert.equal(geometry.cellIndex(1, 0), 9);
  assert.equal(geometry.cellIndex(8, 8), 80);
});

await runTest('cellIndex computes correct index for rectangular 6x8', () => {
  const geometry = CellGeometry.fromGridSize(6, 8);
  assert.equal(geometry.cellIndex(0, 0), 0);
  assert.equal(geometry.cellIndex(0, 7), 7);  // last col of first row
  assert.equal(geometry.cellIndex(1, 0), 8);  // first col of second row
  assert.equal(geometry.cellIndex(5, 7), 47); // last cell
});

await runTest('splitCellIndex is inverse of cellIndex for 9x9', () => {
  const geometry = CellGeometry.fromGridSize(9);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const idx = geometry.cellIndex(r, c);
      const [row, col] = geometry.splitCellIndex(idx);
      assert.equal(row, r);
      assert.equal(col, c);
    }
  }
});

await runTest('splitCellIndex is inverse of cellIndex for rectangular 6x8', () => {
  const geometry = CellGeometry.fromGridSize(6, 8);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 8; c++) {
      const idx = geometry.cellIndex(r, c);
      const [row, col] = geometry.splitCellIndex(idx);
      assert.equal(row, r);
      assert.equal(col, c);
    }
  }
});

// ============================================================================
// Box dimensions
// ============================================================================

await runTest('boxDimsForSize is correct for common square sizes', () => {
  assert.deepEqual(CellGeometry.boxDimsForSize(4, 4, 4), [2, 2]);
  assert.deepEqual(CellGeometry.boxDimsForSize(6, 6, 6), [2, 3]);
  assert.deepEqual(CellGeometry.boxDimsForSize(9, 9, 9), [3, 3]);
  assert.deepEqual(CellGeometry.boxDimsForSize(12, 12, 12), [3, 4]);
  assert.deepEqual(CellGeometry.boxDimsForSize(16, 16, 16), [4, 4]);
});

await runTest('boxDimsForSize for rectangular grids', () => {
  // 6x8 grid with size 8: boxes must have 8 cells
  const [h68, w68] = CellGeometry.boxDimsForSize(6, 8, 8);
  assert.equal(h68 * w68, 8);
  assert.equal(6 % h68, 0);
  assert.equal(8 % w68, 0);

  // 4x6 grid with size 6: boxes must have 6 cells
  const [h46, w46] = CellGeometry.boxDimsForSize(4, 6, 6);
  assert.equal(h46 * w46, 6);
  assert.equal(4 % h46, 0);
  assert.equal(6 % w46, 0);
});

await runTest('boxDimsForSize for square grids have correct cells', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const [h, w] = CellGeometry.boxDimsForSize(size, size, size);
    assert.equal(h * w, size, `${size}x${size} box should have ${size} cells`);
  }
});

await runTest('boxDimsForSize prefers squarer boxes', () => {
  // 9x9: should be 3x3, not 1x9
  assert.deepEqual(CellGeometry.boxDimsForSize(9, 9, 9), [3, 3]);

  // 6x6: should be 2x3, not 1x6
  assert.deepEqual(CellGeometry.boxDimsForSize(6, 6, 6), [2, 3]);

  // 6x8 with size 8: should be 2x4, not 1x8 or 8x1
  assert.deepEqual(CellGeometry.boxDimsForSize(6, 8, 8), [2, 4]);

  // 8x6 with size 8: should be 4x2, not 1x8 or 8x1
  assert.deepEqual(CellGeometry.boxDimsForSize(8, 6, 8), [4, 2]);
});

await runTest('boxDimsForSize returns null for invalid sizes', () => {
  // 5x7 grid cannot have 7-cell boxes that tile evenly
  assert.deepEqual(CellGeometry.boxDimsForSize(5, 7, 7), [null, null]);

  // 3x5 grid cannot have 5-cell boxes
  assert.deepEqual(CellGeometry.boxDimsForSize(3, 5, 5), [null, null]);
});

// ============================================================================
// Exported constants
// ============================================================================

await runTest('GEOMETRY_9x9 is correct', () => {
  assert.equal(GEOMETRY_9x9.numRows, 9);
  assert.equal(GEOMETRY_9x9.numCols, 9);
  assert.equal(GEOMETRY_9x9.numValues, 9);
});

await runTest('GEOMETRY_MAX is correct', () => {
  assert.equal(GEOMETRY_MAX.numRows, 16);
  assert.equal(GEOMETRY_MAX.numCols, 16);
  assert.equal(GEOMETRY_MAX.numValues, 16);
});

// ============================================================================
// Cell ID generation and parsing
// ============================================================================

await runTest('makeCellId generates correct format', () => {
  const geometry = CellGeometry.fromGridSize(9);
  assert.equal(geometry.makeCellId(0, 0), 'R1C1');
  assert.equal(geometry.makeCellId(0, 8), 'R1C9');
  assert.equal(geometry.makeCellId(8, 8), 'R9C9');
});

await runTest('parseCellId is inverse of makeCellId', () => {
  const geometry = CellGeometry.fromGridSize(9);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cellId = geometry.makeCellId(r, c);
      const parsed = geometry.parseCellId(cellId);
      assert.equal(parsed.row, r);
      assert.equal(parsed.col, c);
      assert.equal(parsed.cellIndex, geometry.cellIndex(r, c));
    }
  }
});

await runTest('parseCellId rejects trailing characters (F-01)', () => {
  const geometry = CellGeometry.fromGridSize(9);

  // Previously 'R1C10' silently parsed as R1C1 and 'R9C9extra' as R9C9.
  assert.throws(() => geometry.parseCellId('R1C10'), /Invalid cell ID/);
  assert.throws(() => geometry.parseCellId('R9C9extra'), /Invalid cell ID/);
  assert.throws(() => geometry.parseCellId('R1C1 '), /Invalid cell ID/);
  assert.throws(() => geometry.parseCellId('R0C1'), /Invalid cell ID/);
  assert.throws(() => geometry.parseCellId('R1C0'), /Invalid cell ID/);
});

await runTest('parseCellId still accepts well-formed 16x16 coordinates', () => {
  const geometry = CellGeometry.fromGridSize(16);
  // Base-17: 'g' == 16, so RgCg is the bottom-right cell of a 16x16 grid.
  assert.deepEqual(geometry.parseCellId('RgCg'), { cellIndex: 255, row: 15, col: 15 });
  assert.deepEqual(geometry.parseCellId('rGcG'), { cellIndex: 255, row: 15, col: 15 });
});

await runTest('parseValueId rejects NaN, out-of-range, and trailing garbage (F-02)', () => {
  const geometry = CellGeometry.fromGridSize(9);

  assert.throws(() => geometry.parseValueId('R1C1_99'), /Invalid value ID/);  // out of range
  assert.throws(() => geometry.parseValueId('R1C1_0'), /Invalid value ID/);   // below min
  assert.throws(() => geometry.parseValueId('R1C1_x'), /Invalid value ID/);   // NaN
  assert.throws(() => geometry.parseValueId('R1C1_2x'), /Invalid value ID/);  // trailing garbage
});

await runTest('parseValueId accepts valid single and multi-value ids', () => {
  const geometry = CellGeometry.fromGridSize(9);

  assert.deepEqual(geometry.parseValueId('R1C1_5'), { cellId: 'R1C1', values: [5] });
  assert.deepEqual(geometry.parseValueId('R1C1_1_3_9'),
    { cellId: 'R1C1', values: [1, 3, 9] });
  // No values is a valid (empty candidate set) parse.
  assert.deepEqual(geometry.parseValueId('R1C1'), { cellId: 'R1C1', values: [] });
});

await runTest('parseValueId honours the geometry value range', () => {
  // 0-based 9x9 grid: valid values are 0..8.
  const geometry = CellGeometry.fromGridSize(9, 9, null, -1);
  assert.deepEqual(geometry.parseValueId('R1C1_0'), { cellId: 'R1C1', values: [0] });
  assert.deepEqual(geometry.parseValueId('R1C1_8'), { cellId: 'R1C1', values: [8] });
  assert.throws(() => geometry.parseValueId('R1C1_9'), /Invalid value ID/);

  // Extended-value grid: values up to numValues are accepted.
  const extended = CellGeometry.fromShapeSpec('9x9~10');
  assert.deepEqual(extended.parseValueId('R1C1_10'), { cellId: 'R1C1', values: [10] });
  assert.throws(() => extended.parseValueId('R1C1_11'), /Invalid value ID/);
});

await runTest('makeCellId works for rectangular grids', () => {
  const geometry = CellGeometry.fromGridSize(6, 8);
  assert.equal(geometry.makeCellId(0, 0), 'R1C1');
  assert.equal(geometry.makeCellId(0, 7), 'R1C8');
  assert.equal(geometry.makeCellId(5, 7), 'R6C8');
});

// ============================================================================
// Invariants
// ============================================================================

await runTest('numRows * numCols equals numGridCells', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const geometry = CellGeometry.fromGridSize(size);
    assert.equal(geometry.numRows * geometry.numCols, geometry.numGridCells);
  }
  // Also test rectangular
  const rect = CellGeometry.fromGridSize(6, 8);
  assert.equal(rect.numRows * rect.numCols, rect.numGridCells);
});

await runTest('numValues equals max(numRows, numCols)', () => {
  // Square grids
  for (const size of [4, 6, 9, 12, 16]) {
    const geometry = CellGeometry.fromGridSize(size);
    assert.equal(geometry.numValues, Math.max(geometry.numRows, geometry.numCols));
  }
  // Rectangular grids
  assert.equal(CellGeometry.fromGridSize(6, 8).numValues, 8);
  assert.equal(CellGeometry.fromGridSize(8, 6).numValues, 8);
  assert.equal(CellGeometry.fromGridSize(4, 6).numValues, 6);
});

await runTest('gridSize property no longer exists', () => {
  const geometry = CellGeometry.fromGridSize(9);
  assert.equal(geometry.gridSize, undefined);
});

// ============================================================================
// isSquare()
// ============================================================================

await runTest('isSquare returns true for square grids', () => {
  for (const size of [4, 6, 9, 16]) {
    const geometry = CellGeometry.fromGridSize(size);
    assert.ok(geometry.isSquare(), `${size}x${size} should be square`);
  }
});

await runTest('isSquare returns false for rectangular grids', () => {
  for (const [rows, cols] of [[4, 6], [6, 4], [6, 8], [8, 6]]) {
    const geometry = CellGeometry.fromGridSize(rows, cols);
    assert.ok(!geometry.isSquare(), `${rows}x${cols} should not be square`);
  }
});

// ============================================================================
// valueOffset
// ============================================================================

await runTest('fromGridSize with valueOffset=-1 creates 0-based geometry', () => {
  const geometry = CellGeometry.fromGridSize(9, 9, null, -1);
  assert.equal(geometry.numValues, 9);
  assert.equal(geometry.valueOffset, -1);
  assert.equal(geometry.name, '9x9~0-8');
});

await runTest('fromGridSize rejects invalid valueOffset', () => {
  assert.throws(() => CellGeometry.fromGridSize(9, 9, null, -2));
  assert.throws(() => CellGeometry.fromGridSize(9, 9, null, 1));
});

await runTest('fromShapeSpec parses range syntax', () => {
  const geometry = CellGeometry.fromShapeSpec('9x9~0-8');
  assert.equal(geometry.numValues, 9);
  assert.equal(geometry.valueOffset, -1);
  assert.equal(geometry.name, '9x9~0-8');
});

await runTest('fromShapeSpec rejects invalid range offset', () => {
  // 2-10 means offset=1, which is not allowed
  assert.throws(() => CellGeometry.fromShapeSpec('9x9~2-10'));
});

await runTest('makeName produces canonical forms', () => {
  // Default 9x9: no suffix
  assert.equal(CellGeometry.makeName(9, 9, 9, 0), '9x9');
  // Non-default numValues: bare number suffix
  assert.equal(CellGeometry.makeName(9, 9, 10, 0), '9x9~10');
  // Zero-based: range suffix
  assert.equal(CellGeometry.makeName(9, 9, 9, -1), '9x9~0-8');
});

await runTest('fromShapeSpec round-trips through name', () => {
  for (const spec of ['9x9', '9x9~10', '9x9~0-8', '4x6', '6x8~0-7']) {
    const geometry = CellGeometry.fromShapeSpec(spec);
    const reparsed = CellGeometry.fromShapeSpec(geometry.name);
    assert.equal(reparsed.name, geometry.name);
    assert.equal(reparsed.numValues, geometry.numValues);
    assert.equal(reparsed.valueOffset, geometry.valueOffset);
  }
});

// ============================================================================
// Var cell group columns
// ============================================================================

const groupColumns = (geometry, specs) => {
  geometry._varCellRegistry.addGroups(
    specs.map(s => ({ label: '', ...s })));
  return new Map(geometry.varCellGroups().map(g => [g.prefix, g.columns]));
};

await runTest('count-only groups resolve columns to the grid', () => {
  const columns = groupColumns(CellGeometry.fromGridSize(9), [
    { prefix: 'VA', count: 10, columns: 0 },
    { prefix: 'VB', count: 4, columns: 2 },
  ]);
  assert.equal(columns.get('VA'), 9);
  assert.equal(columns.get('VB'), 2);
});

await runTest('count-only groups resolve columns to the primary group', () => {
  const columns = groupColumns(CellGeometry.fromShapeSpec('VA~1-6'), [
    { prefix: 'VA', count: 36, columns: 6 },
    { prefix: 'VB', count: 10, columns: 0 },
  ]);
  assert.equal(columns.get('VB'), 6);
});

await runTest('count-only columns stay unresolved while the named group is missing', () => {
  const columns = groupColumns(CellGeometry.fromShapeSpec('VA~1-6'), [
    { prefix: 'VB', count: 10, columns: 0 },
  ]);
  assert.equal(columns.get('VB'), 0);
});

logSuiteComplete('CellGeometry');

// ============================================================================
// CellGraph
// ============================================================================

await runTest('CellGraph adjacency is correct for interior cell', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  // Cell at row 4, col 4 (index 40) should have 4 neighbors
  const cell = geometry.cellIndex(4, 4);
  const edges = graph.cellEdges(cell);
  assert.equal(edges[CellGraph.LEFT], geometry.cellIndex(4, 3));
  assert.equal(edges[CellGraph.RIGHT], geometry.cellIndex(4, 5));
  assert.equal(edges[CellGraph.UP], geometry.cellIndex(3, 4));
  assert.equal(edges[CellGraph.DOWN], geometry.cellIndex(5, 4));
});

await runTest('CellGraph adjacency is null at edges', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();

  // Top-left corner (0,0)
  const topLeft = geometry.cellIndex(0, 0);
  assert.equal(graph.cellEdges(topLeft)[CellGraph.LEFT], null);
  assert.equal(graph.cellEdges(topLeft)[CellGraph.UP], null);
  assert.notEqual(graph.cellEdges(topLeft)[CellGraph.RIGHT], null);
  assert.notEqual(graph.cellEdges(topLeft)[CellGraph.DOWN], null);

  // Bottom-right corner (8,8)
  const bottomRight = geometry.cellIndex(8, 8);
  assert.equal(graph.cellEdges(bottomRight)[CellGraph.RIGHT], null);
  assert.equal(graph.cellEdges(bottomRight)[CellGraph.DOWN], null);
});

await runTest('CellGraph works for different grid sizes', () => {
  for (const size of [4, 6, 9, 16]) {
    const geometry = CellGeometry.fromGridSize(size);
    const graph = geometry.cellGraph();

    // Check that last cell has correct bounds
    const lastCell = geometry.cellIndex(size - 1, size - 1);
    assert.equal(graph.cellEdges(lastCell)[CellGraph.RIGHT], null);
    assert.equal(graph.cellEdges(lastCell)[CellGraph.DOWN], null);

    // Check an interior cell
    if (size > 2) {
      const interiorCell = geometry.cellIndex(1, 1);
      const edges = graph.cellEdges(interiorCell);
      assert.equal(edges[CellGraph.LEFT], geometry.cellIndex(1, 0));
      assert.equal(edges[CellGraph.RIGHT], geometry.cellIndex(1, 2));
      assert.equal(edges[CellGraph.UP], geometry.cellIndex(0, 1));
      assert.equal(edges[CellGraph.DOWN], geometry.cellIndex(2, 1));
    }
  }
});

await runTest('CellGraph.adjacent returns neighbor in given direction', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const cell = geometry.cellIndex(4, 4);
  assert.equal(graph.adjacent(cell, CellGraph.RIGHT), geometry.cellIndex(4, 5));
  assert.equal(graph.adjacent(cell, CellGraph.LEFT), geometry.cellIndex(4, 3));
});

await runTest('CellGraph.diagonal returns diagonal neighbor', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const cell = geometry.cellIndex(4, 4);
  // Down-right diagonal
  assert.equal(graph.diagonal(cell, CellGraph.RIGHT, CellGraph.DOWN), geometry.cellIndex(5, 5));
  // Up-left diagonal
  assert.equal(graph.diagonal(cell, CellGraph.LEFT, CellGraph.UP), geometry.cellIndex(3, 3));
});

await runTest('CellGraph.diagonal returns null at edge', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const corner = geometry.cellIndex(0, 0);
  assert.equal(graph.diagonal(corner, CellGraph.LEFT, CellGraph.UP), null);
});

await runTest('CellGraph.diagonal handles cell index 0 as intermediate', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  // From R2C1 the up-right diagonal steps through R1C1 (cell index 0), which
  // is a valid cell and must not be treated as falsy.
  const cell = geometry.cellIndex(1, 0);
  assert.equal(graph.diagonal(cell, CellGraph.UP, CellGraph.RIGHT), geometry.cellIndex(0, 1));
  // The up-left diagonal from the same cell is off-grid and should be null.
  assert.equal(graph.diagonal(cell, CellGraph.UP, CellGraph.LEFT), null);
});

await runTest('CellGraph.perimeter traces the boundary clockwise', () => {
  const geometry = CellGeometry.fromGridSize(4, 4);
  const graph = geometry.cellGraph();
  const at = (r, c) => geometry.cellIndex(r, c);
  // Clockwise from the top-left: top row, right col, bottom row, left col.
  assert.deepEqual(graph.perimeter(at(0, 0)), [
    at(0, 0), at(0, 1), at(0, 2), at(0, 3),
    at(1, 3), at(2, 3), at(3, 3),
    at(3, 2), at(3, 1), at(3, 0),
    at(2, 0), at(1, 0),
  ]);
});

await runTest('CellGraph.perimeter is the same from any cell in the region', () => {
  const geometry = CellGeometry.fromGridSize(4, 4);
  const graph = geometry.cellGraph();
  const fromCorner = graph.perimeter(geometry.cellIndex(0, 0));
  assert.deepEqual(graph.perimeter(geometry.cellIndex(2, 2)), fromCorner);  // interior
  assert.deepEqual(graph.perimeter(geometry.cellIndex(1, 3)), fromCorner);  // edge
});

await runTest('CellGraph.perimeter handles a non-square grid', () => {
  const geometry = CellGeometry.fromGridSize(2, 3);
  const graph = geometry.cellGraph();
  const at = (r, c) => geometry.cellIndex(r, c);
  assert.deepEqual(graph.perimeter(at(0, 0)), [
    at(0, 0), at(0, 1), at(0, 2), at(1, 2), at(1, 1), at(1, 0),
  ]);
});

await runTest("CellGraph.perimeter uses a var group's own column count", () => {
  const geometry = CellGeometry.fromGridSize(4, 4);
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VW', count: 16, columns: 8 }] },
  ]);
  const graph = geometry.cellGraph();
  const cells = geometry.varCellsForGroup('VW');  // 16 cells laid out 2 x 8
  // Only 2 rows, so every cell is on the perimeter: top row L->R, bottom R->L.
  assert.deepEqual(graph.perimeter(cells[0]), [
    ...cells.slice(0, 8),
    ...cells.slice(8).reverse(),
  ]);
});

await runTest('CellGraph.cellPosition returns grid row, col, and origin', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();

  assert.deepEqual(graph.cellPosition(geometry.cellIndex(0, 0)), [0, 0, geometry.cellIndex(0, 0)]);
  assert.deepEqual(graph.cellPosition(geometry.cellIndex(4, 5)), [4, 5, geometry.cellIndex(0, 0)]);
  assert.deepEqual(graph.cellPosition(geometry.cellIndex(8, 8)), [8, 8, geometry.cellIndex(0, 0)]);
});

await runTest('CellGraph.cellPosition computes lazily and caches per cell', () => {
  const geometry = CellGeometry.fromGridSize(4);
  const graph = geometry.cellGraph();
  const cell = geometry.cellIndex(2, 3);

  assert.equal(graph._positionCache[cell], undefined);

  const pos0 = graph.cellPosition(cell);
  const pos1 = graph.cellPosition(cell);

  assert.deepEqual(pos0, [2, 3, geometry.cellIndex(0, 0)]);
  assert.equal(pos0, pos1);
  assert.equal(graph._positionCache[cell], pos0);
});

await runTest('CellGraph.traverse steps rows then cols, null past an edge', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const at = (r, c) => geometry.cellIndex(r, c);

  assert.equal(graph.traverse(at(4, 4), 0, 0), at(4, 4));
  assert.equal(graph.traverse(at(4, 4), 1, 0), at(5, 4));
  assert.equal(graph.traverse(at(4, 4), -2, 3), at(2, 7));
  // Stepping off the grid returns null (no wrap).
  assert.equal(graph.traverse(at(8, 8), 1, 0), null);
  assert.equal(graph.traverse(at(0, 0), 0, -1), null);
});

await runTest('CellGraph.wrappingTraverse wraps to the opposite edge', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const at = (r, c) => geometry.cellIndex(r, c);

  // Interior moves behave like traverse.
  assert.equal(graph.wrappingTraverse(at(4, 4), 0, 1), at(4, 5));
  // Each edge wraps within the same row/column.
  assert.equal(graph.wrappingTraverse(at(4, 8), 0, 1), at(4, 0));
  assert.equal(graph.wrappingTraverse(at(4, 0), 0, -1), at(4, 8));
  assert.equal(graph.wrappingTraverse(at(0, 4), -1, 0), at(8, 4));
  assert.equal(graph.wrappingTraverse(at(8, 4), 1, 0), at(0, 4));
});

await runTest('CellGraph.neighborCountIn counts orthogonal neighbors in a set', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const at = (r, c) => geometry.cellIndex(r, c);

  const allFour = new Set([at(3, 4), at(5, 4), at(4, 3), at(4, 5)]);
  assert.equal(graph.neighborCountIn(at(4, 4), allFour), 4);
  // Diagonal and self are not orthogonal neighbors, so they don't count.
  assert.equal(graph.neighborCountIn(at(4, 4), new Set([at(3, 3), at(4, 4)])), 0);
  // Only two of the four are present.
  assert.equal(graph.neighborCountIn(at(4, 4), new Set([at(3, 4), at(4, 5)])), 2);
  // A corner has at most two neighbors; the off-grid directions are skipped.
  assert.equal(graph.neighborCountIn(at(0, 0), new Set([at(0, 1), at(1, 0)])), 2);
});

await runTest('CellGraph.cellsAreConnected works for grid cells', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const graph = geometry.cellGraph();
  const at = (r, c) => geometry.cellIndex(r, c);

  // A single cell is trivially connected.
  assert.ok(graph.cellsAreConnected(new Set([at(2, 2)])));
  // An orthogonally connected L-shape.
  assert.ok(graph.cellsAreConnected(
    new Set([at(0, 0), at(0, 1), at(1, 1), at(2, 1)])));
  // Diagonal adjacency does not connect cells.
  assert.ok(!graph.cellsAreConnected(new Set([at(0, 0), at(1, 1)])));
  // Two separate cells are disconnected.
  assert.ok(!graph.cellsAreConnected(new Set([at(0, 0), at(4, 4)])));
});

logSuiteComplete('CellGraph');

// ============================================================================
// geometry.cellGraph() (var cell adjacency + caching)
// ============================================================================

function makeShapeWithGroups(size, groups) {
  const geometry = CellGeometry.fromGridSize(size);
  geometry._varCellRegistry.addGroups(groups);
  return geometry;
}

await runTest('VarCellRegistry.addGroups throws on duplicate prefix', () => {
  const geometry = CellGeometry.fromGridSize(4);
  geometry._varCellRegistry.addGroups([{ prefix: 'X', label: 'x', count: 2 }]);
  assert.throws(
    () => geometry._varCellRegistry.addGroups([{ prefix: 'X', label: 'x2', count: 3 }]),
    /Cell group prefix 'X' already exists/);
});

await runTest('VarCellRegistry.clear removes all groups', () => {
  const geometry = CellGeometry.fromGridSize(4);
  geometry._varCellRegistry.addGroups([
    { prefix: 'A', label: 'a', count: 2 },
    { prefix: 'B', label: 'b', count: 3 },
  ]);
  geometry._varCellRegistry.clear();
  // After clear, no var cells should exist.
  assert.equal(geometry._varCellRegistry._groups.size, 0);
  assert.equal(geometry._varCellRegistry._totalCells, 0);
});

await runTest('cellGraph: caches result without var cells', () => {
  const geometry = CellGeometry.fromGridSize(9);
  assert.equal(geometry.cellGraph(), geometry.cellGraph());
});

await runTest('cellGraph: var cells have correct edges within group', () => {
  const geometry = makeShapeWithGroups(9, [
    { prefix: 'T', label: 'test', count: 9 },
  ]);
  const graph = geometry.cellGraph();
  const cells = geometry.varCellsForGroup('T');

  // First cell: no LEFT, has RIGHT.
  const e0 = graph.cellEdges(cells[0]);
  assert.equal(e0[CellGraph.LEFT], null);
  assert.equal(e0[CellGraph.RIGHT], cells[1]);
  assert.equal(e0[CellGraph.UP], null);
  assert.equal(e0[CellGraph.DOWN], null);

  // Middle cell: has LEFT and RIGHT.
  const e4 = graph.cellEdges(cells[4]);
  assert.equal(e4[CellGraph.LEFT], cells[3]);
  assert.equal(e4[CellGraph.RIGHT], cells[5]);
  assert.equal(e4[CellGraph.UP], null);
  assert.equal(e4[CellGraph.DOWN], null);

  // Last cell: has LEFT, no RIGHT.
  const e8 = graph.cellEdges(cells[8]);
  assert.equal(e8[CellGraph.LEFT], cells[7]);
  assert.equal(e8[CellGraph.RIGHT], null);
});

await runTest('cellGraph: multi-row group has UP/DOWN edges', () => {
  const geometry = makeShapeWithGroups(9, [
    { prefix: 'B', label: 'box', count: 9, columns: 3 },
  ]);
  const graph = geometry.cellGraph();
  const cells = geometry.varCellsForGroup('B');

  // Center cell (index 4, row 1 col 1): all 4 neighbors.
  const e4 = graph.cellEdges(cells[4]);
  assert.equal(e4[CellGraph.LEFT], cells[3]);
  assert.equal(e4[CellGraph.RIGHT], cells[5]);
  assert.equal(e4[CellGraph.UP], cells[1]);
  assert.equal(e4[CellGraph.DOWN], cells[7]);

  // Top-left corner (index 0): only RIGHT and DOWN.
  const e0 = graph.cellEdges(cells[0]);
  assert.equal(e0[CellGraph.LEFT], null);
  assert.equal(e0[CellGraph.UP], null);
  assert.equal(e0[CellGraph.RIGHT], cells[1]);
  assert.equal(e0[CellGraph.DOWN], cells[3]);
});

await runTest('cellGraph: cellPosition tracks row, col, and origin within var-cell groups', () => {
  const geometry = makeShapeWithGroups(4, [
    { prefix: 'A', label: 'a', count: 4, columns: 2 },
    { prefix: 'B', label: 'b', count: 3 },
  ]);
  const graph = geometry.cellGraph();
  const aCells = geometry.varCellsForGroup('A');
  const bCells = geometry.varCellsForGroup('B');

  assert.deepEqual(graph.cellPosition(aCells[0]), [0, 0, aCells[0]]);
  assert.deepEqual(graph.cellPosition(aCells[3]), [1, 1, aCells[0]]);
  assert.deepEqual(graph.cellPosition(bCells[0]), [0, 0, bCells[0]]);
  assert.deepEqual(graph.cellPosition(bCells[2]), [0, 2, bCells[0]]);
  assert.equal(graph.cellPosition(aCells[3])[2], aCells[0]);
  assert.equal(graph.cellPosition(bCells[2])[2], bCells[0]);
  assert.notEqual(graph.cellPosition(aCells[3])[2], graph.cellPosition(bCells[2])[2]);
});

await runTest('cellGraph: wrappingTraverse stays within a var-cell group', () => {
  // 7 cells in 3 columns => rows [0,1,2], [3,4,5], [6].
  const geometry = makeShapeWithGroups(9, [
    { prefix: 'T', label: 'test', count: 7, columns: 3 },
  ]);
  const graph = geometry.cellGraph();
  const cells = geometry.varCellsForGroup('T');

  // Row wrap.
  assert.equal(graph.wrappingTraverse(cells[2], 0, 1), cells[0]);
  assert.equal(graph.wrappingTraverse(cells[0], 0, -1), cells[2]);
  // Column wrap, including a partial last row.
  assert.equal(graph.wrappingTraverse(cells[4], 1, 0), cells[1]);
  assert.equal(graph.wrappingTraverse(cells[0], -1, 0), cells[6]);
  // A cell alone in its row wraps to itself.
  assert.equal(graph.wrappingTraverse(cells[6], 0, 1), cells[6]);
  // traverse (no wrap) stops at the group boundary.
  assert.equal(graph.traverse(cells[4], 1, 0), null);
});

await runTest('cellGraph: wrappingTraverse in a single-cell group returns itself', () => {
  const geometry = makeShapeWithGroups(9, [
    { prefix: 'S', label: 'solo', count: 1 },
  ]);
  const graph = geometry.cellGraph();
  const [cell] = geometry.varCellsForGroup('S');

  assert.equal(graph.wrappingTraverse(cell, 0, 1), cell);
  assert.equal(graph.wrappingTraverse(cell, 1, 0), cell);
});

await runTest('cellGraph: no edges between different groups', () => {
  const geometry = makeShapeWithGroups(4, [
    { prefix: 'A', label: 'alpha', count: 4 },
    { prefix: 'B', label: 'beta', count: 4 },
  ]);
  const graph = geometry.cellGraph();
  const aCells = geometry.varCellsForGroup('A');
  const bCells = geometry.varCellsForGroup('B');

  const eALast = graph.cellEdges(aCells[3]);
  const eBFirst = graph.cellEdges(bCells[0]);
  for (const adj of eALast) {
    if (adj !== null) assert.ok(!bCells.includes(adj));
  }
  for (const adj of eBFirst) {
    if (adj !== null) assert.ok(!aCells.includes(adj));
  }
});

await runTest('cellGraph: no edges between grid and var cells', () => {
  const geometry = makeShapeWithGroups(4, [
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const graph = geometry.cellGraph();
  const varCells = new Set(geometry.varCellsForGroup('T'));

  for (let i = 0; i < geometry.numGridCells; i++) {
    for (const adj of graph.cellEdges(i)) {
      if (adj !== null) assert.ok(!varCells.has(adj));
    }
  }
});

await runTest('cellGraph: grid cell edges unchanged with var cells', () => {
  const geometry = makeShapeWithGroups(9, [
    { prefix: 'T', label: 'test', count: 9 },
  ]);
  const graph = geometry.cellGraph();
  const cell = geometry.cellIndex(4, 4);
  const edges = graph.cellEdges(cell);
  assert.equal(edges[CellGraph.LEFT], geometry.cellIndex(4, 3));
  assert.equal(edges[CellGraph.RIGHT], geometry.cellIndex(4, 5));
  assert.equal(edges[CellGraph.UP], geometry.cellIndex(3, 4));
  assert.equal(edges[CellGraph.DOWN], geometry.cellIndex(5, 4));
});

await runTest('cellGraph: cellsAreConnected works for var cells', () => {
  const geometry = makeShapeWithGroups(4, [
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const graph = geometry.cellGraph();
  const cells = geometry.varCellsForGroup('T');

  assert.ok(graph.cellsAreConnected(new Set(cells)));
  assert.ok(graph.cellsAreConnected(new Set([cells[0], cells[1]])));
  assert.ok(!graph.cellsAreConnected(new Set([cells[0], cells[3]])));
});

await runTest('cellGraph: returns same instance on repeated calls', () => {
  const geometry = makeShapeWithGroups(4, [
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const g1 = geometry.cellGraph();
  const g2 = geometry.cellGraph();
  assert.equal(g1, g2);
});

await runTest('cellGraph: invalidates when var cells change', () => {
  const geometry = CellGeometry.fromGridSize(4);
  const g1 = geometry.cellGraph();

  geometry._varCellRegistry.addGroups([
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const g2 = geometry.cellGraph();
  assert.notEqual(g1, g2);

  // New graph has var cell edges.
  const cells = geometry.varCellsForGroup('T');
  assert.notEqual(g2.cellEdges(cells[0]), undefined);
  assert.equal(g2.cellEdges(cells[0])[CellGraph.RIGHT], cells[1]);
});

await runTest('cellGraph: invalidates on removal too', () => {
  const geometry = CellGeometry.fromGridSize(4);
  geometry._varCellRegistry.addGroups([
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const g1 = geometry.cellGraph();

  geometry._varCellRegistry.removeGroups([{ prefix: 'T' }]);
  const g2 = geometry.cellGraph();
  assert.notEqual(g1, g2);

  // Grid cells still correct after removal.
  const cell = geometry.cellIndex(1, 1);
  const edges = g2.cellEdges(cell);
  assert.equal(edges[CellGraph.LEFT], geometry.cellIndex(1, 0));
  assert.equal(edges[CellGraph.RIGHT], geometry.cellIndex(1, 2));
});

logSuiteComplete('geometry.cellGraph()');
