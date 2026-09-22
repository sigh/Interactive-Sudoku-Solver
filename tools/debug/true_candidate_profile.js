// true_candidate_profile.js — bounded profiler for "All possibilities".
//
// Unlike the ordinary solve profilers, this runs the SeenCandidateSet search
// used by solveAllPossibilities().  It reports when candidate support is found,
// where the search branches, and which constraint handlers consume the bounded
// window.  A time cap is implemented by a sentinel checked at solver hot points;
// JavaScript cannot interrupt a single long handler invocation midway through it.

import { runAsCli } from '../lib/cli_entry.js';
import { allPuzzles, loadPuzzle, buildSolver } from '../lib/puzzle_runner.js';

const popcount = (mask) => {
  let n = 0;
  while (mask) { mask &= mask - 1; n++; }
  return n;
};

const parsePositive = (raw, flag) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`);
  return n;
};

const parseArgs = (argv) => {
  const args = {
    puzzle: null, input: null, inputFile: null, maxMs: null,
    maxBacktracks: null, threshold: 1, top: 12, list: false, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inline] = argv[i].split(/=(.*)/s);
    const next = () => inline ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--list': args.list = true; break;
      case '--puzzle': args.puzzle = next(); break;
      case '--input': args.input = next(); break;
      case '--input-file': args.inputFile = next(); break;
      case '--max-ms': args.maxMs = parsePositive(next(), '--max-ms'); break;
      case '--max-backtracks': args.maxBacktracks = parsePositive(next(), '--max-backtracks'); break;
      case '--threshold': args.threshold = parsePositive(next(), '--threshold'); break;
      case '--top': args.top = parsePositive(next(), '--top'); break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  if (!Number.isInteger(args.maxBacktracks ?? 1)) {
    throw new Error('--max-backtracks must be a positive integer');
  }
  if (!Number.isInteger(args.threshold) || args.threshold > 255) {
    throw new Error('--threshold must be an integer between 1 and 255');
  }
  if (!Number.isInteger(args.top)) throw new Error('--top must be a positive integer');
  return args;
};

const usage = () => console.log(`\
Usage: node tools/debug/true_candidate_profile.js [bound] [puzzle source]\n\n
Bound (at least one is required):
  --max-ms <n>             Stop after approximately n milliseconds.
  --max-backtracks <n>     Stop after n backtracks.

Puzzle source (pick one):
  --puzzle <name>          Named puzzle from data/collections.js.
  --input <string>         Raw constraint string.
  --input-file <path>      Read a constraint string from a file.

Options:
  --threshold <1-255>      Required solution support per candidate (default 1).
  --top <n>                Rows per hotspot table (default 12).
  --list                   List named puzzles.
  -h, --help               Print this help.

