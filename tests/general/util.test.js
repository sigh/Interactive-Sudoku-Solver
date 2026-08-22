import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const {
  clamp,
  setSvgAttrs,
  formatTimeMs,
  formatFixedTruncated,
  formatNumberMetric,
  camelCaseToWords,
  arrayDifference,
  arrayIntersect,
  arrayRemoveValue,
  arraysAreEqual,
  mergeSortedArrays,
  sortedArrayCopy,
  insertionSortInts,
  elementarySymmetricSum,
  setIntersectSize,
  setPeek,
  countOnes16bit,
  countOnes32bit,
  requiredBits,
  memoize,
  isIterable,
  shuffleArray,
  BitWriter,
  BitReader,
  groupSortedBy,
  Base64Codec,
  BitSet,
  MultiMap,
  RandomIntGenerator,
  canonicalJSON,
  Timer,
} = await import('../../js/util.js');

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

await runTest('formatTimeMs should format 0 s', () => {
  assert.equal(formatTimeMs(0), '0 s');
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

await runTest('sortedArrayCopy should copy an already-sorted array', () => {
  const input = [1, 4, 9];
  const result = sortedArrayCopy(input);

  assert.deepEqual(result, [1, 4, 9]);
  // A copy, not the input.
  assert.notEqual(result, input);
});

await runTest('sortedArrayCopy should sort an unsorted array', () => {
  const input = [9, 1, 4];
  assert.deepEqual(sortedArrayCopy(input), [1, 4, 9]);
  // The input is left alone.
  assert.deepEqual(input, [9, 1, 4]);
});

await runTest('sortedArrayCopy should sort numerically, not lexicographically', () => {
  assert.deepEqual(sortedArrayCopy([10, 9, 100, 2]), [2, 9, 10, 100]);
});

await runTest('sortedArrayCopy should keep duplicates by default', () => {
  // Sorted-with-duplicates is not a violation when duplicates are allowed.
  assert.deepEqual(sortedArrayCopy([1, 1, 4]), [1, 1, 4]);
  assert.deepEqual(sortedArrayCopy([4, 1, 1]), [1, 1, 4]);
});

await runTest('sortedArrayCopy should remove duplicates when asked', () => {
  assert.deepEqual(sortedArrayCopy([1, 1, 4], true), [1, 4]);
  assert.deepEqual(sortedArrayCopy([4, 1, 4, 1], true), [1, 4]);
  // Already strictly ascending: unchanged.
  assert.deepEqual(sortedArrayCopy([1, 4, 9], true), [1, 4, 9]);
});

await runTest('sortedArrayCopy should accept typed arrays and return a plain Array', () => {
  const result = sortedArrayCopy(new Uint16Array([9, 1, 1, 4]), true);

  assert.ok(Array.isArray(result));
  assert.deepEqual(result, [1, 4, 9]);
});

await runTest('sortedArrayCopy should handle empty and single-element input', () => {
  assert.deepEqual(sortedArrayCopy([]), []);
  assert.deepEqual(sortedArrayCopy([], true), []);
  assert.deepEqual(sortedArrayCopy([7]), [7]);
  assert.deepEqual(sortedArrayCopy([7], true), [7]);
});

await runTest('mergeSortedArrays should merge two sorted arrays', () => {
  assert.deepEqual(
    mergeSortedArrays([1, 3, 5], [2, 4, 6]),
    [1, 2, 3, 4, 5, 6]
  );
});

await runTest('mergeSortedArrays should handle empty first array', () => {
  assert.deepEqual(mergeSortedArrays([], [1, 2, 3]), [1, 2, 3]);
});

await runTest('mergeSortedArrays should handle empty second array', () => {
  assert.deepEqual(mergeSortedArrays([1, 2, 3], []), [1, 2, 3]);
});

await runTest('mergeSortedArrays should handle both arrays empty', () => {
  assert.deepEqual(mergeSortedArrays([], []), []);
});

await runTest('mergeSortedArrays should handle interleaved elements', () => {
  assert.deepEqual(
    mergeSortedArrays([0, 2, 4, 6], [1, 3, 5, 7]),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
});

await runTest('mergeSortedArrays should handle non-overlapping ranges', () => {
  assert.deepEqual(
    mergeSortedArrays([1, 2, 3], [10, 11, 12]),
    [1, 2, 3, 10, 11, 12]
  );
});

await runTest('mergeSortedArrays should handle different length arrays', () => {
  assert.deepEqual(
    mergeSortedArrays([1, 5], [2, 3, 4, 6, 7]),
    [1, 2, 3, 4, 5, 6, 7]
  );
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

await runTest('setIntersectSize should return count of common elements', () => {
  const a = new Set([1, 2, 3]);
  const b = [2, 3, 4];
  assert.equal(setIntersectSize(a, b), 2);
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

await runTest('countOnes32bit should count set bits', () => {
  assert.equal(countOnes32bit(0), 0);
  assert.equal(countOnes32bit(1), 1);
  assert.equal(countOnes32bit(0xFFFFFFFF), 32);
  assert.equal(countOnes32bit(0x80000000), 1);
  assert.equal(countOnes32bit(0x7FFFFFFF), 31);
  assert.equal(countOnes32bit(0xF0F0F0F0), 16);
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
// isIterable
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

await runTest('Base64Codec should encode and decode byte arrays', () => {
  const original = Uint8Array.from([0, 1, 127, 128, 255]);
  const encoded = Base64Codec.encodeBytes(original);
  const decoded = Base64Codec.decodeToBytes(encoded);
  assert.deepEqual([...decoded], [...original]);
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

await runTest('Base64Codec.decodeTo6BitArray with pre-allocated array', () => {
  const original = [0, 1, 62, 63, 32];
  const encoded = Base64Codec.encode6BitArray(original);

  const preallocated = new Uint8Array(10);
  const result = Base64Codec.decodeTo6BitArray(encoded, preallocated);
  assert.equal(result, preallocated);
  assert.deepEqual([...result.subarray(0, original.length)], original);
});

await runTest('Base64Codec.decodeTo6BitArray throws if array too short', () => {
  const encoded = Base64Codec.encode6BitArray([1, 2, 3, 4, 5]);
  const tooSmall = new Uint8Array(2);
  assert.throws(
    () => Base64Codec.decodeTo6BitArray(encoded, tooSmall),
    /Array is too short/,
  );
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

await runTest('insertionSortInts sorts ascending and returns the same array', () => {
  const values = [5, 1, 4, 1, 3];
  const result = insertionSortInts(values);
  assert.deepEqual(values, [1, 1, 3, 4, 5]);
  assert.equal(result, values, 'must sort in place, not copy');
});

await runTest('insertionSortInts leaves ordered input untouched', () => {
  for (const input of [[], [7], [1, 2], [0, 0, 1, 9]]) {
    assert.deepEqual(insertionSortInts(input.slice()), input);
  }
});

await runTest('insertionSortInts sorts a typed array numerically', () => {
  // Array.prototype.sort with no comparator would order these lexicographically
  // (1, 10, 2); a numeric sort must not.
  const values = Uint16Array.from([10, 2, 1]);
  insertionSortInts(values);
  assert.deepEqual(Array.from(values), [1, 2, 10]);
});

await runTest('insertionSortInts matches a numeric sort on random input', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let t = 0; t < 2000; t++) {
    const values = [];
    for (let i = 0, n = rnd(12); i < n; i++) values.push(rnd(50));
    const expected = values.slice().sort((a, b) => a - b);
    assert.deepEqual(insertionSortInts(values.slice()), expected);
  }
});

await runTest('insertionSortInts orders by keys when given', () => {
  // Values are cell ids; keys are scores looked up by cell id.
  const scores = [0, 50, 10, 99, 20];
  const values = [1, 2, 3, 4];
  insertionSortInts(values, scores);
  // scores: 1->50, 2->10, 3->99, 4->20  =>  2, 4, 1, 3
  assert.deepEqual(values, [2, 4, 1, 3]);
});

await runTest('insertionSortInts keyed mode is stable on tied keys', () => {
  const scores = [0, 5, 5, 5];
  const values = [3, 1, 2];
  insertionSortInts(values, scores);
  // All keys tie, so the original order must survive.
  assert.deepEqual(values, [3, 1, 2]);
});

await runTest('insertionSortInts keyed mode matches a sort by the same key', () => {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const scores = new Float64Array(40);
  for (let i = 0; i < 40; i++) scores[i] = rnd(5);
  for (let t = 0; t < 2000; t++) {
    const values = [];
    for (let i = 0, n = rnd(10); i < n; i++) values.push(rnd(40));
    const expected = values.slice().sort((a, b) => scores[a] - scores[b]);
    assert.deepEqual(insertionSortInts(values.slice(), scores), expected);
  }
});

await runTest('BitSet.addAll should set every listed bit', () => {
  const bs = new BitSet(128);
  bs.addAll([0, 31, 32, 127]);
  assert.deepEqual(bs.toSortedArray(), [0, 31, 32, 127]);

  // Adding again is a no-op, and existing bits are kept.
  bs.addAll([31, 64]);
  assert.deepEqual(bs.toSortedArray(), [0, 31, 32, 64, 127]);

  bs.addAll([]);
  assert.deepEqual(bs.toSortedArray(), [0, 31, 32, 64, 127]);
});

await runTest('BitSet.addAll should accept a typed array', () => {
  const bs = new BitSet(64);
  bs.addAll(Uint16Array.from([3, 40]));
  assert.deepEqual(bs.toSortedArray(), [3, 40]);
});

await runTest('BitSet.removeAll should clear every listed bit', () => {
  const bs = new BitSet(128);
  bs.addAll([0, 31, 32, 64, 127]);

  bs.removeAll([31, 64]);
  assert.deepEqual(bs.toSortedArray(), [0, 32, 127]);

  // Removing an absent bit is a no-op.
  bs.removeAll([31]);
  assert.deepEqual(bs.toSortedArray(), [0, 32, 127]);

  bs.removeAll(Uint16Array.from([0, 127]));
  assert.deepEqual(bs.toSortedArray(), [32]);
});

await runTest('BitSet.subtract should remove the other set\'s bits', () => {
  const a = new BitSet(64);
  for (const b of [1, 2, 40]) a.add(b);

  const b = new BitSet(64);
  for (const x of [2, 40, 63]) b.add(x);

  a.subtract(b);
  // Bits only in `a` survive; shared bits go; bits only in `b` are not added.
  assert.deepEqual(a.toSortedArray(), [1]);
  // `b` is untouched.
  assert.deepEqual(b.toSortedArray(), [2, 40, 63]);
});

await runTest('BitSet.count should count set bits', () => {
  const bs = new BitSet(96);
  assert.equal(bs.count(), 0);

  // Spread across words, including the highest bit of a word.
  bs.add(0);
  bs.add(31);
  bs.add(32);
  bs.add(95);
  assert.equal(bs.count(), 4);

  // Adding an existing bit does not change the count.
  bs.add(31);
  assert.equal(bs.count(), 4);

  bs.remove(31);
  assert.equal(bs.count(), 3);
});

await runTest('BitSet.toSortedArray should return bits in ascending order', () => {
  const bs = new BitSet(96);
  assert.deepEqual(bs.toSortedArray(), []);

  // Add out of order, and across word boundaries.
  for (const b of [95, 32, 0, 31, 64]) bs.add(b);
  assert.deepEqual(bs.toSortedArray(), [0, 31, 32, 64, 95]);
});

await runTest('BitSet.toSortedArray length should agree with count', () => {
  const bs = new BitSet(64);
  for (const b of [2, 9, 40]) bs.add(b);

  // A count() that under-reports would still produce the right values (the
  // array grows past its preallocated length), so check the length too.
  assert.equal(bs.toSortedArray().length, bs.count());
});

await runTest('BitSet.clone should copy bits', () => {
  const a = new BitSet(64);
  a.add(1);
  a.add(63);

  const b = a.clone();
  assert.equal(b.has(1), true);
  assert.equal(b.has(63), true);

  b.remove(1);
  assert.equal(a.has(1), true);
  assert.equal(b.has(1), false);
});

await runTest('BitSet.forEachBit should iterate set bits', () => {
  const bs = new BitSet(96);
  bs.add(0);
  bs.add(1);
  bs.add(33);
  bs.add(95);

  const bits = [];
  bs.forEachBit((b) => bits.push(b));
  assert.deepEqual(bits, [0, 1, 33, 95]);
});

await runTest('BitSet.intersectCount should count intersection bits', () => {
  const a = new BitSet(96);
  a.add(1);
  a.add(2);
  a.add(63);
  a.add(95);

  const b = new BitSet(96);
  b.add(2);
  b.add(63);
  b.add(64);
  b.add(95);

  assert.equal(a.intersectCount(b), 3);
});

await runTest('BitSet.hasAll returns true when superset', () => {
  const a = new BitSet(64);
  a.add(1); a.add(2); a.add(3);

  const b = new BitSet(64);
  b.add(1); b.add(2);

  assert.equal(a.hasAll(b), true);
});

await runTest('BitSet.hasAll returns false when not superset', () => {
  const a = new BitSet(64);
  a.add(1); a.add(2);

  const b = new BitSet(64);
  b.add(1); b.add(3);

  assert.equal(a.hasAll(b), false);
});

await runTest('BitSet.hasAll with identical sets', () => {
  const a = new BitSet(64);
  a.add(10); a.add(50);

  const b = a.clone();
  assert.equal(a.hasAll(b), true);
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

await runTest('MultiMap.delete removes key when last value is deleted', () => {
  const mm = new MultiMap();
  mm.add('key', 'only');
  mm.delete('key', 'only');
  assert.deepEqual(mm.get('key'), []);
  // Key should be fully removed from the underlying map.
  assert.equal([...mm].length, 0);
});

await runTest('MultiMap.delete on missing key is a no-op', () => {
  const mm = new MultiMap();
  mm.delete('nonexistent', 'value');
  assert.deepEqual(mm.get('nonexistent'), []);
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

// ============================================================================
// formatFixedTruncated
// ============================================================================

await runTest('formatFixedTruncated should truncate trailing zeros', () => {
  assert.equal(formatFixedTruncated(1.50, 2), '1.5');
  assert.equal(formatFixedTruncated(1.00, 2), '1');
  assert.equal(formatFixedTruncated(1.23, 2), '1.23');
});

await runTest('formatFixedTruncated with 0 digits', () => {
  assert.equal(formatFixedTruncated(1.5, 0), '2');
  assert.equal(formatFixedTruncated(1.0, 0), '1');
});

await runTest('formatFixedTruncated with whole number', () => {
  assert.equal(formatFixedTruncated(42, 3), '42');
});

// ============================================================================
// Timer
// ============================================================================

await runTest('Timer starts paused with 0 elapsed', () => {
  const timer = new Timer();
  assert.equal(timer.elapsedMs(), 0);
});

await runTest('Timer.runTimed accumulates elapsed time', () => {
  const timer = new Timer();
  timer.runTimed(() => {
    // Do some work to ensure measurable time.
    let x = 0;
    for (let i = 0; i < 10000; i++) x += i;
  });
  assert.ok(timer.elapsedMs() >= 0);
});

await runTest('Timer.unpause and pause accumulate time', () => {
  const timer = new Timer();
  timer.unpause();
  // Brief work.
  let x = 0;
  for (let i = 0; i < 10000; i++) x += i;
  timer.pause();
  const elapsed = timer.elapsedMs();
  assert.ok(elapsed >= 0);
  // After pause, time shouldn't change.
  assert.equal(timer.elapsedMs(), elapsed);
});

await runTest('Timer.pause when already paused is safe', () => {
  const timer = new Timer();
  timer.pause(); // Already paused, should be a no-op.
  assert.equal(timer.elapsedMs(), 0);
});

await runTest('Timer.unpause when already running is safe', () => {
  const timer = new Timer();
  timer.unpause();
  timer.unpause(); // Already running, should be a no-op.
  timer.pause();
  assert.ok(timer.elapsedMs() >= 0);
});

await runTest('setSvgAttrs sets each attribute', () => {
  const attrs = {};
  setSvgAttrs({ setAttribute: (k, v) => attrs[k] = v },
    { 'stroke': 'red', 'stroke-width': 2 });
  assert.deepEqual(attrs, { 'stroke': 'red', 'stroke-width': 2 });
});

logSuiteComplete('util');
