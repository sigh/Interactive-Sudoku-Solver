import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { bench, benchGroup, runIfMain } from './bench_harness.js';

ensureGlobalEnvironment();

const { CellExclusions, HandlerSet } = await import('../../js/solver/engine.js' + self.VERSION_PARAM);
const { HandlerUtil } = await import('../../js/solver/handlers.js' + self.VERSION_PARAM);

const SHAPE_9x9 = {
  numCells: 81,
  numValues: 9,
  gridSize: 9,
  boxWidth: 3,
  boxHeight: 3,
};

// Keep inputs deterministic and avoid allocations inside timed sections.

const makeLCG = (seed) => {
  let s = seed >>> 0;
  return () => {
    // Numerical Recipes LCG.
    s = (1664525 * s + 1013904223) >>> 0;
    return s;
  };
};

const addUndirected = (exclusions, a, b) => {
  exclusions.addMutualExclusion(a, b);
  exclusions.addMutualExclusion(b, a);
};

const rowOf = (cell) => (cell / 9) | 0;
const colOf = (cell) => cell % 9;

const makeEmptyExclusions = () => {
  const handlerSet = new HandlerSet([], SHAPE_9x9);
  return new CellExclusions(handlerSet, SHAPE_9x9);
};

const addSudokuBaseEdges = (exclusions) => {
  // Rows.
  for (let r = 0; r < 9; r++) {
    const base = r * 9;
    for (let i = 0; i < 9; i++) {
      for (let j = i + 1; j < 9; j++) {
        addUndirected(exclusions, base + i, base + j);
      }
    }
  }
  // Columns.
  for (let c = 0; c < 9; c++) {
    for (let i = 0; i < 9; i++) {
      for (let j = i + 1; j < 9; j++) {
        addUndirected(exclusions, i * 9 + c, j * 9 + c);
      }
    }
  }
  // Boxes.
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const cells = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          cells.push((br * 3 + dr) * 9 + (bc * 3 + dc));
        }
      }
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          addUndirected(exclusions, cells[i], cells[j]);
        }
      }
    }
  }
};

const pickConnectedCells = ({ n, seed }) => {
  if (n <= 0) return [];
  const rng = makeLCG(seed);

  const chosen = new Set();
  const frontier = [];

  const start = rng() % 81;
  chosen.add(start);
  frontier.push(start);

  const neighbors = (cell) => {
    const r = rowOf(cell);
    const c = colOf(cell);
    const out = [];
    if (r > 0) out.push(cell - 9);
    if (r < 8) out.push(cell + 9);
    if (c > 0) out.push(cell - 1);
    if (c < 8) out.push(cell + 1);
    return out;
  };

  while (chosen.size < n) {
    const baseCell = frontier[rng() % frontier.length];
    const neigh = neighbors(baseCell);
    const next = neigh[rng() % neigh.length];
    if (!chosen.has(next)) {
      chosen.add(next);
      frontier.push(next);
    } else {
      // Occasional jump reduces stalls when region gets boxed in.
      if ((rng() & 31) === 0) {
        const jump = rng() % 81;
        if (!chosen.has(jump)) {
          chosen.add(jump);
          frontier.push(jump);
        }
      }
    }
  }

  return [...chosen].sort((a, b) => a - b);
};

const buildRandomExclusions = ({ cells, edgeProbability, seed }) => {
  const exclusions = makeEmptyExclusions();
  const rng = makeLCG(seed);
  const threshold = Math.max(0, Math.min(1, edgeProbability));
  const thresholdInt = (threshold * 0xFFFFFFFF) >>> 0;

  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (rng() <= thresholdInt) {
        addUndirected(exclusions, cells[i], cells[j]);
      }
    }
  }

  // Warm caches once so the benchmark measures steady-state behavior.
  for (const c of cells) exclusions.getBitSet(c);
  return exclusions;
};

const buildSudokuLikeExclusions = ({ regionCells, allDifferentRegion, extraEdgeProbability, seed }) => {
  const exclusions = makeEmptyExclusions();
  addSudokuBaseEdges(exclusions);

  if (allDifferentRegion) {
    for (let i = 0; i < regionCells.length; i++) {
      for (let j = i + 1; j < regionCells.length; j++) {
        addUndirected(exclusions, regionCells[i], regionCells[j]);
      }
    }
  }

  if (extraEdgeProbability && extraEdgeProbability > 0) {
    const rng = makeLCG(seed);
    const threshold = Math.max(0, Math.min(1, extraEdgeProbability));
    const thresholdInt = (threshold * 0xFFFFFFFF) >>> 0;

    for (let i = 0; i < regionCells.length; i++) {
      for (let j = i + 1; j < regionCells.length; j++) {
        if (rng() <= thresholdInt) {
          addUndirected(exclusions, regionCells[i], regionCells[j]);
        }
      }
    }
  }

  for (const c of regionCells) exclusions.getBitSet(c);
  return exclusions;
};

