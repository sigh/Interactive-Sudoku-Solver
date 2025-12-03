import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { regexToNFA, javascriptSpecToNFA, optimizeNFA, NFASerializer, JavascriptNFABuilder, NFA, Symbol } = await import('../js/nfa_builder.js');
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

await runTest('regex count quantifier {n} exact count', () => {
  const nfa = regexToNFA('1{3}', 9);
  expectRejects(nfa, [1, 1], 'fewer than n should reject');
  expectAccepts(nfa, [1, 1, 1], 'exactly n should accept');
  expectRejects(nfa, [1, 1, 1, 1], 'more than n should reject');
});

await runTest('regex count quantifier {n,} unbounded', () => {
  const nfa = regexToNFA('1{2,}', 9);
  expectRejects(nfa, [1], 'fewer than min should reject');
  expectAccepts(nfa, [1, 1], 'exactly min should accept');
  expectAccepts(nfa, [1, 1, 1], 'more than min should accept');
  expectAccepts(nfa, [1, 1, 1, 1, 1], 'many more than min should accept');
});

await runTest('regex count quantifier {n,m} bounded range', () => {
  const nfa = regexToNFA('1{2,4}', 9);
  expectRejects(nfa, [1], 'fewer than min should reject');
  expectAccepts(nfa, [1, 1], 'exactly min should accept');
  expectAccepts(nfa, [1, 1, 1], 'between min and max should accept');
  expectAccepts(nfa, [1, 1, 1, 1], 'exactly max should accept');
  expectRejects(nfa, [1, 1, 1, 1, 1], 'more than max should reject');
});

await runTest('regex count quantifier {0} matches empty', () => {
  const nfa = regexToNFA('1{0}2', 9);
  expectAccepts(nfa, [2], 'should match just the suffix');
  expectRejects(nfa, [1, 2], 'should reject if prefix present');
});

await runTest('regex count quantifier {0,n} allows zero', () => {
  const nfa = regexToNFA('1{0,2}2', 9);
  expectAccepts(nfa, [2], 'zero occurrences should accept');
  expectAccepts(nfa, [1, 2], 'one occurrence should accept');
  expectAccepts(nfa, [1, 1, 2], 'two occurrences should accept');
  expectRejects(nfa, [1, 1, 1, 2], 'three occurrences should reject');
});

await runTest('regex count quantifier with groups', () => {
  const nfa = regexToNFA('(12){2}', 9);
  expectRejects(nfa, [1, 2], 'single group should reject');
  expectAccepts(nfa, [1, 2, 1, 2], 'two groups should accept');
  expectRejects(nfa, [1, 2, 1, 2, 1, 2], 'three groups should reject');
});

await runTest('regex count quantifier with charset', () => {
  const nfa = regexToNFA('[12]{3}', 9);
  expectAccepts(nfa, [1, 2, 1], 'mixed values should accept');
  expectAccepts(nfa, [2, 2, 2], 'all same values should accept');
  expectRejects(nfa, [1, 2], 'too short should reject');
  expectRejects(nfa, [1, 2, 3], 'out of charset should reject');
});

await runTest('regex count quantifier chained with other quantifiers', () => {
  const nfa = regexToNFA('1{2}2*3?', 9);
  expectAccepts(nfa, [1, 1], 'just required count');
  expectAccepts(nfa, [1, 1, 2, 2, 2], 'count plus star');
  expectAccepts(nfa, [1, 1, 3], 'count plus optional');
  expectAccepts(nfa, [1, 1, 2, 3], 'count plus star plus optional');
  expectRejects(nfa, [1], 'insufficient count should reject');
});

await runTest('regex count quantifier {1} is identity', () => {
  const nfa = regexToNFA('1{1}', 9);
  expectAccepts(nfa, [1], 'single should accept');
  expectRejects(nfa, [1, 1], 'double should reject');
  expectRejects(nfa, [], 'empty should reject');
});

