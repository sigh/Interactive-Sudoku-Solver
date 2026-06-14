import { ensureGlobalEnvironment } from '../helpers/test_env.js';

ensureGlobalEnvironment();

const { EXAMPLES } = await import('../../data/collections.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { ChaosConstruction } = await import('../../js/solver/chaos_handler.js' + self.VERSION_PARAM);
const {
  CHAOS_LADDER_ALIAS,
  DEFAULT_CHAOS_LADDER_COUNTS,
  CHAOS_KILLER_LADDER_ALIAS,
  DEFAULT_CHAOS_KILLER_LADDER_COUNTS,
  CHAOS_X_SUMS_LADDER_ALIAS,
  DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS,
  resolveChaosBenchmarkPuzzles,
} = await import('./chaos_benchmark_puzzles.js' + self.VERSION_PARAM);

const DEFAULT_PUZZLES = [
  'Chaos Construction: 6x6',
  'Chaos Construction - easier',
];

const PHASES = [
  '_enforceCanonicalOrder',
  '_enforceRegionShards',
  '_enforceRegionShardConsistency',
  '_enforceConnectivity',
];

const parseList = (value, fallback) => {
  if (!value) return fallback;
  return value.split(',').map(v => v.trim()).filter(Boolean);
};

const parseArgs = (argv) => {
  const args = {
    puzzles: DEFAULT_PUZZLES,
    maxBacktracks: 50_000,
    summary: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--summary') {
      args.summary = true;
    } else if (arg === '--puzzles') {
      args.puzzles = parseList(argv[++i], DEFAULT_PUZZLES);
    } else if (arg.startsWith('--puzzles=')) {
      args.puzzles = parseList(arg.slice('--puzzles='.length), DEFAULT_PUZZLES);
    } else if (arg === '--max-backtracks') {
      args.maxBacktracks = +argv[++i];
    } else if (arg.startsWith('--max-backtracks=')) {
      args.maxBacktracks = +arg.slice('--max-backtracks='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const isFixed = (mask) => mask && !(mask & (mask - 1));

const solutionString = (grid, shape) => {
  if (!grid) return '';
  let result = '';
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    const mask = grid[cell];
    result += isFixed(mask) ? String(LookupTables.toOffsetValue(mask, shape.valueOffset)) : '?';
  }
  return result;
};

const originalPhaseMethods = Object.fromEntries(
  PHASES.map(phase => [phase, ChaosConstruction.prototype[phase]]));
const originalMutationMethods = {
  _restrictCell: ChaosConstruction.prototype._restrictCell,
};

const restoreChaosPrototype = () => {
  Object.assign(ChaosConstruction.prototype, originalPhaseMethods, originalMutationMethods);
};

const countBits = (mask) => {
  let count = 0;
  while (mask) {
    mask &= mask - 1;
    count++;
  }
  return count;
};

const makeStats = () => Object.fromEntries(PHASES.map(phase => [phase, {
  calls: 0,
  changedCalls: 0,
  falseCalls: 0,
  cellsChanged: 0,
  candidatesRemoved: 0,
  fixedCells: 0,
  ms: 0,
}]));

const recordMutation = (phaseStats, before, after) => {
  if (before === after) return;
  phaseStats.cellsChanged++;
  phaseStats.candidatesRemoved += countBits(before & ~after);
  if (!isFixed(before) && isFixed(after)) phaseStats.fixedCells++;
};

const installProfilers = (stats) => {
  restoreChaosPrototype();
  let currentPhase = null;

  ChaosConstruction.prototype._restrictCell = function (...args) {
    const grid = args[0];
    const cell = args[1];
    const before = grid[cell];
    const result = originalMutationMethods._restrictCell.apply(this, args);
    if (currentPhase && result !== false) {
      recordMutation(stats[currentPhase], before, grid[cell]);
    }
    return result;
  };

  for (const phase of PHASES) {
    const original = originalPhaseMethods[phase];
    ChaosConstruction.prototype[phase] = function (...args) {
      const start = performance.now();
      let result;
      const phaseStats = stats[phase];
      const cellsChangedBefore = phaseStats.cellsChanged;
      currentPhase = phase;
      try {
        result = original.apply(this, args);
      } finally {
        currentPhase = null;
      }
      const elapsed = performance.now() - start;
      phaseStats.calls++;
      phaseStats.ms += elapsed;
      if (result === false) phaseStats.falseCalls++;
      if (phase !== '_scanRegionCandidates' && phaseStats.cellsChanged > cellsChangedBefore) {
        phaseStats.changedCalls++;
      }
      return result;
    };
  }
};

const solveMode = (maxBacktracks) => {
  const mode = {};
  if (maxBacktracks) mode.maxBacktracks = maxBacktracks;
  return Object.keys(mode).length ? mode : null;
};

const solvePuzzle = (puzzle, maxBacktracks) => {
  const stats = makeStats();
  installProfilers(stats);

  const constraint = SudokuParser.parseText(puzzle.input);
  const shape = constraint.getShape();
  const solver = SudokuBuilder.build(constraint);

  let solutionGrid = null;
  const start = performance.now();
  solver._internalSolver.run(solveMode(maxBacktracks), (grid) => {
    if (!solutionGrid) solutionGrid = grid.slice(0, shape.numGridCells);
  });
  const elapsedMs = performance.now() - start;

  const counters = { ...solver._internalSolver.counters };
  const exhausted = solver._internalSolver.state === solver._internalSolver.constructor.STATE_EXHAUSTED;
  const found = !!solutionGrid;
  const expectedSolution = puzzle.solution ?? '';
  const actualSolution = solutionString(solutionGrid, shape);
  const matchesExpected = found && (!expectedSolution || actualSolution === expectedSolution);
  const capped = !exhausted && maxBacktracks > 0 && counters.backtracks >= maxBacktracks;
  const status = capped
    ? 'capped'
    : !found
      ? 'no-solution'
      : !matchesExpected
        ? 'wrong'
        : counters.solutions !== 1
          ? 'multiple'
          : 'ok';

  restoreChaosPrototype();
  return { puzzle: puzzle.name, status, elapsedMs, counters, stats };
};

const printUsage = () => {
  console.log(`Usage: node tests/bench/chaos_profile.js [options]

Options:
  --puzzles <names>         Comma-separated puzzle names.
                            Use "chaos-ladder" for generated 9x9 ladder points.
  --max-backtracks <n>      Stop any run after this many backtracks.
  --summary                 One compact line per puzzle (status, search shape,
                            wall time, connectivity time) instead of the full
                            per-phase table. Use for before/after comparisons.

Default puzzles:
  ${DEFAULT_PUZZLES.join(', ')}

Generated puzzle alias:
  chaos-ladder = ${DEFAULT_CHAOS_LADDER_COUNTS.map(count => `${CHAOS_LADDER_ALIAS} ${count}`).join(', ')}
  chaos-killer-ladder = ${DEFAULT_CHAOS_KILLER_LADDER_COUNTS.map(count => `${CHAOS_KILLER_LADDER_ALIAS} ${count}`).join(', ')}
  chaos-x-sums-ladder = ${DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS.map(count => `${CHAOS_X_SUMS_LADDER_ALIAS} ${count}`).join(', ')}
`);
};

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
  process.exit(0);
}

const puzzles = resolveChaosBenchmarkPuzzles(EXAMPLES, args.puzzles);

// Compact mode: one line per puzzle with just the decision metrics
// (search shape + wall time + connectivity-phase time). Use this for
// before/after comparisons; the full per-phase table below is for deep dives.
if (args.summary) {
  console.log(['puzzle', 'status', 'sols', 'guesses', 'backtracks', 'nodes',
    'solveMs', 'connMs'].join('\t'));
  for (const puzzle of puzzles) {
    const { puzzle: name, status, elapsedMs, counters, stats } =
      solvePuzzle(puzzle, args.maxBacktracks);
    console.log([
      name,
      status,
      counters.solutions,
      counters.guesses,
      counters.backtracks,
      counters.nodesSearched,
      elapsedMs.toFixed(1),
      stats._enforceConnectivity.ms.toFixed(1),
    ].join('\t'));
  }
  process.exit(0);
}

console.log([
  'puzzle',
  'status',
  'solutions',
  'guesses',
  'backtracks',
  'nodes',
  'constraints',
  'solveMs',
  'phase',
  'calls',
  'changedCalls',
  'falseCalls',
  'cellsChanged',
  'candidatesRemoved',
  'fixedCells',
  'phaseMs',
  'usPerCall',
].join('\t'));

for (const puzzle of puzzles) {
  const result = solvePuzzle(puzzle, args.maxBacktracks);
  const { counters, stats } = result;
  for (const phase of PHASES) {
    const phaseStats = stats[phase];
    const usPerCall = phaseStats.calls ? phaseStats.ms * 1000 / phaseStats.calls : 0;
    console.log([
      result.puzzle,
      result.status,
      counters.solutions,
      counters.guesses,
      counters.backtracks,
      counters.nodesSearched,
      counters.constraintsProcessed,
      result.elapsedMs.toFixed(2),
      phase,
      phaseStats.calls,
      phaseStats.changedCalls,
      phaseStats.falseCalls,
      phaseStats.cellsChanged,
      phaseStats.candidatesRemoved,
      phaseStats.fixedCells,
      phaseStats.ms.toFixed(2),
      usPerCall.toFixed(2),
    ].join('\t'));
  }
}
