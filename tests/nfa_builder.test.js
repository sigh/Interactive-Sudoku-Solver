import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { regexToNFA, NFASerializer, JavascriptNFABuilder, NFA } = await import('../js/nfa_builder.js');
const { LookupTables } = await import('../js/solver/lookup_tables.js');
const { BitReader } = await import('../js/util.js');

const evaluateNfa = (nfa, values) => {
  const epsilonClosure = (stateIds) => {
    const visited = new Set(stateIds);
    const stack = [...stateIds];
    while (stack.length) {
      const stateId = stack.pop();
      const state = nfa.states[stateId];
      if (!state) continue;
      for (const epsilonTarget of state.epsilon) {
        if (!visited.has(epsilonTarget)) {
          visited.add(epsilonTarget);
          stack.push(epsilonTarget);
        }
      }
    }
    return visited;
  };

  let activeStates = epsilonClosure([nfa.startId]);
  for (const value of values) {
    const nextStates = new Set();
    const mask = LookupTables.fromValue(value);
    for (const stateId of activeStates) {
      const state = nfa.states[stateId];
      if (!state) continue;
      for (const transition of state.transitions) {
        if (transition.symbols & mask) {
          nextStates.add(transition.state);
        }
      }
    }
    activeStates = epsilonClosure(nextStates);
    if (activeStates.size === 0) {
      break;
    }
  }

  for (const stateId of activeStates) {
    if (nfa.acceptIds.has(stateId)) {
      return true;
    }
  }
  return false;
};

const expectAccepts = (nfa, values, message) => {
  assert.equal(evaluateNfa(nfa, values), true, message);
};

const expectRejects = (nfa, values, message) => {
  assert.equal(evaluateNfa(nfa, values), false, message);
};

const serializationFormat = (serialized) => {
  const bytes = NFASerializer._decodeBytes(serialized);
  const reader = new BitReader(bytes);
  const { format } = NFASerializer._readHeader(reader);
  return format;
};

const expectFormat = (serialized, expectedFormat, message) => {
  assert.equal(serializationFormat(serialized), expectedFormat, message);
};

await runTest('regex literals should concatenate values', () => {
  const nfa = regexToNFA('12', 9);
  expectAccepts(nfa, [1, 2], '12 should match literal');
  expectRejects(nfa, [1], 'missing final symbol should reject');
  expectRejects(nfa, [1, 3], 'mismatched second symbol should reject');
});

await runTest('regex charsets should honor quantifiers', () => {
  const nfa = regexToNFA('[1-3]*4?', 9);
  expectAccepts(nfa, [2, 3, 1], 'star should consume arbitrarily long sequences');
  expectAccepts(nfa, [1, 1, 4], 'optional suffix should match when present');
  expectRejects(nfa, [4, 4], 'second optional symbol should not match');
});

await runTest('NFA serialization should round-trip plain format', () => {
  const nfa = regexToNFA('(1|2)3+', 9);
  const serialized = NFASerializer.serialize(nfa);
  expectFormat(serialized, NFASerializer.FORMAT.PLAIN, 'epsilon transitions should force plain format');
  const restored = NFASerializer.deserialize(serialized);
  expectAccepts(restored, [1, 3, 3], 'restored NFA should preserve transitions');
  expectAccepts(restored, [2, 3], 'restored NFA should accept alternate branch');
  expectRejects(restored, [3], 'prefix is required even after round-trip');
});

await runTest('NFA serialization should round-trip packed format', () => {
  const states = [new NFA.State(), new NFA.State()];
  states[0].addTransition(LookupTables.fromValue(1), 1);
  states[0].addTransition(LookupTables.fromValue(2), 1);
  const nfa = new NFA(0, [1], states);
  const serialized = NFASerializer.serialize(nfa);
  expectFormat(serialized, NFASerializer.FORMAT.PACKED, 'disjoint symbol transitions should use packed format');
  const restored = NFASerializer.deserialize(serialized);
  expectAccepts(restored, [1], 'value 1 should reach accept state');
  expectAccepts(restored, [2], 'value 2 should reach accept state');
  expectRejects(restored, [3], 'values outside alphabet should reject');
});

await runTest('JavascriptNFABuilder should handle parity checks', () => {
  const builder = new JavascriptNFABuilder({
    startExpression: '({ sum: 0 })',
    transitionBody: `
      return { sum: (state.sum + value) % 2 };
    `,
    acceptBody: `
      return state.sum === 0;
    `,
  }, 4);
  const nfa = builder.build();
  expectAccepts(nfa, [1, 2, 1], 'even parity sequences should accept');
  expectAccepts(nfa, [4], 'single even value keeps parity even');
  expectRejects(nfa, [1], 'odd parity sequences should reject');
});

await runTest('JavascriptNFABuilder should support multiple start states', () => {
  const builder = new JavascriptNFABuilder({
    startExpression: '[{ required: 1, seen: false }, { required: 2, seen: false }]',
    transitionBody: `
      if (!state.seen && value === state.required) {
        return { ...state, seen: true };
      }
    `,
    acceptBody: `
      return state.seen === true;
    `,
  }, 4);
  const nfa = builder.build();
  expectAccepts(nfa, [1], 'start branch for value 1 should accept');
  expectAccepts(nfa, [2], 'start branch for value 2 should accept');
  expectRejects(nfa, [3], 'unlisted start values should reject');
  expectRejects(nfa, [1, 2], 'additional unmatched input should reject');
});

