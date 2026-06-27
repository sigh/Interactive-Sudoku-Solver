import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);

// ---------------------------------------------------------------------------
// Data model: the instance holds segments as arrays; serialization delimits
// them with '-'.
// ---------------------------------------------------------------------------

await runTest('EqualSum stores segments as arrays and flattens getCells', () => {
  const c = new SudokuConstraint.EqualSum(['R1C1', 'R2C2'], ['R3C3', 'R4C4']);
  assert.deepEqual(c.segments, [['R1C1', 'R2C2'], ['R3C3', 'R4C4']]);
  // getCells flattens (used for display / shifting / uniqueness).
  assert.deepEqual(c.getCells(), ['R1C1', 'R2C2', 'R3C3', 'R4C4']);
});

await runTest('EqualSum serialize round-trips through the parser', () => {
  const original = new SudokuConstraint.EqualSum(
    ['R1C1', 'R2C2'], ['R3C3', 'R4C4'], ['R1C4']);
  const str = original.toString();
  assert.equal(str, '.EqualSum~R1C1~R2C2~-~R3C3~R4C4~-~R1C4');

  // Parse it back and confirm the segments survive.
  const parsed = SudokuParser.parseText(str);
  let found = null;
  parsed.forEachTopLevel(c => { if (c.type === 'EqualSum') found = c; });
  assert.ok(found, 'parsed an EqualSum constraint');
  assert.deepEqual(found.segments,
    [['R1C1', 'R2C2'], ['R3C3', 'R4C4'], ['R1C4']]);
});

await runTest('EqualSum.makeShifted shifts every segment', () => {
  const c = new SudokuConstraint.EqualSum(['R1C1'], ['R1C2', 'R1C3']);
  const shifted = c.makeShifted(id => id.replace('R1', 'R2'));
  assert.deepEqual(shifted.segments, [['R2C1'], ['R2C2', 'R2C3']]);
});

// ---------------------------------------------------------------------------
// Solver: every segment must have the same sum.
// ---------------------------------------------------------------------------

await runTest('EqualSum makes two same-row single cells unsatisfiable', () => {
  // R1C1 and R1C2 share a row, so they must differ; equal single-cell sums
  // are therefore impossible.
  const solver = new SimpleSolver();
  const solution = solver.solution('.Shape~4x4.EqualSum~R1C1~-~R1C2');
  assert.equal(solution, null, 'should have no solution');
});

await runTest('EqualSum is enforced in found solutions', () => {
  // Two segments in distinct rows/cols/boxes so equality is achievable.
  const solver = new SimpleSolver();
  const input = '.Shape~4x4.EqualSum~R1C1~R2C2~-~R3C3~R4C4';
  const solution = solver.solution(input);
  assert.ok(solution, 'should find a solution');
  const sumA = solution.valueAt('R1C1') + solution.valueAt('R2C2');
  const sumB = solution.valueAt('R3C3') + solution.valueAt('R4C4');
  assert.equal(sumA, sumB, 'the two segments must have equal sums');
});

await runTest('EqualSum across three segments keeps all sums equal', () => {
  // Brute-force check against the TRUE constraint over several solutions.
  // Three single cells in distinct rows, cols and boxes, so equality is
  // achievable (in 4x4 boxes are 2x2).
  const solver = new SimpleSolver();
  const input = '.Shape~4x4.EqualSum~R1C1~-~R2C3~-~R3C2';
  let count = 0;
  for (const solution of solver.solutions(input, 20)) {
    const a = solution.valueAt('R1C1');
    const b = solution.valueAt('R2C3');
    const c = solution.valueAt('R3C2');
    assert.ok(a === b && b === c,
      `segments must be equal, got ${a}, ${b}, ${c}`);
    count++;
  }
  assert.ok(count > 0, 'should produce at least one solution');
});

logSuiteComplete();
