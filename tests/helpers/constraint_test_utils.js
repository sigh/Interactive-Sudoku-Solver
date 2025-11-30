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

export const createCellExclusions = () => ({
  isMutuallyExclusive: () => true,
  getPairExclusions: () => [],
  getArray: () => [],
  getListExclusions: () => [],
});

export const initializeConstraintHandler = (
  HandlerCtor,
  {
    args = [],
    shapeConfig,
    cellExclusions = createCellExclusions(),
    state = {},
  } = {}
) => {
  const { shape, lookupTables, createGrid } = setupConstraintTest(shapeConfig ?? {});
  const handler = new HandlerCtor(...args);
  const initialGrid = createGrid();
  assert.equal(
    handler.initialize(initialGrid, cellExclusions, shape, state),
    true,
    'constraint handler should initialize'
  );
  return { handler, lookupTables, shape, createGrid };
};
