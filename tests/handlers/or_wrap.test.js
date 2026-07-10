import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createCellExclusions,
  OR_WRAP_MODES,
  assertOrWrapEquivalent,
  assertOrWrapNoStateLeak,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

// Adopts the Or-wrap harness (or-safety-invariants.md L3) on the §3 risk set:
// Sum (stateless / `full`), Rellik (`_forcedState`, row 4) and SameValues
// (short-circuit flag, row 5). Each handler is driven through the delta-replay,
// scratch-path and writeback machinery Or introduces, so a future writeback
// change that breaks I3/I4 fails here rather than deep inside a solve.

const { Sum } = await import('../../js/solver/sum_handler.js');
const { Rellik, SameValues } = await import('../../js/solver/handlers.js');

const uniqueCells = () => createCellExclusions({ allUnique: true });
const nonUniqueCells = () => createCellExclusions({ allUnique: false });

// Modes where the wrapped handler's result is the entire union, so pruning
// must match the unwrapped handler exactly.
const EQUIVALENCE_MODES = [OR_WRAP_MODES.FAST_PATH, OR_WRAP_MODES.FAILING_DECOY];

// A scenario is { makeContext, makeHandler, cellExclusions, candidates } where
// `candidates` prunes something at enforce (so equivalence is meaningful) while
// surviving initialize. `leakScenario` optionally overrides it for the
// live-decoy check when a different setup better exercises the state lanes.
const SCENARIOS = {
  Sum: {
    makeContext: () => new GridTestContext({ gridSize: [1, 4], numValues: 4 }),
    makeHandler: () => new Sum([0, 1, 2, 3], 14),
    cellExclusions: uniqueCells,
    candidates: { 0: [1, 2], 1: [2, 3], 2: [3, 4], 3: [4, 5] },
  },
  Rellik: {
    makeContext: () => new GridTestContext({ gridSize: [1, 4], numValues: 4 }),
    makeHandler: () => new Rellik([0, 1, 2], 5),
    cellExclusions: uniqueCells,
    // Cell 0 fixed to 2, so 2+3=5 (forbidden) prunes value 3 from cells 1, 2,
    // and the forbidden set is committed to Rellik's `_forcedState` lane.
    candidates: { 0: [2], 1: [1, 3, 4], 2: [1, 3, 4] },
  },
  SameValues: {
    makeContext: () => new GridTestContext({ gridSize: [1, 4], numValues: 4 }),
    makeHandler: () => new SameValues([0, 1], [2, 3]),
    cellExclusions: uniqueCells,
    candidates: { 0: [1, 2], 1: [2, 3], 2: [2, 3], 3: [2, 4] },
    // The 2-cell/2-set form above allocates no flag lane; the short-circuit
    // flag is only allocated for >2 sets of >2 unique cells. Use that form for
    // the leak check so the flag lane is actually exercised (row 5).
    leakScenario: {
      makeContext: () => new GridTestContext({ gridSize: [1, 9], numValues: 9 }),
      makeHandler: () => new SameValues([0, 1, 2], [3, 4, 5], [6, 7, 8]),
      cellExclusions: uniqueCells,
      candidates: Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [i, [1, 2, 3]])),
    },
  },
};

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  for (const mode of EQUIVALENCE_MODES) {
    await runTest(`${name} Or-wrap preserves pruning (${mode})`, () => {
      assertOrWrapEquivalent({ ...scenario, mode });
    });
  }

  await runTest(`${name} Or-wrap leaks no foreign state (liveDecoy)`, () => {
    assertOrWrapNoStateLeak(scenario.leakScenario ?? scenario);
  });
}

logSuiteComplete('Or-wrap harness adoption');
