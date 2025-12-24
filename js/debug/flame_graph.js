const {
  deferUntilAnimationFrame,
  createSvgElement,
  clearDOMNode,
  formatTimeMs,
  formatFixedTruncated,
  memoize,
} = await import('../util.js' + self.VERSION_PARAM);

export const getColorForValue = memoize((value, numValues) => {
  const idx = ((value - 1) % numValues + numValues) % numValues;
  const hue = (idx / numValues) * 360;
  const lightness = idx % 2 ? 90 : 95;
  return `hsl(${hue}, 70%, ${lightness}%)`;
});

const formatTick = (ms) => {
  if (ms === 0) return '0 s';
  if (ms < 1e3) return `${ms} ms`;
  return `${formatFixedTruncated(ms / 1e3, 3)} s`;
};
export class DebugFlameGraphView {
  constructor(stackTraceElem, { highlighter, infoOverlay }) {
    // Dependencies.
    this._shape = null;
    this._highlighter = highlighter;
    this._infoOverlay = infoOverlay;

    // Lifecycle.
    this._enabled = false;
    this._collapsed = false;

    // Data.
    this._store = new FlameGraphStore();

    // Render scheduling.
    // Centralize gating here so callers can always just call `_render()`.
    const renderDeferred = deferUntilAnimationFrame(this._renderImpl.bind(this));
    this._render = () => {
      if (!this._enabled || this._collapsed) return;
      renderDeferred();
    };

    this._hover = {
      depth: null,
      sampleIndex: null,

      nodeOutline: null,
      segRect: null,
    };


    const flameContainer = document.createElement('div');
    flameContainer.className = 'debug-flame-graph';
    flameContainer.hidden = true;

    const tooltip = document.createElement('div');
    tooltip.className = 'debug-flame-tooltip';
    tooltip.hidden = true;
    // Prevent the tooltip from breaking hover hit-testing.
    tooltip.style.pointerEvents = 'none';
    flameContainer.appendChild(tooltip);
    this._tooltip = tooltip;

    const header = stackTraceElem.closest('.debug-stack-trace-header');
    header.insertAdjacentElement('afterend', flameContainer);
    this._container = flameContainer;

    // Allocate the SVG.
    {
      const svg = createSvgElement('svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');

      this._container.appendChild(svg);
      this._svg = svg;
    }

    // Hover uses event delegation on the SVG rather than document.elementFromPoint().
    this._svg.addEventListener('pointermove', (e) => this._syncHoverFromEvent(e), { passive: true });
    this._svg.addEventListener('pointerleave', () => this._clearHover(), { passive: true });

    this._syncVisibility();

    // Re-render on resize even if data didn't change.
    this._resizeObserver = new ResizeObserver(() => this._render());
    this._resizeObserver.observe(this._container);
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    this._syncVisibility();
    if (!this._enabled) {
      this._clearHover();
      return;
    }

    this._render();
  }

  setCollapsed(collapsed) {
    this._collapsed = !!collapsed;
    this._syncVisibility();
    if (this._collapsed) {
      this._clearHover();
      return;
    }
    this._render();
  }

  reshape(shape) {
    this._shape = shape;

    this._render();
  }

  clear() {
    this._store.clear();
    this._clearHover();

    clearDOMNode(this._svg);

    this._render();
  }

  update(stackTrace, timeMs) {
    if (this._store.appendFromStackTrace(stackTrace, timeMs)) {
      this._render();
    }
  }

  _syncVisibility() {
    this._container.hidden = !this._enabled || this._collapsed;
  }

