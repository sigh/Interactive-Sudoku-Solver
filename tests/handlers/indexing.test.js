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

const { Indexing } = await import('../../js/solver/handlers.js');

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('Indexing should restrict control cell to valid indices on init', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 9 }), context.shape, {});

  assert.equal(result, true);
  assert.equal(grid[0], mask(1, 2, 3, 4), 'control cell should only allow 1..lineLength');
});

await runTest('Indexing should fail init if control cell has no values within the line length', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = context.createGrid();
  grid[0] = mask(9); // out of range for a 4-cell index list
  const result = handler.initialize(grid, createCellExclusions({ numCells: 9 }), context.shape, {});

  assert.equal(result, false);
});

await runTest('Indexing init should work on non-standard grids (line length < numValues)', () => {
  // e.g. a 6-cell line on a numValues=8 rectangular grid
  const context = setupConstraintTest({ numValues: 8, numCells: 8 });
  const handler = new Indexing(0, [1, 2, 3, 4, 5, 6], 5);

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 8 }), context.shape, {});

  assert.equal(result, true);
  assert.equal(grid[0], mask(1, 2, 3, 4, 5, 6), 'control should be limited to the line length');
});

await runTest('Indexing init should clamp a pre-restricted control cell', () => {
  const context = setupConstraintTest({ numValues: 9, numCells: 9 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = context.createGrid();
  grid[0] = mask(2, 4, 9); // mix of in-range and out-of-range
  const result = handler.initialize(grid, createCellExclusions({ numCells: 9 }), context.shape, {});

  assert.equal(result, true);
  assert.equal(grid[0], mask(2, 4), 'out-of-range candidates should be removed');
});

await runTest('Indexing init should restrict control to 1 for a single indexed cell', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 4 });
  const handler = new Indexing(0, [1], 3);

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 4 }), context.shape, {});

  assert.equal(result, true);
  assert.equal(grid[0], mask(1));
});

await runTest('Indexing init should be a no-op when line length equals numValues', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = context.createGrid();
  const result = handler.initialize(grid, createCellExclusions({ numCells: 5 }), context.shape, {});

  assert.equal(result, true);
  assert.equal(grid[0], mask(1, 2, 3, 4));
});

// =============================================================================
// Basic functionality tests
// =============================================================================

await runTest('Indexing should prune control cell when indexed cell cannot have value', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  // controlCell=0, indexedCells=[1,2,3,4], indexedValue=3
  // If control=N, then indexedCells[N-1] must contain value 3
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = new Uint16Array(5);
  grid[0] = mask(1, 2, 3, 4); // Control cell - all values
  grid[1] = mask(1, 2); // Indexed[0] - no 3
  grid[2] = mask(3, 4); // Indexed[1] - has 3
  grid[3] = mask(1, 2); // Indexed[2] - no 3
  grid[4] = mask(2, 3); // Indexed[3] - has 3
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Only indexed[1] (control=2) and indexed[3] (control=4) can have 3
  assert.equal(grid[0], mask(2, 4), 'control should only allow 2 and 4');
  assert.ok(acc.touched.has(0));
});

await runTest('Indexing should remove indexed value from cells that cannot be selected', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = new Uint16Array(5);
  grid[0] = mask(2); // Control cell - fixed to 2
  grid[1] = mask(1, 2, 3); // Indexed[0] - has 3, but control cannot be 1
  grid[2] = mask(3, 4); // Indexed[1] - selected (control=2)
  grid[3] = mask(1, 3); // Indexed[2] - has 3, but control cannot be 3
  grid[4] = mask(2, 3); // Indexed[3] - has 3, but control cannot be 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Since control is fixed to 2, value 3 should be removed from all other indexed cells
  assert.equal(grid[1], mask(1, 2), 'indexed[0] should not have 3');
  assert.equal(grid[2], mask(3, 4), 'indexed[1] keeps 3 (selected)');
  assert.equal(grid[3], mask(1), 'indexed[2] should not have 3');
  assert.equal(grid[4], mask(2), 'indexed[3] should not have 3');
});

await runTest('Indexing should fail when control has no valid options', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = new Uint16Array(5);
  grid[0] = mask(1, 2, 3, 4); // Control cell
  grid[1] = mask(1, 2); // Indexed[0] - no 3
  grid[2] = mask(1, 4); // Indexed[1] - no 3
  grid[3] = mask(1, 2); // Indexed[2] - no 3
  grid[4] = mask(2, 4); // Indexed[3] - no 3
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when no indexed cell can have the value');
});

await runTest('Indexing should fail when removal empties an indexed cell', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = new Uint16Array(5);
  grid[0] = mask(2); // Control fixed to 2
  grid[1] = mask(3); // Indexed[0] - only 3, but control ≠ 1
  grid[2] = mask(3); // Indexed[1] - only 3 (selected)
  grid[3] = mask(3); // Indexed[2] - only 3, but control ≠ 3
  grid[4] = mask(3); // Indexed[3] - only 3, but control ≠ 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when removing value empties a cell');
});

// =============================================================================
// Rectangular grid compatibility
// =============================================================================

