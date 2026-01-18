import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../../js/grid_shape.js');
const { CandidateSelector, ConflictScores, SeenCandidateSet } = await import('../../js/solver/candidate_selector.js');

const makeDebugLogger = () => ({
  enableStepLogs: false,
  enableLogs: false,
  log: () => { },
});

const createGridState = (shape, fill) => new Array(shape.numCells).fill(fill);

await runTest('CandidateSelector prefers interesting values when uninterestingValues set', () => {
  const shape = GridShape.fromGridSize(4);

  const seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);
  seenCandidateSet.enabledInSolver = true;
  const candidates = seenCandidateSet.candidates;
  // Mark value 1 as already-seen for cell 0.
  candidates[0] = 1 << 0;

  seenCandidateSet._lastInterestingCell = 0;

  const selector = new CandidateSelector(
    shape,
    /* handlerSet */[],
    makeDebugLogger(),
    seenCandidateSet,
  );

  const conflictScores = new ConflictScores(new Array(shape.numCells).fill(0), shape.numValues);
  selector.reset(conflictScores);

  // All cells have 4 candidates, so the selector should choose cell 0.
  const gridState = createGridState(shape, (1 << shape.numValues) - 1);

  const [nextDepth, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.equal(nextDepth, 1);
  assert.equal(count, 4);
  // Should prefer value 2 (bit 1) over value 1 (bit 0).
  assert.equal(value, 1 << 1);
});

await runTest('CandidateSelector falls back when no interesting values exist', () => {
  const shape = GridShape.fromGridSize(4);

  const seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);
  seenCandidateSet.enabledInSolver = true;
  const candidates = seenCandidateSet.candidates;
  // Mark all values already-seen for cell 0.
  candidates[0] = (1 << shape.numValues) - 1;

  seenCandidateSet._lastInterestingCell = 0;

  const selector = new CandidateSelector(
    shape,
    /* handlerSet */[],
    makeDebugLogger(),
    seenCandidateSet,
  );

  const conflictScores = new ConflictScores(new Array(shape.numCells).fill(0), shape.numValues);
  selector.reset(conflictScores);

  const gridState = createGridState(shape, (1 << shape.numValues) - 1);

  const [nextDepth, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.equal(nextDepth, 1);
  assert.equal(count, 4);
  // Falls back to the default "lowest-bit" value.
  assert.equal(value, 1 << 0);
});

await runTest('CandidateSelector selects only from interesting cells when prefix is interesting', () => {
  const shape = GridShape.fromGridSize(4);

  const seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);
  seenCandidateSet.enabledInSolver = true;

  const allValues = (1 << shape.numValues) - 1;
  const candidates = seenCandidateSet.candidates;
  // Cell 0 is fixed to value 1, and value 1 has not been seen -> interesting prefix.
  candidates[0] = 0;

  // Make cell 1 non-interesting (all values already seen), and cell 2 interesting.
  candidates[1] = allValues;
  candidates[2] = 0;

  const selector = new CandidateSelector(
    shape,
    /* handlerSet */[],
    makeDebugLogger(),
    seenCandidateSet,
  );

  // Give cell 1 a high conflict score so it would normally be selected.
  const initialScores = new Array(shape.numCells).fill(0);
  initialScores[1] = 100;
  const conflictScores = new ConflictScores(initialScores, shape.numValues);
  selector.reset(conflictScores);

  const gridState = createGridState(shape, allValues);
  gridState[0] = 1 << 0;

  const [nextDepth, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 1,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.equal(selector.getCellAtDepth(1), 2);
  assert.equal(nextDepth, 2);
  assert.equal(count, 4);
  assert.equal(value, 1 << 0);
});

await runTest('CandidateSelector custom candidates pop interesting cell first', () => {
  const shape = GridShape.fromGridSize(4);

  const seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);
  seenCandidateSet.enabledInSolver = true;
  const allValues = (1 << shape.numValues) - 1;

  // Ensure prefix is interesting at depth 1.
  seenCandidateSet.candidates[0] = 0;

  // For the nominated value (1), cell 1 is not interesting, cell 2 is interesting.
  const nominatedValue = 1 << 0;
  seenCandidateSet.candidates[1] = nominatedValue;
  seenCandidateSet.candidates[2] = 0;

  const finder = {
    cells: [1, 2],
    maybeFindCandidate: (grid, conflictScores, result) => {
      result.score = 1e9;
      result.value = nominatedValue;
      result.cells.length = 0;
      result.cells.push(1, 2);
      return true;
    },
  };

  const handler = {
    candidateFinders: () => [finder],
  };

  const selector = new CandidateSelector(
    shape,
    /* handlerSet */[handler],
    makeDebugLogger(),
    seenCandidateSet,
  );

  const initialScores = new Array(shape.numCells).fill(0);
  // Ensure custom candidate mode is eligible (conflictScores[cell] > 0).
  initialScores[1] = 20;
  initialScores[2] = 20;
  const conflictScores = new ConflictScores(initialScores, shape.numValues);
  selector.reset(conflictScores);

  const gridState = createGridState(shape, allValues);
  gridState[0] = nominatedValue;

  // With depth=1, custom candidates should trigger and choose the interesting
  // cell (2) first by popping it from the end of the list.
  const [nextDepth, value, count] = selector.selectNextCandidate(
    /* cellDepth */ 1,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
  );

  assert.equal(nextDepth, 2);
  assert.equal(count, 2);
  assert.equal(value, nominatedValue);
  assert.equal(selector.getCellAtDepth(1), 2);
});
