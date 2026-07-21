import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createCellExclusions,
  createStateAllocator,
  createAccumulator,
  valueMask,
  applyCandidates,
  assertCandidates,
  assertTouched,
  OR_WRAP_MODES,
  assertOrWrapEquivalent,
  assertOrWrapNoStateLeak,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { ConnectedValues, ConnectedCrossing, ConnectedBorder } =
  await import('../../js/solver/connected_handler.js');
const { InvalidConstraintError } = await import('../../js/solver/handlers.js');
const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js');

// Most tests use a 4x4 grid with no exclusions, so connectivity is exercised
// in isolation. Cell indices are row-major: cell = row * 4 + col.
const makeContext = () => new GridTestContext({ gridSize: [4, 4] });

const initHandler = (context, handler) => {
  const result = context.initializeHandler(handler, {
    cellExclusions: createCellExclusions({
      allUnique: false, numCells: context.geometry.numGridCells,
    }),
  });
  assert.equal(result, true, 'initialize should return true');
};

await runTest('ConnectedValues: full-candidate grid passes with no pruning', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(context.grid, acc), true);
  assertTouched(acc, []);
});

await runTest('ConnectedValues: decided cells split by a barrier fail', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  // Row 1 excludes value 1, splitting row 0 from rows 2-3.
  const grid = applyCandidates(context.grid, {
    0: [1], 15: [1],
    4: [2, 3, 4], 5: [2, 3, 4], 6: [2, 3, 4], 7: [2, 3, 4],
  });
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: components without a decided cell are pruned', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  // Decided cell in row 0; row 1 is a barrier; rows 2-3 are undecided.
  const assignments = { 0: [1], 4: [2, 3, 4], 5: [2, 3, 4], 6: [2, 3, 4], 7: [2, 3, 4] };
  for (let cell = 8; cell < 16; cell++) assignments[cell] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  const expectations = {};
  for (let cell = 8; cell < 16; cell++) expectations[cell] = [2];
  assertCandidates(grid, expectations);
  assertTouched(acc, [8, 9, 10, 11, 12, 13, 14, 15]);
  // The decided cell's own component is untouched.
  assertCandidates(grid, { 0: [1], 1: valueMask(1, 2, 3, 4) });
});

await runTest('ConnectedValues: fully decided connected region passes', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2];
  // An L-shaped connected region.
  assignments[0] = [1]; assignments[4] = [1]; assignments[5] = [1];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
});

await runTest('ConnectedValues: fully decided diagonal region fails', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2];
  // Diagonal adjacency doesn't connect.
  assignments[0] = [1]; assignments[5] = [1];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: empty region fails', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: sole possible cell is forced for non-emptiness', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2, 3];
  assignments[6] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();

  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 6: [1] });
  assertTouched(acc, [6]);
});

await runTest('ConnectedValues: sole support narrows to a multi-value set', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1, 2]);
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [3, 4];
  assignments[9] = [1, 2, 3];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();

  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 9: [1, 2] });
  assertTouched(acc, [9]);
});

await runTest('ConnectedValues: singleton supports feed merged sets in one pass', () => {
  const context = makeContext();
  const handler = new ConnectedValues(
    context.geometry.numGridCells, 0, [[1], [2]]);
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [3, 4];
  assignments[0] = [1, 2];
  assignments[1] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();

  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 0: [1], 1: [2] });
  assertTouched(acc, [0, 1]);
});

await runTest('ConnectedValues: multi-value region counts mixed in-set candidates as decided', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1, 2]);
  initHandler(context, handler);

  // Cells 0 and 15 must hold 1 or 2, so both are decided into the region.
  // Rows 1-2 exclude both values, so the region is permanently split.
  const grid = applyCandidates(context.grid, {
    0: [1, 2], 15: [1, 2],
    4: [3, 4], 5: [3, 4], 6: [3, 4], 7: [3, 4],
    8: [3, 4], 9: [3, 4], 10: [3, 4], 11: [3, 4],
  });
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: cells must cover a whole layer', () => {
  for (const [numGridCells, cellOffset] of [
    [4, 0],    // partial layer
    [16, 1],   // not layer-aligned
    [12, 0],   // wrong cell count
  ]) {
    const context = makeContext();
    const handler = new ConnectedValues(numGridCells, cellOffset, [1]);
    assert.throws(() => initHandler(context, handler), InvalidConstraintError,
      `(${numGridCells}, ${cellOffset}) should be rejected`);
  }
});

