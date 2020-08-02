const ITERATION_LIMIT = 10000000;

class Node {
  constructor() {
    this.left = this;
    this.right = this;
    this.up = this;
    this.down = this;
    this.column = null;
    this.row = null;
    this.value = 1;
    this.index = 0;
  }

  removeFromRow() {
    this.left.right = this.right;
    this.right.left = this.left;
    if (this.column) {
      this.column.count--;
      this.column.hitSet -= this.value;
    }
  }

  restoreToRow() {
    this.left.right = this;
    this.right.left = this;
    if (this.column) {
      this.column.count++;
      this.column.hitSet += this.value;
    }
  }

  removeFromColumn() {
    this.up.down = this.down;
    this.down.up = this.up;
    this.column.count--;
    this.column.hitSet -= this.value;
  }

  restoreToColumn() {
    this.up.down = this;
    this.down.up = this;
    this.column.count++;
    this.column.hitSet += this.value;
  }

  appendToColumn(column) {
    this.up = column.up;
    this.down = column;
    column.up.down = this;
    column.up = this;
    this.column = column;

    this.index = this.column.count;
    this.column.count++;
  }

  appendToRow(row) {
    this.left = row.left;
    this.right = row;
    row.left.right = this;
    row.left = this;
    this.row = row;
  }
}

class Column extends Node {
  constructor(id, type) {
    super();
    this.id = id;
    this.count = 0;
    this.type = type || Column.NORMAL;
    this.extraConstraints = [];
    this.hitSet = 0;
    this.removed = false;
    this.weight = 0;
  }

  remove() {
    this.removed = true;
    this.removeFromRow();
  }

  restore() {
    this.removed = false;
    this.restoreToRow();
  }

  forEach(fn) {
    for (let node = this.down; node != this; node = node.down) {
      fn(node);
    }
  }
  forEachRev(fn) {
    for (let node = this.up; node != this; node = node.up) {
      fn(node);
    }
  }

  rowIds() {
    let rowIds = [];
    this.forEach(e => rowIds.push(e.row.id));
    return rowIds;
  }
}
Column.NORMAL = 0;
Column.VARIABLE = 1;

const DUMMY_COLUMN = new Column();

class Row extends Node {
  constructor(id) {
    super();
    this.id = id;
    this.weight = 1;
  }

  remove() {
    this.removeFromColumn();
  }

  restore() {
    this.restoreToColumn();
  }

  forEach(fn) {
    for (let node = this.right; node != this; node = node.right) {
      fn(node);
    }
  }
  forEachRev(fn) {
    for (let node = this.left; node != this; node = node.left) {
      fn(node);
    }
  }
}

class Matrix extends Node {
  constructor(rowIds) {
    super();

    this.value = 0;

    // Set the rows.
    this.rowMap = new Map();
    for (const rowId of rowIds) {
      let row = new Row(rowId);
      this.rowMap.set(rowId, row);
      row.appendToColumn(this);
    }

    this.columnMap = new Map();
  }

  appendColumn(columnId, rowIds) {
    if (this.columnMap.get(columnId)) {
      throw(`Column with id ${columnId} already exists`);
    }

    let column = new Column(columnId);
    for (const rowId of rowIds) {
      let row = this.rowMap.get(rowId);
      let node = new Node();
      node.appendToColumn(column);
      node.appendToRow(row);
    }

    column.appendToRow(this);
    this.columnMap.set(columnId, column);
    return column;
  }

  hasColumns() {
    return this.left != this;
  }

  show() {
    let result = {};
    for (let row = this.down; row != this; row = row.down) {
      let columns = [];
      result[row.id] = columns;
      row.forEach((node) => columns.push(node.column.id));
    }
    return result;
  }
}

class ColumnAccumulator {
  constructor() {
    this._variableColumns = [];
    this.sawContradiction = false;
    this._extraConstraints = [];
  }

