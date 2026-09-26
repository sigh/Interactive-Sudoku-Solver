import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';
import { FakeElement, makeFakeDocument } from '../helpers/mock_dom.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

const { Chaos, CustomLine, ConstraintDisplay } = await import('../../js/ui/constraint_display.js');
const { DisplayContainer, DisplayItem } = await import('../../js/ui/display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');

const CELL = DisplayItem.CELL_SIZE;

// The centre of the cell at (row, col), counting from 1 as cell ids do.
const at = (row, col) => [(col - 1) * CELL + CELL / 2, (row - 1) * CELL + CELL / 2];

// The input manager, as far as the outside clue arrows use it. As on the
// page, setting the selection notifies the selection listeners.
const makeInputManager = () => {
  const selectionListeners = [];
  return {
    selection: [],
    arrow: undefined,
    addSelectionPreserver() { },
    onSelection: (fn) => selectionListeners.push(fn),
    setSelection(cells) {
      this.selection = cells;
      for (const fn of selectionListeners) fn(cells);
    },
    updateOutsideArrowSelection(arrowId) { this.arrow = arrowId; },
  };
};

// A ConstraintDisplay on a new page, built and shaped as the page does.
const makeDisplay = (geometry = CellGeometry.fromGridSize(9)) => {
  globalThis.document = makeFakeDocument();
  const root = document.createElement('div');
  document.body.append(root);
  const container = new DisplayContainer(root);
  const inputManager = makeInputManager();
  const display = new ConstraintDisplay(inputManager, container);
  container.reshape(geometry);
  display.reshape(geometry);

  const svg = root.firstChild;
  // The group a display class draws in, e.g. group('Jigsaw').
  const group = (displayClass) => svg.children.find(
    g => g.classList.contains(`${displayClass.toLowerCase()}-group`));
  // Adds constraints as the page does, and draws those with a display.
  const draw = (...constraints) => {
    geometry.addVarCellsForConstraints(constraints);
    return constraints.map(c => c.constructor.DISPLAY_CONFIG
      ? display.drawConstraint(c) : null);
  };
  return { display, geometry, inputManager, svg, group, draw };
};

const parse = (str) => SudokuParser.parseString(str).constraints;

// The drawn content of a node, to compare before and after.
const render = (node) => node.children
  ? `<${node.tagName} ${JSON.stringify(node.attrs)} .${node.className} `
  + `${node.style.display}>${node.children.map(render).join('')}</>`
  : JSON.stringify(node.textContent);

const byTag = (node, tag) => node.descendants().filter(n => n.tagName === tag);

// The [x, y] points of a path drawn through points ('M x y L x y ...').
const pathPoints = (path) => {
  const nums = path.getAttribute('d').split(' ')
    .filter(t => !/^[A-Za-z]$/.test(t)).map(Number);
  return nums.flatMap((n, i) => i % 2 ? [] : [[n, nums[i + 1]]]);
};

// ============================================================================
// Every constraint type
// ============================================================================

