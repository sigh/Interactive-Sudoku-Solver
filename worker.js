self.importScripts('util.js');
self.importScripts('sudoku_builder.js');
self.importScripts('sudoku_solver.js');

let workerSolver = null;

const handleWorkerMethod = (method, payload) => {
  switch (method) {
    case 'init':
      workerSolver = SudokuBuilder.build(payload.constraint);

      if (payload.updateFrequency) {
        workerSolver.setProgressCallback(sendState, payload.updateFrequency);
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
