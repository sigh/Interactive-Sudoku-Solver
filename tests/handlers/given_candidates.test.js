import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { GivenCandidates } = await import('../../js/solver/handlers.js');
const { GridShape } = await import('../../js/grid_shape.js' + self.VERSION_PARAM);

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

await runTest('applyValues should restrict cells identically to initialize', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new GivenCandidates(new Map([
    [0, [3, 7]],
    [1, 5],
  ]));

  const grid = context.grid;
  handler.applyValues(grid, context.shape.valueOffset);

  assert.equal(grid[0], valueMask(3, 7));
  assert.equal(grid[1], valueMask(5));
  // Untouched cell retains all values.
  assert.equal(grid[2], context.lookupTables.allValues);
});

await runTest('applyValues should AND with existing values', () => {
  const context = new GridTestContext({ gridSize: 9 });
  const handler = new GivenCandidates(new Map([
    [0, [1, 2, 3]],
  ]));

  const grid = context.grid;
  grid[0] = valueMask(2, 3, 4);
  handler.applyValues(grid, context.shape.valueOffset);

  assert.equal(grid[0], valueMask(2, 3));
});

await runTest('applyValues with non-zero valueOffset', () => {
  // 9x9 grid with valueOffset=-1 (values 0-8).
  const offsetShape = GridShape.fromGridSpec('9x9~0-8');
  const grid = new Array(offsetShape.numGridCells).fill(
    (1 << offsetShape.numValues) - 1);

  const handler = new GivenCandidates(new Map([
    [0, [0, 1]],
  ]));
  handler.applyValues(grid, offsetShape.valueOffset);

  // Values 0 and 1 with offset -1 map to bits 0 and 1.
  const expected = (1 << (0 - offsetShape.valueOffset - 1))
                 | (1 << (1 - offsetShape.valueOffset - 1));
  assert.equal(grid[0], expected);
});

logSuiteComplete('given_candidates.test.js');
