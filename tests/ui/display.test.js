import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

// A recording SVG element, enough for the display code to build and query.
const mockEl = (tag) => {
  const attrs = {};
  const children = [];
  return {
    tagName: tag,
    attrs,
    children,
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    append: (...c) => children.push(...c),
    appendChild: (c) => { children.push(c); return c; },
    replaceChildren: () => { children.length = 0; },
    addEventListener: (type, fn) => { attrs['on' + type] = fn; },
    textContent: '',
  };
};

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: { createElementNS: (_ns, tag) => mockEl(tag) },
});

const { GridDisplay, BorderDisplay, VarCellDisplay } =
  await import('../../js/display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');

const GRID_4x4 = CellGeometry.fromGridSize(4);

await runTest('GridDisplay draws the cell lines in its style', () => {
  const svg = mockEl('g');
  const display = new GridDisplay(svg);
  assert.equal(svg.getAttribute('stroke'), GridDisplay.STYLE['stroke']);

  display.reshape(GRID_4x4);
  assert.equal(svg.children.length, 1);
  // Three interior lines each way for a 4x4 (cell size 52).
  assert.equal(svg.children[0].getAttribute('d'),
    'M52,0V208M104,0V208M156,0V208M0,52H208M0,104H208M0,156H208');
});

await runTest('BorderDisplay draws the border, with an optional fill', () => {
  const svg = mockEl('g');
  new BorderDisplay(svg).reshape(GRID_4x4);
  assert.equal(svg.children[0].getAttribute('d'), 'M0,0h208v156h0v52h-208Z');
  assert.equal(svg.children[0].getAttribute('fill'), 'none');

  const filled = mockEl('g');
  new BorderDisplay(filled, 'red').reshape(GRID_4x4);
  assert.equal(filled.children[0].getAttribute('fill'), 'red');
});

const layoutEntry = (over = {}) => ({
  group: { prefix: 'VA', label: '', cells: [0, 1, 2, 3] },
  columns: 2, rows: 2, yLabel: 0, y: 14, ...over,
});

await runTest('VarCellDisplay renders groups lightly with a close button', () => {
  const removed = [];
  const svg = mockEl('g');
  new VarCellDisplay(svg, (prefix) => removed.push(prefix)).render(
    [layoutEntry({ group: { prefix: 'VB', label: 'over', cells: [0, 1, 2] } })]);

  const [block, close, label] = svg.children;
  const [lines, border] = block.children;
  assert.notEqual(lines.getAttribute('stroke'), GridDisplay.STYLE['stroke']);
  assert.equal(border.getAttribute('stroke-width'), 1.5);
  // The partial last row shortens the lines and steps the border.
  assert.equal(lines.getAttribute('d'), 'M52,0V52M0,52H52');
  assert.equal(border.getAttribute('d'), 'M0,0h104v52h-52v52h-52Z');

  // A count-only size shows the count; the close button removes the group.
  assert.equal(label.textContent, '$B [3]: over');
  close.attrs.onclick();
  assert.deepEqual(removed, ['VB']);
});

logSuiteComplete('ui/display.test.js');
