import { mergeSortedArrays } from '../../../js/util.js';
import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Alternative: concat + sort
const concatAndSort = (a, b) => {
  return [...a, ...b].sort((x, y) => x - y);
};

// Generate a few representative test pairs
const small = [
  [Array.from({ length: 3 }, (_, i) => i * 2), Array.from({ length: 4 }, (_, i) => i * 2 + 1)],
  [Array.from({ length: 2 }, (_, i) => i * 2), Array.from({ length: 3 }, (_, i) => i * 2 + 1)],
];

const medium = [
  [Array.from({ length: 8 }, (_, i) => i * 2), Array.from({ length: 7 }, (_, i) => i * 2 + 1)],
  [Array.from({ length: 6 }, (_, i) => i * 2), Array.from({ length: 9 }, (_, i) => i * 2 + 1)],
];

const large = [
  [Array.from({ length: 15 }, (_, i) => i * 2), Array.from({ length: 18 }, (_, i) => i * 2 + 1)],
  [Array.from({ length: 20 }, (_, i) => i * 2), Array.from({ length: 12 }, (_, i) => i * 2 + 1)],
];

benchGroup('small (2-5 elements)', () => {
  bench('mergeSortedArrays', () => mergeSortedArrays(small[0][0], small[0][1]));
  bench('concat + sort', () => concatAndSort(small[0][0], small[0][1]));
});

benchGroup('medium (6-15 elements)', () => {
  bench('mergeSortedArrays', () => mergeSortedArrays(medium[0][0], medium[0][1]));
  bench('concat + sort', () => concatAndSort(medium[0][0], medium[0][1]));
});

benchGroup('large (15-30 elements)', () => {
  bench('mergeSortedArrays', () => mergeSortedArrays(large[0][0], large[0][1]));
  bench('concat + sort', () => concatAndSort(large[0][0], large[0][1]));
});

runIfMain(import.meta.url);