benchGroup('solver::exclusion_groups', () => {
  // Random graphs (stress cases).
  {
    const cells = Array.from({ length: 32 }, (_, i) => i);
    const exclusions = buildRandomExclusions({ cells, edgeProbability: 0.25, seed: 0xC0FFEE });
    const label = 'findExclusionGroupsGreedy(random n=32 p=0.25)';
    bench(`${label} (FIRST)`, () => {
      HandlerUtil.findExclusionGroupsGreedy(cells, exclusions, HandlerUtil.GREEDY_STRATEGY_FIRST);
    }, { innerIterations: 2_000, minSampleTimeMs: 10 });
    bench(`${label} (BEST)`, () => {
      HandlerUtil.findExclusionGroupsGreedy(cells, exclusions, HandlerUtil.GREEDY_STRATEGY_BEST);
    }, { innerIterations: 2_000, minSampleTimeMs: 10 });
  }

  {
    const cells = Array.from({ length: 81 }, (_, i) => i);
    const exclusions = buildRandomExclusions({ cells, edgeProbability: 0.25, seed: 0xBADC0DE });
    const label = 'findExclusionGroupsGreedy(random n=81 p=0.25)';
    bench(`${label} (FIRST)`, () => {
      HandlerUtil.findExclusionGroupsGreedy(cells, exclusions, HandlerUtil.GREEDY_STRATEGY_FIRST);
    }, { innerIterations: 300, minSampleTimeMs: 10 });
    bench(`${label} (BEST)`, () => {
      HandlerUtil.findExclusionGroupsGreedy(cells, exclusions, HandlerUtil.GREEDY_STRATEGY_BEST);
    }, { innerIterations: 300, minSampleTimeMs: 10 });
  }

  // Sudoku-like regions (more representative of sum regions).
  const mkRegionBench = ({ regionSize, allDifferent, extraP, seed }) => {
    const regionCells = pickConnectedCells({ n: regionSize, seed });
    const exclusions = buildSudokuLikeExclusions({
      regionCells,
      allDifferentRegion: allDifferent,
      extraEdgeProbability: extraP,
      seed,
    });

    const label = [
      allDifferent ? 'killer' : 'cage',
      `n=${regionSize}`,
      extraP ? `extras=${extraP}` : null,
    ].filter(Boolean).join(' ');

    const base = `findExclusionGroupsGreedy(${label})`;
    bench(`${base} (FIRST)`, () => {
      HandlerUtil.findExclusionGroupsGreedy(regionCells, exclusions, HandlerUtil.GREEDY_STRATEGY_FIRST);
    }, { innerIterations: 5_000, minSampleTimeMs: 10 });
    bench(`${base} (BEST)`, () => {
      HandlerUtil.findExclusionGroupsGreedy(regionCells, exclusions, HandlerUtil.GREEDY_STRATEGY_BEST);
    }, { innerIterations: 5_000, minSampleTimeMs: 10 });
  };

  mkRegionBench({ regionSize: 8, allDifferent: false, extraP: 0, seed: 0x11111111 });
  mkRegionBench({ regionSize: 12, allDifferent: false, extraP: 0, seed: 0x22222222 });
  mkRegionBench({ regionSize: 16, allDifferent: false, extraP: 0, seed: 0x33333333 });
  mkRegionBench({ regionSize: 8, allDifferent: true, extraP: 0, seed: 0x44444444 });
  mkRegionBench({ regionSize: 12, allDifferent: true, extraP: 0, seed: 0x55555555 });
  mkRegionBench({ regionSize: 16, allDifferent: true, extraP: 0, seed: 0x66666666 });
  mkRegionBench({ regionSize: 16, allDifferent: false, extraP: 0.10, seed: 0x77777777 });
  mkRegionBench({ regionSize: 16, allDifferent: true, extraP: 0.10, seed: 0x88888888 });
});

await runIfMain(import.meta.url);
