import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

// Set up a minimal DOM environment for the modules that need it.
const createMockElement = (tag = 'div', attrs = {}) => {
  const children = [];
  const classList = new Set();
  const styles = {};
  const element = {
    tagName: tag,
    children,
    childNodes: children,
    style: { setProperty: (k, v) => styles[k] = v, display: '' },
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      toggle: (c, force) => {
        if (force === undefined) force = !classList.has(c);
        if (force) classList.add(c); else classList.delete(c);
        return force;
      },
      has: (c) => classList.has(c),
      contains: (c) => classList.has(c),
    },
    getAttribute: (k) => attrs[k] || null,
    setAttribute: (k, v) => attrs[k] = v,
    hasChildNodes: () => children.length > 0,
    appendChild: (child) => children.push(child),
    append: (...items) => children.push(...items),
    querySelectorAll: () => [],
    querySelector: () => null,
    get firstElementChild() { return children[0] || createMockElement(); },
    get nextElementSibling() { return createMockElement(); },
    get parentNode() { return createMockElement('div', { id: 'mock-parent' }); },
    get parentElement() { return createMockElement('div', { id: 'mock-parent' }); },
    get id() { return attrs.id || 'mock-elem'; },
    set id(v) { attrs.id = v; },
    textContent: '',
    onclick: null,
    onchange: null,
    disabled: false,
    checked: false,
    value: '',
    dispatchEvent: () => { },
    focus: () => { },
    blur: () => { },
    select: () => { },
    addEventListener: () => { },
    replaceChildren: function () { children.length = 0; },
  };
  return element;
};

const elementsById = {
  'multi-value-cell-input': (() => {
    const anchor = createMockElement('div', { id: 'mv-anchor' });
    const body = createMockElement('div', { id: 'mv-body' });
    // Override the getter to return the real body.
    Object.defineProperty(anchor, 'nextElementSibling', { value: body, configurable: true });

    const form = createMockElement('form', { id: 'multi-value-cell-input' });
    form.children.push(anchor);
    // Override the getter to return the real anchor.
    Object.defineProperty(form, 'firstElementChild', { value: anchor, configurable: true });
    return form;
  })(),
};

const mockStorage = new Map();

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: {
    createElement: (tag) => createMockElement(tag),
    createTextNode: (text) => ({ textContent: text }),
    getElementById: (id) => elementsById[id] || createMockElement('div', { id }),
    activeElement: null,
  },
});

// Mock requestAnimationFrame so deferUntilAnimationFrame works.
globalThis.window.requestAnimationFrame = (cb) => { cb(); return 0; };

// Mock sessionStorage and localStorage for sessionAndLocalStorage.
const storageMock = {
  _data: new Map(),
  getItem(k) { return this._data.get(k) ?? null; },
  setItem(k, v) { this._data.set(k, v); },
  removeItem(k) { this._data.delete(k); },
};
globalThis.sessionStorage = storageMock;
globalThis.localStorage = { ...storageMock, _data: new Map() };

const { GridShape } = await import('../../js/grid_shape.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { ConstraintCategoryInput } = await import('../../js/constraint_input.js');

// Helper: create a mock collection that tracks constraints with
// uniqueness-key deduplication (matching RootConstraintCollection behavior).
const createMockCollection = () => {
  const constraints = [];
  return {
    constraints,
    addConstraint(c) {
      // Remove existing constraints with matching uniqueness keys and type.
      const keys = c.uniquenessKeys?.() || [];
      for (const key of keys) {
        for (let i = constraints.length - 1; i >= 0; i--) {
          if (constraints[i].type === c.type &&
            constraints[i].uniquenessKeys?.().includes(key)) {
            constraints.splice(i, 1);
          }
        }
      }
      constraints.push(c);
    },
    removeConstraint(c) {
      const idx = constraints.indexOf(c);
      if (idx >= 0) constraints.splice(idx, 1);
    },
    getConstraintsByKey(key) {
      return constraints.filter(c =>
        c.uniquenessKeys?.().includes(key) ||
        c.cell === key);
    },
  };
};

// Helper: create a mock inputManager.
const createMockInputManager = () => {
  const callbacks = { onNewDigit: [], onSelection: [] };
  return {
    onNewDigit(fn) { callbacks.onNewDigit.push(fn); },
    onSelection(fn) { callbacks.onSelection.push(fn); },
    addSelectionPreserver() { },
    registerFocusPanel() { },
    getSelection() { return []; },
    setSelection() { },
    _callbacks: callbacks,
  };
};

// Helper: create a GivenCandidates instance with a shape applied.
const createGivenCandidates = (shape) => {
  const collection = createMockCollection();
  const inputManager = createMockInputManager();
  const gc = new ConstraintCategoryInput.GivenCandidates(
    collection, inputManager);
  gc.reshape(shape);
  return { gc, collection, inputManager };
};

// ============================================================================
// GivenCandidates._inputDigit
// ============================================================================

await runTest('_inputDigit: sets a single digit on empty cell (9x9)', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 5);

  assert.equal(collection.constraints.length, 1);
  assert.equal(collection.constraints[0].cell, 'R1C1');
  assert.deepEqual(collection.constraints[0].values, [5]);
});

