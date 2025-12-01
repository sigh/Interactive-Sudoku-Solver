import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { regexToNFA, NFASerializer, JavascriptNFABuilder, NFA } = await import('../js/nfa_builder.js');
const { BitReader } = await import('../js/util.js');

const evaluateNfa = (nfa, values) => {
  const epsilonClosure = (stateIds) => {
    const visited = new Set(stateIds);
    const stack = [...stateIds];
    while (stack.length) {
      const stateId = stack.pop();
      if (stateId >= nfa.numStates()) continue;
      for (const epsilonTarget of nfa.getEpsilons(stateId)) {
        if (!visited.has(epsilonTarget)) {
          visited.add(epsilonTarget);
          stack.push(epsilonTarget);
        }
      }
    }
    return visited;
  };

  let activeStates = epsilonClosure([...nfa.getStartIds()]);
  for (const value of values) {
    const nextStates = new Set();
    const mask = NFA.Symbol(value);
    for (const stateId of activeStates) {
      if (stateId >= nfa.numStates()) continue;
      for (const transition of nfa.getTransitions(stateId)) {
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
    if (nfa.isAccepting(stateId)) {
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
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addTransition(0, 1, NFA.Symbol(1));
  nfa.addTransition(0, 1, NFA.Symbol(2));
  nfa.seal();
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
  state.addTransition(NFA.Symbol(1), 5);
  state.addTransition(NFA.Symbol(2), 5);
  state.addTransition(NFA.Symbol(3), 7);
  state.addTransition(NFA.Symbol(4), 5);

  state.mergeTransitions();

  assert.equal(state.transitions.length, 2, 'should merge to two distinct targets');
  const target5 = state.transitions.find(t => t.state === 5);
  const target7 = state.transitions.find(t => t.state === 7);
  assert.ok(target5, 'should have transition to state 5');
  assert.ok(target7, 'should have transition to state 7');
  const expectedMask5 = NFA.Symbol(1) | NFA.Symbol(2) | NFA.Symbol(4);
  assert.equal(target5.symbols, expectedMask5, 'should combine symbols for same target');
  assert.equal(target7.symbols, NFA.Symbol(3), 'should keep single symbol unchanged');
});

await runTest('closeOverEpsilonTransitions should inline reachable transitions', () => {
  // Build: state0 --epsilon--> state1 --[1]--> state2
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addEpsilon(0, 1);
  nfa.addTransition(1, 2, NFA.Symbol(1));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.getEpsilons(0).length, 0, 'epsilon transitions should be removed');
  assert.equal(nfa.getTransitions(0).length, 1, 'should have inlined transition');
  assert.equal(nfa.getTransitions(0)[0].state, 2, 'inlined transition should point to state 2');
  assert.equal(nfa.getTransitions(0)[0].symbols, NFA.Symbol(1), 'should preserve symbol mask');
});

await runTest('closeOverEpsilonTransitions should propagate accepting status', () => {
  // Build: state0 --epsilon--> state1 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addEpsilon(0, 1);

  assert.equal(nfa.isAccepting(0), false, 'state 0 should not be accepting before closure');

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.isAccepting(0), true, 'state 0 should become accepting via epsilon');
  assert.equal(nfa.isAccepting(1), true, 'state 1 should remain accepting');
});

await runTest('closeOverEpsilonTransitions should handle transitive epsilon chains', () => {
  // Build: state0 --epsilon--> state1 --epsilon--> state2 --[1]--> state3
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addEpsilon(0, 1);
  nfa.addEpsilon(1, 2);
  nfa.addTransition(2, 3, NFA.Symbol(1));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.getEpsilons(0).length, 0, 'state 0 epsilon should be cleared');
  assert.equal(nfa.getTransitions(0).length, 1, 'state 0 should have inlined transition');
  assert.equal(nfa.getTransitions(0)[0].state, 3, 'state 0 should reach state 3');
});

await runTest('closeOverEpsilonTransitions should merge duplicate transitions', () => {
  // Build: state0 --epsilon--> state1, state0 --epsilon--> state2
  // state1 --[1]--> state3, state2 --[2]--> state3
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addEpsilon(0, 1);
  nfa.addEpsilon(0, 2);
  nfa.addTransition(1, 3, NFA.Symbol(1));
  nfa.addTransition(2, 3, NFA.Symbol(2));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.getTransitions(0).length, 1, 'should merge transitions to same target');
  const expectedMask = NFA.Symbol(1) | NFA.Symbol(2);
  assert.equal(nfa.getTransitions(0)[0].symbols, expectedMask, 'should combine symbol masks');
  assert.equal(nfa.getTransitions(0)[0].state, 3, 'should point to state 3');
});

await runTest('reduceStartStates should create epsilon transitions from new start', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addStartId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 2, NFA.Symbol(1));
  nfa.addTransition(1, 2, NFA.Symbol(2));

  assert.equal(nfa.getStartIds().size, 2, 'should have two start states before reduction');

  nfa.seal();
  nfa.reduceStartStates();

  assert.equal(nfa.getStartIds().size, 1, 'should have one start state after reduction');
  assert.equal(nfa.startId, 3, 'new start state should be the newly added state');
  assert.equal(nfa.getEpsilons(3).length, 2, 'new start should have epsilon to both original starts');
  assert.ok(nfa.getEpsilons(3).includes(0), 'new start should have epsilon to state 0');
  assert.ok(nfa.getEpsilons(3).includes(1), 'new start should have epsilon to state 1');
});

await runTest('reduceStartStates should be a no-op for single start state', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addTransition(0, 1, NFA.Symbol(1));

  nfa.seal();
  nfa.reduceStartStates();

  assert.equal(nfa.getStartIds().size, 1, 'should still have one start state');
  assert.equal(nfa.startId, 0, 'start state should remain unchanged');
  assert.equal(nfa.numStates(), 2, 'should not add any new states');
});

logSuiteComplete('NFA builder');