await runTest('ConnectedValues: invalid values are rejected', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [5]);
  assert.throws(() => initHandler(context, handler), InvalidConstraintError);
});

await runTest('ConnectedValues: full-grid var cell group uses grid adjacency', () => {
  const context = makeContext();
  const geometry = context.geometry;
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VL', count: geometry.numGridCells }] },
  ]);
  const varCells = geometry.varCellsForGroup('VL');
  const handler = new ConnectedValues(geometry.numGridCells, varCells[0], [1]);

  const grid = new Array(geometry.totalCells()).fill(context.lookupTables.allValues);
  const cellExclusions = createCellExclusions({
    allUnique: false, numCells: geometry.totalCells(),
  });
  assert.equal(
    handler.initialize(grid, cellExclusions, geometry, createStateAllocator(grid)),
    true);

  // Var cells at grid positions 0 and 15, split by a barrier at positions 4-7.
  const offset = varCells[0];
  grid[offset] = valueMask(1);
  grid[offset + 15] = valueMask(1);
  for (let position = 4; position < 8; position++) {
    grid[offset + position] = valueMask(2, 3);
  }
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: partial var cell group is rejected', () => {
  const context = makeContext();
  const geometry = context.geometry;
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VP', count: 4 }] },
  ]);
  const handler = new ConnectedValues(
    geometry.numGridCells, geometry.varCellsForGroup('VP')[0], [1]);
  const grid = new Array(geometry.totalCells()).fill(context.lookupTables.allValues);
  assert.throws(
    () => handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: geometry.totalCells() }),
      geometry, createStateAllocator(grid)),
    InvalidConstraintError);
});

await runTest('ConnectedValues: an offset inside a var cell group is rejected', () => {
  const context = makeContext();
  const geometry = context.geometry;
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VM', count: geometry.numGridCells }] },
  ]);
  const handler = new ConnectedValues(
    geometry.numGridCells, geometry.varCellsForGroup('VM')[1], [1]);
  const grid = new Array(geometry.totalCells()).fill(context.lookupTables.allValues);
  assert.throws(
    () => handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: geometry.totalCells() }),
      geometry, createStateAllocator(grid)),
    InvalidConstraintError);
});

await runTest('ConnectedValues: var group uses its own column count, not the grid', () => {
  const context = makeContext();  // 4x4 grid
  const geometry = context.geometry;
  // 16 cells laid out 2 rows x 8 cols — a different shape from the grid.
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VW', count: 16, columns: 8 }] },
  ]);
  const offset = geometry.varCellsForGroup('VW')[0];
  const handler = new ConnectedValues(16, offset, [1]);
  const grid = new Array(geometry.totalCells()).fill(context.lookupTables.allValues);
  assert.equal(
    handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: geometry.totalCells() }),
      geometry, createStateAllocator(grid)),
    true);

  // Positions 0 and 8 are vertically adjacent in the 2x8 layout (one region);
  // under the grid's 4x4 they would be two rows apart and disconnected.
  const setValue1 = (...positions) => {
    for (let i = 0; i < 16; i++) grid[offset + i] = valueMask(2);
    for (const p of positions) grid[offset + p] = valueMask(1);
  };
  setValue1(0, 8);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);

  // Positions 0 and 9 are diagonal in the 2x8 layout — disconnected.
  setValue1(0, 9);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

// ===========================================================================
// Or-wrap harness (see tests/handlers/or_wrap.test.js). ConnectedValues is
// stateless (no allocated lanes), so it must be transparent to Or nesting.
// ===========================================================================

{
  const scenario = {
    makeContext,
    makeHandler: () => new ConnectedValues(16, 0, [1]),
    cellExclusions: () => createCellExclusions({ allUnique: false, numCells: 16 }),
    // Decided cell 0, row-1 barrier, prunable components below.
    candidates: {
      0: [1], 4: [2, 3, 4], 5: [2, 3, 4], 6: [2, 3, 4], 7: [2, 3, 4],
      8: [1, 2], 9: [1, 2], 10: [1, 2], 11: [1, 2],
      12: [1, 2], 13: [1, 2], 14: [1, 2], 15: [1, 2],
    },
  };
  for (const mode of [OR_WRAP_MODES.FAST_PATH, OR_WRAP_MODES.FAILING_DECOY]) {
    await runTest(`ConnectedValues Or-wrap preserves pruning (${mode})`, () => {
      assertOrWrapEquivalent({ ...scenario, mode });
    });
  }
  await runTest('ConnectedValues Or-wrap leaks no foreign state (liveDecoy)', () => {
    assertOrWrapNoStateLeak(scenario);
  });
}

