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
  DEBUG_PARAM_NAME = 'debug';

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

    // Setup elements.
    this._debugCellHighlighter = this._displayContainer.createCellHighlighter(
      'debug-hover');
    this._stackTraceView.setHighlighter(this._debugCellHighlighter);
    this._stackTraceView.activate();
    this._infoOverlay = new InfoOverlay(this._displayContainer);
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

    // Stack trace checkbox controls UI visibility only.
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

    // Unhide any debug-only elements.
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
    options.logLevel = parseInt(this._logLevelElem.value);
    // Only request stack traces if enabled when the solve starts.
    options.exportStackTrace = !!this._stackTraceCheckbox?.checked;
    return options;
  }

  getCallback() {
    return this._update.bind(this);
  }

  reshape(shape) {
    this.clear();
    this._shape = shape;
    this._stackTraceView.reshape(shape);
    this._infoOverlay?.reshape(shape);
    this._candidateDisplay?.reshape(shape);
  }

  clear() {
    clearDOMNode(this._logView);
    clearDOMNode(this._counterView);
    this._infoOverlay?.clear();
    this._debugCellHighlighter?.clear();
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
        this._infoOverlay.setValues(
          values, () => elem.checked = false);
      } else {
        this._infoOverlay.setValues();
      }
    });
  }

  _setInfoOverlayOnHover(elem, data) {
    elem.addEventListener('mouseover', () => {
      this._infoOverlay.setValues(data);
    });
    elem.addEventListener('mouseout', () => {
      this._infoOverlay.setValues();
    });
  }

  enable(enable) {
    if (enable === undefined) enable = true;

    // Reset the container.
    this._enabled = enable;
    this._container.classList.toggle('hidden', !enable);

    this.clear();
  }
}

// A info overlay which is lazily loaded.
export class InfoOverlay {
  constructor(displayContainer) {
    this._shape = null;

    this._heatmap = displayContainer.createCellHighlighter();
    this._textInfo = new InfoTextDisplay(
      displayContainer.getNewGroup('text-info-group'));

    this._onNextTextChangeFn = null;
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();

    this._textInfo.reshape(shape);
  }

  clear() {
    this._heatmap.clear();
    this._clearTextInfo();
  }

  _clearTextInfo() {
    this._textInfo.clear();
    if (this._onNextTextChangeFn) {
      this._onNextTextChangeFn();
      this._onNextTextChangeFn = null;
    }
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

  setValues(values, onChange) {
    const shape = this._shape;
    this._clearTextInfo();
    if (onChange) this._onNextTextChangeFn = onChange;

    if (!values) return;

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      this._textInfo.setText(cellId, values[i]);
    }
  }
}

export class DebugStackTraceView {
  constructor(containerElem) {
    this._container = containerElem;
    this._shape = null;
    this._highlighter = null;

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
    this._hoverCells = [null];

    if (this._container) {
      this._container.hidden = true;
    }
  }

  setHighlighter(highlighter) {
    this._highlighter = highlighter;
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
      this._highlighter?.clear();
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

  update(stack) {
    if (!stack) {
      this._lastCells = null;
      this._lastValues = null;

      this._prev = null;
      this._counts.length = 0;
      this._lastStableLen = 0;
      this._clearRenderedSpans();
      this._highlighter?.clear();
      return;
    }

    const next = (stack.cells && stack.cells.length) ? stack.cells : null;
    this._lastCells = next;
    this._lastValues = next ? stack.values : null;

    if (!next) {
      this._prev = null;
      this._counts.length = 0;
      this._lastStableLen = 0;
      this._clearRenderedSpans();
      this._highlighter?.clear();
      return;
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
    while (stableLen < next.length && counts[stableLen] >= this._minStableCount) {
      stableLen++;
    }

    this._lastStableLen = stableLen;
    this._renderIfVisible();
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

    const numCells = this._shape?.numCells ?? 0;
    const slots = new Array(numCells);

    for (let i = 0; i < numCells; i++) {
      const span = document.createElement('span');
      span.hidden = true;
      span.onmouseover = () => {
        if (!this._highlighter) return;
        const cellId = span.dataset.cellId;
        if (!cellId) return;
        this._hoverCells[0] = cellId;
        this._highlighter.setCells(this._hoverCells);
      };
      span.onmouseout = () => this._highlighter?.clear();
      slots[i] = span;
      this._container.appendChild(span);
      this._container.appendChild(document.createTextNode(' '));
    }

    this._slots = slots;
    this._renderedLen = 0;
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

      const value = values ? values[i] : 0;
      const prevValue = span.dataset.v ? +span.dataset.v : 0;

      span.hidden = false;

      if (span.dataset.cellId !== cellId || prevValue !== value) {
        span.dataset.cellId = cellId;
        span.dataset.v = '' + value;
        span.textContent = `${cellId}=${value || '?'}`;
      }
    }

    // Hide any spans that are no longer part of the rendered prefix.
    for (let i = nextLen; i < prevLen; i++) {
      this._slots[i].hidden = true;
    }

    this._renderedLen = nextLen;
  }
}
