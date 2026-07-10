import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: undefined });

const { SolverStateDisplay } = await import('../../js/solver_state_display.js');

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

logSuiteComplete('SolverStateDisplay');
