// benchmark_puzzles.js — run puzzles through the solver and report search counters.
//
// The general "how hard is this / did my change move the search" tool. Solves
// one or more puzzles under an explicit backtrack budget and prints solver
// counters (solutions, guesses, backtracks, nodes) plus wall time.
//
// Usage:
//   node tools/perf/benchmark_puzzles.js --max-backtracks <n|none> [options]
//
// Required:
//   --max-backtracks <n|none>  Stop each solve after n backtracks. Use "none"
//                              for unlimited — but say so explicitly: an
//                              unbounded run on a hard puzzle can hang, and a
//                              run that hits the cap is reported as status
//                              "capped" so it is never mistaken for a real solve.
//
// Options:
//   --puzzles <a,b,...>   Puzzle names, collection names, and/or ladder selectors
//                         (ladder:<name>[@25-15-5]). Default: "Chaos Construction".
//   --input <string>      Solve a raw constraint string instead of named puzzles.
//   --input-file <path>   Solve a raw constraint string read from a file.
//   --solutions <n|all>   How many solutions to search for. Default 2 = proof of
//                         uniqueness (status "unique" once the search exhausts
//                         finding only one; "multiple" if a 2nd exists). "all"
//                         exhausts/counts every solution. "1" is first-solution
//                         only — not valid evidence for an optimization (warns).
//   --ablate <a,b,...>    Disable named optimizations for the run (see --list-ablations).
//   --compare <a,b,...>   Run a baseline AND each ablation, printing a "vs-base"
//                         guess ratio (>1 ⇒ the feature was reducing search) and,
//                         per ablation, a summary block: total guess/wall ratios,
//                         better/worse/flat counts, status changes (e.g. a run
//                         flipping capped <-> unique — always worth a look), and
//                         any solution mismatch (a soundness alarm). Totals only
//                         aggregate pairs where both sides completed; a capped
//                         side makes a pair incomparable.
//   --require-same-solutions
//                         Soundness gate for --compare: collect every solution on
//                         both sides and fail (exit 1) unless the solution sets
//                         are identical for every puzzle. Requires --solutions all
//                         (identity of a truncated enumeration proves nothing); a
//                         capped run also fails the gate as inconclusive.
//   --repeat <n>          Re-solve n times and report the best wall time as `ms`,
//                         plus `median` and `max` columns showing the spread (node
//                         counts are deterministic; only timing is noisy). Default 1.
//   --json                Emit a JSON array of result rows instead of TSV — a
//                         stable, machine-readable contract for tooling (e.g.
//                         bench_vs_ref.js). Each row: { puzzle, status, solutions,
//                         guesses, backtracks, searchedFraction, nodesSearched,
//                         ms, msMedian, msMax }. searchedFraction is the estimated
//                         share of the search tree resolved -- for a capped run,
//                         how close it came to exhausting the space.
//                         Under --compare each row also carries { variant, vsBase }
//                         (variant: null for the baseline row, else the ablation
//                         name; `puzzle` stays the bare puzzle name). Counters the
//                         engine doesn't define by default (added by experiment
//                         code, e.g. a `probes` counter) appear as { extra: {...} }
//                         — they also become table columns and per-ablation
//                         summary totals in the human view.
//   --list-ablations      Print the available ablations and exit.
//   -h, --help            Print this help and exit.
//
// Examples:
//   node tools/perf/benchmark_puzzles.js --max-backtracks none --puzzles "Count Different"
//   node tools/perf/benchmark_puzzles.js --max-backtracks 50000 --puzzles "ladder:Chaos Construction"
//   node tools/perf/benchmark_puzzles.js --max-backtracks none --puzzles "Chaos Construction" \
//       --compare chaos-hidden-singles

import {
  resolvePuzzles, materializePuzzles, parseBacktrackLimit, parseSolutionLimit,
  warnIfFirstSolution, runSolve, applyAblations, validateAblations, ABLATIONS,
  extraCounters,
  searchedFraction,
} from '../lib/solver_analysis.js';
import { readFileSync } from 'node:fs';

const parseList = (value) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean);

