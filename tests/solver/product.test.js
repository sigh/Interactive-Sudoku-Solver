import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

await runTest('Product round-trips through the parser and allows repeated values', () => {
  const input = '.Product~4~R1C1~R4C4.~R1C1_2';
  const puzzle = SudokuParser.parseString(input);
  assert.equal(SudokuConstraint.Container.serialize([puzzle]), input);
  const solution = SudokuBuilder.build(puzzle).nthSolution(0);
  assert.equal(solution[0], 2);
  assert.equal(solution[30], 2);
});

await runTest('Product rejects an impossible target', () => {
  const puzzle = SudokuParser.parseString('.Product~5~R1C1~R4C4.~R1C1_2');
  assert.equal(SudokuBuilder.build(puzzle).countSolutions(), 0);
});

await runTest('Product zero forces a zero on a zero-based grid', () => {
  const puzzle = SudokuParser.parseString(
    '.Shape~4x4~0-3.Product~0~R1C1~R3C3.~R1C1_2');
  const solution = SudokuBuilder.build(puzzle).nthSolution(0);
  assert.equal(solution[10], 0);
});

await runTest('Product preserves targets above the safe integer range', () => {
  const input = '.Product~10000000000000000001~R1C1~R4C4';
  const puzzle = SudokuParser.parseString(input);
  assert.equal(SudokuConstraint.Container.serialize([puzzle]), input);
  assert.equal(SudokuBuilder.build(puzzle).countSolutions(), 0);
});

logSuiteComplete('Product');
