import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape, CellGraph, SHAPE_9x9, SHAPE_MAX } = await import('../../js/grid_shape.js');

// ============================================================================
// GridShape.fromGridSize (square grids)
// ============================================================================

await runTest('fromGridSize creates valid shape for size 9', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.numRows, 9);
  assert.equal(shape.numCols, 9);
  assert.equal(shape.numValues, 9);
  assert.equal(shape.numGridCells, 81);
  assert.equal(shape.numPencilmarks, 729);
});

await runTest('fromGridSize creates valid shape for size 4', () => {
  const shape = GridShape.fromGridSize(4);
  assert.equal(shape.numRows, 4);
  assert.equal(shape.numCols, 4);
  assert.equal(shape.numValues, 4);
  assert.equal(shape.numGridCells, 16);
});

await runTest('fromGridSize creates valid shape for size 16', () => {
  const shape = GridShape.fromGridSize(16);
  assert.equal(shape.numRows, 16);
  assert.equal(shape.numCols, 16);
  assert.equal(shape.numValues, 16);
  assert.equal(shape.numGridCells, 256);
});

await runTest('fromGridSize returns null for invalid sizes', () => {
  assert.equal(GridShape.fromGridSize(0), null);
  assert.equal(GridShape.fromGridSize(-1), null);
  assert.equal(GridShape.fromGridSize(17), null);
  assert.equal(GridShape.fromGridSize(1.5), null);
});


await runTest('fromGridSize creates rectangular 6x8 grid', () => {
  const shape = GridShape.fromGridSize(6, 8);
  assert.equal(shape.numRows, 6);
  assert.equal(shape.numCols, 8);
  assert.equal(shape.numValues, 8); // max(6, 8)
  assert.equal(shape.numGridCells, 48);
  assert.equal(shape.name, '6x8');
});

await runTest('fromGridSize creates rectangular 8x6 grid', () => {
  const shape = GridShape.fromGridSize(8, 6);
  assert.equal(shape.numRows, 8);
  assert.equal(shape.numCols, 6);
  assert.equal(shape.numValues, 8); // max(8, 6)
  assert.equal(shape.numGridCells, 48);
  assert.equal(shape.name, '8x6');
});

