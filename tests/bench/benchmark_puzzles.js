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
//                         node ratio (>1 ⇒ the feature was reducing search).
//   --repeat <n>          Re-solve n times and report the best wall time (node
//                         counts are deterministic; only timing is noisy). Default 1.
//   --json                Emit a JSON array of result rows instead of TSV — a
//                         stable, machine-readable contract for tooling (e.g.
//                         bench_vs_ref.js). Each row: { puzzle, status, solutions,
//                         guesses, backtracks, nodesSearched, ms } (+ vsBase under
//                         --compare).
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
  `  --compare <a,b,...>        Baseline vs each ablation (prints node ratio).\n` +
  `  --repeat <n>               Best wall time over n runs (default 1).\n` +
  `  --json                     Emit JSON rows instead of TSV (machine-readable).\n` +
  `  --list-ablations           List available ablations.\n` +
  `\nLadders: ladder:<puzzle name>[@25-15-5] reveals solution givens to grade any solved puzzle.`);

const bestOf = (repeat, fn) => {
  let result, bestMs = Infinity;
  for (let i = 0; i < repeat; i++) { const r = fn(); if (r.elapsedMs < bestMs) bestMs = r.elapsedMs; result = r; }
  result.elapsedMs = bestMs;
  return result;
};

// A result row as a plain object — the shared shape for both TSV and JSON output.
// `vsBase` is only present under --compare.
const toRow = (r, label, vsBase) => {
  const row = {
    puzzle: r.name + (label ? ` [${label}]` : ''),
    status: r.status,
    solutions: r.counters.solutions,
    guesses: r.counters.guesses,
    backtracks: r.counters.backtracks,
    nodesSearched: r.counters.nodesSearched,
    ms: Number(r.elapsedMs.toFixed(1)),
  };
  if (vsBase !== undefined) row.vsBase = vsBase;
  return row;
};

const TSV_COLUMNS = ['puzzle', 'status', 'sols', 'guesses', 'backtracks', 'nodes', 'ms'];
const tsvLine = (row) => {
  const cells = [row.puzzle, row.status, row.solutions, row.guesses,
    row.backtracks, row.nodesSearched, row.ms.toFixed(1)];
  if (row.vsBase !== undefined) cells.push(row.vsBase);
  return cells.join('\t');
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

  // Collect rows for JSON; in TSV mode also stream each line as it completes.
  const rows = [];
  const header = args.compare.length ? [...TSV_COLUMNS, 'vs-base'] : TSV_COLUMNS;
  if (!args.json) console.log(header.join('\t'));
  const emit = (row) => { rows.push(row); if (!args.json) console.log(tsvLine(row)); };

  if (args.compare.length) {
    for (const puzzle of puzzles) {
      const base = bestOf(repeat, () => runSolve(puzzle, budgets));
      emit(toRow(base, '', '1.00'));
      for (const name of args.compare) {
        const restore = applyAblations([name]);
        try {
          const ablated = bestOf(repeat, () => runSolve(puzzle, budgets));
          const ratio = (ablated.counters.nodesSearched / Math.max(1, base.counters.nodesSearched)).toFixed(2);
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
};

try {
  main();
} catch (e) {
  console.error(`error: ${e.message}\n(run with --help for usage)`);
  process.exit(1);
}
