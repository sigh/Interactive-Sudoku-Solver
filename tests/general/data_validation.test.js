import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { DISPLAYED_EXAMPLES, PUZZLE_INDEX } = await import('../../data/example_puzzles.js');
const { EXAMPLES } = await import('../../data/collections.js');
const { VALID_JIGSAW_BOX_LAYOUTS } = await import('../../data/jigsaw_box_layouts.js');

// ============================================================================
// Example puzzle data validation
// ============================================================================

await runTest('all DISPLAYED_EXAMPLES build into solvers without error', () => {
  for (const example of DISPLAYED_EXAMPLES) {
    const constraint = SudokuParser.parseText(example.input);
    assert.ok(constraint, `Failed to parse: ${example.name}`);
    const resolved = SudokuBuilder.resolveConstraint(constraint);
    const solver = SudokuBuilder.build(resolved);
    assert.ok(solver, `Failed to build solver for: ${example.name}`);
  }
});

await runTest('PUZZLE_INDEX maps names to DISPLAYED_EXAMPLES entries', () => {
  assert.ok(PUZZLE_INDEX instanceof Map || typeof PUZZLE_INDEX === 'object');
  for (const example of DISPLAYED_EXAMPLES) {
    if (!example.name) continue;
    const found = PUZZLE_INDEX instanceof Map
      ? PUZZLE_INDEX.get(example.name)
      : PUZZLE_INDEX[example.name];
    assert.ok(found, `PUZZLE_INDEX missing entry for: ${example.name}`);
  }
});

// ============================================================================
// Collection puzzle data validation
// ============================================================================

await runTest('all EXAMPLES have required fields', () => {
  assert.ok(EXAMPLES.length > 0, 'Should have collection examples');
  for (const example of EXAMPLES) {
    assert.equal(typeof example.name, 'string', 'Example must have a name');
    assert.ok(example.name.length > 0, 'Name should not be empty');
    assert.equal(typeof example.input, 'string', 'Example must have input');
    assert.ok(example.input.length > 0, `Input should not be empty: ${example.name}`);
  }
});

await runTest('all EXAMPLES build into solvers without error', () => {
  for (const example of EXAMPLES) {
    // Skip file path references (e.g. '/data/large_state_machine.iss')
    // which require file I/O to resolve.
    if (example.input.startsWith('/')) continue;
    const constraint = SudokuParser.parseText(example.input);
    assert.ok(constraint, `Failed to parse collection puzzle: ${example.name}`);
    const resolved = SudokuBuilder.resolveConstraint(constraint);
    const solver = SudokuBuilder.build(resolved);
    assert.ok(solver, `Failed to build solver for collection: ${example.name}`);
  }
});

// ============================================================================
// Jigsaw layout data validation
// ============================================================================

await runTest('all VALID_JIGSAW_BOX_LAYOUTS have valid input strings', () => {
  assert.ok(Array.isArray(VALID_JIGSAW_BOX_LAYOUTS));
  assert.ok(VALID_JIGSAW_BOX_LAYOUTS.length > 0, 'Should have jigsaw layouts');
  for (const layout of VALID_JIGSAW_BOX_LAYOUTS) {
    assert.equal(typeof layout.input, 'string');
    assert.ok(layout.input.length > 0, 'Layout input should not be empty');
  }
});

logSuiteComplete('Data Validation');
