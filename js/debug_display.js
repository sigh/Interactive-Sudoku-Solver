(() => {
  // Load debug CSS once.

  if (typeof document === 'undefined' || !document.head) return;

  const id = 'debug-stylesheet';
  if (document.getElementById(id)) return;

  const href = new URL('../css/debug.css' + self.VERSION_PARAM, import.meta.url).toString();
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
})();

const {
  sessionAndLocalStorage,
  deferUntilAnimationFrame,
  createSvgElement,
  clearDOMNode,
  memoize,
} = await import('./util.js' + self.VERSION_PARAM);

const {
  InfoTextDisplay,
  CellValueDisplay,
} = await import('./display.js' + self.VERSION_PARAM);

const { SudokuParser } = await import('./sudoku_parser.js' + self.VERSION_PARAM);

const { FlameGraphStore } = await import('./flame_graph_store.js' + self.VERSION_PARAM);

const debugModule = await import('./debug.js' + self.VERSION_PARAM);

export class DebugManager {
  constructor(displayContainer, constraintManager) {
    // External dependencies.
    this._displayContainer = displayContainer;
    this._constraintManager = constraintManager;

    // DOM.
    this._container = document.getElementById('debug-container');
    this._logView = document.getElementById('debug-logs');
    this._counterView = document.getElementById('debug-counters');
    this._debugPuzzleSrc = document.getElementById('debug-puzzle-src');
    this._stackTraceCheckbox = document.getElementById('stack-trace-checkbox');
    this._logLevelElem = document.getElementById('debug-log-level');
    this._checkboxes = [
      ['exportConflictHeatmap', document.getElementById('conflict-heatmap-checkbox')],
    ];

    // State.
    this._enabled = false;
    this._shape = null;

    // UI helpers.
    this._infoOverlay = new InfoOverlay(this._displayContainer);
    this._debugCellHighlighter = this._displayContainer.createCellHighlighter(
      'debug-hover');
    this._candidateDisplay = null;

    // Views.
    this._stackTraceView = new DebugStackTraceView(
      this._container.querySelector('.debug-stack-trace'), {
      infoOverlay: this._infoOverlay,
      highlighter: this._debugCellHighlighter,
    });
    this._flameGraphView = new DebugFlameGraphView(this._stackTraceView.getContainer(), {
      infoOverlay: this._infoOverlay,
      highlighter: this._debugCellHighlighter,
    });

    this._initialize();
  }

