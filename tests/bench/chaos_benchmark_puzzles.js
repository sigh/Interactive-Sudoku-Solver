export const CHAOS_LADDER_ALIAS = 'Chaos Construction - ladder';
export const DEFAULT_CHAOS_LADDER_COUNTS = [10, 9, 8, 7, 6];
export const CHAOS_KILLER_LADDER_ALIAS = 'Chaos Construction: killer - ladder';
export const DEFAULT_CHAOS_KILLER_LADDER_COUNTS = [25, 20, 15, 10, 5];
export const CHAOS_X_SUMS_LADDER_ALIAS = 'Chaos Construction: x-sums - ladder';
export const DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS = [25, 20, 15, 10, 5];

const ORIGINAL_CHAOS_NAME = 'Chaos Construction';
const EASIER_CHAOS_NAME = 'Chaos Construction - easier';
const CHAOS_KILLER_NAME = 'Chaos Construction: killer';
const CHAOS_X_SUMS_NAME = 'Chaos Construction: x-sums';
const CONSTRAINT_SUFFIX_MARKERS = ['.ChaosArrow~', '.NFA~'];
const GIVEN_PATTERN = /~(?:R\d+C\d+|CC\d+)(?:_\d+)+/g;
const SOLUTION_GIVEN_STRIDE = 37;

const findPuzzle = (examples, name) => {
  const puzzle = examples.find(example => example.name === name);
  if (!puzzle) throw new Error(`Unknown puzzle: ${name}`);
  return puzzle;
};

const parseGridGivenCell = (token) => {
  const match = /^~R(\d+)C(\d+)_/.exec(token);
  if (!match) return null;
  return { row: +match[1] - 1, col: +match[2] - 1 };
};

const inferSquareSize = (numCells) => {
  const size = Math.sqrt(numCells);
  return Number.isInteger(size) ? size : 0;
};

const constraintSuffixIndex = (input) => Math.min(...CONSTRAINT_SUFFIX_MARKERS.map(
  marker => input.indexOf(marker)).filter(index => index >= 0));

const balancedCellOrder = (numRows, numCols) => {
  const numCells = numRows * numCols;
  const used = new Uint8Array(numCells);
  const order = [];

  const push = (row, col) => {
    if (row < 0 || col < 0 || row >= numRows || col >= numCols) return;
    const cell = row * numCols + col;
    if (used[cell]) return;
    used[cell] = 1;
    order.push(cell);
  };

  // Seed with corners and center-ish cells to spread givens spatially.
  push(0, 0);
  push(0, numCols - 1);
  push(numRows - 1, 0);
  push(numRows - 1, numCols - 1);
  push(numRows >> 1, numCols >> 1);
  push((numRows - 1) >> 1, (numCols - 1) >> 1);

  let cell = ((numRows >> 1) * numCols + (numCols >> 1)) % numCells;
  while (order.length < numCells) {
    if (!used[cell]) {
      used[cell] = 1;
      order.push(cell);
    }
    cell = (cell + SOLUTION_GIVEN_STRIDE) % numCells;
  }

  return order;
};

const balancedTokenOrder = (tokens, numRows, numCols) => {
  const cellOrder = balancedCellOrder(numRows, numCols);
  const rankByCell = new Int16Array(numRows * numCols);
  rankByCell.fill(-1);
  for (let i = 0; i < cellOrder.length; i++) {
    rankByCell[cellOrder[i]] = i;
  }

  return [...tokens].sort((a, b) => {
    const pa = parseGridGivenCell(a);
    const pb = parseGridGivenCell(b);
    if (!pa || !pb) return a.localeCompare(b);
    const ra = rankByCell[pa.row * numCols + pa.col];
    const rb = rankByCell[pb.row * numCols + pb.col];
    return ra - rb;
  });
};

