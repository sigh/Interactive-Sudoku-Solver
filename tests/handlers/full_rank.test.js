import assert from 'node:assert/strict';

import { runTest } from '../helpers/test_runner.js';

const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js' + self.VERSION_PARAM);
import {
  setupConstraintTest,
  createAccumulator,
  createCellExclusions,
  valueMask,
  initializeConstraintHandler,
} from '../helpers/constraint_test_utils.js';

const { FullRank } = await import('../../js/solver/handlers.js');
const { GridShape } = await import('../../js/grid_shape.js');

//////////////////////////////////////////////////////////////////////////////
// buildEntries tests
//////////////////////////////////////////////////////////////////////////////

await runTest('FullRank.buildEntries should create correct entries for 9x9', () => {
  const shape = GridShape.fromGridSize(9);
  const entries = FullRank.buildEntries(shape);

  // 9 rows * 2 directions + 9 cols * 2 directions = 36 entries
  assert.equal(entries.length, 36);

  // First row forward: cells 0-8
  assert.deepEqual([...entries[0]], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  // First row reversed
  assert.deepEqual([...entries[1]], [8, 7, 6, 5, 4, 3, 2, 1, 0]);
  // First column forward: cells 0, 9, 18, 27, 36, 45, 54, 63, 72
  assert.deepEqual([...entries[18]], [0, 9, 18, 27, 36, 45, 54, 63, 72]);
  // First column reversed
  assert.deepEqual([...entries[19]], [72, 63, 54, 45, 36, 27, 18, 9, 0]);
});

await runTest('FullRank.buildEntries should create correct entries for 4x4', () => {
  const shape = GridShape.fromGridSize(4);
  const entries = FullRank.buildEntries(shape);

  // 4 rows * 2 directions + 4 cols * 2 directions = 16 entries
  assert.equal(entries.length, 16);

  // All entries should have 4 cells
  for (const entry of entries) {
    assert.equal(entry.length, 4);
  }

  // First row: cells 0-3
  assert.deepEqual([...entries[0]], [0, 1, 2, 3]);
  // Second row: cells 4-7
  assert.deepEqual([...entries[2]], [4, 5, 6, 7]);
  // First column: cells 0, 4, 8, 12
  assert.deepEqual([...entries[8]], [0, 4, 8, 12]);
  // Second column: cells 1, 5, 9, 13
  assert.deepEqual([...entries[10]], [1, 5, 9, 13]);
});

//////////////////////////////////////////////////////////////////////////////
// initialize tests
//////////////////////////////////////////////////////////////////////////////

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
  assert.equal(grid[4], valueMask(2));
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
    const v = valueMask(i + 1);
    grid[lowEntry[i]] = v;
    grid[highEntry[i]] = v;
  }

  assert.equal(handler._enforceOrderedEntryPair(grid, acc, lowEntry, highEntry), false);
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
    grid[lowEntry[i]] = valueMask(lowDigits[i]);
    grid[highEntry[i]] = valueMask(highDigits[i]);
  }

  assert.equal(handler._enforceOrderedEntryPair(grid, acc, lowEntry, highEntry), true);
});

await runTest('FullRank enforceConsistency should prune based on clued rank ordering', () => {
  // Use a 4x4 grid so the entries are short and easy to reason about.
  // Provide a full rank-set (4 clues) so enforceConsistency does not need to
  // reason about unclued-entry counts.
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);

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
  grid[1] = valueMask(2, 3, 4);
  grid[5] = valueMask(2);
  grid[2] = valueMask(3);
  grid[6] = valueMask(4);

  // Sanity: clue start cells should already be fixed to value 1.
  assert.equal(grid[0], value1);
  assert.equal(grid[4], value1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);

  // Ordering should prune Row0[1] down to value 2.
  assert.equal(grid[1], valueMask(2));
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
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);
  grid[3] = valueMask(4);

  grid[5] = valueMask(2);
  grid[6] = valueMask(3);
  grid[7] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRank clued ranks should still reject forced ties when globallyUnique=true', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const clues = [
    { rank: 1, line: Uint8Array.from([0, 1]) },
    { rank: 2, line: Uint8Array.from([4, 5]) },
    { rank: 3, line: Uint8Array.from([8, 9]) },
    { rank: 4, line: Uint8Array.from([12, 13]) },
  ];

  const handler = new FullRank(16, clues, FullRank.TIE_MODE.NONE);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Force Row0 and Row1 to tie completely (identical fixed digits).
  grid[1] = valueMask(2);
  grid[2] = valueMask(3);
  grid[3] = valueMask(4);
  grid[5] = valueMask(2);
  grid[6] = valueMask(3);
  grid[7] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRank enforceConsistency should fail when not enough viable entries exist', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);

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