// One of every displayable constraint type, on a 9x9 grid.
const SAMPLES = [
  '.Or.Cage~3~R1C1~R1C2.End',
  '.And.X~R1C1~R1C2.End',
  '.Replicate~AwDiQEiwD.SameValues~2~R1C1~R3C3.End',
  `.Jigsaw~${'0'.repeat(9)}${'_'.repeat(72)}`,
  '.Thermo~R1C1~R1C2~R1C3',
  '.Whisper~5~R1C1~R1C2~R1C3',
  '.Renban~R1C1~R1C2~R1C3',
  '.Modular~3~R1C1~R1C2~R1C3',
  '.Entropic~R1C1~R1C2~R1C3',
  '.RegionSumLine~R1C2~R2C2',
  '.Between~R1C1~R1C2~R1C3',
  '.Lockout~4~R1C1~R1C2~R1C3',
  '.Palindrome~R1C1~R1C2~R1C3',
  '.Zipper~R1C1~R1C2~R1C3~R1C4',
  '.SumLine~10~R1C1~R1C2~R1C3',
  '.Regex~WzEtNV0q~R1C1~R1C2',
  '.NFA~ENC~_n~R1C1~R1C2',
  '.NoBoxes',
  '.ChaosConstruction.ChaosArrow~R2C2',
  '.ChaosConstruction.ChaosCount~R1C2~~CC2~CC1',
  '.RegionSize~3',
  '.Windoku',
  '.Diagonal~1',
  '.WhiteDot~R1C1~R1C2',
  '.BlackDot~R1C1~R1C2',
  '.GreaterThan~R1C1~R1C2',
  '.X~R1C1~R1C2',
  '.V~R2C1~R2C2',
  '.ValueIndexing~R1C4~R2C4~R2C3',
  '.Arrow~R1C1~R1C2~R1C3',
  '.DoubleArrow~R1C1~R1C2~R1C3',
  '.PillArrow~2~R1C1~R1C2~R1C3',
  '.Cage~10~R1C1~R1C2',
  '.RellikCage~8~R1C1~R2C1',
  '.EqualityCage~R1C1~R1C2',
  '.Sum~0_=_1_1_-1~R5C1~R5C2~R6C1',
  '.Lunchbox~5~R1C1~R1C2~R1C3',
  '.LittleKiller~10~R1C1',
  '.XSum~C1~10~',
  '.Sandwich~15~R1',
  '.Skyscraper~C5~5',
  '.HiddenSkyscraper~R8~7~4',
  '.NumberedRoom~C1~4~',
  '.FullRank~C1~33~',
  '.AllDifferent~R1C1~R1C2~R2C2',
  '.ContainAtLeast~1_2~R3C4~R3C5',
  '.ContainExact~2~R1C2~R2C2',
  '.LookAndSay~1223~R1C1~R1C2~R1C3',
  '.SameValues~2~R2C2~R3C3',
  '.EqualSum~R1C1~R2C2~-~R3C3~R4C4',
  '.Quad~R1C1~1~2',
  '.Pair~8H_xf8H_xf8H_B~_a~R1C1~R1C2',
  '.PairX~8H_xf8H_xf8H_B~_Nabner~R4C1~R5C1',
  '.Indexing~C~R1C1',
  '.CountingCircles~R1C1~R1C2~R2C2',
  '.CountDistinct~R3C3~R3C2~R2C2',
  '.~R1C1_1',
  '.~R1C2_1_2',
];

await runTest('every displayable constraint type has a sample', () => {
  const sampled = new Set(SAMPLES.flatMap(s => parse(s).map(c => c.type)));
  const missing = Object.entries(SudokuConstraint)
    .filter(([name, cls]) => cls.DISPLAY_CONFIG && !sampled.has(name))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
});

for (const sample of SAMPLES) {
  await runTest(`${sample} draws in its group, and removing it restores the grid`, () => {
    const { display, geometry, svg } = makeDisplay();
    const constraints = parse(sample);
    geometry.addVarCellsForConstraints(constraints);
    const groupElems = svg.children.filter(g => g.className.includes('-group'));
    // Each group in full for the constraint's own group, and otherwise its
    // attributes and size (enough to see it drawn in).
    const snapshot = (groupClass) => groupElems.map(g => g.classList.contains(groupClass)
      ? render(g) : `${JSON.stringify(g.attrs)} ${g.descendants().length}`);
    const changedSince = (before, groupClass) => {
      const now = snapshot(groupClass);
      return groupElems.filter((_, i) => now[i] !== before[i])
        .map(g => g.className.split(' ')[0]);
    };

    for (const constraint of constraints) {
      const config = constraint.constructor.DISPLAY_CONFIG;
      if (!config) continue;
      const groupClass = `${config.displayClass.toLowerCase()}-group`;
      const before = snapshot(groupClass);

      const item = display.drawConstraint(constraint);
      assert.deepEqual(changedSince(before, groupClass), [groupClass]);

      display.removeConstraint(constraint, item);
      assert.deepEqual(changedSince(before, groupClass), [], 'removing restores the grid');

      display.makeConstraintIcon(constraint);
      assert.deepEqual(changedSince(before, groupClass), [], 'an icon is not drawn on the grid');
    }
  });
}

await runTest('a type without a display has no icon', () => {
  const { display } = makeDisplay();
  assert.equal(
    display.makeConstraintIcon(new SudokuConstraint.ChaosConstruction()), null);
});

