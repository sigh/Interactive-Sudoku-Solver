import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { h, makeFakeDocument } from '../helpers/mock_dom.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

const windowListeners = [];
globalThis.addEventListener = (type, fn) => windowListeners.push({ type, fn });
const pressKey = (key, props = {}) => {
  for (const { type, fn } of windowListeners) {
    if (type === 'keydown') fn({ key, target: null, ...props });
  }
};

const { GridInputManager } = await import('../../js/grid_input.js');
const { DisplayContainer } = await import('../../js/display.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');

// A grid with its input manager, on a page with the elements it uses.
const makeGrid = () => {
  globalThis.document = makeFakeDocument();
  windowListeners.length = 0;
  const grid = h('div');
  const panels = h('div', { id: 'constraint-panel-container' }, h('div'), h('div'));
  const controls = h('div', { id: 'selection-controls' },
    h('button', { id: 'commit-segment-button' }),
    h('button', { id: 'clear-selection-button' }),
    h('span', { id: 'selection-segment-readout' }));
  const elsewhere = h('div');
  document.body.append(grid, h('input', { id: 'fake-input' }), panels, controls, elsewhere);

  const geometry = CellGeometry.fromGridSize(9);
  const container = new DisplayContainer(grid);
  const input = new GridInputManager(container);
  container.reshape(geometry);
  input.reshape(geometry);

  const interceptor = container.getClickInterceptor();
  const surface = interceptor.getSvg();
  const digits = [];
  input.onNewDigit((cell, digit) => digits.push([cell, digit]));
  const finished = [];
  input.onSelection((cells, done) => { if (done) finished.push(cells); });

  // The user presses, drags through each point (a cell's centre, or [x, y]),
  // and lets go.
  const drag = (points, modifiers = {}) => {
    const event = (point) => {
      const [offsetX, offsetY] = typeof point === 'string'
        ? interceptor.cellIdCenter(point) : point;
      return { pointerId: 1, offsetX, offsetY, preventDefault() { }, ...modifiers };
    };
    surface.dispatch('pointerdown', event(points[0]));
    for (const point of points.slice(1)) surface.dispatch('pointermove', event(point));
    surface.dispatch('pointerup', event(points.at(-1)));
  };

  return {
    input, drag, digits, finished, panels, elsewhere, surface,
    fakeInput: document.getElementById('fake-input'),
    commit: document.getElementById('commit-segment-button'),
    clear: document.getElementById('clear-selection-button'),
    readout: document.getElementById('selection-segment-readout'),
    selected: () => input.getSelection(),
    committedDrawn: () => grid.firstChild.descendants()
      .filter(e => e.classList?.contains('committed-segment')).length,
  };
};

// ============================================================================
// Pointer selection
// ============================================================================

await runTest('pressing a cell selects it, with the typing input over it', () => {
  const { drag, selected, fakeInput, finished, input } = makeGrid();
  drag(['R2C3']);

  assert.deepEqual(selected(), ['R2C3']);
  assert.deepEqual(finished, [['R2C3']]);
  const [x, y] = [2 * 52 + 26, 52 + 26];
  assert.deepEqual([fakeInput.style.left, fakeInput.style.top], [`${x}px`, `${y}px`]);
  assert.equal(fakeInput.selectionStart, 0, 'ready for a digit');
  assert.equal(input.getSelectionSegments().length, 1);
});

await runTest('dragging selects the cells passed through, in order', () => {
  const { drag, selected } = makeGrid();
  drag(['R1C1', 'R1C2', 'R2C2', 'R1C2']);
  assert.deepEqual(selected(), ['R1C1', 'R1C2', 'R2C2']);
});

await runTest("grazing a neighbour's corner on a diagonal does not select it", () => {
  const { drag, selected } = makeGrid();
  // Just inside R1C2, still near R1C1's centre.
  drag(['R1C1', [55, 30], 'R2C2']);
  assert.deepEqual(selected(), ['R1C1', 'R2C2']);
});

await runTest('a new press starts again; with shift it adds, or removes from a selected cell', () => {
  const { drag, selected } = makeGrid();
  drag(['R1C1', 'R1C2']);
  drag(['R5C5']);
  assert.deepEqual(selected(), ['R5C5']);

  drag(['R6C6', 'R6C7'], { shiftKey: true });
  assert.deepEqual(selected(), ['R5C5', 'R6C6', 'R6C7']);
  drag(['R6C6', 'R6C7'], { shiftKey: true });
  assert.deepEqual(selected(), ['R5C5']);
});

await runTest('ctrl-dragging from a selected cell selects the rectangle', () => {
  const { drag, selected } = makeGrid();
  drag(['R1C1']);
  drag(['R2C2', 'R3C3'], { ctrlKey: true });
  assert.deepEqual(selected(), [
    'R1C1', 'R1C2', 'R1C3', 'R2C1', 'R2C2', 'R2C3', 'R3C1', 'R3C2', 'R3C3']);
});

