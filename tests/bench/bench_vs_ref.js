// bench_vs_ref.js — A/B the working tree against a baseline git revision.
//
// benchmark_puzzles.js only A/Bs *within* one code version (ablations patch a
// prototype at runtime). To compare two code versions you must run each version
// in its own process from its own checkout. This runs the SAME workload twice:
// once against the working tree, once against a clean checkout of <ref> (via a
// throwaway git worktree), then reports per-puzzle the wall-time delta AND any
// change in the search counters.
//
// Two ways to read the result:
//   - Behaviour-preserving refactor: you expect the counters to stay identical
//     and only wall time to move. Pass --require-identical to turn any counter
//     change into a hard failure (a CI-style gate). When counters are identical a
//     `capped` run is a valid timing harness — same work on both sides.
//   - Intentional change (a heuristic/propagation tweak): the counters are
//     *meant* to move. The default just reports the deltas; the per-puzzle guess
//     ratio shows how the search shifted. Note the wall-time ratio then compares
//     *different* work, so read total ms as an end-to-end number, not a
//     like-for-like speedup.
//
// Seam: this consumes benchmark_puzzles.js `--json` (a stable, machine-readable
// contract) rather than scraping its human TSV. For a baseline <ref> old enough
// to predate --json it falls back to parsing TSV columns, so it still works
// against historical revisions.
//
// Usage:
//   node tests/bench/bench_vs_ref.js [--ref <git-ref>] [--require-identical] <benchmark_puzzles args...>
//
//   --ref <git-ref>      Baseline to compare against. Default: HEAD.
//   --require-identical  Fail (exit 1) if any search counter differs.
//   everything else      Passed through verbatim to benchmark_puzzles.js, so all
//                        of its flags work (--max-backtracks, --puzzles, --input,
//                        --solutions, --repeat, ...).
//
// Examples:
//   node tests/bench/bench_vs_ref.js --max-backtracks none --puzzles TAREK_ALL --repeat 5
//   node tests/bench/bench_vs_ref.js --ref main --max-backtracks 200000 --solutions all \
//       --input "................................................................................." --repeat 5

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'tests/bench/benchmark_puzzles.js';

const parseArgs = (argv) => {
  let ref = 'HEAD';
  let requireIdentical = false;
  const passthrough = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--ref') { ref = argv[++i]; continue; }
    if (argv[i] === '--require-identical') { requireIdentical = true; continue; }
    if (argv[i] === '-h' || argv[i] === '--help') { return { help: true }; }
    passthrough.push(argv[i]);
  }
  return { ref, requireIdentical, passthrough };
};

const usage = () => console.log(
  `Usage: node tests/bench/bench_vs_ref.js [--ref <git-ref>] [--require-identical] <benchmark_puzzles args...>\n\n` +
  `  --ref <git-ref>      Baseline revision to compare the working tree against (default HEAD).\n` +
  `  --require-identical  Fail if any search counter differs (behaviour-preserving gate).\n` +
  `  <rest>               Forwarded to ${SCRIPT} (--max-backtracks is still required).\n\n` +
  `Reports the per-puzzle wall-time delta and any change in search counters.`);

// The comparable search counters (ms is excluded — it is what we measure).
const COUNTERS = ['status', 'solutions', 'guesses', 'backtracks', 'nodesSearched'];

// Normalise a row's counters (types coerced so a JSON row and a TSV row compare
// equal).
const normCounters = (row) => ({
  status: String(row.status),
  solutions: Number(row.solutions),
  guesses: Number(row.guesses),
  backtracks: Number(row.backtracks),
  nodesSearched: Number(row.nodesSearched),
});

const countersEqual = (a, b) => COUNTERS.every((k) => a[k] === b[k]);