const buildChaosLadderPuzzles = (examples) => {
  const original = findPuzzle(examples, ORIGINAL_CHAOS_NAME);
  const easier = findPuzzle(examples, EASIER_CHAOS_NAME);
  const originalSuffixIndex = constraintSuffixIndex(original.input);
  const easierSuffixIndex = constraintSuffixIndex(easier.input);
  if (!Number.isFinite(originalSuffixIndex) || !Number.isFinite(easierSuffixIndex)) {
    throw new Error('Chaos Construction ladder requires arrow constraints.');
  }

  const originalPrefix = original.input.slice(0, originalSuffixIndex);
  const easierPrefix = easier.input.slice(0, easierSuffixIndex);
  if (!easierPrefix.startsWith(originalPrefix)) {
    throw new Error('Chaos Construction - easier must extend the original givens.');
  }

  const extraGivens = easierPrefix.slice(originalPrefix.length).match(GIVEN_PATTERN) ?? [];
  const gridSize = inferSquareSize(original.solution.length);
  const balancedExtraGivens = gridSize
    ? balancedTokenOrder(extraGivens, gridSize, gridSize)
    : extraGivens;
  const suffix = original.input.slice(originalSuffixIndex);

  return Array.from({ length: balancedExtraGivens.length + 1 }, (_, extraCount) => ({
    name: `${CHAOS_LADDER_ALIAS} ${extraCount}`,
    src: original.src,
    input: originalPrefix + balancedExtraGivens.slice(0, extraCount).join('') + suffix,
    solution: original.solution,
    generatedFrom: EASIER_CHAOS_NAME,
  }));
};

const solutionGivenForCell = (puzzle, cell) => {
  const row = cell / 9 | 0;
  const col = cell % 9;
  return `~R${row + 1}C${col + 1}_${puzzle.solution[cell]}`;
};

const solutionGivenOrder = (numCells) => {
  const gridSize = inferSquareSize(numCells);
  if (!gridSize) {
    const order = [];
    const seen = new Set();
    let cell = 0;
    while (order.length < numCells) {
      if (!seen.has(cell)) {
        seen.add(cell);
        order.push(cell);
      }
      cell = (cell + SOLUTION_GIVEN_STRIDE) % numCells;
    }
    return order;
  }

  return balancedCellOrder(gridSize, gridSize);
};

const buildSolutionGivenLadderPuzzles = (examples, name, alias, counts) => {
  const puzzle = findPuzzle(examples, name);
  const order = solutionGivenOrder(puzzle.solution.length);
  return counts.map(count => ({
    name: `${alias} ${count}`,
    src: puzzle.src,
    input: puzzle.input + '.' + order.slice(0, count).map(cell => solutionGivenForCell(puzzle, cell)).join(''),
    solution: puzzle.solution,
    generatedFrom: name,
  }));
};

export const expandPuzzleNames = (names) => names.flatMap(name => {
  if (name === CHAOS_LADDER_ALIAS || name === 'chaos-ladder') {
    return DEFAULT_CHAOS_LADDER_COUNTS.map(count => `${CHAOS_LADDER_ALIAS} ${count}`);
  }
  if (name === CHAOS_KILLER_LADDER_ALIAS || name === 'chaos-killer-ladder') {
    return DEFAULT_CHAOS_KILLER_LADDER_COUNTS.map(
      count => `${CHAOS_KILLER_LADDER_ALIAS} ${count}`);
  }
  if (name === CHAOS_X_SUMS_LADDER_ALIAS || name === 'chaos-x-sums-ladder') {
    return DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS.map(
      count => `${CHAOS_X_SUMS_LADDER_ALIAS} ${count}`);
  }
  return [name];
});

export const getChaosBenchmarkPuzzles = (examples) => [
  ...examples,
  ...buildChaosLadderPuzzles(examples),
  ...buildSolutionGivenLadderPuzzles(
    examples, CHAOS_KILLER_NAME, CHAOS_KILLER_LADDER_ALIAS, DEFAULT_CHAOS_KILLER_LADDER_COUNTS),
  ...buildSolutionGivenLadderPuzzles(
    examples, CHAOS_X_SUMS_NAME, CHAOS_X_SUMS_LADDER_ALIAS, DEFAULT_CHAOS_X_SUMS_LADDER_COUNTS),
];

export const resolveChaosBenchmarkPuzzles = (examples, names) => {
  const puzzleMap = new Map(getChaosBenchmarkPuzzles(examples).map(puzzle => [puzzle.name, puzzle]));
  return expandPuzzleNames(names).map(name => {
    const puzzle = puzzleMap.get(name);
    if (!puzzle) throw new Error(`Unknown puzzle: ${name}`);
    return puzzle;
  });
};
