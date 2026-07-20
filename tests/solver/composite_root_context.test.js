import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');

// Constraints nested inside composites (Or/And/Replicate) must read
// cross-constraint information (layout, global modes, strict-marked pairs)
// from the ROOT constraint set, not from their own composite-local map.

const countSolutions = (input) =>
  SudokuBuilder.build(SudokuParser.parseString(input)).countSolutions();

const buildHandlers = (constraint) => {
  const geometry = constraint.getGeometry();
  const constraintMap = constraint.toMap();
  geometry.addVarCellsForConstraints([].concat(...constraintMap.values()));
  return [...SudokuBuilder._handlers(constraintMap, geometry)];
};

const binariesOnPair = (input, cellA, cellB) =>
  buildHandlers(SudokuParser.parseString(input)).filter(h =>
    h.constructor.name === 'BinaryConstraint' &&
    h.cells.length === 2 && h.cells[0] === cellA && h.cells[1] === cellB
  ).length;

// ============================================================================
// RegionSumLine: regions come from the root layout.
// ============================================================================

const JIGSAW_ROWS = '.Shape~4x4.NoBoxes.Jigsaw~0000111122223333';

await runTest('RegionSumLine inside And uses the root jigsaw regions', () => {
  // The line crosses two jigsaw pieces inside one default 2x2 box, so using
  // default boxes instead of the jigsaw pieces would drop the constraint.
  // Both cells are in one column, so equal singleton segments contradict the
  // column house: the correct count is 0.
  const line = '.RegionSumLine~R1C2~R2C2';
  assert.equal(countSolutions(JIGSAW_ROWS + line), 0);
  assert.equal(countSolutions(`${JIGSAW_ROWS}.And${line}.End`), 0);
});

await runTest('RegionSumLine inside And matches top-level (satisfiable case)', () => {
  // R2C2 and R3C3 are in different default boxes: singleton segments with
  // equal sums, i.e. the same value. SameValues is the ground truth.
  const expected = countSolutions('.Shape~4x4.SameValues~2~R2C2~R3C3');
  assert.ok(expected > 0);
  assert.equal(countSolutions('.Shape~4x4.RegionSumLine~R2C2~R3C3'), expected);
  assert.equal(
    countSolutions('.Shape~4x4.And.RegionSumLine~R2C2~R3C3.End'), expected);
});

await runTest('RegionSumLine inside And still rejects Chaos Construction', () => {
  assert.throws(
    () => buildHandlers(SudokuParser.parseString(
      '.Shape~4x4.ChaosConstruction.And.RegionSumLine~R1C1~R1C2.End')),
    /RegionSumLine is not supported with Chaos Construction/);
});

// ============================================================================
// FullRank: the tie mode comes from the root FullRankTies.
// ============================================================================

await runTest('FullRank inside And uses the root FullRankTies mode', () => {
  const topLevel = countSolutions('.Shape~4x4.FullRankTies~any.FullRank~C1~5~');
  const nested = countSolutions('.Shape~4x4.FullRankTies~any.And.FullRank~C1~5~.End');
  assert.ok(topLevel > 0);
  assert.equal(nested, topLevel);
});

// ============================================================================
// StrictKropki/StrictXV: marked pairs include dots nested in composites.
// ============================================================================

await runTest('StrictKropki with no dots adds negatives on every adjacent pair', () => {
  // 4x4 grid: 12 horizontal + 12 vertical adjacent pairs.
  const handlers = buildHandlers(SudokuParser.parseString('.Shape~4x4.StrictKropki'));
  const negatives = handlers.filter(
    h => h.constructor.name === 'BinaryConstraint');
  assert.equal(negatives.length, 24);
});

await runTest('StrictKropki exempts a top-level dot pair', () => {
  // Only the dot's own handler on the pair; no anti-kropki negative.
  assert.equal(
    binariesOnPair('.Shape~4x4.StrictKropki.WhiteDot~R1C1~R1C2', 0, 1), 1);
});

await runTest('StrictKropki exempts an And-nested dot pair', () => {
  assert.equal(
    binariesOnPair('.Shape~4x4.StrictKropki.And.WhiteDot~R1C1~R1C2.End', 0, 1),
    1);
});

await runTest('StrictKropki rejects dots inside an Or', () => {
  // A conditional dot has no well-defined "marked pair" semantics.
  const input =
    '.Shape~4x4.StrictKropki.Or.WhiteDot~R1C1~R1C2.WhiteDot~R2C1~R2C2.End';
  assert.throws(
    () => buildHandlers(SudokuParser.parseString(input)),
    { name: 'InvalidConstraintError', message: /StrictKropki.*Or/ },
  );
});

await runTest('StrictKropki rejects dots nested deeper inside an Or', () => {
  const input =
    '.Shape~4x4.StrictKropki.Or.And.BlackDot~R1C1~R1C2.End.And.~R1C1_1.End.End';
  assert.throws(
    () => buildHandlers(SudokuParser.parseString(input)),
    { name: 'InvalidConstraintError', message: /StrictKropki.*Or/ },
  );
});

await runTest('StrictXV rejects X/V inside an Or', () => {
  assert.throws(
    () => buildHandlers(SudokuParser.parseString(
      '.Shape~4x4.StrictXV.Or.X~R1C1~R1C2.V~R2C1~R2C2.End')),
    { name: 'InvalidConstraintError', message: /StrictXV.*Or/ },
  );
});

await runTest('dots inside an Or are fine without Strict constraints', () => {
  const input = '.Shape~4x4.Or.WhiteDot~R1C1~R1C2.WhiteDot~R2C1~R2C2.End';
  assert.doesNotThrow(() => buildHandlers(SudokuParser.parseString(input)));
  // StrictXV does not restrict dots (only X/V).
  const withXV = '.Shape~4x4.StrictXV.Or.WhiteDot~R1C1~R1C2.WhiteDot~R2C1~R2C2.End';
  assert.doesNotThrow(() => buildHandlers(SudokuParser.parseString(withXV)));
});

await runTest('StrictKropki exempts Replicate-shifted dot pairs', () => {
  // A dot template replicated to two locations must behave like two
  // top-level dots.
  const geometry = SudokuParser.parseString('.Shape~4x4').getGeometry();
  const bitset = SudokuConstraint.Replicate.encodeTargetCells(
    ['R1C1', 'R3C1'], 'R1C1', geometry);
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.StrictKropki(),
    new SudokuConstraint.Replicate(
      [new SudokuConstraint.WhiteDot('R1C1', 'R1C2')], bitset),
  ]);

  const expected = buildHandlers(SudokuParser.parseString(
    '.Shape~4x4.StrictKropki.WhiteDot~R1C1~R1C2.WhiteDot~R3C1~R3C2'));
  const replicated = buildHandlers(constraint);

  const countBinaries = (handlers) => handlers.filter(
    h => h.constructor.name === 'BinaryConstraint').length;
  assert.equal(countBinaries(replicated), countBinaries(expected));
});

await runTest('StrictXV exempts an And-nested X pair', () => {
  const input = '.Shape~4x4.StrictXV.And.X~R1C1~R1C2.End';
  // The X itself is a Sum handler; no negative BinaryConstraint on its pair.
  assert.equal(binariesOnPair(input, 0, 1), 0);
  // Other pairs still get the negative constraint.
  assert.equal(binariesOnPair(input, 4, 5), 1);
});

logSuiteComplete('composite_root_context.test.js');
