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
};

class ConstraintDisplay {
  constructor(svg) {
    this._svg = svg;
    this.clear();  // clear() to initialize.
  }

  static makeDisplay(container) {
    let svg = createSvgElement('svg');
    svg.setAttribute('height', CELL_SIZE * GRID_SIZE);
    svg.setAttribute('width', CELL_SIZE * GRID_SIZE);
    svg.classList.add('sudoku-grid-background');

    // Reuasable arrowhead marker.
    let arrowhead = createSvgElement('marker');
    arrowhead.id = 'arrowhead';
    arrowhead.className.baseVal = 'keep-in-svg';
    arrowhead.setAttribute('refX', '3');
    arrowhead.setAttribute('refY', '3');
    arrowhead.setAttribute('markerWidth', '4');
    arrowhead.setAttribute('markerHeight', '7');
    arrowhead.setAttribute('orient', 'auto');
    let arrowPath = createSvgElement('path');
    arrowPath.setAttribute('d', 'M 0 0 L 3 3 L 0 6');
    arrowPath.setAttribute('fill', 'none');
    arrowPath.setAttribute('stroke-width', 1);
    arrowPath.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrowhead.appendChild(arrowPath);
    svg.append(arrowhead);

    container.prepend(svg);

    return new ConstraintDisplay(svg);
  }

  static cellCenter(cellId) {
    let {row, col} = parseCellId(cellId);
    return [col*CELL_SIZE + CELL_SIZE/2, row*CELL_SIZE + CELL_SIZE/2];
  }

  clear() {
    let svg = this._svg;
    while (svg.lastChild.className.baseVal != 'keep-in-svg') {
      svg.removeChild(svg.lastChild);
    }
    this.killerCellColors = new Map();
    this.killerCages = new Map();
    this._diagonals = [null, null];
  }

  removeItem(item) {
    this._svg.removeChild(item);
    if (this.killerCages.has(item)) {
      for (const cellId of this.killerCages.get(item)) {
        this.killerCellColors.delete(cellId);
      }
      this.killerCages.delete(item);
    }
  }

  static _addTextBackground(elem) {
    let bbox = elem.getBBox();
    let rect = createSvgElement('rect');

    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);

