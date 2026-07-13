// Smoke test for the tools/debug CLI tools.
//
// These tools instrument solver internals (e.g. the candidate selector's return
// geometry), so they break silently when an internal API changes — this catches
// that drift. Each tool exports `main(argv)` and throws on failure, so the tests
// run them IN-PROCESS: the heavy solver + collections module graph loads once
// (when this file imports the tools), and each case is a cheap call. Adding a
// case costs ~nothing — no per-test subprocess startup. Only two tests spawn a
// subprocess, and both do so for a reason the in-process path can't cover: the
// --dump-state | --input - pipe (real stdin + the stdout/stderr split), and the
// CLI exit-code contract (the throw -> process.exit mapping). The latter spawns
// a lightweight fixture that imports only cli_entry.js, so it pays node startup
// but not the solver module graph.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { main as solveMain } from '../../tools/debug/solve.js';
import { main as verifyMain } from '../../tools/debug/verify_solution.js';
import { main as stepMain } from '../../tools/debug/step_analysis.js';
import { main as hotspotsMain } from '../../tools/debug/search_hotspots.js';
import { main as traceMain } from '../../tools/debug/decision_trace.js';
import { main as sandboxMain } from '../../tools/debug/run_sandbox.js';
import {
  injectSolutionGivens, injectSolutionGivensForGroup,
} from '../../tools/lib/puzzle_runner.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// The debug CLIs live in tools/debug/; this test lives under tests/.
const DEBUG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'debug');

const PUZZLE = 'Chaos Construction: 6x6'; // tiny chaos puzzle: ~30 guesses, has var cells

// A classic (no var cells) with a known full solution, for verify_solution.js.
const VERIFY_PUZZLE = 'Anti-knights move';
const VERIFY_SOLUTION =
  '536241897978536241421879635613485972789623514245917368357198426892764153164352789';
const argv = (script, ...args) => ['node', script, ...args];

// Run a tool's main() with output captured and any throw caught. Captures
// console.log (stdout), console.error (stderr), and direct process.stdout.write
// (used by --dump-state to emit the bare constraint string). Async because the
// tool mains are async (they may run a sandbox script to materialize a puzzle);
// tests run sequentially, so the global console swap is never contended.
const capture = async (fn) => {
  const out = [], err = [];
  const { log, error } = console;
  const stdoutWrite = process.stdout.write;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.stdout.write = (s) => { out.push(String(s).replace(/\n+$/, '')); return true; };
  let thrown = null;
  try { await fn(); } catch (e) { thrown = e; } finally {
    Object.assign(console, { log, error });
    process.stdout.write = stdoutWrite;
  }
  return { stdout: out.join('\n'), stderr: err.join('\n'), thrown };
};

await runTest('solve.js prints a solution', async () => {
  const { stdout, thrown } = await capture(() =>
    solveMain(argv('solve.js', '--max-backtracks', '5000', '--puzzle', PUZZLE)));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /Solution 1/);
});

await runTest('solve.js requires an explicit --max-backtracks', async () => {
  const { thrown } = await capture(() => solveMain(argv('solve.js', '--puzzle', PUZZLE)));
  assert.match(thrown?.message ?? '', /backtrack limit is required/);
});

await runTest('verify_solution.js accepts the correct solution', async () => {
  const { stdout, thrown } = await capture(() =>
    verifyMain(argv('verify_solution.js', '--puzzle', VERIFY_PUZZLE, '--solution', VERIFY_SOLUTION)));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /Result: ACCEPTED/);
  assert.match(stdout, /Backtracks: \d+ \(cap 1\)/);
});

await runTest('verify_solution.js accepts an explicit backtrack cap', async () => {
  const { stdout, thrown } = await capture(() =>
    verifyMain(argv('verify_solution.js', '--puzzle', VERIFY_PUZZLE, '--solution', VERIFY_SOLUTION,
      '--max-backtracks', '5')));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /Backtracks: \d+ \(cap 5\)/);
  assert.match(stdout, /Result: ACCEPTED/);
});

