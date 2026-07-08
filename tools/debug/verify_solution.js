// verify_solution.js — check whether a puzzle encoding ACCEPTS a given solution.
//
// The "does my encoding accept this answer?" tool: it injects a full solution as
// givens and reports whether the solver accepts it. This is distinct from
// solve.js, which searches for solutions. Verification is meant to be a quick
// yes/no check, so it defaults to a one-backtrack cap; raise the cap only when
// the encoding needs a little Var-cell search after the main-grid solution is
// pinned.
//
// Usage:
//   node tools/debug/verify_solution.js --solution <digits> (--puzzle <name> | --input <str> | --input-file <path>)
//
// Required:
//   --solution <digits>   The full solution as a row-major digit string. The
//                         grid side is inferred as sqrt(length).
//
// Puzzle source (pick one):
//   --puzzle <name>       Named puzzle from data/collections.js.
//   --input <string>      Raw constraint string.
//   --input-file <path>   Read the constraint string from a file.
//
// Options:
//   --max-backtracks <n|none>
//                         Backtrack cap for verification. Defaults to 1; "none"
//                         is unlimited and should be rare.
//   --list                List available named puzzles.
//   -h, --help            Print this help and exit.
//
// Prints "Result: ACCEPTED" (exit 0) or "Result: REJECTED" (exit non-zero), so
// it doubles as an assertion in scripts/CI. "Result: CAPPED" is inconclusive.
//
// Note: the digit string fixes main-grid cells. For puzzles whose answer lives
// in Var cells (e.g. Chaos region labels), use solve.js and read the printed
// Var groups instead.

import { runAsCli } from '../lib/cli_entry.js';
import {
  allPuzzles, loadPuzzle, buildSolver, injectSolutionGivens,
} from '../lib/puzzle_runner.js';

const DEFAULT_MAX_BACKTRACKS = 1;

const parseArgs = (argv) => {
  const args = {
    puzzle: null, input: null, inputFile: null, solution: null,
    maxBacktracksRaw: undefined, list: false, help: false,
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
      case '--solution': args.solution = next(); break;
      case '--max-backtracks': args.maxBacktracksRaw = next(); break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const parseVerifyBacktrackLimit = (raw) => {
  if (raw === undefined || raw === '') return DEFAULT_MAX_BACKTRACKS;
  if (raw === 'none' || raw === 'unlimited') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`invalid --max-backtracks: ${raw} (expected a non-negative integer or "none")`);
  }
  return n;
};

const printUsage = () => console.log(`\
Usage: node tools/debug/verify_solution.js --solution <digits> (--puzzle <name> | --input <str> | --input-file <path>)

Checks whether the puzzle encoding accepts the given solution. Defaults to a
one-backtrack cap because this is meant to be quick verification, not search.

Required:
  --solution <digits>   Full solution as a row-major digit string
                        (grid side = sqrt(length)).

Puzzle source (pick one):
  --puzzle <name>       Named puzzle from data/collections.js.
  --input <string>      Raw constraint string.
  --input-file <path>   Read the constraint string from a file.

Options:
  --max-backtracks <n|none>
                        Backtrack cap. Default: 1. Use "none" only for rare
                        deliberately unbounded checks.
  --list                List available named puzzles.
  -h, --help            Print this help and exit.

Prints "Result: ACCEPTED" (exit 0) or "Result: REJECTED" (exit non-zero).`);

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (args.list) { for (const p of allPuzzles()) console.log(p.name); return; }
  if (args.solution === null) {
    throw new Error('No solution given. Pass --solution <digits> (or --help).');
  }
  const maxBacktracks = parseVerifyBacktrackLimit(args.maxBacktracksRaw);

  const puzzle = await loadPuzzle(args);
  const input = injectSolutionGivens(puzzle.input, args.solution);
  const { internal } = buildSolver(input);

  // With the solution pinned as givens, one accepting completion is enough;
  // stop at the first so a rejected main-grid answer still returns promptly.
  let count = 0;
  const mode = { maxSolutions: 1 };
  if (maxBacktracks !== null) {
    // The engine stops as soon as counters.backtracks reaches its cap, before a
    // just-failed branch necessarily unwinds to exhausted/rejected. For this
    // verifier, "cap N" means "allow N backtracks to complete classification",
    // so run one past the user cap and classify as capped only if we exceed it.
    mode.maxBacktracks = maxBacktracks + 1;
  }
  internal.run(mode, () => { count++; });

  console.log(`Puzzle: ${puzzle.name}`);
  console.log(`Solution: ${args.solution}`);
  console.log(`Backtracks: ${internal.counters.backtracks}${maxBacktracks === null ? ' (uncapped)' : ` (cap ${maxBacktracks})`}`);
  const exhausted = internal.state === internal.constructor.STATE_EXHAUSTED;
  const capped = count === 0 && maxBacktracks !== null && !exhausted &&
    internal.counters.backtracks > maxBacktracks;
  if (capped) {
    console.log('Result: CAPPED');
    throw new Error(`verification hit the ${maxBacktracks}-backtrack cap before proving acceptance/rejection`);
  }
  if (count === 0) {
    console.log('Result: REJECTED');
    throw new Error('the solver rejected the given solution');
  }
  console.log('Result: ACCEPTED');
};

runAsCli(import.meta.url, main);
