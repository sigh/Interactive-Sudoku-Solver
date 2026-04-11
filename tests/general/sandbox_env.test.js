import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment({
  needWindow: true,
});

const {
  SANDBOX_GLOBALS,
  createSandboxConsole,
  withSandboxConsole,
  getSandboxExtraGlobals,
  getConstraintList,
} = await import('../../js/sandbox/env.js');
const { parseConstraint } = SANDBOX_GLOBALS;

// ============================================================================
// parseConstraint
// ============================================================================

await runTest('parseConstraint returns array for single constraint', () => {
  const result = parseConstraint('.Cage~10~R1C1~R1C2');
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'Cage');
});

await runTest('parseConstraint returns array for multiple constraints', () => {
  const result = parseConstraint('.Cage~10~R1C1~R1C2.Thermo~R3C3~R3C4~R3C5');
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'Cage');
  assert.equal(result[1].type, 'Thermo');
});

await runTest('parseConstraint unwraps Container', () => {
  const result = parseConstraint('.Given~R1C1_1.Given~R2C2_2');
  assert.ok(Array.isArray(result));
  assert.ok(result.every(c => c.type !== 'Container'));
});

await runTest('parseConstraint with single Given', () => {
  const result = parseConstraint('.Given~R1C1_5');
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'Given');
});

// ============================================================================
// solverLink
// ============================================================================

await runTest('solverLink with string constraint', () => {
  const { solverLink } = SANDBOX_GLOBALS;
  const link = solverLink('.Cage~10~R1C1~R1C2', 'Test Link');
  assert.equal(link.constraintStr(), '.Cage~10~R1C1~R1C2');
  assert.equal(link.text, 'Test Link');
});

await runTest('solverLink with constraint object', () => {
  const { solverLink, Cage } = SANDBOX_GLOBALS;
  const cage = new Cage(10, 'R1C1', 'R1C2');
  const link = solverLink(cage);
  assert.ok(link.constraintStr().includes('Cage'));
  assert.equal(link.text, undefined);
});

await runTest('solverLink with array of constraints', () => {
  const { solverLink, Cage, Thermo } = SANDBOX_GLOBALS;
  const constraints = [
    new Cage(10, 'R1C1', 'R1C2'),
    new Thermo('R3C3', 'R3C4'),
  ];
  const link = solverLink(constraints, 'Multiple');
  assert.ok(link.constraintStr().includes('Cage'));
  assert.ok(link.constraintStr().includes('Thermo'));
  assert.equal(link.text, 'Multiple');
});

// ============================================================================
// help
// ============================================================================

await runTest('help(Cage) prints heading', () => {
  const { help, Cage } = SANDBOX_GLOBALS;

  const logs = [];
  const errors = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    help(Cage);
  } finally {
    console.log = original.log;
    console.error = original.error;
  }

  assert.equal(errors.length, 0);
  assert.ok(logs.some(l => l.startsWith('Cage')));
});

await runTest('help with constraint string prints contained headings', () => {
  const { help } = SANDBOX_GLOBALS;

  const logs = [];
  const errors = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    help('.Cage~10~R1C1~R1C2.Thermo~R3C3~R3C4~R3C5');
  } finally {
    console.log = original.log;
    console.error = original.error;
  }

  assert.equal(errors.length, 0);
  assert.ok(logs.some(l => l.startsWith('Cage')));
  assert.ok(logs.some(l => l.startsWith('Thermo')));
});

await runTest('help with constraint instance and array', () => {
  const { help, Cage, Thermo } = SANDBOX_GLOBALS;

  const cage = new Cage(10, 'R1C1', 'R1C2');
  const thermo = new Thermo('R3C3', 'R3C4', 'R3C5');

  const logs = [];
  const errors = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    help(cage);
    help([thermo, new Cage(10, 'R1C1', 'R1C2')]);
  } finally {
    console.log = original.log;
    console.error = original.error;
  }

  assert.equal(errors.length, 0);
  assert.ok(logs.some(l => l.startsWith('Cage')));
  assert.ok(logs.some(l => l.startsWith('Thermo')));
});

// ============================================================================
// getConstraintList
// ============================================================================

await runTest('getConstraintList returns categorized constraint list', () => {
  const list = getConstraintList();
  assert.ok(list.includes('CONSTRAINTS BY CATEGORY'));
  assert.ok(list.includes('Cage'));
  assert.ok(list.includes('Thermo'));
});

