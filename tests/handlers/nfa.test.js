import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { createAccumulator, valueMask } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { regexToNFA, javascriptSpecToNFA, SEGMENT_BREAK } = await import('../../js/nfa_builder.js');
const { compressNFA, NFAConstraint } = await import('../../js/solver/nfa_handler.js');

// A minimal geometry stub: initialize() only reads numValues.
const geometry = (numValues) => ({ numValues });

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
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = [allValues, allValues];
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
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const grid = [0, 0];
  grid[0] = valueMask(2);
  grid[1] = valueMask(2);
  const accumulator = { addForCell() { throw new Error('should not be called'); } };

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint should not touch cells already at supported values', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const grid = [0, 0];
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(accumulator.touched.size, 0, 'no cells should be touched');
});

await runTest('NFAConstraint should report only changed cells', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = [allValues, allValues];
  grid[0] = valueMask(1); // Already constrained
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
  const handler = new NFAConstraint([[0, 1]], cnfa);

  // First cell only allows 2, but NFA requires 1 first
  const grid = [0, 0];
  grid[0] = valueMask(2);
  grid[1] = valueMask(1, 2);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint forward pass should fail when middle cell blocks path', () => {
  const nfa = regexToNFA('123', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1, 2]], cnfa);

  const grid = [0, 0, 0];
  grid[0] = valueMask(1);
  grid[1] = valueMask(3); // Should be 2
  grid[2] = valueMask(1, 2, 3);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint forward pass tracks reachable states through NFA', () => {
  // With alternation, multiple states may be reachable
  const nfa = regexToNFA('(12|13)', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const grid = [0, 0];
  grid[0] = valueMask(1);
  grid[1] = valueMask(2, 3);
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
  const handler = new NFAConstraint([[0, 1, 2]], cnfa);

  // Path 121 - reaches a state but not an accepting one
  const grid = [0, 0, 0];
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(1); // Should be 3 to reach accepting
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, false);
});

await runTest('NFAConstraint backward pass should drop non-accepting final states', () => {
  // After `11` the automaton is in the (non-accepting) `1*` loop, which reaches
  // the final layer; only `12` is accepted.
  const cnfa = compressNFA(regexToNFA('1*2', 2));
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const grid = [valueMask(1, 2), valueMask(1, 2)];
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.deepEqual(grid, [valueMask(1), valueMask(2)]);
});

await runTest('NFAConstraint backward pass should prune values not reaching accepting state', () => {
  const nfa = regexToNFA('(12|34)', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  // Last cell is 2, so first cell must be 1 (not 3)
  const grid = [0, 0];
  grid[0] = valueMask(1, 3);
  grid[1] = valueMask(2);
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1));
});

await runTest('NFAConstraint backward pass should prune unreachable states', () => {
  const nfa = regexToNFA('1[23]', 3);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  // Second cell only allows 2
  const grid = [0, 0];
  grid[0] = valueMask(1, 2, 3);
  grid[1] = valueMask(2);
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
  const handler = new NFAConstraint([[5, 10]], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = new Array(15).fill(allValues);
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
  const handler = new NFAConstraint([[0]], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = [allValues];
  const accumulator = createAccumulator();

  const result = handler.enforceConsistency(grid, accumulator);
  assert.equal(result, true);
  assert.equal(grid[0], valueMask(1, 2));
});

await runTest('NFAConstraint should handle longer cell sequences', () => {
  const nfa = regexToNFA('1234', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1, 2, 3]], cnfa);

  const allValues = valueMask(1, 2, 3, 4);
  const grid = [allValues, allValues, allValues, allValues];
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
  const handler = new NFAConstraint([[0, 1]], cnfa);

  const allValues = valueMask(1, 2, 3, 4);

  // First call
  const grid1 = [allValues, allValues];
  assert.equal(handler.enforceConsistency(grid1, createAccumulator()), true);
  assert.equal(grid1[0], valueMask(1));

  // Second call with different grid
  const grid2 = [0, 0];
  grid2[0] = valueMask(1, 2);
  grid2[1] = valueMask(2, 3);
  assert.equal(handler.enforceConsistency(grid2, createAccumulator()), true);
  assert.equal(grid2[0], valueMask(1));

  // Third call that fails
  const grid3 = [0, 0];
  grid3[0] = valueMask(2);
  grid3[1] = valueMask(2);
  assert.equal(handler.enforceConsistency(grid3, createAccumulator()), false);

  // Fourth call should still work after failure
  const grid4 = [0, 0];
  grid4[0] = valueMask(1, 2);
  grid4[1] = valueMask(1, 2);
  assert.equal(handler.enforceConsistency(grid4, createAccumulator()), true);
  assert.equal(grid4[0], valueMask(1));
});

