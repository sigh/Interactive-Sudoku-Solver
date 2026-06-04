import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, runTestCases, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuConstraint, SudokuConstraintBase } = await import('../../js/sudoku_constraint.js');
const HandlerModule = await import('../../js/solver/handlers.js');
const SumHandlerModule = await import('../../js/solver/sum_handler.js');

// ============================================================================
// Helpers
// ============================================================================

const buildHandlers = (constraint) => {
  const shape = constraint.getShape();
  const constraintMap = constraint.toMap();
  shape.addVarCellsForConstraints([].concat(...constraintMap.values()));
  return [...SudokuBuilder._handlers(constraintMap, shape)];
};

const handlerTypes = (handlers) => handlers.map(h => h.constructor.name);

const hasHandler = (handlers, typeName) =>
  handlers.some(h => h.constructor.name === typeName);

const countHandlers = (handlers, typeName) =>
  handlers.filter(h => h.constructor.name === typeName).length;

const nestedHandlers = (handler) => handler._handlers
  ? [handler, ...handler._handlers.flatMap(nestedHandlers)]
  : [handler];

const countHandlersDeep = (handlers, typeName) => handlers
  .flatMap(nestedHandlers)
  .filter(handler => handler.constructor.name === typeName).length;

const regionShardParent = (handler, grid, cell) => grid[handler._regionShardOffset + cell];

// ============================================================================
// build() basics
// ============================================================================

await runTest('build returns SudokuSolver for simple constraint', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Given('R1C1', 5),
  ]);
  const solver = SudokuBuilder.build(constraint);
  assert.ok(solver);
  assert.equal(typeof solver.countSolutions, 'function');
  assert.equal(typeof solver.nthSolution, 'function');
});

await runTest('build returns solver that can solve', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Given('R1C1', 5),
  ]);
  const solver = SudokuBuilder.build(constraint);
  const solution = solver.nthSolution(0);
  assert.ok(solution);
  assert.equal(solution[0], 5);
});

// ============================================================================
// resolveConstraint
// ============================================================================

await runTest('resolveConstraint resolves Given', () => {
  const raw = { type: 'Given', args: ['R1C1', 5] };
  const resolved = SudokuBuilder.resolveConstraint(raw);
  assert.ok(resolved instanceof SudokuConstraint.Given);
});

await runTest('resolveConstraint resolves composite Container', () => {
  const raw = {
    type: 'Container',
    args: [[
      { type: 'Given', args: ['R1C1', 5] },
      { type: 'Given', args: ['R1C2', 3] },
    ]],
  };
  const resolved = SudokuBuilder.resolveConstraint(raw);
  assert.ok(resolved instanceof SudokuConstraint.Container);
});

// ============================================================================
// _rowColHandlers
// ============================================================================

await runTest('default 9x9 produces row and column AllDifferent handlers', () => {
  const constraint = new SudokuConstraint.Container([]);
  const handlers = buildHandlers(constraint);
  // 9 rows + 9 cols + 9 boxes = 27 AllDifferent, plus BoxInfo.
  const adCount = countHandlers(handlers, 'AllDifferent');
  assert.equal(adCount, 27, `Expected 27 AllDifferent, got ${adCount}`);
  assert.ok(hasHandler(handlers, 'BoxInfo'));
});

await runTest('4x4 produces correct number of AllDifferent handlers', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
  ]);
  const handlers = buildHandlers(constraint);
  // 4 rows + 4 cols + 4 boxes = 12.
  const adCount = countHandlers(handlers, 'AllDifferent');
  assert.equal(adCount, 12, `Expected 12 AllDifferent, got ${adCount}`);
});

await runTestCases('RegionSize controls generated box handlers', [
  ['6x6 default boxes', '6x6', null, 18],
  ['6x6 four-cell boxes', '6x6', 4, 21],
  ['4x6 four-cell boxes', '4x6', 4, 16],
], (gridSpec, regionSize, expectedAllDifferent) => {
  const constraints = [new SudokuConstraint.Shape(gridSpec)];
  if (regionSize !== null) constraints.push(new SudokuConstraint.RegionSize(regionSize));

  const handlers = buildHandlers(new SudokuConstraint.Container(constraints));
  const adCount = countHandlers(handlers, 'AllDifferent');
  assert.equal(adCount, expectedAllDifferent,
    `Expected ${expectedAllDifferent} AllDifferent handlers for ${gridSpec}`);
});

