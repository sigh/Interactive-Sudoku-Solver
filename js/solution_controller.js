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

class DebugOutput {
  constructor(displayContainer) {
    this._container = document.getElementById('debug-container');
    this._visible = false;
    this._shape = null;
    this._infoOverlay = new InfoOverlay(displayContainer);;

    this._debugCellHighlighter = displayContainer.createHighlighter('highlighted-cell');
  }

  reshape(shape) {
    this.clear();
    this._shape = shape;
    this._infoOverlay.reshape(shape);
  }

  clear() {
    if (!this._visible) return;

    this._container.textContent = '';
    this._infoOverlay.clear();
  }

  update(data) {
    if (!this._visible) return;

    data.logs.forEach(l => this._addLog(l));

    if (data.debugState && data.debugState.backtrackTriggers) {
      this._infoOverlay.setHeatmapValues(data.debugState.backtrackTriggers);
    }
  }

  setOverlayValues(values) {
    this._infoOverlay.setValues(values);
  }

  _addLog(data) {
    const elem = document.createElement('div');

    const locSpan = document.createElement('span');
    locSpan.textContent = data.loc + ': ';

    const msgSpan = document.createElement('msg');
    let msg = data.msg;
    if (data.args) {
      msg += ' ' + JSON.stringify(data.args).replaceAll('"', '');
    }
    msgSpan.textContent = msg;

    elem.append(locSpan);
    elem.append(msgSpan);

    const shape = this._shape;

    if (data.cells && data.cells.length) {
      const cellIds = [...data.cells].map(c => shape.makeCellId(...shape.splitCellIndex(c)));
      elem.addEventListener('mouseover', () => {
        this._debugCellHighlighter.setCells(cellIds);
      });
      elem.addEventListener('mouseout', () => {
        this._debugCellHighlighter.clear();
      });
    }

    this._container.append(elem);
  }

  enable(enable) {
    if (enable === undefined) enable = true;
    ENABLE_DEBUG_LOGS = enable;
    this._visible = enable;
    this._container.style.display = enable ? 'block' : 'none';
    this.clear();
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
      stepStatus: document.getElementById('step-status'),
    };

