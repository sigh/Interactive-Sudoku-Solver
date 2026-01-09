// SolverRunner - Decoupled solver execution and mode handling.
//
// This module provides a DOM-independent way to run the solver with
// different modes (all-possibilities, step-by-step, count, etc.)

// Session management for abort control.
class SolverSession {
  constructor() {
    this._abortController = new AbortController();
    this._solver = null;
  }

  isAborted() {
    return this._abortController.signal.aborted;
  }

  terminate() {
    this._abortController.abort();
    this._solver?.terminate();
  }

  getSolver() {
    if (this.isAborted()) return null;
    return this._solver;
  }

  setSolver(solver) {
    if (this._solver !== null) {
      throw ('Solver already set for session');
    }
    this._solver = solver;
    if (this.isAborted()) {
      solver.terminate();
    }
  }
}

// Base class for mode handlers.
class ModeHandler {
  static NAME = '';
  static DESCRIPTION = '';

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

  isDone() {
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
    if (count == 1 && this.isDone()) description = 'Unique solution';
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
    `Show all values which are present in any valid solution.
     Values are colored by how many solutions they are in.`;

  ITERATION_CONTROLS = true;
  ALLOW_DOWNLOAD = true;

  constructor(candidateSupportThreshold) {
    super();
    this._pencilmarks = [];
    this._candidateSupportThreshold = candidateSupportThreshold || 1;
    this._counts = [];
  }

  async run(solver) {
    await super.run(solver);
    await this._solver.solveAllPossibilities(this._candidateSupportThreshold);
  }

  maxIndex() {
    const c = this.solutionCount();
    // If we have a unique solution, we show it at index 0.
    // Otherwise, index 0 is the summary, and solutions are at indices 1..c.
    return (this.isDone() && c === 1) ? 0 : c;
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
      const numCells = solutions[0].length;
      const numValues = Math.max(...solutions[0]);
      this._counts = Array.from({ length: numCells }, () => new Array(numValues).fill(0));
    }

    for (const solution of solutions) {
      for (let i = 0; i < solution.length; i++) {
        this._pencilmarks[i].add(solution[i]);
        this._counts[i][solution[i] - 1]++;
      }
    }

    super.add(...solutions);
  }

