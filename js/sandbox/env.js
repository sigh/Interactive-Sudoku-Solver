const { SudokuConstraint } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const { SEGMENT_BREAK } = await import('../nfa_builder.js' + self.VERSION_PARAM);
const { CellGeometry, CellGraph, GEOMETRY_9x9, GEOMETRY_MAX } = await import('../cell_geometry.js' + self.VERSION_PARAM);
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
  const parsed = GEOMETRY_MAX.parseCellId(cellId);
  return {
    row: parsed.row + 1,
    col: parsed.col + 1,
  };
};

const makeCellId = (rowOrCell, col) => {
  const { row, col: resolvedCol } =
    typeof rowOrCell === 'object' && rowOrCell !== null
      ? rowOrCell
      : { row: rowOrCell, col };
  return GEOMETRY_MAX.makeCellId(row - 1, resolvedCol - 1);
};

// Resolve a lenient shape argument to a CellGeometry:
//   - a grid size: cellGeometry(9) => 9x9, cellGeometry(6, 9) => 6 rows x 9 cols
//   - a CellGeometry                       (returned as-is)
//   - a shape spec string, e.g. '6x6'
//   - a Shape constraint (or any object carrying a shapeSpec)
//   - nothing                           (the default grid)
const cellGeometry = (geometrySource, numCols) => {
  if (typeof geometrySource === 'number') {
    const geometry = CellGeometry.fromGridSize(geometrySource, numCols);
    if (!geometry) {
      throw new Error(`Invalid grid size: ${geometrySource}x${numCols ?? geometrySource}`);
    }
    return geometry;
  }
  if (geometrySource && typeof geometrySource.cellGraph === 'function') return geometrySource;
  const spec = typeof geometrySource === 'string' ? geometrySource
    : geometrySource && typeof geometrySource === 'object' ? geometrySource.shapeSpec ?? null
      : null;
  // Nothing (or an object with no shapeSpec) means the default grid.
  return spec ? CellGeometry.fromShapeSpec(spec) : CellGeometry.newDefault();
};

// A cell-id view over a geometry's CellGraph. The underlying graph works in
// integer indices; this exposes the sandbox-useful operations in 'RxCy' terms.
class SandboxCellGraph {
  constructor(geometry) {
    this._geometry = geometry;
    this._graph = geometry.cellGraph();
  }

  _index(cellId) {
    return this._geometry.parseCellId(cellId).cellIndex;
  }
  _cell(cellIndex) {
    return cellIndex == null ? null : this._geometry.makeCellIdFromIndex(cellIndex);
  }

  // CellLocator: id <-> index over this graph's own cells.
  parseCellId(cellId) { return { cellIndex: this._index(cellId) }; }
  makeCellIdFromIndex(cellIndex) { return this._cell(cellIndex); }

  // The underlying grid CellGeometry
  gridGeometry() { return this._geometry; }

  // Every cell of the main grid, row-major, excluding var cells.
  cells() {
    const cells = [];
    for (let i = 0; i < this._geometry.numGridCells; i++) cells.push(this._cell(i));
    return cells;
  }

  // The orthogonally-adjacent in-grid cells.
  neighbours(cell) {
    return this._graph.cellEdges(this._index(cell))
      .filter(i => i != null).map(i => this._cell(i));
  }

  // The up-to-eight cells a chess king could reach: the orthogonal and diagonal
  // neighbours that lie on the grid, in row-major order.
  kingNeighbours(cell) {
    const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const index = this._index(cell);
    return KING.map(([dRow, dCol]) => this._cell(this._graph.traverse(index, dRow, dCol)))
      .filter(c => c != null);
  }

  // The cell (dRow, dCol) away, or null past the grid edge. Steps are signed,
  // so step(cell, 1, 1) is the down-right diagonal.
  step(cell, dRow, dCol) {
    return this._cell(this._graph.traverse(this._index(cell), dRow, dCol));
  }

  // Cells from `cell` to the grid edge along (dRow, dCol), inclusive of `cell`.
  ray(cell, dRow, dCol) {
    const cells = [];
    for (let i = this._index(cell); i != null; i = this._graph.traverse(i, dRow, dCol)) {
      cells.push(this._cell(i));
    }
    return cells;
  }

  // The whole grid row through `cell`, left to right.
  row(cell) {
    const leftward = this.ray(cell, 0, -1);
    return this.ray(leftward[leftward.length - 1], 0, 1);
  }

  // The whole grid column through `cell`, top to bottom.
  column(cell) {
    const upward = this.ray(cell, -1, 0);
    return this.ray(upward[upward.length - 1], 1, 0);
  }

