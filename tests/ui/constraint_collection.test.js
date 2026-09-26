import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { h, makeFakeDocument } from '../helpers/mock_dom.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

// Window listeners, so tests can see what is left registered.
const windowListeners = new Map();
globalThis.addEventListener = (type, fn) => {
  if (!windowListeners.has(type)) windowListeners.set(type, new Set());
  windowListeners.get(type).add(fn);
};
globalThis.removeEventListener = (type, fn) => windowListeners.get(type)?.delete(fn);
const keydownListeners = () => windowListeners.get('keydown')?.size ?? 0;
const pressEscape = () => {
  for (const fn of [...windowListeners.get('keydown') ?? []]) fn({ key: 'Escape' });
};

const {
  RootConstraintCollection, CompositeConstraintCollection,
  SelectedConstraintCollection, ConstraintChipView, ConstraintSelector,
} = await import('../../js/render_page.js');
const { DisplayContainer } = await import('../../js/display.js');
const { ConstraintDisplay } = await import('../../js/constraint_display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');

const parse = (str) => SudokuParser.parseString(str).constraints;
const shape = (spec) => CellGeometry.fromShapeSpec(spec);

// The constraint collections, display and chip views, wired as
// ConstraintManager wires them. Category inputs record what they are told.
const makePage = (geometry = CellGeometry.fromGridSize(9)) => {
  globalThis.document = makeFakeDocument();
  windowListeners.clear();
  const grid = h('div');
  const chipElems = Object.fromEntries(['ordinary', 'composite', 'jigsaw'].map(
    type => [type, h('div', { class: 'chip-view', 'data-chip-view-type': type })]));
  document.body.append(grid, ...Object.values(chipElems));

  const page = { geometry, events: [], updates: 0, actions: [] };
  const container = new DisplayContainer(grid);
  const display = new ConstraintDisplay(
    { addSelectionPreserver() { }, onSelection() { } }, container);
  const selector = new ConstraintSelector(
    container, display, (collection) => page.selected.setCollection(collection));
  const chipHighlighter = container.createCellHighlighter('chip-hover');
  const makeChipView = (elem) => new ConstraintChipView(
    elem, display, chipHighlighter, selector, () => { },
    (constraint, collection) => page.actions.push([constraint, collection]));
  const chipViews = new Map(Object.entries(chipElems).map(
    ([type, elem]) => [type, makeChipView(elem)]));

  const inputs = {
    get: (category) => ({
      onAddConstraint: (c) => page.events.push(`+${category} ${c}`),
      onRemoveConstraint: (c) => page.events.push(`-${category} ${c}`),
    }),
  };
  const makeComposite = (constraint, chip, parent) => {
    const subView = makeChipView(ConstraintChipView.addSubChipView(chip));
    subView.reshape(page.geometry);
    return new CompositeConstraintCollection(
      constraint, parent, subView, display, selector, makeComposite);
  };

  // A new shape, as ConstraintManager._reshape: clear, then reshape.
  const reshapeAll = (newGeometry) => {
    for (const listener of [container, display, selector, ...chipViews.values(), root]) {
      listener.reshape(newGeometry);
    }
  };
  const newShape = (newGeometry) => {
    display.clear();
    for (const view of chipViews.values()) view.clear();
    chipHighlighter.clear();
    selector.clear();
    root.clear();
    page.geometry = newGeometry;
    reshapeAll(newGeometry);
  };
  const root = new RootConstraintCollection(
    display, chipViews, inputs, makeComposite, newShape, () => page.updates++);
  reshapeAll(geometry);
  page.selected = new SelectedConstraintCollection(root);

  const svg = grid.firstChild;
  return Object.assign(page, {
    root, selector,
    strings: () => [...root.constraints()].map(String),
    chips: (type) => chipElems[type].children,
    group: (displayClass) => svg.children.find(
      g => g.classList.contains(`${displayClass.toLowerCase()}-group`)),
    highlighted: (cssClass) => svg.children
      .find(g => g.classList.contains('highlight-group')).children
      .find(g => g.classList.contains(cssClass))?.children.length ?? 0,
  });
};

const label = (chip) => chip.querySelector(':scope > .chip-label').firstChild.textContent;
const subChips = (chip) => chip.querySelector('.sub-chip-view').children;

// ============================================================================
// The root collection
// ============================================================================

