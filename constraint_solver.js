const ITERATION_LIMIT = 5000000;

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

  findMinColumn() {
    let minCol = null;
    let minCount = Infinity;

    for (let col = this.right; col != this; col = col.right) {
      if (col.count < minCount) {
        // If the value is zero, we'll never go lower.
        if (col.count == 0) return col;

        minCol = col;
        minCount = col.count;
      }
    }

    return minCol;
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
  }

  add(column) {
    if (this.sawContradiction) return;
    if (column.type == Column.VARIABLE) {
      this._variableColumns.push(column);
    }
    if (column.count == 0) {
      this.sawContradition = true;
    }
  }

  hasVariable() {
    return !this.sawContradition && this._variableColumns.length > 0;
  }

  popVariable() {
    if (this.sawContradition) return null;
    return this._variableColumns.pop();
  }
}

class ConstraintSolver {
  constructor(values) {
    this.matrix = new Matrix(values);
    this._setUpBinaryConstraints();
    this.iterations = 0;
  }

  addConstraint(id, values) {
    this.matrix.appendColumn(id, values);
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

  // Form all forced reductions, i.e. where there is only one option.
  _solveForced(matrix, stack) {
    // Find the column with the least number of candidates, to speed up
    // the search.
    for (let column; column = matrix.findMinColumn();) {
      if (column.count != 1) return column;

      let node = column.down;
      stack.push(node);
      if (!this._removeCandidateRow(node.row)) return DUMMY_COLUMN;
    }
    return null;
  }

  solve() {
    let startTime = performance.now();
    this.iterations = 0;
    let result = this._solve(this.matrix, 2);
    let endTime = performance.now();

    let solution = result.solutions[0] || [];
    return {
      values: solution,
      numBacktracks: result.numBacktracks,
      timeMs: endTime - startTime,
      unique: result.solutions.length == 1,
    }
  }

  // Solve until maxSolutions are found, and return leaving matrix in the
  // same state.
  _solve(matrix, maxSolutions) {
    let minColumn = matrix.findMinColumn();
    // If there are no columns, then there is 1 solution - the trival one.
    if (!minColumn) return {solutions: [[]], numBacktracks: 0};

    const stackToSolution = (stack) => stack.map(e => e.row.id);

    let solutions = [];
    let stack = [minColumn];
    let numNodesSearched = 0;
    let numColumnsSearched = stack[0].count ? 1 : 0;

    while (stack.length) {
      let node = stack.pop();

      // If the node is not a column header then we are backtracking, so
      // restore the state.
      if (node.column != null) {
        this._restoreCandidateRow(node.row);
      }
      // Try the next node in the column.
      node = node.down;

      // If we have tried all the nodes, then backtrack.
      if (node.column == null) continue;

      if (this.iterations++ > ITERATION_LIMIT) {
        throw(`Reached iteration limit of ${ITERATION_LIMIT} without completing`);
      }

      stack.push(node);
      this.iterations++;
      numNodesSearched++;

      if (!this._removeCandidateRow(node.row)) continue;

      let column = matrix.findMinColumn();
      if (debugCallback != null) debugCallback(this, node, stack, column);
      if (!column) {
        solutions.push(stackToSolution(stack));
        if (solutions.length == maxSolutions) {
          break;
        }
        continue;
      }

      // If a column has no candidates, then backtrack.
      if (column.count == 0) continue;

      stack.push(column);
      numColumnsSearched++;
    }

    this._unwindStack(stack);

    return {
      solutions: solutions,
      numBacktracks: numNodesSearched - numColumnsSearched,
    };
  }

  _unwindStack(stack) {
    while (stack.length) {
      let node = stack.pop();
      this._restoreCandidateRow(node.row);
    }
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
    let startTime = performance.now();

    let matrix = this.matrix;

    let numBacktracks = 0;
    let rowsExplored = 0;
    this.iterations = 0;

    // First eliminate the forced values.
    // This will prevent us having to redo work later.
    let stack = [];
    this._solveForced(matrix, stack);

    // Do initial solve to see if we have 0, 1 or many solutions.
    let result = this._solve(matrix, 2);
    numBacktracks += result.numBacktracks;

    // Every value in the solutions is a valid row.
    // In addition, all items in the stack are common to all solutions.
    let validRows = new Set();
    if (result.solutions.length) {
      result.solutions.forEach(s => s.forEach(r => validRows.add(r)));
      stack.map(e => validRows.add(e.row.id));
    }

    // If there are 1 or 0 solutions, there is nothing else to do.
    // If there are 2 or more, then we have to check all possibilities.
    if (result.solutions.length > 1) {
      // All remaining rows are possibly valid solutions. Verify each of them.
      for (let row = matrix.down; row != matrix; row = row.down) {
        // If we already know that this row is valid, then we don't need
        // to do anything.
        if (validRows.has(row.id)) continue;

        if (!this._removeCandidateRow(row)) {
          this._restoreCandidateRow(row);
          continue;
        }

        let result = this._solve(matrix, 1);
        numBacktracks += result.numBacktracks;
        if (result.solutions.length) {
          // If there is a solution, then add all it's entries to validRows.
          result.solutions[0].forEach(e => validRows.add(e));
          // The current row is not part of the matrix, so it's not in the
          // solution returned by _solve.
          validRows.add(row.id);
        }

        // NOTE: We could make later searches more efficient by keeping invalid
        // rows out, and replacing them back afterwards. However, it is not
        // worth the code complexity.
        // It only helps when the grid is already constrained, in which case
        // the search is fast already.
        this._restoreCandidateRow(row);

        rowsExplored++;
      }
    }

    this._unwindStack(stack);

    let endTime = performance.now();

    return {
      values: [...validRows],
      numBacktracks: numBacktracks,
      rowsExplored: rowsExplored,
      timeMs: endTime - startTime,
      unique: validRows.size == 81,
    }
  }

  _setUpBinaryConstraints() {
    this.arcInconsistencyMap = new Map();
  }

  _getVariable(variable) {
    // A variable must an existing column id.
    let column = this.matrix.columnMap.get(variable);
    if (!column) {
      throw(`Variable ${variable} must be an existing column`);
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

  addBinaryConstraint(var1, var2, constraintFn) {
    let column1 = this._getVariable(var1);
    let column2 = this._getVariable(var2);
    if (column1.count > 32) throw('Too many values for constraint.');
    if (column2.count > 32) throw('Too many values for constraint.');

    let constraintMap = ConstraintSolver._makeConstraintMap(column1, column2, constraintFn);
    let constraint1 = this._setUpBinaryConstraintColumn(column1, constraintMap);
    let constraint2 = this._setUpBinaryConstraintColumn(column2, constraintMap);

    constraint1.column.extraConstraints.push(constraint2);
    constraint2.column.extraConstraints.push(constraint1);
  }

  _setUpBinaryConstraintColumn(column, constraintMap) {
    let nodeList = [];
    column.forEach(node => {
      nodeList[node.index] = constraintMap.get(node);
    });
    return {
      column: column,
      nodeList: nodeList,
    };
  }

  static _makeConstraintMap(column1, column2, constraintFn) {
    let constraintMap = new Map();
    column1.forEach(e => constraintMap.set(e, 0));
    column2.forEach(e => constraintMap.set(e, 0));

    column1.forEach(node1 => {
      column2.forEach(node2 => {
        if (constraintFn(node1.row.id, node2.row.id)) {
          constraintMap.set(node1, constraintMap.get(node1) | node2.value);
          constraintMap.set(node2, constraintMap.get(node2) | node1.value);
        }
      });
    });

    return constraintMap;
  }

  _enforceArcConsistency(row, updatedColumns) {
    let removedRows = [];
    // Add to the map early so that we can return at any point.
    this.arcInconsistencyMap.set(row, removedRows);

    let pending = updatedColumns;
    if (updatedColumns.sawContradition) return;

    while (pending.hasVariable()) {
      let column = pending.popVariable();
      for (const adj of column.extraConstraints) {
        if (adj.column.removed) {
          // If it's a removed column, we have to be careful:
          //  - We can't remove any nodes.
          //  - There may be more nodes than are actually valid.
          adj.column.forEach((node) => {
            if (pending.sawContradition) return;
            // If the node has already been removed, we should skip it.
            if (!(node.value & adj.column.hitSet)) return;
            if (!(adj.nodeList[node.index] & column.hitSet)) {
              // If we try to remove any valid rows from a satisfied column,
              // then that is a contradiction.
              pending.sawContradiction = true;
            }
          });
        } else {
          adj.column.forEach((node) => {
            if (pending.sawContradition) return;
            if (!(adj.nodeList[node.index] & column.hitSet)) {
              // No valid setting exists for this node.
              removedRows.push(node.row);
              this._removeInvalidRow(node.row, pending);
            }
          });
        }
        if (pending.sawContradition) return;
      }
    }
  }

  _revertArcConsistency(row) {
    let removedRows = this.arcInconsistencyMap.get(row);
    if (!removedRows) return;
    while(removedRows.length) {
      let row = removedRows.pop();
      this._restoreInvalidRow(row);
    }
  }
}

let debugCallback = null;