// ===========================================================================
// Brute-force oracle over the string API: fix the grid digits, put the
// constraint on a Var overlay, and diff the solver's solution count against
// an enumeration of every overlay assignment with a reference flood fill.
// ===========================================================================

const referenceIsConnected = (values, inSet, numRows, numCols) => {
  const start = values.findIndex(v => inSet.includes(v));
  if (start === -1) return false;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cell = queue.pop();
    const row = (cell / numCols) | 0;
    const col = cell % numCols;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= numRows || c >= numCols) continue;
      const neighbor = r * numCols + c;
      if (seen.has(neighbor) || !inSet.includes(values[neighbor])) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return seen.size === values.filter(v => inSet.includes(v)).length;
};

// Every assignment of `domain` values to n cells, as an iterator.
function* allAssignments(domain, n) {
  const values = new Array(n).fill(domain[0]);
  const indexes = new Array(n).fill(0);
  while (true) {
    yield values;
    let position = n - 1;
    while (position >= 0 && indexes[position] === domain.length - 1) {
      indexes[position] = 0;
      values[position] = domain[0];
      position--;
    }
    if (position < 0) return;
    indexes[position]++;
    values[position] = domain[indexes[position]];
  }
}

const gridGivens = (solution, numCols) => solution.split('').map(
  (digit, i) => {
    const row = (i / numCols | 0) + 1;
    const col = (i % numCols) + 1;
    return `.Given~R${row}C${col}_${digit}`;
  }).join('');

await runTest('ConnectedValues: solver matches brute-force oracle (4x4 overlay, single value)', () => {
  // Overlay cells restricted to {1, 2}; cells holding 1 must connect.
  const overlayDomains = Array.from({ length: 16 }, (_, i) =>
    `.~VS${i + 1}_1_2`).join('');
  const input = '.Shape~4x4' + gridGivens('1342243141233214', 4)
    + '.Var~S~~16' + overlayDomains + '.ConnectedValues~VS~1';

  let expected = 0;
  for (const values of allAssignments([1, 2], 16)) {
    if (referenceIsConnected(values, [1], 4, 4)) expected++;
  }
  assert.ok(expected > 0 && expected < 2 ** 16);

  const solver = new SimpleSolver();
  assert.equal(solver.countSolutions(input), expected);
});

await runTest('ConnectedValues: solver matches brute-force oracle (3x3 overlay, value set)', () => {
  // Overlay cells range over 1-3; cells holding 1 or 2 must connect.
  const input = '.Shape~3x3' + gridGivens('123231312', 3)
    + '.Var~S~~9' + '.ConnectedValues~VS~1_2';

  let expected = 0;
  for (const values of allAssignments([1, 2, 3], 9)) {
    if (referenceIsConnected(values, [1, 2], 3, 3)) expected++;
  }
  assert.ok(expected > 0 && expected < 3 ** 9);

  const solver = new SimpleSolver();
  assert.equal(solver.countSolutions(input), expected);
});

await runTest('ConnectedValues: solver matches brute-force oracle (3x3 merged two sets)', () => {
  // Two same-layer sets {1} and {2}: the optimizer merges them and adds the
  // crossing/border handlers. Those are sound, so the solution count must
  // still equal "both sets connected" — this exercises the whole pipeline.
  const input = '.Shape~3x3' + gridGivens('123231312', 3)
    + '.Var~S~~9' + '.ConnectedValues~VS~1.ConnectedValues~VS~2';

  let expected = 0;
  for (const values of allAssignments([1, 2, 3], 9)) {
    if (referenceIsConnected(values, [1], 3, 3) &&
      referenceIsConnected(values, [2], 3, 3)) expected++;
  }
  assert.ok(expected > 0 && expected < 3 ** 9);

  const solver = new SimpleSolver();
  assert.equal(solver.countSolutions(input), expected);
});

