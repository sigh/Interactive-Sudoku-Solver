import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

const makeEasyClassicConstraint = () => {
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

await runTest('debugState should be null when debugging disabled', () => {
  const constraint = makeEasyClassicConstraint();
  const solver = SudokuBuilder.build(constraint, {
    logLevel: 0,
    enableStepLogs: false,
    exportConflictHeatmap: false,
    exportStackTrace: false,
  });

  assert.equal(solver.debugState(), null);
});

await runTest('debugState should include stackTrace when enabled', () => {
  const constraint = makeEasyClassicConstraint();
  const solver = SudokuBuilder.build(constraint, {
    exportStackTrace: true,
  });

  let maxStackDepth = 0;
  solver.setProgressCallback(() => {
    const dbg = solver.debugState();
    const st = dbg?.stackTrace;
    if (!st?.cells?.length) return;
    maxStackDepth = Math.max(maxStackDepth, st.cells.length);
    assert.ok(st.values, 'expected stackTrace.values');
    assert.equal(st.values.length, st.cells.length);

    // For classic Sudoku, values should be in [1, 9].
    // (If a non-singleton ever appears, toValue() would typically return 0.)
    for (let i = 0; i < st.values.length; i++) {
      assert.ok(st.values[i] >= 0 && st.values[i] <= 9);
    }
  }, 1);

  const solution = solver.nthSolution(0);
  assert.ok(solution, 'expected a solution');
  assert.ok(maxStackDepth > 0, `expected stackTrace depth > 0, got ${maxStackDepth}`);
});

logSuiteComplete('engine_debug_state');
