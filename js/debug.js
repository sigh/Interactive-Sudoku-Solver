const debugFilesLoaded = Promise.all([
  loadJSFile('js/solver/candidate_selector.js'),
  loadJSFile('js/solver/engine.js'),
  loadJSFile('js/solver/handlers.js'),
  loadJSFile('js/solver/sum_handler.js'),
  loadJSFile('js/solver/optimizer.js'),
  loadJSFile('data/collections.js'),
  loadJSFile('data/jigsaw_layouts.js'),
  loadJSFile('data/invalid_jigsaw_layouts.js'),
  loadJSFile('data/jigsaw_box_layouts.js'),
]);

var TEST_TIMEOUT_MS = 0;

const loadInput = (puzzleCfg) => {
  const puzzle = puzzleFromCfg(puzzleCfg);
  constraintManager.loadUnsafeFromText(puzzle.input);
}

const puzzleFromCfg = (puzzleCfg) => {
  if (isPlainObject(puzzleCfg)) {
    return { name: puzzleCfg.input, ...puzzleCfg };
  }

  const puzzle = PUZZLE_INDEX.get(puzzleCfg);
  if (puzzle) return { name: puzzleCfg, ...puzzle };

  return { name: puzzleCfg, input: puzzleCfg };
};

class PuzzleRunner {
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
    const totals = this._sumObjectValues(...stats);
    delete totals.puzzle;
    delete totals.collection;
    stats.total = totals;
  }

  static _state = null;
  static _stateHandler(s) { this._state = s; };

  static async _runFnWithChecksSinglePuzzle(puzzle, fn, onFailure) {
    // Set up solver.
    const constraint = SudokuParser.parseText(puzzle.input);
    const solver = await SudokuBuilder.buildInWorker(
      constraint, this._stateHandler.bind(this));
    const shape = constraint.getShape();

    // Log a fixed string so the progress gets collapsed to a single line.
    // Do this after the worker has started to ensure a nice output.
    console.log('solving...');

    // Start solver with optional timeout.
    let resultPromise = fn(solver);
    if (TEST_TIMEOUT_MS) {
      resultPromise = withDeadline(
        resultPromise, TEST_TIMEOUT_MS,
        `Solver timed out (${TEST_TIMEOUT_MS}ms)`);
    }

    // Wait for solver.
    let result;
    try {
      result = await resultPromise;
    } catch (e) {
      onFailure(puzzle, e);
    } finally {
      solver.terminate();
    }

    let solution = null;
    if (result !== undefined) {
      let shortSolution;
      if (isIterable(result)) {
        shortSolution = toShortSolution(result, shape);
        solution = shortSolution;
      }
      const resultToCheck = shortSolution || result;

      if (puzzle.solution !== undefined) {
        // We want to test the result.

        if (!puzzle.solution) {
          // Expect no solution.
          if (result) {
            onFailure(puzzle, resultToCheck);
          }
        } else {
          // Expect a solution.
          if (!result || resultToCheck != puzzle.solution) {
            onFailure(puzzle, resultToCheck);
          }
        }
      }
    }

    const state = this._state;
    delete state.counters.progressRatio;
    delete state.counters.progressRatioPrev;
    const stats = {
      puzzle: puzzle.name,
      ...state.counters,
      setupTimeMs: state.puzzleSetupTime,
      rumtimeMs: state.timeMs
    };

    return {
      solution,
      stats
    };
  }

  static async runFnWithChecks(puzzles, fn, onFailure) {
    if (isPlainObject(puzzles)) {
      const solutions = [];
      const stats = [];
      for (const [name, collection] of Object.entries(puzzles)) {
        const result = await this.runFnWithChecks(collection, fn, onFailure);
        solutions.push(result.solution);
        stats.push(
          { collection: name, ...result.stats.total });
      }
      this.addTotalToStats(stats);

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
        console.log('Test failed: ' + puzzle.name);
        console.log('Expected', puzzle.solution);
        console.log('Got     ', result);
        throw ('Test failed: ' + puzzle.name);
      }
    };

    const solutions = [];
    const stats = [];
    for (const puzzleCfg of puzzles) {
      const puzzle = puzzleFromCfg(puzzleCfg);
      const result = await this._runFnWithChecksSinglePuzzle(puzzle, fn, failTest);
      solutions.push(result.solution);
      stats.push(result.stats);
    }

    if (numFailures > 0) {
      console.error(numFailures + ' failures');
    }

    this.addTotalToStats(stats);

    console.log(stats);
    return {
      solutions,
      stats,
    }
  }

  static async runAllWithChecks(puzzles, onFailure) {
    return await this.runFnWithChecks(puzzles, async (solver) => {
      const result = await solver.nthSolution(0);
      await solver.nthSolution(1); // Try to find a second solution to prove uniqueness.
      return result;
    }, onFailure);
  }

  static async runValidateLayout(cases, onFailure) {
    return await this.runFnWithChecks(cases, async (solver) => {
      return (await solver.validateLayout()) !== null;
    }, onFailure);
  }
}

const runValidateLayoutTests = async (onFailure) => {
  const cases = [].concat(
    VALID_JIGSAW_LAYOUTS.slice(0, 20),
    EASY_INVALID_JIGSAW_LAYOUTS,
    FAST_INVALID_JIGSAW_LAYOUTS.slice(0, 20),
    VALID_JIGSAW_BOX_LAYOUTS.slice(0, 10));
  const result = await PuzzleRunner.runValidateLayout(cases, onFailure);
  result.collection = 'Jigsaw layouts';
  return [result];
};

const runSolveTests = async (onFailure) => {
  const results = [];
  let result = null;
  result = await PuzzleRunner.runAllWithChecks([
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
    'Anti-knight, Anti-consecutive',
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
    'Entropic connections',
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
    'Odd-even thermo',
    'Nabner thermo - easy',
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
    'Full rank - 6 clue snipe',
    'Irregular region sum line',
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

  result = await PuzzleRunner.runAllWithChecks([
    '16x16',
    '16x16: Sudoku X',
    '16x16: Sudoku X, hard',
    '16x16: Jigsaw',
  ], onFailure);
  result.collection = '16x16';
  results.push(result);

  result = await PuzzleRunner.runAllWithChecks([
    '6x6',
    '6x6: Numbered rooms',
    '6x6: Between Odd and Even',
    '6x6: Little Killer',
    '4x4: Counting circles',
    '6x6: Rellik cages',  // Rellik cages
  ], onFailure);
  result.collection = 'Other sizes';
  results.push(result);

  return results;
};

const runAllTests = async () => {
  let results = [];
  results.push(...await runSolveTests());
  results.push(...await runValidateLayoutTests());
  console.log(results);
  const stats = results.map(
    r => ({ collection: r.collection, ...r.stats.total }));
  PuzzleRunner.addTotalToStats(stats);
  console.table(stats);
};

const runAll = async (puzzles) => {
  const result = await PuzzleRunner.runAllWithChecks(puzzles);
  console.table(result.stats);
  return result;
};

const printGrid = (grid) => {
  const gridSize = Math.sqrt(grid.length);
  const matrix = [];
  for (let i = 0; i < gridSize; i++) {
    matrix.push(
      [...grid.slice(i * gridSize, (i + 1) * gridSize)].map(LookupTables.toValue));
  }
  console.table(matrix);
}

const progressBenchmarks = async () => {
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
    parts.push(s.guesses, s.constraintsProcessed, Math.round(s.rumtimeMs));
  }

  console.log(parts.join('\t'));
}