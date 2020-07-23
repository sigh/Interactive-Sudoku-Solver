const addBinaryConstraint = (solver, id, cell1, cell2, fn) => {
  let value = new Map();
  let set1 = [];
  let set2 = [];
  for (let i = 1; i < 10; i++) {
    set1.push(`${cell1}#${i}`);
    set2.push(`${cell2}#${i}`);
    value.set(`${cell1}#${i}`, i);
    value.set(`${cell2}#${i}`, i);
  }
  let constraintFn = (a, b) => fn(value.get(a), value.get(b));
  solver.addBinaryConstraint(id, set1, set2, constraintFn);
}

const testBinaryConstraints = () => {
  let solver = SudokuSolver._makeBaseSudokuConstraints();
  addBinaryConstraint(solver, 'test', 'R1C1', 'R1C2', (a, b) => a > b);
  addBinaryConstraint(solver, 'test', 'R1C2', 'R1C3', (a, b) => a > b);
  solver._enforceArcConsistency(null, solver._allBinaryConstraintColumns());

  grid.setSolution(solver.remainingRows());
  return solver;
}

const testSelection = () => {
  grid.setSelectionCallback((selection) => {
    let solver = SudokuSolver._makeBaseSudokuConstraints();

    for (let i = 1; i < selection.length; i++) {
      addBinaryConstraint(
        solver, 'thermo-'+i, selection[i-1], selection[i], (a, b) => a < b);
    }

    solver._enforceArcConsistency(null, solver._allBinaryConstraintColumns());
    grid.setSolution(solver.remainingRows());
  });
}

// The thermo in https://www.youtube.com/watch?v=ySPrdlfPHZs
// Causes a long search when partially filled in.
