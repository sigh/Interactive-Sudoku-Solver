import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({ needWindow: true });

const { CellPositioner, DisplayItem } = await import('../../js/display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');

const CELL_SIZE = DisplayItem.CELL_SIZE;

// Register groups and lay them out as DisplayContainer does.
const layoutFor = (geometry, specs) => {
  geometry._varCellRegistry.addGroups(
    specs.map(s => ({ label: '', ...s })));
  const positioner = new CellPositioner();
  positioner.reshape(geometry);
  return { positioner, result: positioner.setVarCellGroups(geometry.varCellGroups()) };
};

await runTest('count-only group uses the grid width', () => {
  const { result } = layoutFor(
    CellGeometry.fromGridSize(9), [{ prefix: 'VA', count: 10, columns: 0 }]);
  const { columns, rows } = result.layout[0];
  assert.equal(columns, 9);
  assert.equal(rows, 2);
});

await runTest('count-only group uses the primary group width', () => {
  // Shape~VA: the primary's columns stand in for the grid's.
  const { result } = layoutFor(
    CellGeometry.fromShapeSpec('VA~1-6'),
    [{ prefix: 'VA', count: 36, columns: 6 },
    { prefix: 'VB', count: 10, columns: 0 }]);
  const { columns, rows } = result.layout[1];
  assert.equal(columns, 6);
  assert.equal(rows, 2);
  assert.ok(Number.isFinite(result.extraHeight));
  assert.ok(Number.isFinite(result.extraWidth));
});

await runTest('the primary group lays out as the grid', () => {
  const { result } = layoutFor(
    CellGeometry.fromShapeSpec('VA~1-6'),
    [{ prefix: 'VA', count: 36, columns: 6 },
    { prefix: 'VB', count: 10, columns: 0 }]);

  const labelHeight = CellPositioner.VAR_CELL_LABEL_HEIGHT;
  assert.ok(result.layout[0].primary);
  assert.equal(result.layout[0].group.prefix, 'VA');
  // The primary sits at the top, below its label row.
  assert.equal(result.layout[0].yLabel, 0);
  assert.equal(result.layout[0].y, labelHeight);
  // Other groups follow below the primary, after their label row.
  const belowPrimary = labelHeight + 6 * CELL_SIZE +
    CellPositioner.VAR_CELL_GAP + labelHeight;
  assert.equal(result.layout[1].y, belowPrimary);
  assert.equal(result.extraHeight, belowPrimary + 2 * CELL_SIZE);
});

await runTest('the primary group lays out first regardless of sort order', () => {
  const { result } = layoutFor(
    CellGeometry.fromShapeSpec('VB~1-6'),
    [{ prefix: 'VA', count: 4, columns: 2 },
    { prefix: 'VB', count: 36, columns: 6 }]);

  assert.equal(result.layout[0].group.prefix, 'VB');
  assert.equal(result.layout[0].yLabel, 0);
  assert.ok(!result.layout[1].primary);
});

await runTest('a group with unresolved columns is not laid out', () => {
  // A count-only group has no width while the group named by the shape is
  // missing.
  const { result } = layoutFor(
    CellGeometry.fromShapeSpec('VA~1-6'),
    [{ prefix: 'VB', count: 10, columns: 0 }]);
  assert.equal(result.layout.length, 0);
  assert.ok(Number.isFinite(result.extraHeight));
});

await runTest('cell centers follow the layout for a cell group shape', () => {
  const { positioner, result } = layoutFor(
    CellGeometry.fromShapeSpec('VA~1-6'),
    [{ prefix: 'VA', count: 10, columns: 6 }]);

  const { y } = result.layout[0];
  assert.deepEqual(positioner.cellCenter(0), [CELL_SIZE / 2, y + CELL_SIZE / 2]);
  // Cell 6 wraps to the second row.
  assert.deepEqual(
    positioner.cellCenter(6),
    [CELL_SIZE / 2, y + CELL_SIZE + CELL_SIZE / 2]);
});

logSuiteComplete('ui/cell_positioner.test.js');
