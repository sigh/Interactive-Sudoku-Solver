import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from './helpers/test_env.js';
import { runTest, logSuiteComplete } from './helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuParser, toShortSolution } = await import('../js/sudoku_parser.js');
const { GridShape, SHAPE_9x9 } = await import('../js/grid_shape.js');

// Find all constraints of a given type (recursive).
const findConstraints = (constraint, type) => {
  const results = [];
  const stack = [constraint];
  while (stack.length) {
    const c = stack.pop();
    if (c.type === type) results.push(c);
    if (c.constraints) stack.push(...c.constraints);
  }
  return results;
};

// Find exactly one constraint of a given type, or throw.
const findConstraint = (constraint, type) => {
  const results = findConstraints(constraint, type);
  assert.equal(results.length, 1, `expected exactly 1 ${type}, found ${results.length}`);
  return results[0];
};

// Check if a constraint tree contains a specific type.
const hasConstraintType = (constraint, type) => {
  return findConstraints(constraint, type).length > 0;
};

// Assert the parsed result has a Shape with the expected gridSpec.
const assertShape = (result, expectedSpec) => {
  const shape = findConstraint(result, 'Shape');
  assert.equal(shape.gridSpec, expectedSpec);
};

// Assert the number of constraints of a given type.
const assertConstraintCount = (result, type, expectedCount) => {
  const count = findConstraints(result, type).length;
  assert.equal(count, expectedCount, `expected ${expectedCount} ${type}, found ${count}`);
};

//////////////////////////////////////////////////////////////////////////////
// Plain sudoku parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parsePlainSudoku should parse 9x9 grid with digits', () => {
  const input = '8..6.....'.padEnd(81, '.');
  const result = SudokuParser.parsePlainSudoku(input);

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Given', 2);
  const givens = findConstraints(result, 'Given');
  const g1 = givens.find(g => g.cell === 'R1C1');
  const g2 = givens.find(g => g.cell === 'R1C4');
  assert.ok(g1, 'should have given at R1C1');
  assert.ok(g2, 'should have given at R1C4');
  assert.deepEqual(g1.values, [8]);
  assert.deepEqual(g2.values, [6]);
});

await runTest('parsePlainSudoku should parse 9x9 grid with 0s as blanks', () => {
  // 0s are treated as blanks, not digits
  const input = '800000000036000000007090200050007000000045700001003000010068500009000100000040000';
  const result = SudokuParser.parsePlainSudoku(input);

  assert.ok(result);
  const nonZeroCount = input.split('').filter(c => c !== '0').length;
  assertConstraintCount(result, 'Given', nonZeroCount);
  // Verify no Given has value 0 - the main point of this test
  const givens = findConstraints(result, 'Given');
  const hasZero = givens.some(g => g.values.includes(0));
  assert.ok(!hasZero, 'no Given should have value 0');
});

await runTest('parsePlainSudoku should reject invalid characters', () => {
  const input = '8..6..x..'.padEnd(81, '.'); // 'x' is invalid
  assert.equal(SudokuParser.parsePlainSudoku(input), null);
});

await runTest('parsePlainSudoku should parse 16x16 grid', () => {
  const result = SudokuParser.parsePlainSudoku('.'.repeat(256));
  assert.ok(result);
  assertShape(result, '16x16');
});

await runTest('parsePlainSudoku should parse 16x16 grid with letter digits', () => {
  // 16x16 uses A-P for values 1-16 (baseCharCode is 'A' for numValues >= 10)
  const input = 'ABCDEFGHIJKLMNOP'.repeat(16);
  const result = SudokuParser.parsePlainSudoku(input);

  assert.ok(result);
  assertShape(result, '16x16');
  // Each row has 16 givens, 16 rows = 256 givens
  assertConstraintCount(result, 'Given', 256);
});

await runTest('parsePlainSudoku should parse 6x6 grid', () => {
  const result = SudokuParser.parsePlainSudoku('.'.repeat(36));
  assert.ok(result);
  assertShape(result, '6x6');
});

await runTest('parsePlainSudoku should reject non-square sizes', () => {
  assert.equal(SudokuParser.parsePlainSudoku('.'.repeat(50)), null);
});

await runTest('parseString parses Shape~9x9~numValues', () => {
  const result = SudokuParser.parseString('.Shape~9x9~10.');
  assert.ok(result);
  assertShape(result, '9x9~10');
  assert.equal(result.getShape().numValues, 10);
  assert.equal(result.toString(), '.Shape~9x9~10');
});

