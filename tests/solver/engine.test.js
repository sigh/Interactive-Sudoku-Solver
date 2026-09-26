import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { SudokuSolver, HandlerSet } = await import('../../js/solver/engine.js');
const { SamplingCandidateSelector } = await import('../../js/solver/candidate_selector.js');
const { BitSet } = await import('../../js/util.js');
const {
  SudokuConstraintHandler,
  AllDifferent,
  SearchPriority,
  UniqueValueExclusion,
} = await import('../../js/solver/handlers.js');

// ============================================================================
// Test Data
// ============================================================================

// Easy classic 9x9 with unique solution.
const makeEasyClassicConstraint = () => {
  const givens = [
    ['R1C1', 5], ['R1C2', 3], ['R1C5', 7],
    ['R2C1', 6], ['R2C4', 1], ['R2C5', 9], ['R2C6', 5],
    ['R3C2', 9], ['R3C3', 8], ['R3C8', 6],
    ['R4C1', 8], ['R4C5', 6], ['R4C9', 3],
    ['R5C1', 4], ['R5C4', 8], ['R5C6', 3], ['R5C9', 1],
    ['R6C1', 7], ['R6C5', 2], ['R6C9', 6],
    ['R7C2', 6], ['R7C7', 2], ['R7C8', 8],
    ['R8C4', 4], ['R8C5', 1], ['R8C6', 9], ['R8C9', 5],
    ['R9C5', 8], ['R9C8', 7], ['R9C9', 9],
  ];
  return new SudokuConstraint.Container(
    givens.map(([cell, value]) => new SudokuConstraint.Given(cell, value))
  );
};

const EASY_SOLUTION = [5, 3, 4, 6, 7, 8, 9, 1, 2, 6, 7, 2, 1, 9, 5, 3, 4, 8, 1, 9, 8, 3, 4, 2, 5, 6, 7, 8, 5, 9, 7, 6, 1, 4, 2, 3, 4, 2, 6, 8, 5, 3, 7, 9, 1, 7, 1, 3, 9, 2, 4, 8, 5, 6, 9, 6, 1, 5, 3, 7, 2, 8, 4, 2, 8, 7, 4, 1, 9, 6, 3, 5, 3, 4, 5, 2, 8, 6, 1, 7, 9];

const makeEmptyGridConstraint = (shape) => {
  return new SudokuConstraint.Container([new SudokuConstraint.Shape(shape)]);
};

// 4x4 with one given — has multiple solutions.
const makeMultiSolutionConstraint = () => {
  return new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.Given('R1C1', 1),
  ]);
};

// Contradictory puzzle: two givens in same cell.
const makeContradictoryConstraint = () => {
  return new SudokuConstraint.Container([
    new SudokuConstraint.Given('R1C1', 1),
    new SudokuConstraint.Given('R1C2', 1),
    new SudokuConstraint.Given('R1C3', 1),
  ]);
};

const buildSolver = (constraint, debugOptions) => {
  return SudokuBuilder.build(constraint, debugOptions);
};

class ExtraStateHandler extends SudokuConstraintHandler {
  constructor() {
    super([0]);
  }

  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    stateAllocator.allocate([0]);
    return true;
  }
}

class FixedPriorityHandler extends SudokuConstraintHandler {
  constructor(cells, priority) {
    super(cells);
    this._priority = priority;
  }

  priority() {
    return this._priority;
  }
}

class LinkedCellsHandler extends SudokuConstraintHandler {
  constructor(links) {
    super([]);
    this._links = Uint16Array.from(links);
  }

  linkedSearchCells() {
    return this._links;
  }
}

class WatchedCellExpandingHandler extends FixedPriorityHandler {
  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    this.cells = Uint8Array.from([0, 2]);
    return true;
  }
}
// ============================================================================
// countSolutions
// ============================================================================

await runTest('countSolutions returns 1 for unique puzzle', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  assert.equal(solver.countSolutions(), 1);
});

await runTest('countSolutions returns 0 for contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  assert.equal(solver.countSolutions(), 0);
});

