// General-purpose step-by-step solver analysis.
//
// Walks a puzzle one search step (guess) at a time and reports what the solver
// did at each branch: which cell/value it chose, how many options it branched
// on, and how many candidates the guess eliminated. An `--explain` mode breaks
// down *why* a particular branch was chosen, including the conflict-score
// ranking of competing cells and whether the branch was a plain cell-value
// guess or a "value-placement" guess nominated by a constraint's candidate
// finder (e.g. "value 5 can only go in two cells of row 7").
//
// This is deliberately constraint-agnostic; it works on any puzzle (use
// --vars to inspect constraint-specific cells such as chaos region labels).
//
// Examples:
//   node tests/debug/step_analysis.js --puzzle "Fountain" --steps 8
//   node tests/debug/step_analysis.js --puzzle "Fountain" --steps 1 --explain
//   node tests/debug/step_analysis.js --puzzle "Fountain" --steps 5 --grid --vars
//   node tests/debug/step_analysis.js --input ".Thermo~R1C1~R1C2" --steps 0 --log
//   node tests/debug/step_analysis.js --puzzle "Fountain" --steps 1 --explain --guide 1:R7C9=5
//   node tests/debug/step_analysis.js --list

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runAsCli } from '../helpers/cli_entry.js';

ensureGlobalEnvironment();

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const Collections = await import('../../data/collections.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { countOnes16bit } = await import('../../js/util.js' + self.VERSION_PARAM);
const { CandidateFinders, NO_LINKED_CELL } =
  await import('../../js/solver/candidate_selector.js' + self.VERSION_PARAM);
const { applyAblations, validateAblations } =
  await import('../bench/solver_analysis.js' + self.VERSION_PARAM);

// ============================================================================
// Argument parsing
// ============================================================================

const DEFAULTS = {
  puzzle: null,
  input: null,
  inputFile: null,
  // The walk replays from step 0 for every step (deterministic replay), so it is
  // O(steps^2); keep the default a small overview and opt into depth explicitly.
  // Failures at step 0 (the common "0 guesses" case) are caught regardless.
  steps: 12,

  explain: false,
  cell: null,
  grid: false,
  vars: false,
  log: false,
  dumpState: false,
  top: 12,
  guides: [],
  priorities: false,
  compare: null,
  list: false,
  json: false,
  help: false,
};

const parseArgs = (argv) => {
  const args = { ...DEFAULTS, guides: [] };
  const next = (i) => argv[++args._i] ?? (() => { throw new Error(`Missing value for ${argv[i]}`); })();

  for (args._i = 2; args._i < argv.length; args._i++) {
    const arg = argv[args._i];
    const [flag, inlineRaw] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined];
    const value = () => inlineRaw !== undefined ? inlineRaw : next(args._i);

    switch (flag) {
      case '--help': case '-h': args.help = true; break;
      case '--puzzle': args.puzzle = value(); break;
      case '--input': args.input = value(); break;
      case '--input-file': args.inputFile = value(); break;
      case '--steps': args.steps = +value(); break;
      case '--explain': args.explain = true; break;
      case '--cell': args.cell = value(); break;
      case '--grid': args.grid = true; break;
      case '--vars': args.vars = true; break;
      case '--log': args.log = true; break;
      case '--dump-state': args.dumpState = true; break;
      case '--top': args.top = +value(); break;
      case '--guide': args.guides.push(value()); break;
      case '--priorities': args.priorities = true; break;
      case '--compare': args.compare = value(); break;
      case '--list': args.list = true; break;
      case '--json': args.json = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  delete args._i;
  return args;
};

const printUsage = () => {
  console.log(`Usage: node tests/debug/step_analysis.js [options]

Puzzle source (pick one):
  --puzzle <name>       Name (or substring) of a puzzle in data/collections.js.
  --input <string>      Raw constraint string (e.g. ".Thermo~R1C1~R1C2").
                        Use "-" to read the constraint string from stdin.
  --input-file <path>   Read the constraint string from a file.

Step indexing matches the UI: step 0 is the initial position (before any
guess); step N (N >= 1) is the Nth guess/dead-end the search reaches.

  --steps <n>           Walk from step 0 through step <n>, clamped to where the
                        search ends. Default ${DEFAULTS.steps}. The step you walk
                        to is the step the inspectors below report on, so e.g.
                        "--steps 0 --log" shows the initial propagation. If the
                        walk ends in a conflict, the refuter is printed
                        automatically (no --log needed).

Inspect the step the walk reached:
  --explain             Explain the guess made to reach the step.
  --grid                Print the value-cell pencilmark grid at the step.
  --vars                Print every extra (var) cell group at the step — e.g.
                        Chaos region labels, Doppelganger cells, sum cells.
                        Grid-shaped groups print as a grid, others as a list.
  --log                 Print the constraint-propagation log: what each handler
                        pruned, and (at a conflict) which handler returned
                        false (the refuter).
  --dump-state          Print (to stdout) the grid state at the step as a
                        constraint string; ALL other output goes to stderr, so
                        it pipes straight into a second invocation:
                          step_analysis.js --dump-state --steps N --input "<p>" \\
                            | step_analysis.js --input - --steps 0 --grid --vars
                        (the basis for incremental-vs-full propagation checks).
  --top <n>             Competing-cell rows to show in --explain. Default ${DEFAULTS.top}.

Other:
  --cell <id>           Track one cell across the walk (candidate count + guesses).
  --priorities          Print initial cell priorities (the root conflict scores).
  --guide <STEP:CELL[=VALUE]>
                        Force the guess at step STEP (>= 1, repeatable). CELL is
                        e.g. R7C9 or CC68; VALUE is the user-facing digit. Steers
                        the search so you can explore alternative branches.
  --compare <ablation>  Walk the same steps with an ablation applied and show,
                        per step, where the branch decisions first diverge from
                        baseline. (For the node-count impact of an ablation use
                        \`benchmark_puzzles.js --compare\`.)

Misc:
  --list                List puzzle names available via --puzzle.
  --json                Emit machine-readable JSON instead of tables.
`);
};

// ============================================================================
// Puzzle loading
// ============================================================================

const allPuzzles = () => {
  const seen = new Set();
  const puzzles = [];
  for (const value of Object.values(Collections)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!entry || typeof entry.input !== 'string' || typeof entry.name !== 'string') continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      puzzles.push({ name: entry.name, input: entry.input });
    }
  }
  return puzzles;
};