  add(column) {
    if (column.count == 0) {
      this.sawContradition = true;
    }
    if (this.sawContradiction) return;

    for (let i = 0; i < column.extraConstraints.length; i++) {
      this._extraConstraints.push(column.extraConstraints[i]);
    }
  }

  hasExtraConstraints() {
    return !this.sawContradition && this._extraConstraints.length > 0;
  }

  popExtraConstraint() {
    if (this.sawContradition) return null;
    return this._extraConstraints.pop();
  }
}

class ConstraintSolver {
  constructor(constraints, values, weights) {
    this.matrix = new Matrix(values);
    if (weights) this._setWeights(weights);
    this._sumConstraints = [];

    constraints.forEach(c => c.apply(this));

    this._arcInconsistencyMap = new Map();
    this.stack = [];
    this._done = false;
    this._initCounters();
    this._initTimer();
  }

  _initCounters() {
    this._counters = {
      nodesSearched: 0,
      columnsSearched: 0,
      guesses: 0,
      solutions: 0,
    };
  }

  _initTimer() {
    this._timeMs = 0;
    this._startOfCurrentTimer = null;
  }

  _startTimer() {
    this._startOfCurrentTimer = performance.now();
  }

  _stopTimer() {
    this._timeMs += performance.now() - this._startOfCurrentTimer;
    this._startOfCurrentTimer = null;
  }

  _setWeights(weightMap) {
    let rowMap = this.matrix.rowMap;
    for (const [rowId, weight] of weightMap) {
      rowMap.get(rowId).weight = weight;
    }
  }

  show() {
    return this.matrix.show();
  }

  // _removeCandidateRow removes the row and updates all the constraints.
  //   - Removes conflicting exact cover constraints using alogithms x.
  //   - Enforces arc consistency on binary constraints.
  //
  // Returns true if the remaining matrix is still consistent (assuming the
  // initial matrix was consistent).
  _removeCandidateRow(row) {
    let updatedColumns = new ColumnAccumulator();
    row.remove();
    row.forEach((rowNode) => {
      rowNode.removeFromColumn();
      this._removeSatisfiedColumn(rowNode.column, updatedColumns);
      rowNode.restoreToColumn();
      rowNode.column.weight += row.weight;
      // Important, the column should be added when it's in its final state.
      // In particular, after any restores have happened.
      updatedColumns.add(rowNode.column);
    });
    this._enforceArcConsistency(row, updatedColumns);
    return !updatedColumns.sawContradiction;
  }

  _removeSatisfiedColumn(column, updatedColumns) {
    column.remove();
    column.forEach((node) => {
      node.removeFromRow();
      this._removeInvalidRow(node.row, updatedColumns);
    });
  }

  _removeInvalidRow(row, updatedColumns) {
    row.remove();
    row.forEach((rowNode) => {
      rowNode.removeFromColumn();
      updatedColumns.add(rowNode.column);
    });
  }

  // To restore we need to do everything in exactly the reverse order.
  _restoreCandidateRow(row) {
    this._revertArcConsistency(row);
    row.forEachRev((rowNode) => {
      rowNode.column.weight -= row.weight;
      rowNode.removeFromColumn();
      this._restoreSatisfiedColumn(rowNode.column);
      rowNode.restoreToColumn();
    });
    row.restore();
  }

  _restoreSatisfiedColumn(column) {
    column.forEachRev((node) => {
      this._restoreInvalidRow(node.row);
      node.restoreToRow();
    });
    column.restore();
  }

  _restoreInvalidRow(row) {
    row.forEachRev((rowNode) => rowNode.restoreToColumn());
    row.restore();
  }

