import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Microbench: 16-bit popcount variants.
// The solver uses popcount in many hot paths (candidate counts, etc.).

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

const popcountSWAR = (x) => {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  x += x >> 8;
  return x & 0x1f;
};

const POPCNT16 = (() => {
  const t = new Uint8Array(1 << 16);
  for (let i = 1; i < t.length; i++) t[i] = t[i & (i - 1)] + 1;
  return t;
})();

const popcountTable16 = (x) => POPCNT16[x & 0xffff];

const popcountLoop = (x) => {
  x &= 0xffff;
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

const INPUT_COUNT = 4096;
const inputsSparse = (() => {
  const rng = makeLCG(0xC0FFEE);
  const arr = new Uint16Array(INPUT_COUNT);
  for (let i = 0; i < arr.length; i++) {
    const a = rng() & 15;
    const b = rng() & 15;
    arr[i] = (1 << a) | (1 << b);
  }
  return arr;
})();

const inputsMixed = (() => {
  const rng = makeLCG(0xBADC0DE);
  const arr = new Uint16Array(INPUT_COUNT);
  for (let i = 0; i < arr.length; i++) arr[i] = rng() & 0xffff;
  return arr;
})();

const INDEX_MASK = INPUT_COUNT - 1;

benchGroup('micro::popcount16', () => {
  {
    let i = 0;
    bench('baseline(xor, sparse)', () => {
      consume(inputsSparse[i++ & INDEX_MASK]);
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  // Sparse (typical Sudoku candidates: 1-4 bits).
  {
    let i = 0;
    bench('SWAR (sparse)', () => {
      consume(popcountSWAR(inputsSparse[i++ & INDEX_MASK]));
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('table[mask] (sparse)', () => {
      consume(popcountTable16(inputsSparse[i++ & INDEX_MASK]));
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('x&=x-1 loop (sparse)', () => {
      consume(popcountLoop(inputsSparse[i++ & INDEX_MASK]));
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  // Mixed (uniform random 16-bit masks).
  {
    let i = 0;
    bench('SWAR (mixed)', () => {
      consume(popcountSWAR(inputsMixed[i++ & INDEX_MASK]));
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('table[mask] (mixed)', () => {
      consume(popcountTable16(inputsMixed[i++ & INDEX_MASK]));
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('x&=x-1 loop (mixed)', () => {
      consume(popcountLoop(inputsMixed[i++ & INDEX_MASK]));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