const findPuzzle = (query) => {
  const puzzles = allPuzzles();
  const exact = puzzles.find(p => p.name === query);
  if (exact) return exact;
  const lower = query.toLowerCase();
  const matches = puzzles.filter(p => p.name.toLowerCase().includes(lower));
  if (matches.length === 0) {
    throw new Error(`No puzzle matches "${query}". Use --list to see names.`);
  }
  if (matches.length > 1) {
    console.error(`"${query}" matched ${matches.length} puzzles; using "${matches[0].name}".`);
    console.error(`  (others: ${matches.slice(1, 6).map(m => m.name).join(', ')}${matches.length > 6 ? ', ...' : ''})`);
  }
  return matches[0];
};

// Some collection puzzles store `input` as a "/data/*.iss" path rather than a
// constraint string (the app fetches it lazily); resolve those to file text.
// SudokuParser strips the file's leading `#` comments.
const resolveFileInput = (input) =>
  input.startsWith('/') ? readFileSync(join(PROJECT_ROOT, input), 'utf8') : input;

const loadPuzzle = (args) => {
  if (args.input === '-') return { name: 'stdin', input: readFileSync(0, 'utf8') };
  if (args.input !== null) return { name: 'custom', input: resolveFileInput(args.input) };
  if (args.inputFile !== null) {
    return { name: args.inputFile, input: readFileSync(args.inputFile, 'utf8') };
  }
  if (args.puzzle !== null) {
    const puzzle = findPuzzle(args.puzzle);
    return { ...puzzle, input: resolveFileInput(puzzle.input) };
  }
  throw new Error('No puzzle specified. Use --puzzle, --input, or --input-file (or --list).');
};

// ============================================================================
// Formatting helpers
// ============================================================================

const cellId = (geometry, cell) => geometry.makeCellIdFromIndex(cell);

