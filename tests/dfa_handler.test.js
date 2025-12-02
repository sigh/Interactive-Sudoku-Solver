import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';
import { createAccumulator, mask } from './helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { regexToNFA } = await import('../js/nfa_builder.js');
const { LookupTables } = await import('../js/solver/lookup_tables.js');
const { compressNFA, DFALine } = await import('../js/solver/dfa_handler.js');

const findStartingStateIndex = (cnfa) => {
  for (let i = 0; i < cnfa.numStates; i++) {
    if (cnfa.startingStates.has(i)) {
      return i;
    }
  }
  throw new Error('No starting state found');
};

const getNextStates = (cnfa, stateIndex, value) => {
  const valueMask = LookupTables.fromValue(value);
  const transitions = cnfa.transitionLists[stateIndex];
  const nextStates = [];
  for (let i = 0; i < transitions.length; i++) {
    const entry = transitions[i];
    if (entry & valueMask) {
      nextStates.push(entry >>> 16);
    }
  }
  return nextStates;
};

await runTest('compressNFA should preserve NFA structure', () => {
  const nfa = regexToNFA('(1|2)3', 3);
  const cnfa = compressNFA(nfa);

  const start = findStartingStateIndex(cnfa);
  const statesAfter1 = getNextStates(cnfa, start, 1);
  const statesAfter2 = getNextStates(cnfa, start, 2);
  assert.ok(statesAfter1.length > 0, '1 should transition from start');
  assert.ok(statesAfter2.length > 0, '2 should transition from start');
  assert.deepEqual(getNextStates(cnfa, start, 3), [], '3 is not valid from the start state');

  // Follow path through to accepting state.
  const stateAfter1 = statesAfter1[0];
  const acceptingStates = getNextStates(cnfa, stateAfter1, 3);
  assert.ok(acceptingStates.length > 0, '3 should transition after 1');
  assert.ok(cnfa.acceptingStates.has(acceptingStates[0]), 'final state must be accepting');
});

await runTest('DFALine should prune cells to match a regex line', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new DFALine([0, 1], cnfa);

  const allValues = mask(1, 2, 3, 4);
  const grid = new Uint16Array([allValues, allValues]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true, 'handler should keep solvable grids valid');
  assert.equal(grid[0], LookupTables.fromValue(1), 'first cell forced to value 1');
  assert.equal(grid[1], LookupTables.fromValue(2), 'second cell forced to value 2');
  assert.deepEqual([...accumulator.touched].sort((a, b) => a - b), [0, 1], 'both cells reported as updated');
});

await runTest('DFALine should detect impossible assignments', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new DFALine([0, 1], cnfa);

  const grid = new Uint16Array([
    LookupTables.fromValue(2),
    LookupTables.fromValue(2),
  ]);
  const accumulator = { addForCell() { throw new Error('should not record cells on failure'); } };

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false, 'handler should reject grids that cannot satisfy the NFA');
});

logSuiteComplete('DFA handler');
