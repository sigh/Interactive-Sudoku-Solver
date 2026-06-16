import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  createAccumulator,
  createCellExclusions,
  createStateAllocator,
  valueMask,
} from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../../js/grid_shape.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { LookupTables } = await import('../../js/solver/lookup_tables.js');
const {
  ChaosConstruction,
  ChaosArrow,
  ChaosCount,
  ChaosFixedValueRegionExclusion,
} = await import('../../js/solver/chaos_handler.js');

const makeChaosGrid = (shape) => {
  const grid = new Uint16Array(
    shape.totalCells() + shape.numGridCells * 2 + shape.numGridCells / shape.numValues);
  grid.fill(LookupTables.get(shape.numValues).allValues, 0, shape.totalCells());
  return grid;
};

const makeChaosContext = (gridSpec = '2x2', configureGrid = null) => {
  const shape = GridShape.fromGridSpec(gridSpec);
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const grid = makeChaosGrid(shape);

  const regionCells = shape.varCellsForGroup('CC');
  const gridCells = Uint8Array.from({ length: shape.numGridCells }, (_, i) => i);
  const regionCellOffset = regionCells[0];
  const handler = new ChaosConstruction(shape.numGridCells, regionCellOffset, shape.numValues);
  configureGrid?.({ shape, grid, regionCells, handler });
  const cellExclusions = createCellExclusions({
    allUnique: false,
    numCells: shape.totalCells(),
  });

  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  const stateAllocator = createStateAllocator(grid, shape.totalCells());
  const initialized = handler.initialize(
    grid, cellExclusions, shape, stateAllocator);
  return {
    shape, grid, gridCells, regionCells, regionCellOffset, handler,
    cellExclusions, stateAllocator, initialized,
  };
};

const enforce = (context) => {
  const acc = createAccumulator();
  const result = context.handler.enforceConsistency(context.grid, acc);
  return { result, acc };
};

const makeShardArrow = (context, controlCell, regionRunArms) => {
  const regionArms = regionRunArms.map(arm => arm.map(c => context.regionCells[c]));
  const handler = new ChaosArrow(controlCell, regionArms, regionRunArms, 0);
  handler.attachRegionShardState(context.handler.regionShardState());
  assert.equal(handler.initialize(
    context.grid, context.cellExclusions, context.shape, context.stateAllocator), true);
  return handler;
};

const enforceShardArrow = (arrowHandler, context) => {
  assert.equal(arrowHandler.enforceConsistency(context.grid, createAccumulator()), true);
};

const makeShardCount = (context, controlCell, runCells) => {
  const regionCells = runCells.map(cell => context.regionCells[cell]);
  const handler = new ChaosCount(controlCell, regionCells, runCells, 0);
  handler.attachRegionShardState(context.handler.regionShardState());
  assert.equal(handler.initialize(
    context.grid, context.cellExclusions, context.shape, context.stateAllocator), true);
  return handler;
};

const enforceShardCount = (countHandler, context) => {
  assert.equal(countHandler.enforceConsistency(context.grid, createAccumulator()), true);
};

const makeChaosCount = (shape, controlCell, regionCells, grid) => {
  const regionOffset = shape.varCellsForGroup('CC')[0];
  const runCells = regionCells.map(c => c - regionOffset);
  const handler = new ChaosCount(controlCell, regionCells, runCells, 0);
  const cellExclusions = createCellExclusions({ allUnique: false, numCells: shape.totalCells() });
  const stateAllocator = createStateAllocator(grid, shape.totalCells());
  assert.equal(handler.initialize(grid, cellExclusions, shape, stateAllocator), true);
  return handler;
};

const isFixedMask = mask => mask && !(mask & (mask - 1));

const regionShardParent = (handler, grid, cell) => grid[handler._regionShardOffset + cell];
const possibleRegionCount = (handler, region) => handler._regions.scanData[region] & 0x1ff;
const fixedRegionCount = (handler, region) => (handler._regions.scanData[region] >>> 9) & 0x1f;

const fullChaosGridIsValid = (shape, values, regions) => {
  const allValues = LookupTables.get(shape.numValues).allValues;
  const numRegions = shape.numGridCells / shape.numValues;
  const regionMask = (1 << numRegions) - 1;
  let previousSeen = 1;

  for (let cell = 0; cell < shape.numGridCells; cell++) {
    const allowed = (previousSeen | (previousSeen << 1)) & regionMask;
    if (!(regions[cell] & allowed)) return false;
    previousSeen |= regions[cell];
  }
  if (previousSeen !== regionMask) return false;

  for (let region = 0; region < numRegions; region++) {
    const regionBit = 1 << region;
    const cells = [];
    let valuesSeen = 0;
    for (let cell = 0; cell < shape.numGridCells; cell++) {
      if (regions[cell] !== regionBit) continue;
      if (valuesSeen & values[cell]) return false;
      valuesSeen |= values[cell];
      cells.push(cell);
    }
    if (cells.length !== shape.numValues || valuesSeen !== allValues) return false;

    const seen = new Set([cells[0]]);
    const queue = [cells[0]];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      const row = cell / shape.numCols | 0;
      const col = cell % shape.numCols;
      for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow < 0 || nextCol < 0
          || nextRow >= shape.numRows || nextCol >= shape.numCols) {
          continue;
        }
        const next = nextRow * shape.numCols + nextCol;
        if (regions[next] !== regionBit || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    if (seen.size !== cells.length) return false;
  }

  return true;
};