await runTest('countSolutions returns multiple for under-constrained puzzle', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const count = solver.countSolutions();
  assert.ok(count > 1, `Expected multiple solutions, got ${count}`);
});

await runTest('countSolutions respects limit', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const count = solver.countSolutions(2);
  assert.equal(count, 2);
});

await runTest('countSolutions with limit=1 stops after first', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  assert.equal(solver.countSolutions(1), 1);
});

// ============================================================================
// nthSolution
// ============================================================================

await runTest('nthSolution(0) returns first solution', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const solution = solver.nthSolution(0);
  assert.ok(solution);
  assert.deepEqual([...solution], EASY_SOLUTION);
});

await runTest('nthSolution returns null for contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  assert.equal(solver.nthSolution(0), null);
});

await runTest('nthSolution sequential: n=0 then n=1 on unique puzzle', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const s0 = solver.nthSolution(0);
  const s1 = solver.nthSolution(1);
  assert.ok(s0);
  assert.ok(s1);
  // Different solutions (multi-solution puzzle).
  assert.notDeepEqual([...s0], [...s1]);
});

await runTest('nthSolution(0) can be called multiple times', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const s1 = solver.nthSolution(0);
  const s2 = solver.nthSolution(0);
  assert.deepEqual([...s1], [...s2]);
});

// ============================================================================
// solveAllPossibilities
// ============================================================================

await runTest('solveAllPossibilities returns Uint8Array', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const result = solver.solveAllPossibilities();
  assert.ok(result instanceof Uint8Array);
});

await runTest('solveAllPossibilities unique puzzle has exactly one candidate per cell', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const result = solver.solveAllPossibilities();
  const numValues = 9;
  // Each cell should have exactly one non-zero entry.
  for (let cell = 0; cell < 81; cell++) {
    let nonZeroCount = 0;
    for (let v = 0; v < numValues; v++) {
      if (result[cell * numValues + v] > 0) nonZeroCount++;
    }
    assert.equal(nonZeroCount, 1, `Cell ${cell} should have exactly 1 candidate`);
  }
});

await runTest('solveAllPossibilities multi-solution puzzle has multiple candidates', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const result = solver.solveAllPossibilities();
  const numValues = 4;
  // At least one cell should have multiple candidates.
  let foundMultiple = false;
  for (let cell = 0; cell < 16; cell++) {
    let nonZeroCount = 0;
    for (let v = 0; v < numValues; v++) {
      if (result[cell * numValues + v] > 0) nonZeroCount++;
    }
    if (nonZeroCount > 1) { foundMultiple = true; break; }
  }
  assert.ok(foundMultiple, 'Expected at least one cell with multiple candidates');
});

await runTest('three arrows complete true candidates without exploring redundant subtrees', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Arrow('R3C3', 'R2C2', 'R1C2', 'R2C1'),
    new SudokuConstraint.Arrow('R2C6', 'R3C7', 'R3C8', 'R3C9'),
    new SudokuConstraint.Arrow('R4C3', 'R5C2', 'R5C1', 'R6C1'),
  ]);
  const solver = buildSolver(constraint);
  solver.setProgressCallback(() => {
    assert.ok(solver.state().counters.guesses < 50000,
      'required shaft digits should prune subtrees before candidate search stalls');
  }, 10);
  const counts = solver.solveAllPossibilities();
  // Independently checked by pinning all 729 cell/value pairs in the original
  // solver. These two witnesses appear after the original search first stalls.
  assert.equal([...counts].filter(Boolean).length, 687);
  assert.equal(counts[14 * 9 + 8], 1, 'R2C6=9 is supported');
  assert.equal(counts[6 * 9], 1, 'R1C7=1 is supported');
  assert.equal(solver.state().done, true);
});

// ============================================================================
// validateLayout
// ============================================================================

await runTest('validateLayout returns solution for valid standard layout', () => {
  // Empty 9x9 (no givens) should be a valid layout.
  const constraint = new SudokuConstraint.Container([]);
  const solver = buildSolver(constraint);
  const result = solver.validateLayout();
  assert.ok(result, 'Standard 9x9 should be a valid layout');
});

