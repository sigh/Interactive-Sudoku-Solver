import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../../helpers/test_runner.js';
import { createCellExclusions } from '../../helpers/grid_test_utils.js';

ensureGlobalEnvironment();

const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js');
const { FullRank } = await import('../../../js/solver/handlers.js');
const { Sum } = await import('../../../js/solver/sum_handler.js');
const { CellGeometry } = await import('../../../js/cell_geometry.js');
const { HandlerSet } = await import('../../../js/solver/engine.js');

await runTest('FullRank equalities share exclusions before sum optimization caches them', () => {
  const geometry = CellGeometry.fromGridSize(4);
  const exclusions = createCellExclusions({
    numCells: geometry.totalCells(), allUnique: false,
  });
  exclusions.addMutualExclusion(7, 11);

  // Tying R1 forward with R2 reversed implies cell 0 equals cell 7.
  // Cell 0 must therefore inherit cell 7's exclusion of cell 11.
  const handlers = new HandlerSet([
    new FullRank(16, [{ rank: 1, line: [0, 1] }], FullRank.TIE_MODE.ANY),
    new FullRank(16, [{ rank: 1, line: [7, 6] }], FullRank.TIE_MODE.ANY),
    new Sum([0, 1], 3),
  ], geometry.totalCells());

  const optimizer = new SudokuConstraintOptimizer({ enableLogs: false });
  optimizer.optimize(handlers, exclusions, geometry);

  assert.equal(exclusions.isMutuallyExclusive(0, 11), true);
  assert.ok(exclusions.getArray(0).includes(11));
});

logSuiteComplete('FullRank optimizer');
