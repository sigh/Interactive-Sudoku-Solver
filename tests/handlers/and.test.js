import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, createCellExclusions, createStateAllocator, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { And, Or, True, False, AllDifferent, Rellik } = await import('../../js/solver/handlers.js');

const { Sum } = await import('../../js/solver/sum_handler.js');

await runTest('And reuses exclusions when every declared pair already exists', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const exclusions = createCellExclusions({ allUnique: true, numCells: 4 });
  exclusions.getArray(0); // Sharing must also work with a sealed graph.
  const sum = new Sum([0, 1], 4);
  const handler = new And(sum, new AllDifferent([0, 1]));
  assert.equal(context.initializeHandler(handler, { cellExclusions: exclusions }), true);
  assert.equal(sum._cellExclusions, exclusions);
  assert.ok(sum._flags & Sum._FLAG_CAGE);
  context.grid[0] = context.grid[1] = valueMask(1, 2, 3);
  assert.equal(handler.enforceConsistency(context.grid, createAccumulator()), true);
  assert.equal(context.grid[0], valueMask(1, 3));
  assert.equal(context.grid[1], valueMask(1, 3));
});

await runTest('all pass returns true', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new And(new True(), new True());
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('first failure short circuits', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new And(new False([0]), new True());
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('init short circuits on failure', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new And(new False([0]), new True());
  const result = context.initializeHandler(handler);
  assert.equal(result, false);
});

await runTest('cells is union of sub handlers', () => {
  const handler = new And(new True(), new True());
  // True has no cells, so And should have no cells either.
  assert.equal(handler.cells.length, 0);
});

await runTest('cage sum sees branch-local exclusions and prunes repeated-value sums', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const exclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  // Populate the global cache before constructing the local graph.
  exclusions.getArray(0);
  const sum = new Sum([0, 1], 4);
  const handler = new And(sum, new AllDifferent([0, 1]));
  assert.equal(context.initializeHandler(handler, { cellExclusions: exclusions }), true);
  assert.ok(sum._flags & Sum._FLAG_CAGE);
  assert.equal(exclusions.isMutuallyExclusive(0, 1), false);
  context.grid[0] = context.grid[1] = valueMask(1, 2, 3);
  assert.equal(handler.enforceConsistency(context.grid, createAccumulator()), true);
  assert.equal(context.grid[0], valueMask(1, 3));
  assert.equal(context.grid[1], valueMask(1, 3));
});

await runTest('Rellik initializes with the all-different rule of its conjunction', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const exclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  const handler = new And(new Rellik([0, 1], 5), new AllDifferent([0, 1]));
  assert.equal(context.initializeHandler(handler, { cellExclusions: exclusions }), true);
  context.grid[0] = valueMask(2);
  assert.equal(handler.enforceConsistency(context.grid, createAccumulator()), true);
  assert.equal(context.grid[1], valueMask(1, 4));
  assert.equal(exclusions.isMutuallyExclusive(0, 1), false);
});

await runTest('cage exclusions do not leak into an alternative Or branch', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  context._grid = new Uint16Array(64);
  context.grid.fill(valueMask(1, 2, 3, 4), 0, 4);
  const exclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  const cageSum = new Sum([0, 1], 4);
  const otherSum = new Sum([0, 1], 4);
  const handler = new Or(
    new And(cageSum, new AllDifferent([0, 1])), otherSum);
  assert.equal(context.initializeHandler(handler, {
    cellExclusions: exclusions, state: createStateAllocator(context.grid, 4),
  }), true);
  handler.postInitialize(context.grid);
  assert.ok(cageSum._flags & Sum._FLAG_CAGE);
  assert.equal(otherSum._flags & Sum._FLAG_CAGE, 0);
  context.grid[0] = context.grid[1] = valueMask(2);
  assert.equal(handler.enforceConsistency(context.grid, createAccumulator()), true);
  assert.equal(context.grid[0], valueMask(2));
  assert.equal(context.grid[1], valueMask(2));
});

logSuiteComplete('and.test.js');
