import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  createCellExclusions,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { UniqueValueExclusion } = await import('../../js/solver/handlers.js');

await runTest('UniqueValueExclusion should remove fixed value from exclusion neighbors', () => {
  const context = new GridTestContext({ gridSize: 9 });
  // Create exclusions: cell 0 excludes cells 1, 2, 3.
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 81 });
  cellExclusions.addMutualExclusion(0, 1);
  cellExclusions.addMutualExclusion(0, 2);
  cellExclusions.addMutualExclusion(0, 3);

  const handler = new UniqueValueExclusion(0);
  const grid = context.grid;
  context.initializeHandler(handler, { cellExclusions });

  grid[0] = valueMask(5);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1] & valueMask(5), 0, 'cell 1 should not contain 5');
  assert.equal(grid[2] & valueMask(5), 0, 'cell 2 should not contain 5');
  assert.equal(grid[3] & valueMask(5), 0, 'cell 3 should not contain 5');
  // Cell 4 should be unchanged.
  assert.equal(grid[4], valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9));
});

await runTest('UniqueValueExclusion should not prune when cell is not fixed', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 81 });
  cellExclusions.addMutualExclusion(0, 1);
  cellExclusions.addMutualExclusion(0, 2);

  const handler = new UniqueValueExclusion(0);
  const grid = context.grid;
  context.initializeHandler(handler, { cellExclusions });

  // Cell 0 has multiple candidates — not fixed.
  grid[0] = valueMask(3, 5);
  const allValues = valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  // UniqueValueExclusion removes ALL bits of grid[cell] from neighbors,
  // even when cell is not a singleton. So neighbors lose values 3 and 5.
  assert.equal(result, true);
  assert.equal(grid[1] & valueMask(3, 5), 0, 'cell 1 should have 3,5 removed');
  assert.equal(grid[2] & valueMask(3, 5), 0, 'cell 2 should have 3,5 removed');
});

await runTest('UniqueValueExclusion should fail when removal empties a neighbor', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 81 });
  cellExclusions.addMutualExclusion(0, 1);

  const handler = new UniqueValueExclusion(0);
  const grid = context.grid;
  context.initializeHandler(handler, { cellExclusions });

  grid[0] = valueMask(5);
  grid[1] = valueMask(5); // Only has 5, will become empty.

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail when removal empties a cell');
});

logSuiteComplete('unique_value_exclusion.test.js');
