import assert from 'node:assert/strict';

const g = globalThis;
if (!g.self) {
  g.self = g;
}
if (typeof g.VERSION_PARAM === 'undefined') {
  g.VERSION_PARAM = '';
}

const { LookupTables } = await import('../../js/solver/lookup_tables.js');

const DEFAULT_NUM_VALUES = 9;
const DEFAULT_NUM_CELLS = 81;

export const setupConstraintTest = ({
  numValues = DEFAULT_NUM_VALUES,
  numCells = DEFAULT_NUM_CELLS,
} = {}) => {
  const shape = { numValues, numCells };
  const lookupTables = LookupTables.get(numValues);
  const createGrid = () => new Uint16Array(shape.numCells).fill(lookupTables.allValues);
  return { shape, lookupTables, createGrid };
};

export const mask = (...values) => LookupTables.fromValuesArray(values);

export const createAccumulator = () => {
  const touched = new Set();
  return {
    touched,
    addForCell(cell) {
      touched.add(cell);
    },
  };
};

export const createCellExclusions = ({ allUnique = true } = {}) => ({
  isMutuallyExclusive: allUnique ? () => true : () => false,
  getPairExclusions: () => [],
  getArray: () => [],
  getListExclusions: () => [],
});

export const applyCandidates = (grid, assignments) => {
  for (const [cellKey, values] of Object.entries(assignments)) {
    const cellIndex = Number(cellKey);
    if (Array.isArray(values)) {
      grid[cellIndex] = mask(...values);
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
