// Make these variables global so that we can easily access them from the
// console.
let grid, constraintManager, controller, infoOverlay;

const initPage = () => {
  // Create grid.
  let container = document.getElementById('sudoku-grid');
  grid = new SudokuGrid(container);
  constraintManager = new ConstraintManager(grid);
  infoOverlay = new InfoOverlay(grid._container);

  controller = new SolutionController(constraintManager, grid, infoOverlay);
};

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

class ExampleHandler {
  static _EXAMPLES = [
    'Classic sudoku',
    'Thermosudoku',
    'Killer sudoku',
    'Killer sudoku, hard',
    'Arrow sudoku',
    'Anti-knight, Anti-consecutive',
    'Little killer',
    'Sudoku X',
    'Sandwich sudoku',
    'German whispers',
    'Palindromes',
    'Jigsaw',
  ];

  constructor(constraintManager) {
    this._ignoreConstraintChanges = false;
    this._exampleSelect = this._setUp();
    this._constraintManager = constraintManager;
  }

  _setUp() {
    let exampleSelect = document.getElementById('example-select');

    for (const example of ExampleHandler._EXAMPLES) {
      if (!EXAMPLES[example]) throw('Unknown example: ' + example);
      let option = document.createElement('option');
      option.textContent = example;
      exampleSelect.appendChild(option);
    }

    let link = exampleSelect.nextElementSibling;
    exampleSelect.onchange = () => {
      if (exampleSelect.selectedIndex) {
        let example = exampleSelect.options[exampleSelect.selectedIndex].text;
        link.href = EXAMPLES[example].src;
        link.style.display = 'inline-block';

        this._ignoreConstraintChanges = true;
        this._constraintManager.loadFromText(EXAMPLES[example].input);
        this._ignoreConstraintChanges = false;
      } else {
        link.style.display = 'none';
        this._ignoreConstraintChanges = true;
      }
    };
    exampleSelect.onchange();

    return exampleSelect;
  }

  newConstraintLoaded() {
    if (!this._ignoreConstraintChanges) {
      this._exampleSelect.selectedIndex = 0;
      this._exampleSelect.onchange();
    }
  }
}

class JigsawManager {
  constructor(display, onChange, makePanelItem) {
    this._display = display;
    this._makePanelItem = makePanelItem;

    this._jigsawCheckbox = document.getElementById('jigsaw-input');
    this._jigsawCheckbox.onchange = e => {
      this._updateDependentElements();
      onChange();
    }

    this._regionPanel = document.getElementById('displayed-regions');

    this._piecesMap = Array(NUM_CELLS).fill(0);
    this._maxPieceId = 0;
  }

  _updateDependentElements() {
    const checked = this.enabled();

    const jigsawRadio = document.getElementById('multi-cell-constraint-jigsaw').parentNode;
    jigsawRadio.style.display = checked ? null : 'none';

    const jigsawPanel = document.getElementById('displayed-regions');
    jigsawPanel.style.display = checked ? null : 'none';

    const button = document.getElementById('validate-layout-button');
    button.disabled = !checked;

    this._display.useJigsawRegions(checked);
  }

  enabled() {
    return this._jigsawCheckbox.checked;
  }

  getConstraint() {
    if (!this.enabled()) return new SudokuConstraint.Set([]);

    const indexMap = new Map();
    const grid = Array(NUM_CELLS).fill('-');
    this._piecesMap.forEach((p, i) => {
      if (!indexMap.has(p)) indexMap.set(p, indexMap.size);
      grid[i] = indexMap.get(p);
    });
    return new SudokuConstraint.Jigsaw(grid.join(''));
  }

  setConstraint(constraint) {
    const grid = constraint.grid;
    const map = new Map();
    for (let i = 0; i < NUM_CELLS; i++) {
      const v = grid[i];
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(i);
    }

    for (const [_, cells] of map) {
      if (cells.length == 9) {
        this.addPiece(cells.map(c => toCellId(...toRowCol(c))));
      }
    }

    this._jigsawCheckbox.checked = true;
    this._updateDependentElements();
  }

  clear() {
    this._piecesMap.fill(0);
    this._jigsawCheckbox.checked = false;
    this._regionPanel.innerHTML = '';
    this._updateDependentElements();
  }

