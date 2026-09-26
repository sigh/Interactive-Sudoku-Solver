import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
  initHandler(context, handler);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(context.grid, acc), true);
  assertTouched(acc, []);
});

await runTest('ConnectedValues: decided cells split by a barrier fail', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
  initHandler(context, handler);

  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: sole possible cell is forced for non-emptiness', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1, 2], 0]]));
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
    context.geometry.numGridCells, 0, new Map([[[1], 0], [[2], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1, 2], 0]]));
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
    const handler = new ConnectedValues(numGridCells, cellOffset, new Map([[[1], 0]]));
    assert.throws(() => initHandler(context, handler), InvalidConstraintError,
      `(${numGridCells}, ${cellOffset}) should be rejected`);
  }
});

await runTest('ConnectedValues: invalid values are rejected', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[5], 0]]));
  assert.throws(() => initHandler(context, handler), InvalidConstraintError);
});

await runTest('ConnectedValues: full-grid var cell group uses grid adjacency', () => {
  const context = makeContext();
  const geometry = context.geometry;
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VL', count: geometry.numGridCells }] },
  ]);
  const varCells = geometry.varCellsForGroup('VL');
  const handler = new ConnectedValues(geometry.numGridCells, varCells[0], new Map([[[1], 0]]));

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

await runTest('ConnectedValues: handler size must match the var cell group', () => {
  const context = makeContext();
  const geometry = context.geometry;
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VP', count: 4 }] },
  ]);
  const handler = new ConnectedValues(
    geometry.numGridCells, geometry.varCellsForGroup('VP')[0], new Map([[[1], 0]]));
  const grid = new Array(geometry.totalCells()).fill(context.lookupTables.allValues);
  assert.throws(
    () => handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: geometry.totalCells() }),
      geometry, createStateAllocator(grid)),
    InvalidConstraintError);
});

