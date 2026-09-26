import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { FakeElement, makeFakeDocument } from '../helpers/mock_dom.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

const frames = [];
window.requestAnimationFrame = (cb) => frames.push(cb);
const runFrames = () => { for (const cb of frames.splice(0)) cb(); };

// Timers wait for runTimers(), rather than their delay.
const timers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => timers.push(fn);
const runTimers = () => { for (const fn of timers.splice(0)) fn(); };

const copied = [];
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: async (text) => copied.push(text) },
  configurable: true,
});

const {
  GridDisplay, BorderDisplay, VarCellDisplay, YinYangShadingDisplay, CellPositioner,
  CellValueDisplay, SolutionDisplay, ColorPicker, DisplayContainer, InfoTextDisplay,
  ChaosRegionBorderDisplay, DisplayItem,
} = await import('../../js/ui/display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

const CELL = DisplayItem.CELL_SIZE;
const GRID_4x4 = CellGeometry.fromGridSize(4);

// The centre of the cell at (row, col), counting from 1 as cell ids do.
const at = (row, col) => [(col - 1) * CELL + CELL / 2, (row - 1) * CELL + CELL / 2];

const positionerFor = (geometry) => {
  const positioner = new CellPositioner();
  positioner.reshape(geometry);
  return positioner;
};

const position = (e) => [e.getAttribute('x'), e.getAttribute('y')];

// ============================================================================
// Grid lines
// ============================================================================

await runTest('GridDisplay draws the cell lines in its style', () => {
  const svg = new FakeElement('g');
  const display = new GridDisplay(svg);
  assert.equal(svg.getAttribute('stroke'), GridDisplay.STYLE['stroke']);

  display.reshape(GRID_4x4);
  assert.equal(svg.children.length, 1);
  // Three interior lines each way for a 4x4 (cell size 52).
  assert.equal(svg.children[0].getAttribute('d'),
    'M52,0V208M104,0V208M156,0V208M0,52H208M0,104H208M0,156H208');
});

await runTest('BorderDisplay draws the border, with an optional fill', () => {
  const svg = new FakeElement('g');
  new BorderDisplay(svg).reshape(GRID_4x4);
  assert.equal(svg.children[0].getAttribute('d'), 'M0,0h208v156h0v52h-208Z');
  assert.equal(svg.children[0].getAttribute('fill'), 'none');

  const filled = new FakeElement('g');
  new BorderDisplay(filled, 'red').reshape(GRID_4x4);
  assert.equal(filled.children[0].getAttribute('fill'), 'red');
});

// ============================================================================
// Cell values
// ============================================================================

const makeValueDisplay = (geometry, valueFn) => {
  const display = new CellValueDisplay(
    new FakeElement('g'), valueFn, positionerFor(geometry));
  display.reshape(geometry);
  return display;
};

await runTest('a value is drawn in its cell; candidates in a grid within it', () => {
  const display = makeValueDisplay(CellGeometry.fromGridSize(9));
  display.renderGridValues([5, null, new Set([1, 5, 9])]);
  const [value, candidates] = display.getSvg().children;

  assert.equal(value.textContent, '5');
  assert.equal(value.getAttribute('class'), 'cell-single-value');
  assert.deepEqual(position(value), [at(1, 1)[0], at(1, 1)[1] + 2]);

  // 1, 5 and 9 run down the diagonal of a 3x3 layout around the centre.
  assert.ok(candidates.classList.contains('cell-multi-value'));
  assert.deepEqual(candidates.children.map(c => c.textContent), ['1', '5', '9']);
  const [x, y] = at(1, 3);
  assert.deepEqual(candidates.children.map(position),
    [[x - 18, y - 11], [x, y + 6], [x + 18, y + 23]]);
});

await runTest('large grids lay candidates out in wider rows', () => {
  const display = makeValueDisplay(CellGeometry.fromGridSize(16));
  display.renderGridValues([new Set([1, 4, 5])]);
  const [one, four, five] = display.getSvg().children[0].children.map(position);

  // Four to a row: 4 ends the first row, and 5 starts the next.
  assert.equal(four[1], one[1]);
  assert.equal(five[0], one[0]);
  assert.ok(five[1] > one[1]);
});

await runTest('values are coloured by the colour function, and shown by the value function', () => {
  const display = makeValueDisplay(CellGeometry.fromGridSize(9), v => `<${v}>`);
  display.renderGridValues(
    [3, new Set([1, 2])], (cell, value) => value === 2 ? 'red' : null);
  const [single, multi] = display.getSvg().children;

  assert.equal(single.getAttribute('fill'), null);
  assert.deepEqual(multi.children.map(c => c.textContent), ['<1>', '<2>']);
  assert.deepEqual(multi.children.map(c => c.getAttribute('fill')), [null, 'red']);
});

// ============================================================================
// Solutions
// ============================================================================

const makeSolutionDisplay = (geometry = CellGeometry.fromGridSize(4)) => {
  const copy = new FakeElement('button');
  const display = new SolutionDisplay(new FakeElement('g'), copy, positionerFor(geometry));
  display.reshape(geometry);
  runFrames();
  return { display, copy };
};

const SOLVED_4x4 = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];

