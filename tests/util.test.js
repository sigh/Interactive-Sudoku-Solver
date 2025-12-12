import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const {
  clamp,
  formatTimeMs,
  formatNumberMetric,
  camelCaseToWords,
  arrayDifference,
  arrayIntersect,
  arrayIntersectSize,
  arrayRemoveValue,
  arraysAreEqual,
  elementarySymmetricSum,
  setIntersectionToArray,
  setIntersectSize,
  setDifference,
  setPeek,
  countOnes16bit,
  requiredBits,
  memoize,
  isIterable,
  isPlainObject,
  shuffleArray,
  BitWriter,
  BitReader,
  groupSortedBy,
  Base64Codec,
  BitSet,
  MultiMap,
  RandomIntGenerator,
  canonicalJSON,
} = await import('../js/util.js');

// ============================================================================
// clamp
// ============================================================================

await runTest('clamp should return value when within range', () => {
  assert.equal(clamp(5, 0, 10), 5);
});

await runTest('clamp should return min when value is below range', () => {
  assert.equal(clamp(-5, 0, 10), 0);
});

await runTest('clamp should return max when value is above range', () => {
  assert.equal(clamp(15, 0, 10), 10);
});

// ============================================================================
// formatTimeMs
// ============================================================================

await runTest('formatTimeMs should format milliseconds', () => {
  assert.equal(formatTimeMs(500), '500 ms');
});

await runTest('formatTimeMs should format seconds', () => {
  assert.equal(formatTimeMs(2500), '2.50 s');
});

await runTest('formatTimeMs should format minutes', () => {
  assert.equal(formatTimeMs(125000), '2 min 5 s');
});

// ============================================================================
// formatNumberMetric
// ============================================================================

await runTest('formatNumberMetric should return 0 for zero', () => {
  assert.equal(formatNumberMetric(0), 0);
});

await runTest('formatNumberMetric should format thousands', () => {
  assert.equal(formatNumberMetric(5000), '5k');
});

await runTest('formatNumberMetric should format millions', () => {
  assert.equal(formatNumberMetric(3000000), '3M');
});

await runTest('formatNumberMetric should format billions', () => {
  assert.equal(formatNumberMetric(2000000000), '2G');
});

await runTest('formatNumberMetric should use exponential for very small values', () => {
  assert.equal(formatNumberMetric(0.00001), '1.0e-5');
});

// ============================================================================
// camelCaseToWords
// ============================================================================

await runTest('camelCaseToWords should convert camelCase to words', () => {
  assert.equal(camelCaseToWords('helloWorld'), 'Hello world');
});

await runTest('camelCaseToWords should handle multiple words', () => {
  assert.equal(camelCaseToWords('thisIsATest'), 'This is a test');
});

// ============================================================================
// Array utilities
// ============================================================================

await runTest('arrayDifference should return elements in a but not in b', () => {
  assert.deepEqual(arrayDifference([1, 2, 3, 4], [2, 4]), [1, 3]);
});

await runTest('arrayIntersect should return common elements', () => {
  assert.deepEqual(arrayIntersect([1, 2, 3], [2, 3, 4]), [2, 3]);
});

await runTest('arrayIntersectSize should return count of common elements', () => {
  assert.equal(arrayIntersectSize([1, 2, 3], [2, 3, 4]), 2);
});

await runTest('arrayRemoveValue should remove value from array', () => {
  const arr = [1, 2, 3, 4];
  arrayRemoveValue(arr, 2);
  assert.deepEqual(arr, [1, 3, 4]);
});

await runTest('arrayRemoveValue should not modify array if value not found', () => {
  const arr = [1, 2, 3];
  arrayRemoveValue(arr, 5);
  assert.deepEqual(arr, [1, 2, 3]);
});

await runTest('arraysAreEqual should return true for equal arrays', () => {
  assert.equal(arraysAreEqual([1, 2, 3], [1, 2, 3]), true);
});

await runTest('arraysAreEqual should return false for different arrays', () => {
  assert.equal(arraysAreEqual([1, 2, 3], [1, 2, 4]), false);
});

await runTest('arraysAreEqual should return false for different lengths', () => {
  assert.equal(arraysAreEqual([1, 2], [1, 2, 3]), false);
});

// ============================================================================
// elementarySymmetricSum
// ============================================================================

