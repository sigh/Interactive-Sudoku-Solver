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

await runTest('getSandboxExtraGlobals.currentCellGeometry returns geometry', () => {
  const givens = '.Given~R1C1_5';
  const { currentCellGeometry } = getSandboxExtraGlobals(givens);

  const geometry = currentCellGeometry();
  assert.ok(geometry);
  assert.equal(geometry.numRows, 9);
});

await runTest('getSandboxExtraGlobals caches parsed constraint', () => {
  const { currentConstraint } = getSandboxExtraGlobals('.Given~R1C1_5');

  const first = currentConstraint();
  const second = currentConstraint();
  // Should be the same reference (cached)
  assert.equal(first, second);
});

// ============================================================================
// cellGeometry
// ============================================================================

const { cellGeometry, cellGraph, parseCellId, makeCellId, makeSolver, CellGeometry } =
  SANDBOX_GLOBALS;

await runTest('cellGeometry resolves a shape spec string', () => {
  assert.equal(cellGeometry('9x9').numGridCells, 81);
  assert.equal(cellGeometry('6x6').numGridCells, 36);
});

await runTest('cellGeometry returns a CellGeometry argument as-is', () => {
  const geometry = cellGeometry('6x6');
  assert.equal(cellGeometry(geometry), geometry);
});

await runTest('cellGeometry reads shapeSpec off an object', () => {
  assert.equal(cellGeometry({ shapeSpec: '4x4' }).numGridCells, 16);
});

await runTest('cellGeometry defaults with no/empty argument', () => {
  const expected = CellGeometry.newDefault().numGridCells;
  assert.equal(cellGeometry().numGridCells, expected);
  assert.equal(cellGeometry({}).numGridCells, expected);
});

await runTest('cellGeometry accepts a numeric grid size', () => {
  const square = cellGeometry(6);
  assert.deepEqual([square.numRows, square.numCols], [6, 6]);
  const rect = cellGeometry(6, 9);   // rows x cols
  assert.deepEqual([rect.numRows, rect.numCols], [6, 9]);
  assert.throws(() => cellGeometry(0), /Invalid grid size/);
});

await runTest('cellGraph accepts a numeric grid size too', () => {
  assert.equal(cellGraph(4).cells().length, 16);
  assert.deepEqual(cellGraph(6, 9).block('R1C1', 1, 9).length, 9);
});

// ============================================================================
// cellGraph: SandboxCellGraph over the main grid
// ============================================================================

await runTest('cells() returns every grid cell row-major', () => {
  const cells = cellGraph('9x9').cells();
  assert.equal(cells.length, 81);
  assert.equal(cells[0], 'R1C1');
  assert.equal(cells[80], 'R9C9');
  assert.equal(cells[9], 'R2C1');
});

await runTest('graph.gridGeometry() exposes the underlying geometry', () => {
  const g = cellGraph('6x9');   // rows x cols
  const geo = g.gridGeometry();
  assert.equal(geo.numRows, 6);
  assert.equal(geo.numCols, 9);
  assert.equal(geo.numGridCells, 54);
  assert.equal(geo.numValues, 9);
  // An overlay shares the one grid geometry (no separate handle to drift).
  assert.equal(g.makeOverlay('VL').gridGeometry(), geo);
});

await runTest('neighbours() gives orthogonal in-grid cells', () => {
  const g = cellGraph('9x9');
  assert.deepEqual(new Set(g.neighbours('R1C1')), new Set(['R1C2', 'R2C1']));
  assert.deepEqual(new Set(g.neighbours('R1C5')), new Set(['R1C4', 'R1C6', 'R2C5']));
  assert.deepEqual(
    new Set(g.neighbours('R5C5')),
    new Set(['R5C4', 'R5C6', 'R4C5', 'R6C5']));
});

await runTest('kingNeighbours() gives the up-to-8 cells, row-major', () => {
  const g = cellGraph('9x9');
  assert.deepEqual(g.kingNeighbours('R1C1'), ['R1C2', 'R2C1', 'R2C2']);
  assert.deepEqual(g.kingNeighbours('R5C5'),
    ['R4C4', 'R4C5', 'R4C6', 'R5C4', 'R5C6', 'R6C4', 'R6C5', 'R6C6']);
  assert.equal(g.kingNeighbours('R1C5').length, 5);
});

await runTest('step() moves by a signed offset or off the grid', () => {
  const g = cellGraph('9x9');
  assert.equal(g.step('R1C1', 0, 1), 'R1C2');
  assert.equal(g.step('R1C1', 1, 0), 'R2C1');
  assert.equal(g.step('R1C1', 1, 1), 'R2C2');
  assert.equal(g.step('R1C1', -1, 0), null);
  assert.equal(g.step('R9C9', 1, 0), null);
});

