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

const { fnToBinaryKey } = await import('../../js/sudoku_constraint.js');
const { BinaryConstraint } = await import('../../js/solver/handlers.js');

// Helper to create a binary key from a predicate function.
const binaryKey = (fn, numValues) =>
  fnToBinaryKey(fn, numValues);

// =============================================================================
// Initialization tests
// =============================================================================

await runTest('BinaryConstraint should initialize with valid key', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a !== b, 4);
  const handler = new BinaryConstraint(0, 1, key);

  const result = context.initializeHandler(handler);

  assert.equal(result, true);
});

await runTest('BinaryConstraint should fail initialization if no values are legal', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  // Impossible constraint: no pair is ever valid.
  const key = binaryKey(() => false, 4);
  const handler = new BinaryConstraint(0, 1, key);

  const result = context.initializeHandler(handler);

  assert.equal(result, false);
});

await runTest('BinaryConstraint should store key', () => {
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);

  assert.equal(handler.key(), key);
});

await runTest('BinaryConstraint should have unique idStr', () => {
  const key = binaryKey((a, b) => a < b, 4);
  const h1 = new BinaryConstraint(0, 1, key);
  const h2 = new BinaryConstraint(0, 2, key);
  const h3 = new BinaryConstraint(0, 1, key);

  assert.notEqual(h1.idStr, h2.idStr, 'different cells should have different idStr');
  assert.equal(h1.idStr, h3.idStr, 'same cells and key should have same idStr');
});

// =============================================================================
// enforceConsistency - "not equal" constraint (a !== b)
// =============================================================================

await runTest('not-equal: should prune same values from both cells', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a !== b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Cell 0 can be 1 or 2, so cell 1 can still be 1, 2, or 3 (just not both same)
  // But with a !== b, if cell 0 is {1,2}, cell 1 can still be {1,2,3}
  // The constraint only prunes when one cell is fixed.
  assert.equal(grid[0], valueMask(1, 2));
  assert.equal(grid[1], valueMask(1, 2, 3));
});

await runTest('not-equal: should prune when one cell is fixed', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a !== b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);  // Fixed to 2
  grid[1] = valueMask(1, 2, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(1, 3), 'should remove 2 from cell 1');
  assert.ok(acc.touched.has(1));
});

await runTest('not-equal: should fail when both cells forced to same value', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a !== b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(2);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

// =============================================================================
// enforceConsistency - "less than" constraint (a < b)
// =============================================================================

await runTest('less-than: should prune high values from first cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4);
  grid[1] = valueMask(3);  // Fixed to 3
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2), 'only 1 and 2 are less than 3');
  assert.equal(grid[1], valueMask(3));
  assert.ok(acc.touched.has(0));
});

await runTest('less-than: should prune low values from second cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);  // Fixed to 2
  grid[1] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(3, 4), 'only 3 and 4 are greater than 2');
  assert.ok(acc.touched.has(1));
});

await runTest('less-than: should prune both cells', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2, 3, 4);  // Can be 2, 3, or 4
  grid[1] = valueMask(1, 2, 3);  // Can be 1, 2, or 3
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // For a < b: cell 0 must have values less than something in cell 1
  // cell 1 has max 3, so cell 0 can be 2 (less than 3)
  // cell 0 has min 2, so cell 1 must be > 2, i.e. 3
  assert.equal(grid[0], valueMask(2));
  assert.equal(grid[1], valueMask(3));
});

await runTest('less-than: should fail when first cell minimum >= second cell maximum', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(3, 4);  // Min is 3
  grid[1] = valueMask(1, 2);  // Max is 2
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'no value in cell 0 is less than any value in cell 1');
});

// =============================================================================
// enforceConsistency - "equals" constraint (a === b)
// =============================================================================

await runTest('equals: should intersect candidates', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a === b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3);
  grid[1] = valueMask(2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2, 3), 'intersection of {1,2,3} and {2,3,4}');
  assert.equal(grid[1], valueMask(2, 3));
  assert.ok(acc.touched.has(0));
  assert.ok(acc.touched.has(1));
});

await runTest('equals: should fail when no common values', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a === b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

// =============================================================================
// enforceConsistency - difference constraint (|a - b| >= k)
// =============================================================================

await runTest('difference >= 2: should prune adjacent values', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => Math.abs(a - b) >= 2, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // |2 - b| >= 2 means b <= 0 or b >= 4, so only 4 is valid
  assert.equal(grid[1], valueMask(4));
});

await runTest('difference >= 2: should fail when too close', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => Math.abs(a - b) >= 2, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(2);
  grid[1] = valueMask(1, 2, 3);  // All within 1 of 2
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

// =============================================================================
// enforceConsistency - cells not touched when already consistent
// =============================================================================

await runTest('should not report cells when values unchanged', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(acc.touched.size, 0, 'no cells should be touched');
});