await runTest('NFAConstraint should not be affected by earlier calls', () => {
  const nfa = regexToNFA('(12|21)', 2);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  // First call with specific values
  const grid1 = [0, 0];
  grid1[0] = valueMask(1);
  grid1[1] = valueMask(2);
  assert.equal(handler.enforceConsistency(grid1, createAccumulator()), true);

  // Second call with different valid values - should not be affected by first
  const grid2 = [0, 0];
  grid2[0] = valueMask(2);
  grid2[1] = valueMask(1);
  assert.equal(handler.enforceConsistency(grid2, createAccumulator()), true);
});

// =============================================================================
// NFAConstraint memoization
// =============================================================================

// Mulberry32: a small seeded PRNG so failures are reproducible.
const makeRng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomSubset = (rng, mask) => {
  let subset = 0;
  for (let v = mask; v; v &= v - 1) {
    if (rng() < 0.5) subset |= v & -v;
  }
  return subset;
};

// A random nondeterministic automaton over values 1..numValues. Sum-like
// specs give many states (multi-word layers); table specs give irregular
// nondeterminism.
const randomSpec = (rng, numValues, multiSegment) => {
  if (rng() < 0.5) {
    const limit = 20 + Math.floor(rng() * 60);
    const modulus = 2 + Math.floor(rng() * 5);
    return {
      startState: 0,
      transition: (s, v) => {
        if (v === SEGMENT_BREAK) return s % modulus === 0 ? 0 : [];
        return s + v <= limit ? s + v : [];
      },
      accept: (s) => s % modulus === 0,
    };
  }
  const numStates = 3 + Math.floor(rng() * 40);
  const table = [];
  for (let s = 0; s < numStates; s++) {
    const row = [];
    for (let v = 0; v <= numValues; v++) {
      const targets = [];
      const count = Math.floor(rng() * 3);
      for (let k = 0; k < count; k++) targets.push(Math.floor(rng() * numStates));
      row.push(targets);
    }
    table.push(row);
  }
  const accepting = new Set();
  for (let s = 0; s < numStates; s++) if (rng() < 0.4) accepting.add(s);
  return {
    startState: 0,
    transition: (s, v) => table[s][v === SEGMENT_BREAK ? numValues : v - 1],
    accept: (s) => accepting.has(s) || !multiSegment && s === numStates - 1,
  };
};

const recordingAccumulator = () => {
  const calls = [];
  return { calls, addForCell(cell) { calls.push(cell); } };
};

await runTest('NFAConstraint memoized calls match a fresh handler', () => {
  const rng = makeRng(12345);
  const numValues = 6;
  const allValues = (1 << numValues) - 1;
  let callsCompared = 0;
  let successes = 0;

  for (let trial = 0; trial < 150; trial++) {
    const multiSegment = rng() < 0.3;
    const cnfa = compressNFA(javascriptSpecToNFA(
      randomSpec(rng, numValues, multiSegment), numValues, { multiSegment }));

    // Split cells 0..numCells-1 into segments. Some lines revisit a cell.
    const numCells = 2 + Math.floor(rng() * 12);
    const segments = [[0]];
    for (let c = 1; c < numCells; c++) {
      if (multiSegment && rng() < 0.3) segments.push([]);
      segments[segments.length - 1].push(c);
    }
    if (rng() < 0.2) segments[segments.length - 1].push(0);
    const makeHandler = () => {
      const handler = new NFAConstraint(segments, cnfa);
      handler.initialize(null, null, geometry(numValues), null);
      return handler;
    };
    const memoHandler = makeHandler();

    // Simulate a search: narrow cells, re-run, and sometimes jump back to an
    // earlier grid (widening) or an unrelated one.
    const history = [new Array(numCells).fill(allValues)];
    let grid = history[0].slice();
    for (let step = 0; step < 60; step++) {
      const r = rng();
      if (r < 0.15 && history.length) {
        grid = history[Math.floor(rng() * history.length)].slice();
      } else if (r < 0.2) {
        grid = grid.map(() => randomSubset(rng, allValues) || allValues);
      } else if (r < 0.9) {
        // Narrow a few cells, so some calls see several separate changes.
        const numNarrowed = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < numNarrowed; k++) {
          const cell = Math.floor(rng() * numCells);
          grid[cell] = randomSubset(rng, grid[cell]) || grid[cell];
        }
      }
      // Otherwise re-run on an identical grid.

      const expectedGrid = grid.slice();
      const expectedAcc = recordingAccumulator();
      const expected = makeHandler().enforceConsistency(expectedGrid, expectedAcc);

      const actualAcc = recordingAccumulator();
      const actual = memoHandler.enforceConsistency(grid, actualAcc);

      const context = `trial ${trial}, step ${step}`;
      assert.equal(actual, expected, context);
      assert.deepEqual(actualAcc.calls, expectedAcc.calls, context);
      if (expected) {
        assert.deepEqual(grid, expectedGrid, context);
        history.push(grid.slice());
        successes++;
      } else {
        grid = history[Math.floor(rng() * history.length)].slice();
      }
      callsCompared++;
    }
  }
  // Guard against a generator that only produces failing grids.
  assert.ok(successes > callsCompared / 4,
    `only ${successes} of ${callsCompared} calls succeeded`);
});