await runTest('Indexing should work with fewer indexed cells than numValues', () => {
  // 8 values, but only 6 indexed cells (like a 6-cell row)
  const context = setupConstraintTest({ numValues: 8, numCells: 8 });
  const handler = new Indexing(0, [1, 2, 3, 4, 5, 6], 5); // 6 indexed cells

  const grid = new Uint16Array(8);
  grid[0] = mask(1, 2, 3, 4, 5, 6, 7, 8); // Control - all values
  grid[1] = mask(1, 2, 3, 4, 5); // Indexed[0] - has 5
  grid[2] = mask(1, 2, 3, 4); // Indexed[1] - no 5
  grid[3] = mask(5, 6, 7, 8); // Indexed[2] - has 5
  grid[4] = mask(1, 2, 3); // Indexed[3] - no 5
  grid[5] = mask(4, 5, 6); // Indexed[4] - has 5
  grid[6] = mask(7, 8); // Indexed[5] - no 5

  // The engine calls initialize() before solving starts.
  assert.equal(
    handler.initialize(grid, createCellExclusions({ numCells: 8 }), context.shape, {}),
    true,
    'constraint handler should initialize'
  );
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Valid control values: 1 (indexed[0] has 5), 3 (indexed[2] has 5), 5 (indexed[4] has 5)
  assert.equal(grid[0], mask(1, 3, 5), 'control should allow 1, 3, 5');
});

await runTest('Indexing should work with more indexed cells than numValues', () => {
  // 6 values, but 8 indexed cells
  const context = setupConstraintTest({ numValues: 6, numCells: 10 });
  const handler = new Indexing(0, [1, 2, 3, 4, 5, 6, 7, 8], 4); // 8 indexed cells

  const grid = new Uint16Array(10);
  grid[0] = mask(1, 2, 3, 4, 5, 6); // Control - numValues limits this
  grid[1] = mask(4); // Indexed[0] - has 4
  grid[2] = mask(1, 2, 3); // Indexed[1] - no 4
  grid[3] = mask(1, 2, 3); // Indexed[2] - no 4
  grid[4] = mask(1, 2, 3); // Indexed[3] - no 4
  grid[5] = mask(4, 5, 6); // Indexed[4] - has 4
  grid[6] = mask(1, 2, 3); // Indexed[5] - no 4
  grid[7] = mask(1, 2, 3); // Indexed[6] - no 4
  grid[8] = mask(1, 2, 3); // Indexed[7] - no 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Only indexed[0] (control=1) and indexed[4] (control=5) have 4
  assert.equal(grid[0], mask(1, 5), 'control should only allow 1 and 5');
});

await runTest('Indexing should handle control restricted to valid indices', () => {
  const context = setupConstraintTest({ numValues: 8, numCells: 8 });
  // Only 4 indexed cells, but numValues is 8
  const handler = new Indexing(0, [1, 2, 3, 4], 2);

  const grid = new Uint16Array(8);
  grid[0] = mask(1, 2, 3, 4); // Pre-restricted control
  grid[1] = mask(2, 3); // Indexed[0] - has 2
  grid[2] = mask(2, 3); // Indexed[1] - has 2
  grid[3] = mask(1, 3); // Indexed[2] - no 2
  grid[4] = mask(1, 3); // Indexed[3] - no 2
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], mask(1, 2), 'control should allow 1 and 2');
});

// =============================================================================
// Edge cases
// =============================================================================

await runTest('Indexing should handle single indexed cell', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 2 });
  const handler = new Indexing(0, [1], 3); // Single indexed cell

  const grid = new Uint16Array(2);
  grid[0] = mask(1, 2, 3, 4); // Control
  grid[1] = mask(1, 2, 3); // Single indexed cell - has 3
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Only control=1 points to indexed[0]
  assert.equal(grid[0], mask(1, 2, 3, 4), 'control can still be anything (only 1 indexes)');
  // But values 2, 3, 4 don't index anything in the array
});

await runTest('Indexing should handle all indexed cells having the value', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  const handler = new Indexing(0, [1, 2, 3, 4], 2);

  const grid = new Uint16Array(5);
  grid[0] = mask(1, 2, 3, 4); // Control
  grid[1] = mask(1, 2, 3, 4); // All have 2
  grid[2] = mask(1, 2, 3, 4);
  grid[3] = mask(1, 2, 3, 4);
  grid[4] = mask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // All control values are valid since all indexed cells have 2
  assert.equal(grid[0], mask(1, 2, 3, 4));
});

await runTest('Indexing should prune indexed cells based on control', () => {
  const context = setupConstraintTest({ numValues: 4, numCells: 5 });
  const handler = new Indexing(0, [1, 2, 3, 4], 3);

  const grid = new Uint16Array(5);
  grid[0] = mask(1, 3); // Control can only be 1 or 3
  grid[1] = mask(1, 2, 3); // Indexed[0] - control=1 possible
  grid[2] = mask(1, 2, 3); // Indexed[1] - control=2 NOT possible
  grid[3] = mask(1, 2, 3); // Indexed[2] - control=3 possible
  grid[4] = mask(1, 2, 3); // Indexed[3] - control=4 NOT possible
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // indexed[1] and indexed[3] cannot be selected, so remove value 3 from them
  assert.equal(grid[1], mask(1, 2, 3), 'indexed[0] keeps 3');
  assert.equal(grid[2], mask(1, 2), 'indexed[1] loses 3');
  assert.equal(grid[3], mask(1, 2, 3), 'indexed[2] keeps 3');
  assert.equal(grid[4], mask(1, 2), 'indexed[3] loses 3');
});

logSuiteComplete('indexing.test.js');
