import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);

// Solution counts on a Raw grid (no implicit constraints), verified against
// brute-force enumeration of the TRUE constraint semantics (not the handler
// implementations). Brute-force cells are 0-indexed row-major:
// R{r}C{c} -> (r-1)*cols + c-1.

const countSolutions = (input) => {
  const constraint = SudokuParser.parseString(input);
  const solver = SudokuBuilder.build(constraint);
  return solver.countSolutions();
};

// Enumerate every assignment of 1..numValues to the non-given cells and count
// those where every predicate holds. Predicates get the full values array
// (0-indexed cells, 1-based values).
const bruteForceCount = (numCells, numValues, givens, predicates) => {
  const values = new Array(numCells).fill(0);
  for (const [cell, value] of givens) values[cell] = value;
  const freeCells = [];
  for (let i = 0; i < numCells; i++) {
    if (!givens.has(i)) freeCells.push(i);
  }

  let count = 0;
  const search = (i) => {
    if (i === freeCells.length) {
      if (predicates.every(p => p(values))) count++;
      return;
    }
    for (let v = 1; v <= numValues; v++) {
      values[freeCells[i]] = v;
      search(i + 1);
    }
  };
  search(0);
  return count;
};

const allDistinct = (vs) => new Set(vs).size === vs.length;

await runTest('empty 2x3 group has numValues^numCells solutions', () => {
  assert.equal(
    countSolutions('.Shape~2x3~3~Raw.'), 3 ** 6);
});

await runTest('4x4 group with only givens counts numValues^free', () => {
  const input = '.Shape~4x4~4~Raw.' +
    '~R1C1_1~R1C3_2~R2C2_3~R2C4_4~R3C1_2~R3C3_3~R4C2_4~R4C4_1~R4C1_2~R2C1_4';
  assert.equal(countSolutions(input), 4 ** 6);
});

