import assert from 'node:assert/strict';
import { performance as perf } from 'node:perf_hooks';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: undefined,
  locationValue: { search: '' },
  performance: perf,
});

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { Timer } = await import('../../js/util.js');
const {
  SolverRunner,
  SolverProxy,
  Modes,
  DEFAULT_MODE,
  getHandlerClass,
} = await import('../../js/solver_runner.js');

// ============================================================================
// Test Helpers
// ============================================================================

// Helper to wait for a callback to fire (use microtask queue)
const waitForCallback = () => new Promise(resolve => queueMicrotask(resolve));
// Helper to wait for all pending microtasks and async callbacks to settle.
const waitForSettle = () => new Promise(resolve => setTimeout(resolve, 0));

// Sample cap for estimate-solutions under test, so the sampling loop
// terminates instead of running until aborted.
const ESTIMATE_TEST_MAX_SAMPLES = 50;

// Create a local solver proxy for testing (no web worker needed)
class LocalSolverProxy {
  constructor(solver, stateHandler, statusHandler, setupTimeMs) {
    this._solver = solver;
    this._stateHandler = stateHandler || (() => { });
    this._statusHandler = statusHandler || (() => { });
    this._setupTimeMs = setupTimeMs;
    this._terminated = false;

    if (typeof solver.setProgressCallback === 'function') {
      solver.setProgressCallback((extraState) => this._notifyState(extraState), 13);
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
  async estimatedCountSolutions() {
    // The real worker runs sampling unbounded until the user aborts; bound it
    // here so the mode terminates deterministically under test. The engine's
    // fixed seed makes the estimate reproducible.
    return this._call('estimatedCountSolutions', ESTIMATE_TEST_MAX_SAMPLES);
  }

  terminate() {
    this._solver = null;
    this._terminated = true;
  }

  isTerminated() {
    return this._terminated;
  }
}

class DelayedWorker {
  constructor() {
    this._listeners = new Set();
    this.messages = [];
    this.released = false;
    this.terminated = false;
  }

  addEventListener(type, listener) {
    assert.equal(type, 'message');
    this._listeners.add(listener);
  }

  removeEventListener(type, listener) {
    assert.equal(type, 'message');
    this._listeners.delete(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emit(data) {
    for (const listener of this._listeners) {
      listener({ data });
    }
  }

  release() {
    this.released = true;
  }

  terminate() {
    this.terminated = true;
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

// Build a NoBoxes jigsaw constraint from a layout string, for validate-layout
// testing. validate-layout is about the layout itself, so no givens are added.
const makeJigsawLayoutConstraint = (layout) => {
  const pieces = [
    ...SudokuConstraint.Jigsaw.makeFromArgs([layout], CellGeometry.fromGridSize(9)),
  ];
  return new SudokuConstraint.Container([
    new SudokuConstraint.NoBoxes(),
    ...pieces,
  ]);
};

// A solvable jigsaw layout. (From data/jigsaw_layouts.js VALID_JIGSAW_LAYOUTS.)
const makeValidLayoutConstraint = () => makeJigsawLayoutConstraint(
  '111222233111222233114452333144455633444555666774556669777856699778888999778888999');

// A jigsaw layout with no possible solution.
// (From data/jigsaw_layouts.js EASY_INVALID_JIGSAW_LAYOUTS.)
const makeInvalidLayoutConstraint = () => makeJigsawLayoutConstraint(
  '000000001223411101223415111223455556223444566233334566777374566787774566788888888');

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
  const runner = new SolverRunner({
    stateHandler: () => { },
    statusHandler: () => { },
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
// SolverProxy worker protocol
// ============================================================================

await runTest('SolverProxy rejects concurrent calls until delayed result resolves', async () => {
  const worker = new DelayedWorker();
  const statusCalls = [];
  const proxy = new SolverProxy(
    worker,
    null,
    (isSolving, method) => statusCalls.push({ isSolving, method }),
  );
  proxy._initialized = true;

  const first = proxy.nthSolution(0);
  assert.deepEqual(worker.messages, [{ method: 'nthSolution', payload: 0 }]);

  await assert.rejects(
    () => proxy.nthSolution(1),
    /Can't call worker while a method is in progress\. \(nthSolution\)/,
  );

  worker.emit({ type: 'result', result: ['done'] });
  assert.deepEqual(await first, ['done']);
  assert.equal(proxy._waiting, null);
  assert.deepEqual(statusCalls, [
    { isSolving: true, method: 'nthSolution' },
    { isSolving: false, method: 'nthSolution' },
  ]);

  proxy.terminate();
  assert.equal(worker.released, true);
});

await runTest('SolverProxy forwards state and debug worker messages without a pending call', () => {
  const worker = new DelayedWorker();
  const states = [];
  const debugMessages = [];
  const proxy = new SolverProxy(
    worker,
    state => states.push(state),
    null,
    (data, counters) => debugMessages.push({ data, counters }),
  );

  worker.emit({ type: 'state', state: { done: false, counters: { nodesSearched: 7 } } });
  worker.emit({ type: 'debug', data: { logs: ['x'] }, counters: { y: 1 } });

  assert.deepEqual(states, [{ done: false, counters: { nodesSearched: 7 } }]);
  assert.deepEqual(debugMessages, [{ data: { logs: ['x'] }, counters: { y: 1 } }]);

  proxy.terminate();
  assert.equal(worker.released, true);
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

await runTest('count-solutions mode returns sample solution', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'count-solutions' });
  await waitForSettle();

  assert.ok(handler);
  assert.equal(handler.ITERATION_CONTROLS, false);
  assert.equal(handler.ALLOW_DOWNLOAD, false);

  assert.ok(updateResult);
  assert.ok(updateResult.solution, 'Should have a sample solution');
  assert.equal(updateResult.description, 'Sample solution');
});

await runTest('estimate-solutions mode returns sample solution', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'estimate-solutions' });
  await waitForSettle();

  assert.ok(handler);
  assert.equal(handler.ITERATION_CONTROLS, false);
  assert.equal(handler.ALLOW_DOWNLOAD, false);

  assert.ok(updateResult);
  assert.ok(updateResult.solution, 'Should have a sample solution');
  assert.equal(updateResult.description, 'Sample solution');
});

await runTest('estimate-solutions mode delivers a running estimate via state', async () => {
  let estimate = null;
  const runner = new SolverRunner({
    stateHandler: (state) => {
      if (state.extra?.estimate) estimate = state.extra.estimate;
    },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'estimate-solutions' });
  await waitForSettle();

  assert.ok(estimate, 'Should receive an estimate in state.extra');
  assert.equal(estimate.samples, ESTIMATE_TEST_MAX_SAMPLES);
  // The simple puzzle is uniquely solvable, so the estimate is 1.
  assert.equal(estimate.solutions, 1);
});

await runTest('validate-layout mode handler properties', async () => {
  const runner = new SolverRunner({
    onUpdate: () => {},
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'validate-layout' });

  assert.ok(handler);
  // validate-layout has no iteration controls or downloads
  assert.equal(handler.ITERATION_CONTROLS, false);
  assert.equal(handler.ALLOW_DOWNLOAD, false);
  assert.equal(handler.ALLOW_ALT_CLICK, false);
});

await runTest('validate-layout mode reports a valid layout with a sample solution', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeValidLayoutConstraint();
  await runner.solve(constraint, { mode: 'validate-layout' });
  await waitForSettle();

  assert.ok(updateResult);
  assert.ok(updateResult.solution, 'Valid layout should include a sample solution');
  assert.equal(updateResult.description, 'Valid layout [Sample solution]');
});

await runTest('validate-layout mode reports an invalid layout', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeInvalidLayoutConstraint();
  await runner.solve(constraint, { mode: 'validate-layout' });
  await waitForSettle();

  assert.ok(updateResult);
  assert.equal(updateResult.solution, null);
  assert.equal(updateResult.description, 'Invalid layout');
});

await runTest('step-by-step mode returns step data with statusData', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  const handler = await runner.solve(constraint, { mode: 'step-by-step' });
  await waitForSettle();

  assert.ok(handler);
  assert.equal(handler.ALLOW_ALT_CLICK, true);
  assert.equal(handler.ITERATION_CONTROLS, true);

  assert.ok(updateResult);
  assert.ok(updateResult.description.startsWith('Step '));
  assert.ok(updateResult.solution, 'Step should have pencilmarks');
  assert.ok(updateResult.statusData, 'Step should have statusData');
  assert.ok('values' in updateResult.statusData);
  assert.ok('isSolution' in updateResult.statusData);
  assert.ok('hasConflict' in updateResult.statusData);
  assert.ok(Array.isArray(updateResult.highlightCells));
});

await runTest('solutions mode onUpdate provides solution array', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'solutions' });
  // solutions mode needs multiple async cycles: run → fetch → add → update
  await waitForSettle();
  await waitForSettle();

  assert.ok(updateResult);
  assert.ok(updateResult.solution, 'Should have a solution');
  assert.ok(updateResult.description);
});

