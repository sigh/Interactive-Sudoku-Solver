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
  `  --ref <git-ref>      Baseline revision to compare the current changes against (default HEAD).\n` +
  `  --require-identical  Fail if any search counter differs (behaviour-preserving gate).\n` +
  `  <rest>               Forwarded to ${SCRIPT} (--max-backtracks is still required).\n\n` +
  `Reports per puzzle the current/baseline time ratio on both the best (min) and\n` +
  `median time, plus any change in search counters. Use --repeat <n> for the median.`);

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

// Parse benchmark_puzzles.js tab-separated output (fallback for refs predating
// --json; those older revisions still emit real TSV). Columns are looked up by
// header name, so column order/additions don't matter.
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
  for (const row of rows) {
    map.set(row.puzzle, {
      counters: normCounters(row),
      // ms is the best (min) time. median/max come from benchmark_puzzles' new
      // spread fields; an older ref predating them reports only ms, so fall back
      // to it (median == max == min ⇒ that side contributes no spread signal).
      ms: Number(row.ms),
      median: Number(row.msMedian ?? row.ms),
      max: Number(row.msMax ?? row.ms),
    });
  }
  return map;
};

// Render rows as a space-aligned table (same approach as benchmark_puzzles): the
// named columns in `leftCols` are left-justified, the rest right-justified so
// numbers line up regardless of puzzle-name width.
const renderTable = (header, rows, leftCols) => {
  const matrix = [header, ...rows];
  const widths = header.map((_, c) => Math.max(...matrix.map((r) => (r[c] ?? '').length)));
  return matrix.map((r) => r
    .map((cell, c) => (leftCols.has(c) ? (cell ?? '').padEnd(widths[c]) : (cell ?? '').padStart(widths[c])))
    .join('  ').trimEnd()).join('\n');
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

  console.error(`current changes vs baseline ${args.ref} (${refSha})`);

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

  // One row per puzzle. ref_ms / cur_ms are the best (min) times for the baseline
  // and the current code; `min` and `med` are the current/ref ratios on the min
  // and median time; `guesses` is the search-size ratio; `status` is ok or which
  // counters moved.
  const header = ['puzzle', 'ref_ms', 'cur_ms', 'min', 'med', 'guesses', 'status'];
  const tableRows = [];
  let changed = false, missing = false;
  let baseSum = 0, headSum = 0, baseMedSum = 0, headMedSum = 0, baseGuesses = 0, headGuesses = 0;
  for (const [name, b] of base) {
    const h = head.get(name);
    if (!h) { tableRows.push([name, 'MISSING in current run']); missing = true; continue; }
    const eq = countersEqual(b.counters, h.counters);
    if (!eq) changed = true;
    baseSum += b.ms; headSum += h.ms;
    baseMedSum += b.median; headMedSum += h.median;
    baseGuesses += b.counters.guesses; headGuesses += h.counters.guesses;
    tableRows.push([
      name, b.ms.toFixed(1), h.ms.toFixed(1),
      (h.ms / b.ms).toFixed(3),
      (h.median / b.median).toFixed(3),
      (h.counters.guesses / Math.max(1, b.counters.guesses)).toFixed(3),
      eq ? 'ok' : countersDiff(b.counters, h.counters),
    ]);
  }
  // For multiple puzzles add a pooled row: times summed, ratios over those sums.
  if (base.size > 1) {
    tableRows.push([
      'all puzzles', baseSum.toFixed(1), headSum.toFixed(1),
      (headSum / baseSum).toFixed(3),
      (headMedSum / baseMedSum).toFixed(3),
      (headGuesses / Math.max(1, baseGuesses)).toFixed(3),
      changed ? 'COUNTERS CHANGED' : 'counters identical',
    ]);
  }
  console.log(renderTable(header, tableRows, new Set([0, header.length - 1])));

  // A missing puzzle means the two runs aren't comparable — always a failure.
  if (missing) {
    console.error('\nFAIL: some puzzles were missing from the current run.');
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
  const speed = (ratio) => ratio < 1
    ? `${((1 - ratio) * 100).toFixed(1)}% faster`
    : `${((ratio - 1) * 100).toFixed(1)}% slower`;
  const minRatio = headSum / baseSum;
  const medRatio = headMedSum / baseMedSum;
  console.error(`\ncurrent vs ${args.ref} (${refSha}): ${speed(minRatio)} on best time, ` +
    `${speed(medRatio)} on median.`);
};

try {
  main();
} catch (e) {
  console.error(`error: ${e.message}\n(run with --help for usage)`);
  process.exit(1);
}
