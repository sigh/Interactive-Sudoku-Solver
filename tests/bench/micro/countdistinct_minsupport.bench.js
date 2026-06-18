import { bench, benchGroup, runIfMain } from '../micro_bench_harness.js';

// Microbench: CountDistinct min-support kernel (§4.2). Isolates the work that
// computes which values can appear when the control is pinned to minD, so the
// cost is measurable above whole-solve noise. Compares:
//   - swap:          current branchless single-swap rule
//   - swap-branched: same rule with the data-dependent `if` (measures the branch)
//   - packing:       the old per-value `_packing(fixedMask|v)` approach
// All three start from the same base greedy packing.

let sink = 0;
const consume = (x) => { sink ^= (x | 0); };

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0);
};

// Representative inputs: CountDistinct counted cells on a 9-value grid mid-search
// — a handful of unfixed cells with 2–5 candidates each, plus a few fixed values.
const NUM_VALUES = 9;
const ALL = (1 << NUM_VALUES) - 1;
const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

const SCENARIOS = (() => {
  const rng = makeLCG(0xC0FFEE);
  const out = [];
  for (let s = 0; s < 512; s++) {
    const nu = 3 + (rng() % 6);            // 3..8 unfixed cells
    const doms = new Uint16Array(nu);
    for (let i = 0; i < nu; i++) {
      let d = 0;
      const k = 2 + (rng() % 4);           // 2..5 candidates
      while (popcount(d) < k) d |= 1 << (rng() % NUM_VALUES);
      doms[i] = d;
    }
    let fixedMask = 0;
    const nf = rng() % 3;                   // 0..2 fixed values
    for (let i = 0; i < nf; i++) fixedMask |= 1 << (rng() % NUM_VALUES);
    out.push({ doms, nu, fixedMask });
  }
  return out;
})();
const SCN_MASK = SCENARIOS.length - 1;     // 512 is a power of two

const ownerDom = new Uint16Array(16);

// Shared base packing: builds ownerDom (value -> covering picked domain) and
// returns packUsed. packBase = popcount of picked domains (not needed here).
const basePack = (doms, nu, fixedMask) => {
  ownerDom.fill(0);
  let packUsed = fixedMask;
  for (let i = 0; i < nu; i++) {
    const d = doms[i];
    if (d & packUsed) continue;
    let m = d;
    while (m) { const v = m & -m; m ^= v; ownerDom[31 - Math.clz32(v)] = d; }
    packUsed |= d;
  }
  return packUsed;
};

const swap = (doms, nu, fixedMask) => {
  const packUsed = basePack(doms, nu, fixedMask);
  let supportedMask = packUsed;
  for (let q = 0; q < nu; q++) {
    const b = doms[q] & packUsed;
    const nod = ~ownerDom[31 - Math.clz32(b)];
    supportedMask &= (b | nod) | -((b & nod) !== 0);
  }
  return supportedMask & ALL;
};

const swapBranched = (doms, nu, fixedMask) => {
  const packUsed = basePack(doms, nu, fixedMask);
  let supportedMask = packUsed;
  for (let q = 0; q < nu; q++) {
    const dq = doms[q];
    const b = dq & packUsed;
    const od = ownerDom[31 - Math.clz32(b)];
    if ((b & ~od) === 0) supportedMask &= dq | ~od;
  }
  return supportedMask & ALL;
};

// Old approach: base packing, then one greedy packing per candidate value.
const packingCount = (doms, nu, used) => {
  let c = 0;
  for (let i = 0; i < nu; i++) { const d = doms[i]; if (d & used) continue; c++; used |= d; }
  return c;
};
const packing = (doms, nu, fixedMask) => {
  const packBase = packingCount(doms, nu, fixedMask);
  let union = 0;
  for (let i = 0; i < nu; i++) union |= doms[i];
  let supportedMask = fixedMask & union;          // fixed values always supported
  let cand = union & ~fixedMask;
  while (cand) {
    const v = cand & -cand; cand ^= v;
    if (1 + packingCount(doms, nu, fixedMask | v) <= packBase) supportedMask |= v;
  }
  return supportedMask & ALL;
};

// Sanity: the branchless form must match the branched form exactly. (swap and
// the old packing rule are sound but *incomparable* heuristics — each prunes
// some values the other keeps — so they are not compared here.)
for (const { doms, nu, fixedMask } of SCENARIOS) {
  const a = swap(doms, nu, fixedMask);
  const b = swapBranched(doms, nu, fixedMask);
  if (a !== b) throw new Error(`swap != swapBranched: ${a.toString(2)} ${b.toString(2)}`);
}

benchGroup('micro::countdistinct_minsupport', () => {
  {
    let i = 0;
    bench('swap (branchless)', () => {
      const s = SCENARIOS[i++ & SCN_MASK];
      consume(swap(s.doms, s.nu, s.fixedMask));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }
  {
    let i = 0;
    bench('swap-branched', () => {
      const s = SCENARIOS[i++ & SCN_MASK];
      consume(swapBranched(s.doms, s.nu, s.fixedMask));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }
  {
    let i = 0;
    bench('per-value packing (old)', () => {
      const s = SCENARIOS[i++ & SCN_MASK];
      consume(packing(s.doms, s.nu, s.fixedMask));
    }, { innerIterations: 1_000_000, minSampleTimeMs: 25 });
  }
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