  _findMinColumn() {
    let matrix = this.matrix;
    let minCol = null;
    let minCount = Infinity;

    for (let col = matrix.right; col != matrix; col = col.right) {
      if (col.count < minCount) {
        // If the value is zero, we'll never go lower.
        if (col.count == 0) return col;

        minCol = col;
        minCount = col.count;
      }
    }

    // If column with a unique value, then go with that. Otherwise check if
    // proceed with the more expensive checks.
    if (minCount == 1) return minCol;

    for (const c of this._sumConstraints) {
      let sum = 0;
      let options = 0;  // Remaining options.
      let count = 0;  // Remaining squares.
      for (const cc of c.columns) {
        if (cc.count != 1) {
          count += 1;
          options += cc.count;
        }
      }
      if (!count) continue;  // This constraint is already satisfied.
      // To prioritize sum squares, we want a number which is comparable to
      // the count of an unconstrained variable.
      // Let:
      //   countEff = The number we want to calculate.
      //   options = The number of possible remaining values. i.e. sum of counts
      //             of unfixed variables in the sum.
      //   numVar = The number of remaining unfixed variables.
      // Then the average number of options per variable is:
      //   optionsAv = options/numVar
      // If we fix (numVar - 1) variables, then the last variable is forced.
      // Thus, ignoring the target sum, the approximate number permutations of
      // values is:
      //   permAv = optionsAv**(numVar-1)
      // We want to compare this to the case where there is no sum, and all
      // variables are free. Thus the effective number of options per
      // variable is:
      //  optionsAvEff = permAv**(1/numVar) = optionsAv**((numVar-1)/numVar)
      // Approximating with (e**x ~= 1+x):
      //  optionsAvEff ~= 1 + log(optionsAv)*(numVar-1)/numVar
      // Approximating with (log(1+x) ~= x):
      //  optionsAvEff ~= 1 + (optionsAv-1)*(numVar-1)/numVar
      // Using this value as the effective count:
      //  countEff = 1 + (options/numVar - 1)*(numVar-1)/numVar;
      //
      //  We can verify that this has several desirable properties:
      //   - When numVar = 1, countEff = 1. i.e. The square is forced.
      //   - When numVar = 2, countEff ~= optionsAv/2. i.e. Half the count of
      //     2 free squares.
      //   - countEff is always lower than optionsAv.
      //
      // Note: At the momemnt, the calculation is already expensive enough that
      // the approximation is not warrented. We may also be able to do better
      // if we consider entropy per variable.
      let countEff = 1 + (count - 1)*(options/count-1)/count;
      if (countEff > minCount) continue;

      let minOptions = Infinity;
      for (const cc of c.columns) {
        if (cc.count != 1 && cc.count < minOptions) {
          minCol = cc;
          minOptions = cc.count;
        }
      }
      minCount = countEff;
      // TODO: Uncomment to return early (because we know there are no zeros).
      // if (countEff == 1) return minCol;
    }

    return minCol;
  }

  solve() {
    let solutions = [];

    this._initTimer();
    this._startTimer();
    this._solve(
      2, () => solutions.push(ConstraintSolver._stackToSolution(this.stack)));
    this._stopTimer();

    let solution = solutions[0] || [];
    return {
      values: solution,
      counters: this._getCounters(),
      timeMs: this._timeMs,
      solutionsSeen: solutions,
      done: solutions.length < 2,
    }
  }

  static _stackToSolution(stack) {
    return stack.map(e => e.row.id);
  }

  // Solve until maxSolutions are found, and returns leaving the stack
  // fully unwound.
  _solve(maxSolutions, solutionFn) {
    let result = this._runSolver(maxSolutions, ITERATION_LIMIT, solutionFn);
    if (!result) {
      throw(`Reached iteration limit of ${ITERATION_LIMIT} without completing`);
    }

    this._unwindStack();

    return result;
  }

  state() {
    // Run solver for 0 steps to initiate if not already.
    this._runSolver(0, 0, () => {});
    return this._state();
  }

  _getCounters() {
    let counters = {...this._counters};
    counters.backtracks = counters.nodesSearched - counters.columnsSearched;
    return counters;
  }

  _state() {
    let partialSolution = ConstraintSolver._stackToSolution(this.stack);
    if (partialSolution[partialSolution.length-1] === undefined) {
      partialSolution.pop();
    }
    return {
      values: partialSolution,
      remainingOptions: this.remainingRows(),
      step: this._counters.nodesSearched,
      counters: this._getCounters(),
      timeMs: this._timeMs,
      done: this._done,
    }
  }