await runTest('parseString canonicalizes default Shape~9x9~9 to empty', () => {
  const result = SudokuParser.parseString('.Shape~9x9~9.');
  assert.ok(result);
  assertShape(result, '9x9~9');
  assert.equal(result.getShape().numValues, 9);
  assert.equal(result.toString(), '');
});

//////////////////////////////////////////////////////////////////////////////
// Grid layout parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parseGridLayout should parse spaced grid', () => {
  const input = `
    8 . . | 6 . . | . . .
    . 3 6 | . . . | 7 . 9
    . 2 . | . 5 . | 7 . 1
    ------_-------_------
    . 4 . | 5 . 7 | . . .
    4 . 5 | . 7 . | . 1 .
    3 . . | . . 6 | . 8 .
    ------_-------_------
    . 8 . | 5 . . | 1 . .
    . . 9 | . . . | . 4 .
    . . . | . . . | . . .
  `.trim();
  const result = SudokuParser.parseGridLayout(input);

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Given', 25);
});

await runTest('parseGridLayout should parse double-digit values', () => {
  const row = '1 . . . | 2 . . . | 3 . . . | 16 . . . \n';
  const result = SudokuParser.parseGridLayout(row.repeat(16));

  assert.ok(result);
  assertShape(result, '16x16');
  assertConstraintCount(result, 'Given', 64); // 4 values * 16 rows
  const givens = findConstraints(result, 'Given');
  // 16 appears in column 13 (hex 'd'). Each row has one. Check row 1.
  const r1c13 = givens.find(g => g.cell === 'R1Cd');
  assert.ok(r1c13, 'should have given at R1Cd');
  assert.deepEqual(r1c13.values, [16]);
});

await runTest('parseGridLayout should reject letters', () => {
  const input = ('1 2 3 4 5 6 7 8 . ').repeat(8) + '1 2 3 4 5 6 7 8 a';
  assert.equal(SudokuParser.parseGridLayout(input), null);
});

//////////////////////////////////////////////////////////////////////////////
// Short killer format parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parseShortKillerFormat should parse cage with direction characters', () => {
  // A=sum 10, << point left to join cage. Forms 3-cell cage at R1C1-R1C3.
  // Use B (sum 11) for remaining cells to form single-cell cages.
  const input = 'A<<' + 'B'.repeat(78);
  const result = SudokuParser.parseShortKillerFormat(input);

  assert.ok(result);
  const cages = findConstraints(result, 'Cage');
  assert.equal(cages.length, 79); // 1 three-cell cage + 78 single-cell cages
  const cage10 = cages.find(c => c.sum === 10);
  assert.ok(cage10, 'should have cage with sum 10');
  assert.equal(typeof cage10.sum, 'number'); // short killer uses numeric sums
  assert.deepEqual(cage10.cells.sort(), ['R1C1', 'R1C2', 'R1C3']);
  // Verify sum 11 cages exist
  const cages11 = cages.filter(c => c.sum === 11);
  assert.equal(cages11.length, 78);
});

await runTest('parseShortKillerFormat should reject non-killer input', () => {
  // No direction characters means not killer format
  assert.equal(SudokuParser.parseShortKillerFormat('123456789'.repeat(9)), null);
});

//////////////////////////////////////////////////////////////////////////////
// Long killer format parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parseLongKillerFormat should parse cage', () => {
  // Cell value = sum * 256 + cageId
  const cageValue = 10 * 256 + 1; // sum=10, cageId=1
  const cells = [cageValue, cageValue, ...Array(79).fill(0)];
  const input = `3x3::k:${cells.join(':')}:`;
  const result = SudokuParser.parseLongKillerFormat(input);

  assert.ok(result);
  const cage = findConstraint(result, 'Cage');
  assert.equal(cage.sum, 10);
  assert.equal(typeof cage.sum, 'number'); // long killer uses numeric sums
  assert.deepEqual(cage.cells, ['R1C1', 'R1C2']);
});

await runTest('parseLongKillerFormat should parse diagonals', () => {
  const cells = Array(81).fill(0).join(':');
  const result = SudokuParser.parseLongKillerFormat(`3x3:d:k:${cells}:`);

  assert.ok(result);
  assertConstraintCount(result, 'Diagonal', 2);
  const directions = findConstraints(result, 'Diagonal').map(d => d.direction).sort((a, b) => a - b);
  assert.deepEqual(directions, [-1, 1]);
});

await runTest('parseLongKillerFormat should reject wrong prefix', () => {
  const cells = Array(81).fill(0).join(':');
  assert.equal(SudokuParser.parseLongKillerFormat(`4x4::k:${cells}:`), null);
});

