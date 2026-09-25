import assert from 'node:assert/strict';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { resolvePuzzles, runSolve } from '../../tools/lib/solver_analysis.js';
import { observeSearch, runDecisionExperiment, compareSearches } from '../../tools/lib/search_experiment.js';

const puzzle = { name: '4x4', input: '.Shape~4x4' };
const budgets = { maxBacktracks: 0, maxSolutions: 0, collectSolutions: true };

await runTest('Search experiments preserve all solutions under cell and value interventions', () => {
  const report = runDecisionExperiment(puzzle, budgets, { at: 3 });
  assert.equal(report.controlMatched, true);
  assert.equal(report.baseline.solutionSet.length, 288);
  for (const alternative of report.alternatives) {
    assert.equal(alternative.exhausted, true);
    assert.deepEqual(alternative.solutionSet, report.baseline.solutionSet);
    assert.equal(alternative.subtree.exhausted, true);
    assert.ok(alternative.subtree.counters.guesses < alternative.continuation.guesses);
    assert.ok(alternative.firstArm.counters.guesses <= alternative.subtree.counters.guesses);
  }
  const same = report.alternatives[0];
  assert.deepEqual(same.counters, report.baseline.counters);
  assert.deepEqual(same.subtree, report.baseline.subtree);
});

await runTest('Observing search preserves uninstrumented counters including chaos custom branches', () => {
  for (const p of [puzzle, ...resolvePuzzles(['Chaos Construction: 6x6'])]) {
    const options = { ...budgets, maxSolutions: 2 };
    const baseline = runSolve(p, options);
    const observed = observeSearch(p, options);
    assert.deepEqual(observed.counters, baseline.counters);
    assert.deepEqual(observed.solutionSet, baseline.solutionSet);
  }
});

await runTest('Frozen and last-guess learning preserve exhaustive answers', () => {
  for (const learning of ['frozen', 'last-guess']) {
    const report = runDecisionExperiment(puzzle, budgets, { at: 2, choices: ['same'], learning });
    assert.deepEqual(report.alternatives[0].solutionSet, report.baseline.solutionSet);
  }
});

await runTest('Experiments reject different execution prefixes and missing targets', () => {
  const observed = observeSearch(puzzle, budgets, { at: 3 });
  assert.throws(() => observeSearch(puzzle, budgets, {
    at: 2, expected: observed.decision,
  }), /Execution prefix differs/);
  assert.throws(() => runDecisionExperiment(puzzle, { ...budgets, maxSolutions: 1 }, {
    at: 1000, choices: [],
  }), /not reached/);
});

await runTest('Capped and solution-limited continuations are not called exhausted', () => {
  const result = observeSearch(puzzle, { maxBacktracks: 1, maxSolutions: 0 });
  assert.equal(result.status, 'capped');
  assert.equal(result.subtree.exhausted, false);
  const first = observeSearch(puzzle, { maxBacktracks: 0, maxSolutions: 1 });
  assert.equal(first.subtree.exhausted, false);
});

await runTest('Search comparison checks event prefixes and restores the variant', () => {
  let restored = false;
  const result = compareSearches(puzzle, budgets, () => () => { restored = true; });
  assert.equal(result.divergence, null);
  assert.equal(restored, true);
});

await runTest('Root subtree and first-arm accounting include the expected solution partitions', () => {
  const observed = observeSearch(puzzle, budgets);
  assert.equal(observed.subtree.counters.solutions, 288);
  assert.equal(observed.firstArm.counters.solutions, 72);
  assert.deepEqual(observed.subtree.counters, observed.continuation);
  assert.ok(observed.propagation.eliminated > 0);
  assert.equal(observed.propagation.conflict, false);
});

await runTest('Event stream includes retried guesses and every solution', () => {
  const events = [];
  const observed = observeSearch(puzzle, budgets, { onEvent: event => events.push(event) });
  assert.equal(events.filter(e => e.type === 'solution').length, 288);
  assert.equal(events.filter(e => e.type === 'branch' || e.type === 'retry').length,
    observed.counters.guesses);
});

logSuiteComplete('Search experiments');
