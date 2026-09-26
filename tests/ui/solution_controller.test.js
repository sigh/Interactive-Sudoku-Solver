import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { ScriptedStepSolver } from '../helpers/scripted_step_solver.js';
import { makeFakeDocument } from '../helpers/mock_dom.js';

const frames = [];

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });
globalThis.window.requestAnimationFrame = (cb) => frames.push(cb);

const makeStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
  };
};
globalThis.sessionStorage = makeStorage();
globalThis.localStorage = makeStorage();

const { SolutionController } = await import('../../js/solution_controller.js');
const { SolverProxy, DEFAULT_MODE, getModeDescription } =
  await import('../../js/solver_runner.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');

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
// The constructor needs the whole page, so set up a bare instance with just
// what the controller uses: its elements, and stubs for the rest of the page
// that record calls.
const recorder = (calls, name) => (...args) => calls.push([name, ...args]);

const makeController = () => {
  const controller = Object.create(SolutionController.prototype);
  const displayCalls = [];
  controller.displayCalls = displayCalls;

  const elements = {};
  for (const name of [
    'start', 'back', 'forward', 'end', 'stop', 'solve', 'download', 'copyUrl']) {
    elements[name] = document.createElement('button');
  }
  for (const name of ['iterationState', 'error', 'modeDescription', 'buttonPanel']) {
    elements[name] = document.createElement('div');
  }
  elements.mode = document.createElement('select');
  elements.autoSolve = document.createElement('input');
  // The threshold input sits two wrappers deep, next to its value label.
  elements.candidateSupportThreshold = document.createElement('input');
  const thresholdRow = document.createElement('div');
  thresholdRow.append(elements.candidateSupportThreshold, document.createElement('span'));
  document.createElement('div').append(thresholdRow);
  controller._elements = elements;

  controller._stateDisplay = {
    setState: recorder(displayCalls, 'setState'),
    setSolveStatus: recorder(displayCalls, 'setSolveStatus'),
    setEstimateMode: recorder(displayCalls, 'setEstimateMode'),
    clear: () => { },
  };
  controller._solutionDisplay = { setSolution: recorder(displayCalls, 'solution') };
  controller._chaosRegionBorderDisplay = { setSolution: () => { } };
  controller._yinYangShadingDisplay = { setSolution: () => { } };
  controller._stepHighlighter = { setCells: recorder(displayCalls, 'highlight') };
  controller._diffDisplay = { renderGridValues: () => { }, clear: () => { } };
  controller._debugManager = { clear: () => { }, get: async () => null };
  controller._flameGraphManager = { clear: () => { }, get: async () => null };
  controller._displayContainer = {
    toggleLayoutView: recorder(displayCalls, 'layoutView'),
  };

  // The puzzle is the constraint string `q`; layout constraints are their own.
  controller._constraintManager = {
    q: '.',
    layoutConstraints: { layout: true },
    getConstraints() { return { toString: () => this.q }; },
    getLayoutConstraints() { return this.layoutConstraints; },
  };
  const historyCalls = [];
  controller.historyCalls = historyCalls;
  controller._historyHandler = {
    update: recorder(historyCalls, 'update'),
    setUrlParams: recorder(historyCalls, 'url'),
  };

  controller._setUpPlayback();
  controller._setUpInputs();
  return controller;
};

// A controller over a step solver scripted by the test, showing step 0.
// `worker` has the handlers the runner gave the proxy, to send it state and
// status as the worker would.
const withController = async (fn) => {
  const solver = new ScriptedStepSolver();
  const worker = {};
  const savedMakeSolver = SolverProxy.makeSolver;
  SolverProxy.makeSolver = async (constraints, stateHandler, statusHandler) => {
    Object.assign(worker, { stateHandler, statusHandler });
    return solver;
  };
  // A fresh document, so key listeners from earlier tests are gone.
  globalThis.document = makeFakeDocument();
  try {
    const controller = makeController();
    await controller._solverRunner.solve(null, { mode: 'step-by-step' });
    await settle();
    solver.resolveNext();  // Step 0 displayed.
    await settle();
    await fn(controller, solver, worker);
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }
};

const NAVIGATION = ['start', 'back', 'forward', 'end'];

const enabled = (controller) => NAVIGATION
  .filter(name => !controller._elements[name].disabled);

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
  const controller = makeController();

  controller._handleIterationChange(state({ index: 0, isAtStart: true }));
  assert.deepEqual(enabled(controller), ['forward', 'end']);

  controller._handleIterationChange(state());
  assert.deepEqual(enabled(controller), ['start', 'back', 'forward', 'end']);

  controller._handleIterationChange(state({ index: 3, isAtEnd: true }));
  assert.deepEqual(enabled(controller), ['start', 'back']);
  assert.equal(controller._elements.iterationState.textContent, 'Step 1');
});

