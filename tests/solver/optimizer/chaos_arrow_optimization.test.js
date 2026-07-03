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
const { CellGeometry } = await import('../../../js/cell_geometry.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { ChaosConstruction, ChaosArrow } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

const makeChaosGrid = (geometry) => {
  const grid = new Uint16Array(
    geometry.totalCells() + geometry.numGridCells * 2 + geometry.numGridCells / geometry.numValues);
  grid.fill(LookupTables.get(geometry.numValues).allValues, 0, geometry.totalCells());
  return grid;
};

const makeShape = () => {
  const geometry = CellGeometry.fromShapeSpec('4x4');
  geometry.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  return geometry;
};

const initializeHandler = (handler, geometry, grid) => {
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: geometry.totalCells() });
  const stateAllocator = createStateAllocator(grid, geometry.totalCells());
  if (handler.attachRegionShardState) {
    const regionCells = geometry.varCellsForGroup('CC');
    const chaosHandler = new ChaosConstruction(geometry.numGridCells, regionCells[0], geometry.numValues);
    chaosHandler.selectPriorityAnchorCells(geometry, new Int32Array(geometry.totalCells()));
    assert.equal(chaosHandler.initialize(grid, cellExclusions, geometry, stateAllocator), true);
    handler.attachRegionShardState(chaosHandler.regionShardState());
  }
  return handler.initialize(grid, cellExclusions, geometry, stateAllocator);
};

await runTest('ChaosArrow prunes impossible control counts', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]], 0);

  grid[regionCells[4]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2);

  assert.equal(initializeHandler(handler, geometry, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(2));
});

await runTest('ChaosArrow keeps shorter run when shared prefix has another region choice', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]], 0);

  grid[regionCells[4]] = valueMask(1, 2);
  grid[regionCells[10]] = valueMask(1);

  assert.equal(initializeHandler(handler, geometry, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(1, 2));
});

await runTest('ChaosArrow supports region labels beyond line length', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]], 0);

  grid[regionCells[4]] = valueMask(4);
  grid[regionCells[10]] = valueMask(4);

  assert.equal(initializeHandler(handler, geometry, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(2));
});

await runTest('ChaosArrow prunes break cell regions', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]], 0);

  grid[4] = valueMask(1);
  grid[regionCells[4]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2, 3);

  assert.equal(initializeHandler(handler, geometry, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[10]], valueMask(3));
});

await runTest('ChaosArrow symmetrically prunes unsupported prefix region values', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const handler = new ChaosArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]], 0);

  // With control fixed to a 1-cell run, region=1 is impossible because the
  // boundary cell is also fixed to region=1 and must differ from the run.
  grid[4] = valueMask(1);
  grid[regionCells[4]] = valueMask(1, 2);
  grid[regionCells[10]] = valueMask(1);

  assert.equal(initializeHandler(handler, geometry, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[10]], valueMask(1));
});

await runTest('_addChaosRegionShardSources attaches ChaosArrow lines', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const chaosHandler = new ChaosConstruction(geometry.numGridCells, regionCells[0], geometry.numValues);
  const arrowHandler = new ChaosArrow(4, [[regionCells[4], regionCells[5]]], [[4, 5]], 0);
  const handlerSet = new HandlerSet([chaosHandler, arrowHandler], geometry.totalCells());

  grid[4] = valueMask(2);
  grid[regionCells[5]] = valueMask(2);

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._optimizeChaosConstruction(
    handlerSet, geometry, LookupTables.get(geometry.numValues).allValues);

  chaosHandler.selectPriorityAnchorCells(geometry, new Int32Array(geometry.totalCells()));
  const stateAllocator = createStateAllocator(grid, geometry.totalCells());
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: geometry.totalCells() });
  assert.equal(chaosHandler.initialize(grid, cellExclusions, geometry, stateAllocator), true);
  assert.equal(arrowHandler.initialize(grid, cellExclusions, geometry, stateAllocator), true);
  assert.equal(arrowHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(chaosHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[5]], valueMask(2));
});

await runTest('_addChaosRegionShardSources attaches multi-arm guaranteed prefixes', () => {
  const geometry = makeShape();
  const grid = makeChaosGrid(geometry);
  const regionCells = geometry.varCellsForGroup('CC');
  const chaosHandler = new ChaosConstruction(geometry.numGridCells, regionCells[0], geometry.numValues);
  const arrowHandler = new ChaosArrow(
    4,
    [[regionCells[4], regionCells[5], regionCells[6]], [regionCells[4], regionCells[8]]],
    [[4, 5, 6], [4, 8]], 0);
  const handlerSet = new HandlerSet([chaosHandler, arrowHandler], geometry.totalCells());

  grid[4] = valueMask(3);
  grid[regionCells[5]] = valueMask(2);

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._optimizeChaosConstruction(
    handlerSet, geometry, LookupTables.get(geometry.numValues).allValues);

  chaosHandler.selectPriorityAnchorCells(geometry, new Int32Array(geometry.totalCells()));
  const stateAllocator = createStateAllocator(grid, geometry.totalCells());
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: geometry.totalCells() });
  assert.equal(chaosHandler.initialize(grid, cellExclusions, geometry, stateAllocator), true);
  assert.equal(arrowHandler.initialize(grid, cellExclusions, geometry, stateAllocator), true);
  assert.equal(arrowHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(chaosHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[5]], valueMask(2));
});

logSuiteComplete('chaos_arrow_optimization.test.js');