await runTest('ConnectedValues: solver matches brute-force oracle (2x3 non-square merged)', () => {
  // A rectangular grid (numRows ≠ numCols) exercises the optimizer's perimeter
  // and 2x2-block index math. Base grid pinned to a valid solution; overlay
  // restricted to {1, 2}; both sets must connect.
  const overlayDomains = Array.from({ length: 6 }, (_, i) =>
    `.~VS${i + 1}_1_2`).join('');
  const input = '.Shape~2x3' + gridGivens('123231', 3)
    + '.Var~S~~6' + overlayDomains + '.ConnectedValues~VS~1.ConnectedValues~VS~2';

  let expected = 0;
  for (const values of allAssignments([1, 2], 6)) {
    if (referenceIsConnected(values, [1], 2, 3) &&
      referenceIsConnected(values, [2], 2, 3)) expected++;
  }
  assert.ok(expected > 0 && expected < 2 ** 6);

  const solver = new SimpleSolver();
  assert.equal(solver.countSolutions(input), expected);
});

await runTest('ConnectedValues: unknown variable group fails to build', () => {
  const solver = new SimpleSolver();
  assert.throws(() => solver.countSolutions('.Shape~4x4.ConnectedValues~VX~1'));
});

// An empty group prefix puts the constraint on the main grid. There is no
// overlay to enumerate, so the oracle enumerates the base grid's solutions
// instead and filters them with the reference flood fill.
const assertGridOracle = (shape, numRows, numCols, valueSets) => {
  const solver = new SimpleSolver();

  let expected = 0;
  let total = 0;
  for (const solution of solver.solutions(shape)) {
    const values = solution.getArray();
    total++;
    if (valueSets.every(
      set => referenceIsConnected(values, set, numRows, numCols))) expected++;
  }
  assert.ok(expected > 0 && expected < total);

  const input = shape + valueSets.map(
    set => `.ConnectedValues~~${set.join('_')}`).join('');
  assert.equal(solver.countSolutions(input), expected);
};

await runTest('ConnectedValues: solver matches brute-force oracle (main grid)', () => {
  // A single value can never connect on the main grid (two cells holding it
  // are never adjacent), so the set must span enough values to be satisfiable.
  assertGridOracle('.Shape~4x4', 4, 4, [[1, 2, 3]]);
});

await runTest('ConnectedValues: solver matches brute-force oracle (main grid, merged)', () => {
  // With more values than columns a value may appear just once, which is
  // connected. Two sets exercise the merged handler plus the crossing/border
  // rules the optimizer adds for the grid layer.
  assertGridOracle('.Shape~3x3~5', 3, 3, [[4], [5]]);
});

// ===========================================================================
// One-door forcing.
// ===========================================================================

await runTest('ConnectedValues door forcing: single-door corridor cascades', () => {
    const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  // Row 0 is a corridor (rows 1-3 exclude the value): decided at both ends,
  // undecided between.
  const assignments = { 0: [1], 1: [1, 2], 2: [1, 2], 3: [1] };
  for (let cell = 4; cell < 16; cell++) assignments[cell] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // Each end's only door is forced, cascading until the blobs merge.
  assertCandidates(grid, { 1: [1], 2: [1] });
  assertTouched(acc, [1, 2]);
});

await runTest('ConnectedValues door forcing: multiple doors force nothing', () => {
    const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  // Two decided corners; every blob has two doors.
  const grid = applyCandidates(context.grid, { 0: [1], 15: [1] });
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertTouched(acc, []);
});

await runTest('ConnectedValues door forcing: single blob is never extended', () => {
    const context = makeContext();
  // Decided cell 0 with a single door (cell 1); no other blob, so the
  // region may already be complete and nothing is forced.
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);

  const assignments = { 0: [1], 1: [1, 2], 2: [2, 3], 3: [2, 3] };
  for (let cell = 4; cell < 16; cell++) assignments[cell] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertTouched(acc, []);
});

await runTest('ConnectedValues door forcing: Or-wrap stays sound', () => {
  // A row-0 corridor (other rows exclude the value) whose two blobs force
  // their single doors.
  const candidates = { 0: [1], 1: [1, 2], 2: [1, 2], 3: [1] };
  for (let cell = 4; cell < 16; cell++) candidates[cell] = [2, 3];
  const scenario = {
    makeContext,
    makeHandler: () => new ConnectedValues(16, 0, [1]),
    cellExclusions: () => createCellExclusions({ allUnique: false, numCells: 16 }),
    candidates,
  };
  for (const mode of [OR_WRAP_MODES.FAST_PATH, OR_WRAP_MODES.FAILING_DECOY]) {
    assertOrWrapEquivalent({ ...scenario, mode });
  }
  assertOrWrapNoStateLeak(scenario);
});

