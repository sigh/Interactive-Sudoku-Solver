import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { LookupTables } = await import('../../js/solver/lookup_tables.js');
const { fnToBinaryKey } = await import('../../js/sudoku_constraint.js');

// Helper to create a binary key from a predicate function.
const binaryKey = (fn, numValues) =>
  fnToBinaryKey(fn, numValues);

// =============================================================================
// Static utility methods
// =============================================================================

await runTest('fromValue should convert 1-indexed value to bitmask', () => {
  assert.equal(LookupTables.fromValue(1), 0b0001);
  assert.equal(LookupTables.fromValue(2), 0b0010);
  assert.equal(LookupTables.fromValue(3), 0b0100);
  assert.equal(LookupTables.fromValue(4), 0b1000);
  assert.equal(LookupTables.fromValue(9), 1 << 8);
});

await runTest('fromIndex should convert 0-indexed value to bitmask', () => {
  assert.equal(LookupTables.fromIndex(0), 0b0001);
  assert.equal(LookupTables.fromIndex(1), 0b0010);
  assert.equal(LookupTables.fromIndex(2), 0b0100);
  assert.equal(LookupTables.fromIndex(3), 0b1000);
});

await runTest('fromValuesArray should combine multiple values', () => {
  assert.equal(LookupTables.fromValuesArray([1, 2]), 0b0011);
  assert.equal(LookupTables.fromValuesArray([1, 3]), 0b0101);
  assert.equal(LookupTables.fromValuesArray([1, 2, 3, 4]), 0b1111);
  assert.equal(LookupTables.fromValuesArray([]), 0);
});

await runTest('toValue should convert single-bit mask to 1-indexed value', () => {
  assert.equal(LookupTables.toValue(0b0001), 1);
  assert.equal(LookupTables.toValue(0b0010), 2);
  assert.equal(LookupTables.toValue(0b0100), 3);
  assert.equal(LookupTables.toValue(0b1000), 4);
});

await runTest('maxValue should return highest value in mask', () => {
  assert.equal(LookupTables.maxValue(0b0001), 1);
  assert.equal(LookupTables.maxValue(0b0011), 2);
  assert.equal(LookupTables.maxValue(0b0101), 3);
  assert.equal(LookupTables.maxValue(0b1111), 4);
  assert.equal(LookupTables.maxValue(0b1000), 4);
});

await runTest('minValue should return lowest value in mask', () => {
  assert.equal(LookupTables.minValue(0b0001), 1);
  assert.equal(LookupTables.minValue(0b0011), 1);
  assert.equal(LookupTables.minValue(0b0110), 2);
  assert.equal(LookupTables.minValue(0b1100), 3);
  assert.equal(LookupTables.minValue(0b1000), 4);
});

await runTest('toIndex should convert single-bit mask to 0-indexed position', () => {
  assert.equal(LookupTables.toIndex(0b0001), 0);
  assert.equal(LookupTables.toIndex(0b0010), 1);
  assert.equal(LookupTables.toIndex(0b0100), 2);
  assert.equal(LookupTables.toIndex(0b1000), 3);
});

await runTest('toValuesArray should convert mask to array of values', () => {
  assert.deepEqual(LookupTables.toValuesArray(0b0001), [1]);
  assert.deepEqual(LookupTables.toValuesArray(0b0011), [1, 2]);
  assert.deepEqual(LookupTables.toValuesArray(0b0101), [1, 3]);
  assert.deepEqual(LookupTables.toValuesArray(0b1111), [1, 2, 3, 4]);
  assert.deepEqual(LookupTables.toValuesArray(0), []);
});