// ============================================================================
// estimatedCountSolutions
// ============================================================================

await runTest('estimatedCountSolutions returns a positive estimate for a valid puzzle', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const estimate = solver.estimatedCountSolutions(50);
  assert.equal(typeof estimate, 'number');
  assert.ok(estimate > 0, `Expected positive estimate, got ${estimate}`);
});

await runTest('estimatedCountSolutions returns 0 for a contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  const estimate = solver.estimatedCountSolutions(50);
  assert.equal(estimate, 0);
});

await runTestCases('estimation completion describes the whole puzzle', [
  ['solution without guesses', makeEasyClassicConstraint, 1, true, 1, false],
  ['contradiction without guesses', makeContradictoryConstraint, 1, true, 0, false],
  ['exact root tail', makeMultiSolutionConstraint, 1000, true, 72, true],
  ['sample cap after a plain path', () => makeEmptyGridConstraint('4x4'), 1, false, null, false],
  ['sample cap after a completed tail', () => makeEmptyGridConstraint('4x4'), 192, false, null, true],
], (constraint, maxSamples, exact, expectedCount, countedTail) => {
  const solver = buildSolver(constraint());
  const internal = solver._internalSolver;
  const estimateSample = internal._estimateSample;
  let lastSample;
  internal._estimateSample = function (...args) {
    return lastSample = estimateSample.apply(this, args);
  };
  const updates = [];
  solver.setProgressCallback(() => updates.push(solver.state()), 1);
  const result = solver.estimatedCountSolutions(maxSamples);
  const finalState = solver.state();
  assert.equal(lastSample.countedTail, countedTail, 'the last sample must exercise the intended exit');
  assert.equal(finalState.done, exact);
  assert.equal(finalState.estimate.exact, exact);
  assert.equal(finalState.estimate.solutions, result);
  if (expectedCount !== null) assert.equal(result, expectedCount);
  if (!exact) assert.equal(finalState.estimate.samples, maxSamples);
  assert.deepEqual(updates.at(-1).estimate, finalState.estimate);
  assert.equal(updates.at(-1).done, finalState.done);
  for (const state of updates) {
    assert.equal(state.done, state.estimate.exact, 'progress must not expose subtree completion');
  }
});

await runTest('internal estimation creates a fresh, fully initialized result on each call', () => {
  const internal = buildSolver(makeMultiSolutionConstraint())._internalSolver;
  internal.estimatedCountSolutions(1000);
  const previous = internal.estimationState;
  const saved = { ...previous };
  assert.equal(previous.exact, true);

  let initial;
  internal.setProgressCallback(() => { initial ??= { ...internal.estimationState }; }, 1);
  internal.estimatedCountSolutions(1);
  assert.deepEqual(initial, { solutions: 0, samples: 0, tails: 0, exact: false });
  assert.notEqual(internal.estimationState, previous);
  assert.deepEqual(previous, saved);
  assert.equal(internal.estimationState.samples, 1);
  assert.equal(internal.estimationState.exact, false);
});

await runTest('state retains an estimate after completion and resets it for another operation', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const updates = [];
  solver.setProgressCallback(() => updates.push(solver.state()), 13);

  assert.equal(solver.estimatedCountSolutions(1000), 72);
  const finalState = solver.state();
  assert.equal(finalState.estimate.solutions, 72);
  assert.equal(finalState.estimate.exact, true);
  assert.deepEqual(finalState.estimate, updates.at(-1).estimate);
  assert.notEqual(finalState.estimate, updates.at(-1).estimate, 'snapshots own their estimate');
  assert.equal(updates[0].estimate.exact, false, 'earlier snapshots must not change');

  solver.estimatedCountSolutions(1);
  assert.equal(solver.state().estimate.exact, false);
  assert.equal(solver.state().estimate.samples, 1);
  solver._internalSolver.reset();
  assert.equal(solver.state().estimate, undefined, 'the internal solver owns the estimate lifecycle');
  solver.estimatedCountSolutions(1);
  solver.countSolutions();
  assert.equal(solver.state().estimate, undefined, 'other operations must not carry an old estimate');
  assert.equal(finalState.estimate.exact, true, 'later runs must not change saved snapshots');
});

