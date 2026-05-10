import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { False } = await import('../../js/solver/handlers.js');

await runTest('False: zero-cell handler initializes as contradiction', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new False();

  assert.equal(handler.cells.length, 0);
  assert.equal(context.initializeHandler(handler), false);
});

await runTest('False: zero-cell handler enforces as contradiction', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new False();
  const accumulator = createAccumulator();

  assert.equal(handler.enforceConsistency(context.grid, accumulator), false);
});

logSuiteComplete('false.test.js');
