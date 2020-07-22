const THIN_BORDER_STYLE = '1px solid';
const FAT_BORDER_STYLE = '3px solid';

const CHAR_0 = '0'.charCodeAt(0);
const CHAR_9 = '9'.charCodeAt(0);

const CELL_SIZE = 53;  // 50 + padding.

let grid, constraintManager;

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

  constraintManager = new ConstraintManager(grid);

  grid.setUpdateCallback((cellValues) => {
    // Solve.
    let solveFn = (
      solveTypeElem.value == 'all-possibilities'
        ? (v, c) => solver.solveAllPossibilities(v, c)
        : (v, c) => solver.solve(v, c));
    let result = solveFn(grid.getCellValues(), constraintManager.getConstraints());

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

class ConstraintDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  static makeDisplay(container) {
    let canvas = document.createElement('canvas');
    canvas.height = CELL_SIZE * 9;
    canvas.width = CELL_SIZE * 9;
    canvas.className = 'sudoku-grid-background';
    container.prepend(canvas);

    return new ConstraintDisplay(canvas);
  }

  static parseCell(cellId) {
    return [+cellId[1], +cellId[3]];
  }

  static cellCenter(cellId) {
    let row, col;
    [row, col] = ConstraintDisplay.parseCell(cellId);
    return [col*CELL_SIZE - CELL_SIZE/2, row*CELL_SIZE - CELL_SIZE/2];
  }

  drawThermometer(cells) {
    let ctx = this.ctx;

    if (cells.length < 2) throw(`Thermo too short: ${cells}`)

    let x, y;

    ctx.save();

    ctx.globalAlpha = 0.5;
    ctx.globalCompositeOperation = 'xor';

    // Draw the line.
    ctx.beginPath();
    cells.forEach((cell) => {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      ctx.lineTo(x, y);
    });
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(100, 100, 100)';
    ctx.stroke();

    // Draw the circle.
    ctx.beginPath();
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);
    ctx.arc(x, y, 15, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(100, 100, 100)';
    ctx.fill();

    ctx.restore();
  }
}

class ConstraintManager {
  constructor(grid) {
    this.constraints = [];
    this.grid = grid;

    this.display = ConstraintDisplay.makeDisplay(grid.container);

    grid.setSelectionCallback((selection) => {
      if (selection.length < 2) return;
      ConstraintManager.makeThermometerConstraints(selection).forEach((c) => {
        this.constraints.push(c);
      });
      this.display.drawThermometer(selection);

      this.grid.runUpdateCallback();
    });
  }

  static makeBinaryConstraint(id, cell1, cell2, fn) {
    let value = new Map();
    let set1 = [];
    let set2 = [];
    for (let i = 1; i < 10; i++) {
      set1.push(`${cell1}#${i}`);
      set2.push(`${cell2}#${i}`);
      value.set(`${cell1}#${i}`, i);
      value.set(`${cell2}#${i}`, i);
    }
    return {
      id: id,
      fn: (a, b) => fn(value.get(a), value.get(b)),
      set1: set1,
      set2: set2,
    }
  }

  static makeThermometerConstraints(cells) {
    let constraints = [];
    for (let i = 1; i < cells.length; i++) {
      constraints.push(
        ConstraintManager.makeBinaryConstraint(
          'thermo-'+i, cells[i-1], cells[i], (a, b) => a < b));
    }
    return constraints;
  };

  getConstraints() {
    return this.constraints;
  }
}

class SudokuGrid {
  constructor(container) {
    this.container = container;
    container.classList.add('sudoku-grid');

    this.cellMap = this._makeSudokuGrid(container);
    this._setUpSelection(container);
    this._setUpKeyBindings(container);
    this.setUpdateCallback();
    this.setSelectionCallback();
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn || (() => {});
  }

  setSelectionCallback(fn) {
    this.selectionCallback = fn || (() => {});
  }

  runUpdateCallback() {
    this.updateCallback(this);
  }

  _setUpSelection(container) {
    this.selection = new Set();
    let selection = this.selection;

    // Make the container selectable.
    container.tabIndex = 0;

    const addToSelection = (cell) => {
      if (cell.classList.contains('cell-input')) {
        cell.classList.add('selected');
        selection.add(cell);
      }
    };
    const clearSelection = () => {
      selection.forEach(e => e.classList.remove('selected'));
      selection.clear();
    };

    const mouseoverFn = (e) => addToSelection(e.target);

    container.addEventListener('mousedown', (e) => {
      clearSelection();
      container.addEventListener('mouseover', mouseoverFn);
      addToSelection(e.target);
      container.focus();
      e.preventDefault();
    });

    container.addEventListener('mouseup', (e) => {
      container.removeEventListener('mouseover', mouseoverFn);
      let selectedIds= [];
      selection.forEach(e => selectedIds.push(e.id));
      this.selectionCallback(selectedIds);
      e.preventDefault();
    });

    container.addEventListener('blur', clearSelection);
  }

  _setUpKeyBindings(container) {
    const getActiveElem = () => {
      if (this.selection.size != 1) return null;
      return this.selection.values().next().value;
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
        cellInput.tabIndex = 0;
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
