import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  createAccumulator,
  mask,
} from '../helpers/constraint_test_utils.js';

ensureGlobalEnvironment();

const { FullGridRequiredValues } = await import('../../js/solver/handlers.js');

const makeLines3x2 = () => {
  // 3 lines, each with 2 cells (6 total cells). Lines are backed by one buffer.
  const packed = Uint8Array.from([0, 1, 2, 3, 4, 5]);
  return [
    packed.subarray(0, 2),
    packed.subarray(2, 4),
    packed.subarray(4, 6),
  ];
};

const makeLines4x3 = () => {
  // 4 lines, each with 3 cells (12 total cells). Lines are backed by one buffer.
  const packed = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  return [
    packed.subarray(0, 3),
    packed.subarray(3, 6),
    packed.subarray(6, 9),
    packed.subarray(9, 12),
  ];
};

await runTest('FullGridRequiredValues: forbids value in remaining lines when satisfied == required', () => {
  const lines = makeLines3x2();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5], lines);

  // numValues = 3, so all candidates = {1,2,3} => 0b111.
  const grid = new Uint16Array(6).fill(mask(1, 2, 3));

  // Value 1 is fixed in two lines (required = 2), so it must be forbidden
  // in the remaining line.
  grid[0] = mask(1); // line 0 satisfied
  grid[2] = mask(1); // line 1 satisfied
  // line 2 (cells 4,5) still has candidate 1 initially.

  const acc = createAccumulator();
  const ok = handler.enforceConsistency(grid, acc);

  assert.equal(ok, true);
  assert.equal(grid[4] & mask(1), 0, 'should remove value 1 from cell 4');
  assert.equal(grid[5] & mask(1), 0, 'should remove value 1 from cell 5');
  assert.ok(acc.touched.has(4) || acc.touched.has(5), 'should report touched cells');
});

await runTest('FullGridRequiredValues: returns false when satisfied > required', () => {
  const lines = makeLines3x2();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5], lines);

  const grid = new Uint16Array(6).fill(mask(1, 2, 3));

  // Value 1 fixed in all 3 lines, but required = 2.
  grid[0] = mask(1);
  grid[2] = mask(1);
  grid[4] = mask(1);

  const ok = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(ok, false);
});

await runTest('FullGridRequiredValues: returns false when satisfied + possible < required', () => {
  const lines = makeLines3x2();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5], lines);

  const grid = new Uint16Array(6).fill(mask(1, 2, 3));

  // Make value 2 (bit 0b010) impossible in two lines, leaving it possible
  // in only one line. With required = 2, this is a contradiction.
  const v2 = mask(2);

  // Remove 2 from line 1 and line 2.
  grid[2] &= ~v2;
  grid[3] &= ~v2;
  grid[4] &= ~v2;
  grid[5] &= ~v2;

  const ok = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(ok, false);
});

await runTest('FullGridRequiredValues: forces value when satisfied + possible == required and line has single candidate cell', () => {
  const lines = makeLines3x2();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5], lines);

  const grid = new Uint16Array(6).fill(mask(1, 2, 3));
  const v3 = mask(3);

  // For value 3:
  // - line 0 satisfied (fixed)
  // - line 1 possible (exactly one candidate cell)
  // - line 2 impossible
  // => satisfied + possible == required (2), so line 1 must contain the value,
  // and we can force it when there's only one candidate.
  grid[1] = v3; // line 0 satisfied

  // line 1: only cell 2 can be 3
  grid[2] = mask(1, 3);
  grid[3] = mask(1, 2);

  // line 2: make value 3 impossible
  grid[4] &= ~v3;
  grid[5] &= ~v3;

  const acc = createAccumulator();
  const ok = handler.enforceConsistency(grid, acc);

  assert.equal(ok, true);
  assert.equal(grid[2], v3, 'should force value 3 into the only candidate cell');
  // No accumulator update required for hidden singles; the main solver loop
  // will pick up the newly-fixed cell on the next selection.
});

await runTest('FullGridRequiredValues: prunes non-required values when required values exactly fill a line', () => {
  const lines = makeLines4x3();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], lines);

  const grid = new Uint16Array(12).fill(mask(1, 2, 3, 4));
  const v1 = mask(1);
  const v2 = mask(2);
  const v3 = mask(3);
  const v4 = mask(4);

  // With lineLength = 3, each value must appear in exactly 3 of the 4 lines.
  // Make values 1,2,3 each impossible in exactly one line so they become required.
  // Keep value 4 possible everywhere so it is NOT required.
  // In line 0, required values {1,2,3} exactly fill the line length, so 4 can be
  // removed from all cells in line 0.

  // Remove 3 from line 1.
  for (const cell of lines[1]) grid[cell] &= ~v3;
  // Remove 2 from line 2.
  for (const cell of lines[2]) grid[cell] &= ~v2;
  // Remove 1 from line 3.
  for (const cell of lines[3]) grid[cell] &= ~v1;

  const acc = createAccumulator();
  const ok = handler.enforceConsistency(grid, acc);

  assert.equal(ok, true);
  for (const cell of lines[0]) {
    assert.equal(grid[cell] & v4, 0, `should remove value 4 from cell ${cell}`);
    assert.ok(acc.touched.has(cell), `should report pruned cell ${cell}`);
  }
});

await runTest('FullGridRequiredValues: returns false when a line contains too many required values', () => {
  const lines = makeLines4x3();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], lines);

  const grid = new Uint16Array(12).fill(mask(1, 2, 3, 4));
  const v1 = mask(1);
  const v2 = mask(2);
  const v3 = mask(3);
  const v4 = mask(4);

  // Make ALL values requiredPossible by removing each value from exactly one line.
  // Then in line 0, all 4 required values are possible, but line length is 3 => contradiction.
  for (const cell of lines[1]) grid[cell] &= ~v1;
  for (const cell of lines[2]) grid[cell] &= ~v2;
  for (const cell of lines[3]) grid[cell] &= ~v3;
  // Also remove 4 from one line (line 1) so 4 becomes required too.
  for (const cell of lines[1]) grid[cell] &= ~v4;

  const ok = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(ok, false);
});

await runTest('FullGridRequiredValues: returns false if requiredPossibleValues creates multiple hidden singles in one cell', () => {
  const lines = makeLines3x2();
  const handler = new FullGridRequiredValues([0, 1, 2, 3, 4, 5], lines);

  const grid = new Uint16Array(6).fill(mask(1, 2, 3));
  const v1 = mask(1);
  const v2 = mask(2);
  const v3 = mask(3);

  // Line 0: values 2 and 3 each appear in exactly one cell (cell 1), so they
  // are both hidden singles in the same cell.
  grid[0] = v1;
  grid[1] = v2 | v3;

  // Make value 2 required: satisfied in line 1, possible in line 0, impossible in line 2.
  grid[2] = v2;
  grid[3] = v1 | v2;
  grid[4] &= ~v2;
  grid[5] &= ~v2;

  // Make value 3 required: satisfied in line 2, possible in line 0, impossible in line 1.
  grid[4] = v3;
  grid[5] = v1 | v3;
  grid[2] &= ~v3;
  grid[3] &= ~v3;

  const ok = handler.enforceConsistency(grid, createAccumulator());
  assert.equal(ok, false);
});

logSuiteComplete('full_grid_required_values.test.js');
