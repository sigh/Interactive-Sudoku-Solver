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
    grid[lowEntry[i]] = LookupTables.fromValue(lowDigits[i]);
    grid[highEntry[i]] = LookupTables.fromValue(highDigits[i]);
  }

  assert.equal(handler._enforceOrderedEntryPair(grid, acc, lowEntry, highEntry), true);
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

await runTest('FullRank clued ranks should still reject forced ties when globallyUnique=true', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const clues = [
    { rank: 1, line: Uint8Array.from([0, 1]) },
    { rank: 2, line: Uint8Array.from([4, 5]) },
    { rank: 3, line: Uint8Array.from([8, 9]) },
    { rank: 4, line: Uint8Array.from([12, 13]) },
  ];

  const handler = new FullRank(16, clues, true);
  const grid = context.createGrid();
  assert.equal(handler.initialize(grid, createCellExclusions(), context.shape, {}), true);

  // Force Row0 and Row1 to tie completely (identical fixed digits).
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

await runTest('FullRank unclued entry selection should not count forced ties as < or >', () => {
  const context = setupConstraintTest({ gridSize: 4 });
  const value1 = LookupTables.fromValue(1);
  const value2 = LookupTables.fromValue(2);

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
  const value1 = LookupTables.fromValue(1);
  const value2 = LookupTables.fromValue(2);
  const value3 = LookupTables.fromValue(3);
  const value4 = LookupTables.fromValue(4);

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
    const strictHandler = new FullRank(16, [clue], false, false);
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
    const permissiveHandler = new FullRank(16, [clue], false, true);
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
  const value1 = LookupTables.fromValue(1);
  const value2 = LookupTables.fromValue(2);
  const value3 = LookupTables.fromValue(3);
  const value4 = LookupTables.fromValue(4);

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
    const strictHandler = new FullRank(16, [clue], false, false);
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
    const permissiveHandler = new FullRank(16, [clue], false, true);
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
  const value1 = LookupTables.fromValue(1);
  const value2 = LookupTables.fromValue(2);
  const value3 = LookupTables.fromValue(3);
  const value4 = LookupTables.fromValue(4);

  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], false, true);
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
  const value1 = LookupTables.fromValue(1);
  const value2 = LookupTables.fromValue(2);
  const value3 = LookupTables.fromValue(3);
  const value4 = LookupTables.fromValue(4);

  // Clue at rank=2 => rankIndex=1 => numRanksBelow=1.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], false, true);

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
  const value1 = LookupTables.fromValue(1);
  const value2 = LookupTables.fromValue(2);
  const value3 = LookupTables.fromValue(3);
  const value4 = LookupTables.fromValue(4);

  // Clue at rank=2 => rankIndex=1 => numRanksAbove=2.
  const clue = { rank: 2, line: Uint8Array.from([4, 5]) }; // row 1 forward
  const handler = new FullRank(16, [clue], false, true);

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

await runTest('FullRank should reject whole-entry fixed ties within a rank set', () => {
  const { handler, context } = initializeConstraintHandler(FullRank, {
    args: [81, [], true],
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

await runTest('FullRankTies none should reject a row equal to another row reversed', async () => {
  const base =
    '.Shape~4x4.' +
    '.~R1C1_3.~R1C2_4.~R1C3_2.~R1C4_1.' +
    '.~R2C1_1.~R2C2_2.~R2C3_4.~R2C4_3.';

  const parsed1 = SudokuParser.parseString(base);
  const resolved1 = SudokuBuilder.resolveConstraint(parsed1);
  const solver1 = SudokuBuilder.build(resolved1);
  assert.notEqual(solver1.nthSolution(0), null);

  const parsed2 = SudokuParser.parseString('.Shape~4x4.FullRankTies~none' + base.slice('.Shape~4x4'.length));
  const resolved2 = SudokuBuilder.resolveConstraint(parsed2);
  const solver2 = SudokuBuilder.build(resolved2);
  assert.equal(solver2.nthSolution(0), null);
});

await runTest('FullRank 4x4 regression: provided constraint string has no solutions', async () => {
  const puzzle =
    '.Shape~4x4.FullRankTies~none.FullRank~C1~10~.FullRank~C2~15~.FullRank~C4~3~.FullRank~C3~~4.';

  const parsed = SudokuParser.parseString(puzzle);
  const resolved = SudokuBuilder.resolveConstraint(parsed);
  const solver = SudokuBuilder.build(resolved);

  const sol = solver.nthSolution(0);
  assert.equal(sol, null);
});

await runTest('FullRank 4x4 regression: FullRankTies any should allow a solution (solver)', async () => {
  const puzzle = '.Shape~4x4.FullRank~C1~10~.FullRank~C2~15~.FullRank~R4~5~.FullRankTies~any';

  const parsed = SudokuParser.parseString(puzzle);
  const resolved = SudokuBuilder.resolveConstraint(parsed);
  const solver = SudokuBuilder.build(resolved);

  const sol = solver.nthSolution(0);
  assert.notEqual(sol, null);
});

await runTest('FullRankTies only-unclued vs any: any can be solvable when only-unclued is not (solver)', async () => {
  const anyPuzzle = '.Shape~4x4.FullRankTies~any.FullRank~R1~2~..FullRank~C3~15~.';
  const onlyPuzzle = '.Shape~4x4.FullRankTies~only-unclued.FullRank~R1~2~..FullRank~C3~15~.';

  const parsedAny = SudokuParser.parseString(anyPuzzle);
  const resolvedAny = SudokuBuilder.resolveConstraint(parsedAny);
  const solverAny = SudokuBuilder.build(resolvedAny);
  assert.notEqual(solverAny.nthSolution(0), null);

  const parsedOnly = SudokuParser.parseString(onlyPuzzle);
  const resolvedOnly = SudokuBuilder.resolveConstraint(parsedOnly);
  const solverOnly = SudokuBuilder.build(resolvedOnly);
  assert.equal(solverOnly.nthSolution(0), null);
});