    elem.parentNode.insertBefore(rect, elem);
    return rect;
  }

  static KILLER_CAGE_COLORS = [
    'green',
    'red',
    'blue',
    'yellow',
    'cyan',
    'brown',
    'black',
    'purple',
    'orange',
  ];

  _chooseKillerCageColor(cellIds) {
    // Use a greedy algorithm to choose the graph color.
    let conflictingColors = new Set();
    for (const cellId of cellIds) {
      let {row, col} = parseCellId(cellId);
      // Lookup all  adjacent cells, it doesn't matter if they valid or not.
      conflictingColors.add(this.killerCellColors.get(toCellId(row, col+1)));
      conflictingColors.add(this.killerCellColors.get(toCellId(row, col-1)));
      conflictingColors.add(this.killerCellColors.get(toCellId(row+1, col)));
      conflictingColors.add(this.killerCellColors.get(toCellId(row-1, col)));
    }
    // Return the first color that doesn't conflict.
    for (const color of this.constructor.KILLER_CAGE_COLORS) {
      if (!conflictingColors.has(color)) return color;
    }
    // Otherwse select a random color.
    return `rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;
  }

  drawKillerCage(cells, sum) {
    const cellWidth = CELL_SIZE-1;
    let x,y;

    let cage = createSvgElement('svg');
    let color = this._chooseKillerCageColor(cells);

    for (const cell of cells) {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      let path = createSvgElement('path');
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

    let text = createSvgElement('text');
    text.appendChild(document.createTextNode(sum));
    text.setAttribute('x', x - cellWidth/2 + 1);
    text.setAttribute('y', y - cellWidth/2 + 2);
    text.setAttribute('dominant-baseline', 'hanging');
    text.setAttribute('style',
      'font-size: 10; font-family: monospace; font-weight: bold;');
    cage.append(text);
    this._svg.append(cage);

    let textBackground = ConstraintDisplay._addTextBackground(text);
    textBackground.setAttribute('fill', 'rgb(200, 200, 200)');

    return cage;
  }

  drawDot(cells, fillColor) {
    if (cells.length != 2) throw(`White dot must be two cells: ${cells}`)

    // Find the midpoint between the squares.
    let [x0, y0] = ConstraintDisplay.cellCenter(cells[0]);
    let [x1, y1] = ConstraintDisplay.cellCenter(cells[1]);
    let x = (x0+x1)/2;
    let y = (y0+y1)/2;

    let dot = createSvgElement('circle');
    dot.setAttribute('fill', fillColor);
    dot.setAttribute('stroke', 'black');
    dot.setAttribute('stroke-width', 1);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 4);

    this._svg.append(dot);

    return dot;
  }

  drawArrow(cells) {
    if (cells.length < 2) throw(`Arrow too short: ${cells}`)

    let arrow = createSvgElement('svg');
    arrow.setAttribute('fill', 'transparent');
    arrow.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrow.setAttribute('stroke-width', 3);
    arrow.setAttribute('stroke-linecap', 'round');

    let x, y;
    // Draw the circle.
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);
    let circle = createSvgElement('circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 15);
    arrow.appendChild(circle);

    // Draw the line.
    let directions = [];
    cells.forEach((cell) => {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      directions.push('L');
      directions.push(x);
      directions.push(y);
    });
    directions[0] = 'M';  // Replace the first direction to a move.

    let path = createSvgElement('path');
    path.setAttribute('d', directions.join(' '));
    path.setAttribute('stroke-dashoffset', -15);
    path.setAttribute('stroke-dasharray', path.getTotalLength());
    path.setAttribute('marker-end', 'url(#arrowhead)');

    arrow.appendChild(path);

    this._svg.append(arrow);

    return arrow;
  }

  drawThermometer(cells) {
    if (cells.length < 2) throw(`Thermo too short: ${cells}`)

    let thermo = createSvgElement('svg');
    thermo.setAttribute('fill', 'rgb(200, 200, 200)');
    thermo.setAttribute('stroke', 'rgb(200, 200, 200)');

    let x, y;
    // Draw the circle.
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);
    let circle = createSvgElement('circle');
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
    let path = createSvgElement('path');
    path.setAttribute('d', directions.join(' '));
    path.setAttribute('stroke-width', 15);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'transparent');
    thermo.appendChild(path);

    this._svg.append(thermo);

    return thermo;
  }

  drawDiagonal(direction) {
    let size = CELL_SIZE*GRID_SIZE;
    let line = createSvgElement('path');
    let directions = [
      'M', 0, direction > 0 ? size : 0,
      'L', size, direction > 0 ? 0 : size,
    ];
    line.setAttribute('d', directions.join(' '));
    line.setAttribute('stroke-width', 1);
    line.setAttribute('fill', 'transparent');
    line.setAttribute('stroke', 'rgb(255, 0, 0)');

    this._svg.appendChild(line);
    this._diagonals[direction > 0] = line;

    return line;
  }

  removeDiagonal(direction) {
    let item = this._diagonals[direction > 0];
    if (item) this.removeItem(item);
  }
}

class CheckboxConstraints {
  constructor(display, onChange) {
    this._checkboxes = {
      antiKnight: {
        id: 'anti-knight-input',
        constraint: new SudokuConstraint.AntiKnight(),
      },
      antiKing: {
        id: 'anti-king-input',
        constraint: new SudokuConstraint.AntiKing(),
      },
      antiConsecutive: {
        id: 'anti-consecutive-input',
        constraint: new SudokuConstraint.AntiConsecutive(),
      },
      diagonalPlus: {
        id: 'diagonal-plus-input',
        constraint: new SudokuConstraint.Diagonal(1),
      },
      diagonalMinus: {
        id: 'diagonal-minus-input',
        constraint: new SudokuConstraint.Diagonal(-1),
      },
    };

    // Setup the elements.
    for (const item of Object.values(this._checkboxes)) {
      item.element = document.getElementById(item.id);
      item.element.onchange = onChange;
    }

    this._checkboxes.diagonalPlus.element.onchange = e => {
      if (this._checkboxes.diagonalPlus.element.checked) {
        display.drawDiagonal(1);
      } else {
        display.removeDiagonal(1);
      }
      onChange();
    }
    this._checkboxes.diagonalMinus.element.onchange = e => {
      if (this._checkboxes.diagonalMinus.element.checked) {
        display.drawDiagonal(-1);
      } else {
        display.removeDiagonal(-1);
      }
      onChange();
    }
  }

  getConstraint() {
    let constraints = [];
    for (const item of Object.values(this._checkboxes)) {
      if (item.element.checked) {
        constraints.push(item.constraint);
      }
    }
    return new SudokuConstraint.Set(constraints);
  }

  check(name) {
    this._checkboxes[name].element.checked = true;
    this._checkboxes[name].element.dispatchEvent(new Event('change'));
  }

  uncheckAll() {
    for (const item of Object.values(this._checkboxes)) {
      item.element.checked = false;
    }
  }
}

class ConstraintManager {
  constructor(grid) {
    this._configs = [];
    this._grid = grid;
    this._checkboxes = {};
    grid.setUpdateCallback(() => this.runUpdateCallback());

    this._display = ConstraintDisplay.makeDisplay(grid._container);
    this.setUpdateCallback();

    this._setUpPanel();
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn || (() => {});
  }

  runUpdateCallback() {
    this.updateCallback(this);
  }

  _cellsAreAdjacent(cells) {
    if (cells.length != 2) return false;
    // Manhatten distance is exactly 1.
    let cell0 = parseCellId(cells[0]);
    let cell1 = parseCellId(cells[1]);
    return 1 == Math.abs(cell0.row - cell1.row) + Math.abs(cell0.col - cell1.col);
  }

  _setUpPanel() {
    this._panel = document.getElementById('displayed-constraints');

    this._checkboxConstraints = new CheckboxConstraints(
      this._display, this.runUpdateCallback.bind(this));

    let adjacentOnlyConstraints = [
      document.getElementById('multi-cell-constraint-white-dot'),
      document.getElementById('multi-cell-constraint-black-dot'),
    ];

    this._selectionFrom = document.getElementById('multi-cell-constraint-input');
    this._grid.selection.addCallback((selection) => {
      let disabled = (selection.length < 2);
      this._selectionFrom.firstElementChild.disabled = disabled;
      // Focus on the submit button so that that we can immediately press enter.
      if (!disabled) {
        let cellsAreAdjacent = this._cellsAreAdjacent(selection);
        for (let c of adjacentOnlyConstraints) {
          c.disabled = !cellsAreAdjacent;
        }
        this._selectionFrom.querySelector('button[type=submit]').focus();
      }
    });
    this._selectionFrom.onsubmit = e => {
      this._addConstraintFromForm();
      return false;
    }
    this._grid.selection.addSelectionPreserver(this._selectionFrom);

    let freeInputForm = document.getElementById('freeform-constraint-input');
    freeInputForm.onsubmit = e => {
      try {
        let input = (new FormData(freeInputForm)).get('freeform-input');
        this.loadFromText(input);
      } catch (e) {
        // TODO: Display the error.
      }
      return false;
    }

    document.getElementById('clear-constraints-button').onclick = () => this.clear();
  }

  loadFromText(input) {
    this.clear();
    let constraint = SudokuConstraint.fromText(input);
    if (constraint) this.loadConstraint(constraint);

    this.runUpdateCallback();
  }

  loadConstraint(constraint) {
    let config;
    switch (constraint.type) {
      case 'FixedValues':
        this._grid.setCellValues(constraint.values);
        break;
      case 'BlackDot':
        config = {
          cells: constraint.cells,
          name: `&#9679; [${constraint.cells}]`,
          constraint: constraint,
          displayElem: this._display.drawDot(constraint.cells, 'black'),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'WhiteDot':
        config = {
          cells: constraint.cells,
          name: `&#9675 [${constraint.cells}]`,
          constraint: constraint,
          displayElem: this._display.drawDot(constraint.cells, 'white'),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Arrow':
        config = {
          cells: constraint.cells,
          name: `Arrow [len: ${constraint.cells.length-1}]`,
          constraint: constraint,
          displayElem: this._display.drawArrow(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Thermo':
        config = {
          cells: constraint.cells,
          name: `Themo [len: ${constraint.cells.length}]`,
          constraint: constraint,
          displayElem: this._display.drawThermometer(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Cage':
        config = {
          cells: constraint.cells,
          name: `Cage [sum: ${constraint.sum}]`,
          constraint: constraint,
          displayElem: this._display.drawKillerCage(
            constraint.cells, constraint.sum),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'AntiKnight':
        this._checkboxConstraints.check('antiKnight');
        break;
      case 'AntiKing':
        this._checkboxConstraints.check('antiKing');
        break;
      case 'AntiConsecutive':
        this._checkboxConstraints.check('antiConsecutive');
        break;
      case 'Diagonal':
        if (constraint.direction > 0) {
          this._checkboxConstraints.check('diagonalPlus');
        } else {
          this._checkboxConstraints.check('diagonalMinus');
        }
        break;
      case 'Set':
        constraint.constraints.forEach(c => this.loadConstraint(c));
        break;
    }
    this.runUpdateCallback();
  }

  _addConstraintFromForm() {
    let cells = this._grid.selection.getCells().map(e => e.id);
    if (cells.length < 2) throw('Selection too short.');

    let formData = new FormData(this._selectionFrom);

    let constraint;
    switch (formData.get('constraint-type')) {
      case 'arrow':
        constraint = new SudokuConstraint.Arrow(...cells);
        this.loadConstraint(constraint);
        break;
      case 'cage':
        constraint = new SudokuConstraint.Cage(+formData.get('cage-sum'), ...cells);
        this.loadConstraint(constraint);
        break;
      case 'thermo':
        constraint = new SudokuConstraint.Thermo(...cells);
        this.loadConstraint(constraint);
        break;
      case 'white-dot':
        constraint = new SudokuConstraint.WhiteDot(...cells);
        this.loadConstraint(constraint);
        break;
      case 'black-dot':
        constraint = new SudokuConstraint.BlackDot(...cells);
        this.loadConstraint(constraint);
        break;
    }

    this._grid.selection.setCells([]);
    this.runUpdateCallback();
  }

  _removeConstraint(config) {
    let index = this._configs.indexOf(config);
    this._configs.splice(index, 1);
    this._display.removeItem(config.displayElem);
    this._panel.removeChild(config.panelItem);
  }

  _addToPanel(config) {
    let panelItem = document.createElement('div');
    panelItem.className = 'constraint-item';

    let panelButton = document.createElement('button');
    panelButton.innerHTML = '&#x00D7;';
    panelItem.appendChild(panelButton);

    let panelLabel = document.createElement('span');
    panelLabel.innerHTML = config.name;
    panelItem.appendChild(panelLabel);

    config.panelItem = panelItem;
    panelButton.addEventListener('click', () => {
      this._removeConstraint(config);
      this.runUpdateCallback();
    });

    panelItem.addEventListener('mouseover', () => {
      this._grid.highlight.setCells(config.cells);
    });
    panelItem.addEventListener('mouseout', () => {
      this._grid.highlight.setCells([]);
    });

    this._panel.appendChild(panelItem);
  }

  getConstraints() {
    let constraints = this._configs.map(c => c.constraint);
    constraints.push(this._checkboxConstraints.getConstraint());
    constraints.push(
      new SudokuConstraint.FixedValues(...this._grid.getCellValues()));

    return new SudokuConstraint.Set(constraints);
  }

  clear() {
    this._display.clear();
    this._panel.innerHTML = '';
    this._checkboxConstraints.uncheckAll();
    this._configs = [];
    this._grid.setCellValues([])
    this._grid.setSolution();
    this.runUpdateCallback();
  }
}

class Highlight {
  constructor(container, cssClass) {
    this._cells = new Set();
    this._cssClass = cssClass;
    this._callbacks = [];
  }

  setCells(cellIds) {
    this._clear();
    cellIds.forEach(c => this._addToSelection(document.getElementById(c)));
    this._runCallback();
  }

  getCells() {
    return [...this._cells];
  }

  addCallback(fn) {
    this._callbacks.push(fn);
  }

  _runCallback() {
    let cellIds = [];
    this._cells.forEach(e => cellIds.push(e.id));
    this._callbacks.forEach(fn => fn(cellIds));
  }

  _addToSelection(cell) {
    if (cell.classList.contains('cell-input')) {
      cell.parentNode.classList.add(this._cssClass);
      this._cells.add(cell);
    }
  }

  _clear() {
    this._cells.forEach(e => e.parentNode.classList.remove(this._cssClass));
    this._cells.clear();
    this._runCallback();
  }
}

class Selection extends Highlight {
  constructor(container) {
    super(container, 'selected');
    this._selectionPreservers = [container];

    this._setUpMouseHandlers(container);
  }

  _setUpMouseHandlers(container) {
    // Make the container selectable.
    container.tabIndex = 0;

    let currCell = null;
    const pointerMoveFn = e => {
      // NOTE: e.target does't work correctly for pointers.
      let target = document.elementFromPoint(e.clientX, e.clientY);
      if (target != currCell) {
        currCell = target;
        this._addToSelection(currCell);
      }
    };
    const outsideClickListener = e => {
      // Don't do anything if the click is inside one of the elements where
      // we want to retain clicks.
      for (const elem of this._selectionPreservers) {
        if (elem.contains(e.target)) return;
      }
      // Otherwise clear the selection.
      this._clear();
      document.body.removeEventListener('click', outsideClickListener);
    };
    container.addEventListener('pointerdown', e => {
      // If the shift key is pressed, continue adding to the selection.
      if (!e.shiftKey) {
        this._clear();
      }
      container.addEventListener('pointermove', pointerMoveFn);
      document.body.addEventListener('click', outsideClickListener);
      currCell = null;
      pointerMoveFn(e);
      e.preventDefault();
    });
    container.addEventListener('pointerup', e => {
      container.removeEventListener('pointermove', pointerMoveFn);
      this._runCallback();
      e.preventDefault();
    });
    container.addEventListener('touchmove', e => {
      if (e.touches.length == 1) e.preventDefault();
    });
  }

  addSelectionPreserver(elem) {
    this._selectionPreservers.push(elem);
  }
}

class SudokuGrid {
  constructor(container) {
    this._container = container;
    container.classList.add('sudoku-grid');
    this._solutionValues = [];

    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    this._fakeInput = document.getElementById('fake-input');

    this._cellMap = this._makeSudokuGrid(container);
    this.selection = new Selection(container);
    this.selection.addCallback(cellIds => {
      if (cellIds.length != 1) return;
      let cell = document.getElementById(cellIds[0]);
      let fakeInput = this._fakeInput;
      fakeInput.style.left = cell.offsetLeft;
      fakeInput.style.top = cell.offsetTop;
      fakeInput.select();
    });
    this.highlight = new Highlight(container, 'highlighted');
    this._setUpKeyBindings(container);
    this.setUpdateCallback();

    this.setSolution = deferUntilAnimationFrame(this.setSolution.bind(this));
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

      elem.textContent = value || '';

      this.updateCallback(this);
    };

    const moveActiveCell = (dr, dc) => {
      let elem = getActiveElem();
      if (!elem) return;

      let {row, col} = parseCellId(elem.id);
      row = (row+dr+GRID_SIZE)%GRID_SIZE;
      col = (col+dc+GRID_SIZE)%GRID_SIZE;

      this.selection.setCells([toCellId(row, col)]);
    };

    let fakeInput = this._fakeInput;
    fakeInput.addEventListener('input', event => {
      const value = +fakeInput.value;
      if (value > 0 && value <= 9) {
        setActiveCellValue(value);
      } else {
        setActiveCellValue(null);
      }
      // Ensure that any user input results in a value which makes sense to us:
      //   - Select so that the ensure content is replaced by the new value.
      //   - Initialize with x, so that backspace can be detected.
      fakeInput.value = 'x';
      fakeInput.select();
      return;
    });

    fakeInput.addEventListener('keydown', event => {
      fakeInput.select(); // Restore the selection.
      switch (event.key) {
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

  static THIN_BORDER_STYLE = '1px solid';
  static FAT_BORDER_STYLE = '3px solid';

  _styleCell(cell, row, col) {
    cell.className = 'cell cell-elem';
    cell.style.border = SudokuGrid.THIN_BORDER_STYLE;
    if (row%BOX_SIZE == 0) cell.style.borderTop = SudokuGrid.FAT_BORDER_STYLE;
    if (col%BOX_SIZE == 0) cell.style.borderLeft = SudokuGrid.FAT_BORDER_STYLE;
    if (row == GRID_SIZE-1) cell.style.borderBottom = SudokuGrid.FAT_BORDER_STYLE;
    if (col == GRID_SIZE-1) cell.style.borderRight = SudokuGrid.FAT_BORDER_STYLE;
  }

  _makeSudokuGrid(container) {
    let cellMap = new Map();

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        let cell = document.createElement('div');
        let cellId = toCellId(i, j);
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
    for (let [cellId, cell] of this._cellMap) {
      let value = cell.textContent;
      if (value){
        let {row, col} = parseCellId(cellId);
        values.push(toValueId(row, col, value));
      }
    }
    return values;
  }

  _clearCellValues() {
    for (let cell of this._cellMap.values()) {
      cell.textContent = '';
    }
  }

  setCellValues(valueIds) {
    this._clearCellValues();
    for (let valueId of valueIds) {
      let {cellId, value} = parseValueId(valueId);
      this._cellMap.get(cellId).textContent = value;
    }
    this.updateCallback();
  }

  *_solutionNodes() {
    for (const [cellId, cell] of this._cellMap) {
      yield [cellId, cell.nextSibling];
    }
  }

  _formatMultiSolution(values) {
    let chars = Array(GRID_SIZE*2-1).fill(' ');
    chars[BOX_SIZE*2-1] = '\n';
    chars[BOX_SIZE*2*2-1] = '\n';
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
      }, 10);
      return;
    }

    let cellValues = new Map();
    let pencilmarkCell = new Set();

    const handleValue = (valueId) => {
      let {cellId, value} = parseValueId(valueId);
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

class UrlHandler {
  constructor(onUpdate) {
    this.allowUrlUpdates = false;
    this._onUpdate = onUpdate;

    window.onpopstate = this._reloadFromUrl.bind(this);
    this._reloadFromUrl();
  }

  update(params) {
    if (!this.allowUrlUpdates) return;

    let url = new URL(window.location.href);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    let newUrl = url.toString();
    if (newUrl != window.location.href) {
      history.pushState(null, null, url.toString());
    }
  }

  _reloadFromUrl() {
    let url = new URL(window.location.href);
    this._onUpdate(url.searchParams);
  }
}

class SolutionController {
  constructor(constraintManager, grid) {
    this._solver = null;
    this._constraintManager = constraintManager;
    this._grid = grid;
    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.setUpdateCallback(this._update.bind(this));

    this._elements = {
      start: document.getElementById('solution-start'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      control: document.getElementById('solution-control-panel'),
      stepOutput: document.getElementById('solution-step-output'),
      mode: document.getElementById('solve-mode-input'),
      stateOutput: document.getElementById('state-output'),
      solveStatus: document.getElementById('solve-status'),
      error: document.getElementById('error-output'),
      stop: document.getElementById('stop-solver'),
    }

    this._elements.mode.onchange = () => this._update();
    this._elements.stop.onclick = () => this._terminateSolver();

    this._setUpKeyBindings();

    this._setUpStateOutput();
    this._displayStateVariables =
      deferUntilAnimationFrame(this._displayStateVariables.bind(this));

    this._urlHandler = new UrlHandler((params) => {
      let mode = params.get('mode');
      if (mode) this._elements.mode.value = mode;

      let constraintsText = params.get('q');
      if (constraintsText) {
        this._constraintManager.loadFromText(constraintsText);
      }
    });

    this._update().then(() => {
      this._urlHandler.allowUrlUpdates = true;
    });
  }

  _setUpKeyBindings() {
    const keyHandlers = {
      n: () => this._elements.forward.click(),
      p: () => this._elements.back.click(),
      s: () => this._elements.start.click(),
    };
    let firingKeys = new Map();

    // Keep running handler every frame as long as the key is still held down.
    const runHandler = (key, handler) => {
      if (!firingKeys.has(key)) return;
      handler();
      window.requestAnimationFrame(() => runHandler(key, handler));
    };

    const FIRE_WAIT = 1;
    const FIRE_FAST = 2;

    document.addEventListener('keydown', event => {
      let key = event.key;
      let handler = keyHandlers[key];
      if (!handler) return;

      // Prevent the keypress from affecting the fake-input field.
      event.preventDefault();

      // If the key is not currently pressed, then just fire the handler and
      // record that they key has been pressed.
      // We don't want to start firing continuously as that makes it way too
      // sensitive.
      if (!firingKeys.has(key)) {
        firingKeys.set(key, FIRE_WAIT);
        handler();
        return;
      }

      // If we haven't started fast fire mode, do so now!
      if (firingKeys.get(key) != FIRE_FAST) {
        firingKeys.set(key, FIRE_FAST);
        runHandler(key, handler);
      }

    });
    document.addEventListener('keyup', event => {
      firingKeys.delete(event.key);
    });
  }

  _terminateSolver() {
    if (this._solver) this._solver.terminate();
  }

  async _replaceSolver(constraints) {
    this._terminateSolver();

    this._solver = await SudokuBuilder.buildInWorker(
      constraints, this._displayState.bind(this));

    return this._solver;
  }

  _showIterationControls(show) {
    this._elements.control.style.visibility = show ? 'visible' : 'hidden';
  }

  async _update() {
    let constraints = this._constraintManager.getConstraints();
    let mode = this._elements.mode.value;
    this._urlHandler.update({mode: mode, q: constraints});

    let solver = await this._replaceSolver(constraints);

    this._grid.setSolution([]);

    let handler = {
      'all-possibilities': this._runAllPossibilites,
      'solutions': this._runSolutionIterator,
      'step-by-step': this._runStepIterator,
      'count-solutions': this._runCounter,
    }[mode];

    this._setSolving(true);
    handler.bind(this)(solver)
      .catch(e => this._setError(e))
      .finally(() => this._setSolving(false));
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
      this._elements.solveStatus.textContent = 'Solving';
      this._setError();
    } else {
      this._elements.stop.disabled = true;
      this._elements.solveStatus.textContent = '';
    }
  }

  static _addStateVariable(container, label, value) {
    let elem = document.createElement('div');
    elem.textContent = `${label}: ${value}`;
    container.appendChild(elem);
  }

  _setUpStateOutput() {
    let container = this._elements.stateOutput;
    let vars = [
      'solutions',
      'guesses',
      'backtracks',
      'cellsSearched',
      'valuesTried',
      'constraintsProcessed',
      'runtime',
    ];
    this._stateVars = {};
    for (const v of vars) {
      let elem = document.createElement('div');
      let value = document.createElement('span');
      let title = document.createElement('span');
      title.textContent = camelCaseToWords(v);
      title.className = 'state-output-title';
      elem.appendChild(value);
      elem.appendChild(title);
      container.appendChild(elem);

      this._stateVars[v] = value;
    }
  }

  _displayStateVariables(state) {
    const counters = state.counters;

    for (const v in this._stateVars) {
      let text;
      switch (v) {
        case 'solutions':
          text = counters.solutions + (state.done ? '' : '+');
          break;
        case 'runtime':
          text = formatTimeMs(state.timeMs);
          break;
        default:
          text = counters[v];
      }
      this._stateVars[v].textContent = text;
    }
  }

  _displayState(state) {
    // Handle this in a seperate function, as then it can be defered
    // independently of the solution update:w
    this._displayStateVariables(state);

    // Handle extra state.
    let extra = state.extra;
    if (!extra) return;

    if (extra.solution || extra.pencilmarks) {
      this._grid.setSolution(extra.solution, extra.pencilmarks);
    }
  }

  _setStepStatus(result) {
    if (result.isSolution) {
      this._elements.solveStatus.textContent = 'Solution';
    } else if (result.hasContradiction) {
      this._elements.solveStatus.textContent = 'Conflict';
    }
  }

  async _runStepIterator(solver) {
    let step = 0;

    const update = async () => {
      this._setSolving(true);
      let result = await solver.nthStep(step);
      this._setSolving(false);

      // Update the grid.
      let selection = [];
      if (result) {
        this._grid.setSolution(result.values, result.pencilmarks);
        if (result.values.length > 0 && !result.isSolution) {
          selection.push(result.values[result.values.length-1].substring(0, 4));
        }
        this._setStepStatus(result);
      }
      this._grid.selection.setCells(selection);

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

    this._showIterationControls(true);

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
      let solution = await solver.nthSolution(solutions.length);
      this._setSolving(false);

      if (solution) {
        solutions.push(solution);
      } else {
        done = true;
      }
    };

    const update = () => {
      this._grid.setSolution(solutions[solutionNum-1]);

      this._elements.forward.disabled = (done && solutionNum >= solutions.length);
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

    this._showIterationControls(true);

    // Find the first solution.
    await nextSolution();
    update();

    // Keep searching so that we can check if the solution is unique.
    // (This is automatically elided if there are no solutions.
    await nextSolution();
    update();
  }

  async _runAllPossibilites(solver) {
    this._showIterationControls(false);
    let result = await solver.solveAllPossibilities();
    this._grid.setSolution(result);
    this._setSolving(false);
  }

  async _runCounter(solver) {
    this._showIterationControls(false);
    await solver.countSolutions();
    this._setSolving(false);
  }
}