Example:
  node tools/debug/true_candidate_profile.js --max-ms 3000 --input '.Arrow~R3C3~R2C2~R1C2~R2C1'`);

class ProfileStop extends Error { }

const addStats = (map, key, ms, failed) => {
  let stat = map.get(key);
  if (!stat) map.set(key, stat = { calls: 0, falseReturns: 0, ms: 0 });
  stat.calls++;
  stat.ms += ms;
  if (failed) stat.falseReturns++;
};

const candidateCount = (seen) => {
  let total = 0;
  for (const mask of seen.candidates) total += popcount(mask);
  return total;
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { usage(); return; }
  if (args.list) { for (const p of allPuzzles()) console.log(p.name); return; }
  if (args.maxMs === null && args.maxBacktracks === null) {
    throw new Error('a bound is required: pass --max-ms <n> and/or --max-backtracks <n>');
  }

  const puzzle = await loadPuzzle(args);
  const buildStart = performance.now();
  const { internal, geometry } = buildSolver(puzzle.input);
  const buildMs = performance.now() - buildStart;
  const seen = internal._seenCandidateSet;
  seen.resetWithThreshold(args.threshold);

  const handlerClasses = new Map();
  const handlerInstances = new Map();
  const decisions = new Map();
  const branchFactors = new Map();
  const discoveries = [];
  let selectionCalls = 0;
  let selectionMs = 0;
  let stopReason = null;
  let searchStart = 0;

  const checkBound = () => {
    if (args.maxBacktracks !== null &&
      internal.counters.backtracks >= args.maxBacktracks) {
      stopReason = 'backtrack-cap';
      throw new ProfileStop();
    }
    if (args.maxMs !== null && performance.now() - searchStart >= args.maxMs) {
      stopReason = 'time-cap';
      throw new ProfileStop();
    }
  };

  // Profile concrete handler instances, then aggregate them by class. Instance
  // labels preserve the cells, which makes multiple arrows distinguishable.
  for (const handler of internal._handlerSet) {
    const original = handler.enforceConsistency;
    const className = handler.constructor.name;
    // handler.cells is commonly a typed array; TypedArray#map would coerce the
    // returned cell-id strings back to numbers (and turn them into zeroes).
    const cells = Array.from(handler.cells, c => geometry.makeCellIdFromIndex(c)).join(',');
    const instanceName = `${className}(${cells})`;
    handler.enforceConsistency = function (...callArgs) {
      const start = performance.now();
      let result;
      let returned = false;
      try {
        result = original.apply(this, callArgs);
        returned = true;
      }
      finally {
        const ms = performance.now() - start;
        addStats(handlerClasses, className, ms, result === false);
        addStats(handlerInstances, instanceName, ms, result === false);
        // Do not replace a real handler exception with the profiler's cap.
        if (returned) checkBound();
      }
      return result;
    };
  }

  const selector = internal._candidateSelector;
  const originalSelect = selector.selectNextCandidate.bind(selector);
  selector.selectNextCandidate = function (...callArgs) {
    checkBound();
    const start = performance.now();
    let returned = false;
    try {
      const result = originalSelect(...callArgs);
      returned = true;
      return result;
    }
    finally {
      selectionCalls++;
      selectionMs += performance.now() - start;
      if (returned) checkBound();
    }
  };
  selector.setDecisionHook(({ cell, count }) => {
    decisions.set(cell, (decisions.get(cell) ?? 0) + 1);
    branchFactors.set(count, (branchFactors.get(count) ?? 0) + 1);
    return null;
  });

  const originalAdd = seen.addSolutionGrid.bind(seen);
  seen.addSolutionGrid = (grid) => {
    const before = candidateCount(seen);
    originalAdd(grid);
    const after = candidateCount(seen);
    if (after > before) {
      discoveries.push({
        ms: performance.now() - searchStart,
        solution: internal.counters.solutions,
        added: after - before,
        supported: after,
        backtracks: internal.counters.backtracks,
      });
    }
  };

  searchStart = performance.now();
  try {
    internal.run(null, (grid) => {
      seen.addSolutionGrid(grid);
      if (internal.counters.solutions === 2) seen.enabledInSolver = true;
      checkBound();
    });
  } catch (error) {
    if (!(error instanceof ProfileStop)) throw error;
  }
  const elapsedMs = performance.now() - searchStart;
  const exhausted = internal.state === internal.constructor.STATE_EXHAUSTED;
  if (exhausted) stopReason = 'complete';

  const supported = candidateCount(seen);
  const c = internal.counters;
  console.log(`Puzzle: ${puzzle.name}`);
  console.log(`status=${stopReason} threshold=${args.threshold} buildMs=${buildMs.toFixed(1)} ` +
    `profileMs=${elapsedMs.toFixed(1)} solutions=${c.solutions} supported=${supported} ` +
    `guesses=${c.guesses} backtracks=${c.backtracks} nodes=${c.nodesSearched} ` +
    `ignored=${c.branchesIgnored.toFixed(6)}`);
  if (!exhausted) {
    console.log('(partial profile — candidate support and rankings reflect only the bounded search)');
  }

  const shownDiscoveries = (() => {
    if (discoveries.length <= args.top) return discoveries;
    if (args.top === 1) return [discoveries.at(-1)];
    const indexes = new Set();
    for (let i = 0; i < args.top; i++) {
      indexes.add(Math.round(i * (discoveries.length - 1) / (args.top - 1)));
    }
    return [...indexes].map(i => discoveries[i]);
  })();
  console.log(`\n=== CANDIDATE DISCOVERY (${shownDiscoveries.length} of ${discoveries.length} support-changing solutions) ===`);
  console.log('ms\tsolution\tadded\tsupported\tbacktracks');
  for (const d of shownDiscoveries) {
    console.log(`${d.ms.toFixed(1)}\t${d.solution}\t+${d.added}\t${d.supported}\t${d.backtracks}`);
  }
  if (!discoveries.length) console.log('(no candidate-supporting solution found in the bounded window)');
  const last = discoveries.at(-1);
  if (last) {
    console.log(`last support discovery: ${last.ms.toFixed(1)}ms; ` +
      `${Math.max(0, elapsedMs - last.ms).toFixed(1)}ms spent since then`);
  }

  const cellRows = [...seen.candidates].map((mask, cell) => ({
    cell, count: popcount(mask), values: geometry.makeCellIdFromIndex(cell), mask,
  })).sort((a, b) => a.count - b.count || a.cell - b.cell);
  console.log(`\n=== LEAST-SUPPORTED CELLS (top ${args.top}) ===`);
  console.log('cell\tsupportedValues');
  for (const row of cellRows.slice(0, args.top)) {
    const values = [];
    for (let bit = 0; bit < geometry.numValues; bit++) {
      if (row.mask & (1 << bit)) values.push(bit + 1 + geometry.valueOffset);
    }
    console.log(`${row.values}\t${values.join(',') || '-'}`);
  }

  const printStats = (title, map, limit) => {
    const rows = [...map.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, limit);
    const totalCalls = [...map.values()].reduce((sum, stat) => sum + stat.calls, 0);
    console.log(`\n=== ${title} ===`);
    console.log('name\tcalls\t%calls\tfalse\tms\tus/call\t%search');
    for (const [name, stat] of rows) {
      console.log(`${name}\t${stat.calls}\t${(100 * stat.calls / totalCalls).toFixed(1)}%\t` +
        `${stat.falseReturns}\t${stat.ms.toFixed(1)}\t` +
        `${(stat.ms * 1000 / stat.calls).toFixed(2)}\t${(100 * stat.ms / elapsedMs).toFixed(1)}%`);
    }
  };
  printStats('HANDLER CLASSES', handlerClasses, handlerClasses.size);
  printStats(`HOT HANDLER INSTANCES (top ${args.top})`, handlerInstances, args.top);
  console.log(`\nCandidate selection: calls=${selectionCalls} ms=${selectionMs.toFixed(1)} ` +
    `(${(100 * selectionMs / elapsedMs).toFixed(1)}% of search)`);

  console.log(`\n=== BRANCH HOTSPOTS (top ${args.top}) ===`);
  console.log('cell\tdecisions');
  for (const [cell, count] of [...decisions.entries()].sort((a, b) => b[1] - a[1]).slice(0, args.top)) {
    console.log(`${geometry.makeCellIdFromIndex(cell)}\t${count}`);
  }
  console.log('branch factors: ' + [...branchFactors.entries()].sort((a, b) => a[0] - b[0])
    .map(([factor, count]) => `${factor}:${count}`).join(' '));
};

runAsCli(import.meta.url, main);
