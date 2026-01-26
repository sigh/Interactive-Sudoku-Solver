import assert from 'node:assert/strict';

import { logSuiteComplete } from '../helpers/test_runner.js';

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);

const debugModule = await import('../../js/debug/debug.js');
const {
  debugFilesLoaded,
  runSolveTests,
  runValidateLayoutTests,
  PuzzleRunner,
} = debugModule;
await debugFilesLoaded;

const runner = new PuzzleRunner({
  solver: new SimpleSolver(),
  enableConsoleLogs: false,
});

const expectStatsStructure = (result, label) => {
  assert.ok(result, `${label} returned nothing`);
  assert.ok(Array.isArray(result.stats), `${label} stats should be an array`);
  assert.ok(result.stats.total, `${label} stats should include totals`);
};

const formatNumber = (value) => value.toLocaleString('en-US');
const formatSeconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

const logCollectionSummary = (result, label = result.collection) => {
  const total = result.stats.total || {};
  const parts = [`${label}: ${result.stats.length} puzzles`];
  const runtimeMs = typeof total.rumtimeMs === 'number' ? total.rumtimeMs : total.runtimeMs;
  if (typeof runtimeMs === 'number') {
    parts.push(`runtime ${formatSeconds(runtimeMs)}`);
  }
  if (typeof total.guesses === 'number') {
    parts.push(`guesses ${formatNumber(total.guesses)}`);
  }
  console.log('  ' + parts.join(' | '));
};

const runSolveResults = await runSolveTests((puzzle, err) => {
  throw new Error(`Puzzle ${puzzle.name} failed: ${err}`);
}, runner);
assert.equal(runSolveResults.length, 4, 'runSolveTests should return four collections');
runSolveResults.forEach((result) => expectStatsStructure(result, `solve tests (${result.collection})`));
console.log('✓ runSolveTests completed');
runSolveResults.forEach((result) => logCollectionSummary(result));

const runLayoutResults = await runValidateLayoutTests((puzzle, err) => {
  throw new Error(`Layout puzzle ${puzzle.name} failed: ${err}`);
}, runner);
assert.equal(runLayoutResults.length, 1, 'runValidateLayoutTests should return a single collection');
runLayoutResults.forEach((result) => expectStatsStructure(result, 'layout tests'));
console.log('✓ runValidateLayoutTests completed');
runLayoutResults.forEach((result) => logCollectionSummary(result));

logSuiteComplete('End-to-end');
