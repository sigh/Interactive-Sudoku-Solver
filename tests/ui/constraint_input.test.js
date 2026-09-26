import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';
import { FakeFormData, h, makeFakeDocument } from '../helpers/mock_dom.js';
import {
  cellGroupPanel, compositeForm, customConstraintForm, globalCheckboxes,
  layoutCheckboxes, multiCellForm, multiValueForm, outsideClueOptions,
  outsideClues, regionPanel, shapePanel,
} from '../helpers/page_markup.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

const frames = [];
window.requestAnimationFrame = (cb) => frames.push(cb);
const runFrames = () => { for (const cb of frames.splice(0)) cb(); };

// Timers wait for runTimers(), rather than their delay.
const timers = new Map();
let lastTimer = 0;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn) => {
  timers.set(++lastTimer, fn);
  return lastTimer;
};
globalThis.clearTimeout = (id) => timers.delete(id);
const runTimers = () => {
  const fns = [...timers.values()];
  timers.clear();
  for (const fn of fns) fn();
};

const settle = () => new Promise(resolve => setImmediate(resolve));

const makeStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    clear: () => data.clear(),
  };
};
globalThis.sessionStorage = makeStorage();
globalThis.localStorage = makeStorage();

const realFormData = globalThis.FormData;
globalThis.FormData = FakeFormData;

const { CollapsibleContainer, ConstraintCategoryInput } =
  await import('../../js/constraint_input.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');

const parse = (str) => SudokuParser.parseString(str).constraints;

// The page's constraint collection: a constraint replaces those of its type
// which share a uniqueness key, each change is reported to the input for its
// category and to the update listeners, and a new shape reshapes the inputs.
const makeCollection = (geometry, updateListeners) => ({
  geometry,
  constraints: [],
  inputs: new Map(),
  shaped: null,
  addConstraint(c) {
    if (this.constraints.includes(c)) return;
    const keys = c.uniquenessKeys();
    for (const match of this.constraints.filter(m => m.type === c.type
      && m.uniquenessKeys().some(k => keys.includes(k)))) {
      this.removeConstraint(match);
    }
    this.geometry.addVarCellsForConstraints([c]);
    this.constraints.push(c);
    this.inputs.get(c.constructor.CATEGORY)?.onAddConstraint(c);
    for (const fn of updateListeners) fn();
  },
  removeConstraint(c) {
    const index = this.constraints.indexOf(c);
    if (index < 0) return;
    this.constraints.splice(index, 1);
    this.inputs.get(c.constructor.CATEGORY)?.onRemoveConstraint(c);
    this.geometry.removeVarCellsForConstraints([c]);
    for (const fn of updateListeners) fn();
  },
  getConstraintsByKey(key) {
    return this.constraints.filter(c => c.uniquenessKeys().includes(key));
  },
  getConstraintsByType(type) {
    return this.constraints.filter(c => c.type === type);
  },
  setShape(geometry) {
    this.shaped = this.geometry = geometry;
    for (const input of this.inputs.values()) input.reshape(geometry);
  },
  strings() { return this.constraints.map(String); },
});

// The grid's input manager. Setting the selection notifies the selection
// listeners, as on the page.
const makeInputManager = () => {
  const listeners = { selection: [], digit: [], arrow: [] };
  let segments = [];
  return {
    focusTargets: [],
    addSelectionPreserver() { },
    registerFocusPanel(_panel, fn) { this.focusTargets.push(fn); },
    onSelection: (fn) => listeners.selection.push(fn),
    onNewDigit: (fn) => listeners.digit.push(fn),
    onOutsideArrowSelection: (fn) => listeners.arrow.push(fn),
    getSelection: () => segments.flat(),
    getSelectionSegments: () => segments.map(s => [...s]),
    setSelection(cells) { this.selectSegments(cells); },
    // The user selects cells, in one or more segments.
    selectSegments(...cellSegments) {
      segments = cellSegments.filter(s => s.length);
      for (const fn of listeners.selection) fn(this.getSelection());
    },
    updateOutsideArrowSelection(arrowId) {
      for (const fn of listeners.arrow) fn(arrowId);
    },
    // The user types a digit (or deletes, with null) in a cell.
    typeDigit(cell, digit) {
      for (const fn of listeners.digit) fn(cell, digit);
    },
  };
};

// A category input on a new page holding its markup, built and shaped as the
// page does. `make` builds it from the page.
const setUp = (markup, make, geometry = CellGeometry.fromGridSize(9)) => {
  globalThis.document = makeFakeDocument();
  sessionStorage.clear();
  localStorage.clear();
  document.body.append(markup());

  const updateListeners = [];
  const page = {
    geometry,
    collection: makeCollection(geometry, updateListeners),
    inputManager: makeInputManager(),
    addUpdateListener: (fn) => updateListeners.push(fn),
    updates: 0,
  };
  page.input = make(page);
  page.collection.inputs.set(page.input.constructor.name, page.input);
  page.input.setUpdateCallback(() => page.updates++);
  page.input.reshape(geometry);
  return page;
};

// The user changes a control: its change event bubbles up the page.
const change = (control, value) => {
  if (typeof value === 'boolean') control.checked = value;
  else control.value = value;
  control.dispatch('change', { bubbles: true });
};

const press = (control, key, props = {}) => control.dispatch(
  'keydown', { key, preventDefault() { }, ...props });

const errorText = (id) => document.getElementById(id).textContent;

// ============================================================================
// Collapsible panels
// ============================================================================

const panelMarkup = () => h('div', { id: 'panel' },
  h('h2', {}, 'Panel'),
  h('div', {},
    h('input', { type: 'checkbox' }),
    h('div', { class: 'chip-view' })));

const newPanel = (defaultOpen, keepStorage = false) => {
  globalThis.document = makeFakeDocument();
  if (!keepStorage) {
    sessionStorage.clear();
    localStorage.clear();
  }
  document.body.append(panelMarkup());
  return new CollapsibleContainer(document.getElementById('panel'), defaultOpen);
};

await runTest('a panel opens and closes from its heading, and remembers it', () => {
  const panel = newPanel(true);
  assert.equal(panel.isOpen(), true);

  panel.anchorElement().click();
  assert.equal(panel.isOpen(), false);

  // A later visit opens it as it was left.
  sessionStorage.clear();
  assert.equal(newPanel(true, /* keepStorage= */ true).isOpen(), false);
});