await runTest('elementarySymmetricSum should return correct sum for small inputs', () => {
  // e_1(2, 2) = 2 + 2 = 4
  assert.equal(elementarySymmetricSum([2, 2], 1), 4);
  // e_2(2, 2) = 2 * 2 = 4
  assert.equal(elementarySymmetricSum([2, 2], 2), 4);
});

await runTest('elementarySymmetricSum should return 0 if k > n', () => {
  assert.equal(elementarySymmetricSum([1, 2], 3), 0);
});

await runTest('elementarySymmetricSum should return 1 for k=0', () => {
  assert.equal(elementarySymmetricSum([1, 2, 3], 0), 1);
});

// ============================================================================
// Set utilities
// ============================================================================

await runTest('setIntersectionToArray should return intersection as array', () => {
  const a = new Set([1, 2, 3]);
  const b = [2, 3, 4];
  assert.deepEqual(setIntersectionToArray(a, b), [2, 3]);
});

await runTest('setIntersectSize should return count of common elements', () => {
  const a = new Set([1, 2, 3]);
  const b = [2, 3, 4];
  assert.equal(setIntersectSize(a, b), 2);
});

await runTest('setDifference should return elements in a but not in b', () => {
  const a = new Set([1, 2, 3]);
  const b = [2, 3];
  const result = setDifference(a, b);
  assert.deepEqual([...result], [1]);
});

await runTest('setPeek should return first element of set', () => {
  const s = new Set([5, 6, 7]);
  assert.equal(setPeek(s), 5);
});

await runTest('setPeek should return null for empty set', () => {
  assert.equal(setPeek(new Set()), null);
});

// ============================================================================
// Bit operations
// ============================================================================

await runTest('countOnes16bit should count set bits', () => {
  assert.equal(countOnes16bit(0b1010101010101010), 8);
  assert.equal(countOnes16bit(0b1111111111111111), 16);
  assert.equal(countOnes16bit(0), 0);
  assert.equal(countOnes16bit(1), 1);
});

await runTest('requiredBits should return number of bits needed', () => {
  assert.equal(requiredBits(0), 0);
  assert.equal(requiredBits(1), 1);
  assert.equal(requiredBits(2), 2);
  assert.equal(requiredBits(7), 3);
  assert.equal(requiredBits(8), 4);
  assert.equal(requiredBits(255), 8);
});

// ============================================================================
// memoize
// ============================================================================

await runTest('memoize should cache single argument results', () => {
  let callCount = 0;
  const fn = memoize((x) => {
    callCount++;
    return x * 2;
  });
  assert.equal(fn(5), 10);
  assert.equal(fn(5), 10);
  assert.equal(callCount, 1);
});

await runTest('memoize should cache multiple argument results', () => {
  let callCount = 0;
  const fn = memoize((a, b) => {
    callCount++;
    return a + b;
  });
  assert.equal(fn(1, 2), 3);
  assert.equal(fn(1, 2), 3);
  assert.equal(callCount, 1);
});

// ============================================================================
// isIterable / isPlainObject
// ============================================================================

await runTest('isIterable should return true for arrays', () => {
  assert.equal(isIterable([1, 2, 3]), true);
});

await runTest('isIterable should return true for strings', () => {
  assert.equal(isIterable('hello'), true);
});

await runTest('isIterable should return false for numbers', () => {
  assert.equal(isIterable(42), false);
});

await runTest('isIterable should return falsy for null', () => {
  assert.ok(!isIterable(null));
});

await runTest('isPlainObject should return true for plain objects', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
});

await runTest('isPlainObject should return false for arrays', () => {
  assert.equal(isPlainObject([]), false);
});

await runTest('isPlainObject should return falsy for null', () => {
  assert.ok(!isPlainObject(null));
});

// ============================================================================
// shuffleArray
// ============================================================================

await runTest('shuffleArray should shuffle array in place', () => {
  const rng = new RandomIntGenerator(42);
  const arr = [1, 2, 3, 4, 5];
  const original = [...arr];
  shuffleArray(arr, rng);
  // Should have same elements
  assert.deepEqual(arr.sort(), original.sort());
});

// ============================================================================
// BitWriter / BitReader
// ============================================================================