const partialChaosGridHasCompletion = (shape, partialValues, partialRegions) => {
  const values = new Array(shape.numGridCells);
  const regions = new Array(shape.numGridCells);

  const assignRegions = (cell) => {
    if (cell === shape.numGridCells) return fullChaosGridIsValid(shape, values, regions);
    const numRegions = shape.numGridCells / shape.numValues;
    for (let region = 0; region < numRegions; region++) {
      const regionBit = 1 << region;
      if (!(partialRegions[cell] & regionBit)) continue;
      regions[cell] = regionBit;
      if (assignRegions(cell + 1)) return true;
    }
    return false;
  };

  const assignValues = (cell) => {
    if (cell === shape.numGridCells) return assignRegions(0);
    for (let valueIndex = 0; valueIndex < shape.numValues; valueIndex++) {
      const value = 1 << valueIndex;
      if (!(partialValues[cell] & value)) continue;
      values[cell] = value;
      if (assignValues(cell + 1)) return true;
    }
    return false;
  };

  return assignValues(0);
};

await runTest('ChaosConstruction defines one visible region cell per grid cell', () => {
  const shape = GridShape.fromGridSize(4);
  const constraint = new SudokuConstraint.ChaosConstruction();
  assert.deepEqual(constraint.getVarCellGroups(shape), [{
    prefix: 'CC',
    label: 'Chaos regions',
    count: 16,
    columns: 4,
  }]);

  shape.addVarCellsForConstraints([constraint]);
  assert.equal(shape.totalCells(), 32);
  assert.deepEqual(shape.varCellsForGroup('CC').slice(0, 4), [16, 17, 18, 19]);
});

await runTest('ChaosConstruction accepts non-square grids', () => {
  // 2x3 has regionSize=3 (max), numRegions=2 — valid.
  const shape = GridShape.fromGridSpec('2x3');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);

  assert.equal(
    handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: shape.totalCells() }),
      shape,
      createStateAllocator(grid, shape.totalCells())),
    true);
});

await runTest('ChaosConstruction rejects region size that does not divide grid cell count', () => {
  // 4x5 = 20 cells, regionSize=3 — 20 % 3 !== 0.
  const shape = GridShape.fromGridSpec('4x5');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], 3);

  assert.throws(
    () => handler.initialize(
      grid,
      createCellExclusions({ allUnique: false, numCells: shape.totalCells() }),
      shape,
      createStateAllocator(grid, shape.totalCells())),
    /divisible by region size/);
});

await runTest('ChaosConstruction priority is a low global floor', () => {
  const context = makeChaosContext('4x4');
  assert.equal(context.handler.priority(), 2);
});

await runTest('ChaosConstruction initializes canonical region candidates', () => {
  const context = makeChaosContext('4x4');
  const { grid, regionCells, initialized } = context;

  assert.equal(initialized, true);
  assert.equal(grid[regionCells[0]], valueMask(1));
  assert.equal(grid[regionCells[1]], valueMask(1, 2, 3, 4));
  assert.equal(grid[regionCells[2]], valueMask(1, 2, 3, 4));
  assert.equal(grid[regionCells[3]], valueMask(1, 2, 3, 4));
  assert.equal(grid[regionCells[4]], valueMask(1, 2, 3, 4));
  assert.equal(grid[regionCells[7]], valueMask(2));
  assert.equal(grid[regionCells[13]], valueMask(3));
});

await runTest('ChaosCount prunes control candidates to feasible match counts', () => {
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = makeChaosCount(shape, 0, [regionCells[0], regionCells[1], regionCells[2]], grid);

  grid[regionCells[0]] = valueMask(2);
  grid[regionCells[1]] = valueMask(2);
  grid[regionCells[2]] = valueMask(3);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[0], valueMask(2));
});

const makeEnclosedCount = (shape, runCells) => {
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const counted = runCells.map(p => regionCells[p]);
  const handler = new ChaosCount(0, counted, runCells, 0);
  const ok = handler.initialize(
    grid,
    createCellExclusions({ allUnique: false, numCells: shape.totalCells() }),
    shape,
    createStateAllocator(grid, shape.totalCells()));
  return { handler, grid, ok };
};

await runTest('ChaosCount removes count 1 when the first cell is enclosed', () => {
  // First counted cell is corner 0; its neighbours (1 right, 4 down) are both
  // counted, so it is enclosed and the count can never be 1.
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const { grid, ok } = makeEnclosedCount(shape, [0, 1, 4]);
  assert.equal(ok, true);
  assert.equal(grid[0] & valueMask(1), 0);          // count 1 gone
  assert.equal(grid[0], valueMask(2) | valueMask(3)); // counts 2,3 remain
});

