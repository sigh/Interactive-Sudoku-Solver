// Shared helpers for the solver analysis CLIs (solve.js, profile.js).
//
// Centralises: puzzle resolution (named puzzles, chaos ladder aliases, or raw
// input), running a single solve under an explicit backtrack/solution budget,
// the ablation registry (toggle a named optimization off for A/B runs), and the
// handler-class registry used by the profiler.
//
// Design note: solving is always bounded by an *explicit* backtrack limit. The
// CLIs require the caller to pass one (`none` for unlimited), because an
// accidental unbounded run on a hard puzzle can hang for minutes, and — worse —
// a silently-capped run looks like a completed solve. Every result carries a
// `status` that flags `capped` so a truncated run is never mistaken for a real
// one.

import { readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';

ensureGlobalEnvironment();

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Some collection puzzles store `input` as a "/data/*.iss" file path (the app
// fetches it lazily); resolve those to the file text. SudokuParser strips the
// file's leading `#` comments.
const resolveInput = (input) =>
  input.startsWith('/') ? readFileSync(join(PROJECT_ROOT, input), 'utf8') : input;

const { EXAMPLES } = await import('../../data/collections.js' + self.VERSION_PARAM);
const { PUZZLE_INDEX } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const benchPuzzles = await import('./chaos_benchmark_puzzles.js' + self.VERSION_PARAM);

// --- Extensions (pluggable) ---------------------------------------------------
//
// Puzzle/handler-specific contributions live in ./extensions/*.js and are loaded
// dynamically here, so a new ablation or a newly-profilable handler module can be
// added by dropping in a file — no edits to the core scripts. Each extension file
// may export any of:
//   - `ablations`:      { name: { description, apply() -> restore() } }
//   - `handlerModules`: [moduleNamespace, ...] whose handler classes the profiler
//                       can target (profile.js --handler / --list-handlers)
const EXTENSIONS_DIR = new URL('./extensions/', import.meta.url);
const { ABLATIONS, HANDLER_MODULES } = await (async () => {
  const ablations = {};
  const handlerModules = [];
  let files = [];
  try { files = await readdir(EXTENSIONS_DIR); } catch { /* no extensions dir */ }
  for (const file of files.filter(f => f.endsWith('.js')).sort()) {
    const mod = await import(new URL(file, EXTENSIONS_DIR).href);
    for (const [name, ablation] of Object.entries(mod.ablations ?? {})) {
      if (ablations[name]) throw new Error(`duplicate ablation '${name}' in extensions/${file}`);
      ablations[name] = ablation;
    }
    if (mod.handlerModules) handlerModules.push(...mod.handlerModules);
  }
  return { ABLATIONS: ablations, HANDLER_MODULES: handlerModules };
})();

// Ablation registry, populated from the extensions above. Each disables one
// optimization by patching a prototype method (returning a restore fn); disabling
// must keep the solver SOUND — these measure a feature's search impact, not change
// answers. To add one, drop a file in extensions/ exporting an `ablations` map.
export { ABLATIONS };

// --- Puzzle resolution --------------------------------------------------------

// All named puzzles (collections.js merges its puzzles into PUZZLE_INDEX on
// import), used both for name lookup and as the source for the ladder builders.
const ALL_EXAMPLES = [...PUZZLE_INDEX.values()];

export const LADDER_ALIASES = ['chaos-ladder', 'chaos-killer-ladder', 'chaos-x-sums-ladder'];

// Resolve a list of selectors into puzzle objects ({ name, input, solution? }).
// A selector is one of:
//   - a puzzle name ('Chaos Construction', 'Count Different', ...)
//   - a ladder alias (see LADDER_ALIASES) which expands to several puzzles
//   - 'input:<puzzle-string>' to solve a raw constraint string directly
export const resolvePuzzles = (selectors) => selectors.flatMap((selector) => {
  if (selector.startsWith('input:')) {
    return [{ name: 'input', input: selector.slice('input:'.length) }];
  }
  return benchPuzzles.resolveChaosBenchmarkPuzzles(ALL_EXAMPLES, [selector]);
});

// --- Backtrack / solution budgets --------------------------------------------

// Parse an *explicit* backtrack limit. Returns a count, or 0 for "unlimited"
// (only when the caller wrote 'none'/'unlimited'/'0'). Throws when the value is
// missing or malformed — there is deliberately no default, so a run is never
// silently bounded or silently unbounded.
export const parseBacktrackLimit = (raw) => {
  if (raw === undefined || raw === '') {
    throw new Error(
      'a backtrack limit is required: pass --max-backtracks <n> (or "none" for unlimited)');
  }
  if (raw === 'none' || raw === 'unlimited' || raw === '0') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`invalid --max-backtracks: ${raw} (expected a non-negative integer or "none")`);
  }
  return n;
};

// Number of solutions to search for. Defaults to 2 — proof of uniqueness, the
// metric that matters for handler optimization: an expected-unique puzzle must
// exhaust the search to confirm there is no second solution, so a completed run
// finding exactly one solution ('unique') is the success condition. 'all'
// exhausts (counts every solution). '1' is first-solution only — first-solution
// timing/shape is NOT valid evidence for an optimization (see README.md
// "Methodology"); it is offered for convenience, not comparison, and the CLIs warn
// when it is used.
export const parseSolutionLimit = (raw) => {
  if (raw === undefined) return 2;
  if (raw === 'all') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`invalid --solutions: ${raw} (expected a positive integer or "all")`);
  }
  return n;
};