await runTest('layout constraints are marked for the layout view', () => {
  const { group } = makeDisplay();
  for (const name of ['Jigsaw', 'Windoku', 'Diagonal', 'DefaultRegions']) {
    assert.ok(group(name).classList.contains('layout-constraint'), name);
  }
  assert.ok(group('ShadedRegion').classList.contains('non-layout-constraint'));
  assert.ok(group('ShadedRegion').classList.contains('dimmable-constraint'));
  assert.ok(!group('Givens').classList.contains('dimmable-constraint'));
});

await runTest('clear removes every constraint', () => {
  const { display, group, draw } = makeDisplay();
  draw(...parse('.Cage~10~R1C1~R1C2.Thermo~R2C1~R2C2.~R3C3_4.Sandwich~15~R1'));

  display.clear();
  for (const name of ['ShadedRegion', 'Thermo', 'Givens']) {
    assert.equal(group(name).children.length, 0, name);
  }
  assert.ok(!group('OutsideClue').descendants().some(
    n => n.classList?.contains('active-arrow')));
});

// ============================================================================
// Layout
// ============================================================================

const lines = (group) => group.children.map(pathPoints);

await runTest('DefaultRegions draws the box borders for the grid shape', () => {
  assert.deepEqual(lines(makeDisplay().group('DefaultRegions')), [
    [[156, 0], [156, 468]], [[312, 0], [312, 468]],
    [[0, 156], [468, 156]], [[0, 312], [468, 312]],
  ]);

  // 6x6 has 2x3 boxes.
  const six = makeDisplay(CellGeometry.fromGridSize(6));
  assert.deepEqual(lines(six.group('DefaultRegions')), [
    [[156, 0], [156, 312]],
    [[0, 104], [312, 104]], [[0, 208], [312, 208]],
  ]);
});

await runTest('DefaultRegions hides the boxes for NoBoxes, and for a non-Sudoku grid', () => {
  const { display, group, draw } = makeDisplay();
  const regions = group('DefaultRegions');

  const [item] = draw(new SudokuConstraint.NoBoxes());
  assert.equal(regions.getAttribute('display'), 'none');
  display.removeConstraint(new SudokuConstraint.NoBoxes(), item);
  assert.notEqual(regions.getAttribute('display'), 'none');

  const raw = makeDisplay(CellGeometry.fromShapeSpec('9x9~~Raw'));
  assert.equal(raw.group('DefaultRegions').getAttribute('display'), 'none');
});

await runTest('Windoku shades its four windows, only while drawn', () => {
  const { group, draw } = makeDisplay();
  const windoku = group('Windoku');
  assert.equal(windoku.children.length, 4 * 9);
  assert.equal(windoku.getAttribute('display'), 'none');

  draw(new SudokuConstraint.Windoku());
  assert.notEqual(windoku.getAttribute('display'), 'none');
});

await runTest('Diagonal runs corner to corner in its direction', () => {
  const { group, draw } = makeDisplay();
  draw(new SudokuConstraint.Diagonal(1), new SudokuConstraint.Diagonal(-1));
  assert.deepEqual(lines(group('Diagonal')), [
    [[0, 468], [468, 0]],
    [[0, 0], [468, 468]],
  ]);
});

// The half cell edges on the outline of a set of [row, col] cells, as the
// midpoint of each half.
const outlineHalfEdges = (cells) => {
  const inSet = new Set(cells.map(String));
  const halves = [];
  for (const [r, c] of cells) {
    const [x, y] = [(c - 1) * CELL, (r - 1) * CELL];
    for (const [dr, dc, [x0, y0], [x1, y1]] of [
      [-1, 0, [x, y], [x + CELL, y]], [1, 0, [x, y + CELL], [x + CELL, y + CELL]],
      [0, -1, [x, y], [x, y + CELL]], [0, 1, [x + CELL, y], [x + CELL, y + CELL]],
    ]) {
      if (inSet.has(String([r + dr, c + dc]))) continue;
      for (const f of [0.25, 0.75]) halves.push(String([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]));
    }
  }
  return halves.sort();
};

// The half cell edges a border draws, as the midpoint of each half.
const drawnHalfEdges = (border) => {
  const halves = [];
  for (const path of byTag(border, 'path')) {
    const points = pathPoints(path);
    for (let i = 1; i < points.length; i++) {
      const [[x0, y0], [x1, y1]] = [points[i - 1], points[i]];
      const pieces = Math.hypot(x1 - x0, y1 - y0) / (CELL / 2);
      for (let p = 0; p < pieces; p++) {
        const f = (p + 0.5) / pieces;
        halves.push(String([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]));
      }
    }
  }
  return halves.sort();
};