await runTest('adding a constraint draws it, adds its chip, and tells its input', () => {
  const page = makePage();
  const [cage] = parse('.Cage~10~R1C1~R1C2');

  page.root.addConstraint(cage);
  assert.equal(page.group('ShadedRegion').children.length, 1);
  assert.deepEqual(page.chips('ordinary').map(label), ['Cage (10)']);
  assert.deepEqual(page.events, ['+LinesAndSets .Cage~10~R1C1~R1C2']);
  assert.equal(page.updates, 1);

  page.root.removeConstraint(cage);
  assert.equal(page.group('ShadedRegion').children.length, 0);
  assert.equal(page.chips('ordinary').length, 0);
  assert.equal(page.events.at(-1), '-LinesAndSets .Cage~10~R1C1~R1C2');
  assert.equal(page.updates, 2);
});

await runTest('a constraint replaces one of its type with the same key', () => {
  const page = makePage();
  for (const [cell, value] of [['R1C1', 5], ['R1C1', 3], ['R2C2', 3]]) {
    page.root.addConstraint(new SudokuConstraint.Given(cell, value));
  }

  assert.deepEqual(page.strings(), ['.~R1C1_3', '.~R2C2_3']);
  assert.deepEqual(page.events.slice(1, 3),
    ['-GivenCandidates .~R1C1_5', '+GivenCandidates .~R1C1_3']);
  assert.equal(page.group('Givens').children.length, 2);
});

await runTest('adding a constraint again, or a shape, changes nothing', () => {
  const page = makePage();
  const [cage] = parse('.Cage~10~R1C1~R1C2');
  page.root.addConstraint(cage);
  page.root.addConstraint(cage);
  page.root.addConstraint(new SudokuConstraint.Shape('6x6'));
  assert.deepEqual(page.strings(), ['.Cage~10~R1C1~R1C2']);
  assert.equal(page.updates, 1);
});

await runTest('a chip goes in the view for its category', () => {
  const page = makePage();
  page.root.addConstraints(parse(
    `.Cage~3~R1C1~R1C2.Jigsaw~${'0'.repeat(9)}${'_'.repeat(72)}.Or.Thermo~R5C5~R5C6.End.Windoku`));

  assert.deepEqual(page.chips('ordinary').map(label), ['Cage (3)']);
  assert.equal(page.chips('jigsaw').length, 1);
  const [or] = page.chips('composite');
  assert.ok(or.classList.contains('composite-chip'));
  assert.equal(page.strings().length, 4, 'Windoku has no chip');
});

await runTest('a constraint needing too many cells fails before anything is added', () => {
  const page = makePage();
  assert.throws(() => page.root.addConstraint(new SudokuConstraint.Var('A', '', 1000)),
    /1000-cell limit/);
  assert.deepEqual(page.strings(), []);
  assert.deepEqual(page.events, []);
  assert.equal(page.updates, 0);
});

await runTest('removing a var cell group removes the constraints on it', () => {
  const page = makePage();
  page.root.addConstraints([
    new SudokuConstraint.Cage(3, 'VA1', 'VA2'),
    new SudokuConstraint.Var('A', '', 4),
    ...parse('.Cage~3~R1C1~R1C2'),
  ]);
  assert.deepEqual(page.strings(), ['.Var~A~~4', '.Cage~3~VA1~VA2', '.Cage~3~R1C1~R1C2']);

  page.root.removeConstraintForVarPrefix('VA');
  assert.deepEqual(page.strings(), ['.Cage~3~R1C1~R1C2']);
  assert.deepEqual(page.chips('ordinary').map(label), ['Cage (3)']);
});

await runTest('constraints are redrawn where their var cells move to', () => {
  const page = makePage();
  page.root.addConstraints([
    new SudokuConstraint.Var('A', '', 9),
    new SudokuConstraint.Var('B', '', 9),
    new SudokuConstraint.Cage(3, 'VB1', 'VB2'),
  ]);
  const cageSquares = () => page.group('ShadedRegion').children[0]
    .children.map(p => p.getAttribute('d'));
  const [chip] = page.chips('ordinary');
  const icon = chip.querySelector(':scope > .chip-icon');
  const before = cageSquares();

  // Removing group A moves group B up.
  page.root.removeConstraintForVarPrefix('VA');
  assert.equal(page.strings().length, 2);
  assert.notDeepEqual(cageSquares(), before);
  assert.notEqual(chip.querySelector(':scope > .chip-icon'), icon, 'a new icon');
});

