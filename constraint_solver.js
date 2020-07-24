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
  }

  restoreToRow() {
    this.left.right = this;
    this.right.left = this;
  }

  removeFromColumn() {
    this.up.down = this.down;
    this.down.up = this.up;
    this.column.value -= this.value;
  }

  restoreToColumn() {
    this.up.down = this;
    this.down.up = this;
    this.column.value += this.value;
  }

  appendToColumn(column) {
    this.up = column.up;
    this.down = column;
    column.up.down = this;
    column.up = this;
    this.column = column;
    this.column.value += this.value;

    this.index = this.column.totalNodes;
    this.column.totalNodes++;
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
  constructor(id) {
    super();
    this.id = id;
    this.value = 0;
    this.totalNodes = 0;
  }

  remove() {
    this.removeFromRow();
  }

  restore() {
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
    let minNode = null;
    let minValue = Infinity;

    for (let node = this.right; node != this; node = node.right) {
      if (node.value < minValue) {
        minNode = node;
        minValue = node.value;
      }
    }

    return minNode;
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

  // TODO: Remove forEach and forEachRev with raw loops for performance. Also,
  // they are not really used elsewhere.
  _removeCandidateRow(row) {
    let updatedColumns = [];
    row.remove();
    row.forEach((rowNode) => {
      rowNode.removeFromColumn();
      this._removeConflictingColumn(rowNode.column, updatedColumns);
      rowNode.restoreToColumn();
    });
    this._enforceArcConsistency(row, updatedColumns);
  }

  _removeConflictingColumn(column, updatedColumns) {
    updatedColumns.push(column);
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
      updatedColumns.push(rowNode.column);
    });
  }

  // To restore we need to do everything in exactly the reverse order.
  _restoreCandidateRow(row) {
    this._revertArcConsistency(row);
    row.forEachRev((rowNode) => {
      rowNode.removeFromColumn();
      this._restoreConflictingColumn(rowNode.column);
      rowNode.restoreToColumn();
    });
    row.restore();
  }

  _restoreConflictingColumn(column) {
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
    while (matrix.hasColumns()) {
      // Find the column with the least number of candidates, to speed up
      // the search.
      let column = matrix.findMinColumn();
      if (column.value != 1) return column;

      let node = column.down;
      stack.push(node);
      this._removeCandidateRow(node.row);
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
    // If there are no column, then there is 1 solution - the trival one.
    if (!matrix.hasColumns()) return {solutions: [[]], numBacktracks: 0};

    const stackToSolution = (stack) => stack.map(e => e.row.id);

    let solutions = [];
    let stack = [matrix.findMinColumn()];
    let numNodesSearched = 0;
    let numColumnsSearched = stack[0].value ? 1 : 0;

    while (stack.length) {
      let node = stack.pop();

      // If the node is not a column header then we are backtracking, so
      // restore the state.
      if (!(node instanceof Column)) {
        this._restoreCandidateRow(node.row);
      }
      // Try the next node in the column.
      node = node.down;

      // If we have tried all the nodes, then backtrack.
      if (node instanceof Column) continue;

      if (this.iterations++ > ITERATION_LIMIT) {
        throw(`Reached iteration limit of ${ITERATION_LIMIT} without completing`);
      }

      stack.push(node);
      this._removeCandidateRow(node.row);
      this.iterations++;

      numNodesSearched++;

      // let column = this._solveForced(matrix, stack);
      let column = matrix.findMinColumn();
      if (!column) {
        solutions.push(stackToSolution(stack));
        if (solutions.length == maxSolutions) {
          break;
        }
        continue;
      }

      // If a column has no candidates, then backtrack.
      if (column.value == 0) continue;

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

        this._removeCandidateRow(row);

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
    this.binaryConstraintAdjacencies = new Map();
    // Columns for tracking variables.
    this.variableColumns = new Map();
  }

  _allBinaryConstraintColumns() {
    return [...this.binaryConstraintAdjacencies.keys()];
  }

  _getVariable(variable) {
    // A variable must an existing column id.
    let column = this.matrix.columnMap.get(variable);
    if (!column) {
      throw(`Variable ${variable} must be an existing column`);
    }

    if (!this.variableColumns.has(variable)) {
      let varColumn = this.matrix.appendColumn('_var_' + variable, column.rowIds());
      this.variableColumns.set(variable, varColumn);
      // Variables shouldn't partipate in the exact cover calulation.
      varColumn.remove();
      // Create hitmasks and hitsets.
      varColumn.value = 0;
      varColumn.forEach(node => {
        node.value = 1 << node.index;
        varColumn.value += node.value;
      });
    }

    return this.variableColumns.get(variable);
  }

  addBinaryConstraint(id, var1, var2, constraintFn) {
    let column1 = this._getVariable(var1);
    let column2 = this._getVariable(var2);
    if (column1.count > 32) throw('Too many values for constraint.');
    if (column2.count > 32) throw('Too many values for constraint.');

    let constraintMap = ConstraintSolver._makeConstraintMap(column1, column2, constraintFn);
    let constraint1 = this._setUpBinaryConstraintColumn(column1, constraintMap);
    let constraint2 = this._setUpBinaryConstraintColumn(column2, constraintMap);

    this._appendToBinaryConstraintAdjacencies(constraint1.column, constraint2);
    this._appendToBinaryConstraintAdjacencies(constraint2.column, constraint1);
  }

  _appendToBinaryConstraintAdjacencies(column, constraint) {
    if (!this.binaryConstraintAdjacencies.has(column)) {
      this.binaryConstraintAdjacencies.set(column, []);
    }
    this.binaryConstraintAdjacencies.get(column).push(constraint);
  }

  _setUpBinaryConstraintColumn(column, constraintMap) {
    let nodeList = [];
    column.forEach(node => {
      nodeList[node.index] = constraintMap.get(node.row.id);
    });
    return {
      column: column,
      nodeList: nodeList,
    };
  }

  static _makeConstraintMap(column1, column2, constraintFn) {
    let constraintMap = new Map();
    column1.forEach(e => constraintMap.set(e.row.id, 0));
    column2.forEach(e => constraintMap.set(e.row.id, 0));

    column1.forEach(node1 => {
      let v1 = node1.row.id;
      column2.forEach(node2 => {
        let v2 = node2.row.id;
        if (constraintFn(v1, v2)) {
          constraintMap.set(v1, constraintMap.get(v1) | node2.value);
          constraintMap.set(v2, constraintMap.get(v2) | node1.value);
        }
      });
    });

    return constraintMap;
  }

  _enforceArcConsistency(row, updatedColumns) {
    let pending = updatedColumns;
    let removedRows = [];
    while (pending.length) {
      let column = pending.pop();
      // If any column is down to 0, then we can stop right away. The puzzle
      // is inconsistent.
      // We should defintely not process it, that would cause rows to be
      // removed twice.
      if (column.value == 0) break;
      // Ignore any columns which are not binary constraints.
      let adjConstraints = this.binaryConstraintAdjacencies.get(column);
      if (!adjConstraints) continue;
      for (const adj of adjConstraints) {
        adj.column.forEach((node) => {
          if (!(adj.nodeList[node.index] & column.value)) {
            // No valid setting exists for this node.
            this._removeInvalidRow(node.row, pending);
            removedRows.push(node.row);
          }
        });
      }
    }
    this.arcInconsistencyMap.set(row, removedRows);
  }

  _revertArcConsistency(row) {
    let removedRows = this.arcInconsistencyMap.get(row);
    while(removedRows.length) {
      let row = removedRows.pop();
      this._restoreInvalidRow(row);
    }
  }
}
