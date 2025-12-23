import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Deterministic PRNG (xorshift32) so results are reproducible.
const makeRng = (seed = 0x12345678) => {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x | 0;
  };
};

const buildData = (n, seed) => {
  const rng = makeRng(seed);
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    // Keep values within a moderate range (and non-negative) so comparisons
    // look like typical small-int workloads.
    a[i] = (rng() >>> 0) % 1_000_000;
  }
  return a;
};

// Global sink to discourage dead-code elimination.
let sink = 0;

benchGroup('micro::sort_integers', () => {
  for (const n of [64, 256, 1024, 4096]) {
    const baseArray = buildData(n, 0xC0FFEE + n);
    const baseTyped = Int32Array.from(baseArray);

    bench(`Array copy+sort n=${n}`, () => {
      const xs = baseArray.slice();
      xs.sort((a, b) => a - b);
      sink ^= xs[0] | 0;
    }, {
      innerIterations: Math.max(1, (50_000 / Math.max(1, n / 64)) | 0),
    });

    bench(`Int32Array copy+sort n=${n}`, () => {
      const xs = baseTyped.slice();
      xs.sort();
      sink ^= xs[0] | 0;
    }, {
      innerIterations: Math.max(1, (50_000 / Math.max(1, n / 64)) | 0),
    });

    // Reuse buffers to reduce allocation noise (still measures copy+sort).
    const reuseArray = new Array(n);
    const reuseTyped = new Int32Array(n);

    bench(`Array reuse-copy+sort n=${n}`, () => {
      for (let i = 0; i < n; i++) reuseArray[i] = baseArray[i];
      reuseArray.sort((a, b) => a - b);
      sink ^= reuseArray[0] | 0;
    }, {
      innerIterations: Math.max(1, (50_000 / Math.max(1, n / 64)) | 0),
    });

    bench(`Int32Array reuse-copy+sort n=${n}`, () => {
      reuseTyped.set(baseTyped);
      reuseTyped.sort();
      sink ^= reuseTyped[0] | 0;
    }, {
      innerIterations: Math.max(1, (50_000 / Math.max(1, n / 64)) | 0),
    });
  }
});

await runIfMain(import.meta.url);

export const _benchSink = () => sink;
