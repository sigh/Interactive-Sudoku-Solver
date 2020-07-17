const CELL_SIZE = 50;
const THIN_BORDER_STYLE = '1px solid';
const FAT_BORDER_STYLE = '3px solid';

const CHAR_0 = '0'.charCodeAt(0);
const CHAR_9 = '9'.charCodeAt(0);

let grid = null;

const initGrid = () => {
  let container = document.createElement('div');
  document.body.appendChild(container);

  grid = new SudokuGrid(container);
};

class SudokuGrid {
  constructor(container) {
    this.container = container;
    this.cellMap = this._makeSudokuGrid(container);
    this._setUpKeyBindings(container);
  }

  _setUpKeyBindings(container) {
    container.addEventListener('keydown', event => {
      let val = null;
      if (event.keyCode >= CHAR_0 && event.keyCode <= CHAR_9) {
        // Number key.
        val = event.keyCode - CHAR_0;
      } else if (event.keyCode == 8) {
        // Delete key.
        val = null;
      } else {
        // Uninteresting key.
        return;
      }

      let elem = document.activeElement;
      if (elem == null) return;
      if (elem.className != 'inner-cell') return;

      if (val) {
        elem.innerText = val;
      } else {
        elem.innerText = '';
      }
    });
  }

  _styleCell(cell, row, col) {
    cell.className = 'cell';
    cell.style.border = THIN_BORDER_STYLE;
    if (row%3 == 0) cell.style.borderTop = FAT_BORDER_STYLE;
    if (col%3 == 0) cell.style.borderLeft = FAT_BORDER_STYLE;
    if (row == 8) cell.style.borderBottom = FAT_BORDER_STYLE;
    if (col == 8) cell.style.borderRight = FAT_BORDER_STYLE;
  }

  _makeSudokuGrid(container) {
    let cellMap = {};

    for (let i = 0; i < 9; i++) {
      let row = document.createElement('div');
      for (let j = 0; j < 9; j++) {
        let cell = document.createElement('div');
        this._styleCell(cell, i, j);
        let cellValue = document.createElement('div');
        cellValue.tabIndex = i*9 + j;
        cellValue.className = 'inner-cell';
        cell.appendChild(cellValue);
        row.appendChild(cell);
        cellMap[`R${i+1}C${j+1}`] = cellValue;
      }
      container.appendChild(row);
    }

    return cellMap;
  }

  getCellValues() {
    let values = [];
    for (let [key, cell] of Object.entries(this.cellMap)) {
      let value = cell.innerText;
      if (value){
        values.push(`${key}#${value}`);
      }
    }
    return values;
  }
}

const solveSudokuGrid = (grid) => {
  let matrix = makeBaseSudokuConstraints();
  addFixedSquares(matrix, grid.getCellValues());
  return matrix.solve();
};

const addFixedSquares = (baseContraints, fixedSquares) => {
  for (const valueId of fixedSquares) {
    baseContraints.addConstraint(`fixed_${valueId}`, [valueId]);
  }
};

const makeBaseSudokuConstraints = () => {
  const valueId = (row, col, n) => {
    return id = `R${row+1}C${col+1}#${n+1}`;
  }

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

const showSudokuSolution = (solution) => {
  const parseValueId = (valueId) => ({
    row: parseInt(valueId[1])-1,
    column: parseInt(valueId[3])-1,
    value: parseInt(valueId[5]),
  });

  let grid = [...Array(9)].map(e => Array(9));
  for (const valueId of solution) {
    let value = parseValueId(valueId);
    grid[value.row][value.column] = value.value;
  }

  return grid;
}