  _initialize() {
    // Import debug module functions into the window scope.
    Object.assign(self, debugModule);

    // UI wiring.
    this._candidateDisplay = new CellValueDisplay(
      this._displayContainer.getNewGroup('debug-candidate-group'));

    // Initialize options checkboxes.
    for (const [key, element] of this._checkboxes) {
      const value = sessionAndLocalStorage.getItem(key);
      if (value !== undefined) {
        element.checked = (value === 'true');
      }
      element.onchange = () => {
        sessionAndLocalStorage.setItem(key, element.checked);
      }
    }

    // Stack trace checkbox controls only whether the footer is visible.
    // Whether the solver exports stack traces is decided at solve start via getOptions().
    {
      const stackTraceCheckbox = this._stackTraceCheckbox;

      const stackTraceFooter = document.getElementById('debug-stack-trace-footer');
      const flameToggleButton = document.getElementById('debug-flame-toggle');

      const showStackTraceKey = 'showStackTrace';
      const flameExpandedKey = 'debugFlameExpanded';

      const savedShowStackTrace = sessionAndLocalStorage.getItem(showStackTraceKey);
      if (savedShowStackTrace !== undefined) {
        stackTraceCheckbox.checked = (savedShowStackTrace === 'true');
      }

      const applyFlameExpanded = (expanded) => {
        flameToggleButton.classList.toggle('expanded', expanded);
        this._flameGraphView.setCollapsed(!expanded);
        sessionAndLocalStorage.setItem(flameExpandedKey, expanded.toString());
      };

      // Flame graph is visible by default.
      const savedFlameExpanded = sessionAndLocalStorage.getItem(flameExpandedKey);
      applyFlameExpanded(savedFlameExpanded === undefined ? true : (savedFlameExpanded === 'true'));

      flameToggleButton.addEventListener('click', () => {
        applyFlameExpanded(!flameToggleButton.classList.contains('expanded'));
      });

      const applyStackTraceEnabled = (enabled) => {
        this._stackTraceView.setEnabled(enabled);
        this._flameGraphView.setEnabled(enabled);
        stackTraceFooter.hidden = !enabled;
        sessionAndLocalStorage.setItem(showStackTraceKey, enabled.toString());
      };

      applyStackTraceEnabled(stackTraceCheckbox.checked);
      stackTraceCheckbox.onchange = () => applyStackTraceEnabled(stackTraceCheckbox.checked);
    }

    // Log level selector.
    {
      const logLevelElem = this._logLevelElem;
      const value = sessionAndLocalStorage.getItem('logLevel');
      logLevelElem.value = value || '0';
      logLevelElem.onchange = () => {
        sessionAndLocalStorage.setItem('logLevel', logLevelElem.value);
      };
    }

    // Setup debug checkboxes.
    const debugCheckboxes = [
      ['debug-cell-id', (index) => this._shape.makeCellIdFromIndex(index)],
      ['debug-cell-index', (index) => index],
    ];

    for (const [id, fn] of debugCheckboxes) {
      const element = document.getElementById(id);
      const overlayValuesFn = () => {
        const numCells = this._shape.numCells;
        return [...new Array(numCells).keys()].map(fn);
      };
      this._setInfoOverlayOnCheck(element, overlayValuesFn);
    }

    // Debug puzzle loader.
    debugModule.setConstraintManager(this._constraintManager);
    debugModule.debugFilesLoaded.then(() => {
      this._loadDebugPuzzleInput();
    });

    // Once debug UI is loaded, reveal any debug-only UI elements.
    const hiddenElements = Array.from(
      document.getElementsByClassName('hide-unless-debug'));
    hiddenElements.forEach(e => e.classList.remove('hide-unless-debug'));


    // Call reshape so that all dependencies are initialized with the shape.
    if (this._shape) {
      this.reshape(this._shape);
    }
  }

  static async _makeDebugIndex() {
    const index = new Map();

    const { PUZZLE_INDEX } = await import('../data/example_puzzles.js' + self.VERSION_PARAM);
    for (const puzzle of PUZZLE_INDEX.values()) {
      const constraintTypes = puzzle.constraintTypes
        || SudokuParser.extractConstraintTypes(puzzle.input);
      const title = `${puzzle.name || ''} [${constraintTypes.join(',')}]`;
      index.set(title, puzzle);
    }

    const PuzzleCollections = await import('../data/collections.js' + self.VERSION_PARAM);

    const puzzleLists = {
      TAREK_ALL: PuzzleCollections.TAREK_ALL,
      EXTREME_KILLERS: PuzzleCollections.EXTREME_KILLERS,
      HARD_THERMOS: PuzzleCollections.HARD_THERMOS,
      MATHEMAGIC_KILLERS: PuzzleCollections.MATHEMAGIC_KILLERS,
      HARD_RENBAN: PuzzleCollections.HARD_RENBAN,
      HARD_PENCILMARKS: PuzzleCollections.HARD_PENCILMARKS,
      HS_KILLERS: PuzzleCollections.HS_KILLERS,
    };
    for (const [listName, list] of Object.entries(puzzleLists)) {
      for (let i = 0; i < list.length; i++) {
        const puzzle = list[i];
        const name = `${listName}[${i}]`;
        index.set(name, puzzle);
      }
    }

    return index;
  }

  async _loadDebugPuzzleInput() {
    const debugIndex = await this.constructor._makeDebugIndex();
    const datalist = document.getElementById('debug-puzzles');
    for (const name of debugIndex.keys()) {
      const option = document.createElement('option');
      option.value = name;
      datalist.appendChild(option);
    }

    const input = document.getElementById('debug-puzzle-input');
    input.onchange = async () => {
      const name = input.value;
      // Clear the input after a short time so the user can still notice
      // what was selected.
      window.setTimeout(() => {
        input.value = '';
      }, 300);

      const puzzle = debugIndex.get(name);
      if (!puzzle) return;

      await debugModule.loadInput(puzzle);

      window.setTimeout(() => {
        const debugPuzzleSrc = this._debugPuzzleSrc;
        clearDOMNode(debugPuzzleSrc);
        if (puzzle.src) {
          const link = document.createElement('a');
          link.href = puzzle.src;
          link.textContent = puzzle.name;
          debugPuzzleSrc.appendChild(link);
        } else {
          debugPuzzleSrc.textContent = puzzle.name;
        }
      }, 0);
    };
  }

