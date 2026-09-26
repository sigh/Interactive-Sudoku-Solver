// A step-mode solver whose steps resolve or fail only when the test says so.
// Stands in for the solver returned by SolverProxy.makeSolver.
export class ScriptedStepSolver {
  constructor() {
    this.calls = [];
    this._pending = [];
  }

  nthStep(n, stepGuides) {
    this.calls.push({ n, guideSteps: [...stepGuides.keys()] });
    this.lastGuides = structuredClone(stepGuides);
    return new Promise((resolve, reject) => {
      this._pending.push({ resolve, reject });
    });
  }

  pendingCount() {
    return this._pending.length;
  }

  // Resolve the oldest outstanding step with a grid that has one
  // multi-valued cell (cell 0), so it can be guided.
  resolveNext() {
    this._pending.shift().resolve({
      pencilmarks: [new Set([1, 2]), 3],
      branchCells: [],
      values: [1, 2],
      isSolution: false,
      hasConflict: false,
    });
  }

  rejectNext(error) {
    this._pending.shift().reject(error);
  }

  // Resolve the oldest outstanding step as the end of the search.
  resolveEnd() {
    this._pending.shift().resolve(null);
  }

  terminate() { this.terminated = true; }
}
