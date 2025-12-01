import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { regexToNFA, NFASerializer, JavascriptNFABuilder, NFA, Symbol } = await import('../js/nfa_builder.js');
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
    const symbol = Symbol(value);
    for (const stateId of activeStates) {
      if (stateId >= nfa.numStates()) continue;
      for (const target of nfa.getTransitionTargets(stateId, symbol)) {
        nextStates.add(target);
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
  // Create an NFA where plain format is more efficient than packed.
  // Multiple targets per symbol forces plain format.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(1));  // Same symbol, different target
  nfa.seal();
  const serialized = NFASerializer.serialize(nfa);
  expectFormat(serialized, NFASerializer.FORMAT.PLAIN, 'multiple targets per symbol should force plain format');
  const restored = NFASerializer.deserialize(serialized);
  expectAccepts(restored, [1], 'restored NFA should accept value 1');
});

await runTest('NFA serialization should round-trip packed format', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 1, Symbol(2));
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

await runTest('closeOverEpsilonTransitions should inline reachable transitions', () => {
  // Build: state0 --epsilon--> state1 --[1]--> state2
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addEpsilon(0, 1);
  nfa.addTransition(1, 2, Symbol(1));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.getEpsilons(0).length, 0, 'epsilon transitions should be removed');
  assert.equal(nfa.getTransitions(0).length, 1, 'should have inlined transition');
  assert.equal(nfa.getTransitions(0)[0].state, 2, 'inlined transition should point to state 2');
  assert.equal(nfa.getTransitions(0)[0].symbol.value, 1, 'should preserve symbol value');
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
  nfa.addTransition(2, 3, Symbol(1));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  assert.equal(nfa.getEpsilons(0).length, 0, 'state 0 epsilon should be cleared');
  assert.equal(nfa.getTransitions(0).length, 1, 'state 0 should have inlined transition');
  assert.equal(nfa.getTransitions(0)[0].state, 3, 'state 0 should reach state 3');
});

await runTest('closeOverEpsilonTransitions should inherit transitions from epsilon-reachable states', () => {
  // Build: state0 --epsilon--> state1, state0 --epsilon--> state2
  // state1 --[1]--> state3, state2 --[2]--> state3
  // With 3D structure, transitions are stored per-symbol, so state0 should
  // have two entries (one for symbol 1, one for symbol 2) both pointing to state3
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addEpsilon(0, 1);
  nfa.addEpsilon(0, 2);
  nfa.addTransition(1, 3, Symbol(1));
  nfa.addTransition(2, 3, Symbol(2));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  const trans = nfa.getTransitions(0);
  assert.equal(trans.length, 2, 'should have transitions for both symbols');
  // Check that both symbols lead to state 3
  const symbolsToTarget = new Map();
  for (const t of trans) {
    symbolsToTarget.set(t.symbol.value, t.state);
  }
  assert.equal(symbolsToTarget.get(1), 3, 'symbol 1 should go to state 3');
  assert.equal(symbolsToTarget.get(2), 3, 'symbol 2 should go to state 3');
});

await runTest('reduceStartStates should create epsilon transitions from new start', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addStartId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 2, Symbol(1));
  nfa.addTransition(1, 2, Symbol(2));

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
  nfa.addTransition(0, 1, Symbol(1));

  nfa.seal();
  nfa.reduceStartStates();

  assert.equal(nfa.getStartIds().size, 1, 'should still have one start state');
  assert.equal(nfa.startId, 0, 'start state should remain unchanged');
  assert.equal(nfa.numStates(), 2, 'should not add any new states');
});

await runTest('regex star with alternation should accept correctly', () => {
  // Minimal reproduction: (1|2)* - should accept empty, single, and alternating sequences
  const nfa = regexToNFA('(1|2)*', 4);

  expectAccepts(nfa, [], 'star should accept empty string');
  expectAccepts(nfa, [1], 'should accept single 1');
  expectAccepts(nfa, [2], 'should accept single 2');
  expectAccepts(nfa, [1, 2, 1], 'should accept alternating sequence');
});

await runTest('closeOverEpsilonTransitions should not mutate shared transitions', () => {
  // Regression test: when copying transitions during epsilon closure,
  // the original transitions should not be affected.
  const nfa = new NFA();
  for (let i = 0; i < 5; i++) nfa.addState();

  nfa.addStartId(0);
  nfa.addAcceptId(3);

  nfa.addTransition(2, 3, Symbol(1));
  nfa.addTransition(4, 3, Symbol(2));

  nfa.addEpsilon(0, 4);
  nfa.addEpsilon(0, 2);

  nfa.addEpsilon(1, 2);

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  // State 2's original transition should be preserved (symbol 1 only)
  const state2Trans = nfa.getTransitions(2);
  assert.equal(state2Trans.length, 1, 'state 2 should still have exactly one transition');
  assert.equal(state2Trans[0].symbol.value, 1, 'state 2 transition should still be symbol 1 only');

  // State 1 should have inherited only symbol 1 from state 2
  const state1Trans = nfa.getTransitions(1);
  assert.equal(state1Trans.length, 1, 'state 1 should have one transition');
  assert.equal(state1Trans[0].symbol.value, 1, 'state 1 should have symbol 1 only from state 2');
});

await runTest('closeOverEpsilonTransitions with high-index epsilon source', () => {
  // Test case where epsilon is added from a high-index state
  // This tests the sparse _epsilon array handling
  const nfa = new NFA();
  // Create states 0-5
  for (let i = 0; i < 6; i++) nfa.addState();

  nfa.addStartId(0);
  nfa.addAcceptId(5);

  // Epsilon from state 4 to state 5 (high index first)
  nfa.addEpsilon(4, 5);
  // Epsilon from state 0 to state 1 (low index second)
  nfa.addEpsilon(0, 1);
  // Regular transitions
  nfa.addTransition(1, 4, Symbol(1));

  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  // State 0 should have inherited state 1's transition
  assert.equal(nfa.getTransitions(0).length, 1, 'state 0 should have transition from epsilon closure');
  // State 4 should be accepting (inherited from state 5)
  assert.ok(nfa.isAccepting(4), 'state 4 should be accepting via epsilon to state 5');
});

logSuiteComplete('NFA builder');
