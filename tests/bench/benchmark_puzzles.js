// benchmark_puzzles.js — run puzzles through the solver and report search counters.
//
// The general "how hard is this / did my change move the search" tool. Solves
// one or more puzzles under an explicit backtrack budget and prints solver
// counters (solutions, guesses, backtracks, nodes) plus wall time.
//
// Usage:
//   node tests/bench/benchmark_puzzles.js --max-backtracks <n|none> [options]
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
//   --solutions <n|all>   How many solutions to search for. Default 2 = proof of
//                         uniqueness (status "unique" once the search exhausts
//                         finding only one; "multiple" if a 2nd exists). "all"
//                         exhausts/counts every solution. "1" is first-solution
//                         only — not valid evidence for an optimization (warns).
//   --ablate <a,b,...>    Disable named optimizations for the run (see --list-ablations).
//   --compare <a,b,...>   Run a baseline AND each ablation, printing a "vs-base"
//                         guess ratio (>1 ⇒ the feature was reducing search).
//   --repeat <n>          Re-solve n times and report the best wall time as `ms`,
//                         plus `median` and `max` columns showing the spread (node
//                         counts are deterministic; only timing is noisy). Default 1.
//   --json                Emit a JSON array of result rows instead of TSV — a
//                         stable, machine-readable contract for tooling (e.g.
//                         bench_vs_ref.js). Each row: { puzzle, status, solutions,
//                         guesses, backtracks, nodesSearched, ms, msMedian, msMax }
//                         (+ vsBase under --compare).
//   --list-ablations      Print the available ablations and exit.
//   -h, --help            Print this help and exit.
//
// Examples:
//   node tests/bench/benchmark_puzzles.js --max-backtracks none --puzzles "Count Different"
//   node tests/bench/benchmark_puzzles.js --max-backtracks 50000 --puzzles "ladder:Chaos Construction"
//   node tests/bench/benchmark_puzzles.js --max-backtracks none --puzzles "Chaos Construction" \
//       --compare chaos-hidden-singles

import {
  resolvePuzzles, parseBacktrackLimit, parseSolutionLimit, warnIfFirstSolution,
  runSolve, applyAblations, validateAblations, ABLATIONS,
} from './solver_analysis.js';

const parseList = (value) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean);

const parseArgs = (argv) => {
  const args = {
    maxBacktracksRaw: undefined, puzzles: ['Chaos Construction'], solutionsRaw: undefined,
    ablate: [], compare: [], repeat: 1, help: false, listAblations: false, json: false,
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
      case '--ablate': args.ablate = parseList(next()); break;
      case '--compare': args.compare = parseList(next()); break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
};

const usage = () => console.log(
  /* keep in sync with the header comment */
  `Usage: node tests/bench/benchmark_puzzles.js --max-backtracks <n|none> [options]\n\n` +
  `  --max-backtracks <n|none>  REQUIRED. Backtrack cap per solve; "none" = unlimited.\n` +
  `  --puzzles <a,b,...>        Names / collections / ladder:<name>. Default: "Chaos Construction".\n` +
  `  --input <string>           Solve a raw constraint string.\n` +
  `  --solutions <n|all>        Default 2 = prove uniqueness; "all" exhausts; "1" = first only (warns).\n` +
  `  --ablate <a,b,...>         Disable optimizations for the run.\n` +
  `  --compare <a,b,...>        Baseline vs each ablation (prints guess ratio).\n` +
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

// A result row as a plain object — the shared shape for both TSV and JSON output.
// `vsBase` is only present under --compare.
const toRow = (r, label, vsBase) => {
  const s = r.msStats ?? { min: r.elapsedMs, median: r.elapsedMs, max: r.elapsedMs };
  const row = {
    puzzle: r.name + (label ? ` [${label}]` : ''),
    status: r.status,
    solutions: r.counters.solutions,
    guesses: r.counters.guesses,
    backtracks: r.counters.backtracks,
    nodesSearched: r.counters.nodesSearched,
    ms: Number(r.elapsedMs.toFixed(1)),
    msMedian: Number(s.median.toFixed(1)),
    msMax: Number(s.max.toFixed(1)),
  };
  if (vsBase !== undefined) row.vsBase = vsBase;
  return row;
};

// `ms` is the best (min) time; `median`/`max` show the spread across --repeat runs.
const COLUMNS = ['puzzle', 'status', 'sols', 'guesses', 'backtracks', 'nodes', 'ms', 'median', 'max'];
// Columns 0 (puzzle) and 1 (status) read as text, left-justified; the rest are
// numbers, right-justified so digits line up.
const LEFT_COLS = new Set([0, 1]);

const rowCells = (row) => {
  const cells = [row.puzzle, row.status, String(row.solutions), String(row.guesses),
    String(row.backtracks), String(row.nodesSearched), row.ms.toFixed(1),
    row.msMedian.toFixed(1), row.msMax.toFixed(1)];
  if (row.vsBase !== undefined) cells.push(row.vsBase);
  return cells;
};

// Render rows as a space-aligned table. The puzzle column is variable-width, so
// we size every column from the data (header + all rows) — which is why output
// is buffered until the run completes rather than streamed line by line. --json
// is the machine-readable contract; this is purely the human view.
const renderTable = (headerCols, rows) => {
  const matrix = [headerCols, ...rows.map(rowCells)];
  const widths = headerCols.map((_, c) => Math.max(...matrix.map((cells) => (cells[c] ?? '').length)));
  const formatRow = (cells) => cells
    .map((cell, c) => LEFT_COLS.has(c) ? (cell ?? '').padEnd(widths[c]) : (cell ?? '').padStart(widths[c]))
    .join('  ')
    .trimEnd();
  return matrix.map(formatRow).join('\n');
};

const main = () => {
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
  const repeat = Number.isInteger(args.repeat) && args.repeat > 0 ? args.repeat : 1;
  const puzzles = resolvePuzzles(args.puzzles);
  const budgets = { maxBacktracks, maxSolutions };

  // Buffer rows; render the aligned table (or JSON) once the run completes.
  const rows = [];
  const headerCols = args.compare.length ? [...COLUMNS, 'vs-base'] : COLUMNS;
  const emit = (row) => { rows.push(row); };

  if (args.compare.length) {
    for (const puzzle of puzzles) {
      const base = bestOf(repeat, () => runSolve(puzzle, budgets));
      emit(toRow(base, '', '1.00'));
      for (const name of args.compare) {
        const restore = applyAblations([name]);
        try {
          const ablated = bestOf(repeat, () => runSolve(puzzle, budgets));
          const ratio = (ablated.counters.guesses / Math.max(1, base.counters.guesses)).toFixed(2);
          emit(toRow(ablated, `-${name}`, ratio));
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
  else console.log(renderTable(headerCols, rows));
};

try {
  main();
} catch (e) {
  console.error(`error: ${e.message}\n(run with --help for usage)`);
  process.exit(1);
}
