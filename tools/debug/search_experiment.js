import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAsCli } from '../lib/cli_entry.js';
import { materializePuzzles, resolvePuzzles, parseBacktrackLimit } from '../lib/solver_analysis.js';
import { compareSearches, runDecisionExperiment } from '../lib/search_experiment.js';

export const main = async (argv) => {
  const args = { at: 1, index: 0, choices: 'same,mrv,runner-up,max-value', learning: 'live' };
  const options = new Set(['puzzle', 'index', 'input-file', 'max-backtracks', 'at',
    'choices', 'learning', 'compare-module', 'out']);
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help') {
      console.log(`Usage: search_experiment.js --puzzle <name or collection> --max-backtracks <n|none>
  --index <n>              Zero-based collection index (default 0)
  --input-file <path>      Raw ISS constraints instead of --puzzle
  --at <n>                One-based fresh branch index (default 1)
  --choices <list>         same,mrv,runner-up,max-value (default); plain also available
  --learning <mode>        live, frozen, last-guess (starts at --at)
  --compare-module <path>  Compare complete searches; module exports apply() -> restore()
  --out <path>             Write JSON (otherwise stdout)

Re-executes the original history for each intervention and checks its fingerprint.
Overrides branch on a cell's full domain, replacing any custom placement branch.
Caps apply to the whole run, including the prefix. Instrumented counters, not timing.
Defaults to uniqueness proof; use the library API for exhaustive small-puzzle studies.`);
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
  let report;
  if (args['compare-module']) {
    const module = await import(pathToFileURL(resolve(args['compare-module'])).href);
    if (typeof module.apply !== 'function') throw new Error('Comparison module must export apply()');
    report = compareSearches(puzzle, budgets, module.apply);
  } else {
    report = runDecisionExperiment(puzzle, budgets, { at: Number(args.at),
      choices: args.choices.split(','), learning: args.learning });
  }
  const output = JSON.stringify({ puzzle: puzzle.name, budgets, ...report }, null, 2) + '\n';
  if (args.out) writeFileSync(args.out, output);
  else process.stdout.write(output);
};

runAsCli(import.meta.url, main);
