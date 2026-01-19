import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  setupConstraintTest,
  createAccumulator,
  valueMask,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { DutchFlatmateLine } = await import('../../js/solver/handlers.js');

// =============================================================================
// Basic pruning behavior
// =============================================================================

await runTest('DutchFlatmateLine should remove target from a cell with no valid flatmate', () => {
  // 9 values => target is 5, above=1, below=9
  const context = setupConstraintTest({ gridSize: [1, 3], numValues: 9 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  // Middle cell can be 5, but neighbors can be neither 1 nor 9.
  grid[0] = valueMask(2, 3, 4);
  grid[1] = valueMask(5, 6);
  grid[2] = valueMask(2, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1] & valueMask(5), 0, 'target value should be removed');
  assert.equal(grid[1], valueMask(6), 'other values should remain');
});

await runTest('DutchFlatmateLine should fail if removing target wipes out a cell', () => {
  const context = setupConstraintTest({ gridSize: [1, 3], numValues: 9 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  grid[0] = valueMask(2, 3, 4);
  grid[1] = valueMask(5); // only target
  grid[2] = valueMask(2, 3, 4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when the target has no valid flatmate');
});

// =============================================================================
// Forced flatmate behavior when target is fixed
// =============================================================================

await runTest('DutchFlatmateLine should force above flatmate when target is fixed and only above is possible', () => {
  const context = setupConstraintTest({ gridSize: [1, 3], numValues: 9 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  grid[0] = valueMask(1, 2); // can be above
  grid[1] = valueMask(5); // fixed to target
  grid[2] = valueMask(2, 3, 4); // cannot be below=9

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1), 'left neighbor should be forced to above (1)');
});

await runTest('DutchFlatmateLine should force below flatmate when target is fixed and only below is possible', () => {
  const context = setupConstraintTest({ gridSize: [1, 3], numValues: 9 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  grid[0] = valueMask(2, 3, 4); // cannot be above=1
  grid[1] = valueMask(5); // fixed to target
  grid[2] = valueMask(8, 9); // can be below

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[2], valueMask(9), 'right neighbor should be forced to below (9)');
});

// =============================================================================
// Edge cells
// =============================================================================

await runTest('DutchFlatmateLine should prune target at an edge if the only neighbor cannot be a flatmate', () => {
  const context = setupConstraintTest({ gridSize: [1, 2], numValues: 9 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  grid[0] = valueMask(5, 6);
  grid[1] = valueMask(2, 3, 4); // cannot be 1 or 9

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(6), 'target should be removed from the edge cell');
});

// =============================================================================
// Rectangular / irregular grid compatibility
// =============================================================================

await runTest('DutchFlatmateLine should work on short lines where the below value cannot exist in the line', () => {
  // 6-cell line with 8 values per cell (e.g. columns in a 6x8 grid).
  // Below value is 8, but we exclude it everywhere in the line.
  const context = setupConstraintTest({ gridSize: [1, 6], numValues: 8 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  // Remove 8 everywhere.
  for (let i = 0; i < 6; i++) grid[i] &= ~valueMask(8);

  // Fix target (ceil(8/2) = 4) at index 2.
  grid[2] = valueMask(4);

  // Only valid flatmate is above (1) on the left.
  grid[1] = valueMask(1, 2);
  grid[3] = valueMask(2, 3, 5, 6, 7); // cannot be 1; 8 already removed

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1], valueMask(1), 'should force the available flatmate (1)');
  for (let i = 0; i < 6; i++) {
    assert.equal(grid[i] & valueMask(8), 0, 'below value should remain impossible');
  }
});

await runTest('DutchFlatmateLine should fail when neither flatmate value can exist in the line', () => {
  const context = setupConstraintTest({ gridSize: [1, 3], numValues: 8 });
  const cells = context.cells();
  const handler = new DutchFlatmateLine(cells);

  const grid = context.grid;
  assert.equal(context.initializeHandler(handler), true);

  // Remove both flatmate values (above=1 and below=8) everywhere.
  for (let i = 0; i < 3; i++) grid[i] &= ~(valueMask(1) | valueMask(8));

  // Target is 4 and is forced in the middle.
  grid[1] = valueMask(4);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'target cannot be placed without any possible flatmate');
});

logSuiteComplete('dutch_flatmates.test.js');
