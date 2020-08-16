const THIN_BORDER_STYLE = '1px solid';
const FAT_BORDER_STYLE = '3px solid';

const CHAR_0 = '0'.charCodeAt(0);
const CHAR_9 = '9'.charCodeAt(0);

const CELL_SIZE = 52;

// Make these variables global so that we can easily access them from the
// console.
let grid, constraintManager, controller;

const initPage = () => {
  // Create grid.
  let container = document.getElementById('sudoku-grid');
  grid = new SudokuGrid(container);
  constraintManager = new ConstraintManager(grid);

  controller = new SolutionController(constraintManager, grid);
  controller.update();
};

// We never need more than 5 colors since the max degree of the graph is 4.
const KILLER_CAGE_COLORS = [
  'green',
  'red',
  'blue',
  'yellow',
  'purple',
  'orange',
  'cyan',
  'brown',
  'black',
];
class ConstraintDisplay {
  constructor(svg) {
    this.svg = svg;
    this._diagonals = [null, null];
    this.killerCellColors = new Map();
    this.killerCages = new Map();
  }

  static makeElem(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  static makeDisplay(container) {
    let svg = ConstraintDisplay.makeElem('svg');
    svg.setAttribute('height', CELL_SIZE * 9);
    svg.setAttribute('width', CELL_SIZE * 9);
    svg.classList.add('sudoku-grid-background');
    container.prepend(svg);

    return new ConstraintDisplay(svg);
  }

  static parseCell(cellId) {
    return [+cellId[1], +cellId[3]];
  }

  static cellCenter(cellId) {
    let row, col;
    [row, col] = ConstraintDisplay.parseCell(cellId);
    return [col*CELL_SIZE - CELL_SIZE/2, row*CELL_SIZE - CELL_SIZE/2];
  }

  clear() {
    let svg = this.svg;
    while (svg.lastChild) {
      svg.removeChild(svg.lastChild);
    }
    this.killerCellColors = new Map();
    this.killerCages = new Map();
  }

  removeItem(item) {
    this.svg.removeChild(item);
    if (this.killerCages.has(item)) {
      for (const cellId of this.killerCages.get(item)) {
        this.killerCellColors.delete(cellId);
      }
      this.killerCages.delete(item);
    }
  }

  static _addTextBackground(elem) {
    let bbox = elem.getBBox();
    let rect = ConstraintDisplay.makeElem('rect');

    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);

    elem.parentNode.insertBefore(rect, elem);
    return rect;
  }

