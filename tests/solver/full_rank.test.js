import assert from 'node:assert/strict';
import { performance as perf } from 'node:perf_hooks';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest } from '../helpers/test_runner.js';
import {
  setupConstraintTest,
  createAccumulator,
  createCellExclusions,
  mask,
  initializeConstraintHandler,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment({
  needWindow: true,
  documentValue: undefined,
  locationValue: { search: '' },
  performance: perf,
});

const { LookupTables } = await import('../../js/solver/lookup_tables.js');
const { FullRank } = await import('../../js/solver/handlers.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');

await runTest('FullRank initialize should fail for invalid clue line', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const grid = context.createGrid();

  // [0,2] is not the start of any entry (rows/cols are contiguous).
  const handler = new FullRank(16, [{ rank: 1, line: Uint8Array.from([0, 2]) }]);
  assert.equal(
    handler.initialize(grid, createCellExclusions(), context.shape, {}),
    false,
  );
});

await runTest('FullRank initialize should restrict clue start cell to rank-set value', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const grid = context.createGrid();

  // rank=5 => valueIndex=(5+3)>>2 = 2 => start cell must include only value 2.
  const handler = new FullRank(16, [{ rank: 5, line: Uint8Array.from([4, 5]) }]);
  assert.equal(
    handler.initialize(grid, createCellExclusions(), context.shape, {}),
    true,
  );
  assert.equal(grid[4], LookupTables.fromValue(2));
});

await runTest('FullRank ordering should reject forced ties', () => {
  const handler = new FullRank(81, []);
  const acc = createAccumulator();
  const context = setupConstraintTest({ gridSize: 9 });
  const grid = context.createGrid();

  const lowEntry = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const highEntry = Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16, 17]);

  // Force the two entries to be identical in every compared cell.
  // (Not a valid Sudoku state, but sufficient to validate strict tie handling.)
  for (let i = 0; i < 9; i++) {
    const v = LookupTables.fromValue(i + 1);
    grid[lowEntry[i]] = v;
    grid[highEntry[i]] = v;
  }

  assert.equal(handler._enforceEntriesWithKnownOrder(grid, acc, lowEntry, highEntry), false);
});

await runTest('FullRank ordering should allow strict non-ties', () => {
  const handler = new FullRank(81, []);
  const acc = createAccumulator();
  const context = setupConstraintTest({ gridSize: 9 });
  const grid = context.createGrid();

  const lowEntry = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const highEntry = Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16, 17]);

  // Make them equal up to a point, then ensure low < high at the first
  // difference so the strict ordering is satisfiable.
  const lowDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const highDigits = [1, 2, 3, 4, 5, 6, 7, 9, 8];

  for (let i = 0; i < 9; i++) {
    grid[lowEntry[i]] = LookupTables.fromValue(lowDigits[i]);
    grid[highEntry[i]] = LookupTables.fromValue(highDigits[i]);
  }

  assert.equal(handler._enforceEntriesWithKnownOrder(grid, acc, lowEntry, highEntry), true);
});

await runTest('FullRank enforceConsistency should prune based on clued rank ordering', () => {
  // Use a 4x4 grid so the entries are short and easy to reason about.
  // Provide a full rank-set (4 clues) so enforceConsistency does not need to
  // reason about unclued-entry counts.
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = LookupTables.fromValue(1);

  const clues = [
    { rank: 1, line: Uint8Array.from([0, 1]) },  // row 0 (forward)
    { rank: 2, line: Uint8Array.from([4, 5]) },  // row 1 (forward)
    { rank: 3, line: Uint8Array.from([8, 9]) },  // row 2 (forward)
    { rank: 4, line: Uint8Array.from([12, 13]) }, // row 3 (forward)
  ];
  const handler = new FullRank(16, clues);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Row0 must be < Row1. Force Row1[1] to 2, allow Row0[1] to be {2,3,4}.
  // Ensure the tie is broken later (Row0[2]=3, Row1[2]=4) so strictness is satisfiable.
  grid[1] = mask(2, 3, 4);
  grid[5] = mask(2);
  grid[2] = mask(3);
  grid[6] = mask(4);

  // Sanity: clue start cells should already be fixed to value 1.
  assert.equal(grid[0], value1);
  assert.equal(grid[4], value1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);

  // Ordering should prune Row0[1] down to value 2.
  assert.equal(grid[1], mask(2));
  assert.equal(acc.touched.has(1), true);
});

await runTest('FullRank enforceConsistency should reject forced tie between consecutive clued ranks', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const clues = [
    { rank: 1, line: Uint8Array.from([0, 1]) },
    { rank: 2, line: Uint8Array.from([4, 5]) },
    { rank: 3, line: Uint8Array.from([8, 9]) },
    { rank: 4, line: Uint8Array.from([12, 13]) },
  ];

  const handler = new FullRank(16, clues);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Force Row0 and Row1 to tie completely (identical fixed digits).
  // First cells are already fixed to 1 by initialize.
  grid[1] = mask(2);
  grid[2] = mask(3);
  grid[3] = mask(4);

  grid[5] = mask(2);
  grid[6] = mask(3);
  grid[7] = mask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRank enforceConsistency should fail when not enough viable entries exist', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = LookupTables.fromValue(1);

  // Single clue in value 1 rank set => needs 3 additional unclued entries.
  // Pick a non-corner edge start cell (4) to avoid overlaps with column starts.
  const handler = new FullRank(16, [{ rank: 1, line: Uint8Array.from([4, 5]) }]);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  assert.equal(grid[4], value1);

  // Make almost all unclued entry start cells exclude value1, leaving only 2 viable.
  const keptStartCells = new Set();
  for (let i = 0; i < handler._uncluedEntries.length; i++) {
    const startCell = handler._uncluedEntries[i][0];
    if (keptStartCells.size < 2) {
      keptStartCells.add(startCell);
      continue;
    }
    grid[startCell] &= ~value1;
  }

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRank should reject whole-entry fixed ties within a rank set', () => {
  const { handler, context } = initializeConstraintHandler(FullRank, {
    args: [81, []],
    shapeConfig: { gridSize: 9 },
  });

  const grid = context.createGrid();

  // Force two different rows to be assigned to the same rank-set value and
  // to be identical, fully fixed entries.
  const row1 = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const row2 = Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  for (let i = 0; i < 9; i++) {
    const v = LookupTables.fromValue(i + 1);
    grid[row1[i]] = v;
    grid[row2[i]] = v;
  }

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRank 4x4 regression: provided constraint string has no solutions', async () => {
  const puzzle = '.Shape~4x4.FullRank~C1~10~.FullRank~C2~15~.FullRank~C4~3~.FullRank~C3~~4';

  const parsed = SudokuParser.parseString(puzzle);
  const resolved = SudokuBuilder.resolveConstraint(parsed);
  const solver = SudokuBuilder.build(resolved);

  const sol = solver.nthSolution(0);
  assert.equal(sol, null);
});
