import { SudokuConstraint } from '../sudoku_constraint.js';
import { SudokuParser } from '../sudoku_parser.js';
import { SudokuBuilder } from '../solver/sudoku_builder.js';
import { GridShape, SHAPE_9x9, SHAPE_MAX } from '../grid_shape.js';
import { SANDBOX_HELP_TEXT } from './help_text.js';

export const getConstraintList = () => {
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
  } else if (arg === 'list') {
    console.log(getConstraintList());
  } else {
    if (arg) {
      console.error(`Unknown constraint: '${arg}'\n`);
    }
    console.log(SANDBOX_HELP_TEXT);
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

  constraintStr() {
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

const toSegments = (...args) => {
  return args.map(a => {
    if (a instanceof SolverLink) {
      const constraintStr = a.constraintStr();
      const text = a.text || constraintStr;
      return { type: 'link', text, constraintStr };
    }
    return formatConsoleArg(a);
  });
};

const formatTableSegment = (data, columns) => {
  if (!Array.isArray(data)) {
    return toSegments(data, columns);
  }

  if (data.length === 0) {
    return '(empty table)';
  }

  const keys = columns?.length
    ? columns
    : (data[0] && typeof data[0] === 'object')
      ? Object.keys(data[0])
      : ['value'];

  const rows = data.map((row) => {
    const obj = row && typeof row === 'object' ? row : { value: row };
    return keys.map((k) => toSegments(obj[k]));
  });

  return { type: 'table', columns: keys, rows };
};

/**
 * Create sandbox console methods that emit to a callback.
 * @param {function} emit - Callback receiving { type, segments } where segments is an array of strings or { type: 'link', text, constraintStr }
 * @returns {object} Console methods to override
 */
export const createSandboxConsole = (emit) => {
  return {
    log: (...args) => emit({ type: 'log', segments: toSegments(...args) }),
    error: (...args) => emit({ type: 'log', segments: ['❌ ', ...toSegments(...args)] }),
    warn: (...args) => emit({ type: 'log', segments: ['⚠️ ', ...toSegments(...args)] }),
    info: (...args) => emit({ type: 'status', segments: toSegments(...args) }),
    table: (data, columns) => emit({ type: 'log', segments: [formatTableSegment(data, columns)] }),
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