// ===========================================================================
// Connector masks, blocked edges, and cut forcing.
// ===========================================================================

// Connector bits used by the reference implementation below.
const CONN_L = 1, CONN_R = 2, CONN_U = 4, CONN_D = 8;

await runTest('ConnectedValues control: plain adjacency accepts the same grid', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [1]);
  initHandler(context, handler);
  const grid = applyCandidates(context.grid, (() => {
    const assignments = {};
    for (let cell = 0; cell < 16; cell++) assignments[cell] = [2];
    assignments[0] = [1]; assignments[1] = [1];
    return assignments;
  })());
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
});

// ===========================================================================
// Exhaustive leaf oracle and partial-mask soundness fuzz, per adjacency
// scenario and forcing mode. The reference is an edge-connected flood fill.
// ===========================================================================

const referenceConnected2 = (values, inSet, connOf, walls, numRows, numCols) => {
  const wallKeys = new Set(walls.map(([a, b]) => a < b ? `${a}:${b}` : `${b}:${a}`));
  const isIn = v => inSet.includes(v);
  const start = values.findIndex(isIn);
  if (start === -1) return false;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cell = queue.pop();
    const row = (cell / numCols) | 0;
    const col = cell % numCols;
    const conn = connOf(values[cell]);
    for (const [dr, dc, bit, opp] of [
      [0, -1, CONN_L, CONN_R], [0, 1, CONN_R, CONN_L],
      [-1, 0, CONN_U, CONN_D], [1, 0, CONN_D, CONN_U]]) {
      if (!(conn & bit)) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= numRows || c >= numCols) continue;
      const neighbor = r * numCols + c;
      if (seen.has(neighbor) || !isIn(values[neighbor])) continue;
      if (wallKeys.has(cell < neighbor ? `${cell}:${neighbor}` : `${neighbor}:${cell}`)) continue;
      if (!(connOf(values[neighbor]) & opp)) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return seen.size === values.filter(isIn).length;
};

const ADJACENCY_SCENARIOS = [
  {
    name: 'vertex',
    values: [1, 2],
    connOf: v => v <= 2 ? (CONN_L | CONN_R | CONN_U | CONN_D) : 0,
    walls: [],
  },
];

const makeContext3 = () => new GridTestContext({ gridSize: [3, 3] });

const makeScenarioHandler = (scenario, context) => {
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, scenario.values);
  const result = context.initializeHandler(handler, {
    cellExclusions: createCellExclusions({
      allUnique: false, numCells: context.geometry.numGridCells,
    }),
  });
  assert.equal(result, true);
  return handler;
};

for (const scenario of ADJACENCY_SCENARIOS) {
  await runTest(`ConnectedValues leaf oracle (${scenario.name}, 3^9 grids)`, () => {
    const context = makeContext3();
    const handler = makeScenarioHandler(scenario, context);
    const values = new Array(9).fill(1);
    let checked = 0;
    const enumerate = position => {
      if (position === 9) {
        const assignments = {};
        for (let cell = 0; cell < 9; cell++) assignments[cell] = [values[cell]];
        const grid = applyCandidates(context.grid.slice(), assignments);
        const expected = referenceConnected2(
          values, scenario.values, scenario.connOf, scenario.walls, 3, 3);
        assert.equal(handler.enforceConsistency(grid, createAccumulator()), expected,
          `grid ${values.join('')}`);
        checked++;
        return;
      }
      for (let value = 1; value <= 3; value++) {
        values[position] = value;
        enumerate(position + 1);
      }
    };
    enumerate(0);
    assert.equal(checked, 3 ** 9);
  });
}

// Deterministic LCG so fuzz failures reproduce.
const makeRandom = seed => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