    this._setUpStateOutput();

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
  }

  setStepStatus(status) {
    this._elements.stepStatus.textContent = status || '';
  }

  clear() {
    for (const v in this._stateVars) {
      this._stateVars[v].textContent = '';
    }
    this._elements.progressBar.setAttribute('value', 0);
    this._elements.progressPercentage.textContent = '';
    this.setSolveStatus(false, '');
    this._elements.solveStatus.textContent = '';
    this._elements.stepStatus.textContent = '';
  }

  _displayStateVariables(state) {
    const counters = state.counters;
    const searchComplete = state.done && !counters.branchesIgnored;

    for (const v in this._stateVars) {
      let text;
      switch (v) {
        case 'solutions':
          text = counters.solutions + (searchComplete ? '' : '+');
          break;
        case 'puzzleSetupTime':
          text = state.puzzleSetupTime ? formatTimeMs(state.puzzleSetupTime) : '?';
          break;
        case 'runtime':
          text = formatTimeMs(state.timeMs);
          break;
        case 'searchSpaceExplored':
          text = (counters.progressRatio * 100).toPrecision(3) + '%';
          if (searchComplete) text = '100%';
          break;
        default:
          text = counters[v];
      }
      this._stateVars[v].textContent = text;
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
      'cellsSearched',
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

  constructor(solver) {
    this._solver = solver;
    this._solutions = [];
    this._done = false;
    this._listener = () => { };
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
    return this._solutions[i - 1];
  }

  setUpdateListener(fn) {
    this._listener = fn;
  }
}

ModeHandler.AllPossibilities = class extends ModeHandler {
  ITERATION_CONTROLS = true;

  constructor(solver) {
    super(solver);
    this._pencilmarks = [];
  }

  async run() {
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
    if (i == 0) return this._pencilmarks;
    return super.get(i);
  }
}

ModeHandler.AllSolutions = class extends ModeHandler {
  ITERATION_CONTROLS = true;

  constructor(solver) {
    super(solver);
    this._pending = null;
    this._targetCount = 2;
  }

  async run() {
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
    this._fetchSolutions();

    return super.get(i);
  }
}

ModeHandler.StepByStep = class extends ModeHandler {
  ITERATION_CONTROLS = true;

  constructor(solver) {
    super(solver);
    this._pending = null;
    this._numSteps = Infinity;
  }

  setDone() { }

  minIndex() {
    return 0;
  }

  async run() { }

  count() {
    return this._numSteps;
  }

  _handleStep(i, result) {
    if (result == null) {
      this._numSteps = i;
      return {
        pencilmarks: null,
        stepStatus: null,
        latestCell: null,
      };
    }
    let stepStatus = result.isSolution ? 'Solution' :
      result.hasContradiction ? 'Conflict' : null;
    return {
      pencilmarks: result.pencilmarks,
      stepStatus: stepStatus,
      latestCell: result.latestCell,
    }
  }

  async get(i) {
    return this._solver.nthStep(i).then(
      (result) => this._handleStep(i, result));
  }
}

ModeHandler.CountSolutions = class extends ModeHandler {
  add(...solutions) {
    this._solutions = [solutions.pop()];
    super.add(...solutions);
  }

  async run() {
    await this._solver.countSolutions();
  }

  async get(i) {
    return this._solutions[0];
  }
}

ModeHandler.ValidateLayout = class extends ModeHandler {
  constructor(solver) {
    super(solver);
    this._result = null;
  }

  async run() {
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

    this._modeHandler = null;

    constraintManager.addReshapeListener(this);

    this._solutionDisplay = new SolutionDisplay(
      constraintManager, displayContainer.getNewGroup('solution-group'));
    constraintManager.addReshapeListener(this._solutionDisplay);

    this._isSolving = false;
    this._constraintManager = constraintManager;
    this._stepHighlighter = displayContainer.createHighlighter('highlighted-step-cell');
    displayContainer.addElement(
      HighlightDisplay.makeRadialGradient('highlighted-step-gradient'));

    this.debugOutput = new DebugOutput(displayContainer);
    constraintManager.addReshapeListener(this.debugOutput);

    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.setUpdateCallback(this._update.bind(this));

    this._modeHandlers = {
      'all-possibilities': this._runAllPossibilities,
      'solutions': this._runSolutionIterator,
      'count-solutions': this._runCounter,
      'step-by-step': this._runStepIterator,
      'validate-layout': this._runValidateLayout,
    };

    this._elements = {
      start: document.getElementById('solution-start'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      control: document.getElementById('solution-control-panel'),
      stepOutput: document.getElementById('solution-step-output'),
      mode: document.getElementById('solve-mode-input'),
      modeDescription: document.getElementById('solve-mode-description'),
      error: document.getElementById('error-output'),
      validateResult: document.getElementById('validate-result-output'),
      stop: document.getElementById('stop-solver'),
      solve: document.getElementById('solve-button'),
      validate: document.getElementById('validate-layout-button'),
      autoSolve: document.getElementById('auto-solve-input'),
    }

    this._elements.mode.onchange = () => this._update();
    this._elements.stop.onclick = () => this._terminateSolver();
    this._elements.solve.onclick = () => this._solve();
    this._elements.validate.onclick = () => this._validateLayout();

    this._setUpAutoSolve();
    this._setUpKeyBindings();

    this._stateDisplay = new SolverStateDisplay(this._solutionDisplay);

    this._historyHandler = new HistoryHandler((params) => {
      let mode = params.get('mode');
      if (mode) this._elements.mode.value = mode;

      let constraintsText = params.get('q');
      if (constraintsText) {
        this._constraintManager.loadFromText(constraintsText);
      }
    });

    this._update();
  }

  reshape() {
    // Terminate any runnings solvers ASAP, so they are less
    // likely to cause problems sending stale data.
    this._terminateSolver();
  }

  getSolutionValues() {
    return this._solutionDisplay.getSolutionValues();
  }

  _setUpAutoSolve() {
    try {
      const cookieValue = document.cookie
        .split('; ')
        .find(row => row.startsWith('autoSolve='))
        .split('=')[1];
      this._elements.autoSolve.checked = cookieValue !== 'false';
    } catch (e) { /* ignore */ }

    this._elements.autoSolve.onchange = () => {
      let isChecked = this._elements.autoSolve.checked ? true : false;
      document.cookie = `autoSolve=${isChecked}`;
      // If we have enabled auto-solve, then start solving! Unless
      // we are already solving.
      if (isChecked && !this._isSolving) this._update();
    }
  }

  _setUpKeyBindings() {
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
      if (document.activeElement.tagName == 'TEXTAREA') return;
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
      'Step through the solving process.',
  };

  async _update() {
    this._solutionDisplay.setSolutionNew(null);
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
    this._solutionDisplay.setSolutionNew(null);
    this._stateDisplay.clear();
    this._setValidateResult();
    this.debugOutput.clear();
    this._showIterationControls(false);
    this._modeHandler = null;
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

    const newSolverPromise = SudokuBuilder.buildInWorker(
      constraints,
      s => {
        this._stateDisplay.setState(s);
        if (!this._modeHandler) return;
        if (s.extra && s.extra.solutionsToStore) {
          this._modeHandler.add(...s.extra.solutionsToStore);
        }
        if (s.done) { this._modeHandler.setDone(); }
      },
      this._solveStatusChanged.bind(this),
      data => this.debugOutput.update(data));
    this._solverPromises.push(newSolverPromise);

    const newSolver = await newSolverPromise;

    if (newSolver.isTerminated()) return;

    const handler = this._modeHandlers[mode].bind(this);

    handler(newSolver)
      .catch(e => {
        if (!e.toString().startsWith('Aborted')) {
          throw (e);
        }
      });
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
      this._elements.back.disabled = true;
    } else {
      this._elements.stop.disabled = true;
    }
  }

  async _runValidateLayout(solver) {
    const handler = new ModeHandler.ValidateLayout(solver);
    handler.run();
    this._iterateModeHandler(handler);
  }

  async _runStepIterator(solver) {
    const handler = new ModeHandler.StepByStep(solver);
    handler.run();
    this._iterateModeHandler(handler);
  }

  async _runSolutionIterator(solver) {
    let handler = new ModeHandler.AllSolutions(solver);
    handler.run();
    this._iterateModeHandler(handler);
  }

  async _runAllPossibilities(solver) {
    let handler = new ModeHandler.AllPossibilities(solver);
    this._iterateModeHandler(handler);
    await handler.run();
  }

  _iterateModeHandler(handler) {
    this._modeHandler = handler;

    let index = handler.minIndex();

    const update = async () => {
      if (index < handler.minIndex()) {
        index = handler.minIndex();
      }

      let result = await handler.get(index);
      if (!result || isIterable(result)) {
        this._solutionDisplay.setSolutionNew(result);
      } else if (result) {
        // If result is an object, then it is a step result.
        this._solutionDisplay.setSolutionNew(result.pencilmarks);
        this._stateDisplay.setStepStatus(result.stepStatus);
        this._setValidateResult(result.validateResult);
        if (result.latestCell) {
          this._stepHighlighter.setCells([result.latestCell]);
        } else {
          this._stepHighlighter.setCells([]);
        }
      }

      let minIndex = handler.minIndex();
      this._elements.forward.disabled = (index >= handler.count());
      this._elements.back.disabled = (index == minIndex);
      this._elements.start.disabled = (index == minIndex);
      this._elements.stepOutput.textContent = index;
    };
    handler.setUpdateListener(update);

    if (handler.ITERATION_CONTROLS) {
      this._elements.forward.onclick = async () => {
        index++;
        update();
      };
      this._elements.back.onclick = () => {
        index--;
        update();
      };
      this._elements.start.onclick = () => {
        index = handler.minIndex();
        update();
      };

      this._showIterationControls(true);
    }

    update();
  }

  async _runCounter(solver) {
    let handler = new ModeHandler.CountSolutions(solver);
    this._iterateModeHandler(handler);
    handler.run();
  }
}