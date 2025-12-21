export class FlameGraphStore {
  MAX_TOTAL_NODES = 1000;
  PRUNE_LEEWAY_RATIO = 0.1;

  constructor() {
    // Sample-ordered nodes per depth.
    // Node: {start,end,cellIndex,depth,segments:[{start,end,value}]}
    this._nodesByDepth = [];
    // Flat list of all nodes across all depths.
    this._allNodes = [];
    this._numSamples = 0;

    // Active nodes per depth (persists across gaps).
    this._activeNodesByDepth = [];
  }

  getNumSamples() {
    return this._numSamples;
  }

  // Returns the end time (ms) of the stored timeline.
  getEndTimeMs() {
    const rootRow = this._nodesByDepth[0];
    if (!rootRow?.length) return null;
    return rootRow[rootRow.length - 1].endTimeMs;
  }

  get nodesByDepth() {
    return this._nodesByDepth;
  }

  // Returns the stack entries at sample index `sampleIndex` for depths 0..maxDepthInclusive.
  // - Stops at the first depth that has no node/segment covering `sampleIndex`.
  // - Returns [] if `sampleIndex` is outside the recorded sample range.
  //
  // Each entry is: { node, segment }
  getStackSegmentsAtSample(sampleIndex, maxDepthInclusive) {
    if (sampleIndex < 0 || sampleIndex >= this._numSamples) return [];

    const stack = [];
    const nodesByDepth = this._nodesByDepth;
    const maxDepthAvail = Math.min(maxDepthInclusive + 1, nodesByDepth.length);

    for (let depth = 0; depth < maxDepthAvail; depth++) {
      const entry = this.getDepthEntryAtSample(depth, sampleIndex);
      if (!entry) break;
      stack.push(entry);
    }

    return stack;
  }

  // Returns { node, segment } at the given depth covering sample index `sampleIndex`.
  // Returns null if depth/sampleIndex is out of range or no entry covers `sampleIndex`.
  getDepthEntryAtSample(depth, sampleIndex) {
    if (sampleIndex < 0 || sampleIndex >= this._numSamples) return null;
    if (depth < 0) return null;

    const row = this._nodesByDepth[depth];
    if (!row || row.length === 0) return null;
    const node = this._findNodeAtSample(row, sampleIndex);
    if (!node) return null;
    const seg = this._findSegmentAtSample(node.segments, sampleIndex);
    if (!seg) return null;
    return { node, segment: seg };
  }

  clear() {
    this._nodesByDepth.length = 0;
    this._allNodes.length = 0;
    this._numSamples = 0;

    this._activeNodesByDepth.length = 0;
  }

  // If timeMs is provided, nodes/segments will also track:
  // - node.startTimeMs / node.endTimeMs
  // - segment.startTimeMs / segment.endTimeMs
  appendFromStackTrace(stackTrace, timeMs) {
    if (!stackTrace?.cells?.length) return false;

    // Flame graph samples are expected to have real time.
    // If time is missing/invalid, drop the sample.
    if (!Number.isFinite(timeMs)) return false;

    // Update end time of all active nodes.
    const activeNodes = this._activeNodesByDepth;
    for (let depth = 0; depth < activeNodes.length; depth++) {
      const node = activeNodes[depth];
      node.endTimeMs = timeMs;
      const segs = node.segments;
      const lastSeg = segs[segs.length - 1];
      lastSeg.endTimeMs = timeMs;
    }

    const cells = stackTrace.cells;
    const values = stackTrace.values;
    const len = Math.min(cells.length, values.length);
    if (!len) return false;

    // Append-only, sample-ordered nodes; each node contains sample-ordered segments.
    const sampleIndex = this._numSamples;
    for (let depth = 0; depth < len; depth++) {
      const cellIndex = cells[depth];
      const value = values[depth];

      let node = activeNodes[depth];

      // Only invalidate when we observe a mismatch; if this sample is shorter but matches
      // the prefix, deeper nodes remain active (persist across gaps).
      if (node?.cellIndex === cellIndex) {
        const segs = node.segments;
        const lastSeg = segs[segs.length - 1];
        if (lastSeg.value !== value) {
          // Same node; value change only invalidates deeper nodes.
          activeNodes.length = depth + 1;
        }
      } else {
        // Node identity mismatch invalidates this depth and deeper.
        activeNodes.length = depth;
        node = null;
      }

      if (!node) {
        let row = this._nodesByDepth[depth];
        if (!row) {
          row = [];
          this._nodesByDepth[depth] = row;
        }

        node = {
          start: sampleIndex,
          end: sampleIndex + 1,
          cellIndex,
          depth,
          segments: [],
          startTimeMs: timeMs,
          endTimeMs: timeMs,
        };
        row.push(node);
        this._allNodes.push(node);
        activeNodes[depth] = node;
      } else {
        node.end = sampleIndex + 1;
        node.endTimeMs = timeMs;
      }

      const segs = node.segments;
      const lastSeg = segs[segs.length - 1];
      if (lastSeg && lastSeg.end === sampleIndex && lastSeg.value === value) {
        lastSeg.end = sampleIndex + 1;
        lastSeg.endTimeMs = timeMs;
      } else {
        const seg = {
          start: sampleIndex,
          end: sampleIndex + 1,
          value,
          startTimeMs: timeMs,
          endTimeMs: timeMs,
        };
        segs.push(seg);
      }
    }
    this._numSamples = sampleIndex + 1;

    this._pruneStoredSegments();
    return true;
  }

  _pruneStoredSegments() {
    // Stored-data pruning (memory bound).
    // Invariant: never prune depth=0 so the x-axis always represents sampleIndex=0..now.
    // NOTE: depth=0 still counts towards the budget (memory), even though we never prune it.
    const highWater = Math.ceil(this.MAX_TOTAL_NODES * (1 + this.PRUNE_LEEWAY_RATIO));
    const lowWater = Math.max(0, Math.floor(this.MAX_TOTAL_NODES * (1 - this.PRUNE_LEEWAY_RATIO)));

    const totalNodeCount = this._allNodes.length;
    if (totalNodeCount <= highWater) return;

    const depth0NodeCount = this._nodesByDepth[0]?.length ?? 0;
    const minRemaining = Math.max(lowWater, depth0NodeCount);
    if (totalNodeCount <= minRemaining) return;

    // Prune whole nodes (depth > 0) until under the target.
    // Drop the smallest spans first; protect currently-active nodes.
    const activeNodes = new Set(this._activeNodesByDepth.filter(n => n));

    // Sort all nodes once, then walk the list collecting droppables.
    const nodes = this._allNodes;
    nodes.sort((a, b) => {
      const as = a.endTimeMs - a.startTimeMs;
      const bs = b.endTimeMs - b.startTimeMs;
      if (as !== bs) return as - bs; // smallest span first
      if (a.depth !== b.depth) return b.depth - a.depth; // deeper first
      return a.endTimeMs - b.endTimeMs; // tie-break: oldest first
    });

    let remaining = totalNodeCount;
    const droppedNodes = new Set();
    for (let i = 0; i < nodes.length && remaining > minRemaining; i++) {
      const node = nodes[i];
      if (node.depth === 0) continue;
      if (activeNodes.has(node)) continue;
      droppedNodes.add(node);
      remaining--;
    }
    if (!droppedNodes.size) return;

    this._allNodes = this._allNodes.filter(n => !droppedNodes.has(n));
    for (let depth = 1; depth < this._nodesByDepth.length; depth++) {
      const row = this._nodesByDepth[depth];
      this._nodesByDepth[depth] = row?.filter(n => !droppedNodes.has(n));
    }
  }

  _findNodeAtSample(row, sampleIndex) {
    // Row is sample-ordered, non-overlapping nodes.
    // Find node with node.start <= sampleIndex < node.end via binary search.
    let lo = 0;
    let hi = row.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const node = row[mid];
      if (sampleIndex < node.start) {
        hi = mid - 1;
      } else if (sampleIndex >= node.end) {
        lo = mid + 1;
      } else {
        return node;
      }
    }
    return null;
  }

  _findSegmentAtSample(segments, sampleIndex) {
    // Segments are sample-ordered, non-overlapping.
    // Nodes typically have very few segments, so a linear scan is fine.
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (sampleIndex < seg.start) return null;
      if (sampleIndex < seg.end) return seg;
    }
    return null;
  }
}
