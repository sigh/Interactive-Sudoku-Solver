// Counterfactual continuations reached by deterministic re-execution. Never
// rebuild a checkpoint from givens: doing so loses handler and search history.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runSolve } from './solver_analysis.js';

const { countOnes16bit } = await import('../../js/util.js' + self.VERSION_PARAM);
const { NO_LINKED_CELL } = await import('../../js/solver/candidate_selector.js' + self.VERSION_PARAM);

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const counters = (internal) => ({ ...internal.counters });
const difference = (end, start) => Object.fromEntries(
  Object.keys(start).map(key => [key, end[key] - start[key]]));

export const rankCells = (selector, grid, depth, geometry) => {
  const scores = selector._conflictScores;
  const { value, score } = scores.getMaxValueScore();
  const ranked = [...selector.getCellOrder().subarray(depth)].flatMap((cell, order) => {
    const mask = grid[cell];
    const count = countOnes16bit(mask);
    if (count <= 1) return [];
    const link = selector._linkedCells?.[cell] ?? NO_LINKED_CELL;
    const linkedFixed = link !== NO_LINKED_CELL && countOnes16bit(grid[link]) === 1;
    const conflict = scores.scores[cell];
    const linkedScore = linkedFixed ? conflict << 2 : conflict;
    const valueBoost = mask & value ? score * 0.2 : 0;
    return [{ cell, cellId: geometry.makeCellIdFromIndex(cell), mask, count,
      order, conflict, linkedFixed, valueBoost, score: (linkedScore + valueBoost) / count }];
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  if (ranked.length && ranked[0].score === 0) {
    ranked.sort((a, b) => a.count - b.count || a.order - b.order);
  }
  return ranked;
};

export const chooseAlternative = (decision, choice) => {
  if (choice === 'same') return decision.isCustom ? null : { cell: decision.cell, value: decision.value };
  if (choice === 'plain') return { cell: decision.cell, value: decision.value };
  if (choice === 'max-value') {
    const mask = decision.grid[decision.cell];
    return { cell: decision.cell, value: 1 << (31 - Math.clz32(mask)) };
  }
  if (choice === 'mrv' || choice === 'runner-up') {
    const ranked = decision.ranking.slice();
    if (choice === 'mrv') ranked.sort((a, b) => a.count - b.count || a.order - b.order);
    const candidate = choice === 'runner-up'
      ? ranked.find(r => r.cell !== decision.cell) : ranked[0];
    if (!candidate) throw new Error('No alternative cell');
    return { cell: candidate.cell, value: candidate.mask & -candidate.mask };
  }
  if (typeof choice === 'object' && choice !== null) return choice;
  throw new Error(`Unknown choice: ${choice}`);
};

// onEvent receives chronological guess, contradiction and solution events. Comparing
// their common prefix is meaningful; matching later sequence numbers is not.
export const observeSearch = (puzzle, budgets, {
  at = 1, choice = null, learning = 'live', expected = null,
  onEvent = null, configure = null,
} = {}) => {
  if (!Number.isInteger(at) || at < 1) throw new Error('at must be a positive decision index');
  if (!['live', 'frozen', 'last-guess'].includes(learning)) throw new Error(`Unknown learning: ${learning}`);
  const prefix = createHash('sha256');
  let decision = null, selected = null, subtree = null, firstArm = null;
  let propagation = null, pendingPropagation = false;
  let ranking = null;
  let firstSolution = null, internal = null, branchIndex = 0, assignment = null;
  let failures = 0, reportedSolutions = 0;
  let lastGuess = null;
  const guessStack = [];
  const credit = { forced: 0, guessed: 0, reassigned: 0 };
  const feed = value => prefix.update(JSON.stringify(value));
  const reportSolutions = () => {
    while (reportedSolutions < internal.counters.solutions) {
      reportedSolutions++;
      onEvent?.({ type: 'solution', number: reportedSolutions });
    }
  };
  const result = runSolve(puzzle, { ...budgets, collectSolutions: true }, solver => {
    internal = solver._internalSolver;
    configure?.(solver);
    const selector = internal._candidateSelector;
    const scores = internal._conflictScores;
    const originalSelect = selector.selectNextCandidate;
    const originalEnforce = internal._enforceConstraints;
    const originalIncrement = scores.increment;
    const originalDecay = scores.decay;
    const originalDemote = scores.demote;
    const queue = internal._propagationQueue;
    const originalTakeNext = queue.takeNext;
    let lastHandler = null;
    queue.takeNext = function () {
      return lastHandler = originalTakeNext.call(this);
    };

    scores.increment = function (cell, value) {
      const forced = assignment?.count === 1;
      credit[forced ? 'forced' : 'guessed']++;
      failures++;
      onEvent?.({ type: 'conflict', failure: failures, cell, value, forced, branch: branchIndex });
      if (decision && learning === 'frozen') return;
      if (decision && learning === 'last-guess' && lastGuess) {
        if (cell !== lastGuess.cell || value !== lastGuess.value) credit.reassigned++;
        return originalIncrement.call(this, lastGuess.cell, lastGuess.value);
      }
      return originalIncrement.call(this, cell, value);
    };
    scores.decay = function () {
      if (!(decision && learning === 'frozen')) originalDecay.call(this);
    };
    scores.demote = function (cell) {
      if (!(decision && learning === 'frozen')) originalDemote.call(this, cell);
    };

    selector.selectNextCandidate = function (depth, grid, stepState, isNewNode) {
      reportSolutions();
      while (guessStack.length && guessStack.at(-1).depth >= depth) guessStack.pop();
      lastGuess = guessStack.at(-1) ?? null;
      if (decision && !firstArm && depth <= decision.depth) {
        firstArm = { counters: difference(counters(internal), decision.counters), exhausted: true };
      }
      if (decision && !subtree && depth < decision.depth) {
        subtree = { counters: difference(counters(internal), decision.counters), exhausted: true };
      }
      if (!firstSolution && internal.counters.solutions) firstSolution = counters(internal);
      if (!decision) {
        feed([depth, isNewNode, [...grid], [...this.getCellOrder()],
          [...scores.scores], [...scores._valueScores], scores._decayCountdown,
          this._prevCandidateCount, [...this._candidateSelectionFlags]]);
      }
      // Selection can subsequently demote the preceding guess's score.
      if (branchIndex + 1 === at) ranking = rankCells(this, grid, depth, solver._geometry);
      const next = originalSelect.call(this, depth, grid, stepState, isNewNode);
      assignment = { depth, cell: this.getCellAtDepth(depth), value: next.value, count: next.count };
      if (next.count > 1) {
        if (!isNewNode) onEvent?.({ type: 'retry', branch: branchIndex, ...assignment });
        guessStack.push(assignment);
        lastGuess = assignment;
      }
      if (!decision) feed(assignment);
      return next;
    };

    internal._enforceConstraints = function (grid, queue) {
      const watch = pendingPropagation;
      pendingPropagation = false;
      const before = watch ? grid.slice(0, internal._numSearchCells) : null;
      lastHandler = null;
      const ok = originalEnforce.call(this, grid, queue);
      if (watch) {
        const reductions = [];
        for (let cell = 0; cell < before.length; cell++) {
          if (before[cell] !== grid[cell]) reductions.push({ cell, before: before[cell], after: grid[cell] });
        }
        propagation = { conflict: !ok, reductions,
          eliminated: reductions.reduce((n, r) => n + countOnes16bit(r.before) - countOnes16bit(r.after), 0),
          refuter: !ok && lastHandler ? {
            type: lastHandler.constructor.name, cells: [...lastHandler.cells],
          } : null };
      }
      if (!decision) feed([ok, [...grid]]);
      return ok;
    };

    selector.setDecisionHook(d => {
      branchIndex++;
      const event = { type: 'branch', branch: branchIndex, depth: d.cellDepth,
        cell: d.cell, value: d.value, count: d.count,
        placementCells: d.placementCells, placementValue: d.placementValue };
      if (branchIndex !== at) {
        onEvent?.(event);
        return null;
      }
      const snapshot = d.snapshot();
      decision = { ...event, isCustom: d.isCustom, grid: [...snapshot.grid],
        gridState: [...d.gridState], cellOrder: [...snapshot.cellOrder],
        conflictScores: [...snapshot.conflictScores], valueScores: [...scores._valueScores],
        decayCountdown: scores._decayCountdown,
        selectionStates: selector._candidateSelectionStates.map((s, i) =>
          selector._candidateSelectionFlags[i] ? { ...s, cells: [...s.cells] } : null),
        ranking,
        counters: counters(internal), prefixHash: prefix.copy().digest('hex') };
      decision.stateHash = digest(decision);
      if (expected) {
        assert.equal(decision.prefixHash, expected.prefixHash, 'Execution prefix differs');
        assert.equal(decision.stateHash, expected.stateHash, 'Decision state differs');
      }
      pendingPropagation = true;
      selected = choice === null ? null : chooseAlternative(decision, choice);
      onEvent?.(selected ? { ...event, ...selected,
        count: countOnes16bit(d.gridState[selected.cell]),
        placementCells: null, placementValue: 0 } : event);
      return selected;
    });
  });
  reportSolutions();
  if (!decision && (expected || choice !== null)) {
    throw new Error(`Decision ${at} not reached (${result.status})`);
  }
  if (decision) {
    const tail = difference(result.counters, decision.counters);
    firstArm ??= { counters: tail, exhausted: result.exhausted };
    subtree ??= { counters: tail, exhausted: result.exhausted };
  }
  if (!firstSolution && result.counters.solutions) firstSolution = result.counters;
  return { name: puzzle.name, status: result.status, exhausted: result.exhausted,
    counters: result.counters, solutionSet: result.solutionSet, decision, selected,
    propagation, firstArm, subtree, continuation: decision ? difference(result.counters, decision.counters) : null,
    firstSolution, credit };
};

export const runDecisionExperiment = (puzzle, budgets, { at = 1,
  choices = ['same', 'mrv', 'runner-up', 'max-value'], learning = 'live', configure = null,
} = {}) => {
  const baseline = observeSearch(puzzle, budgets, { at, configure });
  if (!baseline.decision) throw new Error(`Decision ${at} not reached (${baseline.status})`);
  const control = observeSearch(puzzle, budgets, { at, expected: baseline.decision, configure });
  assert.deepEqual(control, baseline, 'Unchanged continuation did not reproduce');
  const alternatives = choices.map(choice => {
    const result = observeSearch(puzzle, budgets, {
      at, choice, learning, expected: baseline.decision, configure,
    });
    if (baseline.exhausted && result.exhausted) {
      assert.deepEqual(result.solutionSet, baseline.solutionSet, 'Completed solution sets differ');
    }
    return { choice, learning, ...result };
  });
  return { baseline, controlMatched: true, alternatives };
};

// Stop aligning at the first different branch or contradiction. Identical
// branch ordinals after this point do not imply identical ancestry.
export const compareSearches = (puzzle, budgets, apply) => {
  const events = [];
  const baseline = observeSearch(puzzle, budgets, { onEvent: e => events.push(e) });
  let index = 0, divergence = null;
  const restore = apply();
  let variant;
  try {
    variant = observeSearch(puzzle, budgets, { onEvent: e => {
      if (!divergence && JSON.stringify(events[index]) !== JSON.stringify(e)) {
        divergence = { event: index + 1, baseline: events[index] ?? null, variant: e };
      }
      index++;
    } });
  } finally { restore(); }
  if (!divergence && index !== events.length) {
    divergence = { event: index + 1, baseline: events[index], variant: null };
  }
  if (baseline.exhausted && variant.exhausted) {
    assert.deepEqual(variant.solutionSet, baseline.solutionSet, 'Completed solution sets differ');
  }
  return { baseline, variant, divergence };
};