await runTest('should report only changed cells', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a < b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1);  // Already constrained
  grid[1] = valueMask(1, 2, 3, 4);           // Needs pruning
  const acc = createAccumulator();

  handler.enforceConsistency(grid, acc);

  assert.deepEqual([...acc.touched], [1], 'only cell 1 should be touched');
});

// =============================================================================
// enforceConsistency - reusability
// =============================================================================

await runTest('should be reusable across multiple calls', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a !== b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  // First call
  const grid1 = setupConstraintTest({ gridSize: [1, 4] }).grid;
  grid1[0] = valueMask(1);
  grid1[1] = valueMask(1, 2, 3);
  assert.equal(handler.enforceConsistency(grid1, createAccumulator()), true);
  assert.equal(grid1[1], valueMask(2, 3));

  // Second call with different grid
  const grid2 = setupConstraintTest({ gridSize: [1, 4] }).grid;
  grid2[0] = valueMask(3);
  grid2[1] = valueMask(2, 3, 4);
  assert.equal(handler.enforceConsistency(grid2, createAccumulator()), true);
  assert.equal(grid2[1], valueMask(2, 4));

  // Third call that fails
  const grid3 = setupConstraintTest({ gridSize: [1, 4] }).grid;
  grid3[0] = valueMask(2);
  grid3[1] = valueMask(2);
  assert.equal(handler.enforceConsistency(grid3, createAccumulator()), false);
});

// =============================================================================
// enforceConsistency - non-contiguous cells
// =============================================================================

await runTest('should work with non-contiguous cell indices', () => {
  const context = setupConstraintTest({ gridSize: [4, 5] });
  const key = binaryKey((a, b) => a < b, 5);
  const handler = new BinaryConstraint(5, 15, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[5] = valueMask(1, 2, 3, 4, 5);
  grid[15] = valueMask(2);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[5], valueMask(1), 'only 1 is less than 2');
  assert.ok(acc.touched.has(5));
  assert.ok(!acc.touched.has(15));
});

// =============================================================================
// asymmetric constraints
// =============================================================================

await runTest('asymmetric constraint: a*2 === b', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  // a*2 === b, so valid pairs are (1,2) and (2,4)
  const key = binaryKey((a, b) => a * 2 === b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4);
  grid[1] = valueMask(1, 2, 3, 4);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2), 'only 1 and 2 have valid doubles');
  assert.equal(grid[1], valueMask(2, 4), 'only 2 and 4 are valid doubles');
});

await runTest('asymmetric constraint: should prune correctly given fixed value', () => {
  const context = setupConstraintTest({ gridSize: [1, 4] });
  const key = binaryKey((a, b) => a * 2 === b, 4);
  const handler = new BinaryConstraint(0, 1, key);
  context.initializeHandler(handler);

  const grid = context.grid;
  grid[0] = valueMask(1, 2, 3, 4);
  grid[1] = valueMask(4);  // Fixed to 4
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(2), '2*2 = 4');
});

// =============================================================================
// enforceConsistency - required value exclusions
// =============================================================================

await runTest('required values: should remove required values from pair exclusions (a !== b)', () => {
  const context = setupConstraintTest({ gridSize: [1, 3] });
  const key = binaryKey((a, b) => a !== b, 3);
  const handler = new BinaryConstraint(0, 1, key);

  const pairIndex01 = (0 << 8) | 1;
  const cellExclusions = {
    ...createCellExclusions(),
    getPairExclusions(pairIndex) {
      return pairIndex === pairIndex01 ? [2] : [];
    },
  };

  context.initializeHandler(handler, { cellExclusions });

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2);
  grid[2] = valueMask(1, 2, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2));
  assert.equal(grid[1], valueMask(1, 2));
  assert.equal(grid[2], valueMask(3), 'values required in (0,1) should be excluded from cell 2');
  assert.ok(acc.touched.has(2), 'exclusion cell should be marked touched');
});

await runTest('required values: should not run required-value exclusions for transitive key (a === b)', () => {
  const context = setupConstraintTest({ gridSize: [1, 3] });
  const key = binaryKey((a, b) => a === b, 3);
  const handler = new BinaryConstraint(0, 1, key);

  const pairIndex01 = (0 << 8) | 1;
  const cellExclusions = {
    ...createCellExclusions(),
    getPairExclusions(pairIndex) {
      return pairIndex === pairIndex01 ? [2] : [];
    },
  };

  context.initializeHandler(handler, { cellExclusions });

  const grid = context.grid;
  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(1, 2);
  grid[2] = valueMask(1, 2, 3);
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[2], valueMask(1, 2, 3), 'transitive keys should skip required-value exclusions');
  assert.equal(acc.touched.size, 0, 'no cells should be touched');
});

logSuiteComplete('BinaryConstraint handler');