await runTest('a jigsaw piece is outlined along its edges exactly', () => {
  const { draw } = makeDisplay();
  // A hook around a hole, closed off where two cells touch diagonally.
  const cells = [[2, 2], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4], [3, 3]];
  const [piece] = draw(new SudokuConstraint.Jigsaw(
    '9x9', ...cells.map(([r, c]) => `R${r}C${c}`)));

  assert.deepEqual(drawnHalfEdges(piece), outlineHalfEdges(cells));
});

await runTest('Jigsaw shades the cells in no piece, and fills disconnected pieces', () => {
  const { display, group, draw } = makeDisplay();
  const [, missing] = group('Jigsaw').children;
  const row = (r) => Array.from({ length: 9 }, (_, i) => `R${r}C${i + 1}`);
  const fills = (item) => item.children.filter(c => c.getAttribute('opacity') != null);

  const row1 = new SudokuConstraint.Jigsaw('9x9', ...row(1));
  const [piece] = draw(row1);
  assert.equal(missing.children.length, 81 - 9);
  assert.equal(fills(piece).length, 0);

  // Split into two parts.
  const [split] = draw(new SudokuConstraint.Jigsaw('9x9', ...row(2).slice(0, 8), 'R3C9'));
  assert.equal(missing.children.length, 81 - 18);
  assert.equal(fills(split).length, 9);

  display.removeConstraint(row1, piece);
  assert.equal(missing.children.length, 81 - 9);
});

// ============================================================================
// Lines
// ============================================================================

// The line a GenericLine item draws, and its markers.
const lineParts = (item) => ({
  path: item.children.find(c => c.tagName === 'path'),
  circles: item.children.filter(c => c.tagName === 'circle'),
});

await runTest('a line runs through its cell centres, back to the start for a loop', () => {
  const { draw } = makeDisplay();
  const [line, loop] = draw(...parse(
    '.Renban~R1C1~R1C2~R2C2.SumLine~10~R5C1~R5C2~R6C2~LOOP'));

  assert.deepEqual(pathPoints(lineParts(line).path), [at(1, 1), at(1, 2), at(2, 2)]);
  assert.deepEqual(pathPoints(lineParts(loop).path),
    [at(5, 1), at(5, 2), at(6, 2), at(5, 1)]);
  assert.equal(line.getAttribute('stroke'),
    SudokuConstraint.Renban.DISPLAY_CONFIG.color);
});

await runTest('a thermo has a solid bulb on its first cell', () => {
  const { draw } = makeDisplay();
  const [thermo] = draw(...parse('.Thermo~R1C1~R1C2~R1C3'));
  const { circles } = lineParts(thermo);

  assert.equal(circles.length, 1);
  assert.deepEqual([circles[0].getAttribute('cx'), circles[0].getAttribute('cy')], at(1, 1));
  assert.equal(circles[0].getAttribute('stroke-width'), 0);
});

await runTest('empty end circles cut the line back to their edge', () => {
  const { draw } = makeDisplay();
  const [between] = draw(...parse('.Between~R1C1~R1C2~R1C3'));
  const { path, circles } = lineParts(between);

  assert.equal(circles.length, 2);
  assert.ok(circles.every(c => c.getAttribute('fill') === 'transparent'));
  const radius = circles[0].getAttribute('r');
  assert.deepEqual(pathPoints(path), [
    [at(1, 1)[0] + radius, at(1, 1)[1]], at(1, 2), [at(1, 3)[0] - radius, at(1, 3)[1]],
  ]);
});

await runTest('a zipper marks its middle, between cells for an even length', () => {
  const { draw } = makeDisplay();
  const [even, odd] = draw(...parse(
    '.Zipper~R1C1~R1C2~R1C3~R1C4.Zipper~R3C1~R3C2~R3C3'));
  const middle = (item) => {
    const [circle] = lineParts(item).circles;
    return [circle.getAttribute('cx'), circle.getAttribute('cy')];
  };

  assert.deepEqual(middle(even), [2 * CELL, at(1, 1)[1]]);
  assert.deepEqual(middle(odd), at(3, 2));
});

