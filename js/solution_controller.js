const {
  sessionAndLocalStorage,
  deferUntilAnimationFrame,
  clearDOMNode,
  localTimestamp,
  copyToClipboard,
  isKeyEventFromEditableElement,
} = await import('./util.js' + self.VERSION_PARAM);
const {
  HighlightDisplay,
  SolutionDisplay,
  CellValueDisplay
} = await import('./display.js' + self.VERSION_PARAM);
const { toShortSolution } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
const { SolverStateDisplay } = await import('./solver_state_display.js' + self.VERSION_PARAM);
const {
  SolverRunner,
  Modes,
  DEFAULT_MODE,
  getModeDescription,
} = await import('./solver_runner.js' + self.VERSION_PARAM);

class LazyDebugManager {
  constructor(displayContainer, constraintManager) {
    this._displayContainer = displayContainer;
    this._constraintManager = constraintManager;
    this._container = document.getElementById('debug-container');
    this._shape = null;

    this._enabled = false;
    this._real = null;
    this._realPromise = null;

    this._setUpDebugLoadingControls();
  }

  _setUpDebugLoadingControls() {
    const DEBUG_PARAM_NAME = 'debug';

    const updateURL = (enable) => {
      const url = new URL(window.location);
      if (enable) {
        url.searchParams.set(DEBUG_PARAM_NAME, 1);
      } else {
        url.searchParams.delete(DEBUG_PARAM_NAME);
      }
      window.history.pushState(null, null, url);
    };

    const toggleDebug = (enabled) => {
      this._enabled = (enabled !== undefined) ? enabled : !this._enabled;
      this._real?.enable(this._enabled);
      updateURL(this._enabled);
      this._container.style.display = this._enabled ? 'block' : 'none';
      if (!this._enabled) return;
      this._ensureLoaded();
    };

    window.loadDebug = () => {
      toggleDebug(true);
      this._container.scrollIntoView();
    }

    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 'd') {
        toggleDebug();
      }
    });

    const closeButton = document.getElementById('close-debug-button');
    if (closeButton) closeButton.onclick = () => toggleDebug(false);

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has(DEBUG_PARAM_NAME)) {
      toggleDebug(true);
    }
  }

  async _ensureLoaded() {
    if (this._real) return this._real;

    if (!this._realPromise) {
      this._realPromise = (async () => {
        const debugDisplay = await import('./debug/debug_display.js' + self.VERSION_PARAM);
        const real = new debugDisplay.DebugManager(
          this._displayContainer,
          this._constraintManager);

        if (this._shape) real.reshape(this._shape);
        real.enable(this._enabled);

        this._real = real;
        this._container.classList.add('lazy-loaded');
        return real;
      })().catch((e) => {
        console.error('Failed to load debug module:', e);
        this._realPromise = null;  // Reset to allow retrying.
        const loadingElement = this._container.querySelector('.lazy-loading');
        loadingElement.textContent = `Failed to load debug: ${e?.message || e}`;
        loadingElement.classList.remove('notice-info');
        loadingElement.classList.add('notice-error');
        return null;
      });
    }

    return this._realPromise;
  }

  async get() {
    if (!this._enabled) return null;
    return this._ensureLoaded();
  }

  reshape(shape) {
    this._shape = shape;
    this._real?.reshape(shape);
  }

  clear() {
    this._real?.clear();
  }
}

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
      if (isKeyEventFromEditableElement(event)) return;
      if (event.key === 'z' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
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
    if (q === this._history[this._historyLocation]) return;
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
    if (newUrl !== window.location.href.toString()) {
      history.pushState(null, null, url.toString());
    }
  }

  _reloadFromUrl() {
    let url = new URL(window.location.href);
    this._addToHistory(url.searchParams.get('q'));
    this._onUpdate(url.searchParams);
  }
}