await runTest('a fetch in flight disables navigation and step guides', () => {
  const controller = makeController();
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
  const controller = makeController();
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
  const controller = makeController();
  controller._solverRunner.selectValue = (v) => selected.push(v);

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

await runTest('‹ and « move back, and so do the p and s keys', async () => {
  await withController(async (controller, solver) => {
    controller._setUpKeyBindings({
      getClickInterceptor: () => ({ getSvg: () => ({ addEventListener() { } }) }),
    });
    const { forward, back, start, iterationState } = controller._elements;
    const step = () => Number(iterationState.textContent.match(/Step (\d+)/)[1]);
    const move = async (act) => {
      act();
      solver.resolveNext();
      await settle();
    };
    const press = (key) => () => {
      pressKey('keydown', key);
      pressKey('keyup', key);
    };

    for (let i = 0; i < 3; i++) await move(() => forward.click());
    assert.equal(step(), 3);

    await move(() => back.click());
    assert.equal(step(), 2);
    await move(() => start.click());
    assert.equal(step(), 0);

    for (let i = 0; i < 2; i++) await move(() => forward.click());
    await move(press('p'));
    assert.equal(step(), 1);
    await move(press('s'));
    assert.equal(step(), 0);
  });
});

await runTest('a new grid shape aborts the solve', async () => {
  await withController(async (controller, solver) => {
    const geometry = { numGridCells: 16 };
    controller.reshape(geometry);
    assert.ok(solver.terminated);
    assert.equal(controller._geometry, geometry);
  });
});

// ============================================================================
// Wiring to the rest of the page
// ============================================================================

await runTest('each step result is drawn on the grid', async () => {
  await withController(async (controller) => {
    const drawn = controller.displayCalls.filter(([name]) => name === 'solution');
    assert.deepEqual(drawn.at(-1)[1], [new Set([1, 2]), 3]);
  });
});

await runTest('solver status drives Stop, and state reaches the state display', async () => {
  await withController(async (controller, solver, worker) => {
    const { stop } = controller._elements;

    worker.statusHandler(true, 'nthStep');
    assert.equal(stop.disabled, false);
    worker.statusHandler(false, 'nthStep');
    assert.equal(stop.disabled, true);
    assert.deepEqual(
      controller.displayCalls.filter(([name]) => name === 'setSolveStatus').slice(-2),
      [['setSolveStatus', true, 'nthStep'], ['setSolveStatus', false, 'nthStep']]);

    const state = { done: true, counters: {} };
    worker.stateHandler(state);
    assert.deepEqual(controller.displayCalls.at(-1), ['setState', state]);
    assert.equal(controller._searchComplete, true);
  });
});

await runTest('Stop aborts the solver and locks the controls', async () => {
  await withController(async (controller, solver) => {
    const { end, stop } = controller._elements;

    end.click();  // Following, with a step in flight.
    stop.click();

    assert.ok(solver.terminated);
    assert.deepEqual(enabled(controller), []);
    assert.equal(end.textContent, '»');
  });
});

await runTest('a solver error is shown', async () => {
  await withController(async (controller, solver) => {
    controller._elements.forward.click();
    solver.rejectNext(new Error('boom'));
    await settle();

    assert.match(controller._elements.error.textContent, /boom/);
    assert.deepEqual(controller.displayCalls.at(-1), ['setSolveStatus', false, 'terminate']);
  });
});

// ============================================================================
// Choosing what to solve (_update)
// ============================================================================

// The arguments of the last display call named `name`.
const lastCall = (controller, name) =>
  controller.displayCalls.filter(c => c[0] === name).at(-1).slice(1);

// Run _update, recording whether it solved (and what) or reset.
const runUpdate = (controller, options) => {
  const actions = [];
  controller._solve = recorder(actions, 'solve');
  controller._resetSolver = recorder(actions, 'reset');
  controller._update(options);
  return actions;
};

await runTest('auto-solve solves the puzzle; otherwise the solver is reset', () => {
  const controller = makeController();
  const { mode, autoSolve } = controller._elements;
  mode.value = 'all-possibilities';
  controller._constraintManager.q = '.~R1C1_1';

  autoSolve.checked = true;
  const [[action, constraints]] = runUpdate(controller);
  assert.equal(action, 'solve');
  assert.equal(String(constraints), '.~R1C1_1');

  autoSolve.checked = false;
  assert.deepEqual(runUpdate(controller), [['reset']]);
  assert.equal(runUpdate(controller, { forceSolve: true })[0][0], 'solve');
});

await runTest('step-by-step solves even without auto-solve', () => {
  const controller = makeController();
  controller._elements.mode.value = 'step-by-step';
  controller._elements.autoSolve.checked = false;
  assert.equal(runUpdate(controller)[0][0], 'solve');
});

await runTest('validate-layout solves the layout, in the layout view', () => {
  const controller = makeController();
  const { mode, autoSolve } = controller._elements;
  autoSolve.checked = true;

  mode.value = 'validate-layout';
  const [[, constraints]] = runUpdate(controller);
  assert.equal(constraints, controller._constraintManager.layoutConstraints);
  assert.deepEqual(lastCall(controller, 'layoutView'), [true]);

  mode.value = 'solutions';
  runUpdate(controller);
  assert.deepEqual(lastCall(controller, 'layoutView'), [false]);
});

await runTest('the URL leaves out the default mode and an empty puzzle', () => {
  const controller = makeController();
  const { mode } = controller._elements;

  mode.value = DEFAULT_MODE;
  controller._constraintManager.q = '.';
  runUpdate(controller);
  assert.deepEqual(controller.historyCalls.at(-1), ['update', { mode: undefined, q: undefined }]);

  mode.value = 'solutions';
  controller._constraintManager.q = '.~R1C1_1';
  runUpdate(controller);
  assert.deepEqual(controller.historyCalls.at(-1), ['update', { mode: 'solutions', q: '.~R1C1_1' }]);
});

await runTest('the page follows the mode', () => {
  const controller = makeController();
  const { mode, modeDescription, candidateSupportThreshold } = controller._elements;
  const thresholdPanel = candidateSupportThreshold.parentElement.parentElement;

  for (const [name, estimate, thresholdShown] of [
    ['all-possibilities', false, true],
    ['estimate-solutions', true, false],
    ['solutions', false, false],
  ]) {
    mode.value = name;
    runUpdate(controller);
    assert.equal(modeDescription.textContent, getModeDescription(name), name);
    assert.deepEqual(lastCall(controller, 'setEstimateMode'), [estimate], name);
    assert.equal(thresholdPanel.style.display, thresholdShown ? '' : 'none', name);
  }

  mode.value = '';
  runUpdate(controller);
  assert.equal(mode.value, DEFAULT_MODE, 'no mode falls back to the default');
});

// ============================================================================
// Setting up the page for a solve (_solve)
// ============================================================================

// Solver builds that finish when the test resolves them, into solvers that never
// finish a call.
const withSolverBuilds = async (fn) => {
  const builds = [];
  const savedMakeSolver = SolverProxy.makeSolver;
  // Each build can also send state, as the worker would.
  SolverProxy.makeSolver = (constraints, stateHandler) => new Promise((resolve) => {
    builds.push(Object.assign(() => resolve({
      solveAllPossibilities: () => new Promise(() => { }),
      countSolutions: () => new Promise(() => { }),
      terminate() { },
    }), { stateHandler }));
  });
  try {
    await fn(builds);
  } finally {
    SolverProxy.makeSolver = savedMakeSolver;
  }
};

await runTest('download and the step controls are enabled only for modes that have them', async () => {
  await withSolverBuilds(async (builds) => {
    const controller = makeController();
    const { mode, download, buttonPanel } = controller._elements;

    mode.value = 'all-possibilities';
    const solve = controller._solve();
    await settle();
    builds.shift()();
    await solve;
    assert.equal(download.disabled, false);
    assert.equal(buttonPanel.style.visibility, 'visible');

    mode.value = 'count-solutions';
    const count = controller._solve();
    await settle();
    builds.shift()();
    await count;
    assert.equal(download.disabled, true);
    assert.equal(buttonPanel.style.visibility, 'hidden');
  });
});

await runTest('resetting the solver disables download', async () => {
  await withSolverBuilds(async (builds) => {
    const controller = makeController();
    const { mode, autoSolve, download } = controller._elements;

    mode.value = 'all-possibilities';
    const solve = controller._solve();
    await settle();
    builds.shift()();
    await solve;
    assert.equal(download.disabled, false);

    // With auto-solve off, a change resets the solver instead of solving.
    autoSolve.checked = false;
    controller._update();
    assert.equal(download.disabled, true);
  });
});

await runTest('a solve replaced before it starts leaves the page set up for the new one', async () => {
  await withSolverBuilds(async (builds) => {
    const controller = makeController();
    const { mode, download, buttonPanel } = controller._elements;

    mode.value = 'all-possibilities';
    const replaced = controller._solve();
    mode.value = 'count-solutions';
    const current = controller._solve();
    await settle();

    // The replaced solve's solver is built first.
    builds[0]();
    builds[1]();
    await Promise.all([replaced, current]);
    assert.equal(download.disabled, true);
    assert.equal(buttonPanel.style.visibility, 'hidden');
  });
});

await runTest('download saves the solutions found, one per line', async () => {
  await withSolverBuilds(async (builds) => {
    const controller = makeController();
    controller._geometry = CellGeometry.fromGridSize(4);
    const { mode, download } = controller._elements;

    mode.value = 'all-possibilities';
    const solve = controller._solve();
    await settle();
    const build = builds.shift();
    build();
    await solve;
    const solutions = [
      [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
      [1, 2, 3, 4, 3, 4, 1, 2, 2, 3, 4, 1, 4, 1, 2, 3],
    ];
    build.stateHandler({ counters: {}, extra: { solutions } });

    // Capture the file, and the link that downloads it.
    let file = null;
    const revoked = [];
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = (blob) => { file = blob; return 'blob:solutions'; };
    URL.revokeObjectURL = (url) => revoked.push(url);
    const links = [];
    const createElement = document.createElement;
    document.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === 'a') {
        element.onclick = () => links.push({ href: element.href, name: element.download });
      }
      return element;
    };
    try {
      download.click();
      assert.deepEqual(revoked, [], 'not released before the download starts');
      await settle();
    } finally {
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      document.createElement = createElement;
    }
    assert.deepEqual(revoked, ['blob:solutions'], 'the file is released');

    assert.equal(await file.text(),
      '1234341221434321\n1234341223414123');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, 'blob:solutions');
    assert.match(links[0].name, /^sudoku-iss-solutions-.*\.txt$/);
    assert.deepEqual(document.body.children, [], 'the link is removed');
  });
});

