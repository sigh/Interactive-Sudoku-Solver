import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { FakeFormData, makeFakeDocument } from '../helpers/mock_dom.js';
import { constraintPage } from '../helpers/page_markup.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

const frames = [];
window.requestAnimationFrame = (cb) => frames.push(cb);
const runFrames = () => { for (const cb of frames.splice(0)) cb(); };

globalThis.addEventListener = () => { };
globalThis.removeEventListener = () => { };

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

// The user script executor starts a worker, which is never used here.
globalThis.Worker = class { postMessage() { } terminate() { } };

const copied = [];
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: async (text) => copied.push(text) },
  configurable: true,
});

const { ConstraintManager } = await import('../../js/render_page.js');
const { GridInputManager } = await import('../../js/grid_input.js');
const { DisplayContainer } = await import('../../js/display.js');

// A ConstraintManager on a new page, built as initPage builds it.
const makeManager = ({ keepStorage = false } = {}) => {
  globalThis.document = makeFakeDocument();
  if (!keepStorage) {
    sessionStorage.clear();
    localStorage.clear();
  }
  document.body.append(constraintPage());
  const byId = (id) => document.getElementById(id);

  const container = new DisplayContainer(byId('sudoku-grid'));
  const inputManager = new GridInputManager(container);
  const manager = new ConstraintManager(inputManager, container);
  let updates = 0;
  manager.addUpdateListener(() => updates++);
  runFrames();

  const freeform = document.forms['freeform-constraint-input'];
  return {
    manager, inputManager, byId,
    updates: () => updates,
    freeform,
    freeformError: () => freeform.querySelector('.notice-error').textContent,
    // Loads a puzzle through the free-form input.
    load(text) {
      freeform['freeform-input'].value = text;
      freeform.requestSubmit();
      runFrames();
    },
    // Adds a Lines & Sets constraint for the selected cells.
    addLinesAndSets(type, cells, value) {
      const form = document.forms['lines-and-sets-input'];
      inputManager.setSelection(cells);
      change(form['constraint-type'], type);
      form[`${type}-value`].value = value;
      form.requestSubmit();
      runFrames();
    },
    puzzle: () => manager.getConstraints().toString(),
    chipLabels: () => document.querySelectorAll(
      '.chip-view[data-chip-view-type="ordinary"] > .chip > .chip-label')
      .map(label => label.firstChild.textContent),
    drawn: (displayClass) => document.querySelector(
      `.${displayClass.toLowerCase()}-group`).children.length,
  };
};

const change = (control, value) => {
  if (typeof value === 'boolean') control.checked = value;
  else control.value = value;
  control.dispatch('change', { bubbles: true });
};

// ============================================================================
// Loading and reading the puzzle
// ============================================================================

await runTest('a puzzle loaded as text replaces the puzzle and its shape', () => {
  const page = makeManager();
  page.load('.Shape~6x6.Cage~3~R1C1~R1C2');
  assert.equal(page.byId('shape-input').value, '6x6');
  assert.deepEqual(page.chipLabels(), ['Cage (3)']);
  assert.equal(page.drawn('ShadedRegion'), 1);

  page.load('.Shape~4x4.Thermo~R1C1~R1C2');
  assert.equal(page.puzzle(), '.Shape~4x4.Thermo~R1C1~R1C2');
  assert.deepEqual(page.chipLabels(), ['Thermometer']);
  assert.equal(page.drawn('ShadedRegion'), 0);
});

await runTest('var cells are defined before the constraints that use them', () => {
  const page = makeManager();
  page.load('.Shape~4x4.Cage~3~VA1~VA2.Var~A~~4');
  assert.equal(page.puzzle(), '.Shape~4x4.Var~A~~4.Cage~3~VA1~VA2');
});

await runTest('text that cannot be loaded shows why, and keeps the puzzle', () => {
  const page = makeManager();
  page.load('.Shape~4x4.Cage~3~R1C1~R1C2');
  page.load('.Shape~4x4.Cage~x~R1C1');
  assert.notEqual(page.freeformError(), '');
  assert.ok(page.byId('freeform-constraint-panel').classList.contains('container-open'));
  assert.equal(page.puzzle(), '.Shape~4x4.Cage~3~R1C1~R1C2');

  page.freeform['freeform-input'].dispatch('input');
  assert.equal(page.freeformError(), '');
});

await runTest('loading from elsewhere puts failing text in the text box', () => {
  const page = makeManager();
  page.manager.loadUnsafeFromText('.Cage~x~R1C1');
  assert.equal(page.freeform['freeform-input'].value, '.Cage~x~R1C1');
});

await runTest('the layout constraints are those of layout categories', () => {
  const page = makeManager();
  page.load('.Shape~4x4.AntiKnight.Cage~3~R1C1~R1C2.Jigsaw~0000111122223333');
  assert.equal(page.manager.getLayoutConstraints().toString(),
    '.Shape~4x4.AntiKnight.Jigsaw~0000111122223333');
});

