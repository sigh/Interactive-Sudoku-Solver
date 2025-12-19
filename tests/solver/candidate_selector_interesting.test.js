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

// await runTest('CandidateSelector prefers interesting values when uninterestingValues set', () => {
//   const shape = GridShape.fromGridSize(4);

//   const seenCandidateSet = new SeenCandidateSet(shape.numCells);
//   seenCandidateSet.enabledInSolver = true;
//   const candidates = seenCandidateSet.candidates;
//   // Mark value 1 as already-seen for cell 0.
//   candidates[0] = 1 << 0;

//   seenCandidateSet._lastInterestingCell = 0;

//   const selector = new CandidateSelector(
//     shape,
//     /* handlerSet */[],
//     makeDebugLogger(),
//     seenCandidateSet,
//   );

//   const conflictScores = new ConflictScores(new Int32Array(shape.numCells), shape.numValues);
//   selector.reset(conflictScores);

//   // All cells have 4 candidates, so the selector should choose cell 0.
//   const gridState = new Uint16Array(shape.numCells);
//   gridState.fill((1 << shape.numValues) - 1);

//   const [nextDepth, value, count] = selector.selectNextCandidate(
//     /* cellDepth */ 0,
//     gridState,
//     /* stepState */ null,
//     /* isNewNode */ true,
//   );

//   assert.equal(nextDepth, 1);
//   assert.equal(count, 4);
//   // Should prefer value 2 (bit 1) over value 1 (bit 0).
//   assert.equal(value, 1 << 1);
// });

// await runTest('CandidateSelector falls back when no interesting values exist', () => {
//   const shape = GridShape.fromGridSize(4);

//   const seenCandidateSet = new SeenCandidateSet(shape.numCells);
//   seenCandidateSet.enabledInSolver = true;
//   const candidates = seenCandidateSet.candidates;
//   // Mark all values already-seen for cell 0.
//   candidates[0] = (1 << shape.numValues) - 1;

//   seenCandidateSet._lastInterestingCell = 0;

//   const selector = new CandidateSelector(
//     shape,
//     /* handlerSet */[],
//     makeDebugLogger(),
//     seenCandidateSet,
//   );

//   const conflictScores = new ConflictScores(new Int32Array(shape.numCells), shape.numValues);
//   selector.reset(conflictScores);

//   const gridState = new Uint16Array(shape.numCells);
//   gridState.fill((1 << shape.numValues) - 1);

//   const [nextDepth, value, count] = selector.selectNextCandidate(
//     /* cellDepth */ 0,
//     gridState,
//     /* stepState */ null,
//     /* isNewNode */ true,
//   );

//   assert.equal(nextDepth, 1);
//   assert.equal(count, 4);
//   // Falls back to the default "lowest-bit" value.
//   assert.equal(value, 1 << 0);
// });
