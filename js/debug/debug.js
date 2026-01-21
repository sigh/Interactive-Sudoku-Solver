const {
  isPlainObject,
  memoize,
  withDeadline,
} = await import('../util.js' + self.VERSION_PARAM);
const { resolvePuzzleConfig } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);

const makeSolver = async () => {
  const { SimpleSolver } = await import('../sandbox/simple_solver.js' + self.VERSION_PARAM);
  return new SimpleSolver();
};

const loadDataFile = async (name) => {
  const module = await import(name);
  Object.assign(window, module);
};

export const debugFilesLoaded = Promise.all([
  loadDataFile('../../data/collections.js' + self.VERSION_PARAM),
  loadDataFile('../../data/jigsaw_layouts.js' + self.VERSION_PARAM),
  loadDataFile('../../data/invalid_jigsaw_layouts.js' + self.VERSION_PARAM),
  loadDataFile('../../data/jigsaw_box_layouts.js' + self.VERSION_PARAM),
]);

var TEST_TIMEOUT_MS = 0;

let constraintManager = null;
export const setConstraintManager = (newConstraintManager) => {
  constraintManager = newConstraintManager;
}

export const loadInput = async (puzzleCfg) => {
  const puzzle = await puzzleFromCfg(puzzleCfg);
  constraintManager.loadUnsafeFromText(puzzle.input);
}

const puzzleFromCfg = async (puzzleCfg) => {
  const puzzle = resolvePuzzleConfig(puzzleCfg);

  // Lazily fetch input from file if it's a path.
  if (puzzle.input.startsWith('/')) {
    const response = await fetch('.' + puzzle.input);
    puzzle.input = await response.text();
  }

  return puzzle;
};

export class PuzzleRunner {
  constructor({ solver, enableConsoleLogs } = {}) {
    this._solver = solver;
    this._log = enableConsoleLogs ? console.log.bind(console) : () => { };
  }

  async _getSolver() {
    if (!this._solver) {
      this._solver = await makeSolver();
    }
    return this._solver;
  }

  static _sumObjectValues(first, ...items) {
    if (!first) return {};
    let result = { ...first };
    for (const item of items) {
      for (const [k, v] of Object.entries(item)) {
        if (!v) continue;
        if (!result[k]) result[k] = 0;
        result[k] += v;
      }
    }
    return result;
  }

  static addTotalToStats(stats) {
    const totals = PuzzleRunner._sumObjectValues(...stats);
    delete totals.puzzle;
    delete totals.collection;
    stats.total = totals;
  }

  async _runWithChecks(puzzle, fn, onFailure) {
    const solver = await this._getSolver();
    let result;
    try {
      let resultPromise = fn(solver, puzzle.input);
      if (TEST_TIMEOUT_MS) {
        resultPromise = withDeadline(
          resultPromise, TEST_TIMEOUT_MS,
          `Solver timed out (${TEST_TIMEOUT_MS}ms)`);
      }
      result = await resultPromise;
    } catch (e) {
      onFailure(puzzle, e);
      return { stats: { puzzle: puzzle.name } };
    }

    const solution = result.solution?.toString() || null;

    if (puzzle.solution !== undefined) {
      if (!puzzle.solution) {
        // Expect no solution.
        if (solution) onFailure(puzzle, solution);
      } else if (puzzle.solution === true) {
        // Expect any solution (for validateLayout valid cases).
        if (!solution) onFailure(puzzle, solution);
      } else {
        // Expect a specific solution.
        if (solution !== puzzle.solution) onFailure(puzzle, solution);
      }
    }

    const solverStats = solver.latestStats();
    const stats = {
      puzzle: puzzle.name,
      guesses: solverStats.guesses,
      backtracks: solverStats.backtracks,
      nodesSearched: solverStats.nodesSearched,
      constraintsProcessed: solverStats.constraintsProcessed,
      setupTimeMs: solverStats.setupTimeMs,
      runtimeMs: solverStats.runtimeMs,
    };

    return { solution, stats };
  }

