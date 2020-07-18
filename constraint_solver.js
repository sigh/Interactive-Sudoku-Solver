class Node {
  constructor() {
    this.left = this;
    this.right = this;
    this.up = this;
    this.down = this;
    this.column = null;
    this.row = null;
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
    this.column.count -= 1;
  }

  restoreToColumn() {
    this.up.down = this;
    this.down.up = this;
    this.column.count += 1;
  }

  appendToColumn(column) {
    this.up = column.up;
    this.down = column;
    column.up.down = this;
    column.up = this;
    this.column = column;
    this.column.count += 1;
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
    this.count = 0;
    this.isColumnHeader = true;
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

    this.count = 0;

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
  }

  findMinColumn() {
    let minNode = null;
    let minValue = Infinity;

    for (let node = this.left; node != this; node = node.left) {
      if (node.count < minValue) {
        minNode = node;
        minValue = node.count;
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

class ContraintMatrix {
  constructor(values) {
    this.matrix = new Matrix(values);
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
    row.remove();
    row.forEach((rowNode) => {
      rowNode.removeFromColumn();
      this._removeConflictingColumn(rowNode.column);
    });
  }

  _removeConflictingColumn(column) {
    column.remove();
    column.forEach((node) => {
      node.removeFromRow();
      node.row.remove();
      node.row.forEach((rowNode) => rowNode.removeFromColumn());
    });
  }

  // To restore we need to do everything in exactly the reverse order.
  _restoreCandidateRow(row) {
    row.forEachRev((rowNode) => {
      this._restoreConflictingColumn(rowNode.column);
      rowNode.restoreToColumn();
    });
    row.restore();
  }

  _restoreConflictingColumn(column) {
    column.forEachRev((node) => {
      node.row.forEachRev((rowNode) => rowNode.restoreToColumn());
      node.row.restore();
      node.restoreToRow();
    });
    column.restore();
  }

  solve() {
    let matrix = this.matrix;

    let solutionRows = [];
    let numBacktracks = 0;
    let startTime = performance.now();

    const _solve = () => {
      let stack = [matrix.findMinColumn()];

      while (stack.length) {
        let node = stack.pop();

        // If the node is not a column header then we are backtracking, so
        // restore the state.
        if (!node.isColumnHeader) {
          this._restoreCandidateRow(node.row);
          numBacktracks += 1;
        }
        // Try the next node in the column.
        node = node.down;

        // If we have tried all the nodes, then backtrack.
        if (node.isColumnHeader) continue;

        stack.push(node);
        this._removeCandidateRow(node.row);

        // If we have no more constraints, then the puzzle is solved.
        if (!matrix.hasColumns()) {
          return stack.map(e => e.row.id);
        }
        // Find the column with the least number of candidates, to speed up
        // the search.
        let column = matrix.findMinColumn();
        // If a column has no candidates, then backtrack.
        if (column.count == 0) continue;
        stack.push(column);
      }
    };

    let solution = _solve();
    let endTime = performance.now();
    return {
      values: solution,
      numBacktracks: numBacktracks,
      timeMs: endTime - startTime,
    }
  }
}

const makeTestMatrix = () => {
  let matrix = new ContraintMatrix(['A', 'B', 'C', 'D', 'E', 'F']);
  matrix.addConstraint(1, ['A', 'B']);
  matrix.addConstraint(2, ['E', 'F']);
  matrix.addConstraint(3, ['D', 'E']);
  matrix.addConstraint(4, ['A', 'B', 'C']);
  matrix.addConstraint(5, ['C', 'D']);
  matrix.addConstraint(6, ['D', 'E']);
  matrix.addConstraint(7, ['A', 'E', 'F']);
  return matrix;
}

