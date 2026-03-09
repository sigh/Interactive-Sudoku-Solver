import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, createCellExclusions, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Or, True, False } = await import('../../js/solver/handlers.js');

// Or requires a stateAllocator with an allocate method, and postInitialize
// with a grid-like array. This helper handles both.
// Or uses .set() and .fill() on grids, so typed arrays are required.
function initOrHandler(context, handler) {
  // Convert the grid to Uint16Array for Or compatibility.
  const plainGrid = context.grid;
  const typedGrid = new Uint16Array(plainGrid.length);
  for (let i = 0; i < plainGrid.length; i++) typedGrid[i] = plainGrid[i];
  context._grid = typedGrid;

  const extraState = [];
  const stateAllocator = {
    allocate(state) {
      const start = typedGrid.length + extraState.length;
      extraState.push(...state);
      return start;
    }
  };

  const cellExclusions = createCellExclusions({ numCells: context.shape.numCells });
  const result = handler.initialize(typedGrid, cellExclusions, context.shape, stateAllocator);

  if (result && extraState.length) {
    // Extend the grid to include the extra state.
    const newGrid = new Uint16Array(typedGrid.length + extraState.length);
    newGrid.set(typedGrid);
    for (let i = 0; i < extraState.length; i++) newGrid[typedGrid.length + i] = extraState[i];
    context._grid = newGrid;
    handler.postInitialize(newGrid);
  }

  return result;
}

await runTest('all handlers fail returns false', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Or(new False([0]), new False([0]));
  const result = initOrHandler(context, handler);
  assert.equal(result, false);
});

await runTest('single valid handler delegates', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Or(new True(), new False([0]));
  const result = initOrHandler(context, handler);
  assert.equal(result, true);

  const grid = context._grid || context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('multiple valid handlers union', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Or(new True(), new True());
  const result = initOrHandler(context, handler);
  assert.equal(result, true);

  const grid = context._grid || context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('init prunes infeasible handlers', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Or(new True(), new False([0]), new True());
  const result = initOrHandler(context, handler);
  assert.equal(result, true);
});

logSuiteComplete('or.test.js');
