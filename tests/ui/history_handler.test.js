import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { makeFakeDocument } from '../helpers/mock_dom.js';

ensureGlobalEnvironment({ needWindow: true, documentValue: makeFakeDocument() });

// A browser URL and history: pushState changes the URL, as in a browser.
const pushes = [];
globalThis.location = { href: '' };
globalThis.history = {
  pushState: (_state, _title, url) => {
    pushes.push(url);
    location.href = url;
  },
};
const windowListeners = new Map();
globalThis.addEventListener = (type, fn) => windowListeners.set(type, fn);

const { HistoryHandler } = await import('../../js/solution_controller.js');

const BASE = 'https://example.test/iss/';

// A handler loaded from `url`, recording the params it asks the page to load.
const makeHandler = (url = BASE) => {
  location.href = url;
  pushes.length = 0;
  const loads = [];
  const handler = new HistoryHandler((params) => loads.push(params.get('q')));
  return { handler, loads, undo: handler._undoButton, redo: handler._redoButton };
};

// The page reports its puzzle after every change. After a load (from the URL,
// undo or redo), its first report is of the puzzle it just loaded. The empty
// puzzle is reported with no q.
const edit = (handler, q, extra = {}) => handler.update({ q, ...extra });
const loaded = (handler, q) => handler.update({ q });

const query = () => new URL(location.href).search;

const pressKey = (key, modifiers = {}) => windowListeners.get('keydown')({
  key, ctrlKey: false, metaKey: false, shiftKey: false, target: null,
  preventDefault() { }, ...modifiers,
});

await runTest('loads the puzzle from the URL, without adding an undo entry', () => {
  const { handler, loads, undo, redo } = makeHandler(`${BASE}?q=.~R1C1_1`);
  assert.deepEqual(loads, ['.~R1C1_1']);

  loaded(handler, '.~R1C1_1');
  assert.deepEqual(pushes, []);
  assert.equal(undo.disabled, true);
  assert.equal(redo.disabled, true);
});

await runTest('an edit is written to the URL and can be undone', () => {
  const { handler, undo } = makeHandler();
  loaded(handler, undefined);

  edit(handler, '.~R1C1_1');
  assert.equal(query(), '?q=.%7ER1C1_1');
  assert.equal(undo.disabled, false);
});

await runTest('other params change the URL without adding an undo entry', () => {
  const { handler, loads, undo } = makeHandler();
  loaded(handler, undefined);
  edit(handler, '.~R1C1_1');

  edit(handler, '.~R1C1_1', { mode: 'solutions' });
  assert.equal(query(), '?q=.%7ER1C1_1&mode=solutions');
  undo.click();
  assert.equal(loads.at(-1), '', 'one undo reaches the empty puzzle');
  assert.equal(undo.disabled, true);
});

await runTest('undo and redo load the previous and next puzzles', () => {
  const { handler, loads, undo, redo } = makeHandler();
  loaded(handler, undefined);
  edit(handler, '.~R1C1_1');
  edit(handler, '.~R1C1_2');
  loads.length = 0;

  undo.click();
  assert.deepEqual(loads, ['.~R1C1_1']);
  assert.equal(new URL(location.href).searchParams.get('q'), '.~R1C1_1');
  assert.equal(redo.disabled, false);

  // Reporting the loaded puzzle isn't a new edit, so redo still works.
  loaded(handler, '.~R1C1_1');
  redo.click();
  assert.deepEqual(loads, ['.~R1C1_1', '.~R1C1_2']);
  assert.equal(redo.disabled, true);
});

await runTest('an edit after undo discards the redo history', () => {
  const { handler, undo, redo } = makeHandler();
  loaded(handler, undefined);
  edit(handler, '.~R1C1_1');
  undo.click();
  loaded(handler, undefined);

  edit(handler, '.~R1C1_3');
  assert.equal(redo.disabled, true);
});

await runTest('Ctrl+Z and Ctrl+Shift+Z undo and redo, except in a text field', () => {
  const { handler, loads } = makeHandler();
  loaded(handler, undefined);
  edit(handler, '.~R1C1_1');
  loads.length = 0;

  pressKey('z', { ctrlKey: true });
  loaded(handler, undefined);
  pressKey('Z', { metaKey: true, shiftKey: true });
  loaded(handler, '.~R1C1_1');
  assert.deepEqual(loads, ['', '.~R1C1_1']);

  pressKey('z', { ctrlKey: true, target: { tagName: 'INPUT' } });
  assert.equal(loads.length, 2, 'typing in an input is not undo');
});

await runTest('browser back/forward reloads the puzzle from the URL', () => {
  const { handler, loads } = makeHandler();
  loaded(handler, undefined);
  loads.length = 0;

  location.href = `${BASE}?q=.~R2C2_4`;
  window.onpopstate();
  assert.deepEqual(loads, ['.~R2C2_4']);
});

await runTest('setUrlParams sets and removes params, and skips unchanged URLs', () => {
  const { handler } = makeHandler(`${BASE}?q=.&valueCountLimit=2`);

  handler.setUrlParams({ valueCountLimit: 3 });
  assert.equal(query(), '?q=.&valueCountLimit=3');
  handler.setUrlParams({ valueCountLimit: undefined });
  assert.equal(query(), '?q=.');

  pushes.length = 0;
  handler.setUrlParams({ q: '.' });
  assert.deepEqual(pushes, [], 'no browser entry for an unchanged URL');
});

delete globalThis.addEventListener;
delete globalThis.history;

logSuiteComplete('HistoryHandler');
