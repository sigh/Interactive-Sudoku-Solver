import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SimpleSolver } = await import('../../../js/sandbox/simple_solver.js');

const collectSolutions = input => Array.from(
  new SimpleSolver().solutions(input), solution => solution.toString()).sort();

const cases = [
  { name: 'repeated cells', cells: [0, 0, 1, 2], total: 11 },
  { name: 'weighted cells', cells: [0, 1, 2], coeffs: [2, 1, 1], total: 11 },
  { name: 'negative coefficients', cells: [0, 1, 2], coeffs: [1, 1, -1], total: 0 },
  {
    name: 'cancellation to unit coefficients',
    cells: [0, 1, 2, 0], coeffs: [2, 1, 1, -1], total: 6,
  },
  { name: 'one weighted cell after normalization', cells: [0, 0], total: 6 },
  { name: 'two weighted cells after normalization', cells: [0, 0, 1], total: 7 },
  { name: 'cancelled equality', cells: [0, 0], coeffs: [1, -1], total: 0 },
  { name: 'contradictory cancelled equality', cells: [0, 0], coeffs: [1, -1], total: 1 },
];

for (const offset of [0, -1]) {
  const shape = offset ? '.Shape~4x4~0-3' : '.Shape~4x4';
  const classicSolutions = collectSolutions(shape);
  assert.equal(classicSolutions.length, 288);

  // Cover the other three rows so that treating a weighted first-row sum as
  // unweighted would also produce an incorrect whole-grid gap deduction.
  const rowSums = [2, 3, 4].map(r =>
    `.Sum~${10 + 4 * offset}~R${r}C1~R${r}C2~R${r}C3~R${r}C4`).join('');

  for (const test of cases) {
    await runTest(`sum optimization preserves ${test.name} (offset ${offset})`, () => {
      const coeffs = test.coeffs ?? test.cells.map(() => 1);
      const total = test.total + offset * coeffs.reduce((a, b) => a + b, 0);
      const sumArg = test.coeffs ? `${total}_=_${coeffs.join('_')}` : `${total}`;
      const cellsArg = test.cells.map(c => `R1C${c + 1}`).join('~');
      const input = shape + rowSums + `.Sum~${sumArg}~${cellsArg}`;

      // Evaluate the original expression, including repeated cell occurrences,
      // independently of Sum's normalization and the optimizer's deductions.
      const expected = classicSolutions.filter(solution =>
        test.cells.reduce((sum, cell, i) =>
          sum + coeffs[i] * Number(solution[cell]), 0) === total);
      if (test.name !== 'contradictory cancelled equality') {
        assert.ok(expected.length > 0);
      } else {
        assert.equal(expected.length, 0);
      }
      assert.deepEqual(collectSolutions(input), expected);
    });
  }
}

logSuiteComplete('sum optimizer coefficients');
