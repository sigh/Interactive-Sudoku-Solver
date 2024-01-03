// Make these variables global so that debug functions can access them.
let constraintManager, controller;

const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  const displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  constraintManager = new ConstraintManager(
    inputManager, displayContainer);
  constraintManager.addReshapeListener(displayContainer);
  constraintManager.addReshapeListener(inputManager);

  controller = new SolutionController(constraintManager, displayContainer);

  _setUpDebug(controller);
};

const _setUpDebug = (controller) => {
  const DEBUG_PARAM_NAME = 'debug';
  let debugLoaded = false;

  const updateURL = (enable) => {
    const url = new URL(window.location);
    if (enable) {
      url.searchParams.set(DEBUG_PARAM_NAME, 1);
    } else {
      url.searchParams.delete(DEBUG_PARAM_NAME);
    }
    window.history.pushState(null, null, url);
  };
  const closeButton = document.getElementById('close-debug-button');

  window.loadDebug = () => {
    controller.debugOutput.enable(true);
    updateURL(true);
    closeButton.style.display = 'block';
    if (debugLoaded) return Promise.resolve();

    debugLoaded = true;
    return dynamicJSFileLoader('js/debug.js')();
  };
  window.closeDebug = () => {
    controller.debugOutput.enable(false);
    closeButton.style.display = 'none';
    updateURL(false);
  };
  closeButton.onclick = window.closeDebug;

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get(DEBUG_PARAM_NAME) !== null) {
    window.loadDebug();
  }
};