  async runFnWithChecks(puzzles, fn, onFailure) {
    if (isPlainObject(puzzles)) {
      const solutions = [];
      const stats = [];
      for (const [name, collection] of Object.entries(puzzles)) {
        const result = await this.runFnWithChecks(collection, fn, onFailure);
        solutions.push(result.solution);
        stats.push(
          { collection: name, ...result.stats.total });
      }
      PuzzleRunner.addTotalToStats(stats);

      return {
        solutions,
        stats,
      };
    }

    let numFailures = 0;
    const failTest = (puzzle, result) => {
      numFailures++;
      if (onFailure) {
        onFailure(puzzle, result);
      } else {
        console.error('Test failed: ' + puzzle.name);
        console.error('Expected', puzzle.solution);
        console.error('Got     ', result);
        throw new Error('Test failed: ' + puzzle.name);
      }
    };

    const solutions = [];
    const stats = [];
    for (const puzzleCfg of puzzles) {
      const puzzle = await puzzleFromCfg(puzzleCfg);
      this._log('solving...');
      const result = await this._runWithChecks(puzzle, fn, failTest);
      solutions.push(result.solution);
      stats.push(result.stats);
    }

    if (numFailures > 0) {
      console.error(numFailures + ' failures');
    }

    PuzzleRunner.addTotalToStats(stats);

    this._log(stats);
    return {
      solutions,
      stats,
    }
  }

  async runAllWithChecks(puzzles, onFailure) {
    return this.runFnWithChecks(puzzles, async (solver, input) => {
      const solutions = [...solver.solutions(input, 2)];
      return { solution: solutions[0] || null };
    }, onFailure);
  }

  async runValidateLayout(cases, onFailure) {
    return this.runFnWithChecks(cases, async (solver, input) => {
      const solution = solver.validateLayout(input);
      return { solution };
    }, onFailure);
  }
}

const getDefaultPuzzleRunner = memoize(() => {
  return new PuzzleRunner({ enableConsoleLogs: true });
});

export const runValidateLayoutTests = async (onFailure, runner) => {
  const activeRunner = runner || getDefaultPuzzleRunner();
  const cases = [
    ...VALID_JIGSAW_LAYOUTS.slice(0, 20),
    ...EASY_INVALID_JIGSAW_LAYOUTS,
    ...FAST_INVALID_JIGSAW_LAYOUTS.slice(0, 20),
    ...VALID_JIGSAW_BOX_LAYOUTS.slice(0, 10),
    // Add non-standard grid tests.
    { input: '.Shape~7x7', solution: true },
    { input: '.Shape~6x6~9', solution: true },
    { input: '.Shape~7x6~9', solution: true },
  ];
  const result = await activeRunner.runValidateLayout(cases, onFailure);
  result.collection = 'Jigsaw layouts';
  return [result];
};