await runTest('ConnectedValues: var cell group smaller than the grid works', () => {
  const context = makeContext();  // 4x4 grid
  const geometry = context.geometry;
  // 6 cells laid out 2 rows x 3 cols.
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VS', count: 6, columns: 3 }] },
  ]);
  const offset = geometry.varCellsForGroup('VS')[0];
  const handler = new ConnectedValues(6, offset, new Map([[[1], 0]]));
  const grid = new Array(geometry.totalCells()).fill(context.lookupTables.allValues);
  assert.equal(
    handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: geometry.totalCells() }),
      geometry, createStateAllocator(grid)),
    true);

  const setValue1 = (...positions) => {
    for (let i = 0; i < 6; i++) grid[offset + i] = valueMask(2);
    for (const p of positions) grid[offset + p] = valueMask(1);
  };
  // Positions 0 and 3 are vertically adjacent in the 2x3 layout.
  setValue1(0, 3);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);

  // Positions 0 and 4 are diagonal — disconnected.
  setValue1(0, 4);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues: an offset inside a var cell group is rejected', () => {
  const context = makeContext();
  const geometry = context.geometry;
  geometry.addVarCellsForConstraints([
    { getVarCellGroups: () => [{ prefix: 'VM', count: geometry.numGridCells }] },
  ]);
  const handler = new ConnectedValues(
    geometry.numGridCells, geometry.varCellsForGroup('VM')[1], new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(16, offset, new Map([[[1], 0]]));
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
    makeHandler: () => new ConnectedValues(16, 0, new Map([[[1], 0]])),
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

await runTest('ConnectedValues: unknown variable group fails to build', () => {
  const solver = new SimpleSolver();
  assert.throws(() => solver.countSolutions('.Shape~4x4.ConnectedValues~VX~1'));
});

// ===========================================================================
// Brute-force oracles, against a reference flood fill.
// ===========================================================================

// The neighbours of each cell of a numRows x numCols grid.
const gridNeighbours = (numRows, numCols) => Array.from(
  { length: numRows * numCols }, (_, cell) => {
    const row = cell / numCols | 0;
    const col = cell % numCols;
    return [[row, col - 1], [row, col + 1], [row - 1, col], [row + 1, col]]
      .filter(([r, c]) => r >= 0 && c >= 0 && r < numRows && c < numCols)
      .map(([r, c]) => r * numCols + c);
  });

// Whether the cells with a value in `inSet` form one non-empty connected
// region.
const isConnected = (values, inSet, neighbours) => {
  let members = 0;
  let start = -1;
  for (let cell = 0; cell < values.length; cell++) {
    if (!inSet.includes(values[cell])) continue;
    members |= 1 << cell;
    if (start < 0) start = cell;
  }
  if (start < 0) return false;
  let seen = 1 << start;
  const stack = [start];
  while (stack.length) {
    for (const neighbour of neighbours[stack.pop()]) {
      const bit = 1 << neighbour;
      if (!(members & bit) || (seen & bit)) continue;
      seen |= bit;
      stack.push(neighbour);
    }
  }
  return seen === members;
};

const allConnected = (values, valueSets, neighbours) =>
  valueSets.every(set => isConnected(values, set, neighbours));

const countOf = (values, value) => values.filter(v => v === value).length;

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

// The solver, through the string API, counts as many solutions for
// `constraints` as brute force: the base grid is fixed to `solution`, and every
// assignment of `domain` to the Var overlay VS is checked with `isValid`.
const assertOverlayOracle = (shape, solution, domain, constraints, isValid) => {
  const [numRows, numCols] = shape.split('x').map(Number);
  const numCells = numRows * numCols;
  const neighbours = gridNeighbours(numRows, numCols);

  let expected = 0;
  for (const values of allAssignments(domain, numCells)) {
    if (isValid(values, neighbours)) expected++;
  }
  assert.ok(expected > 0 && expected < domain.length ** numCells);

  const overlayDomains = Array.from({ length: numCells },
    (_, i) => `.~VS${i + 1}_${domain.join('_')}`).join('');
  const input = `.Shape~${shape}` + gridGivens(solution, numCols)
    + `.Var~S~~${numCells}` + overlayDomains + constraints;
  assert.equal(new SimpleSolver().countSolutions(input), expected);
};

await runTest('ConnectedValues: solver matches brute-force oracle (value set)', () => {
  assertOverlayOracle('2x3', '123231', [1, 2, 3], '.ConnectedValues~VS~1_2',
    (values, neighbours) => isConnected(values, [1, 2], neighbours));
});

await runTest('ConnectedValues: solver matches brute-force oracle (merged sets)', () => {
  // The optimizer merges same-layer sets and adds the crossing and border
  // handlers. Those are sound, so the count must still be "both connected".
  assertOverlayOracle('3x3', '123231312', [1, 2, 3],
    '.ConnectedValues~VS~1.ConnectedValues~VS~2',
    (values, neighbours) => allConnected(values, [[1], [2]], neighbours));
});

await runTest('ConnectedValues: solver matches brute-force oracle (non-square merged)', () => {
  // numRows != numCols exercises the optimizer's perimeter and 2x2 block
  // index math.
  assertOverlayOracle('2x3', '123231', [1, 2],
    '.ConnectedValues~VS~1.ConnectedValues~VS~2',
    (values, neighbours) => allConnected(values, [[1], [2]], neighbours));
});

await runTest('ConnectedValues: solver matches brute-force oracle (with size)', () => {
  assertOverlayOracle('3x3', '123231312', [1, 2], '.ConnectedValues~VS~1~4',
    (values, neighbours) => countOf(values, 1) === 4
      && isConnected(values, [1], neighbours));
});

await runTest('ConnectedValues: solver matches brute-force oracle (merged sizes)', () => {
  // The sizes must survive the optimizer's merge.
  assertOverlayOracle('3x3', '123231312', [1, 2, 3],
    '.ConnectedValues~VS~1~3.ConnectedValues~VS~2~4',
    (values, neighbours) => countOf(values, 1) === 3 && countOf(values, 2) === 4
      && allConnected(values, [[1], [2]], neighbours));
});

// An empty group prefix puts the constraint on the main grid. There is no
// overlay to enumerate, so the oracle enumerates the base grid's solutions
// instead and filters them with the reference flood fill.
const assertGridOracle = (shape, numRows, numCols, valueSets) => {
  const solver = new SimpleSolver();
  const neighbours = gridNeighbours(numRows, numCols);

  let expected = 0;
  let total = 0;
  for (const solution of solver.solutions(shape)) {
    total++;
    if (allConnected(solution.getArray(), valueSets, neighbours)) expected++;
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
  assertGridOracle('.Shape~2x3~4', 2, 3, [[3], [4]]);
});

// One handler for a set of values, and one merged handler for two sets.
const HANDLER_CASES = [
  ['one set', [[1, 2]]],
  ['two sets', [[1], [2]]],
];

// A handler for `valueSets` on a 3x3 grid of values 1-3.
const make3x3Handler = (valueSets) => {
  const context = new GridTestContext({ gridSize: [3, 3] });
  const handler = new ConnectedValues(9, 0, new Map(valueSets.map(set => [set, 0])));
  initHandler(context, handler);
  return { context, handler };
};

// Sets the grid to its initial state, with these candidates for the grid cells.
const resetGrid = (grid, initial, cellMasks) => {
  for (let i = 0; i < grid.length; i++) grid[i] = initial[i];
  for (let cell = 0; cell < cellMasks.length; cell++) grid[cell] = cellMasks[cell];
};

const NEIGHBOURS_3x3 = gridNeighbours(3, 3);
const VALUE_MASKS = [0, valueMask(1), valueMask(2), valueMask(3)];

await runTestCases('ConnectedValues leaf oracle: every 3x3 grid', HANDLER_CASES, (valueSets) => {
  const { context, handler } = make3x3Handler(valueSets);
  const grid = context.grid.slice();
  const acc = createAccumulator();
  for (const values of allAssignments([1, 2, 3], 9)) {
    resetGrid(grid, context.grid, values.map(v => VALUE_MASKS[v]));
    const expected = allConnected(values, valueSets, NEIGHBOURS_3x3);
    if (handler.enforceConsistency(grid, acc) !== expected) {
      assert.fail(`grid ${values.join('')} should be ${expected ? 'accepted' : 'rejected'}`);
    }
  }
});

// Deterministic LCG so fuzz failures reproduce.
const makeRandom = seed => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// On random partial grids, the handler rejects only grids with no valid
// completion, and removes only values that no valid completion uses.
await runTestCases('ConnectedValues soundness fuzz', HANDLER_CASES, (valueSets) => {
  const { context, handler } = make3x3Handler(valueSets);
  const random = makeRandom(0xC0FFEE);
  const grid = context.grid.slice();
  const acc = createAccumulator();
  const randomValue = () => 1 + Math.floor(random() * 3);

  for (let trial = 0; trial < 300; trial++) {
    // One or two candidates per cell keeps the completions few.
    const candidates = Array.from({ length: 9 }, () => {
      const first = randomValue();
      const second = random() < 0.4 ? randomValue() : first;
      return first === second ? [first] : [first, second];
    });
    resetGrid(grid, context.grid, candidates.map(c => valueMask(...c)));

    // The candidates used by some valid completion, per cell.
    const used = new Array(9).fill(0);
    let completions = 0;
    const values = new Array(9);
    const enumerate = cell => {
      if (cell === 9) {
        if (!allConnected(values, valueSets, NEIGHBOURS_3x3)) return;
        completions++;
        for (let c = 0; c < 9; c++) used[c] |= VALUE_MASKS[values[c]];
        return;
      }
      for (const value of candidates[cell]) {
        values[cell] = value;
        enumerate(cell + 1);
      }
    };
    enumerate(0);

    const before = grid.slice(0, 9);
    if (!handler.enforceConsistency(grid, acc)) {
      assert.equal(completions, 0, `trial ${trial}: rejected a completable grid`);
      continue;
    }
    for (let cell = 0; cell < 9; cell++) {
      assert.equal(before[cell] & ~grid[cell] & used[cell], 0,
        `trial ${trial}: cell ${cell} lost a value a valid completion uses`);
    }
  }
});


// ===========================================================================
// One-door forcing.
// ===========================================================================

await runTest('ConnectedValues door forcing: single-door corridor cascades', () => {
    const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0]]));
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
    makeHandler: () => new ConnectedValues(16, 0, new Map([[[1], 0]])),
    cellExclusions: () => createCellExclusions({ allUnique: false, numCells: 16 }),
    candidates,
  };
  for (const mode of [OR_WRAP_MODES.FAST_PATH, OR_WRAP_MODES.FAILING_DECOY]) {
    assertOrWrapEquivalent({ ...scenario, mode });
  }
  assertOrWrapNoStateLeak(scenario);
});