await runTest('a new shape keeps the constraints that fit it', () => {
  const page = makePage();
  page.root.addConstraints(parse('.Cage~3~R1C1~R1C2.Cage~3~R9C8~R9C9.Var~A~~4'));

  page.root.setShape(shape('6x6~1-9'));
  assert.deepEqual(page.strings(), ['.Var~A~~4', '.Cage~3~R1C1~R1C2']);
  assert.deepEqual(page.chips('ordinary').map(label), ['Cage (3)']);
  assert.equal(page.group('ShadedRegion').children.length, 1);
});

await runTest('a new value range keeps only the var cell groups', () => {
  const page = makePage();
  page.root.addConstraints(parse('.Cage~3~R1C1~R1C2.Var~A~~4'));

  page.root.setShape(shape('9x9~0-8'));
  assert.deepEqual(page.strings(), ['.Var~A~~4']);
});

await runTest('constraints are found by key and by type', () => {
  const page = makePage();
  page.root.addConstraints(parse('.~R1C1_5.Cage~3~R1C1~R1C2.Cage~4~R5C5~R5C6'));
  assert.deepEqual(page.root.getConstraintsByKey('R1C1').map(String), ['.~R1C1_5']);
  assert.deepEqual(page.root.getConstraintsByType('Cage').map(String),
    ['.Cage~3~R1C1~R1C2', '.Cage~4~R5C5~R5C6']);
});

// ============================================================================
// Composites
// ============================================================================

await runTest("a composite's children have chips inside its chip", () => {
  const page = makePage();
  page.root.addConstraints(parse('.Or.Cage~3~R1C1~R1C2.Thermo~R5C5~R5C6.End'));
  const [or] = page.chips('composite');
  assert.deepEqual(subChips(or).map(label), ['Cage (3)', 'Thermometer']);
});

await runTest('adding to a composite redraws it, and marks the new child', () => {
  const page = makePage();
  const [or] = parse('.Or.Cage~3~R1C1~R1C2.End');
  page.root.addConstraint(or);
  const drawn = page.group('BorderedRegion').children[0];
  const updates = page.updates;

  page.root.getCollectionForComposite(or).addConstraint(parse('.Cage~4~R5C5~R5C6')[0]);
  assert.deepEqual(or.constraints.map(String), ['.Cage~3~R1C1~R1C2', '.Cage~4~R5C5~R5C6']);
  assert.notEqual(page.group('BorderedRegion').children[0], drawn);
  const [, added] = subChips(page.chips('composite')[0]);
  assert.ok(added.classList.contains('latest-constraint'));
  assert.equal(page.updates, updates + 1);
});

await runTest('in And, a child replaces one with the same key; in Or, both stay', () => {
  const page = makePage();
  const [and, or] = parse('.And.~R1C1_5.End.Or.~R1C1_5.End');
  page.root.addConstraints([and, or]);

  for (const composite of [and, or]) {
    page.root.getCollectionForComposite(composite).addConstraint(parse('.~R1C1_3')[0]);
  }
  assert.deepEqual(and.constraints.map(String), ['.~R1C1_3']);
  assert.deepEqual(or.constraints.map(String), ['.~R1C1_5', '.~R1C1_3']);
});

await runTest('a change inside nested composites redraws the outermost', () => {
  const page = makePage();
  const [or] = parse('.Or.And.Cage~3~R1C1~R1C2.End.Cage~4~R5C5~R5C6.End');
  page.root.addConstraint(or);
  const [and, cage] = [or.constraints[0], or.constraints[0].constraints[0]];
  const drawn = page.group('BorderedRegion').children[0];

  page.root.getCollectionForComposite(or).getCollectionForComposite(and)
    .removeConstraint(cage);
  assert.deepEqual(and.constraints, []);
  assert.notEqual(page.group('BorderedRegion').children[0], drawn);
  assert.equal(subChips(subChips(page.chips('composite')[0])[0]).length, 0);
});

await runTest('while a composite is selected, what it can hold is added to it', () => {
  const page = makePage();
  const [or] = parse('.Or.Cage~3~R1C1~R1C2.End');
  page.root.addConstraint(or);
  const chip = page.chips('composite')[0];

  chip.querySelector(':scope > .chip-label').click();
  page.selected.addConstraint(parse('.Cage~4~R5C5~R5C6')[0]);
  page.selected.addConstraint(new SudokuConstraint.Windoku());
  assert.equal(or.constraints.length, 2);
  assert.deepEqual(page.strings(), [String(or), '.Windoku']);

  // Once deselected, constraints go to the root.
  chip.querySelector(':scope > .chip-label').click();
  page.selected.addConstraint(parse('.Cage~5~R7C7~R7C8')[0]);
  assert.equal(or.constraints.length, 2);
  assert.equal(page.strings().at(-1), '.Cage~5~R7C7~R7C8');
});

