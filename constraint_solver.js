"use strict";

const USE_FUTURE_DEGREE = true;

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
    this.row.count--;
  }

  restoreToRow() {
    this.left.right = this;
    this.right.left = this;
    if (this.column) {
      this.column.count++;
      this.column.hitSet += this.value;
    }
    this.row.count++;
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
    this.row.count++;
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
    this.removed = false;
    this.count = 0;
  }

  remove() {
    this.removed = true;
    this.removeFromColumn();
  }

  restore() {
    this.removed = false;
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
    this.sawContradiction = false;

    // We keep the invariant that:
    //   this._extraConstraints contains c <=> c.dirty == this._generation
    this._extraConstraints = [];
    this._generation = ++ColumnAccumulator.dirtyGeneration;

    this._forcedColumns = [];
  }

  static dirtyGeneration = 0;

  add(column) {
    if (column.count == 0) {
      this.sawContradiction = true;
    }
    if (this.sawContradiction) return;

    if (column.count == 1 && !column.removed) {
      this._forcedColumns.push(column);
    }

    let generation = this._generation;
    for (let i = 0; i < column.extraConstraints.length; i++) {
      let c = column.extraConstraints[i];
      if (c.dirty !== generation) {
        c.dirty = generation;
        this._extraConstraints.push(c);
      }
    }
  }

  hasExtraConstraints() {
    return !this.sawContradiction && this._extraConstraints.length > 0;
  }

  popExtraConstraint() {
    let c = this._extraConstraints.pop();
    c.dirty = 0;
    return c;
  }

  popForcedColumn() {
    while (this._forcedColumns.length) {
      let col = this._forcedColumns.pop();
      if (!col.removed) return col;
    }
    return null;
  }
}

class ConstraintSolver {
  constructor(constraints, values, weights) {
    this.matrix = new Matrix(values);
    if (weights) this._setWeights(weights);
    this._sumConstraints = [];

    constraints.forEach(c => c.apply(this));

    this._stack = [];
    this._progress = {
      frequency: 0,
      callback: null,
      extraState: null,
    };

    this._init();
  }

  _init() {
    if (this._stack.length > 0) {
      throw("Can't initialize ConstraintSolver when stack is not empty.");
    }

    this._done = false;
    this._iter = null;
    this._counters = {
      nodesSearched: 0,
      columnsSearched: 0,
      guesses: 0,
      solutions: 0,
    };
    this._timer = new Timer();
    this._arcInconsistencyMap = new Map();
    this._columnAccumulator = new ColumnAccumulator();
  }

  _setWeights(weightMap) {
    let rowMap = this.matrix.rowMap;
    for (const [rowId, weight] of weightMap) {
      rowMap.get(rowId).weight = weight;
    }
  }