  _chooseKillerCageColor(cellIds) {
    // Use a greedy algorithm to choose the graph color.
    let conflictingColors = new Set();
    for (const cellId of cellIds) {
      let row, col;
      [row, col] = ConstraintDisplay.parseCell(cellId);
      // Lookup all  adjacent cells, it doesn't matter if they valid or not.
      conflictingColors.add(this.killerCellColors.get(`R${row}C${col+1}`));
      conflictingColors.add(this.killerCellColors.get(`R${row}C${col-1}`));
      conflictingColors.add(this.killerCellColors.get(`R${row+1}C${col}`));
      conflictingColors.add(this.killerCellColors.get(`R${row-1}C${col}`));
    }
    // Return the first color that doesn't conflict.
    for (const color of KILLER_CAGE_COLORS) {
      if (!conflictingColors.has(color)) return color;
    }
    // Otherwse select a random color.
    return `rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;
  }

  drawKillerCage(cells, sum) {
    const cellWidth = CELL_SIZE-1;
    let x,y;

    let cage = ConstraintDisplay.makeElem('svg');
    let color = this._chooseKillerCageColor(cells);

    for (const cell of cells) {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      let path = ConstraintDisplay.makeElem('path');
      let directions = [
        'M', x-cellWidth/2+1, y-cellWidth/2+1,
        'l', 0, cellWidth,
        'l', cellWidth, 0,
        'l', 0, -cellWidth,
        'l', -cellWidth, 0,
      ];
      path.setAttribute('d', directions.join(' '));
      path.setAttribute('fill', color);
      path.setAttribute('opacity', '0.1');
      cage.appendChild(path);
    }
    this.killerCages.set(cage, [...cells]);
    cells.forEach(cell => this.killerCellColors.set(cell, color));

    // Draw the sum in the top-left most cell. Luckly, this is the sort order.
    cells.sort();
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);

    let text = ConstraintDisplay.makeElem('text');
    text.appendChild(document.createTextNode(sum));
    text.setAttribute('x', x - cellWidth/2 + 1);
    text.setAttribute('y', y - cellWidth/2 + 2);
    text.setAttribute('dominant-baseline', 'hanging');
    text.setAttribute('style',
      'font-size: 10; font-family: monospace; font-weight: bold;');
    cage.append(text);
    this.svg.append(cage);

    let textBackground = ConstraintDisplay._addTextBackground(text);
    textBackground.setAttribute('fill', 'rgb(200, 200, 200)');

    return cage;
  }

  drawThermometer(cells) {
    if (cells.length < 2) throw(`Thermo too short: ${cells}`)

    let thermo = ConstraintDisplay.makeElem('svg');
    thermo.setAttribute('fill', 'rgb(200, 200, 200)');
    thermo.setAttribute('stroke', 'rgb(200, 200, 200)');

    let x, y;
    // Draw the circle.
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);
    let circle = ConstraintDisplay.makeElem('circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 15);
    thermo.appendChild(circle);

    // Draw the line.
    let directions = [];
    cells.forEach((cell) => {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      directions.push('L');
      directions.push(x);
      directions.push(y);
    });
    directions[0] = 'M';  // Replace the first direction to a move.
    let path = ConstraintDisplay.makeElem('path');
    path.setAttribute('d', directions.join(' '));
    path.setAttribute('stroke-width', 15);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'transparent');
    thermo.appendChild(path);

    this.svg.append(thermo);

    return thermo;
  }

  drawDiagonal(direction) {
    let size = CELL_SIZE*9;
    let line = ConstraintDisplay.makeElem('path');
    let directions = [
      'M', 0, direction > 0 ? size : 0,
      'L', size, direction > 0 ? 0 : size,
    ];
    line.setAttribute('d', directions.join(' '));
    line.setAttribute('stroke-width', 1);
    line.setAttribute('fill', 'transparent');
    line.setAttribute('stroke', 'rgb(255, 0, 0)');

    this.svg.appendChild(line);
    this._diagonals[direction > 0] = line;

    return line;
  }

  removeDiagonal(direction) {
    let item = this._diagonals[direction > 0];
    if (item) this.removeItem(item);
  }
}

class ConstraintManager {
  constructor(grid) {
    this.configs = [];
    this.grid = grid;
    this._checkboxes = {};
    grid.setUpdateCallback(() => this.runUpdateCallback());

    this.display = ConstraintDisplay.makeDisplay(grid._container);
    this.setUpdateCallback();

    this._setUpPanel();
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn || (() => {});
  }

  runUpdateCallback() {
    this.updateCallback(this);
  }

  _setUpPanel() {
    this._panel = document.getElementById('displayed-constraints');

    this._checkboxes.antiKnight = document.getElementById('anti-knight-input');
    this._checkboxes.antiKing = document.getElementById('anti-king-input');
    this._checkboxes.diagonalPlus = document.getElementById('diagonal-plus-input');
    this._checkboxes.diagonalMinus = document.getElementById('diagonal-minus-input');
    this._checkboxes.antiKnight.onchange = e => this.runUpdateCallback();
    this._checkboxes.antiKing.onchange = e => this.runUpdateCallback();
    this._checkboxes.diagonalPlus.onchange = e => {
      if (this._checkboxes.diagonalPlus.checked) {
        this.display.drawDiagonal(1);
      } else {
        this.display.removeDiagonal(1);
      }
      this.runUpdateCallback();
    }
    this._checkboxes.diagonalMinus.onchange = e => {
      if (this._checkboxes.diagonalMinus.checked) {
        this.display.drawDiagonal(-1);
      } else {
        this.display.removeDiagonal(-1);
      }
      this.runUpdateCallback();
    }

    this._selectionFrom = document.getElementById('multi-cell-constraint-input');
    this.grid.selection.setCallback((selection) => {
      let disabled = (selection.length < 2);
      this._selectionFrom.firstElementChild.disabled = disabled;
      // Focus on the submit button so that that we can immediately press enter.
      if (!disabled) {
        this._selectionFrom.querySelector('button[type=submit]').focus();
      }
    });
    this._selectionFrom.onsubmit = e => {
      this._addConstraintFromForm();
      return false;
    }
    this.grid.selection.addSelectionPreserver(this._selectionFrom);

    let freeInputForm = document.getElementById('freeform-constraint-input');
    freeInputForm.onsubmit = e => {
      let input = (new FormData(freeInputForm)).get('freeform-input');
      this.loadFromText(input);
      return false;
    }

    document.getElementById('clear-constraints-button').onclick = () => this.clear();
  }

  loadFromText(input) {
    // Avoid updating until after the constraints are drawn.
    // TODO: Do this in a more principled way.
    let updateCallback = this.updateCallback;
    this.setUpdateCallback();

    this.clear();
    let constraint = SudokuConstraint.fromText(input);
    if (constraint) this.loadConstraint(constraint);

    window.setTimeout(() => {
      this.setUpdateCallback(updateCallback);
      this.runUpdateCallback();
    }, 10);
  }

  loadConstraint(constraint) {
    let args = constraint.args;
    let config;
    switch (constraint.type()) {
      case 'FixedCells':
        this.grid.setCellValues(args.values);
        break;
      case 'Thermo':
        config = {
          cells: args.cells,
          name: `Themometer [len: ${args.cells.length}]`,
          constraint: constraint,
          displayElem: this.display.drawThermometer(args.cells),
        };
        this._addToPanel(config);
        this.configs.push(config);
        break;
      case 'Sum':
        config = {
          cells: args.cells,
          name: `Killer cage [sum: ${args.sum}]`,
          constraint: constraint,
          displayElem: this.display.drawKillerCage(args.cells, args.sum),
        };
        this._addToPanel(config);
        this.configs.push(config);
        break;
      case 'AntiKnight':
        this._checkboxes.antiKnight.checked = true;
        break;
      case 'AntiKing':
        this._checkboxes.antiKing.checked = true;
        break;
      case 'Diagonal':
        // TODO: The code for handling constraints is littered around this
        // class and duplicated. Consolidate it into one place.
        if (args.direction > 0) {
          this._checkboxes.diagonalPlus.checked = true;
          this.display.drawDiagonal(1);
        } else {
          this._checkboxes.diagonalMinus.checked = true;
          this.display.drawDiagonal(-1);
        }
        break;
      case 'Set':
        for (let constraint of args.constraints) {
          this.loadConstraint(constraint);
        }
        break;
    }
    this.runUpdateCallback();
  }

  _addConstraintFromForm() {
    let cells = this.grid.selection.getCells().map(e => e.id);
    if (cells.length < 2) throw('Selection too short.');

    let formData = new FormData(this._selectionFrom);

    let constraint;
    switch (formData.get('constraint-type')) {
      case 'cage':
        constraint = new SudokuConstraint.Sum(
          {cells: cells, sum: +formData.get('sum')});
        this.loadConstraint(constraint);
        break;
      case 'thermo':
        constraint = new SudokuConstraint.Thermo({cells: cells});
        this.loadConstraint(constraint);
        break;
    }

    this.grid.selection.updateSelection([]);
    this.runUpdateCallback();
  }

  _removeConstraint(config) {
    let index = this.configs.indexOf(config);
    this.configs.splice(index, 1);
    this.display.removeItem(config.displayElem);
    this._panel.removeChild(config.panelItem);
  }

  _addToPanel(config) {
    let panelItem = document.createElement('div');
    panelItem.className = 'constraint-item';

    let panelButton = document.createElement('button');
    panelButton.innerHTML = '&#x00D7;';
    panelItem.appendChild(panelButton);

    let panelLabel = document.createElement('span');
    panelLabel.textContent = config.name;
    panelItem.appendChild(panelLabel);

    config.panelItem = panelItem;
    panelButton.addEventListener('click', () => {
      this._removeConstraint(config);
      this.runUpdateCallback();
    });

    panelItem.addEventListener('mouseover', () => {
      config.displayElem.classList.add('highlight-constraint');
    });
    panelItem.addEventListener('mouseout', () => {
      config.displayElem.classList.remove('highlight-constraint');
    });

    this._panel.appendChild(panelItem);
  }

  getConstraints() {
    let constraints = this.configs.map(c => c.constraint);
    if (this._checkboxes.antiKnight.checked) {
      constraints.push(new SudokuConstraint.AntiKnight());
    }
    if (this._checkboxes.antiKing.checked) {
      constraints.push(new SudokuConstraint.AntiKing());
    }
    if (this._checkboxes.diagonalPlus.checked) {
      constraints.push(new SudokuConstraint.Diagonal({direction: 1}));
    }
    if (this._checkboxes.diagonalMinus.checked) {
      constraints.push(new SudokuConstraint.Diagonal({direction: -1}));
    }
    constraints.push(
      new SudokuConstraint.FixedCells(
        {values: this.grid.getCellValues()}));

    return new SudokuConstraint.Set({constraints: constraints});
  }

  clear() {
    this.display.clear();
    this._panel.innerHTML = '';
    for (const input of Object.values(this._checkboxes)) {
      input.checked = false;
    }
    this.configs = [];
    this.grid.clearCellValues()
    this.grid.setSolution();
    this.runUpdateCallback();
  }
}

class Selection {
  constructor(container) {
    this._selection = new Set();
    this._selectionPreservers = [container];
    let selection = this._selection;
    this.setCallback();

    // Make the container selectable.
    container.tabIndex = 0;

    const mouseoverFn = (e) => this._addToSelection(e.target);
    const outsideClickListener = e => {
      // Don't do anything if the click is inside one of the elements where
      // we want to retain clicks.
      for (const elem of this._selectionPreservers) {
        if (elem.contains(e.target)) return;
      }
      // Otherwise clear the selection.
      this._clearSelection();
      document.body.removeEventListener('click', outsideClickListener);
    };

    container.addEventListener('mousedown', (e) => {
      // If the shift key is pressed, continue adding to the selection.
      if (!e.shiftKey) {
        this._clearSelection();
      }
      container.addEventListener('mouseover', mouseoverFn);
      document.body.addEventListener('click', outsideClickListener);
      this._addToSelection(e.target);
      container.focus();
      e.preventDefault();
    });

    container.addEventListener('mouseup', (e) => {
      container.removeEventListener('mouseover', mouseoverFn);
      this._runCallback();
      e.preventDefault();
    });
  }

  updateSelection(cellIds) {
    this._clearSelection();
    cellIds.forEach(c => this._addToSelection(document.getElementById(c)));
    this._runCallback();
  }

  addSelectionPreserver(elem) {
    this._selectionPreservers.push(elem);
  }

  setCallback(fn) {
    this.callback = fn || (() => {});
  }

  getCells() {
    return [...this._selection];
  }

  _runCallback() {
    let selectedIds = [];
    this._selection.forEach(e => selectedIds.push(e.id));
    this.callback(selectedIds);
  }

  _addToSelection(cell) {
    if (cell.classList.contains('cell-input')) {
      cell.parentNode.classList.add('selected');
      this._selection.add(cell);
    }
  }

  _clearSelection() {
    this._selection.forEach(e => e.parentNode.classList.remove('selected'));
    this._selection.clear();
    this._runCallback();
  }
}

class SudokuGrid {
  constructor(container) {
    this._container = container;
    container.classList.add('sudoku-grid');
    this._solutionValues = [];

    this._cellMap = this._makeSudokuGrid(container);
    this.selection = new Selection(container);
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
      let cells = this.selection.getCells();
      if (cells.length != 1) return null;
      return cells[0];
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


      this.selection.updateSelection([`R${row}C${col}`]);
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
    let cellMap = new Map();

    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        let cell = document.createElement('div');
        let cellId = `R${i+1}C${j+1}`;
        this._styleCell(cell, i, j);

        let cellInput = document.createElement('div');
        cellInput.tabIndex = 0;
        cellInput.className = 'cell-input cell-elem';
        cellInput.id = cellId;
        cell.appendChild(cellInput);
        cellMap.set(cellId, cellInput);

        let cellSolution = document.createElement('div');
        cellSolution.className = 'cell-solution cell-elem';
        cell.appendChild(cellSolution);

        container.appendChild(cell);
      }
    }

    return cellMap;
  }

  getCellValues() {
    let values = [];
    for (let [key, cell] of this._cellMap) {
      let value = cell.innerText;
      if (value){
        values.push(`${key}#${value}`);
      }
    }
    return values;
  }

  _clearCellValues() {
    for (let cell of this._cellMap.values()) {
      cell.textContent = '';
    }
  }

  clearCellValues() {
    this._clearCellValues();
    this.updateCallback();
  }

  setCellValues(valueIds) {
    this._clearCellValues();
    for (let valueId of valueIds) {
      let parsedValueId = this._parseValueId(valueId);
      let cellId = parsedValueId.cellId;
      let value = parsedValueId.value;
      this._cellMap.get(cellId).textContent = value;
    }
    this.updateCallback();
  }

  _parseValueId(valueId) {
    return {
      cellId: valueId.substr(0, 4),
      value: valueId[5],
    };
  }

  *_solutionNodes() {
    for (const [cellId, cell] of this._cellMap) {
      yield [cellId, cell.nextSibling];
    }
  }

  _formatMultiSolution(values) {
    let chars = Array(9*2-1).fill(' ');
    chars[3*2-1] = '\n';
    chars[6*2-1] = '\n';
    for (const v of values) {
      chars[v*2-2] = v;
    }
    return chars.join('');
  }

  // Display solution on grid.
  //  - If solution contains mutiple values for single cell, they will be shown
  //    as pencil marks.
  //  - Anything in pencilmarks will always be shown as pencil marks.
  setSolution(solution, pencilmarks) {
    pencilmarks = pencilmarks || [];
    solution = solution || [];
    this._solutionValues = [];

    // If we have no solution, just hide it instead.
    // However, we wait a bit so that we don't fliker if the solution is updated
    // again immediatly.
    if (!solution.length && !pencilmarks.length) {
      window.setTimeout(() => {
        // Ensure there is still no solution.
        if (this._solutionValues.length == 0) {
          this._container.classList.add('hidden-solution');
        }
      }, 100);
      return;
    }

    let cellValues = new Map();
    let pencilmarkCell = new Set();

    const handleValue = (valueId) => {
      let parsedValueId = this._parseValueId(valueId);
      let cellId = parsedValueId.cellId;
      let value = parsedValueId.value;
      this._solutionValues.push(valueId);

      if (!cellValues.has(cellId)) cellValues.set(cellId, []);
      cellValues.get(cellId).push(value);
      return cellId;
    };
    for (const valueId of solution) {
      handleValue(valueId);
    }
    for (const valueId of pencilmarks) {
      let cellId = handleValue(valueId);
      pencilmarkCell.add(cellId);
    }

    for (const [cellId, node] of this._solutionNodes()) {
      let values = cellValues.get(cellId);
      if (!values) {
        node.textContent = '';
      } else if (values.length == 1 && !pencilmarkCell.has(cellId)) {
        node.textContent = values[0];
        node.classList.remove('cell-multi-solution');
      } else {
        node.textContent = this._formatMultiSolution(values);
        node.classList.add('cell-multi-solution');
      }
    }
    this._container.classList.remove('hidden-solution');
  }

  getSolutionValues() {
    return this._solutionValues;
  }
}