class CheckboxConstraints {
  constructor(display, onChange) {
    this._checkboxes = {
      antiKnight: {
        id: 'anti-knight-input',
        constraint: new SudokuConstraint.AntiKnight(),
        isLayout: true,
      },
      antiKing: {
        id: 'anti-king-input',
        constraint: new SudokuConstraint.AntiKing(),
        isLayout: true,
      },
      antiConsecutive: {
        id: 'anti-consecutive-input',
        constraint: new SudokuConstraint.AntiConsecutive(),
        isLayout: false,
      },
      strictKropki: {
        id: 'strict-kropki-input',
        constraint: new SudokuConstraint.StrictKropki(),
        isLayout: false,
      },
      strictXV: {
        id: 'strict-xv-input',
        constraint: new SudokuConstraint.StrictXV(),
        isLayout: false,
      },
      disjointSets: {
        id: 'disjoint-sets',
        constraint: new SudokuConstraint.DisjointSets(),
        isLayout: false,
      },
      globalEntropy: {
        id: 'global-entropy-input',
        constraint: new SudokuConstraint.GlobalEntropy(),
        isLayout: false,
      },
      diagonalPlus: {
        id: 'diagonal-plus-input',
        constraint: new SudokuConstraint.Diagonal(1),
        isLayout: true,
      },
      diagonalMinus: {
        id: 'diagonal-minus-input',
        constraint: new SudokuConstraint.Diagonal(-1),
        isLayout: true,
      },
      windoku: {
        id: 'windoku-input',
        constraint: new SudokuConstraint.Windoku(),
        isLayout: true,
      },
      noBoxes: {
        id: 'no-boxes-input',
        constraint: new SudokuConstraint.NoBoxes(),
        isLayout: true,
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
    this._checkboxes.noBoxes.element.onchange = e => {
      display.useDefaultRegions(!this._checkboxes.noBoxes.element.checked);
      onChange();
    }
    this._checkboxes.windoku.element.onchange = e => {
      display.enableWindokuRegion(this._checkboxes.windoku.element.checked);
      onChange();
    }
  }

  _getConstraint(layout) {
    let constraints = [];
    for (const item of Object.values(this._checkboxes)) {
      if (layout && !item.isLayout) continue;

      if (item.element.checked && !item.element.disabled) {
        constraints.push(item.constraint);
      }
    }
    return new SudokuConstraint.Set(constraints);
  }

  getConstraint() {
    return this._getConstraint(false);
  }

  getLayoutConstraint() {
    return this._getConstraint(true);
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
    'XV-kropki',
    'Sandwich sudoku',
    'German whispers',
    'International whispers',
    'Renban',
    'Between lines',
    'Palindromes',
    'Jigsaw',
    'X-Windoku',
    'Region sum lines',
    'Disjoint little killer',
    'Skyscraper',
    'X-Sum',
    'Odd even',
    'Global entropy',
    'Quadruple X',
    '16x16',
    '16x16: Sudoku X, hard',
    '16x16: Jigsaw',
    '16x16: Windoku',
  ];

  constructor(constraintManager) {
    this._ignoreConstraintChanges = false;
    this._exampleSelect = this._setUp();
    this._constraintManager = constraintManager;
  }

  _setUp() {
    let exampleSelect = document.getElementById('example-select');

    for (const example of ExampleHandler._EXAMPLES) {
      if (!EXAMPLES[example]) throw ('Unknown example: ' + example);
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
  constructor(display, makePanelItem) {
    this._display = display;
    this._shape = null;
    this._makePanelItem = makePanelItem;

    this._regionPanel = document.getElementById('displayed-regions');

    this._piecesMap = [];
    this._maxPieceId = 0;
  }

  reshape(shape) {
    this._shape = shape;
    this._piecesMap = Array(shape.numCells).fill(0);
  }

  getConstraint() {
    if (this._piecesMap.every(x => x == 0)) return new SudokuConstraint.Set([]);

    const baseCharCode = SudokuTextParser.SHAPE_TO_BASE_CHAR_CODE.get(this._shape);

    const indexMap = new Map();
    const grid = Array(this._shape.numCells).fill('-');
    this._piecesMap.forEach((p, i) => {
      if (!indexMap.has(p)) indexMap.set(p, indexMap.size);
      grid[i] = String.fromCharCode(
        baseCharCode + indexMap.get(p));
    });
    return new SudokuConstraint.Jigsaw(grid.join(''));
  }

  setConstraint(constraint) {
    const grid = constraint.grid;
    const map = new Map();
    const shape = this._shape;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(i);
    }

    for (const [_, cells] of map) {
      if (cells.length == shape.gridSize) {
        this.addPiece(cells.map(c => shape.makeCellIdFromIndex(c)));
      }
    }
  }

  clear() {
    this._piecesMap.fill(0);
    this._regionPanel.innerHTML = '';
  }

  isValidJigsawPiece(selection) {
    if (selection.length != this._shape.gridSize) return false;

    // Check that we aren't overlapping an existing tile.
    if (selection.some(c => this._piecesMap[this._shape.parseCellId(c).cell] != 0)) {
      return false;
    }

    return true;
  }

  removePiece(config) {
    this._display.removeItem(config.displayElem);
    config.panelItem.parentNode.removeChild(config.panelItem);

    config.cells.forEach(c => this._piecesMap[this._shape.parseCellId(c).cell] = 0);
  }

  _addToRegionPanel(config) {
    this._regionPanel.appendChild(this._makePanelItem(config));
  }

  addPiece(cells) {
    const pieceId = ++this._maxPieceId;
    cells.forEach(c => this._piecesMap[this._shape.parseCellId(c).cell] = pieceId);
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

class ShapeManager {
  constructor() {
    this._shape = null;
    this._reshapeListeners = [];

    this._select = document.getElementById('shape-select');
    this._select.onchange = () => { this.reloadShape(); };
  }

  reshape(shape) {
    if (this._shape === shape) return;

    this._shape = shape;
    for (const listener of this._reshapeListeners) {
      listener.reshape(shape);
    }
  }

  addReshapeListener(listener) {
    this._reshapeListeners.push(listener);
  }

  reloadShape() {
    const shapeSelect = this._select;
    const shapeName = shapeSelect.value;
    const shape = GridShape.get(shapeName);
    if (!shape) throw ('Invalid shape: ' + shapeName);
    this.reshape(shape);
  }

  loadConstraintShape(constraint) {
    const shape = SudokuConstraint.getShape(constraint);
    this._select.value = shape.name;
    this.reshape(shape);
  }
}

class OutsideArrowConstraints {
  constructor(inputManager, display, onChange) {
    this._display = display;
    this._setUp(inputManager);
    this._onChange = onChange;
  }

  static _mapKey(type, lineId) {
    return `${type}|${lineId}`;
  }

  static _isValidValue(value, type) {
    if (value == '' || value != +value) return false;
    if (type != 'Sandwich' && +value == 0) return false;
    return true;
  }

  _setUp(inputManager) {
    this._constraints = new Map();

    let outsideArrowForm = document.forms['outside-arrow-input'];
    const clearOutsideArrow = () => {
      let formData = new FormData(outsideArrowForm);
      const lineId = formData.get('id');
      const type = formData.get('type');
      this._display.removeOutsideArrow(type, lineId);
      this._constraints.delete(this.constructor._mapKey(type, lineId));
      inputManager.setSelection([]);
      this._onChange();
    };
    outsideArrowForm.onsubmit = e => {
      let formData = new FormData(outsideArrowForm);
      let type = formData.get('type');
      let lineId = formData.get('id');

      let value = formData.get('value');
      if (!this.constructor._isValidValue(value, type)) {
        clearOutsideArrow();
        return false;
      }
      value = +value;

      this._addConstraint(
        this.constructor._makeConstraint(type, lineId, value),
        lineId,
        value);

      inputManager.setSelection([]);
      this._onChange();
      return false;
    };
    inputManager.addSelectionPreserver(outsideArrowForm);

    document.getElementById('outside-arrow-clear').onclick = clearOutsideArrow;
  }

  addConstraint(constraint) {
    const type = constraint.type;
    switch (type) {
      case 'LittleKiller':
        this._addConstraint(constraint, constraint.id, constraint.sum);
        break;
      case 'Sandwich':
        this._addConstraint(constraint, constraint.id + ',1', constraint.sum);
        break;
      case 'XSum':
      case 'Skyscraper':
        {
          const values = constraint.values();
          if (values[0]) {
            const lineId = constraint.rowCol + ',1';
            this._addConstraint(
              this.constructor._makeConstraint(type, lineId, values[0]),
              lineId, values[0]);
          }
          if (values[1]) {
            const lineId = constraint.rowCol + ',-1';
            this._addConstraint(
              this.constructor._makeConstraint(type, lineId, values[1]),
              lineId, values[1]);
          }
        }
        break;
      default:
        throw ('Unknown type: ' + type);
    }
  }

  _addConstraint(constraint, lineId, value) {
    this._constraints.set(
      this.constructor._mapKey(constraint.type, lineId), constraint);
    this._display.addOutsideArrow(constraint.type, lineId, value);
  }

  clear() {
    for (const [key, _] of this._constraints) {
      const [type, lineId] = key.split('|');
      this._display.removeOutsideArrow(type, lineId);
    }
    this._constraints = new Map();
  }

  static _makeConstraint(type, lineId, value) {
    let [rowCol, dir] = lineId.split(',');
    switch (type) {
      case 'LittleKiller':
        return new SudokuConstraint.LittleKiller(value, lineId);
      case 'Sandwich':
        return new SudokuConstraint.Sandwich(value, rowCol);
      case 'XSum':
      case 'Skyscraper':
        return new SudokuConstraint[type](
          rowCol,
          dir == 1 ? value : '',
          dir == 1 ? '' : value);
      default:
        throw ('Unknown type: ' + type);
    }
  }

  getConstraints() {
    const seen = new Map();

    const constraints = [];
    for (const constraint of this._constraints.values()) {
      const type = constraint.type;
      if (type == 'Skyscraper' || type == 'XSum') {
        const key = `${type}|${constraint.rowCol}`;
        if (seen.has(key)) {
          // Merge with the previous.
          const index = seen.get(key);
          const existingConstraint = constraints[index];
          constraints[index] = new SudokuConstraint[type](
            constraint.rowCol,
            existingConstraint.values()[0] || constraint.values()[0],
            existingConstraint.values()[1] || constraint.values()[1]);
          // We can skip adding another constraint.
          continue;
        } else {
          // Add to the seen list.
          seen.set(key, constraints.length);
        }
      }

      constraints.push(constraint);
    };
    return constraints;
  }
}


class ConstraintManager {
  constructor(inputManager, displayContainer) {
    this._configs = [];
    this._shape = null;
    this._checkboxes = {};

    this._invisibleConstraints = [];
    this._shapeManager = new ShapeManager();
    this._shapeManager.addReshapeListener(this);

    this._display = new ConstraintDisplay(
      inputManager, displayContainer);
    this.addReshapeListener(this._display);
    this._setUpPanel(inputManager, displayContainer);
    this._givenCandidates = new GivenCandidates(
      inputManager, this._display, this.runUpdateCallback.bind(this));
    this.addReshapeListener(this._givenCandidates);

    this.setUpdateCallback();
  }

  reshape(shape) {
    // Keep the checkbox constraints, since they are shape-agnostic.
    const checkboxes = this._checkboxConstraints.getConstraint();

    this.clear();
    this._shape = shape;
    this.loadConstraint(checkboxes);
  }
  addReshapeListener(listener) {
    this._shapeManager.addReshapeListener(listener);
  }

  setUpdateCallback(fn) {
    this.updateCallback = fn || (() => { });
  }

  runUpdateCallback() {
    this._exampleHandler.newConstraintLoaded();
    this.updateCallback(this);
  }

  getShape() {
    return this._shape;
  }

  _cellsAre2x2Square(cells) {
    if (cells.length != 4) return false;
    cells = cells.map(
      c => this._shape.parseCellId(c)).sort((a, b) => a.cell - b.cell);
    let { row, col } = cells[0];
    return (
      (cells[1].row == row && cells[1].col == col + 1) &&
      (cells[2].row == row + 1 && cells[2].col == col) &&
      (cells[3].row == row + 1 && cells[3].col == col + 1));
  }

  _cellsAreAdjacent(cells) {
    if (cells.length != 2) return false;
    // Manhattan distance is exactly 1.
    let cell0 = this._shape.parseCellId(cells[0]);
    let cell1 = this._shape.parseCellId(cells[1]);
    return 1 == Math.abs(cell0.row - cell1.row) + Math.abs(cell0.col - cell1.col);
  }

  _setUpPanel(inputManager, displayContainer) {
    this._constraintPanel = document.getElementById('displayed-constraints');
    this._panelItemHighlighter = displayContainer.createHighlighter('highlighted-cell');

    // Checkbox constraints.
    this._checkboxConstraints = new CheckboxConstraints(
      this._display, this.runUpdateCallback.bind(this));

    this._jigsawManager = new JigsawManager(
      this._display, this._makePanelItem.bind(this));
    this.addReshapeListener(this._jigsawManager);

    const selectionForm = document.forms['multi-cell-constraint-input'];
    inputManager.onSelection(
      (selection) => this._onNewSelection(selection, selectionForm));
    inputManager.addSelectionPreserver(selectionForm);

    selectionForm.onsubmit = e => {
      this._addConstraintFromForm(selectionForm, inputManager);
      return false;
    };

    // Selecting anything in the constraint cage will select it and focus on
    // the input box.
    selectionForm['multi-cell-constraint-cage'].onchange = () => {
      selectionForm['cage-sum'].select();
    };
    selectionForm['cage-sum'].onfocus = () => {
      selectionForm['multi-cell-constraint-cage'].checked = true;
    };
    // Selecting anything in the constraint sum will select it and focus on
    // the input box.
    selectionForm['multi-cell-constraint-sum'].onchange = () => {
      selectionForm['plain-sum'].select();
    };
    selectionForm['plain-sum'].onfocus = () => {
      selectionForm['multi-cell-constraint-sum'].checked = true;
    };

    // Selecting anything in the whisper constraint will select it and focus on
    // the input box.
    selectionForm['multi-cell-constraint-whisper'].onchange = () => {
      selectionForm['whisper-difference'].select();
    };
    selectionForm['whisper-difference'].onfocus = () => {
      selectionForm['multi-cell-constraint-whisper'].checked = true;
    };

    // Selecting anything in the whisper constraint will select it and focus on
    // the input box.
    selectionForm['multi-cell-constraint-quad'].onchange = () => {
      selectionForm['quad-values'].select();
    };
    selectionForm['quad-values'].onfocus = () => {
      selectionForm['multi-cell-constraint-quad'].checked = true;
    };

    // Outside arrows.
    this._outsideArrowConstraints = new OutsideArrowConstraints(
      inputManager, this._display, this.runUpdateCallback.bind(this));

    // Load examples.
    this._exampleHandler = new ExampleHandler(this);

    // Free-form.
    const freeInputForm = document.forms['freeform-constraint-input'];
    const freeInputError = document.getElementById('freeform-constraint-input-error');
    freeInputForm.onsubmit = e => {
      e.preventDefault();
      const input = (new FormData(freeInputForm)).get('freeform-input');
      try {
        this.loadFromText(input);
      } catch (e) {
        console.error(e + ' Input: ' + input);
        freeInputError.textContent = e;
      }
      return false;
    };
    freeInputForm['freeform-input'].oninput = () => {
      freeInputError.textContent = '';
    };

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
      'multi-cell-constraint-x',
      'multi-cell-constraint-v',
    ];

    // Enable/disable the adjacent only constraints.
    let cellsAreAdjacent = this._cellsAreAdjacent(selection);
    for (const c of adjacentOnlyConstraints) {
      const elem = selectionForm[c];
      if (cellsAreAdjacent) {
        elem.disabled = false;
      } else {
        elem.checked = false;
        elem.disabled = true;
      }
    }

    // Sum constraints can only be of size 16 or less.
    {
      const sumDisabled = (selection.length > 16);
      selectionForm['multi-cell-constraint-sum'].disabled = sumDisabled;
      selectionForm['multi-cell-constraint-sum-input'].disabled = sumDisabled;
      if (sumDisabled) {
        selectionForm['multi-cell-constraint-sum'].checked = false;
      }
    }

    // Quad constraint must have exactly 4 cells, and they must be in a grid.
    {
      const quadDisabled = !(selection.length == 4 && this._cellsAre2x2Square(selection));
      selectionForm['multi-cell-constraint-quad'].disabled = quadDisabled;
      selectionForm['multi-cell-constraint-quad-input'].disabled = quadDisabled;
      if (quadDisabled) {
        selectionForm['multi-cell-constraint-quad'].checked = false;
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
    //   - If the whisper is selected then focus on the text box for easy input.
    //   - Otherwise just focus on the submit button.
    if (selectionForm['multi-cell-constraint-cage'].checked) {
      selectionForm['cage-sum'].select();
    } else if (selectionForm['multi-cell-constraint-sum'].checked) {
      selectionForm['plain-sum'].select();
    } else if (selectionForm['multi-cell-constraint-whisper'].checked) {
      selectionForm['whisper-difference'].select();
    } else if (selectionForm['multi-cell-constraint-quad'].checked) {
      selectionForm['quad-values'].select();
    } else {
      selectionForm.querySelector('button[type=submit]').focus();
    }
  }

  loadFromText(input) {
    const constraint = SudokuConstraint.fromText(input);
    if (constraint) {
      this.clear();
      this._shapeManager.loadConstraintShape(constraint);
      this.loadConstraint(constraint);
    }

    this.runUpdateCallback();
  }

  loadConstraint(constraint) {
    let config;
    switch (constraint.type) {
      case 'Givens':
        this._givenCandidates.setValueIds(constraint.values);
        break;
      case 'X':
        config = {
          cells: constraint.cells,
          name: 'x',
          constraint: constraint,
          displayElem: this._display.drawXV(constraint.cells, 'x'),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'V':
        config = {
          cells: constraint.cells,
          name: 'v',
          constraint: constraint,
          displayElem: this._display.drawXV(constraint.cells, 'v'),
        };
        this._addToPanel(config);
        this._configs.push(config);
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
          name: `Whisper (${constraint.difference})`,
          constraint: constraint,
          displayElem: this._display.drawWhisper(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Renban':
        config = {
          cells: constraint.cells,
          name: 'Renban',
          constraint: constraint,
          displayElem: this._display.drawRenban(constraint.cells),
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
      case 'Between':
        config = {
          cells: constraint.cells,
          name: 'Between',
          constraint: constraint,
          displayElem: this._display.drawBetween(constraint.cells),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'RegionSumLine':
        config = {
          cells: constraint.cells,
          name: 'RegionSumLine',
          constraint: constraint,
          displayElem: this._display.drawRegionSumLine(constraint.cells),
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
      case 'Sum':
        config = {
          cells: constraint.cells,
          name: `Sum (${constraint.sum})`,
          constraint: constraint,
          displayElem: this._display.drawKillerCage(
            constraint.cells, constraint.sum, true),
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'Quad':
        config = {
          cells: constraint.cells(),
          name: `Quad (${constraint.values.join(',')})`,
          constraint: constraint,
          displayElem: this._display.drawQuad(
            constraint.topLeftCell, constraint.values),
          replaceKey: `Quad-${constraint.topLeftCell}`,
        };
        this._addToPanel(config);
        this._configs.push(config);
        break;
      case 'LittleKiller':
      case 'Sandwich':
      case 'XSum':
      case 'Skyscraper':
        this._outsideArrowConstraints.addConstraint(constraint);
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
      case 'StrictKropki':
        this._checkboxConstraints.check('strictKropki');
        break;
      case 'StrictXV':
        this._checkboxConstraints.check('strictXV');
        break;
      case 'DisjointSets':
        this._checkboxConstraints.check('disjointSets');
        break;
      case 'GlobalEntropy':
        this._checkboxConstraints.check('globalEntropy');
        break;
      case 'Diagonal':
        if (constraint.direction > 0) {
          this._checkboxConstraints.check('diagonalPlus');
        } else {
          this._checkboxConstraints.check('diagonalMinus');
        }
        break;
      case 'NoBoxes':
        this._checkboxConstraints.check('noBoxes');
        break;
      case 'Windoku':
        this._checkboxConstraints.check('windoku');
        break;
      case 'Set':
        constraint.constraints.forEach(c => this.loadConstraint(c));
        break;
      case 'Shape':
        // Nothing to do, but ensure it is not added to invisible constraints.
        break;
      default:
        this._invisibleConstraints.push(constraint);
        break;
    }
    this.runUpdateCallback();
  }

  _addConstraintFromForm(selectionForm, inputManager) {
    const cells = inputManager.getSelection();
    if (cells.length < 2) throw ('Selection too short.');

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
      case 'sum':
        constraint = new SudokuConstraint.Sum(+formData.get('plain-sum'), ...cells);
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
        let difference = +formData.get('whisper-difference');
        constraint = new SudokuConstraint.Whisper(difference, ...cells);
        this.loadConstraint(constraint);
        break;
      case 'renban':
        constraint = new SudokuConstraint.Renban(...cells);
        this.loadConstraint(constraint);
        break;
      case 'region-sum':
        constraint = new SudokuConstraint.RegionSumLine(...cells);
        this.loadConstraint(constraint);
        break;
      case 'between':
        constraint = new SudokuConstraint.Between(...cells);
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
      case 'x':
        constraint = new SudokuConstraint.X(...cells);
        this.loadConstraint(constraint);
        break;
      case 'v':
        constraint = new SudokuConstraint.V(...cells);
        this.loadConstraint(constraint);
        break;
      case 'quad':
        let valuesStr = formData.get('quad-values');
        let values = valuesStr.split(/[, ]+/).map(v => +v).filter(
          v => Number.isInteger(v) && v >= 1 && v <= this._shape.numValues);
        if (values.length) {
          cells.sort();
          constraint = new SudokuConstraint.Quad(cells[0], ...values);
          this.loadConstraint(constraint);
        }
        break;
    }

    inputManager.setSelection([]);
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

    this._panelItemHighlighter.clear();
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
      this._panelItemHighlighter.setCells(config.cells);
    });
    panelItem.addEventListener('mouseout', () => {
      this._panelItemHighlighter.clear();
    });

    if (config.replaceKey) {
      for (const other of this._configs) {
        if (config.replaceKey == other.replaceKey) {
          this._removePanelConstraint(other);
          break;
        }
      }
    }

    return panelItem;
  }

  _PANEL_ICON_SIZE_PX = 28;

  _makePanelIcon(config) {
    const svg = createSvgElement('svg');

    const borders = createSvgElement('g');
    const borderDisplay = new BorderDisplay(
      borders, 'rgb(255, 255, 255)');
    borderDisplay.reshape(this._shape);
    svg.append(borders);

    // Determine the correct scale to fit our icon size.
    const gridSizePixels = borderDisplay.gridSizePixels();
    const scale = this._PANEL_ICON_SIZE_PX / gridSizePixels;
    const transform = `scale(${scale})`;

    borders.setAttribute('transform', transform);
    borders.setAttribute('stoke-width', 0);

    const elem = config.displayElem.cloneNode(true);
    elem.setAttribute('transform', transform);
    elem.setAttribute('stroke-width', 15);
    elem.setAttribute('opacity', 1);

    svg.append(elem);
    svg.style.height = this._PANEL_ICON_SIZE_PX + 'px';
    svg.style.width = this._PANEL_ICON_SIZE_PX + 'px';
    // Undo the opacity (for killer cages).
    svg.style.filter = 'saturate(100)';

    return svg;
  }

  _addToPanel(config) {
    this._constraintPanel.appendChild(this._makePanelItem(config));
  }

  getLayoutConstraint() {
    const constraints = [];
    constraints.push(this._jigsawManager.getConstraint());
    constraints.push(this._checkboxConstraints.getLayoutConstraint());
    return new SudokuConstraint.Set(constraints);
  }

  getConstraints() {
    if (!this._shape) this._shapeManager.reloadShape();

    let constraints = this._configs.map(c => c.constraint);
    constraints.push(this._jigsawManager.getConstraint());
    constraints.push(this._checkboxConstraints.getConstraint());
    constraints.push(...this._outsideArrowConstraints.getConstraints());
    constraints.push(this._givenCandidates.getConstraint());
    constraints.push(new SudokuConstraint.Shape(this._shape.name));
    constraints.push(...this._invisibleConstraints);

    return new SudokuConstraint.Set(constraints);
  }

  getFixedCells() {
    return this._givenCandidates.getFixedCells();
  }

  clear() {
    this._display.clear();
    this._constraintPanel.innerHTML = '';
    this._checkboxConstraints.uncheckAll();
    this._outsideArrowConstraints.clear();
    this._configs = [];
    this._jigsawManager.clear();
    this._givenCandidates.unsafeClear();  // OK because display is cleared.
    this._invisibleConstraints = [];
    this.runUpdateCallback();
  }
}

class Highlight {
  constructor(display, cssClass) {
    this._cells = new Map();
    this._cssClass = cssClass;

    this._display = display;
  }

  setCells(cellIds) {
    this.clear();
    for (const cellId of cellIds) this.addCell(cellId);
  }

  size() {
    return this._cells.size;
  }

  getCells() {
    return this._cells.keys();
  }

  addCell(cell) {
    if (!this._cells.has(cell)) {
      const path = this._display.highlightCell(cell, this._cssClass);
      this._cells.set(cell, path);
      return path;
    }
  }

  clear() {
    for (const path of this._cells.values()) {
      this._display.removeHighlight(path)
    }
    this._cells.clear();
  }
}

class Selection {
  constructor(displayContainer) {
    this._highlight = displayContainer.createHighlighter('selected-cell');

    this._clickInterceptor = displayContainer.getClickInterceptor();

    this._selectionPreservers = [this._clickInterceptor.getSvg()];

    this._setUpMouseHandlers(this._clickInterceptor.getSvg());

    this._callbacks = [];
  }

  addCallback(fn) {
    this._callbacks.push(fn);
  }

  _runCallback() {
    this._callbacks.forEach(fn => fn(
      [...this._highlight.getCells()]));
  }

  setCells(cellIds) {
    this._highlight.setCells(cellIds);
    this._runCallback();
  }
  getCells(cellIds) { return this._highlight.getCells(cellIds); }
  size() { return this._highlight.size; }

  cellIdCenter(cellId) {
    return this._clickInterceptor.cellIdCenter(cellId);
  }

  _setUpMouseHandlers(container) {
    // Make the container selectable.
    container.tabIndex = 0;

    const cellFuzziness = 1.4 * (DisplayItem.CELL_SIZE / 2);

    let currCell = null;
    let currCenter = null;
    const pointerMoveFn = e => {
      const target = this._clickInterceptor.cellAt(e.offsetX, e.offsetY);
      if (target === null || target === currCell) return;

      // Make current cell hitbox larger so that we can more easily
      // select diagonals without hitting adjacent cells.
      const dx = Math.abs(e.offsetX - currCenter[0]);
      const dy = Math.abs(e.offsetY - currCenter[1]);
      if (Math.max(dx, dy) < cellFuzziness) return;

      currCell = target;
      currCenter = this._clickInterceptor.cellIdCenter(currCell);
      this._highlight.addCell(currCell);
    };
    const outsideClickListener = e => {
      // Don't do anything if the click is inside one of the elements where
      // we want to retain clicks.
      for (const elem of this._selectionPreservers) {
        if (elem.contains(e.target)) return;
      }
      // Otherwise clear the selection.
      this.setCells([]);
      document.body.removeEventListener('click', outsideClickListener);
    };
    container.addEventListener('pointerdown', e => {
      // If the shift key is pressed, continue adding to the selection.
      if (!e.shiftKey) {
        this.setCells([]);
      }
      container.addEventListener('pointermove', pointerMoveFn);
      document.body.addEventListener('click', outsideClickListener);
      currCell = null;
      currCenter = [Infinity, Infinity];
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

class GivenCandidates {
  constructor(inputManager, display, onChange) {
    this._shape = null;
    this._givensMap = new Map();
    this._display = display;
    this._onChange = onChange;

    inputManager.onNewDigit(this._inputDigit.bind(this));
    inputManager.onSetValue(this._replaceValue.bind(this));
    inputManager.onSetValuesMultiCell(this._replaceValuesMultiCell.bind(this));
  }

  reshape(shape) { this._shape = shape; }

  _inputDigit(cell, digit) {
    const values = this._givensMap.get(cell) || [];
    const currValue = values.length == 1 ? values[0] : 0;

    let newValue;
    if (digit === null) {
      newValue = 0;
    } else {
      const numValues = this._shape.numValues;
      newValue = currValue * 10 + digit;
      if (newValue > numValues) newValue = digit;
    }

    this._replaceValue(cell, newValue);
  }

  _replaceValuesMultiCell(cells, values) {
    for (const cell of cells) {
      this._replaceValuesNoUpdate(cell, values);
    }
    this._givensUpdated();
  }

  _replaceValue(cell, value) {
    this._replaceValuesNoUpdate(cell, [value]);
    this._givensUpdated();
  }

  _replaceValuesNoUpdate(cell, values) {
    const numValues = this._shape.numValues;
    values = values.filter(v => v && v > 0 && v <= numValues);
    if (values && values.length) {
      this._givensMap.set(cell, values);
    } else {
      this._givensMap.delete(cell);
    }
  }

  setValueIds(valueIds) {
    for (const valueId of valueIds) {
      const parsed = this._shape.parseValueId(valueId);
      this._replaceValuesNoUpdate(parsed.cellId, parsed.values);
    }
    this._givensUpdated();
  }

  _givensUpdated() {
    this._display.drawGivens(this._givensMap);
    this._onChange();
  }

  getConstraint() {
    const valueIds = [];
    for (const [cell, values] of this._givensMap) {
      valueIds.push(`${cell}_${values.join('_')}`);
    }
    return new SudokuConstraint.Givens(...valueIds);
  }

  getFixedCells() {
    let cells = [];
    for (const [cell, values] of this._givensMap) {
      if (values.length === 1) cells.push(cell);
    }
    return cells;
  }

  unsafeClear() {
    this._givensMap = new Map();
  }
}

class GridInputManager {
  constructor(displayContainer) {
    this._shape = null;

    this._callbacks = {
      onNewDigit: [],
      onSetValue: [],
      onSetValuesMultiCell: [],
      onSelection: [],
    };
    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    let fakeInput = document.getElementById('fake-input');
    this._fakeInput = fakeInput;

    this._selection = new Selection(displayContainer);
    this._selection.addCallback(cellIds => {
      this._multiValueInputManager.updateSelection(cellIds);
      if (cellIds.length == 1) {
        this._runCallbacks(this._callbacks.onSelection, []);
        const [x, y] = this._selection.cellIdCenter(cellIds[0]);
        fakeInput.style.top = y + 'px';
        fakeInput.style.left = x + 'px';
        fakeInput.select();
      } else {
        this._runCallbacks(this._callbacks.onSelection, cellIds);
      }
    });

    this._setUpKeyBindings();
    this._multiValueInputManager = new MultiValueInputManager(
      this,
      (...args) => {
        this._runCallbacks(this._callbacks.onSetValuesMultiCell, ...args)
      });
  }

  reshape(shape) {
    this._shape = shape;
    this._multiValueInputManager.reshape(shape);
  }

  onNewDigit(fn) { this._callbacks.onNewDigit.push(fn); }
  onSetValue(fn) { this._callbacks.onSetValue.push(fn); }
  onSetValuesMultiCell(fn) { this._callbacks.onSetValuesMultiCell.push(fn); }
  onSelection(fn) { this._callbacks.onSelection.push(fn); }

  addSelectionPreserver(obj) {
    this._selection.addSelectionPreserver(obj);
  }
  setSelection(cells) {
    this._selection.setCells(cells);
  }
  getSelection() {
    return [...this._selection.getCells()];
  }

  _runCallbacks(callbacks, ...args) {
    for (const callback of callbacks) {
      callback(...args);
    }
  }

  _setUpKeyBindings() {
    const getActiveCell = () => {
      let cells = [...this._selection.getCells()];
      if (cells.length != 1) return null;
      return cells[0];
    };

    const updateActiveCellValue = (value) => {
      const cell = getActiveCell();
      if (!cell) return;

      if (value == '') {
        this._runCallbacks(this._callbacks.onSetValue, cell, null);
        return;
      }

      const digit = parseInt(value);
      if (!Number.isNaN(digit)) {
        this._runCallbacks(this._callbacks.onNewDigit, cell, digit);
      }
    }

    const moveActiveCell = (dr, dc) => {
      let cell = getActiveCell();
      if (!cell) return;

      const shape = this._shape;
      let { row, col } = shape.parseCellId(cell);
      const gridSize = shape.gridSize;
      row = (row + dr + gridSize) % gridSize;
      col = (col + dc + gridSize) % gridSize;

      this._selection.setCells([shape.makeCellId(row, col)]);
    };

    let fakeInput = this._fakeInput;
    fakeInput.addEventListener('input', event => {
      updateActiveCellValue(fakeInput.value);

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
      if (this._selection.size() == 0) return;
      switch (event.key) {
        case 'c':
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onSetValue, cell, null);
          }
          break;
        case 'f':
          let i = 1;
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onSetValue, cell, i++);
          }
          break;
      }
    });
  }
}

class MultiValueInputManager {
  constructor(inputManager, onChange) {
    this._containerElem = document.getElementById('multi-value-cell-input');
    this._dropdownElem = this._containerElem.getElementsByClassName('dropdown-container')[0];
    this._listElem = this._dropdownElem.getElementsByClassName('dropdown-body')[0];
    this._fieldset = this._containerElem.getElementsByTagName('fieldset')[0];
    this._onChange = onChange;

    this._setUp(inputManager);
  }

  updateSelection(selection) {
    this._currentSelection = [];
    this._clearForm();
    this._currentSelection = selection;
    // Add a delay so that the display doesn't flicker.
    // We don't have to worry about consistency as it uses the
    // latest value of _currentSelection.
    window.setTimeout(() => {
      if (this._currentSelection.length == 0) {
        this._dropdownElem.classList.add('disabled');
      } else {
        this._dropdownElem.classList.remove('disabled');
      }
    }, 100);
  };

  reshape(shape) {
    clearDOMNode(this._listElem);
    for (let i = 0; i < shape.numValues; i++) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.setAttribute('type', 'checkbox');
      label.appendChild(input);
      label.appendChild(document.createTextNode(i + 1));
      li.appendChild(label);
      this._listElem.appendChild(li);
    }

    this._listElem.style.setProperty(
      'grid-template-columns', `repeat(${shape.boxSize}, 1fr)`);
  }

  _setUp(inputManager) {
    const dropdown = this._dropdownElem;
    dropdown.getElementsByClassName('dropdown-anchor')[0].onclick = (e) => {
      if (this._currentSelection.length == 0) return;
      dropdown.classList.toggle('visible');
    };

    inputManager.addSelectionPreserver(this._containerElem);

    this._currentSelection = [];

    const form = this._containerElem;
    form.onchange = () => {
      if (this._currentSelection.length == 0) return;

      this._onChange(
        this._currentSelection,
        this._getCheckedValues());
    };
  }

  _getCheckedValues() {
    const inputs = this._containerElem.elements;
    const setValues = [];
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].checked) {
        setValues.push(i + 1);
      }
    }
    return setValues;
  }

  _clearForm() {
    const inputs = this._containerElem.elements;
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].checked = false;
    }
  }
}

// A info overlay which is lazily loaded.
class InfoOverlay {
  constructor(displayContainer) {
    this._shape = null;

    this._heatmap = displayContainer.createHighlighter();
    this._textInfo = new InfoTextDisplay(
      displayContainer.getNewGroup('text-info-group'));
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();

    this._textInfo.reshape(shape);
  }

  clear() {
    this._heatmap.clear();
    this._textInfo.clear();
  }

  setHeatmapValues(values) {
    const shape = this._shape;
    this._heatmap.clear();

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      const path = this._heatmap.addCell(cellId);
      path.setAttribute('fill', 'rgb(255, 0, 0)');
      path.setAttribute('opacity', values[i] / 1000);
    }
  }

  setValues(values) {
    const shape = this._shape;
    this._textInfo.clear();

    if (!values) return;

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      this._textInfo.setText(cellId, values[i]);
    }
  }
}