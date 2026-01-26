const { isPlainObject } = await import('../util.js' + self.VERSION_PARAM);
const { resolvePuzzleConfig } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const { SolverStats } = await import('../sandbox/solver_stats.js' + self.VERSION_PARAM);

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

const addTotalToStats = (stats) => {
  stats.total = stats.reduce((acc, item) => acc.add(item), new SolverStats());
};

const runAllInternal = async (puzzles, solverPromise) => {
  if (isPlainObject(puzzles)) {
    const solutions = [];
    const stats = [];
    for (const [name, collection] of Object.entries(puzzles)) {
      const result = await runAllInternal(collection, solverPromise);
      solutions.push(result.solutions);
      stats.push({ collection: name, ...result.stats.total });
    }
    addTotalToStats(stats);
    return { solutions, stats };
  }

  const solver = await solverPromise;
  const solutions = [];
  const stats = [];
  for (const puzzleCfg of puzzles) {
    const puzzle = await puzzleFromCfg(puzzleCfg);
    console.log('solving...');
    let solution = null;
    try {
      const candidates = [...solver.solutions(puzzle.input, 2)];
      solution = candidates[0] || null;
    } catch (e) {
      throw new Error(`Puzzle ${puzzle.name} failed: ${e}`);
    }
    solutions.push(solution);
    stats.push({
      puzzle: puzzle.name,
      ...solver.latestStats(),
    });
  }

  addTotalToStats(stats);
  console.log(stats);
  return { solutions, stats };
};

export const runAll = async (puzzles) => {
  const result = await runAllInternal(puzzles, makeSolver());
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