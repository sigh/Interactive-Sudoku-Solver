import { bench, benchGroup, runIfMain } from '../../lib/micro_bench_harness.js';

// Sorting a handful of cells by a score looked up in a side table, as done by
// the candidate selector and the exclusion-group code. The lists are tiny —
// almost always 2 — where Array.sort's setup dominates the one comparison it
// actually needs, and the comparator closure has to be allocated because it
// captures the score table.

const makeRng = (seed = 0x12345678) => {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x | 0;
  };
};

const NUM_CELLS = 128;
const SCORES = (() => {
  const rng = makeRng(0x5EED);
  const scores = new Float64Array(NUM_CELLS);
  // A small range so ties are common, as they are in real conflict scores.
  for (let i = 0; i < NUM_CELLS; i++) scores[i] = (rng() >>> 0) % 8;
  return scores;
})();

// Pre-built unsorted lists, cycled through so each iteration sorts fresh input
// rather than re-sorting an already-ordered array.
const NUM_CASES = 64;
const makeCases = (n) => {
  const rng = makeRng(0xC0FFEE + n);
  const cases = new Array(NUM_CASES);
  for (let i = 0; i < NUM_CASES; i++) {
    const cells = new Array(n);
    for (let j = 0; j < n; j++) cells[j] = (rng() >>> 0) % NUM_CELLS;
    cases[i] = cells;
  }
  return cases;
};

let sink = 0;

benchGroup('micro::tiny_sort', () => {
  for (const n of [2, 3, 5, 9]) {
    const cases = makeCases(n);
    // One scratch list per variant, refilled each iteration so the measurement
    // is sort cost, not allocation of the input.
    const scratch = new Array(n);
    let caseIndex = 0;
    const nextCase = () => {
      const src = cases[caseIndex = (caseIndex + 1) % NUM_CASES];
      for (let i = 0; i < n; i++) scratch[i] = src[i];
      return scratch;
    };

    bench(`Array.sort with comparator n=${n}`, () => {
      const cells = nextCase();
      cells.sort((a, b) => SCORES[a] - SCORES[b]);
      sink ^= cells[0];
    }, { innerIterations: 20_000 });

    bench(`insertion sort in place n=${n}`, () => {
      const cells = nextCase();
      for (let i = 1; i < cells.length; i++) {
        const cell = cells[i];
        const score = SCORES[cell];
        let j = i - 1;
        for (; j >= 0 && SCORES[cells[j]] > score; j--) {
          cells[j + 1] = cells[j];
        }
        cells[j + 1] = cell;
      }
      sink ^= cells[0];
    }, { innerIterations: 20_000 });

    if (n === 2) {
      // The special case the insertion sort subsumes, kept to show it wins
      // nothing over the general loop at this size.
      bench(`compare and swap n=2`, () => {
        const cells = nextCase();
        const a = cells[0];
        const b = cells[1];
        if (SCORES[a] > SCORES[b]) {
          cells[0] = b;
          cells[1] = a;
        }
        sink ^= cells[0];
      }, { innerIterations: 20_000 });
    }
  }
});

await runIfMain(import.meta.url);

export const _benchSink = () => sink;
