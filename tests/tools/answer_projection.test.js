import assert from 'node:assert/strict';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { runSolve } from '../../tools/lib/solver_analysis.js';

const budgets = { maxBacktracks: 100, maxSolutions: 0 };
const puzzle = (given = '') => ({
  name: 'existential witness',
  input: '.Shape~1x1~1-2~Raw.Var~A~Witness~1' + given,
});

await runTest('Answer projection deduplicates witnesses without changing default counts', () => {
  const p = puzzle('.~R1C1_1');
  const normal = runSolve(p, budgets);
  const projected = runSolve(p, { ...budgets, projectAnswer: true });
  assert.equal(normal.counters.solutions, 2);
  assert.equal(projected.counters.solutions, 1);
  assert.equal(projected.solutionAssignments, 2);
  assert.equal(projected.exhausted, true);
  assert.equal(projected.status, 'unique');
  assert.equal(projected.counters.backtracks, normal.counters.backtracks);
});

await runTest('Answer projection retains genuinely different board answers', () => {
  const result = runSolve(puzzle(), { ...budgets, projectAnswer: true });
  assert.equal(result.counters.solutions, 2);
  assert.equal(result.solutionAssignments, 4);
  assert.equal(result.status, 'multiple');
});

await runTest('Answer projection can target a named answer group', () => {
  const result = runSolve(puzzle('.~VA_1'), {
    ...budgets, projectAnswer: true, solutionGroup: ['VA'],
  });
  assert.equal(result.counters.solutions, 1);
  assert.equal(result.solutionAssignments, 2);
  assert.equal(result.groupSolution, '1');
});

await runTest('A capped projected search does not establish uniqueness', () => {
  const result = runSolve(puzzle(), {
    maxBacktracks: 1, maxSolutions: 0, projectAnswer: true,
  });
  assert.equal(result.capped, true);
  assert.equal(result.exhausted, false);
  assert.equal(result.status, 'capped');
});

await runTest('Projection refuses a solution-limited enumeration prefix', () => {
  assert.throws(() => runSolve(puzzle(), {
    ...budgets, maxSolutions: 2, projectAnswer: true,
  }), /all-solutions/);
});

logSuiteComplete('Answer projection');
