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

  grid.setUpdateCallback(() => {
    // grid.populateSolution(solveForcedSudokuGrid(grid));
    // grid.populateSolution(solveSudokuGrid(grid));
    grid.populateSolution(solveAllSudokuGrid(grid));
  });
};

class SudokuGrid {
  constructor(container) {
    this.container = container;
    this.cellMap = this._makeSudokuGrid(container);
    this._setUpKeyBindings(container);
    this.updateCallback = null;
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn;
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
      if (!elem.classList.contains('cell-input')) return;

      if (val) {
        elem.innerText = val;
      } else {
        elem.innerText = '';
      }

      if (this.updateCallback) {
        this.updateCallback(grid);
      }
    });
  }

  _styleCell(cell, row, col) {
    cell.className = 'cell cell-elem';
    cell.style.border = THIN_BORDER_STYLE;
    if (row%3 == 0) cell.style.borderTop = FAT_BORDER_STYLE;
    if (col%3 == 0) cell.style.borderLeft = FAT_BORDER_STYLE;
    if (row == 8) cell.style.borderBottom = FAT_BORDER_STYLE;
    if (col == 8) cell.style.borderRight = FAT_BORDER_STYLE;
  }

  _makeSudokuGrid(container) {
    let cellMap = {};
    let defaultSolution = this._formatMultiSolution('123456789');

    for (let i = 0; i < 9; i++) {
      let row = document.createElement('div');
      for (let j = 0; j < 9; j++) {
        let cell = document.createElement('div');
        this._styleCell(cell, i, j);

        let cellInput = document.createElement('div');
        cellInput.tabIndex = i*9 + j;
        cellInput.className = 'cell-input cell-elem';
        cell.appendChild(cellInput);
        cellMap[`R${i+1}C${j+1}`] = cellInput;

        let cellSolution = document.createElement('div');
        cellSolution.className = 'cell-solution cell-elem cell-multi-solution';
        cellSolution.innerText = defaultSolution;
        cell.appendChild(cellSolution);

        row.appendChild(cell);
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

  _getSolutionNode(cellId) {
    return this.cellMap[cellId].nextSibling;
  }

  clearSolution() {
    for (const cellId of Object.keys(this.cellMap)) {
      let node = this._getSolutionNode(cellId);
      node.innerText = '';
      node.classList.remove('cell-multi-solution');
    }
  }

  _formatMultiSolution(values) {
    let chars = Array(9*2-1).fill(' ');
    chars[3*2-1] = '\n';
    chars[6*2-1] = '\n';
    for (let c of values) {
      chars[c*2-2] = c;
    }
    return chars.join('');
  }

  populateSolution(solution) {
    this.clearSolution();
    let multiSolutionCells = new Set();

    for (const valueId of solution) {
      let cellId = valueId.substr(0, 4);
      let value = valueId[5];
      let node = this._getSolutionNode(cellId);
      if (node.innerText != '') {
        node.classList.add('cell-multi-solution');
        multiSolutionCells.add(cellId);
      }
      node.innerText += value;
    }

    // Format multi-solution nodes.
    for (const cellId of multiSolutionCells) {
      let node = this._getSolutionNode(cellId);
      node.innerText = this._formatMultiSolution(node.innerText);
    }
  }
}

const solveSudokuGrid = (grid) => {
  let result = (new SudokuSolver()).solve(grid.getCellValues());
  console.log(result);
  return result.values;
};

const solveAllSudokuGrid = (grid) => {
  let result = (new SudokuSolver()).solveAllPossibilities(grid.getCellValues());
  console.log(result);
  return result.values;
};

const solveForcedSudokuGrid = (grid) => {
  return (new SudokuSolver()).solveForced(grid.getCellValues());
};

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
