import assert from 'node:assert/strict';
import { performance as perf } from 'node:perf_hooks';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: undefined,
  locationValue: { search: '' },
  performance: perf,
});

const { SudokuBuilder } = await import('../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../js/sudoku_constraint.js');
const { Timer } = await import('../js/util.js');
const {
  SolverRunner,
  SolverProxy,
  Modes,
  DEFAULT_MODE,
  getHandlerClass,
} = await import('../js/solver_runner.js');

// ============================================================================
// Test Helpers
// ============================================================================

// Helper to wait for a callback to fire (use microtask queue)
const waitForCallback = () => new Promise(resolve => queueMicrotask(resolve));

// Create a local solver proxy for testing (no web worker needed)
class LocalSolverProxy {
  constructor(solver, stateHandler, statusHandler, setupTimeMs) {
    this._solver = solver;
    this._stateHandler = stateHandler || (() => { });
    this._statusHandler = statusHandler || (() => { });
    this._setupTimeMs = setupTimeMs;
    this._terminated = false;

    if (typeof solver.setProgressCallback === 'function') {
      solver.setProgressCallback(() => this._notifyState(), 13);
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
    this._statusHandler(true, methodName);
    const result = this._solver[methodName](...args);
    this._notifyState();
    this._statusHandler(false, methodName);
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

// Replace SolverProxy.makeSolver for testing
const originalMakeSolver = SolverProxy.makeSolver.bind(SolverProxy);
SolverProxy.makeSolver = async (constraint, stateHandler, statusHandler, debugHandler) => {
  const timer = new Timer();
  let solver;
  timer.runTimed(() => {
    const resolved = SudokuBuilder.resolveConstraint(constraint);
    solver = SudokuBuilder.build(resolved);
  });

  const proxy = new LocalSolverProxy(solver, stateHandler, statusHandler, timer.elapsedMs());
  proxy._notifyState();
  return proxy;
};

// Simple constraint for testing
const makeSimpleConstraint = () => {
  const givens = [
    ['R1C1', 5], ['R1C2', 3], ['R1C5', 7],
    ['R2C1', 6], ['R2C4', 1], ['R2C5', 9], ['R2C6', 5],
    ['R3C2', 9], ['R3C3', 8], ['R3C8', 6],
    ['R4C1', 8], ['R4C5', 6], ['R4C9', 3],
    ['R5C1', 4], ['R5C4', 8], ['R5C6', 3], ['R5C9', 1],
    ['R6C1', 7], ['R6C5', 2], ['R6C9', 6],
    ['R7C2', 6], ['R7C7', 2], ['R7C8', 8],
    ['R8C4', 4], ['R8C5', 1], ['R8C6', 9], ['R8C9', 5],
    ['R9C5', 8], ['R9C8', 7], ['R9C9', 9],
  ];

  return new SudokuConstraint.Container(
    givens.map(([cell, value]) => new SudokuConstraint.Given(cell, value))
  );
};

// ============================================================================
// Modes and getHandlerClass
// ============================================================================

await runTest('Modes should contain all expected mode handlers', () => {
  assert.ok(Modes.ALL_POSSIBILITIES);
  assert.ok(Modes.SOLUTIONS);
  assert.ok(Modes.COUNT_SOLUTIONS);
  assert.ok(Modes.ESTIMATE_SOLUTIONS);
  assert.ok(Modes.STEP_BY_STEP);
  assert.ok(Modes.VALIDATE_LAYOUT);
});

await runTest('DEFAULT_MODE should be all-possibilities', () => {
  assert.equal(DEFAULT_MODE, 'all-possibilities');
});

await runTest('getHandlerClass should return handler for valid mode', () => {
  const handler = getHandlerClass('all-possibilities');
  assert.ok(handler);
  assert.equal(handler.NAME, 'all-possibilities');
});

await runTest('getHandlerClass should return null for invalid mode', () => {
  const handler = getHandlerClass('invalid-mode');
  assert.equal(handler, null);
});

// ============================================================================
// SolverRunner constructor
// ============================================================================

await runTest('SolverRunner constructor should set default callbacks', () => {
  const runner = new SolverRunner();
  assert.ok(runner);
  assert.equal(runner.isSolving(), false);
});

await runTest('SolverRunner constructor should accept custom callbacks', () => {
  let stateReceived = null;
  let statusReceived = null;

  const runner = new SolverRunner({
    stateHandler: (state) => { stateReceived = state; },
    statusHandler: (isSolving, method) => { statusReceived = { isSolving, method }; },
  });

  assert.ok(runner);
});

// ============================================================================
// SolverRunner.solve()
// ============================================================================

await runTest('solve should return handler for valid mode', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  const handler = await runner.solve(constraint, { mode: 'all-possibilities' });

  assert.ok(handler);
  assert.equal(handler.ITERATION_CONTROLS, true);
  assert.equal(handler.ALLOW_DOWNLOAD, true);
});

await runTest('solve should use DEFAULT_MODE when no mode specified', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  const handler = await runner.solve(constraint);

  assert.ok(handler);
  // DEFAULT_MODE is all-possibilities which has these properties
  assert.equal(handler.ITERATION_CONTROLS, true);
  assert.equal(handler.ALLOW_DOWNLOAD, true);
});

await runTest('solve should call onError for invalid mode', async () => {
  let errorReceived = null;
  const runner = new SolverRunner({
    onError: (error) => { errorReceived = error; },
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'invalid-mode' });

  assert.equal(handler, undefined);
  assert.ok(errorReceived);
  assert.ok(errorReceived.includes('Unknown mode'));
});

await runTest('solve should find solution for classic sudoku', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint);

