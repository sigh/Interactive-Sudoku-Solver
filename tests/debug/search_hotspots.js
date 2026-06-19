// search_hotspots.js — headless "where does the search concentrate" report.
//
// Runs a bounded solve and aggregates where the search spends its effort: the
// cells with the most accumulated conflict (the engine's conflict heatmap, which
// is otherwise only visible in the debug UI), the cells the search re-guesses
// most (churn), and the branch-factor shape (how wide the branching is, split
// grid vs var, and how far the heuristic strays from fewest-options — the MRV
// gap). Deterministic: counts, not wall-time sampling.
//
// Usage:
//   node tests/debug/search_hotspots.js --max-backtracks <n|none> [options]
//
// Required:
//   --max-backtracks <n|none>  Backtrack cap; "none" = unlimited. No default.
//
// Puzzle source (pick one):
//   --puzzle <name>       Exact named puzzle (or a collection/ladder selector).
//   --input <string>      Raw constraint string.
//
// Options:
//   --solutions <n|all>   Solutions to search for. Default 2 (proof of uniqueness).
//   --top <n>             Rows to show per ranking. Default 20.
//   -h, --help            Print this help and exit.
//
// Terms:
//   churn    — per cell, how many distinct values the search branched on it.
//   MRV gap  — (avg chosen branch factor) − (avg minimum available); how far the
//              heuristic strays from branching on the fewest-options cell.
//
// Examples:
//   node tests/debug/search_hotspots.js --max-backtracks none --puzzle "Chaos Construction"
//   node tests/debug/search_hotspots.js --max-backtracks 50000 --input ".Cage~10~R1C1~R1C2"

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runAsCli } from '../helpers/cli_entry.js';

ensureGlobalEnvironment();