//////////////////////////////////////////////////////////////////////////////
// Jigsaw parsing
//////////////////////////////////////////////////////////////////////////////

const JIGSAW_LAYOUT = '111222333111222333111222333444555666444555666444555666777888999777888999777888999';

await runTest('parseJigsawLayout should parse valid layout', () => {
  const result = SudokuParser.parseJigsawLayout(JIGSAW_LAYOUT);

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Jigsaw', 9);
  assertConstraintCount(result, 'NoBoxes', 1);
});

await runTest('parseJigsawLayout should reject unbalanced regions', () => {
  // Region 1 has 12 cells, region 4 has 6 (should have 9 each)
  const bad = '111222333111222333111222333111555666444555666444555666777888999777888999777888999';
  assert.equal(SudokuParser.parseJigsawLayout(bad), null);
});

await runTest('parseJigsaw should parse combined layout and givens', () => {
  const givensStr = '5' + '.'.repeat(80);
  const result = SudokuParser.parseJigsaw(givensStr + JIGSAW_LAYOUT);

  assert.ok(result);
  assertConstraintCount(result, 'Jigsaw', 9);
  assertConstraintCount(result, 'NoBoxes', 1);
  const r1c1 = findConstraints(result, 'Given').find(g => g.cell === 'R1C1');
  assert.ok(r1c1, 'should have given at R1C1');
  assert.deepEqual(r1c1.values, [5]);
});

//////////////////////////////////////////////////////////////////////////////
// Pencilmarks parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parsePencilmarks should parse 9x9 pencilmarks', () => {
  // 81 cells * 9 chars each. First cell fixed to 5.
  const input = '....5....' + '123456789'.repeat(80);
  const result = SudokuParser.parsePencilmarks(input);

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Given', 81);
  const r1c1 = findConstraints(result, 'Given').find(g => g.cell === 'R1C1');
  assert.deepEqual(r1c1.values, [5]);
});

