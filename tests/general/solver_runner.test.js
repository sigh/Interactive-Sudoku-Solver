import assert from 'node:assert/strict';
import { performance as perf } from 'node:perf_hooks';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { ScriptedStepSolver } from '../helpers/scripted_step_solver.js';

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: undefined,
  locationValue: { search: '' },
  performance: perf,
});

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { Timer } = await import('../../js/util.js');
const {
  SolverRunner,
  SolverProxy,
  Modes,
  DEFAULT_MODE,
  getHandlerClass,
} = await import('../../js/ui/solver_runner.js');

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

// A killer whose step-by-step search has to guess.
const KILLER_HARD =
  'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<';

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

await runTest('SolverProxy init sends reconstructable constructor data and preserves options', async () => {
  const worker = new DelayedWorker();
  const proxy = new SolverProxy(worker);
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.Or([
      new SudokuConstraint.And([
        new SudokuConstraint.Given('R1C1', 1, 2),
        new SudokuConstraint.Given('R1C1', 2, 3),
      ]),
      new SudokuConstraint.Given('R1C1', 3),
    ]),
  ]);
  const before = structuredClone(constraint);
  const options = { logLevel: 2 };
  const call = proxy.init(constraint, 13, options);
  const message = worker.messages[0];
  assert.equal(message.method, 'init');
  assert.equal(message.payload.logUpdateFrequency, 13);
  assert.equal(message.payload.debugOptions, options);
  assert.equal(Object.getPrototypeOf(message.payload.constraint), Object.prototype);
  assert.deepEqual(
    SudokuBuilder.resolveConstraint(structuredClone(message.payload.constraint)),
    SudokuBuilder.resolveConstraint(before));
  assert.deepEqual(structuredClone(constraint), before);
  worker.emit({ type: 'result', result: true });
  await call;
  proxy.terminate();
});

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

await runTest('SolverProxy terminate during a call kills the worker and rejects the call', async () => {
  const worker = new DelayedWorker();
  const states = [];
  const statusCalls = [];
  const proxy = new SolverProxy(
    worker,
    state => states.push(state),
    (isSolving, method) => statusCalls.push({ isSolving, method }),
  );
  proxy._initialized = true;

  const call = proxy.countSolutions();
  proxy.terminate();

  // A worker mid-call can't be reused, so it is killed rather than released.
  assert.equal(worker.terminated, true);
  assert.equal(worker.released, false);
  await assert.rejects(call, { name: 'AbortedError' });
  assert.deepEqual(statusCalls.at(-1), { isSolving: false, method: 'terminate' });
  assert.equal(proxy.isTerminated(), true);

  // Nothing more from the worker reaches the handlers, and the proxy can't be
  // used again.
  worker.emit({ type: 'state', state: { done: true } });
  assert.deepEqual(states, []);
  await assert.rejects(() => proxy.countSolutions(), /terminated/);
});