await runTest('4x4 cage+thermo count matches brute force', () => {
  const givens = new Map([
    [0, 1],   // R1C1
    [4, 3],   // R2C1
    [5, 2],   // R2C2
    [7, 1],   // R2C4
    [11, 2],  // R3C4
    [12, 3],  // R4C1
    [15, 1],  // R4C4
    [8, 2],   // R3C1
  ]);
  const cage = (vs) => {
    const cells = [vs[1], vs[2], vs[3]];  // R1C2, R1C3, R1C4
    return allDistinct(cells) && cells[0] + cells[1] + cells[2] === 7;
  };
  const thermo = (vs) =>
    vs[13] < vs[14] && vs[14] < vs[10];  // R4C2 < R4C3 < R3C3

  const expected = bruteForceCount(16, 4, givens, [cage, thermo]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~4x4~4~Raw' +
    '.Cage~7~R1C2~R1C3~R1C4' +
    '.Thermo~R4C2~R4C3~R3C3' +
    '.~R1C1_1~R2C1_3~R2C2_2~R2C4_1~R3C4_2~R4C1_3~R4C4_1~R3C1_2';
  assert.equal(countSolutions(input), expected);
});

await runTest('4x4 constraint-provided full house matches brute force', () => {
  // The AllDifferent covers numValues cells, so it can be promoted to a
  // full PerfectAllDifferent house even without the Sudoku defaults.
  const givens = new Map([
    [0, 4],   // R1C1
    [2, 2],   // R1C3
    [6, 1],   // R2C3
    [9, 3],   // R3C2
    [14, 4],  // R4C3
    [15, 2],  // R4C4
    [3, 3],   // R1C4
    [12, 1],  // R4C1
  ]);
  const house = (vs) => allDistinct([vs[1], vs[5], vs[9], vs[13]]);
  const whiteDot = (vs) => Math.abs(vs[10] - vs[11]) === 1;  // R3C3-R3C4

  const expected = bruteForceCount(16, 4, givens, [house, whiteDot]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~4x4~4~Raw' +
    '.AllDifferent~R1C2~R2C2~R3C2~R4C2' +
    '.WhiteDot~R3C3~R3C4' +
    '.~R1C1_4~R1C3_2~R2C3_1~R3C2_3~R4C3_4~R4C4_2~R1C4_3~R4C1_1';
  assert.equal(countSolutions(input), expected);
});

await runTest('restricted value domain (givens on a 0-3 grid) matches brute force', () => {
  // A multiset-style puzzle: every cell restricted to {0,2} by multi-value
  // givens. Values are 0-3 in the constraint string; brute force uses
  // 1-based values, shifted by the -1 offset (faces {0,2} are internal
  // values {1,3}).
  const singleGivens = new Map([
    [2, 1], [3, 3],             // R1C3=0, R1C4=2
    [5, 3], [6, 1], [7, 3],     // R2C2=2, R2C3=0, R2C4=2
    [8, 1], [10, 3], [13, 1],   // R3C1=0, R3C3=2, R4C2=0
    [14, 3], [15, 1],           // R4C3=2, R4C4=0
  ]);
  const restricted = (vs) => vs.every(v => v === 1 || v === 3);
  const cage = (vs) => {
    const faces = [vs[1] - 1, vs[4] - 1];  // R1C2, R2C1
    return allDistinct(faces) && faces[0] + faces[1] === 2;
  };

  const expected = bruteForceCount(16, 4, singleGivens, [restricted, cage]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const restrictions = [];
  for (let i = 0; i < 16; i++) {
    restrictions.push(`R${(i / 4 | 0) + 1}C${i % 4 + 1}_0_2`);
  }
  const input = '.Shape~4x4~0-3~Raw' +
    '.Cage~2~R1C2~R2C1' +
    `.~${restrictions.join('~')}` +
    '.~R1C3_0~R1C4_2~R2C2_2~R2C3_0~R2C4_2~R3C1_0~R3C3_2~R4C2_0~R4C3_2~R4C4_0';
  assert.equal(countSolutions(input), expected);
});

// ============================================================================
// Semantics of line/count constraints without the Sudoku defaults.
// ============================================================================

// Brute-force cells 0-indexed. Values are 1-4.
const GIVENS_ROWS_3_4 = new Map([
  [6, 1], [7, 4],                     // R2C3-R2C4:   1 4
  [8, 2], [9, 4], [10, 1], [11, 3],   // R3C1-R3C4:  2 4 1 3
  [12, 3], [13, 1], [14, 4], [15, 2], // R4C1-R4C4: 3 1 4 2
]);
const GIVENS_STR_ROWS_3_4 =
  '.~R2C3_1~R2C4_4~R3C1_2~R3C2_4~R3C3_1~R3C4_3~R4C1_3~R4C2_1~R4C3_4~R4C4_2';

await runTest('standalone Lunchbox self-enforces distinctness (brute force)', () => {
  // Lunchbox declares its own cells all-different; the crusts are 1 and
  // numValues, and the clue is the sum of values strictly between them.
  const lunchbox = (vs) => {
    const line = [vs[0], vs[1], vs[2], vs[3]];  // R1C1-R1C4
    if (!allDistinct(line)) return false;
    const lo = Math.min(line.indexOf(1), line.indexOf(4));
    const hi = Math.max(line.indexOf(1), line.indexOf(4));
    let sum = 0;
    for (let i = lo + 1; i < hi; i++) sum += line[i];
    return sum === 5;
  };

  const givens = new Map([...GIVENS_ROWS_3_4, [4, 1], [5, 2]]);  // R2C1, R2C2
  const expected = bruteForceCount(16, 4, givens, [lunchbox]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~4x4~4~Raw' +
    '.Lunchbox~5~R1C1~R1C2~R1C3~R1C4' + GIVENS_STR_ROWS_3_4 + '~R2C1_1~R2C2_2';
  assert.equal(countSolutions(input), expected);
});

await runTest('CountingCircles counts repeated values across circles (brute force)', () => {
  // Every value appearing in a circle must appear in exactly that many
  // circles; repeats outside the circles are unconstrained.
  const circleCells = [0, 1, 5];  // R1C1, R1C2, R2C2
  const countingCircles = (vs) => {
    const values = circleCells.map(c => vs[c]);
    return values.every(v => values.filter(o => o === v).length === v);
  };

  const givens = new Map(
    [...GIVENS_ROWS_3_4, [2, 4], [3, 2], [4, 1]]);  // R1C3, R1C4, R2C1
  const expected = bruteForceCount(16, 4, givens, [countingCircles]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~4x4~4~Raw' +
    '.CountingCircles~R1C1~R1C2~R2C2' + GIVENS_STR_ROWS_3_4 +
    '~R1C3_4~R1C4_2~R2C1_1';
  assert.equal(countSolutions(input), expected);
});

// ============================================================================
// Global constraints: positional semantics hold without the Sudoku defaults.
// ============================================================================

// A 2x3 grid (2 rows, 3 columns): cell index = (row-1)*3 + (col-1).
const ADJACENT_2X3 = [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [1, 4], [2, 5]];
const WINDOWS_2X3 = [[0, 1, 3, 4], [1, 2, 4, 5]];

await runTest('AntiConsecutive on a Raw grid matches brute force', () => {
  const antiConsecutive = (vs) => ADJACENT_2X3.every(
    ([a, b]) => Math.abs(vs[a] - vs[b]) !== 1);

  const expected = bruteForceCount(6, 3, new Map(), [antiConsecutive]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~2x3~3~Raw.AntiConsecutive'), expected);
});

await runTest('AntiTaxicab on a Raw grid matches brute force', () => {
  const taxicab = (i, j) =>
    Math.abs((i / 3 | 0) - (j / 3 | 0)) + Math.abs(i % 3 - j % 3);
  const antiTaxicab = (vs) => {
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        if (vs[i] === vs[j] && taxicab(i, j) === vs[i]) return false;
      }
    }
    return true;
  };

  const expected = bruteForceCount(6, 3, new Map(), [antiTaxicab]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(countSolutions('.Shape~2x3~3~Raw.AntiTaxicab'), expected);
});

await runTest('GlobalEntropy on a Raw grid matches brute force', () => {
  const band = (v) => (v - 1) / 3 | 0;
  const entropy = (vs) => WINDOWS_2X3.every(
    w => new Set(w.map(c => band(vs[c]))).size === 3);

  const givens = new Map([[0, 1], [4, 5]]);
  const expected = bruteForceCount(6, 9, givens, [entropy]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~2x3~9~Raw.GlobalEntropy.~R1C1_1~R2C2_5'),
    expected);
});

await runTest('GlobalMod on a Raw grid matches brute force', () => {
  const residue = (v) => (v - 1) % 3;
  const mod3 = (vs) => WINDOWS_2X3.every(
    w => new Set(w.map(c => residue(vs[c]))).size === 3);

  const givens = new Map([[0, 1], [4, 5]]);
  const expected = bruteForceCount(6, 9, givens, [mod3]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~2x3~9~Raw.GlobalMod.~R1C1_1~R2C2_5'), expected);
});

await runTest('DutchFlatmates on a Raw grid matches brute force', () => {
  // A 3x2 grid: columns are [0, 2, 4] and [1, 3, 5], top to bottom. Every 5
  // needs a 1 directly above or a 9 directly below.
  const cols = [[0, 2, 4], [1, 3, 5]];
  const dutch = (vs) => cols.every(col => col.every((c, i) =>
    vs[c] !== 5 ||
    (i > 0 && vs[col[i - 1]] === 1) ||
    (i < col.length - 1 && vs[col[i + 1]] === 9)));

  // The second column is fully given (including a 5 needing its 9 below).
  const givens = new Map([[1, 5], [3, 9], [5, 7]]);
  const expected = bruteForceCount(6, 9, givens, [dutch]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~3x2~9~Raw.DutchFlatmates.~R1C2_5~R2C2_9~R3C2_7'),
    expected);
});

logSuiteComplete('raw_grid_counting.test.js');
