import { SudokuConstraint } from '../sudoku_constraint.js';
import { SudokuParser } from '../sudoku_parser.js';
import { SudokuBuilder } from '../solver/sudoku_builder.js';
import { GridShape, SHAPE_9x9, SHAPE_MAX } from '../grid_shape.js';

const HELP_TEXT = `
=== Constraint Sandbox Help ===

ACCEPTED RETURN VALUES

  Your code should return one of the following:
    - A constraint object (e.g. new Cage(...))
    - A constraint string (e.g. ".Cage~12~R1C1_R1C2_R1C3")
    - An array of constraints or constraint strings
    - Nothing (empty return) to skip solver invocation

CELL IDENTIFIERS

  Cells are identified using 'R{row}C{col}' format, with rows and columns
  starting at 1.
  e.g. 'R1C1' is the top-left cell, 'R9C9' is the bottom-right cell in a 9x9 grid

  The following convenience functions are available for working with cell IDs:
    parseCellId('R3C4')  => { row: 3, col: 4 }
    makeCellId(3, 4)     => 'R3C4'

CONSTRAINT OBJECTS

  Constraint class names match their serialization names. For example:
    new Cage(sum, ...cells)
    new Thermo(...cells)

  The type of a constraint instance c can be found with c.type.

  parseConstraint(constraintString) can parse a constraint string into an array
  of constraint objects. e.g. parseConstraint('.Cage~10~R1C1~R1C2')  => [Cage]

  Use help('<ConstraintName>') for details on a specific constraint.

SOLVER

  makeSolver provides programmatic access to the solver:

    const solver = await makeSolver();
    // Get the first solution, or null if none exist
    const solution = solver.solution(constraints);
    // Get the unique solution, or null if not unique
    const unique = solver.uniqueSolution(constraints);
    // Count the number of solutions
    const count = solver.countSolutions(constraints);
    // Iterate over all solutions, with optional limit
    for (const s of solver.solutions(constraints[, limit])) { ... }
    // Get an array of solutions, with optional limit
    const solutions = solver.solutionArray(constraints[, limit]);

  Solution objects provide:
    solution.valueAt('R1C1')  // Get value at cell
    solution.valueAt(1, 1)    // Same, using row/col
    solution.toString()       // Short string (e.g. 81 digits for 9x9)
    for (const { cell, value } of solution) { ... }  // Iterate cells

  solver.latestStats() returns timing/counter info after each solve.

UTILITIES

  console.log()         - Output to the console
  console.error()       - Output an error to the console
  console.warn()        - Output a warning to the console
  console.info()        - Update status display
  console.table(data)   - Render array of objects as a table
  solverLink(c, t)      - Pass into console.log for clickable link to the solver
                          c: constraint (string, object, or array)
                          t: optional link text (defaults to constraint string)
  help()                - Display this message

LONG RUNNING TASKS

  Async/await is supported for long-running tasks.

  Use extendTimeoutMs(ms) to extend execution timeout (default: Infinity)
`.trim();

const getConstraintList = () => {
  const byCategory = {};
  for (const [name, cls] of Object.entries(SudokuConstraint)) {
    if (typeof cls !== 'function') continue;
    if (!cls.CATEGORY || cls.CATEGORY === 'Experimental') continue;
    (byCategory[cls.CATEGORY] ||= []).push(name);
  }

  let output = '\nCONSTRAINTS BY CATEGORY\n';
  const GROUP_SIZE = 4;
  for (const [category, names] of Object.entries(byCategory).sort()) {
    output += `\n  ${category}:\n`;
    const sorted = names.sort();
    for (let i = 0; i < sorted.length; i += GROUP_SIZE) {
      output += '    ' + sorted.slice(i, i + GROUP_SIZE).join(', ') + '\n';
    }
  }
  return output;
};

const getConstructorArgs = (cls) => {
  const match = String(cls).match(/constructor\s*\(([^)]*)\)/);
  return match?.[1]?.trim() || '';
};

const help = (arg) => {
  const cls = arg && SudokuConstraint[arg];
  if (cls) {
    const args = getConstructorArgs(cls);
    console.log(`${arg}${args ? `(${args})` : ''}`);
    if (cls.DESCRIPTION) {
      console.log('\n  ' + cls.DESCRIPTION.trim().replace(/\s+/g, ' '));
    }
    if (cls.CATEGORY) {
      console.log(`\n  Category: ${cls.CATEGORY}`);
    }
  } else {
    if (arg) {
      console.error(`Unknown constraint: '${arg}'\n`);
    }
    console.log(HELP_TEXT);
    console.log(getConstraintList());
  }
  console.log();
};