await runTest('estimatedCountSolutions counts a small tree exactly', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const estimate = solver.estimatedCountSolutions(1000);
  const { estimate: counters, done } = solver.state();
  assert.equal(estimate, 72);
  assert.equal(done, true);
  assert.equal(counters.exact, true);
  assert.equal(counters.solutions, 72);
  assert.ok(counters.samples > 0 && counters.samples < 1000, `samples=${counters.samples}`);
});

await runTest('estimatedCountSolutions samples a large tree', () => {
  const solver = buildSolver(makeEmptyGridConstraint('6x6'));
  const estimate = solver.estimatedCountSolutions(100);
  const { estimate: counters, done } = solver.state();
  const truth = 28200960;
  assert.equal(counters.exact, false);
  assert.equal(done, false);
  assert.equal(counters.samples, 100);
  assert.equal(counters.solutions, estimate);
  // Deterministic (fixed seed); a loose bound catches a broken estimator.
  assert.ok(Math.abs(estimate / truth - 1) < 0.5, `Expected within 50% of ${truth}, got ${estimate}`);
});

// Replays a choice sequence and advances it like an odometer, so a sample
// can be run once per possible sequence of random choices.
class EnumeratingOptionSelector {
  constructor() { this.choices = []; this.counts = []; this.i = 0; }
  selectValue(values, count) {
    const i = this.i++;
    if (i >= this.choices.length) this.choices.push(0);
    this.counts[i] = count;
    let n = this.choices[i];
    while (n--) values &= values - 1;
    return values & -values;
  }
  probability() { return this.counts.slice(0, this.i).reduce((p, c) => p / c, 1); }
  advance() {
    let j = this.i - 1;
    while (j >= 0 && this.choices[j] + 1 >= this.counts[j]) j--;
    if (j < 0) return false;
    this.choices[j]++;
    this.choices.length = j + 1;
    this.i = 0;
    return true;
  }
}

await runTestCases('estimatedCountSolutions sample rule is exactly unbiased', [
  ['plain path', Infinity, 1],
  ['tail at root, ample budget', 0, 1e9],
  ['tail at depth 1, budget 4 (some tails fail and retry)', 1, 4],
  ['tail at depth 2, budget 2', 2, 2],
  ['tail at depth 3, budget 1 (fails, retries once, then plain)', 3, 1],
], (tailDepth, budget) => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  const internal = solver._internalSolver;
  const exactSelector = internal._candidateSelector;
  const sampler = new SamplingCandidateSelector(
    internal._geometry, internal._numSearchCells, internal._handlerSet, internal._debugLogger);
  const options = new EnumeratingOptionSelector();
  sampler._optionSelector = options;
  let expectation = 0, runs = 0;
  do {
    internal.reset();  // Same starting state (conflict scores) every run.
    const sample = internal._estimateSample(
      sampler, exactSelector, tailDepth, budget, { observe() { } });
    expectation += options.probability() * sample.solutions;
    assert.equal(sample.exact, tailDepth === 0);
    assert.equal(sampler.hasTail, false, 'no exact search remains pending');
    if (tailDepth === 0) assert.equal(sample.countedTail, true);
    if (tailDepth === Infinity) assert.equal(sample.countedTail, false);
    runs++;
  } while (options.advance());
  if (tailDepth === 0) {
    assert.equal(runs, 1, 'a root tail must not consume a random choice');
  } else {
    assert.ok(runs > 1, 'the sampled prefix must branch');
  }
  assert.ok(Math.abs(expectation - 72) < 1e-9, `E[sample] = ${expectation} over ${runs} runs, expected 72`);
});

await runTest('estimatedCountSolutions aggregation remains finite across many levels', () => {
  const internal = buildSolver(makeMultiSolutionConstraint())._internalSolver;
  internal._estimateSample = () => {
    internal.counters.backtracks++;
    return { solutions: 1, exact: false, countedTail: false };
  };
  const estimate = internal.estimatedCountSolutions(66000);
  assert.equal(estimate, 1);
});

