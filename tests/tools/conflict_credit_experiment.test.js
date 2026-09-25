import assert from 'node:assert/strict';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { resolvePuzzles, runSolve } from '../../tools/lib/solver_analysis.js';
import { runCreditExperiment } from '../../tools/lib/conflict_credit_experiment.js';

const puzzle = resolvePuzzles(['TAREK_ALL'])[1];
const budget = { maxBacktracks: 10000, maxSolutions: 2 };

await runTest('Split credit reproduces controls and preserves complete answers', () => {
  const result = runCreditExperiment(puzzle, budget, {
    at: 6, failure: 3, recipient: { cell: 15, value: 1 },
  });
  assert.equal(result.controlMatched, true);
  assert.deepEqual(result.baseline.counters, runSolve(puzzle, budget).counters);
  assert.equal(result.target.cell, 24);
  assert.equal(result.target.value, 2);
  const [cell, value, both] = result.variants;
  assert.deepEqual(cell.update.valueScores, result.baselineUpdate.valueScores);
  assert.deepEqual(value.update.cellScores, result.baselineUpdate.cellScores);
  assert.deepEqual(both.update.cellScores, cell.update.cellScores);
  assert.deepEqual(both.update.valueScores, value.update.valueScores);
  assert.notDeepEqual(cell.update.cellScores, result.baselineUpdate.cellScores);
  assert.notDeepEqual(value.update.valueScores, result.baselineUpdate.valueScores);
  for (const variant of result.variants) {
    assert.equal(variant.update.decayCountdown, result.baselineUpdate.decayCountdown);
    assert.equal(variant.result.exhausted, true);
    assert.deepEqual(variant.result.solutionSet, result.baseline.solutionSet);
    if (variant.firstSelection) {
      assert.equal(variant.firstSelection.sameDomains, true);
      assert.equal(variant.firstSelection.sameCellOrder, true);
    }
  }
});

await runTest('Conditional comparisons can isolate value credit after a cell intervention', () => {
  const result = runCreditExperiment(puzzle, budget, {
    at: 6, failure: 3, recipient: { cell: 15, value: 1 }, referenceMode: 'cell', modes: ['both'],
  });
  assert.equal(result.referenceMode, 'cell');
  assert.deepEqual(result.variants[0].update.cellScores, result.baselineUpdate.cellScores);
  assert.notDeepEqual(result.variants[0].update.valueScores, result.baselineUpdate.valueScores);
});

await runTest('Unchanged credit produces identical selection sequences for every mode', () => {
  const result = runCreditExperiment(puzzle, budget, {
    at: 6, failure: 3, recipient: { cell: 24, value: 2 },
  });
  for (const variant of result.variants) {
    assert.equal(variant.divergence, null);
    assert.deepEqual(variant.result, result.baseline);
  }
});

await runTest('Credit experiments reject missing targets and invalid recipients', () => {
  assert.throws(() => runCreditExperiment(puzzle, budget, {
    at: 1, failure: 10000, recipient: { cell: 1, value: 1 },
  }), /not reached/);
  assert.throws(() => runCreditExperiment(puzzle, budget, {
    at: 1, failure: 1, recipient: { cell: 1, value: 3 },
  }), /Invalid credit value/);
});

await runTest('A cap immediately after the update remains an incomplete comparison', () => {
  const result = runCreditExperiment(puzzle, { ...budget, maxBacktracks: 3 }, {
    at: 6, failure: 3, recipient: { cell: 15, value: 1 },
  });
  assert.equal(result.baseline.status, 'capped');
  for (const variant of result.variants) {
    assert.equal(variant.result.exhausted, false);
    assert.equal(variant.result.status, 'capped');
    assert.equal(variant.firstSelection, null);
  }
});

logSuiteComplete('Conflict credit experiments');