const parseCellId = (cellId) => {
  const parsed = SHAPE_MAX.parseCellId(cellId);
  return {
    row: parsed.row + 1,
    col: parsed.col + 1,
  };
};

const makeCellId = (row, col) => SHAPE_MAX.makeCellId(row - 1, col - 1);

const parseConstraint = (str) => {
  const parsed = SudokuParser.parseString(str);
  const resolved = SudokuBuilder.resolveConstraint(parsed);
  // NOTE: This can't be an instanceof check when run inside the sandbox.
  if (resolved.type === SudokuConstraint.Container.name) {
    return resolved.constraints;
  }
  return [resolved];
};

const makeSolver = async () => {
  const { SimpleSolver } = await import('./simple_solver.js');
  return new SimpleSolver();
};

/**
 * Represents a clickable link to the solver with a constraint.
 */
class SolverLink {
  constructor(constraint, text) {
    this.constraint = constraint;
    this.text = text;
  }

  get constraintStr() {
    if (typeof this.constraint === 'string') return this.constraint;
    if (Array.isArray(this.constraint)) {
      return this.constraint.map(c => typeof c === 'string' ? c : c.toString()).join('');
    }
    return this.constraint.toString();
  }
}

/**
 * Create a link to the solver for a constraint.
 * @param {string|object|array} constraint - Constraint string, object, or array
 * @param {string} [text] - Optional link text (defaults to constraint string)
 * @returns {SolverLink}
 */
const solverLink = (constraint, text) => new SolverLink(constraint, text);

/**
 * Format a value for console output.
 * Uses toString() for objects that have a custom implementation (like Solution).
 */
const formatConsoleArg = (a) => {
  if (a == null) return String(a);
  if (typeof a !== 'object') return String(a);
  if (a instanceof SolverLink) return a; // Keep as-is for special handling
  if (typeof a.toString === 'function' && a.toString !== Object.prototype.toString) {
    return a.toString();
  }
  return JSON.stringify(a, null, 2);
};

/**
 * Format a table from an array of objects.
 */
const formatTable = (data, columns) => {
  if (!Array.isArray(data) || data.length === 0) {
    return '(empty table)';
  }
  const keys = columns || Object.keys(data[0]);
  const widths = keys.map(k =>
    Math.max(String(k).length, ...data.map(row => String(row[k] ?? '').length))
  );
  const header = keys.map((k, i) => String(k).padEnd(widths[i])).join(' | ');
  const sep = widths.map(w => '-'.repeat(w)).join('-+-');
  const rows = data.map(row =>
    keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join(' | ')
  );
  return [header, sep, ...rows].join('\n');
};

/**
 * Create sandbox console methods that emit to a callback.
 * @param {function} emit - Callback receiving { type, segments } where segments is an array of strings or { type: 'link', text, constraintStr }
 * @returns {object} Console methods to override
 */
export const createSandboxConsole = (emit) => {
  const format = (...args) => {
    return args.map(a => {
      if (a instanceof SolverLink) {
        const constraintStr = a.constraintStr;
        const text = a.text || constraintStr;
        return { type: 'link', text, constraintStr };
      }
      return formatConsoleArg(a);
    });
  };
  return {
    log: (...args) => emit({ type: 'log', segments: format(...args) }),
    error: (...args) => emit({ type: 'log', segments: ['❌ ', ...format(...args)] }),
    warn: (...args) => emit({ type: 'log', segments: ['⚠️ ', ...format(...args)] }),
    info: (...args) => emit({ type: 'status', segments: format(...args) }),
    table: (data, columns) => emit({ type: 'log', segments: [formatTable(data, columns)] }),
  };
};

/**
 * Run a function with sandbox console overrides.
 * @param {function} emit - Callback receiving { type, text }
 * @param {function} fn - Async function to run
 * @returns {Promise} Result of fn
 */
export const withSandboxConsole = async (emit, fn) => {
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    table: console.table,
  };
  Object.assign(console, createSandboxConsole(emit));
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
};

export const SANDBOX_GLOBALS = {
  parseConstraint,
  parseCellId,
  makeCellId,
  solverLink,
  help,
  makeSolver,
  SHAPE_9x9,
  SHAPE_MAX,
  GridShape,
  ...SudokuConstraint,
};