  getOptions() {
    if (!this._enabled) return null;
    const options = Object.fromEntries(
      this._checkboxes.map(
        ([k, v]) => [k, v.checked]
      )
    );
    options.logLevel = parseInt(this._logLevelElem.value, 10);
    // Only request stack traces if enabled when the solve starts.
    options.exportStackTrace = this._stackTraceCheckbox.checked;
    return options;
  }

  getCallback() {
    return this._update.bind(this);
  }

  reshape(shape) {
    this.clear();
    this._shape = shape;
    this._stackTraceView.reshape(shape);
    this._flameGraphView.reshape(shape);
    this._infoOverlay.reshape(shape);
    this._candidateDisplay.reshape(shape);
  }

  clear() {
    clearDOMNode(this._logView);
    clearDOMNode(this._counterView);
    this._infoOverlay.clear();
    this._debugCellHighlighter.clear();
    clearDOMNode(this._debugPuzzleSrc);

    this._logDedupe = {
      lastKey: '',
      count: 0,
      currentSpan: null,
    };

    this._stackTraceView.clear();
    this._flameGraphView.clear();
  }

  _update(data) {
    if (!this._enabled) return;

    if (data.logs) {
      const isScrolledToBottom = this._isScrolledToBottom(this._logView);

      data.logs.forEach(l => this._addLog(l));

      if (isScrolledToBottom) {
        this._scrollToBottom(this._logView);
      }
    }

    if (data.conflictHeatmap) {
      this._infoOverlay.setHeatmapValues(data.conflictHeatmap);
    }

    if (data.counters) {
      const counterView = this._counterView;
      clearDOMNode(counterView);

      for (const key of [...data.counters.keys()].sort()) {
        const value = data.counters.get(key);

        const elem = document.createElement('div');
        const label = document.createElement('span');
        label.className = 'description';
        label.textContent = key;
        const count = document.createElement('span');
        count.textContent = value;
        elem.appendChild(label);
        elem.appendChild(count);
        counterView.appendChild(elem);
      }
    }

    if (data.stackTrace !== undefined) {
      const stableLen = this._stackTraceView.update(data.stackTrace);
      this._flameGraphView.update(data.stackTrace, stableLen);
    }
  }

  _isScrolledToBottom(obj) {
    return obj.scrollTop === (obj.scrollHeight - obj.offsetHeight);
  }
  _scrollToBottom(obj) {
    obj.scrollTop = obj.scrollHeight;
  }

  _addDuplicateLog(data) {
    if (!this._logDedupe.currentSpan) {
      this._logDedupe.count = 1;
      this._logDedupe.currentSpan = document.createElement('span');
      this._logDedupe.currentSpan.classList.add('duplicate-log-line');
      this._logView.append(this._logDedupe.currentSpan);
    }
    const span = this._logDedupe.currentSpan;
    const count = ++this._logDedupe.count;

    const repeatSpan = document.createElement('span');
    repeatSpan.textContent = ` x${count}`;
    this._addLogMouseOver(repeatSpan, data);

    span.append(repeatSpan);
  }

  _addLog(data) {
    const argsStr = JSON.stringify(data.args || '').replaceAll('"', '');

    const key = `${data.loc} ${data.msg} ${argsStr}`;
    if (key == this._logDedupe.lastKey) {
      return this._addDuplicateLog(data);
    }
    this._logDedupe.lastKey = key;
    this._logDedupe.currentSpan = null;

    const elem = document.createElement('div');
    if (data.important) {
      elem.classList.add('important-log-line');
    }

    const locSpan = document.createElement('span');
    locSpan.textContent = data.loc + ': ';

    const msgSpan = document.createElement('msg');
    let msg = data.msg || '';
    if (data.args) {
      msg += ' ' + argsStr;
    }
    msgSpan.textContent = msg;

    elem.append(locSpan);
    elem.append(msgSpan);

    this._addLogMouseOver(elem, data);

    this._logView.append(elem);
  }