  isValidJigsawPiece(selection) {
    if (selection.length != 9) return false;
    if (!this.enabled()) return false;

    // Check that we aren't overlapping an existing tile.
    if (selection.some(c => this._piecesMap[parseCellId(c).cell] != 0)) {
      return false;
    }

    return true;
  }

  removePiece(config) {
    this._display.removeItem(config.displayElem);
    config.panelItem.parentNode.removeChild(config.panelItem);

    config.cells.forEach(c => this._piecesMap[parseCellId(c).cell] = 0);
  }

  _addToRegionPanel(config) {
    this._regionPanel.appendChild(this._makePanelItem(config));
  }

  addPiece(cells) {
    const pieceId = ++this._maxPieceId;
    cells.forEach(c => this._piecesMap[parseCellId(c).cell] = pieceId);
    const config = {
      isJigsaw: true,
      pieceId: pieceId,
      cells: cells,
      name: '',
      displayElem: this._display.drawRegion(cells),
    };
    this._addToRegionPanel(config);
  }
}

class ConstraintManager {
  constructor(grid) {
    this._configs = [];
    this._grid = grid;
    this._checkboxes = {};
    grid.setUpdateCallback(() => this.runUpdateCallback());

    this._display = new ConstraintDisplay(grid._container, grid.selection);
    this._setUpPanel();
    this.setUpdateCallback();
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn || (() => {});
  }

  runUpdateCallback() {
    this._exampleHandler.newConstraintLoaded();
    this.updateCallback(this);
  }

  static _cellsAreAdjacent(cells) {
    if (cells.length != 2) return false;
    // Manhatten distance is exactly 1.
    let cell0 = parseCellId(cells[0]);
    let cell1 = parseCellId(cells[1]);
    return 1 == Math.abs(cell0.row - cell1.row) + Math.abs(cell0.col - cell1.col);
  }

  _setUpPanel() {
    this._constraintPanel = document.getElementById('displayed-constraints');

    // Checkbox constraints.
    this._checkboxConstraints = new CheckboxConstraints(
      this._display, this.runUpdateCallback.bind(this));

    this._jigsawManager = new JigsawManager(
      this._display, this.runUpdateCallback.bind(this),
      this._makePanelItem.bind(this));

    let selectionForm = document.forms['multi-cell-constraint-input'];
    this._grid.selection.addCallback(
      (selection) => this._onNewSelection(
        selection, selectionForm));

    selectionForm.onsubmit = e => {
      this._addConstraintFromForm(selectionForm);
      return false;
    }

    // Selecting anything in the constraint cage will select it and focus on
    // the input box.
    selectionForm['multi-cell-constraint-cage'].onchange = () => {
      selectionForm['cage-sum'].select();
    };
    selectionForm['cage-sum'].onfocus = () => {
      selectionForm['multi-cell-constraint-cage'].checked = true;
    };

    this._grid.selection.addSelectionPreserver(selectionForm);

    // Little killer.
    this._setUpLittleKiller();

    // Load examples.
    this._exampleHandler = new ExampleHandler(this);

    // Free-form.
    let freeInputForm = document.forms['freeform-constraint-input'];
    freeInputForm.onsubmit = e => {
      try {
        let input = (new FormData(freeInputForm)).get('freeform-input');
        this.loadFromText(input);
      } catch (e) {
        console.log(e);
        // TODO: Display the error.
      }
      return false;
    }

    // Clear button.
    document.getElementById('clear-constraints-button').onclick = () => this.clear();
  }

