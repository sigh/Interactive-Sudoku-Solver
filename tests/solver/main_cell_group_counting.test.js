import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);

// Solution counts with the shape dimensions taken from a var group, verified
// brute-force enumeration of the TRUE constraint semantics (not the handler
// implementations). Cells are VA{n}, row-major: R{r}C{c} -> VA{(r-1)*cols+c},
// 0-indexed below as n-1.

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
    countSolutions('.Shape~VA~3.Var~A~~2x3.'), 3 ** 6);
});

await runTest('4x4 group with only givens counts numValues^free', () => {
  const input = '.Shape~VA~4.Var~A~~4x4.' +
    '~VA1_1~VA3_2~VA6_3~VA8_4~VA9_2~VA11_3~VA14_4~VA16_1~VA13_2~VA5_4';
  assert.equal(countSolutions(input), 4 ** 6);
});

await runTest('4x4 cage+thermo count matches brute force', () => {
  const givens = new Map([
    [0, 1],   // VA1
    [4, 3],   // VA5
    [5, 2],   // VA6
    [7, 1],   // VA8
    [11, 2],  // VA12
    [12, 3],  // VA13
    [15, 1],  // VA16
    [8, 2],   // VA9
  ]);
  const cage = (vs) => {
    const cells = [vs[1], vs[2], vs[3]];  // VA2, VA3, VA4
    return allDistinct(cells) && cells[0] + cells[1] + cells[2] === 7;
  };
  const thermo = (vs) =>
    vs[13] < vs[14] && vs[14] < vs[10];  // VA14 < VA15 < VA11

  const expected = bruteForceCount(16, 4, givens, [cage, thermo]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~VA~4.Var~A~~4x4' +
    '.Cage~7~VA2~VA3~VA4' +
    '.Thermo~VA14~VA15~VA11' +
    '.~VA1_1~VA5_3~VA6_2~VA8_1~VA12_2~VA13_3~VA16_1~VA9_2';
  assert.equal(countSolutions(input), expected);
});

await runTest('4x4 constraint-provided full house matches brute force', () => {
  // The AllDifferent covers numValues cells, so it can be promoted to a
  // full PerfectAllDifferent house even without the main grid.
  const givens = new Map([
    [0, 4],   // VA1
    [2, 2],   // VA3
    [6, 1],   // VA7
    [9, 3],   // VA10
    [14, 4],  // VA15
    [15, 2],  // VA16
    [3, 3],   // VA4
    [12, 1],  // VA13
  ]);
  const house = (vs) => allDistinct([vs[1], vs[5], vs[9], vs[13]]);
  const whiteDot = (vs) => Math.abs(vs[10] - vs[11]) === 1;  // VA11-VA12

  const expected = bruteForceCount(16, 4, givens, [house, whiteDot]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~VA~4.Var~A~~4x4' +
    '.AllDifferent~VA2~VA6~VA10~VA14' +
    '.WhiteDot~VA11~VA12' +
    '.~VA1_4~VA3_2~VA7_1~VA10_3~VA15_4~VA16_2~VA4_3~VA13_1';
  assert.equal(countSolutions(input), expected);
});

await runTest('restricted value domain (givens on a 0-3 grid) matches brute force', () => {
  // A multiset-style puzzle: every cell restricted to {0,2} by multi-value
  // givens. Values are 0-3 in the constraint string; brute force uses
  // 1-based values, shifted by the -1 offset (faces {0,2} are internal
  // values {1,3}).
  const singleGivens = new Map([
    [2, 1], [3, 3],             // VA3=0, VA4=2
    [5, 3], [6, 1], [7, 3],     // VA6=2, VA7=0, VA8=2
    [8, 1], [10, 3], [13, 1],   // VA9=0, VA11=2, VA14=0
    [14, 3], [15, 1],           // VA15=2, VA16=0
  ]);
  const restricted = (vs) => vs.every(v => v === 1 || v === 3);
  const cage = (vs) => {
    const faces = [vs[1] - 1, vs[4] - 1];  // VA2, VA5
    return allDistinct(faces) && faces[0] + faces[1] === 2;
  };

  const expected = bruteForceCount(16, 4, singleGivens, [restricted, cage]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const restrictions = [];
  for (let i = 1; i <= 16; i++) restrictions.push(`VA${i}_0_2`);
  const input = '.Shape~VA~0-3.Var~A~~4x4' +
    '.Cage~2~VA2~VA5' +
    `.~${restrictions.join('~')}` +
    '.~VA3_0~VA4_2~VA6_2~VA7_0~VA8_2~VA9_0~VA11_2~VA14_0~VA15_2~VA16_0';
  assert.equal(countSolutions(input), expected);
});

// ============================================================================
// Semantics of allowed line/count constraints without the main grid.
// ============================================================================

// VA cells 0-indexed. Values are 1-4.
const GIVENS_ROWS_3_4 = new Map([
  [6, 1], [7, 4],                     // VA7-VA8:   1 4
  [8, 2], [9, 4], [10, 1], [11, 3],   // VA9-VA12:  2 4 1 3
  [12, 3], [13, 1], [14, 4], [15, 2], // VA13-VA16: 3 1 4 2
]);
const GIVENS_STR_ROWS_3_4 =
  '.~VA7_1~VA8_4~VA9_2~VA10_4~VA11_1~VA12_3~VA13_3~VA14_1~VA15_4~VA16_2';

await runTest('standalone Lunchbox self-enforces distinctness (brute force)', () => {
  // Lunchbox declares its own cells all-different; the crusts are 1 and
  // numValues, and the clue is the sum of values strictly between them.
  const lunchbox = (vs) => {
    const line = [vs[0], vs[1], vs[2], vs[3]];  // VA1-VA4
    if (!allDistinct(line)) return false;
    const lo = Math.min(line.indexOf(1), line.indexOf(4));
    const hi = Math.max(line.indexOf(1), line.indexOf(4));
    let sum = 0;
    for (let i = lo + 1; i < hi; i++) sum += line[i];
    return sum === 5;
  };

  const givens = new Map([...GIVENS_ROWS_3_4, [4, 1], [5, 2]]);  // VA5, VA6
  const expected = bruteForceCount(16, 4, givens, [lunchbox]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~VA~4.Var~A~~4x4' +
    '.Lunchbox~5~VA1~VA2~VA3~VA4' + GIVENS_STR_ROWS_3_4 + '~VA5_1~VA6_2';
  assert.equal(countSolutions(input), expected);
});

await runTest('CountingCircles counts repeated values across circles (brute force)', () => {
  // Every value appearing in a circle must appear in exactly that many
  // circles; repeats outside the circles are unconstrained.
  const circleCells = [0, 1, 5];  // VA1, VA2, VA6
  const countingCircles = (vs) => {
    const values = circleCells.map(c => vs[c]);
    return values.every(v => values.filter(o => o === v).length === v);
  };

  const givens = new Map(
    [...GIVENS_ROWS_3_4, [2, 4], [3, 2], [4, 1]]);  // VA3, VA4, VA5
  const expected = bruteForceCount(16, 4, givens, [countingCircles]);
  assert.ok(expected > 0, 'test case must be satisfiable');

  const input = '.Shape~VA~4.Var~A~~4x4' +
    '.CountingCircles~VA1~VA2~VA6' + GIVENS_STR_ROWS_3_4 +
    '~VA3_4~VA4_2~VA5_1';
  assert.equal(countSolutions(input), expected);
});

logSuiteComplete('main_cell_group_counting.test.js');