await runTest('estimatedCountSolutions weights successive levels even with a partial final level', () => {
  const internal = buildSolver(makeMultiSolutionConstraint())._internalSolver;
  const samples = [...Array(64).fill(10), ...Array(64).fill(20), 30];
  let sampleIndex = 0;
  internal._estimateSample = () => ({
    solutions: samples[sampleIndex++], exact: false, countedTail: false,
  });
  // 64 samples at weight 1, 64 at weight 2, and one at weight 4.
  const expected = (64 * 10 + 128 * 20 + 4 * 30) / (64 + 128 + 4);
  assert.equal(internal.estimatedCountSolutions(129), expected);
});

await runTest('estimatedCountSolutions restores solver state when a nested run throws', () => {
  const internal = buildSolver(makeMultiSolutionConstraint())._internalSolver;
  const initialGridState = internal._initialGridState;
  const candidateSelector = internal._candidateSelector;
  const sampler = new SamplingCandidateSelector(
    internal._geometry, internal._numSearchCells, internal._handlerSet, internal._debugLogger);
  const tailState = initialGridState.slice();
  const run = internal.run;
  internal.run = () => {
    assert.equal(internal._candidateSelector, sampler);
    assert.equal(internal._initialGridState, tailState);
    throw new Error('test error');
  };
  try {
    assert.throws(
      () => internal._runFrom(tailState, sampler, 1, () => {}),
      /test error/);
    assert.equal(internal._initialGridState, initialGridState);
    assert.equal(internal._candidateSelector, candidateSelector);
  } finally {
    internal.run = run;
  }
});

await runTestCases('solution operations clear their progress producer on failure',
  ['countSolutions', 'estimatedCountSolutions', 'solveAllPossibilities'].flatMap(method =>
    ['search', 'progress', 'final progress'].map(stage => [`${method}: ${stage}`, method, stage])),
  (method, stage) => {
    const solver = buildSolver(stage === 'progress'
      ? makeMultiSolutionConstraint() : makeEasyClassicConstraint());
    const error = new Error('test operation failure');
    if (stage === 'search') {
      solver._internalSolver.run = () => { throw error; };
    } else {
      solver.setProgressCallback(() => {
        assert.notEqual(solver._progressExtraStateFn, null);
        assert.equal(solver.state().done, stage === 'final progress');
        throw error;
      }, stage === 'progress' ? 1 : undefined);
    }
    assert.throws(() => solver[method](), e => e === error);
    assert.equal(solver._progressExtraStateFn, null);
  });

await runTest('estimatedCountSolutions with a frozen budget is plain Knuth sampling', () => {
  const solver = buildSolver(makeEmptyGridConstraint('6x6'));
  const InternalSolver = solver._internalSolver.constructor;
  const saved = InternalSolver.ESTIMATE_SAMPLES_PER_LEVEL;
  InternalSolver.ESTIMATE_SAMPLES_PER_LEVEL = Infinity;
  try {
    const estimate = solver.estimatedCountSolutions(200);
    const counters = solver.state().estimate;
    assert.equal(counters.tails, 0);
    assert.equal(counters.samples, 200);
    const replay = buildSolver(makeEmptyGridConstraint('6x6'))._internalSolver;
    const sampler = new SamplingCandidateSelector(
      replay._geometry, replay._numSearchCells, replay._handlerSet, replay._debugLogger);
    replay._candidateSelector = sampler;
    let sum = 0;
    for (let i = 0; i < 200; i++) {
      replay._resetRun();
      sampler.startSample(Infinity);
      let found = false;
      replay.run({ maxBacktracks: replay.counters.backtracks + 1 }, () => { found = true; });
      if (found) sum += sampler.getPathWeight();
    }
    assert.equal(estimate, sum / 200);
  } finally {
    InternalSolver.ESTIMATE_SAMPLES_PER_LEVEL = saved;
  }
});

await runTest('estimatedCountSolutions seeds give different, deterministic sequences', () => {
  const constraint = makeEmptyGridConstraint('6x6');
  const run = (seed) => buildSolver(constraint)._internalSolver.estimatedCountSolutions(30, seed);
  assert.equal(run(1), run(1));
  assert.notEqual(run(1), run(2));
});