  _addLogMouseOver(elem, data) {
    const shape = this._shape;

    if (data.cells?.length) {
      const cellIds = [...data.cells].map(c => shape.makeCellIdFromIndex(c));
      elem.addEventListener('mouseover', () => {
        this._debugCellHighlighter.setCells(cellIds);
      });
      elem.addEventListener('mouseout', () => {
        this._debugCellHighlighter.clear();
      });
    }

    if (data.candidates) {
      elem.addEventListener('mouseover', () => {
        this._candidateDisplay.renderGridValues(data.candidates);
      });
      elem.addEventListener('mouseout', () => {
        this._candidateDisplay.clear();
      });
    }

    if (data.overlay) {
      this._setInfoOverlayOnHover(elem, data.overlay);
    }
  }

  _setInfoOverlayOnCheck(elem, data) {
    elem.addEventListener('change', () => {
      if (elem.checked) {
        let values = data;
        if (typeof data === 'function') values = data();
        this._infoOverlay.setAnnotations(
          values, () => elem.checked = false);
      } else {
        this._infoOverlay.setAnnotations();
      }
    });
  }

  _setInfoOverlayOnHover(elem, data) {
    elem.addEventListener('mouseover', () => {
      this._infoOverlay.setAnnotations(data);
    });
    elem.addEventListener('mouseout', () => {
      this._infoOverlay.setAnnotations();
    });
  }

  enable(enable) {
    if (enable === undefined) enable = true;

    // Show/hide the debug panel. When disabling, we also clear the UI.
    this._enabled = enable;
    this._container.classList.toggle('hidden', !enable);

    this.clear();
  }
}

// Renders per-cell overlays on the grid.
//
// There are two independent text channels:
// - Annotations: controlled by debug checkboxes / hover overlays (e.g. show cell id/index).
// - Values: reserved for stack-trace hover (shows the value at each step's prefix).
//
// Keeping these separate ensures stack-trace hover never interferes with annotation toggles.
export class InfoOverlay {
  constructor(displayContainer) {
    this._shape = null;

    this._heatmap = displayContainer.createCellHighlighter();
    this._annotationText = new InfoTextDisplay(
      displayContainer.getNewGroup('debug-info-group'));
    const valueGroup = displayContainer.getNewGroup('debug-value-group');
    valueGroup.classList.add('solution-group');
    this._valueDisplay = new CellValueDisplay(valueGroup);

    this._onNextTextChangeFn = null;
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();

    this._annotationText.reshape(shape);
    this._valueDisplay.reshape(shape);
  }

  clear() {
    this._heatmap.clear();
    this._clearAnnotationText();
    this._clearValueText();
  }

  _clearAnnotationText() {
    this._annotationText.clear();
    if (this._onNextTextChangeFn) {
      this._onNextTextChangeFn();
      this._onNextTextChangeFn = null;
    }
  }

  _clearValueText() {
    this._valueDisplay.clear();
  }

  setHeatmapValues(values) {
    const shape = this._shape;
    this._heatmap.clear();

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      const path = this._heatmap.addCell(cellId);
      path.setAttribute('fill', 'rgb(255, 0, 0)');
      path.setAttribute('opacity', values[i] / 1000);
    }
  }

  // Sets the annotation overlay text.
  // If onChange is provided, it will be called the next time annotations are cleared.
  // (Used by checkbox-driven overlays so they can auto-uncheck.)
  setAnnotations(values, onChange) {
    const shape = this._shape;
    this._clearAnnotationText();
    if (onChange) this._onNextTextChangeFn = onChange;

    if (!values) return;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const cellId = shape.makeCellIdFromIndex(i);
      this._annotationText.setText(cellId, value);
    }
  }

  setValues(gridValues) {
    this._clearValueText();
    if (!gridValues) return;

    this._valueDisplay.renderGridValues(gridValues);
  }
}

