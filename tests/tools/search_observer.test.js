import assert from 'node:assert/strict';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { runSolve } from '../../tools/lib/solver_analysis.js';
import { observeSolver } from '../../tools/lib/search_observer.js';

const puzzle = { name: '4x4', input: '.Shape~4x4' };
// Chaos Construction adds region cells, searched by placement.
const chaosPuzzle = { name: 'chaos 4x4', input: '.Shape~4x4.ChaosConstruction' };
const budgets = { maxBacktracks: 100, maxSolutions: 2, collectSolutions: true };

await runTest('Observation preserves plain and placement searches, with copied explanations', () => {
  for (const p of [puzzle, chaosPuzzle]) {
    const baseline = runSolve(p, budgets);
    let selections = 0, solutions = 0, restored;
    const result = runSolve(p, budgets, solver => {
      const internal = solver._internalSolver;
      const select = internal._candidateSelector.selectNextCandidate;
      restored = () => assert.equal(internal._candidateSelector.selectNextCandidate, select);
      return observeSolver(solver, context => ({
        beforeSelection: () => ({ explain: true }),
        afterSelection(selection, explanation) {
          selections++;
          assert.deepEqual(selection.cells, context.snapshot().cellOrder.slice(selection.depth, selection.nextDepth));
          assert.deepEqual(explanation.selected.cells, selection.cells);
        },
        solution: () => solutions++,
      }));
    });
    restored();
    assert(selections > 0);
    assert.equal(solutions, baseline.counters.solutions);
    assert.deepEqual(result.counters, baseline.counters);
    assert.deepEqual(result.solutionSet, baseline.solutionSet);
  }
});

await runTest('Propagation measurements are optional and exclude the assignment itself', () => {
  let pending = false, measured = false;
  runSolve(puzzle, budgets, solver => observeSolver(solver, () => ({
    branch() { pending = true; },
    beforePropagation: () => pending ? { eliminated: true, reductions: true, refuter: true } : null,
    afterPropagation(event) {
      if (pending) {
        measured = true;
        assert(event.eliminated > 0);
        assert(event.reductions.length > 0);
        assert.equal(event.refuter, null);
      } else assert.equal(event.eliminated, undefined);
      pending = false;
    },
  })));
  assert(measured);
});

await runTest('Score intervention preserves nested decay order and restores wrappers on failure', () => {
  const stop = new Error('stop');
  const events = [];
  let restored;
  assert.throws(() => runSolve(puzzle, budgets, solver => {
    const internal = solver._internalSolver, selector = internal._candidateSelector, scores = internal._conflictScores;
    const select = selector.selectNextCandidate, increment = scores.increment, decay = scores.decay;
    restored = () => {
      assert.equal(selector.selectNextCandidate, select);
      assert.equal(scores.increment, increment);
      assert.equal(scores.decay, decay);
      assert.equal(selector._decisionHook, null);
    };
    return observeSolver(solver, context => ({
      branch() {},
      beforeIncrement() { events.push('before'); },
      scoreChange(e) { assert.equal(e.type, 'decay'); events.push('decay'); },
      afterIncrement(e) { assert.equal(e.creditedCell, 1); events.push('after'); },
      afterSelection() {
        const before = context.scoreState();
        scores._decayCountdown = 1;
        scores.increment(0, 1);
        assert.equal(scores.scores[0], before.cellScores[0] >> 1);
        assert.equal(scores.scores[1], (before.cellScores[1] + 1) >> 1);
        throw stop;
      },
    }), { increment: e => ({ cell: 1, value: e.value }) });
  }), e => e === stop);
  restored();
  assert.deepEqual(events, ['before', 'decay', 'after']);
});

await runTest('Branch interventions use the selector validation and are cleaned up on rejection', () => {
  let selector;
  assert.throws(() => runSolve(puzzle, budgets, solver => {
    selector = solver._internalSolver._candidateSelector;
    return observeSolver(solver, () => ({}), { branch: () => ({ cell: 999, value: 1 }) });
  }), /Decision override/);
  assert.equal(selector._decisionHook, null);
});

logSuiteComplete('Search observation');