await runTest('solutions mode navigation fetches multiple solutions', async () => {
  const updates = [];
  const runner = new SolverRunner({
    onUpdate: (result) => { updates.push(result); },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'solutions' });
  await waitForSettle();

  // Navigate forward
  runner.next();
  await waitForSettle();

  // For a unique solution, next should still produce a result
  assert.ok(updates.length >= 1);
});

await runTest('step-by-step next advances step index', async () => {
  const iterations = [];
  const runner = new SolverRunner({
    onUpdate: () => {},
    onIterationChange: (state) => { iterations.push({ ...state }); },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'step-by-step' });
  await waitForSettle();

  const initialIndex = iterations[iterations.length - 1].index;

  runner.next();
  await waitForSettle();

  const nextIndex = iterations[iterations.length - 1].index;
  assert.equal(nextIndex, initialIndex + 1);
});

await runTest('all-possibilities onUpdate returns solution data', async () => {
  let updateResult = null;
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'all-possibilities' });
  await waitForSettle();

  assert.ok(updateResult);
  assert.ok(updateResult.solution, 'Should have solution');
  // Unique sudoku yields 'Unique solution'
  assert.equal(updateResult.description, 'Unique solution');
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
  await waitForCallback();

  // Should not throw
  runner.handleAltClick(0);
});

