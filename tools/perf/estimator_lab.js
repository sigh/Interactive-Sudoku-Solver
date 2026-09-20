// estimator_lab.js — compare solution-count estimators against known counts.
//
// The "is this sampling strategy actually better" tool. Runs each strategy
// several times (different seeds) on puzzles whose exact solution count is
// known, and reports error against truth, hit rate, tail share, and the
// cost-normalised figure of merit: the wall time needed to reach a 10%
// relative standard error. Strategies live in tools/lib/estimator_strategies.js.
//
// Usage:
//   node tools/perf/estimator_lab.js [options]
//
// Options:
//   --corpus <path>       JSON array of { name, input, truth } (truth may be
//                         null: then the pooled mean is used as truth and the
//                         spread column is the only meaningful one). Default:
//                         tools/perf/estimator_corpus.json.
//   --puzzles <a,b,...>   Only corpus entries whose name contains one of these
//                         (case-insensitive substrings).
//   --input <string>      A raw constraint string instead of the corpus.
//   --truth <n>           Known count for --input (optional).
//   --strategies <a,b>    Strategy names, optionally with overrides:
//                         "g6-L2k:tailL=500". Default: base.
//   --runs <n>            Seeded repetitions per (puzzle, strategy). Default 10.
//   --samples <n>         Samples per run. Default 1000.
//   --list                Print the known strategies and exit.
//   --json                Emit rows as a JSON array instead of TSV.
//   -h, --help            Print this help and exit.
//
// Columns:
//   us/sample   mean wall time per sample
//   hit%        samples with a non-zero weight
//   log10err    log10(pooled mean / truth) — bias over all runs
//   relStd      std of run means / truth
//   log10rmse   rms of per-run log10 error
//   maxShare    share of a run's total carried by its single largest sample
//   cost10%ms   relVar(per sample) * 100 * us/sample — ms to reach 10% s.e.
//   extra       strategy diagnostics (tails per sample, exact fraction,
//               backtracks per tail; tree size)
//
// Examples:
//   node tools/perf/estimator_lab.js --strategies base,g6-L2k --puzzles Thermo,Arrow --runs 20
//   node tools/perf/estimator_lab.js --input ".Shape~6x6" --truth 28200960 --strategies base,at

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAsCli } from '../lib/cli_entry.js';
import { STRATEGIES, resolveStrategy, runStrategy } from '../lib/estimator_strategies.js';

const DEFAULT_CORPUS = join(dirname(fileURLToPath(import.meta.url)), 'estimator_corpus.json');