for (const scenario of ADJACENCY_SCENARIOS) {
  await runTest(`ConnectedValues soundness fuzz (${scenario.name})`, () => {
    const context = makeContext3();
    const handler = makeScenarioHandler(scenario, context);
    const random = makeRandom(0xC0FFEE);
    for (let trial = 0; trial < 300; trial++) {
      // Narrow random masks keep completion enumeration tractable.
      const masks = [];
      for (let cell = 0; cell < 9; cell++) {
        const first = 1 + Math.floor(random() * 3);
        let mask = [first];
        if (random() < 0.4) {
          const second = 1 + Math.floor(random() * 3);
          if (second !== first) mask.push(second);
        }
        masks.push(mask);
      }
      const assignments = {};
      for (let cell = 0; cell < 9; cell++) assignments[cell] = masks[cell];
      const grid = applyCandidates(context.grid.slice(), assignments);
      const before = grid.slice();

      // Enumerate the valid completions of the masks.
      const validCompletions = [];
      const values = new Array(9);
      const enumerate = position => {
        if (position === 9) {
          if (referenceConnected2(
            values, scenario.values, scenario.connOf, scenario.walls, 3, 3)) {
            validCompletions.push(values.slice());
          }
          return;
        }
        for (const value of masks[position]) {
          values[position] = value;
          enumerate(position + 1);
        }
      };
      enumerate(0);

      const result = handler.enforceConsistency(grid, createAccumulator());
      if (!result) {
        assert.equal(validCompletions.length, 0,
          `trial ${trial}: rejected state with ${validCompletions.length} valid completions`);
        continue;
      }
      // Anything pruned or forced away must appear in no valid completion.
      for (let cell = 0; cell < 9; cell++) {
        const removed = before[cell] & ~grid[cell];
        if (!removed) continue;
        for (const completion of validCompletions) {
          const completionBit = valueMask(completion[cell]);
          assert.equal(completionBit & removed, 0,
            `trial ${trial}: cell ${cell} pruned value ${completion[cell]} used by a valid completion`);
        }
      }
    }
  });
}

await runTest('ConnectedValues: serialization round trip', async () => {
  const { SudokuParser } = await import('../../js/sudoku_parser.js');
  const str = '.ConnectedValues~VS~1_2';
  const parsed = SudokuParser.parseText(str);
  assert.equal(parsed.toString(), str);
  const constraint = parsed.toMap().get('ConnectedValues')[0];
  assert.equal(constraint.groupPrefix, 'VS');
  assert.equal(constraint.values, '1_2');
});

await runTest('ConnectedValues: serialization round trip (main grid)', async () => {
  const { SudokuParser } = await import('../../js/sudoku_parser.js');
  const str = '.ConnectedValues~~1_2';
  const parsed = SudokuParser.parseText(str);
  assert.equal(parsed.toString(), str);
  const constraint = parsed.toMap().get('ConnectedValues')[0];
  assert.equal(constraint.groupPrefix, '');
  assert.equal(constraint.values, '1_2');
});

// ===========================================================================
// Multi-set handlers (the optimizer merges same-cell instances into one).
// ===========================================================================

await runTest('ConnectedValues multi-set: sets propagate to each other in one pass', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [[1], [2]]);
  initHandler(context, handler);

  // Complementary {1,2} shading. Set 1 is decided at cells 0 and 8 with cell
  // 1 blocked, so its only route is through cell 4 (door forced to 1). That
  // exclusion leaves set 2's blob at cell 12 a single door at cell 13 —
  // forceable only after set 1's move, within the same pass.
  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [1, 2];
  assignments[0] = [1];
  assignments[8] = [1];
  assignments[1] = [2];
  assignments[12] = [2];
  const grid = applyCandidates(context.grid, assignments);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 4: [1], 13: [2] });
  assertTouched(acc, [4, 13]);
});

await runTest('ConnectedValues multi-set leaf oracle (3^9 grids)', () => {
  const context = makeContext3();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [[1], [2]]);
  const result = context.initializeHandler(handler, {
    cellExclusions: createCellExclusions({ allUnique: false, numCells: 9 }),
  });
  assert.equal(result, true);

  const { connOf, walls } = ADJACENCY_SCENARIOS[0];
  const values = new Array(9).fill(1);
  let checked = 0;
  const enumerate = position => {
    if (position === 9) {
      const assignments = {};
      for (let cell = 0; cell < 9; cell++) assignments[cell] = [values[cell]];
      const grid = applyCandidates(context.grid.slice(), assignments);
      const expected =
        referenceConnected2(values, [1], connOf, walls, 3, 3) &&
        referenceConnected2(values, [2], connOf, walls, 3, 3);
      assert.equal(handler.enforceConsistency(grid, createAccumulator()), expected,
        `grid ${values.join('')}`);
      checked++;
      return;
    }
    for (let value = 1; value <= 3; value++) {
      values[position] = value;
      enumerate(position + 1);
    }
  };
  enumerate(0);
  assert.equal(checked, 3 ** 9);
});

