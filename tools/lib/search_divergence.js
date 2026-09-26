import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { runSolve } from './solver_analysis.js';
import { observeSolver } from './search_observer.js';

export const counterDifference = (end, start) => Object.fromEntries(
  Object.keys(start).map(key => [key, end[key] - start[key]]));

export const assertSameSolutions = (baseline, variant) => {
  if (baseline.exhausted && variant.exhausted) {
    assert.deepEqual(variant.solutionSet, baseline.solutionSet, 'Completed solution sets differ');
  }
};

// Compare chronological events only until the first difference. An observation
// limit bounds retained events independently of the solve's backtrack budget.
export const compareSearches = (puzzle, budgets, apply, { maxEvents = 100000 } = {}) => {
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('maxEvents must be a positive integer');
  const events = [];
  const observe = emit => solver => {
    let branch = 0;
    const record = event => emit({ branch, ...event });
    return observeSolver(solver, () => ({
      branch: () => branch++,
      afterSelection: selection => record({ type: 'selection', ...selection }),
      afterPropagation: event => record({ type: 'propagation', ...event }),
      beforeIncrement: event => record({ type: 'conflict', ...event }),
      solution: () => record({ type: 'solution' }),
    }));
  };
  let baselineEvents = 0;
  const baseline = runSolve(puzzle, { ...budgets, collectSolutions: true }, observe(event => {
    if (baselineEvents++ < maxEvents) events.push(event);
  }));
  let variantEvents = 0, divergence = null;
  const restore = apply();
  if (typeof restore !== 'function') throw new Error('Variant apply() must return a restore function');
  let variant;
  try {
    variant = runSolve(puzzle, { ...budgets, collectSolutions: true }, observe(event => {
      const index = variantEvents++;
      if (index >= maxEvents || divergence) return;
      if (!isDeepStrictEqual(events[index], event)) {
        divergence = { event: index + 1, baseline: events[index] ?? null, variant: event };
      }
    }));
  } finally { restore(); }
  if (!divergence && variantEvents < events.length) {
    divergence = { event: variantEvents + 1, baseline: events[variantEvents], variant: null };
  }
  assertSameSolutions(baseline, variant);
  // Instrumented runtime is not a benchmark.
  const report = ({ elapsedMs, geometry, ...result }) => result;
  return { baseline: report(baseline), variant: report(variant), divergence,
    counterDifference: counterDifference(variant.counters, baseline.counters),
    observation: { maxEvents, baselineEvents, variantEvents,
      status: divergence ? 'diverged'
        : Math.max(baselineEvents, variantEvents) > maxEvents ? 'observation-limit'
          : baseline.exhausted && variant.exhausted ? 'matched' : 'matching-prefix' } };
};
