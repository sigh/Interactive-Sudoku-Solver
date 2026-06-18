import assert from 'node:assert/strict';

import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { GridTestContext } from '../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { CandidateSelector, ConflictScores } = await import('../../js/solver/candidate_selector.js');
const { SudokuConstraint } = await import('../../js/sudoku_constraint.js');
const { ChaosConstruction } = await import('../../js/solver/chaos_handler.js');

const makeDebugLogger = () => ({
  enableStepLogs: false,
  enableLogs: false,
  log: () => { },
});

const makeSelector = (context, { handlerSet = [] } = {}) => {
  const { shape } = context;
  const numSearchCells = shape.totalCells();
  const selector = new CandidateSelector(
    shape,
    numSearchCells,
    handlerSet,
    makeDebugLogger(),
  );

  const conflictScores = new ConflictScores(new Array(numSearchCells).fill(0), shape.numValues);
  selector.reset(conflictScores);
  return { selector, conflictScores };
};

// selectNextCandidate writes its result to reused fields (no per-node allocation);
// adapt that to the [nextDepth, value, count] tuple these tests assert on.
const select = (selector, cellDepth, gridState, stepState, isNewNode) => {
  const { nextDepth, value, count } =
    selector.selectNextCandidate(cellDepth, gridState, stepState, isNewNode);
  return [nextDepth, value, count];
};

await runTest('CandidateSelector moves all singletons to the front when next cell is a singleton', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const { selector } = makeSelector(context);

  const gridState = context.createGrid({ fill: allValues });

  // Ensure the next cell is a singleton and there are other singletons later.
  gridState[0] = 1 << 0;
  gridState[3] = 1 << 1;
  gridState[7] = 1 << 2;

  const [nextDepth, value, count] = select(
    selector,
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
    );

  assert.equal(count, 1);
  assert.equal(value, 1 << 0);
  assert.equal(nextDepth, 3);

  const cellOrder = selector.getCellOrder();
  const prefixCells = Array.from(cellOrder.subarray(0, nextDepth));
  assert.deepEqual(prefixCells, [0, 3, 7]);

  for (let i = 0; i < nextDepth; i++) {
    const v = gridState[cellOrder[i]];
    assert.ok(v && ((v & (v - 1)) === 0), `Expected singleton at depth ${i}`);
  }
  for (let i = nextDepth; i < shape.numGridCells; i++) {
    const v = gridState[cellOrder[i]];
    assert.ok((v & (v - 1)) !== 0, `Expected non-singleton at depth ${i}`);
  }
});

await runTest('CandidateSelector signals a wipeout (count 0) when a 0 exists while bubbling singletons', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;

  const { selector } = makeSelector(context);

  const gridState = context.createGrid({ fill: allValues });

  // Make the next cell a singleton so that _updateCellOrder scans for other
  // singletons and detects wipeouts.
  gridState[0] = 1 << 0;
  gridState[5] = 0;

  const [nextDepth, value, count] = select(
    selector,
    /* cellDepth */ 0,
    gridState,
    /* stepState */ null,
    /* isNewNode */ true,
    );

  assert.equal(nextDepth, 0);
  assert.equal(value, 0);
  assert.equal(count, 0);
});