await runTest('ray() walks to the grid edge, inclusive', () => {
  const g = cellGraph('9x9');
  assert.deepEqual(g.ray('R1C1', 0, 1),
    ['R1C1', 'R1C2', 'R1C3', 'R1C4', 'R1C5', 'R1C6', 'R1C7', 'R1C8', 'R1C9']);
  assert.deepEqual(g.ray('R5C5', 1, 1), ['R5C5', 'R6C6', 'R7C7', 'R8C8', 'R9C9']);
  assert.deepEqual(g.ray('R1C9', 0, 1), ['R1C9']);
});

await runTest('row() / column() give the whole line through a cell', () => {
  const g = cellGraph('9x9');
  assert.deepEqual(g.row('R5C3'),
    ['R5C1', 'R5C2', 'R5C3', 'R5C4', 'R5C5', 'R5C6', 'R5C7', 'R5C8', 'R5C9']);
  assert.deepEqual(g.column('R3C5'),
    ['R1C5', 'R2C5', 'R3C5', 'R4C5', 'R5C5', 'R6C5', 'R7C5', 'R8C5', 'R9C5']);
});

await runTest('block() returns a rectangle or null if off-grid', () => {
  const g = cellGraph('9x9');
  assert.deepEqual(g.block('R1C1', 2, 2), ['R1C1', 'R1C2', 'R2C1', 'R2C2']);
  assert.deepEqual(g.block('R1C1', 1, 3), ['R1C1', 'R1C2', 'R1C3']);
  assert.deepEqual(g.block('R2C3', 1, 1), ['R2C3']);
  assert.equal(g.block('R9C9', 2, 2), null);
  assert.equal(g.block('R1C8', 1, 3), null);
});

await runTest('connected() tests orthogonal connectivity', () => {
  const g = cellGraph('9x9');
  assert.equal(g.connected(['R1C1', 'R1C2', 'R2C1']), true);
  assert.equal(g.connected(['R1C1', 'R4C4']), false);
  assert.equal(g.connected(['R1C1']), true);
  assert.equal(g.connected([]), true);
});

// ============================================================================
// makeOverlay: SandboxOverlay as a cell graph over a var-cell group
// ============================================================================

await runTest('a dense overlay pairs each grid cell with a var cell', () => {
  const cc = cellGraph('4x4').makeOverlay('CC');
  assert.equal(cc.cells().length, 16);
  assert.equal(cc.cells()[0], 'CC1');
  assert.equal(cc.cells()[15], 'CC16');
  assert.equal(cc.at('R1C1'), 'CC1');
  assert.equal(cc.at('R2C1'), 'CC5');
  assert.equal(cc.gridAt('CC5'), 'R2C1');
});

await runTest('overlay at()/gridAt() return null when unpaired', () => {
  const cc = cellGraph('4x4').makeOverlay('CC');
  assert.equal(cc.gridAt('CC99'), null);
  const sparse = cellGraph('4x4').makeOverlay('VC', ['R1C1', 'R1C2', 'R3C3']);
  assert.equal(sparse.at('R2C2'), null);
  assert.equal(sparse.gridAt('VC9'), null);
});

await runTest('overlay defaults to the whole grid, and honours a prefix', () => {
  const overlay = cellGraph('4x4').makeOverlay('VL');
  assert.equal(overlay.cells().length, 16);
  assert.equal(overlay.cells()[0], 'VL1');
});

await runTest('a dense overlay is connected as its grid cells are', () => {
  const cc = cellGraph('4x4').makeOverlay('CC');
  assert.deepEqual(new Set(cc.neighbours('CC1')), new Set(['CC2', 'CC5']));
  assert.deepEqual(new Set(cc.neighbours('CC6')),
    new Set(['CC5', 'CC7', 'CC2', 'CC10']));
  assert.equal(cc.step('CC1', 0, 1), 'CC2');
  assert.equal(cc.step('CC1', 1, 0), 'CC5');
  assert.equal(cc.step('CC1', -1, 0), null);
  assert.deepEqual(cc.row('CC5'), ['CC5', 'CC6', 'CC7', 'CC8']);
  assert.deepEqual(cc.column('CC2'), ['CC2', 'CC6', 'CC10', 'CC14']);
  assert.deepEqual(cc.kingNeighbours('CC6'),
    ['CC1', 'CC2', 'CC3', 'CC5', 'CC7', 'CC9', 'CC10', 'CC11']);
});