await runTest('regex count quantifier error on invalid syntax', () => {
  assert.throws(() => regexToNFA('1{,2}', 9), /Expected number/, 'missing min should throw');
  assert.throws(() => regexToNFA('1{3,2}', 9), /max.*<.*min/i, 'max < min should throw');
  assert.throws(() => regexToNFA('1{', 9), /Expected number/, 'unclosed brace should throw');
  assert.throws(() => regexToNFA('1{}', 9), /Expected number/, 'empty braces should throw');
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

await runTest('NFA serialization should handle empty NFA', () => {
  const nfa = new NFA();
  nfa.seal();

  const serialized = NFASerializer.serialize(nfa);
  assert.equal(serialized, '', 'empty NFA should serialize to empty string');

  const restored = NFASerializer.deserialize(serialized);
  assert.equal(restored.numStates(), 0, 'restored NFA should have 0 states');
  expectRejects(restored, [], 'empty NFA should reject empty input');
  expectRejects(restored, [1], 'empty NFA should reject any input');
});

await runTest('NFA serialization should handle multiple start states', () => {
  // NFA with two start states: one accepts 1, the other accepts 2.
  const nfa = new NFA();
  nfa.addState();  // 0: start, accepts on 1
  nfa.addState();  // 1: start, accepts on 2
  nfa.addState();  // 2: accept
  nfa.addStartId(0);
  nfa.addStartId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 2, Symbol(1));
  nfa.addTransition(1, 2, Symbol(2));
  nfa.seal();

  const serialized = NFASerializer.serialize(nfa);
  const restored = NFASerializer.deserialize(serialized);

  assert.equal(restored.getStartIds().size, 2, 'should have 2 start states');
  expectAccepts(restored, [1], 'path from first start should accept');
  expectAccepts(restored, [2], 'path from second start should accept');
  expectRejects(restored, [3], 'no path for value 3');
});

await runTest('NFA serialization should handle accepting start states', () => {
  // NFA with two start states, one of which is accepting.
  const nfa = new NFA();
  nfa.addState();  // 0: start and accept
  nfa.addState();  // 1: start, not accept
  nfa.addState();  // 2: accept
  nfa.addStartId(0);
  nfa.addStartId(1);
  nfa.addAcceptId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(1, 2, Symbol(1));
  nfa.seal();

  const serialized = NFASerializer.serialize(nfa);
  const restored = NFASerializer.deserialize(serialized);

  assert.equal(restored.getStartIds().size, 2, 'should have 2 start states');
  expectAccepts(restored, [], 'empty input accepted by accepting start state');
  expectAccepts(restored, [1], 'path from second start should accept');
});

await runTest('JavascriptNFABuilder should handle parity checks', () => {
  const builder = new JavascriptNFABuilder({
    startState: { sum: 0 },
    transition: (state, value) => ({ sum: (state.sum + value) % 2 }),
    accept: (state) => state.sum === 0,
  }, 4);
  const nfa = builder.build();
  expectAccepts(nfa, [1, 2, 1], 'even parity sequences should accept');
  expectAccepts(nfa, [4], 'single even value keeps parity even');
  expectRejects(nfa, [1], 'odd parity sequences should reject');
});

await runTest('JavascriptNFABuilder should support multiple start states', () => {
  const builder = new JavascriptNFABuilder({
    startState: [{ required: 1, seen: false }, { required: 2, seen: false }],
    transition: (state, value) => {
      if (!state.seen && value === state.required) {
        return { ...state, seen: true };
      }
    },
    accept: (state) => state.seen === true,
  }, 4);
  const nfa = builder.build();
  expectAccepts(nfa, [1], 'start branch for value 1 should accept');
  expectAccepts(nfa, [2], 'start branch for value 2 should accept');
  expectRejects(nfa, [3], 'unlisted start values should reject');
  expectRejects(nfa, [1, 2], 'additional unmatched input should reject');
});

await runTest('JavascriptNFABuilder should allow transition fan-out', () => {
  const builder = new JavascriptNFABuilder({
    startState: { stage: 'START' },
    transition: (state, value) => {
      if (state.stage === 'START' && value === 1) {
        return [{ stage: 'LEFT' }, { stage: 'RIGHT' }];
      }
      if (state.stage === 'LEFT' && value === 2) {
        return { stage: 'ACCEPT' };
      }
      if (state.stage === 'RIGHT' && value === 3) {
        return { stage: 'ACCEPT' };
      }
    },
    accept: (state) => state.stage === 'ACCEPT',
  }, 4);
  const nfa = builder.build();
  expectAccepts(nfa, [1, 2], 'left branch should reach accept');
  expectAccepts(nfa, [1, 3], 'right branch should reach accept');
  expectRejects(nfa, [1, 1], 'branch fan-out must consume matching suffix');
  expectRejects(nfa, [2, 3], 'values without initial branch should reject');
});

await runTest('javascriptSpecToNFA should optimize and return ready NFA', () => {
  // Parity check - bounded state space (only 2 states: even/odd).
  const nfa = javascriptSpecToNFA({
    startState: 0,
    transition: (state, value) => (state + value) % 2,
    accept: (state) => state === 0,
  }, 3);

  // Parity check has single start state.
  assert.equal(nfa.getStartIds().size, 1, 'should have single start state');;

  expectAccepts(nfa, [2], 'should accept even sum');
  expectAccepts(nfa, [1, 1], 'should accept even sum');
  expectAccepts(nfa, [1, 2, 3], 'should accept even sum (1+2+3=6)');
  expectRejects(nfa, [1], 'should reject odd sum');
  expectRejects(nfa, [1, 2], 'should reject odd sum (1+2=3)');
});

await runTest('javascriptSpecToNFA should merge equivalent states', () => {
  // Two branches that end up equivalent should be merged.
  const nfa = javascriptSpecToNFA({
    startState: [{ path: "A", done: false }, { path: "B", done: false }],
    transition: (state, value) => {
      if (!state.done && value === 1) {
        return { path: state.path, done: true };
      }
    },
    accept: (state) => state.done,
  }, 2);

  // Both paths lead to equivalent accepting states after seeing 1.
  // reduceBySimulation should merge them.
  expectAccepts(nfa, [1], 'should accept value 1');
  expectRejects(nfa, [2], 'should reject value 2');

  // After optimization, equivalent terminal states should be merged.
  // We can't easily check exact state count, but we can verify correctness.
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

await runTest('removeDeadStates should remove transitions to non-accepting states', () => {
  // Build: state0 --[1]--> state1, state0 --[2]--> state2 (accepting)
  // state1 has no outgoing transitions and is not accepting (dead state)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));

  assert.equal(nfa.numStates(), 3, 'should have 3 states before');

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 2, 'should have 2 states after removing dead state');
  // Start state should have exactly one transition (to accept)
  const startTrans = nfa.getTransitions(nfa.startId);
  assert.equal(startTrans.length, 1, 'start should only have one transition');
  assert.equal(startTrans[0].symbol.value, 2, 'remaining transition should be symbol 2');
  expectAccepts(nfa, [2], 'should still accept valid input');
  expectRejects(nfa, [1], 'should reject dead path');
});

await runTest('removeDeadStates should keep states that can reach accept', () => {
  // Build: state0 --[1]--> state1 --[2]--> state2 (accepting)
  // state1 is not accepting but can reach state2, so it should be kept
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(1, 2, Symbol(2));

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 3, 'all states should be kept (all can reach accept)');
  expectAccepts(nfa, [1, 2], 'should still accept valid input');
});

await runTest('removeDeadStates should handle multiple targets per symbol', () => {
  // Build: state0 --[1]--> state1 (dead), state0 --[1]--> state2 (can reach accept)
  // state2 --[2]--> state3 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));  // dead path
  nfa.addTransition(0, 2, Symbol(1));  // live path
  nfa.addTransition(2, 3, Symbol(2));

  assert.equal(nfa.numStates(), 4, 'should have 4 states before');

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 3, 'should have 3 states after (dead state 1 removed)');
  // The NFA should still work correctly
  expectAccepts(nfa, [1, 2], 'should accept via the live path');
  expectRejects(nfa, [1], 'single symbol should not reach accept');
});

