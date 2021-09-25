const START_INIT_WORKER = performance.now();

self.importScripts('util.js');
self.importScripts('sudoku_builder.js');
self.importScripts('sudoku_solver.js');

let workerSolver = null;
let workerSolverSetUpTime = 0;

const handleWorkerMethod = (method, payload) => {
  switch (method) {
    case 'init':
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

    case 'nthSolution':
      return workerSolver.nthSolution(payload);

    case 'nthStep':
      return workerSolver.nthStep(payload);

    case 'countSolutions':
      return workerSolver.countSolutions();
  }
  throw(`Unknown method ${method}`);
};

const sendState = (extraState) => {
  let state = workerSolver.state();
  state.extra = extraState;
  state.puzzleSetupTime = workerSolverSetUpTime;
  self.postMessage({
    type: 'state',
    state: state,
  });
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
