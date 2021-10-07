const START_INIT_WORKER = performance.now();

const cachebuster = self.location.search;
self.importScripts(
  'util.js' + cachebuster,
  'sudoku_builder.js' + cachebuster,
  'solver/engine.js' + cachebuster,
  'solver/handlers.js' + cachebuster);


let workerSolver = null;
let workerSolverSetUpTime = 0;

const handleWorkerMethod = (method, payload) => {
  switch (method) {
    case 'init':
      if (payload.globalVars) {
        for (const [v, value] of payload.globalVars) {
          self[v] = value;
        }
      }

      const timer = new Timer();
      timer.runTimed(() => {
        workerSolver = SudokuBuilder.build(payload.constraint);
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
      return workerSolver.nthStep(payload);

    case 'countSolutions':
      return workerSolver.countSolutions();
  }
  throw(`Unknown method ${method}`);
};

const pendingDebugLogs = [];
const debugLog = (data) => {
  pendingDebugLogs.push(data);
};

const sendState = (extraState) => {
  let state = workerSolver.state();
  state.extra = extraState;
  state.puzzleSetupTime = workerSolverSetUpTime;
  self.postMessage({
    type: 'state',
    state: state,
  });
  if (pendingDebugLogs.length) {
    self.postMessage({
      type: 'debug',
      logs: pendingDebugLogs.splice(0),
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
  } catch(e) {
    self.postMessage({
      type: 'exception',
      error: e,
    });
  }
};

const END_INIT_WORKER = performance.now();
const workerSetupMs = Math.ceil(END_INIT_WORKER - START_INIT_WORKER);

console.log(`Worker initialized in ${Math.ceil(workerSetupMs)}ms`);
