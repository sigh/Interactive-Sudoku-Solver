class Node {
  constructor() {
    this.left = this;
    this.right = this;
    this.up = this;
    this.down = this;
    this.column = null;
    this.row = null;
  }

  removeFromColumn() {
    this.left.right = this.right;
    this.right.left = this.left;
    this.column.count -= 1;
  }

  restoreToColumn() {
    this.left.right = this;
    this.right.left = this;
    this.column.count += 1;
  }

  removeFromRow() {
    this.up.down = this.down;
    this.down.up = this.up;
  }

  restoreToRow() {
    this.up.down = this;
    this.down.up = this;
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
    let minValue = this.count + 1;

    for (let node = this.left; node != this; node = node.left) {
      if (node.count < minValue) {
        minNode = node;
        minValue = this.count;
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

  _removeCandidateRow(row) {
    row.remove();
    row.forEach((rowNode) => {
      rowNode.removeFromColumn();
      _removeConflictingColumn(rowNode.column);
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

  _restoreCandidateRow(row) {
    row.restore();
    row.forEach((rowNode) => {
      rowNode.restoreToColumn();
      _restoreConflictingColumn(rowNode.column);
    });
  }

  _restoreConflictingColumn(column) {
    column.forEach((node) => {
      node.row.forEach((rowNode) => rowNode.restoreToColumn());
      node.row.restore();
      node.restoreToRow();
    });
    column.restore();
  }

  solve() {
    let solution = [];
    let stack = [];
    let columns = [];
    let matrix = this.matrix;


    let solutionRows = [];
    let recSolve = () => {
      if (!matrix.hasColumns()) {
        return true;
      }
      let column = matrix.findMinColumn();
      if (column.count == 0) {
        return false;
      }

      for (let node = column.down; node != column; node = node.down) {
        let row = node.row;
        _removeCandidateRow(row);
        let result = recSolve();
        _restoreCandidateRow(row);
        if (result) return true;
      }
      return false;
    }
  }
}

let makeTestMatrix = () => {
  let matrix = new ContraintMatrix(['A', 'B', 'C', 'D', 'E', 'F']);
  matrix.addConstraint(1, ['A', 'B']);
  matrix.addConstraint(2, ['E', 'F']);
  matrix.addConstraint(3, ['D', 'E']);
  matrix.addConstraint(4, ['A', 'B', 'C']);
  matrix.addConstraint(5, ['C', 'D']);
  matrix.addConstraint(6, ['D', 'E']);
  matrix.addConstraint(7, ['A', 'B', 'E', 'F']);
  return matrix;
}

let valueId = (row, col, n) => {
  return id = `R${row}C${col}#${n}`;
}

let makeBaseSudokuConstraints = () => {
  // Create constrained values.
  let valueMap = {};
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      for (let n = 0; n < 9; n++) {
        let id = valueId(i, j, n);
        valueMap[id] = [i, j, n];
      }
    }
  }

  let constraints = new ContraintMatrix(Object.keys(valueMap));

  // Add constraints.

  // Each cell can only have one value.
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      let values = [];
      for (let n = 0; n < 9; n++) {
        values.push(valueId(i, j, n));
      }
      constraints.addConstraint(`R${i}C${j}`, values);
    }
  }

  // Each row can only have one of each value.
  for (let i = 0; i < 9; i++) {
    for (let n = 0; n < 9; n++) {
      let values = [];
      for (let j = 0; j < 9; j++) {
        values.push(valueId(i, j, n));
      }
      constraints.addConstraint(`R${i}#${n}`, values);
    }
  }

  // Each column can only have one of each value.
  for (let j = 0; j < 9; j++) {
    for (let n = 0; n < 9; n++) {
      let values = [];
      for (let i = 0; i < 9; i++) {
        values.push(valueId(i, j, n));
      }
      constraints.addConstraint(`C${j}#${n}`, values);
    }
  }

  // Each box can only have one value.
  for (let b = 0; b < 9; b++) {
    let i = b/3|0;
    let j = b%3;
    for (let n = 0; n < 9; n++) {
      let values = [];
      for (let c = 0; c < 9; c++) {
        values.push(valueId(3*i+c%3, 3*j+(c/3|0), n));
      }
      constraints.addConstraint(`B${i}${j}#${n}`, values);
    }
  }

  return constraints;
}
