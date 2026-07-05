// verify_solution.js — check whether a puzzle encoding ACCEPTS a given solution.
//
// The "does my encoding accept this answer?" tool: it injects a full solution as
// givens and reports whether the solver accepts it. This is distinct from
// solve.js, which searches for solutions — verifying an answer is a bounded
// yes/no check, not a search, so there is no backtrack cap to set. Use it to
// confirm a constraint encoding doesn't reject the intended answer (the common
// over-constraining bug).
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
//   --list                List available named puzzles.
//   -h, --help            Print this help and exit.
//
// Prints "Result: ACCEPTED" (exit 0) or "Result: REJECTED" (exit non-zero), so
// it doubles as an assertion in scripts/CI.
//
// Note: the digit string fixes main-grid cells. For puzzles whose answer lives
// in Var cells (e.g. Chaos region labels), use solve.js and read the printed
// Var groups instead.

import { runAsCli } from '../lib/cli_entry.js';
import {
  allPuzzles, loadPuzzle, buildSolver, injectSolutionGivens,
} from '../lib/puzzle_runner.js';

const parseArgs = (argv) => {
  const args = { puzzle: null, input: null, inputFile: null, solution: null, list: false, help: false };
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
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tools/debug/verify_solution.js --solution <digits> (--puzzle <name> | --input <str> | --input-file <path>)

Checks whether the puzzle encoding accepts the given solution.

Required:
  --solution <digits>   Full solution as a row-major digit string
                        (grid side = sqrt(length)).

Puzzle source (pick one):
  --puzzle <name>       Named puzzle from data/collections.js.
  --input <string>      Raw constraint string.
  --input-file <path>   Read the constraint string from a file.

Options:
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

  const puzzle = await loadPuzzle(args);
  const input = injectSolutionGivens(puzzle.input, args.solution);
  const { internal } = buildSolver(input);

  // With the solution pinned as givens, one accepting completion is enough;
  // stop at the first so a rejected main-grid answer still returns promptly.
  let count = 0;
  internal.run({ maxSolutions: 1 }, () => { count++; });

  console.log(`Puzzle: ${puzzle.name}`);
  console.log(`Solution: ${args.solution}`);
  if (count === 0) {
    console.log('Result: REJECTED');
    throw new Error('the solver rejected the given solution');
  }
  console.log('Result: ACCEPTED');
};

runAsCli(import.meta.url, main);
