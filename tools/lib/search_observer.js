// Instrument an existing solver. See SEARCH_OBSERVER.md for event timing and costs.
import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';
ensureGlobalEnvironment();
const { countOnes16bit } = await import('../../js/util.js' + self.VERSION_PARAM);
const { NO_LINKED_CELL } = await import('../../js/solver/candidate_selector.js' + self.VERSION_PARAM);

export const scoreCell = (cell, grid, conflictScores, linkedCells, maxValueInfo) => {
  const count = countOnes16bit(grid[cell]);
  if (count <= 1) return null;
  let raw = conflictScores[cell];
  let linkBoost = false;
  if (linkedCells) {
    const linked = linkedCells[cell];
    if (linked !== NO_LINKED_CELL) {
      const lv = grid[linked];
      if ((lv & (lv - 1)) === 0) { raw <<= 2; linkBoost = true; }
    }
  }
  let valueBoost = 0;
  if (maxValueInfo.value && (grid[cell] & maxValueInfo.value)) {
    valueBoost = maxValueInfo.score * 0.2;
    raw += valueBoost;
  }
  return { cell, count, conflictScore: conflictScores[cell], linkBoost, valueBoost, score: raw / count };
};

export const rankCells = (selector, grid, depth, geometry) => {
  const scores = selector._conflictScores;
  const { value, score } = scores.getMaxValueScore();
  const ranked = [...selector.getCellOrder().subarray(depth)].flatMap((cell, order) => {
    const row = scoreCell(cell, grid, scores.scores, selector._linkedCells, { value, score });
    if (!row) return [];
    return [{ cell, cellId: geometry.makeCellIdFromIndex(cell), mask: grid[cell], count: row.count,
      order, conflict: row.conflictScore, linkedFixed: row.linkBoost,
      valueBoost: row.valueBoost, score: row.score }];
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  if (ranked.length && ranked[0].score === 0) {
    ranked.sort((a, b) => a.count - b.count || a.order - b.order);
  }
  return ranked;
};

// Returns a disposer; runSolve accepts it as the onSolver callback's return value.
export const observeSolver = (solver, observer, interventions = {}) => {
  const internal = solver._internalSolver;
  const selector = internal._candidateSelector;
  const scores = internal._conflictScores;
  const numSearchCells = internal._numSearchCells;
  let grid = null;
  const scoreState = () => ({ cellScores: [...scores.scores],
    valueScores: [...scores._valueScores], decayCountdown: scores._decayCountdown });
  const context = {
    get grid() { return grid; },
    get cellOrder() { return selector.getCellOrder(); },
    numSearchCells, numValues: solver._geometry.numValues,
    scoreState,
    valuePreference: () => ({ ...scores.getMaxValueScore() }),
    counters: () => ({ ...internal.counters }),
    ranking: depth => rankCells(selector, grid, depth, solver._geometry),
    snapshot: () => ({ grid: grid ? [...grid] : null,
      cellOrder: [...selector.getCellOrder()], ...scoreState(),
      previousCandidateCount: selector._prevCandidateCount,
      selectionFlags: [...selector._candidateSelectionFlags],
      selectionStates: selector._candidateSelectionStates.map(x => ({ ...x, cells: [...x.cells] })),
      frames: internal._recStack.slice(0, internal._recStack.indexOf(internal._currentRecFrame) + 1)
        .map(f => ({ depth: f.cellDepth, fresh: f.newNode,
          lastConflictCell: f.lastConflictCell, grid: [...f.gridState] })),
    }),
  };
  const hooks = observer(context);
  const undo = [];
  const wrap = (object, key, factory) => {
    const own = Object.hasOwn(object, key), original = object[key];
    object[key] = factory(original);
    undo.push(() => { if (own) object[key] = original; else delete object[key]; });
  };
  const dispose = () => { while (undo.length) undo.pop()(); };
  let explanation = null;
  try {
    if (hooks.beforeSelection || hooks.afterSelection) {
      wrap(selector, 'selectNextCandidate', original => function (depth, state, stepState, fresh) {
        grid = state;
        const request = hooks.beforeSelection?.({ depth, fresh });
        explanation = request?.explain ? { demotions: [] } : null;
        try {
          const next = explanation
            ? explainSelection(this, solver._geometry, grid, depth, fresh, explanation,
              () => original.call(this, depth, state, stepState, fresh))
            : original.call(this, depth, state, stepState, fresh);
          hooks.afterSelection?.({ depth, fresh, nextDepth: next.nextDepth,
            cell: this.getCellAtDepth(depth), value: next.value, count: next.count,
            cells: [...this.getCellOrder().slice(depth, next.nextDepth)],
            placement: !!this._candidateSelectionFlags[depth],
            remainingPlacementCells: this._candidateSelectionFlags[depth]
              ? [...this._candidateSelectionStates[depth].cells] : [] }, explanation);
          return next;
        } finally { explanation = null; }
      });
    }
    if (hooks.branch || interventions.branch) {
      // A second hook would silently replace the first; require a single owner.
      assert.equal(selector._decisionHook, null, 'Solver already has a decision hook');
      selector.setDecisionHook(d => {
        grid = d.gridState;
        hooks.branch?.(d);
        return interventions.branch?.(d) ?? null;
      });
      undo.push(() => selector.setDecisionHook(null));
    }
    if (hooks.beforePropagation || hooks.afterPropagation || hooks.beforeIncrement || hooks.afterIncrement || interventions.increment) {
      wrap(internal, '_enforceConstraints', original => function (state, queue) {
        grid = state;
        if (!hooks.beforePropagation && !hooks.afterPropagation) return original.call(this, state, queue);
        const request = hooks.beforePropagation?.() ?? {};
        const before = request.reductions ? state.slice(0, numSearchCells) : null;
        const population = () => {
          let total = 0;
          for (let i = 0; i < numSearchCells; i++) total += countOnes16bit(state[i]);
          return total;
        };
        const count = request.eliminated && !before ? population() : 0;
        let lastHandler = null;
        const own = Object.hasOwn(queue, 'takeNext'), takeNext = queue.takeNext;
        if (request.refuter) queue.takeNext = function () { return lastHandler = takeNext.call(this); };
        let ok;
        try { ok = original.call(this, state, queue); }
        finally {
          if (request.refuter) { if (own) queue.takeNext = takeNext; else delete queue.takeNext; }
        }
        const event = { conflict: !ok };
        if (before) {
          event.reductions = [];
          for (let cell = 0; cell < before.length; cell++) {
            if (before[cell] !== state[cell]) event.reductions.push({ cell, before: before[cell], after: state[cell] });
          }
          event.eliminated = event.reductions.reduce((n, r) => n + countOnes16bit(r.before) - countOnes16bit(r.after), 0);
        } else if (request.eliminated) event.eliminated = count - population();
        if (request.refuter) event.refuter = !ok && lastHandler
          ? { type: lastHandler.constructor.name, cells: [...lastHandler.cells] } : null;
        hooks.afterPropagation?.(event);
        return ok;
      });
    }
    if (hooks.beforeIncrement || hooks.afterIncrement || interventions.increment) {
      wrap(scores, 'increment', original => function (cell, value) {
        const event = { cell, value };
        hooks.beforeIncrement?.(event);
        const replacement = interventions.increment?.(event);
        const applied = replacement !== false;
        const credited = replacement || event;
        if (applied) {
          assert.ok(Number.isInteger(credited.cell) && credited.cell >= 0 && credited.cell < numSearchCells, 'Invalid credit cell');
          assert.ok(Number.isInteger(credited.value) && credited.value > 0 &&
            !(credited.value & (credited.value - 1)) && credited.value < (1 << context.numValues), 'Invalid credit value');
          original.call(this, credited.cell, credited.value);
        }
        hooks.afterIncrement?.({ ...event, applied, creditedCell: credited.cell, creditedValue: credited.value });
      });
    }
    for (const method of ['decay', 'demote']) {
      if (!hooks.scoreChange && !interventions[method] && !(method === 'demote' && hooks.beforeSelection)) continue;
      wrap(scores, method, original => function (...args) {
        const before = hooks.scoreChange ? scoreState() : null;
        const cellBefore = explanation && method === 'demote' ? this.scores[args[0]] : null;
        const applied = interventions[method]?.({ cell: args[0] }) !== false;
        if (applied) original.apply(this, args);
        if (explanation && method === 'demote' && applied) {
          explanation.demotions.push({ cell: args[0], before: cellBefore, after: this.scores[args[0]] });
        }
        hooks.scoreChange?.({ type: method, cell: args[0], applied, before, after: scoreState() });
      });
    }
    if (hooks.solution) {
      wrap(internal, 'run', original => function (mode, onSolution) {
        return original.call(this, mode, (...args) => {
          hooks.solution();
          return onSolution(...args);
        });
      });
    }
    return dispose;
  } catch (error) { dispose(); throw error; }
};

// Detailed observation is installed only for a requested selection.
const explainSelection = (selector, geometry, grid, depth, fresh, report, select) => {
  const scores = selector._conflictScores;
  const undo = [];
  const wrap = (object, key, factory) => {
    const own = Object.hasOwn(object, key);
    const original = object[key];
    object[key] = factory(original);
    undo.push(() => { if (own) object[key] = original; else delete object[key]; });
  };
  Object.assign(report, { depth, fresh, plain: null, placement: null, heuristic: null, selected: null });
  wrap(selector, '_selectBestCell', original => function (...args) {
    const ranking = rankCells(this, grid, depth, geometry);
    const result = original.apply(this, args);
    const cell = this.getCellOrder()[result.cellOffset];
    report.plain = { cell, ranking, rule: result.totalCandidateCount === -1
      ? 'forced-cell' : ranking.every(r => r.score === 0) ? 'minimum-domain' : 'score-and-retained-order' };
    const chosen = ranking.find(r => r.cell === cell);
    if (chosen && result.totalCandidateCount !== -1) {
      report.plain.equalRankCells = ranking.filter(r => report.plain.rule === 'minimum-domain'
        ? r.count === chosen.count : r.score === chosen.score).map(r => r.cell);
      report.plain.tiePolicy = 'earliest-in-retained-order';
    }
    return result;
  });
  wrap(selector, '_findCustomCandidates', original => function (...args) {
    const state = args[3];
    report.placement = { initialScore: state.score,
      initialCellThreshold: Math.ceil(state.score * 2) | 0, eligibleCells: [], considered: [] };
    wrap(this._candidateFinderSet, 'getIndexesForCell', get => function (cell) {
      report.placement.eligibleCells.push({ cell, score: scores.scores[cell],
        threshold: Math.ceil(state.score * 2) | 0 });
      return get.call(this, cell);
    });
    // Finders are initialized before this method is entered. Observe only calls
    // the real traversal makes, including its changing nomination threshold.
    for (const finder of this._candidateFinderSet._finders) {
      wrap(finder, 'maybeFindCandidate', find => function (...findArgs) {
        const candidate = findArgs[2];
        const beforeScore = candidate.score;
        const accepted = find.apply(this, findArgs);
        report.placement.considered.push({ type: this.constructor.name,
          cells: [...this.cells], beforeScore, cellThreshold: Math.ceil(beforeScore * 2) | 0,
          accepted, ...(accepted ? { score: candidate.score, value: candidate.value,
            candidateCells: [...candidate.cells] } : {}) });
        return accepted;
      });
    }
    const accepted = original.apply(this, args);
    report.placement.accepted = accepted;
    if (accepted) report.placement.orderedCells = [...state.cells];
    return accepted;
  });
  wrap(selector, '_selectBestCandidate', original => function (...args) {
    const result = original.apply(this, args);
    const cell = this.getCellOrder()[result.cellOffset];
    report.heuristic = { cell, value: result.value, count: result.count,
      placement: !!this._candidateSelectionFlags[depth] };
    const plainCell = report.plain?.cell ?? cell;
    const mask = grid[plainCell];
    const count = countOnes16bit(mask);
    report.placementGate = { fresh, plainCell, domainSize: count,
      cellScore: scores.scores[plainCell], optionSelector: this._optionSelector !== null,
      entered: report.placement !== null };
    return result;
  });
  try {
    const result = select();
    report.selected = { ...result, cells: [...selector.getCellOrder().slice(depth, result.nextDepth)],
      placement: !!selector._candidateSelectionFlags[depth] };
    return result;
  } finally {
    for (const restore of undo.reverse()) restore();
  }
};
