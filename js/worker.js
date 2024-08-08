const START_INIT_WORKER = performance.now();

{
  const versionParam = self.location.search;
  self.importScripts(
    'util.js' + versionParam,
    'sudoku_builder.js' + versionParam,
    'solver/candidate_selector.js' + versionParam,
    'solver/engine.js' + versionParam,
    'solver/handlers.js' + versionParam,
    'solver/optimizer.js' + versionParam);
}


let workerSolver = null;
let workerSolverSetUpTime = 0;

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

self.onmessage = (msg) => {
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

const END_INIT_WORKER = performance.now();
const workerSetupMs = Math.ceil(END_INIT_WORKER - START_INIT_WORKER);

console.log(`Worker initialized in ${Math.ceil(workerSetupMs)}ms`);
