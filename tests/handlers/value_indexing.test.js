import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  setupConstraintTest,
  createAccumulator,
  valueMask,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { ValueIndexing } = await import('../../js/solver/handlers.js');

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('ValueIndexing should restrict control cell to valid indices on init', () => {
  const context = setupConstraintTest({ gridSize: [1, 9] });
  // valueCell=0, controlCell=1, indexedCells=[2,3,4] (3 cells)
  const handler = new ValueIndexing(0, 1, 2, 3, 4);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  // Control cell should only allow values 1-3 (indices into 3 indexed cells)
  assert.equal(grid[1], valueMask(1, 2, 3), 'control cell should only allow 1, 2, 3');
});

await runTest('ValueIndexing should fail init if value cell is empty', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const handler = new ValueIndexing(0, 1, 2, 3);

  const grid = context.grid;
  grid[0] = 0; // Empty value cell
  const result = context.initializeHandler(handler);

  assert.equal(result, false);
});

await runTest('ValueIndexing should pass init even with restricted control cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  // valueCell=0, controlCell=1, indexedCells=[2,3] (2 cells)
  const handler = new ValueIndexing(0, 1, 2, 3);

  const grid = context.grid;
  grid[1] = valueMask(1, 2, 3, 4); // All values initially
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  // Control should be restricted to 1, 2 (only 2 indexed cells)
  assert.equal(grid[1], valueMask(1, 2));
});

// =============================================================================
// enforceConsistency - basic pruning
// =============================================================================

await runTest('ValueIndexing should prune value cell based on possible indexed values', () => {
  const context = setupConstraintTest({ gridSize: [1, 5] });
  // valueCell=0, controlCell=1, indexedCells=[2,3,4]
  const handler = new ValueIndexing(0, 1, 2, 3, 4);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4); // Value cell - all values
  grid[1] = valueMask(1, 2, 3); // Control cell (indices 1, 2, 3)
  grid[2] = valueMask(1, 2); // Indexed[0] - has 1, 2
  grid[3] = valueMask(3, 4); // Indexed[1] - has 3, 4
  grid[4] = valueMask(2); // Indexed[2] - has only 2
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Possible values: from indexed[0]={1,2}, indexed[1]={3,4}, indexed[2]={2}
  // Value cell intersection with each: {1,2} ∩ {1,2,3,4} = {1,2}, etc.
  // Union: {1,2} ∪ {3,4} ∪ {2} = {1,2,3,4}
  assert.equal(grid[0], valueMask(1, 2, 3, 4));
});

await runTest('ValueIndexing should prune control cell based on value compatibility', () => {
  const context = setupConstraintTest({ gridSize: [1, 5] });
  const handler = new ValueIndexing(0, 1, 2, 3, 4);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(3); // Value cell - only 3
  grid[1] = valueMask(1, 2, 3); // Control cell
  grid[2] = valueMask(1, 2); // Indexed[0] - no 3
  grid[3] = valueMask(3, 4); // Indexed[1] - has 3
  grid[4] = valueMask(2, 4); // Indexed[2] - no 3
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Only indexed[1] (control=2) can have value 3
  assert.equal(grid[1], valueMask(2), 'control should only be 2');
  assert.ok(acc.touched.has(1));
});

await runTest('ValueIndexing should constrain indexed cell when control is fixed', () => {
  const context = setupConstraintTest({ gridSize: [1, 5] });
  const handler = new ValueIndexing(0, 1, 2, 3, 4);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2, 3); // Value cell
  grid[1] = valueMask(2); // Control cell - fixed to 2 (meaning indexed[1])
  grid[2] = valueMask(1, 2, 3, 4);
  grid[3] = valueMask(1, 2, 3, 4); // This is indexed[1]
  grid[4] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // indexed[1] (grid[3]) should be constrained to value cell values
  assert.equal(grid[3], valueMask(2, 3), 'indexed cell should match possible values');
});

await runTest('ValueIndexing should fail when no valid control-value pair exists', () => {
  const context = setupConstraintTest({ gridSize: [1, 5] });
  const handler = new ValueIndexing(0, 1, 2, 3, 4);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(4); // Value cell - only 4
  grid[1] = valueMask(1, 2, 3); // Control cell
  grid[2] = valueMask(1, 2); // Indexed[0] - no 4
  grid[3] = valueMask(2, 3); // Indexed[1] - no 4
  grid[4] = valueMask(1, 3); // Indexed[2] - no 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when value cannot be found in any indexed cell');
});

