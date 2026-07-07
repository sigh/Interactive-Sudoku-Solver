import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete, logInfo } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { SolverStats } = await import('../../js/sandbox/solver_stats.js' + self.VERSION_PARAM);
const { resolvePuzzleConfig } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const { extractConstraintTypes } = await import('../../js/debug/extract_constraint_types.js' + self.VERSION_PARAM);

const { solveCollections, layoutCases } = await import('./e2e_puzzles.js' + self.VERSION_PARAM);

const loadInput = async (puzzle) => {
  if (puzzle.input.startsWith('/')) {
    const filePath = resolvePath(process.cwd(), '.' + puzzle.input);
    return readFile(filePath, 'utf8');
  }
  return puzzle.input;
};

// Extra context appended to failure messages to aid debugging: the entry's
// comment and its constraint types (declared, else derived from the input).
const puzzleDebugInfo = (puzzle) => {
  const types = puzzle.constraintTypes ?? extractConstraintTypes(puzzle.input);
  const parts = [];
  if (puzzle.comment) parts.push(`comment: ${puzzle.comment}`);
  if (types?.length) parts.push(`constraints: ${types.join(', ')}`);
  return parts.length ? ` (${parts.join('; ')})` : '';
};

const assertPuzzleSolution = (puzzle, solution, solutionCount) => {
  if (puzzle.solution === undefined) return;
  if (!puzzle.solution) {
    if (solution) throw new Error(`Puzzle ${puzzle.name} failed: ${solution}${puzzleDebugInfo(puzzle)}`);
  } else if (puzzle.solution === true) {
    if (!solution) throw new Error(`Puzzle ${puzzle.name} failed: ${solution}${puzzleDebugInfo(puzzle)}`);
  } else {
    if (solution !== puzzle.solution) {
      throw new Error(`Puzzle ${puzzle.name} failed: ${solution}${puzzleDebugInfo(puzzle)}`);
    }
    if (solutionCount !== undefined && solutionCount !== 1) {
      throw new Error(
        `Puzzle ${puzzle.name} failed: solution is not unique (found ${solutionCount})${puzzleDebugInfo(puzzle)}`);
    }
  }
};

const runCollection = async (puzzles, solveFn, label) => {
  const stats = [];
  for (const puzzleCfg of puzzles) {
    const puzzle = await resolvePuzzleConfig(puzzleCfg);
    await runTest(`${label}: ${puzzle.name}`, async () => {
      const input = await loadInput(puzzle);
      const result = await solveFn(input);

      const solution = result?.solution !== undefined ? result.solution : result;
      const solutionCount = result?.solutionCount;
      assertPuzzleSolution(puzzle, solution?.toString() || null, solutionCount);
    });

    stats.push({
      puzzle: puzzle.name,
      ...solver.latestStats(),
    });
  }

  stats.total = stats.reduce((acc, item) => acc.add(item), new SolverStats());
  return stats;
};

const solver = new SimpleSolver();


const formatNumber = (value) => value.toLocaleString('en-US');
const formatSeconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

const logCollectionSummary = (result, label = result.collection) => {
  const total = result.stats.total || {};
  const parts = [`${label}: ${result.stats.length} puzzles`];
  const runtimeMs = typeof total.rumtimeMs === 'number' ? total.rumtimeMs : total.runtimeMs;
  if (typeof runtimeMs === 'number') {
    parts.push(`runtime ${formatSeconds(runtimeMs)}`);
  }
  if (typeof total.guesses === 'number') {
    parts.push(`guesses ${formatNumber(total.guesses)}`);
  }
  logInfo('  ' + parts.join(' | '));
};

const runSolveResults = [];
for (const { collection, puzzles } of solveCollections) {
  const stats = await runCollection(
    puzzles,
    (input) => {
      const candidates = [...solver.solutions(input, 2)];
      return { solution: candidates[0] || null, solutionCount: candidates.length };
    },
    collection
  );
  runSolveResults.push({ collection, stats });
}
runSolveResults.forEach((result) => logCollectionSummary(result));

const runLayoutResults = [];
{
  const stats = await runCollection(
    layoutCases,
    (input) => solver.validateLayout(input),
    'Layout'
  );
  runLayoutResults.push({ collection: 'Jigsaw layouts', stats });
}
runLayoutResults.forEach((result) => logCollectionSummary(result));

logSuiteComplete('End-to-end');
