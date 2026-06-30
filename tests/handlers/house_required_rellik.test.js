import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createAccumulator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { Rellik, HouseRequiredRellik } = await import('../../js/solver/handlers.js');

// The companion delegates to a real Rellik handler over the cage cells. Each
// house is given as (outside cells, the value mask the house must hold).
const ALL9 = valueMask(1, 2, 3, 4, 5, 6, 7, 8, 9);
const makeHandler = (context, cageCells, sum, houseOutsides, houseMasks) => {
  const rellik = new Rellik(cageCells, sum);
  context.initializeHandler(rellik);
  const handler = new HouseRequiredRellik(rellik, houseOutsides, houseMasks);
  context.initializeHandler(handler);
  return handler;
};

// A house is the 9-cell row [0..8] (holding all values); the cage is [0,1,2]
// inside it, so the outside cells are [3..8].
const CAGE = [0, 1, 2];
const OUTSIDE = [3, 4, 5, 6, 7, 8];

// Eliminate `value` from every outside cell so the house must place it in the
// cage.
const forceValueViaHouse = (grid, value) => {
  const mask = valueMask(value);
  for (const c of OUTSIDE) grid[c] &= ~mask;
};

await runTest('HouseRequiredRellik removes a value forced by an overlapping house', () => {
  const context = new GridTestContext({ gridSize: [2, 9], numValues: 9 });
  // Rellik (forbidden sum) cage [0,1,2] with target 6.
  const handler = makeHandler(context, CAGE, 6, [OUTSIDE], [ALL9]);

  const grid = context.grid;
  forceValueViaHouse(grid, 1); // 1 now required inside the cage.
  grid[2] = valueMask(5, 9);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // 1 is forced present; 1+5 = 6 is forbidden, so 5 must be removed from cell 2.
  assert.equal(grid[2], valueMask(9), 'value 5 should be removed from cell 2');
});

await runTest('HouseRequiredRellik fails when a required value cannot be placed', () => {
  const context = new GridTestContext({ gridSize: [2, 9], numValues: 9 });
  const handler = makeHandler(context, CAGE, 6, [OUTSIDE], [ALL9]);

  const grid = context.grid;
  // House forces value 9 into the cage, but no cage cell can hold it.
  forceValueViaHouse(grid, 9);
  for (const c of CAGE) grid[c] = valueMask(1, 2, 3);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('HouseRequiredRellik handles a cage extending beyond the house', () => {
  // The cage may have cells outside the house we hand the handler. Cage =
  // {0,1} (in the row-0 house) + {9,10} (row 1); only row 0 is given as the
  // overlapping house, with outside [2..8].
  const context = new GridTestContext({ gridSize: [2, 9], numValues: 9 });
  const cage = [0, 1, 9, 10];
  const handler = makeHandler(context, cage, 6, [OUTSIDE], [ALL9]);

  const grid = context.grid;
  forceValueViaHouse(grid, 1); // row 0 forces value 1 into cells 0/1.
  grid[10] = valueMask(5, 9);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
  // 1 is present in the cage; 1+5 = 6 is forbidden, so 5 must be removed from
  // the free cell 10 — even though it lives in a different house.
  assert.equal(grid[10], valueMask(9), 'value 5 should be removed from cell 10');
});

await runTest('HouseRequiredRellik fast-bails when nothing is required', () => {
  const context = new GridTestContext({ gridSize: [2, 9], numValues: 9 });
  const handler = makeHandler(context, CAGE, 6, [OUTSIDE], [ALL9]);

  const grid = context.grid;
  grid[2] = valueMask(5, 9);
  const before = CAGE.map(c => grid[c]);

  const acc = createAccumulator();
  // Outside cells still hold every value → houseRequired is empty, so the
  // forbidden-sum deduction does not run and cell 2 keeps its 5.
  assert.equal(handler.enforceConsistency(grid, acc), true);
  CAGE.forEach((c, i) => assert.equal(grid[c], before[i],
    `cage cell ${c} should be unchanged on fast bail`));
});

logSuiteComplete('house_required_rellik.test.js');