await runTest('parsePencilmarks should handle dots for missing values', () => {
  // First cell has only 1,2,3
  const input = '123......' + '123456789'.repeat(80);
  const result = SudokuParser.parsePencilmarks(input);

  assert.ok(result);
  const givens = findConstraints(result, 'Given');
  const r1c1 = givens.find(g => g.cell === 'R1C1');
  const r1c2 = givens.find(g => g.cell === 'R1C2');
  assert.deepEqual(r1c1.values, [1, 2, 3]);
  assert.deepEqual(r1c2.values, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

//////////////////////////////////////////////////////////////////////////////
// Constraint string parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parseString should parse empty constraint', () => {
  const result = SudokuParser.parseString('.');
  assert.ok(result);
  assert.equal(result.constraints.length, 0);
});

await runTest('parseString should parse Given constraints', () => {
  const result = SudokuParser.parseString('.~R1C1_5.~R2C2_3.');

  assert.ok(result);
  assertConstraintCount(result, 'Given', 2);
  const givens = findConstraints(result, 'Given');
  const g1 = givens.find(g => g.cell === 'R1C1');
  const g2 = givens.find(g => g.cell === 'R2C2');
  assert.deepEqual(g1.values, [5]);
  assert.deepEqual(g2.values, [3]);
});

await runTest('parseString should parse AntiKnight', () => {
  const result = SudokuParser.parseString('.AntiKnight.');
  assert.ok(result);
  assertConstraintCount(result, 'AntiKnight', 1);
});

await runTest('parseString should parse Cage', () => {
  const result = SudokuParser.parseString('.Cage~15~R1C1~R1C2~R1C3.');

  assert.ok(result);
  const cage = findConstraint(result, 'Cage');
  assert.equal(cage.sum, 15);
  assert.deepEqual(cage.cells, ['R1C1', 'R1C2', 'R1C3']);
});

await runTest('parseString should parse Thermo', () => {
  const result = SudokuParser.parseString('.Thermo~R1C1~R1C2~R1C3.');
  assert.ok(result);
  const thermo = findConstraint(result, 'Thermo');
  assert.deepEqual(thermo.cells, ['R1C1', 'R1C2', 'R1C3']);
});

await runTest('parseString should parse Arrow', () => {
  const result = SudokuParser.parseString('.Arrow~R1C1~R1C2~R1C3~R1C4.');
  assert.ok(result);
  const arrow = findConstraint(result, 'Arrow');
  assert.deepEqual(arrow.cells, ['R1C1', 'R1C2', 'R1C3', 'R1C4']);
});

await runTest('parseString should parse Diagonal', () => {
  const result = SudokuParser.parseString('.Diagonal~1.');
  assert.ok(result);
  const diagonal = findConstraint(result, 'Diagonal');
  assert.equal(diagonal.direction, 1);
});

await runTest('parseString should parse Sandwich', () => {
  const result = SudokuParser.parseString('.Sandwich~15~R1.');
  assert.ok(result);
  const sandwich = findConstraint(result, 'Sandwich');
  assert.equal(sandwich.value, 15);
  assert.equal(sandwich.id, 'R1');
});

await runTest('parseString should parse Whisper', () => {
  const result = SudokuParser.parseString('.Whisper~5~R1C1~R1C2~R1C3.');
  assert.ok(result);
  const whisper = findConstraint(result, 'Whisper');
  assert.equal(whisper.difference, 5);
  assert.deepEqual(whisper.cells, ['R1C1', 'R1C2', 'R1C3']);
});

await runTest('parseString should parse Renban', () => {
  const result = SudokuParser.parseString('.Renban~R1C1~R1C2~R1C3.');
  assert.ok(result);
  const renban = findConstraint(result, 'Renban');
  assert.deepEqual(renban.cells, ['R1C1', 'R1C2', 'R1C3']);
});

await runTest('parseString should parse multiple constraints', () => {
  const result = SudokuParser.parseString('.AntiKnight.AntiKing.~R1C1_5.');

  assert.ok(result);
  assertConstraintCount(result, 'AntiKnight', 1);
  assertConstraintCount(result, 'AntiKing', 1);
  assertConstraintCount(result, 'Given', 1);
});

await runTest('parseString should parse FullRankTies', () => {
  const result = SudokuParser.parseString('.FullRankTies~none.');
  assert.ok(result);
  const ties = findConstraint(result, 'FullRankTies');
  assert.equal(ties.ties, 'none');
});

await runTest('parseString should reject invalid FullRankTies value', () => {
  assert.throws(
    () => SudokuParser.parseString('.FullRankTies~not-a-mode.'),
    /Invalid FullRankTies/i,
  );
});

await runTest('parseString should throw on unknown constraint', () => {
  assert.throws(
    () => SudokuParser.parseString('.UnknownConstraint.'),
    /Unknown constraint type/
  );
});

await runTest('parseString should throw if not starting with dot', () => {
  assert.throws(
    () => SudokuParser.parseString('AntiKnight.'),
    /must start with/i
  );
});

//////////////////////////////////////////////////////////////////////////////
// Or and And constraint parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parseString should parse Or constraint', () => {
  const result = SudokuParser.parseString('.Or.~R1C1_1.~R1C1_2.End.');

  assert.ok(result);
  const or = findConstraint(result, 'Or');
  assert.equal(or.constraints.length, 2);
  assert.ok(or.constraints.every(c => c.type === 'Given'));
});

await runTest('parseString should parse And constraint', () => {
  // And at top level gets absorbed into Set, so nest inside Or
  const result = SudokuParser.parseString('.Or.And.~R1C1_1.~R1C2_2.End.End.');

  assert.ok(result);
  const or = findConstraint(result, 'Or');
  const and = findConstraint(or, 'And');
  assert.equal(and.constraints.length, 2);
});

await runTest('parseString should parse nested Or and And', () => {
  // Or with And branch and Given branch
  const result = SudokuParser.parseString('.Or.And.~R1C1_1.~R1C2_2.End.~R1C3_3.End.');

  assert.ok(result);
  const or = findConstraint(result, 'Or');
  assert.equal(or.constraints.length, 2);
  assert.ok(hasConstraintType(or, 'And'));
  // Verify the direct Given child (R1C3=3)
  const directGiven = or.constraints.find(c => c.type === 'Given');
  assert.ok(directGiven);
  assert.equal(directGiven.cell, 'R1C3');
  assert.deepEqual(directGiven.values, [3]);
});

//////////////////////////////////////////////////////////////////////////////
// parseText (high-level parsing)
//////////////////////////////////////////////////////////////////////////////

await runTest('parseText should detect plain sudoku', () => {
  const result = SudokuParser.parseText('8..6.....'.padEnd(81, '.'));

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Given', 2);
});

await runTest('parseText should detect constraint string', () => {
  const result = SudokuParser.parseText('.AntiKnight.~R1C1_5.');

  assert.ok(result);
  assertConstraintCount(result, 'AntiKnight', 1);
  const given = findConstraint(result, 'Given');
  assert.equal(given.cell, 'R1C1');
  assert.deepEqual(given.values, [5]);
});