await runTest('BitWriter/BitReader should round-trip bits correctly', () => {
  const writer = new BitWriter();
  writer.writeBits(5, 3);   // 101
  writer.writeBits(10, 4);  // 1010
  writer.writeBits(1, 1);   // 1

  const bytes = writer.toUint8Array();
  const reader = new BitReader(bytes);

  assert.equal(reader.readBits(3), 5);
  assert.equal(reader.readBits(4), 10);
  assert.equal(reader.readBits(1), 1);
});

await runTest('BitWriter should handle zero bits', () => {
  const writer = new BitWriter();
  writer.writeBits(0, 0);
  const bytes = writer.toUint8Array();
  assert.equal(bytes.length, 0);
});

await runTest('BitReader should report remaining bits', () => {
  const writer = new BitWriter();
  writer.writeBits(0xFF, 8);
  const reader = new BitReader(writer.toUint8Array());
  assert.equal(reader.remainingBits(), 8);
  reader.readBits(3);
  assert.equal(reader.remainingBits(), 5);
});

await runTest('BitReader should throw on reading past end', () => {
  const writer = new BitWriter();
  writer.writeBits(1, 1);
  const reader = new BitReader(writer.toUint8Array());
  reader.readBits(8);
  assert.throws(() => reader.readBits(1), /Unexpected end/);
});

// ============================================================================
// groupSortedBy
// ============================================================================

await runTest('groupSortedBy should group consecutive items by key', () => {
  const items = [1, 1, 2, 2, 2, 3];
  const groups = [...groupSortedBy(items, x => x)];
  assert.deepEqual(groups, [[1, 1], [2, 2, 2], [3]]);
});

await runTest('groupSortedBy should handle empty iterable', () => {
  const groups = [...groupSortedBy([], x => x)];
  assert.deepEqual(groups, []);
});

await runTest('groupSortedBy should group objects by property', () => {
  const items = [{ type: 'a' }, { type: 'a' }, { type: 'b' }];
  const groups = [...groupSortedBy(items, x => x.type)];
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[1].length, 1);
});

// ============================================================================
// Base64Codec
// ============================================================================

await runTest('Base64Codec should encode and decode strings', () => {
  const original = 'Hello, World!';
  const encoded = Base64Codec.encodeString(original);
  const decoded = Base64Codec.decodeToString(encoded);
  assert.equal(decoded, original);
});

await runTest('Base64Codec should encode and decode 6-bit arrays', () => {
  const original = [0, 1, 62, 63, 32];
  const encoded = Base64Codec.encode6BitArray(original);
  const decoded = Base64Codec.decodeTo6BitArray(encoded);
  assert.deepEqual([...decoded], original);
});

await runTest('Base64Codec should calculate correct length for 6-bit arrays', () => {
  assert.equal(Base64Codec.lengthOf6BitArray(6), 1);
  assert.equal(Base64Codec.lengthOf6BitArray(12), 2);
  assert.equal(Base64Codec.lengthOf6BitArray(7), 2);
});

// ============================================================================
// BitSet
// ============================================================================

await runTest('BitSet should add and check bits', () => {
  const bs = new BitSet(64);
  bs.add(5);
  bs.add(63);
  assert.equal(bs.has(5), true);
  assert.equal(bs.has(63), true);
  assert.equal(bs.has(6), false);
});

await runTest('BitSet should remove bits', () => {
  const bs = new BitSet(64);
  bs.add(10);
  assert.equal(bs.has(10), true);
  bs.remove(10);
  assert.equal(bs.has(10), false);
});

await runTest('BitSet should clear all bits', () => {
  const bs = new BitSet(64);
  bs.add(1);
  bs.add(50);
  bs.clear();
  assert.equal(bs.isEmpty(), true);
});

await runTest('BitSet should intersect with another set', () => {
  const a = new BitSet(64);
  a.add(1);
  a.add(2);
  a.add(3);

  const b = new BitSet(64);
  b.add(2);
  b.add(3);
  b.add(4);

  a.intersect(b);
  assert.equal(a.has(1), false);
  assert.equal(a.has(2), true);
  assert.equal(a.has(3), true);
  assert.equal(a.has(4), false);
});

await runTest('BitSet should union with another set', () => {
  const a = new BitSet(64);
  a.add(1);
  a.add(2);

  const b = new BitSet(64);
  b.add(2);
  b.add(3);

  a.union(b);
  assert.equal(a.has(1), true);
  assert.equal(a.has(2), true);
  assert.equal(a.has(3), true);
  assert.equal(a.has(4), false);
});

