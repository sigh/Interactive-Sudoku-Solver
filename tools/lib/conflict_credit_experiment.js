import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { observeSearch, rankCells } from './search_experiment.js';

// Replace exactly one cell/value credit. All continuations are natural runs;
// only increment's arguments change, preserving decay and propagation scheduling.
export const runCreditExperiment = (puzzle, budgets, {
  at, failure, recipient, referenceMode = 'original', modes = ['cell', 'value', 'both'],
}) => {
  if (!Number.isInteger(failure) || failure < 1) throw new Error('Invalid failure index');
  const validModes = ['original', 'cell', 'value', 'both'];
  for (const mode of [referenceMode, ...modes]) {
    if (!validModes.includes(mode)) throw new Error(`Invalid credit mode: ${mode}`);
  }
  const run = (mode, reference = null, capture = -1, stopAtCapture = false) => {
    const prefix = createHash('sha256');
    const trace = [];
    let target = null, update = null, snapshot = null, divergence = null, boostDifference = null;
    let selection = 0, failures = 0, failedGrid = null;
    const stopped = {};
    let result = null;
    const configure = solver => {
      const internal = solver._internalSolver;
      const selector = internal._candidateSelector;
      const scores = internal._conflictScores;
      const select = selector.selectNextCandidate;
      const enforce = internal._enforceConstraints;
      const increment = scores.increment;
      assert.ok(Number.isInteger(recipient.cell) && recipient.cell >= 0 &&
        recipient.cell < internal._numSearchCells, 'Invalid credit cell');
      assert.ok(Number.isInteger(recipient.value) && recipient.value > 0 &&
        !(recipient.value & (recipient.value - 1)) &&
        recipient.value < (1 << solver._geometry.numValues), 'Invalid credit value');

      internal._enforceConstraints = function (grid, queue) {
        const ok = enforce.call(this, grid, queue);
        if (!ok && failures + 1 === failure) failedGrid = [...grid];
        return ok;
      };
      scores.increment = function (cell, value) {
        if (++failures !== failure) return increment.call(this, cell, value);
        target = { cell, value, grid: failedGrid, cellOrder: [...selector.getCellOrder()],
          cellScores: [...this.scores], valueScores: [...this._valueScores],
          decayCountdown: this._decayCountdown, counters: { ...internal.counters },
          prefix: prefix.copy().digest('hex') };
        if (reference) assert.deepEqual(target, reference.target, 'Conflict state/history differs');
        const creditedCell = mode === 'cell' || mode === 'both' ? recipient.cell : cell;
        const creditedValue = mode === 'value' || mode === 'both' ? recipient.value : value;
        increment.call(this, creditedCell, creditedValue);
        update = { cell: creditedCell, value: creditedValue, cellScores: [...this.scores],
          valueScores: [...this._valueScores], decayCountdown: this._decayCountdown };
      };
      selector.selectNextCandidate = function (depth, grid, step, fresh) {
        if (!target) prefix.update(JSON.stringify([depth, fresh, [...grid],
          [...this.getCellOrder()], [...scores.scores], [...scores._valueScores]]));
        const tracking = target !== null;
        const index = selection;
        const boost = tracking ? { ...scores.getMaxValueScore() } : null;
        if (tracking && index === capture) {
          snapshot = { depth, fresh, grid: [...grid], cellOrder: [...this.getCellOrder()],
            cellScores: [...scores.scores], valueScores: [...scores._valueScores],
            boost, ranking: rankCells(this, grid, depth, solver._geometry) };
        }
        const next = select.call(this, depth, grid, step, fresh);
        const custom = this._candidateSelectionFlags[depth];
        const choice = [depth, fresh, next.nextDepth, this.getCellAtDepth(depth),
          next.value, next.count, custom,
          ...(custom ? this._candidateSelectionStates[depth].cells : [])];
        if (!target) prefix.update(JSON.stringify(choice));
        if (tracking) {
          const row = { choice, boost };
          if (!reference) trace.push(row);
          else {
            const other = reference.trace[index];
            if (divergence === null && JSON.stringify(choice) !== JSON.stringify(other?.choice)) {
              divergence = index;
            }
            if (boostDifference === null && (divergence === null || divergence === index) &&
              JSON.stringify(boost) !== JSON.stringify(other?.boost)) {
              boostDifference = index;
            }
          }
          selection++;
          if (snapshot && index === capture) {
            snapshot.choice = choice;
            if (stopAtCapture) throw stopped;
          }
        }
        return next;
      };
    };
    try {
      result = observeSearch(puzzle, budgets, { at, configure,
        expected: reference?.result.decision });
    } catch (e) {
      if (e !== stopped) throw e;
    }
    if (!target) throw new Error(`Failure ${failure} not reached`);
    if (reference && divergence === null && selection !== reference.trace.length && !stopAtCapture) {
      divergence = selection;
    }
    return { mode, result, target, update, trace, snapshot, divergence, boostDifference };
  };

  const baseline = run(referenceMode);
  const control = run(referenceMode, baseline);
  assert.deepEqual(control.result, baseline.result, 'Unchanged continuation differs');
  assert.equal(control.divergence, null, 'Unchanged selection trace differs');
  const variants = [];
  for (const mode of modes) {
    const trial = run(mode, baseline);
    if (trial.result.exhausted && baseline.result.exhausted) {
      assert.deepEqual(trial.result.solutionSet, baseline.result.solutionSet, 'Solution contents differ');
    }
    let firstSelection = null;
    if (trial.divergence !== null && trial.divergence < baseline.trace.length) {
      const original = run(referenceMode, baseline, trial.divergence, true).snapshot;
      const modified = run(mode, baseline, trial.divergence, true).snapshot;
      firstSelection = { index: trial.divergence, original, modified,
        sameDomains: original && modified && JSON.stringify(original.grid) === JSON.stringify(modified.grid),
        sameCellOrder: original && modified && JSON.stringify(original.cellOrder) === JSON.stringify(modified.cellOrder) };
    }
    variants.push({ mode, result: trial.result, update: trial.update, divergence: trial.divergence,
      boostDifference: trial.boostDifference, firstSelection });
  }
  return { at, failure, recipient, referenceMode, controlMatched: true, target: baseline.target,
    baseline: baseline.result, baselineUpdate: baseline.update, variants };
};
