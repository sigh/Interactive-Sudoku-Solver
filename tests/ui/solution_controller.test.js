import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { ScriptedStepSolver } from '../helpers/scripted_step_solver.js';
import { makeFakeDocument } from '../helpers/mock_dom.js';

const frames = [];

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });
globalThis.window.requestAnimationFrame = (cb) => frames.push(cb);

const { SolutionController } = await import('../../js/solution_controller.js');
const { SolverRunner, SolverProxy } = await import('../../js/solver_runner.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const runFrames = (n) => {
  for (let i = 0; i < n; i++) {
    for (const cb of frames.splice(0)) cb();
  }
};

const pressKey = (type, key) => document.dispatch(type, {
  key, target: null, preventDefault() { },
});

// The controller needs the whole page to construct, so test its playback
// methods on a bare instance with just the elements they use.
const makeController = (solverRunner) => {
  const controller = Object.create(SolutionController.prototype);
  controller._elements = {
    start: document.createElement('button'),
    back: document.createElement('button'),
    forward: document.createElement('button'),
    end: document.createElement('button'),
    iterationState: document.createElement('div'),
  };
  // As in the constructor.
  controller._pauseIcon = document.createElement('span');
  controller._pauseIcon.className = 'pause-icon';
  controller._solverRunner = solverRunner;
  controller._setUpIterationControls();
  return controller;
};

// A controller driving a real SolverRunner, with the callbacks the constructor
// passes it, over a step solver scripted by the test.
const withController = async (fn) => {
  const solver = new ScriptedStepSolver();
  const savedMakeSolver = SolverProxy.makeSolver;
  SolverProxy.makeSolver = async () => solver;
  try {
    let controller = null;
    const runner = new SolverRunner({
      onFetchStart: (following) => controller._lockIterationControls(following),
      onIterationChange: (state) => controller._handleIterationChange(state),
    });
    controller = makeController(runner);
    await runner.solve(null, { mode: 'step-by-step' });
    await settle();
    solver.resolveNext();  // Step 0 displayed.
    await settle();
    await fn(controller, solver);
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }
};

const enabled = (controller) => Object.entries(controller._elements)
  .filter(([name, e]) => name !== 'iterationState' && !e.disabled)
  .map(([name]) => name);

const showsPause = (controller) =>
  controller._elements.end.children[0] === controller._pauseIcon;

const state = (overrides) => ({
  index: 1, maxIndex: 3, isAtStart: false, isAtEnd: false,
  fetching: false, following: false, description: 'Step 1', statusData: null,
  ...overrides,
});

// ============================================================================
// Rendering
// ============================================================================

await runTest('buttons are enabled by position', () => {
  const controller = makeController(null);

  controller._handleIterationChange(state({ index: 0, isAtStart: true }));
  assert.deepEqual(enabled(controller), ['forward', 'end']);

  controller._handleIterationChange(state());
  assert.deepEqual(enabled(controller), ['start', 'back', 'forward', 'end']);

  controller._handleIterationChange(state({ index: 3, isAtEnd: true }));
  assert.deepEqual(enabled(controller), ['start', 'back']);
  assert.equal(controller._elements.iterationState.textContent, 'Step 1');
});

await runTest('a fetch in flight disables navigation and step guides', () => {
  const controller = makeController(null);
  const iterationState = controller._elements.iterationState;

  controller._lockIterationControls();
  assert.deepEqual(enabled(controller), []);
  assert.ok(iterationState.classList.contains('disabled'));

  controller._handleIterationChange(state({ fetching: true }));
  assert.deepEqual(enabled(controller), []);
  assert.ok(iterationState.classList.contains('disabled'));

  controller._handleIterationChange(state());
  assert.ok(!iterationState.classList.contains('disabled'));
});