await runTest('a dashed line scales its dashes by its width', () => {
  const { draw } = makeDisplay();
  const [modular] = draw(...parse('.Modular~3~R1C1~R1C2~R1C3'));
  // The default '0.5 2' pattern on a line 5 wide.
  assert.equal(lineParts(modular).path.getAttribute('stroke-dasharray'), '2.5 10');
});

await runTest('an arrow ends in an arrowhead', () => {
  const { draw } = makeDisplay();
  const [arrow] = draw(...parse('.Arrow~R1C1~R1C2~R1C3'));
  assert.equal(lineParts(arrow).path.getAttribute('marker-end'), 'url(#arrowhead)');
});

await runTest('a pill arrow draws the pill over its sum cells, then the arrow', () => {
  const { draw, display } = makeDisplay();
  const pillArrow = parse('.PillArrow~2~R1C1~R1C2~R1C3~R2C3')[0];
  const [a, b] = draw(pillArrow, pillArrow);
  const [mask, pill, arrow] = a.children;

  assert.deepEqual(pathPoints(pill), [at(1, 1), at(1, 2)]);
  assert.deepEqual(pathPoints(arrow), [at(1, 2), at(1, 3), at(2, 3)]);
  assert.equal(arrow.getAttribute('marker-end'), 'url(#arrowhead)');
  // The pill is hollowed out by its own mask.
  assert.equal(pill.getAttribute('mask'), `url(#${mask.getAttribute('id')})`);
  assert.notEqual(b.children[0].getAttribute('id'), mask.getAttribute('id'));

  const icon = display.makeConstraintIcon(pillArrow);
  assert.equal(icon.children[1].getAttribute('mask'), null);
});

await runTest('custom lines share a colour per definition', () => {
  const { draw, display } = makeDisplay();
  const one = new SudokuConstraint.Regex('1+', 'R1C1', 'R1C2');
  const [a, b, c] = draw(one,
    new SudokuConstraint.Regex('1+', 'R3C1', 'R3C2'),
    new SudokuConstraint.Regex('2+', 'R5C1', 'R5C2'));
  const color = (item) => item.getAttribute('stroke');

  assert.equal(color(a), color(b));
  assert.notEqual(color(a), color(c));

  // The colour is freed once no line uses it.
  display.removeConstraint(one, a);
  display.removeConstraint(one, b);
  const [d] = draw(new SudokuConstraint.Regex('3+', 'R7C1', 'R7C2'));
  assert.equal(color(d), color(a));
});

// ============================================================================
// Regions
// ============================================================================

await runTest('a cage is labelled with its sum in its top-left cell', () => {
  const { draw } = makeDisplay();
  const [cage] = draw(...parse('.Cage~10~R2C2~R1C3~R2C3'));
  const [label] = byTag(cage, 'text');
  const [x, y] = at(1, 3);

  assert.equal(label.textContent, '10');
  assert.deepEqual([label.getAttribute('x'), label.getAttribute('y')],
    [x - CELL / 2, y - CELL / 2 + 2]);
  assert.equal(byTag(cage, 'path').length, 3);
});

await runTest('neighbouring cages get different colours', () => {
  const { draw, display } = makeDisplay();
  const color = (cage) => byTag(cage, 'path')[0].getAttribute('fill');
  const first = parse('.Cage~3~R1C1~R1C2')[0];
  const [a, b, c] = draw(first, ...parse('.Cage~3~R1C3~R1C4.Cage~3~R5C5~R5C6'));

  assert.notEqual(color(b), color(a));
  assert.equal(color(c), color(a), 'a colour is reused away from its cage');

  // A removed cage no longer holds its colour.
  display.removeConstraint(first, a);
  const [d] = draw(...parse('.Cage~3~R2C4'));
  assert.equal(color(d), color(a));
});

await runTestCases('a patterned region fills its cells with its pattern', [
  ['lines', '.EqualityCage~R1C1~R1C2', ['line']],
  ['checks', '.Sum~0_=_1_1_-1~R5C1~R5C2~R6C1', ['rect', 'rect']],
  ['diagonals', '.ContainExact~2~R1C2~R2C2', ['line']],
  ['squares', '.Indexing~C~R1C1', ['rect']],
], (sample, patternShapes) => {
  const { draw } = makeDisplay();
  const [item] = draw(...parse(sample));
  const [pattern] = byTag(item, 'pattern');
  const cells = byTag(item, 'path').filter(p => p.getAttribute('fill')?.startsWith('url'));

  assert.deepEqual(pattern.children.map(c => c.tagName), patternShapes);
  assert.ok(cells.length > 0);
  for (const cell of cells) {
    assert.equal(cell.getAttribute('fill'), `url(#${pattern.id})`);
  }
});

