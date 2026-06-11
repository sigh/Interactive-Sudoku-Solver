import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuConstraint } = await import('../js/sudoku_constraint.js');
const { SHAPE_9x9 } = await import('../js/grid_shape.js');
const { SudokuBuilder } = await import('../js/solver/sudoku_builder.js');
const HandlerModule = await import('../js/solver/handlers.js');

await runTest('Replicate.decodeTargetCells should decode base64 bitset', () => {
  const shape = SHAPE_9x9;
  const origin = 'R1C1';
  const cellIds = [0, 1, 10, 80].map(i => shape.makeCellIdFromIndex(i));
  const token = SudokuConstraint.Replicate.encodeTargetCells(cellIds, origin, shape);

  const decoded = SudokuConstraint.Replicate.decodeTargetCells(token, origin, shape);
  assert.deepEqual(decoded, [0, 1, 10, 80]);

  const decodedCellIds = decoded.map(i => shape.makeCellIdFromIndex(i));
  const token2 = SudokuConstraint.Replicate.encodeTargetCells(decodedCellIds, origin, shape);
  assert.equal(token2, token);
});

await runTest('Replicate.getCells returns only target cells', () => {
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(
    ['R1C2', 'R1C3'], 'R1C1', SHAPE_9x9);
  const constraint = new SudokuConstraint.Replicate([
    new SudokuConstraint.Given('R1C1', 5),
  ], bitset);

  assert.deepEqual(constraint.getCells(SHAPE_9x9), ['R1C2', 'R1C3']);
});

await runTest('Replicate.getCells returns empty list for empty bitset', () => {
  const constraint = new SudokuConstraint.Replicate([
    new SudokuConstraint.Given('R1C1', 5),
  ], '');

  assert.deepEqual(constraint.getCells(SHAPE_9x9), []);
});

await runTest('Replicate should replicate child constraints onto targets', () => {
  const shape = SHAPE_9x9;

  // Template: Given at R1C1. Targets R1C1, R1C2, R1C3 — R1C1 maps to each
  // target, so the Given shifts to R1C1, R1C2, R1C3 respectively.
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(
    ['R1C1', 'R1C2', 'R1C3'], 'R1C1', shape);

  const root = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('9x9'),
    new SudokuConstraint.Replicate([
      new SudokuConstraint.Given('R1C1', 5),
    ], bitset),
  ]);

  const resolved = SudokuBuilder.resolveConstraint(root);
  const resolvedShape = resolved.getShape();
  const constraintMap = resolved.toMap();
  resolvedShape.addVarCellsForConstraints([].concat(...constraintMap.values()));

  const handlers = [...SudokuBuilder._handlers(constraintMap, resolvedShape)];
  const givenHandlers = handlers.filter(h => h instanceof HandlerModule.GivenCandidates);

  const cellToValues = new Map();
  for (const h of givenHandlers) {
    for (const [cell, values] of h._valueMap) {
      cellToValues.set(cell, Array.isArray(values) ? values : [values]);
    }
  }

  assert.deepEqual(cellToValues.get(0), [5]);
  assert.deepEqual(cellToValues.get(1), [5]);
  assert.deepEqual(cellToValues.get(2), [5]);
});

await runTest('Replicate does not enforce template when target is not in bitset', () => {
  const shape = SHAPE_9x9;

  // R1C1 is not in the bitset, so the template at R1C1 is not enforced.
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(['R1C2'], 'R1C1', shape);

  const root = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('9x9'),
    new SudokuConstraint.Replicate([
      new SudokuConstraint.Given('R1C1', 5),
    ], bitset),
  ]);

  const resolved = SudokuBuilder.resolveConstraint(root);
  const resolvedShape = resolved.getShape();
  const constraintMap = resolved.toMap();
  resolvedShape.addVarCellsForConstraints([].concat(...constraintMap.values()));

  const handlers = [...SudokuBuilder._handlers(constraintMap, resolvedShape)];
  const givenHandlers = handlers.filter(h => h instanceof HandlerModule.GivenCandidates);

  const cellToValues = new Map();
  for (const h of givenHandlers) {
    for (const [cell, values] of h._valueMap) {
      cellToValues.set(cell, Array.isArray(values) ? values : [values]);
    }
  }

  assert.equal(cellToValues.get(0), undefined);
  assert.deepEqual(cellToValues.get(1), [5]);
});

logSuiteComplete('Replicate constraint');