// ============================================================================
// _boxHandlers with NoBoxes
// ============================================================================

await runTest('NoBoxes suppresses box AllDifferent handlers', () => {
  const withBoxes = new SudokuConstraint.Container([]);
  const withoutBoxes = new SudokuConstraint.Container([
    new SudokuConstraint.NoBoxes(),
  ]);
  const handlersWithBoxes = buildHandlers(withBoxes);
  const handlersWithout = buildHandlers(withoutBoxes);
  const adWith = countHandlers(handlersWithBoxes, 'AllDifferent');
  const adWithout = countHandlers(handlersWithout, 'AllDifferent');
  // Without boxes should have 9 fewer (no box handlers).
  assert.equal(adWith - adWithout, 9);
});

// ============================================================================
// Constraint type → handler mapping
// ============================================================================

await runTest('AntiKnight produces additional AllDifferent handlers', () => {
  const base = new SudokuConstraint.Container([]);
  const withAntiKnight = new SudokuConstraint.Container([
    new SudokuConstraint.AntiKnight(),
  ]);
  const baseCount = countHandlers(buildHandlers(base), 'AllDifferent');
  const akCount = countHandlers(buildHandlers(withAntiKnight), 'AllDifferent');
  // AntiKnight adds 2-cell AllDifferent for knight-move pairs.
  assert.ok(akCount > baseCount, `Expected more AllDifferent with AntiKnight`);
});

await runTest('AntiKing produces additional AllDifferent handlers', () => {
  const base = new SudokuConstraint.Container([]);
  const withAntiKing = new SudokuConstraint.Container([
    new SudokuConstraint.AntiKing(),
  ]);
  const baseCount = countHandlers(buildHandlers(base), 'AllDifferent');
  const akCount = countHandlers(buildHandlers(withAntiKing), 'AllDifferent');
  assert.ok(akCount > baseCount, `Expected more AllDifferent with AntiKing`);
});

await runTest('Cage produces Sum and AllDifferent handlers', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Cage(10, 'R1C1', 'R1C2', 'R1C3'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'Sum'));
  // 27 base + 1 cage AllDifferent = 28.
  const adCount = countHandlers(handlers, 'AllDifferent');
  assert.equal(adCount, 28);
});

await runTest('Cage with sum=0 produces AllDifferent only (no Sum)', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Cage(0, 'R1C1', 'R1C2', 'R1C3'),
  ]);
  const handlers = buildHandlers(constraint);
  // Sum handler count should stay at 0 from cage (base has none).
  const sumCount = countHandlers(handlers, 'Sum');
  assert.equal(sumCount, 0, 'Sum=0 cage should not produce Sum handler');
});

await runTest('Sum with coefficients produces Sum handler preserving coefficients', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Sum('0_=_2_-1', 'R1C1', 'R1C2'),
  ]);
  const sumHandlers = buildHandlers(constraint)
    .filter(h => h instanceof SumHandlerModule.Sum);

  assert.equal(sumHandlers.length, 1);
  assert.deepEqual([...sumHandlers[0].cells], [0, 1]);
  assert.deepEqual(sumHandlers[0].coefficients(), [2, -1]);
  assert.equal(sumHandlers[0].sum(), 0);
});

await runTest('Arrow produces Sum handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Arrow('R1C1', 'R1C2', 'R1C3'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'Sum'));
});

await runTest('PillArrow produces place-value Sum coefficients', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.PillArrow(2, 'R1C2', 'R1C1', 'R1C3'),
  ]);
  const sumHandlers = buildHandlers(constraint)
    .filter(h => h instanceof SumHandlerModule.Sum);

  assert.equal(sumHandlers.length, 1);
  assert.deepEqual([...sumHandlers[0].cells], [0, 1, 2]);
  assert.deepEqual(sumHandlers[0].coefficients(), [-10, -1, 1]);
  assert.equal(sumHandlers[0].sum(), 0);
});

