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

const { ValueDependentUniqueValueExclusion } = await import('../../js/solver/handlers.js');

await runTest('ValueDependentExclusion should remove fixed value from mapped neighbors', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  // value-to-cell map: value 1→[], value 2→[1,2], value 3→[], value 4→[]
  const handler = new ValueDependentUniqueValueExclusion(0, [
    [],       // value 1
    [1, 2],   // value 2
    [],       // value 3
    [],       // value 4
  ]);

  const grid = context.grid;
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  context.initializeHandler(handler, { cellExclusions });

  grid[0] = valueMask(2); // fixed to value 2

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  assert.equal(grid[1] & valueMask(2), 0, 'cell 1 should not have value 2');
  assert.equal(grid[2] & valueMask(2), 0, 'cell 2 should not have value 2');
  assert.ok(grid[3] & valueMask(2), 'cell 3 should still have value 2');
});

await runTest('ValueDependentExclusion should fail when removal empties a neighbor', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new ValueDependentUniqueValueExclusion(0, [
    [],
    [1],   // value 2 → exclude cell 1
    [],
    [],
  ]);

  const grid = context.grid;
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  context.initializeHandler(handler, { cellExclusions });

  grid[0] = valueMask(2);
  grid[1] = valueMask(2); // only value 2, will become empty

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false);
});

await runTest('ValueDependentExclusion should strip regular exclusions from map during init', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  // value 1 maps to [1, 2], but cell 0 already has regular exclusion with cell 1
  const handler = new ValueDependentUniqueValueExclusion(0, [
    [1, 2],   // value 1
    [],
    [],
    [],
  ]);

  const grid = context.grid;
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: 4 });
  cellExclusions.addMutualExclusion(0, 1); // cell 0 already excludes cell 1

  context.initializeHandler(handler, { cellExclusions });

  grid[0] = valueMask(1);

  const acc = createAccumulator();
  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Cell 1 should still have value 1 — it was removed from the map during init.
  assert.ok(grid[1] & valueMask(1), 'cell 1 should have value 1 (stripped from exclusion map)');
  // Cell 2 should lose value 1.
  assert.equal(grid[2] & valueMask(1), 0, 'cell 2 should not have value 1');
});

logSuiteComplete('value_dependent_exclusion.test.js');