const valueOf = (geometry, mask) => LookupTables.toValue(mask) + geometry.valueOffset;

const valuesString = (mask) => LookupTables.toValuesArray(mask).join('') || '-';

// Describe a set of cells as a house (row/col) when they share one, else list.
const describeCells = (geometry, cells) => {
  const gridCells = cells.filter(c => c < geometry.numGridCells);
  if (gridCells.length === cells.length && gridCells.length > 1) {
    const rows = new Set(gridCells.map(c => c / geometry.numCols | 0));
    const cols = new Set(gridCells.map(c => c % geometry.numCols));
    if (rows.size === 1) return `row ${[...rows][0] + 1}`;
    if (cols.size === 1) return `col ${[...cols][0] + 1}`;
  }
  const ids = cells.map(c => cellId(geometry, c));
  return ids.length > 6 ? `[${ids.slice(0, 6).join(',')},...] (${ids.length} cells)` : `[${ids.join(',')}]`;
};

// ============================================================================
// Candidate-selector instrumentation
//
// We wrap the selector's private decision methods to capture, for each branch,
// what was chosen and (optionally) a snapshot for competitor ranking. Because
// nthStep replays deterministically and stops at the target step's guess, the
// last captured branch in a run is that step's branch.
// ============================================================================

const capture = { current: null, last: null, wantSnapshot: false };

// The CandidateFinders prototype patching below is global; guard it so
// instrumenting a second solver (e.g. under --compare) doesn't re-wrap it.
let candidateFindersPatched = false;

const installInstrumentation = (selector) => {
  const origCandidate = selector._selectBestCandidate.bind(selector);
  const origCell = selector._selectBestCell.bind(selector);

  selector._selectBestCell = function (gridState, cellOrder, cellDepth) {
    const offset = origCell(gridState, cellOrder, cellDepth);
    if (capture.current) capture.current.heuristicCell = cellOrder[offset];
    return offset;
  };

  selector._selectBestCandidate = function (gridState, cellOrder, cellDepth, isNewNode) {
    const dec = { cellDepth, isNewNode, finder: null, heuristicCell: null };
    capture.current = dec;
    const res = origCandidate(gridState, cellOrder, cellDepth, isNewNode);
    capture.current = null;

    const { cellOffset, value, count } = res;
    if (isNewNode && count > 1) {
      dec.chosenCell = cellOrder[cellOffset];
      dec.value = value;
      dec.count = count;
      dec.isCustom = !!this._candidateSelectionFlags[cellDepth];
      if (dec.isCustom) {
        const state = this._candidateSelectionStates[cellDepth];
        // The chosen cell was popped from state.cells; the rest are alternatives.
        dec.placementValue = state.value;
        dec.placementCells = [dec.chosenCell, ...[...state.cells].reverse()];
      }
      if (capture.wantSnapshot) {
        dec.grid = gridState.slice();
        dec.cellOrder = cellOrder.slice();
        dec.conflictScores = this._conflictScores.scores.slice();
        dec.maxValueInfo = this._conflictScores.getMaxValueScore();
        dec.linkedCells = this._linkedCells;
      }
      capture.last = dec;
    }
    return res;
  };

  // Wrap the candidate finders so we learn which finder/house produced a
  // value-placement branch. The last finder to improve the result wins.
  if (candidateFindersPatched) return;
  candidateFindersPatched = true;
  for (const klass of [CandidateFinders.House, CandidateFinders.RequiredValue]) {
    const orig = klass.prototype.maybeFindCandidate;
    klass.prototype.maybeFindCandidate = function (grid, conflictScores, result) {
      const improved = orig.call(this, grid, conflictScores, result);
      if (improved && capture.current) {
        capture.current.finder = { type: klass.name, cells: [...this.cells], value: result.value };
      }
      return improved;
    };
  }
};

const runStep = (solver, stepIndex, guides, wantSnapshot = false) => {
  capture.last = null;
  capture.wantSnapshot = wantSnapshot;
  const step = solver.nthStep(stepIndex, guides);
  capture.wantSnapshot = false;
  return { step, decision: capture.last };
};

