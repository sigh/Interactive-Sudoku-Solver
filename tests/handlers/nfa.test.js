import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { createAccumulator, valueMask } from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { regexToNFA } = await import('../../js/nfa_builder.js');
const { LookupTables } = await import('../../js/solver/lookup_tables.js');
const { compressNFA, NFAConstraint } = await import('../../js/solver/nfa_handler.js');

const findStartingStateIndex = (cnfa) => {
  for (let i = 0; i < cnfa.numStates; i++) {
    if (cnfa.startingStates.has(i)) {
      return i;
    }
  }
  throw new Error('No starting state found');
};

const getNextStates = (cnfa, stateIndex, value) => {
  const transitionMask = valueMask(value);
  const transitions = cnfa.transitionLists[stateIndex];
  const nextStates = [];
  for (let i = 0; i < transitions.length; i++) {
    const entry = transitions[i];
    if (entry & transitionMask) {
      nextStates.push(entry >>> 16);
    }
  }
  return nextStates;
};

// =============================================================================
// compressNFA tests
// =============================================================================

await runTest('compressNFA should preserve transitions and states', () => {
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

await runTest('compressNFA should track starting states', () => {
  const nfa = regexToNFA('12', 2);
  const cnfa = compressNFA(nfa);

  let startCount = 0;
  for (let i = 0; i < cnfa.numStates; i++) {
    if (cnfa.startingStates.has(i)) startCount++;
  }
  assert.ok(startCount >= 1, 'should have at least one starting state');
});

await runTest('compressNFA should track accepting states', () => {
  const nfa = regexToNFA('12', 2);
  const cnfa = compressNFA(nfa);

  let acceptCount = 0;
  for (let i = 0; i < cnfa.numStates; i++) {
    if (cnfa.acceptingStates.has(i)) acceptCount++;
  }
  assert.ok(acceptCount >= 1, 'should have at least one accepting state');
});

await runTest('compressNFA should combine symbol masks for same target state', () => {
  // [12] transitions to the same state on either symbol
  const nfa = regexToNFA('[12]', 2);
  const cnfa = compressNFA(nfa);

  const start = findStartingStateIndex(cnfa);
  const transitions = cnfa.transitionLists[start];

  // Should have a single transition entry with mask covering both 1 and 2
  assert.equal(transitions.length, 1, 'should combine into single transition');
  const entry = transitions[0];
  const entryMask = entry & 0xFFFF;
  assert.equal(entryMask, valueMask(1, 2), 'mask should cover both symbols');
});

await runTest('compressNFA should use compact transition entry format', () => {
  const nfa = regexToNFA('12', 2);
  const cnfa = compressNFA(nfa);

  const start = findStartingStateIndex(cnfa);
  const transitions = cnfa.transitionLists[start];

  // Verify entry format: [state: 16 bits, mask: 16 bits]
  const entry = transitions[0];
  const entryMask = entry & 0xFFFF;
  const targetState = entry >>> 16;

  assert.ok(entryMask > 0, 'mask should be non-zero');
  assert.ok(targetState < cnfa.numStates, 'target state should be valid');
});

// =============================================================================
// NFAConstraint basic enforcement tests
// =============================================================================

await runTest('NFAConstraint should prune cells to supported values', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = new Uint16Array([allValues, allValues]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1), 'first cell forced to 1');
  assert.equal(grid[1], valueMask(2), 'second cell forced to 2');
  assert.deepEqual([...accumulator.touched].sort((a, b) => a - b), [0, 1]);
});

await runTest('NFAConstraint should return false when no valid path exists', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  const grid = new Uint16Array([
    valueMask(2),
    valueMask(2),
  ]);
  const accumulator = { addForCell() { throw new Error('should not be called'); } };

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint should not touch cells already at supported values', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  const grid = new Uint16Array([
    valueMask(1),
    valueMask(2),
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(accumulator.touched.size, 0, 'no cells should be touched');
});

await runTest('NFAConstraint should report only changed cells', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  const grid = new Uint16Array([
    valueMask(1),  // Already constrained
    valueMask(1, 2, 3, 4),            // Needs pruning
  ]);
  const accumulator = createAccumulator();

  handler.enforceConsistency(grid, accumulator);
  assert.deepEqual([...accumulator.touched], [1], 'only second cell reported');
});

// =============================================================================
// NFAConstraint forward pass tests
// =============================================================================

