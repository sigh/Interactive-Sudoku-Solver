import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Microbench: single-bit mask -> index/value conversions.
// Used heavily throughout solver code (e.g., iterating bitmasks).

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

// Precompute a 16-bit mask -> index table (-1 for non-single-bit).
const INDEX16 = (() => {
  const t = new Int8Array(1 << 16);
  t.fill(-1);
  for (let i = 0; i < 16; i++) t[1 << i] = i;
  return t;
})();

const VALUE16 = (() => {
  const t = new Int8Array(1 << 16);
  // 0 stays 0.
  for (let i = 0; i < 16; i++) t[1 << i] = i + 1;
  return t;
})();

const INPUT_COUNT = 4096;
const inputs = (() => {
  const rng = makeLCG(0xA11CE);
  const arr = new Uint16Array(INPUT_COUNT);
  for (let i = 0; i < arr.length; i++) arr[i] = 1 << (rng() & 15);
  return arr;
})();

const INDEX_MASK = INPUT_COUNT - 1;

benchGroup('micro::mask_to_index', () => {
  {
    let i = 0;
    bench('baseline(xor)', () => {
      consume(inputs[i++ & INDEX_MASK]);
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('index: 31-clz32(mask)', () => {
      const m = inputs[i++ & INDEX_MASK];
      consume(31 - Math.clz32(m));
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('index: log2(mask)|0', () => {
      const m = inputs[i++ & INDEX_MASK];
      consume(Math.log2(m) | 0);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('index: INDEX16[mask]', () => {
      const m = inputs[i++ & INDEX_MASK];
      consume(INDEX16[m]);
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('value: 32-clz32(mask)', () => {
      const m = inputs[i++ & INDEX_MASK];
      consume(32 - Math.clz32(m));
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('value: VALUE16[mask]', () => {
      const m = inputs[i++ & INDEX_MASK];
      consume(VALUE16[m]);
    }, { innerIterations: 6_000_000, minSampleTimeMs: 25 });
  }
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
