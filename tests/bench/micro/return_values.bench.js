import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// Standalone microbench: compare strategies for returning two values from a hot function.
// Intentionally independent of application code.

// Prevent V8 from DCEing results.
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

// Deterministic inputs; sized as power-of-two for cheap indexing.
const INPUT_COUNT = 4096;
const inputs = (() => {
  const arr = new Uint32Array(INPUT_COUNT);
  for (let i = 0; i < arr.length; i++) arr[i] = rng();
  return arr;
})();

const INDEX_MASK = INPUT_COUNT - 1;

// Return strategies.
const retArray = (x) => {
  const a = x & 0xffff;
  const b = x >>> 16;
  return [a, b];
};

const retObject = (x) => {
  const a = x & 0xffff;
  const b = x >>> 16;
  return { a, b };
};

const outU32 = (x, out) => {
  out[0] = x & 0xffff;
  out[1] = x >>> 16;
};

const outArray = (x, out) => {
  out[0] = x & 0xffff;
  out[1] = x >>> 16;
};

// Packed return (single number) as a baseline for "no container".
const retPacked32 = (x) => x; // already a packed pair (low/high 16 bits)

benchGroup('micro::return_values', () => {
  // Baseline loop body cost.
  {
    let i = 0;
    bench('baseline(xor)', () => {
      const x = inputs[i++ & INDEX_MASK];
      consume(x);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  // Return [a,b] and consume both.
  {
    let i = 0;
    bench('return array [a,b]', () => {
      const x = inputs[i++ & INDEX_MASK];
      const r = retArray(x);
      consume((r[0] + r[1]) | 0);
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  // Return {a,b} and consume both.
  {
    let i = 0;
    bench('return object {a,b}', () => {
      const x = inputs[i++ & INDEX_MASK];
      const r = retObject(x);
      consume((r.a + r.b) | 0);
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  // Out parameter: preallocated Uint32Array(2).
  {
    const out = new Uint32Array(2);
    let i = 0;
    bench('out-param Uint32Array(2)', () => {
      const x = inputs[i++ & INDEX_MASK];
      outU32(x, out);
      consume((out[0] + out[1]) | 0);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  // Out parameter: preallocated plain Array(2).
  {
    const out = [0, 0];
    let i = 0;
    bench('out-param Array(2)', () => {
      const x = inputs[i++ & INDEX_MASK];
      outArray(x, out);
      consume((out[0] + out[1]) | 0);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  // Packed return: consume both halves without allocating.
  {
    let i = 0;
    bench('return packed uint32', () => {
      const x = inputs[i++ & INDEX_MASK];
      const p = retPacked32(x);
      consume(((p & 0xffff) + (p >>> 16)) | 0);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }
});

// Export a value so the module has an observable side-effect.
export const _benchSink = () => sink;
await runIfMain(import.meta.url);