await runTest('ConnectedValues multi-set soundness fuzz', () => {
  const context = makeContext3();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [[1], [2]]);
  const initResult = context.initializeHandler(handler, {
    cellExclusions: createCellExclusions({ allUnique: false, numCells: 9 }),
  });
  assert.equal(initResult, true);

  const { connOf, walls } = ADJACENCY_SCENARIOS[0];
  const bothConnected = values =>
    referenceConnected2(values, [1], connOf, walls, 3, 3) &&
    referenceConnected2(values, [2], connOf, walls, 3, 3);

  const random = makeRandom(0xFACADE);
  for (let trial = 0; trial < 300; trial++) {
    const masks = [];
    for (let cell = 0; cell < 9; cell++) {
      const first = 1 + Math.floor(random() * 3);
      let mask = [first];
      if (random() < 0.4) {
        const second = 1 + Math.floor(random() * 3);
        if (second !== first) mask.push(second);
      }
      masks.push(mask);
    }
    const assignments = {};
    for (let cell = 0; cell < 9; cell++) assignments[cell] = masks[cell];
    const grid = applyCandidates(context.grid.slice(), assignments);
    const before = grid.slice();

    const validCompletions = [];
    const values = new Array(9);
    const enumerate = position => {
      if (position === 9) {
        if (bothConnected(values)) validCompletions.push(values.slice());
        return;
      }
      for (const value of masks[position]) {
        values[position] = value;
        enumerate(position + 1);
      }
    };
    enumerate(0);

    const result = handler.enforceConsistency(grid, createAccumulator());
    if (!result) {
      assert.equal(validCompletions.length, 0,
        `trial ${trial}: rejected state with ${validCompletions.length} valid completions`);
      continue;
    }
    for (let cell = 0; cell < 9; cell++) {
      const removed = before[cell] & ~grid[cell];
      if (!removed) continue;
      for (const completion of validCompletions) {
        assert.equal(valueMask(completion[cell]) & removed, 0,
          `trial ${trial}: cell ${cell} pruned value ${completion[cell]} used by a valid completion`);
      }
    }
  }
});

// ===========================================================================
// Crossing and border rules — the joint deductions the optimizer adds as
// their own handlers over a merged layer (§5).
// ===========================================================================

// A 4x4 perimeter in cyclic order, for ConnectedBorder tests.
const BORDER_4X4 = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4];

await runTest('ConnectedCrossing: forbids the completing checkerboard cell', () => {
  const context = makeContext();
  // The 2x2 block at rows 1-2, cols 1-2 is [nw=5, ne=6, sw=9, se=10].
  const handler = new ConnectedCrossing([5, 6, 9, 10], [1, 2]);
  initHandler(context, handler);

  // Diagonal 5/10 decided into set 1, cell 6 into set 2: cell 9 completing
  // the checkerboard is impossible, so it loses value 2.
  const grid = applyCandidates(context.grid, {
    5: [1], 10: [1], 6: [2], 9: [1, 2],
  });
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 9: [1] });
  assertTouched(acc, [9]);

  // A completed checkerboard is a direct conflict.
  const conflictGrid = applyCandidates(context.grid.slice(), {
    5: [1], 10: [1], 6: [2], 9: [2],
  });
  assert.equal(handler.enforceConsistency(conflictGrid, createAccumulator()), false);
});

await runTest('ConnectedBorder: forbids interleaves', () => {
  const context = makeContext();
  const handler = new ConnectedBorder(BORDER_4X4, [1, 2]);
  initHandler(context, handler);

  // The four corners alternate sets around the perimeter (1, 2, 1, 2 in
  // cyclic order): the two regions' connecting paths would have to cross.
  const grid = applyCandidates(context.grid, {
    0: [1], 3: [2], 15: [1], 12: [2],
  });
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedBorder: strips gaps between same-set cells', () => {
  const context = makeContext();
  const handler = new ConnectedBorder(BORDER_4X4, [1, 2]);
  initHandler(context, handler);

  // Cell 1 sits on the border between two decided 1s, and a 2 is decided
  // elsewhere on the border: a 2 at cell 1 would interleave, so it is
  // forced to 1 (only the other set's value is stripped).
  const grid = applyCandidates(context.grid, {
    0: [1], 1: [1, 2], 2: [1], 13: [2],
  });
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 1: [1] });
  assertTouched(acc, [1]);

  // Without a decided 2 on the border the strip must not fire: the 2s'
  // region may legitimately reach the border inside the gap.
  const noBorder2 = applyCandidates(context.grid.slice(), {
    0: [1], 1: [1, 2], 2: [1], 13: [1, 2],
  });
  assert.equal(handler.enforceConsistency(noBorder2, createAccumulator()), true);
  assert.equal(noBorder2[1], valueMask(1, 2));
});