await runTest('estimatedCountSolutions is deterministic (fixed seed)', () => {
  const constraint = makeEmptyGridConstraint('6x6');
  const estimate1 = buildSolver(constraint).estimatedCountSolutions(20);
  const estimate2 = buildSolver(constraint).estimatedCountSolutions(20);
  assert.equal(estimate1, estimate2);
});

// ============================================================================
// nthStep
// ============================================================================

await runTest('nthStep(0) returns initial state', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const step = solver.nthStep(0, new Map());
  assert.ok(step);
  assert.ok(step.pencilmarks);
  assert.ok('isSolution' in step);
  assert.ok('hasConflict' in step);
  assert.ok(step.branchCells);
});

await runTest('nthStep returns null for contradictory puzzle', () => {
  const solver = buildSolver(makeContradictoryConstraint());
  const step = solver.nthStep(0, new Map());
  // Step 0 should still return something (initial propagation may find conflict).
  if (step) {
    assert.equal(step.hasConflict, true);
  }
});

const KILLER_HARD =
  'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<';
const GERMAN_WHISPERS =
  '.Whisper~R8C1~R7C1~R7C2~R8C3~R9C3~R9C2.Whisper~R9C6~R8C7~R7C7~R7C8~R6C9~R5C8.Whisper~R6C3~R5C2~R4C3~R3C4~R2C5~R1C6~R1C7~R2C8~R3C8~R4C7~R5C6~R6C6~R7C6~R8C5~R7C4.Whisper~R4C5~R4C6~R3C7.~R1C5_1~R2C2_5~R5C1_6~R5C9_9~R7C3_3~R8C8_3~R9C1_5~R9C5_3';
const makeStepSolver = (input = KILLER_HARD) => SudokuBuilder.build(
  SudokuBuilder.resolveConstraint(SudokuParser.parseText(input)));

await runTestCases('nthStep in any order matches a fresh solver', [
  ['killer', KILLER_HARD],
  ['german whispers', GERMAN_WHISPERS],
], (input) => {
  const solver = makeStepSolver(input);
  const guides = new Map();
  const check = (n) => {
    const step = solver.nthStep(n, guides);
    assert.deepEqual(step, makeStepSolver(input).nthStep(n, guides), `step ${n}`);
    return step;
  };

  for (let n = 0; n <= 60; n++) check(n);
  // Guide the displayed step, as alt-clicking a cell does, then move on
  // without refetching it.
  const step = check(60);
  const cell = step.pencilmarks.findIndex(v => v instanceof Set);
  guides.set(60, { cell, depth: step.branchCells.length - 1 });
  for (let n = 61; n <= 100; n++) check(n);
  check(60);

  check(400);
  check(50);
  check(51);
  assert.equal(solver.nthStep(1e6, guides), null);
  check(120);
});

await runTest('nthStep continues forward instead of restarting', () => {
  const solver = makeStepSolver();
  let resets = 0;
  const reset = solver._internalSolver.reset.bind(solver._internalSolver);
  solver._internalSolver.reset = () => { resets++; reset(); };

  for (let n = 0; n <= 100; n++) solver.nthStep(n, new Map());
  solver.nthStep(500, new Map());
  assert.equal(resets, 1);

  solver.nthStep(50, new Map());
  assert.equal(resets, 2, 'going back restarts');
});

await runTest('nthStep debug logs support extra solver state', () => {
  const geometry = CellGeometry.fromGridSize(9);
  const solver = new SudokuSolver([new ExtraStateHandler()], geometry, { logLevel: 1 });
  const step = solver.nthStep(0, new Map());
  assert.ok(step);
});

// ============================================================================
// state()
// ============================================================================

await runTest('state() returns correct geometry before solving', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  const state = solver.state();
  assert.ok(state);
  assert.ok('counters' in state);
  assert.ok('timeMs' in state);
  assert.ok('done' in state);
  assert.equal(state.done, false);
  assert.equal(state.counters.solutions, 0);
});

