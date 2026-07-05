// ladder.js — build a difficulty ladder from any solved puzzle.
//
// A "ladder" is a series of rungs of increasing difficulty derived from one base
// puzzle by revealing some of its solution cells as extra givens: more revealed
// cells ⇒ an easier rung. Every rung stays uniquely solvable, because the givens
// match the puzzle's known solution. This is what lets a hard puzzle stand in for
// a graded set when the real one is too slow to use directly.
//
// Givens are revealed in a spatially-balanced order so any prefix is spread
// across the grid rather than front-loaded into one region — a cluster of givens
// in one corner is not representative of the puzzle's real difficulty.
//
// This is puzzle-type-agnostic: it only needs a base puzzle with `input` +
// `solution` and the grid dimensions. (It supersedes the old chaos-specific
// ladders, which additionally had an "extra givens from a paired easier puzzle"
// mode that only existed for Chaos Construction.)

export const DEFAULT_LADDER_COUNTS = [25, 20, 15, 10, 5];

// A coprime-ish stride used to scatter the remaining cells after the seeds.
const SCATTER_STRIDE = 37;

// Spatially-balanced cell order: corners + centre first, then the rest scattered
// by a fixed stride, so any prefix of the order is spread across the grid.
export const balancedCellOrder = (numRows, numCols) => {
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

  // Seed with corners and centre-ish cells to spread givens spatially.
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
    cell = (cell + SCATTER_STRIDE) % numCells;
  }

  return order;
};

// Build one rung per entry in `counts`: the base puzzle plus that many revealed
// solution givens. Counts are clamped to the open interval (0, numCells) and
// de-duped (a count >= numCells would fully reveal the grid).
export const buildSolutionGivenLadder = (puzzle, numRows, numCols, counts) => {
  if (!puzzle.solution) {
    throw new Error(`ladder: '${puzzle.name}' has no known solution to reveal givens from`);
  }
  const numCells = numRows * numCols;
  const order = balancedCellOrder(numRows, numCols);

  const givenFor = (cell) => {
    const row = (cell / numCols | 0) + 1;
    const col = (cell % numCols) + 1;
    return `~R${row}C${col}_${puzzle.solution[cell]}`;
  };

  const seen = new Set();
  const rungs = [];
  for (const count of counts) {
    if (!(count > 0 && count < numCells) || seen.has(count)) continue;
    seen.add(count);
    rungs.push({
      name: `${puzzle.name} - ladder ${count}`,
      src: puzzle.src,
      input: puzzle.input + '.' + order.slice(0, count).map(givenFor).join(''),
      solution: puzzle.solution,
      generatedFrom: puzzle.name,
    });
  }
  return rungs;
};
