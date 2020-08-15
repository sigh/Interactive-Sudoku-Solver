self.importScripts('constraint_solver.js');
self.importScripts('sudoku_solver.js');

let solver = null;
let iter = null;

const ACTIONS = {
  solveAllPossibilies: (jsonConstraint) => {
    solver = makeSolver(jsonConstraint);
    let result = solver.solveAllPossibilities();
    solver = null;
    return result;
  },
  solutionIterator: (jsonConstraint) => {
    solver = makeSolver(jsonConstraint);
    iter = solver.solutions()
    return ACTIONS.nextSolution();
  },
  nextSolution: () => {
    let next = iter.next();
    next.state = solver.state();
    return next;
  },
};

self.onmessage = (msg) => {
  let result = ACTIONS[msg.data.action](msg.data.payload);
  self.postMessage({
    result: result,
    msgId: msg.data.msgId,
  });
};

const makeSolver = (jsonConstraint) => {
  let constraint = SudokuConstraint.fromJSON(jsonConstraint);
  let builder = new SudokuBuilder();
  builder.addConstraint(constraint);

  return builder.build();
};
