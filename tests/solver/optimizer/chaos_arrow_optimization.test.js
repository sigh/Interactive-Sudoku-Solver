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
const { ChaosConstruction, ChaosMultiArrow } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

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

const initializeHandler = (handler, shape, grid) => handler.initialize(
  grid,
  createCellExclusions({ allUnique: false, numCells: shape.totalCells() }),
  shape,
  createStateAllocator(grid, shape.totalCells()));

await runTest('ChaosMultiArrow prunes impossible control counts', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosMultiArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[regionCells[4]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(2));
});

await runTest('ChaosMultiArrow keeps shorter run when shared prefix has another region choice', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosMultiArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[regionCells[4]] = valueMask(1, 2);
  grid[regionCells[10]] = valueMask(1);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(1, 2));
});

await runTest('ChaosMultiArrow supports region labels beyond line length', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosMultiArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[regionCells[4]] = valueMask(4);
  grid[regionCells[10]] = valueMask(4);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[4], valueMask(2));
});

await runTest('ChaosMultiArrow prunes break cell regions', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosMultiArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

  grid[4] = valueMask(1);
  grid[regionCells[4]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2, 3);

  assert.equal(initializeHandler(handler, shape, grid), true);
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[10]], valueMask(3));
});

await runTest('ChaosMultiArrow symmetrically prunes unsupported prefix region values', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosMultiArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);

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

await runTest('_addChaosRegionShardSources attaches ChaosMultiArrow lines', () => {
  const shape = makeShape();
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const chaosHandler = new ChaosConstruction(shape.numGridCells, regionCells[0]);
  const arrowHandler = new ChaosMultiArrow(4, [[regionCells[4], regionCells[10]]], [[4, 10]]);
  const handlerSet = new HandlerSet([chaosHandler, arrowHandler], shape.totalCells());

  grid[4] = valueMask(2);
  grid[regionCells[10]] = valueMask(2);

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._addChaosRegionShardSources(handlerSet, shape);

  chaosHandler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  assert.equal(initializeHandler(chaosHandler, shape, grid), true);
  assert.equal(chaosHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[10]], valueMask(2));
});

logSuiteComplete('chaos_arrow_optimization.test.js');