import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createCellExclusions } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { CellExclusions, HandlerSet } = await import('../../js/solver/engine.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../js/solver/handlers.js' + self.VERSION_PARAM);
const { BitSet } = await import('../../js/util.js' + self.VERSION_PARAM);

const context = new GridTestContext({ gridSize: 9 });
const SHAPE_9x9 = context.shape;

const createHandlerSet = (handlers = []) => {
  return new HandlerSet(handlers, SHAPE_9x9.numGridCells);
};

await runTest('CellExclusions should initialize empty', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  assert.equal(exclusions.isMutuallyExclusive(0, 1), false);
});

await runTest('CellExclusions should respect handler exclusions', () => {
  // Create a row handler for the first 9 cells.
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const handler = new HandlerModule.AllDifferent(cells);
  const handlerSet = createHandlerSet([handler]);
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  assert.equal(exclusions.isMutuallyExclusive(0, 1), true);
  assert.equal(exclusions.isMutuallyExclusive(0, 8), true);
  assert.equal(exclusions.isMutuallyExclusive(0, 9), false);
});

await runTest('CellExclusions should allow adding manual exclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  exclusions.addMutualExclusion(0, 1);
  assert.equal(exclusions.isMutuallyExclusive(0, 1), true);
  assert.equal(exclusions.isMutuallyExclusive(0, 2), false);
});

await runTest('CellExclusions should propagate exclusions for same values', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  exclusions.addMutualExclusion(0, 2);
  // If 0 and 1 are the same value, then 1 must also be exclusive with 2.
  exclusions.areSameValue(0, 1);

  assert.equal(exclusions.isMutuallyExclusive(1, 2), true);
});

await runTest('CellExclusions should return BitSet', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.addMutualExclusion(0, 1);
  exclusions.addMutualExclusion(0, 5);

  const bitSet = exclusions.getBitSet(0);
  assert.ok(bitSet instanceof BitSet);
  assert.equal(bitSet.has(1), true);
  assert.equal(bitSet.has(5), true);
  assert.equal(bitSet.has(2), false);
});

await runTest('HandlerUtil.findExclusionGroups should return groups/sumOfSquares', () => {
  const cellExclusions = createCellExclusions({ numCells: SHAPE_9x9.numGridCells });

  const cells = [0, 1, 2, 3];
  const result = HandlerModule.HandlerUtil.findExclusionGroups(
    cells, cellExclusions);

  // With all cells mutually exclusive, greedy should make one group.
  assert.deepEqual(result, {
    groups: [cells],
    sumOfSquares: 4 * 4,
  });
});

await runTest('HandlerUtil.findExclusionGroups should work for a single cell', () => {
  const cellExclusions = createCellExclusions({ numCells: SHAPE_9x9.numGridCells });

  const cells = [7];
  const result = HandlerModule.HandlerUtil.findExclusionGroups(
    cells, cellExclusions);

  assert.deepEqual(result, {
    groups: [cells],
    sumOfSquares: 1,
  });
});

await runTest('HandlerUtil.findExclusionGroupsGreedy(BEST) should return clique groups', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  // Build a small mutual-exclusion graph over cells [0..4].
  // Clique A: 0-1-2, Clique B: 2-3-4, with no edges between {0,1} and {3,4}.
  const addUndirected = (a, b) => {
    exclusions.addMutualExclusion(a, b);
    exclusions.addMutualExclusion(b, a);
  };
  addUndirected(0, 1);
  addUndirected(0, 2);
  addUndirected(1, 2);
  addUndirected(2, 3);
  addUndirected(2, 4);
  addUndirected(3, 4);

  const cells = [0, 1, 2, 3, 4];
  const result = HandlerModule.HandlerUtil.findExclusionGroupsGreedy(
    cells,
    exclusions,
    HandlerModule.HandlerUtil.GREEDY_STRATEGY_BEST);

  // Should partition the input cells exactly once.
  const flattened = result.groups.flat();
  flattened.sort((a, b) => a - b);
  assert.deepEqual(flattened, cells);

  // Each group should be a clique.
  for (const g of result.groups) {
    assert.equal(exclusions.areMutuallyExclusive(g), true);
  }

  // In this graph, an optimal partition is a 3-clique + 2-clique.
  // We don't assert ordering, but we can assert the score.
  assert.equal(result.sumOfSquares, 3 * 3 + 2 * 2);
});