await runTest('a panel is highlighted while it has a constraint set', () => {
  const panel = newPanel(true);
  const highlighted = () => panel.element().classList.contains('constraint-panel-highlight');
  const [checkbox, chips] = panel.bodyElement().children;

  panel.updateActiveHighlighting();
  assert.equal(highlighted(), false);

  checkbox.checked = true;
  panel.updateActiveHighlighting();
  assert.equal(highlighted(), true);

  checkbox.checked = false;
  chips.append(h('div'));
  panel.updateActiveHighlighting();
  assert.equal(highlighted(), true);
});

// ============================================================================
// Checkboxes
// ============================================================================

const setUpLayoutCheckboxes = (geometry) => setUp(layoutCheckboxes,
  ({ collection }) => new ConstraintCategoryInput.LayoutCheckbox(collection), geometry);

// The checkbox with this label.
const checkbox = (label) => {
  const labelElem = document.body.querySelectorAll('label')
    .find(l => l.textContent.trim() === label);
  return document.getElementById(labelElem.htmlFor);
};

await runTest('there is a checkbox for each constraint, and for each option', () => {
  setUpLayoutCheckboxes();
  const labels = document.body.querySelectorAll('label').map(l => l.textContent.trim());
  for (const label of ['Windoku', 'Anti-Knight', 'Diagonal ╱', 'Diagonal ╲']) {
    assert.ok(labels.includes(label), label);
  }
});

await runTest('checking a box adds its constraint, and unchecking removes it', () => {
  const { collection } = setUpLayoutCheckboxes();

  change(checkbox('Diagonal ╲'), true);
  change(checkbox('Windoku'), true);
  assert.deepEqual(collection.strings(), ['.Diagonal~-1', '.Windoku']);

  change(checkbox('Diagonal ╲'), false);
  assert.deepEqual(collection.strings(), ['.Windoku']);
});

await runTest('a constraint that cannot be added is unchecked, with the error shown', () => {
  const { collection } = setUpLayoutCheckboxes();
  collection.addConstraint = () => { throw new Error('Too many cells'); };
  const windoku = checkbox('Windoku');
  const error = document.getElementById('layout-constraint-checkboxes-error');

  change(windoku, true);
  assert.equal(windoku.checked, false);
  assert.equal(error.textContent, 'Too many cells');
  assert.equal(error.style.display, '');

  // The error goes away by itself.
  runTimers();
  assert.equal(error.textContent, '');
  assert.equal(error.style.display, 'none');
});

await runTest('the checkboxes follow the constraints', () => {
  const { collection, input } = setUpLayoutCheckboxes();
  const [windoku] = parse('.Windoku');

  collection.addConstraint(windoku);
  assert.equal(checkbox('Windoku').checked, true);
  collection.removeConstraint(windoku);
  assert.equal(checkbox('Windoku').checked, false);

  collection.addConstraint(parse('.AntiKnight')[0]);
  input.clear();
  assert.equal(checkbox('Anti-Knight').checked, false);
});

await runTest('the global checkboxes are in a collapsible panel', () => {
  const { collection } = setUp(globalCheckboxes, ({ collection, addUpdateListener }) =>
    new ConstraintCategoryInput.Global(collection, addUpdateListener));
  const panel = document.getElementById('global-constraints-container');

  change(checkbox('Anti-Consecutive'), true);
  assert.deepEqual(collection.strings(), ['.AntiConsecutive']);
  assert.ok(panel.classList.contains('constraint-panel-highlight'));
});

await runTest('on a Raw grid, only the checkboxes without Sudoku rules are enabled', () => {
  const { input } = setUpLayoutCheckboxes(CellGeometry.fromShapeSpec('9x9~~Raw'));
  assert.equal(checkbox('Yin-Yang').disabled, false);
  assert.equal(checkbox('Windoku').disabled, true);
  assert.ok(checkbox('Windoku').parentElement.classList.contains('disabled'));

  input.reshape(CellGeometry.fromGridSize(9));
  assert.equal(checkbox('Windoku').disabled, false);
});

await runTest('a checkbox is found for its constraint type', () => {
  const { input } = setUpLayoutCheckboxes();
  assert.equal(input.getConstraintInputElement(SudokuConstraint.Windoku), checkbox('Windoku'));
  assert.equal(input.getConstraintInputElement(SudokuConstraint.Cage), null);
});

// ============================================================================
// Lines & Sets
// ============================================================================

const setUpLinesAndSets = (geometry) => {
  const page = setUp(multiCellForm('lines-and-sets-input'),
    ({ collection, inputManager }) =>
      new ConstraintCategoryInput.LinesAndSets(collection, inputManager), geometry);
  const form = document.forms['lines-and-sets-input'];
  const valueInput = (type) => form[`${type}-value`];
  // The user picks a constraint type.
  const pick = (type) => change(form['constraint-type'], type);
  const add = (cells, values = {}) => {
    page.inputManager.setSelection(cells);
    for (const [type, value] of Object.entries(values)) valueInput(type).value = value;
    form.requestSubmit();
  };
  return Object.assign(page, { form, valueInput, pick, add });
};

const optionFor = (form, type) => form['constraint-type'].options.find(o => o.value === type);

await runTest('the type list has every Lines & Sets constraint, with Cage chosen', () => {
  const { form, valueInput } = setUpLinesAndSets();
  const types = form['constraint-type'].options.map(o => o.value);

  assert.deepEqual([...types].sort(),
    ConstraintCategoryInput.LinesAndSets.constraintClasses().map(c => c.name).sort());
  assert.equal(form['constraint-type'].value, 'Cage');
  assert.equal(form.querySelector('div.description').textContent,
    SudokuConstraint.Cage.DESCRIPTION);
  assert.equal(valueInput('Cage').style.display, 'inline');
});

await runTest('choosing a type shows its value input, loop option and description', () => {
  const { form, valueInput, pick } = setUpLinesAndSets();
  const valueContainer = form.querySelector('.constraint-value');
  const loop = form.querySelector('.constraint-loop');

  pick('SumLine');
  assert.equal(valueInput('SumLine').style.display, 'inline');
  assert.equal(valueInput('Cage').style.display, 'none');
  assert.equal(valueContainer.style.visibility, 'visible');
  assert.equal(loop.style.display, 'block');

  pick('Thermo');
  assert.equal(valueContainer.style.visibility, 'hidden');
  assert.equal(loop.style.display, 'none');
  assert.equal(form.querySelector('div.description').textContent,
    SudokuConstraint.Thermo.DESCRIPTION);
});

await runTest('the form is disabled until cells are selected', () => {
  const { form, inputManager } = setUpLinesAndSets();
  assert.ok(form.classList.contains('disabled'));
  assert.equal(form['add-constraint'].disabled, true);

  inputManager.setSelection(['R1C1', 'R1C2']);
  assert.ok(!form.classList.contains('disabled'));
  assert.equal(form['add-constraint'].disabled, false);

  inputManager.setSelection([]);
  assert.equal(form['add-constraint'].disabled, true);
});