await runTest('state() reflects completion after counting', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  solver.countSolutions();
  const state = solver.state();
  assert.equal(state.done, true);
  assert.equal(state.counters.solutions, 1);
  assert.ok(state.timeMs >= 0);
});

await runTest('state() counters include expected fields', () => {
  const solver = buildSolver(makeEasyClassicConstraint());
  solver.countSolutions();
  const { counters } = solver.state();
  assert.equal(typeof counters.valuesTried, 'number');
  assert.equal(typeof counters.nodesSearched, 'number');
  assert.equal(typeof counters.backtracks, 'number');
  assert.equal(typeof counters.guesses, 'number');
  assert.equal(typeof counters.solutions, 'number');
  assert.equal(typeof counters.constraintsProcessed, 'number');
});

// ============================================================================
// Cell priorities
// ============================================================================

await runTest('cell priorities sum handler priorities and apply explicit overrides', () => {
  const geometry = CellGeometry.fromGridSize(2);
  const solver = new SudokuSolver([
    new FixedPriorityHandler([0, 1], 4),
    new FixedPriorityHandler([1, 2], 3),
    new SearchPriority([1, 3], 12),
  ], geometry);

  const priorities = solver._internalSolver._cellPriorities;
  assert.equal(priorities[0], 4);
  assert.equal(priorities[1], 12);
  assert.equal(priorities[2], 3);
  assert.equal(priorities[3], 12);
});

await runTest('cell priorities are computed before initialization expands watched cells', () => {
  const geometry = CellGeometry.fromGridSize(2);
  const solver = new SudokuSolver([
    new WatchedCellExpandingHandler([0], 5),
  ], geometry);

  const priorities = solver._internalSolver._cellPriorities;
  assert.equal(priorities[0], 5);
  assert.equal(priorities[2], 0);
});

await runTest('cell priorities boost linked cell pairs', () => {
  const geometry = CellGeometry.fromGridSize(2);
  geometry.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const regionCells = geometry.varCellsForGroup('CC');

  const solver = new SudokuSolver([
    new LinkedCellsHandler([
      0, regionCells[0],
      1, regionCells[1],
      2, regionCells[2],
      3, regionCells[3],
    ]),
    new FixedPriorityHandler([0, regionCells[0]], 10),
    new FixedPriorityHandler([1, regionCells[2]], 11),
    new FixedPriorityHandler([3, regionCells[3]], 7),
  ], geometry);
  const priorities = solver._internalSolver._cellPriorities;

  assert.equal(priorities[0], 20);
  assert.equal(priorities[regionCells[0]], 20);
  assert.equal(priorities[1], 11);
  assert.equal(priorities[regionCells[2]], 11);
  assert.equal(priorities[3], 7);
  assert.equal(priorities[regionCells[3]], 7);
});

// ============================================================================
// setProgressCallback
// ============================================================================

await runTest('setProgressCallback is called during countSolutions', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  let callCount = 0;
  solver.setProgressCallback(() => { callCount++; }, 0);
  solver.countSolutions();
  // Should have been called at least once (final send).
  assert.ok(callCount >= 1, `Expected callback calls, got ${callCount}`);
});

await runTest('setProgressCallback is called during solveAllPossibilities', () => {
  const solver = buildSolver(makeMultiSolutionConstraint());
  let callCount = 0;
  solver.setProgressCallback(() => { callCount++; }, 0);
  solver.solveAllPossibilities();
  assert.ok(callCount >= 1, `Expected callback calls, got ${callCount}`);
});

// ============================================================================
// Cell limit (MAX_SEARCH_CELLS)
// ============================================================================

// 9x9 grid (81 cells) + var cells. The limit is on grid + var cells together.
const withVarCells = (numVars) => new SudokuConstraint.Container([
  new SudokuConstraint.Var('X', '', numVars),
]);

await runTest('build accepts exactly MAX_SEARCH_CELLS (1000) cells', () => {
  // 81 + 919 = 1000.
  assert.doesNotThrow(() => buildSolver(withVarCells(919)));
});

