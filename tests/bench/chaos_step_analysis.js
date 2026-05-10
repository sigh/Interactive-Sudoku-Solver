import { ensureGlobalEnvironment } from '../helpers/test_env.js';

ensureGlobalEnvironment();

const { EXAMPLES } = await import('../../data/collections.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { ChaosConstruction } = await import('../../js/solver/chaos_handler.js' + self.VERSION_PARAM);
const { resolveChaosBenchmarkPuzzles } = await import('./chaos_benchmark_puzzles.js' + self.VERSION_PARAM);

const DEFAULT_PUZZLE = 'Chaos Construction: x-sums';

const PHASES = [
  ['_enforceCanonicalOrder', 'canonical'],
  ['_enforceRegionShards', 'shards'],
  ['_enforceRegionShardConsistency', 'shard-consistency'],
  ['_enforceConnectivity', 'connectivity'],
];

const regionShardRoot = (handler, grid, cell) => {
  const offset = handler._regionShardOffset;
  let parent = grid[offset + cell];
  while (parent !== cell) {
    cell = parent;
    parent = grid[offset + cell];
  }
  return cell;
};

const parseArgs = (argv) => {
  const args = {
    puzzle: DEFAULT_PUZZLE,
    steps: 100,
    focusCell: 'CC68',
    details: 20,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--puzzle') {
      args.puzzle = argv[++i];
    } else if (arg.startsWith('--puzzle=')) {
      args.puzzle = arg.slice('--puzzle='.length);
    } else if (arg === '--steps') {
      args.steps = +argv[++i];
    } else if (arg.startsWith('--steps=')) {
      args.steps = +arg.slice('--steps='.length);
    } else if (arg === '--focus-cell') {
      args.focusCell = argv[++i];
    } else if (arg.startsWith('--focus-cell=')) {
      args.focusCell = arg.slice('--focus-cell='.length);
    } else if (arg === '--details') {
      args.details = +argv[++i];
    } else if (arg.startsWith('--details=')) {
      args.details = +arg.slice('--details='.length);
    } else if (arg === '--json') {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const printUsage = () => {
  console.log(`Usage: node tests/bench/chaos_step_analysis.js [options]

Options:
  --puzzle <name>       Puzzle name or benchmark ladder name.
  --steps <n>           Analyze user-visible steps 0 through n - 1.
  --focus-cell <cell>   Print detailed rows for this guessed cell.
  --details <n>         Maximum focus rows to print.
  --json                Print raw records as JSON.

Defaults:
  --puzzle "${DEFAULT_PUZZLE}"
  --steps 100
  --focus-cell CC68
`);
};

const isFixed = mask => mask && !(mask & (mask - 1));

const valuesString = (mask) => LookupTables.toValuesArray(mask).join('') || '-';

const increment = (map, key) => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const sortedCounts = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const getRegionCells = (shape) => shape.varCellsForGroup('CC') ?? [];

const regionCellIndex = (regionCells, cell) => {
  for (let i = 0; i < regionCells.length; i++) {
    if (regionCells[i] === cell) return i;
  }
  return -1;
};

const cellLabel = (shape, regionCells, cell) => {
  const ccIndex = regionCellIndex(regionCells, cell);
  if (ccIndex >= 0) {
    const gridCell = shape.makeCellIdFromIndex(ccIndex);
    return `CC${ccIndex + 1}(${gridCell})`;
  }
  return shape.makeCellIdFromIndex(cell);
};

const canonicalCellLabel = (shape, regionCells, cell) => {
  const ccIndex = regionCellIndex(regionCells, cell);
  if (ccIndex >= 0) return `CC${ccIndex + 1}`;
  return shape.makeCellIdFromIndex(cell);
};

const parseFocusCell = (shape, focusCell) => {
  if (!focusCell) return null;
  const match = /^CC(\d+)$/i.exec(focusCell);
  if (match) {
    const regionCells = getRegionCells(shape);
    const index = +match[1] - 1;
    if (index >= 0 && index < regionCells.length) return regionCells[index];
  }
  return shape.parseCellId(focusCell).cell;
};

const selectedCandidateLog = (logs) => {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log.loc !== 'selectNextCandidate') continue;
    if (log.msg !== 'Best candidate:' && log.msg !== 'Adjusted by user:') continue;
    return log;
  }
  return null;
};

const returnedFalseLog = (logs) => {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (typeof log.msg === 'string' && log.msg.endsWith(' returned false')) return log;
  }
  return null;
};

