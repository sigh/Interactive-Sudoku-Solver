import assert from 'node:assert/strict';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { runSolve } from '../../tools/lib/solver_analysis.js';
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

await runTest('Completed comparisons require solution contents, including empty sets', () => {
  assert.throws(() => assertSameSolutions({ exhausted: true }, { exhausted: true }), /collected solution sets/);
  assert.throws(() => assertSameSolutions({ exhausted: true, solutionSet: [] }, { exhausted: true }), /collected solution sets/);
  assert.doesNotThrow(() => assertSameSolutions({ exhausted: true, solutionSet: [] }, { exhausted: true, solutionSet: [] }));
});

await runTest('Optional state comparison detects changed input before a changed selection', () => {
  const original = CandidateSelector.prototype._updateCellOrder;
  let changed = false;
  const report = compareSearches(puzzle, budgets, () => {
    CandidateSelector.prototype._updateCellOrder = function (depth, offset, count, grid) {
      const next = original.call(this, depth, offset, count, grid);
      if (!changed && count > 1) {
        const cell = [...this.getCellOrder().slice(next)].find(c => grid[c] & (grid[c] - 1));
        assert.notEqual(cell, undefined);
        grid[cell] &= grid[cell] - 1;
        changed = true;
      }
      return next;
    };
    return () => { CandidateSelector.prototype._updateCellOrder = original; };
  }, { compareState: true });
  assert(changed);
  assert.equal(report.divergence.baseline.type, 'propagation-input');
  assert.equal(report.divergence.stateDifference.differences.length, 1);
  assert.equal(CandidateSelector.prototype._updateCellOrder, original);
  const control = compareSearches(puzzle, budgets, () => () => {}, { compareState: true });
  assert.equal(control.divergence, null);
  assert.equal(control.observation.status, 'matching-prefix');
});

await runTest('State comparison observes successful propagation output changes', () => {
  let proto;
  runSolve(puzzle, budgets, solver => { proto = Object.getPrototypeOf(solver._internalSolver); });
  const original = proto._enforceConstraints;
  let changed = false;
  const report = compareSearches(puzzle, budgets, () => {
    proto._enforceConstraints = function (grid, queue) {
      const ok = original.call(this, grid, queue);
      if (ok && !changed) {
        const cell = [...this._candidateSelector.getCellOrder()].find(c => grid[c] & (grid[c] - 1));
        if (cell !== undefined) { grid[cell] &= grid[cell] - 1; changed = true; }
      }
      return ok;
    };
    return () => { proto._enforceConstraints = original; };
  }, { compareState: true });
  assert(changed);
  assert.equal(report.divergence.baseline.type, 'propagation');
  assert.equal(report.divergence.baseline.conflict, false);
  assert.equal(report.divergence.variant.conflict, false);
  assert.equal(report.divergence.stateDifference.differences.length, 1);
  assert.equal(proto._enforceConstraints, original);
});

logSuiteComplete('Search divergence');