await runTest('a selection disables the types it cannot make', () => {
  const { form, inputManager, pick } = setUpLinesAndSets();
  pick('Thermo');

  inputManager.setSelection(['R1C1']);
  assert.equal(optionFor(form, 'Thermo').disabled, true);
  assert.equal(optionFor(form, 'Indexing').disabled, false);
  assert.equal(form['add-constraint'].disabled, true);

  // A dot needs adjacent cells.
  inputManager.setSelection(['R1C1', 'R5C5']);
  assert.equal(optionFor(form, 'WhiteDot').disabled, true);
  assert.equal(optionFor(form, 'Thermo').disabled, false);

  // With nothing selected, every type can be looked at.
  inputManager.setSelection([]);
  assert.ok(form['constraint-type'].options.every(o => !o.disabled));
});

await runTest('adding uses the selection and the value, then clears the selection', () => {
  const page = setUpLinesAndSets();
  page.add(['R1C1', 'R1C2'], { Cage: '10' });

  assert.deepEqual(page.collection.strings(), ['.Cage~10~R1C1~R1C2']);
  assert.deepEqual(page.inputManager.getSelection(), []);
  assert.equal(page.updates, 1);
});

await runTest('a loop is added as a loop', () => {
  const { collection, form, pick, add } = setUpLinesAndSets();
  pick('SumLine');
  form['is-loop'].checked = true;
  add(['R1C1', 'R1C2', 'R2C2'], { SumLine: '5' });
  assert.deepEqual(collection.strings(), ['.SumLine~5~R1C1~R1C2~R2C2~LOOP']);
});

await runTest('quad and contain values keep only values in the grid', () => {
  const { collection, pick, add } = setUpLinesAndSets();

  pick('Quad');
  add(['R2C2', 'R1C2', 'R1C1', 'R2C1'], { Quad: '1 2 x 12' });
  pick('ContainExact');
  add(['R5C5', 'R5C6'], { ContainExact: '1,3' });
  // Nothing to add.
  add(['R7C7', 'R7C8'], { ContainExact: '0' });

  assert.deepEqual(collection.strings(),
    ['.Quad~R1C1~1~2', '.ContainExact~1_3~R5C5~R5C6']);
});

await runTest('a quad on var cells is placed at the lowest numbered cell', () => {
  const geometry = CellGeometry.fromGridSize(9);
  geometry.addVarCellsForConstraints([new SudokuConstraint.Var('X', '', 81)]);
  const { collection, pick, add } = setUpLinesAndSets(geometry);

  // VX2 is before VX11, though not as text.
  pick('Quad');
  add(['VX11', 'VX12', 'VX2', 'VX3'], { Quad: '1 2 3 4' });
  assert.deepEqual(collection.strings(), ['.Quad~VX2~1~2~3~4']);
});

await runTest('adding with nothing selected shows an error', () => {
  const { collection, form, add } = setUpLinesAndSets();
  add([]);
  assert.deepEqual(collection.strings(), []);
  assert.equal(form.querySelector('.notice-error').textContent, 'Selection too short.');
  runTimers();
});

await runTest('a constraint that cannot be made shows why', () => {
  const { collection, form, add } = setUpLinesAndSets();
  add(['R1C1', 'R1C2'], { Cage: 'x' });
  assert.deepEqual(collection.strings(), []);
  assert.equal(form.querySelector('.notice-error').textContent,
    'Cage sum must be an integer: x');
  runTimers();
});

await runTest('an invalid submission shows an error, until the selection changes', () => {
  const { collection, form, pick, add, inputManager } = setUpLinesAndSets();
  const error = form.querySelector('.notice-error');
  pick('Thermo');

  add(['R1C1']);
  assert.deepEqual(collection.strings(), []);
  assert.equal(error.textContent, 'Invalid selection for Thermo');

  inputManager.setSelection(['R1C1', 'R1C2']);
  assert.equal(error.textContent, '');
});

await runTest('Enter in a long value adds the constraint; Shift+Enter does not', () => {
  const { collection, pick, valueInput, inputManager } = setUpLinesAndSets();
  pick('Regex');
  const pattern = valueInput('Regex');
  assert.equal(pattern.tagName, 'TEXTAREA');
  inputManager.setSelection(['R1C1', 'R1C2']);
  pattern.value = '12';

  press(pattern, 'Enter', { shiftKey: true });
  assert.deepEqual(collection.strings(), []);
  press(pattern, 'Enter');
  assert.deepEqual(collection.constraints.map(c => [c.pattern, c.cells]),
    [['12', ['R1C1', 'R1C2']]]);
});

await runTest("a type's options can follow the selection", () => {
  const { form, pick, valueInput, inputManager, collection } = setUpLinesAndSets();
  pick('SameValues');
  const sets = valueInput('SameValues');
  assert.equal(sets.disabled, true);

  inputManager.setSelection(['R1C1', 'R1C2', 'R2C1', 'R2C2']);
  assert.deepEqual(sets.options.map(o => o.textContent), ['4 sets', '2 sets']);
  assert.equal(sets.disabled, false);

  sets.value = '2';
  form.requestSubmit();
  assert.deepEqual(collection.strings(), ['.SameValues~2~R1C1~R1C2~R2C1~R2C2']);
});

await runTest('focus goes to the value input, else the add button', () => {
  const { form, pick, valueInput, inputManager } = setUpLinesAndSets();
  const [focusTarget] = inputManager.focusTargets;
  assert.equal(focusTarget(), null, 'nothing to add');

  inputManager.setSelection(['R1C1', 'R1C2']);
  assert.equal(focusTarget(), valueInput('Cage'));
  pick('Thermo');
  assert.equal(focusTarget(), form['add-constraint']);
});

await runTest('the chosen type is remembered', () => {
  setUpLinesAndSets().pick('Thermo');
  const saved = sessionStorage.getItem('autoSave-lines-and-sets-input-select');
  assert.equal(saved, 'Thermo');
});

await runTest('the type input is found for its constraint type, and chosen', () => {
  const { form, input } = setUpLinesAndSets();
  assert.equal(input.getConstraintInputElement(SudokuConstraint.Thermo),
    form['constraint-type']);
  assert.equal(form['constraint-type'].value, 'Thermo');
  assert.equal(input.getConstraintInputElement(SudokuConstraint.Windoku), null);
});

// ============================================================================
// Chaos Construction
// ============================================================================

