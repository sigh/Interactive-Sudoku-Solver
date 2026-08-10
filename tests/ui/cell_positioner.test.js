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

await runTest('groups lay out below the grid in prefix order', () => {
  const { result } = layoutFor(
    CellGeometry.fromGridSize(6),
    [{ prefix: 'VB', count: 10, columns: 0 },
    { prefix: 'VA', count: 36, columns: 6 }]);

  const labelHeight = CellPositioner.VAR_CELL_LABEL_HEIGHT;
  const gap = CellPositioner.VAR_CELL_GAP;
  const gridHeight = 6 * CELL_SIZE;
  assert.equal(result.layout[0].group.prefix, 'VA');
  // The first group sits below the grid, after its label row.
  assert.equal(result.layout[0].yLabel, gridHeight + gap);
  assert.equal(result.layout[0].y, gridHeight + gap + labelHeight);
  // Later groups follow below, after their own label row.
  const belowFirst = result.layout[0].y + 6 * CELL_SIZE + gap + labelHeight;
  assert.equal(result.layout[1].y, belowFirst);
  assert.equal(
    result.extraHeight, belowFirst + 2 * CELL_SIZE - gridHeight);
});

await runTest('cell centers follow the layout for var cells', () => {
  const geometry = CellGeometry.fromGridSize(2);
  const { positioner, result } = layoutFor(
    geometry, [{ prefix: 'VA', count: 10, columns: 6 }]);

  const { y } = result.layout[0];
  const firstVarCell = geometry.numGridCells;
  assert.deepEqual(
    positioner.cellCenter(firstVarCell), [CELL_SIZE / 2, y + CELL_SIZE / 2]);
  // The 7th var cell wraps to the second row.
  assert.deepEqual(
    positioner.cellCenter(firstVarCell + 6),
    [CELL_SIZE / 2, y + CELL_SIZE + CELL_SIZE / 2]);
});

logSuiteComplete('ui/cell_positioner.test.js');