await runTest('fromGridSize returns null for invalid dimensions', () => {
  assert.equal(GridShape.fromGridSize(0, 9), null);
  assert.equal(GridShape.fromGridSize(9, 0), null);
  assert.equal(GridShape.fromGridSize(17, 9), null);
  assert.equal(GridShape.fromGridSize(9, 17), null);
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

await runTest('numRows * numCols equals numGridCells', () => {
  for (const size of [4, 6, 9, 12, 16]) {
    const shape = GridShape.fromGridSize(size);
    assert.equal(shape.numRows * shape.numCols, shape.numGridCells);
  }
  // Also test rectangular
  const rect = GridShape.fromGridSize(6, 8);
  assert.equal(rect.numRows * rect.numCols, rect.numGridCells);
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

// ============================================================================
// valueOffset
// ============================================================================

await runTest('fromGridSize with valueOffset=-1 creates 0-based shape', () => {
  const shape = GridShape.fromGridSize(9, 9, null, -1);
  assert.equal(shape.numValues, 9);
  assert.equal(shape.valueOffset, -1);
  assert.equal(shape.name, '9x9~0-8');
});

await runTest('fromGridSize rejects invalid valueOffset', () => {
  assert.throws(() => GridShape.fromGridSize(9, 9, null, -2));
  assert.throws(() => GridShape.fromGridSize(9, 9, null, 1));
});

await runTest('fromGridSpec parses range syntax', () => {
  const shape = GridShape.fromGridSpec('9x9~0-8');
  assert.equal(shape.numValues, 9);
  assert.equal(shape.valueOffset, -1);
  assert.equal(shape.name, '9x9~0-8');
});

await runTest('fromGridSpec rejects invalid range offset', () => {
  // 2-10 means offset=1, which is not allowed
  assert.throws(() => GridShape.fromGridSpec('9x9~2-10'));
});

await runTest('makeName produces canonical forms', () => {
  // Default 9x9: no suffix
  assert.equal(GridShape.makeName(9, 9, 9, 0), '9x9');
  // Non-default numValues: bare number suffix
  assert.equal(GridShape.makeName(9, 9, 10, 0), '9x9~10');
  // Zero-based: range suffix
  assert.equal(GridShape.makeName(9, 9, 9, -1), '9x9~0-8');
});

await runTest('fromGridSpec round-trips through name', () => {
  for (const spec of ['9x9', '9x9~10', '9x9~0-8', '4x6', '6x8~0-7']) {
    const shape = GridShape.fromGridSpec(spec);
    const reparsed = GridShape.fromGridSpec(shape.name);
    assert.equal(reparsed.name, shape.name);
    assert.equal(reparsed.numValues, shape.numValues);
    assert.equal(reparsed.valueOffset, shape.valueOffset);
  }
});

logSuiteComplete('GridShape');

// ============================================================================
// CellGraph
// ============================================================================

await runTest('CellGraph adjacency is correct for interior cell', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = shape.cellGraph();
  // Cell at row 4, col 4 (index 40) should have 4 neighbors
  const cell = shape.cellIndex(4, 4);
  const edges = graph.cellEdges(cell);
  assert.equal(edges[CellGraph.LEFT], shape.cellIndex(4, 3));
  assert.equal(edges[CellGraph.RIGHT], shape.cellIndex(4, 5));
  assert.equal(edges[CellGraph.UP], shape.cellIndex(3, 4));
  assert.equal(edges[CellGraph.DOWN], shape.cellIndex(5, 4));
});

await runTest('CellGraph adjacency is null at edges', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = shape.cellGraph();

  // Top-left corner (0,0)
  const topLeft = shape.cellIndex(0, 0);
  assert.equal(graph.cellEdges(topLeft)[CellGraph.LEFT], null);
  assert.equal(graph.cellEdges(topLeft)[CellGraph.UP], null);
  assert.notEqual(graph.cellEdges(topLeft)[CellGraph.RIGHT], null);
  assert.notEqual(graph.cellEdges(topLeft)[CellGraph.DOWN], null);

  // Bottom-right corner (8,8)
  const bottomRight = shape.cellIndex(8, 8);
  assert.equal(graph.cellEdges(bottomRight)[CellGraph.RIGHT], null);
  assert.equal(graph.cellEdges(bottomRight)[CellGraph.DOWN], null);
});

await runTest('CellGraph works for different grid sizes', () => {
  for (const size of [4, 6, 9, 16]) {
    const shape = GridShape.fromGridSize(size);
    const graph = shape.cellGraph();

    // Check that last cell has correct bounds
    const lastCell = shape.cellIndex(size - 1, size - 1);
    assert.equal(graph.cellEdges(lastCell)[CellGraph.RIGHT], null);
    assert.equal(graph.cellEdges(lastCell)[CellGraph.DOWN], null);

    // Check an interior cell
    if (size > 2) {
      const interiorCell = shape.cellIndex(1, 1);
      const edges = graph.cellEdges(interiorCell);
      assert.equal(edges[CellGraph.LEFT], shape.cellIndex(1, 0));
      assert.equal(edges[CellGraph.RIGHT], shape.cellIndex(1, 2));
      assert.equal(edges[CellGraph.UP], shape.cellIndex(0, 1));
      assert.equal(edges[CellGraph.DOWN], shape.cellIndex(2, 1));
    }
  }
});

await runTest('CellGraph.adjacent returns neighbor in given direction', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = shape.cellGraph();
  const cell = shape.cellIndex(4, 4);
  assert.equal(graph.adjacent(cell, CellGraph.RIGHT), shape.cellIndex(4, 5));
  assert.equal(graph.adjacent(cell, CellGraph.LEFT), shape.cellIndex(4, 3));
});

await runTest('CellGraph.diagonal returns diagonal neighbor', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = shape.cellGraph();
  const cell = shape.cellIndex(4, 4);
  // Down-right diagonal
  assert.equal(graph.diagonal(cell, CellGraph.RIGHT, CellGraph.DOWN), shape.cellIndex(5, 5));
  // Up-left diagonal
  assert.equal(graph.diagonal(cell, CellGraph.LEFT, CellGraph.UP), shape.cellIndex(3, 3));
});

await runTest('CellGraph.diagonal returns null at edge', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = shape.cellGraph();
  const corner = shape.cellIndex(0, 0);
  assert.equal(graph.diagonal(corner, CellGraph.LEFT, CellGraph.UP), null);
});

logSuiteComplete('CellGraph');

// ============================================================================
// shape.cellGraph() (var cell adjacency + caching)
// ============================================================================

function makeShapeWithGroups(size, groups) {
  const shape = GridShape.fromGridSize(size);
  shape._varCellRegistry.addGroups(groups);
  return shape;
}

await runTest('VarCellRegistry.addGroups throws on duplicate prefix', () => {
  const shape = GridShape.fromGridSize(4);
  shape._varCellRegistry.addGroups([{ prefix: 'X', label: 'x', count: 2 }]);
  assert.throws(
    () => shape._varCellRegistry.addGroups([{ prefix: 'X', label: 'x2', count: 3 }]),
    /Var cell group prefix 'X' already exists/);
});