await runTest('HandlerUtil.findExclusionGroupsGreedy should be deterministic for FIRST and BEST', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  const addUndirected = (a, b) => {
    exclusions.addMutualExclusion(a, b);
    exclusions.addMutualExclusion(b, a);
  };
  addUndirected(0, 1);
  addUndirected(0, 2);
  addUndirected(1, 2);
  addUndirected(2, 3);
  addUndirected(2, 4);
  addUndirected(3, 4);

  const cells = [4, 2, 1, 0, 3];
  for (const strategy of [
    HandlerModule.HandlerUtil.GREEDY_STRATEGY_FIRST,
    HandlerModule.HandlerUtil.GREEDY_STRATEGY_BEST,
  ]) {
    const r1 = HandlerModule.HandlerUtil.findExclusionGroupsGreedy(cells, exclusions, strategy);
    const r2 = HandlerModule.HandlerUtil.findExclusionGroupsGreedy(cells, exclusions, strategy);
    assert.deepEqual(r1, r2);
  }
});

await runTest('HandlerUtil.findExclusionGroupsGreedy should seal CellExclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  // Calling findExclusionGroupsGreedy uses getBitSet for performance, which
  // seals the exclusions cache.
  const cells = [0, 1, 2];
  HandlerModule.HandlerUtil.findExclusionGroupsGreedy(
    cells,
    exclusions,
    HandlerModule.HandlerUtil.GREEDY_STRATEGY_BEST);

  assert.throws(() => exclusions.addMutualExclusion(10, 11), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should seal after reading BitSet', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.getBitSet(0);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should compute pair exclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  // 0 is exclusive with 2
  exclusions.addMutualExclusion(0, 2);
  // 1 is exclusive with 2
  exclusions.addMutualExclusion(1, 2);
  // 0 is exclusive with 3
  exclusions.addMutualExclusion(0, 3);

  // Intersection of exclusions for 0 and 1 should contain 2.
  const pairExclusions = exclusions.getPairExclusions((0 << 16) | 1);
  assert.deepEqual(pairExclusions, [2]);
});

await runTest('CellExclusions should compute list exclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  exclusions.addMutualExclusion(0, 3);
  exclusions.addMutualExclusion(1, 3);
  exclusions.addMutualExclusion(2, 3);

  exclusions.addMutualExclusion(0, 4);

  const listExclusions = exclusions.getListExclusions([0, 1, 2]);
  assert.deepEqual(listExclusions, [3]);
});

await runTest('CellExclusions should seal after reading Array', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.getArray(0);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should seal after reading PairExclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.getPairExclusions((0 << 16) | 1);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should seal after reading ListExclusions', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.getListExclusions([0, 1]);

  assert.throws(() => exclusions.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should throw when calling areSameValue after sealing', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.getArray(0);

  assert.throws(() => exclusions.areSameValue(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should check areMutuallyExclusive correctly', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.addMutualExclusion(0, 1);
  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 2);

  assert.equal(exclusions.areMutuallyExclusive([0, 1, 2]), true);
  assert.equal(exclusions.areMutuallyExclusive([0, 1, 3]), false);
});

await runTest('CellExclusions should clone correctly and preserve sealed state', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.addMutualExclusion(0, 1);
  exclusions.getArray(0); // Seals it

  const clone = exclusions.clone();
  assert.equal(clone.isMutuallyExclusive(0, 1), true);
  assert.throws(() => clone.addMutualExclusion(1, 2), /Cannot add exclusions after caching/);
});

await runTest('CellExclusions should allow modifications on clone if not sealed', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.addMutualExclusion(0, 1);

  const clone = exclusions.clone();
  clone.addMutualExclusion(1, 2);

  assert.equal(clone.isMutuallyExclusive(1, 2), true);
  assert.equal(exclusions.isMutuallyExclusive(1, 2), false);
});

await runTest('CellExclusions should merge sets when calling areSameValue', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);

  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 3);

  // Merge 0 and 1.
  exclusions.areSameValue(0, 1);

  // 0 should now have 1's exclusions (3)
  assert.equal(exclusions.isMutuallyExclusive(0, 3), true);
  // 1 should now have 0's exclusions (2)
  assert.equal(exclusions.isMutuallyExclusive(1, 2), true);
});

