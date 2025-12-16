import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Microbench: iterate set bits in small masks.
// Pattern appears throughout the solver: `while (m) { b=m&-m; m^=b; ... }`.

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

const INDEX16 = (() => {
  const t = new Int8Array(1 << 16);
  t.fill(-1);
  for (let i = 0; i < 16; i++) t[1 << i] = i;
  return t;
})();

const makeMasks = (numValues, mode, seed) => {
  const rng = makeLCG(seed);
  const arr = new Uint16Array(4096);
  const all = (1 << numValues) - 1;

  for (let i = 0; i < arr.length; i++) {
    let m = 0;
    if (mode === 'sparse') {
      const a = rng() % numValues;
      const b = rng() % numValues;
      m = (1 << a) | (1 << b);
    } else if (mode === 'half') {
      for (let b = 0; b < numValues; b++) if (rng() & 1) m |= 1 << b;
      m ||= 1;
    } else if (mode === 'dense') {
      m = all;
      const clears = rng() % 3;
      for (let j = 0; j < clears; j++) m &= ~(1 << (rng() % numValues));
    } else {
      m = rng() & all;
      m ||= 1;
    }

    arr[i] = m;
  }

  return arr;
};

const INPUT_COUNT = 4096;
const INDEX_MASK = INPUT_COUNT - 1;

const masks9Sparse = makeMasks(9, 'sparse', 0xC0FFEE);
const masks9Half = makeMasks(9, 'half', 0xBADC0DE);
const masks9Dense = makeMasks(9, 'dense', 0xFEEDFACE);

const benchIterators = (label, masks, numValues) => {
  // Lowbit loop; uses clz32 to convert bit->index.
  {
    let i = 0;
    bench(`${label} :: lowbit+clz32`, () => {
      let m = masks[i++ & INDEX_MASK];
      let acc = 0;
      while (m) {
        const b = m & -m;
        m ^= b;
        acc += 31 - Math.clz32(b);
      }
      consume(acc);
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  // Lowbit loop; uses table to convert bit->index.
  {
    let i = 0;
    bench(`${label} :: lowbit+INDEX16`, () => {
      let m = masks[i++ & INDEX_MASK];
      let acc = 0;
      while (m) {
        const b = m & -m;
        m ^= b;
        acc += INDEX16[b];
      }
      consume(acc);
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  // Scan bits 0..N-1.
  {
    let i = 0;
    bench(`${label} :: scan(0..N-1)`, () => {
      const m = masks[i++ & INDEX_MASK];
      let acc = 0;
      for (let b = 0; b < numValues; b++) {
        if (m & (1 << b)) acc += b;
      }
      consume(acc);
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }
};

benchGroup('micro::iterate_bits', () => {
  // Baseline.
  {
    let i = 0;
    bench('baseline(xor)', () => {
      consume(masks9Half[i++ & INDEX_MASK]);
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  benchIterators('9v sparse', masks9Sparse, 9);
  benchIterators('9v half', masks9Half, 9);
  benchIterators('9v dense', masks9Dense, 9);
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