  _onNewSelection(selection, selectionForm) {
    // Only enable the selection panel if the selection is long enough.
    const disabled = (selection.length < 2);
    selectionForm.firstElementChild.disabled = disabled;
    if (disabled) return;

    // Multi-cell selections.
    const adjacentOnlyConstraints = [
      'multi-cell-constraint-white-dot',
      'multi-cell-constraint-black-dot',
    ];

    // Enable/disable the adjacent only constraints.
    let cellsAreAdjacent = this.constructor._cellsAreAdjacent(selection);
    for (const c of adjacentOnlyConstraints) {
      const elem = selectionForm[c];
      if (cellsAreAdjacent) {
        elem.disabled = false;
      } else {
        elem.checked = false;
        elem.disabled = true;
      }
    }

    if (this._jigsawManager.isValidJigsawPiece(selection)) {
      selectionForm['multi-cell-constraint-jigsaw'].disabled = false;
      selectionForm['multi-cell-constraint-jigsaw'].checked = true;
    } else {
      selectionForm['multi-cell-constraint-jigsaw'].disabled = true;
    }

    // Focus on the the form so we can immediately press enter.
    //   - If the cage is selected then focus on the text box for easy input.
    //   - Otherwise just focus on the submit button.
    if (selectionForm['multi-cell-constraint-cage'].checked) {
      selectionForm['cage-sum'].select();
    } else {
      selectionForm.querySelector('button[type=submit]').focus();
    }
  }

  _setUpLittleKiller() {
    this._outsideArrowConstraints = {};


    let outsideArrowForm = document.forms['outside-arrow-input'];
    const clearOutsideArrow = () => {
      let formData = new FormData(outsideArrowForm);
      let id = formData.get('id');
      delete this._outsideArrowConstraints[id];
      this._display.removeOutsideArrow(id);
      this._grid.selection.setCells([]);
      this.runUpdateCallback();
    };
    outsideArrowForm.onsubmit = e => {
      let formData = new FormData(outsideArrowForm);
      let type = formData.get('type');
      let id = formData.get('id');

      let sum = formData.get('sum');
      if (sum == '' || sum != +sum) {
        clearOutsideArrow();
        return false;
      }
      sum = +sum;

      switch (type) {
        case 'little-killer':
          this.loadConstraint(new SudokuConstraint.LittleKiller(sum, id));
          break;
        case 'sandwich':
          this.loadConstraint(new SudokuConstraint.Sandwich(sum, id));
          break;
      }

      this._grid.selection.setCells([]);
      this.runUpdateCallback();
      return false;
    };
    this._grid.selection.addSelectionPreserver(outsideArrowForm);

    document.getElementById('outside-arrow-clear').onclick = clearOutsideArrow;
  }