export class SolutionController {
  constructor(constraintManager, displayContainer) {
    this._shape = null;

    this._displayContainer = displayContainer;
    this._solutionDisplay = new SolutionDisplay(
      displayContainer.getNewGroup('solution-group'),
      document.getElementById('copy-solution-button'));

    this._diffDisplay = new CellValueDisplay(
      displayContainer.getNewGroup('diff-group'));
    constraintManager.addReshapeListener(this._diffDisplay);

    this._constraintManager = constraintManager;
    this._stepHighlighter = displayContainer.createCellHighlighter('step-cell');
    displayContainer.addElement(
      HighlightDisplay.makeRadialGradient('highlighted-step-gradient'));

    this._debugManager = new LazyDebugManager(displayContainer, constraintManager);
    constraintManager.addReshapeListener(this._debugManager);

    this._stateDisplay = new SolverStateDisplay(this._solutionDisplay);
    constraintManager.addReshapeListener(this._solutionDisplay);

    // Create the SolverRunner with callbacks for UI updates
    this._solverRunner = new SolverRunner({
      stateHandler: (state) => this._stateDisplay.setState(state),
      statusHandler: (isSolving, method) => this._solveStatusChanged(isSolving, method),
      onError: (error) => {
        this._elements.error.textContent = error;
        this._stateDisplay.setSolveStatus(false, 'terminate');
      },
      onUpdate: (result) => this._handleResultUpdate(result),
      onIterationChange: (state) => this._handleIterationChange(state),
    });

    // Add reshape listener after the SolverRunner has been created, so that we
    // don't try to abort a non-existent solver.
    constraintManager.addReshapeListener(this);

    this._elements = {
      start: document.getElementById('solution-start'),
      end: document.getElementById('solution-end'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      buttonPanel: document.getElementById('solution-control-buttons'),
      iterationState: document.getElementById('solution-iteration-state'),
      mode: document.getElementById('solve-mode-input'),
      modeDescription: document.getElementById('solve-mode-description'),
      candidateSupportThreshold: document.getElementById('candidate-support-threshold'),
      error: document.querySelector('#right-panel .notice-error'),
      stop: document.getElementById('stop-solver'),
      solve: document.getElementById('solve-button'),
      autoSolve: document.getElementById('auto-solve-input'),
      download: document.getElementById('download-solutions-button'),
      copyUrl: document.getElementById('copy-url-button'),
    }

    this._elements.copyUrl.onclick = () => {
      copyToClipboard(this._shareUrlToString(), this._elements.copyUrl);
    };

    this._elements.mode.onchange = () => {
      this._updateValueCountLimitUrl();
      this._update();
    };
    const thresholdInput = this._elements.candidateSupportThreshold;
    const thresholdValue = thresholdInput.nextElementSibling;
    thresholdInput.oninput = () => {
      thresholdValue.textContent = thresholdInput.value;
      this._handleThresholdChange();
    };
    this._elements.stop.onclick = () => this._solverRunner.abort();
    this._elements.solve.onclick = () => this._solve();

    this._setUpAutoSolve();
    this._setUpKeyBindings(displayContainer);
    this._setUpIterationControls();

    this._historyHandler = new HistoryHandler((params) => {
      const mode = params.get('mode');
      if (mode) this._elements.mode.value = mode;

      const valueCountLimit = params.get('valueCountLimit');
      if (valueCountLimit) thresholdInput.value = valueCountLimit;

      const constraintsText = params.get('q') || '.';
      this._constraintManager.loadUnsafeFromText(constraintsText);
    });

    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.addUpdateListener((_, options) => this._update(options));

    // This can trigger an update, so do it last.
    thresholdInput.oninput();

    this._update();
  }

  reshape(shape) {
    // Terminate any running solvers ASAP, so they are less
    // likely to cause problems sending stale data.
    this._shape = shape;
    this._solverRunner.abort();
  }

  _shareUrlToString() {
    const current = new URL(window.location.href);
    const share = new URL(current.origin + current.pathname);

    const q = current.searchParams.get('q');
    if (q) share.searchParams.set('q', q);

    const mode = current.searchParams.get('mode');
    if (mode) share.searchParams.set('mode', mode);

    const valueCountLimit = current.searchParams.get('valueCountLimit');
    if (valueCountLimit) share.searchParams.set('valueCountLimit', valueCountLimit);

    // Unescape specific characters for readability.
    // (Only '~' for now.)
    return share.toString().replaceAll('%7E', '~').replaceAll('%7e', '~');
  }

  _setUpAutoSolve() {
    this._elements.autoSolve.checked = (
      sessionAndLocalStorage.getItem('autoSolve') !== 'false');

    this._elements.autoSolve.onchange = () => {
      let isChecked = this._elements.autoSolve.checked ? true : false;
      sessionAndLocalStorage.setItem('autoSolve', isChecked);
      // If we have enabled auto-solve, then start solving! Unless
      // we are already solving.
      if (isChecked && !this._solverRunner.isSolving()) this._update();
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
      // Ctrl/Cmd+Shift+Enter to solve.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
        // If in freeform-input, submit the form (which triggers solve).
        const freeformInput = document.querySelector('[name="freeform-input"]');
        if (document.activeElement === freeformInput) {
          event.preventDefault();
          freeformInput.form.requestSubmit();
        } else if (!isKeyEventFromEditableElement(event)) {
          event.preventDefault();
          this._solve();
        }
        return;
      }

      if (isKeyEventFromEditableElement(event)) return;
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
      if (firingKeys.get(key) !== FIRE_FAST) {
        firingKeys.set(key, FIRE_FAST);
        runHandler(key, handler);
      }

    });
    document.addEventListener('keyup', event => {
      firingKeys.delete(event.key);
    });