await runTest('a solution is drawn on the next frame, and only the latest', () => {
  const { display } = makeSolutionDisplay();
  display.setSolution([1]);
  display.setSolution(SOLVED_4x4);
  assert.equal(display.getSvg().children.length, 0);

  runFrames();
  assert.equal(display.getSvg().children.length, 16);
});

await runTest('copy is enabled only for a full solution, and copies it', () => {
  const { display, copy } = makeSolutionDisplay();
  display.setSolution([new Set([1, 2]), ...SOLVED_4x4.slice(1)]);
  runFrames();
  assert.equal(copy.disabled, true);

  display.setSolution(SOLVED_4x4);
  runFrames();
  assert.equal(copy.disabled, false);

  copied.length = 0;
  copy.click();
  assert.deepEqual(copied, [SOLVED_4x4.join('')]);
});

await runTest('an empty solution clears shortly after, unless replaced', () => {
  const { display, copy } = makeSolutionDisplay();
  display.setSolution(SOLVED_4x4);
  runFrames();

  display.setSolution([]);
  runFrames();
  display.setSolution(SOLVED_4x4);
  runFrames();
  runTimers();
  assert.equal(display.getSvg().children.length, 16, 'replaced before clearing');

  display.setSolution([]);
  runFrames();
  assert.equal(display.getSvg().children.length, 16, 'not cleared at once');
  runTimers();
  assert.equal(display.getSvg().children.length, 0);
  assert.equal(copy.disabled, true);
});

await runTest('reshaping drops a pending solution', () => {
  const { display } = makeSolutionDisplay();
  display.setSolution(SOLVED_4x4);
  display.reshape(CellGeometry.fromGridSize(4));
  runFrames();
  assert.equal(display.getSvg().children.length, 0);
});

// ============================================================================
// Colours
// ============================================================================

await runTest('a key keeps its colour, and new keys avoid the colours in use', () => {
  const picker = new ColorPicker();
  const first = picker.pickColor('a');
  picker.addItem('item-a', first, 'a');

  assert.equal(picker.pickColor('a'), first);
  const second = picker.pickColor('b');
  assert.notEqual(second, first);

  // Avoiding only some keys can reuse the others' colours.
  picker.addItem('item-b', second, 'b');
  assert.equal(picker.pickColor(null, ['b']), first);
});

await runTest('a colour is freed when the last item with its key is removed', () => {
  const picker = new ColorPicker();
  const color = picker.pickColor();
  picker.addItem('one', color, 'k');
  picker.addItem('two', color, 'k');

  picker.removeItem('one');
  assert.notEqual(picker.pickColor(), color);
  picker.removeItem('two');
  assert.equal(picker.pickColor(), color);
  assert.equal(picker.removeItem('two'), false);
});