await runTest('Thermo produces BinaryConstraint handlers', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Thermo('R1C1', 'R2C1', 'R3C1'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'BinaryConstraint'));
  // 3-cell thermo → 2 pairwise binary constraints.
  assert.equal(countHandlers(handlers, 'BinaryConstraint'), 2);
});

await runTest('Diagonal produces AllDifferent handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Diagonal(1),
  ]);
  const handlers = buildHandlers(constraint);
  // 27 base + 1 diagonal = 28.
  const adCount = countHandlers(handlers, 'AllDifferent');
  assert.equal(adCount, 28);
});

await runTest('Whisper produces BinaryConstraint handlers', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Whisper('R1C1', 'R2C1', 'R3C1'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'BinaryConstraint'));
});

await runTest('Renban produces BinaryPairwise handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Renban('R1C1', 'R2C1', 'R3C1'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'BinaryPairwise'));
});

await runTest('Quad supports var-cell 2x2 squares', () => {
  const constraint = SudokuParser.parseString(
    '.Var~X~X~81.BlackDot~VX1~VX2~VX3~VX10.Quad~VX13~1~2~3~4');
  const handlers = buildHandlers(constraint);
  const requiredHandlers = handlers.filter(h =>
    h instanceof HandlerModule.RequiredValues &&
    h.values().join(',') === '1,2,3,4');

  assert.equal(requiredHandlers.length, 1);
  assert.deepEqual([...requiredHandlers[0].cells], [93, 94, 102, 103]);
});

await runTest('Between produces Between handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Between('R1C1', 'R2C1', 'R3C1'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'Between'));
});

await runTest('Lockout produces Lockout handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Lockout('R1C1', 'R2C1', 'R3C1'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'Lockout'));
});

await runTest('Given produces GivenCandidates handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Given('R1C1', 5),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'GivenCandidates'));
});

// ============================================================================
// InvalidConstraintError
// ============================================================================

await runTest('Diagonal on non-square grid throws InvalidConstraintError', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x6'),
    new SudokuConstraint.Diagonal(1),
  ]);
  assert.throws(
    () => buildHandlers(constraint),
    { name: 'InvalidConstraintError' },
  );
});

// ============================================================================
// Jigsaw
// ============================================================================

await runTest('Jigsaw produces AllDifferent and JigsawPiece handlers', () => {
  // Build a valid 4x4 jigsaw with 4 pieces of size 4.
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.NoBoxes(),
    new SudokuConstraint.Jigsaw('4x4', 'R1C1', 'R1C2', 'R2C1', 'R2C2'),
    new SudokuConstraint.Jigsaw('4x4', 'R1C3', 'R1C4', 'R2C3', 'R2C4'),
    new SudokuConstraint.Jigsaw('4x4', 'R3C1', 'R3C2', 'R4C1', 'R4C2'),
    new SudokuConstraint.Jigsaw('4x4', 'R3C3', 'R3C4', 'R4C3', 'R4C4'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'JigsawPiece'));
  // 4 rows + 4 cols + 4 jigsaw pieces = 12 AllDifferent (no boxes).
  assert.equal(countHandlers(handlers, 'AllDifferent'), 12);
});

await runTest('ChaosConstruction produces handler, extra cells, and no box handlers', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
  ]);

  const shape = constraint.getShape();
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  assert.equal(shape.totalCells(), 32);
  assert.equal(shape.varCellsForGroup('CC').length, 16);

  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'ChaosConstruction'));
  assert.equal(countHandlers(handlers, 'ChaosFixedValueRegionExclusion'), 0);
  // 4 rows + 4 columns. Chaos Construction replaces default boxes.
  assert.equal(countHandlers(handlers, 'AllDifferent'), 8);
});

await runTest('ChaosArrow produces ChaosArrow handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.ChaosArrow('R2C1', 'CC16'),
  ]);

  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'ChaosArrow'));
});

