const {
  sessionAndLocalStorage,
  deferUntilAnimationFrame,
  clearDOMNode,
  isIterable,
  localTimestamp,
  clamp
} = await import('./util.js' + self.VERSION_PARAM);
const {
  HighlightDisplay,
  SolutionDisplay,
  InfoTextDisplay,
  CellValueDisplay
} = await import('./display.js' + self.VERSION_PARAM);
const { SudokuParser, toShortSolution } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
const { SolverStateDisplay } = await import('./solver_state_display.js' + self.VERSION_PARAM);

class HistoryHandler {
  MAX_HISTORY = 50;
  HISTORY_ADJUSTMENT = 10;

  constructor(onUpdate) {
    this._blockHistoryUpdates = false;
    this._onUpdate = params => {
      // Block history updates until we have reloaded.
      this._blockHistoryUpdates = true;
      onUpdate(params);
    }

    this._history = [];
    this._historyLocation = -1;

    this._undoButton = document.getElementById('undo-button');
    this._undoButton.onclick = () => this._incrementHistory(-1);
    this._redoButton = document.getElementById('redo-button');
    this._redoButton.onclick = () => this._incrementHistory(+1);
    // ctrl-z/shift-ctrl-z are shortcuts for undo/redo,
    window.addEventListener('keydown', event => {
      if (document.activeElement.tagName === 'TEXTAREA') return;
      if (event.key === 'z' && (event.metaKey || event.ctrlKey)) {
        this._incrementHistory(event.shiftKey ? 1 : -1);
      }
      return false;
    });

    window.onpopstate = this._reloadFromUrl.bind(this);
    this._reloadFromUrl();
  }

  update(params) {
    if (this._blockHistoryUpdates) {
      this._blockHistoryUpdates = false;
      return;
    }
    let q = '' + (params.q || '');

    this._addToHistory(q);
    this._updateUrl(params);
  }

  _addToHistory(q) {
    if (q == this._history[this._historyLocation]) return;
    this._history.length = this._historyLocation + 1;
    this._history.push(q || '');
    this._historyLocation++;

    if (this._history.length > HistoryHandler.MAX_HISTORY) {
      this._history = this._history.slice(HISTORY_ADJUSTMENT);
      this._historyLocation -= HISTORY_ADJUSTMENT;
    }

    this._updateButtons();
  }

  _incrementHistory(delta) {
    const index = this._historyLocation + delta;
    if (index < 0 || index >= this._history.length) return;
    let q = this._history[this._historyLocation + delta];
    this._historyLocation += delta;
    this._updateButtons();

    this._updateUrl({ q: q });
    this._onUpdate(new URLSearchParams({ q: q }));
  }

  _updateButtons() {
    this._undoButton.disabled = this._historyLocation <= 0;
    this._redoButton.disabled = this._historyLocation >= this._history.length - 1;
  }

  _updateUrl(params) {
    let url = new URL(window.location.href);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }

    let newUrl = url.toString();
    if (newUrl != window.location.href) {
      history.pushState(null, null, url.toString());
    }
  }

  _reloadFromUrl() {
    let url = new URL(window.location.href);
    this._addToHistory(url.searchParams.get('q'));
    this._onUpdate(url.searchParams);
  }
}

class DebugStackTraceView {
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

class DebugManager {
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

    this._initializeState();
  }