await runTest('build rejects more than MAX_SEARCH_CELLS cells', () => {
  // 81 + 920 = 1001. The geometry throws when the var cells are registered (before
  // the solver is built); the error bubbles up to the caller (and the UI).
  assert.throws(() => buildSolver(withVarCells(920)), /would exceed the .*-cell limit/);
});

logSuiteComplete('SudokuSolver Engine');

// ============================================================================
// HandlerSet
// ============================================================================

const NUM_SEARCH_CELLS = 81;

await runTest('HandlerSet.addNonEssential marks handlers as non-essential', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  const h = new AllDifferent([0, 1, 2]);
  hs.addNonEssential(h);

  const all = hs.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].essential, false);
});

await runTest('HandlerSet.addSingletonHandlers adds to singleton map', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  const h = new UniqueValueExclusion(0);
  hs.addSingletonHandlers(h);

  const all = hs.getAll();
  assert.equal(all.length, 1);
});

// Only handlers that opt in take part in dedup, so tests need a class that does.
class DedupingHandler extends SudokuConstraintHandler {
  static DEDUPES = true;
  constructor(cells, id) {
    super(cells);
    this._id = id;
  }
  // dedupId must distinguish classes too, hence the class name.
  dedupId() { return `${this.constructor.name}:${this._id}`; }
}

class DedupingSingleton extends DedupingHandler {
  static SINGLETON_HANDLER = true;
}

await runTest('HandlerSet.addSingletonHandlers throws on duplicate', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  const h1 = new DedupingSingleton([0], 'duplicate-singleton');
  const h2 = new DedupingSingleton([0], 'duplicate-singleton');

  hs.addSingletonHandlers(h1);
  assert.throws(
    () => hs.addSingletonHandlers(h2),
    /Singleton handlers must be unique/);
});

await runTest('HandlerSet should not dedupe handlers which do not opt in', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  // Two identical-looking handlers both survive.
  const h1 = new SudokuConstraintHandler([0, 1, 2]);
  const h2 = new SudokuConstraintHandler([0, 1, 2]);
  assert.equal(SudokuConstraintHandler.DEDUPES, false);

  hs.add(h1, h2);
  assert.equal(hs.numHandlers(), 2);
});

await runTest('HandlerSet should dedupe handlers sharing a dedupId', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  const h1 = new DedupingHandler([0, 1, 2], 'same-content');
  const h2 = new DedupingHandler([0, 1, 2], 'same-content');

  hs.add(h1, h2);
  assert.equal(hs.numHandlers(), 1);
  assert.equal(hs.getAll()[0], h1);
});

await runTest('HandlerSet dedup should keep the handler essential if either is', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  const h1 = new DedupingHandler([0, 1, 2], 'same-content');
  const h2 = new DedupingHandler([0, 1, 2], 'same-content');

  // The kept handler is the non-essential one, so the merge has to upgrade it.
  hs.addNonEssential(h1);
  assert.equal(h1.essential, false);
  hs.add(h2);

  assert.equal(hs.numHandlers(), 1);
  assert.equal(hs.getAll()[0].essential, true);
});

await runTest('HandlerSet should keep same-cell handlers with different ids', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  // Identical class and cells, so these share a hash bucket: only the exact
  // dedupId separates them.
  const h1 = new DedupingHandler([0, 1, 2], 'first');
  const h2 = new DedupingHandler([0, 1, 2], 'second');
  const h3 = new DedupingHandler([0, 1, 2], 'first');

  hs.add(h1, h2, h3);
  assert.equal(hs.numHandlers(), 2);
  assert.deepEqual(hs.getAll().map(h => h._id), ['first', 'second']);
});

await runTest('HandlerSet should not confuse a subclass with its parent', () => {
  const hs = new HandlerSet([], NUM_SEARCH_CELLS);
  // Same cells and same content, so these collide and are separated only by
  // dedupId including the class name.
  class Subclass extends DedupingHandler { }
  const parent = new DedupingHandler([0, 1, 2], 'shared-id');
  const child = new Subclass([0, 1, 2], 'shared-id');

  hs.add(parent, child);
  assert.equal(hs.numHandlers(), 2);
});

logSuiteComplete('HandlerSet');
