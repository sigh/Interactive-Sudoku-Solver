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
const { BitSet } = await import('../../js/util.js');

const DEFAULT_NUM_VALUES = 9;
const DEFAULT_NUM_CELLS = 81;

export const setupConstraintTest = ({
  gridSize,
  numValues = DEFAULT_NUM_VALUES,
  numCells = DEFAULT_NUM_CELLS,
  shape,
} = {}) => {
  const resolvedShape = (() => {
    if (shape) return shape;
    if (typeof gridSize !== 'undefined') {
      const s = GridShape.fromGridSize(gridSize);
      if (!s) throw new Error(`Invalid gridSize: ${gridSize}`);
      return s;
    }

    const inferredGridSize = Math.sqrt(numCells);
    if (Number.isInteger(inferredGridSize) && inferredGridSize === numValues) {
      return GridShape.fromGridSize(inferredGridSize);
    }

    return { numValues, numCells };
  })();

  const lookupTables = LookupTables.get(resolvedShape.numValues);
  const createGrid = () => new Uint16Array(resolvedShape.numCells).fill(lookupTables.allValues);
  return { shape: resolvedShape, lookupTables, createGrid };
};

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
  const cache = new Array(numCells);

  return {
    isMutuallyExclusive: allUnique ? (a, b) => a !== b : () => false,
    getPairExclusions: () => [],
    getListExclusions: () => [],
    getArray: (cell) => {
      if (!allUnique) return [];
      const out = [];
      for (let i = 0; i < numCells; i++) {
        if (i !== cell) out.push(i);
      }
      return out;
    },
    getBitSet: (cell) => {
      let bs = cache[cell];
      if (!bs) {
        bs = new BitSet(numCells);
        if (allUnique) {
          for (let i = 0; i < numCells; i++) {
            if (i !== cell) bs.add(i);
          }
        }
        cache[cell] = bs;
      }
      return bs;
    },
  };
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

export const initializeConstraintHandler = (
  HandlerCtor,
  {
    args = [],
    context,
    shapeConfig,
    cellExclusions = createCellExclusions(),
    state = {},
  } = {}
) => {
  const resolvedContext = context ?? setupConstraintTest(shapeConfig ?? {});
  const handler = new HandlerCtor(...args);
  const initialGrid = resolvedContext.createGrid();
  assert.equal(
    handler.initialize(initialGrid, cellExclusions, resolvedContext.shape, state),
    true,
    'constraint handler should initialize'
  );
  return { handler, context: resolvedContext };
};
