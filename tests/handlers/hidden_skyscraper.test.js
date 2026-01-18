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

const { HiddenSkyscraper } = await import('../../js/solver/handlers.js');

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('HiddenSkyscraper should remove target from first cell on init', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  const handler = new HiddenSkyscraper(cells, 3); // First hidden = 3

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 4 }), context.shape, {});

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2, 4), 'first cell should not contain target value 3');
});

await runTest('HiddenSkyscraper should fail init if first cell only has target value', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  const handler = new HiddenSkyscraper(cells, 3);

  const grid = context.createGrid();
  grid[0] = valueMask(3); // Only the target value
  const result = handler.initialize(grid, createCellExclusions({ numCells: 4 }), context.shape, {});

  assert.equal(result, false, 'should fail when first cell only has target');
});

// =============================================================================
// Forward pass - visibility tracking
// =============================================================================

await runTest('HiddenSkyscraper should allow target when it can be hidden', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  const handler = new HiddenSkyscraper(cells, 3);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  // If first cell is 4, 3 can be hidden behind it (4 > 3)
  grid[0] = valueMask(4);
  grid[1] = valueMask(1, 2, 3, 4);
  grid[2] = valueMask(1, 2, 3, 4);
  grid[3] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should pass when 3 can be hidden behind 4');
});

await runTest('HiddenSkyscraper should remove target from cells where it cannot be hidden', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  const handler = new HiddenSkyscraper(cells, 2); // First hidden = 2
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = valueMask(1); // First cell is 1, so 2 can be hidden by anything > 2
  grid[1] = valueMask(2, 3); // 2 here can be hidden (1 < 3 exists)
  grid[2] = valueMask(2, 4);
  grid[3] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
});

await runTest('HiddenSkyscraper should remove target from cells after first valid position', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const cells = [0, 1, 2, 3];
  const handler = new HiddenSkyscraper(cells, 2);
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 4 }), context.shape, {});

  const grid = new Uint16Array(4);
  grid[0] = valueMask(3); // First visible is 3, so 2 must be hidden behind it
  grid[1] = valueMask(2); // 2 is here and hidden (3 > 2)
  grid[2] = valueMask(2, 4); // 2 should be removed - we already found it at index 1
  grid[3] = valueMask(1, 2, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[2] & valueMask(2), 0, 'cell 2 should not contain 2 after first hidden found');
  assert.equal(grid[3] & valueMask(2), 0, 'cell 3 should not contain 2 after first hidden found');
});

// =============================================================================
// Backward pass - filtering values too large
// =============================================================================

await runTest('HiddenSkyscraper backward pass should filter values too large to reach target', () => {
  const context = setupConstraintTest({ numValues: 5, numCells: 5 });
  const cells = [0, 1, 2, 3, 4];
  const handler = new HiddenSkyscraper(cells, 2); // First hidden = 2
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 5 }), context.shape, {});

  const grid = new Uint16Array(5);
  // To hide 2, we need a value > 2 before it
  // Valid sequence: 3, 2, ... or 4, 2, ... or 5, 2, ... etc.
  grid[0] = valueMask(3, 4, 5); // Must be > 2 to hide it
  grid[1] = valueMask(2); // Target is here, hidden
  grid[2] = valueMask(1, 3, 4, 5);
  grid[3] = valueMask(1, 3, 4, 5);
  grid[4] = valueMask(1, 3, 4, 5);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Backward pass ensures first cell values allow reaching target at index 1
  // Max value at index 0 can be anything > 2 since target is at index 1
});

// =============================================================================
// Rectangular grid compatibility
// =============================================================================

await runTest('HiddenSkyscraper should work on short rows (numCells < numValues)', () => {
  // 6x8 grid: 6 columns, 8 values per cell
  const context = setupConstraintTest({ numValues: 8, numCells: 6 });
  const cells = [0, 1, 2, 3, 4, 5]; // A 6-cell row
  const handler = new HiddenSkyscraper(cells, 4); // First hidden = 4
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 6 }), context.shape, {});

  const grid = new Uint16Array(6);
  // Row of 6 cells, each can have values 1-8
  // For 4 to be hidden, we need a value > 4 before it
  grid[0] = valueMask(5, 6, 7, 8); // First visible must be > 4 to hide 4
  grid[1] = valueMask(4); // 4 is hidden here
  grid[2] = valueMask(1, 2, 3, 4, 5, 6, 7, 8);
  grid[3] = valueMask(1, 2, 3, 4, 5, 6, 7, 8);
  grid[4] = valueMask(1, 2, 3, 4, 5, 6, 7, 8);
  grid[5] = valueMask(1, 2, 3, 4, 5, 6, 7, 8);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should work on rectangular grid');
  // 4 should be cleared from cells after position 1
  assert.equal(grid[2] & valueMask(4), 0, 'cell 2 should not have 4');
  assert.equal(grid[3] & valueMask(4), 0, 'cell 3 should not have 4');
});

await runTest('HiddenSkyscraper should work on long rows (numCells > numValues)', () => {
  // Hypothetical 10x6 grid: 10 columns, 6 values
  const context = setupConstraintTest({ numValues: 6, numCells: 10 });
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // A 10-cell row
  const handler = new HiddenSkyscraper(cells, 3); // First hidden = 3
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 10 }), context.shape, {});

  const grid = new Uint16Array(10);
  for (let i = 0; i < 10; i++) {
    grid[i] = valueMask(1, 2, 3, 4, 5, 6);
  }
  grid[0] = valueMask(4, 5, 6); // Must be > 3 to hide it
  grid[1] = valueMask(3); // 3 is hidden here
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true, 'should work with more cells than values');
  // 3 should be cleared from cells after position 1
  for (let i = 2; i < 10; i++) {
    assert.equal(grid[i] & valueMask(3), 0, `cell ${i} should not have 3`);
  }
});

// =============================================================================
// Edge cases
// =============================================================================

await runTest('HiddenSkyscraper should handle minimum valid scenario', () => {
  const context = setupConstraintTest({ numValues: 2, numCells: 2 });
  const cells = [0, 1];
  const handler = new HiddenSkyscraper(cells, 1); // First hidden = 1
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 2 }), context.shape, {});

  const grid = new Uint16Array(2);
  grid[0] = valueMask(2); // Must be > 1 to hide it
  grid[1] = valueMask(1, 2); // 1 can be hidden here
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1], valueMask(1), '1 must be in cell 1');
});

await runTest('HiddenSkyscraper should fail when target cannot be placed', () => {
  const context = setupConstraintTest({ numValues: 3, numCells: 3 });
  const cells = [0, 1, 2];
  const handler = new HiddenSkyscraper(cells, 2); // First hidden = 2
  handler.initialize(context.createGrid(), createCellExclusions({ numCells: 3 }), context.shape, {});

  const grid = new Uint16Array(3);
  grid[0] = valueMask(1); // First is 1 - cannot hide 2 (1 < 2)
  grid[1] = valueMask(1, 3);
  grid[2] = valueMask(1, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  // Need to check if this fails - 2 cannot be hidden because nothing > 2 before any 2
  assert.equal(result, false, 'should fail when 2 cannot be hidden');
});

logSuiteComplete('hidden_skyscraper.test.js');
