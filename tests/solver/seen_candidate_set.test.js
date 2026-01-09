import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SeenCandidateSet } = await import('../../js/solver/candidate_selector.js');

await runTest('SeenCandidateSet with candidateSupportThreshold=1 sets candidates immediately', () => {
  const numCells = 4;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);

  // Simulate a solution grid where each cell has a single value (as bitmask).
  const grid = new Uint16Array([1 << 0, 1 << 1, 1 << 2, 1 << 3]);

  seenCandidateSet.addSolutionGrid(grid);

  // With candidateSupportThreshold=1, candidates should be set immediately.
  assert.equal(seenCandidateSet.candidates[0], 1 << 0);
  assert.equal(seenCandidateSet.candidates[1], 1 << 1);
  assert.equal(seenCandidateSet.candidates[2], 1 << 2);
  assert.equal(seenCandidateSet.candidates[3], 1 << 3);

  // Counts should all be 1.
  const counts = seenCandidateSet.getCandidateCounts();
  assert.equal(counts[0 * numValues + 0], 1);
  assert.equal(counts[1 * numValues + 1], 1);
  assert.equal(counts[2 * numValues + 2], 1);
  assert.equal(counts[3 * numValues + 3], 1);
});

await runTest('SeenCandidateSet with candidateSupportThreshold>1 delays candidate bitmask', () => {
  const numCells = 4;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);
  seenCandidateSet.resetWithThreshold(3);

  const grid = new Uint16Array([1 << 0, 1 << 1, 1 << 2, 1 << 3]);

  // First solution: counts are 1, candidates should be empty.
  seenCandidateSet.addSolutionGrid(grid);
  assert.equal(seenCandidateSet.candidates[0], 0);
  assert.equal(seenCandidateSet.getCandidateCounts()[0], 1);

  // Second solution: counts are 2, candidates should still be empty.
  seenCandidateSet.addSolutionGrid(grid);
  assert.equal(seenCandidateSet.candidates[0], 0);
  assert.equal(seenCandidateSet.getCandidateCounts()[0], 2);

  // Third solution: counts are 3, candidates should now be set.
  seenCandidateSet.addSolutionGrid(grid);
  assert.equal(seenCandidateSet.candidates[0], 1 << 0);
  assert.equal(seenCandidateSet.getCandidateCounts()[0], 3);
});

await runTest('SeenCandidateSet counts saturate at candidateSupportThreshold', () => {
  const numCells = 2;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);
  seenCandidateSet.resetWithThreshold(3);

  const grid = new Uint16Array([1 << 0, 1 << 1]);

  // Add many solutions.
  for (let i = 0; i < 10; i++) {
    seenCandidateSet.addSolutionGrid(grid);
  }

  // Counts should saturate at candidateSupportThreshold (3), not overflow.
  const counts = seenCandidateSet.getCandidateCounts();
  assert.equal(counts[0 * numValues + 0], 3);
  assert.equal(counts[1 * numValues + 1], 3);
});

await runTest('SeenCandidateSet reset clears counts and candidates', () => {
  const numCells = 4;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);

  const grid = new Uint16Array([1 << 0, 1 << 1, 1 << 2, 1 << 3]);
  seenCandidateSet.addSolutionGrid(grid);

  // Verify data is set.
  assert.equal(seenCandidateSet.candidates[0], 1 << 0);
  assert.equal(seenCandidateSet.getCandidateCounts()[0], 1);

  // Reset and verify data is cleared.
  seenCandidateSet.reset();
  assert.equal(seenCandidateSet.candidates[0], 0);
  assert.equal(seenCandidateSet.getCandidateCounts()[0], 0);
});

await runTest('SeenCandidateSet resetWithThreshold sets candidateSupportThreshold', () => {
  const numCells = 4;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);

  // Default candidateSupportThreshold is 1.
  assert.equal(seenCandidateSet._candidateSupportThreshold, 1);

  seenCandidateSet.resetWithThreshold(5);
  assert.equal(seenCandidateSet._candidateSupportThreshold, 5);

  // Also clears data.
  const grid = new Uint16Array([1 << 0, 1 << 1, 1 << 2, 1 << 3]);
  seenCandidateSet.addSolutionGrid(grid);
  seenCandidateSet.resetWithThreshold(10);
  assert.equal(seenCandidateSet._candidateSupportThreshold, 10);
  assert.equal(seenCandidateSet.getCandidateCounts()[0], 0);
});

await runTest('SeenCandidateSet resetWithThreshold throws for invalid value', () => {
  const numCells = 4;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);

  assert.throws(() => seenCandidateSet.resetWithThreshold(0), /candidateSupportThreshold must be between 1 and 255/);
  assert.throws(() => seenCandidateSet.resetWithThreshold(-1), /candidateSupportThreshold must be between 1 and 255/);
  assert.throws(() => seenCandidateSet.resetWithThreshold(256), /candidateSupportThreshold must be between 1 and 255/);
});

await runTest('SeenCandidateSet accumulates multiple values per cell', () => {
  const numCells = 2;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);

  // Two different solutions with different values in cell 0.
  const grid1 = new Uint16Array([1 << 0, 1 << 1]);
  const grid2 = new Uint16Array([1 << 2, 1 << 1]);

  seenCandidateSet.addSolutionGrid(grid1);
  seenCandidateSet.addSolutionGrid(grid2);

  // Cell 0 should have both values 1 and 3 marked.
  assert.equal(seenCandidateSet.candidates[0], (1 << 0) | (1 << 2));
  // Cell 1 should have value 2 marked (appeared twice, but saturates at threshold=1).
  assert.equal(seenCandidateSet.candidates[1], 1 << 1);

  // Check counts - with candidateSupportThreshold=1, counts saturate at 1.
  const counts = seenCandidateSet.getCandidateCounts();
  assert.equal(counts[0 * numValues + 0], 1); // Cell 0, value 1
  assert.equal(counts[0 * numValues + 2], 1); // Cell 0, value 3
  assert.equal(counts[1 * numValues + 1], 1); // Cell 1, value 2 (saturated at 1)
});

await runTest('SeenCandidateSet hasInterestingSolutions works with candidateSupportThreshold', () => {
  const numCells = 4;
  const numValues = 4;
  const seenCandidateSet = new SeenCandidateSet(numCells, numValues);
  seenCandidateSet.resetWithThreshold(2);

  // Add one solution.
  const solution1 = new Uint16Array([1 << 0, 1 << 1, 1 << 2, 1 << 3]);
  seenCandidateSet.addSolutionGrid(solution1);

  // Candidates not yet set (candidateSupportThreshold=2, count=1).
  assert.equal(seenCandidateSet.candidates[0], 0);

  // A grid with the same values should be interesting (count < candidateSupportThreshold).
  const testGrid = new Uint16Array([1 << 0, 1 << 1, 1 << 2, 1 << 3]);
  assert.equal(seenCandidateSet.hasInterestingSolutions(testGrid), true);

  // Add another solution to reach threshold.
  seenCandidateSet.addSolutionGrid(solution1);
  assert.equal(seenCandidateSet.candidates[0], 1 << 0);

  // Now the same grid should NOT be interesting.
  assert.equal(seenCandidateSet.hasInterestingSolutions(testGrid), false);

  // A grid with a new value should still be interesting.
  const newGrid = new Uint16Array([1 << 1, 1 << 1, 1 << 2, 1 << 3]);
  assert.equal(seenCandidateSet.hasInterestingSolutions(newGrid), true);
});