// ============================================================================
// createSandboxConsole
// ============================================================================

await runTest('createSandboxConsole.log emits segments', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.log('hello', 42);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'log');
  assert.ok(emitted[0].segments.includes('hello'));
  assert.ok(emitted[0].segments.includes('42'));
});

await runTest('createSandboxConsole.error prepends error marker', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.error('bad');

  assert.equal(emitted[0].type, 'log');
  assert.equal(emitted[0].segments[0], '❌ ');
});

await runTest('createSandboxConsole.warn prepends warning marker', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.warn('careful');

  assert.equal(emitted[0].segments[0], '⚠️ ');
});

await runTest('createSandboxConsole.info emits status type', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.info('progress');

  assert.equal(emitted[0].type, 'status');
});

await runTest('createSandboxConsole.table emits table for array data', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.table([{ a: 1 }, { a: 2 }]);

  assert.equal(emitted[0].type, 'log');
  const tableSegment = emitted[0].segments[0];
  assert.equal(tableSegment.type, 'table');
  assert.deepEqual(tableSegment.columns, ['a']);
  assert.equal(tableSegment.rows.length, 2);
});

await runTest('createSandboxConsole.table handles empty array', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.table([]);

  assert.equal(emitted[0].segments[0], '(empty table)');
});

await runTest('createSandboxConsole.table handles non-array data', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.table('not an array');

  // Should fall through to toSegments for non-array
  assert.equal(emitted[0].type, 'log');
});

await runTest('createSandboxConsole.log handles SolverLink', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));
  const { solverLink } = SANDBOX_GLOBALS;

  const link = solverLink('.Cage~10~R1C1~R1C2', 'My Link');
  sc.log(link);

  const seg = emitted[0].segments[0];
  assert.equal(seg.type, 'link');
  assert.equal(seg.text, 'My Link');
  assert.equal(seg.constraintStr, '.Cage~10~R1C1~R1C2');
});

await runTest('createSandboxConsole.log formats null and objects', () => {
  const emitted = [];
  const sc = createSandboxConsole((msg) => emitted.push(msg));

  sc.log(null, { x: 1 });

  assert.ok(emitted[0].segments.includes('null'));
  // Object gets JSON.stringified
  assert.ok(emitted[0].segments.some(s => s.includes('"x"')));
});

// ============================================================================
// withSandboxConsole
// ============================================================================

await runTest('withSandboxConsole overrides and restores console', async () => {
  const originalLog = console.log;
  const emitted = [];

  const result = await withSandboxConsole(
    (msg) => emitted.push(msg),
    async () => {
      console.log('inside');
      return 42;
    },
  );

  assert.equal(result, 42);
  assert.equal(emitted.length, 1);
  assert.equal(console.log, originalLog, 'console.log should be restored');
});

await runTest('withSandboxConsole restores console on error', async () => {
  const originalLog = console.log;

  await assert.rejects(
    () => withSandboxConsole(() => { }, async () => { throw new Error('boom'); }),
    { message: 'boom' },
  );

  assert.equal(console.log, originalLog, 'console.log should be restored after error');
});

// ============================================================================
// getSandboxExtraGlobals
// ============================================================================

await runTest('getSandboxExtraGlobals.currentConstraint parses constraint string', () => {
  const givens = '.Given~R1C1_5.Given~R2C2_3';
  const { currentConstraint } = getSandboxExtraGlobals(givens);

  const result = currentConstraint();
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'Given');
});

await runTest('getSandboxExtraGlobals.currentConstraint returns null for non-string', () => {
  const { currentConstraint } = getSandboxExtraGlobals(undefined);
  assert.equal(currentConstraint(), null);
});

await runTest('getSandboxExtraGlobals.currentShape returns shape', () => {
  const givens = '.Given~R1C1_5';
  const { currentShape } = getSandboxExtraGlobals(givens);

  const shape = currentShape();
  assert.ok(shape);
  assert.equal(shape.numRows, 9);
});

await runTest('getSandboxExtraGlobals caches parsed constraint', () => {
  const { currentConstraint } = getSandboxExtraGlobals('.Given~R1C1_5');

  const first = currentConstraint();
  const second = currentConstraint();
  // Should be the same reference (cached)
  assert.equal(first, second);
});

logSuiteComplete('sandbox env');
