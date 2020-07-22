class Node {
  constructor() {
    this.left = this;
    this.right = this;
    this.up = this;
    this.down = this;
    this.column = null;
    this.row = null;
    this.value = 1;
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
    this.rowMap = {};
    for (const rowId of rowIds) {
      let row = new Row(rowId);
      this.rowMap[rowId] = row;
      row.appendToColumn(this);
    }
  }

  appendColumn(columnId, rowIds) {
    let column = new Column(columnId);
    for (const rowId of rowIds) {
      let row = this.rowMap[rowId];
      let node = new Node();
      node.appendToColumn(column);
      node.appendToRow(row);
    }
    column.appendToRow(this);
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

      stack.push(node);
      this._removeCandidateRow(node.row);

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

  addBinaryConstraint(id, set1, set2, constraintFn) {
    this._addBinaryConstraint(id, set1, set2, constraintFn);
  };

  _setUpBinaryConstraints() {
    this.arcInconsistencyMap = new Map();
    this.binaryConstraintAdjacencies = new Map();
    this.binaryConstraintCache = new Map();
  }

  _allBinaryConstraintColumns() {
    return [...this.binaryConstraintAdjacencies.keys()];
  }

  _addBinaryConstraint(id, set1, set2, constraintFn) {
    if (set1.length > 32) throw('Too many values for constraint.');
    if (set2.length > 32) throw('Too many values for constraint.');

    let constraintMap = ConstraintSolver._makeConstraintMap(set1, set2, constraintFn);
    let constraint1 = this._setUpBinaryConstraintColumn(id+'-1', set1, constraintMap);
    let constraint2 = this._setUpBinaryConstraintColumn(id+'-2', set2, constraintMap);

    this._appendToBinaryConstraintAdjacencies(constraint1.column, constraint2);
    this._appendToBinaryConstraintAdjacencies(constraint2.column, constraint1);
  }

  _appendToBinaryConstraintAdjacencies(column, constraint) {
    if (!this.binaryConstraintAdjacencies.has(column)) {
      this.binaryConstraintAdjacencies.set(column, []);
    }
    this.binaryConstraintAdjacencies.get(column).push(constraint);
  }

  _setUpBinaryConstraintColumn(id, set, constraintMap) {
    let column =  ConstraintSolver._addMatrixColumn(this.matrix, id, set);
    let nodeMap = new Map();
    column.forEach(node => {
      nodeMap.set(node, constraintMap.get(node.row.id));
    });
    return {
      column: column,
      nodeMap: nodeMap,
    };
  }

  static _addMatrixColumn(matrix, id, set) {
    let column = matrix.appendColumn(id, set);
    // Don't participate in constraint selection.
    column.removeFromRow();
    column.left = column;
    column.right = column;

    // Use the column value to track efficiently track which values have been
    // set.
    column.value = (1 << set.length) - 1
    let i = 0;
    column.forEach(node => { node.value = (1 << i++); });
    return column;
  }

  static _makeConstraintMap(set1, set2, constraintFn) {
    let constraintMap = new Map();
    set1.forEach(e => constraintMap.set(e, 0));
    set2.forEach(e => constraintMap.set(e, 0));

    for (let i = 0; i < set1.length; ++i) {
      let v1 = set1[i];
      for (let j = 0; j < set2.length; ++j) {
        let v2 = set2[j];
        if (v1 == v2) throw(`${v1} is in both sets for binary constraint.`);
        if (constraintFn(v1, v2)) {
          constraintMap.set(v1, constraintMap.get(v1) | (1 << j));
          constraintMap.set(v2, constraintMap.get(v2) | (1 << i));
        }
      }
    }
    return constraintMap;
  }

  _enforceArcConsistency(row, updatedColumns) {
    let pending = updatedColumns;
    let removedRows = [];
    while (pending.length) {
      let column = pending.pop();
      let adjConstraints = this.binaryConstraintAdjacencies.get(column);
      if (!adjConstraints) continue;
      for (const adj of adjConstraints) {
        adj.column.forEach((node) => {
          if (!(adj.nodeMap.get(node) & column.value)) {
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

// Test example from https://en.wikipedia.org/wiki/Knuth%27s_Algorithm_X
const makeTestMatrix = () => {
  let matrix = new ConstraintSolver(['A', 'B', 'C', 'D', 'E', 'F']);
  matrix.addConstraint(1, ['A', 'B']);
  matrix.addConstraint(2, ['E', 'F']);
  matrix.addConstraint(3, ['D', 'E']);
  matrix.addConstraint(4, ['A', 'B', 'C']);
  matrix.addConstraint(5, ['C', 'D']);
  matrix.addConstraint(6, ['D', 'E']);
  matrix.addConstraint(7, ['A', 'E', 'F']);
  return matrix;
}