// Replicates _selectBestCell scoring so we can rank competing cells.
const scoreCell = (cell, grid, conflictScores, linkedCells, maxValueInfo) => {
  const count = countOnes16bit(grid[cell]);
  if (count <= 1) return null;
  let raw = conflictScores[cell];
  let linkBoost = false;
  if (linkedCells) {
    const linked = linkedCells[cell];
    if (linked !== NO_LINKED_CELL) {
      const lv = grid[linked];
      if ((lv & (lv - 1)) === 0) { raw <<= 2; linkBoost = true; }
    }
  }
  let valueBoost = 0;
  if (maxValueInfo.value && (grid[cell] & maxValueInfo.value)) {
    valueBoost = maxValueInfo.score * 0.2;
    raw += valueBoost;
  }
  return { cell, count, conflictScore: conflictScores[cell], linkBoost, valueBoost, score: raw / count };
};

// ============================================================================
// Guides
// ============================================================================

// Parse "STEP:CELL[=VALUE]" into { step, cell (index), value (user digit|null) }.
const parseGuideSpec = (geometry, spec) => {
  const m = /^(\d+):([^=]+)(?:=(.+))?$/.exec(spec);
  if (!m) throw new Error(`Bad --guide "${spec}". Expected STEP:CELL[=VALUE].`);
  return {
    step: +m[1],
    cell: geometry.parseCellId(m[2]).cell,
    value: m[3] !== undefined ? +m[3] : null,
  };
};

// Step guides need the branch depth at their step, which depends on earlier
// guides. Resolve depths by replaying steps in order with the guides so far.
const buildGuides = (solver, geometry, specs) => {
  const guides = new Map();
  const parsed = specs.map(s => parseGuideSpec(geometry, s)).sort((a, b) => a.step - b.step);
  for (const g of parsed) {
    const res = solver.nthStep(g.step, guides);
    const depth = res?.branchCells ? res.branchCells.length - 1 : 0;
    const guide = { cell: g.cell, depth };
    if (g.value !== null) guide.value = g.value;
    guides.set(g.step, guide);
  }
  return guides;
};

// ============================================================================
// Reports
// ============================================================================

const branchType = (decision) =>
  !decision ? 'forced/none' : decision.isCustom ? 'value-placement' : 'cell-value';

// Does the captured decision describe the guess the public step is showing?
// (The guess cell is decision.chosenCell, or — after backtracking to the other
// half of a value-placement branch — one of its placement cells.)
const decisionMatchesGuess = (decision, guessCellIndex) => {
  if (!decision || guessCellIndex === null) return false;
  if (decision.chosenCell === guessCellIndex) return true;
  return decision.isCustom && decision.placementCells.includes(guessCellIndex);
};

// The value placed by the guess: after committing, the guess cell is fixed, so
// its pencilmark is a single value (nthStep collapses singletons to a number).
const triedValueAt = (step, guessCellIndex) => {
  if (guessCellIndex === null) return null;
  const pm = step.pencilmarks[guessCellIndex];
  if (typeof pm === 'number') return pm;
  if (pm instanceof Set && pm.size === 1) return [...pm][0];
  return null;
};

const buildStepRecord = (geometry, stepIndex, step, decision) => {
  const eliminated = step.diffPencilmarks
    ? step.diffPencilmarks.reduce((sum, set) => sum + set.size, 0)
    : 0;
  const guessCellIndex = step.guessCell ? geometry.parseCellId(step.guessCell).cell : null;
  const matched = decisionMatchesGuess(decision, guessCellIndex);
  return {
    step: stepIndex,
    guessCell: step.guessCell ?? null,
    triedValue: triedValueAt(step, guessCellIndex),
    branch: guessCellIndex === null ? 'forced/none' : matched ? branchType(decision) : 'forced/single',
    count: matched ? decision.count : (guessCellIndex === null ? 0 : 1),
    options: step.values?.join('') ?? '',
    eliminated,
    conflict: !!step.hasConflict,
    solution: !!step.isSolution,
    detail: matched && decision.isCustom
      ? (decision.finder ? `${valueOf(geometry, decision.placementValue)}@${describeCells(geometry, decision.finder.cells)}` : 'custom')
      : '',
  };
};