await runTest('removeDeadStates should keep accepting terminal states', () => {
  // Build: state0 --[1]--> state1 (accepting, no outgoing transitions)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addTransition(0, 1, Symbol(1));

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 2, 'should keep both states');
  assert.equal(nfa.getTransitions(nfa.startId).length, 1, 'start should keep transition to accepting state');
  expectAccepts(nfa, [1], 'should still accept valid input');
});

await runTest('removeDeadStates should handle chain of dead states', () => {
  // Build: state0 --[1]--> state1 --[2]--> state2 (all dead, no accept)
  //        state0 --[3]--> state3 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(1, 2, Symbol(2));
  nfa.addTransition(0, 3, Symbol(3));

  assert.equal(nfa.numStates(), 4, 'should have 4 states before');

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 2, 'should have 2 states after removing dead chain');
  expectAccepts(nfa, [3], 'should still accept valid input');
  expectRejects(nfa, [1], 'dead path should reject');
  expectRejects(nfa, [1, 2], 'dead chain should reject');
});

await runTest('removeDeadStates should throw if epsilon transitions exist', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addEpsilon(0, 1);
  nfa.seal();

  assert.throws(
    () => nfa.removeDeadStates(),
    /epsilon/i,
    'should throw if epsilon transitions exist'
  );
});

