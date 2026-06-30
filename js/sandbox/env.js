const { SudokuConstraint } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const { GridShape, SHAPE_9x9, SHAPE_MAX } = await import('../grid_shape.js' + self.VERSION_PARAM);
const { SolverStats } = await import('./solver_stats.js' + self.VERSION_PARAM);
const { SANDBOX_HELP_TEXT } = await import('./help_text.js' + self.VERSION_PARAM);

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

const printHelpForResolved = ({ name, cls }) => {
  const args = getConstructorArgs(cls);
  console.log(`${name}${args ? `(${args})` : ''}`);
  if (cls.DESCRIPTION) {
    console.log('\n  ' + cls.DESCRIPTION.trim().replace(/\s+/g, ' '));
  }
  if (cls.CATEGORY) {
    console.log(`\n  Category: ${cls.CATEGORY}`);
  }
  console.log();
};

const normalizeToConstraint = (arg) => {
  if (Array.isArray(arg)) {
    const constraintStr = arg.map(v => v.toString()).join('');
    return SudokuParser.parseString(constraintStr);
  }

  if (typeof arg === 'string') {
    return SudokuParser.parseString(arg);
  }

  return arg;
};

const help = (arg) => {
  if (!arg) {
    console.log(SANDBOX_HELP_TEXT);
    console.log();
    return;
  }

  if (arg === 'list') {
    console.log(getConstraintList());
    console.log();
    return;
  }

  // Handle explicit constraint type requests separately.
  if (SudokuConstraint[arg]) {
    printHelpForResolved({ name: arg, cls: SudokuConstraint[arg] });
    return;
  }
  if (SudokuConstraint[arg?.name]) {
    printHelpForResolved({ name: arg.name, cls: SudokuConstraint[arg.name] });
    return;
  }

  try {
    const constraint = normalizeToConstraint(arg);
    const types = [...constraint.toMap().keys()].sort();

    if (types.length) {
      for (const type of types) {
        printHelpForResolved({ name: type, cls: SudokuConstraint[type] });
      }
      return;
    }
  } catch (e) {
    console.error('help(): ' + String(e?.message || e));
    console.log();
    return;
  }

  console.error(`help(): Unknown constraint: '${arg}'\n`);
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

// Resolve a lenient shape argument to a GridShape:
//   - a GridShape                       (returned as-is)
//   - a grid spec string, e.g. '6x6'
//   - a Shape constraint (or any object carrying a gridSpec)
//   - nothing                           (the default grid)
const shape = (shapeSpec) => {
  if (shapeSpec && typeof shapeSpec.cellGraph === 'function') return shapeSpec;
  const gridSpec = typeof shapeSpec === 'string' ? shapeSpec
    : shapeSpec && typeof shapeSpec === 'object' ? shapeSpec.gridSpec ?? null
      : null;
  return SudokuConstraint.Shape.getShapeFromGridSpec(gridSpec);
};

// A cell-id view over a shape's CellGraph. The underlying graph works in integer
// indices; this exposes the sandbox-useful operations in 'RxCy' terms.
class SandboxCellGraph {
  constructor(gridShape) {
    this._shape = gridShape;
    this._graph = gridShape.cellGraph();
  }

  _index(cell) { return this._shape.parseCellId(cell).cell; }
  _cell(index) { return index == null ? null : this._shape.makeCellIdFromIndex(index); }

  // The orthogonally-adjacent in-grid cells.
  neighbours(cell) {
    return this._graph.cellEdges(this._index(cell))
      .filter(i => i != null).map(i => this._cell(i));
  }

  // The cell (dRow, dCol) away, or null past the grid edge. Steps are signed,
  // so step(cell, 1, 1) is the down-right diagonal.
  step(cell, dRow, dCol) {
    return this._cell(this._graph.traverse(this._index(cell), dRow, dCol));
  }

  // Cells from `cell` to the grid edge along (dRow, dCol), inclusive of `cell`.
  ray(cell, dRow, dCol) {
    const cells = [];
    for (let c = cell; c != null; c = this.step(c, dRow, dCol)) cells.push(c);
    return cells;
  }

  // The cells of a numRows x numCols block with topLeft as its top-left corner,
  // row-major, or null if the block runs off the grid. Walks one step at a time
  // in index space rather than re-traversing from topLeft for every cell.
  block(topLeft, numRows, numCols) {
    const cells = [];
    let rowStart = this._index(topLeft);
    for (let r = 0; r < numRows; r++) {
      let cell = rowStart;
      for (let c = 0; c < numCols; c++) {
        if (cell == null) return null;
        cells.push(this._cell(cell));
        cell = this._graph.traverse(cell, 0, 1);    // step right
      }
      rowStart = this._graph.traverse(rowStart, 1, 0);   // step down
    }
    return cells;
  }

  // Whether the cells form a single orthogonally-connected group.
  connected(cells) {
    const indices = new Set([...cells].map(c => this._index(c)));
    return indices.size === 0 || this._graph.cellsAreConnected(indices);
  }
}

// A SandboxCellGraph for a shape. The argument is passed through shape(), so it
// accepts a grid spec, Shape constraint, GridShape, or nothing for the default.
const cellGraph = (shapeSpec) => new SandboxCellGraph(shape(shapeSpec));

const parseConstraint = (str) => {
  const parsed = SudokuParser.parseString(str);
  // NOTE: This can't be an instanceof check when run inside the sandbox.
  if (parsed.type === SudokuConstraint.Container.name) {
    return parsed.constraints;
  }
  return [parsed];
};

const makeSolver = async () => {
  const { SimpleSolver } = await import('./simple_solver.js' + self.VERSION_PARAM);
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
  if (a === null) return String(a);
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
  shape,
  cellGraph,
  solverLink,
  help,
  makeSolver,
  SolverStats,
  SHAPE_9x9,
  SHAPE_MAX,
  GridShape,
  extendTimeoutMs: () => {
    console.error('extendTimeoutMs is deprecated, sandbox has no timeout.');
  },
  ...SudokuConstraint,
};

export const getSandboxExtraGlobals = (currentConstraintStr) => {
  let cachedParsedConstraint;

  const parseConstraint = () => {
    if (cachedParsedConstraint !== undefined) return cachedParsedConstraint;

    if (typeof currentConstraintStr === 'string') {
      cachedParsedConstraint = SudokuParser.parseString(currentConstraintStr);
    } else {
      cachedParsedConstraint = null;
    }

    return cachedParsedConstraint;
  };

  const currentConstraint = () => {
    const parsedConstraint = parseConstraint();
    if (!parsedConstraint) return null;
    if (parsedConstraint.type === SudokuConstraint.Container.name) {
      return parsedConstraint.constraints;
    }
    return [parsedConstraint];
  };

  const currentShape = () => {
    return parseConstraint()?.getShape();
  };

  return { currentConstraint, currentShape };
};
