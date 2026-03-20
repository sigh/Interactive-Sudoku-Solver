import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  GridTestContext,
  createCellExclusions,
  createAccumulator,
  valueMask,
  valueMask0,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { RequiredValues, HandlerUtil } = await import('../../js/solver/handlers.js');

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Create a CellExclusions object for a standard 9×9 sudoku grid.
 *
 * All row, column, and 3×3 box pairs are mutually exclusive.  The helper
 * uses the public `addMutualExclusion` API so it is independent of any
 * internal representation.
 */
const createSudoku9x9CellExclusions = () => {
  const numCells = 81;
  const exc = createCellExclusions({ allUnique: false, numCells });

  const addGroup = (cells) => {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        exc.addMutualExclusion(cells[i], cells[j]);
      }
    }
  };

  // Rows
  for (let r = 0; r < 9; r++) {
    addGroup(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  }
  // Columns
  for (let c = 0; c < 9; c++) {
    addGroup(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  }
  // 3×3 boxes
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const boxCells = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          boxCells.push((br * 3 + r) * 9 + (bc * 3 + c));
        }
      }
      addGroup(boxCells);
    }
  }

  return exc;
};

/**
 * Convert "R<row>C<col>" (1-indexed) to 0-based cell index in a 9×9 grid.
 */
const cellId = (str) => {
  const m = str.match(/[Rr](\d+)[Cc](\d+)/);
  if (!m) throw new Error(`Invalid cell ID: ${str}`);
  return (parseInt(m[1]) - 1) * 9 + (parseInt(m[2]) - 1);
};

/**
 * Parse a value string like "9_9_9" into an array of integers.
 */
const parseValues = (s) => s.split('_').map(Number);

/**
 * Build and initialize a RequiredValues (strict=true) handler.
 * Returns { handler, result, context, cellExclusions }.
 */
const initContainExact = (valStr, cellIds, cellExclusions = createSudoku9x9CellExclusions()) => {
  const cells = cellIds.map(cellId);
  const values = parseValues(valStr);
  const context = new GridTestContext();
  const handler = new RequiredValues(cells, values, /* strict */ true);
  const result = context.initializeHandler(handler, { cellExclusions });
  return { handler, result, context, cellExclusions };
};

// ===========================================================================
// Tests – findExclusionGroups
//
// These verify the fundamental building block used by RequiredValues to
// determine how many times a repeated value can legally appear.  The
// JavaScript implementation is the reference; the Rust port must match it.
// ===========================================================================

await runTest('findExclusionGroups: cells spanning 3 different boxes yield 3 groups', () => {
  // ContainExact~9_9_9~R5C1~R6C2~R7C3~R8C4~R9C5 from Look-and-say.
  // R5C1 and R6C2 share box 3; R8C4 and R9C5 share box 7; R7C3 is alone.
  const cellExclusions = createSudoku9x9CellExclusions();
  const cells = ['R5C1', 'R6C2', 'R7C3', 'R8C4', 'R9C5'].map(cellId);
  const { groups } = HandlerUtil.findExclusionGroups(cells, cellExclusions);
  assert.equal(groups.length, 3,
    `expected 3 exclusion groups but got ${groups.length}: ${JSON.stringify(groups)}`);
});

await runTest('findExclusionGroups: four cells in two adjacent rows/box split into 2 groups', () => {
  // ContainExact~3_4_4~R1C3~R2C3~R2C4~R1C4.
  // R1C3-R2C3 share column; R1C4-R2C4 share column; cross-pairs don't.
  const cellExclusions = createSudoku9x9CellExclusions();
  const cells = ['R1C3', 'R2C3', 'R2C4', 'R1C4'].map(cellId);
  const { groups } = HandlerUtil.findExclusionGroups(cells, cellExclusions);
  assert.equal(groups.length, 2,
    `expected 2 groups but got ${groups.length}`);
  // Each group has exactly 2 cells.
  assert.ok(groups.every(g => g.length === 2),
    `expected each group to have 2 cells, got sizes ${groups.map(g => g.length)}`);
});

// ===========================================================================
// Tests – RequiredValues.initialize() with standard 9×9 exclusions
//
// Each test corresponds to one ContainExact constraint from the Look-and-say
// puzzle.  All must return true because the expected solution is valid.
// ===========================================================================