  step(n) {
    this._startTimer();
    this._runSolver(0, n, () => {});
    this._stopTimer();
    return this._state();
  }

  reset() {
    this._unwindStack();
    this._initCounters();
    this._initTimer();
    return this.state();
  }

  // _runSolver runs the solver until either maxSolutions are found, or
  // maxIterations steps have passed.
  // Returns true if the solver completed successfully without reaching
  // maxIterations.
  _runSolver(maxSolutions, maxIterations, solutionFn) {
    let stack = this.stack;

    // Initialize if the stack is empty.
    if (stack.length == 0) {
      let minColumn = this._findMinColumn();
      // If there are no columns, then there is 1 solution - the trival one.
      if (!minColumn) {
        this._addSolution();
        this._counters.solutions++;
        return true;
      }
      this.stack.push(minColumn);
    }

    let numNodesSearched = 0;
    let numColumnsSearched = 0;
    let numSolutions = 0;
    let numGuesses = 0;

    while (stack.length && numNodesSearched < maxIterations) {
      let node = stack.pop();

      // If the node is not a column header then we are backtracking, so
      // restore the state.
      if (node.column != null) {
        this._restoreCandidateRow(node.row);
      } else {
        if (node.count > 0) numColumnsSearched++;
      }
      // Try the next node in the column.
      node = node.down;

      // If we have tried all the nodes, then backtrack.
      if (node.column == null) continue;

      stack.push(node);
      numNodesSearched++;
      // If there was more than one node to choose from, then this was a guess.
      if (node.down.column != null) numGuesses++;

      if (!this._removeCandidateRow(node.row)) continue;

      let column = this._findMinColumn();
      if (!column) {
        solutionFn();
        numSolutions++;
        if (numSolutions == maxSolutions) {
          break;
        }
        continue;
      }

      // If a column has no candidates, then backtrack.
      if (column.count == 0) continue;

      stack.push(column);
    }

    this._done = (stack.length == 0);

    this._counters.nodesSearched += numNodesSearched;
    this._counters.columnsSearched += numColumnsSearched;
    this._counters.guesses += numGuesses;
    this._counters.solutions += numSolutions;

    return numNodesSearched < maxIterations;
  }

  _unwindStack() {
    let stack = this.stack;
    while (stack.length) {
      let node = stack.pop();
      if (node.column != null) {  // If the node is not a column header.
        this._restoreCandidateRow(node.row);
      }
    }
    this._done = false;
  }

  remainingRows() {
    let rows = [];
    let matrix = this.matrix;
    for (let row = matrix.down; row != matrix; row = row.down) {
      rows.push(row.id);
    }
    return rows;
  }

  solveAllPossibilities() {
    this._initTimer();
    this._startTimer();

    // TODO: Do all forced reductions first to avoid having to do them for
    // each iteration.

    let solutions = [];

    // Do initial solve to see if we have 0, 1 or many solutions.
    this._solve(
      2, () => solutions.push(ConstraintSolver._stackToSolution(this.stack)));

    // Every value in the solutions is a valid row.
    let validRows = new Set();
    if (solutions.length > 0) {
      solutions.forEach(s => s.forEach(r => validRows.add(r)));
    }

    // If there are 1 or 0 solutions, there is nothing else to do.
    // If there are 2 or more, then we have to check all possibilities.
    if (solutions.length > 1) {
      // All remaining rows are possibly valid solutions. Verify each of them.
      let matrix = this.matrix;
      for (let row = matrix.down; row != matrix; row = row.down) {
        // If we already know that this row is valid, then we don't need
        // to do anything.
        if (validRows.has(row.id)) continue;

        if (!this._removeCandidateRow(row)) {
          this._restoreCandidateRow(row);
          continue;
        }

        this._solve(1, () => {
          let solution = ConstraintSolver._stackToSolution(this.stack);
          solution.unshift(row.id);
          solution.forEach(e => validRows.add(e));
          solutions.push(solution);
        });

        // NOTE: We could make later searches more efficient by keeping invalid
        // rows out, and replacing them back afterwards. However, it is not
        // worth the code complexity.
        // It only helps when the grid is already constrained, in which case
        // the search is fast already.
        this._restoreCandidateRow(row);
      }
    }

    this._stopTimer();

    return {
      values: [...validRows],
      counters: this._getCounters(),
      timeMs: this._timeMs,
      solutionsSeen: solutions,
      done: solutions.length < 2,
    }
  }