await runTest('verify_solution.js rejects a wrong solution with the default cap', async () => {
  const wrong = '6' + VERIFY_SOLUTION.slice(1); // duplicate a digit in row 1 → conflict
  const { stdout, thrown } = await capture(() =>
    verifyMain(argv('verify_solution.js', '--puzzle', VERIFY_PUZZLE, '--solution', wrong)));
  assert.match(thrown?.message ?? '', /rejected/);
  assert.match(stdout, /Backtracks: \d+ \(cap 1\)/);
  assert.match(stdout, /Result: REJECTED/);
});

await runTest('verify_solution.js rejects a wrong solution with an explicit cap', async () => {
  const wrong = '6' + VERIFY_SOLUTION.slice(1); // duplicate a digit in row 1 → conflict
  const { stdout, thrown } = await capture(() =>
    verifyMain(argv('verify_solution.js', '--puzzle', VERIFY_PUZZLE, '--solution', wrong,
      '--max-backtracks', '5')));
  assert.match(thrown?.message ?? '', /rejected/);
  assert.match(stdout, /Backtracks: \d+ \(cap 5\)/);
  assert.match(stdout, /Result: REJECTED/);
});

// --solution-group pins the answer onto a named cell group rather than the main
// grid, for puzzles the grid cannot hold. The fixture is that shape in miniature:
// a placeholder 1x1 grid whose real cells are the four-cell Var group VX.
// The injector's own rules are unit-tested below; this only checks the CLI wires
// the flag through to a real accept/reject.
const GROUP_PUZZLE = '.Shape~1x1~4.Var~X~Test~4.AllDifferent~VX1~VX2~VX3~VX4';

await runTest('verify_solution.js --solution-group pins the answer onto the group', async () => {
  const good = await capture(() =>
    verifyMain(argv('verify_solution.js', '--input', GROUP_PUZZLE,
      '--solution', '1234', '--solution-group', 'VX')));
  assert.equal(good.thrown, null, good.thrown?.message);
  assert.match(good.stdout, /Result: ACCEPTED/);

  // A repeat breaks the group's AllDifferent, so the pin must actually bind.
  const bad = await capture(() =>
    verifyMain(argv('verify_solution.js', '--input', GROUP_PUZZLE,
      '--solution', '1134', '--solution-group', 'VX')));
  assert.match(bad.thrown?.message ?? '', /rejected/);
  assert.match(bad.stdout, /Result: REJECTED/);
});

await runTest('injectSolutionGivens takes the grid dims from the puzzle, not sqrt(length)', () => {
  // 4x6 is not square, so a sqrt(length) reading would mis-shape it (or refuse).
  const givens = injectSolutionGivens('.Shape~4x6', '123456'.repeat(4));
  assert.match(givens, /\.~R1C1_1/);
  assert.match(givens, /\.~R1C6_6/);   // 6 columns, not sqrt(24)
  assert.match(givens, /\.~R4C6_6/);   // 4 rows
  assert.equal(givens.match(/\.~R/g).length, 24);

  assert.throws(() => injectSolutionGivens('.Shape~4x6', '12345'),
    /5 chars but the grid is 4x6/);
});

await runTest("injectSolutionGivens leaves '.' cells unpinned", () => {
  // An irregular grid modelled inside a rectangular Shape has holes: those cells
  // are not part of the answer and must not be pinned as givens.
  const givens = injectSolutionGivens('.Shape~4x6', '..3456' + '123456'.repeat(3));
  assert.doesNotMatch(givens, /\.~R1C1_/);
  assert.doesNotMatch(givens, /\.~R1C2_/);
  assert.match(givens, /\.~R1C3_3/);
  assert.equal(givens.match(/\.~R/g).length, 22);
});

