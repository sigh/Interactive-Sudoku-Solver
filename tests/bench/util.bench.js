import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { bench, benchGroup, runIfMain } from './bench_harness.js';

ensureGlobalEnvironment();

const {
  Base64Codec,
  BitSet,
  RandomIntGenerator,
  arrayDifference,
  arrayIntersect,
  arrayIntersectSize,
  arrayRemoveValue,
  arraysAreEqual,
  countOnes16bit,
  memoize,
  requiredBits,
  setDifference,
  setIntersectSize,
  setIntersectionToArray,
  setPeek,
} = await import('../../js/util.js' + self.VERSION_PARAM);

// Keep inputs deterministic and avoid allocations inside timed sections.

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

benchGroup('util::bitset', () => {
  const CAPACITY = 256;
  const wordCount = BitSet._wordCountFor(CAPACITY);

  const rng = makeLCG(0xC0FFEE);
  const indexes = (() => {
    const arr = new Uint16Array(4096);
    for (let i = 0; i < arr.length; i++) arr[i] = rng() % CAPACITY;
    return arr;
  })();

  {
    const bs = new BitSet(CAPACITY);
    let i = 0;
    bench('add(index)', () => {
      bs.add(indexes[i++ % indexes.length]);
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  {
    const bs = new BitSet(CAPACITY);
    let i = 0;
    bench('remove(index)', () => {
      bs.remove(indexes[i++ % indexes.length]);
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }

  {
    const bs = new BitSet(CAPACITY);
    // Seed with some bits set.
    for (let k = 0; k < CAPACITY; k += 3) bs.add(k);

    let i = 0;
    bench('has(index)', () => {
      consume(bs.has(indexes[i++ % indexes.length]));
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  {
    const bs = new BitSet(CAPACITY);
    for (let k = 0; k < CAPACITY; k += 2) bs.add(k);
    bench('isEmpty()', () => {
      consume(bs.isEmpty());
    }, { innerIterations: 500_000, minSampleTimeMs: 25 });
  }

  {
    const bs = new BitSet(CAPACITY);
    for (let k = 0; k < CAPACITY; k += 2) bs.add(k);
    bench('clear()', () => {
      bs.clear();
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }

  {
    const a = new BitSet(CAPACITY);
    const b = new BitSet(CAPACITY);
    for (let k = 0; k < CAPACITY; k += 2) a.add(k);
    for (let k = 0; k < CAPACITY; k += 3) b.add(k);

    bench('union(other)', () => {
      a.union(b);
      consume(a.words[0]);
      // Restore a to stable baseline.
      a.words.fill(0);
      for (let k = 0; k < CAPACITY; k += 2) a.add(k);
    }, { innerIterations: 50_000, minSampleTimeMs: 25 });
  }

  {
    const a = new BitSet(CAPACITY);
    const b = new BitSet(CAPACITY);
    for (let k = 0; k < CAPACITY; k += 2) a.add(k);
    for (let k = 0; k < CAPACITY; k += 3) b.add(k);

    bench('intersect(other)', () => {
      a.intersect(b);
      consume(a.words[0]);
      // Restore a to stable baseline.
      a.words.fill(0);
      for (let k = 0; k < CAPACITY; k += 2) a.add(k);
    }, { innerIterations: 50_000, minSampleTimeMs: 25 });
  }

  {
    const a = new BitSet(CAPACITY);
    const b = new BitSet(CAPACITY);
    for (let k = 0; k < CAPACITY; k += 2) a.add(k);
    for (let k = 0; k < CAPACITY; k += 3) b.add(k);

    bench('copyFrom(other)', () => {
      a.copyFrom(b);
      consume(a.words[wordCount - 1]);
    }, { innerIterations: 200_000, minSampleTimeMs: 25 });
  }

  {
    const words = new Uint32Array(wordCount);
    for (let i = 0; i < wordCount; i++) words[i] = rng();

    let wi = 0;
    bench('bitIndex(word, lowbit)', () => {
      const w = words[wi++ % words.length] || 1;
      const low = w & -w;
      consume(BitSet.bitIndex(wi & 7, low));
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }
});

benchGroup('util::base64', () => {
  const rng = makeLCG(0xBADC0DE);

  const make6BitArray = (len) => {
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = rng() & 63;
    return arr;
  };

  const a54 = make6BitArray(54);
  const a216 = make6BitArray(216);
  const out54 = new Uint8Array(54);
  const out216 = new Uint8Array(216);

  const s54 = Base64Codec.encode6BitArray(Array.from(a54));
  const s216 = Base64Codec.encode6BitArray(Array.from(a216));

  {
    bench('decodeTo6BitArray(len=54)', () => {
      const out = Base64Codec.decodeTo6BitArray(s54, out54);
      consume(out[0]);
    }, { innerIterations: 400_000, minSampleTimeMs: 25 });
  }

  {
    bench('decodeTo6BitArray(len=216)', () => {
      const out = Base64Codec.decodeTo6BitArray(s216, out216);
      consume(out[0]);
    }, { innerIterations: 200_000, minSampleTimeMs: 25 });
  }

  {
    const arr = Array.from(a54);
    bench('encode6BitArray(len=54)', () => {
      const s = Base64Codec.encode6BitArray(arr);
      consume(s.length);
    }, { innerIterations: 150_000, minSampleTimeMs: 25 });
  }

  {
    const arr = Array.from(a216);
    bench('encode6BitArray(len=216)', () => {
      const s = Base64Codec.encode6BitArray(arr);
      consume(s.length);
    }, { innerIterations: 60_000, minSampleTimeMs: 25 });
  }

  {
    const binary = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/='.repeat(4);
    bench('encodeString(len~256)', () => {
      const s = Base64Codec.encodeString(binary);
      consume(s.length);
    }, { innerIterations: 50_000, minSampleTimeMs: 25 });
  }

  {
    const binary = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/='.repeat(4);
    const encoded = Base64Codec.encodeString(binary);
    bench('decodeToString(len~256)', () => {
      const s = Base64Codec.decodeToString(encoded);
      consume(s.length);
    }, { innerIterations: 50_000, minSampleTimeMs: 25 });
  }
});

benchGroup('util::memoize', () => {
  // Hit path (single-arg key) is used heavily by LookupTables.get.
  const f1 = memoize((x) => x + 1);
  f1(123);

  bench('memoize(hit, 1 arg)', () => {
    consume(f1(123));
  }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });

  // Miss path (single arg).
  let miss = 0;
  const fMiss = memoize((x) => x ^ 0x5a5a5a5a);
  bench('memoize(miss, 1 arg)', () => {
    consume(fMiss(miss++));
  }, { innerIterations: 200_000, minSampleTimeMs: 25 });

  // Multi-arg key uses JSON.stringify; useful to quantify.
  const f2 = memoize((a, b, c) => a + b + c);
  f2(1, 2, 3);

  bench('memoize(hit, 3 args)', () => {
    consume(f2(1, 2, 3));
  }, { innerIterations: 300_000, minSampleTimeMs: 25 });

  let miss2 = 0;
  bench('memoize(miss, 3 args)', () => {
    consume(f2(miss2++, 2, 3));
  }, { innerIterations: 50_000, minSampleTimeMs: 25 });
});

benchGroup('util::math', () => {
  const rng = makeLCG(0xFEEDFACE);
  const xs = (() => {
    const arr = new Uint32Array(4096);
    for (let i = 0; i < arr.length; i++) arr[i] = rng();
    return arr;
  })();

  {
    let i = 0;
    bench('countOnes16bit(x)', () => {
      consume(countOnes16bit(xs[i++ % xs.length] & 0xffff));
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }

  {
    let i = 0;
    bench('requiredBits(x)', () => {
      consume(requiredBits(xs[i++ % xs.length] | 1));
    }, { innerIterations: 3_000_000, minSampleTimeMs: 25 });
  }
});

benchGroup('util::array', () => {
  const rng = makeLCG(0xA11A11A1);

  const makeArray = (len, maxVal) => {
    const arr = new Array(len);
    for (let i = 0; i < len; i++) arr[i] = rng() % maxVal;
    return arr;
  };

  // Two arrays with partial overlap.
  const a64 = makeArray(64, 128);
  const b64 = makeArray(64, 128);

  const a256 = makeArray(256, 512);
  const b256 = makeArray(256, 512);

  // Equality cases.
  const eq128a = makeArray(128, 256);
  const eq128b = eq128a.slice();
  const ne128 = eq128a.slice();
  ne128[ne128.length >> 1] ^= 1;

  {
    bench('arrayIntersect(len=64)', () => {
      consume(arrayIntersect(a64, b64).length);
    }, { innerIterations: 40_000, minSampleTimeMs: 25 });
  }

  {
    bench('arrayDifference(len=64)', () => {
      consume(arrayDifference(a64, b64).length);
    }, { innerIterations: 40_000, minSampleTimeMs: 25 });
  }

  {
    bench('arrayIntersectSize(len=64)', () => {
      consume(arrayIntersectSize(a64, b64));
    }, { innerIterations: 80_000, minSampleTimeMs: 25 });
  }

  {
    bench('arrayIntersect(len=256)', () => {
      consume(arrayIntersect(a256, b256).length);
    }, { innerIterations: 2_500, minSampleTimeMs: 25 });
  }

  {
    bench('arrayDifference(len=256)', () => {
      consume(arrayDifference(a256, b256).length);
    }, { innerIterations: 2_500, minSampleTimeMs: 25 });
  }

  {
    bench('arrayIntersectSize(len=256)', () => {
      consume(arrayIntersectSize(a256, b256));
    }, { innerIterations: 5_000, minSampleTimeMs: 25 });
  }

  {
    bench('arraysAreEqual(equal, len=128)', () => {
      consume(arraysAreEqual(eq128a, eq128b));
    }, { innerIterations: 200_000, minSampleTimeMs: 25 });
  }

  {
    bench('arraysAreEqual(not equal, len=128)', () => {
      consume(arraysAreEqual(eq128a, ne128));
    }, { innerIterations: 200_000, minSampleTimeMs: 25 });
  }

  {
    // Avoid per-iteration allocations by mutating and restoring.
    const pool = (() => {
      const xs = new Array(256);
      for (let i = 0; i < xs.length; i++) {
        const arr = makeArray(64, 256);
        // Ensure 'needle' exists.
        arr[32] = 123;
        xs[i] = arr;
      }
      return xs;
    })();

    let i = 0;
    bench('arrayRemoveValue(found, len=64)', () => {
      const arr = pool[i++ & (pool.length - 1)];
      arrayRemoveValue(arr, 123);
      // Restore so the next iteration is comparable.
      arr.push(123);
      consume(arr.length);
    }, { innerIterations: 200_000, minSampleTimeMs: 25 });
  }
});

benchGroup('util::set', () => {
  const rng = makeLCG(0x5E7BEEF);

  const makeSet = (size, maxVal) => {
    const s = new Set();
    while (s.size < size) s.add(rng() % maxVal);
    return s;
  };

  const makeArray = (len, maxVal) => {
    const arr = new Array(len);
    for (let i = 0; i < len; i++) arr[i] = rng() % maxVal;
    return arr;
  };

  const setA = makeSet(256, 1024);
  const iterB64 = makeArray(64, 1024);
  const iterB256 = makeArray(256, 1024);

  {
    bench('setIntersectSize(iter len=64)', () => {
      consume(setIntersectSize(setA, iterB64));
    }, { innerIterations: 150_000, minSampleTimeMs: 25 });
  }

  {
    bench('setIntersectionToArray(iter len=64)', () => {
      consume(setIntersectionToArray(setA, iterB64).length);
    }, { innerIterations: 80_000, minSampleTimeMs: 25 });
  }

  {
    bench('setIntersectSize(iter len=256)', () => {
      consume(setIntersectSize(setA, iterB256));
    }, { innerIterations: 40_000, minSampleTimeMs: 25 });
  }

  {
    bench('setIntersectionToArray(iter len=256)', () => {
      consume(setIntersectionToArray(setA, iterB256).length);
    }, { innerIterations: 20_000, minSampleTimeMs: 25 });
  }

  {
    const setB = makeSet(256, 1024);
    bench('setDifference(set,size=256)', () => {
      consume(setDifference(setA, setB).size);
    }, { innerIterations: 10_000, minSampleTimeMs: 25 });
  }

  {
    bench('setPeek(size=256)', () => {
      const v = setPeek(setA);
      consume((v ?? 0) | 0);
    }, { innerIterations: 2_000_000, minSampleTimeMs: 25 });
  }
});

benchGroup('util::rng', () => {
  const rng = new RandomIntGenerator(123456);

  bench('RandomIntGenerator._next()', () => {
    consume(rng._next());
  }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });

  bench('RandomIntGenerator.randomInt(max=255)', () => {
    consume(rng.randomInt(255));
  }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