await runTest('valueRangeInclusive should return mask of values between min and max', () => {
  // For mask 0b0101 (values 1 and 3), range inclusive is 1,2,3 = 0b0111
  assert.equal(LookupTables.valueRangeInclusive(0b0101), 0b0111);
  // For mask 0b1001 (values 1 and 4), range inclusive is 1,2,3,4 = 0b1111
  assert.equal(LookupTables.valueRangeInclusive(0b1001), 0b1111);
  // For mask 0b0110 (values 2 and 3), range inclusive is 2,3 = 0b0110
  assert.equal(LookupTables.valueRangeInclusive(0b0110), 0b0110);
});

await runTest('valueRangeExclusive should return mask of values strictly between min and max', () => {
  // For mask 0b0101 (values 1 and 3), range exclusive is just 2 = 0b0010
  assert.equal(LookupTables.valueRangeExclusive(0b0101), 0b0010);
  // For mask 0b1001 (values 1 and 4), range exclusive is 2,3 = 0b0110
  assert.equal(LookupTables.valueRangeExclusive(0b1001), 0b0110);
  // For mask 0b0110 (values 2 and 3), range exclusive is empty = 0
  assert.equal(LookupTables.valueRangeExclusive(0b0110), 0);
});

// =============================================================================
// Instance properties
// =============================================================================

await runTest('allValues should be mask with all bits set', () => {
  const tables4 = LookupTables.get(4);
  assert.equal(tables4.allValues, 0b1111);

  const tables9 = LookupTables.get(9);
  assert.equal(tables9.allValues, 0b111111111);
});

await runTest('combinations should be 2^numValues', () => {
  const tables4 = LookupTables.get(4);
  assert.equal(tables4.combinations, 16);

  const tables9 = LookupTables.get(9);
  assert.equal(tables9.combinations, 512);
});

// =============================================================================
// sum table
// =============================================================================

await runTest('sum table should return sum of values in mask', () => {
  const tables = LookupTables.get(4);

  assert.equal(tables.sum[0b0000], 0);
  assert.equal(tables.sum[0b0001], 1);
  assert.equal(tables.sum[0b0010], 2);
  assert.equal(tables.sum[0b0011], 3);  // 1 + 2
  assert.equal(tables.sum[0b0101], 4);  // 1 + 3
  assert.equal(tables.sum[0b1111], 10); // 1 + 2 + 3 + 4
});

await runTest('sum table should work for 9 values', () => {
  const tables = LookupTables.get(9);

  assert.equal(tables.sum[0b111111111], 45); // 1+2+...+9
  assert.equal(tables.sum[0b100000001], 10); // 1 + 9
});

// =============================================================================
// reverse table
// =============================================================================

await runTest('reverse table should flip value positions', () => {
  const tables = LookupTables.get(4);

  // Single values: 1 <-> 4, 2 <-> 3
  assert.equal(tables.reverse[0b0001], 0b1000); // 1 -> 4
  assert.equal(tables.reverse[0b1000], 0b0001); // 4 -> 1
  assert.equal(tables.reverse[0b0010], 0b0100); // 2 -> 3
  assert.equal(tables.reverse[0b0100], 0b0010); // 3 -> 2

  // Multiple values
  assert.equal(tables.reverse[0b0011], 0b1100); // {1,2} -> {3,4}
  assert.equal(tables.reverse[0b1111], 0b1111); // all -> all
});

await runTest('reverse table should be its own inverse', () => {
  const tables = LookupTables.get(4);

  for (let i = 1; i < tables.combinations; i++) {
    assert.equal(tables.reverse[tables.reverse[i]], i,
      `reverse should be involutory for mask ${i}`);
  }
});

// =============================================================================
// rangeInfo table
// =============================================================================

