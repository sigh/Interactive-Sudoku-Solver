import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask, initTypedHandler } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Or, True, False, GivenCandidates } = await import('../../js/solver/handlers.js');
const { LookupTables } = await import('../../js/solver/lookup_tables.js');

// Or requires a typed, state-extended grid and postInitialize; initTypedHandler
// (shared with the Or-wrap harness) sets both up.
const initOrHandler = (context, handler) =>
  initTypedHandler(context, handler).result;

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

// Helper: create a context with a geometry that has var cells.
function contextWithVarCells({ gridSize, numValues, varCellCount }) {
  const context = new GridTestContext({ gridSize, numValues });
  context.geometry._varCellRegistry.addGroups([
    { prefix: 'VX', count: varCellCount },
  ]);
  return context;
}

await runTest('var cells: initialization captures var cell constraints', () => {
  // 1x4 grid with 4 values, plus 1 var cell (index 4).
  // Branch 1: var cell = 1, Branch 2: var cell = 2.
  // The Or handler should capture these as per-branch initializations
  // and apply them via enforceConsistency.
  const context = contextWithVarCells({
    gridSize: [1, 4], numValues: 4, varCellCount: 1,
  });
  const varCell = context.geometry.numGridCells;  // = 4

  const branch1 = new GivenCandidates(new Map([[varCell, [1]]]));
  const branch2 = new GivenCandidates(new Map([[varCell, [2]]]));
  const handler = new Or(branch1, branch2);

  const result = initOrHandler(context, handler);
  assert.equal(result, true);

  const grid = context._grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // The var cell should be constrained to {1, 2} (union of branches).
  assert.equal(grid[varCell], valueMask(1, 2));
});

await runTest('var cells: enforceConsistency unions var cell values', () => {
  // Same setup: Or with two branches constraining a var cell differently.
  const context = contextWithVarCells({
    gridSize: [1, 4], numValues: 4, varCellCount: 1,
  });
  const varCell = context.geometry.numGridCells;

  const branch1 = new GivenCandidates(new Map([[varCell, [1]]]));
  const branch2 = new GivenCandidates(new Map([[varCell, [3]]]));
  const handler = new Or(branch1, branch2);

  const result = initOrHandler(context, handler);
  assert.equal(result, true);

  const grid = context._grid;
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Var cell should be the union: {1, 3}.
  assert.equal(grid[varCell], valueMask(1, 3));
});

await runTest('var cells: var cell not left unconstrained', () => {
  // Regression test: var cell must not retain all values (1-4)
  // when both branches constrain it to a subset.
  const context = contextWithVarCells({
    gridSize: [1, 4], numValues: 4, varCellCount: 1,
  });
  const varCell = context.geometry.numGridCells;
  const allValues = LookupTables.get(4).allValues;

  const branch1 = new GivenCandidates(new Map([[varCell, [1]]]));
  const branch2 = new GivenCandidates(new Map([[varCell, [2]]]));
  const handler = new Or(branch1, branch2);

  const result = initOrHandler(context, handler);
  assert.equal(result, true);

  const grid = context._grid;
  const acc = createAccumulator();
  handler.enforceConsistency(grid, acc);

  // The var cell must NOT have all values — it must be restricted.
  assert.notEqual(grid[varCell], allValues,
    'var cell should not have all values after Or enforcement');
  assert.equal(grid[varCell], valueMask(1, 2));
});

logSuiteComplete('or.test.js');