await runTest('ConnectedBorder: requires exactly two values', () => {
  const context = makeContext();
  for (const values of [[1], [1, 2, 3]]) {
    const handler = new ConnectedBorder(BORDER_4X4, values);
    assert.throws(() => initHandler(context, handler), InvalidConstraintError);
  }
});

await runTest('ConnectedBorder: accepts a one-row perimeter', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const perimeter = context.geometry.cellGraph().perimeter(0);
  const handler = new ConnectedBorder(perimeter, [1, 2]);
  initHandler(context, handler);

  const grid = applyCandidates(context.grid, {
    0: [1], 1: [1], 2: [2], 3: [2],
  });
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
});

await runTest('ConnectedValues: optimizer merges same-cell instances', async () => {
  const { SudokuParser } = await import('../../js/sudoku_parser.js');
  const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');

  const build = (input) => {
    const constraint = SudokuBuilder.resolveConstraint(SudokuParser.parseText(input));
    const solver = SudokuBuilder.build(constraint);
    const all = solver._internalSolver._handlerSet.getAll();
    const countOf = type => all.filter(h => h.constructor === type).length;
    return {
      connected: all.filter(h => h.constructor === ConnectedValues),
      crossing: countOf(ConnectedCrossing),
      border: countOf(ConnectedBorder),
    };
  };

  // Same group: merged into one multi-set handler, with the joint rules
  // added — one crossing handler per 2x2 block (9 on a 4x4) and one border.
  const merged = build(
    '.Shape~4x4.Var~S~~16.ConnectedValues~VS~1.ConnectedValues~VS~2');
  assert.equal(merged.connected.length, 1);
  assert.deepEqual(merged.connected[0].valueSets(), [[1], [2]]);
  assert.equal(merged.crossing, 9);
  assert.equal(merged.border, 1);

  // The main grid (empty prefix) is a layer like any other.
  const mergedGrid = build(
    '.Shape~4x4.ConnectedValues~~1.ConnectedValues~~2');
  assert.equal(mergedGrid.connected.length, 1);
  assert.equal(mergedGrid.connected[0].cells[0], 0);
  assert.deepEqual(mergedGrid.connected[0].valueSets(), [[1], [2]]);
  assert.equal(mergedGrid.crossing, 9);
  assert.equal(mergedGrid.border, 1);

  // The grid and a var group are separate layers.
  const gridAndGroup = build(
    '.Shape~4x4.Var~S~~16.ConnectedValues~~1.ConnectedValues~VS~1');
  assert.equal(gridAndGroup.connected.length, 2);
  assert.equal(gridAndGroup.crossing, 0);
  assert.equal(gridAndGroup.border, 0);

  // Different groups: left alone, and no joint rules added.
  const separate = build(
    '.Shape~4x4.Var~S~~16.Var~T~~16.ConnectedValues~VS~1.ConnectedValues~VT~1');
  assert.equal(separate.connected.length, 2);
  assert.equal(separate.crossing, 0);
  assert.equal(separate.border, 0);

  // Overlapping value sets: left alone (merged sets must be disjoint).
  const overlapping = build(
    '.Shape~4x4.Var~S~~16.ConnectedValues~VS~1_2.ConnectedValues~VS~2_3');
  assert.equal(overlapping.connected.length, 2);
  assert.equal(overlapping.crossing, 0);

  // Multi-value sets: left alone even when disjoint (only supported alone).
  const multiValue = build(
    '.Shape~4x4.Var~S~~16.ConnectedValues~VS~1_2.ConnectedValues~VS~3_4');
  assert.equal(multiValue.connected.length, 2);
  assert.equal(multiValue.crossing, 0);
});

await runTest('ConnectedValues multi-set: overlapping sets are rejected', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [[1, 2], [2, 3]]);
  assert.throws(
    () => initHandler(context, handler),
    InvalidConstraintError);
});

await runTest('ConnectedValues multi-set: multi-value sets are rejected', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, [[1, 2], [3]]);
  assert.throws(
    () => initHandler(context, handler),
    InvalidConstraintError);
});

logSuiteComplete('connected_values.test.js');
