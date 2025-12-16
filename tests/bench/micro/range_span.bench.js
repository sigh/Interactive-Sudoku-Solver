import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Microbench: compute bit-span (maxBitIndex - minBitIndex) for a 16-bit mask.
// This mirrors the `sum_handler` pattern:
//   const clz = Math.clz32(v);
//   const span = Math.clz32(v & -v) - clz;
// (where v is non-zero).

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

// Precompute span for all 16-bit masks.
// For mask==0, span=0 (undefined in real use, but keeps table total).
const SPAN16 = (() => {
  const t = new Uint8Array(1 << 16);
  for (let m = 1; m < t.length; m++) {
    const hi = 31 - Math.clz32(m);
    const lo = 31 - Math.clz32(m & -m);
    t[m] = hi - lo;
  }
  return t;
})();

const spanClzCached = (v) => {
  const clz = Math.clz32(v);
  return Math.clz32(v & -v) - clz;
};

const spanClzNoCache = (v) => {
  return Math.clz32(v & -v) - Math.clz32(v);
};

const spanTable = (v) => SPAN16[v & 0xffff];

const INPUT_COUNT = 4096;
const INDEX_MASK = INPUT_COUNT - 1;

const makeMasks = (numValues, mode, seed) => {
  const rng = makeLCG(seed);
  const arr = new Uint16Array(INPUT_COUNT);
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

const masks9Sparse = makeMasks(9, 'sparse', 0xC0FFEE);
const masks9Half = makeMasks(9, 'half', 0xBADC0DE);
const masks9Dense = makeMasks(9, 'dense', 0xFEEDFACE);

const benchOne = (label, masks, spanFn) => {
  let i = 0;
  bench(label, () => {
    const v = masks[i++ & INDEX_MASK];
    consume(spanFn(v));
  }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
};

benchGroup('micro::range_span', () => {
  {
    let i = 0;
    bench('baseline(xor)', () => {
      consume(masks9Half[i++ & INDEX_MASK]);
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  // 9-value masks, representative of Sudoku candidates.
  benchOne('9v sparse :: clz cached', masks9Sparse, spanClzCached);
  benchOne('9v sparse :: clz no-cache', masks9Sparse, spanClzNoCache);
  benchOne('9v sparse :: table', masks9Sparse, spanTable);

  benchOne('9v half :: clz cached', masks9Half, spanClzCached);
  benchOne('9v half :: clz no-cache', masks9Half, spanClzNoCache);
  benchOne('9v half :: table', masks9Half, spanTable);

  benchOne('9v dense :: clz cached', masks9Dense, spanClzCached);
  benchOne('9v dense :: clz no-cache', masks9Dense, spanClzNoCache);
  benchOne('9v dense :: table', masks9Dense, spanTable);
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