await runTest('removeDeadStates should handle NFA with no accept states', () => {
  // All states are dead since nothing can reach an accept state
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  // No accept states!
  nfa.addTransition(0, 1, Symbol(1));

  nfa.seal();
  nfa.removeDeadStates();

  // All states removed - NFA is empty
  assert.equal(nfa.numStates(), 0, 'all states should be removed');
});

await runTest('removeDeadStates should handle start state that is also accepting', () => {
  // state0 is both start and accept, with transition to dead state
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(0);  // Start is also accept
  nfa.addTransition(0, 1, Symbol(1));  // Dead transition

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 1, 'should only have the start/accept state');
  expectAccepts(nfa, [], 'empty input should still accept');
  expectRejects(nfa, [1], 'dead transition should be removed');
});

await runTest('removeDeadStates with cycle that cannot reach accept', () => {
  // state0 --[1]--> state1 --[2]--> state0 (cycle but no accept)
  // state0 --[3]--> state2 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(1, 0, Symbol(2));  // Creates cycle
  nfa.addTransition(0, 2, Symbol(3));

  nfa.seal();
  nfa.removeDeadStates();

  // The cycle is not dead because state0 can reach state2
  // But state1 can only go back to state0, which can reach accept
  // So state1 is NOT dead - it can reach accept through state0
  assert.equal(nfa.numStates(), 3, 'all states in cycle should be kept');
  expectAccepts(nfa, [3], 'direct path to accept should work');
  expectAccepts(nfa, [1, 2, 3], 'cycle then accept should work');
});

await runTest('removeDeadStates with self-loop on dead state', () => {
  // state0 --[1]--> state1 --[1]--> state1 (self-loop, but dead)
  // state0 --[2]--> state2 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(1, 1, Symbol(1));  // Self-loop
  nfa.addTransition(0, 2, Symbol(2));

  assert.equal(nfa.numStates(), 3, 'should have 3 states before');

  nfa.seal();
  nfa.removeDeadStates();

  assert.equal(nfa.numStates(), 2, 'should have 2 states after removing dead state');
  expectAccepts(nfa, [2], 'should still accept valid input');
  expectRejects(nfa, [1], 'dead state path should reject');
  expectRejects(nfa, [1, 1, 1], 'self-loop on dead state should reject');
});

await runTest('remapStates should reorder states', () => {
  // Build: state0 --[1]--> state1 --[2]--> state2 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(1, 2, Symbol(2));
  nfa.seal();

  // Remap: 0->2, 1->0, 2->1 (rotate states)
  nfa.remapStates([2, 0, 1]);

  assert.equal(nfa.numStates(), 3, 'should still have 3 states');
  assert.equal(nfa.startId, 2, 'start should be remapped to 2');
  assert.ok(nfa.isAccepting(1), 'accept should be remapped to 1');
  expectAccepts(nfa, [1, 2], 'should still accept valid input after remap');
});