await runTest('FullRank unclued entry selection should not count forced ties as < or >', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);

  // One clue in the value-1 rank set at rankIndex=1 (rank=2).
  // This requires 1 strictly-less and 2 strictly-greater unclued entries.
  // If all viable unclued entries are forced ties, the constraint must fail.
  const handler = new FullRank(16, [{ rank: 2, line: Uint8Array.from([4, 5]) }]);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to a pattern that allows
  // us to create forced ties on other entries.
  // Note: We intentionally allow repeated digits here; these tests are about FullRank
  // ordering semantics, not Sudoku validity.
  grid[5] = value2;
  grid[6] = value2;
  grid[7] = value1;

  // Make exactly three unclued entries viable (start cell includes value1) and force
  // each of them to be an exact tie with the clued entry.
  // Viable unclued entries (by start cell):
  //  - row 1 reverse starts at 7: [7,6,5,4]
  //  - row 2 forward starts at 8: [8,9,10,11]
  //  - row 2 reverse starts at 11: [11,10,9,8]
  const keptStartCells = new Set([7, 8, 11]);

  // Force row 2 forward to match the clued entry positionally.
  grid[8] = value1;
  grid[9] = value2;
  grid[10] = value2;
  grid[11] = value1;

  // Remove value1 from all other unclued-entry start cells so only the above three
  // entries are viable.
  for (let i = 0; i < handler._uncluedEntries.length; i++) {
    const startCell = handler._uncluedEntries[i][0];
    if (keptStartCells.has(startCell)) continue;
    grid[startCell] &= ~value1;
  }

  const acc = createAccumulator();
  // All viable entries are forced ties, so none can satisfy strict < or >.
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRankTies any should allow missing ">" ranks due to ties', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Single clue at rank=2 => rankIndex=1.
  // numRanksBelow=1 is still strict, but numRanksAbove is permissive when permissiveClues=true.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward

  const makeGridAndViableEntries = (handler) => {
    const grid = context.createGrid();
    assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

    // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
    grid[5] = value3;
    grid[6] = value4;
    grid[7] = value2;

    // Choose EXACTLY three unclued entries to be considered viable, to avoid
    // accidentally including other entries that share the same start cell.
    const idxLess = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1);   // row 0 forward
    const idxTie = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9);    // row 2 forward
    const idxGreater = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13); // row 3 forward
    assert.ok(idxLess >= 0 && idxTie >= 0 && idxGreater >= 0);

    const viableEntries = Int16Array.from([idxLess, idxTie, idxGreater]);

    // Ensure the start cells can be set to the rank-set value.
    grid[0] |= value1;
    grid[8] |= value1;
    grid[12] |= value1;

    // Less-only: row 0 forward => [?,2,2,2] < [?,3,4,2].
    grid[1] = value2;
    grid[2] = value2;
    grid[3] = value2;

    // Tie: row 2 forward => [?,3,4,2] == clued.
    grid[9] = value3;
    grid[10] = value4;
    grid[11] = value2;

    // Greater-only: row 3 forward => [?,4,4,4] > [?,3,4,2].
    grid[13] = value4;
    grid[14] = value4;
    grid[15] = value4;

    return { grid, viableEntries };
  };

  // Strict: requires enough strictly-greater entries for numRanksAbove.
  {
    const strictHandler = new FullRank(16, [clue], FullRank.TIE_MODE.ONLY_UNCLUED);
    const { grid, viableEntries } = makeGridAndViableEntries(strictHandler);
    const given = strictHandler._rankSets[0].givens[0];
    const acc = createAccumulator();
    assert.equal(
      strictHandler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
      false,
    );
  }

  // Permissive: allows the shortfall due to ties.
  {
    const permissiveHandler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);
    const { grid, viableEntries } = makeGridAndViableEntries(permissiveHandler);
    const given = permissiveHandler._rankSets[0].givens[0];
    const acc = createAccumulator();
    assert.equal(
      permissiveHandler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
      true,
    );
    // numRanksBelow is still strict: the single less-only entry is forced to be included.
    assert.equal(grid[0], value1);
  }
});