await runTest('JavascriptNFABuilder should allow transition fan-out', () => {
  const builder = new JavascriptNFABuilder({
    startExpression: '({ stage: "START" })',
    transitionBody: `
      if (state.stage === 'START' && value === 1) {
        return [{ stage: 'LEFT' }, { stage: 'RIGHT' }];
      }
      if (state.stage === 'LEFT' && value === 2) {
        return { stage: 'ACCEPT' };
      }
      if (state.stage === 'RIGHT' && value === 3) {
        return { stage: 'ACCEPT' };
      }
    `,
    acceptBody: `
      return state.stage === 'ACCEPT';
    `,
  }, 4);
  const nfa = builder.build();
  expectAccepts(nfa, [1, 2], 'left branch should reach accept');
  expectAccepts(nfa, [1, 3], 'right branch should reach accept');
  expectRejects(nfa, [1, 1], 'branch fan-out must consume matching suffix');
  expectRejects(nfa, [2, 3], 'values without initial branch should reject');
});

await runTest('mergeTransitions should combine transitions to same target', () => {
  const state = new NFA.State();
  state.addTransition(LookupTables.fromValue(1), 5);
  state.addTransition(LookupTables.fromValue(2), 5);
  state.addTransition(LookupTables.fromValue(3), 7);
  state.addTransition(LookupTables.fromValue(4), 5);

  state.mergeTransitions();

  assert.equal(state.transitions.length, 2, 'should merge to two distinct targets');
  const target5 = state.transitions.find(t => t.state === 5);
  const target7 = state.transitions.find(t => t.state === 7);
  assert.ok(target5, 'should have transition to state 5');
  assert.ok(target7, 'should have transition to state 7');
  const expectedMask5 = LookupTables.fromValuesArray([1, 2, 4]);
  assert.equal(target5.symbols, expectedMask5, 'should combine symbols for same target');
  assert.equal(target7.symbols, LookupTables.fromValue(3), 'should keep single symbol unchanged');
});

await runTest('closeOverEpsilonTransitions should inline reachable transitions', () => {
  // Build: state0 --epsilon--> state1 --[1]--> state2
  const states = [new NFA.State(), new NFA.State(), new NFA.State()];
  states[0].addEpsilon(1);
  states[1].addTransition(LookupTables.fromValue(1), 2);
  const nfa = new NFA(0, [2], states);

  nfa.closeOverEpsilonTransitions();

  assert.equal(states[0].epsilon.length, 0, 'epsilon transitions should be removed');
  assert.equal(states[0].transitions.length, 1, 'should have inlined transition');
  assert.equal(states[0].transitions[0].state, 2, 'inlined transition should point to state 2');
  assert.equal(states[0].transitions[0].symbols, LookupTables.fromValue(1), 'should preserve symbol mask');
});

await runTest('closeOverEpsilonTransitions should propagate accepting status', () => {
  // Build: state0 --epsilon--> state1 (accepting)
  const states = [new NFA.State(), new NFA.State()];
  states[0].addEpsilon(1);
  const nfa = new NFA(0, [1], states);

  assert.equal(nfa.acceptIds.has(0), false, 'state 0 should not be accepting before closure');

  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.acceptIds.has(0), true, 'state 0 should become accepting via epsilon');
  assert.equal(nfa.acceptIds.has(1), true, 'state 1 should remain accepting');
});

await runTest('closeOverEpsilonTransitions should handle transitive epsilon chains', () => {
  // Build: state0 --epsilon--> state1 --epsilon--> state2 --[1]--> state3
  const states = [new NFA.State(), new NFA.State(), new NFA.State(), new NFA.State()];
  states[0].addEpsilon(1);
  states[1].addEpsilon(2);
  states[2].addTransition(LookupTables.fromValue(1), 3);
  const nfa = new NFA(0, [3], states);

  nfa.closeOverEpsilonTransitions();

  assert.equal(states[0].epsilon.length, 0, 'state 0 epsilon should be cleared');
  assert.equal(states[0].transitions.length, 1, 'state 0 should have inlined transition');
  assert.equal(states[0].transitions[0].state, 3, 'state 0 should reach state 3');
});

await runTest('closeOverEpsilonTransitions should merge duplicate transitions', () => {
  // Build: state0 --epsilon--> state1, state0 --epsilon--> state2
  // state1 --[1]--> state3, state2 --[2]--> state3
  const states = [new NFA.State(), new NFA.State(), new NFA.State(), new NFA.State()];
  states[0].addEpsilon(1);
  states[0].addEpsilon(2);
  states[1].addTransition(LookupTables.fromValue(1), 3);
  states[2].addTransition(LookupTables.fromValue(2), 3);
  const nfa = new NFA(0, [3], states);

  nfa.closeOverEpsilonTransitions();

  assert.equal(states[0].transitions.length, 1, 'should merge transitions to same target');
  const expectedMask = LookupTables.fromValuesArray([1, 2]);
  assert.equal(states[0].transitions[0].symbols, expectedMask, 'should combine symbol masks');
  assert.equal(states[0].transitions[0].state, 3, 'should point to state 3');
});

logSuiteComplete('NFA builder');