const parseArgs = (argv) => {
  const args = {
    maxBacktracksRaw: undefined, puzzles: ['Chaos Construction'], solutionsRaw: undefined,
    ablate: [], compare: [], repeat: 1, help: false, listAblations: false, json: false,
    requireSameSolutions: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split(/=(.*)/s);
    const next = () => inlineValue ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--json': args.json = true; break;
      case '--list-ablations': args.listAblations = true; break;
      case '--max-backtracks': args.maxBacktracksRaw = next(); break;
      case '--solutions': args.solutionsRaw = next(); break;
      case '--repeat': args.repeat = Number(next()); break;
      case '--puzzles': args.puzzles = parseList(next()); break;
      case '--input': args.puzzles = ['input:' + next()]; break;
      case '--input-file': args.puzzles = ['input:' + readFileSync(next(), 'utf8').trim()]; break;
      case '--ablate': args.ablate = parseList(next()); break;
      case '--compare': args.compare = parseList(next()); break;
      case '--require-same-solutions': args.requireSameSolutions = true; break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
};

const usage = () => console.log(
  /* keep in sync with the header comment */
  `Usage: node tools/perf/benchmark_puzzles.js --max-backtracks <n|none> [options]\n\n` +
  `  --max-backtracks <n|none>  REQUIRED. Backtrack cap per solve; "none" = unlimited.\n` +
  `  --puzzles <a,b,...>        Names / collections / ladder:<name>. Default: "Chaos Construction".\n` +
  `  --input <string>           Solve a raw constraint string.\n` +
  `  --input-file <path>        Solve a raw constraint string read from a file.\n` +
  `  --solutions <n|all>        Default 2 = prove uniqueness; "all" exhausts; "1" = first only (warns).\n` +
  `  --ablate <a,b,...>         Disable optimizations for the run.\n` +
  `  --compare <a,b,...>        Baseline vs each ablation (guess ratios + summary block).\n` +
  `  --require-same-solutions   With --compare + --solutions all: fail unless solution\n` +
  `                             sets are identical on every puzzle (soundness gate).\n` +
  `  --repeat <n>               Re-solve n times; report best (ms), median and max (default 1).\n` +
  `  --json                     Emit JSON rows instead of TSV (machine-readable).\n` +
  `  --list-ablations           List available ablations.\n` +
  `\nLadders: ladder:<puzzle name>[@25-15-5] reveals solution givens to grade any solved puzzle.`);

const median = (sorted) => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Run `fn` `repeat` times and annotate the result with the spread of wall times.
// `elapsedMs` stays the best (min) time — the headline number, and what
// bench_vs_ref consumes — while `msStats` exposes min / median / max so a warming
// or noisy run shows up instead of being silently hidden behind the min.
const bestOf = (repeat, fn) => {
  const times = [];
  let result;
  for (let i = 0; i < repeat; i++) { result = fn(); times.push(result.elapsedMs); }
  times.sort((a, b) => a - b);
  result.elapsedMs = times[0];
  result.msStats = { min: times[0], median: median(times), max: times[times.length - 1] };
  return result;
};

// A result row as a plain object — the shared geometry for both TSV and JSON output.
// `variant` and `vsBase` are only present under --compare: variant is null for the
// baseline row and the ablation name otherwise, and `puzzle` stays the bare puzzle
// name (the human table renders the variant as a name suffix; JSON consumers get
// it as a field instead of re-parsing the name).
const toRow = (r, variant, vsBase) => {
  const s = r.msStats ?? { min: r.elapsedMs, median: r.elapsedMs, max: r.elapsedMs };
  const row = {
    puzzle: r.name,
    status: r.status,
    solutions: r.counters.solutions,
    guesses: r.counters.guesses,
    backtracks: r.counters.backtracks,
    nodesSearched: r.counters.nodesSearched,
    // Significant digits, not fixed decimals: a hard puzzle can resolve 1e-9 of
    // its tree, which rounding to decimal places would report as a flat 0.
    searchedFraction: Number(searchedFraction(r.counters).toPrecision(6)),
    ms: Number(r.elapsedMs.toFixed(1)),
    msMedian: Number(s.median.toFixed(1)),
    msMax: Number(s.max.toFixed(1)),
  };
  const extra = extraCounters(r.counters);
  if (extra) row.extra = extra;
  if (variant !== undefined) row.variant = variant;
  if (vsBase !== undefined) row.vsBase = vsBase;
  return row;
};

// `ms` is the best (min) time; `median`/`max` show the spread across --repeat runs.
const COLUMNS = ['puzzle', 'status', 'sols', 'guesses', 'backtracks', 'nodes', 'ms', 'median', 'max'];
// Columns 0 (puzzle) and 1 (status) read as text, left-justified; the rest are
// numbers, right-justified so digits line up.
const LEFT_COLS = new Set([0, 1]);

// `extraNames` are experiment-added counter names (union across rows) rendered
// as additional numeric columns after the standard ones.
const rowCells = (row, extraNames) => {
  const puzzle = row.puzzle + (row.variant ? ` [-${row.variant}]` : '');
  const cells = [puzzle, row.status, String(row.solutions), String(row.guesses),
    String(row.backtracks), String(row.nodesSearched), row.ms.toFixed(1),
    row.msMedian.toFixed(1), row.msMax.toFixed(1)];
  for (const name of extraNames) cells.push(String(row.extra?.[name] ?? ''));
  if (row.vsBase !== undefined) cells.push(row.vsBase);
  return cells;
};

// Render rows as a space-aligned table. The puzzle column is variable-width, so
// we size every column from the data (header + all rows) — which is why output
// is buffered until the run completes rather than streamed line by line. --json
// is the machine-readable contract; this is purely the human view.
const renderTable = (headerCols, rows, extraNames) => {
  const matrix = [headerCols, ...rows.map((row) => rowCells(row, extraNames))];
  const widths = headerCols.map((_, c) => Math.max(...matrix.map((cells) => (cells[c] ?? '').length)));
  const formatRow = (cells) => cells
    .map((cell, c) => LEFT_COLS.has(c) ? (cell ?? '').padEnd(widths[c]) : (cell ?? '').padStart(widths[c]))
    .join('  ')
    .trimEnd();
  return matrix.map(formatRow).join('\n');
};

// --- Compare summary ----------------------------------------------------------

// Per-ablation aggregates over the (baseline, ablated) pairs. Totals and
// better/worse/flat counts only cover pairs where both sides completed: a capped
// run is an incomplete search, so its counters are not comparable. Status changes
// and solution mismatches are tracked for every pair — a status flip (especially
// capped <-> unique) is often the most interesting result of a comparison, and a
// solution mismatch on completed runs is a soundness alarm, not a perf result.
const newCompareStats = () => ({
  pairs: 0, completed: 0,
  baseGuesses: 0, ablatedGuesses: 0, baseMs: 0, ablatedMs: 0,
  better: 0, worse: 0, flat: 0,
  statusChanges: [], solutionMismatches: [], inconclusive: [],
  movers: [],
  extras: new Map(),  // extra counter name -> { base, ablated } totals
});

const accumulateCompareStats = (s, base, ablated) => {
  s.pairs++;
  if (base.status !== ablated.status) {
    s.statusChanges.push(`${base.name}: ${base.status} -> ${ablated.status}`);
  }
  if (base.capped || ablated.capped) {
    s.inconclusive.push(base.name);
    return;
  }
  s.completed++;
  s.baseGuesses += base.counters.guesses;
  s.ablatedGuesses += ablated.counters.guesses;
  s.baseMs += base.elapsedMs;
  s.ablatedMs += ablated.elapsedMs;

  const delta = ablated.counters.guesses - base.counters.guesses;
  if (delta > 0) s.worse++; else if (delta < 0) s.better++; else s.flat++;
  if (delta !== 0) s.movers.push({ name: base.name, delta });

  const baseExtra = extraCounters(base.counters);
  const ablatedExtra = extraCounters(ablated.counters);
  if (baseExtra || ablatedExtra) {
    for (const key of new Set(
      [...Object.keys(baseExtra ?? {}), ...Object.keys(ablatedExtra ?? {})])) {
      const totals = s.extras.get(key) ?? { base: 0, ablated: 0 };
      totals.base += baseExtra?.[key] ?? 0;
      totals.ablated += ablatedExtra?.[key] ?? 0;
      s.extras.set(key, totals);
    }
  }

  if (base.counters.solutions !== ablated.counters.solutions) {
    s.solutionMismatches.push(
      `${base.name}: ${base.counters.solutions} vs ${ablated.counters.solutions} solutions`);
  } else if (base.solutionSet && ablated.solutionSet &&
    base.solutionSet.join('|') !== ablated.solutionSet.join('|')) {
    s.solutionMismatches.push(`${base.name}: solution content differs`);
  } else if (!base.solutionSet && base.solution !== ablated.solution &&
    base.counters.solutions === 1 && ablated.counters.solutions === 1) {
    s.solutionMismatches.push(`${base.name}: solution content differs`);
  }
};

const TOP_MOVERS = 5;

const renderCompareSummary = (name, s) => {
  const ratio = (a, b) => b ? (a / b).toFixed(2) : '-';
  const lines = [`== summary vs [-${name}] ==`];
  const excluded = s.pairs - s.completed;
  lines.push(
    `completed-both pairs: ${s.completed} of ${s.pairs}` +
    (excluded ? ` (${excluded} excluded: a capped side)` : ''));
  lines.push(
    `total guesses: base=${s.baseGuesses} ablated=${s.ablatedGuesses}` +
    ` vs-base=${ratio(s.ablatedGuesses, s.baseGuesses)}`);
  lines.push(
    `total ms:      base=${s.baseMs.toFixed(1)} ablated=${s.ablatedMs.toFixed(1)}` +
    ` vs-base=${ratio(s.ablatedMs, s.baseMs)}`);
  lines.push(`ablated guesses: worse on ${s.worse}, better on ${s.better}, flat on ${s.flat}`);
  for (const [key, t] of [...s.extras].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`extra ${key}: base=${t.base} ablated=${t.ablated}`);
  }
  for (const change of s.statusChanges) lines.push(`status change: ${change}`);
  for (const mismatch of s.solutionMismatches) lines.push(`SOLUTION MISMATCH: ${mismatch}`);
  const movers = [...s.movers]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, TOP_MOVERS);
  if (movers.length) {
    lines.push('top guess movers: ' + movers.map(
      (m) => `${m.name} (${m.delta > 0 ? '+' : ''}${m.delta})`).join(', '));
  }
  return lines.join('\n');
};

