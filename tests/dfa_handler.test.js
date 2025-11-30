import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { regexToNFA } = await import('../js/nfa_builder.js');
const { LookupTables } = await import('../js/solver/lookup_tables.js');
const { NFAToDFA, DFALine } = await import('../js/solver/dfa_handler.js');

const findStartingStateIndex = (dfa) => {
  for (let i = 0; i < dfa.numStates; i++) {
    if (dfa.startingState.has(i)) {
      return i;
    }
  }
  throw new Error('No starting state found');
};

const getNextState = (dfa, stateIndex, value) => {
  const mask = LookupTables.fromValue(value);
  const transitions = dfa.transitionLists[stateIndex];
  for (let i = 0; i < transitions.length; i++) {
    const entry = transitions[i];
    if (entry & mask) {
      return entry >>> 16;
    }
  }
  return -1;
};

await runTest('NFAToDFA should merge equivalent prefixes', () => {
  const nfa = regexToNFA('(1|2)3', 3);
  const dfa = NFAToDFA(nfa, 3);
  assert.equal(dfa.numStates, 3, 'expected start, mid, and accept states');

  const start = findStartingStateIndex(dfa);
  const stateAfter1 = getNextState(dfa, start, 1);
  const stateAfter2 = getNextState(dfa, start, 2);
  assert.notEqual(stateAfter1, -1, '1 should transition from start');
  assert.notEqual(stateAfter2, -1, '2 should transition from start');
  assert.equal(stateAfter1, stateAfter2, '1 and 2 share the same DFA state');
  assert.equal(getNextState(dfa, start, 3), -1, '3 is not valid from the start state');

  const acceptingState = getNextState(dfa, stateAfter1, 3);
  assert.notEqual(acceptingState, -1, '3 should transition after the shared state');
  assert.ok(dfa.acceptingStates.has(acceptingState), 'final state must be accepting');
});

await runTest('DFALine should prune cells to match a regex line', () => {
  const nfa = regexToNFA('12', 4);
  const dfa = NFAToDFA(nfa, 4);
  const handler = new DFALine([0, 1], dfa);

  const allValues = LookupTables.fromValuesArray([1, 2, 3, 4]);
  const grid = new Uint16Array([allValues, allValues]);
  const touched = new Set();
  const accumulator = { addForCell(cell) { touched.add(cell); } };

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true, 'handler should keep solvable grids valid');
  assert.equal(grid[0], LookupTables.fromValue(1), 'first cell forced to value 1');
  assert.equal(grid[1], LookupTables.fromValue(2), 'second cell forced to value 2');
  assert.deepEqual([...touched].sort((a, b) => a - b), [0, 1], 'both cells reported as updated');
});

await runTest('DFALine should detect impossible assignments', () => {
  const nfa = regexToNFA('12', 4);
  const dfa = NFAToDFA(nfa, 4);
  const handler = new DFALine([0, 1], dfa);

  const grid = new Uint16Array([
    LookupTables.fromValue(2),
    LookupTables.fromValue(2),
  ]);
  const accumulator = { addForCell() { throw new Error('should not record cells on failure'); } };

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false, 'handler should reject grids that cannot satisfy the DFA');
});

logSuiteComplete('DFA handler');
