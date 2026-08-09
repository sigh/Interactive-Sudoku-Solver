import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { extractConstraintTypes } = await import('../../js/debug/extract_constraint_types.js');

//////////////////////////////////////////////////////////////////////////////
// Basic extraction
//////////////////////////////////////////////////////////////////////////////

await runTest('extractConstraintTypes should extract unique types', () => {
  const types = extractConstraintTypes('.AntiKnight.Cage~15~R1C1~R1C2.Cage~10~R2C1~R2C2.');

  assert.equal(types.length, 2); // only unique types
  assert.ok(types.includes('AntiKnight'));
  assert.ok(types.includes('Cage'));
});

await runTest('extractConstraintTypes should ignore unknown types', () => {
  const types = extractConstraintTypes('.AntiKnight.FakeConstraint~123.');

  assert.equal(types.length, 1); // only valid types
  assert.ok(types.includes('AntiKnight'));
  assert.ok(!types.includes('FakeConstraint'));
});

await runTest('extractConstraintTypes should handle empty string', () => {
  assert.deepEqual(extractConstraintTypes(''), []);
});

await runTest('extractConstraintTypes should ignore the End composite marker', () => {
  const types = extractConstraintTypes(
    '.Or.Cage~10~R1C1~R1C2.Cage~15~R2C1~R2C2.End');

  assert.ok(types.includes('Or'));
  assert.ok(types.includes('Cage'));
  assert.ok(!types.includes('End'));
});

//////////////////////////////////////////////////////////////////////////////
// Shape
//////////////////////////////////////////////////////////////////////////////

await runTest('extractConstraintTypes omits Shape for the default grid', () => {
  const types = extractConstraintTypes('.Shape~9x9.AntiKnight.');
  assert.deepEqual(types, ['AntiKnight']);
});

await runTest('extractConstraintTypes omits Shape for a bare default Shape', () => {
  // A Shape with no spec means the default geometry (nothing to surface).
  const types = extractConstraintTypes('.Shape.AntiKnight.');
  assert.deepEqual(types, ['AntiKnight']);
});

await runTest('extractConstraintTypes surfaces non-default dimensions', () => {
  const types = extractConstraintTypes('.Shape~6x6.NoBoxes.');
  assert.ok(types.includes('6x6'));
  assert.ok(!types.includes('Shape'));
  assert.ok(types.includes('NoBoxes'));
});

await runTest('extractConstraintTypes surfaces a zero-based value range', () => {
  const types = extractConstraintTypes('.Shape~9x9~0-8.Arrow~R1C1~R1C2.');
  // Default dimensions are omitted; only the value range is surfaced.
  assert.ok(types.includes('0-8'));
  assert.ok(!types.includes('9x9'));
  assert.ok(!types.includes('Shape'));
  assert.ok(types.includes('Arrow'));
});

await runTest('extractConstraintTypes surfaces an extended value range', () => {
  const types = extractConstraintTypes('.Shape~9x9~10.Cage~5~R1C1.');
  assert.ok(types.includes('1-10'));
});

await runTest('extractConstraintTypes surfaces dimensions and range as leading entries', () => {
  // Dimensions then value range, both ahead of the other constraint types.
  const types = extractConstraintTypes('.Shape~6x6~0-5.Var~R1C1.');
  assert.deepEqual(types, ['6x6', '0-5', 'Var']);
});

await runTest('extractConstraintTypes tags a cell-group shape from its group', () => {
  // No main grid: the shape's own dims are 0x0, and the board's are on the
  // named group. 'Raw' because the group has no rows, columns or boxes.
  const types = extractConstraintTypes('.Shape~VG~9.Var~G~Grid~9x9.Arrow~VG1~VG2.');
  assert.ok(types.includes('Raw 9x9'));
  assert.ok(!types.includes('0x0'));
  // 1-9 over 9x9 is the default range, so it is not surfaced -- as for a grid.
  assert.ok(!types.includes('1-9'));
  assert.ok(types.includes('Arrow'));
});

await runTest('extractConstraintTypes surfaces a cell-group shape non-default range', () => {
  const types = extractConstraintTypes('.Shape~VP~0-6.Var~P~Canvas~13x13.');
  assert.deepEqual(types, ['Raw 13x13', '0-6', 'Var']);
});

await runTest('extractConstraintTypes tags a non-square cell-group shape', () => {
  const types = extractConstraintTypes('.Shape~VG~0-9.Var~G~Board~10x8.');
  assert.ok(types.includes('Raw 10x8'));
  assert.ok(types.includes('0-9'));
});

//////////////////////////////////////////////////////////////////////////////
// Named custom constraints (NFA / Pair / ...)
//////////////////////////////////////////////////////////////////////////////

await runTest('extractConstraintTypes surfaces a named Pair', () => {
  const types = extractConstraintTypes('.Pair~961rXv~_non-consecutive~R3C1~R3C2');
  assert.deepEqual(types, ['Pair: non-consecutive']);
});

await runTest('extractConstraintTypes uses the bare type for an empty Pair name', () => {
  const types = extractConstraintTypes('.Pair~BAACAAEAAIAAQ~_~R6C2~R7C3');
  assert.deepEqual(types, ['Pair']);
});

await runTest('extractConstraintTypes URI-decodes an NFA name', () => {
  // %2E -> '.', %20 -> ' '.
  const types = extractConstraintTypes('.NFA~VgGv_wQgxBRhyCf~_Arith%2E%20Seq~R1C1~R1C2');
  assert.deepEqual(types, ['NFA: Arith. Seq']);
});

await runTest('extractConstraintTypes ignores a key that contains or starts with "_"', () => {
  // The key (base64url) may contain or start with '_'; only the tail holds names.
  const withUnderscore = extractConstraintTypes('.PairX~8H_xf8H_xf8H_B~_Nabner~R4C1~R5C1');
  assert.deepEqual(withUnderscore, ['PairX: Nabner']);
  const startsUnderscore = extractConstraintTypes('.BinaryX~_v-7-_v-7-_v-D~_Renban%20-%20single~R6C2~R7C3');
  assert.deepEqual(startsUnderscore, ['BinaryX: Renban - single']);
});

await runTest('extractConstraintTypes handles an unnamed legacy Binary', () => {
  const types = extractConstraintTypes('.Binary~gH8gH8A4BP4BP~~R9C8~R9C9');
  assert.deepEqual(types, ['Binary']);
});

await runTest('extractConstraintTypes distinguishes multiple names of the same type', () => {
  const types = extractConstraintTypes(
    '.Pair~k1~_foo~R1C1~R1C2.Pair~k2~_bar~R2C1~R2C2');
  assert.ok(types.includes('Pair: foo'));
  assert.ok(types.includes('Pair: bar'));
  assert.ok(!types.includes('Pair'));
});

await runTest('extractConstraintTypes puts named entries last', () => {
  // NFA precedes Cage in the string, but named entries still trail.
  const types = extractConstraintTypes('.NFA~k~_foo~R1C1.Cage~5~R1C2');
  assert.deepEqual(types, ['Cage', 'NFA: foo']);
});

logSuiteComplete('extractConstraintTypes');