// ============================================================================
// Inputs (_setUpInputs)
// ============================================================================

await runTest('the threshold input updates its label, the URL and the runner', () => {
  const controller = makeController();
  const { mode, candidateSupportThreshold: input } = controller._elements;
  const updates = [];
  controller._update = recorder(updates, 'update');
  const thresholds = [];
  let handled = true;
  controller._solverRunner.setCandidateSupportThreshold = (t) => {
    thresholds.push(t);
    return handled;
  };

  mode.value = 'all-possibilities';
  input.value = '3';
  input.oninput();
  assert.equal(input.nextElementSibling.textContent, '3');
  assert.deepEqual(controller.historyCalls.at(-1), ['url', { valueCountLimit: 3 }]);
  assert.deepEqual(thresholds, [4], 'the threshold is one more than the limit');
  assert.deepEqual(updates, [], 'the current solve handles it');

  handled = false;
  input.oninput();
  assert.deepEqual(updates, [['update']], 'the solve must be redone');
});

await runTest('the value count limit is only in the URL in all-possibilities mode', () => {
  const controller = makeController();
  const { mode, candidateSupportThreshold: input } = controller._elements;
  controller._update = () => { };

  input.value = '3';
  mode.value = 'solutions';
  mode.onchange();
  assert.deepEqual(controller.historyCalls.at(-1), ['url', { valueCountLimit: undefined }]);

  input.value = '0';
  mode.value = 'all-possibilities';
  mode.onchange();
  assert.deepEqual(controller.historyCalls.at(-1), ['url', { valueCountLimit: undefined }]);
});

