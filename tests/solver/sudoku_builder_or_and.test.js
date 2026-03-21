import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { And, Or, True, AllDifferent, GivenCandidates } = await import('../../js/solver/handlers.js');
const { Sum } = await import('../../js/solver/sum_handler.js');

// Helper: collect all handlers yielded by _constraintHandlers for a given
// constraint on a standard 9x9 shape.
const collectHandlers = (constraint) => {
  const shape = SudokuConstraint.Shape.getShapeFromGridSpec(null);
  const constraintMap = constraint.toMap();
  return [...SudokuBuilder._constraintHandlers(constraintMap, shape)];
};

// -- _wrapAnd tests --

await runTest('_wrapAnd: single handler returns it directly', () => {
  const h = new True();
  const result = SudokuBuilder._wrapAnd([h]);
  assert.equal(result, h);
});

await runTest('_wrapAnd: multiple handlers returns And', () => {
  const h1 = new True();
  const h2 = new True();
  const result = SudokuBuilder._wrapAnd([h1, h2]);
  assert.ok(result instanceof And);
});

// -- _yieldOr tests --

await runTest('_yieldOr: empty branches yields nothing', () => {
  const result = [...SudokuBuilder._yieldOr([])];
  assert.equal(result.length, 0);
});

await runTest('_yieldOr: all-empty branches yields nothing', () => {
  const result = [...SudokuBuilder._yieldOr([[], []])];
  assert.equal(result.length, 0);
});

await runTest('_yieldOr: single branch with one handler yields it directly', () => {
  const h = new True();
  const result = [...SudokuBuilder._yieldOr([[h]])];
  assert.equal(result.length, 1);
  assert.equal(result[0], h);
  assert.ok(!(result[0] instanceof Or));
  assert.ok(!(result[0] instanceof And));
});

await runTest('_yieldOr: single branch with multiple handlers yields them all unwrapped', () => {
  const h1 = new True();
  const h2 = new True();
  const result = [...SudokuBuilder._yieldOr([[h1, h2]])];
  assert.equal(result.length, 2);
  assert.equal(result[0], h1);
  assert.equal(result[1], h2);
});

await runTest('_yieldOr: multiple branches yields single Or', () => {
  const h1 = new True();
  const h2 = new True();
  const result = [...SudokuBuilder._yieldOr([[h1], [h2]])];
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof Or);
});

await runTest('_yieldOr: multiple branches wraps multi-handler branch in And', () => {
  const h1 = new True();
  const h2 = new True();
  const h3 = new True();
  const result = [...SudokuBuilder._yieldOr([[h1, h2], [h3]])];
  assert.equal(result.length, 1);
  assert.ok(result[0] instanceof Or);
  // First branch should be And, second should be raw handler.
  const orHandlers = result[0]._handlers;
  assert.ok(orHandlers[0] instanceof And);
  assert.equal(orHandlers[1], h3);
});

await runTest('_yieldOr: skips empty branches among non-empty', () => {
  const h = new True();
  const result = [...SudokuBuilder._yieldOr([[], [h], []])];
  // Single non-empty branch -> yield directly.
  assert.equal(result.length, 1);
  assert.equal(result[0], h);
});

// -- Integration: Or constraint --

await runTest('Or constraint: single sub-constraint yields unwrapped handlers', () => {
  // Or with a single Given inside should not produce an Or or And handler.
  const given = new SudokuConstraint.Given('R1C1', 5);
  const orConstraint = new SudokuConstraint.Or([given]);
  const handlers = collectHandlers(orConstraint);

  assert.ok(handlers.length > 0);
  for (const h of handlers) {
    assert.ok(!(h instanceof Or), 'should not yield Or');
    assert.ok(!(h instanceof And), 'should not yield And');
  }
  // The handler should be a GivenCandidates.
  assert.ok(handlers.some(h => h instanceof GivenCandidates));
});