await runTest('once the colours run out, new ones are random', () => {
  const picker = new ColorPicker();
  for (const [i, color] of picker.COLOR_LIST.entries()) {
    picker.addItem(i, color, i);
  }
  assert.match(picker.pickColor(), /^rgb\(\d+,\d+,\d+\)$/);
});

// ============================================================================
// The display container
// ============================================================================

const makeContainer = (geometry = CellGeometry.fromGridSize(9)) => {
  const root = new FakeElement('div');
  const container = new DisplayContainer(root);
  container.reshape(geometry);
  const [svg, interceptor] = root.children;
  return { container, geometry, svg, interceptor: container.getClickInterceptor() };
};

await runTest('the grid is sized for its cells, with a class for its values', () => {
  const { svg } = makeContainer();
  const padding = DisplayItem.SVG_PADDING;
  assert.equal(svg.getAttribute('width'), 9 * CELL + 2 * padding);
  assert.equal(svg.getAttribute('height'), 9 * CELL + 2 * padding);
  assert.equal(svg.getAttribute('class'), 'grid-size-small');

  assert.equal(makeContainer(CellGeometry.fromGridSize(16)).svg.getAttribute('class'),
    'grid-size-large');
});

await runTest('clicks find the cell under them', () => {
  const { interceptor } = makeContainer();
  assert.equal(interceptor.cellAt(10, 10), 'R1C1');
  assert.equal(interceptor.cellAt(CELL * 8 + 1, CELL * 2 + 1), 'R3C9');
});

await runTest('var cells extend the grid below it, and can be clicked', () => {
  const { svg, geometry, interceptor } = makeContainer();
  const height = svg.getAttribute('height');
  geometry.addVarCellsForConstraints([new SudokuConstraint.Var('A', '', 4)]);

  const [, varRow] = interceptor.getSvg().children;
  const rowY = varRow.getAttribute('y');
  assert.equal(svg.getAttribute('height'), height + rowY + CELL - 9 * CELL);
  // A group sized by count alone is as wide as the grid.
  assert.equal(varRow.getAttribute('width'), 9 * CELL);

  assert.equal(interceptor.cellAt(10, rowY + 10), 'VA1');
  assert.equal(interceptor.cellAt(3 * CELL + 10, rowY + 10), 'VA4');
  assert.equal(interceptor.cellAt(4 * CELL + 10, rowY + 10), null, 'past the last cell');
  assert.equal(interceptor.cellAt(10, rowY - 1), null, 'between the grid and the row');

  // Reshaping drops the var cells.
  const { container } = makeContainer();
  container.reshape(CellGeometry.fromGridSize(9));
  assert.equal(container.getClickInterceptor().getSvg().children.length, 1);
});

await runTest("a var cell group's close button removes it", () => {
  const { container, geometry, svg } = makeContainer();
  const removed = [];
  container.onVarCellRemove((prefix) => removed.push(prefix));
  geometry.addVarCellsForConstraints([new SudokuConstraint.Var('A', '', 4)]);

  const varCells = svg.children.find(g => g.classList.contains('var-cell-group'));
  varCells.children.find(c => c.getAttribute('class') === 'var-cell-close')
    .dispatch('click');
  assert.deepEqual(removed, ['VA']);
});

await runTest('the layout view is a class on the grid', () => {
  const { container, svg } = makeContainer();
  container.toggleLayoutView(true);
  assert.ok(svg.classList.contains('layout-view'));
  container.toggleLayoutView(false);
  assert.ok(!svg.classList.contains('layout-view'));
});

// ============================================================================
// Highlights
// ============================================================================

const highlightGroup = (svg) => svg.children.find(
  g => g.classList.contains('highlight-group'));

await runTest('a cell highlighter draws a square per cell in its class', () => {
  const { container, svg } = makeContainer();
  const highlighter = container.createCellHighlighter('selected-cells');
  const squares = () => highlightGroup(svg).children
    .find(g => g.classList.contains('selected-cells')).children;

  highlighter.setCells(['R1C1', 'R1C2']);
  highlighter.addCell('R1C2');
  assert.equal(squares().length, 2);
  assert.deepEqual(highlighter.getCells(), ['R1C1', 'R1C2']);

  highlighter.removeCell('R1C1');
  assert.equal(squares().length, 1);
  assert.equal(highlighter.size(), 1);

  highlighter.clear();
  assert.equal(squares().length, 0);
});

