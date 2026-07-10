import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext, createAccumulator } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { JigsawPiece } = await import('../../js/solver/handlers.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

const buildHandlers = (constraint) => {
  const geometry = constraint.getGeometry();
  const constraintMap = constraint.toMap();
  geometry.addVarCellsForConstraints([].concat(...constraintMap.values()));
  return [...SudokuBuilder._handlers(constraintMap, geometry)];
};

await runTest('JigsawPiece: stores the cells array as-is, unlike the base handler', () => {
  const cells = [3, 1, 4];
  const handler = new JigsawPiece(cells);
  assert.equal(handler.cells, cells);
});

await runTest('JigsawPiece: is a marker handler that never blocks solving', () => {
  const context = new GridTestContext({ gridSize: [1, 4], numValues: 4 });
  const handler = new JigsawPiece([0, 1, 2, 3]);

  assert.equal(context.initializeHandler(handler), true);
  assert.equal(handler.enforceConsistency(context.grid, createAccumulator()), true);
  assert.deepEqual(handler.exclusionCells(), []);
  assert.equal(handler.priority(), 4);
});

await runTest('JigsawPiece: built from a Jigsaw constraint holds the piece cell indices', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.NoBoxes(),
    new SudokuConstraint.Jigsaw('4x4', 'R1C1', 'R1C2', 'R2C1', 'R2C2'),
  ]);
  const handlers = buildHandlers(constraint);
  const handler = handlers.find(h => h instanceof JigsawPiece);

  // R1C1, R1C2, R2C1, R2C2 -> row-major indices 0, 1, 4, 5 on a 4x4 grid.
  assert.deepEqual(Array.from(handler.cells), [0, 1, 4, 5]);
});

logSuiteComplete('jigsaw_piece.test.js');