  _renderImpl() {
    const svgRect = this._svg.getBoundingClientRect();
    const width = svgRect.width;
    const height = svgRect.height;
    if (!width || !height) return;

    const numSamples = this._store.getNumSamples();
    if (!numSamples) return;
    if (!this._shape) return;

    const AXIS_HEIGHT = 14;
    const ROW_HEIGHT = 16;
    const maxDepth = Math.max(1, Math.ceil((height - AXIS_HEIGHT) / ROW_HEIGHT));
    const MIN_LABEL_WIDTH = 34;
    const MIN_DISPLAY_NODE_SAMPLES = 2;

    const nodesByDepth = this._store.nodesByDepth;
    const endTimeMs = this._store.getEndTimeMs();
    if (!endTimeMs) return;
    const scale = width / endTimeMs;

    clearDOMNode(this._svg);

    // Render into two groups so overlays always sit on top.
    const axisLayer = createSvgElement('g');
    const segLayer = createSvgElement('g');
    const overlayLayer = createSvgElement('g');
    this._svg.append(axisLayer);
    this._svg.append(segLayer);
    this._svg.append(overlayLayer);

    // Time axis labels at the top (no tick marks).
    {
      const approxLabelCount = 10;
      const rawStep = endTimeMs / approxLabelCount;
      const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const f = rawStep / pow10;
      const niceF = (f <= 1) ? 1 : (f <= 2) ? 2 : (f <= 5) ? 5 : 10;
      const step = niceF * pow10;

      for (let t = 0; t <= endTimeMs; t += step) {
        const x = t * scale;

        const label = createSvgElement('text');
        label.classList.add('debug-flame-label');
        label.style.pointerEvents = 'none';
        label.setAttribute('x', x);
        label.setAttribute('y', AXIS_HEIGHT - 2);
        label.setAttribute('text-anchor', 'start');
        label.textContent = formatTick(t);
        axisLayer.appendChild(label);
      }
    }

    const maxDepthAvail = Math.min(maxDepth, nodesByDepth.length);

    for (let depth = 0; depth < maxDepthAvail; depth++) {
      const row = nodesByDepth[depth];
      if (!row?.length) continue;

      const y = AXIS_HEIGHT + depth * ROW_HEIGHT;
      const h = ROW_HEIGHT - 1;

      for (let i = 0; i < row.length; i++) {
        const node = row[i];

        // Always show root nodes even if small, otherwise skip small nodes.
        if (depth > 0 && node.end - node.start < MIN_DISPLAY_NODE_SAMPLES) continue;

        const nodeX0 = node.startTimeMs * scale;
        const nodeX1 = node.endTimeMs * scale;
        const nodeW = nodeX1 - nodeX0;
        if (nodeW <= 0) continue;

        const outline = createSvgElement('path');
        outline.classList.add('debug-flame-node-outline');
        // Overlays should not intercept hover hit-testing.
        outline.style.pointerEvents = 'none';
        outline.setAttribute('d', `M ${nodeX0} ${y} V ${y + h} H ${nodeX0 + nodeW} V ${y} H ${nodeX0} Z`);
        outline.setAttribute('stroke-dasharray', `${h} 100000`);
        outline.dataset.flameDepth = node.depth;
        outline.dataset.flameSampleIndex = node.start;
        overlayLayer.appendChild(outline);

        if (nodeW >= MIN_LABEL_WIDTH) {
          const cellId = this._shape.makeCellIdFromIndex(node.cellIndex);
          const text = createSvgElement('text');
          text.classList.add('debug-flame-label');
          text.style.pointerEvents = 'none';
          text.setAttribute('x', nodeX0 + 2);
          text.setAttribute('y', y + h - 3);
          text.textContent = cellId;
          overlayLayer.appendChild(text);
        }

        const segs = node.segments;
        for (let j = 0; j < segs.length; j++) {
          const seg = segs[j];
          const x0 = seg.startTimeMs * scale;
          const x1 = seg.endTimeMs * scale;
          const w = x1 - x0;
          if (w <= 0) continue;

          const color = getColorForValue(seg.value, this._shape.numValues);

          const rect = createSvgElement('rect');
          rect.classList.add('debug-flame-rect');
          rect.setAttribute('x', x0);
          rect.setAttribute('y', y);
          rect.setAttribute('width', w);
          rect.setAttribute('height', h);
          rect.setAttribute('fill', color);
          rect.setAttribute('stroke', color);
          rect.dataset.flameDepth = depth;
          rect.dataset.flameSampleIndex = seg.start;
          segLayer.appendChild(rect);
        }
      }
    }

    // Hover/tooltip only update on mousemove/mouseleave.
    // But re-apply hover styling after re-render so it doesn't disappear.
    if (this._hover.sampleIndex !== null) {
      this._reapplyHoverStylesAfterRender();
    }
  }

  _syncHoverFromEvent(e) {
    if (!this._enabled) return;

    const rect = e.target.closest('rect.debug-flame-rect');
    if (!rect) {
      this._clearHover();
      return;
    }

    const depth = parseInt(rect.dataset.flameDepth, 10);
    const sampleIndex = parseInt(rect.dataset.flameSampleIndex, 10);
    const entry = this._store.getDepthEntryAtSample(depth, sampleIndex);
    if (!entry) {
      this._clearHover();
      return;
    }

    this._setHover(depth, sampleIndex, rect, { clientX: e.clientX, clientY: e.clientY });
  }

  _setHover(depth, sampleIndex, rectEl, pointer) {
    const hover = this._hover;
    if (sampleIndex !== hover?.sampleIndex || depth !== hover?.depth) {
      hover.depth = depth;
      hover.sampleIndex = sampleIndex;
      this._syncHover();
      this._applyHoverStyles(rectEl);
    }

    this._updateTooltip(pointer);
  }

