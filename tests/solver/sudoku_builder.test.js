import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
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

await runTest('Arrow produces Sum handler', () => {
  const constraint = new SudokuConstraint.Container([
    new SudokuConstraint.Arrow('R1C1', 'R1C2', 'R1C3'),
  ]);
  const handlers = buildHandlers(constraint);
  assert.ok(hasHandler(handlers, 'Sum'));
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