await runTest('VarCellRegistry.clear removes all groups', () => {
  const shape = GridShape.fromGridSize(4);
  shape._varCellRegistry.addGroups([
    { prefix: 'A', label: 'a', count: 2 },
    { prefix: 'B', label: 'b', count: 3 },
  ]);
  shape._varCellRegistry.clear();
  // After clear, no var cells should exist.
  assert.equal(shape._varCellRegistry._groups.size, 0);
  assert.equal(shape._varCellRegistry._totalCells, 0);
});

await runTest('cellGraph: caches result without var cells', () => {
  const shape = GridShape.fromGridSize(9);
  assert.equal(shape.cellGraph(), shape.cellGraph());
});

await runTest('cellGraph: var cells have correct edges within group', () => {
  const shape = makeShapeWithGroups(9, [
    { prefix: 'T', label: 'test', count: 9 },
  ]);
  const graph = shape.cellGraph();
  const cells = shape.varCellsForGroup('T');

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
  const shape = makeShapeWithGroups(9, [
    { prefix: 'B', label: 'box', count: 9, columns: 3 },
  ]);
  const graph = shape.cellGraph();
  const cells = shape.varCellsForGroup('B');

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

await runTest('cellGraph: no edges between different groups', () => {
  const shape = makeShapeWithGroups(4, [
    { prefix: 'A', label: 'alpha', count: 4 },
    { prefix: 'B', label: 'beta', count: 4 },
  ]);
  const graph = shape.cellGraph();
  const aCells = shape.varCellsForGroup('A');
  const bCells = shape.varCellsForGroup('B');

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
  const shape = makeShapeWithGroups(4, [
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const graph = shape.cellGraph();
  const varCells = new Set(shape.varCellsForGroup('T'));

  for (let i = 0; i < shape.numGridCells; i++) {
    for (const adj of graph.cellEdges(i)) {
      if (adj !== null) assert.ok(!varCells.has(adj));
    }
  }
});

await runTest('cellGraph: grid cell edges unchanged with var cells', () => {
  const shape = makeShapeWithGroups(9, [
    { prefix: 'T', label: 'test', count: 9 },
  ]);
  const graph = shape.cellGraph();
  const cell = shape.cellIndex(4, 4);
  const edges = graph.cellEdges(cell);
  assert.equal(edges[CellGraph.LEFT], shape.cellIndex(4, 3));
  assert.equal(edges[CellGraph.RIGHT], shape.cellIndex(4, 5));
  assert.equal(edges[CellGraph.UP], shape.cellIndex(3, 4));
  assert.equal(edges[CellGraph.DOWN], shape.cellIndex(5, 4));
});

await runTest('cellGraph: cellsAreConnected works for var cells', () => {
  const shape = makeShapeWithGroups(4, [
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const graph = shape.cellGraph();
  const cells = shape.varCellsForGroup('T');

  assert.ok(graph.cellsAreConnected(new Set(cells)));
  assert.ok(graph.cellsAreConnected(new Set([cells[0], cells[1]])));
  assert.ok(!graph.cellsAreConnected(new Set([cells[0], cells[3]])));
});

await runTest('cellGraph: returns same instance on repeated calls', () => {
  const shape = makeShapeWithGroups(4, [
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const g1 = shape.cellGraph();
  const g2 = shape.cellGraph();
  assert.equal(g1, g2);
});

await runTest('cellGraph: invalidates when var cells change', () => {
  const shape = GridShape.fromGridSize(4);
  const g1 = shape.cellGraph();

  shape._varCellRegistry.addGroups([
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const g2 = shape.cellGraph();
  assert.notEqual(g1, g2);

  // New graph has var cell edges.
  const cells = shape.varCellsForGroup('T');
  assert.notEqual(g2.cellEdges(cells[0]), undefined);
  assert.equal(g2.cellEdges(cells[0])[CellGraph.RIGHT], cells[1]);
});

await runTest('cellGraph: invalidates on removal too', () => {
  const shape = GridShape.fromGridSize(4);
  shape._varCellRegistry.addGroups([
    { prefix: 'T', label: 'test', count: 4 },
  ]);
  const g1 = shape.cellGraph();

  shape._varCellRegistry.removeGroups([{ prefix: 'T' }]);
  const g2 = shape.cellGraph();
  assert.notEqual(g1, g2);

  // Grid cells still correct after removal.
  const cell = shape.cellIndex(1, 1);
  const edges = g2.cellEdges(cell);
  assert.equal(edges[CellGraph.LEFT], shape.cellIndex(1, 0));
  assert.equal(edges[CellGraph.RIGHT], shape.cellIndex(1, 2));
});

logSuiteComplete('shape.cellGraph()');