await runTest('SolverProxy rejects with the worker exception, keeping its name', async () => {
  const worker = new DelayedWorker();
  const statusCalls = [];
  const proxy = new SolverProxy(
    worker, null, (isSolving, method) => statusCalls.push({ isSolving, method }));
  proxy._initialized = true;

  const call = proxy.nthStep(3, new Map());
  worker.emit({
    type: 'exception',
    method: 'nthStep',
    error: { name: 'InvalidConstraintError', message: 'bad cage', stack: 'at x' },
  });

  await assert.rejects(call, {
    name: 'InvalidConstraintError', message: 'bad cage', workerMethod: 'nthStep',
  });
  assert.deepEqual(statusCalls.at(-1), { isSolving: false, method: 'nthStep' });
  assert.equal(proxy._waiting, null, 'the proxy is free for the next call');
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

// LocalSolverProxy answers at once, so the solutions that each move prefetches
// arrive, and refresh the display, while the move is still in flight.
await runTest('next, previous and toStart move from the displayed solution', async () => {
  const iterations = [];
  const runner = new SolverRunner({
    onIterationChange: (state) => iterations.push(state),
  });
  // An empty grid has many solutions to move between.
  await runner.solve(new SudokuConstraint.Container([]), { mode: 'solutions' });
  await waitForSettle();

  const shown = () => {
    const s = iterations.at(-1);
    return [s.index, s.description, s.isAtStart];
  };
  assert.deepEqual(shown(), [0, 'Solution 1', true]);

  const moves = [
    ['next', [1, 'Solution 2', false]],
    ['next', [2, 'Solution 3', false]],
    ['previous', [1, 'Solution 2', false]],
    ['toStart', [0, 'Solution 1', true]],
    ['previous', [0, 'Solution 1', true]],
  ];
  for (const [move, expected] of moves) {
    runner[move]();
    await waitForSettle();
    assert.deepEqual(shown(), expected, move);
  }
});

await runTest('toEnd shows the last result', async () => {
  const iterations = [];
  const runner = new SolverRunner({
    onIterationChange: (state) => iterations.push(state),
  });
  await runner.solve(makeSimpleConstraint(), { mode: 'all-possibilities' });
  await waitForSettle();

  runner.toggleFollowing();
  await waitForSettle();

  const s = iterations.at(-1);
  assert.deepEqual(
    [s.index, s.description, s.isAtEnd, s.following],
    [0, 'Unique solution', true, false]);
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
      if (state.estimate) estimate = state.estimate;
    },
  });

  const constraint = makeSimpleConstraint();
  await runner.solve(constraint, { mode: 'estimate-solutions' });
  await waitForSettle();

  assert.ok(estimate, 'Should receive an estimate in state');
  // The simple puzzle's tree is tiny, so the estimator counts it exactly
  // as soon as its size estimate says it fits the work already spent.
  assert.equal(estimate.exact, true);
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
  assert.equal(handler.ALLOW_STEP_GUIDES, false);
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
  assert.equal(handler.ALLOW_STEP_GUIDES, true);
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

await runTest('all-possibilities counts larger values arriving in later updates', async () => {
  const Handler = getHandlerClass('all-possibilities');
  const handler = new Handler(2);
  handler.add([0, 1]);
  handler.add([3, 1]);
  handler.add([3, 2]);

  const result = await handler.get(0);
  assert.deepEqual(result.solution, [new Set([0, 3]), new Set([1, 2])]);
  assert.equal(result.counts[0][0], 1);
  assert.equal(result.counts[0][3], 2);
  assert.equal(result.counts[1][1], 2);
  assert.equal(result.counts[1][2], 1);
});

for (const valueRange of ['1-3', '0-2']) {
  await runTest(`all-possibilities counts all values on a Raw grid with range ${valueRange}`, async () => {
    const constraint = new SudokuConstraint.Container([
      new SudokuConstraint.Shape('1x1', valueRange, 'Raw'),
    ]);
    const runner = new SolverRunner();
    const handler = await runner.solve(constraint, { mode: 'all-possibilities' });
    await waitForSettle();

    const result = await handler.get(0);
    const values = constraint.getGeometry().allValues();
    assert.equal(handler.solutionCount(), values.length);
    assert.deepEqual(result.solution, [new Set(values)]);
    for (const value of values) {
      assert.equal(result.counts[0][value], 1, `Count for value ${value}`);
    }
    runner.abort();
  });
}

// ============================================================================
// handleAltClick
// ============================================================================

await runTest('handleAltClick should be safe when no handler', () => {
  const runner = new SolverRunner();

  // Should not throw
  runner.handleAltClick(0);
});

await runTest('handleAltClick should be ignored for modes without ALLOW_STEP_GUIDES', async () => {
  const runner = new SolverRunner();
  const constraint = makeSimpleConstraint();

  await runner.solve(constraint, { mode: 'all-possibilities' });
  await waitForCallback();

  // Should not throw
  runner.handleAltClick(0);
});

await runTest('step guides change the displayed step and the next one', async () => {
  let result = null;
  const iterations = [];
  const runner = new SolverRunner({
    onUpdate: (r) => { result = r; },
    onIterationChange: (state) => iterations.push(state),
  });
  // A search that has to guess, so step 0 is a guess with several options.
  const constraint = SudokuParser.parseText(KILLER_HARD);
  await runner.solve(constraint, { mode: 'step-by-step' });
  await waitForSettle();
  // Step 0 is the grid before any guess; step 1 is the first guess.
  runner.next();
  await waitForSettle();
  assert.equal(result.highlightCells.length, 1, 'step 1 is a guess');

  // Alt-click another multi-valued cell: step 1 now guesses that cell.
  const geometry = CellGeometry.fromGridSize(9);
  const cellIndex = result.solution.findIndex((v, i) =>
    v instanceof Set && geometry.makeCellIdFromIndex(i) !== result.highlightCells[0]);
  runner.handleAltClick(cellIndex);
  await waitForSettle();
  assert.deepEqual(result.highlightCells, [geometry.makeCellIdFromIndex(cellIndex)]);
  assert.equal(iterations.at(-1).index, 1);

  // Select the last listed value: the next step has the cell set to it.
  const value = iterations.at(-1).statusData.values.at(-1);
  runner.selectValue(value);
  await waitForSettle();
  runner.next();
  await waitForSettle();
  assert.equal(iterations.at(-1).index, 2);
  assert.equal(result.solution[cellIndex], value);
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
// Committed position
// ============================================================================

const withScriptedStepSolver = async (fn) => {
  const solver = new ScriptedStepSolver();
  const savedMakeSolver = SolverProxy.makeSolver;
  SolverProxy.makeSolver = async () => solver;
  try {
    await fn(solver);
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }
};

await runTest('a failed step leaves the position on the displayed step', async () => {
  await withScriptedStepSolver(async (solver) => {
    const errors = [];
    const iterations = [];
    const runner = new SolverRunner({
      onError: (e) => errors.push(e),
      onIterationChange: (state) => iterations.push(state),
    });
    await runner.solve(makeSimpleConstraint(), { mode: 'step-by-step' });
    await waitForSettle();
    solver.resolveNext();  // Step 0 displayed.
    await waitForSettle();

    runner.next();
    await waitForSettle();
    solver.rejectNext(new Error('boom'));
    await waitForSettle();

    assert.equal(errors.length, 1);
    assert.deepEqual(iterations.map(s => s.index), [0, 0],
      'the failed step is never reported as shown');
    assert.equal(iterations.at(-1).fetching, false,
      'the failure is reported, so the controls re-enable');

    // A guide applies to the displayed step (0), not the failed one (1).
    runner.handleAltClick(0);
    await waitForSettle();
    assert.deepEqual(solver.calls.at(-1), { n: 0, guideSteps: [0] });
    solver.resolveNext();
    await waitForSettle();

    // The next move retries step 1 instead of skipping to step 2.
    runner.next();
    await waitForSettle();
    assert.equal(solver.calls.at(-1).n, 1);
    solver.resolveNext();
    await waitForSettle();
  });
});

// ============================================================================
// One fetch at a time
// ============================================================================

await runTest('moves and guides are ignored while a step is being fetched', async () => {
  await withScriptedStepSolver(async (solver) => {
    const errors = [];
    const iterations = [];
    let fetchStarts = 0;
    const runner = new SolverRunner({
      onError: (e) => errors.push(e),
      onFetchStart: () => fetchStarts++,
      onIterationChange: (state) => iterations.push(state),
    });
    await runner.solve(makeSimpleConstraint(), { mode: 'step-by-step' });
    await waitForSettle();
    solver.resolveNext();  // Step 0 displayed.
    await waitForSettle();
    assert.equal(iterations.at(-1).fetching, false);
    const reportsBefore = iterations.length;

    runner.next();  // Step 1 in flight.
    await waitForSettle();
    assert.equal(solver.calls.length, 2);
    assert.equal(fetchStarts, 2, 'the UI is told a fetch is in flight');
    assert.equal(iterations.length, reportsBefore,
      'nothing else is reported until the fetch finishes');

    runner.handleAltClick(0);
    runner.selectValue(1);
    runner.next();
    runner.previous();
    runner.toStart();
    runner.toEnd();
    await waitForSettle();
    assert.equal(solver.calls.length, 2, 'no solver call starts mid-fetch');

    solver.resolveNext();  // Step 1 displayed.
    await waitForSettle();
    assert.deepEqual(errors, []);
    assert.deepEqual(
      { index: iterations.at(-1).index, fetching: iterations.at(-1).fetching },
      { index: 1, fetching: false });

    // Once the fetch lands, a guide applies to the displayed step.
    runner.handleAltClick(0);
    await waitForSettle();
    assert.deepEqual(solver.calls.at(-1), { n: 1, guideSteps: [1] });
    solver.resolveNext();
    await waitForSettle();

    // Selecting a value guides the displayed step too.
    runner.selectValue(2);
    await waitForSettle();
    assert.equal(solver.calls.at(-1).n, 1);
    assert.equal(solver.lastGuides.get(1).value, 2);
    solver.resolveNext();
    await waitForSettle();
  });
});

await runTest('a fetch from a replaced solve does not lift the new solve\'s gate', async () => {
  await withScriptedStepSolver(async (solver) => {
    const runner = new SolverRunner();
    await runner.solve(makeSimpleConstraint(), { mode: 'step-by-step' });
    await waitForSettle();
    // Solve A's step 0 is still in flight when solve B starts.
    await runner.solve(makeSimpleConstraint(), { mode: 'step-by-step' });
    await waitForSettle();
    assert.equal(solver.calls.length, 2);

    solver.resolveNext();  // A's stale step lands; B's step 0 still in flight.
    await waitForSettle();
    runner.next();
    await waitForSettle();
    assert.equal(solver.calls.length, 2, 'B is still fetching, so next is ignored');

    solver.resolveNext();
    await waitForSettle();
  });
});

// ============================================================================
// Following
// ============================================================================

await runTest('toggling follow off lets the step in flight land and requests no more', async () => {
  await withScriptedStepSolver(async (solver) => {
    const iterations = [];
    const fetchStarts = [];
    const runner = new SolverRunner({
      onFetchStart: (following) => fetchStarts.push(following),
      onIterationChange: (state) => iterations.push(state),
    });
    await runner.solve(makeSimpleConstraint(), { mode: 'step-by-step' });
    await waitForSettle();
    solver.resolveNext();  // Step 0 displayed.
    await waitForSettle();

    runner.toggleFollowing();  // Following; step 1 in flight.
    await waitForSettle();
    assert.equal(fetchStarts.at(-1), true, 'the UI is told playback is following');

    // Allowed mid-fetch: it starts no fetch.
    runner.toggleFollowing();
    assert.equal(iterations.at(-1).following, false);
    assert.equal(iterations.at(-1).fetching, true);

    solver.resolveNext();  // Step 1 lands.
    await waitForSettle();
    assert.equal(iterations.at(-1).index, 1);
    assert.equal(solver.calls.length, 2, 'no further step is requested');
    assert.ok(!solver.terminated, 'the solver is left alone');
  });
});

await runTest('following ends at the end of the step search', async () => {
  await withScriptedStepSolver(async (solver) => {
    const iterations = [];
    const runner = new SolverRunner({
      onIterationChange: (state) => iterations.push(state),
    });
    const handler = await runner.solve(makeSimpleConstraint(), { mode: 'step-by-step' });
    await waitForSettle();
    solver.resolveNext();  // Step 0.
    await waitForSettle();

    runner.toEnd();
    await waitForSettle();
    solver.resolveNext();  // Step 1; following requests step 2.
    await waitForSettle();
    assert.equal(iterations.at(-1).following, true);
    solver.resolveEnd();  // Step 2 is the end of the search.
    await waitForSettle();

    assert.equal(handler.isDone(), true);
    assert.deepEqual(
      { index: iterations.at(-1).index, following: iterations.at(-1).following },
      { index: 2, following: false });
    assert.equal(solver.calls.length, 3);

    // A guide changes the search path, so its end is unknown again.
    runner.previous();
    await waitForSettle();
    solver.resolveNext();  // Step 1.
    await waitForSettle();
    runner.handleAltClick(0);
    assert.equal(handler.isDone(), false);
    await waitForSettle();
    solver.resolveNext();
    await waitForSettle();
  });
});

await runTest('in a streaming mode, following lasts until the solve finishes', async () => {
  let pushState = null;
  const savedMakeSolver = SolverProxy.makeSolver;
  SolverProxy.makeSolver = async (constraint, stateHandler) => {
    pushState = stateHandler;
    return {
      solveAllPossibilities: () => new Promise(() => { }),
      terminate() { },
    };
  };
  try {
    const iterations = [];
    const runner = new SolverRunner({
      onIterationChange: (state) => iterations.push(state),
    });
    await runner.solve(makeSimpleConstraint(), { mode: 'all-possibilities' });
    await waitForSettle();

    runner.toEnd();
    await waitForSettle();
    pushState({ extra: { solutions: [[1, 2], [2, 1]] } });
    await waitForSettle();
    assert.deepEqual(
      { index: iterations.at(-1).index, following: iterations.at(-1).following },
      { index: 2, following: true },
      'caught up, but still following while the solver works');

    pushState({ done: true });
    await waitForSettle();
    assert.equal(iterations.at(-1).following, false);
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }
});

// ============================================================================
// Replaced solves
// ============================================================================

// Solver builds that finish only when the test resolves or rejects them.
const withDeferredSolverBuilds = async (fn) => {
  const builds = [];
  const savedMakeSolver = SolverProxy.makeSolver;
  SolverProxy.makeSolver = (constraints, stateHandler, statusHandler) =>
    new Promise((resolve, reject) => {
      builds.push({ stateHandler, statusHandler, resolve, reject });
    });
  try {
    await fn(builds);
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }
};

const makeIdleSolver = () => ({
  solveAllPossibilities: () => new Promise(() => { }),
  nthSolution: () => new Promise(() => { }),
  terminate() { this.terminated = true; },
});

await runTest('a solve replaced while its solver is built has no effect', async () => {
  await withDeferredSolverBuilds(async (builds) => {
    const states = [];
    const statuses = [];
    const runner = new SolverRunner({
      stateHandler: (state) => states.push(state),
      statusHandler: (isSolving, method) => statuses.push(method),
    });
    const solveA = runner.solve(makeSimpleConstraint(), { mode: 'all-possibilities' });
    const solveB = runner.solve(makeSimpleConstraint(), { mode: 'solutions' });

    // A's build reports and finishes after B replaced it.
    builds[0].statusHandler(false, 'init');
    builds[0].stateHandler({ done: false });
    const solverA = makeIdleSolver();
    builds[0].resolve(solverA);
    assert.equal(await solveA, undefined);
    assert.ok(solverA.terminated);
    assert.deepEqual(states, []);
    assert.deepEqual(statuses, []);

    builds[1].resolve(makeIdleSolver());
    assert.ok((await solveB) instanceof Modes.SOLUTIONS);
  });
});

await runTest('abort while the solver is built reports the stop once', async () => {
  await withDeferredSolverBuilds(async (builds) => {
    const statuses = [];
    const runner = new SolverRunner({
      statusHandler: (isSolving, method) => statuses.push([isSolving, method]),
    });
    const solve = runner.solve(makeSimpleConstraint(), { mode: 'all-possibilities' });
    builds[0].statusHandler(true, 'init');

    runner.abort();
    // The build finishing afterwards is ignored.
    builds[0].statusHandler(false, 'init');
    const solver = makeIdleSolver();
    builds[0].resolve(solver);

    assert.equal(await solve, undefined);
    assert.ok(solver.terminated);
    assert.deepEqual(statuses, [[true, 'init'], [false, 'terminate']]);
    assert.equal(runner.isSolving(), false);
  });
});

await runTest('a replaced solve\'s build failure is not reported', async () => {
  await withDeferredSolverBuilds(async (builds) => {
    const errors = [];
    const runner = new SolverRunner({ onError: (e) => errors.push(e) });
    const solveA = runner.solve(makeSimpleConstraint(), { mode: 'all-possibilities' });
    runner.solve(makeSimpleConstraint(), { mode: 'all-possibilities' });

    builds[0].reject(new Error('boom'));
    assert.equal(await solveA, undefined);
    assert.deepEqual(errors, []);
  });
});

// Exercise the real asynchronous worker factory with a controllable transport.
const withFactoryWorkers = async (fn) => {
  const savedWorker = globalThis.Worker;
  const hadWorker = Object.hasOwn(globalThis, 'Worker');
  const savedPool = SolverProxy._unusedWorkers;
  const savedFactory = SolverProxy.makeSolver;
  const workers = [];
  globalThis.Worker = class extends DelayedWorker {
    constructor() { super(); workers.push(this); }
  };
  SolverProxy._unusedWorkers = [];
  SolverProxy.makeSolver = originalMakeSolver;
  try {
    await fn(workers);
  } finally {
    for (const worker of workers) worker.terminate();
    if (hadWorker) globalThis.Worker = savedWorker;
    else delete globalThis.Worker;
    SolverProxy._unusedWorkers = savedPool;
    SolverProxy.makeSolver = savedFactory;
  }
};

await runTest('an already aborted factory request does not create a worker', async () => {
  await withFactoryWorkers(async (workers) => {
    const controller = new AbortController();
    const request = originalMakeSolver(makeSimpleConstraint(), null, null, null, controller.signal);
    controller.abort();
    await assert.rejects(request, { name: 'AbortedError' });
    assert.equal(workers.length, 0);
  });
});

await runTest('replacing pending initialization kills it before any reply and the next solve works', async () => {
  await withFactoryWorkers(async (workers) => {
    const states = [], errors = [];
    const runner = new SolverRunner({ stateHandler: s => states.push(s), onError: e => errors.push(e) });
    let firstSettled = false;
    const first = runner.solve(makeSimpleConstraint()).then(() => { firstSettled = true; });
    await waitForSettle();
    assert.equal(workers[0].messages[0].method, 'init');
    const second = runner.solve(makeSimpleConstraint(), { mode: Modes.COUNT_SOLUTIONS.NAME });
    await waitForSettle();
    assert.equal(firstSettled, true, 'cancellation must settle without an init result');
    assert.equal(workers[0].terminated, true);
    assert.equal(SolverProxy._unusedWorkers.includes(workers[0]), false);
    assert.equal(SolverProxy._unusedWorkers.length, 0);
    workers[0].emit({ type: 'state', state: { done: true } });
    workers[0].emit({ type: 'result', result: true });
    assert.deepEqual(states, []);
    workers[1].emit({ type: 'result', result: true });
    const handler = await second;
    await waitForSettle();
    assert.equal(workers[1].messages.at(-1).method, 'countSolutions');
    workers[1].emit({ type: 'state', state: { done: true } });
    workers[1].emit({ type: 'result', result: 1 });
    await waitForSettle();
    assert.equal(handler.isDone(), true);
    runner.abort();
    assert.equal(SolverProxy._unusedWorkers.includes(workers[1]), true);
    assert.equal(workers[1].terminated, false);
    assert.equal(SolverProxy._unusedWorkers.length, 1);
    assert.deepEqual(errors, []);
    await first;
  });
});

await runTest('the factory signal stops owning cancellation once initialization completes', async () => {
  await withFactoryWorkers(async (workers) => {
    const controller = new AbortController();
    const request = originalMakeSolver(makeSimpleConstraint(), null, null, null, controller.signal);
    await waitForSettle();
    workers[0].emit({ type: 'result', result: true });
    const proxy = await request;
    controller.abort();
    assert.equal(proxy.isTerminated(), false, 'the caller owns the initialized proxy');
    proxy.terminate();
    assert.equal(SolverProxy._unusedWorkers.includes(workers[0]), true);
  });
});

await runTest('initialization errors preserve their details and remove the abort listener', async () => {
  await withFactoryWorkers(async (workers) => {
    const controller = new AbortController();
    let added = 0, removed = 0;
    const signal = {
      get aborted() { return controller.signal.aborted; },
      addEventListener(...args) { added++; controller.signal.addEventListener(...args); },
      removeEventListener(...args) { removed++; controller.signal.removeEventListener(...args); },
    };
    const request = originalMakeSolver(makeSimpleConstraint(), null, null, null, signal);
    await waitForSettle();
    workers[0].emit({ type: 'exception', method: 'init', error: {
      name: 'InvalidConstraintError', message: 'invalid region', stack: 'worker initialization stack',
    } });
    await assert.rejects(request, { name: 'InvalidConstraintError', message: 'invalid region', workerMethod: 'init' });
    assert.equal(added, 1);
    assert.equal(removed, 1);
  });
});

await runTest('abort from an initialization status callback does not post to a terminated proxy', async () => {
  await withFactoryWorkers(async (workers) => {
    const controller = new AbortController();
    const request = originalMakeSolver(makeSimpleConstraint(), null,
      (active, method) => { if (active && method === 'init') controller.abort(); },
      null, controller.signal);
    await assert.rejects(request, { name: 'AbortedError' });
    assert.equal(workers[0].messages.length, 0);
    assert.equal(SolverProxy._unusedWorkers.includes(workers[0]), true);
  });
});

await runTest('failed factory builds release one worker for retries and a later successful request', async () => {
  await withFactoryWorkers(async (workers) => {
    for (let i = 0; i < 2; i++) {
      const request = originalMakeSolver(makeSimpleConstraint());
      await waitForSettle();
      assert.equal(workers.length, 1);
      workers[0].emit({ type: 'exception', method: 'init', error: {
        name: 'InvalidConstraintError', message: 'invalid region', stack: 'worker stack',
      } });
      await assert.rejects(request, { name: 'InvalidConstraintError', message: 'invalid region',
        stack: 'worker stack', workerMethod: 'init' });
      assert.deepEqual(SolverProxy._unusedWorkers, [workers[0]]);
      assert.equal(workers[0]._listeners.size, 0);
      workers[0].emit({ type: 'state', state: { done: true } });
    }
    const request = originalMakeSolver(makeSimpleConstraint());
    await waitForSettle();
    assert.equal(workers.length, 1);
    workers[0].emit({ type: 'result', result: true });
    const proxy = await request;
    const count = proxy.countSolutions();
    workers[0].emit({ type: 'result', result: 288 });
    assert.equal(await count, 288);
    proxy.terminate();
    assert.deepEqual(SolverProxy._unusedWorkers, [workers[0]]);
    assert.equal(workers[0]._listeners.size, 0);
  });
});

await runTest('a failed send rejects its request and permits the next request', async () => {
  const worker = new DelayedWorker();
  const statuses = [];
  const proxy = new SolverProxy(worker, null, (active, method) => statuses.push([active, method]));
  proxy._initialized = true;
  const postMessage = worker.postMessage;
  const error = new DOMException('uncloneable data', 'DataCloneError');
  worker.postMessage = () => { throw error; };
  await assert.rejects(proxy.countSolutions(), actual => actual === error);
  assert.deepEqual(statuses, [[true, 'countSolutions'], [false, 'countSolutions']]);
  worker.postMessage = postMessage;
  const request = proxy.countSolutions(2);
  assert.deepEqual(worker.messages, [{ method: 'countSolutions', payload: 2 }]);
  worker.emit({ type: 'result', result: 1 });
  assert.equal(await request, 1);
  proxy.terminate();
  assert.equal(worker.released, true);
});

await runTest('a factory send failure returns its worker and allows reinitialization', async () => {
  await withFactoryWorkers(async (workers) => {
    const error = new DOMException('uncloneable data', 'DataCloneError');
    const postMessage = globalThis.Worker.prototype.postMessage;
    let fail = true;
    globalThis.Worker.prototype.postMessage = function (message) {
      if (fail) throw error;
      return postMessage.call(this, message);
    };
    await assert.rejects(originalMakeSolver(makeSimpleConstraint()), actual => actual === error);
    assert.equal(workers.length, 1);
    assert.equal(workers[0]._listeners.size, 0);
    assert.deepEqual(SolverProxy._unusedWorkers, [workers[0]]);
    fail = false;
    const request = originalMakeSolver(makeSimpleConstraint());
    await waitForSettle();
    assert.equal(workers.length, 1);
    workers[0].emit({ type: 'result', result: true });
    const proxy = await request;
    proxy.terminate();
    assert.deepEqual(SolverProxy._unusedWorkers, [workers[0]]);
  });
});

for (const getter of ['getCallback', 'getOptions']) {
  await runTest(`${getter} failure does not create or acquire a worker`, async () => {
    await withFactoryWorkers(async (workers) => {
      const error = new Error(`invalid debug ${getter}`);
      const debugHandler = { getCallback: () => null, getOptions: () => ({}) };
      debugHandler[getter] = () => { throw error; };
      const request = () => originalMakeSolver(makeSimpleConstraint(), null, null, debugHandler);
      await assert.rejects(request(), actual => actual === error);
      assert.equal(workers.length, 0);
      assert.deepEqual(SolverProxy._unusedWorkers, []);

      const idle = new Worker();
      SolverProxy._unusedWorkers.push(idle);
      await assert.rejects(request(), actual => actual === error);
      assert.equal(workers.length, 1);
      assert.deepEqual(SolverProxy._unusedWorkers, [idle]);
      assert.equal(idle.messages.length, 0);
      assert.equal(idle._listeners.size, 0);
      assert.equal(idle.terminated, false);
    });
  });
}

await runTest('abort during debug configuration does not acquire a worker', async () => {
  await withFactoryWorkers(async (workers) => {
    for (const getter of ['getCallback', 'getOptions']) {
      const controller = new AbortController();
      const debugHandler = { getCallback: () => null, getOptions: () => ({}) };
      debugHandler[getter] = () => { controller.abort(); return null; };
      await assert.rejects(
        originalMakeSolver(makeSimpleConstraint(), null, null, debugHandler, controller.signal),
        { name: 'AbortedError' });
      assert.equal(workers.length, 0);
      assert.deepEqual(SolverProxy._unusedWorkers, []);
    }
  });
});

// ============================================================================
// Cleanup
// ============================================================================

// Restore original makeSolver
SolverProxy.makeSolver = originalMakeSolver;

logSuiteComplete('SolverRunner');