await runTest('ChaosArrow expands control-only arrows before handler creation', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.ChaosArrow('R2C2'),
  ]);

  const handler = buildHandlers(constraint).find(h => h.constructor.name === 'ChaosArrow');

  assert.deepEqual(handler._regionRunArms.map(arm => [...arm]), [
    [5, 4],
    [5, 6, 7],
    [5, 1],
    [5, 9, 13],
  ]);
});

await runTest('ChaosArrow requires chaos cells after control cell', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.ChaosArrow('R2C1', 'R4C4'),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    /ChaosArrow cells after the control cell must be Chaos Construction region cells/);
});

await runTest('ChaosArrow requires ChaosConstruction', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosArrow('R2C1', 'R2C2'),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    /ChaosArrow requires Chaos Construction/);
});

await runTest('ChaosArrow produces ChaosArrow handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.ChaosArrow('R2C1', 'CC6', 'CC10', '', 'CC6', 'CC7', 'CC8'),
  ]);

  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'ChaosArrow'));
});

await runTest('ChaosArrow requires ChaosConstruction', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosArrow('R2C1', 'CC6', '', 'CC7'),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    /ChaosArrow requires Chaos Construction/);
});

await runTest('ChaosConstruction optimizer adds fixed value-region handlers with cages', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.Cage(3, 'R1C1', 'R1C2'),
  ]);

  const solver = SudokuBuilder.build(constraint);
  const handlers = solver._internalSolver._handlerSet.getAll();
  assert.equal(countHandlersDeep(handlers, 'ChaosFixedValueRegionExclusion'), 32);
});

await runTest('ChaosConstruction optimizer links adjacent equal CC cells only', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.SameValues(3, 'CC1', 'CC2', 'CC16'),
  ]);

  const solver = SudokuBuilder.build(constraint);
  const handlers = solver._internalSolver._handlerSet.getAll();
  const handler = handlers.find(h => h.constructor.name === 'ChaosConstruction');
  const grid = solver._internalSolver._initialGridState.slice();
  const root = regionShardParent(handler, grid, 0);

  assert.equal(regionShardParent(handler, grid, 1), root);
  assert.notEqual(regionShardParent(handler, grid, 15), root);
});

await runTest('ChaosConstruction rejects explicit non-value region size', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.RegionSize(2),
    new SudokuConstraint.ChaosConstruction(),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    { name: 'InvalidConstraintError' },
  );
});

await runTest('ChaosConstruction rejects effective non-value region size', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('6x6~9'),
    new SudokuConstraint.ChaosConstruction(),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    { name: 'InvalidConstraintError' },
  );
});

await runTest('ChaosConstruction rejects RegionSumLine', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.RegionSumLine('R1C1', 'R1C2', 'R1C3'),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    /RegionSumLine is not supported with Chaos Construction/);
});

await runTest('ChaosConstruction rejects RegionSameValues', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('4x4'),
    new SudokuConstraint.ChaosConstruction(),
    new SudokuConstraint.RegionSameValues(),
  ]);

  assert.throws(
    () => buildHandlers(constraint),
    /RegionSameValues is not supported with Chaos Construction/);
});

await runTest('ChaosConstruction solves through builder with canonical labels', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Shape('2x2'),
    new SudokuConstraint.ChaosConstruction(),
  ]);

  const solver = SudokuBuilder.build(constraint);
  assert.equal(solver.countSolutions(20), 4);

  const firstSolution = SudokuBuilder.build(constraint).nthSolution(0);
  assert.equal(firstSolution.length, 8);
  assert.equal(firstSolution[4], 1);
});

// ============================================================================
// Priority
// ============================================================================

await runTest('Priority constraint produces Priority handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Priority(5, 'R1C1', 'R1C2'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'Priority'));
  const priorityHandler = handlers.find(h => h.constructor.name === 'Priority');
  assert.equal(priorityHandler.priority(), 5);
  assert.equal(priorityHandler.priorityCells().length, 2);
});

logSuiteComplete('SudokuBuilder');
