import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { CellExclusions, HandlerSet } = await import('../../js/solver/engine.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../js/solver/handlers.js' + self.VERSION_PARAM);
const { BitSet } = await import('../../js/util.js' + self.VERSION_PARAM);

const SHAPE_9x9 = {
  numCells: 81,
  numValues: 9,
  gridSize: 9,
  boxWidth: 3,
  boxHeight: 3,
};

const createHandlerSet = (handlers = []) => {
  return new HandlerSet(handlers, SHAPE_9x9);
};

await runTest('CellExclusions should initialize empty', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  assert.equal(exclusions.isMutuallyExclusive(0, 1), false);
});

await runTest('CellExclusions should respect handler exclusions', () => {
  // Create a row handler for the first 9 cells.
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const handler = new HandlerModule.AllDifferent(cells);
  const handlerSet = createHandlerSet([handler]);
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  assert.equal(exclusions.isMutuallyExclusive(0, 1), true);
  assert.equal(exclusions.isMutuallyExclusive(0, 8), true);
  assert.equal(exclusions.isMutuallyExclusive(0, 9), false);
});

await runTest('CellExclusions should allow adding manual exclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  exclusions.addMutualExclusion(0, 1);
  assert.equal(exclusions.isMutuallyExclusive(0, 1), true);
  assert.equal(exclusions.isMutuallyExclusive(0, 2), false);
});

await runTest('CellExclusions should propagate exclusions for same values', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  exclusions.addMutualExclusion(0, 2);
  // If 0 and 1 are the same value, then 1 must also be exclusive with 2.
  exclusions.areSameValue(0, 1);

  assert.equal(exclusions.isMutuallyExclusive(1, 2), true);
});

await runTest('CellExclusions should return BitSet', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.addMutualExclusion(0, 1);
  exclusions.addMutualExclusion(0, 5);

  const bitSet = exclusions.getBitSet(0);
  assert.ok(bitSet instanceof BitSet);
  assert.equal(bitSet.has(1), true);
  assert.equal(bitSet.has(5), true);
  assert.equal(bitSet.has(2), false);
});

await runTest('CellExclusions should seal after reading BitSet', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.getBitSet(0);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should compute pair exclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  // 0 is exclusive with 2
  exclusions.addMutualExclusion(0, 2);
  // 1 is exclusive with 2
  exclusions.addMutualExclusion(1, 2);
  // 0 is exclusive with 3
  exclusions.addMutualExclusion(0, 3);

  // Intersection of exclusions for 0 and 1 should contain 2.
  const pairExclusions = exclusions.getPairExclusions((0 << 8) | 1);
  assert.deepEqual(pairExclusions, [2]);
});

await runTest('CellExclusions should compute list exclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  exclusions.addMutualExclusion(0, 3);
  exclusions.addMutualExclusion(1, 3);
  exclusions.addMutualExclusion(2, 3);

  exclusions.addMutualExclusion(0, 4);

  const listExclusions = exclusions.getListExclusions([0, 1, 2]);
  assert.deepEqual(listExclusions, [3]);
});

await runTest('CellExclusions should seal after reading Array', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.getArray(0);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should seal after reading PairExclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.getPairExclusions((0 << 8) | 1);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should seal after reading ListExclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.getListExclusions([0, 1]);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should throw when calling areSameValue after sealing', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.getArray(0);

  assert.throws(() => exclusions.areSameValue(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should check areMutuallyExclusive correctly', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.addMutualExclusion(0, 1);
  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 2);

  assert.equal(exclusions.areMutuallyExclusive([0, 1, 2]), true);
  assert.equal(exclusions.areMutuallyExclusive([0, 1, 3]), false);
});

await runTest('CellExclusions should clone correctly and preserve sealed state', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.addMutualExclusion(0, 1);
  exclusions.getArray(0); // Seals it

  const clone = exclusions.clone();
  assert.equal(clone.isMutuallyExclusive(0, 1), true);
  assert.throws(() => clone.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should allow modifications on clone if not sealed', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.addMutualExclusion(0, 1);

  const clone = exclusions.clone();
  clone.addMutualExclusion(1, 2);

  assert.equal(clone.isMutuallyExclusive(1, 2), true);
  assert.equal(exclusions.isMutuallyExclusive(1, 2), false);
});

await runTest('CellExclusions should merge sets when calling areSameValue', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);

  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 3);

  // Merge 0 and 1.
  exclusions.areSameValue(0, 1);

  // 0 should now have 1's exclusions (3)
  assert.equal(exclusions.isMutuallyExclusive(0, 3), true);
  // 1 should now have 0's exclusions (2)
  assert.equal(exclusions.isMutuallyExclusive(1, 2), true);

  // Adding to one should affect the other.
  exclusions.addMutualExclusion(0, 4);
  assert.equal(exclusions.isMutuallyExclusive(1, 4), true);
});

await runTest('CellExclusions should return sorted array from getArray', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.addMutualExclusion(0, 5);
  exclusions.addMutualExclusion(0, 1);
  exclusions.addMutualExclusion(0, 3);

  const arr = exclusions.getArray(0);
  assert.deepEqual(arr, [1, 3, 5]);
});

await runTest('CellExclusions should handle empty BitSet', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  const bitSet = exclusions.getBitSet(0);
  assert.ok(bitSet.isEmpty());
});

await runTest('CellExclusions should cache pair exclusions regardless of order', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9);
  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 2);

  const pair1 = exclusions.getPairExclusions((0 << 8) | 1);
  const pair2 = exclusions.getPairExclusions((1 << 8) | 0);

  assert.deepEqual(pair1, [2]);
  assert.deepEqual(pair2, [2]);
  // Note: The implementation might return different array instances if not explicitly caching both keys,
  // but the content should be the same. If it caches based on computed result, they might be same instance.
  // The current implementation caches `revKey` inside `_computePairExclusions` but `getPairExclusions`
  // stores the result under the requested key.
  // So `pair1` is stored under `(0<<8)|1`.
  // When requesting `(1<<8)|0`, `_computePairExclusions` checks `(0<<8)|1` and returns it.
  // So they should be the same instance if the first one was computed first.
  assert.equal(pair1, pair2);
});

logSuiteComplete('CellExclusions');