await runTest('FullRankTies any should allow skipping multiple ranks due to multiple ties', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Single clue at rank=2 => rankIndex=1.
  // If TWO other unclued entries are forced to tie with the clued entry, then
  // ranks 3 and 4 are skipped, so we may have 0 strictly-greater entries.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward

  const makeGridAndViableEntries = (handler) => {
    const grid = context.createGrid();
    assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

    // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
    grid[5] = value3;
    grid[6] = value4;
    grid[7] = value2;

    // Choose EXACTLY three unclued entries to be considered viable.
    //  - one less-only
    //  - two forced ties (equal to clued)
    const idxLess = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1);   // row 0 forward
    const idxTie1 = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9);   // row 2 forward
    const idxTie2 = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13); // row 3 forward
    assert.ok(idxLess >= 0 && idxTie1 >= 0 && idxTie2 >= 0);

    const viableEntries = Int16Array.from([idxLess, idxTie1, idxTie2]);

    // Ensure the start cells can be set to the rank-set value.
    grid[0] |= value1;
    grid[8] |= value1;
    grid[12] |= value1;

    // Less-only: row 0 forward => [?,2,2,2] < [?,3,4,2].
    grid[1] = value2;
    grid[2] = value2;
    grid[3] = value2;

    // Ties: row 2 forward and row 3 forward are identical to clued.
    grid[9] = value3;
    grid[10] = value4;
    grid[11] = value2;
    grid[13] = value3;
    grid[14] = value4;
    grid[15] = value2;

    return { grid, viableEntries };
  };

  // Strict: requires enough strictly-greater entries for numRanksAbove.
  {
    const strictHandler = new FullRank(16, [clue], FullRank.TIE_MODE.ONLY_UNCLUED);
    const { grid, viableEntries } = makeGridAndViableEntries(strictHandler);
    const given = strictHandler._rankSets[0].givens[0];
    const acc = createAccumulator();
    assert.equal(
      strictHandler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
      false,
    );
  }

  // Permissive: allows the shortfall due to ties consuming multiple ranks.
  {
    const permissiveHandler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);
    const { grid, viableEntries } = makeGridAndViableEntries(permissiveHandler);
    const given = permissiveHandler._rankSets[0].givens[0];
    const acc = createAccumulator();
    assert.equal(
      permissiveHandler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
      true,
    );
    // numRanksBelow is still strict: the single less-only entry is forced to be included.
    assert.equal(grid[0], value1);
  }
});

await runTest('FullRankTies any should still reject too many forced ">" entries', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Clued entry digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  // Force three different entries to be:
  //  - included in this rank set (start cell fixed to value1)
  //  - strictly greater than the clued entry.
  // With rankIndex=1, numRanksAbove=2, so 3 forced-greater entries must reject.
  const forcedGreaterStarts = [0, 8, 12];
  for (const s of forcedGreaterStarts) grid[s] = value1;

  // Make row0 forward, row2 forward, row3 forward all greater-only by setting their second cell to 4.
  grid[1] = value4;
  grid[9] = value4;
  grid[13] = value4;

  // Provide exactly one less-only option so the less-side requirement doesn't fail first.
  // Use row0 reverse start 3: [3,2,1,0] with second cell 2 < 3.
  grid[2] = value2;

  const keptStartCells = new Set([0, 8, 12, 3]);
  for (let i = 0; i < handler._uncluedEntries.length; i++) {
    const startCell = handler._uncluedEntries[i][0];
    if (keptStartCells.has(startCell)) continue;
    grid[startCell] &= ~value1;
  }

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRank permissive should exclude extra < candidate only when not-equal is proven', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Clue at rank=2 => rankIndex=1 => numRanksBelow=1.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);

  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  const given = handler._rankSets[0].givens[0];

  // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  // Two viable entries that are both less-than the clued entry.
  // One is already set to the rank-set value (fixed <), the other is not.
  const idxFixedLess = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1); // row 0 forward
  const idxExtraLess = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9); // row 2 forward
  assert.ok(idxFixedLess >= 0 && idxExtraLess >= 0);

  // Fixed less: start cell fixed to rank-set value.
  grid[0] = value1;
  grid[1] = value2; // 2 < 3 ensures strict < and proves not-equal.

  // Extra less: start cell contains the rank-set value but isn't fixed.
  grid[8] |= value1;
  grid[8] |= value2;
  grid[9] = value2; // 2 < 3 ensures strict < and proves not-equal.

  const viableEntries = Int16Array.from([idxFixedLess, idxExtraLess]);
  const acc = createAccumulator();
  assert.equal(
    handler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
    true,
  );

  // Since we already have the required fixed < entry, the other less-only entry
  // must be excluded from this rank set (i.e. cannot take the rank-set value).
  assert.equal((grid[8] & value1) !== 0, false);
});