const printWalk = (geometry, records) => {
  const header = ['step', 'guess', 'tried', 'branch', 'n', 'options', 'elim', 'flags', 'detail'];
  console.log(header.join('\t'));
  for (const r of records) {
    const flags = [r.conflict ? 'X' : '', r.solution ? 'SOLVED' : ''].filter(Boolean).join(',');
    console.log([
      r.step,
      r.guessCell ?? '-',
      r.triedValue ?? '-',
      r.branch,
      r.count,
      r.options || '-',
      r.eliminated,
      flags || '-',
      r.detail || '-',
    ].join('\t'));
  }
  console.log('\nbranch: cell-value = guessing a cell\'s digit; ' +
    'value-placement = guessing which cell in a house holds a digit (n = real branch factor).');
};

// Walk steps 0..lastStep on `solver`, returning a per-step record list. (Always
// walks from step 0 so each step's guess decision, captured at the prior step's
// replay, is available — see the note in main().)
const walk = (solver, geometry, guides, lastStep) => {
  const records = [];
  let prevDecision = null;
  for (let s = 0; s <= lastStep; s++) {
    const { step, decision } = runStep(solver, s, guides, false);
    if (!step) break;
    records.push(buildStepRecord(geometry, s, step, prevDecision));
    prevDecision = decision;
    if (step.isSolution) break;
  }
  return records;
};

// Show, per step, where the ablated walk's branch decisions first diverge from
// baseline. (Node-count impact of an ablation is benchmark_puzzles.js --compare.)
const printCompare = (records, ablated, name) => {
  console.log(`\n=== Compare vs --ablate ${name} (branch decisions per step) ===`);
  console.log(`step\tbaseline${' '.repeat(20)}\t-${name}`);
  const fmt = (r) => r
    ? `${r.guessCell ?? '-'}=${r.triedValue ?? '-'} (${r.branch},n${r.count})`
    : '(end)';
  let firstDiff = -1;
  const n = Math.max(records.length, ablated.length);
  for (let i = 0; i < n; i++) {
    const a = records[i], b = ablated[i];
    const same = a && b && a.guessCell === b.guessCell && a.triedValue === b.triedValue;
    if (!same && firstDiff < 0) firstDiff = i;
    console.log(`${i}\t${fmt(a).padEnd(28)}\t${fmt(b)}${same ? '' : '  <<<'}`);
  }
  console.log(firstDiff < 0
    ? `\nNo divergence within ${n} steps.`
    : `\nFirst divergence at step ${firstDiff}.`);
};

const printExplain = (geometry, stepIndex, decision, top) => {
  console.log(`\n=== Explain step ${stepIndex} (the guess made to reach this step) ===`);
  if (!decision) {
    console.log('No multi-way branch was decided for this step (forced single, conflict, or past the end).');
    return;
  }

  const chosen = cellId(geometry, decision.chosenCell);
  const tried = valueOf(geometry, decision.value);
  console.log(`Branch type:   ${branchType(decision)}`);
  console.log(`Chosen cell:   ${chosen} (first value tried: ${tried})`);
  console.log(`Branch factor: ${decision.count}`);

  if (decision.isCustom) {
    const house = decision.finder ? describeCells(geometry, decision.finder.cells) : 'unknown house';
    const finderType = decision.finder?.type ?? 'unknown';
    const placeCells = decision.placementCells.map(c => cellId(geometry, c));
    console.log(`\nThis is NOT a guess on ${chosen}'s ${countOnes16bit(decision.grid?.[decision.chosenCell] ?? 0) || '?'} candidates.`);
    console.log(`A ${finderType} candidate finder noticed that value ${valueOf(geometry, decision.placementValue)} ` +
      `can only go in ${decision.placementCells.length} cells of ${house}:`);
    console.log(`  ${placeCells.join(', ')}`);
    console.log(`The solver branches on that placement, trying ${placeCells[0]}=${valueOf(geometry, decision.placementValue)} first.`);
    if (decision.heuristicCell !== null && decision.heuristicCell !== undefined) {
      console.log(`(Before the override, the score heuristic's best plain cell was ` +
        `${cellId(geometry, decision.heuristicCell)}.)`);
    }
  } else {
    console.log(`\nThe score heuristic picked the cell maximizing conflictScore / candidateCount, ` +
      `then tried its smallest value first.`);
  }

  if (!decision.grid) {
    console.log('\n(Run with --explain to capture the competitor ranking snapshot.)');
    return;
  }

  // Rank competing cells the way _selectBestCell would.
  const rows = [];
  for (let i = decision.cellDepth; i < decision.cellOrder.length; i++) {
    const r = scoreCell(decision.cellOrder[i], decision.grid, decision.conflictScores,
      decision.linkedCells, decision.maxValueInfo);
    if (r) rows.push(r);
  }
  rows.sort((a, b) => b.score - a.score);

  console.log(`\nTop ${Math.min(top, rows.length)} cells by heuristic score (conflictScore/count):`);
  console.log('cell\tcount\tconflict\tlinkx4\tvalboost\tscore');
  for (const r of rows.slice(0, top)) {
    console.log([
      cellId(geometry, r.cell),
      r.count,
      r.conflictScore,
      r.linkBoost ? 'yes' : '-',
      r.valueBoost ? r.valueBoost.toFixed(1) : '-',
      r.score.toFixed(3),
    ].join('\t'));
  }
  if (decision.maxValueInfo.value) {
    console.log(`\n(A recently conflict-prone value (${valueOf(geometry, decision.maxValueInfo.value)}, ` +
      `score ${decision.maxValueInfo.score}) is boosting cells that contain it.)`);
  }
};

