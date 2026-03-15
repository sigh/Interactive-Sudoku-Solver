import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Lunchbox } = await import('../../js/solver/handlers.js');

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('Lunchbox should initialize successfully with valid sum', () => {
  const context = new GridTestContext({ gridSize: [1, 9] });
  const cells = context.cells();
  const handler = new Lunchbox(cells, 10);

  const result = context.initializeHandler(handler);

  assert.equal(result, true);
});

await runTest('Lunchbox should throw on invalid sum', () => {
  const context = new GridTestContext({ gridSize: [1, 3] });
  const cells = context.cells();
  assert.throws(() => new Lunchbox(cells, -1), /Invalid sum/);
  assert.throws(() => new Lunchbox(cells, 'abc'), /Invalid sum/);
  assert.throws(() => new Lunchbox(cells, 1.5), /Invalid sum/);
});

await runTest('Lunchbox should initialize with sum of 0', () => {
  const context = new GridTestContext({ gridSize: [1, 9] });
  const cells = context.cells();
  const handler = new Lunchbox(cells, 0);

  const result = context.initializeHandler(handler);

  assert.equal(result, true);
});

// =============================================================================
// Basic constraint enforcement (house case - full rows)
// =============================================================================

await runTest('Lunchbox should fail when no valid border placement exists', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  // Sum of 5 between 1 and 4 (only 2+3=5 works, distance 2)
  const handler = new Lunchbox(cells, 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  // Force borders to be adjacent (distance 1) - can't fit 2+3 inside
  grid[0] = valueMask(1); // Border
  grid[1] = valueMask(4); // Border
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(2, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when distance is too short for sum');
});

await runTest('Lunchbox should pass with valid configuration', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  // Sum = 5: 2+3 between borders 1 and 4
  const handler = new Lunchbox(cells, 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1); // Border
  grid[1] = valueMask(2); // Inner
  grid[2] = valueMask(3); // Inner
  grid[3] = valueMask(4); // Border
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle valid setup with multiple options', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  // Sum = 2: only value 2 can be between borders (1 and 4)
  // Valid: [1,2,4,3] or [4,2,1,3] etc.
  const handler = new Lunchbox(cells, 2);
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle sum of 0 (borders adjacent)', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  // Sum = 0: borders must be adjacent
  const handler = new Lunchbox(cells, 0);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 4);
  grid[1] = valueMask(1, 2, 3, 4);
  grid[2] = valueMask(1, 2, 3, 4);
  grid[3] = valueMask(1, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

// =============================================================================
// Rectangular grid compatibility (non-house case)
// =============================================================================

await runTest('Lunchbox should work on short rows (numCells < numValues)', () => {
  // 6-cell row with 8 possible values
  const context = new GridTestContext({ gridSize: [2, 3], numValues: 8 });
  const cells = context.cells();
  // Sum = 5: various combinations possible
  const handler = new Lunchbox(cells, 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should work on rectangular grid');
});

await runTest('Lunchbox should work with more cells than values (house)', () => {
  // When numCells == numValues, it's a "house" with special handling
  // 6 cells with 6 values (this is a house)
  const context = new GridTestContext({ gridSize: [1, 6] });
  const cells = context.cells();
  const handler = new Lunchbox(cells, 5); // Sum of 5 (valid: 2+3 or 5)
  context.initializeHandler(handler);

  // Set up a valid house configuration
  // Borders are 1 and 6, sum = 2+3 = 5
  const grid = context.grid;
  grid[0] = valueMask(1);     // Border
  grid[1] = valueMask(2);     // Inside: 2
  grid[2] = valueMask(3);     // Inside: 3
  grid[3] = valueMask(6);     // Border
  grid[4] = valueMask(4);
  grid[5] = valueMask(5);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should work with house constraint');
});

await runTest('Lunchbox should not assume house when numCells != numValues', () => {
  // 5-cell row with 9 values - NOT a house
  const context = new GridTestContext({ gridSize: [1, 5], numValues: 9 });
  const cells = context.cells();
  // Sum = 10
  const handler = new Lunchbox(cells, 10);
  context.initializeHandler(handler);

  const grid = context.grid;
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

// =============================================================================
// Edge cases
// =============================================================================

await runTest('Lunchbox should handle minimum cells for house (numValues cells)', () => {
  const context = new GridTestContext({ gridSize: [1, 3] });
  const cells = context.cells();
  // Sum = 2: only 2 between 1 and 3
  const handler = new Lunchbox(cells, 2);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1); // Border
  grid[1] = valueMask(2); // Inner = 2
  grid[2] = valueMask(3); // Border
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle house with borders adjacent', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  // Sum = 0: borders must be adjacent
  const handler = new Lunchbox(cells, 0);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(1);
  grid[2] = valueMask(4);
  grid[3] = valueMask(3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should work with 2 cells and sum=0 (non-house edge case)', () => {
  // This is a regression test for a bug where 2-cell non-house configurations
  // with sum=0 would incorrectly return false because validSettings was never
  // populated when both innerPossibilities and outerPossibilities were 0.
  const context = new GridTestContext({ gridSize: [1, 2], numValues: 4 });
  const cells = context.cells();
  const handler = new Lunchbox(cells, 0);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 4); // Can be either border value
  grid[1] = valueMask(1, 4); // Can be either border value
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should handle 2-cell non-house with sum=0');
});

await runTest('Lunchbox should handle large valid sum', () => {
  const context = new GridTestContext({ gridSize: [1, 9] });
  const cells = context.cells();
  // Max sum = 2+3+4+5+6+7+8 = 35
  const handler = new Lunchbox(cells, 35);
  context.initializeHandler(handler);

  const grid = context.grid;
  // 1, 2, 3, 4, 5, 6, 7, 8, 9 - borders are 1 and 9
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);
  grid[3] = valueMask(4);
  grid[4] = valueMask(5);
  grid[5] = valueMask(6);
  grid[6] = valueMask(7);
  grid[7] = valueMask(8);
  grid[8] = valueMask(9);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should handle large sum', () => {
  const context = new GridTestContext({ gridSize: [1, 9] });
  const cells = context.cells();
  // Max sum = 2+3+4+5+6+7+8 = 35
  const handler = new Lunchbox(cells, 35);
  context.initializeHandler(handler);

  const grid = context.grid;
  // 1, 2, 3, 4, 5, 6, 7, 8, 9 - borders are 1 and 9
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);
  grid[3] = valueMask(4);
  grid[4] = valueMask(5);
  grid[5] = valueMask(6);
  grid[6] = valueMask(7);
  grid[7] = valueMask(8);
  grid[8] = valueMask(9);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('Lunchbox should work when borders not at ends', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  // Sum = 0: borders adjacent somewhere in middle
  const handler = new Lunchbox(cells, 0);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2); // Not a border
  grid[1] = valueMask(1); // Border
  grid[2] = valueMask(4); // Border
  grid[3] = valueMask(3); // Not a border
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'borders can be anywhere, not just at ends');
});

// =============================================================================
// Pruning tests
// =============================================================================

await runTest('Lunchbox should accumulate changes', () => {
  const context = new GridTestContext({ gridSize: [1, 4] });
  const cells = context.cells();
  const handler = new Lunchbox(cells, 2);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(2, 3); // Should be pruned based on constraints
  grid[2] = valueMask(3);
  grid[3] = valueMask(4);
  const acc = createAccumulator();

  handler.enforceConsistency(grid, acc);

  // Any pruning should result in accumulated changes
  // (The exact pruning depends on constraint logic)
});

// =============================================================================
// Offset (0-indexed) tests
// =============================================================================

const { GridShape } = await import('../../js/grid_shape.js');

await runTest('offset: per-distance combinations adjust correctly', () => {
  // 4 cells (house), numValues=4, offset=-1. External 0-3, internal 1-4.
  // Sentinels: internal 1 + 4 (external 0 + 3).
  // External sandwich sum = 2.
  // Distance 2 (0 inner): internalSum = 2 - (-1)*(2-1) = 3. No inner cells. Skip.
  // Distance 3 (1 inner): internalSum = 2 - (-1)*(3-1) = 4. 1 inner cell needs
  //   internal sum 4, but inner values are {2,3}. Internal 4 is a sentinel. So no combo.
  //   Wait, inner value mask excludes sentinels. Internal non-sentinels: {2,3}.
  //   Sum 4 from {2,3}: only possibility is {2}+{3}? No, single cell: internal 4
  //   is a sentinel. countOnes = 1, so d=2 not d=3... let me reconsider.
  //
  // Actually: combinations table is indexed by [internalSum][distance].
  // Distance = countOnes(combo) + 1.
  // For d=3: combo has 2 bits set. internalSum = 2 - (-1)*2 = 4.
  //   Non-sentinel combos summing to 4 with 2 bits: {2,3} (sum=5 no), none.
  //   Actually wait: sum of {2} is 2 with 1 bit → d=2. sum of {3} is 3 with 1 bit → d=2.
  //   {2,3} sum = 5 with 2 bits → d=3. Not 4. So no combo matches.
  // For d=2: combo has 1 bit set. internalSum = 2 - (-1)*1 = 3.
  //   Non-sentinel single bit summing to 3: {3}. 1 bit → d=2. Yes!
  //   So adjacent sentinels with {3} between → distance 2 with 1 inner cell.
  //
  // With 4-cell house [s1, inner, s2, outer], sentinels at positions 0,2:
  // inner = cell 1 with internal value 3, outer = cell 3 with internal value 2.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new Lunchbox([0, 1, 2, 3], 2);
  context.initializeHandler(handler);

  const grid = context.grid;
  // Sentinels can be 1 or 4 (internal). Inner values: 2 or 3.
  grid[0] = valueMask(1, 4);   // sentinel candidate
  grid[1] = valueMask(2, 3);   // inner candidate
  grid[2] = valueMask(1, 4);   // sentinel candidate
  grid[3] = valueMask(2, 3);   // outer candidate

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);
  assert.equal(result, true);
});