await runTest('a second pointer is ignored while one is down', () => {
  const { surface, input, selected } = makeGrid();
  const press = (pointerId, [offsetX, offsetY]) => surface.dispatch('pointerdown',
    { pointerId, offsetX, offsetY, preventDefault() { } });
  press(1, [26, 26]);
  press(2, [260, 260]);
  assert.deepEqual(selected(), ['R1C1']);
  assert.equal(input.getSelectionSegments().length, 1);
});

await runTest('clicking elsewhere clears the selection, except in the panels that keep it', () => {
  const { drag, selected, input, panels, elsewhere } = makeGrid();
  input.addSelectionPreserver(panels);
  drag(['R1C1']);

  panels.firstChild.click();
  assert.deepEqual(selected(), ['R1C1']);
  elsewhere.click();
  assert.deepEqual(selected(), []);
});

// ============================================================================
// Segments
// ============================================================================

await runTest('committing a segment keeps it while the next is selected', () => {
  const { drag, input, commit, clear, readout, committedDrawn } = makeGrid();
  drag(['R1C1', 'R1C2']);
  assert.equal(commit.disabled, false);

  commit.click();
  assert.deepEqual(input.getSelectionSegments(), [['R1C1', 'R1C2']]);
  assert.equal(committedDrawn(), 1);
  assert.equal(commit.disabled, true, 'nothing new to commit');
  assert.equal(readout.textContent, '1 segment');
  assert.equal(clear.style.display, '');

  drag(['R3C3', 'R3C4']);
  assert.deepEqual(input.getSelectionSegments(), [['R1C1', 'R1C2'], ['R3C3', 'R3C4']]);
  assert.equal(readout.textContent, '2 segments');

  clear.click();
  assert.deepEqual(input.getSelectionSegments(), []);
  assert.equal(committedDrawn(), 0);
  assert.equal(clear.style.display, 'none');
});

await runTest('setting the selection drops the committed segments', () => {
  const { drag, input, commit } = makeGrid();
  drag(['R1C1', 'R1C2']);
  commit.click();
  input.setSelection(['R9C9']);
  assert.deepEqual(input.getSelectionSegments(), [['R9C9']]);
});

// ============================================================================
// Keys
// ============================================================================

await runTest('a digit typed goes to the selected cell, when there is one', () => {
  const { drag, fakeInput, digits } = makeGrid();
  const type = (value) => {
    fakeInput.value = value;
    fakeInput.dispatch('input');
  };

  drag(['R1C1']);
  type('5');
  type('');
  assert.deepEqual(digits, [['R1C1', 5], ['R1C1', null]]);
  assert.equal(fakeInput.value, 'x', 'a backspace can still be seen');

  drag(['R1C1', 'R1C2']);
  type('5');
  assert.equal(digits.length, 2);
});

await runTest('arrow keys move the selected cell, wrapping around', () => {
  const { drag, fakeInput, selected } = makeGrid();
  const arrow = (key) => {
    fakeInput.dispatch('keydown', { key });
    return selected();
  };
  drag(['R1C1']);

  assert.deepEqual(arrow('ArrowLeft'), ['R1C9']);
  assert.deepEqual(arrow('ArrowRight'), ['R1C1']);
  assert.deepEqual(arrow('ArrowUp'), ['R9C1']);
  assert.deepEqual(arrow('ArrowDown'), ['R1C1']);
});

await runTest('Backspace clears the selected cells, and f numbers them', () => {
  const { drag, digits } = makeGrid();
  pressKey('Backspace');
  assert.deepEqual(digits, [], 'nothing selected');

  drag(['R1C1', 'R1C2']);
  pressKey('Backspace');
  assert.deepEqual(digits, [['R1C1', null], ['R1C2', null]]);

  // Each cell gets its number as two digits: 01, 02, ..., 11.
  digits.length = 0;
  drag(['R1C1', 'R1C2', 'R1C3', 'R1C4', 'R1C5', 'R1C6', 'R1C7', 'R1C8', 'R1C9',
    'R2C9', 'R2C8']);
  pressKey('f');
  assert.deepEqual(digits.slice(0, 2), [['R1C1', 0], ['R1C1', 1]]);
  assert.deepEqual(digits.slice(-2), [['R2C8', 1], ['R2C8', 1]]);

  pressKey('Backspace', { target: { tagName: 'INPUT' } });
  assert.equal(digits.length, 22, 'typing in a field is not for the grid');
});

// ============================================================================
// Focus
// ============================================================================

await runTest('after selecting cells, focus returns to the panel used last', () => {
  const { drag, input, panels } = makeGrid();
  const [panel, other] = panels.children;
  const target = h('input');
  let focused = 0;
  target.focus = () => focused++;
  input.registerFocusPanel(panel, () => target);

  panel.click();
  drag(['R1C1', 'R1C2']);
  assert.equal(focused, 1);

  // A click on another panel forgets it.
  other.click();
  drag(['R1C1', 'R1C2']);
  assert.equal(focused, 1);
});

await runTest('outside arrow selections are passed on', () => {
  const { input } = makeGrid();
  const arrows = [];
  input.onOutsideArrowSelection((arrowId) => arrows.push(arrowId));
  input.updateOutsideArrowSelection('R1,1');
  assert.deepEqual(arrows, ['R1,1']);
});

delete globalThis.addEventListener;

logSuiteComplete('Grid input');
