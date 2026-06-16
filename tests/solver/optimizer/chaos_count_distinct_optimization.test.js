import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';
import { createCellExclusions } from '../../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
const HandlerModule = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { HandlerSet } = await import('../../../js/solver/engine.js' + self.VERSION_PARAM);
const { ChaosConstruction } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

const makeChaosShape = () => {
  const shape = GridShape.fromGridSize(9);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  return shape;
};

const regionCellsFor = (shape, gridCells) => {
  const regionCells = shape.varCellsForGroup('CC');
  return gridCells.map(c => regionCells[c]);
};

// Builds a handler set with a CountDistinct over the given counted cells, runs
// the optimization, and returns the control cell's capped value list (or null if
// no cap was added).
const capForCountDistinct = (shape, controlCell, countedCells, { withChaos = true } = {}) => {
  const handlers = [];
  if (withChaos) {
    const regionCells = shape.varCellsForGroup('CC');
    handlers.push(new ChaosConstruction(
      shape.numGridCells, regionCells[0], shape.numValues));
  }
  const countHandler = new HandlerModule.CountDistinct(controlCell, countedCells);
  handlers.push(countHandler);

  const handlerSet = new HandlerSet(handlers, shape.totalCells());
  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer._optimizeChaosConstruction(
    handlerSet, shape, (1 << shape.numValues) - 1);

  const givens = handlerSet.getAllofType(HandlerModule.GivenCandidates);
  if (givens.length === 0) return null;
  assert.equal(givens.length, 1);
  return [...givens[0]._valueMap.get(controlCell)];
};

// 3x2 blob: R4C1 R4C2 / R5C1 R5C2 / R6C1 R6C2 (the collections.js case). Only the
// middle-left cell R5C1 is enclosed (no left neighbour, the other three are in
// the set), so one coincidence is forced: at most 5 of the 6 labels are distinct.
await runTest('caps the control of an enclosed region-cell blob', () => {
  const shape = makeChaosShape();
  const blob = [27, 28, 36, 37, 45, 46];
  const cap = capForCountDistinct(shape, 0, regionCellsFor(shape, blob));
  assert.deepEqual(cap, [1, 2, 3, 4, 5]);
});

// Two plus-shapes with disjoint closed neighbourhoods each have an enclosed
// centre, forcing two cell-disjoint coincidences: at most 8 of the 10 distinct.
await runTest('counts disjoint enclosed cells independently', () => {
  const shape = makeChaosShape();
  const plusA = [20, 11, 29, 19, 21];   // centre R3C3
  const plusB = [60, 51, 69, 59, 61];   // centre R7C7
  const cap = capForCountDistinct(shape, 0, regionCellsFor(shape, [...plusA, ...plusB]));
  assert.deepEqual(cap, [1, 2, 3, 4, 5, 6, 7, 8]);
});

// A whole row of region cells has no enclosed cell (the up/down neighbours are
// outside the counted set), so nothing is forced.
await runTest('does not cap a row of region cells', () => {
  const shape = makeChaosShape();
  const row = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(capForCountDistinct(shape, 9, regionCellsFor(shape, row)), null);
});

// The deduction is region-specific: a value-lane counted set is left alone even
// when it would be geometrically enclosed.
await runTest('ignores value-lane counted cells', () => {
  const shape = makeChaosShape();
  const blob = [27, 28, 36, 37, 45, 46];  // grid (value) cells, not CC cells
  assert.equal(capForCountDistinct(shape, 0, blob), null);
});

// Without a ChaosConstruction handler the adjacency fact does not hold.
await runTest('does nothing without Chaos Construction', () => {
  const shape = makeChaosShape();
  const blob = [27, 28, 36, 37, 45, 46];
  const cap = capForCountDistinct(
    shape, 0, regionCellsFor(shape, blob), { withChaos: false });
  assert.equal(cap, null);
});

// A cap of numValues or more would not tighten the handler's own bound, so no
// given is added even though a cell is enclosed.
await runTest('skips caps that do not tighten the handler', () => {
  const shape = makeChaosShape();
  // A single enclosed cell (the plus centred at R2C2) among 11 counted cells:
  // 11 - 1 = 10 >= numValues (9), so capping the count would not tighten anything.
  const cells = [
    1, 9, 10, 11, 19,           // plus centred at R2C2 (index 10)
    4, 5, 6, 7, 8, 13,          // padding cells, none enclosed
  ];
  // Sanity: the centre (10) is the only enclosed cell here.
  assert.equal(capForCountDistinct(shape, 0, regionCellsFor(shape, cells)), null);
});

logSuiteComplete();