await runTest('BitSet should copy from another set', () => {
  const a = new BitSet(64);
  a.add(5);
  a.add(10);

  const b = new BitSet(64);
  b.copyFrom(a);

  assert.equal(b.has(5), true);
  assert.equal(b.has(10), true);
});

await runTest('BitSet.allocatePool should create pool of sets', () => {
  const { bitsets } = BitSet.allocatePool(32, 3);
  assert.equal(bitsets.length, 3);

  bitsets[0].add(5);
  assert.equal(bitsets[0].has(5), true);
  assert.equal(bitsets[1].has(5), false);
});

// ============================================================================
// MultiMap
// ============================================================================

await runTest('MultiMap should add and get values', () => {
  const mm = new MultiMap();
  mm.add('key', 'value1');
  mm.add('key', 'value2');
  assert.deepEqual(mm.get('key'), ['value1', 'value2']);
});

await runTest('MultiMap should return empty array for missing key', () => {
  const mm = new MultiMap();
  assert.deepEqual(mm.get('missing'), []);
});

await runTest('MultiMap should delete specific values', () => {
  const mm = new MultiMap();
  mm.add('key', 'a');
  mm.add('key', 'b');
  mm.delete('key', 'a');
  assert.deepEqual(mm.get('key'), ['b']);
});

await runTest('MultiMap should clear all entries', () => {
  const mm = new MultiMap();
  mm.add('key1', 'value1');
  mm.add('key2', 'value2');
  mm.clear();
  assert.deepEqual(mm.get('key1'), []);
  assert.deepEqual(mm.get('key2'), []);
});

await runTest('MultiMap should be iterable', () => {
  const mm = new MultiMap();
  mm.add('a', 1);
  mm.add('b', 2);
  const entries = [...mm];
  assert.equal(entries.length, 2);
});

// ============================================================================
// RandomIntGenerator
// ============================================================================

await runTest('RandomIntGenerator should produce deterministic results with same seed', () => {
  const rng1 = new RandomIntGenerator(123);
  const rng2 = new RandomIntGenerator(123);

  const values1 = [rng1.randomInt(100), rng1.randomInt(100), rng1.randomInt(100)];
  const values2 = [rng2.randomInt(100), rng2.randomInt(100), rng2.randomInt(100)];

  assert.deepEqual(values1, values2);
});

await runTest('RandomIntGenerator should produce values in range', () => {
  const rng = new RandomIntGenerator(42);
  for (let i = 0; i < 100; i++) {
    const value = rng.randomInt(10);
    assert.ok(value >= 0 && value <= 10, `Value ${value} out of range`);
  }
});

// ============================================================================
// canonicalJSON
// ============================================================================

await runTest('canonicalJSON should sort object keys alphabetically', () => {
  const obj = { z: 1, a: 2, m: 3 };
  assert.equal(canonicalJSON(obj), '{"a":2,"m":3,"z":1}');
});

await runTest('canonicalJSON should produce same output regardless of key insertion order', () => {
  const obj1 = { b: 1, a: 2 };
  const obj2 = { a: 2, b: 1 };
  assert.equal(canonicalJSON(obj1), canonicalJSON(obj2));
});

await runTest('canonicalJSON should handle nested objects', () => {
  const obj = { z: { b: 1, a: 2 }, a: 3 };
  assert.equal(canonicalJSON(obj), '{"a":3,"z":{"a":2,"b":1}}');
});

await runTest('canonicalJSON should preserve array order', () => {
  const obj = { arr: [3, 1, 2] };
  assert.equal(canonicalJSON(obj), '{"arr":[3,1,2]}');
});

await runTest('canonicalJSON should handle arrays of objects', () => {
  const obj = { items: [{ z: 1, a: 2 }, { b: 3 }] };
  assert.equal(canonicalJSON(obj), '{"items":[{"a":2,"z":1},{"b":3}]}');
});

await runTest('canonicalJSON should handle primitives', () => {
  assert.equal(canonicalJSON(42), '42');
  assert.equal(canonicalJSON('hello'), '"hello"');
  assert.equal(canonicalJSON(null), 'null');
  assert.equal(canonicalJSON(true), 'true');
});

await runTest('canonicalJSON should handle empty objects and arrays', () => {
  assert.equal(canonicalJSON({}), '{}');
  assert.equal(canonicalJSON([]), '[]');
});

logSuiteComplete('util');
