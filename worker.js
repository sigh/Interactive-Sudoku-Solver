self.importScripts('util.js');
self.importScripts('constraint_solver.js');
self.importScripts('sudoku_solver.js');

let workerSolver = null;

const handleWorkerMethod = (method, payload) => {
  switch (method) {
    case 'init':
      let constraint = SudokuConstraint.fromJSON(payload.jsonConstraint);
      let builder = new SudokuBuilder();
      builder.addConstraint(constraint);

      workerSolver = builder.build();
      if (payload.updateFrequency) {
        workerSolver.setProgressCallback(sendState, payload.updateFrequency);
      }

      return true;

    case 'solveAllPossibilities':
      return workerSolver.solveAllPossibilities();

    case 'nextSolution':
      return workerSolver.nextSolution();

    case 'goToStep':
      return workerSolver.goToStep(payload);
  }
  throw(`Unknown method ${method}`);
};

const sendState = () => {
  self.postMessage({
    type: 'state',
    state: workerSolver.state(),
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