// ===========================================================================
// Given size (§7 of the handler doc).
// ===========================================================================

await runTest('ConnectedValues size: cardinality window fails both ways', () => {
  const context = makeContext();

  // More decided cells than the size.
  const tooMany = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 1]]));
  initHandler(context, tooMany);
  let grid = applyCandidates(context.grid.slice(), { 0: [1], 1: [1] });
  assert.equal(tooMany.enforceConsistency(grid, createAccumulator()), false);

  // Fewer possible cells than the size, even with nothing decided.
  const tooFew = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 4]]));
  initHandler(context, tooFew);
  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2, 3];
  assignments[0] = [1, 2];
  assignments[1] = [1, 2];
  grid = applyCandidates(context.grid.slice(), assignments);
  assert.equal(tooFew.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues size: a complete region strips all other cells', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 2]]));
  initHandler(context, handler);

  // Cells 0-1 are a decided blob of exactly the size; everything else is
  // undecided and must leave the set.
  const assignments = { 0: [1], 1: [1] };
  for (let cell = 2; cell < 16; cell++) assignments[cell] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  const expectations = {};
  for (let cell = 2; cell < 16; cell++) expectations[cell] = [2];
  assertCandidates(grid, expectations);
  assertTouched(acc, Array.from({ length: 14 }, (_, i) => i + 2));
});

