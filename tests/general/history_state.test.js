import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { HistoryState } = await import('../../js/solution_controller.js');

// ============================================================================
// add / dedup / forward-truncation
// ============================================================================

await runTest('add returns true and advances the cursor', () => {
  const h = new HistoryState();
  assert.equal(h.add('a'), true);
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.add('b'), true);
  assert.equal(h.canUndo(), true);
});

await runTest('add dedups an entry equal to the current one', () => {
  const h = new HistoryState();
  h.add('a');
  assert.equal(h.add('a'), false);
  // No phantom entry was created: there is nothing to undo to.
  assert.equal(h.canUndo(), false);
});

await runTest('add after undo truncates the forward (redo) history', () => {
  const h = new HistoryState();
  h.add('a');
  h.add('b');
  h.add('c');
  assert.equal(h.undo(), 'b');
  assert.equal(h.canRedo(), true);
  h.add('d');
  // 'c' is gone; redo is no longer possible.
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo(), 'b');
});

// ============================================================================
// undo / redo bounds
// ============================================================================

await runTest('undo/redo return entries and null at the bounds', () => {
  const h = new HistoryState();
  h.add('a');
  h.add('b');
  assert.equal(h.undo(), 'a');
  assert.equal(h.undo(), null);   // already at the oldest entry
  assert.equal(h.redo(), 'b');
  assert.equal(h.redo(), null);   // already at the newest entry
});

await runTest('a no-op undo/redo leaves the cursor unchanged', () => {
  const h = new HistoryState();
  h.add('a');
  h.add('b');
  assert.equal(h.redo(), null);   // at newest already
  assert.equal(h.undo(), 'a');    // still steps back correctly
});

// ============================================================================
// Trimming — regression test for the bug where the trim never ran because
// `HistoryHandler.MAX_HISTORY` was read as an (undefined) static, so history
// grew without bound. (solution_controller.js:75-77)
// ============================================================================

await runTest('history is trimmed once it exceeds maxHistory', () => {
  const h = new HistoryState({ maxHistory: 50, adjustment: 10 });
  for (let i = 0; i < 51; i++) h.add('e' + i);
  // Old (buggy) behaviour kept all 51 entries. Now the oldest `adjustment`
  // entries are dropped, leaving 41.
  assert.equal(h._entries.length, 41);
  // The cursor still points at the newest entry, so redo is exhausted...
  assert.equal(h.canRedo(), false);
  // ...and undo walks back through the retained entries to the new oldest.
  assert.equal(h.undo(), 'e49');
});

await runTest('trimming keeps the cursor within bounds under many adds', () => {
  const h = new HistoryState({ maxHistory: 50, adjustment: 10 });
  for (let i = 0; i < 200; i++) h.add('e' + i);
  assert.ok(h._entries.length <= 50);
  assert.equal(h.redo(), null);
  // The newest entry is always reachable and correct.
  assert.equal(h.undo(), 'e198');
  assert.equal(h.redo(), 'e199');
});

logSuiteComplete('history_state');