await runTest('ChaosCount keeps count 1 when the first cell is not enclosed', () => {
  // Missing the down-neighbour (4), so the first cell is not enclosed.
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const { grid, ok } = makeEnclosedCount(shape, [0, 1]);
  assert.equal(ok, true);
  assert.notEqual(grid[0] & valueMask(1), 0);       // count 1 still possible
});

await runTest('ChaosCount removes the infeasible count 0 in a 0-indexed grid', () => {
  // 0-3 grid (valueOffset -1): count k sits at value k+1, so count 0 is value 1.
  // The count is never 0 (the first cell is always counted), so value 1 is removed
  // even when the first cell is not enclosed.
  const shape = GridShape.fromGridSpec('4x4~0-3');
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const { grid, ok } = makeEnclosedCount(shape, [0, 1]);  // not enclosed
  assert.equal(ok, true);
  assert.equal(grid[0] & valueMask(1), 0);          // count 0 (value 1) removed
  assert.notEqual(grid[0] & valueMask(2), 0);       // count 1 (value 2) still ok
});

await runTest('ChaosCount removes counts 0 and 1 through the offset when enclosed', () => {
  const shape = GridShape.fromGridSpec('4x4~0-3');  // valueOffset -1
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const { grid, ok } = makeEnclosedCount(shape, [0, 1, 4]);
  assert.equal(ok, true);
  // count 0 (value 1) and count 1 (value 2) gone; counts 2,3 (values 3,4) remain.
  assert.equal(grid[0], valueMask(3) | valueMask(4));
});

await runTest('ChaosCount: enclosed first cell needs an extra in-region neighbour', () => {
  // First cell (corner 0) is enclosed by counted cells 1, 4. A non-neighbour
  // counted cell (5) is fixed to the first cell's region, but neither neighbour
  // is — so a neighbour must still join, forcing the count to >= 3.
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const regionCells = shape.varCellsForGroup('CC');
  const { handler, grid, ok } = makeEnclosedCount(shape, [0, 1, 4, 5]);
  assert.equal(ok, true);
  const allRegions = (1 << (shape.numGridCells / 4)) - 1;  // regionSize 4 -> 4 regions
  grid[regionCells[0]] = valueMask(2);  // first cell fixed to region 2
  grid[regionCells[1]] = allRegions;    // neighbour, open
  grid[regionCells[4]] = allRegions;    // neighbour, open
  grid[regionCells[5]] = valueMask(2);  // non-neighbour fixed to region 2
  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  // count is first + cell 5 + one of {1,4} >= 3, so counts 1 and 2 are removed.
  assert.equal(grid[0], valueMask(3) | valueMask(4));
});

await runTest('ChaosCount maps the control value through the shape value offset', () => {
  // On a 0-8 style grid (valueOffset -1) the control's displayed count is one
  // less than its stored value, so a count of 2 fixes the control to value 3.
  const shape = GridShape.fromGridSpec('4x4~0-3');
  assert.equal(shape.valueOffset, -1);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = makeChaosCount(shape, 0, [regionCells[0], regionCells[1], regionCells[2]], grid);

  grid[regionCells[0]] = valueMask(2);
  grid[regionCells[1]] = valueMask(2);
  grid[regionCells[2]] = valueMask(3);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[0], valueMask(3));
});

await runTest('ChaosCount prunes unsupported first region candidates', () => {
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = makeChaosCount(shape, 0, [regionCells[0], regionCells[1], regionCells[2]], grid);

  grid[0] = valueMask(3);
  grid[regionCells[0]] = valueMask(1) | valueMask(2);
  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[2]] = valueMask(1);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[0]], valueMask(1));
});

await runTest('ChaosCount rejects impossible fixed counts', () => {
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = makeChaosCount(shape, 0, [regionCells[0], regionCells[1]], grid);

  grid[0] = valueMask(1);
  grid[regionCells[0]] = valueMask(2);
  grid[regionCells[1]] = valueMask(2);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ChaosCount prunes counted cells when control forces no extra matches', () => {
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = makeChaosCount(shape, 0, [regionCells[0], regionCells[1], regionCells[2]], grid);

  grid[0] = valueMask(1);
  grid[regionCells[0]] = valueMask(2);
  grid[regionCells[1]] = valueMask(2) | valueMask(3);
  grid[regionCells[2]] = valueMask(1) | valueMask(2) | valueMask(4);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[1]], valueMask(3));
  assert.equal(grid[regionCells[2]], valueMask(1) | valueMask(4));
});

await runTest('ChaosCount prunes counted cells when control forces all matches', () => {
  const shape = GridShape.fromGridSize(4);
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = makeChaosCount(shape, 0, [regionCells[0], regionCells[1], regionCells[2]], grid);

  grid[0] = valueMask(3);
  grid[regionCells[0]] = valueMask(2);
  grid[regionCells[1]] = valueMask(2) | valueMask(3);
  grid[regionCells[2]] = valueMask(2) | valueMask(4);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[regionCells[1]], valueMask(2));
  assert.equal(grid[regionCells[2]], valueMask(2));
});

