// solve.js — run a puzzle and display the solution content.
//
// The "what did the solver find" tool: shows the digit grid and all var-cell
// groups (e.g. Chaos region labels) for each solution found. To instead check
// that an encoding accepts a known answer, use tests/debug/verify_solution.js.
// Use tests/bench/benchmark_puzzles.js when you want search counters (guesses,
// backtracks, nodes) rather than solution content.
//
// Usage:
//   node tests/debug/solve.js --max-backtracks <n|none> [options]
//
// Required:
//   --max-backtracks <n|none>  Backtrack cap; "none" = unlimited. No default,
//                         so a run is never silently unbounded.
//
// Puzzle source (pick one):
//   --puzzle <name>       Named puzzle from data/collections.js.
//   --input <string>      Raw constraint string.
//   --input-file <path>   Read the constraint string from a file.
//
// Options:
//   --solutions <n|all>   Number of solutions to find. Default 2 (proves
//                         uniqueness; reports "multiple" if a 2nd exists).
//   --list                List available named puzzles.
//   -h, --help            Print this help and exit.
//
// Examples:
//   node tests/debug/solve.js --max-backtracks none --puzzle "Chaos Construction"
//   node tests/debug/solve.js --max-backtracks none --input-file puzzle.txt --solutions all

import { runAsCli } from '../helpers/cli_entry.js';
import { allPuzzles, loadPuzzle, buildSolver, printSolution } from './puzzle_runner.js';

// ============================================================================
// Arg parsing
// ============================================================================

// Parse an *explicit* backtrack limit (mirrors solver_analysis.parseBacktrackLimit).
// There is no default: a run is never silently bounded or silently unbounded.
const parseBacktrackLimit = (raw) => {
  if (raw === undefined || raw === '') {
    throw new Error(
      'a backtrack limit is required: pass --max-backtracks <n> (or "none" for unlimited)');
  }
  if (raw === 'none' || raw === 'unlimited' || raw === '0') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`invalid --max-backtracks: ${raw} (expected a non-negative integer or "none")`);
  }
  return n;
};

const parseArgs = (argv) => {
  const args = {
    puzzle: null, input: null, inputFile: null,
    maxSolutions: 2, maxBacktracksRaw: undefined,
    list: false, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split(/=(.*)/s);
    const next = () => inlineValue ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--list': args.list = true; break;
      case '--puzzle': args.puzzle = next(); break;
      case '--input': args.input = next(); break;
      case '--input-file': args.inputFile = next(); break;
      case '--max-backtracks': args.maxBacktracksRaw = next(); break;
      case '--solutions': {
        const v = next();
        args.maxSolutions = v === 'all' ? 0 : +v;
        break;
      }
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tests/debug/solve.js --max-backtracks <n|none> [options]

Required:
  --max-backtracks <n|none>  Backtrack cap; "none" = unlimited. No default —
                             you must say which, so a run is never silently
                             unbounded (it can hang on a hard puzzle).

Puzzle source (pick one):
  --puzzle <name>       Named puzzle from data/collections.js.
  --input <string>      Raw constraint string.
  --input-file <path>   Read the constraint string from a file.

Options:
  --solutions <n|all>   Solutions to find. Default 2 (proves uniqueness).
  --list                List available named puzzles.
  -h, --help            Print this help and exit.

To check a known answer is accepted, use tests/debug/verify_solution.js.`);

// ============================================================================
// Solving
// ============================================================================

export const main = (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (args.list) { for (const p of allPuzzles()) console.log(p.name); return; }

  const puzzle = loadPuzzle(args);
  const { internal, geometry } = buildSolver(puzzle.input);

  const maxBacktracks = parseBacktrackLimit(args.maxBacktracksRaw);

  const mode = {};
  if (args.maxSolutions > 0) mode.maxSolutions = args.maxSolutions;
  if (maxBacktracks > 0) mode.maxBacktracks = maxBacktracks;

  let count = 0;
  const grids = [];
  internal.run(Object.keys(mode).length ? mode : null, (grid) => {
    count++;
    grids.push(grid.slice());
  });

  const exhausted = internal.state === internal.constructor.STATE_EXHAUSTED;
  const capped = !exhausted && maxBacktracks > 0 &&
    internal.counters.backtracks >= maxBacktracks;

  console.log(`Puzzle: ${puzzle.name}`);

  if (count === 0) {
    // A capped run is inconclusive (throw → non-zero exit); a genuine
    // no-solution is a valid result (exit 0).
    if (capped) {
      throw new Error(`capped after ${maxBacktracks} backtracks — no solution found yet (incomplete)`);
    }
    console.log('Result: no solution');
    return;
  }

  const status = capped ? `capped after ${maxBacktracks} backtracks (incomplete)`
    : !exhausted ? 'first-only'
    : count > 1 ? 'multiple solutions'
    : 'unique';
  console.log(`Result: ${status} (${count} found)`);

  for (let i = 0; i < grids.length; i++) {
    printSolution(geometry, grids[i], i + 1);
  }
};

runAsCli(import.meta.url, main);