await runTest('rangeInfo should encode min, max, fixed, and isFixed', () => {
  const tables = LookupTables.get(4);

  // Helper to extract components
  const getMax = (info) => info & 0xFF;
  const getMin = (info) => (info >> 8) & 0xFF;
  const getFixed = (info) => (info >> 16) & 0xFF;
  const getIsFixed = (info) => (info >> 24) & 0xF;

  // Single value (fixed)
  const info1 = tables.rangeInfo[0b0001];
  assert.equal(getMin(info1), 1);
  assert.equal(getMax(info1), 1);
  assert.equal(getFixed(info1), 1);
  assert.equal(getIsFixed(info1), 1);

  // Two values (not fixed)
  const info12 = tables.rangeInfo[0b0011];
  assert.equal(getMin(info12), 1);
  assert.equal(getMax(info12), 2);
  assert.equal(getFixed(info12), 0);
  assert.equal(getIsFixed(info12), 0);

  // Non-contiguous values
  const info13 = tables.rangeInfo[0b0101];
  assert.equal(getMin(info13), 1);
  assert.equal(getMax(info13), 3);
  assert.equal(getFixed(info13), 0);
  assert.equal(getIsFixed(info13), 0);
});

await runTest('rangeInfo for empty mask should indicate invalid', () => {
  const tables = LookupTables.get(4);

  // isFixed field should be set high to indicate invalid after summing
  const info0 = tables.rangeInfo[0];
  const isFixed = (info0 >> 24) & 0xFF;
  assert.equal(isFixed, 4, 'empty mask should have high isFixed to detect invalid');
});

// =============================================================================
// forBinaryKey - basic structure
// =============================================================================

await runTest('forBinaryKey should return two tables', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a < b, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  assert.ok(table instanceof Uint16Array);
  assert.ok(tableInv instanceof Uint16Array);
  assert.equal(table.length, 16);  // 2^4 combinations
  assert.equal(tableInv.length, 16);
});

await runTest('forBinaryKey tables should have zero for empty mask', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a < b, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  assert.equal(table[0], 0);
  assert.equal(tableInv[0], 0);
});

// =============================================================================
// forBinaryKey - "not equal" (a !== b)
// =============================================================================

await runTest('forBinaryKey not-equal: single value maps to all other values', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a !== b, 4);
  const [table] = tables.forBinaryKey(key);

  // If cell0 = {1}, valid values for cell1 are {2,3,4}
  assert.equal(table[0b0001], 0b1110);
  assert.equal(table[0b0010], 0b1101);
  assert.equal(table[0b0100], 0b1011);
  assert.equal(table[0b1000], 0b0111);
});

await runTest('forBinaryKey not-equal: multiple values map to union', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a !== b, 4);
  const [table] = tables.forBinaryKey(key);

  // If cell0 = {1,2}, valid values for cell1 are {2,3,4} | {1,3,4} = {1,2,3,4}
  assert.equal(table[0b0011], 0b1111);
});

await runTest('forBinaryKey not-equal: should be symmetric', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a !== b, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  // For symmetric constraints, table and tableInv should be equal
  for (let i = 0; i < 16; i++) {
    assert.equal(table[i], tableInv[i], `tables should match at index ${i}`);
  }
});

// =============================================================================
// forBinaryKey - "less than" (a < b)
// =============================================================================

await runTest('forBinaryKey less-than: forward table gives valid second values', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a < b, 4);
  const [table] = tables.forBinaryKey(key);

  // table[cell0 values] = valid cell1 values (values greater than cell0)
  assert.equal(table[0b0001], 0b1110); // 1 < {2,3,4}
  assert.equal(table[0b0010], 0b1100); // 2 < {3,4}
  assert.equal(table[0b0100], 0b1000); // 3 < {4}
  assert.equal(table[0b1000], 0b0000); // 4 < nothing
});

await runTest('forBinaryKey less-than: inverse table gives valid first values', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a < b, 4);
  const [, tableInv] = tables.forBinaryKey(key);

  // tableInv[cell1 values] = valid cell0 values (values less than cell1)
  assert.equal(tableInv[0b0001], 0b0000); // nothing < 1
  assert.equal(tableInv[0b0010], 0b0001); // {1} < 2
  assert.equal(tableInv[0b0100], 0b0011); // {1,2} < 3
  assert.equal(tableInv[0b1000], 0b0111); // {1,2,3} < 4
});