export class DebugStackTraceView {
  constructor(containerElem, { highlighter, infoOverlay }) {
    // DOM.
    this._container = containerElem;

    // Dependencies.
    this._shape = null;
    this._highlighter = highlighter;
    this._infoOverlay = infoOverlay;

    // Lifecycle.
    this._enabled = false;

    // Trace state.
    this._lastCells = null;
    this._lastValues = null;
    this._lastStableLen = 0;

    this._prev = null;
    this._counts = [];

    // Render state.
    this._slots = null;
    this._renderedLen = 0;

    // Hover state.
    this._hoverStepIndex = null;

    // Hover updates only on mouse movement; DOM updates should not affect it.
    this._container.onmousemove = (e) => {
      if (!this._enabled) return;

      const target = e.target;
      const el = (target instanceof Element) ? target : target?.parentElement;
      const span = el?.closest?.('span');
      if (!span || !this._container.contains(span) || span.hidden) {
        this._setHoverStepIndex(null);
        return;
      }

      const idx = parseInt(span.dataset.stepIndex || '', 10);
      this._setHoverStepIndex(Number.isFinite(idx) ? idx : null);
    };
    this._container.onmouseleave = () => {
      this._setHoverStepIndex(null);
    };

    this._container.hidden = true;
  }

  getContainer() {
    return this._container;
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    this._syncVisibility();
    if (!this._enabled) {
      this._setHoverStepIndex(null);
      return;
    }

    this._ensureSlots();
    this._renderIfVisible();
  }

  reshape(shape) {
    this._shape = shape;
    this._ensureSlots();
    this.clear();
  }

  clear() {
    this._prev = null;
    this._counts.length = 0;

    this._lastCells = null;
    this._lastValues = null;
    this._lastStableLen = 0;

    this._clearRenderedSpans();
    this._highlighter.clear();
  }

  _resetTrace() {
    this._lastCells = null;
    this._lastValues = null;

    this._setHoverStepIndex(null);

    this._prev = null;
    this._counts.length = 0;
    this._lastStableLen = 0;

    this._clearRenderedSpans();
  }

  update(stack) {
    if (!stack) {
      this._resetTrace();
      return 0;
    }

    const next = (stack.cells?.length) ? stack.cells : null;
    this._lastCells = next;
    this._lastValues = next ? stack.values : null;

    if (!next) {
      this._resetTrace();
      return 0;
    }

    const prev = this._prev;
    const counts = this._counts;

    if (!prev) {
      this._prev = next;
      counts.length = next.length;
      counts.fill(1);
    } else {
      let commonPrefixLen = 0;
      const minLen = Math.min(prev.length, next.length);
      while (commonPrefixLen < minLen && prev[commonPrefixLen] === next[commonPrefixLen]) {
        commonPrefixLen++;
      }

      counts.length = next.length;
      for (let i = 0; i < commonPrefixLen; i++) {
        counts[i] = (counts[i] ?? 1) + 1;
      }
      for (let i = commonPrefixLen; i < next.length; i++) {
        counts[i] = 1;
      }

      this._prev = next;
    }

    let stableLen = 0;
    const minStableCount = 4;
    while (stableLen < next.length && counts[stableLen] >= minStableCount) {
      stableLen++;
    }

    this._lastStableLen = stableLen;
    this._renderIfVisible();

    return stableLen;
  }

  _syncVisibility() {
    // Visibility is controlled solely by the checkbox.
    this._container.hidden = !this._enabled;
  }

  _renderIfVisible() {
    if (!this._enabled) return;
    if (!this._shape) return;
    if (!this._slots) return;

    if (this._lastCells) {
      this._renderPrefix(this._lastCells, this._lastValues, this._lastStableLen);
    } else {
      this._clearRenderedSpans();
    }
  }

  _ensureSlots() {
    if (!this._shape) return;
    if (this._slots?.length === this._shape.numCells) return;

    clearDOMNode(this._container);

    const numCells = this._shape.numCells;
    const slots = new Array(numCells);

    for (let i = 0; i < numCells; i++) {
      const span = document.createElement('span');
      span.hidden = true;
      span.dataset.stepIndex = i;
      slots[i] = span;
      this._container.appendChild(span);
    }

    this._slots = slots;
    this._renderedLen = 0;
  }

  _setHoverStepIndex(stepIndex) {
    if (this._hoverStepIndex === stepIndex) return;
    this._hoverStepIndex = stepIndex;
    this._syncHover();
  }

