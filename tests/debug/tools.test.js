// Smoke test for the tests/debug CLI tools.
//
// These tools instrument solver internals (e.g. the candidate selector's return
// shape), so they break silently when an internal API changes — this catches
// that drift. Each tool exports `main(argv)` and throws on failure, so the tests
// run them IN-PROCESS: the heavy solver + collections module graph loads once
// (when this file imports the three tools), and each case is a cheap call. Adding
// a case costs ~nothing — no per-test subprocess startup. A single subprocess
// test covers the CLI exit-code contract (the throw -> process.exit mapping).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { main as solveMain } from './solve.js';
import { main as stepMain } from './step_analysis.js';
import { main as hotspotsMain } from './search_hotspots.js';

const PUZZLE = 'Chaos Construction: 6x6'; // tiny chaos puzzle: ~30 guesses, has var cells
const argv = (script, ...args) => ['node', script, ...args];

// Run a tool's main() with output captured and any throw caught. Captures
// console.log (stdout), console.error (stderr), and direct process.stdout.write
// (used by --dump-state to emit the bare constraint string).
const capture = (fn) => {
  const out = [], err = [];
  const { log, error } = console;
  const stdoutWrite = process.stdout.write;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.stdout.write = (s) => { out.push(String(s).replace(/\n+$/, '')); return true; };
  let thrown = null;
  try { fn(); } catch (e) { thrown = e; } finally {
    Object.assign(console, { log, error });
    process.stdout.write = stdoutWrite;
  }
  return { stdout: out.join('\n'), stderr: err.join('\n'), thrown };
};

await runTest('solve.js prints a solution', () => {
  const { stdout, thrown } = capture(() =>
    solveMain(argv('solve.js', '--max-backtracks', '5000', '--puzzle', PUZZLE)));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /Solution 1/);
});

await runTest('solve.js requires an explicit --max-backtracks', () => {
  const { thrown } = capture(() => solveMain(argv('solve.js', '--puzzle', PUZZLE)));
  assert.match(thrown?.message ?? '', /backtrack limit is required/);
});

// One call exercises the whole step-inspection surface: the walk table, the
// candidate-selector instrumentation (--explain, the path that silently broke
// when _selectBestCandidate changed shape), pencilmarks/var cells, and the
// per-step propagation log (--log).
await runTest('step_analysis.js walk + explain + grid + vars + log', () => {
  const { stdout, thrown } = capture(() => stepMain(argv('step_analysis.js',
    '--puzzle', PUZZLE, '--steps', '6', '--at', '2', '--explain', '--grid', '--vars', '--log')));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /step\tguess/);
  assert.match(stdout, /Explain step/);
  assert.match(stdout, /Pencilmarks at step 2/);
  assert.match(stdout, /Extra \(var\) cells/);
  assert.match(stdout, /Constraint propagation at step 2/);
});

// --dump-state must write ONLY the constraint string to stdout (human output to
// stderr), and that string must parse and re-propagate.
await runTest('step_analysis.js --dump-state round-trips', () => {
  const dump = capture(() => stepMain(argv('step_analysis.js', '--puzzle', PUZZLE, '--at', '4', '--dump-state')));
  assert.equal(dump.thrown, null, dump.thrown?.message);
  const stateString = dump.stdout.trim();
  assert.ok(stateString.startsWith('.'), `expected a bare constraint on stdout, got: ${JSON.stringify(stateString)}`);
  assert.equal(stateString.split('\n').length, 1, 'stdout must be a single constraint line');
  assert.match(dump.stderr, /state at step 4/);  // the human summary went to stderr
  const back = capture(() => stepMain(argv('step_analysis.js', '--input', stateString, '--steps', '2')));
  assert.equal(back.thrown, null, back.thrown?.message);
});

// The pipe contract: --dump-state | --input - (reading the constraint from stdin).
// Subprocess because it exercises real stdin + the stdout/stderr split.
await runTest('step_analysis.js --dump-state | --input - pipe', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'step_analysis.js');
  const dump = spawnSync(process.execPath, [script, '--puzzle', PUZZLE, '--at', '4', '--dump-state'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(dump.status, 0, dump.stderr);
  assert.equal(dump.stdout.trim().split('\n').length, 1, 'dump stdout must be one clean line');
  const back = spawnSync(process.execPath, [script, '--input', '-', '--steps', '2'],
    { input: dump.stdout, encoding: 'utf8', timeout: 60000 });
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /step\tguess/);
});

await runTest('step_analysis.js --compare <ablation> runs', () => {
  const { stdout, thrown } = capture(() => stepMain(argv('step_analysis.js',
    '--puzzle', PUZZLE, '--steps', '8', '--compare', 'chaos-bottlenecks')));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /Compare vs --ablate chaos-bottlenecks/);
});

await runTest('step_analysis.js --compare rejects an unknown ablation', () => {
  const { thrown } = capture(() => stepMain(argv('step_analysis.js', '--puzzle', PUZZLE, '--compare', 'nonexistent')));
  assert.match(thrown?.message ?? '', /unknown ablation/);
});

await runTest('search_hotspots.js runs', () => {
  const { stdout, thrown } = capture(() =>
    hotspotsMain(argv('search_hotspots.js', '--max-backtracks', '5000', '--puzzle', PUZZLE)));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /CONFLICT/);
  assert.match(stdout, /BRANCH FACTOR/);
  assert.match(stdout, /PROPAGATION YIELD/);
});

await runTest('search_hotspots.js requires --max-backtracks', () => {
  const { thrown } = capture(() => hotspotsMain(argv('search_hotspots.js', '--puzzle', PUZZLE)));
  assert.match(thrown?.message ?? '', /backtrack limit is required/);
});

// The one subprocess check: the shared CLI entry maps a thrown error to a
// non-zero exit (the contract scripts/CI rely on). Everything else is in-process.
await runTest('CLI entry exits non-zero on error', () => {
  const r = spawnSync(process.execPath,
    [join(dirname(fileURLToPath(import.meta.url)), 'solve.js'), '--puzzle', PUZZLE],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /backtrack limit is required/);
});

logSuiteComplete('Debug tools smoke');
