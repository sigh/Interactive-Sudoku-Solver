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

const {
  SudokuConstraintOptimizer,
  CHAOS_REGION_RUN_ENCODED_NFA,
} = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { NFAConstraint } = await import('../../../js/solver/nfa_handler.js' + self.VERSION_PARAM);
const { ChaosConstruction } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

const fakeCompressedNFA = () => ({
  numStates: 1,
  acceptingStates: null,
  startingStates: null,
  transitionLists: [],
});

const makeChaosRunContext = (encodedNFA) => {
  const shape = GridShape.fromGridSpec('4x4');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const grid = new Uint16Array(
    shape.totalCells() + shape.numGridCells * 2 + shape.numGridCells / shape.numValues);
  grid.fill(LookupTables.get(shape.numValues).allValues, 0, shape.totalCells());
  grid[4] = valueMask(2);

  const regionCells = shape.varCellsForGroup('CC');
  grid[regionCells[5]] = valueMask(2);
  const chaosHandler = new ChaosConstruction(shape.numGridCells, regionCells[0]);
  const nfaHandler = new NFAConstraint(
    [4, regionCells[4], regionCells[5]],
    fakeCompressedNFA(),
    encodedNFA);
  const handlerSet = new HandlerSet([chaosHandler, nfaHandler], shape.totalCells());

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._addChaosRegionShardSources(handlerSet, shape);

  const cellExclusions = createCellExclusions({
    allUnique: false,
    numCells: shape.totalCells(),
  });
  chaosHandler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  const initialized = chaosHandler.initialize(
    grid, cellExclusions, shape, createStateAllocator(grid, shape.totalCells()));
  assert.equal(initialized, true);

  return { chaosHandler, grid, regionCells };
};

await runTest('_addChaosRegionShardSources attaches exact encoded Chaos run NFA lines', () => {
  const { chaosHandler, grid, regionCells } = makeChaosRunContext(CHAOS_REGION_RUN_ENCODED_NFA);
  const accumulator = createAccumulator();

  assert.equal(chaosHandler.enforceConsistency(grid, accumulator), true);
  assert.equal(grid[regionCells[4]], valueMask(2));
  assert.equal(grid[regionCells[5]], valueMask(2));
});

await runTest('_addChaosRegionShardSources ignores non-matching encoded NFA lines', () => {
  const { chaosHandler, grid } = makeChaosRunContext('not-the-chaos-region-run-machine');
  const accumulator = createAccumulator();

  assert.equal(chaosHandler.enforceConsistency(grid, accumulator), true);
  assert.equal(grid[4], valueMask(2));
});

logSuiteComplete('chaos_region_run_optimization.test.js');
