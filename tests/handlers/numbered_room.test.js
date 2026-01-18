import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  setupConstraintTest,
  createAccumulator,
  createCellExclusions,
  valueMask,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { NumberedRoom } = await import('../../js/solver/handlers.js');

// =============================================================================
// Initialization
// =============================================================================

await runTest('NumberedRoom should restrict control cell to the line length on init', () => {
  const context = setupConstraintTest({ gridSize: [1, 9] });
  const handler = new NumberedRoom(context.cells(4), 7);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2, 3, 4), 'control cell should only allow 1..lineLength');
});

await runTest('NumberedRoom should fail init if control cell has no values within the line length', () => {
  const context = setupConstraintTest({ gridSize: [1, 9] });
  const handler = new NumberedRoom(context.cells(4), 7);

  const grid = context.grid;
  grid[0] = valueMask(9); // out of range for a 4-cell line
  const result = context.initializeHandler(handler);

  assert.equal(result, false);
});

await runTest('NumberedRoom init should be a no-op when line length equals numValues', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const handler = new NumberedRoom(context.cells(4), 2);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2, 3, 4));
});

// =============================================================================
// enforceConsistency
// =============================================================================

await runTest('NumberedRoom should prune control options when corresponding cell cannot take the clue value', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const handler = new NumberedRoom(context.cells(4), 3);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4); // control cell N
  grid[1] = valueMask(1, 2); // if N=2, cell[1] must be 3, but it can't
  grid[2] = valueMask(1, 3); // allows 3 (N=3 remains possible)
  grid[3] = valueMask(3, 4); // allows 3 (N=4 remains possible)
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 3, 4), 'control should drop 2');
});

await runTest('NumberedRoom should remove the clue value from cells that cannot be selected by the control cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const handler = new NumberedRoom(context.cells(4), 2);

  const grid = context.grid;
  grid[0] = valueMask(3); // N fixed to 3 (selects cell index 2)
  grid[1] = valueMask(1, 2, 4); // has 2 but cannot be selected (N != 2)
  grid[2] = valueMask(2, 3); // selected (N=3)
  grid[3] = valueMask(2, 4); // has 2 but cannot be selected (N != 4)
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1], valueMask(1, 4), 'cell[1] should lose clue value');
  assert.equal(grid[2], valueMask(2, 3), 'selected cell keeps clue value');
  assert.equal(grid[3], valueMask(4), 'cell[3] should lose clue value');
});

await runTest('NumberedRoom should fail when the clue value is forced in a non-selected cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const handler = new NumberedRoom(context.cells(4), 2);

  const grid = context.grid;
  grid[0] = valueMask(3); // N fixed to 3
  grid[1] = valueMask(2); // forced to clue value, but cannot be selected (N != 2)
  grid[2] = valueMask(1, 2, 3, 4); // selected cell still allows clue value
  grid[3] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('NumberedRoom should fail when no index remains compatible with the clue value', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const handler = new NumberedRoom(context.cells(4), 4);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3); // first cell also cannot be 4
  grid[1] = valueMask(1, 2, 3); // no 4
  grid[2] = valueMask(1, 2, 3); // no 4
  grid[3] = valueMask(1, 2, 3); // no 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

logSuiteComplete('numbered_room.test.js');