// Render pencilmarks laid out as the grid. cellIndexFor(row, col) maps a grid
// position to the search-cell index whose candidates to show (the value cell
// itself, or its region cell).
const printPencilmarkGrid = (geometry, pencilmarks, cellIndexFor, title, width) => {
  console.log(`\n=== ${title} ===`);
  for (let row = 0; row < geometry.numRows; row++) {
    const cells = [];
    for (let col = 0; col < geometry.numCols; col++) {
      const pm = pencilmarks[cellIndexFor(row, col)];
      const text = pm instanceof Set ? [...pm].join('') : String(pm);
      cells.push(text.padEnd(width));
    }
    console.log(cells.join(' | '));
  }
};

const printGrid = (geometry, pencilmarks, stepIndex) => {
  printPencilmarkGrid(geometry, pencilmarks,
    (row, col) => row * geometry.numCols + col,
    `Pencilmarks at step ${stepIndex}`, geometry.numValues);
};

const candidatesText = (pencilmarks, cellIndex) => {
  const pm = pencilmarks[cellIndex];
  return pm instanceof Set ? ([...pm].join('') || '-') : String(pm);
};

// Print every var-cell group (chaos regions, doppelganger cells, sum cells, ...).
// Groups with a `columns` layout hint print as a grid; the rest as a list.
const printVarCells = (geometry, pencilmarks, stepIndex) => {
  const groups = geometry.varCellGroups();
  if (!groups.length) {
    console.log(`\nThis puzzle has no extra (var) cells.`);
    return;
  }
  console.log(`\n=== Extra (var) cells at step ${stepIndex} ===`);
  for (const group of groups) {
    const cells = group.cells;
    const width = Math.max(1, ...cells.map(c => candidatesText(pencilmarks, c).length));
    const hidden = group.hidden ? ', hidden' : '';
    console.log(`\n[${group.prefix}] ${group.label} (${group.count} cells${hidden}):`);
    if (group.columns > 0) {
      for (let i = 0; i < cells.length; i += group.columns) {
        const line = cells.slice(i, i + group.columns)
          .map(c => candidatesText(pencilmarks, c).padEnd(width));
        console.log('  ' + line.join(' | '));
      }
    } else {
      const entries = cells.map(c => `${cellId(geometry, c)}=${candidatesText(pencilmarks, c)}`);
      console.log('  ' + entries.join('  '));
    }
  }
};