await runTest('indexing colours rows and columns differently', () => {
  const { draw } = makeDisplay();
  const color = (item) => byTag(item, 'rect')[0].getAttribute('fill');
  const [col, row] = draw(...parse('.Indexing~C~R1C1.Indexing~R~R2C2'));
  assert.notEqual(color(col), color(row));
});

await runTest('a lunchbox draws a line through its region', () => {
  const { draw } = makeDisplay();
  const [lunchbox] = draw(...parse('.Lunchbox~5~R1C1~R1C2~R1C3'));
  const line = lunchbox.children.find(c => c.tagName === 'g');

  assert.equal(line.getAttribute('stroke'),
    SudokuConstraint.Lunchbox.DISPLAY_CONFIG.lineConfig.color);
  assert.deepEqual(pathPoints(byTag(line, 'path')[0]), [at(1, 1), at(1, 2), at(1, 3)]);
});

await runTest('a bordered region is outlined, in a new colour each time', () => {
  const { draw } = makeDisplay();
  const [a, b] = draw(...parse('.AllDifferent~R1C1~R1C2.AllDifferent~R5C5~R5C6'));
  const { inset } = SudokuConstraint.AllDifferent.DISPLAY_CONFIG;

  assert.notEqual(a.getAttribute('stroke'), b.getAttribute('stroke'));
  assert.equal(a.getAttribute('stroke-width'), inset * 2);
  assert.equal(a.getAttribute('stroke-dasharray'), null);
});

await runTest('a composite is outlined dashed, and its icon is grey', () => {
  const { draw, display } = makeDisplay();
  const [or] = parse('.Or.Cage~3~R1C1~R1C2.Cage~3~R2C1.End');
  const [item] = draw(or);

  assert.equal(item.getAttribute('stroke-dasharray'), '8 2');
  // One border around all the contained cells.
  assert.equal(item.children.filter(c => c.tagName === 'g').length, 1);
  assert.equal(display.makeConstraintIcon(or).getAttribute('stroke'), 'gray');
});

await runTest('a region split into sets is outlined per set, with a light fill', () => {
  const { draw } = makeDisplay();
  const [sameValues] = draw(...parse('.SameValues~2~R1C1~R1C2~R3C1~R3C2'));
  const { fillOpacity, opacity = 0.4 } = SudokuConstraint.SameValues.DISPLAY_CONFIG;
  const fills = sameValues.children.filter(c => c.tagName === 'path');
  const borders = sameValues.children.filter(c => c.tagName === 'g');

  assert.equal(borders.length, 2);
  assert.equal(fills.length, 4);
  // Drawn at the group's opacity, the fill comes out at fillOpacity.
  assert.equal(fills[0].getAttribute('opacity') * opacity, fillOpacity);
});

await runTest('count distinct circles its first cell', () => {
  const { draw } = makeDisplay();
  const [item] = draw(...parse('.CountDistinct~R3C3~R3C2~R2C2'));
  const [circle] = item.children.filter(c => c.tagName === 'circle');
  assert.deepEqual([circle.getAttribute('cx'), circle.getAttribute('cy')], at(3, 3));
});

await runTest('counting circles ring each cell, in a new colour each time', () => {
  const { draw, display } = makeDisplay();
  const [first] = parse('.CountingCircles~R1C1~R2C2');
  const [a, b] = draw(first, ...parse('.CountingCircles~R5C5'));

  assert.deepEqual(a.children.map(c => [c.getAttribute('cx'), c.getAttribute('cy')]),
    [at(1, 1), at(2, 2)]);
  assert.notEqual(a.children[0].getAttribute('stroke'), b.children[0].getAttribute('stroke'));
  assert.equal(display.makeConstraintIcon(first).children[0].getAttribute('stroke'), 'blue');
});

// ============================================================================
// Marks between cells
// ============================================================================

await runTest('a dot sits between each adjacent pair', () => {
  const { draw } = makeDisplay();
  const [dots] = draw(...parse('.WhiteDot~R1C1~R1C2.WhiteDot~R2C1~R3C1'));
  const [dot] = dots.children;

  assert.equal(dots.getAttribute('fill'), 'white');
  assert.deepEqual([dot.getAttribute('cx'), dot.getAttribute('cy')], [CELL, CELL / 2]);
});