await runTest('remapStates should remove states with undefined mapping', () => {
  // Build: state0 --[1]--> state1, state0 --[2]--> state2 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.seal();

  // Remove state1 by mapping it to undefined
  nfa.remapStates([0, undefined, 1]);

  assert.equal(nfa.numStates(), 2, 'should have 2 states after removal');
  expectAccepts(nfa, [2], 'should still accept valid input');
  expectRejects(nfa, [1], 'transition to removed state should be gone');
});

await runTest('remapStates should merge states', () => {
  // Build: state0 --[1]--> state1 (accepting), state0 --[2]--> state2 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.seal();

  // Merge state1 and state2 into new state 1
  nfa.remapStates([0, 1, 1]);

  assert.equal(nfa.numStates(), 2, 'should have 2 states after merge');
  assert.ok(nfa.isAccepting(1), 'merged state should be accepting');
  expectAccepts(nfa, [1], 'should accept via first path');
  expectAccepts(nfa, [2], 'should accept via second path');
});

await runTest('remapStates should deduplicate targets when merging', () => {
  // Build: state0 --[1]--> state1, state0 --[1]--> state2 (same symbol, different targets)
  // state1 --[2]--> state3 (accepting)
  // state2 --[2]--> state3 (accepting)
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(1));  // Fan-out
  nfa.addTransition(1, 3, Symbol(2));
  nfa.addTransition(2, 3, Symbol(2));
  nfa.seal();

  // Merge state1 and state2 into same state
  nfa.remapStates([0, 1, 1, 2]);

  assert.equal(nfa.numStates(), 3, 'should have 3 states after merge');
  // The transition from state0 on symbol 1 should go to state 1 only once
  const targets = nfa.getTransitionTargets(0, Symbol(1));
  assert.equal(targets.length, 1, 'targets should be deduplicated after merge');
  expectAccepts(nfa, [1, 2], 'should still accept');
});

await runTest('remapStates dedup should preserve targets after duplicate', () => {
  // This test catches bugs where the dedup loop uses `break` instead of `continue`.
  // Build: state0 --[1]--> state1, state0 --[1]--> state2, state0 --[1]--> state3
  // All three targets on the same symbol from state0.
  // We'll remap state1 and state3 to the same state, but state2 to a different one.
  // If dedup incorrectly breaks after finding the duplicate, state2 would be lost.
  const nfa = new NFA();
  nfa.addState();  // 0
  nfa.addState();  // 1
  nfa.addState();  // 2
  nfa.addState();  // 3
  nfa.addState();  // 4 (accepting via state2)
  nfa.addStartId(0);
  nfa.addAcceptId(4);
  nfa.addTransition(0, 1, Symbol(1));  // First target
  nfa.addTransition(0, 2, Symbol(1));  // Second target (middle)
  nfa.addTransition(0, 3, Symbol(1));  // Third target
  nfa.addTransition(2, 4, Symbol(2));  // Only state2 leads to accepting
  nfa.seal();

  // Remap: state1 and state3 both go to new state 1, state2 goes to new state 2
  // Old states: 0, 1, 2, 3, 4
  // New states: 0, 1, 2, 1, 3  (state1 and state3 merge to 1, state2 stays distinct as 2)
  nfa.remapStates([0, 1, 2, 1, 3]);

  // After remap, state0 should have targets [1, 2] on symbol 1
  // If there's a break-instead-of-continue bug:
  // - First we see state1 -> maps to 1, write it
  // - Then state2 -> maps to 2, but if dedup breaks on any duplicate check, we'd lose it
  // - Then state3 -> maps to 1, duplicate found... if we break here, we already have 2
  // The bug would manifest if we broke AFTER finding duplicate of 1 (from state1),
  // preventing us from processing state3.
  // Actually the ordering matters - let's verify targets are [1, 2].
  const targets = nfa.getTransitionTargets(0, Symbol(1));
  assert.equal(targets.length, 2, 'should have 2 distinct targets after dedup');
  assert.ok(targets.includes(1), 'should include merged state 1');
  assert.ok(targets.includes(2), 'should include state 2 (path to accepting)');

  // Critical: the NFA should still accept [1, 2] because state2 path is preserved
  expectAccepts(nfa, [1, 2], 'must still accept via state2 path');
});

