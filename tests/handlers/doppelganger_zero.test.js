import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask0,
  assertTouched,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../../js/grid_shape.js');
const { DoppelgangerZero } = await import('../../js/solver/handlers.js');

// DoppelgangerZero operates on a grid cell + 2-3 state cells.
// It requires valueOffset === -1 (values 0..N).
// Bit 1 (value index 0) represents the display value 0.
//
// When gridCell is fixed to 0 (bit 1), it enforces pairwise exclusion
// among state cells. When gridCell might be 0, it removes 0 if state
// cells can't all differ.
//
// valueMask0 is 0-indexed: valueMask0(0) = display value 0, etc.
const ZERO = valueMask0(0);

const makeShape = () => GridShape.fromGridSize(9, 9, 10, -1);

const makeContext = (numStateCells = 3) => {
  const shape = makeShape();
  // Use cells 0 (gridCell), 1, 2, [3] (stateCells).
  const gridCell = 0;
  const stateCells = Array.from({ length: numStateCells }, (_, i) => i + 1);
  const handler = new DoppelgangerZero(gridCell, stateCells);
  const context = new GridTestContext({ shape });
  return { handler, context, gridCell, stateCells };
};

// =============================================================================
// Constructor tests
// =============================================================================

await runTest('DoppelgangerZero constructor accepts 2 state cells', () => {
  const handler = new DoppelgangerZero(0, [1, 2]);
  assert.deepEqual([...handler.cells], [0, 1, 2]);
});

await runTest('DoppelgangerZero constructor accepts 3 state cells', () => {
  const handler = new DoppelgangerZero(0, [1, 2, 3]);
  assert.deepEqual([...handler.cells], [0, 1, 2, 3]);
});

await runTest('DoppelgangerZero constructor rejects 1 state cell', () => {
  assert.throws(() => new DoppelgangerZero(0, [1]));
});

await runTest('DoppelgangerZero constructor rejects 4 state cells', () => {
  assert.throws(() => new DoppelgangerZero(0, [1, 2, 3, 4]));
});

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('DoppelgangerZero initialize succeeds with valueOffset -1', () => {
  const { handler, context } = makeContext();
  const result = context.initializeHandler(handler);
  assert.equal(result, true);
});

await runTest('DoppelgangerZero initialize fails with valueOffset 0', () => {
  const shape = GridShape.fromGridSize(9);
  const handler = new DoppelgangerZero(0, [1, 2, 3]);
  const context = new GridTestContext({ shape });
  assert.throws(() => context.initializeHandler(handler));
});

// =============================================================================
// enforceConsistency - gridCell can't be 0
// =============================================================================

await runTest('no-op when gridCell cannot be 0', () => {
  const { handler, context, gridCell, stateCells } = makeContext();
  context.initializeHandler(handler);
  const grid = context.grid;

  // gridCell has no 0 bit.
  grid[gridCell] = valueMask0(1, 2, 3);
  grid[stateCells[0]] = valueMask0(1);
  grid[stateCells[1]] = valueMask0(1);
  grid[stateCells[2]] = valueMask0(1);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assertTouched(acc, []);
});

// =============================================================================
// enforceConsistency - gridCell fixed to 0 (v === 1)
// =============================================================================

await runTest('v=1: fixed state cell excludes from others (3 state cells)', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(3);          // fixed
  grid[stateCells[1]] = valueMask0(2, 3, 4);    // contains 3
  grid[stateCells[2]] = valueMask0(3, 5);        // contains 3

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[stateCells[1]], valueMask0(2, 4), 's1 should have 3 removed');
  assert.equal(grid[stateCells[2]], valueMask0(5), 's2 should have 3 removed');
  assertTouched(acc, [stateCells[1], stateCells[2]]);
});

await runTest('v=1: fixed state cell excludes from others (2 state cells)', () => {
  const { handler, context, gridCell, stateCells } = makeContext(2);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(5);
  grid[stateCells[1]] = valueMask0(3, 5, 7);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[stateCells[1]], valueMask0(3, 7));
  assertTouched(acc, [stateCells[1]]);
});

await runTest('v=1: multiple fixed state cells exclude from each other', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(3);       // fixed
  grid[stateCells[1]] = valueMask0(5);       // fixed
  grid[stateCells[2]] = valueMask0(3, 5, 7); // contains both

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[stateCells[2]], valueMask0(7), 's2 should have 3 and 5 removed');
  assertTouched(acc, [stateCells[2]]);
});