await runTest('CandidateSelector consumes custom candidate state across backtracks (count reflects remaining custom options)', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;
  const nominatedValue = 1 << 0;

  const finder = {
    cells: [2, 5, 7],
    maybeFindCandidate: (grid, conflictScores, result) => {
      result.score = 1e9;
      result.value = nominatedValue;
      result.cells.length = 0;
      result.cells.push(2, 5, 7);
      return true;
    },
  };

  const handler = {
    candidateFinders: () => [finder],
    linkedSearchCells: () => [],
  };

  const { selector, conflictScores } = makeSelector(context, { handlerSet: [handler] });

  // Make default selection eligible for custom candidates: best cell has count>2 and cs>0.
  // Ensure minCS is beaten by at least one finder cell.
  conflictScores.scores[0] = 100;
  conflictScores.scores[2] = 60;
  conflictScores.scores[5] = 70;
  conflictScores.scores[7] = 80;

  const gridState = context.createGrid({ fill: allValues });

  // First visit: custom candidate state should be created and the highest
  // conflict-score cell (7) should be popped first.
  {
    const [nextDepth, value, count] = select(selector, 0, gridState, null, true);
    assert.equal(nextDepth, 1);
    assert.equal(value, nominatedValue);
    assert.equal(count, 3);
    assert.equal(selector.getCellAtDepth(0), 7);
  }

  // Backtrack: should continue consuming the custom state (count=2), popping 5 next.
  {
    const [nextDepth, value, count] = select(selector, 0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(value, nominatedValue);
    assert.equal(count, 2);
    assert.equal(selector.getCellAtDepth(0), 5);
  }

  // Backtrack again: last custom option (count=1), popping 2.
  {
    const [nextDepth, value, count] = select(selector, 0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(value, nominatedValue);
    assert.equal(count, 1);
    assert.equal(selector.getCellAtDepth(0), 2);
  }

  // After exhaustion: should fall back to default selection (count=domain size).
  {
    const [nextDepth, value, count] = select(selector, 0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(0), 0);
    assert.equal(value, 1 << 0);
  }
});

await runTest('CandidateSelector stepState override clears any pending custom-candidate state', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  const allValues = context.lookupTables.allValues;
  const nominatedValue = 1 << 0;

  const finder = {
    cells: [2, 5, 7],
    maybeFindCandidate: (grid, conflictScores, result) => {
      result.score = 1e9;
      result.value = nominatedValue;
      result.cells.length = 0;
      result.cells.push(2, 5, 7);
      return true;
    },
  };

  const handler = {
    candidateFinders: () => [finder],
    linkedSearchCells: () => [],
  };

  const { selector, conflictScores } = makeSelector(context, { handlerSet: [handler] });

  conflictScores.scores[0] = 100;
  conflictScores.scores[2] = 60;
  conflictScores.scores[5] = 70;
  conflictScores.scores[7] = 80;

  const gridState = context.createGrid({ fill: allValues });

  // First call seeds the custom candidate state.
  {
    const [, , count] = select(selector, 0, gridState, null, true);
    assert.equal(count, 3);
  }

  // Second call would normally be custom (count=2), but we override with a guided cell.
  const guidedCell = 1;
  const stepState = {
    step: 0,
    stepGuides: new Map([[0, { cell: guidedCell, depth: 0 }]]),
  };

  {
    const [nextDepth, , count] = select(selector, 0, gridState, stepState, false);
    assert.equal(nextDepth, 1);
    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(0), guidedCell);
  }

  // Third call: custom state should have been cleared by the adjustment, so we should
  // see default selection behavior (count=4, best cell=0).
  {
    const [nextDepth, value, count] = select(selector, 0, gridState, null, false);
    assert.equal(nextDepth, 1);
    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(0), 0);
    assert.equal(value, 1 << 0);
  }
});

await runTest('CandidateSelector boosts linked chaos cells whose counterpart is fixed', () => {
  const context = new GridTestContext({ gridSize: 4 });
  const { shape } = context;
  shape.addVarCellsForConstraints([new SudokuConstraint.ChaosConstruction()]);
  const regionCells = shape.varCellsForGroup('CC');
  const handlerSet = [new ChaosConstruction(shape.numGridCells, regionCells[0])];
  const allValues = context.lookupTables.allValues;

  {
    const { selector, conflictScores } = makeSelector(context, { handlerSet });
    conflictScores.scores[0] = 1;

    const gridState = new Array(shape.totalCells()).fill(allValues);
    gridState[1] = (1 << 0) | (1 << 1);
    gridState[regionCells[0]] = 1 << 0;

    const [nextDepth, , fixedCount] = select(selector, 0, gridState, null, true);
    assert.equal(fixedCount, 1);
    assert.equal(nextDepth, 1);
    assert.equal(selector.getCellAtDepth(0), regionCells[0]);

    const [, , count] = select(selector, nextDepth, gridState, null, true);

    assert.equal(count, 4);
    assert.equal(selector.getCellAtDepth(nextDepth), 0);
  }

  {
    const { selector, conflictScores } = makeSelector(context, { handlerSet });
    conflictScores.scores[regionCells[0]] = 1;

    const gridState = new Array(shape.totalCells()).fill(allValues);
    gridState[0] = 1 << 0;
    gridState[1] = (1 << 0) | (1 << 1);

    const [nextDepth, , fixedCount] = select(selector, 0, gridState, null, true);
    assert.equal(fixedCount, 1);
    assert.equal(nextDepth, 1);
    assert.equal(selector.getCellAtDepth(0), 0);

    const [, , regionCount] = select(selector, nextDepth, gridState, null, true);
    assert.equal(regionCount, 4);
    assert.equal(selector.getCellAtDepth(nextDepth), regionCells[0]);
  }
});

logSuiteComplete('CandidateSelector invariants');
