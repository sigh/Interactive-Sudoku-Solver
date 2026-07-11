// decision_trace.js — export a solve's branch decisions, and replay them.
//
// Two halves of the search-dynamics program's frozen-order machinery, both
// riding the supported `setDecisionHook` seam on the candidate selector (no
// internal patching of selection):
//
//   export  (default)   Run a solve and stream one record per branch decision —
//                        (n, depth, cell, value, count, elims) — as NDJSON to a
//                        file or stdout. The trace another run replays, and the
//                        input to a trace diff.
//   replay  (--replay)  Load a trace and force each branch onto the recorded
//                        (cell, value) whenever it is still applicable (cell
//                        unfixed, value present), reporting the guided fraction
//                        and where the run diverged. Replaying a trace under a
//                        different build (an ablation, a revision) is B-frozen-
//                        order: node ratio vs the original isolates pure pruning
//                        value from selection/learning shifts. Replaying a trace
//                        against its own build reproduces it exactly (100%
//                        guided, identical counters) — the correctness check.
//
// A trace is only meaningful at ~90%+ guided; below that, alignment has broken
// down (the replaying build prunes a different tree) and the decomposition is
// unmeasurable — reported honestly rather than as a number.
//
// Usage:
//   node tools/debug/decision_trace.js --max-backtracks <n|none> [options]
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
//   --out <file>          Export: write the NDJSON trace here (default: stdout).
//   --replay <file>       Replay this trace instead of exporting.
//   --top <n>             Replay: divergences to list. Default 10.
//   -h, --help            Print this help and exit.
//
// Examples:
//   node tools/debug/decision_trace.js --max-backtracks none --puzzle "Chaos Construction" --out /tmp/a.ndjson
//   node tools/debug/decision_trace.js --max-backtracks none --puzzle "Chaos Construction" --replay /tmp/a.ndjson
//   # B-frozen-order: does an ablation change the tree, or just prune less?
//   node tools/debug/decision_trace.js --max-backtracks none --puzzle X --ablate demote-off --replay /tmp/a.ndjson

import { readFileSync, writeFileSync } from 'node:fs';

import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';
import { runAsCli } from '../lib/cli_entry.js';

ensureGlobalEnvironment();

