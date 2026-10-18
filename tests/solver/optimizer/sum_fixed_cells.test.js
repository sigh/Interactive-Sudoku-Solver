import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuParser } = await import('../../../js/sudoku_parser.js');
const { SudokuBuilder } = await import('../../../js/solver/sudoku_builder.js');
const { LookupTables } = await import('../../../js/solver/lookup_tables.js');
const { Sum } = await import('../../../js/solver/sum_handler.js');

const buildSolver = input => SudokuBuilder.build(SudokuParser.parseText(input));

// Compare grids in the same 1-based representation for both value offsets.
const collectSolutions = solver => {
  const solutions = [];
  const numCells = solver.geometry().numGridCells;
  solver._internalSolver.run(null, grid => {
    solutions.push(Array.from(
      grid.subarray(0, numCells), mask => LookupTables.toValue(mask)).join(''));
  });
  return solutions.sort();
};

const classicSolutions = collectSolutions(buildSolver('.Shape~4x4'));
assert.equal(classicSolutions.length, 288);

for (const offset of [0, -1]) {
  const shape = offset ? '.Shape~4x4~0-3' : '.Shape~4x4';
  const label = offset ? '0-based' : '1-based';

  await runTest(`sum gap retains fixed cells and their contributions (${label})`, () => {
    const rowTotal = 10 + 4 * offset;
    const input = shape
      + `.~R1C1_${1 + offset}~R4C2_${3 + offset}`
      + [1, 2, 3].map(r =>
        `.Sum~${rowTotal}~R${r}C1~R${r}C2~R${r}C3~R${r}C4`).join('')
      + `.Sum~${4 + offset}~R4C1`;
    const solver = buildSolver(input);
    const sums = solver._internalSolver._handlerSet.getAllofType(Sum);
    const gap = sums.find(h =>
      h.cells.length === 3 && [13, 14, 15].every(c => h.cells.includes(c)));

    // R4C2 is given, but still belongs to the inferred three-cell sum.
    assert.ok(gap);
    assert.equal(gap.sum(), 6 + 3 * offset);
    const expected = classicSolutions.filter(s =>
      s[0] === '1' && s[12] === '4' && s[13] === '3');
    assert.equal(expected.length, 6);
    assert.deepEqual(collectSolutions(solver), expected);
  });

  await runTest(`sum complement retains fixed cells on both sides (${label})`, () => {
    const input = shape
      + `.~R1C1_${1 + offset}~R1C4_${4 + offset}`
      + `.Sum~${6 + 3 * offset}~R1C1~R1C2~R1C3`;
    const solver = buildSolver(input);
    const sums = solver._internalSolver._handlerSet.getAllofType(Sum);
    const cage = sums.find(h =>
      h.cells.length === 3 && [0, 1, 2].every(c => h.cells.includes(c)));

    assert.ok(cage);
    assert.equal(cage.sum(), 6 + 3 * offset);
    assert.deepEqual([...cage._complementCells], [3]);
    const expected = classicSolutions.filter(s => s[0] === '1' && s[3] === '4');
    assert.equal(expected.length, 24);
    assert.deepEqual(collectSolutions(solver), expected);
  });

  await runTest(`fully fixed sums still reject an incorrect total (${label})`, () => {
    const input = shape
      + `.~R1C1_${1 + offset}~R1C2_${2 + offset}~R1C3_${3 + offset}`
      + `.Sum~${7 + 3 * offset}~R1C1~R1C2~R1C3`;

    assert.deepEqual(collectSolutions(buildSolver(input)), []);
  });
}

logSuiteComplete('sum optimizer fixed cells');