// =============================================================================
// Rectangular grid compatibility
// =============================================================================

await runTest('ValueIndexing should work with short indexed array (numIndexed < numValues)', () => {
  // 8 values, but only 6 indexed cells (like a 6-cell row on a 6x8 grid)
  const context = setupConstraintTest({ gridSize: [2, 5], numValues: 8 });
  // valueCell=0, controlCell=1, indexedCells=[2,3,4,5,6,7] (6 cells)
  const handler = new ValueIndexing(0, 1, 2, 3, 4, 5, 6, 7);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  // Control cell should only allow values 1-6 (6 indexed cells)
  assert.equal(grid[1], valueMask(1, 2, 3, 4, 5, 6), 'control should be limited to valid indices');
});

await runTest('ValueIndexing should enforce correctly on rectangular grid', () => {
  const context = setupConstraintTest({ gridSize: [2, 5], numValues: 8 });
  const handler = new ValueIndexing(0, 1, 2, 3, 4, 5, 6, 7);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(7, 8); // Value cell - values 7 and 8
  grid[1] = valueMask(1, 2, 3, 4, 5, 6); // Control (already restricted by init)
  grid[2] = valueMask(1, 2, 3, 4, 5, 6); // Indexed[0] - no 7 or 8
  grid[3] = valueMask(7, 8); // Indexed[1] - has 7, 8
  grid[4] = valueMask(1, 2, 3); // Indexed[2]
  grid[5] = valueMask(4, 5, 6, 7); // Indexed[3] - has 7
  grid[6] = valueMask(1, 8); // Indexed[4] - has 8
  grid[7] = valueMask(2, 3, 4); // Indexed[5]
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Only indices where indexed cell has 7 or 8: 1 (7,8), 3 (7), 4 (8)
  // So control can be 2, 4, 5 (1-indexed)
  assert.equal(grid[1], valueMask(2, 4, 5), 'control should only allow compatible indices');
});

await runTest('ValueIndexing should work with more indexed cells than values', () => {
  // 6 values, but 10 indexed cells
  const context = setupConstraintTest({ gridSize: [3, 4], numValues: 6 });
  const handler = new ValueIndexing(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  // Control cell should allow values 1-6 (limited by numValues even though 10 indexed)
  // Actually: mask is (1 << 10) - 1 = values 1-10, but numValues=6 means only 1-6 exist
  // So control will be all values 1-6 (as that's what grid fills with)
  assert.equal(grid[1], valueMask(1, 2, 3, 4, 5, 6));
});

// =============================================================================
// Edge cases
// =============================================================================

await runTest('ValueIndexing should handle single indexed cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 3], numValues: 4 });
  // valueCell=0, controlCell=1, indexedCells=[2] (only 1)
  const handler = new ValueIndexing(0, 1, 2);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2, 3); // Value cell
  grid[1] = valueMask(1); // Control - only option is 1
  grid[2] = valueMask(2, 3, 4); // The single indexed cell
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Indexed[0] must contain a value from value cell
  assert.equal(grid[2], valueMask(2, 3), 'indexed cell should be constrained to value cell');
});

await runTest('ValueIndexing should update both value and control cells', () => {
  const context = setupConstraintTest({ gridSize: [2, 3], numValues: 4 });
  const handler = new ValueIndexing(0, 1, 2, 3, 4, 5);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4); // Value cell
  grid[1] = valueMask(1, 2, 3, 4); // Control
  grid[2] = valueMask(1); // Indexed[0] - only 1
  grid[3] = valueMask(2); // Indexed[1] - only 2
  grid[4] = valueMask(3); // Indexed[2] - only 3
  grid[5] = valueMask(4); // Indexed[3] - only 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // All combinations are valid - no pruning needed
  assert.equal(grid[0], valueMask(1, 2, 3, 4));
  assert.equal(grid[1], valueMask(1, 2, 3, 4));
});

logSuiteComplete('value_indexing.test.js');