await runTest('ConnectedValues size: a complete but split region fails', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 2]]));
  initHandler(context, handler);

  // Two decided corners reach the size but form two blobs; undecided cells
  // between them can no longer join the region to connect it.
  const assignments = { 0: [1], 15: [1] };
  for (let cell = 1; cell < 15; cell++) assignments[cell] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues size: exhausted support forces the region', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 3]]));
  initHandler(context, handler);

  // Exactly three possible cells (one decided): all of them are the region.
  const assignments = { 0: [1], 1: [1, 2], 2: [1, 2] };
  for (let cell = 3; cell < 16; cell++) assignments[cell] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 1: [1], 2: [1] });
  assertTouched(acc, [1, 2]);
});

await runTest('ConnectedValues size: zero-decided exhaustion forces and verifies', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 2]]));
  initHandler(context, handler);

  // Connected pair: forced into the region.
  const assignments = {};
  for (let cell = 0; cell < 16; cell++) assignments[cell] = [2, 3];
  assignments[0] = [1, 2];
  assignments[1] = [1, 2];
  const grid = applyCandidates(context.grid.slice(), assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 0: [1], 1: [1] });
  assertTouched(acc, [0, 1]);

  // Diagonal pair: forced cells cannot connect, so the pass fails.
  assignments[1] = [2, 3];
  assignments[5] = [1, 2];
  const splitGrid = applyCandidates(context.grid.slice(), assignments);
  assert.equal(handler.enforceConsistency(splitGrid, createAccumulator()), false);
});

await runTest('ConnectedValues size: lone blob forces its door and completes', () => {
  const context = makeContext();
  // Same shape as the no-size 'single blob is never extended' test, but with
  // a size the blob is provably incomplete: the row-0 corridor cascades two
  // doors to reach size 3, then the leftover corridor cell is stripped.
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 3]]));
  initHandler(context, handler);

  const assignments = { 0: [1], 1: [1, 2], 2: [1, 2], 3: [1, 2] };
  for (let cell = 4; cell < 16; cell++) assignments[cell] = [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  assertCandidates(grid, { 1: [1], 2: [1], 3: [2] });
  assertTouched(acc, [1, 2, 3]);
});

await runTest('ConnectedValues size: forced doors past the size fail', () => {
  const context = makeContext();
  // Cells 2 and 8 each reach cell 10 through their only door (6 and 9). Each
  // is one step away, within the budget of one cell, but together they need
  // both doors: five cells for a region of four.
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 4]]));
  initHandler(context, handler);

  const assignments = { 2: [1], 8: [1], 10: [1], 6: [1, 2], 9: [1, 2] };
  for (let cell = 0; cell < 16; cell++) assignments[cell] ??= [2, 3];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues size: cells beyond the reach budget are pruned', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 2]]));
  initHandler(context, handler);

  // One decided cell and a budget of one more: only its orthogonal
  // neighbours (cells 1 and 4) stay possible; the rest lose the value.
  const assignments = { 0: [1] };
  for (let cell = 1; cell < 16; cell++) assignments[cell] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  const expectations = { 1: [1, 2], 4: [1, 2] };
  for (let cell = 2; cell < 16; cell++) {
    if (cell !== 4) expectations[cell] = [2];
  }
  assertCandidates(grid, expectations);
});

await runTest('ConnectedValues size: singleton-level cascade completes the region', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 3]]));
  initHandler(context, handler);

  // A row-0 corridor from the decided corner, plus a second possible area
  // behind a barrier so the corridor is not the only support (numPossible
  // stays above the size). The area is unreachable and is stripped; the
  // corridor's two singleton levels are forced, completing the region, and
  // the leftover corridor cell is stripped by the re-run.
  const assignments = { 0: [1], 1: [1, 2], 2: [1, 2], 3: [1, 2] };
  for (let cell = 4; cell < 8; cell++) assignments[cell] = [2, 3];
  for (let cell = 8; cell < 16; cell++) assignments[cell] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);
  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  const expectations = { 1: [1], 2: [1], 3: [2] };
  for (let cell = 8; cell < 16; cell++) expectations[cell] = [2];
  assertCandidates(grid, expectations);
});