await runTest('RequiredValues initialize: 6_7 / R3C1 R2C1 R1C1 (no repeats)', () => {
  const { result } = initContainExact('6_7', ['R3C1', 'R2C1', 'R1C1']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 3_4_4 / R1C3 R2C3 R2C4 R1C4 (4 appears twice)', () => {
  // count(4) = 2, maxGroups must be ≥ 2.
  const { result } = initContainExact('3_4_4', ['R1C3', 'R2C3', 'R2C4', 'R1C4']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 1 / R1C7 R1C8 (single value in 2 cells)', () => {
  const { result } = initContainExact('1', ['R1C7', 'R1C8']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 9_3 / R2C9 R2C8 R3C8 R3C7 R3C6 (no repeats)', () => {
  const { result } = initContainExact('9_3', ['R2C9', 'R2C8', 'R3C8', 'R3C7', 'R3C6']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 5_5_5_8 / 7 cells spanning boxes 2/5 (5 appears 3 times)', () => {
  // R3C9(box2), R4C9..R6C7(all box5), R6C6(box4).
  // Expected ≥ 3 exclusion groups (R3C9+R4C9+R5C9 via col8, plus box-5 group, plus R6C6).
  const { result } = initContainExact('5_5_5_8',
    ['R3C9', 'R4C9', 'R5C9', 'R5C8', 'R5C7', 'R6C7', 'R6C6']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 1_2 / R7C9 R7C8 R8C8 R8C7 R9C7 (no repeats)', () => {
  const { result } = initContainExact('1_2', ['R7C9', 'R7C8', 'R8C8', 'R8C7', 'R9C7']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 3_3_1 / R7C4 R8C4 R8C3 R8C2 R7C2 (3 appears twice)', () => {
  // R7C4 and R8C4 are in the same col; R8C3 R8C2 R7C2 form another clique.
  // Expected ≥ 2 exclusion groups.
  const { result } = initContainExact('3_3_1',
    ['R7C4', 'R8C4', 'R8C3', 'R8C2', 'R7C2']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 6_6 / R7C5 R6C5 R6C4 R5C4 (6 appears twice)', () => {
  // R7C5-R6C5 share col; R6C5-R6C4-R5C4 share box4.  Expected ≥ 2 groups.
  const { result } = initContainExact('6_6', ['R7C5', 'R6C5', 'R6C4', 'R5C4']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 1_1_3 / R6C2 R6C1 R7C1 (1 appears twice)', () => {
  // R6C2-R6C1 share row and box3; R6C1-R7C1 share col.  Expected ≥ 2 groups.
  const { result } = initContainExact('1_1_3', ['R6C2', 'R6C1', 'R7C1']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 8_8 / R7C7 R7C6 R8C6 R9C6 (8 appears twice)', () => {
  // R7C7-R7C6 share row; R7C6-R8C6-R9C6 share col.  Expected ≥ 2 groups.
  const { result } = initContainExact('8_8', ['R7C7', 'R7C6', 'R8C6', 'R9C6']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 4_2_2 / R5C5 R4C5 R4C4 R4C3 (2 appears twice)', () => {
  // R5C5-R4C5 share col and box4; R4C4-R4C3-R4C5 share row3.  Expected ≥ 2 groups.
  const { result } = initContainExact('4_2_2', ['R5C5', 'R4C5', 'R4C4', 'R4C3']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 9_9_9 / R5C1 R6C2 R7C3 R8C4 R9C5 (9 appears 3 times)', () => {
  // R5C1-R6C2 share box3; R7C3 alone; R8C4-R9C5 share box7.
  // → 3 exclusion groups, so count(9)=3 ≤ maxGroups=3.
  const { result } = initContainExact('9_9_9',
    ['R5C1', 'R6C2', 'R7C3', 'R8C4', 'R9C5']);
  assert.equal(result, true, 'initialize should return true');
});

await runTest('RequiredValues initialize: 6_6 / R6C9 R7C8 R8C7 R9C6 (6 appears twice)', () => {
  // R7C8-R8C7 share box8; others unrelated.  Expected ≥ 2 groups.
  const { result } = initContainExact('6_6', ['R6C9', 'R7C8', 'R8C7', 'R9C6']);
  assert.equal(result, true, 'initialize should return true');
});

// ===========================================================================
// Tests – RequiredValues.enforceConsistency() on a full initial grid
//
// With all 9 candidates available in every cell, enforceConsistency must
// return true for every Look-and-say constraint.
// ===========================================================================

await runTest('RequiredValues enforceConsistency: returns true on full-candidate grid', () => {
  const acc = createAccumulator();
  const constraints = [
    { valStr: '6_7',   cellIds: ['R3C1', 'R2C1', 'R1C1'] },
    { valStr: '3_4_4', cellIds: ['R1C3', 'R2C3', 'R2C4', 'R1C4'] },
    { valStr: '1',     cellIds: ['R1C7', 'R1C8'] },
    { valStr: '9_3',   cellIds: ['R2C9', 'R2C8', 'R3C8', 'R3C7', 'R3C6'] },
    { valStr: '5_5_5_8', cellIds: ['R3C9', 'R4C9', 'R5C9', 'R5C8', 'R5C7', 'R6C7', 'R6C6'] },
    { valStr: '1_2',   cellIds: ['R7C9', 'R7C8', 'R8C8', 'R8C7', 'R9C7'] },
    { valStr: '3_3_1', cellIds: ['R7C4', 'R8C4', 'R8C3', 'R8C2', 'R7C2'] },
    { valStr: '6_6',   cellIds: ['R7C5', 'R6C5', 'R6C4', 'R5C4'] },
    { valStr: '1_1_3', cellIds: ['R6C2', 'R6C1', 'R7C1'] },
    { valStr: '8_8',   cellIds: ['R7C7', 'R7C6', 'R8C6', 'R9C6'] },
    { valStr: '4_2_2', cellIds: ['R5C5', 'R4C5', 'R4C4', 'R4C3'] },
    { valStr: '9_9_9', cellIds: ['R5C1', 'R6C2', 'R7C3', 'R8C4', 'R9C5'] },
    { valStr: '6_6',   cellIds: ['R6C9', 'R7C8', 'R8C7', 'R9C6'] },
  ];

  for (const { valStr, cellIds } of constraints) {
    const { handler, context } = initContainExact(valStr, cellIds);
    const ok = handler.enforceConsistency(context.grid, acc);
    assert.equal(ok, true,
      `enforceConsistency should return true for ContainExact~${valStr}~${cellIds.join('~')}`);
  }
});

// ===========================================================================
// Tests – boundary: initialize() should reject count > maxGroups
// ===========================================================================

await runTest('RequiredValues initialize: rejects count > maxGroups (all-same-exclusion group)', () => {
  // Two cells in the same row share an exclusion and form 1 group.
  // Count = 2 > maxGroups = 1 → must return false.
  const cellExclusions = createSudoku9x9CellExclusions();
  const cells = [cellId('R1C1'), cellId('R1C2')];  // same row → 1 group
  const handler = new RequiredValues(cells, [5, 5], /* strict */ true);
  const context = new GridTestContext();
  const result = context.initializeHandler(handler, { cellExclusions });
  assert.equal(result, false,
    'initialize should return false when count > number of exclusion groups');
});

await runTest('RequiredValues initialize: accepts count == maxGroups', () => {
  // Two cells in different rows AND columns AND boxes, forming 2 groups.
  // R1C1(0) and R5C5(40) – different row, col, box.
  const cellExclusions = createSudoku9x9CellExclusions();
  const cells = [cellId('R1C1'), cellId('R5C5')];
  const handler = new RequiredValues(cells, [7, 7], /* strict */ true);
  const context = new GridTestContext();
  const result = context.initializeHandler(handler, { cellExclusions });
  assert.equal(result, true,
    'initialize should return true when count == number of exclusion groups');
});

// ===========================================================================
// Tests – Offset (0-indexed) value translation
// ===========================================================================

const { GridShape } = await import('../../js/grid_shape.js');

await runTest('RequiredValues offset: enforceConsistency finds hidden single with offset -1', () => {
  // 0-indexed: external values 0-3, offset=-1.
  // RequiredValues [0, 2] in 3 cells.
  // Cell 0 has only 0 → hidden single for 2 in cells 1/2.
  // Cell 1 is the only one with 2, so it becomes a hidden single.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const cells = [0, 1, 2];
  const handler = new RequiredValues(cells, [0, 2], /* strict */ true);
  const cellExclusions = createCellExclusions({ numCells: shape.numCells });
  context.initializeHandler(handler, { cellExclusions });

  const grid = context.grid;
  grid[0] = valueMask0(0);       // Fixed to 0.
  grid[1] = valueMask0(1, 2, 3); // Has 2.
  grid[2] = valueMask0(1, 3);    // No 2.
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // 2 is a hidden single in cell 1 → cell 1 fixed to 2.
  assert.equal(grid[1], valueMask0(2));
});

await runTest('RequiredValues offset: enforceConsistency detects missing value with offset -1', () => {
  // External values [0, 2], offset=-1.
  // If no cell has 0, enforceConsistency returns false.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const cells = [0, 1, 2];
  const handler = new RequiredValues(cells, [0, 2], /* strict */ true);
  const cellExclusions = createCellExclusions({ numCells: shape.numCells });
  context.initializeHandler(handler, { cellExclusions });

  const grid = context.grid;
  grid[0] = valueMask0(1, 2);  // No 0.
  grid[1] = valueMask0(2, 3);  // No 0.
  grid[2] = valueMask0(1, 2);  // No 0.
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, false, 'should fail: 0 not in any cell');
});

await runTest('RequiredValues offset: enforceConsistency with repeated value and offset -1', () => {
  // External values [1, 1], offset=-1.
  // 2 cells, no exclusions: repeated value 1 must appear twice.
  const shape = GridShape.fromGridSize(1, 4, null, -1);
  const context = new GridTestContext({ shape });
  const cells = [0, 1];
  const handler = new RequiredValues(cells, [1, 1], /* strict */ true);
  const cellExclusions = createCellExclusions({ numCells: shape.numCells });
  context.initializeHandler(handler, { cellExclusions });

  const grid = context.grid;
  grid[0] = valueMask0(1, 2);  // Has 1.
  grid[1] = valueMask0(1, 3);  // Has 1.
  const acc = createAccumulator();

  const result = handler.enforceConsistency(grid, acc);

  assert.equal(result, true);
  // Both cells must be fixed to 1.
  assert.equal(grid[0], valueMask0(1));
  assert.equal(grid[1], valueMask0(1));
});

logSuiteComplete('required_values.test.js');