const handlerNameFromLog = (log) => log?.msg?.replace(/ returned false$/, '') ?? 'unknown';

const regionIndexForBit = bit => 31 - Math.clz32(bit);

const regionSummary = (handler, grid, regionBit, focusCell = null) => {
  const regionCells = handler._regionCells;
  const shape = handler._shapeForStepAnalysis;
  const region = regionIndexForBit(regionBit);
  const fixedCells = [];
  const candidateCells = [];
  let possibleValues = 0;
  let focusComponent = null;

  for (let cell = 0; cell < handler._numGridCells; cell++) {
    const regionMask = grid[regionCells[cell]];
    if (!(regionMask & regionBit)) continue;
    candidateCells.push(cell);
    possibleValues |= grid[cell];
    if (regionMask === regionBit) fixedCells.push(cell);
  }

  const components = [];
  const seen = new Uint8Array(handler._numGridCells);
  const stack = [];
  for (const start of candidateCells) {
    if (seen[start]) continue;
    let size = 0;
    let fixed = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop();
      if (cell === focusCell) focusComponent = components.length;
      size++;
      if (grid[regionCells[cell]] === regionBit) fixed++;
      const row = cell / shape.numCols | 0;
      const col = cell % shape.numCols;
      for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow < 0 || nextCol < 0 || nextRow >= shape.numRows || nextCol >= shape.numCols) {
          continue;
        }
        const next = nextRow * shape.numCols + nextCol;
        if (seen[next] || !(grid[regionCells[next]] & regionBit)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    components.push({ size, fixed });
  }

  const missingValues = handler._allValues & ~possibleValues;
  const parts = [
    `r${region + 1}`,
    `fixed=${fixedCells.length}`,
    `possible=${candidateCells.length - fixedCells.length}`,
    `missing=${valuesString(missingValues)}`,
    `components=${components.map(c => `${c.size}/${c.fixed}`).join(',') || '-'}`,
  ];

  if (focusCell !== null) {
    const component = focusComponent === null ? null : components[focusComponent];
    parts.push(`focusComponent=${component ? `${component.size}/${component.fixed}` : '-'}`);

    const neighbors = [];
    const row = focusCell / shape.numCols | 0;
    const col = focusCell % shape.numCols;
    for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextCol < 0 || nextRow >= shape.numRows || nextCol >= shape.numCols) {
        continue;
      }
      const next = nextRow * shape.numCols + nextCol;
      neighbors.push(`${shape.makeCellIdFromIndex(next)}:${valuesString(grid[regionCells[next]])}`);
    }
    parts.push(`neighbors=${neighbors.join(',') || '-'}`);
  }

  return parts.join(' ');
};

const shardSummary = (handler, grid, guessCell, regionCells) => {
  const physicalCell = regionCellIndex(regionCells, guessCell);
  if (physicalCell < 0 || handler._regionShardOffset === undefined) return null;

  const root = regionShardRoot(handler, grid, physicalCell);
  const members = [];
  let mask = handler._regionMask;
  let fixedValues = 0;
  for (let cell = 0; cell < handler._numGridCells; cell++) {
    if (regionShardRoot(handler, grid, cell) !== root) continue;
    members.push(cell);
    mask &= grid[regionCells[cell]];
    if (isFixed(grid[cell])) fixedValues |= grid[cell];
  }

  return [
    `shard=[${members.map(cell => handler._shapeForStepAnalysis.makeCellIdFromIndex(cell)).join(',')}]`,
    `labels=${valuesString(mask)}`,
    `fixedValues=${valuesString(fixedValues)}`,
  ].join(' ');
};

const chaosDetail = (handler, grid, shape, regionCells, guessCell) => {
  if (!handler || !grid || guessCell === null || guessCell === undefined) return '';

  const ccIndex = regionCellIndex(regionCells, guessCell);
  if (ccIndex < 0) return '';

  const regionMask = grid[guessCell];
  const parts = [`${cellLabel(shape, regionCells, guessCell)} labels=${valuesString(regionMask)}`];
  if (isFixed(regionMask)) parts.push(regionSummary(handler, grid, regionMask, ccIndex));
  const shard = shardSummary(handler, grid, guessCell, regionCells);
  if (shard) parts.push(shard);
  return parts.join(' | ');
};

