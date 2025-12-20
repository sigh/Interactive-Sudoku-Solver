import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

import { FlameGraphStore } from '../js/flame_graph_store.js';

const st = (cells, values) => ({ cells, values });

await runTest('appendFromStackTrace returns false for empty input / stableLen', () => {
  const store = new FlameGraphStore();
  assert.equal(store.appendFromStackTrace(null, 1), false);
  assert.equal(store.appendFromStackTrace(st([], []), 1), false);
  assert.equal(store.appendFromStackTrace(st([0], [1]), 0), false);
  assert.equal(store.getNumSamples(), 0);
});

await runTest('appendFromStackTrace increments sample count and creates nodes/segments', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  assert.equal(store.appendFromStackTrace(st([3], [7]), 1), true);
  assert.equal(store.getNumSamples(), 1);
  assert.equal(store.nodesByDepth.length >= 1, true);
  assert.equal(store.nodesByDepth[0].length, 1);

  const node = store.nodesByDepth[0][0];
  assert.deepEqual({ start: node.start, end: node.end, cellIndex: node.cellIndex, depth: node.depth },
    { start: 0, end: 1, cellIndex: 3, depth: 0 });
  assert.equal(node.segments.length, 1);
  assert.deepEqual(node.segments[0], { start: 0, end: 1, value: 7 });
});

await runTest('segments coalesce when contiguous and value stays same', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  store.appendFromStackTrace(st([3], [7]), 1);
  store.appendFromStackTrace(st([3], [7]), 1);
  store.appendFromStackTrace(st([3], [7]), 1);

  const node = store.nodesByDepth[0][0];
  assert.equal(node.start, 0);
  assert.equal(node.end, 3);
  assert.equal(node.segments.length, 1);
  assert.deepEqual(node.segments[0], { start: 0, end: 3, value: 7 });
});

await runTest('same node, different value creates new segment (not new node)', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  store.appendFromStackTrace(st([3], [7]), 1);
  store.appendFromStackTrace(st([3], [8]), 1);

  assert.equal(store.nodesByDepth[0].length, 1);
  const node = store.nodesByDepth[0][0];
  assert.equal(node.segments.length, 2);
  assert.deepEqual(node.segments[0], { start: 0, end: 1, value: 7 });
  assert.deepEqual(node.segments[1], { start: 1, end: 2, value: 8 });
});

await runTest('signature change invalidates deeper active nodes (creates new node at depth 1)', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  store.appendFromStackTrace(st([0, 1], [1, 2]), 2);
  store.appendFromStackTrace(st([0, 1], [1, 2]), 2);

  assert.equal(store.nodesByDepth[1].length, 1);
  const firstDepth1 = store.nodesByDepth[1][0];
  assert.equal(firstDepth1.start, 0);
  assert.equal(firstDepth1.end, 2);

  // Change depth0 value; depth1 active node must be invalidated and replaced.
  store.appendFromStackTrace(st([0, 1], [9, 2]), 2);
  assert.equal(store.nodesByDepth[1].length, 2);
  const secondDepth1 = store.nodesByDepth[1][1];
  assert.notEqual(secondDepth1, firstDepth1);
  assert.equal(secondDepth1.start, 2);
  assert.equal(secondDepth1.end, 3);
});

await runTest('deeper active nodes persist across gaps (shorter sample)', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  // Establish depth 0 + depth 1.
  store.appendFromStackTrace(st([0, 1], [1, 2]), 2); // sampleIndex=0
  const node1 = store.nodesByDepth[1][0];
  assert.equal(node1.segments.length, 1);
  assert.deepEqual(node1.segments[0], { start: 0, end: 1, value: 2 });

  // Gap at depth 1: only depth 0 is present.
  store.appendFromStackTrace(st([0], [1]), 1); // sampleIndex=1

  // Depth 1 returns with the same cell+value; should extend the same node (not create a new one).
  store.appendFromStackTrace(st([0, 1], [1, 2]), 2); // sampleIndex=2
  assert.equal(store.nodesByDepth[1].length, 1);
  assert.equal(store.nodesByDepth[1][0], node1);

  // The gap should cause a new segment rather than merging contiguously.
  assert.equal(node1.segments.length, 2);
  assert.deepEqual(node1.segments[0], { start: 0, end: 1, value: 2 });
  assert.deepEqual(node1.segments[1], { start: 2, end: 3, value: 2 });
});

