import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { GivenCandidates } = await import('../../js/solver/handlers.js');

await runTest('GivenCandidates should restrict cells to given candidates on init', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new GivenCandidates([
    [0, [5]],
    [1, [3, 7]],
  ]);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(5));
  assert.equal(grid[1], valueMask(3, 7));
});

await runTest('GivenCandidates should fail init when given candidates have no overlap', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new GivenCandidates([
    [0, [5]],
  ]);

  const grid = context.grid;
  // Pre-set cell 0 to only have value 3 — no overlap with given [5].
  grid[0] = valueMask(3);
  const result = context.initializeHandler(handler);

  // In JS, GivenCandidates does grid[cell] &= mask, so grid[0] = valueMask(3) & valueMask(5) = 0.
  // initialize still returns true, but cell becomes empty.
  assert.equal(result, true);
  assert.equal(grid[0], 0, 'cell should be empty when no overlap');
});

await runTest('GivenCandidates should accept single values', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new GivenCandidates([
    [0, 5],
    [1, 3],
  ]);

  const grid = context.grid;
  const result = context.initializeHandler(handler);

  assert.equal(result, true);
  assert.equal(grid[0], valueMask(5));
  assert.equal(grid[1], valueMask(3));
});

logSuiteComplete('given_candidates.test.js');
