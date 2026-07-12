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
import { main as lintScriptMain } from '../../tools/dev/lint_sandbox_script.js';
import { main as lintConstraintsMain } from '../../tools/dev/lint_constraints.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// The lint tools are guidance heuristics; these cases pin the rules most
// prone to false positives (name-based helper detection, adjacency-gated
// native-relation suggestions) alongside one true positive each.
const lintCase = async (main, script, name, content, ...extraArgs) => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-test-'));
  const file = join(dir, name);
  writeFileSync(file, content);
  try {
    return await capture(() => main(argv(script, ...extraArgs, file)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const SCRIPT_HEADER = `// Title: t\n// Author: a\n// Video: v\n// Source: s\n// Rules prose.\n`;

await runTest('lint_sandbox_script.js passes idiomatic helpers', async () => {
  // "Marking" contains "king"; a graph.step alias contains "neighbour" —
  // neither is a custom helper.
  const { stdout, thrown } = await lintCase(lintScriptMain, 'lint_sandbox_script.js', 's.js',
    SCRIPT_HEADER
    + 'function wolfAwareMarking(cells) { return cells; }\n'
    + 'const leftNeighbour = graph.step(cell, 0, -1);\n'
    + "return [new Shape('6x6'), new Given('R1C1', 3)];\n");
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /: OK/);
});

await runTest('lint_sandbox_script.js flags numValues/Shape mismatch and id templates', async () => {
  const { stdout, thrown } = await lintCase(lintScriptMain, 'lint_sandbox_script.js', 's.js',
    SCRIPT_HEADER
    + 'const key = Pair.fnToKey((a, b) => a < b, 9);\n'
    + 'const cells = [1, 2, 3].map(r => `R${r}C1`);\n'
    + "return [new Shape('6x6'), new Pair(key, 'x', ...cells)];\n");
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /num-values-mismatch/);
  assert.match(stdout, /manual-cell-id-template/);
});

await runTest('lint_sandbox_script.js flags idioms superseded by houses/Var APIs', async () => {
  const { stdout, thrown } = await lintCase(lintScriptMain, 'lint_sandbox_script.js', 's.js',
    SCRIPT_HEADER
    + 'const wolf = b => `VW${b}`;\n'
    + 'const cells = graph.row(makeCellId(4, 1));\n'
    + 'const origins = [1, 4, 7];\n'
    + "return [new Shape('9x9')];\n");
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /manual-var-id-template/);
  assert.match(stdout, /manual-house-lookup/);
  assert.match(stdout, /manual-box-arithmetic/);
});

await runTest('lint_constraints.js suggests native constraints per key group', async () => {
  // The native suggestion fires only when EVERY Pair sharing the key is a
  // 2-cell adjacent pair — a partial replacement would split one drawn rule
  // into two constraint types.
  const consecutiveKey = 'CoAKgCoAKgCoAC';
  const allAdjacent = await lintCase(lintConstraintsMain, 'lint_constraints.js', 'c.iss',
    `.Pair~${consecutiveKey}~_a~R1C1~R1C2\n`
    + `.Pair~${consecutiveKey}~_b~R4C4~R5C4\n`
    + '.Sum~0_=_1_1_-1~R5C1~R5C2~R6C1\n');
  assert.equal(allAdjacent.thrown, null, allAdjacent.thrown?.message);
  assert.match(allAdjacent.stdout, /pair-native-relation.*2 Pair constraints re-encode WhiteDot/);
  assert.match(allAdjacent.stdout, /sum-equal-sum/);

  const mixedGroup = await lintCase(lintConstraintsMain, 'lint_constraints.js', 'c.iss',
    `.Pair~${consecutiveKey}~_a~R1C1~R1C2\n`
    + `.Pair~${consecutiveKey}~_b~R1C1~R3C3\n`);
  assert.equal(mixedGroup.thrown, null, mixedGroup.thrown?.message);
  assert.doesNotMatch(mixedGroup.stdout, /pair-native-relation/);
});

await runTest('lint_constraints.js --script runs inputs through the sandbox', async () => {
  const { stdout, thrown } = await lintCase(lintConstraintsMain, 'lint_constraints.js', 's.js',
    "return [new Shape('9x9'), new Sum('0_=_1_1_-1', 'R5C1', 'R5C2', 'R6C1')];\n",
    '--script');
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /sum-equal-sum/);
});

await runTest('lint_constraints.js flags redundancy and duplicates', async () => {
  const { stdout, thrown } = await lintCase(lintConstraintsMain, 'lint_constraints.js', 'c.iss',
    '.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n'
    + '.WhiteDot~R2C1~R2C2\n'
    + '.WhiteDot~R2C1~R2C2\n');
  assert.equal(thrown, null, thrown?.message);
  assert.match(stdout, /redundant-all-different.*row 1/);
  assert.match(stdout, /duplicate-constraint/);
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
