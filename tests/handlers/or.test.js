import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator, valueMask, initTypedHandler, createCellExclusions } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Or, And, True, False, GivenCandidates, SameValues } = await import('../../js/solver/handlers.js');
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

await runTest('all handlers fail leaves enforceConsistency safe', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Or(new False([0]), new False([0]));
  assert.equal(initOrHandler(context, handler), false);

  // The engine keeps a failed handler (it only invalidates the grid) and
  // still runs postInitialize and the initial propagation pass on it.
  handler.postInitialize(context._grid);
  assert.equal(
    handler.enforceConsistency(context._grid, createAccumulator()), false);
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

// -- nested composite watched-cell discovery --
//
// GivenCandidates registers no constructor-time cells (it acts via
// initialize), so an Or over GivenCandidates starts with cells=[] and only
// discovers its dependencies during initialize. A *nested* Or's dependencies
// must propagate up through the enclosing composites, or the outer handler is
// attached to no cell and the engine never schedules it (it is then silently
// unenforced -- the bug behind pipeline blockers #1107/#1109).

const makeInnerOrOn = (cell) => new Or(
  new GivenCandidates(new Map([[cell, [1, 2]]])),
  new GivenCandidates(new Map([[cell, [3]]])));

await runTest('nested Or discovers watched cells during initialize', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const outer = new Or(makeInnerOrOn(0), makeInnerOrOn(1));

  // Constructor-time: no branch exposes any cells.
  assert.equal(outer.cells.length, 0);

  const result = initOrHandler(context, outer);
  assert.equal(result, true);

  const watched = new Set(outer.cells);
  assert.ok(watched.has(0) && watched.has(1),
    'outer Or must watch the cells its nested branches depend on, got: '
    + JSON.stringify([...outer.cells]));
});

await runTest('And mirrors child cells extended during initialize', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const outer = new Or(new And(makeInnerOrOn(0)), new And(makeInnerOrOn(1)));

  assert.equal(outer.cells.length, 0);

  const result = initOrHandler(context, outer);
  assert.equal(result, true);

  const watched = new Set(outer.cells);
  assert.ok(watched.has(0) && watched.has(1),
    'cells discovered by a nested Or must propagate up through And, got: '
    + JSON.stringify([...outer.cells]));
});

await runTest('nested Or rejects when every branch is dead', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const outer = new Or(new And(makeInnerOrOn(0)), new And(makeInnerOrOn(1)));
  const result = initOrHandler(context, outer);
  assert.equal(result, true);

  const grid = context._grid;
  // Pin both cells to 4: excluded by every Given in every nested branch.
  grid[0] = valueMask(4);
  grid[1] = valueMask(4);
  assert.equal(outer.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('leaf state from a live branch does not persist across calls', () => {
  // Regression: a branch's SameValues restricted its sets to {1,2,3} in the
  // scratch grid and set its "satisfied" flag; the Or kept the flag but not
  // the pruning (the other branch allowed 4). A later call with the sets
  // violated then short-circuited to "satisfied" and the Or accepted a grid
  // no branch allows.
  const context = new GridTestContext({ gridSize: [3, 4], numValues: 4 });
  const numCells = context.geometry.numGridCells;
  // Rows are houses, so each 3-cell set is mutually exclusive (the form that
  // allocates the flag: >2 sets of >2 unique cells).
  const cellExclusions = createCellExclusions({ allUnique: false, numCells });
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        cellExclusions.addMutualExclusion(r * 4 + i, r * 4 + j);
      }
    }
  }
  const sets = [[0, 1, 2], [4, 5, 6], [8, 9, 10]];
  const handler = new Or(
    new And(new SameValues(...sets)),
    // Alternative branch: R3C4 = 4, indifferent to the sets.
    new GivenCandidates([[11, 4]]));

  const { result, grid } = initTypedHandler(context, handler, { cellExclusions });
  assert.equal(result, true);

  // Row 1 of the sets is {1,2,3}; the other rows are open.
  for (const cell of sets[0]) grid[cell] = valueMask(1, 2, 3);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  // The union keeps 4 in the other rows (the second branch allows it).
  assert.equal(grid[4], valueMask(1, 2, 3, 4));

  // Now violate both branches: 4 in a set cell, and R3C4 != 4.
  grid[4] = valueMask(4);
  grid[11] = valueMask(1);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('nested Or eliminations persist across calls', () => {
  // The inverse guarantee: a nested Or's own state (its live-branch words)
  // is still written back, so a branch eliminated under a live outer branch
  // stays eliminated.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const inner = new Or(
    new GivenCandidates([[0, 1]]), new GivenCandidates([[0, 2]]));
  const outer = new Or(new And(inner), new GivenCandidates([[1, 4]]));
  const { result, grid } = initTypedHandler(context, outer);
  assert.equal(result, true);

  grid[0] = valueMask(2, 3);
  assert.equal(outer.enforceConsistency(grid, createAccumulator()), true);
  // Inner branch 0 (cell 0 = 1) was eliminated in the outer's first branch.
  assert.equal(inner._isInvalid(grid, 0), true);
  assert.equal(inner._isInvalid(grid, 1), false);
});

logSuiteComplete('or.test.js');