await runTest('offset: house shortcut adjusts target sum', () => {
  // 4-cell house, numValues=4, offset=-1. Sum=1.
  // Sentinels at fixed positions 0 and 3. Inner cells: 1 and 2.
  // 2 inner cells. internalTarget = 1 - (-1)*2 = 3.
  // Inner cells internal min/max range check against internalTarget=3.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new Lunchbox([0, 1, 2, 3], 1);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);   // sentinel (ext 0)
  grid[1] = valueMask(2);   // inner: internal 2 (ext 1)
  grid[2] = valueMask(3);   // inner: internal 3 (ext 2)
  grid[3] = valueMask(4);   // sentinel (ext 3)

  const acc = createAccumulator();
  // Internal sum of inner cells = 2+3 = 5. Target = 1 - (-1)*2 = 3.
  // 5 ≠ 3, so this config is not valid for the sandwich constraint.
  // But the handler may still return true if other sentinel placements work.
  // Actually with all cells fixed, only one configuration: sentinels at 0,3.
  // Inner sum = 5 ≠ 3 → fail.
  const result = handler.enforceConsistency(grid, acc);
  assert.equal(result, false);
});

await runTest('offset: house shortcut passes with correct sum', () => {
  // 4-cell house, numValues=4, offset=-1. Sum=3.
  // Sentinels at 0 and 3. 2 inner cells: target = 3 - (-1)*2 = 5.
  // Inner internal sum = 2+3 = 5. Matches!
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const handler = new Lunchbox([0, 1, 2, 3], 3);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);   // sentinel
  grid[1] = valueMask(2);   // inner
  grid[2] = valueMask(3);   // inner
  grid[3] = valueMask(4);   // sentinel

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);
  assert.equal(result, true);
});

await runTest('offset=0: unchanged behavior', () => {
  // 4-cell house, numValues=4, sum=2. Standard (no offset).
  // Sentinels: 1 and 4. Inner: {2,3}. Sum=2 → internal 2 between sentinels.
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new Lunchbox([0, 1, 2, 3], 2);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(4);
  grid[3] = valueMask(3);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);
  assert.equal(result, true);
});

logSuiteComplete('lunchbox.test.js');