await runTest('NFAConstraint recomputes after a cell regains values', () => {
  // `(12|34)`: fixing cell 1 to 2 forces cell 0 to 1. Widening cell 1 again
  // must restore cell 0's support for 3, even though the memo says otherwise.
  const cnfa = compressNFA(regexToNFA('(12|34)', 4));
  const handler = new NFAConstraint([[0, 1]], cnfa);
  const allValues = valueMask(1, 2, 3, 4);

  const grid1 = [allValues, valueMask(2)];
  assert.equal(handler.enforceConsistency(grid1, createAccumulator()), true);
  assert.deepEqual(grid1, [valueMask(1), valueMask(2)]);

  const grid2 = [allValues, valueMask(2, 4)];
  assert.equal(handler.enforceConsistency(grid2, createAccumulator()), true);
  assert.deepEqual(grid2, [valueMask(1, 3), valueMask(2, 4)]);
});

// =============================================================================
// NFAConstraint initialize symbol check
// =============================================================================

await runTest('initialize accepts a single-segment NFA over a subset of digits', () => {
  // `[1-5]*` only references symbols 1-5, so numSymbols (5) is below numValues
  // (9). The unused digits just get pruned, so this must not throw.
  const cnfa = compressNFA(regexToNFA('[1-5]*', 9));
  assert.equal(cnfa.numSymbols, 5);
  const handler = new NFAConstraint([[0]], cnfa);

  assert.equal(handler.initialize(null, null, geometry(9), null), true);
});

await runTest('initialize accepts a single-segment NFA regardless of symbol count', () => {
  const cnfa = compressNFA(regexToNFA('12', 9));
  const handler = new NFAConstraint([[0, 1]], cnfa);

  assert.equal(handler.initialize(null, null, geometry(9), null), true);
});

await runTest('initialize rejects a multi-segment NFA lacking the segment-break symbol', () => {
  // A plain regex has no segment-break symbol, so numSymbols (2) < numValues + 1.
  // Assembling it across two segments must be rejected.
  const cnfa = compressNFA(regexToNFA('12', 9));
  const handler = new NFAConstraint([[0], [1]], cnfa);

  assert.throws(
    () => handler.initialize(null, null, geometry(9), null),
    /multiSegment/);
});

await runTest('initialize accepts a correctly compiled multi-segment NFA', () => {
  const spec = {
    startState: 0,
    transition: (s, v) => (v === SEGMENT_BREAK ? 0 : (v > s ? v : [])),
    accept: () => true,
  };
  // multiSegment adds the segment-break symbol at index numValues, so
  // numSymbols == numValues + 1.
  const cnfa = compressNFA(javascriptSpecToNFA(spec, 4, { multiSegment: true }));
  assert.equal(cnfa.numSymbols, 5);
  const handler = new NFAConstraint([[0], [1]], cnfa);

  assert.equal(handler.initialize(null, null, geometry(4), null), true);
});

// =============================================================================
// NFAConstraint getNFA
// =============================================================================

await runTest('NFAConstraint getNFA should return the compressed NFA', () => {
  const nfa = regexToNFA('12', 4);
  const cnfa = compressNFA(nfa);
  const handler = new NFAConstraint([[0, 1]], cnfa);

  assert.strictEqual(handler.getNFA(), cnfa);
});

logSuiteComplete('NFA handler');
