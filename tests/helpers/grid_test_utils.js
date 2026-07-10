import assert from 'node:assert/strict';

const g = globalThis;
if (!g.self) {
  g.self = g;
}
if (typeof g.VERSION_PARAM === 'undefined') {
  g.VERSION_PARAM = '';
}

const { LookupTables } = await import('../../js/solver/lookup_tables.js');
const { CellGeometry } = await import('../../js/cell_geometry.js');
const { CellExclusions } = await import('../../js/solver/engine.js');
const { Or, True, False, SudokuConstraintHandler } =
  await import('../../js/solver/handlers.js');

const DEFAULT_NUM_VALUES = 9;
const DEFAULT_NUM_CELLS = 81;

/*
 * Guidance for AIs
 *
 * - Prefer `new GridTestContext({ gridSize, numValues })` so tests always use a real `CellGeometry`.
 * - Model “line length” scenarios with rectangles:
 *   - short line: `gridSize: [1, N]`, `numValues: M` where `N < M`
 *   - long line:  `gridSize: [1, N]`, `numValues: M` where `N > M`
 * - Prefer `context.initializeHandler(handler)` to avoid boilerplate; pass `{ cellExclusions, state }` only when the test is about them.
 * - `context.grid` is cached per context; use a fresh context when you need an independent grid.
 * - Build candidate masks with `valueMask(...values)` (values are 1-indexed), or via `applyCandidates`.
 * - If something needs a cell count (e.g. `createCellExclusions`), use `context.geometry.numGridCells`.
 * - Consider when the API might evolve; for example if a resetGrid method would be useful on the context.
 * - Update this guidance as needed when you notice common patterns.
 */

const normalizeGridSize = (gridSize) => {
  if (typeof gridSize === 'number') return [gridSize, gridSize];
  if (
    Array.isArray(gridSize) &&
    gridSize.length === 2 &&
    typeof gridSize[0] === 'number' &&
    typeof gridSize[1] === 'number'
  ) {
    return [gridSize[0], gridSize[1]];
  }
  return null;
};

export class GridTestContext {
  constructor({
    gridSize = DEFAULT_NUM_VALUES,
    numValues = null,
    geometry,
  } = {}) {
    this.geometry = (() => {
      if (geometry) return (numValues === null || numValues === undefined) ? geometry : CellGeometry.fromGridSize(geometry.numRows, geometry.numCols, numValues);

      const dims = normalizeGridSize(gridSize);
      if (!dims) throw new Error(`Invalid gridSize: ${gridSize}`);
      const [numRows, numCols] = dims;

      const baseGeometry = CellGeometry.fromGridSize(numRows, numCols, numValues);
      if (!baseGeometry) throw new Error(`Invalid gridSize: ${gridSize}`);
      return baseGeometry;
    })();

    this.lookupTables = LookupTables.get(this.geometry.numValues);

    this._grid = null;
  }

  get grid() {
    if (!this._grid) this._grid = this.createGrid();
    return this._grid;
  }

  initializeHandler(handler, { cellExclusions, state } = {}) {
    const grid = this.grid;
    const resolvedCellExclusions = cellExclusions ?? createCellExclusions({ numCells: this.geometry.numGridCells });
    const resolvedState = state ?? createStateAllocator(grid);
    return handler.initialize(grid, resolvedCellExclusions, this.geometry, resolvedState);
  }

  createGrid({ fill = this.lookupTables.allValues } = {}) {
    const grid = new Array(this.geometry.numGridCells).fill(fill);
    this._grid = grid;
    return grid;
  }