// The injector is a pure string transform: test it directly rather than paying
// for a solver build per case.
await runTest('injectSolutionGivensForGroup maps digits onto the group in order', () => {
  const input = injectSolutionGivensForGroup(GROUP_PUZZLE, '1234', 'VX');
  assert.equal(input, GROUP_PUZZLE + '.~VX1_1.~VX2_2.~VX3_3.~VX4_4');
});

await runTest('injectSolutionGivensForGroup rejects a bad group or size', () => {
  // `new Var('X', ...)` makes the group VX, so a bare 'X' is the predictable
  // slip: it must name the real groups, not silently pin nothing.
  assert.throws(
    () => injectSolutionGivensForGroup(GROUP_PUZZLE, '1234', 'X'),
    /unknown cell group 'X'.*VX/);
  // The group must BE the answer: a size mismatch would otherwise map the
  // solution onto the wrong cells.
  assert.throws(
    () => injectSolutionGivensForGroup(GROUP_PUZZLE, '123', 'VX'),
    /has 4 cells but the solution has 3 digits/);
});

// One call exercises the whole step-inspection surface: the walk table, the
// candidate-selector instrumentation (--explain, the path that silently broke
// when _selectBestCandidate changed geometry), pencilmarks/var cells, and the
// per-step propagation log (--log).
await runTest('step_analysis.js walk + explain + grid + vars + log', async () => {
  const { stdout, thrown } = await capture(() => stepMain(argv('step_analysis.js',
    '--puzzle', PUZZLE, '--steps', '2', '--explain', '--grid', '--vars', '--log')));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /step\tguess/);
  assert.match(stdout, /Explain step/);
  assert.match(stdout, /Pencilmarks at step 2/);
  assert.match(stdout, /Extra \(var\) cells/);
  assert.match(stdout, /Constraint propagation at step 2/);
});

// --dump-state must write ONLY the constraint string to stdout (human output to
// stderr), and that string must parse and re-propagate.
await runTest('step_analysis.js --dump-state round-trips', async () => {
  const dump = await capture(() => stepMain(argv('step_analysis.js', '--puzzle', PUZZLE, '--steps', '4', '--dump-state')));
  assert.equal(dump.thrown, null, dump.thrown?.message);
  const stateString = dump.stdout.trim();
  assert.ok(stateString.startsWith('.'), `expected a bare constraint on stdout, got: ${JSON.stringify(stateString)}`);
  assert.equal(stateString.split('\n').length, 1, 'stdout must be a single constraint line');
  assert.match(dump.stderr, /state at step 4/);  // the human summary went to stderr
  const back = await capture(() => stepMain(argv('step_analysis.js', '--input', stateString, '--steps', '2')));
  assert.equal(back.thrown, null, back.thrown?.message);
});

// The pipe contract: --dump-state | --input - (reading the constraint from stdin).
// Subprocess because it exercises real stdin + the stdout/stderr split.
await runTest('step_analysis.js --dump-state | --input - pipe', () => {
  const script = join(DEBUG_DIR, 'step_analysis.js');
  const dump = spawnSync(process.execPath, [script, '--puzzle', PUZZLE, '--steps', '4', '--dump-state'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(dump.status, 0, dump.stderr);
  assert.equal(dump.stdout.trim().split('\n').length, 1, 'dump stdout must be one clean line');
  const back = spawnSync(process.execPath, [script, '--input', '-', '--steps', '2'],
    { input: dump.stdout, encoding: 'utf8', timeout: 60000 });
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /step\tguess/);
});

await runTest('step_analysis.js --compare <ablation> runs', async () => {
  const { stdout, thrown } = await capture(() => stepMain(argv('step_analysis.js',
    '--puzzle', PUZZLE, '--steps', '8', '--compare', 'chaos-bottlenecks')));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /Compare vs --ablate chaos-bottlenecks/);
});