// Warn (without failing) when a run is configured for first-solution only, which
// is not a valid basis for an optimization comparison.
export const warnIfFirstSolution = (maxSolutions) => {
  if (maxSolutions === 1) {
    console.error(
      'note: --solutions 1 measures first-solution behaviour, which is not valid ' +
      'evidence for an optimization. Use the default (proof of uniqueness) or --solutions all.');
  }
};

// --- Running a single solve ---------------------------------------------------

// 'capped' is an *incomplete* proof (hit the backtrack cap) — never read it as a
// win or loss by how much work it did. 'unique' = search completed with exactly
// one (expected) solution. 'multiple' = a 2nd solution exists. 'first' = found a
// solution but the search did not exhaust (only possible under --solutions 1).
const STATUS = {
  CAPPED: 'capped', NO_SOLUTION: 'no-solution', WRONG: 'wrong',
  MULTIPLE: 'multiple', UNIQUE: 'unique', FIRST: 'first',
};

const solutionString = (grid, shape) => {
  if (!grid) return '';
  let result = '';
  for (let cell = 0; cell < shape.numGridCells; cell++) {
    const mask = grid[cell];
    const fixed = mask && !(mask & (mask - 1));
    result += fixed ? String(LookupTables.toOffsetValue(mask, shape.valueOffset)) : '?';
  }
  return result;
};

// Build and run one puzzle under the given budgets, returning a result with
// counters, wall time, and a status. `maxBacktracks`/`maxSolutions` of 0 mean
// unlimited. The solver is built fresh, so prototype patches (ablations) applied
// beforehand take effect. The optional `onSolver` hook (used by the profiler)
// runs after build but before search, e.g. to install method wrappers.
export const runSolve = (puzzle, { maxBacktracks, maxSolutions }, onSolver) => {
  const constraint = SudokuParser.parseText(resolveInput(puzzle.input));
  const shape = constraint.getShape();
  // Match the production build path (SimpleSolver / the worker): resolve the
  // constraint through the optimizer before building, so counts reflect real
  // solves rather than an un-optimized handler set.
  const resolved = SudokuBuilder.resolveConstraint(constraint);
  const solver = SudokuBuilder.build(resolved);
  const internal = solver._internalSolver;
  if (onSolver) onSolver(solver);

  const mode = {};
  if (maxBacktracks) mode.maxBacktracks = maxBacktracks;
  if (maxSolutions) mode.maxSolutions = maxSolutions;

  let firstGrid = null;
  const start = performance.now();
  internal.run(Object.keys(mode).length ? mode : null, (grid) => {
    if (!firstGrid) firstGrid = grid.slice(0, shape.numGridCells);
  });
  const elapsedMs = performance.now() - start;

  const counters = { ...internal.counters };
  const exhausted = internal.state === internal.constructor.STATE_EXHAUSTED;
  const capped = !exhausted && maxBacktracks > 0 && counters.backtracks >= maxBacktracks;
  const actual = solutionString(firstGrid, shape);
  const expected = puzzle.solution ?? '';

  let status;
  if (capped) status = STATUS.CAPPED;
  else if (!firstGrid) status = STATUS.NO_SOLUTION;
  else if (expected && actual !== expected) status = STATUS.WRONG;
  else if (counters.solutions > 1) status = STATUS.MULTIPLE;
  else if (exhausted) status = STATUS.UNIQUE;
  else status = STATUS.FIRST;

  return { name: puzzle.name, shape, counters, elapsedMs, exhausted, capped, status, solution: actual };
};

// --- Ablations ---------------------------------------------------------------

// Throw (with the valid list) if any name is not a known ablation. Call this up
// front so a typo fails before any solving / partial output.
export const validateAblations = (names) => {
  for (const name of names) {
    if (!ABLATIONS[name]) {
      throw new Error(
        `unknown ablation: ${name}\nknown: ${Object.keys(ABLATIONS).join(', ') || '(none)'}`);
    }
  }
};

// Apply the named ablations and return a single restore function. Throws on an
// unknown name (with the list of valid ones) rather than silently no-op-ing.
export const applyAblations = (names) => {
  const restores = names.map((name) => {
    const ablation = ABLATIONS[name];
    if (!ablation) {
      throw new Error(
        `unknown ablation: ${name}\nknown: ${Object.keys(ABLATIONS).join(', ') || '(none)'}`);
    }
    return ablation.apply();
  });
  return () => { for (let i = restores.length - 1; i >= 0; i--) restores[i](); };
};

// --- Handler registry (for the profiler) -------------------------------------

// Map of class name -> handler class, for every handler exported by a registered
// handler module (see extensions/).
export const HANDLERS = (() => {
  const map = {};
  for (const mod of HANDLER_MODULES) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function' && value.prototype &&
        typeof value.prototype.enforceConsistency === 'function') {
        map[name] = value;
      }
    }
  }
  return map;
})();

// All instance methods on a handler's prototype (and its bases up to, but not
// including, the abstract SudokuConstraintHandler) — the default set to profile.
export const handlerMethodNames = (HandlerClass) => {
  const names = new Set();
  for (let proto = HandlerClass.prototype; proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)) {
    // Stop before the abstract base so its generic methods aren't profiled.
    if (proto.constructor && proto.constructor.name === 'SudokuConstraintHandler') break;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      if (typeof proto[name] === 'function') names.add(name);
    }
  }
  return [...names];
};

// --- Small shared formatting --------------------------------------------------

export const COUNTER_COLUMNS = ['status', 'solutions', 'guesses', 'backtracks', 'nodesSearched'];

export const counterRow = (result) =>
  [result.status, result.counters.solutions, result.counters.guesses,
  result.counters.backtracks, result.counters.nodesSearched];
