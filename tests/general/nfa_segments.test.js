import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { javascriptSpecToNFA, SEGMENT_BREAK } = await import('../../js/nfa_builder.js' + self.VERSION_PARAM);

// Strictly increasing within each segment; reset at the segment boundary.
const incSpec = {
  startState: 0,
  transition: (s, v) => {
    if (v === SEGMENT_BREAK) return 0;   // reset at boundary
    return v > s ? v : [];          // strictly increasing, else reject
  },
  accept: () => true,
};

// ---------------------------------------------------------------------------
// Constraint data model: segments delimited by '-' in the flat cell list.
// ---------------------------------------------------------------------------

await runTest('NFA takes segment arrays; getCells flattens them', () => {
  const c = new SudokuConstraint.NFA('ENC', 'n', ['R1C1', 'R1C2'], ['R1C3', 'R1C4']);
  assert.deepEqual(c.segments, [['R1C1', 'R1C2'], ['R1C3', 'R1C4']]);
  assert.deepEqual(c.getCells(), ['R1C1', 'R1C2', 'R1C3', 'R1C4']);
});

await runTest('NFA backward-compat: a flat cell list is split into segments', () => {
  // Old flat form with separators (e.g. from the parser).
  assert.deepEqual(
    new SudokuConstraint.NFA('ENC', 'n', 'R1C1', 'R1C2', '-', 'R1C3').segments,
    [['R1C1', 'R1C2'], ['R1C3']]);
  // Old flat form with no separator is a single segment.
  assert.deepEqual(
    new SudokuConstraint.NFA('ENC', 'n', 'R1C1', 'R1C2').segments,
    [['R1C1', 'R1C2']]);
});

await runTest('makeShifted maps each cell while preserving segment structure', () => {
  const c = new SudokuConstraint.NFA('ENC', 'n', ['R1C1', 'R1C2'], ['R1C3']);
  const rename = { R1C1: 'R2C1', R1C2: 'R2C2', R1C3: 'R2C3' };
  const shifted = c.makeShifted(cell => rename[cell]);
  // Segments stay separate (not flattened) and the encoding/name carry over.
  assert.deepEqual(shifted.segments, [['R2C1', 'R2C2'], ['R2C3']]);
  assert.equal(shifted.encodedNFA, 'ENC');
  assert.equal(shifted.name, 'n');
});

await runTest('NFA round-trips segments through the parser', () => {
  const original = new SudokuConstraint.NFA('ENC', 'n', ['R1C1', 'R1C2'], ['R1C3']);
  const parsed = SudokuParser.parseText(original.toString());
  let found = null;
  parsed.forEachTopLevel(c => { if (c.type === 'NFA') found = c; });
  assert.ok(found, 'parsed an NFA constraint');
  assert.deepEqual(found.segments, [['R1C1', 'R1C2'], ['R1C3']]);
});

// ---------------------------------------------------------------------------
// Builder: the segment break becomes the symbol just past the real values.
// ---------------------------------------------------------------------------

await runTest('builder emits a segment-break symbol when SEGMENT_BREAK is handled', () => {
  // numSymbols == highest used symbol index + 1; the segment break sits at index
  // numValues, so handling it bumps the count to numValues + 1.
  const nfa = javascriptSpecToNFA(incSpec, 4, { multiSegment: true });
  assert.equal(nfa.numSymbols(), 5);
});

await runTest('builder emits no segment-break symbol when SEGMENT_BREAK is ignored', () => {
  const ignoreSpec = { startState: 0, transition: (s, v) => (v > s ? v : []), accept: () => true };
  const nfa = javascriptSpecToNFA(ignoreSpec, 4, { multiSegment: true });
  assert.equal(nfa.numSymbols(), 4);
});

// ---------------------------------------------------------------------------
// Solver: the segment break resets per segment.
// ---------------------------------------------------------------------------

const encoded = SudokuConstraint.NFA.encodeSpec(incSpec, 4, { multiSegment: true });

await runTest('segmented NFA enforces per-segment increasing, resetting at the boundary', () => {
  const nfaStr = new SudokuConstraint.NFA(
    encoded, 'inc', ['R1C1', 'R1C2'], ['R1C3', 'R1C4']).toString();
  const solver = new SimpleSolver();

  let count = 0;
  let sawCrossSegmentDecrease = false;
  for (const sol of solver.solutions('.Shape~4x4' + nfaStr, 100)) {
    const [a, b, c, d] = ['R1C1', 'R1C2', 'R1C3', 'R1C4'].map(id => sol.valueAt(id));
    assert.ok(a < b, `segment 1 must increase: ${a},${b}`);
    assert.ok(c < d, `segment 2 must increase: ${c},${d}`);
    if (b > c) sawCrossSegmentDecrease = true;  // only possible thanks to the reset
    count++;
  }
  assert.ok(count > 0, 'should have solutions');
  assert.ok(sawCrossSegmentDecrease,
    'the boundary reset should permit a decrease across segments');
});

await runTest('single-segment NFA (no boundary) forces one increasing run', () => {
  // Same automaton over the whole row with no separator: it never resets, so
  // the row must be strictly increasing end to end (1,2,3,4).
  const nfaStr = new SudokuConstraint.NFA(
    encoded, 'inc', 'R1C1', 'R1C2', 'R1C3', 'R1C4').toString();
  const solver = new SimpleSolver();
  for (const sol of solver.solutions('.Shape~4x4' + nfaStr, 100)) {
    const row = ['R1C1', 'R1C2', 'R1C3', 'R1C4'].map(id => sol.valueAt(id));
    assert.deepEqual(row, [1, 2, 3, 4]);
  }
});

await runTest('segment-break NFA on a 16-value grid is rejected at encode time', () => {
  // 16 values + segment break = 17 symbols, past the serializer's 16-symbol ceiling.
  assert.throws(() => SudokuConstraint.NFA.encodeSpec(incSpec, 16, { multiSegment: true }), /symbols/);
});

await runTest('a segmented constraint whose automaton lacks the segment break is rejected', () => {
  // Encoded single-segment (no segment-break symbol), then assembled with two
  // segments: numSymbols == numValues < numValues + 1, so the handler rejects it.
  const noSentinel = SudokuConstraint.NFA.encodeSpec(
    { startState: 0, transition: (s, v) => (v > s ? v : []), accept: () => true },
    4, { multiSegment: false });
  const nfaStr = new SudokuConstraint.NFA(
    noSentinel, 'inc', ['R1C1', 'R1C2'], ['R1C3']).toString();
  const solver = new SimpleSolver();
  assert.throws(() => [...solver.solutions('.Shape~4x4' + nfaStr, 1)], /multiSegment/);
});

await runTest('NFA with no cells produces no segments', () => {
  // The flat/segment sniff must not treat an empty arg list as a flat list.
  assert.deepEqual(new SudokuConstraint.NFA('ENC', 'n').segments, []);
});

logSuiteComplete();