await runTest('ChaosCount merges contiguous fixed matching region cells into shards', () => {
  const context = makeChaosContext('4x4');
  const { grid, regionCells, handler } = context;
  const countHandler = makeShardCount(context, 0, [5, 6, 9]);

  grid[regionCells[5]] = valueMask(2);
  grid[regionCells[6]] = valueMask(2);
  grid[regionCells[9]] = valueMask(2);

  enforceShardCount(countHandler, context);
  assert.equal(regionShardParent(handler, grid, 5), regionShardParent(handler, grid, 6));
  assert.equal(regionShardParent(handler, grid, 5), regionShardParent(handler, grid, 9));
});

await runTest('ChaosCount does not shard-merge non-contiguous fixed matching region cells', () => {
  const context = makeChaosContext('4x4');
  const { grid, regionCells, handler } = context;
  const countHandler = makeShardCount(context, 0, [5, 10]);

  grid[regionCells[5]] = valueMask(2);
  grid[regionCells[10]] = valueMask(2);

  enforceShardCount(countHandler, context);
  assert.notEqual(regionShardParent(handler, grid, 5), regionShardParent(handler, grid, 10));
});

await runTest('ChaosConstruction priority anchor selection does not mutate grid', () => {
  const shape = GridShape.fromGridSpec('4x4');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const grid = makeChaosGrid(shape);
  const beforeSelection = grid.slice();
  const handler = new ChaosConstruction(shape.numGridCells, shape.varCellsForGroup('CC')[0], shape.numValues);

  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  assert.deepEqual(grid, beforeSelection);
});

await runTest('ChaosConstruction uses one anchor when no separated triple exists', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells, initialized } = context;

  assert.equal(initialized, true);
  assert.equal(grid[regionCells[0]], valueMask(1));
  assert.equal(grid[regionCells[5]], valueMask(1, 2, 3));
  assert.equal(grid[regionCells[7]], valueMask(1, 2, 3));
});

await runTest('ChaosConstruction anchor separation uses regionSize not numCols for tall grids', () => {
  // 4x3: numRows=4, numCols=3, regionSize=4, numRegions=3
  // With numCols (3) as threshold: triple [0,5,9] passes since dist(0,9)=3 >= 3, but 3 < regionSize=4
  // With regionSize (4) as threshold: no triple has all pairwise distances >= 4, so falls back to [0]
  const shape = GridShape.fromGridSpec('4x3');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  assert.deepEqual(handler._canonicalAnchorCells, [0]);
});

await runTest('ChaosConstruction returned anchors have pairwise Manhattan distance at least regionSize', () => {
  const shape = GridShape.fromGridSpec('4x4');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));

  const anchors = handler._canonicalAnchorCells;
  assert.equal(anchors.length, 3);
  const { numCols } = shape;
  const regionSize = shape.numValues;
  const manhattan = (a, b) =>
    Math.abs((a / numCols | 0) - (b / numCols | 0)) + Math.abs(a % numCols - b % numCols);
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const dist = manhattan(anchors[i], anchors[j]);
      assert.ok(dist >= regionSize,
        `anchors ${anchors[i]} and ${anchors[j]}: dist=${dist} < regionSize=${regionSize}`);
    }
  }
});

await runTest('ChaosConstruction exits early with single anchor when numRegions < 3 (tall 4x2)', () => {
  // 4x2: numRows=4, numCols=2, regionSize=4, numRegions=2 — hits the numRegions<3 early return
  const shape = GridShape.fromGridSpec('4x2');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  assert.deepEqual(handler._canonicalAnchorCells, [0]);
});

await runTest('ChaosConstruction falls back to single anchor when no sufficiently separated triple exists (wide 3x4)', () => {
  // 3x4: numRows=3, numCols=4, regionSize=4, numRegions=3 — enough regions but no triple
  // with all pairwise Manhattan distance >= 4 exists in this narrow grid.
  // Max distance = 2+3=5, but three mutually-distant cells cannot be found.
  const shape = GridShape.fromGridSpec('3x4');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);
  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  assert.deepEqual(handler._canonicalAnchorCells, [0]);
});

await runTest('ChaosConstruction anchor selection picks highest-scoring valid triple via cell priorities', () => {
  // 6x6: multiple valid triples exist; boost cell 23 (r3,c5, right-column edge cell)
  // so the algorithm prefers any triple containing it over the default first-found triple.
  // Triple (0, 23, 31): dist(0,23)=8, dist(0,31)=6, dist(23,31)=6 — all >= regionSize=6.
  const shape = GridShape.fromGridSpec('6x6');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);

  const priorities = new Int32Array(shape.totalCells());
  priorities[23] = 100;
  priorities[regionCells[0] + 23] = 100;
  handler.selectPriorityAnchorCells(shape, priorities);

  assert.deepEqual(handler._canonicalAnchorCells, [0, 23, 31]);
});

await runTest('ChaosConstruction rejects conflicting default canonical anchor during initialization', () => {
  assert.equal(makeChaosContext('4x4', ({ grid, regionCells }) => {
    grid[regionCells[0]] = valueMask(2);
  }).initialized, false);
});

