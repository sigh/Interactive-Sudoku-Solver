import assert from 'node:assert/strict';
import { performance as perf } from 'node:perf_hooks';

import { ensureGlobalEnvironment } from './helpers/test_env.js';

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: undefined,
  locationValue: { search: '' },
  performance: perf,
});

const debugModule = await import('../js/debug.js');
const {
  debugFilesLoaded,
  runSolveTests,
  runValidateLayoutTests,
  PuzzleRunner,
} = debugModule;
await debugFilesLoaded;

const { SudokuBuilder } = await import('../js/solver/sudoku_builder.js');
const { Timer } = await import('../js/util.js');

const LOG_UPDATE_FREQUENCY = 13;

class LocalSolverProxy {
  constructor(solver, stateHandler, setupTimeMs) {
    this._solver = solver;
    this._stateHandler = stateHandler || (() => { });
    this._setupTimeMs = setupTimeMs;
    this._terminated = false;

    if (typeof solver.setProgressCallback === 'function') {
      solver.setProgressCallback(() => this._notifyState(), LOG_UPDATE_FREQUENCY);
    }
  }

  _notifyState(extraState) {
    if (!this._solver || !this._stateHandler) return;
    const state = this._solver.state?.();
    if (!state) return;
    state.puzzleSetupTime = this._setupTimeMs;
    if (extraState !== undefined) {
      state.extra = extraState;
    }
    this._stateHandler(state);
  }

  _call(methodName, ...args) {
    if (!this._solver) {
      throw new Error('Solver has been terminated.');
    }
    const result = this._solver[methodName](...args);
    this._notifyState();
    return result;
  }

  async solveAllPossibilities() { return this._call('solveAllPossibilities'); }
  async validateLayout() { return this._call('validateLayout'); }
  async nthSolution(n) { return this._call('nthSolution', n); }
  async nthStep(n, stepGuides) { return this._call('nthStep', n, stepGuides); }
  async countSolutions() { return this._call('countSolutions'); }
  async estimatedCountSolutions() { return this._call('estimatedCountSolutions'); }

  terminate() {
    this._solver = null;
    this._terminated = true;
  }

  isTerminated() {
    return this._terminated;
  }
}

const makeLocalSolverFactory = () => {
  return async (constraint, stateHandler) => {
    const timer = new Timer();
    let solver;
    timer.runTimed(() => {
      const resolved = SudokuBuilder.resolveConstraint(constraint);
      solver = SudokuBuilder.build(resolved);
    });

    const proxy = new LocalSolverProxy(solver, stateHandler, timer.elapsedMs());
    proxy._notifyState();
    return proxy;
  };
};

const runner = new PuzzleRunner({
  solverFactory: makeLocalSolverFactory(),
  enableConsoleLogs: false,
});

const expectStatsStructure = (result, label) => {
  assert.ok(result, `${label} returned nothing`);
  assert.ok(Array.isArray(result.stats), `${label} stats should be an array`);
  assert.ok(result.stats.total, `${label} stats should include totals`);
};

const formatNumber = (value) => value.toLocaleString('en-US');
const formatSeconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

const logCollectionSummary = (result, label = result.collection) => {
  const total = result.stats.total || {};
  const parts = [`${label}: ${result.stats.length} puzzles`];
  const runtimeMs = typeof total.rumtimeMs === 'number' ? total.rumtimeMs : total.runtimeMs;
  if (typeof runtimeMs === 'number') {
    parts.push(`runtime ${formatSeconds(runtimeMs)}`);
  }
  if (typeof total.guesses === 'number') {
    parts.push(`guesses ${formatNumber(total.guesses)}`);
  }
  console.log('  ' + parts.join(' | '));
};

const runSolveResults = await runSolveTests((puzzle, err) => {
  throw new Error(`Puzzle ${puzzle.name} failed: ${err}`);
}, runner);
assert.equal(runSolveResults.length, 3, 'runSolveTests should return three collections');
runSolveResults.forEach((result) => expectStatsStructure(result, `solve tests (${result.collection})`));
console.log('✓ runSolveTests completed');
runSolveResults.forEach((result) => logCollectionSummary(result));

const runLayoutResults = await runValidateLayoutTests((puzzle, err) => {
  throw new Error(`Layout puzzle ${puzzle.name} failed: ${err}`);
}, runner);
assert.equal(runLayoutResults.length, 1, 'runValidateLayoutTests should return a single collection');
runLayoutResults.forEach((result) => expectStatsStructure(result, 'layout tests'));
console.log('✓ runValidateLayoutTests completed');
runLayoutResults.forEach((result) => logCollectionSummary(result));

console.log('All end-to-end tests passed.');