await runTest('_inputDigit: null digit clears the cell', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 5);
  assert.equal(collection.constraints.length, 1);

  gc._inputDigit('R1C1', null);
  assert.equal(collection.constraints.length, 0);
});

await runTest('_inputDigit: composing multi-digit value on 16x16 grid', () => {
  const shape = GridShape.fromGridSize(16);
  const { gc, collection } = createGivenCandidates(shape);

  // Type '1' then '0' to make 10.
  gc._inputDigit('R1C1', 1);
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [1]);

  gc._inputDigit('R1C1', 0);
  // Should have removed old and added new constraint.
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [10]);
});

await runTest('_inputDigit: composing wraps when exceeding maxValue', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  // Type '1' then '5' — 15 > 9, so should reset to just 5.
  gc._inputDigit('R1C1', 1);
  assert.deepEqual(collection.constraints[0].values, [1]);

  gc._inputDigit('R1C1', 5);
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [5]);
});

await runTest('_inputDigit: composing 16 on 16x16 grid works', () => {
  const shape = GridShape.fromGridSize(16);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 1);
  gc._inputDigit('R1C1', 6);
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [16]);
});

await runTest('_inputDigit: composing past maxValue wraps on 16x16', () => {
  const shape = GridShape.fromGridSize(16);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 1);
  gc._inputDigit('R1C1', 7);
  // 17 > 16, so wraps to just 7.
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [7]);
});

await runTest('_inputDigit: digit 0 alone is rejected when minValue is 1', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 0);
  // 0 < minValue(1), so should clear.
  assert.equal(collection.constraints.length, 0);
});

await runTest('_inputDigit: digit 0 alone is accepted when minValue is 0', () => {
  // Create a shape with value range 0-8 (valueOffset = -1).
  const shape = GridShape.fromGridSize(9, 9, null, -1);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 0);
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [0]);
});

await runTest('_inputDigit: composing with 0 on 16x16 (1 then 0 = 10)', () => {
  const shape = GridShape.fromGridSize(16);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 1);
  gc._inputDigit('R1C1', 0);
  assert.deepEqual(collection.constraints[0].values, [10]);
});

// ============================================================================
// GivenCandidates._setValues
// ============================================================================

await runTest('_setValues: adds constraints for given values', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._setValues(['R1C1', 'R2C2'], [3, 5]);
  // One constraint per cell.
  assert.equal(collection.constraints.length, 2);
  assert.equal(collection.constraints[0].cell, 'R1C1');
  assert.deepEqual(collection.constraints[0].values, [3, 5]);
  assert.equal(collection.constraints[1].cell, 'R2C2');
  assert.deepEqual(collection.constraints[1].values, [3, 5]);
});

await runTest('_setValues: empty values removes existing constraints', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._setValues(['R1C1'], [7]);
  assert.equal(collection.constraints.length, 1);

  gc._setValues(['R1C1'], []);
  assert.equal(collection.constraints.length, 0);
});

// ============================================================================
// GivenCandidates._getCellValues
// ============================================================================

await runTest('_getCellValues: returns values for a cell with a constraint', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  collection.addConstraint(new SudokuConstraint.Given('R1C1', 4));
  const values = gc._getCellValues('R1C1');
  assert.deepEqual(values, [4]);
});

await runTest('_getCellValues: returns empty for cell with no constraints', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc } = createGivenCandidates(shape);

  const values = gc._getCellValues('R1C1');
  assert.deepEqual(values, []);
});

await runTest('_getCellValues: returns multiple candidate values', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  collection.addConstraint(new SudokuConstraint.Given('R1C1', 2, 5, 8));
  const values = gc._getCellValues('R1C1');
  assert.deepEqual(values, [2, 5, 8]);
});

// ============================================================================
// GivenCandidates._inputDigit - edge cases
// ============================================================================

await runTest('_inputDigit: second digit on cell with multiple candidates resets', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  // Manually set multiple candidates (simulating multi-value input panel).
  collection.addConstraint(new SudokuConstraint.Given('R1C1', 2, 5));

  // Typing a digit when there are multiple candidates should treat as new.
  gc._inputDigit('R1C1', 3);
  // Old multi-value constraint should be replaced with single value.
  const values = gc._getCellValues('R1C1');
  assert.deepEqual(values, [3]);
});

await runTest('_inputDigit: boundary value maxValue is accepted', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 9);
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [9]);
});

await runTest('_inputDigit: boundary value minValue is accepted', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 1);
  assert.equal(collection.constraints.length, 1);
  assert.deepEqual(collection.constraints[0].values, [1]);
});

await runTest('_inputDigit: independent cells do not interfere', () => {
  const shape = GridShape.fromGridSize(9);
  const { gc, collection } = createGivenCandidates(shape);

  gc._inputDigit('R1C1', 3);
  gc._inputDigit('R2C2', 7);

  assert.equal(collection.constraints.length, 2);
  assert.deepEqual(gc._getCellValues('R1C1'), [3]);
  assert.deepEqual(gc._getCellValues('R2C2'), [7]);
});

logSuiteComplete('ConstraintCategoryInput.GivenCandidates');