  async get(i) {
    // If we have a unique solution, we want to show it at index 0.
    // This overrides the default behavior where index 0 is the summary.
    if (this.isDone() && this.solutionCount() === 1) {
      return {
        solution: this._solutions[0],
        description: 'Unique solution',
      };
    }
    // Index 0 is the summary view (pencilmarks).
    if (i == 0) return {
      solution: this._pencilmarks,
      description: 'All possibilities',
      counts: this._counts,
      threshold: this._candidateSupportThreshold,
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
    while (!this.isDone()) {
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
        // Structured data instead of DOM element
        statusData: null,
        highlightCells: [],
      };
    }

    const statusData = {
      values: result.values || [],
      isSolution: result.isSolution,
      hasContradiction: result.hasContradiction,
    };

    // Update numSteps if we have a new max.
    if (i + 1 > this._numSteps) {
      this._numSteps = i + 1;
    }
    return {
      solution: result.pencilmarks,
      diff: result.diffPencilmarks || [],
      statusData: statusData,
      description: `Step ${i}`,
      highlightCells: result.latestCell ? [result.latestCell] : [],
      // Provide callback for value selection (for step-by-step UI)
      onValueSelect: (value) => this._addStepGuideValue(i, value),
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

// Registry of available modes.
export const Modes = {
  ALL_POSSIBILITIES: AllPossibilitiesModeHandler,
  SOLUTIONS: AllSolutionsModeHandler,
  COUNT_SOLUTIONS: CountSolutionsModeHandler,
  ESTIMATE_SOLUTIONS: EstimatedCountSolutionsModeHandler,
  STEP_BY_STEP: StepByStepModeHandler,
  VALIDATE_LAYOUT: ValidateLayoutModeHandler,
};

export const DEFAULT_MODE = AllPossibilitiesModeHandler.NAME;

// Get handler class by mode name.
export function getHandlerClass(modeName) {
  for (const handler of Object.values(Modes)) {
    if (handler.NAME === modeName) return handler;
  }
  return null;
}

// Get description for a mode.
export function getModeDescription(modeName) {
  return getHandlerClass(modeName)?.DESCRIPTION;
}

/**
 * SolverRunner - DOM-independent solver execution manager.
 *
 * Manages solver lifecycle, mode handling, and iteration state.
 * Uses callbacks to communicate state changes to the UI layer.
 */
export class SolverRunner {
  constructor(options = {}) {
    this._stateHandler = options.stateHandler || (() => { });
    this._statusHandler = options.statusHandler || (() => { });
    this._onError = options.onError || ((e) => console.error(e));
    this._onUpdate = options.onUpdate || (() => { });
    this._onIterationChange = options.onIterationChange || (() => { });

    this._session = null;
    this._handler = null;
    this._isSolving = false;

    // Iteration state
    this._index = 0;
    this._follow = false;
    this._currentResult = null;
  }

  // --- Solver state ---

  isSolving() {
    return this._isSolving;
  }

  // --- Solver control ---

  async solve(constraints, options = {}) {
    this.abort();

    const mode = options.mode || DEFAULT_MODE;
    const debugHandler = options.debugHandler || null;
    const candidateSupportThreshold = options.candidateSupportThreshold || 1;

    const session = new SolverSession();
    this._session = session;

    const handlerClass = getHandlerClass(mode);
    if (!handlerClass) {
      this._onError(`Unknown mode: ${mode}`);
      return;
    }

    const handler = new handlerClass(candidateSupportThreshold);
    this._handler = handler;

    // Reset iteration state
    this._index = 0;
    this._follow = false;
    this._currentResult = null;

    let solver = null;
    try {
      solver = await SolverProxy.makeSolver(
        constraints,
        (state) => {
          this._stateHandler(state);
          if (state.extra?.solutions) {
            handler.add(...state.extra.solutions);
          }
          if (state.done) {
            handler.setDone();
          }
        },
        (isSolving, method) => {
          this._isSolving = isSolving;
          this._statusHandler(isSolving, method);
        },
        debugHandler
      );
    } catch (e) {
      this._onError(e.toString());
      this._statusHandler(false, 'terminate');
      return;
    }

    session.setSolver(solver);

    // Set up handler update listener
    handler.setUpdateListener(() => this._update());

    // Run the handler
    handler.run(session.getSolver()).catch(handler.handleSolverException);

    // Initial update
    this._update();

    return handler;
  }

  abort() {
    this._session?.terminate();
    this._session = null;
    this._handler = null;
    this._currentResult = null;
    this._isSolving = false;
  }

  // --- Iteration control ---

  next() {
    this._index++;
    this._follow = false;
    this._update();
  }

  previous() {
    this._index--;
    this._follow = false;
    this._update();
  }

  toStart() {
    this._index = 0;
    this._follow = false;
    this._update();
  }

  toEnd() {
    this._follow = true;
    this._update();
  }

  // --- Alt-click handling ---

  handleAltClick(cellIndex) {
    if (!this._handler?.ALLOW_ALT_CLICK) return;
    if (!this._currentResult?.solution) return;

    // Check if the cell has multiple possibilities (iterable)
    const cellValue = this._currentResult.solution[cellIndex];
    if (!cellValue || typeof cellValue[Symbol.iterator] !== 'function' ||
      typeof cellValue === 'string') {
      return;
    }

    this._handler.handleAltClick(this._index, cellIndex);
  }

  // --- Internal ---

  async _update() {
    const handler = this._handler;
    const session = this._session;

    if (!handler || !session || session.isAborted()) return;

    // Update index based on mode and bounds
    if (this._follow) {
      this._index = handler.maxIndex();
    } else {
      this._index = Math.max(0, Math.min(this._index, handler.maxIndex()));
    }

    // Fetch result
    let result = null;
    try {
      result = await handler.get(this._index);
    } catch (e) {
      handler.handleSolverException(e);
    }

    if (session.isAborted()) return;

    this._currentResult = result || null;

    // Notify update
    this._onUpdate(this._currentResult);

    // Notify iteration state change
    if (handler.ITERATION_CONTROLS) {
      const isAtStart = this._index === 0;
      const isAtEnd = this._index >= handler.maxIndex();
      this._onIterationChange({
        index: this._index,
        maxIndex: handler.maxIndex(),
        isAtStart,
        isAtEnd,
        description: result?.description || '',
        statusData: result?.statusData || null,
        onValueSelect: result?.onValueSelect || null,
      });
    }

    // Continue following if needed
    if (this._follow && this._index < handler.maxIndex() && !session.isAborted()) {
      this._update();
    }
  }
}

/**
 * SolverProxy - Manages communication with the solver web worker.
 */
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

  async solveAllPossibilities(candidateSupportThreshold) {
    return this._callWorker('solveAllPossibilities', { candidateSupportThreshold });
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