await runTest('a sparse overlay is the induced subgraph', () => {
  const sparse = cellGraph('4x4').makeOverlay('VC', ['R1C1', 'R1C2', 'R3C3']);
  assert.deepEqual(sparse.cells(), ['VC1', 'VC2', 'VC3']);
  assert.deepEqual(sparse.neighbours('VC1'), ['VC2']);   // R1C2 is the only member adjacent
  assert.deepEqual(sparse.neighbours('VC3'), []);        // R3C3 has no member neighbours
});

await runTest('overlay graph methods throw for a foreign cell', () => {
  const cc = cellGraph('4x4').makeOverlay('CC');
  assert.throws(() => cc.neighbours('R1C1'), /not in overlay/);
});

await runTest('overlay toVar() derives the matching Var constraint', () => {
  // Dense: name is the prefix minus its leading 'V', count is the cell count.
  const dense = cellGraph('4x4').makeOverlay('VL').toVar('loop');
  assert.equal(dense.type, 'Var');
  assert.deepEqual(dense.args, ['L', 'loop', 16]);

  // Sparse: count follows the overlay, not the grid.
  const sparse = cellGraph('4x4').makeOverlay('VC', ['R1C1', 'R2C2', 'R3C3']);
  assert.deepEqual(sparse.toVar('Color').args, ['C', 'Color', 3]);

  // Label defaults to the name.
  assert.deepEqual(cellGraph('4x4').makeOverlay('VS').toVar().args, ['S', 'S', 16]);
});

await runTest('overlay toVar() rejects a non-var prefix', () => {
  // 'CC' is a chaos-construction group, registered by its own constraint.
  assert.throws(() => cellGraph('4x4').makeOverlay('CC').toVar(), /'V'-prefixed/);
});

// ============================================================================
// CellLocator role: parseCellId / makeCellIdFromIndex over the graph's own cells
// ============================================================================

await runTest('grid graph is a locator over its grid cells', () => {
  const g = cellGraph('9x9');
  assert.deepEqual(g.parseCellId('R1C1'), { cellIndex: 0 });
  assert.deepEqual(g.parseCellId('R2C1'), { cellIndex: 9 });
  assert.equal(g.makeCellIdFromIndex(0), 'R1C1');
  assert.equal(g.makeCellIdFromIndex(9), 'R2C1');
  const { cellIndex } = g.parseCellId("R7C2");
  assert.equal(g.makeCellIdFromIndex(cellIndex), "R7C2");
});

await runTest('overlay is a locator over group-local dense positions', () => {
  const cc = cellGraph('9x9').makeOverlay('CC');
  // The nth var cell has group-local index n-1, independent of grid indices.
  assert.deepEqual(cc.parseCellId('CC1'), { cellIndex: 0 });
  assert.deepEqual(cc.parseCellId('CC10'), { cellIndex: 9 });
  assert.equal(cc.makeCellIdFromIndex(0), 'CC1');
  assert.equal(cc.makeCellIdFromIndex(9), 'CC10');
});

await runTest('a sparse overlay locator indexes only its members', () => {
  const sparse = cellGraph('9x9').makeOverlay('VC', ['R1C1', 'R5C5', 'R9C9']);
  assert.deepEqual(sparse.parseCellId('VC2'), { cellIndex: 1 });
  assert.equal(sparse.makeCellIdFromIndex(2), 'VC3');
  assert.throws(() => sparse.parseCellId('VC9'), /not in overlay/);
});

await runTest('grid graph locator throws for an invalid cell', () => {
  const g = cellGraph('9x9');
  assert.throws(() => g.parseCellId('R9C99'), /Invalid cell ID/);
});

// ============================================================================
// parseCellId / makeCellId  (1-based, over the max geometry)
// ============================================================================

await runTest('parseCellId / makeCellId round-trip', () => {
  assert.deepEqual(parseCellId('R3C4'), { row: 3, col: 4 });
  assert.deepEqual(parseCellId('R1C1'), { row: 1, col: 1 });
  assert.equal(makeCellId(3, 4), 'R3C4');
  const { row, col } = parseCellId('R7C2');
  assert.equal(makeCellId(row, col), 'R7C2');
});

// ============================================================================
// makeSolver
// ============================================================================

await runTest('makeSolver returns a solver with the expected interface', async () => {
  const solver = await makeSolver();
  assert.equal(typeof solver.solution, 'function');
  assert.equal(typeof solver.uniqueSolution, 'function');
  assert.equal(typeof solver.countSolutions, 'function');
});

logSuiteComplete('sandbox env');