await runTest('forBinaryKey less-than: multiple values combine correctly', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a < b, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  // If cell0 = {1,2}, valid cell1 values are {2,3,4} | {3,4} = {2,3,4}
  assert.equal(table[0b0011], 0b1110);

  // If cell1 = {3,4}, valid cell0 values are {1,2} | {1,2,3} = {1,2,3}
  assert.equal(tableInv[0b1100], 0b0111);
});

// =============================================================================
// forBinaryKey - "equals" (a === b)
// =============================================================================

await runTest('forBinaryKey equals: single value maps to itself', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a === b, 4);
  const [table] = tables.forBinaryKey(key);

  assert.equal(table[0b0001], 0b0001);
  assert.equal(table[0b0010], 0b0010);
  assert.equal(table[0b0100], 0b0100);
  assert.equal(table[0b1000], 0b1000);
});

await runTest('forBinaryKey equals: multiple values map to same set', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a === b, 4);
  const [table] = tables.forBinaryKey(key);

  // If cell0 = {1,2}, valid cell1 values are {1} | {2} = {1,2}
  assert.equal(table[0b0011], 0b0011);
  assert.equal(table[0b1111], 0b1111);
});

// =============================================================================
// forBinaryKey - difference constraint (|a - b| >= 2)
// =============================================================================

await runTest('forBinaryKey difference>=2: should exclude adjacent values', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => Math.abs(a - b) >= 2, 4);
  const [table] = tables.forBinaryKey(key);

  // 1 is at least 2 away from {3,4}
  assert.equal(table[0b0001], 0b1100);
  // 2 is at least 2 away from {4} only
  assert.equal(table[0b0010], 0b1000);
  // 3 is at least 2 away from {1} only
  assert.equal(table[0b0100], 0b0001);
  // 4 is at least 2 away from {1,2}
  assert.equal(table[0b1000], 0b0011);
});

// =============================================================================
// forBinaryKey - asymmetric constraint (a * 2 === b)
// =============================================================================

await runTest('forBinaryKey asymmetric: a*2===b forward table', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a * 2 === b, 4);
  const [table] = tables.forBinaryKey(key);

  // Forward: given cell0, what can cell1 be?
  assert.equal(table[0b0001], 0b0010); // 1*2 = 2
  assert.equal(table[0b0010], 0b1000); // 2*2 = 4
  assert.equal(table[0b0100], 0b0000); // 3*2 = 6, out of range
  assert.equal(table[0b1000], 0b0000); // 4*2 = 8, out of range
});

await runTest('forBinaryKey asymmetric: a*2===b inverse table', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a * 2 === b, 4);
  const [, tableInv] = tables.forBinaryKey(key);

  // Inverse: given cell1, what can cell0 be?
  assert.equal(tableInv[0b0001], 0b0000); // nothing * 2 = 1
  assert.equal(tableInv[0b0010], 0b0001); // 1 * 2 = 2
  assert.equal(tableInv[0b0100], 0b0000); // nothing * 2 = 3
  assert.equal(tableInv[0b1000], 0b0010); // 2 * 2 = 4
});

await runTest('forBinaryKey asymmetric: combined masks work correctly', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a * 2 === b, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  // cell0 = {1,2}: valid cell1 = {2} | {4} = {2,4}
  assert.equal(table[0b0011], 0b1010);

  // cell1 = {2,4}: valid cell0 = {1} | {2} = {1,2}
  assert.equal(tableInv[0b1010], 0b0011);
});

// =============================================================================
// forBinaryKey - edge cases
// =============================================================================

await runTest('forBinaryKey always-true: all values map to all values', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey(() => true, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  for (let i = 1; i < 16; i++) {
    assert.equal(table[i], 0b1111);
    assert.equal(tableInv[i], 0b1111);
  }
});