await runTest('an X is written between its cells, over a white halo', () => {
  const { draw } = makeDisplay();
  const [x] = draw(...parse('.X~R1C1~R2C1'));
  const [halo, text] = x.children;

  assert.equal(text.textContent, 'x');
  assert.deepEqual([text.getAttribute('x'), text.getAttribute('y')], [CELL / 2, CELL]);
  assert.equal(halo.getAttribute('fill'), 'white');
});

await runTest('a greater-than sign points at the smaller cell', () => {
  const { draw } = makeDisplay();
  const apex = (item) => pathPoints(item.children[0])[1];
  const [right, left, down] = draw(...parse(
    '.GreaterThan~R1C1~R1C2.GreaterThan~R3C2~R3C1.GreaterThan~R5C1~R6C1'));

  // Each sign is centred on the edge between its cells.
  const [rx, ry] = apex(right);
  assert.ok(rx > CELL && ry === CELL / 2);
  const [lx] = apex(left);
  assert.ok(lx < CELL);
  const [dx, dy] = apex(down);
  assert.ok(dx === CELL / 2 && dy > 5 * CELL);
});

await runTest('a quad sits on the corner of its cells, with its values around it', () => {
  const { draw } = makeDisplay();
  const [two, one] = draw(...parse('.Quad~R1C1~1~2.Quad~R3C3~7'));
  const position = (text) => [text.getAttribute('x'), text.getAttribute('y')];
  const [circle, ...values] = two.children;

  assert.deepEqual([circle.getAttribute('cx'), circle.getAttribute('cy')], [CELL, CELL]);
  assert.deepEqual(values.map(v => v.textContent), ['1', '2']);
  // Two values sit either side of the centre; one sits on it.
  assert.deepEqual(values.map(position), [[CELL - 5, CELL + 1], [CELL + 5, CELL + 1]]);
  assert.deepEqual(position(one.children[1]), [3 * CELL, 3 * CELL + 1]);
});

// ============================================================================
// Outside clues
// ============================================================================

// The arrow with this id, found by clicking each until it is selected.
const arrowFor = (group, arrowId, inputManager) => {
  for (const arrow of group.children) {
    arrow.onclick();
    if (inputManager.arrow === arrowId) return arrow;
  }
  return null;
};

await runTest('there is an arrow for every row and column end, and diagonal', () => {
  const { group } = makeDisplay();
  const arrows = group('OutsideClue').children;
  const count = (cls) => arrows.filter(a => a.classList.contains(cls)).length;

  assert.equal(count('full-line-arrow'), 4 * 9);
  assert.equal(count('diagonal-arrow'), 30);

  const raw = makeDisplay(CellGeometry.fromShapeSpec('9x9~~Raw'));
  assert.equal(raw.group('OutsideClue').children.length, 0);
});

await runTest('clicking an arrow selects its cells until the selection changes', () => {
  const { group, inputManager } = makeDisplay();
  const arrow = arrowFor(group('OutsideClue'), 'R2,-1', inputManager);

  assert.deepEqual(inputManager.selection,
    ['R2C9', 'R2C8', 'R2C7', 'R2C6', 'R2C5', 'R2C4', 'R2C3', 'R2C2', 'R2C1']);
  assert.ok(arrow.classList.contains('selected-arrow'));

  inputManager.setSelection(['R5C5']);
  assert.ok(!arrow.classList.contains('selected-arrow'));
  assert.equal(inputManager.arrow, null);
});

await runTest('a clue is written by its arrow, stacking with others on a row', () => {
  const { group, inputManager, draw, display } = makeDisplay();
  const arrow = arrowFor(group('OutsideClue'), 'R1,1', inputManager);
  const text = arrow.lastChild;
  const [sandwich, xSum] = parse('.Sandwich~15~R1.XSum~R1~10~');

  const [item] = draw(sandwich);
  assert.equal(text.textContent, '15');
  assert.ok(arrow.classList.contains('active-arrow'));
  const oneClueSize = text.getAttribute('style');

  draw(xSum);
  assert.equal(text.textContent, '15⟨10⟩');
  assert.deepEqual(text.children.map(t => t.getAttribute('dy')), ['-0.6em', '1.2em']);
  assert.notEqual(text.getAttribute('style'), oneClueSize, 'more clues are smaller');

  display.removeConstraint(sandwich, item);
  assert.equal(text.textContent, '⟨10⟩');
});