class SolutionController {
  constructor(constraintManager, grid) {
    this._solver = null;
    this._constraintManager = constraintManager;
    this._grid = grid;
    constraintManager.setUpdateCallback(collapseFnCalls(() => this.update()));

    this._elements = {
      start: document.getElementById('solution-start'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      control: document.getElementById('solution-control-panel'),
      stepOutput: document.getElementById('solution-step-output'),
      mode: document.getElementById('solve-mode-input'),
      stateOutput: document.getElementById('state-output'),
      solving: document.getElementById('solving-indicator'),
      error: document.getElementById('error-output'),
      stop: document.getElementById('stop-solver'),
    }

    this._elements.mode.onchange = () => this.update();
    this._elements.stop.onclick = () => {
      this._terminateSolver();
      this._setError('Aborted');
      this._setSolving(false);
    }

    this._setUpKeyBindings();
  }

  _setUpKeyBindings() {
    document.addEventListener('keydown', event => {
      switch (event.key) {
        case 'n':
          this._elements.forward.click();
          break;
        case 'p':
          this._elements.back.click();
          break;
        case 's':
          this._elements.start.click();
          break;
      }
    });
  }

  _terminateSolver() {
    if (this._solver) this._solver.terminate();
  }

  async _replaceSolver() {
    this._terminateSolver();

    let constraints = this._constraintManager.getConstraints();
    this._solver = await SolverProxy.make(
      constraints, state => this._displayState(state));

    return this._solver;
  }

  async update() {
    this._elements.control.style.visibility = (
      this._elements.mode.value == 'all-possibilities' ? 'hidden' : 'visible');
    this._setSolving(true);
    this._grid.setSolution();

    try {
      let solver = await this._replaceSolver();

      switch (this._elements.mode.value) {
        case 'all-possibilities':
          let result = await solver.solveAllPossibilities();
          this._grid.setSolution(result);
          this._setSolving(false);
          break;
        case 'one-solution':
          this._runSolutionIterator(solver);
          break;
        case 'step-by-step':
          this._runStepIterator(solver);
          break;
      }
    } catch(e) {
      this._setError(e);
      this._setSolving(false);
    }
  }

  _setError(text) {
    this._elements.error.textContent = text || '';
  }

  _setSolving(isSolving) {
    if (isSolving) {
      this._elements.stop.disabled = false;
      this._elements.start.disabled = true;
      this._elements.forward.disabled = true;
      this._elements.back.disabled = true;
      this._elements.solving.style.visibility = 'visible';
      this._setError();
    } else {
      this._elements.stop.disabled = true;
      this._elements.start.disabled = false;
      this._elements.forward.disabled = false;
      this._elements.back.disabled = false;
      this._elements.solving.style.visibility = 'hidden';
    }
  }

  static _addStateVariable(container, label, value) {
    let elem = document.createElement('div');
    elem.textContent = `${label}: ${value}`;
    container.appendChild(elem);
  }

  _displayState(state) {
    let counters = state.counters;

    let container = this._elements.stateOutput;
    container.innerHTML = '';

    let solutionText = counters.solutions + (state.done ? '' : '+');
    SolutionController._addStateVariable(
      container, '# Solutions', solutionText);

    SolutionController._addStateVariable(container,
      '# Guesses', counters.guesses);
    SolutionController._addStateVariable(container,
      '# Backtracks', counters.nodesSearched - counters.columnsSearched);
    SolutionController._addStateVariable(container,
      '# Nodes searched', counters.nodesSearched);
    SolutionController._addStateVariable(container,
      '# Constraints searched', counters.columnsSearched);

    SolutionController._addStateVariable(
      container, 'Runtime', formatTimeMs(state.timeMs));
  }

  _runStepIterator(solver) {
    let step = 0;

    const update = async () => {
      this._setSolving(true);
      let result = await solver.goToStep(step);
      this._setSolving(false);

      // Update the grid.
      let selection = [];
      if (result) {
        this._grid.setSolution(result.values, result.remainingOptions);
        if (result.values.length > 0) {
          selection.push(result.values[result.values.length-1].substring(0, 4));
        }
      }
      this._grid.selection.updateSelection(selection);

      this._elements.forward.disabled = (result == null);
      this._elements.back.disabled = (step == 0);
      this._elements.start.disabled = (step == 0);
      this._elements.stepOutput.textContent = step+1;
    };

    this._elements.forward.onclick = () => {
      step++;
      update();
    };
    this._elements.back.onclick = () => {
      step--;
      update();
    };
    this._elements.start.onclick = () => {
      step = 0;
      update();
    };

    // Run the onclick handler (just calling click() would only work when
    // the start button is enabled).
    this._elements.start.onclick();
    this._setSolving(false);
  }

  async _runSolutionIterator(solver) {
    let solutions = [];
    let solutionNum = 1;
    let done = false;

    const nextSolution = async () => {
      if (done) return;

      this._setSolving(true);
      let solution = await solver.nextSolution();
      this._setSolving(false);

      if (solution) {
        solutions.push(solution);
      } else {
        done = true;
      }
    };

    const update = () => {
      this._grid.setSolution(solutions[solutionNum-1]);

      this._elements.forward.disabled = (done && solutionNum == solutions.length);
      this._elements.back.disabled = (solutionNum == 1);
      this._elements.start.disabled = (solutionNum == 1);
      this._elements.stepOutput.textContent = solutionNum;
    };

    this._elements.forward.onclick = async () => {
      solutionNum++;
      // Always stay an extra step ahead so that we always know if there are
      // more solutions.
      if (solutions.length == solutionNum) {
        await nextSolution();
      }
      update();
    };
    this._elements.back.onclick = () => {
      solutionNum--;
      update();
    };
    this._elements.start.onclick = () => {
      solutionNum = 1;
      update();
    };

    // Find the first solution.
    await nextSolution();
    update();

    // Keep searching so that we can check if the solution is unique.
    // (This is automatically elided if there are no solutions.
    await nextSolution();
    update();
  }
}