// Print the engine's constraint-propagation log for one step: which handlers
// pruned which candidates, and (at a conflict) the handler that returned
// false. Requires the solver built with logLevel >= 1. The engine scopes step
// logs to the target step, so we discard logs from earlier replays, run the step
// fresh, then read what it produced.
const printDebugLog = (geometry, solver, atStep, guides) => {
  solver.debugState();  // drain logs accumulated during the walk / earlier runs
  runStep(solver, atStep, guides, false);
  const logs = (solver.debugState()?.logs ?? [])
    .filter(l => l.loc === '_enforceConstraints');

  console.log(`\n=== Constraint propagation at step ${atStep} ===`);
  if (!logs.length) {
    console.log('  (nothing logged — the step had no propagating eliminations, ' +
      'or is past the end of the search)');
    return;
  }
  for (const l of logs) {
    if (l.args && Object.keys(l.args).length) {
      const removed = Object.entries(l.args)
        .map(([cell, vals]) => `${cell}:${(vals ?? []).join('') || '-'}`)
        .join(' ');
      console.log(`  ${l.msg}${removed}`);
    } else {
      const cells = l.cells?.length
        ? ` [${Array.from(l.cells, c => cellId(geometry, c)).join(',')}]` : '';
      console.log(`  ${l.msg}${cells}`);
    }
  }
};

// Serialize the grid state at a step as a constraint string: the original
// puzzle plus a `~Cell_v…` given for every cell the search has narrowed (grid
// and var cells). Feeding the result back via --input re-propagates from this
// state under full initial propagation — the basis for comparing what a node's
// incremental propagation derived against a full sweep.
const valuesOf = (pm) =>
  typeof pm === 'number' ? [pm] : (pm instanceof Set ? [...pm].sort((a, b) => a - b) : []);

const printStateString = (geometry, internal, solver, atStep, guides, baseInput) => {
  const initial = runStep(solver, 0, guides).step;
  const { step: target } = runStep(solver, atStep, guides);
  if (!target) { console.log(`\nStep ${atStep} is past the end of the search.`); return; }

  const givens = [];
  let empties = 0;
  for (let cell = 0; cell < internal._numSearchCells; cell++) {
    const values = valuesOf(target.pencilmarks[cell]);
    if (values.length === 0) { empties++; continue; }  // conflict state — can't represent
    // Only emit cells the search narrowed; initial-propagation narrowings are
    // reproduced by the original constraints when the string is re-propagated.
    if (values.length >= valuesOf(initial.pencilmarks[cell]).length) continue;
    givens.push(`~${cellId(geometry, cell)}_${values.join('_')}`);
  }
  const stateString = baseInput + givens.map(g => `.${g}`).join('');

  // Comments to stderr; the constraint string to stdout (so it can be piped into
  // `--input -`). console.log is routed to stderr in --dump-state mode, so write
  // the constraint to the real stdout explicitly.
  console.error(`# state at step ${atStep}: ${givens.length} given(s) added` +
    (empties ? `; ${empties} empty-domain cell(s) omitted (conflict state)` : '') +
    `. Pipe stdout into a second run with --input - .`);
  process.stdout.write(stateString + '\n');
};

const printPriorities = (geometry, internal) => {
  const priorities = internal._cellPriorities;
  console.log('\n=== Initial cell priorities (root conflict scores) ===');
  for (let row = 0; row < geometry.numRows; row++) {
    const cells = [];
    for (let col = 0; col < geometry.numCols; col++) {
      cells.push(String(priorities[row * geometry.numCols + col]).padStart(4));
    }
    console.log(cells.join(' '));
  }
  const nonzeroVar = [];
  for (let i = geometry.numGridCells; i < internal._numSearchCells; i++) {
    if (priorities[i]) nonzeroVar.push(`${cellId(geometry, i)}=${priorities[i]}`);
  }
  if (nonzeroVar.length) {
    console.log('\nNon-zero var-cell priorities:');
    console.log('  ' + nonzeroVar.join('  '));
  }
};

const printCellTracking = (geometry, cellSpec, records, solver, guides) => {
  const cellIndex = geometry.parseCellId(cellSpec).cell;
  console.log(`\n=== Tracking ${cellId(geometry, cellIndex)} ===`);
  console.log('step\tcandidates\tguessedHere');
  for (const r of records) {
    const { step } = runStep(solver, r.step, guides, false);
    if (!step) break;
    const pm = step.pencilmarks[cellIndex];
    const text = pm instanceof Set ? valuesString_fromSet(pm) : String(pm);
    const guessed = step.guessCell === cellId(geometry, cellIndex) ? 'yes' : '';
    console.log([r.step, text, guessed].join('\t'));
  }
};

