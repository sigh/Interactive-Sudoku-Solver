import assert from 'node:assert/strict';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { compareSearches, assertSameSolutions } from '../../tools/lib/search_divergence.js';
const { CandidateSelector } = await import('../../js/solver/candidate_selector.js' + self.VERSION_PARAM);
const puzzle = { name: '4x4', input: '.Shape~4x4' };
const budgets = { maxBacktracks: 100, maxSolutions: 1 };

await runTest('Matching limited searches and observation limits remain inconclusive', () => {
  const report = compareSearches(puzzle, budgets, () => () => {});
  assert.equal(report.divergence, null);
  assert.equal(report.observation.status, 'matching-prefix');
  assert(Object.values(report.counterDifference).every(n => n === 0));
  assert.equal(compareSearches(puzzle, budgets, () => () => {}, { maxEvents: 1 }).observation.status, 'observation-limit');
  assert.throws(() => compareSearches(puzzle, budgets, () => assert.fail(), { maxEvents: 0 }), /maxEvents/);
});

await runTest('Divergence includes reordered forced cells and restores failed variants', () => {
  let changed = false;
  const original = CandidateSelector.prototype._updateCellOrder;
  const report = compareSearches(puzzle, budgets, () => {
    CandidateSelector.prototype._updateCellOrder = function (depth, offset, count, grid) {
      const next = original.call(this, depth, offset, count, grid);
      if (!changed && count === 1 && next - depth >= 3) {
        const order = this.getCellOrder();
        [order[depth + 1], order[depth + 2]] = [order[depth + 2], order[depth + 1]];
        changed = true;
      }
      return next;
    };
    return () => { CandidateSelector.prototype._updateCellOrder = original; };
  });
  assert(changed);
  assert.equal(report.divergence.baseline.type, 'selection');
  assert.equal(report.divergence.baseline.cell, report.divergence.variant.cell);
  assert.notDeepEqual(report.divergence.baseline.cells, report.divergence.variant.cells);
  assert.equal(CandidateSelector.prototype._updateCellOrder, original);
  assert.throws(() => compareSearches(puzzle, budgets, () => {
    CandidateSelector.prototype._updateCellOrder = () => { throw Error('variant failed'); };
    return () => { CandidateSelector.prototype._updateCellOrder = original; };
  }), /variant failed/);
  assert.equal(CandidateSelector.prototype._updateCellOrder, original);
});

await runTest('Solution equality is checked only for completed searches', () => {
  const baseline = { exhausted: true, solutionSet: ['a'] };
  assert.doesNotThrow(() => assertSameSolutions(baseline, { exhausted: false, solutionSet: ['b'] }));
  assert.throws(() => assertSameSolutions(baseline, { exhausted: true, solutionSet: ['b'] }), /Completed solution sets differ/);
});

logSuiteComplete('Search divergence');