  // _removeCandidateRow removes the row and updates all the constraints.
  //   - Removes conflicting exact cover constraints using alogithms x.
  //   - Enforces arc consistency on binary constraints.
  //
  // Returns true if the remaining matrix is still consistent (assuming the
  // initial matrix was consistent).
  _removeCandidateRow(row, updatedColumns) {
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

  // Approximate the number of variables constrained by this column.
  _futureDegree(column) {
    let degree = 0;
    for (let node = column.down; node != column; node = node.down) {
      degree += node.row.count;
    }
    // Determine the average degree per value.
    degree /= column.count;

    // Then add an extra degree for column in an extra constraint.
    for (const constraint of column.extraConstraints) {
      // Subtract one, as we don't want to count the current column.
      // NOTE: We could check for only columns which are still uninstantiated
      //       but that would take longer and doesn't seem to be worth it.
      degree += constraint.columns.length - 1;
    }

    return degree;
  }

  _selectNextColumn(updatedColumns) {
    if (updatedColumns.sawContradiction) {
      throw('updatedColumns shuld not have a contradiction');
    }
    let forcedColumn = updatedColumns.popForcedColumn();
    if (forcedColumn) {
      return forcedColumn;
    }

    let matrix = this.matrix;
    let minCol = null;
    let minScore = Infinity;

    for (let col = matrix.right; col != matrix; col = col.right) {
      // If the value is zero, we'll never go lower.
      if (col.count == 0) return col;
      // If the minScore is negative, we've already seen a column of count
      // 1, so we are just searching for 0s now.
      if (minScore < 0) continue;

      if (col.count == 1) {
        minCol = col;
        minScore = -1;
        continue;
      }

      let score = col.count;
      if (USE_FUTURE_DEGREE) {
        score = col.count / this._futureDegree(col);
      }
      if (score < minScore) {
        minCol = col;
        minScore = score;
      }
    }

    // If column with a unique value, then go with that. Otherwise check if
    // proceed with the more expensive checks.
    if (minScore < 0) return minCol;

    // If we are using future degree, then special handling for sum constraints
    // is not relavent (it is almost always a higher score.
    // However, USE_FUTURE_DEGREE does help with sums regardless.
    if (USE_FUTURE_DEGREE) return minCol;

    // TODO: Update this to be consistent with USE_FUTURE_DEGREE.
    let minConstraint = null;
    for (const c of this._sumConstraints) {
      let countEff = c.effectiveCount();
      if (countEff > minScore) continue;

      minConstraint = c;
      minScore = countEff;
    }

    // If a constraint had a lower effective count, then choose its variable
    // with the least number of options.
    if (minConstraint) {
      let minOptions = Infinity;
      for (const c of minConstraint.columns) {
        if (c.count != 1 && c.count < minOptions) {
          minCol = c;
          minOptions = c.count;
        }
      }
    }

    return minCol;
  }

  static _stackToSolution(stack) {
    return stack.map(e => e.row.id);
  }

  // Solve until maxSolutions are found, and returns leaving the stack
  // fully unwound.
  _solve(maxSolutions, solutionFn) {
    let iter = this._runSolver();

    let numSolutions = 0;
    while (numSolutions < maxSolutions) {
      let result = iter.next();
      if (result.done) break;
      solutionFn(result.value);
      numSolutions++;
    }

    this._unwindStack();
  }

  _getCounters() {
    let counters = {...this._counters};
    counters.backtracks = counters.nodesSearched - counters.columnsSearched;
    return counters;
  }

  reset() {
    this._unwindStack();
    this._init();
  }

  state() {
    return {
      counters: this._getCounters(),
      timeMs: this._timer.elapsedMs(),
      done: this._done,
      extra: null,
    }
  }

  _getIter(iterationsUntilYield) {
    // If an iterator doesn't exist, then create it.
    if (!this._iter) {
      if (this._stack.length) {
        throw("Can't create iterator when stack is not empty");
      }

      this._iter = this._runSolver(iterationsUntilYield);
    }

    return this._iter;
  }

  setProgressCallback(callback, frequency) {
    this._progress.callback = callback;
    this._progress.frequency = frequency;
  }

  _sendProgress() {
    this._progress.callback(
      this._progress.extraState ? this._progress.extraState() : null);
  }

  nextSolution() {
    let iter = this._getIter();

    this._timer.unpause();
    let result = this._iter.next();
    this._timer.pause();

    if (result.done) return null;

    return ConstraintSolver._stackToSolution(result.value);
  }

  countSolutions(updateFrequency) {
    this.reset();

    // Add a sample solution to the state updates, but only if a different
    // solution is ready.
    let sampleSolution = null;
    this._progress.extraState = () => {
      let result = null;
      if (sampleSolution) {
        result = {solution: sampleSolution};
        sampleSolution = null;
      }
      return result;
    };

    this._timer.unpause();
    for (let stack of this._getIter()) {
      // Only store a sample solution if we don't have one.
      if (sampleSolution == null) {
        sampleSolution = ConstraintSolver._stackToSolution(stack)
      }
    }
    this._timer.pause();

    // Send progress one last time to ensure the last solution is sent.
    this._sendProgress();

    this._progress.extraState = null;

    return this._counters.solutions;
  }

  goToStep(n) {
    // Easiest way to go backwards is to start from the start again.
    if (n < this._counters.nodesSearched) this.reset();

    let iter = this._getIter(1);

    // Iterate until we have seen n steps.
    this._timer.unpause();
    while (this._counters.nodesSearched + this._done < n && !this._done) {
      iter.next(1);
    }
    this._timer.pause();

    if (this._done) return null;

    let partialSolution = ConstraintSolver._stackToSolution(this._stack);
    if (partialSolution[partialSolution.length-1] === undefined) {
      partialSolution.pop();
    }
    return {
      values: partialSolution,
      remainingOptions: this._remainingRows(),
    }
  }

  // _runSolver runs the solver yielding each solution, and optionally at
  // intermediate steps.
  // The value returned to yeild determines how many steps to run for (-1 for
  // no limit).
  *_runSolver(iterationsUntilYield) {
    if (this._done) {
      return true;
    }

    let stack = this._stack;

    // Initialize if the stack is empty.
    if (stack.length == 0) {
      let column = this._selectNextColumn(this._columnAccumulator);
      // If there are no columns, then there is 1 solution - the trival one.
      if (!column) {
        this._addSolution();
        this._counters.solutions++;
        return true;
      }
      this._stack.push(column);
    }

    let counters = this._counters;
    let progressFrequency = this._progress.frequency;
    iterationsUntilYield = iterationsUntilYield || -1;

    while (stack.length) {
      if (counters.nodesSearched % progressFrequency == 0) {
        this._sendProgress();
      }
      if (!iterationsUntilYield) {
        iterationsUntilYield = (yield null) || -1;
      }
      let node = stack.pop();

      // If the node is not a column header then we are backtracking, so
      // restore the state.
      if (node.column != null) {
        this._restoreCandidateRow(node.row);
      } else {
        if (node.count > 0) counters.columnsSearched++;
      }
      // Try the next node in the column.
      node = node.down;

      // If we have tried all the nodes, then backtrack.
      if (node.column == null) continue;

      stack.push(node);
      iterationsUntilYield--;
      counters.nodesSearched++;
      // If there was more than one node to choose from, then this was a guess.
      if (node.down.column != null) counters.guesses++;

      if (!this._removeCandidateRow(node.row, this._columnAccumulator)) {
        this._columnAccumulator = new ColumnAccumulator();
        continue;
      }

      let column = this._selectNextColumn(this._columnAccumulator);
      if (!column) {
        counters.solutions++;
        iterationsUntilYield = (yield this._stack) || -1;
        continue;
      }

      // If a column has no candidates, then backtrack.
      if (column.count == 0) continue;

      stack.push(column);
    }

    this._done = true;
  }

  _unwindStack() {
    let stack = this._stack;
    while (stack.length) {
      let node = stack.pop();
      if (node.column != null) {  // If the node is not a column header.
        this._restoreCandidateRow(node.row);
      }
    }
    this._done = false;
    this._iter = null;  // This always invalidates the iterator.
  }

  _remainingRows() {
    let rows = [];
    let matrix = this.matrix;
    for (let row = matrix.down; row != matrix; row = row.down) {
      rows.push(row.id);
    }
    return rows;
  }

  solveAllPossibilities() {
    this.reset();

    let validRows = new Set();

    // Send the current valid rows with the progress update, if there have
    // been any changes.
    let lastSize = 0;
    this._progress.extraState = () => {
      if (validRows.size == lastSize) return null;
      lastSize = validRows.size;
      return {pencilmarks: [...validRows]};
    };

    this._timer.unpause();
    this._solveAllPossibilities(validRows);
    this._timer.pause();

    this._progress.extraState = null;

    return [...validRows];
  }

  _solveAllPossibilities(validRows) {
    // TODO: Do all forced reductions first to avoid having to do them for
    // each iteration.

    // Do initial solve to see if we have 0, 1 or many solutions.
    this._solve(2,
      () => {
        ConstraintSolver._stackToSolution(this._stack).forEach(
          r => validRows.add(r));
      });

    let numSolutions = this._counters.solutions;

    // If there are 1 or 0 solutions, there is nothing else to do.
    // If there are 2 or more, then we have to check all possibilities.
    if (numSolutions > 1) {
      // All remaining rows are possibly valid solutions. Verify each of them.
      let matrix = this.matrix;
      for (let row = matrix.down; row != matrix; row = row.down) {
        // If we already know that this row is valid, then we don't need
        // to do anything.
        if (validRows.has(row.id)) continue;

        this._columnAccumulator = new ColumnAccumulator();
        if (!this._removeCandidateRow(row, this._columnAccumulator)) {
          this._restoreCandidateRow(row);
          continue;
        }

        this._solve(1, () => {
          let solution = ConstraintSolver._stackToSolution(this._stack);
          solution.unshift(row.id);
          solution.forEach(e => validRows.add(e));
        });

        // NOTE: We could make later searches more efficient by keeping invalid
        // rows out, and replacing them back afterwards. However, it is not
        // worth the code complexity.
        // It only helps when the grid is already constrained, in which case
        // the search is fast already.
        this._restoreCandidateRow(row);
      }
    }

    this._done = this._counters.solutions < 2;
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
    if (updatedColumns.sawContradiction) return;

    while (pending.hasExtraConstraints()) {
      let constraint = pending.popExtraConstraint();
      let rowsToRemove = constraint.enforceConsistency();
      if (!rowsToRemove) {
        pending.sawContradiction = true;
        return;
      }

      for (const row of rowsToRemove) {
        if (!row.removed) {
          removedRows.push(row);
          this._removeInvalidRow(row, pending);
          if (pending.sawContradiction) return;
        }
      }
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

class ConstraintHandler {
  constructor() {
    this.dirty = 0;
  }
}

class BinaryConstraintHandler extends ConstraintHandler {
  constructor(column, adjColumn, nodeList, onlyApplyWhenFinal) {
    super();
    this.column = column;
    this.adjColumn = adjColumn;
    this.nodeList = nodeList;
    this.onlyApplyWhenFinal = onlyApplyWhenFinal;
    this.columns = [column, adjColumn];
  }

  enforceConsistency() {
    let rowsToRemove = [];
    let sawContradiction = false;
    // Optmization for constraints where it doesn't help to prune until
    // the value is fixed.
    if (this.onlyApplyWhenFinal && !this.column.removed) return rowsToRemove;
    if (this.adjColumn.removed) {
      // If it's a removed column, we have to be careful:
      //  - We can't remove any nodes.
      //  - There may be more nodes than are actually valid.
      this.adjColumn.forEach((node) => {
        // If the node has already been removed, we should skip it.
        if (!(node.value & this.adjColumn.hitSet)) return;
        if (!(this.nodeList[node.index] & this.column.hitSet)) {
          // If we try to remove any valid rows from a satisfied column,
          // then that is a contradiction.
          sawContradiction = true;
        }
      });
    } else {
      this.adjColumn.forEach((node) => {
        if (!(this.nodeList[node.index] & this.column.hitSet)) {
          // No valid setting exists for this node.
          rowsToRemove.push(node.row);
        }
      });
    }
    return sawContradiction ? null : rowsToRemove;
  }
}

class SumConstraintHandler extends ConstraintHandler {
  constructor(columns, sum, uniqueWeights) {
    super();
    this.columns = columns;
    this.sum = sum;
    this.uniqueWeights = uniqueWeights;
    this.count = columns.length;
  }

  enforceConsistency() {
    let rowsToRemove = [];

    let min = 0;
    let max = 0;
    let fixedValueHitSet = 0;  // Track duplicates.
    let unfixedValueHitSet = 0;  // Track duplicates.
    let fixedSum = 0;
    let numUnfixed = 0;
    for (const column of this.columns) {
      if (column.count == 1) {
        let weight = column.removed ? column.weight : column.down.row.weight;
        min += weight;
        max += weight;

        if (this.uniqueWeights) {
          if (fixedValueHitSet & column.hitSet) {
            // We saw a duplicate so this is a contradiction.
            return null;
          }
          fixedValueHitSet |= column.hitSet;
          fixedSum += weight;
        }
      } else {
        min += column.down.row.weight;
        max += column.up.row.weight;

        unfixedValueHitSet |= column.hitSet;
        numUnfixed++;
      }
    }
    if (this.sum < min || this.sum > max) {
      return null;
    }
    // Short-circuit the rest of the function because everything is fixed, and
    // the sum is correct.
    if (this.sum == min && this.sum == max) {
      return rowsToRemove;
    }

    // Check that sum can be made from unique weights.
    if (this.uniqueWeights) {
      // Find all possible legal values.
      // This is specific to Sudoku killer cages.
      let options = SumConstraintHandler.KILLER_CAGE_SUMS[numUnfixed][this.sum - fixedSum];
      let possible = 0;
      for (let option of options) {
        if (option & unfixedValueHitSet) possible |= option;
      }

      // If there are no possible sums, then we found a contradiction.
      if (!possible) {
        return null;
      }

      // Otherwise remove any which are either:
      //  - Not included in any sum.
      //  - Already in the fixed values.
      let valuesToRemove = unfixedValueHitSet & (~possible | fixedValueHitSet);
      if (valuesToRemove) {
        for (const column of this.columns) {
          if (column.count > 1 && (column.hitSet & valuesToRemove)) {
            column.forEach(node => {
              if ((1 << node.index) & valuesToRemove) {
                rowsToRemove.push(node.row);
              }
            });
          }
        }
      }
    }

    // TODO: If one square left, we can just set it.
    // TODO: If there are only 2 squares left, we can reduce it to
    // just the matching values.
    // TODO: For 3 squares, need to experiment to see if it pays off.
    // TODO: Only in the larger cases does the more general range
    // calculation make sense.
    // TODO: For 3 squares we might be able to learn new binary
    // constraints. Only do this at the start of a solve?
    for (const column of this.columns) {
      // Check if any values in each columns in the range are impossible
      // given the current min and max.
      // If any columns with a count == 1 were inconsistant, then that
      // would have been ruled out by the initial check.
      if (column.count > 1) {
        let colMin = column.down.row.weight;
        let colMax = column.up.row.weight;
        let range = colMax - colMin;
        if (min + range > this.sum || max - range < this.sum) {
          column.forEach(node => {
            let weight = node.row.weight;
            if (min + weight - colMin > this.sum || max + weight - colMax < this.sum) {
              rowsToRemove.push(node.row);
            }
          });
        }
      }
    }

    return rowsToRemove;
  }

  effectiveCount() {
    let sum = 0;
    let options = 0;  // Remaining options.
    let count = 0;  // Remaining squares.
    let maxCount = 0;
    for (const c of this.columns) {
      if (c.count != 1) {
        count += 1;
        options += c.count;
        if (c.count > maxCount) {
          maxCount = c.count;
        }
      }
    }
    if (!count) return Infinity;  // This constraint is already satisfied.
    // To prioritize sum squares, we want a number which is comparable to
    // the count of an unconstrained variable.
    // Let:
    //   countEff = The number we want to calculate.
    //   options = The number of possible remaining values. i.e. sum of counts
    //             of unfixed variables in the sum.
    //   numVar = The number of remaining unfixed variables.
    //   maxCount = The variable with the largest number of options.
    // Then the average number of options per variable is:
    //   optionsAvNaive = options/numVar
    // However, if we fix (numVar - 1) variables, then the last variable is
    // forced. We can choose the least constrained option to be forced,
    // giving:
    //   optionsAv = (options - maxCount)/(numVar-1)
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
    //  countEff = 1 + (options-maxCount-numVar-1)/numVar;
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
    //
    // The above approximation over-estimates optionsAvEff. In addition, the
    // options are usually more constrainted, because we haven't considered
    // what the sum actually is. To account for this, squish (countEff-1)
    // by an adjustmentFactor. This results in up to 2x performance increase.
    const adjustmentFactor = 2;
    let countEff = 1 + (options-maxCount-count+1)/(count*adjustmentFactor);
    return countEff;
  }
}
SumConstraintHandler.KILLER_CAGE_SUMS = (() => {
  let sums = [];
  for (let n = 0; n < 10; n++) {
    let totals = [];
    sums.push(totals);
    for (let i = 0; i < 46; i++) {
      totals.push([]);
    }
  }

  // Recursively find all sums of subsets of {1..9}.
  const findAllSums = (n, count, sum, hits) => {
    if (n == 9) {
      sums[count][sum].push(hits);
      return;
    }

    n++;
    findAllSums(n, count+1, sum+n, hits|(1<<(n-1)));
    findAllSums(n, count, sum, hits);
  }
  findAllSums(0, 0, 0, 0);

  return sums;
})();


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
  constructor(vars, sum, uniqueWeights) {
    super();
    this._vars = vars;
    this._sum = sum;
    this._uniqueWeights = uniqueWeights;
  }

  apply(solver) {
    let id = `sum_${this._sum}`
    let vars = this._vars
    let sum = this._sum;

    let columns = [];
    for (const v of vars) {
      let column = solver._getVariable(v);
      columns.push(column);
      column.forEach(node => {
        if (node.index != node.row.weight - 1) {
          throw("Node weights don't correspond to index. Some optimizations don't hold.");
        }
      });
    }

    let constraint = new SumConstraintHandler(columns, sum, this._uniqueWeights);
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
    column.extraConstraints.push(new BinaryConstraintHandler(
      column, adjColumn, nodeList, this._onlyApplyWhenFinal));
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
