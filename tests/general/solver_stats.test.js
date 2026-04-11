import assert from 'node:assert/strict';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

const { SolverStats } = await import('../../js/sandbox/solver_stats.js' + self.VERSION_PARAM);

await runTest('SolverStats constructor populates fields from state', () => {
  const stats = new SolverStats({
    puzzleSetupTime: 10.5,
    timeMs: 200.7,
    counters: { solutions: 1, guesses: 50, backtracks: 3 },
  });
  assert.equal(stats.setupTimeMs, 10.5);
  assert.equal(stats.runtimeMs, 200.7);
  assert.equal(stats.solutions, 1);
  assert.equal(stats.guesses, 50);
  assert.equal(stats.backtracks, 3);
});

await runTest('SolverStats constructor handles null/undefined state', () => {
  const stats = new SolverStats(null);
  assert.equal(stats.setupTimeMs, 0);
  assert.equal(stats.solutions, 0);
});

await runTest('SolverStats.add accumulates values', () => {
  const a = new SolverStats({
    timeMs: 100, counters: { solutions: 1, guesses: 10 },
  });
  const b = new SolverStats({
    timeMs: 200, counters: { solutions: 2, guesses: 20 },
  });
  a.add(b);
  assert.equal(a.runtimeMs, 300);
  assert.equal(a.solutions, 3);
  assert.equal(a.guesses, 30);
});

await runTest('SolverStats.pick returns selected fields', () => {
  const stats = new SolverStats({
    puzzleSetupTime: 10.7,
    timeMs: 200.3,
    counters: { solutions: 5, guesses: 42 },
  });
  const picked = stats.pick('solutions', 'guesses', 'setupTimeMs', 'runtimeMs');
  assert.equal(picked.solutions, 5);
  assert.equal(picked.guesses, 42);
  // Ms fields get rounded.
  assert.equal(picked.setupTimeMs, 11);
  assert.equal(picked.runtimeMs, 200);
});

logSuiteComplete('SolverStats');