await runTest('CellExclusions should return sorted array from getArray', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.addMutualExclusion(0, 5);
  exclusions.addMutualExclusion(0, 1);
  exclusions.addMutualExclusion(0, 3);

  const arr = exclusions.getArray(0);
  assert.deepEqual(arr, [1, 3, 5]);
});

await runTest('CellExclusions should handle empty BitSet', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  const bitSet = exclusions.getBitSet(0);
  assert.ok(bitSet.isEmpty());
});

await runTest('CellExclusions should cache pair exclusions regardless of order', () => {
  const handlerSet = createHandlerSet();
  const exclusions = new CellExclusions(handlerSet, SHAPE_9x9.numGridCells);
  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 2);

  const pair1 = exclusions.getPairExclusions((0 << 16) | 1);
  const pair2 = exclusions.getPairExclusions((1 << 16) | 0);

  assert.deepEqual(pair1, [2]);
  assert.deepEqual(pair2, [2]);
  // Note: The implementation might return different array instances if not explicitly caching both keys,
  // but the content should be the same. If it caches based on computed result, they might be same instance.
  // The current implementation caches `revKey` inside `_computePairExclusions` but `getPairExclusions`
  // stores the result under the requested key.
  // So `pair1` is stored under `(0<<16)|1`.
  // When requesting `(1<<16)|0`, `_computePairExclusions` checks `(0<<16)|1` and returns it.
  // So they should be the same instance if the first one was computed first.
  assert.equal(pair1, pair2);
});

// =============================================================================
// Pair-exclusion packing edge cases.
//
// A pair key packs two cell indices as `(a << 16) | b`, decoded with an UNSIGNED
// `>>> 16` / `& 0xffff`. These cover the boundaries: cells past the old 8-bit
// limit, cell 0 in the pair, an empty intersection, and — most importantly — a
// high cell >= 2^15, where `a << 16` makes the key a negative int32 and a SIGNED
// `>> 16` would decode the wrong cell0.
// =============================================================================

// Build a CellExclusions of the given size with the listed mutual-exclusion
// pairs, then return the shared exclusions of (a, b) in both orders.
const sharedExclusions = (size, mutualPairs, a, b) => {
  const exclusions = new CellExclusions(createHandlerSet(), size);
  for (const [c, d] of mutualPairs) exclusions.addMutualExclusion(c, d);
  return {
    forward: exclusions.getPairExclusions((a << 16) | b),
    reverse: exclusions.getPairExclusions((b << 16) | a),
  };
};

await runTest('pair exclusions: first var cell (just past the old 8-bit limit)', () => {
  // 256 = 0x100: its low byte is 0, which the old (a << 8) packing dropped.
  const { forward, reverse } = sharedExclusions(
    300, [[256, 258], [257, 258]], 256, 257);
  assert.deepEqual(forward, [258]);
  assert.deepEqual(reverse, [258]);
});

await runTest('pair exclusions: both cells > 255', () => {
  const { forward, reverse } = sharedExclusions(
    300, [[270, 280], [290, 280]], 270, 290);
  assert.deepEqual(forward, [280]);
  assert.deepEqual(reverse, [280]);
});

await runTest('pair exclusions: pair involving cell 0 and a high cell', () => {
  // (0 << 16) | b === b, so the packed key looks like a bare cell index; the
  // dispatch must still treat it as the pair (0, b).
  const { forward, reverse } = sharedExclusions(
    400, [[0, 150], [300, 150]], 0, 300);
  assert.deepEqual(forward, [150]);
  assert.deepEqual(reverse, [150]);
});

await runTest('pair exclusions: empty when the two cells share no exclusions', () => {
  const { forward, reverse } = sharedExclusions(
    300, [[270, 271], [290, 291]], 270, 290);
  assert.deepEqual(forward, []);
  assert.deepEqual(reverse, []);
});

await runTest('pair exclusions: high cell >= 2^15 (negative packed key)', () => {
  // 32768 = 2^15: (32768 << 16) is negative as an int32, so a signed `>> 16`
  // would decode cell0 wrong (and crash on the missing cell set). The design
  // envelope is cell index < 2^16, so this must still resolve correctly.
  const A = 32768;
  const B = 40000;
  const { forward, reverse } = sharedExclusions(
    50001, [[A, 33000], [B, 33000]], A, B);
  assert.deepEqual(forward, [33000]);
  assert.deepEqual(reverse, [33000]);
});

logSuiteComplete('CellExclusions');