await runTest('while following, the end button is ⏸ and stays enabled', () => {
  const controller = makeController(null);
  const end = controller._elements.end;

  controller._lockIterationControls(true);
  assert.deepEqual(enabled(controller), ['end']);
  assert.ok(showsPause(controller));
  assert.equal(end.title, 'stop following');

  controller._handleIterationChange(state({ fetching: true, following: true, isAtEnd: true }));
  assert.deepEqual(enabled(controller), ['end']);
  assert.ok(showsPause(controller));

  controller._handleIterationChange(state());
  assert.equal(end.textContent, '»');
  assert.equal(end.title, 'end');
});

await runTest('value links select that value on the runner', () => {
  const selected = [];
  const controller = makeController({ selectValue: (v) => selected.push(v) });

  controller._handleIterationChange(state({
    statusData: { values: [3, 5], isSolution: false, hasConflict: true },
  }));
  const iterationState = controller._elements.iterationState;
  assert.equal(iterationState.textContent, 'Step 1 {3,5} [Conflict]');

  const links = iterationState.descendants().filter(n => n.tagName === 'A');
  assert.deepEqual(links.map(a => a.textContent), ['3', '5']);
  links[1].click();
  assert.deepEqual(selected, [5]);
});

// ============================================================================
// Driving a SolverRunner
// ============================================================================

await runTest('clicking › during a step fetch does nothing', async () => {
  await withController(async (controller, solver) => {
    const { forward, iterationState } = controller._elements;

    forward.click();
    assert.equal(solver.calls.length, 2);
    assert.deepEqual(enabled(controller), []);

    forward.click();
    forward.click();
    assert.equal(solver.calls.length, 2);

    solver.resolveNext();
    await settle();
    assert.match(iterationState.textContent, /^Step 1 /);
    assert.deepEqual(enabled(controller), ['start', 'back', 'forward', 'end']);
  });
});

await runTest('holding n moves one step per result and stops on release', async () => {
  await withController(async (controller, solver) => {
    controller._setUpKeyBindings({
      getClickInterceptor: () => ({ getSvg: () => ({ addEventListener() { } }) }),
    });
    const { iterationState } = controller._elements;

    // The first keydown clicks ›; a repeat starts clicking every frame.
    pressKey('keydown', 'n');
    pressKey('keydown', 'n');
    for (let step = 1; step <= 3; step++) {
      runFrames(10);
      assert.equal(solver.calls.length, step + 1, 'one request per result');
      solver.resolveNext();
      await settle();
    }
    runFrames(1);  // Requests step 4.

    pressKey('keyup', 'n');
    runFrames(10);
    solver.resolveNext();
    await settle();
    runFrames(10);
    assert.equal(solver.calls.length, 5, 'nothing is requested after release');
    assert.match(iterationState.textContent, /^Step 4 /);
    frames.length = 0;
  });
});

await runTest('» follows, and ⏸ stops after the step in flight', async () => {
  await withController(async (controller, solver) => {
    const { end, iterationState } = controller._elements;

    end.click();
    assert.ok(showsPause(controller));
    assert.deepEqual(enabled(controller), ['end']);
    solver.resolveNext();
    await settle();
    assert.equal(solver.calls.length, 3, 'following requests the next step');

    end.click();  // ⏸
    assert.equal(end.textContent, '»');
    solver.resolveNext();
    await settle();
    assert.equal(solver.calls.length, 3, 'no step after the one in flight');
    assert.match(iterationState.textContent, /^Step 2 /);
    assert.deepEqual(enabled(controller), ['start', 'back', 'forward', 'end']);
  });
});

await runTest('following ends at the end of the search', async () => {
  await withController(async (controller, solver) => {
    const { end, iterationState } = controller._elements;

    end.click();
    solver.resolveNext();
    await settle();
    solver.resolveEnd();  // Step 2 is the end.
    await settle();

    assert.equal(iterationState.textContent, 'Step 2 [Done]');
    assert.equal(end.textContent, '»');
    assert.deepEqual(enabled(controller), ['start', 'back']);
  });
});

logSuiteComplete('SolutionController');