await runTest('parseText should handle comments', () => {
  const input = `
# Comment
.AntiKnight.
# Another comment
.~R1C1_5.
  `;
  const result = SudokuParser.parseText(input);

  assert.ok(result);
  assertConstraintCount(result, 'AntiKnight', 1);
  const given = findConstraint(result, 'Given');
  assert.deepEqual(given.values, [5]);
});

await runTest('parseText should handle multiple sections', () => {
  const result = SudokuParser.parseText('.AntiKnight.\n\n.~R1C1_5.');

  assert.ok(result);
  assertConstraintCount(result, 'AntiKnight', 1);
  const given = findConstraint(result, 'Given');
  assert.equal(given.cell, 'R1C1');
  assert.deepEqual(given.values, [5]);
});

await runTest('parseText should reject inconsistent Shape constraints', () => {
  assert.throws(
    () => SudokuParser.parseText('.Shape~4x4.Shape~9x9.'),
    /Inconsistent Shape constraints\./
  );
});

//////////////////////////////////////////////////////////////////////////////
// extractConstraintTypes
//////////////////////////////////////////////////////////////////////////////

await runTest('extractConstraintTypes should extract unique types', () => {
  const types = SudokuParser.extractConstraintTypes('.AntiKnight.Cage~15~R1C1~R1C2.Cage~10~R2C1~R2C2.');

  assert.equal(types.length, 2); // only unique types
  assert.ok(types.includes('AntiKnight'));
  assert.ok(types.includes('Cage'));
});

await runTest('extractConstraintTypes should ignore unknown types', () => {
  const types = SudokuParser.extractConstraintTypes('.AntiKnight.FakeConstraint~123.');

  assert.equal(types.length, 1); // only valid types
  assert.ok(types.includes('AntiKnight'));
  assert.ok(!types.includes('FakeConstraint'));
});

await runTest('extractConstraintTypes should handle empty string', () => {
  assert.deepEqual(SudokuParser.extractConstraintTypes(''), []);
});

//////////////////////////////////////////////////////////////////////////////
// toShortSolution
//////////////////////////////////////////////////////////////////////////////

await runTest('toShortSolution should convert 9x9 solution', () => {
  const solution = [1, 2, 3, 4, 5, 6, 7, 8, 9, ...Array(72).fill(1)];
  const result = toShortSolution(solution, SHAPE_9x9);

  assert.equal(result.length, 81);
  assert.equal(result.slice(0, 9), '123456789');
});

await runTest('toShortSolution should convert 16x16 solution', () => {
  const shape = GridShape.fromGridSize(16);
  const solution = Array(256).fill(1);
  solution[0] = 16;
  solution[1] = 10;
  const result = toShortSolution(solution, shape);

  assert.equal(result.length, 256);
  // 16x16 uses A-P: 1=A, 2=B, ..., 10=J, ..., 16=P
  assert.equal(result[0], 'P'); // 16
  assert.equal(result[1], 'J'); // 10
});

await runTest('toShortSolution should convert 6x6 solution', () => {
  const shape = GridShape.fromGridSize(6);
  const solution = [1, 2, 3, 4, 5, 6, ...Array(30).fill(1)];
  const result = toShortSolution(solution, shape);

  assert.equal(result.length, 36);
  assert.equal(result.slice(0, 6), '123456');
});

//////////////////////////////////////////////////////////////////////////////
// Edge cases
//////////////////////////////////////////////////////////////////////////////

await runTest('parseShortKillerFormat should detect loop', () => {
  // > points right, < points left - creates a loop
  assert.throws(
    () => SudokuParser.parseShortKillerFormat('><' + '0'.repeat(79)),
    /Loop/i
  );
});

//////////////////////////////////////////////////////////////////////////////
// Solution parsing
//////////////////////////////////////////////////////////////////////////////

await runTest('parseSolution should parse dense solution string', () => {
  const input = '=' + '123456789'.repeat(9);
  const result = SudokuParser.parseSolution(input);

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Given', 81);
});

await runTest('parseText should parse solution string with spaces', () => {
  const input = '= ' + '1 2 3 4 5 6 7 8 9 '.repeat(9);
  const result = SudokuParser.parseText(input);

  assert.ok(result);
  assertShape(result, '9x9');
  assertConstraintCount(result, 'Given', 81);
});

await runTest('parseSolution should return null if no equals sign', () => {
  const input = '123456789'.repeat(9);
  const result = SudokuParser.parseSolution(input);
  assert.equal(result, null);
});

logSuiteComplete('SudokuParser');