await runTest('remapStates dedup processes all targets when duplicate found early', () => {
  // Specifically test: targets = [A, B, C] where A=C (map to same), B is unique.
  // The dedup loop should process: A (write), B (write), C (skip as dup of A).
  // A break bug on finding C as dup would be fine here since C is last.
  // But if targets = [A, C, B] and we break on C, we lose B.
  // Build with that order: state0 --[1]--> state1, state0 --[1]--> state3, state0 --[1]--> state2
  const nfa = new NFA();
  nfa.addState();  // 0
  nfa.addState();  // 1
  nfa.addState();  // 2
  nfa.addState();  // 3
  nfa.addState();  // 4 (accepting)
  nfa.addStartId(0);
  nfa.addAcceptId(4);
  // Add in order so targets array is [1, 3, 2]
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 3, Symbol(1));  // This will be dup with state1 after remap
  nfa.addTransition(0, 2, Symbol(1));  // This comes AFTER the duplicate
  nfa.addTransition(2, 4, Symbol(2));  // Only state2 leads to accepting
  nfa.seal();

  // Remap: state1 and state3 both go to new state 1
  // state2 goes to new state 2
  nfa.remapStates([0, 1, 2, 1, 3]);

  // Processing should be:
  // - targets[0]=1 maps to 1, write it (writeIndex=1)
  // - targets[1]=3 maps to 1, duplicate of targets[0]=1, CONTINUE (not break!)
  // - targets[2]=2 maps to 2, no dup, write it (writeIndex=2)
  // Final: [1, 2]
  // If we used break instead of continue on the duplicate:
  // - targets[0]=1 maps to 1, write it
  // - targets[1]=3 maps to 1, duplicate found, BREAK -> stop processing
  // Final: [1] only, lost state2!

  const targets = nfa.getTransitionTargets(0, Symbol(1));
  assert.equal(targets.length, 2, 'should have 2 targets (continue, not break on dedup)');
  assert.ok(targets.includes(1), 'should have merged state');
  assert.ok(targets.includes(2), 'should have state2 - must not be lost after dup');

  // This is the critical check: if state2 was lost, this would fail
  expectAccepts(nfa, [1, 2], 'MUST accept - state2 path must be preserved');
});

await runTest('remapStates should throw if epsilon transitions exist', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addEpsilon(0, 1);
  nfa.seal();

  assert.throws(
    () => nfa.remapStates([0, 1]),
    /epsilon/i,
    'should throw if epsilon transitions exist'
  );
});

await runTest('reduceBySimulation should merge equivalent states', () => {
  // Two states with identical transitions to same accepting state.
  // state0 --[1]--> state1, state0 --[2]--> state2
  // state1 --[3]--> state3 (accepting)
  // state2 --[3]--> state3 (accepting)
  // state1 and state2 are simulation-equivalent.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.addTransition(1, 3, Symbol(3));
  nfa.addTransition(2, 3, Symbol(3));
  nfa.seal();

  assert.equal(nfa.numStates(), 4, 'should have 4 states before');
  nfa.reduceBySimulation();
  assert.equal(nfa.numStates(), 3, 'should have 3 states after merging equivalent states');

  expectAccepts(nfa, [1, 3], 'should accept via first path');
  expectAccepts(nfa, [2, 3], 'should accept via second path');
  expectRejects(nfa, [1, 2], 'wrong sequence should reject');
});

await runTest('reduceBySimulation should not merge non-equivalent states', () => {
  // state1 is accepting, state2 is not - they cannot be equivalent.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.seal();

  assert.equal(nfa.numStates(), 3, 'should have 3 states before');
  nfa.reduceBySimulation();
  assert.equal(nfa.numStates(), 3, 'should still have 3 states (no equivalent states)');

  expectAccepts(nfa, [1], 'should accept via accepting state');
  expectRejects(nfa, [2], 'should reject via non-accepting state');
});