  _syncHover() {
    const shape = this._shape;
    const stepIndex = this._hoverStepIndex;
    const cells = this._lastCells;

    if (!shape || stepIndex === null || !cells?.length) {
      this._highlighter.clear();
      this._infoOverlay.setValues();
      return;
    }

    const idx = Math.min(stepIndex, cells.length - 1);

    // Highlight the hovered step's cell.
    const cellId = shape.makeCellIdFromIndex(cells[idx]);
    this._highlighter.setCells([cellId]);

    // Show values up to (and including) the hovered step.
    const values = this._lastValues;
    const gridValues = new Array(shape.numCells);
    for (let i = 0; i <= idx; i++) {
      gridValues[cells[i]] = values[i];
    }
    this._infoOverlay.setValues(gridValues);
  }

  _clearRenderedSpans() {
    if (!this._slots || !this._renderedLen) return;
    for (let i = 0; i < this._renderedLen; i++) {
      this._slots[i].hidden = true;
    }
    this._renderedLen = 0;
  }

  _renderPrefix(cells, values, len = 0) {
    if (!this._slots) return;

    const prevLen = this._renderedLen;
    const nextLen = len;

    // Update visible prefix spans.
    for (let i = 0; i < nextLen; i++) {
      const cellIndex = cells[i];
      const cellId = this._shape.makeCellIdFromIndex(cellIndex);
      const span = this._slots[i];

      const value = values[i];
      const prevValue = span.dataset.v ? +span.dataset.v : 0;

      span.hidden = false;

      // Match flame-graph colors for easier visual association.
      span.style.backgroundColor = getColorForValue(value, this._shape.numValues);

      if (span.dataset.cellId !== cellId || prevValue !== value) {
        span.dataset.cellId = cellId;
        span.dataset.v = value;
        span.textContent = `${cellId}=${value}`;
      }
    }

    // Hide any spans that are no longer part of the rendered prefix.
    for (let i = nextLen; i < prevLen; i++) {
      this._slots[i].hidden = true;
    }

    this._renderedLen = nextLen;
  }
}

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
    this._svgRect = this._svg.getBoundingClientRect();
    this._resizeObserver = new ResizeObserver(() => {
      this._svgRect = this._svg.getBoundingClientRect();
      this._render()
    });
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

  update(stackTrace, stableLen) {
    if (this._store.appendFromStackTrace(stackTrace, stableLen)) {
      this._render();
    }
  }

  _syncVisibility() {
    this._container.hidden = !this._enabled || this._collapsed;
  }

  _renderImpl() {
    const width = this._svgRect.width;
    const height = this._svgRect.height;
    if (!width || !height) return;
    const numSamples = this._store.getNumSamples();
    if (!numSamples) return;
    if (!this._shape) return;

    const ROW_HEIGHT = 16;
    const maxDepth = Math.max(1, Math.floor(height / ROW_HEIGHT));
    const MIN_LABEL_WIDTH = 34;
    const scale = width / numSamples;

    clearDOMNode(this._svg);

    // Render into two groups so overlays always sit on top.
    const segLayer = createSvgElement('g');
    const overlayLayer = createSvgElement('g');
    this._svg.append(segLayer);
    this._svg.append(overlayLayer);

    const nodesByDepth = this._store.nodesByDepth;
    const maxDepthAvail = Math.min(maxDepth, nodesByDepth.length);

    for (let depth = 0; depth < maxDepthAvail; depth++) {
      const row = nodesByDepth[depth];
      if (!row?.length) continue;

      const y = depth * ROW_HEIGHT;
      const h = ROW_HEIGHT - 1;

      for (let i = 0; i < row.length; i++) {
        const node = row[i];

        const nodeX0 = node.start * scale;
        const nodeX1 = node.end * scale;
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
          const x0 = seg.start * scale;
          const x1 = seg.end * scale;
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
    const span = entry.segment.end - entry.segment.start;
    tooltip.textContent = `${cellId}=${entry.segment.value} | span ${span}`;
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

const getColorForValue = memoize((value, numValues) => {
  const idx = ((value - 1) % numValues + numValues) % numValues;
  const hue = (idx / numValues) * 360;
  const lightness = idx % 2 ? 90 : 95;
  return `hsl(${hue}, 80%, ${lightness}%)`;
});