await runTest('ChaosConstruction default anchor is applied without priority selection', () => {
  const shape = GridShape.fromGridSpec('4x4');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const grid = makeChaosGrid(shape);
  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0], shape.numValues);

  const initialized = handler.initialize(
    grid,
    createCellExclusions({ allUnique: false, numCells: shape.totalCells() }),
    shape,
    createStateAllocator(grid, shape.totalCells()));
  assert.equal(initialized, true);
  assert.equal(grid[regionCells[0]], valueMask(1));
  assert.equal(grid[regionCells[7]], valueMask(1, 2, 3, 4));
  assert.equal(grid[regionCells[13]], valueMask(1, 2, 3, 4));
});

await runTest('ChaosConstruction rejects non-canonical fixed labels', () => {
  const context = makeChaosContext('6x6');
  const { grid, regionCells } = context;

  grid[regionCells[1]] = valueMask(5);
  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction removes completed region labels from other cells', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells } = context;

  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[3]] = valueMask(1);
  grid[regionCells[4]] = valueMask(1, 2, 3);

  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[4]] & valueMask(1), 0);
});

await runTest('ChaosConstruction rejects regions with too many fixed cells', () => {
  const context = makeChaosContext('2x2');
  const { grid, regionCells } = context;

  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[2]] = valueMask(1);

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction rejects disconnected fixed region cells', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells } = context;

  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[8]] = valueMask(1);

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction removes region candidates too far from fixed cells', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells } = context;

  grid[regionCells[0]] = valueMask(1);

  assert.equal(enforce(context).result, true);
  assert.notEqual(grid[regionCells[2]] & valueMask(1), 0);
  assert.equal(grid[regionCells[5]] & valueMask(1), 0);
  assert.equal(grid[regionCells[7]] & valueMask(1), 0);
  assert.equal(grid[regionCells[8]] & valueMask(1), 0);
});

await runTest('ChaosConstruction distance pruning takes whole shards together', () => {
  const context = makeChaosContext('3x3', ({ grid, regionCells }) => {
    grid[0] = valueMask(1);
    grid[1] = valueMask(3);
    grid[3] = valueMask(2);
    grid[regionCells[0]] = valueMask(1);
    grid[regionCells[1]] = valueMask(1);
    grid[regionCells[3]] = valueMask(1, 2);
    grid[regionCells[4]] = valueMask(1, 2);
  });
  enforceShardArrow(makeShardArrow(context, 3, [[3, 4]]), context);
  const { grid, regionCells } = context;

  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[3]] & valueMask(1), 0);
  assert.equal(grid[regionCells[4]] & valueMask(1), 0);
});

await runTest('ChaosConstruction forces a single flexible door from a fixed component', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells } = context;

  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1, 2);
  grid[regionCells[2]] = valueMask(1, 2);
  grid[regionCells[3]] = valueMask(2, 3);
  grid[regionCells[4]] = valueMask(1, 2, 3);

  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[1]], valueMask(1));
  assert.notEqual(grid[regionCells[2]] & valueMask(1), 0);
});

await runTest('ChaosConstruction connectivity cache tracks possible region candidates', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells, handler } = context;
  const acc = createAccumulator();

  assert.equal(handler._rebuildShards(grid, acc, handler._shards), true);
  assert.equal(handler._scanRegionCandidates(grid, handler._shards, handler._regions), true);
  const previousPossibleCount = possibleRegionCount(handler, 0);
  const previousFixedCount = fixedRegionCount(handler, 0);
  handler._connectivityDirtyRegionsMask = 0;

  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[2]] = valueMask(2, 3);

  assert.equal(handler._rebuildShards(grid, acc, handler._shards), true);
  assert.equal(handler._scanRegionCandidates(grid, handler._shards, handler._regions), true);
  assert.equal(possibleRegionCount(handler, 0), previousPossibleCount - 2);
  assert.equal(fixedRegionCount(handler, 0), previousFixedCount + 1);
  assert.notEqual(handler._connectivityDirtyRegionsMask & valueMask(1), 0);
});