await runTest('FullRank permissive should exclude extra > candidate only when not-equal is proven', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Clue at rank=2 => rankIndex=1 => numRanksAbove=2.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);

  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  const given = handler._rankSets[0].givens[0];

  // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  // Two fixed greater-only entries (fill the required numRanksAbove slots).
  const idxGreater1 = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13); // row 3 forward
  const idxGreater2 = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1); // row 0 forward
  // One extra greater-only entry that is viable but not set.
  const idxGreaterExtra = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9); // row 2 forward
  // One less-only entry so the strict "below" requirement doesn't fail first.
  const idxLess = handler._uncluedEntries.findIndex(e => e[0] === 3 && e[1] === 2); // row 0 reverse
  assert.ok(idxGreater1 >= 0 && idxGreater2 >= 0 && idxGreaterExtra >= 0 && idxLess >= 0);

  // Fixed greater entries: start fixed to rank-set value, second digit 4 > 3.
  grid[12] = value1;
  grid[13] = value4;
  grid[0] = value1;
  grid[1] = value4;

  // Extra greater: start includes rank-set value but isn't fixed.
  grid[8] |= value1;
  grid[8] |= value2;
  grid[9] = value4;

  // Less-only: second digit 2 < 3. Start includes rank-set value but isn't fixed.
  grid[3] |= value1;
  grid[3] |= value2;
  grid[2] = value2;

  const viableEntries = Int16Array.from([idxGreater1, idxGreater2, idxGreaterExtra, idxLess]);
  const acc = createAccumulator();
  assert.equal(
    handler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
    true,
  );

  // Since we already have the required fixed > entries, the other greater-only entry
  // must be excluded from this rank set.
  assert.equal((grid[8] & value1) !== 0, false);
});

await runTest('FullRank should not force/exclude a both-sides viable entry (only-unclued)', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Clue at rank=3 => rankIndex=2 => needs 2 entries below, 1 above.
  // We provide enough viable entries that no entry is forced or excluded.
  const clue = { rank: 3, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ONLY_UNCLUED);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  const given = handler._rankSets[0].givens[0];

  // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  // Entries:
  //  - two less-only (ensure maybeLessCount > numRanksBelow so nothing is forced)
  //  - one both-sides (can be < or >)
  //  - one greater-only (ensure maybeGreaterCount > numRanksAbove)
  const idxLess1 = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1);    // row 0 forward
  const idxBoth = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9);     // row 2 forward
  const idxLess2 = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13);  // row 3 forward
  const idxGreater = handler._uncluedEntries.findIndex(e => e[0] === 3 && e[1] === 2);  // row 0 reverse
  assert.ok(idxLess1 >= 0 && idxBoth >= 0 && idxLess2 >= 0 && idxGreater >= 0);

  const viableEntries = Int16Array.from([idxLess1, idxBoth, idxLess2, idxGreater]);

  // Ensure the start cells can be set to the rank-set value but are NOT fixed.
  grid[0] = valueMask(1, 2);
  grid[8] = valueMask(1, 2);
  grid[12] = valueMask(1, 2);
  grid[3] = valueMask(1, 2);

  // Less-only entries: second cell fixed to 2 (< 3).
  grid[1] = value2;
  grid[13] = value2;

  // Both-sides entry: second cell can be 2 or 4, so it can be < or > vs 3.
  grid[9] = valueMask(2, 4);

  // Greater-only entry (row 0 reverse): its second cell (cell 2) fixed to 4 (> 3).
  grid[2] = value4;

  const startBefore = grid[8];
  const acc = createAccumulator();
  assert.equal(
    handler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
    true,
  );

  // Since counts don't force inclusion/exclusion, the both-sides entry start should be unchanged.
  assert.equal(grid[8], startBefore);
  assert.equal((grid[8] & value1) !== 0, true);
  assert.equal((grid[8] & value2) !== 0, true);
});