  _getVariable(variable) {
    // A variable must an existing column id.
    let column = this.matrix.columnMap.get(variable);
    if (!column) {
      throw(`Variable ${variable} must be an existing column`);
    }
    if (column.count > 32) {
      throw(`Variable ${variable} has too many values (max 32)`);
    }

    if (column.type != Column.VARIABLE) {
      column.type = Column.VARIABLE;
      // Create hitmasks and hitsets.
      column.hitSet = 0;
      column.forEach(node => {
        node.value = 1 << node.index;
        column.hitSet += node.value;
      });
    }

    return column;
  }

  _enforceArcConsistency(row, updatedColumns) {
    let removedRows = [];
    // Add to the map early so that we can return at any point.
    this._arcInconsistencyMap.set(row, removedRows);

    let pending = updatedColumns;
    if (updatedColumns.sawContradition) return;

    while (pending.hasExtraConstraints()) {
      let c = pending.popExtraConstraint();
      switch (c.type) {
        case BINARY_CONSTRAINT:
          // Optmization for constraints where it doesn't help to prune until
          // the value is fixed.
          if (c.onlyApplyWhenFinal && !c.column.removed) continue;
          if (c.adjColumn.removed) {
            // If it's a removed column, we have to be careful:
            //  - We can't remove any nodes.
            //  - There may be more nodes than are actually valid.
            c.adjColumn.forEach((node) => {
              if (pending.sawContradition) return;
              // If the node has already been removed, we should skip it.
              if (!(node.value & c.adjColumn.hitSet)) return;
              if (!(c.nodeList[node.index] & c.column.hitSet)) {
                // If we try to remove any valid rows from a satisfied column,
                // then that is a contradiction.
                pending.sawContradiction = true;
              }
            });
          } else {
            c.adjColumn.forEach((node) => {
              if (pending.sawContradition) return;
              if (!(c.nodeList[node.index] & c.column.hitSet)) {
                // No valid setting exists for this node.
                removedRows.push(node.row);
                this._removeInvalidRow(node.row, pending);
              }
            });
          }
          break;
        case SUM_CONSTRAINT:
          let min = 0;
          let max = 0;
          for (const adjColumn of c.columns) {
            if (adjColumn.removed) {
              // Currently the weight is only set if it is removed.
              // This is ok, as this will be fixed in a later iteration
              // before have to do any branching.
              min += adjColumn.weight;
              max += adjColumn.weight;
            } else {
              min += adjColumn.down.row.weight;
              max += adjColumn.up.row.weight;
            }
          }
          if (c.sum < min || c.sum > max) {
            pending.sawContradiction = true;
            return;
          }
          // TODO: If one square left, we can just set it.
          // TODO: If there are only 2 squares left, we can reduce it to
          // just the matching values.
          // TODO: For 3 squares, need to experiment to see if it pays off.
          // TODO: Only in the larger cases does the more general range
          // calculation make sense.
          // TODO: For 3 squares we might be able to learn new binary
          // constraints. Only do this at the start of a solve?
          for (const adjColumn of c.columns) {
            // Check if any values in each columns in the range are impossible
            // given the current min and max.
            // If any columns with a count == 1 were inconsistant, then that
            // would have been ruled out by the initial check.
            if (adjColumn.count > 1) {
              let colMin = adjColumn.down.row.weight;
              let colMax = adjColumn.up.row.weight;
              let range = colMax - colMin;
              if (min + range > c.sum || max - range < c.sum) {
                adjColumn.forEach(node => {
                  let weight = node.row.weight;
                  if (min + weight - colMin > c.sum || max + weight - colMax < c.sum) {
                    removedRows.push(node.row);
                    this._removeInvalidRow(node.row, pending);
                  }
                });
                if (pending.sawContradiction) return;
              }
            }
          }
          break;
      }
      if (pending.sawContradiction) return;
    }
  }