await runTest('ChaosConstruction rejects duplicate fixed values in fixed regions', () => {
  const context = makeChaosContext('2x2');
  const { grid, regionCells } = context;

  grid[0] = valueMask(1);
  grid[1] = valueMask(1);
  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1);

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction rechecks connectivity on fully fixed regions', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells, handler } = context;
  const acc = createAccumulator();
  const regions = [1, 2, 1, 2, 2, 3, 1, 3, 3];
  const values = [1, 1, 2, 2, 3, 1, 3, 2, 3];

  for (let cell = 0; cell < regions.length; cell++) {
    grid[cell] = valueMask(values[cell]);
    grid[regionCells[cell]] = valueMask(regions[cell]);
  }

  assert.equal(handler._rebuildShards(grid, acc, handler._shards), true);
  assert.equal(handler._scanRegionCandidates(grid, handler._shards, handler._regions), true);
  // Even with the incremental dirty tracking cleared, a complete partition must
  // still be fully connectivity-checked before it can be accepted.
  handler._connectivityDirtyRegionsMask = 0;

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction rejects a fully fixed but disconnected grid', () => {
  // End-to-end (no internal poking): a complete grid whose region 1 is the three
  // non-adjacent cells {0, 2, 6} must be rejected as disconnected.
  const context = makeChaosContext('3x3');
  const { grid, regionCells } = context;
  const regions = [1, 2, 1, 2, 2, 3, 1, 3, 3];
  const values = [1, 1, 2, 2, 3, 1, 3, 2, 3];

  for (let cell = 0; cell < regions.length; cell++) {
    grid[cell] = valueMask(values[cell]);
    grid[regionCells[cell]] = valueMask(regions[cell]);
  }

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction does not reject completable 2x2 partial grids', () => {
  const masks = [valueMask(1), valueMask(2), valueMask(1, 2)];
  let checked = 0;
  let completable = 0;

  for (const v0 of masks) for (const v1 of masks) for (const v2 of masks) for (const v3 of masks) {
    for (const r1 of masks) for (const r2 of masks) for (const r3 of masks) {
      const context = makeChaosContext('2x2');
      const { grid, regionCells, shape } = context;
      const partialValues = [v0, v1, v2, v3];
      const partialRegions = [valueMask(1), r1, r2, r3];
      checked++;

      for (let cell = 0; cell < shape.numGridCells; cell++) {
        grid[cell] = partialValues[cell];
        grid[regionCells[cell]] = partialRegions[cell];
      }

      const result = enforce(context).result;
      const hasCompletion = partialChaosGridHasCompletion(shape, partialValues, partialRegions);
      if (hasCompletion) completable++;
      assert.equal(result || !hasCompletion, true,
        `rejected completable values=${partialValues.join(',')} regions=${partialRegions.join(',')}`);

      const fullyFixed = partialValues.every(isFixedMask) && partialRegions.every(isFixedMask);
      if (fullyFixed) {
        assert.equal(result, fullChaosGridIsValid(shape, partialValues, partialRegions),
          `full fixed mismatch values=${partialValues.join(',')} regions=${partialRegions.join(',')}`);
      }
    }
  }

  assert.equal(checked, 2187);
  assert.equal(completable > 0, true);
});

await runTest('ChaosFixedValueRegionExclusion removes fixed pair region from matching values', () => {
  const context = makeChaosContext('2x2');
  const { grid, gridCells, regionCells, regionCellOffset } = context;

  grid[0] = valueMask(1);
  grid[regionCells[0]] = valueMask(1);
  grid[1] = valueMask(1);
  grid[regionCells[1]] = valueMask(1, 2);

  const handler = new ChaosFixedValueRegionExclusion(
    0, gridCells[0], context.shape.numGridCells, regionCellOffset);
  const acc = createAccumulator();

  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[regionCells[1]], valueMask(2));
  assert.deepEqual([...acc.touched], [regionCells[1]]);
});

await runTest('ChaosFixedValueRegionExclusion removes fixed pair value from matching regions', () => {
  const context = makeChaosContext('2x2');
  const { grid, gridCells, regionCells, regionCellOffset } = context;

  grid[0] = valueMask(1);
  grid[regionCells[0]] = valueMask(1);
  grid[1] = valueMask(1, 2);
  grid[regionCells[1]] = valueMask(1);

  const handler = new ChaosFixedValueRegionExclusion(
    0, gridCells[0], context.shape.numGridCells, regionCellOffset);
  const acc = createAccumulator();

  assert.equal(handler.enforceConsistency(grid, acc), true);
  assert.equal(grid[1], valueMask(2));
  assert.deepEqual([...acc.touched], [1]);
});

await runTest('ChaosFixedValueRegionExclusion rejects duplicate fixed pairs', () => {
  const context = makeChaosContext('2x2');
  const { grid, gridCells, regionCells, regionCellOffset } = context;

  grid[0] = valueMask(1);
  grid[regionCells[0]] = valueMask(1);
  grid[1] = valueMask(1);
  grid[regionCells[1]] = valueMask(1);

  const handler = new ChaosFixedValueRegionExclusion(
    0, gridCells[0], context.shape.numGridCells, regionCellOffset);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), false);
});

await runTest('ChaosFixedValueRegionExclusion is a singleton per trigger cell', () => {
  const context = makeChaosContext('2x2');
  const { gridCells, regionCells, regionCellOffset } = context;

  const gridTriggerHandler = new ChaosFixedValueRegionExclusion(
    0, gridCells[0], context.shape.numGridCells, regionCellOffset);
  const regionTriggerHandler = new ChaosFixedValueRegionExclusion(
    0, regionCells[0], context.shape.numGridCells, regionCellOffset);

  assert.equal(ChaosFixedValueRegionExclusion.SINGLETON_HANDLER, true);
  assert.deepEqual([...gridTriggerHandler.cells], [gridCells[0]]);
  assert.deepEqual([...regionTriggerHandler.cells], [regionCells[0]]);
});

await runTest('ChaosConstruction removes duplicate fixed-value candidate labels', () => {
  const context = makeChaosContext('2x2');
  const { grid, regionCells } = context;

  grid[0] = valueMask(1);
  grid[1] = valueMask(1);
  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1, 2);

  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[1]], valueMask(2));
});

