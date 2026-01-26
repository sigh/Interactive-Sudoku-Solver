import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest } from '../helpers/test_runner.js';
import { GridTestContext } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { CandidateSelector, ConflictScores, SeenCandidateSet } = await import('../../js/solver/candidate_selector.js');

const makeDebugLogger = () => ({
  enableStepLogs: false,
  enableLogs: false,
  log: () => { },
});

const makeSelector = (context, { handlerSet = [], seenCandidateSet } = {}) => {
  const { shape } = context;
  const selector = new CandidateSelector(
    shape,
    handlerSet,
    makeDebugLogger(),
    seenCandidateSet || new SeenCandidateSet(shape.numCells, shape.numValues),
  );

  const conflictScores = new ConflictScores(new Array(shape.numCells).fill(0), shape.numValues);
  selector.reset(conflictScores);
  return { selector, conflictScores };
};

await runTest('CandidateSelector moves all singletons to the front when next cell is a singleton', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const { selector } = makeSelector(context);

  const gridState = context.createGrid({ fill: allValues });

  // Ensure the next cell is a singleton and there are other singletons later.
  gridState[0] = 1 << 0;
  gridState[3] = 1 << 1;
  gridState[7] = 1 << 2;

  const [nextDepth, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.equal(count, 1);
  assert.equal(value, 1 << 0);
  assert.equal(nextDepth, 3);

  const cellOrder = selector.getCellOrder();
  const prefixCells = Array.from(cellOrder.subarray(0, nextDepth));
  assert.deepEqual(prefixCells, [0, 3, 7]);

  for (let i = 0; i < nextDepth; i++) {
    const v = gridState[cellOrder[i]];
    assert.ok(v && ((v & (v - 1)) === 0), `Expected singleton at depth ${i}`);
  }
  for (let i = nextDepth; i < shape.numCells; i++) {
    const v = gridState[cellOrder[i]];
    assert.ok((v & (v - 1)) !== 0, `Expected non-singleton at depth ${i}`);
  }
});

await runTest('CandidateSelector returns [cellOrder,0,0] when a wipeout (0) exists while bubbling singletons', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const { selector } = makeSelector(context);

  const gridState = context.createGrid({ fill: allValues });

  // Make the next cell a singleton so that _updateCellOrder scans for other
  // singletons and detects wipeouts.
  gridState[0] = 1 << 0;
  gridState[5] = 0;

  const [cellOrderOrZero, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.ok(cellOrderOrZero instanceof Uint8Array);
  assert.equal(value, 0);
  assert.equal(count, 0);
});

await runTest('CandidateSelector consumes custom candidate state across backtracks (count reflects remaining custom options)', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;
  const nominatedValue = 1 << 0;

  const finder = {
    cells: [2, 5, 7],
    maybeFindCandidate: (grid, conflictScores, result) => {
      result.score = 1e9;
      result.value = nominatedValue;
      result.cells.length = 0;
      result.cells.push(2, 5, 7);
      return true;
    },
  };

  const handler = {
    candidateFinders: () => [finder],
  };

  const { selector, conflictScores } = makeSelector(context, { handlerSet: [handler] });

  // Make default selection eligible for custom candidates: best cell has count>2 and cs>0.
  // Ensure minCS is beaten by at least one finder cell.
  conflictScores.scores[0] = 100;
  conflictScores.scores[2] = 60;
  conflictScores.scores[5] = 70;
  conflictScores.scores[7] = 80;

  const gridState = context.createGrid({ fill: allValues });

  // First visit: custom candidate state should be created and the highest
  // conflict-score cell (7) should be popped first.
  {
    const [nextDepth, value, count] = selector.selectNextCandidate(0, gridState, null, true);
    assert.equal(nextDepth, 1);
    assert.equal(value, nominatedValue);
    assert.equal(count, 3);
    assert.equal(selector.getCellAtDepth(0), 7);
  }

  // Backtrack: should continue consuming the custom state (count=2), popping 5 next.
  {
    const [nextDepth, value, count] = selector.selectNextCandidate(0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(value, nominatedValue);
    assert.equal(count, 2);
    assert.equal(selector.getCellAtDepth(0), 5);
  }

  // Backtrack again: last custom option (count=1), popping 2.
  {
    const [nextDepth, value, count] = selector.selectNextCandidate(0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(value, nominatedValue);
    assert.equal(count, 1);
    assert.equal(selector.getCellAtDepth(0), 2);
  }

  // After exhaustion: should fall back to default selection (count=domain size).
  {
    const [nextDepth, value, count] = selector.selectNextCandidate(0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(0), 0);
    assert.equal(value, 1 << 0);
  }
});

await runTest('CandidateSelector stepState override clears any pending custom-candidate state', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;
  const nominatedValue = 1 << 0;

  const finder = {
    cells: [2, 5, 7],
    maybeFindCandidate: (grid, conflictScores, result) => {
      result.score = 1e9;
      result.value = nominatedValue;
      result.cells.length = 0;
      result.cells.push(2, 5, 7);
      return true;
    },
  };

  const handler = {
    candidateFinders: () => [finder],
  };

  const { selector, conflictScores } = makeSelector(context, { handlerSet: [handler] });

  conflictScores.scores[0] = 100;
  conflictScores.scores[2] = 60;
  conflictScores.scores[5] = 70;
  conflictScores.scores[7] = 80;

  const gridState = context.createGrid({ fill: allValues });

  // First call seeds the custom candidate state.
  {
    const [, , count] = selector.selectNextCandidate(0, gridState, null, true);
    assert.equal(count, 3);
  }

  // Second call would normally be custom (count=2), but we override with a guided cell.
  const guidedCell = 1;
  const stepState = {
    step: 0,
    stepGuides: new Map([[0, { cell: guidedCell, depth: 0 }]]),
  };

  {
    const [nextDepth, , count] = selector.selectNextCandidate(0, gridState, stepState, false);
    assert.equal(nextDepth, 1);
    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(0), guidedCell);
  }

  // Third call: custom state should have been cleared by the adjustment, so we should
  // see default selection behavior (count=4, best cell=0).
  {
    const [nextDepth, value, count] = selector.selectNextCandidate(0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(0), 0);
    assert.equal(value, 1 << 0);
  }
});