// ============================================================================
// Chips
// ============================================================================

await runTest("a chip's remove button removes its constraint", () => {
  const page = makePage();
  page.root.addConstraint(parse('.Cage~3~R1C1~R1C2')[0]);
  page.chips('ordinary')[0].querySelector('button').click();
  assert.deepEqual(page.strings(), []);
  assert.equal(page.chips('ordinary').length, 0);
});

await runTest("hovering a chip highlights its cells until the pointer leaves", () => {
  const page = makePage();
  page.root.addConstraint(parse('.Cage~3~R1C1~R1C2')[0]);
  const [chip] = page.chips('ordinary');

  chip.dispatch('mouseover', { target: chip });
  assert.equal(page.highlighted('chip-hover'), 2);
  chip.dispatch('mouseleave');
  assert.equal(page.highlighted('chip-hover'), 0);
});

await runTest('a chip icon is a small copy of the drawing, as wide as the grid', () => {
  const page = makePage(shape('6x9'));
  page.root.addConstraint(parse('.Cage~3~R1C1~R1C2')[0]);
  const icon = page.chips('ordinary')[0].querySelector('.chip-icon');

  assert.equal(icon.style.width, '28px');
  assert.ok(parseFloat(icon.style.height) < 28);
  assert.equal(icon.children[1].getAttribute('stroke-width'), 15);
});

await runTest("a chip's action button runs its action, without selecting it", () => {
  const page = makePage();
  const [pair] = parse('.Pair~8H_xf8H_xf8H_B~_a~R1C1~R1C2');
  page.root.addConstraint(pair);
  const [chip] = page.chips('ordinary');

  chip.querySelector('.chip-load-button').click();
  assert.deepEqual(page.actions, [[pair, page.root]]);
  assert.ok(!chip.classList.contains('selected-constraint'));
});

// ============================================================================
// Selecting constraints
// ============================================================================

await runTest('clicking a chip selects it; clicking it again or Escape clears it', () => {
  const page = makePage();
  page.root.addConstraint(parse('.Cage~3~R1C1~R1C2')[0]);
  const [chip] = page.chips('ordinary');
  const isSelected = () => chip.classList.contains('selected-constraint');

  chip.click();
  assert.ok(isSelected());
  assert.equal(page.highlighted('selected-constraint'), 2);
  chip.click();
  assert.ok(!isSelected());
  assert.equal(page.highlighted('selected-constraint'), 0);

  chip.click();
  pressEscape();
  assert.ok(!isSelected());
  assert.equal(keydownListeners(), 0, 'the Escape listener is removed');
});

await runTest('a selected child of a composite is also drawn on the grid', () => {
  const page = makePage();
  page.root.addConstraint(parse('.Or.Cage~3~R1C1~R1C2.End')[0]);
  const [child] = subChips(page.chips('composite')[0]);
  const drawnCages = () => page.group('ShadedRegion').children;

  child.click();
  assert.equal(drawnCages().length, 1);
  assert.ok(drawnCages()[0].classList.contains('selected-constraint'));

  page.selector.clear();
  assert.equal(drawnCages().length, 0);
});

await runTest("the selection follows its constraint's cells, until its chip is removed", () => {
  const page = makePage();
  const [or] = parse('.Or.Cage~3~R1C1~R1C2.End');
  page.root.addConstraint(or);
  page.chips('composite')[0].click();

  page.selected.addConstraint(parse('.Cage~4~R5C5~R5C6')[0]);
  page.selector.onConstraintsUpdated();
  assert.equal(page.highlighted('selected-constraint'), 4);

  page.root.removeConstraint(or);
  page.selector.onConstraintsUpdated();
  assert.equal(page.highlighted('selected-constraint'), 0);
  page.selected.addConstraint(parse('.Cage~5~R7C7~R7C8')[0]);
  assert.deepEqual(page.strings(), ['.Cage~5~R7C7~R7C8'], 'nothing is selected');
});

delete globalThis.addEventListener;
delete globalThis.removeEventListener;

logSuiteComplete('Constraint collections');