await runTest('v=1: returns false when exclusion empties a cell', () => {
  const { handler, context, gridCell, stateCells } = makeContext(2);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(3);
  grid[stateCells[1]] = valueMask0(3); // same fixed value, will be emptied

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('v=1: no change when fixed state cells already differ', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(1);
  grid[stateCells[1]] = valueMask0(2);
  grid[stateCells[2]] = valueMask0(3);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assertTouched(acc, []);
});

await runTest('v=1: no change when no state cell is fixed', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(1, 2);
  grid[stateCells[1]] = valueMask0(1, 2);
  grid[stateCells[2]] = valueMask0(1, 2);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assertTouched(acc, []);
});

await runTest('v=1: fixed cell does not exclude non-overlapping values', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(3);
  grid[stateCells[1]] = valueMask0(4, 5);
  grid[stateCells[2]] = valueMask0(6, 7);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[stateCells[1]], valueMask0(4, 5));
  assert.equal(grid[stateCells[2]], valueMask0(6, 7));
  assertTouched(acc, []);
});

// =============================================================================
// enforceConsistency - gridCell might be 0 (conflict check)
// =============================================================================

await runTest('conflict: removes 0 when two state cells have same fixed value', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1, 2);
  grid[stateCells[0]] = valueMask0(5);
  grid[stateCells[1]] = valueMask0(5);     // same as s0
  grid[stateCells[2]] = valueMask0(7);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell] & ZERO, 0, '0 should be removed from gridCell');
  assertTouched(acc, [gridCell]);
});

await runTest('conflict: removes 0 when s0 fixed equals s2', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1);
  grid[stateCells[0]] = valueMask0(3);
  grid[stateCells[1]] = valueMask0(4);
  grid[stateCells[2]] = valueMask0(3); // same as s0

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell] & ZERO, 0);
  assertTouched(acc, [gridCell]);
});

await runTest('conflict: removes 0 when s1 fixed equals s2', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1);
  grid[stateCells[0]] = valueMask0(2);
  grid[stateCells[1]] = valueMask0(6);
  grid[stateCells[2]] = valueMask0(6); // same as s1

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell] & ZERO, 0);
  assertTouched(acc, [gridCell]);
});

await runTest('conflict: returns false when gridCell is only 0 and conflict exists', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  // gridCell === ZERO means v === 1, which enters the pairwise branch.
  // s0 and s1 both fixed to same value → s1 gets emptied → false.
  grid[gridCell] = ZERO;
  grid[stateCells[0]] = valueMask0(5);
  grid[stateCells[1]] = valueMask0(5);
  grid[stateCells[2]] = valueMask0(7);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('conflict: no change when no state cell is fixed', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1, 2);
  grid[stateCells[0]] = valueMask0(3, 4);
  grid[stateCells[1]] = valueMask0(3, 4);
  grid[stateCells[2]] = valueMask0(3, 4);

  const before = grid[gridCell];
  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell], before, 'gridCell should not change');
  assertTouched(acc, []);
});

await runTest('conflict: no change when fixed state cells are all distinct', () => {
  const { handler, context, gridCell, stateCells } = makeContext(3);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1);
  grid[stateCells[0]] = valueMask0(3);
  grid[stateCells[1]] = valueMask0(4);
  grid[stateCells[2]] = valueMask0(5);

  const before = grid[gridCell];
  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell], before);
  assertTouched(acc, []);
});

await runTest('conflict: 2 state cells, removes 0 on conflict', () => {
  const { handler, context, gridCell, stateCells } = makeContext(2);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1);
  grid[stateCells[0]] = valueMask0(4);
  grid[stateCells[1]] = valueMask0(4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell] & ZERO, 0);
  assertTouched(acc, [gridCell]);
});

await runTest('conflict: 2 state cells, no conflict when distinct', () => {
  const { handler, context, gridCell, stateCells } = makeContext(2);
  context.initializeHandler(handler);
  const grid = context.grid;

  grid[gridCell] = valueMask0(0, 1);
  grid[stateCells[0]] = valueMask0(4);
  grid[stateCells[1]] = valueMask0(5);

  const before = grid[gridCell];
  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[gridCell], before);
  assertTouched(acc, []);
});

logSuiteComplete('doppelganger_zero.test.js');
