import assert from 'node:assert/strict';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';
import { runTest, logSuiteComplete } from '../helpers/test_runner.js';

ensureGlobalEnvironment();

const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const { SudokuConstraint: C } = await import('../../js/sudoku_constraint.js');

// Enumerate assignments directly, without asking the solver which are valid.
const assignments = [];
for (let code = 0; code < 3 ** 9; code++) {
  let remaining = code;
  const values = Array.from({ length: 9 }, () => {
    const value = remaining % 3 + 1;
    remaining = Math.floor(remaining / 3);
    return value;
  });
  const groups = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)];
  const signature = group => group.slice().sort().join(',');
  if (!groups.every(group => signature(group) === signature(groups[0]))) continue;
  const distinct = groups.reduce((mask, group, i) =>
    mask | (new Set(group).size === 3 ? 1 << i : 0), 0);
  assignments.push({ values, distinct });
}
assert.equal(assignments.length, 381);

for (const offset of [0, -1]) {
  for (let distinctGroups = 0; distinctGroups < 8; distinctGroups++) {
    await runTest(`SameValues exact solutions and supports, distinct groups ${distinctGroups}, offset ${offset}`, () => {
      const variables = new C.Var('A', '', 9);
      const cells = variables.cells();
      const fixedGrid = Array.from({ length: 9 }, (_, i) =>
        1 + ((i / 3 | 0) + i % 3) % 3 + offset);
      const constraint = new C.Container([
        new C.Shape('3x3', offset ? '0-2' : undefined), variables,
        ...fixedGrid.map((v, i) => new C.Given(`R${1 + (i / 3 | 0)}C${1 + i % 3}`, v)),
        ...[0, 1, 2].filter(i => distinctGroups & (1 << i))
          .map(i => new C.AllDifferent(...cells.slice(i * 3, i * 3 + 3))),
        new C.SameValues(3, ...cells),
      ]);
      const solutions = assignments.filter(a =>
        (a.distinct & distinctGroups) === distinctGroups)
        .map(a => [...fixedGrid, ...a.values.map(v => v + offset)]);
      const expected = new Set(solutions.map(g => g.join(',')));
      assert.equal(expected.size, distinctGroups ? 216 : 381);
      const solver = SudokuBuilder.build(constraint);
      const actual = new Set();
      for (let i = 0; ; i++) {
        const solution = solver.nthSolution(i);
        if (!solution) break;
        const key = solution.join(',');
        assert.ok(expected.has(key), 'every returned assignment satisfies the multiset rule');
        assert.ok(!actual.has(key), 'enumeration must not repeat solutions');
        actual.add(key);
      }
      assert.deepEqual(actual, expected);
      assert.equal(solver.countSolutions(), expected.size, 'counting resets the enumerated solver');
      solver.setProgressCallback(extra => {
        for (const solution of extra?.solutions ?? []) {
          assert.ok(expected.has(solution.join(',')), 'progress witnesses satisfy the same rule');
        }
      }, 4);
      for (const threshold of [1, 2, 3, 255]) {
        const counts = new Uint8Array(18 * 3);
        for (const solution of solutions) {
          solution.forEach((v, cell) => {
            const index = cell * 3 + v - offset - 1;
            if (counts[index] < threshold) counts[index]++;
          });
        }
        assert.deepEqual(solver.solveAllPossibilities(threshold), counts,
          `complete candidate counts at support threshold ${threshold}`);
      }
    });
  }
}

logSuiteComplete('same_values.test.js');