  _range(n, start = 0) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid range length: ${n}`);
    if (!Number.isInteger(start) || start < 0) throw new Error(`Invalid range start: ${start}`);
    return Array.from({ length: n }, (_, i) => start + i);
  }

  cells(...args) {
    if (args.length === 0) return this._range(this.geometry.numGridCells);

    if (args.length === 1) {
      const [only] = args;
      if (Array.isArray(only)) return [...only];
      if (Number.isInteger(only)) return this._range(only);
    }

    return args;
  }

  row(rowIndex) {
    if (!Number.isInteger(rowIndex)) throw new Error(`Invalid row index: ${rowIndex}`);
    if (rowIndex < 0 || rowIndex >= this.geometry.numRows) throw new Error(`Row out of bounds: ${rowIndex}`);
    return this._range(this.geometry.numCols, rowIndex * this.geometry.numCols);
  }

  col(colIndex) {
    if (!Number.isInteger(colIndex)) throw new Error(`Invalid col index: ${colIndex}`);
    if (colIndex < 0 || colIndex >= this.geometry.numCols) throw new Error(`Col out of bounds: ${colIndex}`);
    return Array.from({ length: this.geometry.numRows }, (_, r) => r * this.geometry.numCols + colIndex);
  }
}

export const valueMask = (...values) => LookupTables.fromValuesArray(values);

// 0-indexed variant: valueMask0(0) = bit 0 (display value 0), etc.
export const valueMask0 = (...values) =>
  LookupTables.fromValuesArray(values.map(v => v + 1));

export const createAccumulator = () => {
  const touched = new Set();
  return {
    touched,
    addForCell(cell) {
      touched.add(cell);
    },
  };
};

export const createStateAllocator = (grid, startOffset = grid.length) => {
  let nextOffset = startOffset;
  let bitWordOffset = 0;
  let bitCursor = 16;
  const allocator = {
    allocate(state) {
      const offset = nextOffset;
      if (grid.set) {
        if (offset + state.length > grid.length) {
          throw new Error('Typed test grid is too small for state allocation');
        }
        grid.set(state, offset);
      } else {
        for (let i = 0; i < state.length; i++) grid[offset + i] = state[i];
      }
      nextOffset += state.length;
      return offset;
    },
    allocateBit() {
      if (bitCursor === 16) {
        bitWordOffset = allocator.allocate(new Uint16Array(1));
        bitCursor = 0;
      }
      return { offset: bitWordOffset, mask: 1 << bitCursor++ };
    },
  };
  return allocator;
};

export const createCellExclusions = ({ allUnique = true, numCells = DEFAULT_NUM_CELLS } = {}) => {
  const exclusions = new CellExclusions([], numCells);

  if (allUnique) {
    for (let i = 0; i < numCells; i++) {
      for (let j = i + 1; j < numCells; j++) {
        exclusions.addMutualExclusion(i, j);
      }
    }
  }

  return exclusions;
};

export const applyCandidates = (grid, assignments) => {
  for (const [cellKey, values] of Object.entries(assignments)) {
    const cellIndex = Number(cellKey);
    if (Array.isArray(values)) {
      grid[cellIndex] = valueMask(...values);
    } else if (typeof values === 'number') {
      grid[cellIndex] = values;
    } else {
      throw new TypeError('Assignments must be arrays of values or numeric bitmasks');
    }
  }
  return grid;
};

export const assertTouched = (acc, expectedCells) => {
  const actual = [...acc.touched].sort((a, b) => a - b);
  const expected = [...expectedCells].sort((a, b) => a - b);
  assert.deepEqual(actual, expected, 'Accumulator touched cells mismatch');
};

export const assertCandidates = (grid, expectations) => {
  for (const [cell, values] of Object.entries(expectations)) {
    const expected = Array.isArray(values) ? valueMask(...values) : values;
    assert.equal(grid[Number(cell)], expected,
      `Cell ${cell} candidates mismatch`);
  }
};

// ===========================================================================
// Or-wrap harness (see _notes/.../engine/or-safety-invariants.md, L3).
//
// The engine only exercises a handler's Or-nested paths (delta replay, scratch
// isolation, state writeback) during a full solve, where regressions surface
// far from the cause. These helpers drive those paths directly against a bare
// handler so a broken writeback shows up as a failing unit test.
// ===========================================================================

export const OR_WRAP_MODES = {
  // Decoy dies at init => only the wrapped handler survives => Or's single-
  // handler fast path, which replays the wrapped handler's init deltas each
  // call. Pruning stays identical to the unwrapped handler.
  FAST_PATH: 'fastPath',
  // Decoy survives init but fails on the first enforce => scratch path, then
  // the wrapped handler's scratch result becomes the whole union. Pruning is
  // still identical, but reached through the scratch/writeback machinery.
  FAILING_DECOY: 'failingDecoy',
  // Decoy stays live forever => scratch path with a genuine union, so cell
  // lanes are widened back (pruning is NOT preserved). Used for the state-leak
  // assertion: only the wrapped handler's own state lanes may change.
  LIVE_DECOY: 'liveDecoy',
};

// Survives initialize(), fails the first enforceConsistency(). Test-only.
class FailingDecoyHandler extends SudokuConstraintHandler {
  initialize() { return true; }
  enforceConsistency() { return false; }
}

const makeOrDecoy = (mode) => {
  switch (mode) {
    case OR_WRAP_MODES.FAST_PATH: return new False([0]);
    case OR_WRAP_MODES.FAILING_DECOY: return new FailingDecoyHandler();
    case OR_WRAP_MODES.LIVE_DECOY: return new True();
    default: throw new Error(`Unknown Or-wrap mode: ${mode}`);
  }
};

// Initialize any handler (typically an Or) on a typed, state-extended grid,
// the way the engine does. Returns the grid plus the state slots each
// allocate()/allocateBit() call claimed, in order.
export const initTypedHandler = (
  context, handler, { cellExclusions, stateSlack = 256 } = {}) => {
  const geometry = context.geometry;
  const numSearchCells = geometry.totalCells();
  const allValues = LookupTables.get(geometry.numValues).allValues;

  const grid = new Uint16Array(numSearchCells + stateSlack);
  const src = context.grid;
  for (let i = 0; i < geometry.numGridCells; i++) {
    grid[i] = src[i] ?? allValues;
  }
  for (let i = geometry.numGridCells; i < numSearchCells; i++) {
    grid[i] = allValues;
  }

  const allocations = [];
  let next = numSearchCells;
  let bitWordOffset = 0;
  let bitCursor = 16;
  const stateAllocator = {
    allocate(state) {
      const offset = next;
      if (offset + state.length > grid.length) {
        throw new Error('Or-wrap grid too small; raise stateSlack');
      }
      grid.set(state, offset);
      next += state.length;
      allocations.push([offset, next]);
      return offset;
    },
    allocateBit() {
      if (bitCursor === 16) {
        bitWordOffset = this.allocate(new Uint16Array(1));
        bitCursor = 0;
      }
      return { offset: bitWordOffset, mask: 1 << bitCursor++ };
    },
  };

  const resolvedExclusions = cellExclusions
    ?? createCellExclusions({ numCells: geometry.numGridCells });
  const result = handler.initialize(
    grid, resolvedExclusions, geometry, stateAllocator);
  if (result) handler.postInitialize(grid);
  context._grid = grid;
  return { result, grid, allocations, numSearchCells, stateEnd: next };
};

// Wrap a bare handler in `Or(handler, decoy)` and initialize it. `wrappedSlots`
// are the state lanes owned by the wrapped handler (everything the allocator
// handed out except the Or's own state word), which is what the leak assertion
// keys off.
export const wrapInOr = (context, handler, mode, options = {}) => {
  const orHandler = new Or(handler, makeOrDecoy(mode));
  const init = initTypedHandler(context, orHandler, options);
  const orStart = orHandler._stateOffset;
  const wrappedSlots = init.allocations.filter(([start]) => start !== orStart);
  return { orHandler, ...init, wrappedSlots, orStateOffset: orStart };
};

// Assert that Or-wrapping preserves pruning. Only valid for the modes where the
// wrapped handler's result is the whole union (FAST_PATH, FAILING_DECOY).
// `candidates` are applied to the fresh grid *before* initialize so the
// baseline and wrapped runs see byte-identical starting grids.
export const assertOrWrapEquivalent = (
  { makeContext, makeHandler, cellExclusions, candidates, mode }) => {
  const run = (buildHandler) => {
    const context = makeContext();
    if (candidates) applyCandidates(context.grid, candidates);
    const opts = { cellExclusions: cellExclusions?.() };
    const built = buildHandler(context, opts);
    const acc = createAccumulator();
    const ok = built.result
      ? built.handler.enforceConsistency(built.grid, acc) : false;
    return { ...built, ok };
  };

  const base = run((context, opts) => {
    const handler = makeHandler();
    const init = initTypedHandler(context, handler, opts);
    return { handler, ...init };
  });
  const wrapped = run((context, opts) => {
    const wrap = wrapInOr(context, makeHandler(), mode, opts);
    return { handler: wrap.orHandler, ...wrap };
  });

  assert.equal(wrapped.ok, base.ok, `Or-wrap (${mode}): result mismatch`);
  if (base.ok) {
    for (let i = 0; i < base.numSearchCells; i++) {
      assert.equal(wrapped.grid[i], base.grid[i],
        `Or-wrap (${mode}): cell ${i} lane mismatch`);
    }
  }
};

// Assert that a live-decoy scratch-path enforce leaks no foreign state: cell
// lanes are unchanged (the True decoy makes the union vacuous) and every state
// lane except the wrapped handler's own is byte-identical afterwards. This is
// the direct regression net for the Or writeback loop.
export const assertOrWrapNoStateLeak = (
  { makeContext, makeHandler, cellExclusions, candidates }) => {
  const context = makeContext();
  if (candidates) applyCandidates(context.grid, candidates);
  const wrap = wrapInOr(
    context, makeHandler(), OR_WRAP_MODES.LIVE_DECOY,
    { cellExclusions: cellExclusions?.() });
  assert.equal(wrap.result, true,
    'no-leak scenario must survive init; pick candidates that do');

  const { grid, numSearchCells, stateEnd, wrappedSlots } = wrap;
  const owned = new Uint8Array(grid.length);
  for (const [start, end] of wrappedSlots) {
    for (let i = start; i < end; i++) owned[i] = 1;
  }

  const before = grid.slice();
  const ok = wrap.orHandler.enforceConsistency(grid, createAccumulator());
  assert.equal(ok, true, 'live-decoy Or should survive enforce');

  for (let i = 0; i < numSearchCells; i++) {
    assert.equal(grid[i], before[i],
      `live-decoy: cell ${i} changed (union should be vacuous)`);
  }
  for (let i = numSearchCells; i < stateEnd; i++) {
    if (owned[i]) continue;
    assert.equal(grid[i], before[i],
      `live-decoy: foreign state lane ${i} leaked`);
  }
};

