const THIN_BORDER_STYLE = '1px solid';
const FAT_BORDER_STYLE = '3px solid';

const CHAR_0 = '0'.charCodeAt(0);
const CHAR_9 = '9'.charCodeAt(0);

let grid = null;

const initPage = () => {
  let solver = new SudokuSolver();

  // Create grid.
  let container = document.getElementById('sudoku-grid');
  grid = new SudokuGrid(container);

  // Inputs.
  let clearGridElem = document.getElementById('clear-grid-button');
  clearGridElem.addEventListener('click', _ => grid.clearCellValues());

  let solveTypeElem = document.getElementById('solve-type-input');
  solveTypeElem.addEventListener('change', _ => grid.runUpdateCallback());

  // Outputs.
  let solveTimeElem = document.getElementById('solve-time-output');
  let backtrackOutputElem = document.getElementById('backtrack-output');
  let uniqueOutputElem = document.getElementById('unique-output');
  let validOutputElem = document.getElementById('valid-output');

  grid.setUpdateCallback((cellValues) => {
    // Solve.
    let solveFn = (
      solveTypeElem.value == 'all-possibilities'
        ? v => solver.solveAllPossibilities(v)
        : v => solver.solve(v));
    let result = solveFn(grid.getCellValues());

    // Update grid.
    grid.setSolution(result.values);

    // Update display panel.
    solveTimeElem.innerText = result.timeMs.toPrecision(3) + ' ms';
    backtrackOutputElem.innerText = result.numBacktracks;
    uniqueOutputElem.innerHTML = result.unique ? '&#10003;' : '&#10007;';
    validOutputElem.innerHTML = result.values.length ? '&#10003;' : '&#10007;';
  });
  grid.runUpdateCallback();
};

class SudokuGrid {
  constructor(container) {
    this.container = container;
    this.cellMap = this._makeSudokuGrid(container);
    this._setUpKeyBindings(container);
    this.setUpdateCallback();
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn || (() => {});
  }

  runUpdateCallback() {
    this.updateCallback(this);
  }

  _setUpKeyBindings(container) {
    const getActiveElem = () => {
      let elem = document.activeElement;
      if (elem == null) return null;
      if (!elem.classList.contains('cell-input')) return null;
      return elem;
    };

    const setActiveCellValue = (value) => {
      let elem = getActiveElem();
      if (!elem) return;

      elem.innerText = value || '';

      this.updateCallback(this);
    };

    const moveActiveCell = (dr, dc) => {
      let elem = getActiveElem();
      if (!elem) return;

      let row = +elem.id[1];
      let col = +elem.id[3];
      row = (row+dr+8)%9+1;
      col = (col+dc+8)%9+1;

      document.getElementById(`R${row}C${col}`).focus();
    };

    container.addEventListener('keydown', event => {
      // Number key.
      if (event.keyCode > CHAR_0 && event.keyCode <= CHAR_9) {
        setActiveCellValue(event.key);
        return;
      }

      switch (event.key) {
        // Delete key.
        case 'Backspace':
        case '0':
          setActiveCellValue(null);
          return;

        // Arrow keys.
        case 'ArrowLeft':
          moveActiveCell(0, -1);
          return;
        case 'ArrowRight':
          moveActiveCell(0, 1);
          return;
        case 'ArrowUp':
          moveActiveCell(-1, 0);
          return;
        case 'ArrowDown':
          moveActiveCell(1, 0);
          return;
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

    for (let i = 0; i < 9; i++) {
      let row = document.createElement('div');
      for (let j = 0; j < 9; j++) {
        let cell = document.createElement('div');
        let cellId = `R${i+1}C${j+1}`;
        this._styleCell(cell, i, j);

        let cellInput = document.createElement('div');
        cellInput.tabIndex = '0';
        cellInput.className = 'cell-input cell-elem';
        cellInput.id = cellId;
        cell.appendChild(cellInput);
        cellMap[cellId] = cellInput;

        let cellSolution = document.createElement('div');
        cellSolution.className = 'cell-solution cell-elem';
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

  _clearCellValues() {
    for (let cell of Object.values(this.cellMap)) {
      cell.innerText = '';
    }
  }

  clearCellValues() {
    this._clearCellValues();
    this.updateCallback(this);
  }

  setCellValues(valueIds) {
    this._clearCellValues();
    for (let valueId of valueIds) {
      let parsedValueId = this._parseValueId(valueId);
      let cellId = parsedValueId.cellId;
      let value = parsedValueId.value;
      this.cellMap[cellId].innerText = value;
    }
    this.updateCallback(this);
  }

  _parseValueId(valueId) {
    return {
      cellId: valueId.substr(0, 4),
      value: valueId[5],
    };
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

  setSolution(solution) {
    this.clearSolution();
    let multiSolutionCells = new Set();

    for (const valueId of solution) {
      let parsedValueId = this._parseValueId(valueId);
      let cellId = parsedValueId.cellId;
      let value = parsedValueId.value;
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