export const runSolveTests = async (onFailure, runner) => {
  const activeRunner = runner || getDefaultPuzzleRunner();
  const results = [];
  let result = null;
  result = await activeRunner.runAllWithChecks([
    'Thermosudoku',
    'Classic sudoku',
    'Classic sudoku, hard',
    'Anti-knights move',
    'Killer sudoku',
    'Killer sudoku, with overlap',
    'Killer sudoku, with gaps',
    'Killer sudoku, with 0 cage',
    'Killer sudoku, with alldiff',
    'Sudoku X',
    'Anti-knight Anti-king',
    'Anti-knight Anti-consecutive',
    'Arrow sudoku',
    'Double arrow',
    'Pill arrow',
    '3-digit pill arrow',
    'Arrow killer sudoku',
    'Kropki sudoku',
    'Little killer',
    'Little killer - Sum',
    'Little killer 2',
    'Sandwich sudoku',
    'German whispers',
    'International whispers',
    'Renban',
    'Between lines',
    'Lockout lines',
    'Palindromes',
    'Modular lines',
    'Entropic connections',  // Entropic Line, Pair
    'Jigsaw',
    'Jigsaw boxes, disconnected',
    'Windoku',
    'X-Windoku',
    'Region sum lines',
    'XV-sudoku',
    'XV-kropki',
    'Strict kropki',
    'Strict XV',
    'Hailstone (easier) - little killer',
    'X-Sum little killer',
    'Skyscraper',
    'Skyscraper - all 6',
    'Global entropy',  // Global entropy
    'Global mod 3',  // Global mod
    'Odd even',
    'Quadruple X',
    'Quadruple - repeated values',
    'Odd-even thermo',  // Pair
    'Nabner thermo - easy',  // PairX
    'Knight-arrows',  // Binary (backward compatibility)
    'Zipper lines - tutorial',  // Zipper both odd and even length.
    'Sum lines',
    'Sum lines, with loop',
    'Sum lines - long loop',
    'Long sums 3',
    'Indexing',
    '2D 1-5-9',
    'Full rank',
    'Duplicate cell sums',
    'Lunchbox',  // Lunchbox
    'Killer lunchboxes, resolved', // Lunchbox with 0
    'Hidden skyscrapers',
    'Unbidden First Hidden', // And constraint
    'Look-and-say',
    'Counting circles',
    'Bubble Tornado',
    'Anti-taxicab',
    'Dutch Flatmates',  // Dutch Flatmates
    'Fortress sudoku',  // GreaterThan
    'Equality cages',  // EqualityCage
    'Regex line',  // Regex
    'Sequence sudoku', // NFA (simple transitions only)
    'NFA: Equal sum parition', // NFA (with state bifurcation)
    'Full rank - 6 clue snipe',
    'Irregular region sum line',
    'Embedded Squishdoku',
    'Force non-unit coeff', // Sum with non-unit coeff
    'Event horizon', // Duplicate cell in sum, BinaryPairwise optimization.
    'Copycat, easy',  // Same value - 2 sets, repeated values
    'Clone sudoku', // Same value - single cell sets
    'Slingshot sudoku', // ValueIndexing
    'Numbered Rooms vs X-Sums', // Or constraint
    'Or with Givens', // Or constraint (update watched cells)
    'And with AllDifferent', // And constraint (with cellExclusions)
    'Or with AllDifferent', // Or constraint (with cellExclusions)
    'Elided And and Or', // And and Or constraint which are both simplified out.
  ], onFailure);
  result.collection = '9x9';
  results.push(result);

  result = await activeRunner.runAllWithChecks([
    '16x16',
    '16x16: Sudoku X',
    '16x16: Sudoku X, hard',
    '16x16: Jigsaw',
  ], onFailure);
  result.collection = '16x16';
  results.push(result);

  result = await activeRunner.runAllWithChecks([
    '6x6',
    '6x6: Numbered rooms',
    '6x6: Between Odd and Even',
    '6x6: Little Killer',
    '4x4: Counting circles',
    '6x6: Rellik cages',  // Rellik cages
    '6x6: Successor Arrows',  // Regex
    '6x6: Full rank',  // Full rank (requires enforcing no ties)
    '4x4: Full Rank - no ties',
    '4x4: Full Rank - with ties',
    '4x4: Full Rank - unclued ties',
    '4x4: Full Rank - tied clues',
  ], onFailure);
  result.collection = 'Other sizes';
  results.push(result);

  result = await activeRunner.runAllWithChecks([
    '6x8: Plain',
    '5x10: Killer Sudoku',  // Killer cages (tests sum optimizer on non-square grids)
    '6x9: Postcard',  // Indexing, Anti-knight, Whisper
    '4x7: Jigsaw',  // Jigsaw
    '4x6: Skyscraper',  // Skyscraper
    '9x8: Plain boxless',  // Boxless rectangular grid
    '5x5: Squishtroquadri',  // non-standard numValues, Arrows and Thermo
    '7x7: Killer Squishdoku',  // non-standard numValues
    '6x6: Con-set-cutive',  // non-standard numValues, strict subset
    '7x7: Skyscraper Squishdoku',  // non-standard numValues, Skyscraper
    '7x7: Numbered Rooms Squishdoku',  // non-standard numValues, Numbered Rooms
    '6x6: Hidden Hostility', // non-standard numValues, Diagonal
    '6x6: Order from Chaos', // non-standard numValues, Global Entropy, NFA
    '6x6: Irregular Quadro Quadri', // non-standard numValues, Irregular
    '7x7: Dutch Flat Mate Squishdoku', // non-standard numValues, Dutch Flatmates
    '7x7: Buggy NR Squishdoku',  // non-standard numValues, Numbered Rooms
  ], onFailure);
  result.collection = 'Non-square grids';
  results.push(result);

  return results;
};

export const runAllTests = async (runner) => {
  const activeRunner = runner || getDefaultPuzzleRunner();
  let results = [];
  results.push(...await runSolveTests(undefined, activeRunner));
  results.push(...await runValidateLayoutTests(undefined, activeRunner));
  console.log(results);
  const stats = results.map(
    r => ({ collection: r.collection, ...r.stats.total }));
  PuzzleRunner.addTotalToStats(stats);
  console.table(stats);
};

export const runAll = async (puzzles, runner) => {
  const activeRunner = runner || getDefaultPuzzleRunner();
  const result = await activeRunner.runAllWithChecks(puzzles);
  console.table(result.stats);
  return result;
};

export const progressBenchmarks = async () => {
  const puzzleSets = {
    MATHEMAGIC_KILLERS,
    EXTREME_KILLERS,
    TAREK_ALL,
    HARD_THERMOS,
    HARD_RENBAN,
  };
  const results = await runAll(puzzleSets);

  const parts = [];
  for (const s of results.stats) {
    parts.push(s.guesses, s.constraintsProcessed, Math.round(s.runtimeMs));
  }

  console.log(parts.join('\t'));
}