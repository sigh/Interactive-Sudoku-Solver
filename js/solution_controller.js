class HistoryHandler {
  MAX_HISTORY = 50;
  HISTORY_ADJUSTMENT = 10;

  constructor(onUpdate) {
    this._blockHistoryUpdates = false;
    this._onUpdate = (params) => {
      this._blockHistoryUpdates = true;
      onUpdate(params);
      this._blockHistoryUpdates = false;
    }

    this._history = [];
    this._historyLocation = -1;

    this._undoButton = document.getElementById('undo-button');
    this._undoButton.onclick = () => this._incrementHistory(-1);
    this._redoButton = document.getElementById('redo-button');
    this._redoButton.onclick = () => this._incrementHistory(+1);

    window.onpopstate = this._reloadFromUrl.bind(this);
    this._reloadFromUrl();
  }

  update(params) {
    if (this._blockHistoryUpdates) return;
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
    let q = this._history[this._historyLocation + delta];
    if (q === undefined) return;
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

class DebugManager {
  DEBUG_PARAM_NAME = 'debug';

  constructor(displayContainer) {
    this._container = document.getElementById('debug-container');
    this._logOutput = document.getElementById('debug-logs');
    this._enabled = false;
    this._shape = null;
    this._infoOverlay = null;
    this._candidateDisplay = null;
    this._checkboxes = [
      ['exportBacktrackCounts', document.getElementById('backtrack-heatmap-checkbox')]
    ];
    this._logLevelElem = document.getElementById('debug-log-level');

    this._debugCellHighlighter = null;
    this._displayContainer = displayContainer;

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
      const loaderPromise = dynamicJSFileLoader('js/debug.js')();

      this._deferredSetup(loaderPromise);

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
    this._debugCellHighlighter = this._displayContainer.createHighlighter('highlighted-cell');
    this._infoOverlay = new InfoOverlay(this._displayContainer);
    this._candidateDisplay = new CellValueDisplay(
      this._displayContainer.getNewGroup('debug-candidate-group'));

    // Initialize options checkboxes.
    for (const [key, element] of this._checkboxes) {
      const value = localStorage.getItem(key);
      if (value !== undefined) {
        element.checked = (value === 'true');
      }
      element.onchange = () => {
        localStorage.setItem(key, element.checked);
      }
    }

    // Log level selector.
    {
      const logLevelElem = this._logLevelElem;
      const value = localStorage.getItem('logLevel');
      logLevelElem.value = value || '0';
      logLevelElem.onchange = () => {
        localStorage.setItem('logLevel', logLevelElem.value);
      };
    }

    // Setup hover elements.
    const elements = [
      ['debug-cell-id', (index) => this._shape.makeCellIdFromIndex(index)],
      ['debug-cell-index', (index) => index],
    ];

    for (const [id, fn] of elements) {
      const element = document.getElementById(id);
      const overlayValuesFn = () => {
        const numCells = this._shape.numCells;
        return [...new Array(numCells).keys()].map(fn);
      };
      this._setInfoOverlayOnHover(element, overlayValuesFn);
    }

    // Debug puzzle loader.
    loaderPromise.then(() => {
      debugFilesLoaded.then(() => {
        this._loadDebugPuzzleInput();
      });
    });

    // Call reshape so that all dependencies are initialized with the shape.
    if (this._shape) {
      this.reshape(this._shape);
    }
  }

  static _makeDebugIndex() {
    const index = new Map();
    for (const puzzle of PUZZLE_INDEX.values()) {
      const constraintTypes = SudokuParser.extractConstraintTypes(puzzle.input);
      const title = `${puzzle.name || ''} [${constraintTypes.join(',')}]`;
      index.set(title, puzzle);
    }

    const puzzleLists = {
      TAREK_ALL,
      EXTREME_KILLERS,
      HARD_THERMOS,
      MATHEMAGIC_KILLERS,
      HARD_RENBAN,
      HARD_PENCILMARKS,
      HS_KILLERS,
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

  _loadDebugPuzzleInput() {
    const debugIndex = this.constructor._makeDebugIndex();
    const datalist = document.getElementById('debug-puzzles');
    for (const name of debugIndex.keys()) {
      const option = document.createElement('option');
      option.value = name;
      datalist.appendChild(option);
    }

    const input = document.getElementById('debug-puzzle-input');
    input.onchange = () => {
      const name = input.value;
      // Clear the input after a short time so the user can still notice
      // what was selected.
      window.setTimeout(() => {
        input.value = '';
      }, 300);

      const puzzle = debugIndex.get(name);
      if (puzzle) {
        loadInput(puzzle);
      }
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
    return options;
  }

  getCallback() {
    return (data => this._update(data));
  }

  reshape(shape) {
    this.clear();
    this._shape = shape;
    this._infoOverlay?.reshape(shape);
    this._candidateDisplay?.reshape(shape);
  }

  clear() {
    this._logOutput.textContent = '';
    this._infoOverlay?.clear();

    this._logDedupe = {
      lastKey: '',
      count: 0,
      currentSpan: null,
    };
  }

  _update(data) {
    if (!this._enabled) return;


    if (data.logs) {
      const isScrolledToBottom = this._isScrolledToBottom(this._logOutput);

      data.logs.forEach(l => this._addLog(l));

      if (isScrolledToBottom) {
        this._scrollToBottom(this._logOutput);
      }
    }

    if (data.backtrackCounts) {
      this._infoOverlay.setHeatmapValues(data.backtrackCounts);
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
      this._logOutput.append(this._logDedupe.currentSpan);
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

    this._logOutput.append(elem);
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

  _setInfoOverlayOnHover(elem, data) {
    elem.addEventListener('mouseover', () => {
      let values = data;
      if (typeof data === 'function') values = data();
      this._infoOverlay.setValues(values);
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

class StateHistoryDisplay {
  CHART_HEIGHT = 120;
  CONTAINER_WIDTH = 400;
  AXIS_WIDTH = 50;
  MAX_NUM_STATES = 1000;

  constructor() {
    this._states = [];
    this._statsContainer = null;
    this._visible = false;

    this._setUpChartButton();
    this._charts = [];

    this._updateCharts = deferUntilAnimationFrame(
      this._updateCharts.bind(this));

    this.clear();
  }

  add(state) {

    const newState = {
      timeMs: state.timeMs / 1000,
      guesses: state.counters.guesses,
      searchedPercentage: state.counters.progressRatio * 100,
      skippedPercentage: state.counters.branchesIgnored * 100,
      solutions: state.counters.solutions,
    };

    if (this._states.length && newState.timeMs < this._nextT) {
      // If the new state is too soon then just update last point.
      this._states[this._states.length - 1] = newState;
    } else {
      // The new state is sufficiently new, so add a new data point.
      this._states.push(newState);
      this._nextT += this._deltaT;
    }

    // NOTE: Both of these defer work until it needs to be done.
    this._compressStates(this._states);
    this._updateCharts();
  }

  _compressStates(states) {
    if (states.length <= this.MAX_NUM_STATES) return;

    // Figure out the minimum time delta between states.
    const targetCount = this.MAX_NUM_STATES / 2;
    const deltaT = states[states.length - 1].timeMs / targetCount;

    // Remove states which are too close together.
    let j = 0;
    let nextT = 0;
    for (let i = 0; i < states.length - 1; i++) {
      const state = states[i];
      if (state.timeMs >= nextT) {
        nextT += deltaT;
        states[j++] = state;
      }
    }

    // Always include the last state.
    states[j++] = states[states.length - 1];

    // Truncate the states.
    states.length = j;

    // Update the global deltaT and nextT.
    this._deltaT = deltaT;
    this._nextT = nextT;
  }

  _updateCharts() {
    if (!this._visible || !this._charts.length) {
      return;
    }

    this._eventReplayFn();
    for (const chart of this._charts) {
      chart.update('none');
    }
  }

  clear() {
    this._deltaT = 0;
    this._nextT = 0;
    // NOTE: _states must be updated in place since we have passed it into the
    //       chart.
    this._states.length = 0;
  }

  _setUpChartButton() {
    const button = document.getElementById('chart-button');
    button.onclick = () => {
      // Ensure container is initialized.
      this._initStatsContainer();
      // Toggle visibility.
      if (this._visible) {
        this._statsContainer.style.display = 'none';
        this._visible = false;
        return;
      }

      this._statsContainer.style.display = 'block';
      this._visible = true;
      this._updateCharts();
    };
    button.disabled = false;
  }

  static _openAndPositionContainer(container) {
    container.style.top = ((window.innerHeight / 2) - (container.offsetHeight / 2)) + 'px';
    container.style.left = ((window.innerWidth / 2) - (container.offsetWidth / 2)) + 'px';
    container.style.display = 'block';
  }

  async _initStatsContainer() {
    if (this._statsContainer) return;

    this._statsContainer = document.getElementById('stats-container');
    await dynamicJSFileLoader('lib/chart.umd.min.js')();

    this._setUpStatsWindow(this._statsContainer);

    this._addChartDisplay(this._statsContainer,
      'Solutions', 'solutions');
    this._addChartDisplay(this._statsContainer,
      'Progress percentage (searched + skipped)',
      'searchedPercentage', 'skippedPercentage');
    this._addChartDisplay(this._statsContainer,
      'Guesses', 'guesses');

    this._eventReplayFn = this._syncToolTips(this._charts);
  }

  _setUpStatsWindow(container) {
    document.getElementById('chart-close-button').onclick = () => {
      container.style.display = 'none';
    }
    container.style.width = this.CONTAINER_WIDTH + 'px';

    makeDraggable(container, document.getElementById('stats-header'));
  }

  _addChartDisplay(container, title, ...yAxis) {
    const titleElem = document.createElement('div');
    titleElem.classList.add('description');
    titleElem.textContent = title;
    container.appendChild(titleElem);

    const chartContainer = document.createElement('div');
    chartContainer.style.height = this.CHART_HEIGHT;
    container.appendChild(chartContainer);

    const ctx = document.createElement('canvas');
    chartContainer.appendChild(ctx);
    this._makeChart(ctx, ...yAxis);
    return chartContainer;
  }

  _makeChart(ctx, ...yAxis) {
    const options = {
      events: [], // We will manually implement hover.
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      pointRadius: 0,
      animation: false,
      parsing: {
        xAxisKey: 'timeMs',
      },
      elements: {
        line: { borderWidth: 1 },
      },
      scales: {
        x: {
          type: 'linear',
          grace: 0,
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback: function (...args) {
              // Use function so that `this` is bound.
              return Chart.Ticks.formatters.numeric.apply(this, args) + 's';
            }
          },
        },
        y: {
          stacked: true,
          afterFit: (axis) => { axis.width = this.AXIS_WIDTH; },
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback: formatNumberMetric,
          }
        }
      },
      plugins: {
        legend: {
          display: false,
        },
      }
    };
    const data = {
      datasets: yAxis.map((key) => ({
        label: key,
        data: this._states,
        stepped: true,
        parsing: {
          yAxisKey: key,
        },
      }))
    };
    const config = {
      type: 'line',
      data: data,
      options: options,
    };

    const chart = new Chart(ctx, config);
    this._charts.push(chart);
    return chart;
  }

  _syncToolTips(charts) {
    let currentIndex = -1;
    let lastCall = null;

    const onMouseMouse = (e, currentChart) => {
      lastCall = [e, currentChart];

      // Find the nearest points.
      const points = currentChart.getElementsAtEventForMode(
        e, 'index', { intersect: false }, true);

      // If it is the currently active index, then nothing needs to change.
      const index = points.length ? points[0].index : -1;
      if (index == currentIndex) return;

      // Update the active elements for all the charts.
      currentIndex = index;
      for (const chart of charts) {
        const activeElements = [];
        if (points.length) {
          const numDatasets = chart.data.datasets.length;
          for (let i = 0; i < numDatasets; i++) {
            activeElements.push({
              index: index,
              datasetIndex: i,
            });
          }
        }
        chart.tooltip.setActiveElements(activeElements);
        chart.setActiveElements(activeElements);
        chart.render();
      }
    };

    // Setup all charts.
    for (const chart of charts) {
      chart.canvas.onmousemove = e => onMouseMouse(e, chart);
    }

    // Pass back a function that will allow us to replay the last call.
    // This is used when the chart is updated to ensure the tooltip is updated
    // if the point under the mouse changes.
    return () => { lastCall && onMouseMouse(...lastCall); };
  }
}

class SolverStateDisplay {
  constructor(solutionDisplay) {
    this._solutionDisplay = solutionDisplay;

    this._elements = {
      progressContainer: document.getElementById('progress-container'),
      stateOutput: document.getElementById('state-output'),
      error: document.getElementById('error-output'),
      progressBar: document.getElementById('solve-progress'),
      progressPercentage: document.getElementById('solve-percentage'),
      solveStatus: document.getElementById('solve-status'),
    };

    this._setUpStateOutput();
    this._stateHistory = new StateHistoryDisplay();

    this._lazyUpdateState = deferUntilAnimationFrame(
      this._lazyUpdateState.bind(this));
  }

  _lazyUpdateState(state) {
    this._displayStateVariables(state);

    this._updateProgressBar(state);
  }

  _METHOD_TO_STATUS = {
    'solveAllPossibilities': 'Solving',
    'nthSolution': 'Solving',
    'nthStep': '',
    'countSolutions': 'Counting',
    'validateLayout': 'Validating',
    'terminate': 'Aborted',
  };

  setSolveStatus(isSolving, method) {
    if (!isSolving && method == 'terminate') {
      this._elements.solveStatus.textContent = this._METHOD_TO_STATUS[method];
      this._elements.progressContainer.classList.add('error');
      return;
    }

    if (isSolving) {
      this._elements.solveStatus.textContent = this._METHOD_TO_STATUS[method];
    } else {
      this._elements.solveStatus.textContent = '';
    }
    this._elements.progressContainer.classList.remove('error');
  }

  setState(state) {
    this._lazyUpdateState(state);
    // Don't update state history lazily, as that will cause gaps when
    // the window is not active.
    this._stateHistory.add(state);
  }

  clear() {
    for (const v in this._stateVars) {
      this._stateVars[v].textContent = '';
    }
    this._elements.progressBar.setAttribute('value', 0);
    this._elements.progressPercentage.textContent = '';
    this.setSolveStatus(false, '');
    this._elements.solveStatus.textContent = '';
    this._stateHistory.clear();
  }

  _displayStateVariables(state) {
    const counters = state.counters;
    const searchComplete = state.done && !counters.branchesIgnored;

    for (const v in this._stateVars) {
      let text;
      switch (v) {
        case 'solutions':
          this._renderNumberWithGaps(this._stateVars[v], counters[v]);
          if (!searchComplete) {
            this._stateVars[v].appendChild(document.createTextNode('+'));
          }
          break;
        case 'puzzleSetupTime':
          text = state.puzzleSetupTime ? formatTimeMs(state.puzzleSetupTime) : '?';
          this._stateVars[v].textContent = text;
          break;
        case 'runtime':
          text = formatTimeMs(state.timeMs);
          this._stateVars[v].textContent = text;
          break;
        case 'searchSpaceExplored':
          text = (counters.progressRatio * 100).toPrecision(3) + '%';
          if (searchComplete) text = '100%';
          this._stateVars[v].textContent = text;
          break;
        default:
          this._renderNumberWithGaps(this._stateVars[v], counters[v]);
      }
    }
  }

  _TEMPLATE_GAP_SPAN = (() => {
    const span = document.createElement('span');
    span.classList.add('number-gap');
    return span;
  })();

  _renderNumberWithGaps(container, number) {
    clearDOMNode(container);
    const numberStr = number.toString();

    let index = (numberStr.length % 3) || 3;
    container.appendChild(document.createTextNode(
      numberStr.substring(0, index)));
    while (index < numberStr.length) {
      container.appendChild(this._TEMPLATE_GAP_SPAN.cloneNode());
      container.appendChild(document.createTextNode(
        numberStr.substring(index, index + 3)));
      index += 3;
    }
  }

  _updateProgressBar(state) {
    const progress = state.done
      ? 1
      : state.counters.progressRatio + state.counters.branchesIgnored;
    const percent = Math.round(progress * 100);
    this._elements.progressBar.setAttribute('value', progress);
    this._elements.progressPercentage.textContent = percent + '%';
  }

  _setUpStateOutput() {
    let container = this._elements.stateOutput;
    let vars = [
      'solutions',
      'guesses',
      'backtracks',
      'nodesSearched',
      'valuesTried',
      'constraintsProcessed',
      'searchSpaceExplored',
      'puzzleSetupTime',
      'runtime',
    ];
    this._stateVars = {};
    for (const v of vars) {
      let elem = document.createElement('div');
      let value = document.createElement('span');
      let title = document.createElement('span');
      title.textContent = camelCaseToWords(v);
      title.className = 'description';
      if (v == 'solutions') title.style.fontSize = '16px';
      elem.appendChild(value);
      elem.appendChild(title);
      container.appendChild(elem);

      this._stateVars[v] = value;
    }
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

  minIndex() { return 1; }

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

  count() {
    return this._solutions.length;
  }

  async get(i) {
    let description = `Solution ${i}`;
    if (this.count() == 1 && this.done()) description = 'Unique solution';
    return {
      solution: this._solutions[i - 1],
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

ModeHandler.AllPossibilities = class extends ModeHandler {
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

  minIndex() {
    // If we are done, and there is only one solution, then don't bother
    // showing the summary.
    return this.done() && this.count() == 1 ? 1 : 0;
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
    if (i == 0) return {
      solution: this._pencilmarks,
      description: 'All possibilities',
    }
    return super.get(i);
  }
}

ModeHandler.AllSolutions = class extends ModeHandler {
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
      if (this.count() >= this._targetCount) return;

      this._pending = this._solver.nthSolution(this.count());
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
    this._targetCount = i + 1;
    this._fetchSolutions().catch(this.handleSolverException);

    return super.get(i);
  }
}

ModeHandler.StepByStep = class extends ModeHandler {
  ITERATION_CONTROLS = true;
  ALLOW_ALT_CLICK = true;

  constructor() {
    super();
    this._pending = null;
    this._numSteps = 0;
    this._stepGuides = new Map();
  }

  setDone() { }

  minIndex() {
    return 0;
  }

  async run(solver) {
    await super.run(solver);
  }

  count() {
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

ModeHandler.CountSolutions = class extends ModeHandler {
  add(...solutions) {
    this._solutions = [solutions.pop()];
    super.add(...solutions);
  }

  async run(solver) {
    await super.run(solver);
    await this._solver.countSolutions();
  }

  async get(i) {
    return { solution: this._solutions[0] }
  }
}

ModeHandler.ValidateLayout = class extends ModeHandler {
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

  async get() {
    if (this._result === null) return null;
    return {
      validateResult: this._result ? 'Valid layout' : 'Invalid layout'
    };
  }
}

class SolutionController {
  constructor(constraintManager, displayContainer) {
    // Solvers are a list in case we manage to start more than one. This can
    // happen when we are waiting for a worker to initialize.
    this._solverPromises = [];

    this._currentModeHandler = null;

    this._shape = null;
    constraintManager.addReshapeListener(this);

    this._solutionDisplay = new SolutionDisplay(
      displayContainer.getNewGroup('solution-group'));
    constraintManager.addReshapeListener(this._solutionDisplay);

    this._diffDisplay = new CellValueDisplay(
      displayContainer.getNewGroup('diff-group'));
    constraintManager.addReshapeListener(this._diffDisplay);

    this._isSolving = false;
    this._constraintManager = constraintManager;
    this._stepHighlighter = displayContainer.createHighlighter('highlighted-step-cell');
    displayContainer.addElement(
      HighlightDisplay.makeRadialGradient('highlighted-step-gradient'));

    this.debugManager = new DebugManager(displayContainer);
    constraintManager.addReshapeListener(this.debugManager);

    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.setUpdateCallback(this._update.bind(this));

    this._modeHandlers = {
      'all-possibilities': ModeHandler.AllPossibilities,
      'solutions': ModeHandler.AllSolutions,
      'count-solutions': ModeHandler.CountSolutions,
      'step-by-step': ModeHandler.StepByStep,
      'validate-layout': ModeHandler.ValidateLayout,
    };

    this._elements = {
      start: document.getElementById('solution-start'),
      end: document.getElementById('solution-end'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      control: document.getElementById('solution-control-panel'),
      iterationState: document.getElementById('solution-iteration-state'),
      mode: document.getElementById('solve-mode-input'),
      modeDescription: document.getElementById('solve-mode-description'),
      error: document.getElementById('error-output'),
      validateResult: document.getElementById('validate-result-output'),
      stop: document.getElementById('stop-solver'),
      solve: document.getElementById('solve-button'),
      validate: document.getElementById('validate-layout-button'),
      autoSolve: document.getElementById('auto-solve-input'),
      download: document.getElementById('download-solutions-button'),
    }

    this._elements.mode.onchange = () => this._update();
    this._elements.stop.onclick = () => this._terminateSolver();
    this._elements.solve.onclick = () => this._solve();
    this._elements.validate.onclick = () => this._validateLayout();

    this._setUpAutoSolve();
    this._setUpKeyBindings(displayContainer);

    this._stateDisplay = new SolverStateDisplay(this._solutionDisplay);

    this._historyHandler = new HistoryHandler((params) => {
      let mode = params.get('mode');
      if (mode) this._elements.mode.value = mode;

      let constraintsText = params.get('q');
      if (constraintsText) {
        this._constraintManager.loadUnsafeFromText(constraintsText);
      }
    });

    this._update();
  }

  reshape(shape) {
    // Terminate any runnings solvers ASAP, so they are less
    // likely to cause problems sending stale data.
    this._shape = shape;
    this._terminateSolver();
  }

  _setUpAutoSolve() {
    this._elements.autoSolve.checked = (
      localStorage.getItem('autoSolve') !== 'false');

    this._elements.autoSolve.onchange = () => {
      let isChecked = this._elements.autoSolve.checked ? true : false;
      localStorage.setItem('autoSolve', isChecked);
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

  _terminateSolver() {
    for (const promise of this._solverPromises) {
      promise.then(solver => solver.terminate());
    }
    this._solverPromises = [];
  }

  _showIterationControls(show) {
    this._elements.control.style.visibility = show ? 'visible' : 'hidden';
  }

  static _MODE_DESCRIPTIONS = {
    'all-possibilities':
      'Show all values which are present in any valid solution.',
    'solutions':
      'View each solution.',
    'count-solutions':
      'Count the total number of solutions by iterating over all solutions.',
    'step-by-step':
      'Step through the solving process. ' +
      'Alt-click on a cell to force the solver to resolve it next.',
  };

  async _update() {
    this._solutionDisplay.setSolution();
    this._solutionDisplay.setNewConstraints(this._constraintManager);
    let constraints = this._constraintManager.getConstraints();
    let mode = this._elements.mode.value;
    let auto = this._elements.autoSolve.checked;

    let params = { mode: mode, q: constraints };
    // Remove mode if it is the default.
    if (mode == 'all-possibilities') params.mode = undefined;
    this._historyHandler.update(params);

    let description = SolutionController._MODE_DESCRIPTIONS[mode];
    this._elements.modeDescription.textContent = description;

    if (auto || mode === 'step-by-step') {
      this._solve(constraints);
    } else {
      this._resetSolver();
    }
  }

  _resetSolver() {
    this._terminateSolver();
    this._stepHighlighter.setCells([]);
    this._solutionDisplay.setSolution();
    this._diffDisplay.clear();
    this._stateDisplay.clear();
    this._setValidateResult();
    this.debugManager.clear();
    this._showIterationControls(false);
    this._currentModeHandler = null;
    this._altClickHandler = null;
    clearDOMNode(this._elements.error);
  }

  async _solve(constraints) {
    const mode = this._elements.mode.value;
    this._replaceAndRunSolver(mode, constraints);
  }

  async _validateLayout() {
    const constraints = this._constraintManager.getLayoutConstraint();
    this._replaceAndRunSolver('validate-layout', constraints);
  }

  async _replaceAndRunSolver(mode, constraints) {
    constraints ||= this._constraintManager.getConstraints();

    this._resetSolver();

    const handler = new this._modeHandlers[mode]();

    let newSolver = null;
    try {
      const newSolverPromise = SudokuBuilder.buildInWorker(
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
      this._solverPromises.push(newSolverPromise);

      newSolver = await newSolverPromise;
    } catch (e) {
      this._elements.error.textContent = e.toString();
      this._stateDisplay.setSolveStatus(false, 'terminate');
      return;
    }

    if (newSolver.isTerminated()) return;

    // Run the handler.
    this._currentModeHandler = handler;
    this._runModeHandler(handler, newSolver);
  }

  _setValidateResult(text) {
    this._elements.validateResult.textContent = text || '';
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

  _runModeHandler(handler, solver) {
    handler.run(solver).catch(handler.handleSolverException);

    let index = handler.minIndex();
    let follow = false;
    let currentSolution = null;

    const update = async () => {
      if (follow) {
        index = handler.count();
      } else if (index < handler.minIndex()) {
        index = handler.minIndex();
      }

      let result = await handler.get(index).catch(handler.handleSolverException);
      if (!result) {
        currentSolution = null;
      } else {
        currentSolution = result.solution;
        if (result.validateResult) {
          this._setValidateResult(result.validateResult);
        }
        if (result.highlightCells) {
          this._stepHighlighter.setCells(result.highlightCells);
        }
      }
      this._solutionDisplay.setSolution(currentSolution);

      if (result.diff) {
        this._diffDisplay.renderGridValues(result.diff);
      }

      if (handler.ITERATION_CONTROLS) {
        let minIndex = handler.minIndex();
        this._elements.forward.disabled = (index >= handler.count());
        this._elements.back.disabled = (index == minIndex);
        this._elements.start.disabled = (index == minIndex);
        this._elements.end.disabled = (index >= handler.count());

        this._elements.iterationState.textContent = result.description;
        if (result.statusElem) {
          this._elements.iterationState.appendChild(
            document.createTextNode(' '));
          this._elements.iterationState.appendChild(result.statusElem);
        }
      }

      if (follow && handler.count() > index) {
        update();
      }
    };
    handler.setUpdateListener(update);

    if (handler.ITERATION_CONTROLS) {
      this._elements.forward.onclick = async () => {
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
        index = handler.minIndex();
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