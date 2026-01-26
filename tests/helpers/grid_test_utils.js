import assert from 'node:assert/strict';

const g = globalThis;
if (!g.self) {
  g.self = g;
}
if (typeof g.VERSION_PARAM === 'undefined') {
  g.VERSION_PARAM = '';
}

const { LookupTables } = await import('../../js/solver/lookup_tables.js');
const { GridShape } = await import('../../js/grid_shape.js');
const { CellExclusions } = await import('../../js/solver/engine.js');

const DEFAULT_NUM_VALUES = 9;
const DEFAULT_NUM_CELLS = 81;

/*
 * Guidance for AIs
 *
 * - Prefer `new GridTestContext({ gridSize, numValues })` so tests always use a real `GridShape`.
 * - Model “line length” scenarios with rectangles:
 *   - short line: `gridSize: [1, N]`, `numValues: M` where `N < M`
 *   - long line:  `gridSize: [1, N]`, `numValues: M` where `N > M`
 * - Prefer `context.initializeHandler(handler)` to avoid boilerplate; pass `{ cellExclusions, state }` only when the test is about them.
 * - `context.grid` is cached per context; use a fresh context when you need an independent grid.
 * - Build candidate masks with `valueMask(...values)` (values are 1-indexed), or via `applyCandidates`.
 * - If something needs a cell count (e.g. `createCellExclusions`), use `context.shape.numCells`.
 * - Consider when the API might evolve; for example if a resetGrid method would be useful on the context.
 * - Update this guidance as needed when you notice common patterns.
 */

const normalizeGridSize = (gridSize) => {
  if (typeof gridSize === 'number') return [gridSize, gridSize];
  if (
    Array.isArray(gridSize) &&
    gridSize.length === 2 &&
    typeof gridSize[0] === 'number' &&
    typeof gridSize[1] === 'number'
  ) {
    return [gridSize[0], gridSize[1]];
  }
  return null;
};

export class GridTestContext {
  constructor({
    gridSize = DEFAULT_NUM_VALUES,
    numValues = null,
    shape,
  } = {}) {
    this.shape = (() => {
      if (shape) return (numValues === null || numValues === undefined) ? shape : shape.withNumValues(numValues);

      const dims = normalizeGridSize(gridSize);
      if (!dims) throw new Error(`Invalid gridSize: ${gridSize}`);
      const [numRows, numCols] = dims;

      const baseShape = GridShape.fromGridSize(numRows, numCols);
      if (!baseShape) throw new Error(`Invalid gridSize: ${gridSize}`);
      return (numValues === null || numValues === undefined) ? baseShape : baseShape.withNumValues(numValues);
    })();

    this.lookupTables = LookupTables.get(this.shape.numValues);

    this._grid = null;
  }

  get grid() {
    if (!this._grid) this._grid = this.createGrid();
    return this._grid;
  }

  initializeHandler(handler, { cellExclusions, state = {} } = {}) {
    const resolvedCellExclusions = cellExclusions ?? createCellExclusions({ numCells: this.shape.numCells });
    return handler.initialize(this.grid, resolvedCellExclusions, this.shape, state);
  }

  createGrid({ fill = this.lookupTables.allValues } = {}) {
    const grid = new Array(this.shape.numCells).fill(fill);
    this._grid = grid;
    return grid;
  }

  _range(n, start = 0) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid range length: ${n}`);
    if (!Number.isInteger(start) || start < 0) throw new Error(`Invalid range start: ${start}`);
    return Array.from({ length: n }, (_, i) => start + i);
  }

  cells(...args) {
    if (args.length === 0) return this._range(this.shape.numCells);

    if (args.length === 1) {
      const [only] = args;
      if (Array.isArray(only)) return [...only];
      if (Number.isInteger(only)) return this._range(only);
    }

    return args;
  }

  row(rowIndex) {
    if (!Number.isInteger(rowIndex)) throw new Error(`Invalid row index: ${rowIndex}`);
    if (rowIndex < 0 || rowIndex >= this.shape.numRows) throw new Error(`Row out of bounds: ${rowIndex}`);
    return this._range(this.shape.numCols, rowIndex * this.shape.numCols);
  }

  col(colIndex) {
    if (!Number.isInteger(colIndex)) throw new Error(`Invalid col index: ${colIndex}`);
    if (colIndex < 0 || colIndex >= this.shape.numCols) throw new Error(`Col out of bounds: ${colIndex}`);
    return Array.from({ length: this.shape.numRows }, (_, r) => r * this.shape.numCols + colIndex);
  }
}

export const valueMask = (...values) => LookupTables.fromValuesArray(values);

export const createAccumulator = () => {
  const touched = new Set();
  return {
    touched,
    addForCell(cell) {
      touched.add(cell);
    },
  };
};

export const createCellExclusions = ({ allUnique = true, numCells = DEFAULT_NUM_CELLS } = {}) => {
  const exclusions = new CellExclusions([], { numCells });

  if (allUnique) {
    for (let i = 0; i < numCells; i++) {
      for (let j = i + 1; j < numCells; j++) {
        exclusions.addMutualExclusion(i, j);
      }
    }
  }

  return exclusions;
};

export const applyCandidates = (grid, assignments) => {
  for (const [cellKey, values] of Object.entries(assignments)) {
    const cellIndex = Number(cellKey);
    if (Array.isArray(values)) {
      grid[cellIndex] = valueMask(...values);
    } else if (typeof values === 'number') {
      grid[cellIndex] = values;
    } else {
      throw new TypeError('Assignments must be arrays of values or numeric bitmasks');
    }
  }
  return grid;
};

