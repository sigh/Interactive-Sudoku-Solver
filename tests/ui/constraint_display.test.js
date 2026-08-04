import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

// A recording SVG element, enough for the display code to build and query.
const mockEl = (tag) => {
  const attrs = {};
  const children = [];
  return {
    tagName: tag,
    children,
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    append: (...c) => children.push(...c),
    appendChild: (c) => { children.push(c); return c; },
    classList: { add: () => { } },
  };
};

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: { createElementNS: (_ns, tag) => mockEl(tag) },
});

const { Chaos, CustomLine } = await import('../../js/constraint_display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

// A 9x9 grid with the 'CC' region cells that Chaos Construction adds.
const makeGeometry = () => {
  const geometry = CellGeometry.fromGridSize(9);
  geometry._varCellRegistry.addGroups([{
    prefix: 'CC', label: 'Chaos regions',
    count: geometry.numGridCells, columns: geometry.numCols,
  }]);
  return geometry;
};

// Grid-only cell centres are enough for the arm-direction geometry.
const cellPositioner = {
  cellCenter: (i) => [(i % 9) * 10 + 5, ((i / 9) | 0) * 10 + 5],
};

const makeDisplay = (geometry) => {
  const display = new Chaos(mockEl('g'), cellPositioner);
  display.reshape(geometry);
  return display;
};

// The arm's line is the only path carrying an arrowhead (markers are circles).
const arrowPaths = (el, out = []) => {
  if (el.tagName === 'path' && el.getAttribute('marker-end') != null) out.push(el);
  for (const c of el.children || []) arrowPaths(c, out);
  return out;
};

const pointCount = (path) => (path.getAttribute('d').match(/[ML]/g) || []).length;

// A control-only ChaosArrow expands to four arms that run to the grid edge, so
// every arm renders as a short solid arrow pointing outward.
await runTest('Chaos.makeIcon: edge-reaching arms render as short solid arrows', () => {
  const geometry = makeGeometry();
  const display = makeDisplay(geometry);
  const constraint = new SudokuConstraint.ChaosArrow('R5C5', 0);

  const icon = display.makeIcon(constraint, { multiArrow: true });
  const paths = arrowPaths(icon);

  assert.equal(paths.length, 4);
  for (const path of paths) {
    assert.equal(path.getAttribute('stroke-dasharray'), null);
    assert.equal(pointCount(path), 2);
  }
});

// An arm given explicit region cells that stop short of the edge (R5C5->R5C7)
// cannot point outward, so it renders as a dashed line through every cell.
await runTest('Chaos.makeIcon: an inner arm renders as a dashed full line', () => {
  const geometry = makeGeometry();
  const display = makeDisplay(geometry);
  // CC41/CC42/CC43 are the region cells for grid cells R5C5, R5C6, R5C7.
  const constraint = new SudokuConstraint.ChaosArrow('R5C5', 0, ['CC41', 'CC42', 'CC43']);

  const icon = display.makeIcon(constraint, { multiArrow: true });
  const paths = arrowPaths(icon);

  assert.equal(paths.length, 1);
  assert.notEqual(paths[0].getAttribute('stroke-dasharray'), null);
  assert.equal(pointCount(paths[0]), 3);
});

const linePaths = (el, out = []) => {
  if (el.tagName === 'path' && el.getAttribute('d') != null) out.push(el);
  for (const c of el.children || []) linePaths(c, out);
  return out;
};

// An NFA segment may be empty (its separator is still a symbol consumed by the
// automaton); a zero-point group draws nothing rather than throwing.
await runTest('CustomLine.makeIcon: an empty NFA segment draws nothing', () => {
  const display = new CustomLine(mockEl('g'), cellPositioner);
  display.reshape(CellGeometry.fromGridSize(9));
  const constraint = new SudokuConstraint.NFA('ENC', 'n', [], ['R1C1', 'R1C2']);

  const icon = display.makeIcon(constraint, SudokuConstraint.NFA.DISPLAY_CONFIG);

  // Only the non-empty segment produces a line.
  assert.equal(linePaths(icon).length, 1);
});

logSuiteComplete('Constraint display');