await runTest('ChaosConstruction rejects region values with no possible location', () => {
  const context = makeChaosContext('2x2');
  const { grid, regionCells } = context;

  grid[0] = valueMask(1);
  grid[1] = valueMask(1);
  grid[2] = valueMask(1);
  grid[3] = valueMask(1);
  grid[regionCells[0]] = valueMask(1);

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction forces sole region-value locations opportunistically', () => {
  const context = makeChaosContext('2x2');
  const { grid, regionCells } = context;

  grid[0] = valueMask(1, 2);
  grid[1] = valueMask(2);
  grid[2] = valueMask(2);
  grid[3] = valueMask(1, 2);
  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1, 2);
  grid[regionCells[2]] = valueMask(2);
  grid[regionCells[3]] = valueMask(2);

  assert.equal(enforce(context).result, true);
  assert.equal(grid[0], valueMask(1));
  assert.equal(grid[regionCells[1]], valueMask(1));
  assert.equal(grid[3], valueMask(1, 2));

  assert.equal(enforce(context).result, true);
  assert.equal(grid[3], valueMask(1));
});

await runTest('ChaosConstruction region shard equalizes minimum-prefix candidates', () => {
  const context = makeChaosContext('4x4', ({ grid, regionCells }) => {
    grid[2] = valueMask(2, 3);
    grid[regionCells[3]] = valueMask(2);
  });
  enforceShardArrow(makeShardArrow(context, 2, [[2, 3]]), context);
  const { grid, regionCells } = context;

  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[2]], valueMask(2));
  assert.equal(grid[regionCells[3]], valueMask(2));
});

await runTest('ChaosConstruction region shard rejects oversized shards', () => {
  const context = makeChaosContext('4x4', ({ grid }) => {
    grid[4] = valueMask(3);
  });
  enforceShardArrow(makeShardArrow(context, 4, [[4, 5, 6]]), context);
  enforceShardArrow(makeShardArrow(context, 4, [[4, 7, 8]]), context);

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction region shard rejects duplicate fixed values', () => {
  const context = makeChaosContext('4x4', ({ grid }) => {
    grid[0] = valueMask(2);
    grid[1] = valueMask(2);
  });
  enforceShardArrow(makeShardArrow(context, 0, [[0, 1]]), context);

  assert.equal(enforce(context).result, false);
});

await runTest('ChaosConstruction initializes static region links', () => {
  const context = makeChaosContext('3x3', ({ handler }) => {
    handler.addRegionLink([0, 1]);
    handler.addRegionLink([1, 4]);
  });
  const { grid, handler } = context;
  const root = regionShardParent(handler, grid, 0);

  assert.equal(regionShardParent(handler, grid, 1), root);
  assert.equal(regionShardParent(handler, grid, 4), root);
});

await runTest('ChaosConstruction merges contiguous fixed region cells into shards', () => {
  const context = makeChaosContext('3x3');
  const { grid, regionCells, handler } = context;

  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[2]] = valueMask(1, 2, 3);

  assert.equal(handler._rebuildShards(grid, createAccumulator(), handler._shards), true);
  const root = regionShardParent(handler, grid, 0);
  assert.equal(regionShardParent(handler, grid, 1), root);
  assert.notEqual(regionShardParent(handler, grid, 2), root);
  assert.equal(handler._shards.sizes[root], 2);
});

await runTest('ChaosConstruction region shard removes fixed-value duplicate labels', () => {
  const context = makeChaosContext('4x4', ({ grid, regionCells }) => {
    grid[0] = valueMask(2);
    grid[2] = valueMask(2);
    grid[regionCells[0]] = valueMask(1);
    grid[regionCells[2]] = valueMask(1, 2);
    grid[regionCells[3]] = valueMask(1, 2);
  });
  enforceShardArrow(makeShardArrow(context, 2, [[2, 3]]), context);
  const { grid, regionCells } = context;

  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[2]], valueMask(2));
  assert.equal(grid[regionCells[3]], valueMask(2));
});

await runTest('ChaosConstruction region shard removes labels without compatible capacity', () => {
  const context = makeChaosContext('4x4');
  const { grid, regionCells, handler } = context;
  const acc = createAccumulator();

  for (let cell = 0; cell < context.shape.numGridCells; cell++) {
    grid[regionCells[cell]] = valueMask(3, 4);
  }

  grid[5] = valueMask(1);
  grid[regionCells[5]] = valueMask(1, 2);

  grid[1] = valueMask(2);
  grid[4] = valueMask(3);
  grid[9] = valueMask(4);
  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[4]] = valueMask(1);
  grid[regionCells[9]] = valueMask(1);

  grid[6] = valueMask(3);
  grid[7] = valueMask(1);
  grid[11] = valueMask(4);
  grid[regionCells[6]] = valueMask(1, 2);
  grid[regionCells[7]] = valueMask(1, 2);
  grid[regionCells[11]] = valueMask(1, 2);

  grid[10] = valueMask(2);
  grid[regionCells[10]] = valueMask(2);

  enforceShardArrow(makeShardArrow(context, 6, [[6, 7, 11]]), context);
  assert.equal(handler._rebuildShards(grid, acc, handler._shards), true);
  assert.equal(handler._scanRegionCandidates(grid, handler._shards, handler._regions), true);
  handler._connectivityDirtyRegionsMask = valueMask(2);
  assert.equal(handler._enforceConnectivity(grid, acc, handler._shards, handler._regions), true);
  assert.equal(grid[regionCells[5]], valueMask(1));
  assert.equal(grid[regionCells[6]], valueMask(2));
  assert.equal(grid[regionCells[7]], valueMask(2));
  assert.equal(grid[regionCells[11]], valueMask(2));
});