await runTest('the puzzle can be copied, or put in the text box', () => {
  const page = makeManager();
  page.load('.Shape~4x4.Cage~3~R1C1~R1C2');

  copied.length = 0;
  page.byId('copy-constraints-button').click();
  assert.deepEqual(copied.map(String), ['.Shape~4x4.Cage~3~R1C1~R1C2']);

  page.freeform['freeform-input'].value = '';
  page.byId('freeform-load-current-button').click();
  assert.equal(page.freeform['freeform-input'].value, '.Shape~4x4.Cage~3~R1C1~R1C2');
});

await runTest('Clear removes the constraints and resets the inputs, keeping the shape', () => {
  const page = makeManager();
  page.load('.Shape~4x4.Cage~3~R1C1~R1C2.AntiKnight');
  const updates = page.updates();

  page.byId('clear-constraints-button').click();
  runFrames();
  assert.equal(page.puzzle(), '.Shape~4x4');
  assert.deepEqual(page.chipLabels(), []);
  assert.equal(page.drawn('ShadedRegion'), 0);
  assert.ok(document.querySelectorAll('input[type="checkbox"]').every(c => !c.checked));
  assert.equal(page.updates(), updates + 1, 'updates are batched per frame');
});

// ============================================================================
// Panels
// ============================================================================

await runTest('the layout and outside clue panels are hidden off Sudoku grids', () => {
  const page = makeManager();
  const shown = () => ['layout-constraint-container', 'outside-clue-container']
    .map(id => page.byId(id).style.display);
  page.load('.Shape~4x4~~Raw');
  assert.deepEqual(shown(), ['none', 'none']);
  page.load('.Shape~4x4');
  assert.deepEqual(shown(), ['', '']);
});

await runTest('the layout panel is highlighted while it has a constraint', () => {
  const page = makeManager();
  const highlighted = () => page.byId('layout-constraint-container')
    .classList.contains('constraint-panel-highlight');
  page.load('.Shape~4x4.AntiKnight');
  assert.ok(highlighted());
  page.load('.Shape~4x4.Cage~3~R1C1~R1C2');
  assert.ok(!highlighted());
});

await runTest('a new composite is selected, so new constraints go into it', () => {
  const page = makeManager();
  page.load('.Shape~4x4');
  document.forms['composite-constraint-input']['add-or'].click();
  runFrames();
  const or = document.querySelector('.chip-view[data-chip-view-type="composite"] > .chip');
  assert.ok(or.classList.contains('selected-constraint'));
  assert.ok(page.byId('constraint-panel-container')
    .classList.contains('composite-constraint-selected'));

  page.addLinesAndSets('Cage', ['R1C1', 'R1C2'], '3');
  assert.deepEqual(page.chipLabels(), []);
  assert.equal(page.puzzle(), '.Shape~4x4.Or.Cage~3~R1C1~R1C2.End');
});

await runTest("a pairwise chip's action shows its function for editing", () => {
  const page = makeManager();
  page.load('.Pair~8H_xf8H_xf8H_B~_a~R1C1~R1C2');
  document.querySelector('.chip-load-button').click();
  const form = document.forms['custom-constraint-input'];
  assert.ok(page.byId('custom-constraint-panel').classList.contains('container-open'));
  assert.equal(form['pairwise-name'].value, 'a');
  assert.notEqual(form['function'].value, '');
});

await runTest("a var cell group's close button removes it, with its constraints", () => {
  const page = makeManager();
  page.load('.Shape~4x4.Var~A~~4.Cage~3~VA1~VA2.Cage~4~R1C1~R1C2');
  const close = page.byId('sudoku-grid').descendants()
    .find(e => e.getAttribute?.('class') === 'var-cell-close');
  close.dispatch('click');
  assert.equal(page.puzzle(), '.Shape~4x4.Cage~4~R1C1~R1C2');
});

await runTest('constraints can be dimmed, and it is remembered', () => {
  const page = makeManager();
  const dimmed = () => page.byId('sudoku-grid').classList.contains('constraints-dimmed');
  change(page.byId('dim-constraints-input'), true);
  assert.ok(dimmed());
  assert.equal(page.byId('dim-constraints-warning').style.display, '');

  const reopened = makeManager({ keepStorage: true });
  assert.equal(reopened.byId('dim-constraints-input').checked, true);
  assert.ok(reopened.byId('sudoku-grid').classList.contains('constraints-dimmed'));

  change(reopened.byId('dim-constraints-input'), false);
  assert.ok(!reopened.byId('sudoku-grid').classList.contains('constraints-dimmed'));
  assert.equal(reopened.byId('dim-constraints-warning').style.display, 'none');
});

await runTest('the chosen custom constraint tab is shown, and remembered', () => {
  const tab = () => document.getElementById('custom-constraint-panel').querySelector(
    '.tab-container button[data-tab="state-machine-tab"]');
  const shown = (page) => ['custom-pairwise-tab', 'state-machine-tab']
    .map(id => page.byId(id).classList.contains('active'));

  const page = makeManager();
  tab().click();
  assert.deepEqual(shown(page), [false, true]);
  assert.ok(tab().classList.contains('active'));

  assert.deepEqual(shown(makeManager({ keepStorage: true })), [false, true]);
});

delete navigator.clipboard;
delete globalThis.Worker;
globalThis.FormData = realFormData;

logSuiteComplete('ConstraintManager');