await runTest('changing the mode and pressing Solve update the page', () => {
  const controller = makeController();
  const calls = [];
  controller._update = recorder(calls, 'update');
  controller._solve = recorder(calls, 'solve');

  controller._elements.mode.onchange();
  controller._elements.solve.click();
  assert.deepEqual(calls, [['update'], ['solve']]);
});

await runTest('auto-solve is remembered, and turning it on solves unless solving', () => {
  sessionStorage.setItem('autoSolve', 'false');
  const controller = makeController();
  const { autoSolve } = controller._elements;
  assert.equal(autoSolve.checked, false, 'read from storage');

  const updates = [];
  controller._update = recorder(updates, 'update');
  autoSolve.checked = true;
  autoSolve.onchange();
  assert.equal(sessionStorage.getItem('autoSolve'), 'true');
  assert.deepEqual(updates, [['update']]);

  controller._solverRunner.isSolving = () => true;
  autoSolve.onchange();
  assert.deepEqual(updates, [['update']], 'not while already solving');
});

await runTest('the share URL keeps only the puzzle, mode and value count limit', () => {
  const controller = makeController();
  globalThis.location.href =
    'https://example.test/iss/?q=.~R1C1_1&mode=solutions&valueCountLimit=2&x=1#top';
  assert.equal(controller._shareUrlToString(),
    'https://example.test/iss/?q=.~R1C1_1&mode=solutions&valueCountLimit=2');
});

logSuiteComplete('SolutionController');