const parseArgs = (argv) => {
  const a = {
    corpus: DEFAULT_CORPUS, puzzles: null, input: null, truth: null,
    strategies: ['base'], runs: 10, samples: 1000, list: false, json: false, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split(/=(.*)/s);
    const next = () => inlineValue ?? argv[++i];
    switch (key) {
      case '-h': case '--help': a.help = true; break;
      case '--list': a.list = true; break;
      case '--json': a.json = true; break;
      case '--corpus': a.corpus = next(); break;
      case '--puzzles': a.puzzles = next().split(','); break;
      case '--input': a.input = next(); break;
      case '--truth': a.truth = +next(); break;
      case '--strategies': a.strategies = next().split(','); break;
      case '--runs': a.runs = +next(); break;
      case '--samples': a.samples = +next(); break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return a;
};

const printUsage = () => console.log(`\
Usage: node tools/perf/estimator_lab.js [options]

Options:
  --corpus <path>       JSON [{ name, input, truth }]. Default: estimator_corpus.json.
  --puzzles <a,b,...>   Corpus entries whose name contains one of these.
  --input <string>      Raw constraint string instead of the corpus.
  --truth <n>           Known count for --input.
  --strategies <a,b>    Strategy names (--list), with overrides: "g6-L2k:tailL=500".
  --runs <n>            Seeded repetitions per (puzzle, strategy). Default 10.
  --samples <n>         Samples per run. Default 1000.
  --list                Print the known strategies and exit.
  --json                Emit JSON rows instead of TSV.
  -h, --help            Print this help and exit.

cost10%ms is the wall time needed to reach a 10% relative standard error —
the one column that compares a slower, lower-variance sampler with the baseline.`);

// Aggregate seeded runs of one (puzzle, strategy) pair into a result row.
const summarizeRuns = (puzzle, strategy, runs, numSamples) => {
  const means = runs.map(r => r.mean);
  const pooled = means.reduce((x, y) => x + y, 0) / means.length;
  const truth = puzzle.truth ?? pooled;
  const varRun = means.reduce((x, m) => x + (m - truth) ** 2, 0) / means.length;
  const relStd = Math.sqrt(varRun) / truth;
  const relVarSample = varRun * numSamples / (truth * truth);
  const us = runs.reduce((x, r) => x + r.us, 0) / runs.length;
  const logErrs = means.map(m => m > 0 ? Math.log10(m / truth) : -3);
  const st = runs[0].stats ?? {};
  const extra = {};
  if (st.tails) {
    extra.tailsPerSample = st.tails / numSamples;
    extra.tailExactFraction = st.tailExact / st.tails;
    extra.backtracksPerTail = st.tailBacktracks / st.tails;
  }
  if (st.nodes !== undefined) { extra.nodes = st.nodes; extra.frontier = st.frontier; }
  return {
    puzzle: puzzle.name, truth: puzzle.truth ?? null, strategy,
    usPerSample: us,
    hitRate: runs.reduce((x, r) => x + r.hits, 0) / (runs.length * numSamples),
    log10err: pooled > 0 ? Math.log10(pooled / truth) : -Infinity,
    relStd,
    log10rmse: Math.sqrt(logErrs.reduce((x, e) => x + e * e, 0) / logErrs.length),
    maxShare: runs.reduce((x, r) => x + r.maxShare, 0) / runs.length,
    cost10ms: relVarSample * 100 * us / 1000,
    extra,
  };
};

const formatRow = (row) => {
  const e = row.extra;
  const extras = [];
  if (e.tailsPerSample !== undefined) {
    extras.push(`tails=${e.tailsPerSample.toFixed(2)} exact=${e.tailExactFraction.toFixed(2)} bt/tail=${e.backtracksPerTail.toFixed(0)}`);
  }
  if (e.nodes !== undefined) extras.push(`nodes=${e.nodes} frontier=${e.frontier}`);
  return [
    row.puzzle.slice(0, 32), row.truth ?? '?', row.strategy, row.usPerSample.toFixed(0),
    (row.hitRate * 100).toFixed(1), row.log10err.toFixed(2), row.relStd.toFixed(2),
    row.log10rmse.toFixed(2), row.maxShare.toFixed(2), row.cost10ms.toFixed(0), extras.join(' '),
  ].join('\t');
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (args.list) {
    for (const [name, opts] of Object.entries(STRATEGIES)) console.log(`${name}\t${JSON.stringify(opts)}`);
    return;
  }
  let corpus;
  if (args.input !== null) {
    corpus = [{ name: 'input', input: args.input, truth: args.truth }];
  } else {
    corpus = JSON.parse(readFileSync(args.corpus, 'utf8'));
    if (args.puzzles) {
      const wanted = args.puzzles.map(p => p.toLowerCase());
      corpus = corpus.filter(c => wanted.some(p => c.name.toLowerCase().includes(p)));
    }
  }
  if (corpus.length === 0) throw new Error('no puzzles selected');
  const strategies = args.strategies.map(spec => [spec, resolveStrategy(spec)]);

  const rows = [];
  if (!args.json) {
    console.log(['puzzle', 'truth', 'strategy', 'us/sample', 'hit%', 'log10err', 'relStd',
      'log10rmse', 'maxShare', 'cost10%ms', 'extra'].join('\t'));
  }
  for (const puzzle of corpus) {
    for (const [spec, opts] of strategies) {
      const runs = [];
      for (let r = 0; r < args.runs; r++) runs.push(runStrategy(puzzle.input, opts, r + 1, args.samples));
      const row = summarizeRuns(puzzle, spec, runs, args.samples);
      rows.push(row);
      if (!args.json) console.log(formatRow(row));
    }
  }
  if (args.json) console.log(JSON.stringify(rows, null, 1));
};

runAsCli(import.meta.url, main);