// Compact description of which counters changed, e.g. "nodesSearched 100→80".
const countersDiff = (a, b) =>
  COUNTERS.filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]}→${b[k]}`).join(' ');

// Parse benchmark_puzzles.js TSV (fallback for refs predating --json). The
// column order is fixed by benchmark_puzzles' TSV_COLUMNS.
const parseTsv = (out) => {
  const lines = out.trim().split('\n');
  const header = lines[0].split('\t');
  const idx = (name) => header.indexOf(name);
  const [pi, si, soli, gi, bi, ni] =
    ['puzzle', 'status', 'sols', 'guesses', 'backtracks', 'nodes'].map(idx);
  const mi = idx('ms');
  return lines.slice(1).map((line) => {
    const f = line.split('\t');
    return {
      puzzle: f[pi], status: f[si], solutions: f[soli], guesses: f[gi],
      backtracks: f[bi], nodesSearched: f[ni], ms: f[mi],
    };
  });
};

// Run benchmark_puzzles.js in `cwd` and return rows keyed by puzzle, each with a
// normalised counter key and ms. Prefers --json; falls back to TSV if the ref's
// benchmark_puzzles is too old to know that flag.
const run = (cwd, passthrough) => {
  const exec = (extra) => execFileSync('node', [SCRIPT, ...extra, ...passthrough], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    // Capture child stderr (don't inherit) so the --json probe against an old
    // ref doesn't leak its "unknown argument" message to our terminal.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let rows;
  try {
    rows = JSON.parse(exec(['--json']));
  } catch {
    // Either the ref predates --json, or the run failed. Retry plain TSV; if that
    // also fails, surface a concise message (not the child's whole stack trace).
    try {
      rows = parseTsv(exec([]));
    } catch (e) {
      const stderr = (e.stderr || '').toString().trim().split('\n').slice(-3).join('\n');
      throw new Error(`benchmark_puzzles.js failed in ${cwd}:\n${stderr || e.message}`);
    }
  }
  const map = new Map();
  for (const row of rows) map.set(row.puzzle, { counters: normCounters(row), ms: Number(row.ms) });
  return map;
};

const main = () => {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }

  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const refSha = execFileSync('git', ['rev-parse', '--short', args.ref], { cwd: root, encoding: 'utf8' }).trim();

  // The baseline must contain the benchmark harness — bench_vs_ref runs the ref's
  // own copy of benchmark_puzzles.js. Fail clearly if the ref predates it.
  try {
    execFileSync('git', ['cat-file', '-e', `${args.ref}:${SCRIPT}`], { cwd: root, stdio: 'ignore' });
  } catch {
    console.error(`error: ${args.ref} (${refSha}) does not contain ${SCRIPT} — ` +
      `bench_vs_ref needs the baseline revision to include the current benchmark harness.`);
    process.exit(1);
  }

  console.error(`baseline ref ${args.ref} (${refSha}) vs working tree`);

  // Materialise the baseline ref in a throwaway worktree so the comparison never
  // touches the working tree (which holds the change under test).
  const wt = mkdtempSync(join(tmpdir(), 'iss-bench-'));
  let base, head;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', wt, args.ref], { cwd: root });
    base = run(wt, args.passthrough);
    head = run(root, args.passthrough);
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root }); } catch { /* best effort */ }
    rmSync(wt, { recursive: true, force: true });
  }

  // Columns compare the working tree against the baseline ref:
  // `time` = tree/ref wall-time ratio; `guesses` = tree/ref search-size ratio
  // (1.000 when unchanged); `status` = ok, or which counters moved.
  console.log(['puzzle', 'ref_ms', 'tree_ms', 'time', 'guesses', 'status'].join('\t'));
  let changed = false, missing = false;
  let baseTotal = 0, headTotal = 0, baseGuesses = 0, headGuesses = 0;
  for (const [name, b] of base) {
    const h = head.get(name);
    if (!h) { console.log(`${name}\tMISSING in working-tree run`); missing = true; continue; }
    const eq = countersEqual(b.counters, h.counters);
    if (!eq) changed = true;
    baseTotal += b.ms; headTotal += h.ms;
    baseGuesses += b.counters.guesses; headGuesses += h.counters.guesses;
    const timeRatio = (h.ms / b.ms).toFixed(3);
    const guessRatio = (h.counters.guesses / Math.max(1, b.counters.guesses)).toFixed(3);
    console.log([name, b.ms.toFixed(1), h.ms.toFixed(1), timeRatio, guessRatio,
      eq ? 'ok' : countersDiff(b.counters, h.counters)].join('\t'));
  }
  console.log(['TOTAL', baseTotal.toFixed(1), headTotal.toFixed(1),
    (headTotal / baseTotal).toFixed(3),
    (headGuesses / Math.max(1, baseGuesses)).toFixed(3),
    changed ? 'COUNTERS CHANGED' : 'counters identical'].join('\t'));

  // A missing puzzle means the two runs aren't comparable — always a failure.
  if (missing) {
    console.error('\nFAIL: some puzzles were missing from the working-tree run.');
    process.exit(1);
  }

  if (changed) {
    if (args.requireIdentical) {
      console.error('\nFAIL: search counters differ, but --require-identical was set ' +
        '(expected a behaviour-preserving refactor).');
      process.exit(1);
    }
    console.error('\nNote: search counters changed between revisions, so the wall-time ratio ' +
      'compares different work — read total ms as an end-to-end number, not a like-for-like ' +
      'speedup. Pass --require-identical to treat any counter change as a failure.');
    return;
  }
  console.error(`\nratio < 1.0 ⇒ working tree is faster than ${args.ref} (${refSha}). ` +
    `tree/ref = ${(headTotal / baseTotal).toFixed(3)}`);
};

try {
  main();
} catch (e) {
  console.error(`error: ${e.message}\n(run with --help for usage)`);
  process.exit(1);
}