  // The cells of a numRows x numCols block with topLeft as its top-left corner,
  // row-major, or null if the block runs off the grid. Walks one step at a time
  // in index space rather than re-traversing from topLeft for every cell.
  block(topLeft, numRows, numCols) {
    const cells = [];
    let rowStart = this._index(topLeft);
    for (let r = 0; r < numRows; r++) {
      let cellIndex = rowStart;
      for (let c = 0; c < numCols; c++) {
        if (cellIndex == null) return null;
        cells.push(this._cell(cellIndex));
        cellIndex = this._graph.traverse(cellIndex, 0, 1);    // step right
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

  // A cell graph over a var-cell group, paired 1:1 with an ordered list of grid
  // cells (default: the whole grid). `prefix` is the var group's id
  // prefix, e.g. 'CC' for chaos construction or 'VL' for a Var('L', ...).
  // this is a standalone view, it does not add the var cells to this graph.
  makeOverlay(prefix, cells = this.cells()) {
    return new SandboxOverlay(this, prefix, cells);
  }
}

// A cell graph in its own right whose cells are a var-cell group: the nth grid
// cell is shadowed by the nth var cell (`${prefix}${n}`), and two var cells are
// adjacent iff their grid cells are. So neighbours()/step()/ray()/row()/etc all
// work over the var cells, and at()/gridAt() cross between a var cell and the
// grid cell it shadows.
class SandboxOverlay extends SandboxCellGraph {
  constructor(parent, prefix, gridCells) {
    super(parent._geometry);

    // Everything is indexed by position: the nth grid cell and nth var cell are a
    // pair. Two arrays (pos -> cell) and two maps (cell -> pos) give O(1) both ways.
    this._prefix = prefix;
    this._gridCells = gridCells;
    this._cells = gridCells.map((_, i) => `${prefix}${i + 1}`);
    this._gridPos = new Map(gridCells.map((cell, i) => [cell, i]));
    this._varPos = new Map(this._cells.map((varCell, i) => [varCell, i]));

    // Connect the overlay cells exactly as their grid cells connect. An off-grid
    // or unpaired neighbour maps to no position, so has no edge.
    const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];   // LEFT, RIGHT, UP, DOWN
    const adjacency = gridCells.map(gridCell => DIRS.map(([dRow, dCol]) =>
      this._gridPos.get(parent.step(gridCell, dRow, dCol)) ?? null));
    this._graph = new CellGraph(adjacency);
  }

  // Translate ids for the inherited graph methods, which run over the overlay's
  // own cells indexed by position.
  _index(cellId) {
    const pos = this._varPos.get(cellId);
    if (pos === undefined) throw new Error(`Cell not in overlay: ${cellId}`);
    return pos;
  }
  _cell(cellIndex) {
    return cellIndex == null ? null : this._cells[cellIndex];
  }

  // The overlay's cells (the var cells), in grid order.
  cells() { return [...this._cells]; }

  // The var cell shadowing `gridCell`, or null if `gridCell` has no overlay cell.
  at(gridCell) {
    const pos = this._gridPos.get(gridCell);
    return pos === undefined ? null : this._cells[pos];
  }

  // The grid cell shadowed by `varCell`, or null if `varCell` isn't in the overlay.
  gridAt(varCell) {
    const pos = this._varPos.get(varCell);
    return pos === undefined ? null : this._gridCells[pos];
  }

  // The Var constraint that registers this overlay's cells.
  toVar(label) {
    if (this._prefix[0] !== 'V' || this._prefix.length < 2) {
      throw new Error(`toVar() needs a 'V'-prefixed overlay, got: '${this._prefix}'`);
    }
    const name = this._prefix.slice(1);
    return new SudokuConstraint.Var(name, label ?? name, this._cells.length);
  }
}

// A SandboxCellGraph for a geometry. The argument is passed through cellGeometry(), so
// it accepts a shape spec, Shape constraint, CellGeometry, or nothing for the default.
const cellGraph = (geometryLike, numCols) =>
  new SandboxCellGraph(cellGeometry(geometryLike, numCols));

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
  cellGeometry,
  cellGraph,
  solverLink,
  help,
  makeSolver,
  SolverStats,
  GEOMETRY_9x9,
  GEOMETRY_MAX,
  CellGeometry,
  extendTimeoutMs: () => {
    console.error('extendTimeoutMs is deprecated, sandbox has no timeout.');
  },
  SEGMENT_BREAK,
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

  const currentCellGeometry = () => {
    return parseConstraint()?.getGeometry();
  };

  return { currentConstraint, currentCellGeometry };
};
