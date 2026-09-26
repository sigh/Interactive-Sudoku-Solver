import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';
import { makeFakeDocument } from '../helpers/mock_dom.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

const frames = [];
window.requestAnimationFrame = (cb) => frames.push(cb);
const runFrames = () => { for (const cb of frames.splice(0)) cb(); };

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
};

const { SolverStateDisplay } = await import('../../js/ui/solver_state_display.js');

// A display with the stats charts closed, so no chart library loads.
const makeDisplay = () => new SolverStateDisplay(null, {
  openTab() { }, closeTab() { }, onTabClose() { },
});

// A solver state, as the worker sends it.
const makeState = ({ counters = {}, ...rest } = {}) => ({
  counters: {
    solutions: 0, guesses: 0, valuesTried: 0, constraintsProcessed: 0,
    progressRatio: 0, branchesIgnored: 0, ...counters,
  },
  timeMs: 0,
  ...rest,
});

const show = (display, state) => {
  display.setState(state);
  runFrames();
};

// The row of the state output with this label, and the value it shows.
const row = (display, label) => display._elements.stateOutput.children
  .find(r => r.children[1].textContent === label);
const value = (display, label) => row(display, label).children[0].textContent;

// ============================================================================
// Solve status
// ============================================================================

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

// ============================================================================
// State output
// ============================================================================

await runTest('counters are shown in groups of three digits', () => {
  const display = makeDisplay();
  show(display, makeState({ counters: { guesses: 1234567, valuesTried: 12 } }));

  assert.equal(value(display, 'Guesses'), '1234567');
  const gaps = row(display, 'Guesses').children[0].children
    .filter(n => n.classList?.contains('number-gap'));
  assert.equal(gaps.length, 2);
  assert.equal(value(display, 'Values tried'), '12');
});

await runTest('the solution count has + until the search is complete', () => {
  const display = makeDisplay();
  show(display, makeState({ counters: { solutions: 3 } }));
  assert.equal(value(display, 'Solutions'), '3+');

  show(display, makeState({ counters: { solutions: 3, branchesIgnored: 0.5 }, done: true }));
  assert.equal(value(display, 'Solutions'), '3+', 'parts of the search were skipped');

  show(display, makeState({ counters: { solutions: 3 }, done: true }));
  assert.equal(value(display, 'Solutions'), '3');
});

await runTest('the search explored is a percentage, 100% once complete', () => {
  const display = makeDisplay();
  show(display, makeState({ counters: { progressRatio: 0.123456 } }));
  assert.equal(value(display, 'Search space explored'), '12.3%');

  show(display, makeState({ counters: { progressRatio: 0.99 }, done: true }));
  assert.equal(value(display, 'Search space explored'), '100%');
});

await runTest('setup time and runtime are formatted', () => {
  const display = makeDisplay();
  show(display, makeState({ timeMs: 1500 }));
  assert.equal(value(display, 'Puzzle setup time'), '?');
  assert.equal(value(display, 'Runtime'), '1.50 s');

  show(display, makeState({ puzzleSetupTime: 12 }));
  assert.equal(value(display, 'Puzzle setup time'), '12.0 ms');
});

await runTest('the progress bar counts skipped branches, and is full when done', () => {
  const display = makeDisplay();
  const { progressBar, progressPercentage } = display._elements;

  show(display, makeState({ counters: { progressRatio: 0.2, branchesIgnored: 0.1 } }));
  assert.equal(progressBar.getAttribute('value'), 0.2 + 0.1);
  assert.equal(progressPercentage.textContent, '30%');

  show(display, makeState({ counters: { progressRatio: 0.2 }, done: true }));
  assert.equal(progressBar.getAttribute('value'), 1);
  assert.equal(progressPercentage.textContent, '100%');
});

await runTest('estimate mode shows the estimate rows instead of the search rows', () => {
  const display = makeDisplay();
  const shown = (label) => row(display, label).style.display;

  display.setEstimateMode(true);
  assert.deepEqual(
    ['Estimated solutions', 'Estimate samples', 'Solutions', 'Search space explored'].map(shown),
    ['block', 'block', 'none', 'none']);
  assert.equal(display._elements.progressPercentage.style.display, 'none');

  // The progress bar is left alone while estimating.
  show(display, makeState({ counters: { progressRatio: 0.5 } }));
  assert.equal(display._elements.progressPercentage.textContent, '');

  display.setEstimateMode(false);
  assert.deepEqual(
    ['Estimated solutions', 'Estimate samples', 'Solutions', 'Search space explored'].map(shown),
    ['none', 'none', 'block', 'block']);
});

await runTest('clear empties the output and the progress', () => {
  const display = makeDisplay();
  show(display, makeState({ counters: { guesses: 5, progressRatio: 0.5 } }));
  display.setSolveStatus(true, 'countSolutions');

  display.clear();
  assert.equal(value(display, 'Guesses'), '');
  assert.equal(display._elements.progressBar.getAttribute('value'), 0);
  assert.equal(display._elements.progressPercentage.textContent, '');
  assert.equal(display._elements.solveStatus.textContent, '');
});

// ============================================================================
// Estimates
// ============================================================================

await runTest('estimate renders with ~ and scientific notation when sampled', () => {
  const display = makeDisplay();
  const container = document.createElement('span');
  display._renderSolutionEstimate(container, { solutions: 3.2e9, exact: false });
  assert.equal(container.textContent, '~3.200×109');
  assert.equal(container.children.at(-1).tagName, 'SUP');
});

await runTest('estimate renders as a plain count when exact', () => {
  const display = makeDisplay();
  const container = document.createElement('span');
  display._renderSolutionEstimate(container, { solutions: 28200, exact: true });
  assert.equal(container.textContent, '28200');
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
  const display = makeDisplay();
  const estimate = { solutions, exact, samples: 1 };
  show(display, makeState({ counters: { solutions: discoveries }, estimate }));
  assert.equal(value(display, 'Estimated solutions'), expected);
  assert.equal(estimate.solutions, solutions, 'rendering must not change the raw estimate');
});

await runTest('batched state snapshots render the final exact estimate', () => {
  const display = makeDisplay();
  const estimated = () => value(display, 'Estimated solutions');

  show(display, makeState({ estimate: { solutions: 0, samples: 1, exact: false } }));
  assert.equal(estimated(), '~0');

  const finalStatus = makeState({
    done: true, estimate: { solutions: 1, samples: 258, exact: true },
  });
  display.setState({ ...finalStatus, extra: { solutions: [[1]] } });
  const queued = frames.length;
  display.setState(finalStatus);
  assert.equal(frames.length, queued, 'final updates share one animation frame');
  assert.equal(estimated(), '~0', 'nothing renders until the frame');
  runFrames();
  assert.equal(estimated(), '1');
  assert.equal(finalStatus.extra, undefined, 'incoming state is not mutated');

  display.clear();
  show(display, makeState());
  assert.equal(estimated(), '', 'the next run must not reuse the estimate');
});

logSuiteComplete('SolverStateDisplay');
