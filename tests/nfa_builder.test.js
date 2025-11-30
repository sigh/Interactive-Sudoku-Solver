import assert from 'node:assert/strict';

const ensureGlobalEnvironment = () => {
  const g = globalThis;
  if (!g.self) {
    g.self = g;
  }
  if (typeof g.VERSION_PARAM === 'undefined') {
    g.VERSION_PARAM = '';
  }
  if (typeof g.atob !== 'function') {
    g.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
  }
  if (typeof g.btoa !== 'function') {
    g.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
  }
};

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

const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
};

await runTest('regex literal concatenation', () => {
  const nfa = regexToNFA('12', 9);
  expectAccepts(nfa, [1, 2], '12 should match literal');
  expectRejects(nfa, [1], 'missing final symbol should reject');
  expectRejects(nfa, [1, 3], 'mismatched second symbol should reject');
});

await runTest('regex charsets and quantifiers', () => {
  const nfa = regexToNFA('[1-3]*4?', 9);
  expectAccepts(nfa, [2, 3, 1], 'star should consume arbitrarily long sequences');
  expectAccepts(nfa, [1, 1, 4], 'optional suffix should match when present');
  expectRejects(nfa, [4, 4], 'second optional symbol should not match');
});

await runTest('NFA serialization round-trip', () => {
  const nfa = regexToNFA('(1|2)3+', 9);
  const serialized = NFASerializer.serialize(nfa);
  expectFormat(serialized, NFASerializer.FORMAT.PLAIN, 'epsilon transitions should force plain format');
  const restored = NFASerializer.deserialize(serialized);
  expectAccepts(restored, [1, 3, 3], 'restored NFA should preserve transitions');
  expectAccepts(restored, [2, 3], 'restored NFA should accept alternate branch');
  expectRejects(restored, [3], 'prefix is required even after round-trip');
});

await runTest('NFA serialization packed round-trip', () => {
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

await runTest('JavascriptNFABuilder parity check', () => {
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

await runTest('JavascriptNFABuilder multiple start states', () => {
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

await runTest('JavascriptNFABuilder transition fan-out', () => {
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

console.log('All tests passed.');