await runTest('Or constraint: multiple sub-constraints yields Or handler', () => {
  const g1 = new SudokuConstraint.Given('R1C1', 5);
  const g2 = new SudokuConstraint.Given('R1C1', 3);
  const orConstraint = new SudokuConstraint.Or([g1, g2]);
  const handlers = collectHandlers(orConstraint);

  assert.equal(handlers.length, 1);
  assert.ok(handlers[0] instanceof Or);
});

await runTest('Or constraint: sub-constraint yielding multiple handlers wraps in And', () => {
  // A Cage yields both a Sum and an AllDifferent handler, so it produces
  // multiple handlers that should be wrapped in And inside the Or.
  const cage1 = new SudokuConstraint.Cage(10, 'R1C1', 'R1C2', 'R1C3');
  const cage2 = new SudokuConstraint.Cage(15, 'R2C1', 'R2C2', 'R2C3');
  const orConstraint = new SudokuConstraint.Or([cage1, cage2]);
  const handlers = collectHandlers(orConstraint);

  assert.equal(handlers.length, 1);
  assert.ok(handlers[0] instanceof Or);
  // Each branch should be an And (since Cage yields 2 handlers).
  for (const branch of handlers[0]._handlers) {
    assert.ok(branch instanceof And);
  }
});

await runTest('Or constraint: single sub-constraint yielding multiple handlers yields all unwrapped', () => {
  // A Cage yields both a Sum and an AllDifferent handler. With only one
  // branch in the Or, both should be yielded directly — no Or or And.
  const cage = new SudokuConstraint.Cage(10, 'R1C1', 'R1C2', 'R1C3');
  const orConstraint = new SudokuConstraint.Or([cage]);
  const handlers = collectHandlers(orConstraint);

  assert.equal(handlers.length, 2);
  for (const h of handlers) {
    assert.ok(!(h instanceof Or), 'should not yield Or');
    assert.ok(!(h instanceof And), 'should not yield And');
  }
  assert.ok(handlers.some(h => h instanceof Sum));
  assert.ok(handlers.some(h => h instanceof AllDifferent));
});

await runTest('Or constraint: nested Or-in-Or is fully unnested', () => {
  // Or(Or(Given1, Given2)) — the outer Or has a single branch that yields
  // an inner Or. The outer Or should be elided, yielding just the inner Or.
  const g1 = new SudokuConstraint.Given('R1C1', 5);
  const g2 = new SudokuConstraint.Given('R1C1', 3);
  const innerOr = new SudokuConstraint.Or([g1, g2]);
  const outerOr = new SudokuConstraint.Or([innerOr]);
  const handlers = collectHandlers(outerOr);

  // Should yield a single Or (the inner one), not Or(And(Or(...))).
  assert.equal(handlers.length, 1);
  assert.ok(handlers[0] instanceof Or);
  // The Or's branches should be the leaf GivenCandidates, not nested Or/And.
  for (const h of handlers[0]._handlers) {
    assert.ok(h instanceof GivenCandidates);
  }
});

await runTest('Or constraint: nested Or-in-And-in-Or is unnested', () => {
  // Or(And(Or(Given1, Given2))) — outer Or has one And branch containing
  // an inner Or. The outer Or and And should be elided.
  const g1 = new SudokuConstraint.Given('R1C1', 5);
  const g2 = new SudokuConstraint.Given('R1C1', 3);
  const innerOr = new SudokuConstraint.Or([g1, g2]);
  const andConstraint = new SudokuConstraint.And([innerOr]);
  const outerOr = new SudokuConstraint.Or([andConstraint]);
  const handlers = collectHandlers(outerOr);

  // The And is transparent (yields child handlers directly), and the outer
  // Or has a single branch, so we get just the inner Or's handler.
  assert.equal(handlers.length, 1);
  assert.ok(handlers[0] instanceof Or);
  for (const h of handlers[0]._handlers) {
    assert.ok(h instanceof GivenCandidates);
  }
});

logSuiteComplete('sudoku_builder_or_and.test.js');
