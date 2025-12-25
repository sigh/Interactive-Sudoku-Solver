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

const buildInt32Pairs = (n, seed, mask) => {
  const rng = makeRng(seed);
  const a = new Int32Array(n);
  const b = new Int32Array(n);
  if (mask === undefined) {
    for (let i = 0; i < n; i++) {
      a[i] = rng();
      b[i] = rng();
    }
  } else {
    for (let i = 0; i < n; i++) {
      a[i] = rng() & mask;
      b[i] = rng() & mask;
    }
  }
  return { a, b };
};

// Global sink to discourage dead-code elimination.
let sink = 0;

benchGroup('micro::imul_vs_mul', () => {
  for (const n of [256, 1024, 4096]) {
    const small = buildInt32Pairs(n, 0xC0FFEE + n, /* mask */ 0xFFFF);
    const full = buildInt32Pairs(n, 0xFACE0000 + n);

    const inner = Math.max(1, (50_000 / Math.max(1, n / 256)) | 0);

    for (const [label, data] of [
      ['small16', small],
      ['full32', full],
    ]) {
      bench(`Math.imul int32 (${label}) n=${n}`, () => {
        const a = data.a;
        const b = data.b;
        let acc = 0;
        for (let i = 0; i < n; i++) {
          acc = (acc + Math.imul(a[i], b[i])) | 0;
        }
        sink ^= acc;
      }, { innerIterations: inner });

      bench(`Number mul (double) (${label}) n=${n}`, () => {
        const a = data.a;
        const b = data.b;
        let acc = 0;
        for (let i = 0; i < n; i++) {
          acc += a[i] * b[i];
        }
        sink ^= acc | 0;
      }, { innerIterations: inner });

      // Coerce to int32 to make the output type closer to Math.imul.
      bench(`Number mul |0 (${label}) n=${n}`, () => {
        const a = data.a;
        const b = data.b;
        let acc = 0;
        for (let i = 0; i < n; i++) {
          acc = (acc + ((a[i] * b[i]) | 0)) | 0;
        }
        sink ^= acc;
      }, { innerIterations: inner });
    }
  }
});

await runIfMain(import.meta.url);

export const _benchSink = () => sink;
