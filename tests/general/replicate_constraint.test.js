import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { GEOMETRY_9x9, CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SANDBOX_GLOBALS } = await import('../../js/sandbox/env.js');
const HandlerModule = await import('../../js/solver/handlers.js');

const { cellGraph } = SANDBOX_GLOBALS;

await runTest('Replicate.decodeTargetCells should decode base64 bitset', () => {
  const geometry = GEOMETRY_9x9;
  const origin = 'R1C1';
  const cellIds = [0, 1, 10, 80].map(i => geometry.makeCellIdFromIndex(i));
  const token = SudokuConstraint.Replicate.encodeTargetCells(cellIds, origin, geometry);

  const decoded = SudokuConstraint.Replicate.decodeTargetCells(token, origin, geometry);
  assert.deepEqual(decoded, [0, 1, 10, 80]);

  const decodedCellIds = decoded.map(i => geometry.makeCellIdFromIndex(i));
  const token2 = SudokuConstraint.Replicate.encodeTargetCells(decodedCellIds, origin, geometry);
  assert.equal(token2, token);
});

await runTest('Replicate.getCells returns only target cells', () => {
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(
    ['R1C2', 'R1C3'], 'R1C1', GEOMETRY_9x9);
  const constraint = new SudokuConstraint.Replicate([
    new SudokuConstraint.Given('R1C1', 5),
  ], bitset);

  assert.deepEqual(constraint.getCells(GEOMETRY_9x9), ['R1C2', 'R1C3']);
});

await runTest('Replicate.getCells returns empty list for empty bitset', () => {
  const constraint = new SudokuConstraint.Replicate([
    new SudokuConstraint.Given('R1C1', 5),
  ], '');

  assert.deepEqual(constraint.getCells(GEOMETRY_9x9), []);
});

await runTest('Replicate should replicate child constraints onto targets', () => {
  const geometry = GEOMETRY_9x9;

  // Template: Given at R1C1. Targets R1C1, R1C2, R1C3 — R1C1 maps to each
  // target, so the Given shifts to R1C1, R1C2, R1C3 respectively.
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(
    ['R1C1', 'R1C2', 'R1C3'], 'R1C1', geometry);

  const root = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('9x9'),
    new SudokuConstraint.Replicate([
      new SudokuConstraint.Given('R1C1', 5),
    ], bitset),
  ]);

  const resolved = SudokuBuilder.resolveConstraint(root);
  const resolvedGeometry = resolved.getGeometry();
  const constraintMap = resolved.toMap();
  resolvedGeometry.addVarCellsForConstraints([].concat(...constraintMap.values()));

  const handlers = [...SudokuBuilder._handlers(constraintMap, resolvedGeometry)];
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
  const geometry = GEOMETRY_9x9;

  // R1C1 is not in the bitset, so the template at R1C1 is not enforced.
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(['R1C2'], 'R1C1', geometry);

  const root = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('9x9'),
    new SudokuConstraint.Replicate([
      new SudokuConstraint.Given('R1C1', 5),
    ], bitset),
  ]);

  const resolved = SudokuBuilder.resolveConstraint(root);
  const resolvedGeometry = resolved.getGeometry();
  const constraintMap = resolved.toMap();
  resolvedGeometry.addVarCellsForConstraints([].concat(...constraintMap.values()));

  const handlers = [...SudokuBuilder._handlers(constraintMap, resolvedGeometry)];
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

await runTest('encodeTargetCells accepts a sandbox grid graph as the locator', () => {
  const g = cellGraph('9x9');
  const targets = g.block('R1C1', 8, 8);
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(targets, 'R1C1', g);

  // A grid-graph locator agrees with the real geometry, so it round-trips.
  const decoded = new SudokuConstraint.Replicate([], bitset, 'R1C1')
    .getCells(GEOMETRY_9x9);
  assert.deepEqual(decoded, targets);
});

await runTest('sandbox graph makeReplicate accepts one constraint and defaults to all cells', () => {
  const g = cellGraph('9x9');
  const template = new SudokuConstraint.Given('R1C1', 5);
  const replicate = g.makeReplicate(template);

  assert.deepEqual(replicate.constraints, [template]);
  assert.equal(replicate.origin, 'R1C1');
  assert.deepEqual(replicate.getCells(GEOMETRY_9x9), g.cells());
});

await runTest('sandbox graph makeReplicate accepts a constraint array and target subset', () => {
  const g = cellGraph('9x9');
  const targets = ['R2C2', 'R3C2', 'R4C2'];
  const templates = [
    new SudokuConstraint.Given('R1C1', 1, 2),
    new SudokuConstraint.Pair('A', 'pair', 'R1C1', 'R1C2'),
  ];
  const replicate = g.makeReplicate(templates, targets);

  assert.deepEqual(replicate.constraints, templates);
  assert.equal(replicate.origin, 'R1C1');
  assert.deepEqual(replicate.getCells(GEOMETRY_9x9), targets);
});

await runTest('encodeTargetCells accepts a var-cell overlay as the locator', () => {
  // The overlay's ids ('VY1'..) aren't in a bare geometry, but the overlay is
  // itself a locator, so it can both mint and index them.
  const y = cellGraph('9x9').makeOverlay('VY');
  const targets = y.block('VY1', 8, 8);
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(targets, 'VY1', y);

  // Decoding against a real geometry that has the group registered recovers the
  // same var cells: within one group both index spaces are dense and aligned,
  // so the origin-relative offsets are invariant.
  const geometry = CellGeometry.newDefault();
  geometry.addVarCellsForConstraints([new SudokuConstraint.Var('Y', 'Y', 81)]);
  const decoded = new SudokuConstraint.Replicate([], bitset, 'VY1')
    .getCells(geometry);
  assert.deepEqual(decoded, targets);
});

await runTest('sandbox overlay inherits makeReplicate and defaults to overlay cells', () => {
  const y = cellGraph('9x9').makeOverlay('VY');
  const template = new SudokuConstraint.Given('VY1', 1, 2);
  const replicate = y.makeReplicate(template);

  const geometry = CellGeometry.newDefault();
  geometry.addVarCellsForConstraints([new SudokuConstraint.Var('Y', 'Y', 81)]);
  assert.deepEqual(replicate.constraints, [template]);
  assert.equal(replicate.origin, 'VY1');
  assert.deepEqual(replicate.getCells(geometry), y.cells());
});

await runTest('encodeTargetCells rejects targets before the origin', () => {
  const y = cellGraph('9x9').makeOverlay('VY');
  assert.throws(
    () => SudokuConstraint.Replicate.encodeTargetCells(['VY1', 'VY5'], 'VY3', y),
    /must not precede the origin/);
});

logSuiteComplete('Replicate constraint');