await runTest('ConnectedValues size: mutually unreachable blobs fail', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 3]]));
  initHandler(context, handler);

  // Decided cells in opposite corners with one cell of budget: every path
  // between the blobs needs at least six more cells, so no region of size 3
  // contains both, even though the possible graph is fully connected.
  const assignments = { 0: [1], 15: [1] };
  for (let cell = 1; cell < 15; cell++) assignments[cell] = [1, 2];
  const grid = applyCandidates(context.grid, assignments);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ConnectedValues size: sizes past the layer are unsatisfiable', () => {
  const context = makeContext();
  for (const sets of [
    new Map([[[1], 17]]),            // single size larger than the layer
    new Map([[[1], 10], [[2], 7]]),  // disjoint sizes jointly overfull
  ]) {
    const handler = new ConnectedValues(context.geometry.numGridCells, 0, sets);
    const result = context.initializeHandler(handler, {
      cellExclusions: createCellExclusions({
        allUnique: false, numCells: context.geometry.numGridCells,
      }),
    });
    assert.equal(result, false, 'oversized sizes are unsatisfiable, not an error');
  }
  // The whole puzzle is unsatisfiable, not broken.
  assert.equal(new SimpleSolver().countSolutions(
    '.Shape~4x4.Var~S~~16.ConnectedValues~VS~1~17'), 0);
  // Exactly filling the layer is fine.
  const full = new ConnectedValues(
    context.geometry.numGridCells, 0, new Map([[[1], 8], [[2], 8]]));
  initHandler(context, full);
});

await runTest('ConnectedValues size: Or-wrap stays sound', () => {
  // The lone-blob cascade scenario, wrapped in Or.
  const candidates = { 0: [1], 1: [1, 2], 2: [1, 2], 3: [1, 2] };
  for (let cell = 4; cell < 16; cell++) candidates[cell] = [2, 3];
  const scenario = {
    makeContext,
    makeHandler: () => new ConnectedValues(16, 0, new Map([[[1], 3]])),
    cellExclusions: () => createCellExclusions({ allUnique: false, numCells: 16 }),
    candidates,
  };
  for (const mode of [OR_WRAP_MODES.FAST_PATH, OR_WRAP_MODES.FAILING_DECOY]) {
    assertOrWrapEquivalent({ ...scenario, mode });
  }
  assertOrWrapNoStateLeak(scenario);
});


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

await runTest('ConnectedValues: serialization round trip (with size)', async () => {
  const { SudokuParser } = await import('../../js/sudoku_parser.js');
  const str = '.ConnectedValues~VS~1_2~10';
  const parsed = SudokuParser.parseText(str);
  assert.equal(parsed.toString(), str);
  const constraint = parsed.toMap().get('ConnectedValues')[0];
  assert.equal(constraint.groupPrefix, 'VS');
  assert.equal(constraint.values, '1_2');
  assert.equal(constraint.size, 10);
});

// ===========================================================================
// Multi-set handlers (the optimizer merges same-cell instances into one).
// ===========================================================================

await runTest('ConnectedValues multi-set: sets propagate to each other in one pass', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1], 0], [[2], 0]]));
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
  assert.deepEqual([...merged.connected[0].sets()], [[[1], 0], [[2], 0]]);
  assert.equal(merged.crossing, 9);
  assert.equal(merged.border, 1);

  // Sizes survive the merge, aligned with their sets.
  const mergedSized = build(
    '.Shape~4x4.Var~S~~16.ConnectedValues~VS~1~3.ConnectedValues~VS~2~5');
  assert.equal(mergedSized.connected.length, 1);
  assert.deepEqual([...mergedSized.connected[0].sets()], [[[1], 3], [[2], 5]]);

  // The main grid (empty prefix) is a layer like any other.
  const mergedGrid = build(
    '.Shape~4x4.ConnectedValues~~1.ConnectedValues~~2');
  assert.equal(mergedGrid.connected.length, 1);
  assert.equal(mergedGrid.connected[0].cells[0], 0);
  assert.deepEqual([...mergedGrid.connected[0].sets()], [[[1], 0], [[2], 0]]);
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
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1, 2], 0], [[2, 3], 0]]));
  assert.throws(
    () => initHandler(context, handler),
    InvalidConstraintError);
});

await runTest('ConnectedValues multi-set: multi-value sets are rejected', () => {
  const context = makeContext();
  const handler = new ConnectedValues(context.geometry.numGridCells, 0, new Map([[[1, 2], 0], [[3], 0]]));
  assert.throws(
    () => initHandler(context, handler),
    InvalidConstraintError);
});

logSuiteComplete('connected_values.test.js');
