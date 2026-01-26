const {
  isPlainObject,
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

const getDefaultPuzzleRunner = () => new PuzzleRunner({ enableConsoleLogs: true });

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