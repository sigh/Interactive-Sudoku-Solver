import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { BoxRegionInfo } = await import('../../js/solver/handlers.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

const buildHandlers = (constraint) => {
  const geometry = constraint.getGeometry();
  const constraintMap = constraint.toMap();
  geometry.addVarCellsForConstraints([].concat(...constraintMap.values()));
  return [...SudokuBuilder._handlers(constraintMap, geometry)];
};

await runTest('BoxRegionInfo: boxRegions returns the regions passed to the constructor', () => {
  const regions = [[0, 1, 2], [3, 4, 5]];
  const handler = new BoxRegionInfo(regions);
  assert.equal(handler.boxRegions(), regions);
});

await runTest('BoxRegionInfo: has no cells and behaves as a no-op handler', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new BoxRegionInfo([]);

  assert.equal(handler.cells.length, 0);
  assert.equal(context.initializeHandler(handler), true);
  assert.equal(handler.enforceConsistency(context.grid, createAccumulator()), true);
});

await runTest('BoxRegionInfo: default 9x9 boxes are the nine 3x3 regions', () => {
  const constraint = new SudokuConstraint.Container([]);
  const handlers = buildHandlers(constraint);
  const handler = handlers.find(h => h instanceof BoxRegionInfo);

  const regions = handler.boxRegions();
  assert.equal(regions.length, 9);
  assert.deepEqual(Array.from(regions[0]), [0, 1, 2, 9, 10, 11, 18, 19, 20]);
});

await runTest('BoxRegionInfo: NoBoxes constraint produces an empty boxRegions list', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.NoBoxes(),
  ]);
  const handlers = buildHandlers(constraint);
  const handler = handlers.find(h => h instanceof BoxRegionInfo);

  assert.deepEqual(handler.boxRegions(), []);
});

await runTest('BoxRegionInfo: a cell group shape produces an empty boxRegions list', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('VA', '4'),
    new SudokuConstraint.Var('A', '', '2x2'),
  ]);
  const handlers = buildHandlers(constraint);
  const handler = handlers.find(h => h instanceof BoxRegionInfo);

  assert.deepEqual(handler.boxRegions(), []);
});

logSuiteComplete('box_region_info.test.js');