await runTest('step_analysis.js --compare rejects an unknown ablation', async () => {
  const { thrown } = await capture(() => stepMain(argv('step_analysis.js', '--puzzle', PUZZLE, '--compare', 'nonexistent')));
  assert.match(thrown?.message ?? '', /unknown ablation/);
});

await runTest('search_hotspots.js runs', async () => {
  const { stdout, thrown } = await capture(() =>
    hotspotsMain(argv('search_hotspots.js', '--max-backtracks', '5000', '--puzzle', PUZZLE)));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /CONFLICT/);
  assert.match(stdout, /BRANCH FACTOR/);
  assert.match(stdout, /PROPAGATION YIELD/);
});

await runTest('search_hotspots.js requires --max-backtracks', async () => {
  const { thrown } = await capture(() => hotspotsMain(argv('search_hotspots.js', '--puzzle', PUZZLE)));
  assert.match(thrown?.message ?? '', /backtrack limit is required/);
});

await runTest('decision_trace.js exports then self-replays exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iss-trace-'));
  const traceFile = join(dir, 'trace.ndjson');
  try {
    const exp = await capture(() => traceMain(argv('decision_trace.js',
      '--max-backtracks', 'none', '--puzzle', PUZZLE, '--out', traceFile)));
    assert.equal(exp.thrown, null, exp.thrown?.message);

    // Self-replay reproduces the run exactly: 100% guided, no divergence.
    const rep = await capture(() => traceMain(argv('decision_trace.js',
      '--max-backtracks', 'none', '--puzzle', PUZZLE, '--replay', traceFile)));
    assert.equal(rep.thrown, null, rep.thrown?.message);
    assert.match(rep.stdout, /status=unique/);
    assert.match(rep.stdout, /guided=\d+ \(100\.0%, 0 overriding/);
    assert.match(rep.stdout, /diverged=0/);

    // Replaying under a selection-only ablation stays sound (finds the unique
    // solution) — a forced order can never turn a SAT puzzle UNSAT.
    const abl = await capture(() => traceMain(argv('decision_trace.js',
      '--max-backtracks', 'none', '--puzzle', PUZZLE, '--ablate', 'demote-off', '--replay', traceFile)));
    assert.equal(abl.thrown, null, abl.thrown?.message);
    assert.match(abl.stdout, /status=unique/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await runTest('run_sandbox.js falls back to stdout when --output write fails', async () => {
  const { stdout, stderr, thrown } = await capture(() => sandboxMain(argv('run_sandbox.js',
    '--code', 'return [new Shape("6x6"), new Given("R1C1", 3)];',
    '--output', '/definitely-missing-dir/out.iss')));
  assert.equal(thrown, null, thrown?.message);
  assert.match(stderr, /could not write --output/);
  assert.match(stderr, /printing generated constraint string to stdout/);
  assert.match(stdout.trim(), /^\.Shape~6x6/);
  assert.match(stdout.trim(), /\.~R1C1_3/);
});

await runTest('run_sandbox.js rejects output that fails to build', async () => {
  // A count=1 Var group gets the bare-prefix id ('VM'), so 'VM1' is invalid —
  // the round-trip build must surface that here, not in a downstream tool.
  const { thrown } = await capture(() => sandboxMain(argv('run_sandbox.js',
    '--code', 'return [new Shape("9x9"), new Var("M", "m", 1), new WhiteDot("VM1", "R1C1")];')));
  assert.match(thrown?.message, /fails to build: Invalid cell ID: VM1/);
});

// The shared CLI entry maps a thrown error to a non-zero exit with a clean
// message (the contract scripts/CI rely on). Spawns a lightweight fixture that
// imports only cli_entry.js — no solver module graph — so it stays cheap.
await runTest('CLI entry exits non-zero on error', () => {
  const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'cli_entry_throw_fixture.js');
  const r = spawnSync(process.execPath, [fixture], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fixture: intentional failure/);
  assert.match(r.stderr, /run with --help for usage/);
});

logSuiteComplete('Debug tools smoke');