await runTest('pruning never removes depth 0 nodes and never drops active nodes', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 6;

  // Create multiple depth-0 nodes by alternating depth-0 cellIndex.
  // Also create a fresh depth-1 node each time so we can observe pruning.
  for (let i = 0; i < 20; i++) {
    const c0 = i % 3;      // 0,1,2 -> multiple root nodes
    const v0 = 1 + (i % 2);
    const c1 = 10 + i;     // unique each time => new depth-1 node
    const v1 = 3;
    store.appendFromStackTrace(st([c0, c1], [v0, v1]), 2);
  }

  const depth0Count = store.nodesByDepth[0].length;
  assert.ok(depth0Count >= 3);

  const row1 = store.nodesByDepth[1] || [];
  assert.ok(row1.length > 0);

  // Ensure we kept all depth-0 nodes.
  assert.equal(store.nodesByDepth[0].length, depth0Count);

  // Active depth-1 node should still exist after pruning.
  const activeDepth1Node = store._activeNodesByDepth[1];
  assert.ok(activeDepth1Node);
  assert.ok((store.nodesByDepth[1] || []).some(n => n === activeDepth1Node));

  // Pruning target is bounded by both the configured budget and by nodes we refuse to drop.
  // If depth-0 nodes already exceed the budget, we can never go below them.
  // Also, active non-root nodes are protected.
  const minRemaining = Math.max(store.MAX_TOTAL_NODES, depth0Count);
  const protectedNonRootCount = store._activeNodesByDepth.filter(n => n && n.depth > 0).length;
  const nonDroppableFloor = depth0Count + protectedNonRootCount;
  assert.ok(store._allNodes.length <= Math.max(minRemaining, nonDroppableFloor));
});

await runTest('getStackSegmentsAtSample returns [] when sampleIndex is out of range', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  assert.deepEqual(store.getStackSegmentsAtSample(0, 0), []);
  store.appendFromStackTrace(st([3], [7]), 1);
  assert.deepEqual(store.getStackSegmentsAtSample(-1, 0), []);
  assert.deepEqual(store.getStackSegmentsAtSample(1, 0), []);
});

await runTest('getStackSegmentsAtSample returns segments up to depth and stops on gaps', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  // sampleIndex=0: depth0+depth1
  store.appendFromStackTrace(st([0, 5], [1, 9]), 2);
  // sampleIndex=1: only depth0 (gap at depth1)
  store.appendFromStackTrace(st([0], [1]), 1);
  // sampleIndex=2: depth0+depth1 again
  store.appendFromStackTrace(st([0, 5], [1, 9]), 2);

  const at0 = store.getStackSegmentsAtSample(0, 1);
  assert.equal(at0.length, 2);
  assert.equal(at0[0].node.cellIndex, 0);
  assert.equal(at0[0].segment.value, 1);
  assert.equal(at0[1].node.cellIndex, 5);
  assert.equal(at0[1].segment.value, 9);

  const at1 = store.getStackSegmentsAtSample(1, 1);
  assert.equal(at1.length, 1);
  assert.equal(at1[0].node.cellIndex, 0);
  assert.equal(at1[0].segment.value, 1);

  const at2 = store.getStackSegmentsAtSample(2, 1);
  assert.equal(at2.length, 2);
  assert.equal(at2[0].node.cellIndex, 0);
  assert.equal(at2[0].segment.value, 1);
  assert.equal(at2[1].node.cellIndex, 5);
  assert.equal(at2[1].segment.value, 9);
});

await runTest('getStackSegmentsAtSample respects segment boundaries', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  store.appendFromStackTrace(st([3], [7]), 1); // sampleIndex=0
  store.appendFromStackTrace(st([3], [8]), 1); // sampleIndex=1

  const at0 = store.getStackSegmentsAtSample(0, 0);
  const at1 = store.getStackSegmentsAtSample(1, 0);
  assert.equal(at0.length, 1);
  assert.equal(at1.length, 1);
  assert.equal(at0[0].node.cellIndex, 3);
  assert.equal(at0[0].segment.value, 7);
  assert.equal(at1[0].node.cellIndex, 3);
  assert.equal(at1[0].segment.value, 8);
});

await runTest('getDepthEntryAtSample returns null for out-of-range depth/sampleIndex and gaps', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  assert.equal(store.getDepthEntryAtSample(0, 0), null);
  store.appendFromStackTrace(st([0, 5], [1, 9]), 2); // sampleIndex=0

  assert.equal(store.getDepthEntryAtSample(-1, 0), null);
  assert.equal(store.getDepthEntryAtSample(0, -1), null);
  assert.equal(store.getDepthEntryAtSample(0, 1), null);
  assert.equal(store.getDepthEntryAtSample(2, 0), null);

  // Create a gap at depth 1.
  store.appendFromStackTrace(st([0], [1]), 1); // sampleIndex=1
  assert.equal(store.getDepthEntryAtSample(1, 1), null);
});

await runTest('getDepthEntryAtSample returns the correct node+segment for (depth,sampleIndex)', () => {
  const store = new FlameGraphStore();
  store.PRUNE_LEEWAY_RATIO = 0;
  store.MAX_TOTAL_NODES = 10_000;

  store.appendFromStackTrace(st([3], [7]), 1); // sampleIndex=0
  store.appendFromStackTrace(st([3], [8]), 1); // sampleIndex=1

  const e0 = store.getDepthEntryAtSample(0, 0);
  const e1 = store.getDepthEntryAtSample(0, 1);
  assert.ok(e0);
  assert.ok(e1);
  assert.equal(e0.node.cellIndex, 3);
  assert.equal(e0.segment.value, 7);
  assert.equal(e1.node.cellIndex, 3);
  assert.equal(e1.segment.value, 8);
});

logSuiteComplete('FlameGraphStore');