await runTest('FullRank should not force/exclude a both-sides viable entry (any)', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  const clue = { rank: 3, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  const given = handler._rankSets[0].givens[0];

  // Clued entry digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  const idxLess1 = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1);    // row 0 forward
  const idxBoth = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9);     // row 2 forward
  const idxLess2 = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13);  // row 3 forward
  const idxGreater = handler._uncluedEntries.findIndex(e => e[0] === 3 && e[1] === 2);  // row 0 reverse
  assert.ok(idxLess1 >= 0 && idxBoth >= 0 && idxLess2 >= 0 && idxGreater >= 0);
  const viableEntries = Int16Array.from([idxLess1, idxBoth, idxLess2, idxGreater]);

  // Start cells (not fixed).
  grid[0] = valueMask(1, 2);
  grid[8] = valueMask(1, 2);
  grid[12] = valueMask(1, 2);
  grid[3] = valueMask(1, 2);

  // Less-only.
  grid[1] = value2;
  grid[13] = value2;

  // Both-sides.
  grid[9] = valueMask(2, 4);

  // Greater-only.
  grid[2] = value4;

  const startBefore = grid[8];
  const acc = createAccumulator();
  assert.equal(
    handler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
    true,
  );

  assert.equal(grid[8], startBefore);
});

await runTest('FullRankTies only-unclued should reject an unclued entry forced to tie a clued entry (even if counts are satisfied)', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Clue at rank=2 => rankIndex=1 => needs 1 strictly-less and 2 strictly-greater entries.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ONLY_UNCLUED);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  const given = handler._rankSets[0].givens[0];

  // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  // Force one unclued entry to be an exact tie with the clued entry:
  // row 2 forward: [8,9,10,11]
  grid[8] = value1;
  grid[9] = value3;
  grid[10] = value4;
  grid[11] = value2;

  // Provide one strictly-less and two strictly-greater entries, without
  // conflicting with the tie entry.
  // Less: row 0 forward [0,1,2,3] is 2 < 3 at j=1.
  grid[0] = value1;
  grid[1] = value2;
  grid[2] = value1; // also used as start for the column entry below.
  grid[3] = value2;

  // Greater #1: row 3 forward [12,13,14,15] is 4 > 3 at j=1.
  grid[12] = value1;
  grid[13] = value4;
  grid[14] = value4;
  grid[15] = value4;

  // Greater #2: col 2 forward [2,6,10,14] is 4 > 3 at j=1.
  // (cell 6 is already fixed to 4 by the clued entry)
  grid[10] = value4;
  grid[14] = value4;

  const idxTie = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9);        // row 2 forward
  const idxLess = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1);       // row 0 forward
  const idxGreaterRow = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13); // row 3 forward
  const idxGreaterCol = handler._uncluedEntries.findIndex(e => e[0] === 2 && e[1] === 6); // col 2 forward
  assert.ok(idxTie >= 0 && idxLess >= 0 && idxGreaterRow >= 0 && idxGreaterCol >= 0);

  // Sanity: without the tie entry, the less/greater counts are satisfiable.
  // This ensures the rejection is specifically due to the forced tie with a
  // clued entry (which is invalid in ONLY_UNCLUED mode), not due to a generic
  // lack of viable < or > entries.
  {
    const viableNoTie = Int16Array.from([idxLess, idxGreaterRow, idxGreaterCol]);
    const acc = createAccumulator();
    assert.equal(
      handler._enforceUncluedEntriesForGiven(grid, acc, viableNoTie, viableNoTie.length, given),
      true,
    );
  }

  // Adding an unclued entry that is forced to be identical to the clued entry
  // must be rejected.
  {
    const viableWithTie = Int16Array.from([idxTie, idxLess, idxGreaterRow, idxGreaterCol]);
    const acc = createAccumulator();
    assert.equal(
      handler._enforceUncluedEntriesForGiven(grid, acc, viableWithTie, viableWithTie.length, given),
      false,
    );
  }
});