const {
  resolvePuzzles, materializePuzzles, runSolve, parseBacktrackLimit,
  parseSolutionLimit, applyAblations, validateAblations,
} = await import('../lib/solver_analysis.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);

const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

const parseArgs = (argv) => {
  const args = {
    puzzle: null, input: null, maxBacktracksRaw: undefined, solutionsRaw: undefined,
    out: null, replay: null, ablate: [], top: 10, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inline] = argv[i].split(/=(.*)/s);
    const next = () => inline ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--puzzle': args.puzzle = next(); break;
      case '--input': args.input = next(); break;
      case '--max-backtracks': args.maxBacktracksRaw = next(); break;
      case '--solutions': args.solutionsRaw = next(); break;
      case '--out': args.out = next(); break;
      case '--replay': args.replay = next(); break;
      case '--ablate': args.ablate = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--top': args.top = +next(); break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tools/debug/decision_trace.js --max-backtracks <n|none> [options]

Required:
  --max-backtracks <n|none>  Backtrack cap; "none" = unlimited. No default.

Puzzle source (pick one):
  --puzzle <name>       Exact named puzzle (or collection/ladder selector).
  --input <string>      Raw constraint string.

Options:
  --solutions <n|all>   Solutions to search for. Default 2 (proof of uniqueness).
  --out <file>          Export: write the NDJSON trace here (default: stdout).
  --replay <file>       Replay this trace instead of exporting.
  --ablate <a,b,...>    Disable optimizations (e.g. for B-frozen-order replay).
  --top <n>             Replay: divergences to list. Default 10.
  -h, --help            Print this help and exit.`);

// Export (D1): record every branch decision via the decision hook, and the
// candidates each guess propagated away via an enforce wrapper (before−after
// population, à la search_hotspots).
const runExport = (puzzle, budgets, out) => {
  const trace = [];
  let geometry = null;

  const onSolver = (solver) => {
    const internal = solver._internalSolver;
    geometry = solver._geometry;
    const numSearch = internal._numSearchCells;
    const offset = geometry.valueOffset;

    let pending = null;
    internal._candidateSelector.setDecisionHook((d) => {
      // Only plain single-cell branches are representable as (cell, value).
      if (d.isCustom) return null;
      pending = {
        n: trace.length, depth: d.cellDepth, cell: d.cell,
        cellId: geometry.makeCellIdFromIndex(d.cell),
        value: d.value, digit: LookupTables.toOffsetValue(d.value, offset),
        count: d.count, elims: 0,
      };
      trace.push(pending);
      return null;  // observe only
    });

    const popSum = (gs) => { let s = 0; for (let i = 0; i < numSearch; i++) s += popcount(gs[i]); return s; };
    const origEnforce = internal._enforceConstraints.bind(internal);
    internal._enforceConstraints = function (gridState, pQueue) {
      const p = pending; pending = null;
      if (!p) return origEnforce(gridState, pQueue);
      const before = popSum(gridState);
      const ok = origEnforce(gridState, pQueue);
      p.elims = before - popSum(gridState);
      return ok;
    };
  };

  const result = runSolve(puzzle, budgets, onSolver);

  const ndjson = trace.map((r) => JSON.stringify(r)).join('\n') + '\n';
  if (out) {
    writeFileSync(out, ndjson);
    console.error(`wrote ${trace.length} decisions to ${out}`);
  } else {
    process.stdout.write(ndjson);
  }
  console.error(`puzzle: ${puzzle.name}  status=${result.status} ` +
    `guesses=${result.counters.guesses} decisions=${trace.length}`);
};

// Replay (D2): a flat guide consulted once per branch node. Force the recorded
// (cell, value) whenever applicable; classify each node as:
//   guided   — forced onto the recorded decision (of which `overrode`: the live
//              heuristic would have picked differently — where the orders differ).
//   free     — the recorded cell was already fixed or its value pruned, so the
//              run reached the same point for free (pure pruning value).
//   diverged — the trace ran out while the run kept branching (the replaying
//              build has a bigger/other tree; the frozen order can't reach here).
const runReplay = (puzzle, budgets, tracePath, top) => {
  const guide = readFileSync(tracePath, 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));

  let cursor = 0, guided = 0, free = 0, diverged = 0, overrode = 0;
  const overrides = [];
  let geometry = null;

  const onSolver = (solver) => {
    geometry = solver._geometry;
    solver._internalSolver._candidateSelector.setDecisionHook((d) => {
      // Custom multi-cell branches aren't traced/forced; skip without consuming
      // the guide (export skipped them too, so the cursor stays aligned).
      if (d.isCustom) return null;
      if (cursor >= guide.length) { diverged++; return null; }
      const g = guide[cursor++];
      const mask = d.gridState[g.cell];
      if (popcount(mask) <= 1 || (mask & g.value) === 0) { free++; return null; }
      guided++;
      if (g.cell !== d.cell || g.value !== d.value) {
        overrode++;
        if (overrides.length < top) {
          overrides.push(`depth ${d.cellDepth}: guide ${g.cellId}=${g.digit} over live ` +
            `${geometry.makeCellIdFromIndex(d.cell)}=${LookupTables.toOffsetValue(d.value, geometry.valueOffset)}`);
        }
      }
      return { cell: g.cell, value: g.value };
    });
  };

  const result = runSolve(puzzle, budgets, onSolver);
  const nodes = guided + free + diverged;
  const guidedPct = nodes ? (100 * guided / nodes) : 100;

  console.log(`puzzle: ${puzzle.name}  (trace: ${tracePath}, ${guide.length} decisions)`);
  console.log(`status=${result.status} guesses=${result.counters.guesses} ` +
    `backtracks=${result.counters.backtracks} nodes=${result.counters.nodesSearched}`);
  console.log(`branch nodes=${nodes}  guided=${guided} (${guidedPct.toFixed(1)}%, ` +
    `${overrode} overriding the heuristic)  free=${free}  diverged=${diverged}`);
  if (guidedPct < 90) {
    console.log('WARNING: <90% guided — the replaying build prunes a different tree; ' +
      'the frozen-order decomposition is unmeasurable here.');
  }
  if (overrides.length) {
    console.log(`\nfirst ${overrides.length} order overrides:`);
    for (const o of overrides) console.log(`  ${o}`);
  }
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }

  const selector = args.input !== null ? 'input:' + args.input : args.puzzle;
  if (!selector) throw new Error('No puzzle specified. Use --puzzle or --input.');
  validateAblations(args.ablate);
  const budgets = {
    maxBacktracks: parseBacktrackLimit(args.maxBacktracksRaw),
    maxSolutions: parseSolutionLimit(args.solutionsRaw),
  };
  const [puzzle] = await materializePuzzles(resolvePuzzles([selector]));

  const restore = args.ablate.length ? applyAblations(args.ablate) : null;
  try {
    if (args.replay) runReplay(puzzle, budgets, args.replay, args.top);
    else runExport(puzzle, budgets, args.out);
  } finally { restore?.(); }
};

runAsCli(import.meta.url, main);
