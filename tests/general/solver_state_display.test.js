import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: undefined });

const { SolverStateDisplay } = await import('../../js/solver_state_display.js');
const { deferUntilAnimationFrame } = await import('../../js/util.js');

// setSolveStatus only touches a few DOM elements, so exercise it on a bare
// instance with stub elements rather than standing up the whole display (which
// needs a full document). _METHOD_TO_STATUS is a per-instance field, so it is
// absent on the bare prototype object; supply the real mapping here.
const makeDisplay = () => {
  const display = Object.create(SolverStateDisplay.prototype);
  const classes = new Set();
  display._isEstimateMode = false;
  display._METHOD_TO_STATUS = {
    solveAllPossibilities: 'Solving',
    nthSolution: 'Solving',
    nthStep: '',
    countSolutions: 'Counting',
    validateLayout: 'Validating',
    terminate: 'Aborted',
    estimatedCountSolutions: 'Estimating',
  };
  display._elements = {
    solveStatus: { textContent: 'stale' },
    progressPercentage: { style: {} },
    progressContainer: {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
    },
  };
  return display;
};

await runTest('setSolveStatus shows the method label while solving', () => {
  const display = makeDisplay();
  display.setSolveStatus(true, 'solveAllPossibilities');
  assert.equal(display._elements.solveStatus.textContent, 'Solving');

  display.setSolveStatus(true, 'countSolutions');
  assert.equal(display._elements.solveStatus.textContent, 'Counting');
});

await runTest('setSolveStatus clears the label when the solve stops', () => {
  const display = makeDisplay();
  display.setSolveStatus(true, 'solveAllPossibilities');
  // Normal completion reports (false, <real method>), not 'terminate'.
  display.setSolveStatus(false, 'solveAllPossibilities');
  assert.equal(display._elements.solveStatus.textContent, '',
    'label must not linger after the solve completes');
});

await runTest('setSolveStatus shows no label for methods without one', () => {
  const display = makeDisplay();
  // 'init' is not in the status map; it must not render as "undefined".
  display.setSolveStatus(true, 'init');
  assert.equal(display._elements.solveStatus.textContent, '');
  // 'nthStep' maps to an intentional empty label.
  display.setSolveStatus(true, 'nthStep');
  assert.equal(display._elements.solveStatus.textContent, '');
});

await runTest('setSolveStatus shows Aborted with the error class on terminate', () => {
  const display = makeDisplay();
  display.setSolveStatus(false, 'terminate');
  assert.equal(display._elements.solveStatus.textContent, 'Aborted');
  assert.ok(display._elements.progressContainer.classList.contains('solver-status-error'));
});

await runTest('setSolveStatus clears the error class when solving resumes', () => {
  const display = makeDisplay();
  display.setSolveStatus(false, 'terminate');
  display.setSolveStatus(true, 'solveAllPossibilities');
  assert.ok(!display._elements.progressContainer.classList.contains('solver-status-error'));
});

// A minimal DOM for the estimate renderers: text nodes, elements with
// children, and the handful of methods the renderers call.
const makeFakeDom = () => {
  class Node {
    constructor(tag, text) { this.tag = tag; this.text = text ?? ''; this.childNodes = []; }
    appendChild(n) { this.childNodes.push(n); return n; }
    insertBefore(n, ref) {
      const i = this.childNodes.indexOf(ref);
      this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
      return n;
    }
    replaceChildren() { this.childNodes = []; }
    cloneNode() { return new Node(this.tag, this.text); }
    get firstChild() { return this.childNodes[0] ?? null; }
    get textContent() { return this.text + this.childNodes.map(c => c.textContent).join(''); }
    set textContent(t) { this.childNodes = [new Node('#text', t)]; }
    get classList() { return { add: () => {} }; }
  }
  return {
    createTextNode: (t) => new Node('#text', t),
    createElement: (tag) => new Node(tag),
  };
};

const withFakeDom = (fn) => {
  const saved = globalThis.document;
  globalThis.document = makeFakeDom();
  try {
    const display = Object.create(SolverStateDisplay.prototype);
    display._TEMPLATE_GAP_SPAN = document.createElement('span');
    return fn(display, document.createElement('span'));
  } finally {
    globalThis.document = saved;
  }
};

await runTest('estimate renders with ~ and scientific notation when sampled', () => {
  withFakeDom((display, container) => {
    display._renderSolutionEstimate(container, { solutions: 3.2e9, exact: false });
    assert.equal(container.textContent, '~3.200×109');
    assert.equal(container.childNodes.at(-1).tag, 'sup');
  });
});

await runTest('estimate renders as a plain count when exact', () => {
  withFakeDom((display, container) => {
    display._renderSolutionEstimate(container, { solutions: 28200, exact: true });
    assert.equal(container.textContent, '28200');
  });
});

await runTestCases('estimate display respects known solutions', [
  ['no solution discovered', 0, false, 0, '~0'],
  ['solution in an unfinished tail', 0, false, 1, '~1'],
  ['repeated discoveries are not distinct solutions', 0, false, 100, '~1'],
  ['positive estimate rounds up to one', 0.1, false, 0, '~1'],
  ['larger estimate is preserved', 3.2, false, 100, '~3'],
  ['exact zero stays exact', 0, true, 0, '0'],
  ['exact one stays exact', 1, true, 100, '1'],
], (solutions, exact, discoveries, expected) => {
  withFakeDom((display, container) => {
    const estimate = { solutions, exact };
    display._stateVars = { estimatedSolutions: container };
    display._displayStateVariables({
      counters: { solutions: discoveries },
      estimate,
    });
    assert.equal(container.textContent, expected);
    assert.equal(estimate.solutions, solutions, 'rendering must not change the raw estimate');
  });
});

await runTest('batched state snapshots render the final exact estimate', () => {
  withFakeDom((display, container) => {
    const savedRequestAnimationFrame = window.requestAnimationFrame;
    const frames = [];
    window.requestAnimationFrame = callback => frames.push(callback);
    try {
      display._stateVars = { estimatedSolutions: container };
      display._stateHistory = { add() {}, clear() {} };
      display._updateProgressBar = () => {};
      display.setSolveStatus = () => {};
      display._elements = {
        progressBar: { setAttribute() {} },
        progressPercentage: {},
        solveStatus: {},
      };
      display._lazyUpdateState = deferUntilAnimationFrame(
        SolverStateDisplay.prototype._lazyUpdateState.bind(display));

      display.setState({ counters: {},
        estimate: { solutions: 0, samples: 1, exact: false },
      });
      frames.shift()();
      assert.equal(container.textContent, '~0');

      const finalStatus = { counters: {}, done: true,
        estimate: { solutions: 1, samples: 258, exact: true },
      };
      display.setState({ ...finalStatus, extra: { solutions: [[1]] } });
      display.setState(finalStatus);
      assert.equal(frames.length, 1, 'final updates share one animation frame');
      frames.shift()();
      assert.equal(container.textContent, '1');
      assert.equal(finalStatus.extra, undefined, 'incoming state is not mutated');

      display.clear();
      display.setState({ counters: {} });
      frames.shift()();
      assert.equal(container.textContent, '', 'the next run must not reuse the estimate');
    } finally {
      window.requestAnimationFrame = savedRequestAnimationFrame;
    }
  });
});

logSuiteComplete('SolverStateDisplay');