await runTest('FullRank should reject whole-entry fixed ties within a rank set', () => {
  const { handler, context } = initializeConstraintHandler(FullRank, {
    args: [81, [], FullRank.TIE_MODE.NONE],
    shapeConfig: { gridSize: 9 },
  });

  const grid = context.createGrid();

  // Force two different rows to be assigned to the same rank-set value and
  // to be identical, fully fixed entries.
  const row1 = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const row2 = Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  for (let i = 0; i < 9; i++) {
    const v = valueMask(i + 1);
    grid[row1[i]] = v;
    grid[row2[i]] = v;
  }

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRankTies none should reject a row equal to a column', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const handler = new FullRank(16, [], FullRank.TIE_MODE.NONE);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Make row 0 forward and col 0 forward identical, fully fixed entries.
  // row0: [0,1,2,3]
  // col0: [0,4,8,12]
  const row0 = [0, 1, 2, 3];
  const col0 = [0, 4, 8, 12];
  const digits = [1, 2, 3, 4];
  for (let i = 0; i < 4; i++) {
    const v = valueMask(digits[i]);
    grid[row0[i]] = v;
    grid[col0[i]] = v;
  }

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRankTies none should reject a row equal to a column reversed', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const handler = new FullRank(16, [], FullRank.TIE_MODE.NONE);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Make row 0 forward equal to col 3 reverse.
  // row0:        [0, 1, 2, 3]
  // col3 reverse: [15,11,7,3]
  const row0 = [0, 1, 2, 3];
  const col3rev = [15, 11, 7, 3];
  const digits = [1, 2, 3, 4];
  for (let i = 0; i < 4; i++) {
    grid[row0[i]] = valueMask(digits[i]);
    grid[col3rev[i]] = valueMask(digits[i]);
  }

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), false);
});

await runTest('FullRankTies none should allow a partial whole-entry tie (not fully fixed)', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const handler = new FullRank(16, [], FullRank.TIE_MODE.NONE);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Two rows share the same fixed endpoints (1 and 4) and the same fixed mid cell.
  // But they are NOT fully fixed: at least one interior cell remains multi-valued.
  // This should be considered valid (uniqueness enforcement is fixed-only).
  // row0 forward: [0,1,2,3]
  // row1 forward: [4,5,6,7]
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(4);

  grid[4] = valueMask(1);
  grid[5] = valueMask(2);
  grid[6] = valueMask(2, 3);
  grid[7] = valueMask(4);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('FullRankTies none should allow a partial reversed tie (not fully fixed)', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const handler = new FullRank(16, [], FullRank.TIE_MODE.NONE);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // row0 forward: [0,1,2,3] => [1,2,?,4]
  grid[0] = valueMask(1);
  grid[1] = valueMask(2);
  grid[2] = valueMask(2, 3);
  grid[3] = valueMask(4);

  // row1 forward: [4,5,6,7] => [4,2,?,1]
  // Its reverse entry [7,6,5,4] shares endpoints [1,4] and mid fixed.
  grid[4] = valueMask(4);
  grid[5] = valueMask(2, 3);
  grid[6] = valueMask(2);
  grid[7] = valueMask(1);

  const acc = createAccumulator();
  assert.equal(handler.enforceConsistency(grid, acc), true);
});

await runTest('FullRank should throw when clue ranks are duplicated', () => {
  assert.throws(() => {
    new FullRank(16, [
      { rank: 1, line: Uint8Array.from([0, 1]) },
      { rank: 1, line: Uint8Array.from([4, 5]) },
    ]);
  }, /not unique/i);
});

await runTest('FullRank initialize should fail when two clues force different rank-set values on the same entry', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const grid = context.createGrid();

  // Two clues point at the same entry start, but belong to different rank sets:
  // rank 1 => value 1 rank set; rank 5 => value 2 rank set.
  const handler = new FullRank(16, [
    { rank: 1, line: Uint8Array.from([0, 1]) },
    { rank: 5, line: Uint8Array.from([0, 1]) },
  ]);

  assert.equal(
    handler.initialize(grid, createCellExclusions(), context.shape, {}),
    false,
  );
});

await runTest('FullRank initialize should fail for out-of-range rank', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const grid = context.createGrid();

  // For a 4x4 grid, ranks are grouped into 4 rank sets of 4 (1..16).
  // rank 17 implies a rank-set value of 5, which cannot exist.
  const handler = new FullRank(16, [{ rank: 17, line: Uint8Array.from([0, 1]) }]);

  assert.equal(
    handler.initialize(grid, createCellExclusions(), context.shape, {}),
    false,
  );
});

