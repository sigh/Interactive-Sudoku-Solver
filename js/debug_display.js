const {
  sessionAndLocalStorage,
  clearDOMNode,
} = await import('./util.js' + self.VERSION_PARAM);

const {
  InfoTextDisplay,
  CellValueDisplay,
} = await import('./display.js' + self.VERSION_PARAM);

const { SudokuParser } = await import('./sudoku_parser.js' + self.VERSION_PARAM);

const debugModule = await import('./debug.js' + self.VERSION_PARAM);

export class DebugManager {
  constructor(displayContainer, constraintManager) {
    this._constraintManager = constraintManager;
    this._container = document.getElementById('debug-container');
    this._logView = document.getElementById('debug-logs');
    this._counterView = document.getElementById('debug-counters');
    this._enabled = false;
    this._shape = null;
    this._infoOverlay = null;
    this._candidateDisplay = null;
    this._checkboxes = [
      ['exportConflictHeatmap', document.getElementById('conflict-heatmap-checkbox')],
    ];
    this._stackTraceCheckbox = document.getElementById('stack-trace-checkbox');
    this._logLevelElem = document.getElementById('debug-log-level');

    this._debugCellHighlighter = null;
    this._displayContainer = displayContainer;
    this._debugPuzzleSrc = document.getElementById('debug-puzzle-src');

    this._stackTraceView = new DebugStackTraceView(
      this._container.querySelector('.debug-stack-trace'));

    this._initialize();
  }

  _initialize() {
    // Import debug module functions into the window scope.
    Object.assign(self, debugModule);

    // UI wiring.
    this._infoOverlay = new InfoOverlay(this._displayContainer);
    this._stackTraceView.setInfoOverlay(this._infoOverlay);
    this._debugCellHighlighter = this._displayContainer.createCellHighlighter(
      'debug-hover');
    this._stackTraceView.setHighlighter(this._debugCellHighlighter);
    this._stackTraceView.activate();
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
      const element = this._stackTraceCheckbox;
      const value = sessionAndLocalStorage.getItem('showStackTrace') ??
        sessionAndLocalStorage.getItem('exportStackTrace');
      if (value !== undefined) {
        element.checked = (value === 'true');
      }
      this._stackTraceView.setEnabled(element.checked);
      element.onchange = () => {
        sessionAndLocalStorage.setItem('showStackTrace', element.checked);
        this._stackTraceView.setEnabled(element.checked);
      };
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
      this._stackTraceView.update(data.stackTrace);
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
  constructor(containerElem) {
    this._container = containerElem;
    this._shape = null;
    this._highlighter = null;
    this._infoOverlay = null;

    // Active means the debug UI has been loaded (so it's worth allocating DOM).
    this._active = false;

    this._enabled = false;

    this._prev = null;
    this._counts = [];
    this._minStableCount = 4;

    this._lastCells = null;
    this._lastValues = null;
    this._lastStableLen = 0;

    this._slots = null;
    this._renderedLen = 0;

    this._hoverStepIndex = null;

    if (this._container) {
      this._container.hidden = true;
    }
  }

  setHighlighter(highlighter) {
    this._highlighter = highlighter;
  }

  setInfoOverlay(infoOverlay) {
    this._infoOverlay = infoOverlay;
  }

  activate() {
    if (this._active) return;
    this._active = true;
    this._syncVisibility();
    this._ensureSlots();
    this._renderIfVisible();
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
    this._highlighter?.clear();
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
    if (!stack) return this._resetTrace();

    const next = (stack.cells?.length) ? stack.cells : null;
    this._lastCells = next;
    this._lastValues = next ? stack.values : null;

    if (!next) return this._resetTrace();

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
    while (stableLen < next.length && counts[stableLen] >= this._minStableCount) {
      stableLen++;
    }

    this._lastStableLen = stableLen;
    this._renderIfVisible();

    // If the user is hovering a step, keep hover effects in sync with new data.
    this._syncHover();
  }

  _syncVisibility() {
    if (!this._container) return;
    // Visibility is controlled solely by the checkbox.
    this._container.hidden = !this._enabled;
  }

  _renderIfVisible() {
    if (!this._active || !this._enabled) return;
    if (!this._shape) return;
    if (!this._slots) return;

    if (this._lastCells) {
      this._renderPrefix(this._lastCells, this._lastValues, this._lastStableLen);
    } else {
      this._clearRenderedSpans();
    }
  }

  _ensureSlots() {
    if (!this._active || !this._shape || !this._container) return;
    if (this._slots?.length === this._shape.numCells) return;

    clearDOMNode(this._container);

    const numCells = this._shape.numCells;
    const slots = new Array(numCells);

    for (let i = 0; i < numCells; i++) {
      const span = document.createElement('span');
      span.hidden = true;
      span.onmouseover = () => {
        this._setHoverStepIndex(i);
      };
      span.onmouseout = () => {
        this._setHoverStepIndex(null);
      };
      slots[i] = span;
      this._container.appendChild(span);
      this._container.appendChild(document.createTextNode(' '));
    }

    this._slots = slots;
    this._renderedLen = 0;
  }

  _setHoverStepIndex(stepIndex) {
    this._hoverStepIndex = stepIndex;
    this._syncHover();
  }

  _syncHover() {
    const highlighter = this._highlighter;
    const infoOverlay = this._infoOverlay;
    const shape = this._shape;
    const stepIndex = this._hoverStepIndex;
    const cells = this._lastCells;

    if (!shape || stepIndex === null || !cells?.length) {
      highlighter?.clear();
      infoOverlay?.setValues();
      return;
    }

    const idx = Math.min(stepIndex, cells.length - 1);

    // Highlight the hovered step's cell.
    if (highlighter) {
      const cellId = shape.makeCellIdFromIndex(cells[idx]);
      highlighter.setCells([cellId]);
    }

    // Show values up to (and including) the hovered step.
    if (infoOverlay) {
      const values = this._lastValues;
      const gridValues = new Array(shape.numCells);
      for (let i = 0; i <= idx; i++) {
        gridValues[cells[i]] = values[i];
      }
      infoOverlay.setValues(gridValues);
    }
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

      if (span.dataset.cellId !== cellId || prevValue !== value) {
        span.dataset.cellId = cellId;
        span.dataset.v = '' + value;
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