  _revertArcConsistency(row) {
    let removedRows = this._arcInconsistencyMap.get(row);
    if (!removedRows) return;
    while(removedRows.length) {
      let row = removedRows.pop();
      this._restoreInvalidRow(row);
    }
  }
}

ConstraintSolver.Constraint = class {}

ConstraintSolver.OneOfConstraint = class extends ConstraintSolver.Constraint {
  constructor(id, values) {
    super();
    this.values = values;
    this.id = id;
  }

  apply(solver) {
    solver.matrix.appendColumn(this.id, this.values);
  }
}

ConstraintSolver.SumConstraint = class extends ConstraintSolver.Constraint {
  constructor(vars, sum) {
    super();
    this._vars = vars;
    this._sum = sum;
  }

  apply(solver) {
    let id = `sum_${this._sum}`
    let vars = this._vars
    let sum = this._sum;

    let columns = [];
    let values = [];
    for (const v of vars) {
      let column = solver._getVariable(v);
      // if (!column) {
      //   throw(`Variable ${variable} must be an existing column`);
      // }
      columns.push(column);
      column.forEach(n => values.push(n.row.id));
    }

    let constraint = {
      type: SUM_CONSTRAINT,
      columns: columns,
      sum: sum
    }
    for (const column of columns) {
      column.extraConstraints.push(constraint);
    }
    solver._sumConstraints.push(constraint);
  }
}

ConstraintSolver.BinaryConstraint = class extends ConstraintSolver.Constraint {
  constructor(var1, var2, fn, onlyApplyWhenFinal) {
    super();
    this._var1 = var1;
    this._var2 = var2;
    this._fn = fn;
    this._onlyApplyWhenFinal = onlyApplyWhenFinal || false;
  }

  apply(solver) {
    let var1 = this._var1;
    let var2 = this._var2;
    let constraintFn = this._fn;

    let column1 = solver._getVariable(var1);
    let column2 = solver._getVariable(var2);

    let constraintMap = ConstraintSolver.BinaryConstraint._makeConstraintMap(
      column1, column2, constraintFn);
    this._setUpConstraint(column1, column2, constraintMap);
    this._setUpConstraint(column2, column1, constraintMap);
  }

  _setUpConstraint(column, adjColumn, constraintMap) {
    let nodeList = [];
    adjColumn.forEach(node => {
      nodeList[node.index] = constraintMap.get(node);
    });
    let constraint = {
      type: BINARY_CONSTRAINT,
      column: column,
      adjColumn: adjColumn,
      nodeList: nodeList,
      onlyApplyWhenFinal: this._onlyApplyWhenFinal,
    };
    column.extraConstraints.push(constraint);
  }

  static _makeConstraintMap(column1, column2, constraintFn) {
    let constraintMap = new Map();
    column1.forEach(e => constraintMap.set(e, 0));
    column2.forEach(e => constraintMap.set(e, 0));

    column1.forEach(node1 => {
      column2.forEach(node2 => {
        if (constraintFn(node1.row.weight, node2.row.weight)) {
          constraintMap.set(node1, constraintMap.get(node1) | node2.value);
          constraintMap.set(node2, constraintMap.get(node2) | node1.value);
        }
      });
    });

    return constraintMap;
  }

}

ConstraintSolver.ConstraintSet = class extends ConstraintSolver.Constraint {
  constructor(constraints) {
    super();
    this._constraints = constraints;
  }

  apply(solver) {
    for (const constraint of this._constraints) {
      constraint.apply(solver);
    }
  }
}

const BINARY_CONSTRAINT = 2;
const SUM_CONSTRAINT = 1;
