// Set up onmessage handler now so that it can be called immediately (before the
// worker is fully loaded), but ensure it waits for the worker to load before
// doing anything else.
let resolveWorkerLoaded;
const workerLoadedPromise = new Promise(resolve => {
  resolveWorkerLoaded = resolve;
});
self.onmessage = async (msg) => {
  await workerLoadedPromise;
  handleWorkerMessage(msg);
};

const START_INIT_WORKER = performance.now();

self.VERSION_PARAM = self.location.search;
if (!self.VERSION_PARAM.endsWith('&sync')) {
  // Preload all required modules asynchronously, unless we've been told
  // otherwise via the &sync parameter.
  import('./util.js' + self.VERSION_PARAM);
  import('./solver/lookup_tables.js' + self.VERSION_PARAM);
  import('./solver/handlers.js' + self.VERSION_PARAM);
  import('./solver/engine.js' + self.VERSION_PARAM);
  import('./solver/optimizer.js' + self.VERSION_PARAM);
  import('./solver/candidate_selector.js' + self.VERSION_PARAM);
  import('./solver/sum_handler.js' + self.VERSION_PARAM);
  import('./solver/regex_handler.js' + self.VERSION_PARAM);
  import('./grid_shape.js' + self.VERSION_PARAM);
  import('./sudoku_constraint.js' + self.VERSION_PARAM);
}
const { SudokuBuilder } = await import('./solver/sudoku_builder.js' + self.VERSION_PARAM);
const { Timer } = await import('./util.js' + self.VERSION_PARAM);

let workerSolver = null;
let workerSolverSetUpTime = 0;

const handleWorkerMessage = (msg) => {
  try {
    let result = handleWorkerMethod(msg.data.method, msg.data.payload);
    sendState();
    self.postMessage({
      type: 'result',
      result: result,
    });
  } catch (e) {
    self.postMessage({
      type: 'exception',
      error: e,
    });
  }
};

const handleWorkerMethod = (method, payload) => {
  switch (method) {
    case 'init':
      const timer = new Timer();
      timer.runTimed(() => {
        const constraint = SudokuBuilder.resolveConstraint(payload.constraint);
        workerSolver = SudokuBuilder.build(constraint, payload.debugOptions);
      });
      workerSolverSetUpTime = timer.elapsedMs();

      if (payload.logUpdateFrequency) {
        workerSolver.setProgressCallback(sendState, payload.logUpdateFrequency);
      }

      return true;

    case 'solveAllPossibilities':
      return workerSolver.solveAllPossibilities();

    case 'validateLayout':
      return workerSolver.validateLayout();

    case 'nthSolution':
      return workerSolver.nthSolution(payload);

    case 'nthStep':
      return workerSolver.nthStep(...payload);

    case 'countSolutions':
      return workerSolver.countSolutions();
  }
  throw (`Unknown method ${method}`);
};

const debugCount = (key, value) => {
  workerSolver.incDebugCounter(key, value);
}
globalThis.debugCount = debugCount;

const sendState = (extraState) => {
  const state = workerSolver.state();
  state.extra = extraState;
  state.puzzleSetupTime = workerSolverSetUpTime;
  self.postMessage({
    type: 'state',
    state: state,
  });
  const debugState = workerSolver.debugState();
  if (debugState && Object.keys(debugState).length) {
    self.postMessage({
      type: 'debug',
      data: debugState,
    });
  }
};

const END_INIT_WORKER = performance.now();
const workerSetupMs = Math.ceil(END_INIT_WORKER - START_INIT_WORKER);

console.log(`Worker initialized in ${Math.ceil(workerSetupMs)}ms`);

// Resolve the promise to indicate the worker is fully loaded.
resolveWorkerLoaded();