const { resolvePuzzles, runSolve, parseBacktrackLimit, parseSolutionLimit } =
  await import('../bench/solver_analysis.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);

const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

const parseArgs = (argv) => {
  const args = { puzzle: null, input: null, maxBacktracksRaw: undefined, solutionsRaw: undefined, top: 20, help: false };
  for (let i = 2; i < argv.length; i++) {
    const [key, inline] = argv[i].split(/=(.*)/s);
    const next = () => inline ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--puzzle': args.puzzle = next(); break;
      case '--input': args.input = next(); break;
      case '--max-backtracks': args.maxBacktracksRaw = next(); break;
      case '--solutions': args.solutionsRaw = next(); break;
      case '--top': args.top = +next(); break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tests/debug/search_hotspots.js --max-backtracks <n|none> [options]

Required:
  --max-backtracks <n|none>  Backtrack cap; "none" = unlimited. No default.

Puzzle source (pick one):
  --puzzle <name>       Exact named puzzle (or collection/ladder selector).
  --input <string>      Raw constraint string.

Options:
  --solutions <n|all>   Solutions to search for. Default 2 (proof of uniqueness).
  --top <n>             Rows to show per ranking. Default 20.
  -h, --help            Print this help and exit.`);

export const main = (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }

  const selector = args.input !== null ? 'input:' + args.input : args.puzzle;
  if (!selector) throw new Error('No puzzle specified. Use --puzzle or --input.');
  const maxBacktracks = parseBacktrackLimit(args.maxBacktracksRaw);
  const maxSolutions = parseSolutionLimit(args.solutionsRaw);
  const [puzzle] = resolvePuzzles([selector]);

  // Accumulated per-node branch stats; populated by the selector wrapper.
  const churn = new Map();           // cell -> Set of values branched on it
  const bfGrid = new Map(), bfVar = new Map();  // branch factor -> count
  let branches = 0, varBranches = 0, sumChosen = 0, sumMin = 0;
  let internal = null, shape = null;

  const onSolver = (solver) => {
    internal = solver._internalSolver;
    shape = solver._shape;
    const numGridCells = shape.numGridCells;
    const numSearch = internal._numSearchCells;
    const sel = internal._candidateSelector;
    const orig = sel._selectBestCandidate.bind(sel);
    sel._selectBestCandidate = function (g, co, cd, nn) {
      const res = orig(g, co, cd, nn);
      if (nn && res.count > 1) {
        const cell = co[res.cellOffset];
        const isVar = cell >= numGridCells;
        branches++;
        if (isVar) varBranches++;
        (isVar ? bfVar : bfGrid).set(res.count, ((isVar ? bfVar : bfGrid).get(res.count) ?? 0) + 1);
        let set = churn.get(cell); if (!set) churn.set(cell, set = new Set());
        set.add(res.value);
        // Minimum branch factor available at this node (the MRV the heuristic could have taken).
        let minBf = res.count;
        for (let i = cd; i < numSearch; i++) {
          const c = popcount(g[co[i]]);
          if (c >= 2 && c < minBf) minBf = c;
        }
        sumChosen += res.count;
        sumMin += minBf;
      }
      return res;
    };
  };

  const result = runSolve(puzzle, { maxBacktracks, maxSolutions }, onSolver);
  const c = result.counters;
  const numGridCells = shape.numGridCells;
  const cid = (i) => shape.makeCellIdFromIndex(i);
  const kind = (i) => i >= numGridCells ? 'var' : 'grid';

  console.log(`puzzle: ${puzzle.name}`);
  console.log(`status=${result.status} guesses=${c.guesses} backtracks=${c.backtracks} ` +
    `nodes=${c.nodesSearched} ms=${result.elapsedMs.toFixed(0)} branches=${branches}`);
  if (result.status === 'capped') {
    console.log('(capped — an incomplete search; the rankings reflect only the work done so far)');
  }

  // --- Conflict heatmap: cells with the most accumulated backtrack conflict. ---
  const scores = internal.getConflictScores().scores;
  const ranked = [...scores.keys()].map(i => [i, scores[i]]).filter(x => x[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, x) => s + x[1], 0) || 1;
  const varShare = ranked.filter(x => x[0] >= numGridCells).reduce((s, x) => s + x[1], 0);
  console.log(`\n=== CONFLICT (top ${args.top} of ${ranked.length} cells; var share ${(100 * varShare / total).toFixed(1)}%) ===`);
  console.log('cell\tkind\tscore\t%total');
  for (const [i, s] of ranked.slice(0, args.top)) {
    console.log(`${cid(i)}\t${kind(i)}\t${s}\t${(100 * s / total).toFixed(1)}%`);
  }

  // --- Churn: cells the search re-guesses the most distinct values on. ---
  const churnRanked = [...churn.entries()].map(([i, set]) => [i, set.size])
    .filter(x => x[1] > 1).sort((a, b) => b[1] - a[1]);
  console.log(`\n=== CHURN (top ${args.top}: distinct values re-guessed per cell) ===`);
  console.log('cell\tkind\tdistinctValues');
  for (const [i, n] of churnRanked.slice(0, args.top)) {
    console.log(`${cid(i)}\t${kind(i)}\t${n}`);
  }

  // --- Branch-factor shape + MRV gap. ---
  const hist = (m) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([bf, n]) => `bf${bf}:${n}`).join(' ');
  console.log(`\n=== BRANCH FACTOR (n=${branches} branches; ${(100 * varBranches / Math.max(1, branches)).toFixed(1)}% on var cells) ===`);
  console.log(`grid: ${hist(bfGrid) || '-'}`);
  console.log(`var : ${hist(bfVar) || '-'}`);
  console.log(`avg chosen branch factor: ${(sumChosen / Math.max(1, branches)).toFixed(2)}  ` +
    `avg min available: ${(sumMin / Math.max(1, branches)).toFixed(2)}  ` +
    `(MRV gap: ${((sumChosen - sumMin) / Math.max(1, branches)).toFixed(2)})`);
};

runAsCli(import.meta.url, main);
