import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { ConflictScores } = await import('../js/solver/candidate_selector.js');

await runTest('ConflictScores.increment should increment cell and value scores', () => {
  const cs = new ConflictScores([0, 0, 0], /* numValues= */ 16);
  const valueMask = 1 << 3;

  cs.increment(1, valueMask);

  assert.equal(cs.scores[1], 1);
  // Value scores are observable via getMaxValueScore once they are significant.
  const info = cs.getMaxValueScore();
  assert.deepEqual(info, { value: 0, score: 0 });
});

await runTest('ConflictScores.decay should decay cell scores', () => {
  const cs = new ConflictScores([5, 3], /* numValues= */ 16);
  cs.decay();
  assert.deepEqual(cs.scores, [2, 1]);
});

await runTest('ConflictScores.increment should trigger decay when countdown hits zero', () => {
  // Keep this black-box-ish: only assert visible effects (cell scores).
  // We still need to force the countdown because the default is large.
  const cs = new ConflictScores([3], /* numValues= */ 16);
  const valueMask = 1 << 4;
  cs._decayCountdown = 1;

  cs.increment(0, valueMask);

  // After increment: scores[0] was 4, then decay applied => 4 >> 1.
  assert.equal(cs.scores[0], 2);
});

await runTest('ConflictScores.getMaxValueScore should return zero when max is not significant', () => {
  const cs = new ConflictScores([0], /* numValues= */ 16);
  // Build max=15 (< numValues) via increments.
  const valueMask = 1 << 1;
  for (let i = 0; i < 15; i++) cs.increment(0, valueMask);
  assert.deepEqual(cs.getMaxValueScore(), { value: 0, score: 0 });
});

await runTest('ConflictScores.getMaxValueScore should return zero when spread is insufficient (boundary)', () => {
  const cs = new ConflictScores([0], /* numValues= */ 16);
  const minMask = 1 << 2;
  const maxMask = 1 << 5;

  // min=16
  for (let i = 0; i < 16; i++) cs.increment(0, minMask);
  // max=24 (exactly 1.5*min) => should NOT pass
  for (let i = 0; i < 24; i++) cs.increment(0, maxMask);

  assert.deepEqual(cs.getMaxValueScore(), { value: 0, score: 0 });
});

await runTest('ConflictScores.getMaxValueScore should return best value+score when spread is sufficient', () => {
  const cs = new ConflictScores([0], /* numValues= */ 16);
  const minMask = 1 << 2;
  const maxMask = 1 << 5;

  // min=16
  for (let i = 0; i < 16; i++) cs.increment(0, minMask);
  // max=32 => max > 1.5*min and >= numValues
  for (let i = 0; i < 32; i++) cs.increment(0, maxMask);

  assert.deepEqual(cs.getMaxValueScore(), { value: maxMask, score: 32 });
});

await runTest('ConflictScores.getMaxValueScore should ignore zeros when computing min', () => {
  const cs = new ConflictScores([0], /* numValues= */ 16);
  const onlyMask = 1 << 7;
  for (let i = 0; i < 32; i++) cs.increment(0, onlyMask);

  // With only one non-zero value, min == max so spread check fails.
  assert.deepEqual(cs.getMaxValueScore(), { value: 0, score: 0 });
});

await runTest('ConflictScores.decay should decay value scores (observable via getMaxValueScore)', () => {
  const cs = new ConflictScores([0], /* numValues= */ 16);
  const minMask = 1 << 2;
  const maxMask = 1 << 5;

  for (let i = 0; i < 16; i++) cs.increment(0, minMask);
  for (let i = 0; i < 32; i++) cs.increment(0, maxMask);
  assert.deepEqual(cs.getMaxValueScore(), { value: maxMask, score: 32 });

  cs.decay();
  // Value scores decay by >>2, so max becomes 8 (< numValues), which fails significance.
  assert.deepEqual(cs.getMaxValueScore(), { value: 0, score: 0 });
});

logSuiteComplete('ConflictScores');