await runTest('setting the same key again keeps the highlight', () => {
  const { container } = makeContainer();
  const highlighter = container.createCellHighlighter('c');

  highlighter.setCells(['R1C1'], 'key');
  highlighter.setCells(['R5C5', 'R6C6'], 'key');
  assert.deepEqual(highlighter.getCells(), ['R1C1']);
  assert.equal(highlighter.key(), 'key');

  highlighter.setCells(['R5C5'], 'other');
  assert.deepEqual(highlighter.getCells(), ['R5C5']);
});

await runTest('a region highlight shades its cells inside one inset border', () => {
  const { container, svg } = makeContainer();
  const highlighter = container.createRegionHighlighter('region', 3);

  highlighter.setCells(['R1C1']);
  const [region] = highlightGroup(svg).children;
  assert.ok(region.classList.contains('region'));
  const [shading, ...border] = region.children;
  assert.equal(shading.getAttribute('stroke'), 'none');

  // Every corner of the border is inset 3 from the cell's edges.
  const corners = border.flatMap(p => p.getAttribute('d').split(' ')
    .filter(t => !/[A-Z]/.test(t)).map(Number))
    .filter(n => n !== CELL / 2 && n !== 0 && n !== CELL);
  assert.ok(corners.length > 0);
  assert.ok(corners.every(n => n === 3 || n === CELL - 3), corners);

  assert.deepEqual(highlighter.getCells(), ['R1C1']);
  highlighter.clear();
  assert.equal(highlightGroup(svg).children.length, 0);
  highlighter.setCells([]);
  assert.equal(highlightGroup(svg).children.length, 0);
});

await runTest('where region cells touch diagonally, the border cuts across the cells outside', () => {
  const { container, svg } = makeContainer();
  container.createRegionHighlighter('region').setCells(['R1C1', 'R2C2']);
  const [region] = highlightGroup(svg).children;
  const border = region.children.filter(c => c.getAttribute('stroke') !== 'none');

  // The cells under the middle of each diagonal segment.
  const cut = [];
  for (const path of border) {
    const nums = path.getAttribute('d').split(' ').filter(t => !/[A-Z]/.test(t)).map(Number);
    for (let i = 2; i + 1 < nums.length; i += 2) {
      const [x0, y0, x1, y1] = nums.slice(i - 2, i + 2);
      if (x0 === x1 || y0 === y1) continue;
      const [x, y] = [(x0 + x1) / 2, (y0 + y1) / 2];
      cut.push(`R${Math.floor(y / CELL) + 1}C${Math.floor(x / CELL) + 1}`);
    }
  }
  assert.deepEqual(cut.sort(), ['R1C2', 'R2C1']);
});

// ============================================================================
// Overlays
// ============================================================================

await runTest('info text is written in the bottom-left of its cell', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const display = new InfoTextDisplay(new FakeElement('g'), positionerFor(geometry));
  display.reshape(geometry);
  display.setText('R2C3', 'hi');

  const [text] = display.getSvg().children;
  assert.equal(text.textContent, 'hi');
  assert.deepEqual(position(text), [2 * CELL + 2, 2 * CELL - 2]);
});

const layoutEntry = (over = {}) => ({
  group: { prefix: 'VA', label: '', cells: [0, 1, 2, 3] },
  columns: 2, rows: 2, yLabel: 0, y: 14, ...over,
});

await runTest('VarCellDisplay renders groups lightly with a close button', () => {
  const removed = [];
  const svg = new FakeElement('g');
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
  close.dispatch('click');
  assert.deepEqual(removed, ['VB']);
});

await runTest('VarCellDisplay labels a full block with its dimensions', () => {
  const svg = new FakeElement('g');
  new VarCellDisplay(svg).render([layoutEntry()]);
  assert.equal(svg.children[2].textContent, '$A [2x2]');
});