await runTest('forBinaryKey always-false: all values map to nothing', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey(() => false, 4);
  const [table, tableInv] = tables.forBinaryKey(key);

  for (let i = 0; i < 16; i++) {
    assert.equal(table[i], 0);
    assert.equal(tableInv[i], 0);
  }
});

// =============================================================================
// forBinaryKey - memoization
// =============================================================================

await runTest('forBinaryKey should return same tables for same key', () => {
  const tables = LookupTables.get(4);
  const key = binaryKey((a, b) => a < b, 4);

  const [table1, tableInv1] = tables.forBinaryKey(key);
  const [table2, tableInv2] = tables.forBinaryKey(key);

  assert.strictEqual(table1, table2, 'should return same table instance');
  assert.strictEqual(tableInv1, tableInv2, 'should return same tableInv instance');
});

// =============================================================================
// forBinaryKey - larger grid sizes
// =============================================================================

await runTest('forBinaryKey should work with 9 values', () => {
  const tables = LookupTables.get(9);
  const key = binaryKey((a, b) => a < b, 9);
  const [table, tableInv] = tables.forBinaryKey(key);

  // 1 < {2,3,4,5,6,7,8,9}
  assert.equal(table[0b000000001], 0b111111110);
  // {1,2,3,4,5,6,7,8} < 9
  assert.equal(tableInv[0b100000000], 0b011111111);
});

await runTest('forBinaryKey equals with 9 values', () => {
  const tables = LookupTables.get(9);
  const key = binaryKey((a, b) => a === b, 9);
  const [table, tableInv] = tables.forBinaryKey(key);

  // Each single value maps to itself
  for (let i = 0; i < 9; i++) {
    const mask = 1 << i;
    assert.equal(table[mask], mask);
    assert.equal(tableInv[mask], mask);
  }

  // All values maps to all values
  assert.equal(table[0b111111111], 0b111111111);
});

// =============================================================================
// binaryKeyIsTransitive
// =============================================================================

await runTest('binaryKeyIsTransitive should return true for equals', () => {
  const tables = LookupTables.get(9);
  const key = binaryKey((a, b) => a === b, 9);
  assert.equal(tables.binaryKeyIsTransitive(key), true);
});

await runTest('binaryKeyIsTransitive should return true for less-than', () => {
  const tables = LookupTables.get(9);
  const key = binaryKey((a, b) => a < b, 9);
  assert.equal(tables.binaryKeyIsTransitive(key), true);
});

await runTest('binaryKeyIsTransitive should return false for not-equal', () => {
  const tables = LookupTables.get(9);
  const key = binaryKey((a, b) => a !== b, 9);
  assert.equal(tables.binaryKeyIsTransitive(key), false);
});

await runTest('binaryKeyIsTransitive should return false for difference>=2', () => {
  const tables = LookupTables.get(9);
  const key = binaryKey((a, b) => Math.abs(a - b) >= 2, 9);
  assert.equal(tables.binaryKeyIsTransitive(key), false);
});

await runTest('binaryKeyIsTransitive should return true for always-true and always-false', () => {
  const tables = LookupTables.get(9);
  const keyTrue = binaryKey(() => true, 9);
  const keyFalse = binaryKey(() => false, 9);
  assert.equal(tables.binaryKeyIsTransitive(keyTrue), true);
  assert.equal(tables.binaryKeyIsTransitive(keyFalse), true);
});

// =============================================================================
// LookupTables.get memoization
// =============================================================================

await runTest('LookupTables.get should return same instance for same numValues', () => {
  const tables1 = LookupTables.get(4);
  const tables2 = LookupTables.get(4);

  assert.strictEqual(tables1, tables2);
});

await runTest('LookupTables.get should return different instances for different numValues', () => {
  const tables4 = LookupTables.get(4);
  const tables9 = LookupTables.get(9);

  assert.notStrictEqual(tables4, tables9);
  assert.equal(tables4.allValues, 0b1111);
  assert.equal(tables9.allValues, 0b111111111);
});

logSuiteComplete('Lookup tables');