  _removeAllLittleKillers() {
    for (const cell in this._outsideArrowConstraints) {
      this._display.removeOutsideArrow(cell);
    }
    this._outsideArrowConstraints = {};
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
          name: '&#9679',
          constraint: constraint,
          displayElem: this._display.drawDot(constraint.cells, 'black'),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'WhiteDot':
        config = {
          cells: constraint.cells,
          name: '&#9675',
          constraint: constraint,
          displayElem: this._display.drawDot(constraint.cells, 'white'),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Arrow':
        config = {
          cells: constraint.cells,
          name: 'Arrow',
          constraint: constraint,
          displayElem: this._display.drawArrow(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Thermo':
        config = {
          cells: constraint.cells,
          name: 'Thermo',
          constraint: constraint,
          displayElem: this._display.drawThermometer(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Jigsaw':
        this._jigsawManager.setConstraint(constraint);
        break;
      case 'Whisper':
        config = {
          cells: constraint.cells,
          name: 'Whisper',
          constraint: constraint,
          displayElem: this._display.drawWhisper(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Palindrome':
        config = {
          cells: constraint.cells,
          name: 'Palindrome',
          constraint: constraint,
          displayElem: this._display.drawPalindrome(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Cage':
        config = {
          cells: constraint.cells,
          name: `Cage (${constraint.sum})`,
          constraint: constraint,
          displayElem: this._display.drawKillerCage(
            constraint.cells, constraint.sum),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'LittleKiller':
        this._outsideArrowConstraints[constraint.id] = constraint;
        this._display.addOutsideArrow(constraint.id, constraint.sum);
        break;
      case 'Sandwich':
        this._outsideArrowConstraints[constraint.id] = constraint;
        this._display.addOutsideArrow(constraint.id, constraint.sum);
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

  _addConstraintFromForm(selectionForm) {
    let cells = this._grid.selection.getCells().map(e => e.id);
    if (cells.length < 2) throw('Selection too short.');

    let formData = new FormData(selectionForm);

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
      case 'jigsaw':
        this._jigsawManager.addPiece(cells);
        break;
      case 'whisper':
        constraint = new SudokuConstraint.Whisper(...cells);
        this.loadConstraint(constraint);
        break;
      case 'palindrome':
        constraint = new SudokuConstraint.Palindrome(...cells);
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

  _removePanelConstraint(config) {
    if (config.isJigsaw) {
      this._jigsawManager.removePiece(config);
    } else {
      const index = this._configs.indexOf(config);
      this._configs.splice(index, 1);
      this._display.removeItem(config.displayElem);
      config.panelItem.parentNode.removeChild(config.panelItem);
    }

    this._grid.highlight.setCells([]);
  }

  _makePanelItem(config) {
    let panelItem = document.createElement('div');
    panelItem.className = 'constraint-item';

    let panelButton = document.createElement('button');
    panelButton.innerHTML = '&#x00D7;';
    panelItem.appendChild(panelButton);

    panelItem.append(this._makePanelIcon(config));

    let panelLabel = document.createElement('span');
    panelLabel.innerHTML = config.name;
    panelItem.appendChild(panelLabel);

    config.panelItem = panelItem;
    panelButton.addEventListener('click', () => {
      this._removePanelConstraint(config);
      this.runUpdateCallback();
    });

    panelItem.addEventListener('mouseover', () => {
      this._grid.highlight.setCells(config.cells);
    });
    panelItem.addEventListener('mouseout', () => {
      this._grid.highlight.setCells([]);
    });

    return panelItem;
  }

  _makePanelIcon(config) {
    const svg = createSvgElement('svg');
    const transform = 'scale(0.06)';

    const borders = this._display.makeBorders('rgb(255, 255, 255)');
    borders.setAttribute('transform', transform);
    borders.setAttribute('stoke-width', 0);
    svg.append(borders);

    const elem = config.displayElem.cloneNode(true);
    elem.setAttribute('transform', transform);
    elem.setAttribute('stroke-width', 15);
    elem.setAttribute('opacity', 1);

    svg.append(elem);
    svg.style.height = '28px';
    svg.style.width = '28px';
    // Undo the opacity (for killer cages).
    svg.style.filter = 'saturate(100)';

    return svg;
  }

  _addToPanel(config) {
    this._constraintPanel.appendChild(this._makePanelItem(config));
  }

  getLayoutConstraint() {
    return this._jigsawManager.getConstraint();
  }

  getConstraints() {
    let constraints = this._configs.map(c => c.constraint);
    constraints.push(this._jigsawManager.getConstraint());
    constraints.push(this._checkboxConstraints.getConstraint());
    constraints.push(...Object.values(this._outsideArrowConstraints));
    constraints.push(
      new SudokuConstraint.FixedValues(...this._grid.getCellValues()));

    return new SudokuConstraint.Set(constraints);
  }

  clear() {
    this._display.clear();
    this._constraintPanel.innerHTML = '';
    this._checkboxConstraints.uncheckAll();
    this._removeAllLittleKillers();
    this._configs = [];
    this._jigsawManager.clear();
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

  size() {
    return this._cells.size;
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

    window.addEventListener('keydown', event => {
      if (this.selection.size() == 0) return;
      switch (event.key) {
        case 'c':
          this.selection.getCells().forEach(c => c.textContent = '');
          this.updateCallback(this);
          break;
        case 'f':
          if (this.selection.size() != 9) return;
          this.selection.getCells().forEach((c,i) => c.textContent = i+1);
          this.updateCallback(this);
          break;
      }
    });
  }

  _makeSudokuGrid(container) {
    let cellMap = new Map();

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        let cell = document.createElement('div');
        cell.className = 'cell cell-elem';
        let cellId = toCellId(i, j);

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

  static _TEMPLATE_ARRAY = (() => {
    const chars = Array(GRID_SIZE*2-1).fill(' ');
    chars[BOX_SIZE*2-1] = '\n';
    chars[BOX_SIZE*2*2-1] = '\n';
    return chars;
  })();

  _formatMultiSolution(values) {
    const chars = [...this.constructor._TEMPLATE_ARRAY];
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

class HistoryHandler {
  MAX_HISTORY = 50;
  HISTORY_ADJUSTMENT = 10;

  constructor(onUpdate) {
    this._blockHistoryUpdates = false;
    this._onUpdate = (params) => {
      this._blockHistoryUpdates = true;
      onUpdate(params);
      this._blockHistoryUpdates = false;
    }

    this._history = [];
    this._historyLocation = -1;

    this._undoButton = document.getElementById('undo-button');
    this._undoButton.onclick = () => this._incrementHistory(-1);
    this._redoButton = document.getElementById('redo-button');
    this._redoButton.onclick = () => this._incrementHistory(+1);

    window.onpopstate = this._reloadFromUrl.bind(this);
    this._reloadFromUrl();
  }

  update(params) {
    if (this._blockHistoryUpdates) return;
    let q = '' + (params.q||'');

    this._addToHistory(q);
    this._updateUrl(params);
  }

  _addToHistory(q) {
    if (q == this._history[this._historyLocation]) return;
    this._history.length = this._historyLocation + 1;
    this._history.push(q||'');
    this._historyLocation++;

    if (this._history.length > HistoryHandler.MAX_HISTORY) {
      this._history = this._history.slice(HISTORY_ADJUSTMENT);
      this._historyLocation -= HISTORY_ADJUSTMENT;
    }

    this._updateButtons();
  }

  _incrementHistory(delta) {
    let q = this._history[this._historyLocation+delta];
    if (q === undefined) return;
    this._historyLocation += delta;
    this._updateButtons();

    this._updateUrl({q: q});
    this._onUpdate(new URLSearchParams({q: q}));
  }

  _updateButtons() {
    this._undoButton.disabled = this._historyLocation <= 0;
    this._redoButton.disabled = this._historyLocation >= this._history.length - 1;
  }

  _updateUrl(params) {
    let url = new URL(window.location.href);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }

    let newUrl = url.toString();
    if (newUrl != window.location.href) {
      history.pushState(null, null, url.toString());
    }
  }

  _reloadFromUrl() {
    let url = new URL(window.location.href);
    this._addToHistory(url.searchParams.get('q'));
    this._onUpdate(url.searchParams);
  }
}

class DebugOutput {
  constructor(grid) {
    this._container = document.getElementById('debug-container');
    this._visible = false;
    this._grid = grid;
  }

  clear() {
    if (!this._visible) return;

    this._container.textContent = '';
  }

  addLogs(logs) {
    if (!this._visible) return;
    logs.forEach(l => this._addLog(l));
  }

  _addLog(data) {
    const elem = document.createElement('div');

    const locSpan = document.createElement('span');
    locSpan.textContent = data.loc + ': ';

    const msgSpan = document.createElement('msg');
    let msg = data.msg;
    if (data.args) {
      msg += ' ' + JSON.stringify(data.args).replaceAll('"', '');
    }
    msgSpan.textContent = msg;

    elem.append(locSpan);
    elem.append(msgSpan);

    if (data.cells && data.cells.length) {
      const cellIds = [...data.cells].map(c => toCellId(...toRowCol(c)));
      elem.addEventListener('mouseover', () => {
        this._grid.highlight.setCells(cellIds);
      });
      elem.addEventListener('mouseout', () => {
        this._grid.highlight.setCells([]);
      });
    }

    this._container.append(elem);
  }

  enable(enable) {
    if (enable === undefined) enable = true;
    ENABLE_DEBUG_LOGS = enable;
    this._visible = enable;
    this._container.style.display = enable ? 'block' : 'none';
    this.clear();
  }
}

class SolutionController {
  constructor(constraintManager, grid, infoOverlay) {
    this._solver = null;
    this._isSolving = false;
    this._constraintManager = constraintManager;
    this._infoOverlay = infoOverlay;
    this._grid = grid;
    this._debugOutput = new DebugOutput(grid);
    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.setUpdateCallback(this._update.bind(this));

    this._modeHandlers = {
      'all-possibilities': this._runAllPossibilites,
      'solutions': this._runSolutionIterator,
      'count-solutions': this._runCounter,
      'step-by-step': this._runStepIterator,
    };

    this._elements = {
      start: document.getElementById('solution-start'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      control: document.getElementById('solution-control-panel'),
      stepOutput: document.getElementById('solution-step-output'),
      mode: document.getElementById('solve-mode-input'),
      modeDescription: document.getElementById('solve-mode-description'),
      stateOutput: document.getElementById('state-output'),
      solveStatus: document.getElementById('solve-status'),
      error: document.getElementById('error-output'),
      validateResult: document.getElementById('validate-result-output'),
      stop: document.getElementById('stop-solver'),
      solve: document.getElementById('solve-button'),
      validate: document.getElementById('validate-layout-button'),
      autoSolve: document.getElementById('auto-solve-input'),
    }

    this._elements.mode.onchange = () => this._update();
    this._elements.stop.onclick = () => this._terminateSolver();
    this._elements.solve.onclick = () => this._solve();
    this._elements.validate.onclick = () => this._validateLayout();

    this._setUpAutoSolve();
    this._setUpKeyBindings();

    this._setUpStateOutput();
    this._displayStateVariables =
      deferUntilAnimationFrame(this._displayStateVariables.bind(this));

    this._historyHandler = new HistoryHandler((params) => {
      let mode = params.get('mode');
      if (mode) this._elements.mode.value = mode;

      let constraintsText = params.get('q');
      if (constraintsText) {
        this._constraintManager.loadFromText(constraintsText);
      }
    });

    this._update();
  }

  enableDebugOutput(enable) {
    this._debugOutput.enable(enable);
  }

  _setUpAutoSolve() {
    try {
      const cookieValue = document.cookie
        .split('; ')
        .find(row => row.startsWith('autoSolve='))
        .split('=')[1];
      this._elements.autoSolve.checked = cookieValue !== 'false';
    } catch (e) { /* ignore */ }

    this._elements.autoSolve.onchange = () => {
      let isChecked = this._elements.autoSolve.checked ? true : false;
      document.cookie = `autoSolve=${isChecked}`;
      // If we have enabled auto-solve, then start solving! Unless
      // we are already solving.
      if (isChecked && !this._isSolving) this._update();
    }
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
      constraints, this._displayState.bind(this),
      (logs) => this._debugOutput.addLogs(logs));

    return this._solver;
  }

  _showIterationControls(show) {
    this._elements.control.style.visibility = show ? 'visible' : 'hidden';
  }

  static _MODE_DESCRIPTIONS = {
    'all-possibilities':
      'Show all values which are present in any valid solution.',
    'solutions':
      'View each solution.',
    'count-solutions':
      'Count the total number of solutions by iterating over all solutions.',
    'step-by-step':
      'Step through the solving process.',
  };

  async _update() {
    let constraints = this._constraintManager.getConstraints();
    let mode = this._elements.mode.value;
    let auto = this._elements.autoSolve.checked;

    this._historyHandler.update({mode: mode, q: constraints});

    let description = SolutionController._MODE_DESCRIPTIONS[mode];
    this._elements.modeDescription.textContent = description;

    this._setValidateResult();

    if (auto || mode === 'step-by-step') {
      this._solve(constraints);
    } else {
      this._grid.setSolution([]);
      this._infoOverlay.clear();
      this._clearStateVariables();
      this._debugOutput.clear();
      this._terminateSolver();
      this._showIterationControls(false);
    }
  }

  async _solve(constraints) {
    constraints ||= this._constraintManager.getConstraints();
    let mode = this._elements.mode.value;

    this._grid.setSolution([]);
    this._infoOverlay.clear();
    this._debugOutput.clear();

    let solver = await this._replaceSolver(constraints);

    let handler = this._modeHandlers[mode];

    this._setSolving(true);
    handler.bind(this)(solver)
      .catch(e => this._setError(e))
      .finally(() => this._setSolving(false));
  }

  async _validateLayout(constraints) {
    this._infoOverlay.clear();
    this._debugOutput.clear();

    const solver = await this._replaceSolver(this._constraintManager.getLayoutConstraint());

    const statusElem = this._elements.solveStatus;

    let handler = async (solver) => {
      let result = await solver.validateLayout();
      this._setValidateResult(result ?'Valid layout' : 'Invalid layout');
      this._setSolving(false);
    };

    this._setSolving(true, 'Validating Layout');
    handler.bind(this)(solver)
      .catch(e => this._setError(e))
      .finally(() => this._setSolving(false));
  }

  _setError(text) {
    this._elements.error.textContent = text || '';
  }

  _setValidateResult(text) {
    this._elements.validateResult.textContent = text || '';
  }

  _setSolving(isSolving, msg) {
    this._isSolving = isSolving;
    if (isSolving) {
      this._elements.stop.disabled = false;
      this._elements.start.disabled = true;
      this._elements.forward.disabled = true;
      this._elements.back.disabled = true;
      this._elements.solveStatus.textContent = msg || 'Solving';
      this._setError();
      this._setValidateResult();
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
      'searchSpaceExplored',
      'puzzleSetupTime',
      'runtime',
    ];
    this._stateVars = {};
    for (const v of vars) {
      let elem = document.createElement('div');
      let value = document.createElement('span');
      let title = document.createElement('span');
      title.textContent = camelCaseToWords(v);
      title.className = 'description';
      if (v == 'solutions') title.style.fontSize = '16px';
      elem.appendChild(value);
      elem.appendChild(title);
      container.appendChild(elem);

      this._stateVars[v] = value;
    }
  }

  _clearStateVariables() {
    for (const v in this._stateVars) {
      this._stateVars[v].textContent = '';
    }
  }

  _displayStateVariables(state) {
    const counters = state.counters;

    for (const v in this._stateVars) {
      let text;
      switch (v) {
        case 'solutions':
          text = counters.solutions + (counters.branchesIgnored ? '+' : '');
          break;
        case 'puzzleSetupTime':
          text = state.puzzleSetupTime ? formatTimeMs(state.puzzleSetupTime) : '?';
          break;
        case 'runtime':
          text = formatTimeMs(state.timeMs);
          break;
        case 'searchSpaceExplored':
          text = (counters.progressRatio * 100).toPrecision(3) + '%';

          if (counters.progressRatioPrev > 0) {
            const extra = counters.progressRatioPrev * 100;
            const extraText = extra >= 100 ? Math.floor(extra): extra.toPrecision(2);
            text += ` (+${extraText}%)`;
          }
          break;
        default:
          text = counters[v];
      }
      this._stateVars[v].textContent = text;
    }
  }

  _displayState(state) {
    // Handle this in a seperate function, as then it can be defered
    // independently of the solution update.
    this._displayStateVariables(state);

    if (state.backtrackTriggers) {
      this._infoOverlay.setHeatmapValues(state.backtrackTriggers);
    }

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

// A info overlay which is lazily loaded.
class InfoOverlay {
  _infoOverlay;
  _cellMap;
  _container;
  _isClear = true;

  constructor(container) {
    this._container = container;
  }

  _initInfoOverlay() {
    const infoOverlay = document.createElement('div');
    infoOverlay.className = 'info-overlay';
    infoOverlay.style.padding = this._container.style.padding;
    this._container.append(infoOverlay);

    const cellMap = new Map();

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const cell = document.createElement('div');
        cell.className = 'cell-elem';
        const cellIndex = toCellIndex(i, j);
        cellMap[cellIndex] = cell;

        infoOverlay.appendChild(cell);
      }
    }

    this._cellMap = cellMap;
    this._infoOverlay = infoOverlay;
  }

  clear() {
    if (!this._infoOverlay) return;
    if (this._isClear) return;

    for (let i = 0; i < NUM_CELLS; i++) {
      this._cellMap[i].style.background = 'none';
      this._cellMap[i].textContent = '';
    }
    this._isClear = true;
  }

  setHeatmapValues(values) {
    if (!this._infoOverlay) this._initInfoOverlay();

    for (let i = 0; i < NUM_CELLS; i++) {
      this._cellMap[i].style.background = (
        `rgba(255, 0, 0, ${values[i]/1000})`);
    }
    this._isClear = false;
  }

  setValues(values) {
    if (!this._infoOverlay) this._initInfoOverlay();

    for (let i = 0; i < NUM_CELLS; i++) {
      this._cellMap[i].textContent = values[i];
    }
    this._isClear = false;
  }
}
