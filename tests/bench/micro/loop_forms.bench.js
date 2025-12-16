import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Microbench: loop forms on Arrays vs TypedArrays.
// This targets "non-idiomatic" choices like preferring indexed `for` loops
// over `for...of` / `forEach` in hot code.

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

const rng = makeLCG(0xC0FFEE);

const COUNT = 8192;

// Keep this microbench fast: the harness will auto-increase inner iterations
// until `minSampleTimeMs` is reached, but it will not auto-decrease if the
// chosen `innerIterations` is too slow.
const OPT_BASELINE = { innerIterations: 2_000_000, minSampleTimeMs: 10 };
const OPT_FAST = { innerIterations: 5_000, minSampleTimeMs: 10 };
const OPT_MED = { innerIterations: 1_000, minSampleTimeMs: 10 };
const OPT_SLOW = { innerIterations: 200, minSampleTimeMs: 10 };
const typed = (() => {
  const a = new Uint32Array(COUNT);
  for (let i = 0; i < a.length; i++) a[i] = rng();
  return a;
})();

const plain = (() => Array.from(typed))();

benchGroup('micro::loop_forms', () => {
  // -------------------------------------------------------------------------
  // Baselines
  // -------------------------------------------------------------------------
  {
    let i = 0;
    bench('baseline(xor)', () => {
      consume(typed[i++ & (COUNT - 1)]);
    }, OPT_BASELINE);
  }

  // -------------------------------------------------------------------------
  // TypedArray iteration
  // -------------------------------------------------------------------------
  {
    bench('typed: for(i)<len', () => {
      let acc = 0;
      for (let i = 0; i < typed.length; i++) acc ^= typed[i];
      consume(acc);
    }, OPT_FAST);
  }

  {
    bench('typed: for(i)<cachedLen', () => {
      let acc = 0;
      for (let i = 0, n = typed.length; i < n; i++) acc ^= typed[i];
      consume(acc);
    }, OPT_FAST);
  }

  {
    bench('typed: for(i)>=0', () => {
      let acc = 0;
      for (let i = typed.length - 1; i >= 0; i--) acc ^= typed[i];
      consume(acc);
    }, OPT_FAST);
  }

  {
    bench('typed: for-of', () => {
      let acc = 0;
      for (const v of typed) acc ^= v;
      consume(acc);
    }, OPT_SLOW);
  }

  {
    bench('typed: forEach', () => {
      let acc = 0;
      typed.forEach((v) => { acc ^= v; });
      consume(acc);
    }, OPT_SLOW);
  }

  // -------------------------------------------------------------------------
  // Plain Array iteration
  // -------------------------------------------------------------------------
  {
    bench('array: for(i)<len', () => {
      let acc = 0;
      for (let i = 0; i < plain.length; i++) acc ^= plain[i];
      consume(acc);
    }, OPT_FAST);
  }

  {
    bench('array: for(i)<cachedLen', () => {
      let acc = 0;
      for (let i = 0, n = plain.length; i < n; i++) acc ^= plain[i];
      consume(acc);
    }, OPT_FAST);
  }

  {
    bench('array: for(i)>=0', () => {
      let acc = 0;
      for (let i = plain.length - 1; i >= 0; i--) acc ^= plain[i];
      consume(acc);
    }, OPT_FAST);
  }

  {
    bench('array: for-of', () => {
      let acc = 0;
      for (const v of plain) acc ^= v;
      consume(acc);
    }, OPT_SLOW);
  }

  {
    bench('array: forEach', () => {
      let acc = 0;
      plain.forEach((v) => { acc ^= v; });
      consume(acc);
    }, OPT_MED);
  }

  {
    bench('array: reduce', () => {
      const acc = plain.reduce((p, v) => (p ^ v), 0);
      consume(acc);
    }, OPT_MED);
  }
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