let activeStepTrace = null;

const installChaosPhaseTracing = () => {
  for (const [method, phase] of PHASES) {
    const original = ChaosConstruction.prototype[method];
    if (!original) continue;
    ChaosConstruction.prototype[method] = function (...args) {
      const result = original.apply(this, args);
      if (!result && activeStepTrace) {
        const grid = args[0];
        activeStepTrace.phaseFailures.push({
          phase,
          handler: this,
          grid: grid.slice(),
        });
      }
      return result;
    };
  }
};

const analyzePuzzle = (puzzle, steps) => {
  const constraint = SudokuParser.parseText(puzzle.input);
  const solver = SudokuBuilder.build(constraint, { logLevel: 1 });
  const shape = solver._shape;
  const regionCells = getRegionCells(shape);

  for (const handler of solver._internalSolver._handlerSet.getAllofType(ChaosConstruction)) {
    handler._shapeForStepAnalysis = shape;
  }

  const records = [];
  for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
    activeStepTrace = { phaseFailures: [] };
    const step = solver.nthStep(stepIndex, new Map());
    const logs = solver.debugState()?.logs ?? [];
    const phaseFailure = activeStepTrace.phaseFailures.at(-1) ?? null;
    activeStepTrace = null;
    if (!step?.hasContradiction) continue;

    const guessCell = step.guessCell ? shape.parseCellId(step.guessCell).cell : null;
    const selectLog = selectedCandidateLog(logs);
    const failureLog = returnedFalseLog(logs);
    const phase = phaseFailure?.phase ?? 'unknown';
    records.push({
      step: stepIndex,
      guessCell: guessCell === null ? 'unknown' : canonicalCellLabel(shape, regionCells, guessCell),
      guessCellDetail: guessCell === null ? 'unknown' : cellLabel(shape, regionCells, guessCell),
      tried: selectLog?.args?.value ?? null,
      options: step.values?.join('') ?? '',
      phase,
      handler: handlerNameFromLog(failureLog),
      detail: phaseFailure
        ? chaosDetail(phaseFailure.handler, phaseFailure.grid, shape, regionCells, guessCell)
        : '',
    });
  }

  return { puzzle: puzzle.name, steps, shape, regionCells, records };
};

const printCounts = (title, counts, limit = 12) => {
  console.log(`\n${title}`);
  for (const [key, count] of sortedCounts(counts).slice(0, limit)) {
    console.log(`${key}\t${count}`);
  }
};

const printTable = (records) => {
  console.log('step\tguess\ttried\toptions\tphase\thandler\tdetail');
  for (const record of records) {
    console.log([
      record.step,
      record.guessCellDetail,
      record.tried ?? '',
      record.options,
      record.phase,
      record.handler,
      record.detail,
    ].join('\t'));
  }
};

const printAnalysis = (analysis, focusCell, detailLimit) => {
  const byCell = new Map();
  const byPhase = new Map();
  const byHandler = new Map();
  for (const record of analysis.records) {
    increment(byCell, record.guessCell);
    increment(byPhase, record.phase);
    increment(byHandler, record.handler);
  }

  console.log(`Puzzle\t${analysis.puzzle}`);
  console.log(`Steps\t${analysis.steps}`);
  console.log(`Conflicts\t${analysis.records.length}`);
  printCounts('By guessed cell', byCell);
  printCounts('By chaos phase', byPhase);
  printCounts('By final handler', byHandler);

  if (focusCell) {
    const focusIndex = parseFocusCell(analysis.shape, focusCell);
    const focusLabel = canonicalCellLabel(analysis.shape, analysis.regionCells, focusIndex);
    const focusRecords = analysis.records.filter(record => record.guessCell === focusLabel);
    console.log(`\nFocus ${focusCell}\t${focusRecords.length}`);
    printTable(focusRecords.slice(0, detailLimit));
  }
};

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
  process.exit(0);
}

installChaosPhaseTracing();

const [puzzle] = resolveChaosBenchmarkPuzzles(EXAMPLES, [args.puzzle]);
const analysis = analyzePuzzle(puzzle, args.steps);
if (args.json) {
  console.log(JSON.stringify({
    puzzle: analysis.puzzle,
    steps: analysis.steps,
    records: analysis.records,
  }, null, 2));
} else {
  printAnalysis(analysis, args.focusCell, args.details);
}