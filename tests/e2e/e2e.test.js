import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { logSuiteComplete } from '../helpers/test_runner.js';

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
const { SolverStats } = await import('../../js/sandbox/solver_stats.js' + self.VERSION_PARAM);
const { resolvePuzzleConfig } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
await import('../../data/collections.js' + self.VERSION_PARAM);
const {
  VALID_JIGSAW_LAYOUTS,
  EASY_INVALID_JIGSAW_LAYOUTS,
  FAST_INVALID_JIGSAW_LAYOUTS,
} = await import('../../data/jigsaw_layouts.js' + self.VERSION_PARAM);
const { VALID_JIGSAW_BOX_LAYOUTS } = await import('../../data/jigsaw_box_layouts.js' + self.VERSION_PARAM);

const solveCollections = [
  {
    collection: '9x9',
    puzzles: [
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
    ],
  },
  {
    collection: '16x16',
    puzzles: [
      '16x16',
      '16x16: Sudoku X',
      '16x16: Sudoku X, hard',
      '16x16: Jigsaw',
    ],
  },
  {
    collection: 'Other sizes',
    puzzles: [
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
    ],
  },
  {
    collection: 'Non-square grids',
    puzzles: [
      '6x8: Plain',
      '5x10: Killer Sudoku',  // Killer cages (tests sum optimizer on non-square grids)
      '6x9: Postcard',  // Indexing, Anti-knight, Whisper
      '4x7: Jigsaw',  // Jigsaw
      '4x6: Skyscraper',  // Skyscraper
      '9x8: Plain boxless',  // Boxless rectangular grid
      '5x5: Squishtroquadri',  // non-standard numValues, Arrows and Thermo
      '7x7: Killer Squishdoku',  // non-standard numValues
      '6x6: Con-set-cutive',  // non-standard numValues, RegionSize, region-sized boxes
      '7x7: Skyscraper Squishdoku',  // non-standard numValues, Skyscraper
      '7x7: Numbered Rooms Squishdoku',  // non-standard numValues, Numbered Rooms
      '6x6: Hidden Hostility', // non-standard numValues, Diagonal, region-sized boxes
      '6x6: Order from Chaos', // non-standard numValues, Global Entropy, NFA, region-sized boxes
      '6x6: Irregular Quadro Quadri', // non-standard numValues, Jigsaw
      '7x7: Dutch Flat Mate Squishdoku', // non-standard numValues, Dutch Flatmates
      '7x7: Buggy NR Squishdoku',  // non-standard numValues, Numbered Rooms
      '6x6: 9-value disjoint sets',  // non-standard numValues, DisjointSets
    ],
  },
];

const layoutCases = [
  ...VALID_JIGSAW_LAYOUTS.slice(0, 20),
  ...EASY_INVALID_JIGSAW_LAYOUTS,
  ...FAST_INVALID_JIGSAW_LAYOUTS.slice(0, 20),
  ...VALID_JIGSAW_BOX_LAYOUTS.slice(0, 10),
  // Add non-standard grid tests.
  { input: '.Shape~7x7', solution: true },
  { input: '.Shape~6x6~9', solution: true },
  { input: '.Shape~6x6~9.NoBoxes', solution: true },
  { input: '.Shape~6x6~9.RegionSize~6', solution: true },
  { input: '.Shape~7x6~9', solution: true },
  { input: '.Shape~7x6~9.RegionSize~7', solution: true },
];

const loadInput = async (puzzle) => {
  if (puzzle.input.startsWith('/')) {
    const filePath = resolvePath(process.cwd(), '.' + puzzle.input);
    return readFile(filePath, 'utf8');
  }
  return puzzle.input;
};

const assertPuzzleSolution = (puzzle, solution) => {
  if (puzzle.solution === undefined) return;
  if (!puzzle.solution) {
    if (solution) throw new Error(`Puzzle ${puzzle.name} failed: ${solution}`);
  } else if (puzzle.solution === true) {
    if (!solution) throw new Error(`Puzzle ${puzzle.name} failed: ${solution}`);
  } else if (solution !== puzzle.solution) {
    throw new Error(`Puzzle ${puzzle.name} failed: ${solution}`);
  }
};

const runCollection = async (puzzles, solveFn, label) => {
  const stats = [];
  for (const puzzleCfg of puzzles) {
    const puzzle = await resolvePuzzleConfig(puzzleCfg);
    const input = await loadInput(puzzle);

    let solution = null;
    try {
      solution = await solveFn(input);
    } catch (e) {
      throw new Error(`${label} ${puzzle.name} failed: ${e}`);
    }

    const asString = solution?.toString() || null;
    assertPuzzleSolution(puzzle, asString);

    stats.push({
      puzzle: puzzle.name,
      ...solver.latestStats(),
    });
  }

  stats.total = stats.reduce((acc, item) => acc.add(item), new SolverStats());
  return stats;
};

const solver = new SimpleSolver();


const expectStatsStructure = (result, label) => {
  assert.ok(result, `${label} returned nothing`);
  assert.ok(Array.isArray(result.stats), `${label} stats should be an array`);
  assert.ok(result.stats.total, `${label} stats should include totals`);
};

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
  console.log('  ' + parts.join(' | '));
};

const runSolveResults = [];
for (const { collection, puzzles } of solveCollections) {
  const stats = await runCollection(
    puzzles,
    (input) => {
      const candidates = [...solver.solutions(input, 2)];
      return candidates[0] || null;
    },
    'Puzzle'
  );
  runSolveResults.push({ collection, stats });
}
assert.equal(runSolveResults.length, 4, 'solve collections should return four collections');
runSolveResults.forEach((result) => expectStatsStructure(result, `solve tests (${result.collection})`));
console.log('✓ solve collections completed');
runSolveResults.forEach((result) => logCollectionSummary(result));

const runLayoutResults = [];
{
  const stats = await runCollection(
    layoutCases,
    (input) => solver.validateLayout(input),
    'Layout puzzle'
  );
  runLayoutResults.push({ collection: 'Jigsaw layouts', stats });
}
assert.equal(runLayoutResults.length, 1, 'layout collections should return a single collection');
runLayoutResults.forEach((result) => expectStatsStructure(result, 'layout tests'));
console.log('✓ layout collections completed');
runLayoutResults.forEach((result) => logCollectionSummary(result));

logSuiteComplete('End-to-end');