  _updateTooltip(pointer) {
    if (!this._shape) return;

    const tooltip = this._tooltip;

    const hover = this._hover;
    if (hover.sampleIndex === null) return;
    const entry = this._store.getDepthEntryAtSample(hover.depth, hover.sampleIndex);
    if (!entry) return;

    const cellId = this._shape.makeCellIdFromIndex(entry.node.cellIndex);
    const startTimeMs = entry.segment.startTimeMs;
    const endTimeMs = entry.segment.endTimeMs;
    const durationMs = (Number.isFinite(startTimeMs) && Number.isFinite(endTimeMs))
      ? Math.max(0, endTimeMs - startTimeMs)
      : null;
    const durationText = (durationMs === null) ? '?' : formatTimeMs(durationMs);
    tooltip.textContent = `${cellId}=${entry.segment.value} | ${durationText}`;
    tooltip.hidden = false;

    const container = this._container;
    const containerRect = container.getBoundingClientRect();
    const OFFSET_PX = 10;
    const EDGE_PADDING_PX = 2;

    const desiredLeft = (pointer.clientX - containerRect.left) + OFFSET_PX;
    const desiredTop = (pointer.clientY - containerRect.top) + OFFSET_PX;

    const maxLeft = container.clientWidth - tooltip.offsetWidth - EDGE_PADDING_PX;
    const maxTop = container.clientHeight - tooltip.offsetHeight - EDGE_PADDING_PX;

    const left = Math.min(
      Math.max(desiredLeft, EDGE_PADDING_PX),
      Math.max(EDGE_PADDING_PX, maxLeft),
    );
    const top = Math.min(
      Math.max(desiredTop, EDGE_PADDING_PX),
      Math.max(EDGE_PADDING_PX, maxTop),
    );

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  _clearHover() {
    const hover = this._hover;
    if (hover.sampleIndex === null) return;
    hover.depth = null;
    hover.sampleIndex = null;

    this._clearHoverStyles();
    this._highlighter.clear();
    this._infoOverlay.setValues();
    this._tooltip.hidden = true;
  }

  _syncHover() {
    const hover = this._hover;
    if (!this._shape || hover.sampleIndex === null) return;
    const entry = this._store.getDepthEntryAtSample(hover.depth, hover.sampleIndex);
    if (!entry) return;

    const cellId = this._shape.makeCellIdFromIndex(entry.node.cellIndex);
    this._highlighter.setCells([cellId]);

    // Show values up to (and including) the hovered depth at the hovered time.
    const hoverDepth = hover.depth;
    const hoverSampleIndex = hover.sampleIndex;

    const stackSegs = this._store.getStackSegmentsAtSample(hoverSampleIndex, hoverDepth);
    const gridValues = new Array(this._shape.numCells);
    for (let i = 0; i < stackSegs.length; i++) {
      const s = stackSegs[i];
      gridValues[s.node.cellIndex] = s.segment.value;
    }
    this._infoOverlay.setValues(gridValues);
  }

  _clearHoverStyles() {
    const hover = this._hover;
    if (hover.nodeOutline) {
      hover.nodeOutline.classList.remove('debug-flame-node-hover');
      hover.nodeOutline = null;
    }

    if (hover.segRect) {
      hover.segRect.classList.remove('debug-flame-seg-hover');
      hover.segRect = null;
    }
  }

  _applyHoverStyles(rectEl) {
    this._clearHoverStyles();
    const hover = this._hover;
    if (hover.sampleIndex === null) return;

    const entry = this._store.getDepthEntryAtSample(hover.depth, hover.sampleIndex);
    if (!entry) return;

    // Highlight the whole cell-node via its outline element.
    const outline = this._svg.querySelector(
      `.debug-flame-node-outline[data-flame-depth="${entry.node.depth}"][data-flame-sample-index="${entry.node.start}"]`);
    if (outline) {
      outline.classList.add('debug-flame-node-hover');
      hover.nodeOutline = outline;
    }

    // Highlight the specific hovered value segment.
    if (rectEl) {
      rectEl.classList.add('debug-flame-seg-hover');
      hover.segRect = rectEl;
    }
  }

  _reapplyHoverStylesAfterRender() {
    const hover = this._hover;
    if (hover.sampleIndex === null) return;
    // Re-apply without changing the current hover selection (no hit-testing).
    const rect = this._svg.querySelector(
      `rect.debug-flame-rect[data-flame-depth="${hover.depth}"][data-flame-sample-index="${hover.sampleIndex}"]`);
    this._applyHoverStyles(rect);
  }
}
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