const setUpChaos = (geometry) => {
  const page = setUp(multiCellForm('chaos-constraint-input'),
    ({ collection, inputManager, addUpdateListener }) =>
      new ConstraintCategoryInput.ChaosConstruction(
        collection, inputManager, addUpdateListener), geometry);
  page.collection.addConstraint(new SudokuConstraint.ChaosConstruction());
  return Object.assign(page, { form: document.forms['chaos-constraint-input'] });
};

// A chaos arrow drawn over a 4x4 grid, in segments of cells.
const addChaosArrow = (...segments) => {
  const { form, collection, inputManager } = setUpChaos(CellGeometry.fromGridSize(4));
  inputManager.selectSegments(...segments);
  form.requestSubmit();
  return collection.constraints.at(-1);
};

await runTest('the Chaos panel is shown only with Chaos Construction', () => {
  const { form, collection } = setUpChaos();
  assert.equal(form.style.display, '');

  collection.removeConstraint(collection.constraints[0]);
  assert.equal(form.style.display, 'none');
});

await runTest('a chaos arrow on grid cells runs through their region cells', () => {
  const arrow = addChaosArrow(['R2C1', 'R2C2', 'R3C2']);
  assert.deepEqual(arrow.cells, ['R2C1', 'CC5', 'CC6', 'CC10']);
});

await runTest('a chaos arrow has an arm for each segment', () => {
  const arrow = addChaosArrow(['R2C1', 'R2C2'], ['R3C1']);
  assert.deepEqual(arrow.arms, [['CC5', 'CC6'], ['CC5', 'CC9']]);
});

await runTest('a chaos arrow starts on a grid cell, with its arm on grid or region cells', () => {
  const { form, inputManager } = setUpChaos(CellGeometry.fromGridSize(4));
  const allowed = (cells) => {
    inputManager.setSelection(cells);
    return !optionFor(form, 'ChaosArrow').disabled;
  };

  assert.equal(allowed(['R2C1']), true);
  assert.equal(allowed(['R2C1', 'R2C2']), true);
  assert.equal(allowed(['R2C1', 'CC6']), true);
  assert.equal(allowed(['CC5', 'CC6']), false);
  assert.equal(allowed(['R2C1', 'CC6', 'R2C3']), false);
});

await runTest('a chaos constraint on grid cells counts their region cells', () => {
  const { form, collection, inputManager } = setUpChaos();
  change(form['constraint-type'], 'ChaosCount');
  form['ChaosCount-value'].value = '1';

  inputManager.setSelection(['R1C1', 'R1C2', 'R2C2']);
  form.requestSubmit();
  assert.equal(collection.strings()[1], '.ChaosCount~R1C1~1~CC1~CC2~CC11');
});

// ============================================================================
// Composite constraints
// ============================================================================

const setUpComposite = () => {
  const page = setUp(compositeForm,
    ({ collection, inputManager, addUpdateListener }) =>
      new ConstraintCategoryInput.Composite(collection, addUpdateListener, inputManager));
  return Object.assign(page, { form: document.forms['composite-constraint-input'] });
};

await runTest('+ Or and + And add empty composites', () => {
  const { form, collection } = setUpComposite();
  form['add-or'].click();
  form['add-and'].click();
  assert.deepEqual(collection.constraints.map(c => c.type), ['Or', 'And']);
});

await runTest('+ Replicate targets the selected cells', () => {
  const { form, collection, inputManager } = setUpComposite();
  form['add-replicate'].click();
  inputManager.setSelection(['R2C2', 'R2C5']);
  form['add-replicate'].click();

  const [plain, targeted] = collection.constraints;
  assert.equal(plain.targetBitset, '');
  // Targets are relative to the first cell of their group.
  assert.equal(targeted.origin, 'R1C1');
  assert.equal(targeted.targetBitset, SudokuConstraint.Replicate.encodeTargetCells(
    ['R2C2', 'R2C5'], 'R1C1', CellGeometry.fromGridSize(9)));
});

// ============================================================================
// Regions
// ============================================================================

const setUpRegion = (geometry) => setUp(regionPanel,
  ({ collection, inputManager }) =>
    new ConstraintCategoryInput.Region(collection, inputManager), geometry);

const row = (r, n = 9) => Array.from({ length: n }, (_, i) => `R${r}C${i + 1}`);

await runTest('a jigsaw piece can be added for a full, free set of cells', () => {
  const { collection, inputManager } = setUpRegion();
  const button = document.getElementById('add-jigsaw-button');
  const canAdd = (cells) => {
    inputManager.setSelection(cells);
    return !button.disabled;
  };

  assert.equal(canAdd(row(1, 8)), false, 'too few cells');
  assert.equal(canAdd(row(1)), true);

  button.click();
  assert.deepEqual(collection.constraints.map(c => c.cells), [row(1)]);
  assert.equal(canAdd([...row(1, 8), 'R2C1']), false, 'overlaps a piece');
});

await runTest('the region size is offered only for grids with extra values', () => {
  setUpRegion();
  const select = document.getElementById('region-size-select');
  assert.equal(select.parentNode.style.display, 'none');

  const { collection } = setUpRegion(CellGeometry.fromShapeSpec('6x6~1-9'));
  const sizeSelect = document.getElementById('region-size-select');
  assert.equal(sizeSelect.parentNode.style.display, 'block');
  assert.deepEqual(sizeSelect.options.map(o => o.textContent), ['6', '9']);
  assert.equal(sizeSelect.value, '6');

  collection.addConstraint(new SudokuConstraint.Jigsaw('6x6~1-9', ...row(1, 6)));
  change(sizeSelect, '9');
  assert.deepEqual(collection.strings(), ['.RegionSize~9'], 'the pieces are cleared');

  change(sizeSelect, '6');
  assert.deepEqual(collection.strings(), []);
});

await runTest('a jigsaw piece is the region size', () => {
  const { inputManager } = setUpRegion(CellGeometry.fromShapeSpec('6x6~1-9'));
  const button = document.getElementById('add-jigsaw-button');
  change(document.getElementById('region-size-select'), '9');

  inputManager.setSelection([...row(1, 6), ...row(2, 3)]);
  assert.equal(button.disabled, false);
});

