import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../js/grid_shape.js');
const { GridGraph } = await import('../js/display.js');

// ============================================================================
// GridGraph
// ============================================================================

await runTest('GridGraph adjacency is correct for interior cell', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = GridGraph.get(shape);
  // Cell at row 4, col 4 (index 40) should have 4 neighbors
  const cell = shape.cellIndex(4, 4);
  const edges = graph.cellEdges(cell);
  assert.equal(edges[GridGraph.LEFT], shape.cellIndex(4, 3));
  assert.equal(edges[GridGraph.RIGHT], shape.cellIndex(4, 5));
  assert.equal(edges[GridGraph.UP], shape.cellIndex(3, 4));
  assert.equal(edges[GridGraph.DOWN], shape.cellIndex(5, 4));
});

await runTest('GridGraph adjacency is null at edges', () => {
  const shape = GridShape.fromGridSize(9);
  const graph = GridGraph.get(shape);

  // Top-left corner (0,0)
  const topLeft = shape.cellIndex(0, 0);
  assert.equal(graph.cellEdges(topLeft)[GridGraph.LEFT], null);
  assert.equal(graph.cellEdges(topLeft)[GridGraph.UP], null);
  assert.notEqual(graph.cellEdges(topLeft)[GridGraph.RIGHT], null);
  assert.notEqual(graph.cellEdges(topLeft)[GridGraph.DOWN], null);

  // Bottom-right corner (8,8)
  const bottomRight = shape.cellIndex(8, 8);
  assert.equal(graph.cellEdges(bottomRight)[GridGraph.RIGHT], null);
  assert.equal(graph.cellEdges(bottomRight)[GridGraph.DOWN], null);
});

await runTest('GridGraph works for different grid sizes', () => {
  for (const size of [4, 6, 9, 16]) {
    const shape = GridShape.fromGridSize(size);
    const graph = GridGraph.get(shape);

    // Check that last cell has correct bounds
    const lastCell = shape.cellIndex(size - 1, size - 1);
    assert.equal(graph.cellEdges(lastCell)[GridGraph.RIGHT], null);
    assert.equal(graph.cellEdges(lastCell)[GridGraph.DOWN], null);

    // Check an interior cell
    if (size > 2) {
      const interiorCell = shape.cellIndex(1, 1);
      const edges = graph.cellEdges(interiorCell);
      assert.equal(edges[GridGraph.LEFT], shape.cellIndex(1, 0));
      assert.equal(edges[GridGraph.RIGHT], shape.cellIndex(1, 2));
      assert.equal(edges[GridGraph.UP], shape.cellIndex(0, 1));
      assert.equal(edges[GridGraph.DOWN], shape.cellIndex(2, 1));
    }
  }
});

logSuiteComplete('GridGraph');