await runTest('handleAltClick in step-by-step mode with iterable cell triggers guide', async () => {
  let updateResult = null;
  const iterations = [];
  const runner = new SolverRunner({
    onUpdate: (result) => { updateResult = result; },
    onIterationChange: (state) => { iterations.push({ ...state }); },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'step-by-step' });
  await waitForSettle();

  // Find a cell with multiple possibilities (an iterable, not a string)
  if (updateResult?.solution) {
    let cellIndex = -1;
    for (let i = 0; i < updateResult.solution.length; i++) {
      const v = updateResult.solution[i];
      if (v && typeof v !== 'string' && typeof v[Symbol.iterator] === 'function') {
        cellIndex = i;
        break;
      }
    }
    if (cellIndex >= 0) {
      const itersBefore = iterations.length;
      runner.handleAltClick(cellIndex);
      await waitForSettle();
      // handleAltClick should trigger an update cycle
      assert.ok(iterations.length > itersBefore,
        'handleAltClick should trigger iteration change');
    }
  }
});

// ============================================================================
// setCandidateSupportThreshold
// ============================================================================

await runTest('setCandidateSupportThreshold returns true when threshold decreases', async () => {
  const runner = new SolverRunner({ onUpdate: () => { } });
  const constraint = makeSimpleConstraint();

  await runner.solve(constraint, { mode: 'all-possibilities' });
  await waitForCallback();

  // Default threshold is 1. Lowering it is a display-only change.
  const result = runner.setCandidateSupportThreshold(1);
  assert.equal(result, true);
});

await runTest('setCandidateSupportThreshold returns false when no handler', () => {
  const runner = new SolverRunner();
  // No solve called, so no handler.
  const result = runner.setCandidateSupportThreshold(5);
  assert.equal(result, undefined);
});

// ============================================================================
// _handleException error routing
// ============================================================================

await runTest('solve with invalid constraint reports InvalidConstraintError', async () => {
  let errorMsg = null;
  const runner = new SolverRunner({
    onError: (msg) => { errorMsg = msg; },
  });

  // Jigsaw piece with wrong number of cells triggers InvalidConstraintError
  // during build (pieces must match regionSize).
  const constraint = new SudokuConstraint.Jigsaw('R1C1', 'R1C2');
  await runner.solve(constraint, { mode: 'all-possibilities' });
  await waitForCallback();

  assert.ok(errorMsg);
  assert.ok(errorMsg.startsWith('Invalid Constraint:'), `Expected prefix, got: ${errorMsg}`);
});

// A solver error thrown inside the detached solutions-prefetch has no awaiter,
// so before the fix it became a silent unhandled rejection. It must reach
// onError instead.
await runTest('solutions prefetch errors are reported to onError', async () => {
  let errorMsg = null;
  const runner = new SolverRunner({ onError: (msg) => { errorMsg = msg; } });

  const savedMakeSolver = SolverProxy.makeSolver;
  SolverProxy.makeSolver = async () => ({
    // n < 2 succeed (consumed by the initial run); n >= 2 is only reached by
    // the background prefetch and throws.
    async nthSolution(n) {
      if (n >= 2) throw new Error('boom');
      return [n];
    },
    terminate() { },
  });

  try {
    await runner.solve(makeSimpleConstraint(), { mode: 'solutions' });
    await waitForSettle();
    // Advancing bumps the prefetch target to n = 2, triggering the throw.
    runner.next();
    await waitForSettle();
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }

  assert.ok(errorMsg, 'onError should have been called');
  assert.ok(errorMsg.includes('boom'), `Expected boom, got: ${errorMsg}`);
});

// ============================================================================
// Cleanup
// ============================================================================

// Restore original makeSolver
SolverProxy.makeSolver = originalMakeSolver;

logSuiteComplete('SolverRunner');
