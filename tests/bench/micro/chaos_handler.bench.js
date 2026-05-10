import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { bench, benchGroup, runIfMain } from '../bench_harness.js';

ensureGlobalEnvironment();

const { GridShape } = await import('../../../js/grid_shape.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../../js/solver/lookup_tables.js' + self.VERSION_PARAM);
const { ChaosConstruction } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

let sink = 0;

const accumulator = {
  addForCell(cell) { sink ^= cell; },
};

const valueMask = (...values) => LookupTables.fromValuesArray(values);

const makeContext = () => {
  const shape = GridShape.fromGridSpec('6x6');
  const constraint = new SudokuConstraint.ChaosConstruction();
  shape.addVarCellsForConstraints([constraint]);

  const allValues = LookupTables.get(shape.numValues).allValues;
  const grid = new Uint16Array(shape.totalCells() + shape.numGridCells + 8);
  grid.fill(allValues, 0, shape.totalCells());
  let nextStateOffset = shape.totalCells();
  const stateAllocator = {
    allocate(state) {
      const offset = nextStateOffset;
      for (let i = 0; i < state.length; i++) {
        grid[offset + i] = state[i];
      }
      nextStateOffset += state.length;
      return offset;
    },
  };

  const regionCells = shape.varCellsForGroup('CC');
  const handler = new ChaosConstruction(shape.numGridCells, regionCells[0]);
  handler.selectPriorityAnchorCells(shape, new Int32Array(shape.totalCells()));
  if (!handler.initialize(grid, null, shape, stateAllocator)) {
    throw new Error('ChaosConstruction benchmark context failed to initialize');
  }

  return { shape, grid, regionCells, handler };
};

const makeBlankSteadyContext = () => {
  const context = makeContext();
  if (!context.handler.enforceConsistency(context.grid, accumulator)) {
    throw new Error('ChaosConstruction blank benchmark state is invalid');
  }
  return context;
};

const makeSolvedContext = () => {
  const context = makeContext();
  const { grid, regionCells } = context;
  const solution = '345126634512213654526431451263162345';

  for (let cell = 0; cell < 36; cell++) {
    const row = cell / 6 | 0;
    grid[cell] = valueMask(+solution[cell]);
    grid[regionCells[cell]] = valueMask(row < 2 ? row + 1 : row === 5 ? 3 : row + 2);
  }
  if (!context.handler.enforceConsistency(grid, accumulator)) {
    throw new Error('ChaosConstruction solved benchmark state is invalid');
  }
  return context;
};

const makeMutatingContext = () => {
  const context = makeContext();
  const { grid, regionCells } = context;

  for (let cell = 0; cell < 6; cell++) {
    grid[regionCells[cell]] = valueMask(1);
  }
  grid[0] = valueMask(1);
  grid[1] = valueMask(1, 2, 3, 4, 5, 6);

  return {
    handler: context.handler,
    baseGrid: grid.slice(),
    workGrid: new Uint16Array(grid.length),
  };
};

const blankSteady = makeBlankSteadyContext();
const solved = makeSolvedContext();
const mutating = makeMutatingContext();

benchGroup('micro::chaos_handler', () => {
  bench('6x6 blank steady propagation', () => {
    if (!blankSteady.handler.enforceConsistency(blankSteady.grid, accumulator)) {
      throw new Error('blank steady propagation failed');
    }
    sink ^= blankSteady.grid[36];
  }, { innerIterations: 50_000, minSampleTimeMs: 25 });

  bench('6x6 solved validation propagation', () => {
    if (!solved.handler.enforceConsistency(solved.grid, accumulator)) {
      throw new Error('solved validation propagation failed');
    }
    sink ^= solved.grid[0];
  }, { innerIterations: 50_000, minSampleTimeMs: 25 });

  bench('6x6 region-full mutating propagation', () => {
    mutating.workGrid.set(mutating.baseGrid);
    if (!mutating.handler.enforceConsistency(mutating.workGrid, accumulator)) {
      throw new Error('region-full mutating propagation failed');
    }
    sink ^= mutating.workGrid[42];
  }, { innerIterations: 25_000, minSampleTimeMs: 25 });
});

export const _benchSink = () => sink;
await runIfMain(import.meta.url);