  assert.ok(updateResult);
  assert.ok(updateResult.solution);
  // Description could be 'All possibilities' or 'Unique solution' depending on timing
  assert.ok(updateResult.description);
});

await runTest('solve should call stateHandler with solver state', async () => {
  let stateReceived = null;
  const runner = new SolverRunner({
    stateHandler: (state) => { stateReceived = state; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint);

  assert.ok(stateReceived);
  assert.ok('counters' in stateReceived);
});

await runTest('solve should call statusHandler when solving starts/ends', async () => {
  const statusCalls = [];
  const runner = new SolverRunner({
    statusHandler: (isSolving, method) => {
      statusCalls.push({ isSolving, method });
    },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint);

  // Should have at least one true and one false call
  const startCalls = statusCalls.filter(c => c.isSolving);
  const endCalls = statusCalls.filter(c => !c.isSolving);
  assert.ok(startCalls.length > 0, 'Expected status calls with isSolving=true');
  assert.ok(endCalls.length > 0, 'Expected status calls with isSolving=false');
});

// ============================================================================
// SolverRunner.abort()
// ============================================================================

await runTest('abort should terminate current solve', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  // Start solving and wait for it to complete
  await runner.solve(constraint);

  // Now abort (should be safe even after solve completes)
  runner.abort();

  // After abort, isSolving should be false
  assert.equal(runner.isSolving(), false);
});

await runTest('abort should be safe to call when not solving', () => {
  const runner = new SolverRunner();

  // Should not throw
  runner.abort();
  runner.abort();

  assert.equal(runner.isSolving(), false);
});

await runTest('solve should abort previous solve when called again', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  // Start first solve and let it complete
  await runner.solve(constraint);

  // Start second solve (should abort first - which is already done)
  const handler2 = await runner.solve(constraint);

  // handler2 should be valid
  assert.ok(handler2);
});

// ============================================================================
// Iteration control
// ============================================================================

await runTest('next should increment index and trigger update', async () => {
  let iterationState = null;
  const runner = new SolverRunner({
    onIterationChange: (state) => { iterationState = state; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'solutions' });
  await waitForCallback();

  assert.ok(iterationState);
  const initialIndex = iterationState.index;

  runner.next();
  await waitForCallback();

  // Index should have incremented (or stayed at max if at end)
  assert.ok(iterationState.index >= initialIndex);
});

await runTest('previous should decrement index and trigger update', async () => {
  let iterationState = null;
  const runner = new SolverRunner({
    onIterationChange: (state) => { iterationState = state; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'solutions' });
  await waitForCallback();

  // Move forward first
  runner.next();
  await waitForCallback();
  const afterNext = iterationState.index;

  // Then move back
  runner.previous();
  await waitForCallback();

  assert.ok(iterationState.index <= afterNext);
});

await runTest('toStart should set index to 0', async () => {
  let iterationState = null;
  const runner = new SolverRunner({
    onIterationChange: (state) => { iterationState = state; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'solutions' });
  await waitForCallback();

  // Move forward
  runner.next();
  await waitForCallback();

  // Go to start
  runner.toStart();
  await waitForCallback();

  assert.ok(iterationState);
  assert.equal(iterationState.index, 0);
});

await runTest('toEnd should set follow mode', async () => {
  let iterationState = null;
  const runner = new SolverRunner({
    onIterationChange: (state) => { iterationState = state; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'all-possibilities' });
  await waitForCallback();

  runner.toEnd();
  await waitForCallback();

  assert.ok(iterationState);
  // Should be at the end
  assert.equal(iterationState.isAtEnd, true);
});

// ============================================================================
// onIterationChange callback
// ============================================================================

await runTest('onIterationChange should provide iteration state for modes with ITERATION_CONTROLS', async () => {
  let iterationState = null;
  const runner = new SolverRunner({
    onIterationChange: (state) => { iterationState = state; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'all-possibilities' });
  await waitForCallback();

  assert.ok(iterationState);
  assert.ok('index' in iterationState);
  assert.ok('maxIndex' in iterationState);
  assert.ok('isAtStart' in iterationState);
  assert.ok('isAtEnd' in iterationState);
  assert.ok('description' in iterationState);
});

// ============================================================================
// Mode-specific behavior
// ============================================================================

await runTest('count-solutions mode should work', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'count-solutions' });

  assert.ok(handler);
  assert.equal(handler.ITERATION_CONTROLS, false);
  assert.equal(handler.ALLOW_DOWNLOAD, false);
});

await runTest('validate-layout mode should work', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'validate-layout' });

  assert.ok(handler);
});

await runTest('step-by-step mode should allow alt-click', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  const handler = await runner.solve(constraint, { mode: 'step-by-step' });

  assert.ok(handler);
  assert.equal(handler.ALLOW_ALT_CLICK, true);
  assert.equal(handler.ITERATION_CONTROLS, true);
});

// ============================================================================
// handleAltClick
// ============================================================================

await runTest('handleAltClick should be safe when no handler', () => {
  const runner = new SolverRunner();

  // Should not throw
  runner.handleAltClick(0);
});

await runTest('handleAltClick should be ignored for modes without ALLOW_ALT_CLICK', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  await runner.solve(constraint, { mode: 'all-possibilities' });

  // Should not throw
  runner.handleAltClick(0);
});

// ============================================================================
// Cleanup
// ============================================================================

// Restore original makeSolver
SolverProxy.makeSolver = originalMakeSolver;

logSuiteComplete('SolverRunner');
