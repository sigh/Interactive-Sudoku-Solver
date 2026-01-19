import { bench, benchGroup, runIfMain } from '../bench_harness.js';

// 9x9 Sudoku assumptions.
const NUM_CELLS = 81;
const NUM_VALUES = 9;

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

const buildGrid = (seed, fixedChance /* 0..1 */) => {
  const rng = makeRng(seed);
  const grid = new Uint16Array(NUM_CELLS);

  for (let i = 0; i < NUM_CELLS; i++) {
    // Use uint32 -> float in [0,1).
    const u = (rng() >>> 0) / 0x1_0000_0000;
    if (u < fixedChance) {
      grid[i] = 1 << ((rng() >>> 0) % NUM_VALUES);
      continue;
    }

    // Non-fixed: choose 2..5 bits.
    const targetBits = 2 + ((rng() >>> 0) % 4);
    let m = 0;
    while (m && (m & (m - 1)) === 0) m = 0; // paranoia, keep non-fixed
    while (popcount9(m) < targetBits) {
      m |= 1 << ((rng() >>> 0) % NUM_VALUES);
    }
    grid[i] = m;
  }

  return grid;
};

const popcount9 = (x) => {
  // x <= 511
  x = x - ((x >>> 1) & 0x5555);
  x = (x & 0x3333) + ((x >>> 2) & 0x3333);
  return (((x + (x >>> 4)) & 0x0F0F) * 0x0101) >>> 8;
};

const buildCellLists = (seed, len, count) => {
  const rng = makeRng(seed);
  const lists = new Array(count);

  for (let k = 0; k < count; k++) {
    const used = new Uint8Array(NUM_CELLS);
    const cells = new Uint8Array(len);
    let i = 0;
    while (i < len) {
      const c = (rng() >>> 0) % NUM_CELLS;
      if (used[c]) continue;
      used[c] = 1;
      cells[i++] = c;
    }
    lists[k] = cells;
  }

  return lists;
};

// Global sink to discourage dead-code elimination.
let sink = 0;

const scanMul = (grid, cells) => {
  let fixedValues = 0;
  let allValues = 0;
  let nonUniqueValues = 0;

  const numCells = cells.length;
  for (let i = 0; i < numCells; i++) {
    const v = grid[cells[i]];
    nonUniqueValues |= allValues & v;
    allValues |= v;
    fixedValues |= (!(v & (v - 1))) * v;
  }

  sink ^= (fixedValues ^ allValues ^ nonUniqueValues) | 0;
};

const scanBranch = (grid, cells) => {
  let fixedValues = 0;
  let allValues = 0;
  let nonUniqueValues = 0;

  const numCells = cells.length;
  for (let i = 0; i < numCells; i++) {
    const v = grid[cells[i]];
    nonUniqueValues |= allValues & v;
    allValues |= v;
    if ((v & (v - 1)) === 0) fixedValues |= v;
  }

  sink ^= (fixedValues ^ allValues ^ nonUniqueValues) | 0;
};

const scanMask = (grid, cells) => {
  let fixedValues = 0;
  let allValues = 0;
  let nonUniqueValues = 0;

  const numCells = cells.length;
  for (let i = 0; i < numCells; i++) {
    const v = grid[cells[i]];
    nonUniqueValues |= allValues & v;
    allValues |= v;
    fixedValues |= v & -((v & (v - 1)) === 0);
  }

  sink ^= (fixedValues ^ allValues ^ nonUniqueValues) | 0;
};

const scanBranchLowBit = (grid, cells) => {
  let fixedValues = 0;
  let allValues = 0;
  let nonUniqueValues = 0;

  const numCells = cells.length;
  for (let i = 0; i < numCells; i++) {
    const v = grid[cells[i]];
    nonUniqueValues |= allValues & v;
    allValues |= v;
    if ((v & -v) === v) fixedValues |= v;
  }

  sink ^= (fixedValues ^ allValues ^ nonUniqueValues) | 0;
};

const scanMaskLowBit = (grid, cells) => {
  let fixedValues = 0;
  let allValues = 0;
  let nonUniqueValues = 0;

  const numCells = cells.length;
  for (let i = 0; i < numCells; i++) {
    const v = grid[cells[i]];
    nonUniqueValues |= allValues & v;
    allValues |= v;
    fixedValues |= v & -((v & -v) === v);
  }

  sink ^= (fixedValues ^ allValues ^ nonUniqueValues) | 0;
};

benchGroup('micro::fixed_values_scan', () => {
  const grids = [
    ['mostly_nonfixed', buildGrid(0x11111111, 0.05)],
    ['mixed', buildGrid(0x22222222, 0.30)],
    ['mostly_fixed', buildGrid(0x33333333, 0.80)],
  ];

  const variants = [
    ['mul', scanMul],
    ['branch', scanBranch],
    ['mask', scanMask],
    ['branchLowBit', scanBranchLowBit],
    ['maskLowBit', scanMaskLowBit],
  ];

  for (let len = 2; len <= 9; len++) {
    const lists = buildCellLists(0xC0FFEE00 + len, len, /* count */ 256);
    let idx = 0;

    // Scale so total inner work is similar across lengths.
    const inner = Math.max(1, (50_000 / Math.max(1, len / 2)) | 0);

    for (const [gridLabel, grid] of grids) {
      for (const [variantLabel, variantFn] of variants) {
        bench(`len=${len} ${gridLabel} fixed=${variantLabel}`, () => {
          const cells = lists[idx++ & 255];
          variantFn(grid, cells);
        }, { innerIterations: inner });
      }
    }
  }
});

await runIfMain(import.meta.url);

export const _benchSink = () => sink;