await runTest('NFAConstraint forward pass should fail when first cell has no valid transition', () => {
  const nfa = regexToNFA('12', 2);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  // First cell only allows 2, but NFA requires 1 first
  const grid = new Uint16Array([
    valueMask(2),
    valueMask(1, 2),
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint forward pass should fail when middle cell blocks path', () => {
  const nfa = regexToNFA('123', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1, 2], cnfa);

  const grid = new Uint16Array([
    valueMask(1),
    valueMask(3),  // Should be 2
    valueMask(1, 2, 3),
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint forward pass tracks reachable states through NFA', () => {
  // With alternation, multiple states may be reachable
  const nfa = regexToNFA('(12|13)', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  const grid = new Uint16Array([
    valueMask(1),
    valueMask(2, 3),
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  // Both 2 and 3 should remain valid
  assert.equal(grid[1], valueMask(2, 3));
});

// =============================================================================
// NFAConstraint backward pass tests
// =============================================================================

await runTest('NFAConstraint backward pass should fail when final states are not accepting', () => {
  const nfa = regexToNFA('123', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1, 2], cnfa);

  // Path 121 - reaches a state but not an accepting one
  const grid = new Uint16Array([
    valueMask(1),
    valueMask(2),
    valueMask(1),  // Should be 3 to reach accepting
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint backward pass should prune values not reaching accepting state', () => {
  const nfa = regexToNFA('(12|34)', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  // Last cell is 2, so first cell must be 1 (not 3)
  const grid = new Uint16Array([
    valueMask(1, 3),
    valueMask(2),
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1));
});

await runTest('NFAConstraint backward pass should prune unreachable states', () => {
  const nfa = regexToNFA('1[23]', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  // Second cell only allows 2
  const grid = new Uint16Array([
    valueMask(1, 2, 3),
    valueMask(2),
  ]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1));
});

// =============================================================================
// NFAConstraint with different cell configurations
// =============================================================================

await runTest('NFAConstraint should work with non-contiguous cell indices', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([5, 10], cnfa);

  const grid = new Uint16Array(15).fill(valueMask(1, 2, 3, 4));
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[5], valueMask(1));
  assert.equal(grid[10], valueMask(2));
  // Other cells should be untouched
  assert.equal(grid[0], valueMask(1, 2, 3, 4));
});

await runTest('NFAConstraint should handle single cell', () => {
  const nfa = regexToNFA('[12]', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0], cnfa);

  const grid = new Uint16Array([valueMask(1, 2, 3, 4)]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2));
});

await runTest('NFAConstraint should handle longer cell sequences', () => {
  const nfa = regexToNFA('1234', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1, 2, 3], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = new Uint16Array([allValues, allValues, allValues, allValues]);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1));
  assert.equal(grid[1], valueMask(2));
  assert.equal(grid[2], valueMask(3));
  assert.equal(grid[3], valueMask(4));
});

// =============================================================================
// NFAConstraint state reuse
// =============================================================================

await runTest('NFAConstraint should be reusable across multiple calls', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  // First call
  const grid1 = new Uint16Array([valueMask(1, 2, 3, 4), valueMask(1, 2, 3, 4)]);
  assert.equal(handler.enforceConsistency(grid1, createAccumulator()), true);
  assert.equal(grid1[0], valueMask(1));

  // Second call with different grid
  const grid2 = new Uint16Array([valueMask(1, 2), valueMask(2, 3)]);
  assert.equal(handler.enforceConsistency(grid2, createAccumulator()), true);
  assert.equal(grid2[0], valueMask(1));

  // Third call that fails
  const grid3 = new Uint16Array([valueMask(2), valueMask(2)]);
  assert.equal(handler.enforceConsistency(grid3, createAccumulator()), false);

  // Fourth call should still work after failure
  const grid4 = new Uint16Array([valueMask(1, 2), valueMask(1, 2)]);
  assert.equal(handler.enforceConsistency(grid4, createAccumulator()), true);
  assert.equal(grid4[0], valueMask(1));
});

await runTest('NFAConstraint internal state should be cleared between calls', () => {
  const nfa = regexToNFA('(12|21)', 2);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  // First call with specific values
  const grid1 = new Uint16Array([valueMask(1), valueMask(2)]);
  assert.equal(handler.enforceConsistency(grid1, createAccumulator()), true);

  // Second call with different valid values - should not be affected by first
  const grid2 = new Uint16Array([valueMask(2), valueMask(1)]);
  assert.equal(handler.enforceConsistency(grid2, createAccumulator()), true);
});

// =============================================================================
// NFAConstraint getNFA
// =============================================================================

await runTest('NFAConstraint getNFA should return the compressed NFA', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([0, 1], cnfa);

  assert.strictEqual(handler.getNFA(), cnfa);
});

logSuiteComplete('NFA handler');
