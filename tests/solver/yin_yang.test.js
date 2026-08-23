import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);

// Solution counts for the YinYang grid type and the Yin-Yang overlay
// constraint, verified against brute-force enumeration of the TRUE yin-yang
// semantics: both shades non-empty and orthogonally connected, and no 2x2
// box a single shade. Shadings are 0-indexed row-major arrays holding the
// internal shade values 1 (shaded) and 2 (unshaded).

const countSolutions = (input) => {
  const constraint = SudokuParser.parseString(input);
  const solver = SudokuBuilder.build(constraint);
  return solver.countSolutions();
};

const isConnected = (shading, numRows, numCols, shade) => {
  const start = shading.indexOf(shade);
  if (start === -1) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cell = stack.pop();
    const row = cell / numCols | 0;
    const col = cell % numCols;
    for (const [r, c] of [
      [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
      if (r < 0 || r >= numRows || c < 0 || c >= numCols) continue;
      const n = r * numCols + c;
      if (shading[n] === shade && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === shading.filter(v => v === shade).length;
};

const noMono2x2 = (shading, numRows, numCols) => {
  for (let r = 0; r + 1 < numRows; r++) {
    for (let c = 0; c + 1 < numCols; c++) {
      const nw = shading[r * numCols + c];
      if (nw === shading[r * numCols + c + 1] &&
        nw === shading[(r + 1) * numCols + c] &&
        nw === shading[(r + 1) * numCols + c + 1]) {
        return false;
      }
    }
  }
  return true;
};

const isYinYang = (shading, numRows, numCols) =>
  isConnected(shading, numRows, numCols, 1) &&
  isConnected(shading, numRows, numCols, 2) &&
  noMono2x2(shading, numRows, numCols);

// Count the yin-yang shadings of the grid which satisfy every predicate.
const bruteForceShadingCount = (numRows, numCols, predicates = []) => {
  const numCells = numRows * numCols;
  const shading = new Array(numCells);
  let count = 0;
  for (let m = 0; m < (1 << numCells); m++) {
    for (let i = 0; i < numCells; i++) shading[i] = ((m >> i) & 1) + 1;
    if (isYinYang(shading, numRows, numCols) &&
      predicates.every(p => p(shading))) {
      count++;
    }
  }
  return count;
};

// ============================================================================
// YinYang grid type
// ============================================================================

await runTest('empty YinYang grid matches brute force', () => {
  const expected = bruteForceShadingCount(3, 4);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(countSolutions('.Shape~3x4~2~YinYang.'), expected);
});

await runTest('YinYang grid with givens matches brute force', () => {
  const expected = bruteForceShadingCount(3, 4, [
    (s) => s[0] === 1,   // R1C1 shaded
    (s) => s[6] === 2,   // R2C3 unshaded
  ]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~3x4~2~YinYang.~R1C1_1~R2C3_2'), expected);
});

await runTest('YinYang grid with a 0-1 value range matches brute force', () => {
  // Face values are 0 (shaded) and 1 (unshaded), internally 1 and 2.
  const expected = bruteForceShadingCount(3, 3, [(s) => s[4] === 1]);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(countSolutions('.Shape~3x3~0-1~YinYang.~R2C2_0'), expected);
});

await runTest('YinYang grid with extra values restricts cells to the shades', () => {
  // Values beyond the two shades are only for var cells: the grid cells are
  // masked to the shades, and the extra cell can take all 3 values.
  const expected = bruteForceShadingCount(2, 3);
  assert.ok(expected > 0, 'test case must be satisfiable');
  assert.equal(countSolutions('.Shape~2x3~3~YinYang.'), expected);
  assert.equal(countSolutions('.Shape~2x3~3~YinYang.Var~A.'), expected * 3);
});

await runTest('degenerate YinYang grids need both shades non-empty', () => {
  // 1x1 leaves one shade empty; 2x1 has exactly the two split shadings.
  assert.equal(countSolutions('.Shape~1x1~2~YinYang.'), 0);
  assert.equal(countSolutions('.Shape~2x1~2~YinYang.'), 2);
});

// ============================================================================
// Yin-Yang overlay constraint
// ============================================================================

await runTest('overlay on a Raw grid multiplies in the shading count', () => {
  // The shading layer and the (unconstrained) grid are independent.
  const expected = bruteForceShadingCount(2, 3) * 3 ** 6;
  assert.equal(countSolutions('.Shape~2x3~3~Raw.YinYang.'), expected);
});

await runTest('overlay givens restrict the shading (brute force)', () => {
  const shadings = bruteForceShadingCount(2, 3, [
    (s) => s[0] === 1,   // YY1 shaded
    (s) => s[3] === 2,   // YY4 unshaded
  ]);
  assert.ok(shadings > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~2x3~3~Raw.YinYang.~YY1_1~YY4_2'),
    shadings * 3 ** 6);
});

await runTest('overlay on a Sudoku grid keeps the Sudoku rules', () => {
  // 4x4 Sudokus with a fixed R1C1 (72 of them), independent of the shading.
  const shadings = bruteForceShadingCount(4, 4);
  assert.ok(shadings > 0, 'test case must be satisfiable');
  assert.equal(
    countSolutions('.Shape~4x4.YinYang.~R1C1_1'), 72 * shadings);
});

await runTest('overlay is rejected on incompatible grids', () => {
  // A YinYang grid already has the rules; a 1-value grid has no two shades.
  assert.throws(
    () => countSolutions('.Shape~4x4~2~YinYang.YinYang.'),
    /not compatible/);
  assert.throws(
    () => countSolutions('.Shape~2x2~1~Raw.YinYang.'),
    /not compatible/);
});

logSuiteComplete('yin_yang.test.js');