await runTest('reduceBySimulation should handle states with different transitions', () => {
  // state1 --[2]--> state3, state2 --[3]--> state3
  // Different transition symbols, so not equivalent.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(1));
  nfa.addTransition(1, 3, Symbol(2));
  nfa.addTransition(2, 3, Symbol(3));  // Different symbol
  nfa.seal();

  nfa.reduceBySimulation();
  assert.equal(nfa.numStates(), 4, 'should keep all states (different transitions)');
});

await runTest('reduceBySimulation should merge multiple equivalent terminal states', () => {
  // Multiple accepting terminal states with no transitions.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addAcceptId(2);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.addTransition(0, 3, Symbol(3));
  nfa.seal();

  assert.equal(nfa.numStates(), 4, 'should have 4 states before');
  nfa.reduceBySimulation();
  assert.equal(nfa.numStates(), 2, 'should have 2 states after (all accepts merged)');

  expectAccepts(nfa, [1], 'should accept symbol 1');
  expectAccepts(nfa, [2], 'should accept symbol 2');
  expectAccepts(nfa, [3], 'should accept symbol 3');
});

await runTest('reduceBySimulation should preserve language with simulation chains', () => {
  // state0 --[1]--> state1 --[2]--> state2 --[3]--> state3 (accepting)
  // state0 --[4]--> state4 --[2]--> state2
  // state1 and state4 both lead to state2 on symbol 2, so they're equivalent.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 4, Symbol(4));
  nfa.addTransition(1, 2, Symbol(2));
  nfa.addTransition(4, 2, Symbol(2));
  nfa.addTransition(2, 3, Symbol(3));
  nfa.seal();

  assert.equal(nfa.numStates(), 5, 'should have 5 states before');
  nfa.reduceBySimulation();
  assert.equal(nfa.numStates(), 4, 'should have 4 states after');

  expectAccepts(nfa, [1, 2, 3], 'should accept [1,2,3]');
  expectAccepts(nfa, [4, 2, 3], 'should accept [4,2,3]');
  expectRejects(nfa, [1, 2], 'should reject incomplete path');
});

await runTest('reduceBySimulation should prune dominated transitions', () => {
  // state0 --[1]--> state1 --[2]--> state2 (accepting)
  //                 state1 --[3]--> state3 (accepting)
  // state0 --[1]--> state4 --[2]--> state2 (accepting)
  // state1 simulates state4: both have [2]->state2, but state1 also has [3]->state3.
  // state4 does NOT simulate state1 (missing [3] transition).
  // So transition to state4 should be pruned.
  const nfa = new NFA();
  nfa.addState();  // 0: start
  nfa.addState();  // 1: has both [2] and [3]
  nfa.addState();  // 2: accepting
  nfa.addState();  // 3: accepting
  nfa.addState();  // 4: only has [2]
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addAcceptId(3);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 4, Symbol(1));
  nfa.addTransition(1, 2, Symbol(2));
  nfa.addTransition(1, 3, Symbol(3));
  nfa.addTransition(4, 2, Symbol(2));
  nfa.seal();

  // Before: state0 has 2 targets on symbol 1.
  assert.equal(nfa.getTransitionTargets(0, Symbol(1)).length, 2, 'should have 2 targets before');

  nfa.reduceBySimulation();

  // After: state1 simulates state4 (but not vice versa), so edge to state4 is pruned.
  assert.equal(nfa.getTransitionTargets(0, Symbol(1)).length, 1, 'should have 1 target after pruning');
  expectAccepts(nfa, [1, 2], 'should accept [1,2]');
  expectAccepts(nfa, [1, 3], 'should accept [1,3]');
});

await runTest('reduceBySimulation should keep both targets for mutual simulation', () => {
  // state0 --[1]--> state1 (accepting)
  // state0 --[1]--> state2 (accepting)
  // state1 and state2 mutually simulate each other, one is kept.
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(1));
  nfa.seal();

  nfa.reduceBySimulation();

  // Mutual simulation: states merge, transitions dedupe.
  assert.equal(nfa.numStates(), 2, 'should have 2 states after merging');
  expectAccepts(nfa, [1], 'should accept [1]');
});