await runTest('column clues sit side by side', () => {
  const { group, inputManager, draw } = makeDisplay();
  const text = arrowFor(group('OutsideClue'), 'C1,1', inputManager).lastChild;
  draw(...parse('.Sandwich~15~C1.XSum~C1~10~'));
  assert.deepEqual(text.children.map(t => t.getAttribute('dy')), [null, null]);
});

await runTest('a clue for a missing arrow draws nothing', () => {
  const { draw } = makeDisplay();
  assert.deepEqual(draw(new SudokuConstraint.LittleKiller('R5C5', 10)), [null]);
});

// ============================================================================
// Givens
// ============================================================================

await runTest('a given hides the solution under it; candidates do not', () => {
  const { draw, display } = makeDisplay();
  const mask = document.getElementById('givens-mask');
  const [given, candidates] = parse('.~R1C1_5.~R1C2_1_2');

  const [item] = draw(given);
  assert.equal(item.getAttribute('class'), 'cell-single-value');
  assert.equal(mask.children.length, 2);

  draw(candidates);
  assert.equal(mask.children.length, 2);

  display.removeConstraint(given, item);
  assert.equal(mask.children.length, 1);
});

await runTest('clear uncovers every given', () => {
  const { draw, display } = makeDisplay();
  draw(...parse('.~R1C1_5.~R2C2_3'));

  display.clear();
  const mask = document.getElementById('givens-mask');
  assert.equal(mask.children.length, 1);
  assert.equal(mask.children[0].getAttribute('fill'), 'white');
});

// ============================================================================
// Chaos
// ============================================================================

// A 9x9 grid with the 'CC' region cells that Chaos Construction adds.
const makeChaosGeometry = () => {
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

const makeChaos = (geometry) => {
  const display = new Chaos(new FakeElement('g'), cellPositioner);
  display.reshape(geometry);
  return display;
};

// The arm's line is the only path carrying an arrowhead (markers are circles).
const arrowPaths = (el) => byTag(el, 'path').filter(
  p => p.getAttribute('marker-end') != null);

const pointCount = (path) => (path.getAttribute('d').match(/[ML]/g) || []).length;

// A control-only ChaosArrow expands to four arms that run to the grid edge, so
// every arm renders as a short solid arrow pointing outward.
await runTest('Chaos.makeIcon: edge-reaching arms render as short solid arrows', () => {
  const display = makeChaos(makeChaosGeometry());
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
  const display = makeChaos(makeChaosGeometry());
  // CC41/CC42/CC43 are the region cells for grid cells R5C5, R5C6, R5C7.
  const constraint = new SudokuConstraint.ChaosArrow('R5C5', 0, ['CC41', 'CC42', 'CC43']);

  const icon = display.makeIcon(constraint, { multiArrow: true });
  const paths = arrowPaths(icon);

  assert.equal(paths.length, 1);
  assert.notEqual(paths[0].getAttribute('stroke-dasharray'), null);
  assert.equal(pointCount(paths[0]), 3);
});

await runTest('a chaos count outlines its region cells', () => {
  const { draw } = makeDisplay();
  const [, count] = draw(...parse('.ChaosConstruction.ChaosCount~R1C2~~CC2~CC1'));
  const border = count.children.find(c => c.tagName === 'g');

  assert.equal(border.getAttribute('stroke'), Chaos.COLOR);
  assert.ok(byTag(border, 'path').length > 0);
});

// An NFA segment may be empty (its separator is still a symbol consumed by the
// automaton); a zero-point group draws nothing rather than throwing.
await runTest('CustomLine.makeIcon: an empty NFA segment draws nothing', () => {
  const display = new CustomLine(new FakeElement('g'), cellPositioner);
  display.reshape(CellGeometry.fromGridSize(9));
  const constraint = new SudokuConstraint.NFA('ENC', 'n', [], ['R1C1', 'R1C2']);

  const icon = display.makeIcon(constraint, SudokuConstraint.NFA.DISPLAY_CONFIG);

  // Only the non-empty segment produces a line.
  assert.equal(byTag(icon, 'path').length, 1);
});

logSuiteComplete('Constraint display');