await runTest('CandidateSelector falls back cleanly when filtering to interesting cells but none are interesting', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);
  seenCandidateSet.enabledInSolver = true;

  // Prefix (cell 0) is interesting (fixed value not previously seen).
  seenCandidateSet.candidates[0] = 0;

  // Make all remaining cells non-interesting (all values already seen).
  for (let i = 1; i < shape.numCells; i++) {
    seenCandidateSet.candidates[i] = allValues;
  }

  const selector = new CandidateSelector(
    shape,
    /* handlerSet */[],
    makeDebugLogger(),
    seenCandidateSet,
  );

  const initialScores = new Array(shape.numCells).fill(0);
  initialScores[5] = 123;
  const conflictScores = new ConflictScores(initialScores, shape.numValues);
  selector.reset(conflictScores);

  const gridState = context.createGrid({ fill: allValues });
  gridState[0] = 1 << 0;

  const [nextDepth, , count] = selector.selectNextCandidate(1, gridState, null, true);

  assert.equal(nextDepth, 2);
  assert.equal(count, 4);
  assert.equal(selector.getCellAtDepth(1), 5);
});

await runTest('CandidateSelector returns [cellOrder,0,0] when current depth cell is already a wipeout (0)', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const { selector } = makeSelector(context);

  const gridState = context.createGrid({ fill: allValues });
  gridState[0] = 0;

  const [cellOrderOrZero, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.ok(cellOrderOrZero instanceof Uint8Array);
  assert.equal(value, 0);
  assert.equal(count, 0);
});

await runTest('CandidateSelector interesting-cell filtering works on the maxScore==0 (minCount) path', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);
  seenCandidateSet.enabledInSolver = true;

  // Prefix is interesting at depth=1.
  seenCandidateSet.candidates[0] = 0;

  // Make cell 1 non-interesting; cells 2 and 3 interesting.
  seenCandidateSet.candidates[1] = allValues;
  seenCandidateSet.candidates[2] = 0;
  seenCandidateSet.candidates[3] = 0;

  const selector = new CandidateSelector(
    shape,
    /* handlerSet */[],
    makeDebugLogger(),
    seenCandidateSet,
  );

  // All conflict scores are 0 => maxScore==0 branch.
  const conflictScores = new ConflictScores(new Array(shape.numCells).fill(0), shape.numValues);
  selector.reset(conflictScores);

  const gridState = context.createGrid({ fill: allValues });
  gridState[0] = 1 << 0;

  // Make the interesting cells have different counts.
  gridState[2] = (1 << 0) | (1 << 1); // count=2
  gridState[3] = (1 << 0) | (1 << 1) | (1 << 2); // count=3

  const [nextDepth, value, count] = selector.selectNextCandidate(1, gridState, null, true);

  assert.equal(nextDepth, 2);
  assert.equal(count, 2);
  assert.equal(selector.getCellAtDepth(1), 2);
  assert.equal(value, 1 << 0);
});
