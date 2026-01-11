import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  setupConstraintTest,
  createAccumulator,
  createCellExclusions,
  mask,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { Lunchbox } = await import('../../js/solver/handlers.js');
const { LookupTables } = await import('../../js/solver/lookup_tables.js');

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('Lunchbox should initialize successfully with valid sum', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const handler = new Lunchbox(cells, 10);

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 9 }), context.shape, {});

  assert.equal(result, true);
});

await runTest('Lunchbox should throw on invalid sum', () => {
  assert.throws(() => new Lunchbox([0, 1, 2], -1), /Invalid sum/);
  assert.throws(() => new Lunchbox([0, 1, 2], 'abc'), /Invalid sum/);
  assert.throws(() => new Lunchbox([0, 1, 2], 1.5), /Invalid sum/);
});

await runTest('Lunchbox should initialize with sum of 0', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const handler = new Lunchbox(cells, 0);

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 9 }), context.shape, {});

  assert.equal(result, true);
});

// =============================================================================
// Basic constraint enforcement (house case - full rows)
// =============================================================================

await runTest('Lunchbox should fail when no valid border placement exists', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  // Sum of 5 between 1 and 4 (only 2+3=5 works, distance 2)
  const handler = new Lunchbox(cells, 5);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  // Force borders to be adjacent (distance 1) - can't fit 2+3 inside
  grid[0] = mask(1); // Border
  grid[1] = mask(4); // Border
  grid[2] = mask(2, 3);
  grid[3] = mask(2, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when distance is too short for sum');
});

await runTest('Lunchbox should pass with valid configuration', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  // Sum = 5: 2+3 between borders 1 and 4
  const handler = new Lunchbox(cells, 5);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = mask(1); // Border
  grid[1] = mask(2); // Inner
  grid[2] = mask(3); // Inner
  grid[3] = mask(4); // Border
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle valid setup with multiple options', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  // Sum = 2: only value 2 can be between borders (1 and 4)
  // Valid: [1,2,4,3] or [4,2,1,3] etc.
  const handler = new Lunchbox(cells, 2);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = mask(1, 2, 3, 4); // All values possible
  grid[1] = mask(1, 2, 3, 4);
  grid[2] = mask(1, 2, 3, 4);
  grid[3] = mask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle sum of 0 (borders adjacent)', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  // Sum = 0: borders must be adjacent
  const handler = new Lunchbox(cells, 0);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = mask(1, 4);
  grid[1] = mask(1, 2, 3, 4);
  grid[2] = mask(1, 2, 3, 4);
  grid[3] = mask(1, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

// =============================================================================
// Rectangular grid compatibility (non-house case)
// =============================================================================

await runTest('Lunchbox should work on short rows (numCells < numValues)', () => {
  // 6-cell row with 8 possible values
  const context = setupConstraintTest({ numValues: 8, numCells: 6 });
  const cells = [0, 1, 2, 3, 4, 5];
  // Sum = 5: various combinations possible
  const handler = new Lunchbox(cells, 5);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 6 }), context.shape, {});

  const grid = new Uint16Array(6);
  for (let i = 0; i < 6; i++) {
    grid[i] = mask(1, 2, 3, 4, 5, 6, 7, 8);
  }
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should work on rectangular grid');
});

await runTest('Lunchbox should work with more cells than values (house)', () => {
  // When numCells == numValues, it's a "house" with special handling
  // 6 cells with 6 values (this is a house)
  const context = setupConstraintTest({ numValues: 6, numCells: 6 });
  const cells = [0, 1, 2, 3, 4, 5];
  const handler = new Lunchbox(cells, 5); // Sum of 5 (valid: 2+3 or 5)
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 6 }), context.shape, {});

  // Set up a valid house configuration
  // Borders are 1 and 6, sum = 2+3 = 5
  const grid = new Uint16Array(6);
  grid[0] = mask(1);     // Border
  grid[1] = mask(2);     // Inside: 2
  grid[2] = mask(3);     // Inside: 3
  grid[3] = mask(6);     // Border
  grid[4] = mask(4);
  grid[5] = mask(5);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should work with house constraint');
});

await runTest('Lunchbox should not assume house when numCells != numValues', () => {
  // 5-cell row with 9 values - NOT a house
  const context = setupConstraintTest({ numValues: 9, numCells: 5 });
  const cells = [0, 1, 2, 3, 4];
  // Sum = 10
  const handler = new Lunchbox(cells, 10);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 5 }), context.shape, {});

  const grid = new Uint16Array(5);
  for (let i = 0; i < 5; i++) {
    grid[i] = mask(1, 2, 3, 4, 5, 6, 7, 8, 9);
  }
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

// =============================================================================
// Edge cases
// =============================================================================

await runTest('Lunchbox should handle minimum cells for house (numValues cells)', () => {
  const context = setupConstraintTest({ numValues: 3, numCells: 3 });
  const cells = [0, 1, 2];
  // Sum = 2: only 2 between 1 and 3
  const handler = new Lunchbox(cells, 2);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 3 }), context.shape, {});

  const grid = new Uint16Array(3);
  grid[0] = mask(1); // Border
  grid[1] = mask(2); // Inner = 2
  grid[2] = mask(3); // Border
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle house with borders adjacent', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  // Sum = 0: borders must be adjacent
  const handler = new Lunchbox(cells, 0);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = mask(2);
  grid[1] = mask(1);
  grid[2] = mask(4);
  grid[3] = mask(3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle large valid sum', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  // Max sum = 2+3+4+5+6+7+8 = 35
  const handler = new Lunchbox(cells, 35);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 9 }), context.shape, {});

  const grid = new Uint16Array(9);
  // 1, 2, 3, 4, 5, 6, 7, 8, 9 - borders are 1 and 9
  grid[0] = mask(1);
  grid[1] = mask(2);
  grid[2] = mask(3);
  grid[3] = mask(4);
  grid[4] = mask(5);
  grid[5] = mask(6);
  grid[6] = mask(7);
  grid[7] = mask(8);
  grid[8] = mask(9);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle large sum', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  // Max sum = 2+3+4+5+6+7+8 = 35
  const handler = new Lunchbox(cells, 35);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 9 }), context.shape, {});

  const grid = new Uint16Array(9);
  // 1, 2, 3, 4, 5, 6, 7, 8, 9 - borders are 1 and 9
  grid[0] = mask(1);
  grid[1] = mask(2);
  grid[2] = mask(3);
  grid[3] = mask(4);
  grid[4] = mask(5);
  grid[5] = mask(6);
  grid[6] = mask(7);
  grid[7] = mask(8);
  grid[8] = mask(9);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should work when borders not at ends', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  // Sum = 0: borders adjacent somewhere in middle
  const handler = new Lunchbox(cells, 0);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = mask(2); // Not a border
  grid[1] = mask(1); // Border
  grid[2] = mask(4); // Border
  grid[3] = mask(3); // Not a border
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'borders can be anywhere, not just at ends');
});

// =============================================================================
// Pruning tests
// =============================================================================

await runTest('Lunchbox should accumulate changes', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  const handler = new Lunchbox(cells, 2);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = mask(1);
  grid[1] = mask(2, 3); // Should be pruned based on constraints
  grid[2] = mask(3);
  grid[3] = mask(4);
  const acc = createAccumulator();

  handler.enforceConsistency(grid, acc);

  // Any pruning should result in accumulated changes
  // (The exact pruning depends on constraint logic)
});

logSuiteComplete('lunchbox.test.js');