const valuesString_fromSet = (set) => [...set].sort((a, b) => a - b).join('') || '-';

// ============================================================================
// Main
// ============================================================================

export const main = (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (args.list) {
    for (const p of allPuzzles()) console.log(p.name);
    return;
  }

  // In --dump-state mode, stdout must carry ONLY the dumped constraint string
  // (so it pipes straight into `--input -`). Route every human-readable line to
  // stderr; printStateString writes the constraint to stdout directly.
  if (args.dumpState) console.log = (...a) => console.error(...a);

  const puzzle = loadPuzzle(args);
  const constraint = SudokuParser.parseText(puzzle.input);
  // logLevel 1 enables the engine's per-step propagation log (handler prunings
  // and refuter). Always on so a conflict can be explained automatically;
  // it only logs the walked step, so it's cheap.
  const solver = SudokuBuilder.build(constraint, { logLevel: 1 });
  const internal = solver._internalSolver;
  const geometry = solver._geometry;

  installInstrumentation(internal._candidateSelector);

  const guides = buildGuides(solver, geometry, args.guides);

  if (args.priorities) printPriorities(geometry, internal);

  // Walk from step 0 through step `--steps` (clamped to where the search ends).
  // We always iterate from step 0 so the decision captured at step s-1 (which
  // describes the guess shown at public step s) is available as we reach step s.
  const records = walk(solver, geometry, guides, args.steps);

  // Validate any ablation up front, before producing output.
  if (args.compare) validateAblations([args.compare]);

  if (args.json) {
    console.log(JSON.stringify({ puzzle: puzzle.name, records }, null, 2));
    return;
  }

  console.log(`Puzzle: ${puzzle.name}`);
  console.log(`Grid:   ${geometry.numRows}x${geometry.numCols}, ${internal._numSearchCells} search cells ` +
    `(${geometry.numGridCells} grid + ${internal._numSearchCells - geometry.numGridCells} var)`);
  if (guides.size) console.log(`Guides: ${args.guides.join(' ')}`);
  console.log('');
  printWalk(geometry, records);

  if (args.cell) printCellTracking(geometry, args.cell, records, solver, guides);

  if (args.compare) {
    const restore = applyAblations([args.compare]);
    let ablatedRecords;
    try {
      const solver2 = SudokuBuilder.build(
        SudokuParser.parseText(puzzle.input), { logLevel: 0 });
      installInstrumentation(solver2._internalSolver._candidateSelector);
      const guides2 = buildGuides(solver2, solver2._geometry, args.guides);
      ablatedRecords = walk(solver2, solver2._geometry, guides2, args.steps);
    } finally { restore(); }
    printCompare(records, ablatedRecords, args.compare);
  }

  // Everything below inspects the last step the walk reached (step `--steps`, or
  // wherever the search ended). No separate target: the step you walked to is the
  // step you inspect.
  const last = records.at(-1);
  const atStep = last?.step ?? 0;

  if (args.explain) {
    if (atStep < 1) {
      console.log(`\nStep ${atStep} is the initial position; no guess to explain.`);
    } else {
      // The guess shown at step `atStep` is decided during the replay to step
      // atStep - 1, so capture its decision (with a snapshot) there.
      const { decision } = runStep(solver, atStep - 1, guides, true);
      printExplain(geometry, atStep, decision, args.top);
    }
  }

  if (args.grid) printGrid(geometry, runStep(solver, atStep, guides).step.pencilmarks, atStep);
  if (args.vars) printVarCells(geometry, runStep(solver, atStep, guides).step.pencilmarks, atStep);

  // Show the propagation log when asked, and always when the walk ended in a
  // conflict — so a plain run explains a failure (e.g. 0 guesses) by itself.
  if (args.log || last?.conflict) printDebugLog(geometry, solver, atStep, guides);

  if (args.dumpState) printStateString(geometry, internal, solver, atStep, guides, puzzle.input);
};

runAsCli(import.meta.url, main);