await runTest('the region size and same values inputs follow the constraints', () => {
  const { collection, input } = setUpRegion(CellGeometry.fromShapeSpec('6x6~1-9'));
  const select = document.getElementById('region-size-select');
  const sameValues = document.getElementById('region-same-values-checkbox');

  const [size, same] = parse('.RegionSize~9.RegionSameValues');
  collection.addConstraint(size);
  collection.addConstraint(same);
  assert.equal(select.value, '9');
  assert.equal(sameValues.checked, true);

  collection.removeConstraint(size);
  collection.removeConstraint(same);
  assert.equal(select.value, '6');
  assert.equal(sameValues.checked, false);

  change(sameValues, true);
  assert.deepEqual(collection.strings(), ['.RegionSameValues']);
  change(sameValues, false);
  assert.deepEqual(collection.strings(), []);
  assert.equal(input.getConstraintInputElement(SudokuConstraint.Jigsaw),
    document.getElementById('add-jigsaw-button'));
});

// ============================================================================
// Outside clues
// ============================================================================

const setUpOutsideClues = () => {
  const page = setUp(outsideClues, ({ collection, inputManager }) =>
    new ConstraintCategoryInput.OutsideClue(collection, inputManager));
  const form = document.forms['outside-clue-input'];
  const enabledTypes = () => [...form.type].filter(r => !r.disabled).map(r => r.value);
  const selectArrow = (arrowId) => page.inputManager.updateOutsideArrowSelection(arrowId);
  return Object.assign(page, { form, enabledTypes, selectArrow });
};

await runTest('an arrow enables the form for the clue types it can take', () => {
  const { form, enabledTypes, selectArrow } = setUpOutsideClues();
  assert.equal(form.firstElementChild.disabled, true);

  selectArrow('R1,1');
  assert.equal(form.firstElementChild.disabled, false);
  assert.equal(form.id.value, 'R1,1');
  assert.ok(enabledTypes().includes('Sandwich'));
  assert.ok(!enabledTypes().includes('LittleKiller'));

  // Sandwich clues are only read from the start of a row.
  selectArrow('R1,-1');
  assert.ok(!enabledTypes().includes('Sandwich'));
  assert.ok(enabledTypes().includes('XSum'));

  selectArrow('R1C1');
  assert.deepEqual(enabledTypes(), ['LittleKiller']);
  assert.equal(form.type.value, 'LittleKiller', 'a valid type is chosen');

  selectArrow(null);
  assert.equal(form.firstElementChild.disabled, true);
});

await runTest('a clue is set from its value, and cleared by no value or Clear', () => {
  const { form, collection, inputManager, selectArrow } = setUpOutsideClues();
  const setClue = (value) => {
    selectArrow('R1,1');
    form.type.value = 'Sandwich';
    form.value.value = value;
    form.requestSubmit();
  };

  setClue('15');
  assert.deepEqual(collection.strings(), ['.Sandwich~15~R1']);
  assert.deepEqual(inputManager.getSelection(), []);

  setClue('');
  assert.deepEqual(collection.strings(), []);

  setClue('15');
  document.getElementById('outside-arrow-clear').click();
  assert.deepEqual(collection.strings(), []);
});

await runTest("choosing an arrow with a clue chooses the clue's type", () => {
  const { form, collection, selectArrow } = setUpOutsideClues();
  collection.addConstraint(parse('.XSum~R1~10~')[0]);
  form.type.value = 'Sandwich';

  selectArrow('R1,1');
  assert.equal(form.type.value, 'XSum');
});

await runTest('a clue type input is found for its constraint type, and chosen', () => {
  const { form, input } = setUpOutsideClues();
  const option = input.getConstraintInputElement(SudokuConstraint.Skyscraper);
  assert.equal(option.firstChild, form['Skyscraper-option']);
  assert.equal(form.type.value, 'Skyscraper');
});

const setUpOutsideClueOptions = (geometry) => setUp(outsideClueOptions,
  ({ collection }) => new ConstraintCategoryInput.OutsideClueOption(collection), geometry);

await runTest('an option is set by its select, and unset at its default', () => {
  const { collection, input } = setUpOutsideClueOptions();
  const select = input.getConstraintInputElement(SudokuConstraint.FullRankTies);
  assert.equal(select.value, 'only-unclued');

  change(select, 'any');
  assert.deepEqual(collection.strings(), ['.FullRankTies~any']);
  change(select, 'only-unclued');
  assert.deepEqual(collection.strings(), []);
});

await runTest('an option select follows its constraint', () => {
  const { collection, input } = setUpOutsideClueOptions();
  const select = input.getConstraintInputElement(SudokuConstraint.FullRankTies);
  const [ties] = parse('.FullRankTies~none');

  collection.addConstraint(ties);
  assert.equal(select.value, 'none');
  collection.removeConstraint(ties);
  assert.equal(select.value, 'only-unclued');

  change(select, 'any');
  input.clear();
  assert.equal(select.value, 'only-unclued');
});

await runTest('an option that cannot be added reverts, with the error shown', () => {
  const { collection, input } = setUpOutsideClueOptions();
  collection.addConstraint = () => { throw new Error('No'); };
  const select = input.getConstraintInputElement(SudokuConstraint.FullRankTies);

  change(select, 'any');
  assert.equal(select.value, 'only-unclued');
  assert.equal(errorText('outside-clue-options-error'), 'No');
  runTimers();
});

await runTest('an option is disabled where it does not apply', () => {
  const { input } = setUpOutsideClueOptions(CellGeometry.fromShapeSpec('9x9~~Raw'));
  const select = input.getConstraintInputElement(SudokuConstraint.FullRankTies);
  assert.equal(select.disabled, true);
  assert.ok(select.parentElement.classList.contains('disabled'));
});

// ============================================================================
// Multiple values
// ============================================================================

const setUpMultiValues = (geometry) => {
  const page = setUp(multiValueForm, ({ collection, inputManager }) =>
    new ConstraintCategoryInput.GivenCandidates(collection, inputManager), geometry);
  const form = document.forms['multi-value-cell-input'];
  const boxes = form.querySelectorAll('input[type="checkbox"]');
  const checked = () => boxes.flatMap((b, i) => b.checked ? [i + 1] : []);
  const button = (text) => form.querySelectorAll('button').find(b => b.textContent === text);
  const select = (...cells) => {
    page.inputManager.setSelection(cells);
    runFrames();
  };
  return Object.assign(page, { form, boxes, checked, button, select });
};

