import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';
import {
  createAccumulator,
  createCellExclusions,
  createStateAllocator,
  valueMask,
} from '../../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { ChaosConstruction, ChaosArrow } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

const makeChaosGrid = (shape) => {
  const grid = new Uint16Array(
    shape.totalCells() + shape.numGridCells * 2 + shape.numGridCells / shape.numValues);
  grid.fill(LookupTables.get(shape.numValues).allValues, 0, shape.totalCells());
  return grid;
};

const makeShape = () => {
  const shape = GridShape.fromGridSpec('4x4');
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  return shape;
};

const initializeHandler = (handler, shape, grid) => {
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: shape.totalCells() });
  const stateAllocator = createStateAllocator(grid, shape.totalCells());
  if (handler.attachRegionShardState) {
    const regionCells = shape.varCellsForGroup('CC');
    const chaosHandler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
    chaosHandler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
    assert.equal(chaosHandler.initialize(grid, cellExclusions, shape, stateAllocator), true);
    handler.attachRegionShardState(chaosHandler.regionShardState());
  }
  return handler.initialize(grid, cellExclusions, shape, stateAllocator);
};

await runTest('ChaosArrow prunes impossible control counts', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[regionCells[4]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(2));
});

await runTest('ChaosArrow keeps shorter run when shared prefix has another region choice', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[regionCells[4]] = valueMask(1, 2);
  grid[regionCells[10]] = valueMask(1);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(1, 2));
});

await runTest('ChaosArrow supports region labels beyond line length', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[regionCells[4]] = valueMask(4);
  grid[regionCells[10]] = valueMask(4);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(2));
});

await runTest('ChaosArrow prunes break cell regions', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[4] = valueMask(1);
  grid[regionCells[4]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2, 3);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[10]], valueMask(3));
});

await runTest('ChaosArrow symmetrically prunes unsupported prefix region values', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  // With control fixed to a 1-cell run, region=1 is impossible because the
  // boundary cell is also fixed to region=1 and must differ from the run.
  grid[4] = valueMask(1);
  grid[regionCells[4]] = valueMask(1, 2);
  grid[regionCells[10]] = valueMask(1);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[10]], valueMask(1));
});

await runTest('_addChaosRegionShardSources attaches ChaosArrow lines', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const chaosHandler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
  const arrowHandler = new ChaosArrow(4, [[regionCells[4], regionCells[5]]], [[4, 5]]);
  const handlerSet = new HandlerSet([chaosHandler, arrowHandler], shape.totalCells());

  grid[4] = valueMask(2);
  grid[regionCells[5]] = valueMask(2);

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._addChaosRegionShardSources(handlerSet, shape, LookupTables.get(shape.numValues).allValues);

  chaosHandler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  const stateAllocator = createStateAllocator(grid, shape.totalCells());
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: shape.totalCells() });
  assert.equal(chaosHandler.initialize(grid, cellExclusions, shape, stateAllocator), true);
  assert.equal(arrowHandler.initialize(grid, cellExclusions, shape, stateAllocator), true);
  assert.equal(arrowHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(chaosHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[5]], valueMask(2));
});

await runTest('_addChaosRegionShardSources attaches multi-arm guaranteed prefixes', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const chaosHandler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
  const arrowHandler = new ChaosArrow(
    4,
    [[regionCells[4], regionCells[5], regionCells[6]], [regionCells[4], regionCells[8]]],
    [[4, 5, 6], [4, 8]]);
  const handlerSet = new HandlerSet([chaosHandler, arrowHandler], shape.totalCells());

  grid[4] = valueMask(3);
  grid[regionCells[5]] = valueMask(2);

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._addChaosRegionShardSources(handlerSet, shape, LookupTables.get(shape.numValues).allValues);

  chaosHandler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  const stateAllocator = createStateAllocator(grid, shape.totalCells());
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: shape.totalCells() });
  assert.equal(chaosHandler.initialize(grid, cellExclusions, shape, stateAllocator), true);
  assert.equal(arrowHandler.initialize(grid, cellExclusions, shape, stateAllocator), true);
  assert.equal(arrowHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(chaosHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[5]], valueMask(2));
});

logSuiteComplete('chaos_arrow_optimization.test.js');