  _initializeState() {
    let debugLoaded = false;

    const updateURL = (enable) => {
      const url = new URL(window.location);
      if (enable) {
        url.searchParams.set(this.DEBUG_PARAM_NAME, 1);
      } else {
        url.searchParams.delete(this.DEBUG_PARAM_NAME);
      }
      window.history.pushState(null, null, url);
    };

    // Set up loading and closing.
    const loadDebug = () => {
      this.enable(true);
      updateURL(true);
      if (debugLoaded) return Promise.resolve();

      debugLoaded = true;
      const loaderPromise = import('./debug.js' + self.VERSION_PARAM);

      this._deferredSetup(loaderPromise);

      const hiddenElements = Array.from(
        document.getElementsByClassName('hide-unless-debug'));
      hiddenElements.forEach(e => e.classList.remove('hide-unless-debug'));

      // Return a promise so that the caller can wait for debug
      // functions to be available.
      return loaderPromise;
    };
    const closeDebug = () => {
      this.enable(false);
      updateURL(false);
    };

    // Wire up loading and closing.
    window.loadDebug = loadDebug;
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 'd') {
        this._enabled ? closeDebug() : loadDebug();
      }
    });
    document.getElementById('close-debug-button').onclick = closeDebug;

    // Load debug if we are already in debug mode.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get(this.DEBUG_PARAM_NAME) !== null) {
      loadDebug();
    }
  }

  _deferredSetup(loaderPromise) {
    // Things setup only when the debugger is actually loaded.

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
    loaderPromise.then((debugModule) => {
      debugModule.setConstraintManager(this._constraintManager);
      Object.assign(self, debugModule);
      debugModule.debugFilesLoaded.then(() => {
        this._loadDebugPuzzleInput();
      });
    });

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

      await loadInput(puzzle);

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

class ModeHandler {
  ITERATION_CONTROLS = false;
  ALLOW_DOWNLOAD = false;
  ALLOW_ALT_CLICK = false;

  constructor() {
    this._solver = null;
    this._solutions = [];
    this._done = false;
    this._listener = () => { };
  }

  async run(solver) {
    this._solver = solver;
  }

  setDone() {
    this._done = true;
    this._listener();
  }

  add() {
    this._listener();
  }

  done() {
    return this._done;
  }

  solutionCount() {
    return this._solutions.length;
  }

  maxIndex() {
    return Math.max(0, this.solutionCount() - 1);
  }

  async get(i) {
    const count = this.solutionCount();
    if (count == 0) return {};

    let description = `Solution ${i + 1}`;
    if (count == 1 && this.done()) description = 'Unique solution';
    return {
      solution: this._solutions[i],
      description: description,
    }
  }

  solutions() {
    return Array.from(this._solutions);
  }

  setUpdateListener(fn) {
    this._listener = fn;
  }

  handleSolverException(e) {
    // If the solver was terminated, then don't show an error.
    if (!e.toString().startsWith('Aborted')) {
      throw (e);
    }
  }
}

class AllPossibilitiesModeHandler extends ModeHandler {
  static NAME = 'all-possibilities';
  static DESCRIPTION =
    'Show all values which are present in any valid solution.';

  ITERATION_CONTROLS = true;
  ALLOW_DOWNLOAD = true;

  constructor() {
    super();
    this._pencilmarks = [];
  }

  async run(solver) {
    await super.run(solver);
    await this._solver.solveAllPossibilities();
  }

  maxIndex() {
    const c = this.solutionCount();
    // If we have a unique solution, we show it at index 0.
    // Otherwise, index 0 is the summary, and solutions are at indices 1..c.
    return (this.done() && c === 1) ? 0 : c;
  }

  setDone() {
    for (let i = 0; i < this._pencilmarks.length; i++) {
      if (this._pencilmarks[i].size == 1) {
        this._pencilmarks[i] = this._pencilmarks[i].values().next().value;
      }
    }
    super.setDone();
  }

  add(...solutions) {
    this._solutions.push(...solutions);

    if (this._pencilmarks.length == 0) {
      this._pencilmarks = Array.from(solutions[0]).map(() => new Set());
    }
    for (const solution of solutions) {
      for (let i = 0; i < solution.length; i++) {
        this._pencilmarks[i].add(solution[i]);
      }
    }

    super.add(...solutions);
  }

  async get(i) {
    // If we have a unique solution, we want to show it at index 0.
    // This overrides the default behavior where index 0 is the summary.
    if (this.done() && this.solutionCount() === 1) {
      return {
        solution: this._solutions[0],
        description: 'Unique solution',
      };
    }
    // Index 0 is the summary view (pencilmarks).
    if (i == 0) return {
      solution: this._pencilmarks,
      description: 'All possibilities',
    }
    return super.get(i - 1);
  }
}

class AllSolutionsModeHandler extends ModeHandler {
  static NAME = 'solutions';
  static DESCRIPTION = 'View each solution.';

  ITERATION_CONTROLS = true;
  ALLOW_DOWNLOAD = true;

  constructor() {
    super();
    this._pending = null;
    this._targetCount = 2;
  }

  async run(solver) {
    super.run(solver);
    await this._fetchSolutions();
  }

  add(...solutions) {
    this._solutions.push(...solutions);
    super.add(...solutions);
  }

  async _fetchSolutions() {
    while (!this.done()) {
      // We are already waiting for results.
      if (this._pending) return;
      // If we've already reached the target count then return.
      if (this.solutionCount() >= this._targetCount) return;

      this._pending = this._solver.nthSolution(this.solutionCount());
      const solution = await this._pending;
      this._pending = null;

      if (solution) {
        this.add(solution);
      } else {
        this.setDone();
      }
    }
  }

  async get(i) {
    // Ensure we have at least one past the solution being asked for.
    this._targetCount = i + 2;
    this._fetchSolutions().catch(this.handleSolverException);

    return super.get(i);
  }
}

class StepByStepModeHandler extends ModeHandler {
  static NAME = 'step-by-step';
  static DESCRIPTION = `
      Step through the solving process.
      Alt-click on a cell to force the solver to resolve it next.`;

  ITERATION_CONTROLS = true;
  ALLOW_ALT_CLICK = true;

  constructor() {
    super();
    this._pending = null;
    this._numSteps = 0;
    this._stepGuides = new Map();
  }

  setDone() { }

  async run(solver) {
    await super.run(solver);
  }

  maxIndex() {
    return this._numSteps;
  }

  handleAltClick(step, cell) {
    this._addStepGuideCell(step, cell);
    this._listener();
  }

  _invalidateStepGuides(minStep) {
    for (const [s, _] of this._stepGuides) {
      if (s >= minStep) this._stepGuides.delete(s);
    }
  }

  _addStepGuideCell(step, cell) {
    // Invalidate step guides, including the current step.
    // We don't want the current value to remain.
    this._invalidateStepGuides(step);
    this._stepGuides.set(step, { cell: cell });
  }

  _addStepGuideValue(step, value) {
    // Invalid step guides which come after this step.
    // We still want to keep any cell guides on this step.
    this._invalidateStepGuides(step + 1);
    if (!this._stepGuides.has(step)) {
      this._stepGuides.set(step, {});
    }
    this._stepGuides.get(step).value = value;
    this._listener();
  }

  _handleStep(i, result) {
    if (result == null) {
      this._numSteps = i;
      return {
        description: `Step ${i} [Done]`,
        diff: [],
        solution: null,
        statusElem: null,
        highlightCells: [],
      };
    }
    let statusText = result.isSolution ? '[Solution]' :
      result.hasContradiction ? '[Conflict]' : '';

    const statusElem = document.createElement('span');
    if (result.values && result.values.length) {
      statusElem.appendChild(document.createTextNode('{'));
      let first = true;
      for (const value of result.values) {
        if (!first) statusElem.appendChild(document.createTextNode(','));
        first = false;

        let valueLink = document.createElement('a');
        valueLink.href = 'javascript:void(0)';
        valueLink.textContent = value;
        valueLink.onclick = this._addStepGuideValue.bind(this, i, value);
        statusElem.appendChild(valueLink);
      }
      statusElem.appendChild(document.createTextNode('}'));
    }
    statusElem.appendChild(document.createTextNode(' ' + statusText));

    // Update numSteps if we have a new max.
    if (i + 1 > this._numSteps) {
      this._numSteps = i + 1;
    }
    return {
      solution: result.pencilmarks,
      diff: result.diffPencilmarks || [],
      statusElem: statusElem,
      description: `Step ${i}`,
      highlightCells: result.latestCell ? [result.latestCell] : [],
    }
  }

  async get(i) {
    this._pending = this._solver.nthStep(i, this._stepGuides);
    const result = await this._pending;
    this._pending = null;
    return this._handleStep(i, result);
  }
}

class CountSolutionsModeHandler extends ModeHandler {
  static NAME = 'count-solutions';
  static DESCRIPTION =
    `Count the total number of solutions by iterating over all solutions.`;

  add(...solutions) {
    this._solutions = [solutions.pop()];
    super.add(...solutions);
  }

  async run(solver) {
    await super.run(solver);
    await this._solver.countSolutions();
  }

  async get(i) {
    if (this._solutions.length === 0) return {};
    return {
      solution: this._solutions[0],
      description: 'Sample solution',
    }
  }
}

class ValidateLayoutModeHandler extends ModeHandler {
  static NAME = 'validate-layout';
  static DESCRIPTION = `Check if there are any possible solutions given the
      current layout constraints, especially jigsaw pieces.
      Non-layout constraints are ignored (including givens).`;

  constructor() {
    super();
    this._result = null;
  }

  async run(solver) {
    await super.run(solver);
    this._result = await this._solver.validateLayout();
    this._listener();
    return this._result;
  }

  async get(i) {
    if (!this._done) return {};
    return {
      solution: this._result,
      description: this._result
        ? 'Valid layout [Sample solution]'
        : 'Invalid layout'
    };
  }
}

class EstimatedCountSolutionsModeHandler extends ModeHandler {
  static NAME = 'estimate-solutions';
  static DESCRIPTION =
    'Estimate the total number of solutions using monte carlo sampling.';

  add(...solutions) {
    this._solutions = [solutions.pop()];
    super.add(...solutions);
  }

  async run(solver) {
    await super.run(solver);
    await this._solver.estimatedCountSolutions();
  }

  async get(i) {
    if (this._solutions.length === 0) return {};
    return {
      solution: this._solutions[0],
      description: 'Sample solution',
    }
  }
}

const Modes = {
  ALL_POSSIBILITIES: AllPossibilitiesModeHandler,
  SOLUTIONS: AllSolutionsModeHandler,
  COUNT_SOLUTIONS: CountSolutionsModeHandler,
  ESTIMATE_SOLUTIONS: EstimatedCountSolutionsModeHandler,
  STEP_BY_STEP: StepByStepModeHandler,
  VALIDATE_LAYOUT: ValidateLayoutModeHandler,
};

export class SolutionController {
  constructor(constraintManager, displayContainer) {
    this._activeSession = null;

    this._shape = null;
    constraintManager.addReshapeListener(this);

    this._displayContainer = displayContainer;
    this._solutionDisplay = new SolutionDisplay(
      displayContainer.getNewGroup('solution-group'));
    constraintManager.addReshapeListener(this._solutionDisplay);

    this._diffDisplay = new CellValueDisplay(
      displayContainer.getNewGroup('diff-group'));
    constraintManager.addReshapeListener(this._diffDisplay);

    this._isSolving = false;
    this._constraintManager = constraintManager;
    this._stepHighlighter = displayContainer.createCellHighlighter('step-cell');
    displayContainer.addElement(
      HighlightDisplay.makeRadialGradient('highlighted-step-gradient'));

    this.debugManager = new DebugManager(displayContainer, constraintManager);
    constraintManager.addReshapeListener(this.debugManager);

    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.addUpdateListener(this._update.bind(this));

    this._elements = {
      start: document.getElementById('solution-start'),
      end: document.getElementById('solution-end'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      buttonPanel: document.getElementById('solution-control-buttons'),
      iterationState: document.getElementById('solution-iteration-state'),
      mode: document.getElementById('solve-mode-input'),
      modeDescription: document.getElementById('solve-mode-description'),
      error: document.getElementById('error-panel').appendChild(
        document.createElement('div')),
      stop: document.getElementById('stop-solver'),
      solve: document.getElementById('solve-button'),
      autoSolve: document.getElementById('auto-solve-input'),
      download: document.getElementById('download-solutions-button'),
    }

    this._elements.mode.onchange = () => this._update();
    this._elements.stop.onclick = () => this._terminateActiveSession();
    this._elements.solve.onclick = () => this._solve();

    this._setUpAutoSolve();
    this._setUpKeyBindings(displayContainer);

    this._stateDisplay = new SolverStateDisplay(this._solutionDisplay);

    this._historyHandler = new HistoryHandler((params) => {
      const mode = params.get('mode');
      if (mode) this._elements.mode.value = mode;

      const constraintsText = params.get('q') || '.';
      this._constraintManager.loadUnsafeFromText(constraintsText);
    });

    this._update();
  }

  reshape(shape) {
    // Terminate any runnings solvers ASAP, so they are less
    // likely to cause problems sending stale data.
    this._shape = shape;
    this._terminateActiveSession();
  }

  _setUpAutoSolve() {
    this._elements.autoSolve.checked = (
      sessionAndLocalStorage.getItem('autoSolve') !== 'false');

    this._elements.autoSolve.onchange = () => {
      let isChecked = this._elements.autoSolve.checked ? true : false;
      sessionAndLocalStorage.setItem('autoSolve', isChecked);
      // If we have enabled auto-solve, then start solving! Unless
      // we are already solving.
      if (isChecked && !this._isSolving) this._update();
    }
  }

  _setUpKeyBindings(displayContainer) {
    const keyHandlers = {
      n: () => this._elements.forward.click(),
      p: () => this._elements.back.click(),
      s: () => this._elements.start.click(),
    };
    let firingKeys = new Map();

    // Keep running handler every frame as long as the key is still held down.
    const runHandler = (key, handler) => {
      if (!firingKeys.has(key)) return;
      handler();
      window.requestAnimationFrame(() => runHandler(key, handler));
    };

    const FIRE_WAIT = 1;
    const FIRE_FAST = 2;

    document.addEventListener('keydown', event => {
      if (document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'INPUT') return;
      let key = event.key;
      let handler = keyHandlers[key];
      if (!handler) return;

      // Prevent the keypress from affecting the fake-input field.
      event.preventDefault();

      // If the key is not currently pressed, then just fire the handler and
      // record that they key has been pressed.
      // We don't want to start firing continuously as that makes it way too
      // sensitive.
      if (!firingKeys.has(key)) {
        firingKeys.set(key, FIRE_WAIT);
        handler();
        return;
      }

      // If we haven't started fast fire mode, do so now!
      if (firingKeys.get(key) != FIRE_FAST) {
        firingKeys.set(key, FIRE_FAST);
        runHandler(key, handler);
      }

    });
    document.addEventListener('keyup', event => {
      firingKeys.delete(event.key);
    });

    // Listen for clicks in the solution grid.
    this._altClickHandler = null;
    const clickInterceptor = displayContainer.getClickInterceptor();
    const clickContainer = clickInterceptor.getSvg();
    clickContainer.addEventListener('click', e => {
      // Only do something if it was an alt-click on a valid cell,
      // and there is a handler to handle it.
      if (!this._altClickHandler) return;
      if (!e.altKey) return;
      const target = clickInterceptor.cellAt(e.offsetX, e.offsetY);
      if (target === null) return;

      this._altClickHandler(target);
      e.preventDefault();
    });
  }

  _terminateActiveSession() {
    this._activeSession?.terminate();
    this._activeSession = null;
  }

  _showIterationControls(show) {
    this._elements.buttonPanel.style.visibility = show ? 'visible' : 'hidden';
  }

  static _getHandlerClass(modeName) {
    for (const handler of Object.values(Modes)) {
      if (handler.NAME === modeName) return handler;
    }
    return null;
  }

  static DEFAULT_MODE = Modes.ALL_POSSIBILITIES.NAME;

  async _update() {
    this._solutionDisplay.setSolution();
    let mode = this._elements.mode.value;
    if (!mode) {
      mode = SolutionController.DEFAULT_MODE;
      this._elements.mode.value = mode;
    }
    let auto = this._elements.autoSolve.checked;

    const constraints = this._constraintManager.getConstraints();

    let params = { mode: mode, q: constraints.toString() };
    // Remove mode if it is the default.
    if (mode === SolutionController.DEFAULT_MODE) params.mode = undefined;
    if (params.q === '.') params.q = undefined;
    this._historyHandler.update(params);

    const isLayoutMode = mode === Modes.VALIDATE_LAYOUT.NAME;
    this._displayContainer.toggleLayoutView(isLayoutMode);
    const isEstimateMode = mode === Modes.ESTIMATE_SOLUTIONS.NAME;
    this._stateDisplay.setEstimateMode(isEstimateMode);

    const handlerClass = SolutionController._getHandlerClass(mode);
    this._elements.modeDescription.textContent = handlerClass.DESCRIPTION;

    if (auto || mode === Modes.STEP_BY_STEP.NAME) {
      const solverConstraints = isLayoutMode
        ? this._constraintManager.getLayoutConstraints()
        : constraints;
      this._solve(solverConstraints);
    } else {
      this._resetSolver();
    }
  }

  _resetSolver() {
    this._terminateActiveSession();
    this._stepHighlighter.setCells([]);
    this._solutionDisplay.setSolution();
    this._diffDisplay.clear();
    this._stateDisplay.clear();
    this.debugManager.clear();
    this._showIterationControls(false);
    this._altClickHandler = null;
    clearDOMNode(this._elements.error);
    clearDOMNode(this._elements.iterationState);
  }

  async _solve(constraints) {
    const mode = this._elements.mode.value;
    this._replaceAndRunSolver(mode, constraints);
  }

  async _replaceAndRunSolver(mode, constraints) {
    constraints ||= mode === Modes.VALIDATE_LAYOUT.NAME
      ? this._constraintManager.getLayoutConstraints()
      : this._constraintManager.getConstraints();

    this._resetSolver();

    this._terminateActiveSession();
    const session = new SolverSession();
    this._activeSession = session;

    const handlerClass = SolutionController._getHandlerClass(mode);
    const handler = new handlerClass();

    let newSolver = null;
    try {
      newSolver = await SolverProxy.makeSolver(
        constraints,
        s => {
          this._stateDisplay.setState(s);
          if (s.extra && s.extra.solutions) {
            handler.add(...s.extra.solutions);
          }
          if (s.done) { handler.setDone(); }
        },
        this._solveStatusChanged.bind(this),
        this.debugManager);
    } catch (e) {
      this._elements.error.textContent = e.toString();
      this._stateDisplay.setSolveStatus(false, 'terminate');
      return;
    }

    session.setSolver(newSolver);

    // Run the handler.
    this._runModeHandler(handler, session);
  }

  _solveStatusChanged(isSolving, method) {
    this._isSolving = isSolving;
    this._stateDisplay.setSolveStatus(isSolving, method);

    if (isSolving) {
      this._elements.stop.disabled = false;
      this._elements.start.disabled = true;
      this._elements.forward.disabled = true;
      this._elements.end.disabled = true;
      this._elements.back.disabled = true;
    } else {
      this._elements.stop.disabled = true;
    }
  }

  _runModeHandler(handler, session) {
    if (session.aborted) return;

    handler.run(session.getSolver()).catch(handler.handleSolverException);

    let index = 0;
    let follow = false;
    let currentSolution = null;

    const update = async () => {
      if (session.aborted) return;

      // Update index based on mode and bounds
      if (follow) {
        // In follow mode, set index to the last available view.
        index = handler.maxIndex();
      } else {
        // Clamp index to valid range [0, maxIndex]
        index = clamp(index, 0, handler.maxIndex());
      }

      // Fetch and display the result
      let result = await handler.get(index).catch(handler.handleSolverException);
      if (session.aborted) return;

      if (!result) {
        currentSolution = null;
      } else {
        currentSolution = result.solution;
        if (result.highlightCells) {
          this._stepHighlighter.setCells(result.highlightCells);
        }
      }
      this._solutionDisplay.setSolution(currentSolution);

      if (result?.diff) {
        this._diffDisplay.renderGridValues(result.diff);
      }

      this._elements.iterationState.textContent = result?.description || '';

      // Update button states
      if (result && handler.ITERATION_CONTROLS) {
        const isAtStart = index === 0;
        const isAtEnd = index >= handler.maxIndex();

        this._elements.back.disabled = isAtStart;
        this._elements.start.disabled = isAtStart;
        this._elements.forward.disabled = isAtEnd;
        this._elements.end.disabled = isAtEnd;

        if (result.statusElem) {
          this._elements.iterationState.appendChild(
            document.createTextNode(' '));
          this._elements.iterationState.appendChild(result.statusElem);
        }
      }

      // Continue following if we haven't caught up to the latest view
      if (follow && index < handler.maxIndex() && !session.aborted) {
        update();
      }
    };
    handler.setUpdateListener(update);

    if (handler.ITERATION_CONTROLS) {
      this._elements.forward.onclick = () => {
        index++;
        follow = false;
        update();
      };
      this._elements.back.onclick = () => {
        index--;
        follow = false;
        update();
      };
      this._elements.start.onclick = () => {
        index = 0;
        follow = false;
        update();
      };
      this._elements.end.onclick = () => {
        follow = true;
        update();
      };

      this._showIterationControls(true);
    }

    this._elements.download.disabled = !handler.ALLOW_DOWNLOAD;
    if (handler.ALLOW_DOWNLOAD) {
      this._elements.download.onclick = () => {
        const solutions = handler.solutions();
        this._downloadSolutionFile(solutions);
      }
    }

    if (handler.ALLOW_ALT_CLICK) {
      this._altClickHandler = (cell) => {
        let cellIndex = this._shape.parseCellId(cell).cell;
        if (!currentSolution || !isIterable(currentSolution[cellIndex])) return;
        handler.handleAltClick(index, cellIndex);
      }
    }

    update();
  }

  _downloadSolutionFile(solutions) {
    // Create the object URL.
    const text = solutions.map(s => toShortSolution(s, this._shape)).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    // Create a dummy element and click it.
    const elem = window.document.createElement('a');
    elem.href = url;
    elem.download = `sudoku-iss-solutions-${localTimestamp()}.txt`;
    document.body.appendChild(elem);
    elem.click();
    document.body.removeChild(elem);
  }
}

class SolverSession {
  constructor() {
    this._abortController = new AbortController();
    this._solver = null;
  }

  get aborted() {
    return this._abortController.signal.aborted;
  }

  terminate() {
    this._abortController.abort();
    this._solver?.terminate();
  }

  getSolver() {
    if (this.aborted) return null;
    return this._solver;
  }

  setSolver(solver) {
    if (this._solver !== null) {
      throw ('Solver already set for session');
    }
    this._solver = solver;
    if (this.aborted) {
      solver.terminate();
    }
  }
}

export class SolverProxy {
  // Ask for a state update every 2**13 iterations.
  // NOTE: Using a non-power of 10 makes the display look faster :)
  static LOG_UPDATE_FREQUENCY = 13;

  static _unusedWorkers = [];

  static async makeSolver(constraints, stateHandler, statusHandler, debugHandler) {
    // Ensure any pending terminations are enacted.
    await new Promise(r => setTimeout(r, 0));

    if (!this._unusedWorkers.length) {
      const worker = new Worker(
        'js/solver_worker.js' + self.VERSION_PARAM, { type: 'module' });
      this._unusedWorkers.push(worker);
    }
    const worker = this._unusedWorkers.pop();
    worker.release = () => this._unusedWorkers.push(worker);

    const solverProxy = new SolverProxy(
      worker, stateHandler, statusHandler,
      debugHandler?.getCallback());
    await solverProxy.init(
      constraints, this.LOG_UPDATE_FREQUENCY,
      debugHandler?.getOptions());
    return solverProxy;
  }

  constructor(worker, stateHandler, statusHandler, debugHandler) {
    if (!worker) {
      throw ('Must provide worker');
    }

    this._worker = worker;
    this._messageHandler = (msg) => this._handleMessage(msg);
    this._worker.addEventListener('message', this._messageHandler);
    this._waiting = null;

    this._initialized = false;
    this._stateHandler = stateHandler || (() => null);
    this._debugHandler = debugHandler || (() => null);
    this._statusHandler = statusHandler || (() => null);
  }

  async solveAllPossibilities() {
    return this._callWorker('solveAllPossibilities');
  }

  async validateLayout() {
    return this._callWorker('validateLayout');
  }

  async nthSolution(n) {
    return this._callWorker('nthSolution', n);
  }

  async nthStep(n, stepGuides) {
    return this._callWorker('nthStep', [n, stepGuides]);
  }

  async countSolutions() {
    return this._callWorker('countSolutions');
  }

  async estimatedCountSolutions() {
    return this._callWorker('estimatedCountSolutions');
  }

  _handleMessage(response) {
    // Solver has been terminated.
    if (!this._worker) return;

    let data = response.data;

    switch (data.type) {
      case 'result':
        this._waiting.resolve(data.result);
        this._statusHandler(false, this._waiting.method);
        this._waiting = null;
        break;
      case 'exception':
        this._waiting.reject(data.error);
        this._statusHandler(false, this._waiting.method);
        this._waiting = null;
        break;
      case 'state':
        this._stateHandler(data.state);
        break;
      case 'debug':
        this._debugHandler(data.data, data.counters);
        break;
    }
  }

  _callWorker(method, payload) {
    if (!this._initialized) {
      throw (`SolverProxy not initialized.`);
    }
    if (!this._worker) {
      throw (`SolverProxy has been terminated.`);
    }
    if (this._waiting) {
      throw (`Can't call worker while a method is in progress. (${this._waiting.method})`);
    }

    this._statusHandler(true, method);

    let promise = new Promise((resolve, reject) => {
      this._waiting = {
        method: method,
        payload: payload,
        resolve: resolve,
        reject: reject,
      }
    });

    this._worker.postMessage({
      method: method,
      payload: payload,
    });

    return promise;
  }

  async init(constraint, logUpdateFrequency, debugOptions) {
    this._initialized = true;
    await this._callWorker(
      'init',
      { constraint, logUpdateFrequency, debugOptions });
  }

  terminate() {
    if (!this._worker) return;
    const worker = this._worker;
    this._worker = null;

    worker.removeEventListener('message', this._messageHandler);
    // If we are waiting, we have to kill it because we don't know how long
    // we'll be waiting. Otherwise we can just release it to be reused.
    if (this._waiting) {
      worker.terminate();
      this._waiting.reject('Aborted worker running: ' + this._waiting.method);
      this._statusHandler(false, 'terminate');
    } else {
      worker.release();
    }
  }

  isTerminated() {
    return this._worker === null;
  }
}

// A info overlay which is lazily loaded.
class InfoOverlay {
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