await runTest('there is a button for each value', () => {
  const { boxes } = setUpMultiValues();
  assert.deepEqual(boxes.map(b => b.parentNode.textContent),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.equal(boxes[0].parentNode.parentNode.style['grid-template-columns'],
    'repeat(3, 1fr)');
});

await runTest("a cell's candidates are shown when it is selected", () => {
  const { collection, form, checked, select } = setUpMultiValues();
  const fieldset = form.firstElementChild;
  collection.addConstraint(parse('.~R1C2_1_2')[0]);

  select('R1C1');
  assert.deepEqual(checked(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(fieldset.getAttribute('disabled'), null);

  select('R1C2');
  assert.deepEqual(checked(), [1, 2]);

  select();
  assert.deepEqual(checked(), []);
  assert.equal(fieldset.getAttribute('disabled'), '');
});

await runTest('changing the values sets the candidates of the selected cells', () => {
  const { collection, boxes, button, select } = setUpMultiValues();
  select('R1C1', 'R1C2');

  change(boxes[8], false);
  assert.deepEqual(collection.strings(),
    ['.~R1C1_1_2_3_4_5_6_7_8', '.~R1C2_1_2_3_4_5_6_7_8']);

  button('Odd').click();
  assert.deepEqual(collection.strings(), ['.~R1C1_1_3_5_7_9', '.~R1C2_1_3_5_7_9']);
  button('Even').click();
  assert.deepEqual(collection.strings(), ['.~R1C1_2_4_6_8', '.~R1C2_2_4_6_8']);

  // Every value is no constraint.
  button('All').click();
  assert.deepEqual(collection.strings(), []);
});

await runTestCases('typing digits in a cell sets its value', [
  ['a digit', '9x9', [5], ['.~R1C1_5']],
  ['the highest value', '9x9', [9], ['.~R1C1_9']],
  ['delete clears it', '9x9', [5, null], []],
  ['digits make a larger value', '16x16', [1, 6], ['.~R1C1_16']],
  ['a 0 makes a larger value', '16x16', [1, 0], ['.~R1C1_10']],
  ['past the highest value starts again', '9x9', [1, 5], ['.~R1C1_5']],
  ['past the highest value starts again on 16x16', '16x16', [1, 7], ['.~R1C1_7']],
  ['a 0 below the values is no value', '9x9', [0], []],
  ['a 0 in the values', '9x9~0-8', [0], ['.~R1C1_0']],
], (shape, digits, expected) => {
  const { collection, inputManager } = setUpMultiValues(CellGeometry.fromShapeSpec(shape));
  for (const digit of digits) inputManager.typeDigit('R1C1', digit);
  assert.deepEqual(collection.strings(), expected);
});

await runTest('typing replaces candidates, and each cell is typed separately', () => {
  const { collection, inputManager } = setUpMultiValues();
  collection.addConstraint(parse('.~R1C1_2_5')[0]);

  inputManager.typeDigit('R1C1', 3);
  inputManager.typeDigit('R2C2', 7);
  assert.deepEqual(collection.strings(), ['.~R1C1_3', '.~R2C2_7']);
});

await runTest('changing the values with nothing selected does nothing', () => {
  const { collection, boxes } = setUpMultiValues();
  change(boxes[0], true);
  assert.deepEqual(collection.strings(), []);
});

// ============================================================================
// Custom JavaScript constraints
// ============================================================================

// The user script executor, which compiles in a worker: each call waits until
// it is resolved or rejected with finish().
const makeExecutor = () => {
  const executor = { calls: [] };
  const call = (name) => (...args) => new Promise((resolve, reject) => {
    executor.calls.push({ name, args });
    executor.finish = (value, error) => error ? reject(error) : resolve(value);
  });
  for (const name of ['compilePairwise', 'compileStateMachine', 'convertUnifiedToSplit']) {
    executor[name] = call(name);
  }
  return executor;
};

const setUpCustom = (InputClass) => {
  const executor = makeExecutor();
  const page = setUp(customConstraintForm, ({ collection, inputManager }) =>
    new InputClass(collection, inputManager, executor));
  const select = (...segments) => {
    page.inputManager.selectSegments(...segments);
    runFrames();
  };
  return Object.assign(page, {
    executor, select, form: document.forms['custom-constraint-input'],
  });
};

await runTest('a custom constraint can be added once two cells are selected', () => {
  const { form, select } = setUpCustom(ConstraintCategoryInput.Pairwise);
  const add = form['add-pairwise-constraint'];
  const tab = document.getElementById('custom-pairwise-tab');
  assert.equal(add.disabled, true);

  select(['R1C1']);
  assert.equal(add.disabled, true);
  assert.ok(tab.classList.contains('disabled'));

  select(['R1C1', 'R1C2']);
  assert.equal(add.disabled, false);
  assert.ok(!tab.classList.contains('disabled'));
});

await runTest('a pairwise constraint is compiled and added for the selection', async () => {
  const { form, select, executor, collection, inputManager } =
    setUpCustom(ConstraintCategoryInput.Pairwise);
  const add = form['add-pairwise-constraint'];
  const spinner = add.querySelector('.spinner');
  select(['R1C1', 'R1C2']);
  form['pairwise-name'].value = 'less';
  form['chain-mode'].value = 'PairX';
  form['function'].value = 'a < b';

  add.click();
  assert.deepEqual(executor.calls[0], {
    name: 'compilePairwise', args: ['PairX', 'a < b', 9, 0],
  });
  assert.ok(spinner.classList.contains('active'));
  assert.equal(add.disabled, true, 'no second click while compiling');

  executor.finish('KEY');
  await settle();
  assert.deepEqual(collection.constraints.map(c => [c.type, c.key, c.name, c.cells]),
    [['PairX', 'KEY', 'less', ['R1C1', 'R1C2']]]);
  assert.deepEqual(inputManager.getSelection(), []);
  assert.ok(!spinner.classList.contains('active'));
  assert.equal(add.disabled, true, 'nothing is selected');
});

await runTest('a pairwise compile error is shown until the function is edited', async () => {
  const { form, select, executor, collection } = setUpCustom(ConstraintCategoryInput.Pairwise);
  select(['R1C1', 'R1C2']);

  form['add-pairwise-constraint'].click();
  executor.finish(undefined, new Error('bad function'));
  await settle();
  assert.equal(errorText('custom-pairwise-input-error'), 'Error: bad function');
  assert.deepEqual(collection.strings(), []);
  assert.equal(form['add-pairwise-constraint'].disabled, false);

  form['function'].oninput();
  assert.equal(errorText('custom-pairwise-input-error'), '');
});

await runTest("a pairwise constraint's function can be shown for editing", () => {
  const { form, input } = setUpCustom(ConstraintCategoryInput.Pairwise);
  const [pair] = parse('.Pair~8H_xf8H_xf8H_B~_a~R1C1~R1C2');

  input.populateForm(pair, 9, 1);
  assert.ok(document.getElementById('custom-constraint-panel')
    .classList.contains('container-open'));
  assert.equal(form['pairwise-name'].value, 'a');
  assert.equal(form['chain-mode'].value, 'Pair');
  assert.notEqual(form['function'].value, '');

  assert.equal(input.getConstraintInputElement(SudokuConstraint.PairX), form['chain-mode']);
  assert.equal(form['chain-mode'].value, 'PairX');
});

await runTest('a state machine switches between split and unified code', async () => {
  const { form, executor } = setUpCustom(ConstraintCategoryInput.StateMachine);
  const split = document.getElementById('state-machine-split-input');
  const unified = document.getElementById('state-machine-unified-input');
  form['start-state'].value = '0';
  form['transition-body'].value = 'return state + value;';
  form['accept-body'].value = 'return state == 10;';
  assert.equal(unified.style.display, 'none');

  change(form['unified-mode'], true);
  assert.equal(split.style.display, 'none');
  assert.equal(unified.style.display, '');
  assert.equal(form['unified-code'].value, [
    'startState = 0;',
    '',
    'function transition(state, value) {',
    '  return state + value;',
    '}',
    '',
    'function accept(state) {',
    '  return state == 10;',
    '}',
  ].join('\n'));

  change(form['unified-mode'], false);
  executor.finish({
    startExpression: '1', transitionBody: 't', acceptBody: 'a', maxDepthExpression: '3',
  });
  await settle();
  assert.deepEqual(
    ['start-state', 'transition-body', 'accept-body', 'max-depth'].map(n => form[n].value),
    ['1', 't', 'a', '3']);
  assert.equal(split.style.display, '');
});

await runTest('unified code that does not parse keeps the split fields', async () => {
  const { form, executor } = setUpCustom(ConstraintCategoryInput.StateMachine);
  change(form['unified-mode'], true);
  form['start-state'].value = 'kept';

  change(form['unified-mode'], false);
  executor.finish(undefined, new Error('parse error'));
  await settle();
  assert.equal(form['start-state'].value, 'kept');
});

await runTest('a state machine is compiled for the selected segments', async () => {
  const { form, select, executor, collection } =
    setUpCustom(ConstraintCategoryInput.StateMachine);
  select(['R1C1', 'R1C2'], ['R3C3']);
  form['state-machine-name'].value = 'sum';
  form['start-state'].value = '0';

  form['add-state-machine-constraint'].click();
  const [{ name, args }] = executor.calls;
  assert.equal(name, 'compileStateMachine');
  const [spec, ...rest] = args;
  assert.equal(spec.startExpression, '0');
  // 9 values over 3 cells, split code, no value offset, in several segments.
  assert.deepEqual(rest, [9, 3, false, 0, true]);

  executor.finish('ENC');
  await settle();
  const [nfa] = collection.constraints;
  assert.deepEqual([nfa.encodedNFA, nfa.name, nfa.segments],
    ['ENC', 'sum', [['R1C1', 'R1C2'], ['R3C3']]]);
});

await runTest('a state machine error is shown with its help link', async () => {
  const { form, select, executor, input } = setUpCustom(ConstraintCategoryInput.StateMachine);
  select(['R1C1', 'R1C2']);

  form['add-state-machine-constraint'].click();
  executor.finish(undefined, Object.assign(
    new Error('Too many states'), { helpUrl: 'help#states', helpText: 'Why?' }));
  await settle();
  const error = document.getElementById('state-machine-input-error');
  const link = error.querySelector('a');
  assert.equal(error.textContent, 'Too many states Why?');
  assert.equal(link.href, 'help#states');

  form['accept-body'].dispatch('input');
  assert.equal(error.textContent, '');

  assert.equal(input.getConstraintInputElement(SudokuConstraint.NFA),
    document.body.querySelector('[data-tab="state-machine-tab"]'));
});

// ============================================================================
// Shape
// ============================================================================

const setUpShape = () => {
  const page = setUp(shapePanel,
    ({ collection }) => new ConstraintCategoryInput.Shape(collection));
  const dropdown = document.getElementById('shape-dropdown');
  return Object.assign(page, {
    shapeInput: document.getElementById('shape-input'),
    isOpen: () => dropdown.classList.contains('dropdown-open'),
    highlighted: () => document.getElementById('shape-dropdown-items').children
      .findIndex(i => i.classList.contains('highlighted')),
    varForm: document.forms['var-constraint-input'],
    gridType: document.getElementById('grid-type-input'),
    minValue: document.getElementById('value-range-min'),
    maxValue: document.getElementById('value-range-max'),
  });
};

// A shape spec, as a geometry.
const shape = (spec) => CellGeometry.fromShapeSpec(spec);

await runTest('the shape input shows the dimensions, without the values or type', () => {
  const { shapeInput: input, collection } = setUpShape();
  collection.setShape(shape('9x9~0-8'));
  assert.equal(input.value, '9x9');
  collection.setShape(shape('6x6~~Raw'));
  assert.equal(input.value, '6x6');
});

await runTest('typed dimensions keep the grid type, unless they give one', () => {
  const { shapeInput: input, collection } = setUpShape();
  collection.setShape(shape('9x9~~Raw'));

  input.value = '6x6';
  press(input, 'Enter');
  assert.equal(collection.shaped.name, '6x6~~Raw');

  input.value = '5x5~~Sudoku';
  press(input, 'Enter');
  assert.equal(collection.shaped.name, '5x5');
});

await runTest('a shape that is not dimensions is refused', () => {
  const { shapeInput: input, collection } = setUpShape();
  for (const spec of ['$A', 'VA~1-9']) {
    input.value = spec;
    press(input, 'Enter');
    assert.equal(collection.shaped, null, spec);
    assert.ok(input.validationMessage, spec);
  }
});

await runTest('the value range can be changed, keeping the dimensions and type', () => {
  const { minValue, maxValue, collection } = setUpShape();
  change(minValue, '0');
  change(maxValue, '8');
  assert.equal(collection.shaped.name, '9x9~0-8');

  collection.setShape(shape('9x9~~Raw'));
  change(maxValue, '8');
  assert.equal(collection.shaped.name, '9x9~8~Raw');
});

await runTest('the highest value can be as low as the grid type allows', () => {
  const { maxValue, collection } = setUpShape();
  // A Sudoku grid needs a value for each cell of a row.
  assert.equal(maxValue.options[0].textContent, '9');

  collection.setShape(shape('9x9~~Raw'));
  assert.equal(maxValue.options[0].textContent, '1');
});

await runTest('the grid type can be changed, keeping the dimensions and values', () => {
  const { gridType, collection } = setUpShape();
  assert.deepEqual(gridType.options.map(o => o.value), ['Sudoku', 'Raw', 'YinYang']);

  collection.setShape(shape('6x6~0-5'));
  change(gridType, 'Raw');
  assert.equal(collection.shaped.name, '6x6~0-5~Raw');
  assert.equal(gridType.value, 'Raw');
});

await runTest('a grid type the values are too few for is refused', () => {
  const { gridType, collection } = setUpShape();
  const twoValues = shape('9x9~1-2~Raw');
  collection.setShape(twoValues);

  change(gridType, 'Sudoku');
  assert.equal(collection.shaped, twoValues);
  assert.equal(gridType.value, 'Raw');
  assert.ok(gridType.validationMessage);
});

await runTest('the var cell size starts as the grid dimensions, unless typed', () => {
  const { varForm, collection } = setUpShape();
  const size = varForm['var-count'];
  assert.equal(size.value, '9x9');

  collection.setShape(shape('4x6~~Raw'));
  assert.equal(size.value, '4x6');

  size.value = '4x4';
  collection.addConstraint(new SudokuConstraint.Var('B', '', 4));
  assert.equal(size.value, '4x4');
});

await runTest('the arrow keys move through the shapes, and Enter picks one', () => {
  const { shapeInput: input, collection, isOpen, highlighted } = setUpShape();
  assert.deepEqual(
    document.getElementById('shape-dropdown-items').children.map(i => i.textContent),
    ['9x9', '6x6', '16x16']);
  input.dispatch('focus');
  assert.ok(isOpen());

  press(input, 'ArrowUp');
  assert.equal(highlighted(), 0, 'stays on the first');
  press(input, 'ArrowDown');
  press(input, 'ArrowDown');
  press(input, 'ArrowDown');
  assert.equal(highlighted(), 2, 'stops at the last');
  press(input, 'ArrowUp');

  press(input, 'Enter');
  assert.equal(collection.shaped.name, '6x6');
  assert.ok(!isOpen());
});

await runTest('Enter applies typed dimensions, and Escape closes the list', () => {
  const { shapeInput: input, collection, isOpen } = setUpShape();
  press(input, 'ArrowDown');
  // Typing replaces the selected text, so the highlighted shape isn't meant.
  input.value = '4x4';
  input.selectionStart = input.selectionEnd = 3;

  press(input, 'Escape');
  assert.ok(!isOpen());
  press(input, 'Enter');
  assert.equal(collection.shaped.name, '4x4');
});

await runTest('clicking a shape picks it, and leaving the input applies it', () => {
  const { shapeInput: input, collection } = setUpShape();
  const [, , large] = document.getElementById('shape-dropdown-items').children;

  large.onmousedown({ preventDefault() { } });
  assert.equal(collection.shaped.name, '16x16');

  input.value = '5x5';
  input.dispatch('blur');
  assert.equal(collection.shaped.name, '5x5');
});

await runTest('extra cells are added from the var form, which moves to the next prefix', () => {
  const { varForm, collection } = setUpShape();
  assert.equal(varForm['var-prefix'].value, 'A');

  varForm['var-count'].value = '4';
  varForm['var-label'].value = ' lights ';
  varForm.requestSubmit();
  assert.deepEqual(collection.strings(), ['.Var~A~lights~4']);
  assert.equal(varForm['var-prefix'].value, 'B');
});

await runTest('a bad var prefix is shown as an error until it is edited', () => {
  const { varForm, collection } = setUpShape();
  const prefix = varForm['var-prefix'];
  prefix.value = '1';
  varForm.requestSubmit();
  assert.deepEqual(collection.strings(), []);
  assert.notEqual(errorText('var-constraint-input-error'), '');

  prefix.value = 'b';
  prefix.dispatch('input');
  assert.equal(prefix.value, 'B');
  assert.equal(errorText('var-constraint-input-error'), '');
});

// ============================================================================
// Cell groups
// ============================================================================

const setUpCellGroup = (geometry) => {
  const page = setUp(cellGroupPanel,
    ({ collection }) => new ConstraintCategoryInput.CellGroup(collection), geometry);
  const form = document.forms['connected-values-input'];
  const add = (group, values, size = '') => {
    form['cell-group'].value = group;
    form['values'].value = values;
    form['size'].value = size;
    form.requestSubmit();
  };
  const addGroup = (prefix, label, count) =>
    page.collection.addConstraint(new SudokuConstraint.Var(prefix, label, count));
  return Object.assign(page, {
    form, add, addGroup,
    panel: document.getElementById('cell-group-constraint-container'),
  });
};

await runTest('on a Sudoku grid, cell groups are only offered for var cells', () => {
  const { panel, addGroup, input, form } = setUpCellGroup();
  assert.equal(panel.style.display, 'none');
  assert.equal(input.getConstraintInputElement(SudokuConstraint.ConnectedValues), null);

  addGroup('A', '', 9);
  assert.equal(panel.style.display, '');
  assert.equal(input.getConstraintInputElement(SudokuConstraint.ConnectedValues),
    form['cell-group']);
});

await runTest('on another grid type, the grid itself is a cell group', () => {
  const { panel, form, add, collection } = setUpCellGroup(shape('9x9~~Raw'));
  assert.equal(panel.style.display, '');
  assert.deepEqual(form['cell-group'].options.map(o => o.textContent), ['Grid']);

  add('', '1');
  assert.deepEqual(collection.strings(), ['.ConnectedValues~~1']);
});

await runTest('the cell groups follow the var cells', () => {
  const { form, addGroup, collection } = setUpCellGroup();
  addGroup('A', 'lights', 9);
  addGroup('B', '', 4);
  const select = form['cell-group'];
  assert.deepEqual(select.options.map(o => [o.value, o.textContent]),
    [['', 'Grid'], ['VA', '$A: lights'], ['VB', '$B']]);

  // A removed group falls back to the grid.
  select.value = 'VB';
  collection.removeConstraint(collection.constraints[1]);
  assert.equal(select.value, '');
});

await runTest('connected values are added for a group, with an optional size', () => {
  const { add, addGroup, collection } = setUpCellGroup();
  addGroup('A', '', 9);
  addGroup('B', '', 9);

  add('VB', '1, 2 3', '4');
  add('VA', '5');
  assert.deepEqual(collection.strings().slice(2),
    ['.ConnectedValues~VB~1_2_3~4', '.ConnectedValues~VA~5']);
});

await runTest('connected values outside the grid values are refused', () => {
  const { add, addGroup, collection } = setUpCellGroup();
  addGroup('A', '', 9);

  for (const values of ['', '10', '1,x', '0']) {
    add('VA', values);
    assert.notEqual(errorText('cell-group-constraint-error'), '', values);
  }
  assert.deepEqual(collection.strings(), ['.Var~A~~9']);
  runTimers();
});

globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;
globalThis.FormData = realFormData;

logSuiteComplete('Constraint input');