const main = async () => {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  if (args.listAblations) {
    for (const [name, { description }] of Object.entries(ABLATIONS)) console.log(`${name}\t${description}`);
    return;
  }

  const maxBacktracks = parseBacktrackLimit(args.maxBacktracksRaw);
  const maxSolutions = parseSolutionLimit(args.solutionsRaw);
  warnIfFirstSolution(maxSolutions);
  validateAblations([...args.ablate, ...args.compare]);
  if (args.requireSameSolutions) {
    if (!args.compare.length) {
      throw new Error('--require-same-solutions only makes sense with --compare');
    }
    if (maxSolutions !== 0) {
      throw new Error(
        '--require-same-solutions requires --solutions all: identical prefixes of a ' +
        'truncated enumeration prove nothing about the full solution sets');
    }
  }
  const repeat = Number.isInteger(args.repeat) && args.repeat > 0 ? args.repeat : 1;
  const puzzles = await materializePuzzles(resolvePuzzles(args.puzzles));
  const budgets = { maxBacktracks, maxSolutions, collectSolutions: args.requireSameSolutions };

  // Buffer rows; render the aligned table (or JSON) once the run completes.
  const rows = [];
  const emit = (row) => { rows.push(row); };

  const compareStats = new Map(args.compare.map((name) => [name, newCompareStats()]));

  if (args.compare.length) {
    for (const puzzle of puzzles) {
      const base = bestOf(repeat, () => runSolve(puzzle, budgets));
      emit(toRow(base, null, '1.00'));
      for (const name of args.compare) {
        const restore = applyAblations([name]);
        try {
          const ablated = bestOf(repeat, () => runSolve(puzzle, budgets));
          const ratio = (ablated.counters.guesses / Math.max(1, base.counters.guesses)).toFixed(2);
          emit(toRow(ablated, name, ratio));
          accumulateCompareStats(compareStats.get(name), base, ablated);
        } finally { restore(); }
      }
    }
  } else {
    const restore = args.ablate.length ? applyAblations(args.ablate) : null;
    try {
      for (const puzzle of puzzles) emit(toRow(bestOf(repeat, () => runSolve(puzzle, budgets))));
    } finally { restore?.(); }
  }

  if (args.json) console.log(JSON.stringify(rows));
  else {
    // Extra (experiment-added) counters become columns; only known after the runs.
    const extraNames = [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))].sort();
    const headerCols = [
      ...COLUMNS, ...extraNames, ...(args.compare.length ? ['vs-base'] : [])];
    console.log(renderTable(headerCols, rows, extraNames));
    for (const [name, s] of compareStats) console.log('\n' + renderCompareSummary(name, s));
  }

  if (args.requireSameSolutions) {
    // The gate fails on any mismatch, and also on any capped pair — a truncated
    // search is inconclusive, not a pass.
    const failures = [];
    for (const [name, s] of compareStats) {
      for (const m of s.solutionMismatches) failures.push(`[-${name}] ${m}`);
      for (const p of s.inconclusive) {
        failures.push(`[-${name}] ${p}: capped — inconclusive; raise --max-backtracks`);
      }
    }
    if (failures.length) {
      console.error(`require-same-solutions: FAILED (${failures.length}):`);
      for (const f of failures) console.error(`  ${f}`);
      process.exitCode = 1;
    } else {
      console.error(`require-same-solutions: OK — solution sets identical across ` +
        `${puzzles.length} puzzle(s) x ${args.compare.length} ablation(s)`);
    }
  }
};

main().catch((e) => {
  console.error(`error: ${e.message}\n(run with --help for usage)`);
  process.exit(1);
});
