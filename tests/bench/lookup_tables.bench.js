import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { bench, benchGroup, runIfMain } from './bench_harness.js';

ensureGlobalEnvironment();

const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { Base64Codec } = await import('../../js/util.js' + self.VERSION_PARAM);

// Keep this file focused on hot primitives and stable inputs.
// As the suite grows, prefer adding new *.bench.js files per module.

const NUM_VALUES = 9;
const TABLES = LookupTables.get(NUM_VALUES);
const COMBINATIONS = TABLES.combinations; // 1 << NUM_VALUES
const ALL = TABLES.allValues;

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    // Numerical Recipes LCG.
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

const rng = makeLCG(0xC0FFEE);

const singleBitMasks = (() => {
  const arr = new Uint16Array(NUM_VALUES);
  for (let i = 0; i < NUM_VALUES; i++) arr[i] = 1 << i;
  return arr;
})();

const values1toN = (() => {
  const arr = new Uint8Array(NUM_VALUES);
  for (let i = 0; i < NUM_VALUES; i++) arr[i] = i + 1;
  return arr;
})();

const masksSparse = (() => {
  const arr = new Uint16Array(2048);
  for (let i = 0; i < arr.length; i++) {
    // 1–2 bits set.
    const a = rng() % NUM_VALUES;
    const b = rng() % NUM_VALUES;
    arr[i] = (1 << a) | (1 << b);
  }
  return arr;
})();

const masksHalf = (() => {
  const arr = new Uint16Array(2048);
  for (let i = 0; i < arr.length; i++) {
    // Roughly half the bits set.
    let m = 0;
    for (let b = 0; b < NUM_VALUES; b++) {
      if (rng() & 1) m |= 1 << b;
    }
    // Avoid degenerate 0 mask.
    arr[i] = m || 1;
  }
  return arr;
})();

const masksDense = (() => {
  const arr = new Uint16Array(2048);
  for (let i = 0; i < arr.length; i++) {
    // Clear 0–2 bits from ALL.
    let m = ALL;
    const clears = rng() % 3;
    for (let j = 0; j < clears; j++) {
      m &= ~(1 << (rng() % NUM_VALUES));
    }
    arr[i] = m;
  }
  return arr;
})();

const allMasks = (() => {
  // Iterate through all possible masks in a fixed order.
  const arr = new Uint16Array(COMBINATIONS);
  for (let i = 0; i < COMBINATIONS; i++) arr[i] = i;
  return arr;
})();

// Prevent V8 from DCEing results.
let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const valueArraysSparse = Array.from(masksSparse, (m) => LookupTables.toValuesArray(m));
const valueArraysHalf = Array.from(masksHalf, (m) => LookupTables.toValuesArray(m));
const valueArraysDense = Array.from(masksDense, (m) => LookupTables.toValuesArray(m));

const KEY_LEN = Base64Codec.lengthOf6BitArray(NUM_VALUES * NUM_VALUES);
const makeBinaryKey = (seed) => {
  const r = makeLCG(seed);
  const sixBits = new Array(KEY_LEN);
  for (let i = 0; i < KEY_LEN; i++) {
    sixBits[i] = r() & 63;
  }
  return Base64Codec.encode6BitArray(sixBits);
};

const binaryKeyHit = makeBinaryKey(0xBADF00D);
const binaryKeysCold = (() => {
  const keys = new Array(16384);
  for (let i = 0; i < keys.length; i++) {
    keys[i] = makeBinaryKey((0x12345678 + i) >>> 0);
  }
  return keys;
})();

benchGroup('lookup_tables', () => {
  // ---------------------------------------------------------------------------
  // Basic value<->bit conversions
  // ---------------------------------------------------------------------------
  {
    let i = 0;
    bench('fromValue(1..N)', () => {
      consume(LookupTables.fromValue(values1toN[i++ % values1toN.length]));
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('fromIndex(0..N-1)', () => {
      consume(LookupTables.fromIndex(i++ % NUM_VALUES));
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  // ---------------------------------------------------------------------------
  // Basic bit->value conversions
  // ---------------------------------------------------------------------------
  {
    let i = 0;
    bench('toValue(single-bit)', () => {
      consume(LookupTables.toValue(singleBitMasks[i++ % singleBitMasks.length]));
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('toIndex(single-bit)', () => {
      consume(LookupTables.toIndex(singleBitMasks[i++ % singleBitMasks.length]));
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('minMax16bitValue(mixed)', () => {
      consume(LookupTables.minMax16bitValue(masksHalf[i++ % masksHalf.length]));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('minValue(mixed)', () => {
      consume(LookupTables.minValue(masksHalf[i++ % masksHalf.length]));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('maxValue(mixed)', () => {
      consume(LookupTables.maxValue(masksHalf[i++ % masksHalf.length]));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('valueRangeInclusive(mixed)', () => {
      consume(LookupTables.valueRangeInclusive(masksHalf[i++ % masksHalf.length]));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('valueRangeExclusive(mixed)', () => {
      consume(LookupTables.valueRangeExclusive(masksHalf[i++ % masksHalf.length]));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  // ---------------------------------------------------------------------------
  // Mask -> array conversion (allocation-heavy, but hot in UI/debug paths)
  // ---------------------------------------------------------------------------
  {
    let i = 0;
    bench('fromValuesArray(sparse)', () => {
      consume(LookupTables.fromValuesArray(valueArraysSparse[i++ % valueArraysSparse.length]));
    }, { innerIterations: 250_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('fromValuesArray(half)', () => {
      consume(LookupTables.fromValuesArray(valueArraysHalf[i++ % valueArraysHalf.length]));
    }, { innerIterations: 150_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('fromValuesArray(dense)', () => {
      consume(LookupTables.fromValuesArray(valueArraysDense[i++ % valueArraysDense.length]));
    }, { innerIterations: 150_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('toValuesArray(sparse)', () => {
      consume(LookupTables.toValuesArray(masksSparse[i++ % masksSparse.length]).length);
    }, { innerIterations: 250_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('toValuesArray(half)', () => {
      consume(LookupTables.toValuesArray(masksHalf[i++ % masksHalf.length]).length);
    }, { innerIterations: 150_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('toValuesArray(dense)', () => {
      consume(LookupTables.toValuesArray(masksDense[i++ % masksDense.length]).length);
    }, { innerIterations: 150_000, minSampleTimeMs: 25 });
  }

  // ---------------------------------------------------------------------------
  // Table lookups (these are the intended fast-path primitives)
  // ---------------------------------------------------------------------------
  {
    let i = 1; // skip 0 to avoid special-case entries dominating
    bench('sum[mask] (table lookup)', () => {
      consume(TABLES.sum[allMasks[i++ % allMasks.length]]);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 1;
    bench('rangeInfo[mask] (table lookup)', () => {
      consume(TABLES.rangeInfo[allMasks[i++ % allMasks.length]]);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 1;
    bench('reverse[mask] (table lookup)', () => {
      consume(TABLES.reverse[allMasks[i++ % allMasks.length]]);
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }
});

// Export a value so the module has an observable side-effect.
export const _benchSink = () => sink;
await runIfMain(import.meta.url);