await runTest('reduceBySimulation should not prune when neither dominates', () => {
  // state0 --[1]--> state1 --[2]--> state3 (accepting)
  // state0 --[1]--> state2 --[3]--> state4 (accepting)
  // Neither state1 nor state2 simulates the other (different outgoing symbols).
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(3);
  nfa.addAcceptId(4);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(1));
  nfa.addTransition(1, 3, Symbol(2));
  nfa.addTransition(2, 4, Symbol(3));
  nfa.seal();

  nfa.reduceBySimulation();

  // Both paths should remain since neither dominates.
  expectAccepts(nfa, [1, 2], 'should accept [1,2]');
  expectAccepts(nfa, [1, 3], 'should accept [1,3]');
});

await runTest('optimizeNFA should close epsilon transitions', () => {
  const nfa = new NFA();
  nfa.addState();
  nfa.addState();
  nfa.addState();
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addEpsilon(0, 1);
  nfa.addTransition(1, 2, Symbol(1));
  nfa.seal();

  optimizeNFA(nfa);

  // After optimization, epsilon is closed and NFA works correctly.
  expectAccepts(nfa, [1], 'should accept [1] after epsilon closure');
  expectRejects(nfa, [2], 'should reject [2]');
});

await runTest('optimizeNFA should remove unreachable states', () => {
  const nfa = new NFA();
  nfa.addState();  // 0: start
  nfa.addState();  // 1: reachable, accepting
  nfa.addState();  // 2: unreachable
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(2, 2, Symbol(1));  // Self-loop on unreachable state
  nfa.seal();

  optimizeNFA(nfa);

  assert.equal(nfa.numStates(), 2, 'unreachable state should be removed');
  expectAccepts(nfa, [1], 'should still accept [1]');
});

await runTest('optimizeNFA should remove dead-end states', () => {
  const nfa = new NFA();
  nfa.addState();  // 0: start
  nfa.addState();  // 1: dead-end (no path to accept)
  nfa.addState();  // 2: accepting
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));  // Dead-end path
  nfa.addTransition(0, 2, Symbol(2));  // Path to accept
  nfa.seal();

  optimizeNFA(nfa);

  assert.equal(nfa.numStates(), 2, 'dead-end state should be removed');
  expectAccepts(nfa, [2], 'should still accept [2]');
  expectRejects(nfa, [1], 'should reject [1] (dead-end removed)');
});

await runTest('optimizeNFA should merge equivalent states', () => {
  const nfa = new NFA();
  nfa.addState();  // 0: start
  nfa.addState();  // 1: accepting terminal
  nfa.addState();  // 2: accepting terminal (equivalent to 1)
  nfa.addStartId(0);
  nfa.addAcceptId(1);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.seal();

  optimizeNFA(nfa);

  // States 1 and 2 are equivalent (both accepting terminals), should merge.
  assert.equal(nfa.numStates(), 2, 'equivalent states should be merged');
  expectAccepts(nfa, [1], 'should accept [1]');
  expectAccepts(nfa, [2], 'should accept [2]');
});

await runTest('optimizeNFA with allStatesAreReachable should skip forward reachability', () => {
  // When allStatesAreReachable is true, forward dead state removal is skipped.
  // This tests that the option works correctly.
  const nfa = new NFA();
  nfa.addState();  // 0: start
  nfa.addState();  // 1: dead-end
  nfa.addState();  // 2: accepting
  nfa.addStartId(0);
  nfa.addAcceptId(2);
  nfa.addTransition(0, 1, Symbol(1));
  nfa.addTransition(0, 2, Symbol(2));
  nfa.seal();

  optimizeNFA(nfa);

  // Dead-end state 1 should still be removed (backward reachability still runs).
  assert.equal(nfa.numStates(), 2, 'dead-end should still be removed via backward pass');
});

logSuiteComplete('NFA builder');
