import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAsCli } from '../lib/cli_entry.js';
import { materializePuzzles, resolvePuzzles, parseBacktrackLimit, applyAblations, validateAblations } from '../lib/solver_analysis.js';
import { compareSearches } from '../lib/search_divergence.js';

export const main = async (argv) => {
  const args = { index: 0, 'max-events': 100000 };
  const options = new Set(['puzzle', 'index', 'input-file', 'max-backtracks', 'max-events', 'ablate', 'compare-module', 'out']);
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help') {
      console.log(`Usage: search_divergence.js --puzzle <name> --ablate <name> --max-backtracks <n|none>
  --index <n>              Zero-based collection index (default 0)
  --input-file <path>      Raw ISS constraints instead of --puzzle
  --ablate <a,b,...>       Compare with named optimizations disabled
  --compare-module <path>  Instead of --ablate: module exports apply() -> restore()
  --max-events <n>         Maximum events compared (default 100000)
  --out <path>             Write JSON (otherwise stdout)

Reports the first differing selection, propagation outcome, conflict or solution.
Matching events do not establish equal domains or scores. Alignment ends at the
first difference. Capped solves and observation limits remain inconclusive.
Counters describe instrumented search work; use benchmark_puzzles.js for timing.`);
      return;
    }
    const key = argv[i].replace(/^--/, '');
    if (!options.has(key) || argv[i + 1] === undefined) throw new Error(`Invalid option: ${argv[i]}`);
    args[key] = argv[++i];
  }
  const budgets = { maxBacktracks: parseBacktrackLimit(args['max-backtracks']), maxSolutions: 2 };
  if (Boolean(args.puzzle) === Boolean(args['input-file'])) {
    throw new Error('Specify exactly one of --puzzle or --input-file');
  }
  const puzzles = args['input-file']
    ? [{ name: args['input-file'], input: readFileSync(args['input-file'], 'utf8') }]
    : await materializePuzzles(resolvePuzzles([args.puzzle]));
  const index = Number(args.index);
  if (!Number.isInteger(index) || !puzzles[index]) throw new Error('Invalid puzzle index');
  const puzzle = puzzles[index];
  if (Boolean(args.ablate) === Boolean(args['compare-module'])) {
    throw new Error('Specify exactly one of --ablate or --compare-module');
  }
  let apply;
  if (args.ablate) {
    const names = args.ablate.split(',');
    validateAblations(names);
    apply = () => applyAblations(names);
  } else {
    const module = await import(pathToFileURL(resolve(args['compare-module'])).href);
    if (typeof module.apply !== 'function') throw new Error('Comparison module must export apply()');
    apply = module.apply;
  }
  const report = compareSearches(puzzle, budgets, apply, { maxEvents: Number(args['max-events']) });
  const output = JSON.stringify({ puzzle: puzzle.name, budgets, ...report }, null, 2) + '\n';
  if (args.out) writeFileSync(args.out, output);
  else process.stdout.write(output);
};

runAsCli(import.meta.url, main);
