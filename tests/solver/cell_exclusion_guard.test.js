import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { guardListExclusions } from '../helpers/cell_exclusion_guard.js';

ensureGlobalEnvironment();
const { CellExclusions } = await import('../../js/solver/engine.js');

class GuardedCellExclusions extends CellExclusions {}
GuardedCellExclusions.prototype.getListExclusions = guardListExclusions(
  CellExclusions.prototype.getListExclusions);

await runTest('cell exclusion guard preserves cached results for unchanged lists', () => {
  const exclusions = new GuardedCellExclusions([], 4);
  exclusions.addMutualExclusion(0, 2);
  exclusions.addMutualExclusion(1, 2);
  for (const cells of [[0, 1], new Uint16Array([0, 1])]) {
    const result = exclusions.getListExclusions(cells);
    assert.deepEqual([...result], [2]);
    assert.equal(exclusions.getListExclusions(cells), result);
  }
});

await runTest('cell exclusion guard rejects changed array and typed-array entries', () => {
  for (const cells of [[0, 1], new Uint16Array([0, 1])]) {
    const exclusions = new GuardedCellExclusions([], 4);
    const result = exclusions.getListExclusions(cells);
    cells[1] = 2;
    assert.throws(() => exclusions.getListExclusions(cells), /changed at index 1/);
    cells[1] = 1;
    assert.equal(exclusions.getListExclusions(cells), result);
  }
});

await runTest('cell exclusion guard rejects a changed list length', () => {
  const exclusions = new GuardedCellExclusions([], 4);
  const cells = [0, 1];
  exclusions.getListExclusions(cells);
  cells.push(2);
  assert.throws(() => exclusions.getListExclusions(cells), /changed length/);
});

await runTest('cell exclusion guard allows distinct lists with different contents', () => {
  const exclusions = new GuardedCellExclusions([], 4);
  exclusions.getListExclusions(new Uint16Array([0, 1]));
  assert.doesNotThrow(() => exclusions.getListExclusions(new Uint16Array([0, 2])));
});

await runTest('cell exclusion guard tracks each cache instance separately', () => {
  const first = new GuardedCellExclusions([], 4);
  const second = new GuardedCellExclusions([], 4);
  const cells = new Uint16Array([0, 1]);
  first.getListExclusions(cells);
  cells[1] = 2;
  assert.doesNotThrow(() => second.getListExclusions(cells));
  assert.throws(() => first.getListExclusions(cells), /changed at index 1/);
});

logSuiteComplete('Cell exclusion cache guard');