await runTest('FullRankTies any should still require enough "<" entries (no shortfall)', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = valueMask(1);
  const value2 = valueMask(2);
  const value3 = valueMask(3);
  const value4 = valueMask(4);

  // Single clue at rank=3 => rankIndex=2.
  // This requires TWO strictly-less unclued entries. TIE_MODE.ANY does not
  // relax the "below" requirement.
  const clue = { rank: 3, line: Uint8Array.from([4, 5]) }; // row 1 forward

  const handler = new FullRank(16, [clue], FullRank.TIE_MODE.ANY);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);
  const given = handler._rankSets[0].givens[0];

  // Fully fix the clued entry (row 1 forward: [4,5,6,7]) to digits [1,3,4,2].
  grid[5] = value3;
  grid[6] = value4;
  grid[7] = value2;

  // Choose EXACTLY three viable entries:
  //  - one less-only
  //  - two forced ties
  const idxLess = handler._uncluedEntries.findIndex(e => e[0] === 0 && e[1] === 1);   // row 0 forward
  const idxTie1 = handler._uncluedEntries.findIndex(e => e[0] === 8 && e[1] === 9);   // row 2 forward
  const idxTie2 = handler._uncluedEntries.findIndex(e => e[0] === 12 && e[1] === 13); // row 3 forward
  assert.ok(idxLess >= 0 && idxTie1 >= 0 && idxTie2 >= 0);

  const viableEntries = Int16Array.from([idxLess, idxTie1, idxTie2]);

  // Ensure the start cells can be set to the rank-set value.
  grid[0] |= value1;
  grid[8] |= value1;
  grid[12] |= value1;

  // Less-only: row 0 forward => [?,2,2,2] < [?,3,4,2].
  grid[1] = value2;
  grid[2] = value2;
  grid[3] = value2;

  // Ties: rows 2 and 3 forward identical to clued.
  grid[9] = value3;
  grid[10] = value4;
  grid[11] = value2;
  grid[13] = value3;
  grid[14] = value4;
  grid[15] = value2;

  const acc = createAccumulator();
  assert.equal(
    handler._enforceUncluedEntriesForGiven(grid, acc, viableEntries, viableEntries.length, given),
    false,
  );
});

await runTest('FullRankTies none should reject a row equal to another row reversed', async () => {
  const solver = new SimpleSolver();
  const base =
    '.Shape~4x4.' +
    '.~R1C1_3.~R1C2_4.~R1C3_2.~R1C4_1.' +
    '.~R2C1_1.~R2C2_2.~R2C3_4.~R2C4_3.';

  assert.notEqual(await solver.solution(base), null);
  assert.equal(await solver.solution('.Shape~4x4.FullRankTies~none' + base.slice('.Shape~4x4'.length)), null);
});

await runTest('FullRank 4x4 regression: provided constraint string has no solutions', async () => {
  const solver = new SimpleSolver();
  const puzzle =
    '.Shape~4x4.FullRankTies~none.FullRank~C1~10~.FullRank~C2~15~.FullRank~C4~3~.FullRank~C3~~4.';

  assert.equal(await solver.solution(puzzle), null);
});

await runTest('FullRank 4x4 regression: FullRankTies any should allow a solution (solver)', async () => {
  const solver = new SimpleSolver();
  const puzzle = '.Shape~4x4.FullRank~C1~10~.FullRank~C2~15~.FullRank~R4~5~.FullRankTies~any';

  assert.notEqual(await solver.solution(puzzle), null);
});

await runTest('FullRankTies only-unclued vs any: any can be solvable when only-unclued is not (solver)', async () => {
  const solver = new SimpleSolver();
  const anyPuzzle = '.Shape~4x4.FullRankTies~any.FullRank~R1~2~..FullRank~C3~15~.';
  const onlyPuzzle = '.Shape~4x4.FullRankTies~only-unclued.FullRank~R1~2~..FullRank~C3~15~.';

  assert.notEqual(await solver.solution(anyPuzzle), null);
  assert.equal(await solver.solution(onlyPuzzle), null);
});

await runTest('FullRank optimizer should dedupe same-rank clues and enforce equality (solver)', async () => {
  const solver = new SimpleSolver();
  // Two FullRank clues with the same rank imply the corresponding entries are tied,
  // so the optimizer should add equality constraints and keep only one of them
  // in the final FullRank handler.
  const puzzle = '.Shape~4x4.FullRankTies~any.FullRank~R1~1~..FullRank~R2~~1.';

  assert.notEqual(await solver.solution(puzzle), null);
});