    // Listen for clicks in the solution grid.
    const clickInterceptor = displayContainer.getClickInterceptor();
    const clickContainer = clickInterceptor.getSvg();
    clickContainer.addEventListener('click', e => {
      // Only do something if it was an alt-click on a valid cell,
      // and there is a solver runner that can handle it.
      if (!e.altKey) return;
      const target = clickInterceptor.cellAt(e.offsetX, e.offsetY);
      if (target === null) return;

      const cellIndex = this._shape.parseCellId(target).cell;
      this._solverRunner.handleAltClick(cellIndex);
      e.preventDefault();
    });
  }

  _setUpIterationControls() {
    this._elements.forward.onclick = () => this._solverRunner.next();
    this._elements.back.onclick = () => this._solverRunner.previous();
    this._elements.start.onclick = () => this._solverRunner.toStart();
    this._elements.end.onclick = () => this._solverRunner.toEnd();
  }

  _showIterationControls(show) {
    this._elements.buttonPanel.style.visibility = show ? 'visible' : 'hidden';
  }

  async _update(options) {
    const forceSolve = options?.forceSolve;
    this._solutionDisplay.setSolution();
    let mode = this._elements.mode.value;
    if (!mode) {
      mode = DEFAULT_MODE;
      this._elements.mode.value = mode;
    }
    let auto = this._elements.autoSolve.checked;

    const constraints = this._constraintManager.getConstraints();

    let params = { mode: mode, q: constraints.toString() };
    // Remove mode if it is the default.
    if (mode === DEFAULT_MODE) params.mode = undefined;
    if (params.q === '.') params.q = undefined;
    this._historyHandler.update(params);

    const isLayoutMode = mode === Modes.VALIDATE_LAYOUT.NAME;
    this._displayContainer.toggleLayoutView(isLayoutMode);
    const isEstimateMode = mode === Modes.ESTIMATE_SOLUTIONS.NAME;
    this._stateDisplay.setEstimateMode(isEstimateMode);

    // Show candidate support threshold input only for all-possibilities mode.
    const isAllPossibilitiesMode = mode === Modes.ALL_POSSIBILITIES.NAME;
    this._elements.candidateSupportThreshold.parentElement.parentElement.style.display = isAllPossibilitiesMode ? '' : 'none';

    this._elements.modeDescription.textContent = getModeDescription(mode);

    if (forceSolve || auto || mode === Modes.STEP_BY_STEP.NAME) {
      const solverConstraints = isLayoutMode
        ? this._constraintManager.getLayoutConstraints()
        : constraints;
      this._solve(solverConstraints);
    } else {
      this._resetSolver();
    }
  }

  _resetSolver() {
    this._solverRunner.abort();
    this._stepHighlighter.setCells([]);
    this._solutionDisplay.setSolution();
    this._diffDisplay.clear();
    this._stateDisplay.clear();
    this._debugManager.clear();
    this._showIterationControls(false);
    clearDOMNode(this._elements.error);
    clearDOMNode(this._elements.iterationState);
  }

  _handleThresholdChange() {
    this._updateValueCountLimitUrl();

    const valueCountLimit = parseInt(
      this._elements.candidateSupportThreshold.value, 10) || 0;
    // candidateSupportThreshold is 1 more than valueCountLimit so that we can
    // distinguish values at the limit from those above it.
    const candidateSupportThreshold = 1 + valueCountLimit;
    // If the solver can't accommodate the new threshold, then resolve.
    if (!this._solverRunner.setCandidateSupportThreshold(candidateSupportThreshold)) {
      this._update();
    }
  }

  _updateValueCountLimitUrl() {
    const isAllPossibilitiesMode = this._elements.mode.value === Modes.ALL_POSSIBILITIES.NAME;
    let valueCountLimit;
    if (isAllPossibilitiesMode) {
      const parsedLimit = parseInt(
        this._elements.candidateSupportThreshold.value, 10) || 0;
      if (parsedLimit > 0) valueCountLimit = parsedLimit;
    }
    this._historyHandler._updateUrl({ valueCountLimit });
  }

  async _solve(constraints) {
    const mode = this._elements.mode.value;

    constraints ||= mode === Modes.VALIDATE_LAYOUT.NAME
      ? this._constraintManager.getLayoutConstraints()
      : this._constraintManager.getConstraints();

    this._resetSolver();

    const debugHandler = await this._debugManager.get();

    // Set up download handler
    this._elements.download.disabled = true;  // Will be enabled after solve starts

    // Node: modeHandler can be null if initialization failed.
    const modeHandler = await this._solverRunner.solve(constraints, { mode, debugHandler });

    // Update download button based on handler capabilities
    if (modeHandler?.ALLOW_DOWNLOAD) {
      this._elements.download.disabled = false;
      this._elements.download.onclick = () => {
        const solutions = modeHandler.solutions();
        this._downloadSolutionFile(solutions);
      };
    }

    // Show iteration controls if supported
    if (modeHandler?.ITERATION_CONTROLS) {
      this._showIterationControls(true);
    }
  }

  _solveStatusChanged(isSolving, method) {
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

  _handleResultUpdate(result) {
    if (!result) {
      this._solutionDisplay.setSolution();
      return;
    }

    const colorFn = this._makeCandidateColorFn(result);
    this._solutionDisplay.setSolution(result.solution, colorFn);

    if (result.highlightCells) {
      this._stepHighlighter.setCells(result.highlightCells);
    }

    if (result.diff) {
      this._diffDisplay.renderGridValues(result.diff);
    }
  }

  _makeCandidateColorFn(result) {
    const counts = result.counts;
    const threshold = result.candidateSupportThreshold;
    if (!counts || threshold <= 1) return null;

    return (cellIndex, value) => {
      const count = counts[cellIndex]?.[value - 1];
      if (!count || count >= threshold) return null;
      if (count === 1) return 'var(--color-candidate-unique)';
      // Note that the threshold is one more than the limit to detect when
      // we are over the limit.
      if (count === threshold - 1) return 'var(--color-candidate-at-limit)';
      return 'var(--color-candidate-below-limit)';
    };
  }

  _handleIterationChange(state) {
    this._elements.iterationState.textContent = state.description || '';

    this._elements.back.disabled = state.isAtStart;
    this._elements.start.disabled = state.isAtStart;
    this._elements.forward.disabled = state.isAtEnd;
    this._elements.end.disabled = state.isAtEnd;

    // Build status element from statusData (for step-by-step mode)
    if (state.statusData) {
      this._elements.iterationState.appendChild(
        document.createTextNode(' '));
      this._elements.iterationState.appendChild(
        this._buildStatusElement(state.statusData, state.onValueSelect));
    }
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

  // Build a DOM element for step-by-step status display.
  _buildStatusElement(statusData, onValueSelect) {
    const statusElem = document.createElement('span');

    if (statusData.values && statusData.values.length) {
      statusElem.appendChild(document.createTextNode('{'));
      let first = true;
      for (const value of statusData.values) {
        if (!first) statusElem.appendChild(document.createTextNode(','));
        first = false;

        const valueLink = document.createElement('a');
        valueLink.href = 'javascript:void(0)';
        valueLink.textContent = value;
        if (onValueSelect) {
          valueLink.onclick = () => onValueSelect(value);
        }
        statusElem.appendChild(valueLink);
      }
      statusElem.appendChild(document.createTextNode('}'));
    }

    const statusParts = [];
    if (statusData.isSolution) statusParts.push('[Solution]');
    if (statusData.hasContradiction) statusParts.push('[Conflict]');
    if (statusData.isBacktrack) statusParts.push('[Backtracked]');
    statusElem.appendChild(document.createTextNode(' ' + statusParts.join(' ')));

    return statusElem;
  }
}