// A 2x2 grid with its Chaos region cells laid out below it.
const makeChaosBorders = () => {
  const geometry = CellGeometry.fromGridSize(2);
  geometry._varCellRegistry.addGroups(
    [{ prefix: 'CC', label: '', count: 4, columns: 2 }]);
  const positioner = positionerFor(geometry);
  positioner.setVarCellGroups(geometry.varCellGroups());
  const display = new ChaosRegionBorderDisplay(new FakeElement('g'), positioner);
  display.reshape(geometry);
  return display;
};

await runTest('Chaos borders separate cells whose regions cannot match', () => {
  const display = makeChaosBorders();
  // Grid values, then each cell's region: R1C1 and R1C2 share region 1; R2C1
  // is in 2; R2C2 may be in 1 or 2.
  display.setSolution([0, 0, 0, 0, 1, 1, 2, new Set([1, 2])]);

  // Only R1C1|R2C1 is certain, drawn on the grid and on the region cells.
  const paths = display.getSvg().children;
  assert.equal(paths.length, 2);
  assert.deepEqual(paths[0].getAttribute('d'), `M 0 ${CELL} L ${CELL} ${CELL}`);
  assert.equal(display.getSvg().getAttribute('stroke-width'),
    ChaosRegionBorderDisplay.IN_PROGRESS_BORDER_WIDTH);

  display.setSolution([0, 0, 0, 0, 1, 1, 2, 2], /* searchComplete= */ true);
  assert.equal(display.getSvg().children.length, 4);
  assert.equal(display.getSvg().getAttribute('stroke-width'),
    ChaosRegionBorderDisplay.COMPLETE_BORDER_WIDTH);

  // Candidate sets with no value in common are disjoint.
  display.setSolution([0, 0, 0, 0, new Set([1]), new Set([2]), new Set([1]), new Set([2])]);
  assert.equal(display.getSvg().children.length, 4);

  display.setSolution();
  assert.equal(display.getSvg().children.length, 0);
});

await runTest('Chaos borders need the region cells', () => {
  const geometry = CellGeometry.fromGridSize(2);
  const display = new ChaosRegionBorderDisplay(new FakeElement('g'), positionerFor(geometry));
  display.reshape(geometry);
  display.setSolution([1, 2, 3, 4]);
  assert.equal(display.getSvg().children.length, 0);
});

await runTest('YinYangShadingDisplay fills decided shaded grid cells', () => {
  const geometry = CellGeometry.fromShapeSpec('2x2~2~YinYang');
  const display = new YinYangShadingDisplay(new FakeElement('g'), positionerFor(geometry));
  display.reshape(geometry);

  // Full fills for the decided shaded (1) cells, a half fill (closed
  // triangle path) for the undecided set, nothing for unshaded.
  display.setSolution([1, 2, new Set([1, 2]), new Set([1])]);
  const paths = display.getSvg().children.map(c => c.getAttribute('d'));
  assert.equal(paths.length, 3);
  assert.equal(paths.filter(d => d.endsWith('Z')).length, 1);

  display.setSolution();
  assert.equal(display.getSvg().children.length, 0);
});

await runTest('YinYangShadingDisplay fills the YY overlay and its grid cells', () => {
  const geometry = CellGeometry.fromGridSize(2);
  geometry._varCellRegistry.addGroups(
    [{ prefix: 'YY', label: '', count: 4, columns: 2 }]);
  const positioner = positionerFor(geometry);
  positioner.setVarCellGroups(geometry.varCellGroups());
  const display = new YinYangShadingDisplay(new FakeElement('g'), positioner);
  display.reshape(geometry);

  // YY cells (indices 4-7) shade cells 0 and 3: each fills its grid cell too.
  display.setSolution([2, 1, 1, 2, 1, 2, 2, 1]);
  assert.equal(display.getSvg().children.length, 4);
});

delete navigator.clipboard;
globalThis.setTimeout = realSetTimeout;

logSuiteComplete('ui/display.test.js');