await runTest('ChaosConstruction region shard persists fixed-control merges', () => {
  const context = makeChaosContext('4x4', ({ grid }) => {
    grid[0] = valueMask(1, 2);
  });
  const { shape, grid, regionCells } = context;
  const arrowHandler = makeShardArrow(context, 0, [[0, 1]]);

  enforceShardArrow(arrowHandler, context);
  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[1]], LookupTables.get(shape.numValues).allValues);

  grid[0] = valueMask(2);
  enforceShardArrow(arrowHandler, context);
  assert.equal(enforce(context).result, true);
  assert.equal(grid[regionCells[0]], grid[regionCells[1]]);
});

await runTest('ChaosArrow shard merges use supported multi-arm prefixes', () => {
  const context = makeChaosContext('4x4');
  const { grid, regionCells, handler } = context;
  const arrowHandler = makeShardArrow(context, 15, [[5, 6, 7], [5, 9, 13]]);

  grid[15] = valueMask(3);
  grid[regionCells[5]] = valueMask(2);
  grid[regionCells[6]] = valueMask(2);
  grid[regionCells[7]] = valueMask(3);
  grid[regionCells[9]] = valueMask(2);
  grid[regionCells[13]] = valueMask(3);

  enforceShardArrow(arrowHandler, context);
  assert.equal(regionShardParent(handler, grid, 5), regionShardParent(handler, grid, 6));
  assert.equal(regionShardParent(handler, grid, 5), regionShardParent(handler, grid, 9));
});

await runTest('ChaosArrow derives minimum lengths from region shards', () => {
  const context = makeChaosContext('4x4');
  const { grid, handler } = context;
  const arrowHandler = makeShardArrow(context, 0, [[0, 1, 2], [0, 4]]);

  handler.regionShardState().merge(grid, 0, 1);

  assert.equal(arrowHandler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[0], valueMask(2, 3, 4));
});

await runTest('ChaosArrow drops origin-only arms from runtime support', () => {
  const context = makeChaosContext('4x4');
  const handler = makeShardArrow(context, 0, [[0], [0, 1], [0]]);

  assert.equal(handler._regionArms.length, 1);
  assert.equal(handler._duplicateStartCount, 0);
  assert.equal(handler._regionRunArms.length, 1);
});

await runTest('ChaosArrow allows origin-only directions', () => {
  const context = makeChaosContext('4x4');
  const { grid, regionCells } = context;
  const handler = makeShardArrow(context, 0, [[0, 1, 2, 3], [0, 4, 5, 6]]);

  grid[0] = valueMask(4);
  grid[regionCells[0]] = valueMask(1);
  for (const cell of [regionCells[4], regionCells[5], regionCells[6]]) {
    grid[cell] = valueMask(2);
  }

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[0], valueMask(4));
});

await runTest('ChaosArrow prunes unsupported total counts', () => {
  const context = makeChaosContext('4x4');
  const { grid } = context;
  const handler = makeShardArrow(context, 0, [[0, 1], [0, 4]]);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  // Corner start 0 is enclosed by its two arms (to 1 and 4), so its same-region
  // neighbour is on an arm and the run length is >= 2: length 1 is ruled out.
  assert.equal(grid[0], valueMask(2, 3));
});

await runTest('ChaosArrow keeps length 1 when the start is not enclosed', () => {
  // Start 5 (interior) has four neighbours but only two arms (up to 1, left to 4),
  // so its same-region neighbour may be off-arm — length 1 stays possible.
  const context = makeChaosContext('4x4');
  const { grid } = context;
  const handler = makeShardArrow(context, 0, [[5, 1], [5, 4]]);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.notEqual(grid[0] & valueMask(1), 0);
});

await runTest('ChaosArrow maps the control value through the shape value offset', () => {
  // On a 0-8 style grid (valueOffset -1) the control's displayed run length is
  // one less than its stored value, so a run of 3 fixes the control to value 4.
  const context = makeChaosContext('4x4~0-3');
  assert.equal(context.shape.valueOffset, -1);
  const { grid, regionCells } = context;
  const handler = makeShardArrow(context, 0, [[0, 1, 2, 3]]);

  grid[regionCells[0]] = valueMask(1);
  grid[regionCells[1]] = valueMask(1);
  grid[regionCells[2]] = valueMask(1);
  grid[regionCells[3]] = valueMask(2);

  assert.equal(handler.enforceConsistency(grid, createAccumulator()), true);
  assert.equal(grid[0], valueMask(4));
});

logSuiteComplete('chaos_construction.test.js');
