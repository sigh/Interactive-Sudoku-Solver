// Make these variables global so that we can easily access them from the
// console.
let constraintManager, controller, displayContainer;

const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  constraintManager = new ConstraintManager(
    inputManager, displayContainer);
  constraintManager.addReshapeListener(displayContainer);
  constraintManager.addReshapeListener(inputManager);

  controller = new SolutionController(constraintManager, displayContainer);
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

    this._piecesMap = new Array();
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
        this.addPiece(cells.map(c => shape.makeCellId(...shape.splitCellIndex(c))));
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

class ConstraintManager {
  constructor(inputManager, displayContainer) {
    this._configs = [];
    this._shape = null;
    this._checkboxes = {};

    this._shapeManager = new ShapeManager();
    this._shapeManager.addReshapeListener(this);

    this._display = new ConstraintDisplay(
      inputManager, displayContainer);
    this.addReshapeListener(this._display);
    this._setUpPanel(inputManager, displayContainer);
    this._fixedValues = new FixedValues(
      inputManager, this._display, this.runUpdateCallback.bind(this));
    this.addReshapeListener(this._fixedValues);

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

  _cellsAreAdjacent(cells) {
    if (cells.length != 2) return false;
    // Manhatten distance is exactly 1.
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

    // Selecting anything in the whisper constraint will select it and focus on
    // the input box.
    selectionForm['multi-cell-constraint-whisper'].onchange = () => {
      selectionForm['whisper-difference'].select();
    };
    selectionForm['whisper-difference'].onfocus = () => {
      selectionForm['multi-cell-constraint-whisper'].checked = true;
    };

    // Little killer.
    this._setUpLittleKiller(inputManager);

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
        console.log(e + ' Input: ' + input);
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
    } else if (selectionForm['multi-cell-constraint-whisper'].checked) {
      selectionForm['whisper-difference'].select();
    } else {
      selectionForm.querySelector('button[type=submit]').focus();
    }
  }

  _setUpLittleKiller(inputManager) {
    this._outsideArrowConstraints = {};

    let outsideArrowForm = document.forms['outside-arrow-input'];
    const clearOutsideArrow = () => {
      let formData = new FormData(outsideArrowForm);
      let id = formData.get('id');
      delete this._outsideArrowConstraints[id];
      this._display.removeOutsideArrow(id);
      inputManager.setSelection([]);
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

      inputManager.setSelection([]);
      this.runUpdateCallback();
      return false;
    };
    inputManager.addSelectionPreserver(outsideArrowForm);

    document.getElementById('outside-arrow-clear').onclick = clearOutsideArrow;
  }

  _removeAllLittleKillers() {
    for (const cell in this._outsideArrowConstraints) {
      this._display.removeOutsideArrow(cell);
    }
    this._outsideArrowConstraints = {};
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
      case 'FixedValues':
        constraint.values.forEach(valueId => {
          this._fixedValues.setValueId(valueId);
        });
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
        var name;
        if (constraint.difference==5) {
          name = 'Whisper';
        } else {
          name = 'Whisper ('+constraint.difference+')';
        }
        config = {
          cells: constraint.cells,
          name: name,
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
      case 'StrictKropki':
        this._checkboxConstraints.check('strictKropki');
        break;
      case 'StrictXV':
        this._checkboxConstraints.check('strictXV');
        break;
      case 'DisjointSets':
        this._checkboxConstraints.check('disjointSets');
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
      case 'thermo':
        constraint = new SudokuConstraint.Thermo(...cells);
        this.loadConstraint(constraint);
        break;
      case 'jigsaw':
        this._jigsawManager.addPiece(cells);
        break;
      case 'whisper':
        let difference = +formData.get('whisper-difference');
        if (difference==5) {
          constraint = new SudokuConstraint.Whisper(...cells);
        } else {
          constraint = new SudokuConstraint.Whisper(difference, ...cells);
        }
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
    constraints.push(...Object.values(this._outsideArrowConstraints));
    constraints.push(this._fixedValues.getConstraint());
    constraints.push(new SudokuConstraint.Shape(this._shape.name));

    return new SudokuConstraint.Set(constraints);
  }

  getFixedCells() {
    return this._fixedValues.getFixedCells();
  }

  clear() {
    this._display.clear();
    this._constraintPanel.innerHTML = '';
    this._checkboxConstraints.uncheckAll();
    this._removeAllLittleKillers();
    this._configs = [];
    this._jigsawManager.clear();
    this._fixedValues.unsafeClear();  // OK because display is cleared.
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

    const cellFuziness = 1.4 * (DisplayItem.CELL_SIZE / 2);

    let currCell = null;
    let currCenter = null;
    const pointerMoveFn = e => {
      const target = this._clickInterceptor.cellAt(e.offsetX, e.offsetY);
      if (target === null || target === currCell) return;

      // Make current cell hitbox larger so that we can more easily
      // select diagonals without hitting adjacent cells.
      const dx = Math.abs(e.offsetX - currCenter[0]);
      const dy = Math.abs(e.offsetY - currCenter[1]);
      if (Math.max(dx, dy) < cellFuziness) return;

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

class FixedValues {
  constructor(inputManager, display, onChange) {
    this._shape = null;
    this._fixedValueMap = new Map();
    this._display = display;
    this._onChange = onChange;

    inputManager.onNewDigit(this._inputDigit.bind(this));
    inputManager.onSetValue(this._updateValue.bind(this));
  }

  reshape(shape) { this._shape = shape; }

  _inputDigit(cell, digit) {
    const currValue = this._fixedValueMap.get(cell) || 0;

    let newValue;
    if (digit === null) {
      newValue = 0;
    } else {
      const numValues = this._shape.numValues;
      newValue = currValue * 10 + digit;
      if (newValue > numValues) newValue = digit;
      if (newValue > numValues) newValue = 0;
    }

    this._updateValue(cell, newValue);
  }

  _updateValue(cell, value) {
    const numValues = this._shape.numValues;
    if (value > 0 && value <= numValues) {
      this._fixedValueMap.set(cell, value);
    } else {
      this._fixedValueMap.delete(cell);
    }

    this._display.drawFixedValue(cell, value || '');
    this._onChange();
  }

  setValueId(valueId) {
    const parsed = this._shape.parseValueId(valueId);
    this._updateValue(parsed.cellId, parsed.value);
  }

  getConstraint() {
    const values = [];
    for (const [cell, value] of this._fixedValueMap) {
      values.push(`${cell}_${value}`);
    }
    return new SudokuConstraint.FixedValues(...values);
  }

  getFixedCells() {
    return this._fixedValueMap.keys();
  }

  unsafeClear() {
    this._fixedValueMap = new Map();
  }
}

class GridInputManager {
  constructor(displayContainer) {
    this._shape = null;

    this._callbacks = {
      onNewDigit: [],
      onSetValue: [],
      onSelection: [],
    };
    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    let fakeInput = document.getElementById('fake-input');
    this._fakeInput = fakeInput;

    this._selection = new Selection(displayContainer);
    this._selection.addCallback(cellIds => {
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
  }

  reshape(shape) { this._shape = shape; }

  onNewDigit(fn) { this._callbacks.onNewDigit.push(fn); }
  onSetValue(fn) { this._callbacks.onSetValue.push(fn); }
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
    let q = '' + (params.q || '');

    this._addToHistory(q);
    this._updateUrl(params);
  }

  _addToHistory(q) {
    if (q == this._history[this._historyLocation]) return;
    this._history.length = this._historyLocation + 1;
    this._history.push(q || '');
    this._historyLocation++;

    if (this._history.length > HistoryHandler.MAX_HISTORY) {
      this._history = this._history.slice(HISTORY_ADJUSTMENT);
      this._historyLocation -= HISTORY_ADJUSTMENT;
    }

    this._updateButtons();
  }

  _incrementHistory(delta) {
    let q = this._history[this._historyLocation + delta];
    if (q === undefined) return;
    this._historyLocation += delta;
    this._updateButtons();

    this._updateUrl({ q: q });
    this._onUpdate(new URLSearchParams({ q: q }));
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
  constructor(displayContainer) {
    this._container = document.getElementById('debug-container');
    this._visible = false;
    this._shape = null;
    this._infoOverlay = new InfoOverlay(displayContainer);;

    this._debugCellHighlighter = displayContainer.createHighlighter('highlighted-cell');
  }

  reshape(shape) {
    this.clear();
    this._shape = shape;
    this._infoOverlay.reshape(shape);
  }

  clear() {
    if (!this._visible) return;

    this._container.textContent = '';
    this._infoOverlay.clear();
  }

  update(data) {
    if (!this._visible) return;

    data.logs.forEach(l => this._addLog(l));

    if (data.debugState && data.debugState.backtrackTriggers) {
      this._infoOverlay.setHeatmapValues(data.debugState.backtrackTriggers);
    }
  }

  setOverlayValues(values) {
    this._infoOverlay.setValues(values);
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

    const shape = this._shape;

    if (data.cells && data.cells.length) {
      const cellIds = [...data.cells].map(c => shape.makeCellId(...shape.splitCellIndex(c)));
      elem.addEventListener('mouseover', () => {
        this._debugCellHighlighter.setCells(cellIds);
      });
      elem.addEventListener('mouseout', () => {
        this._debugCellHighlighter.clear();
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

class SolverStateDisplay {
  constructor(solutionDisplay) {
    this._solutionDisplay = solutionDisplay;

    this._elements = {
      progressContainer: document.getElementById('progress-container'),
      stateOutput: document.getElementById('state-output'),
      error: document.getElementById('error-output'),
      progressBar: document.getElementById('solve-progress'),
      progressPercentage: document.getElementById('solve-percentage'),
      solveStatus: document.getElementById('solve-status'),
      stepStatus: document.getElementById('step-status'),
    };

    this._setUpStateOutput();

    this._lazyUpdateState = deferUntilAnimationFrame(
      this._lazyUpdateState.bind(this));
  }

  _lazyUpdateState(state) {
    this._displayStateVariables(state);

    this._updateProgressBar(state);
  }

  _METHOD_TO_STATUS = {
    'solveAllPossibilities': 'Solving',
    'nthSolution': 'Solving',
    'nthStep': '',
    'countSolutions': 'Counting',
    'validateLayout': 'Validating',
    'terminate': 'Aborted',
  };

  setSolveStatus(isSolving, method) {
    if (!isSolving && method == 'terminate') {
      this._elements.solveStatus.textContent = this._METHOD_TO_STATUS[method];
      this._elements.progressContainer.classList.add('error');
      return;
    }

    if (isSolving) {
      this._elements.solveStatus.textContent = this._METHOD_TO_STATUS[method];
    } else {
      this._elements.solveStatus.textContent = '';
    }
    this._elements.progressContainer.classList.remove('error');
  }

  setState(state) {
    this._lazyUpdateState(state);

    // Handle extra state.
    // This must be handled as we see it because we only see each solution once.
    let extra = state.extra;
    if (!extra) return;

    if (extra.solution || extra.pencilmarks) {
      this._solutionDisplay.setSolution(extra.solution, extra.pencilmarks);
    }
  }

  setStepStatus(status) {
    this._elements.stepStatus.textContent = status || '';
  }

  clear() {
    for (const v in this._stateVars) {
      this._stateVars[v].textContent = '';
    }
    this._elements.progressBar.setAttribute('value', 0);
    this._elements.progressPercentage.textContent = '';
    this.setSolveStatus(false, '');
    this._elements.solveStatus.textContent = '';
    this._elements.stepStatus.textContent = '';
  }

  _displayStateVariables(state) {
    const counters = state.counters;
    const searchComplete = state.done && !counters.branchesIgnored;

    for (const v in this._stateVars) {
      let text;
      switch (v) {
        case 'solutions':
          text = counters.solutions + (searchComplete ? '' : '+');
          break;
        case 'puzzleSetupTime':
          text = state.puzzleSetupTime ? formatTimeMs(state.puzzleSetupTime) : '?';
          break;
        case 'runtime':
          text = formatTimeMs(state.timeMs);
          break;
        case 'searchSpaceExplored':
          text = (counters.progressRatio * 100).toPrecision(3) + '%';
          if (searchComplete) text = '100%';
          break;
        default:
          text = counters[v];
      }
      this._stateVars[v].textContent = text;
    }
  }

  _updateProgressBar(state) {
    const progress = state.done
      ? 1
      : state.counters.progressRatio + state.counters.branchesIgnored;
    const percent = Math.round(progress * 100);
    this._elements.progressBar.setAttribute('value', progress);
    this._elements.progressPercentage.textContent = percent + '%';
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
}

class SolutionController {
  constructor(constraintManager, displayContainer) {
    // Solvers are a list in case we manage to start more than one. This can
    // happen when we are waiting for a worker to initialize.
    this._solverPromises = [];

    constraintManager.addReshapeListener(this);

    this._solutionDisplay = new SolutionDisplay(
      constraintManager, displayContainer.getNewGroup('solution-group'));
    constraintManager.addReshapeListener(this._solutionDisplay);

    this._isSolving = false;
    this._constraintManager = constraintManager;
    this._stepHighlighter = displayContainer.createHighlighter('highlighted-step-cell');
    displayContainer.addElement(
      HighlightDisplay.makeRadialGradient('highlighted-step-gradient'));

    this.debugOutput = new DebugOutput(displayContainer);
    constraintManager.addReshapeListener(this.debugOutput);

    this._update = deferUntilAnimationFrame(this._update.bind(this));
    constraintManager.setUpdateCallback(this._update.bind(this));

    this._modeHandlers = {
      'all-possibilities': this._runAllPossibilites,
      'solutions': this._runSolutionIterator,
      'count-solutions': this._runCounter,
      'step-by-step': this._runStepIterator,
      'validate-layout': this._runValidateLayout,
    };

    this._elements = {
      start: document.getElementById('solution-start'),
      forward: document.getElementById('solution-forward'),
      back: document.getElementById('solution-back'),
      control: document.getElementById('solution-control-panel'),
      stepOutput: document.getElementById('solution-step-output'),
      mode: document.getElementById('solve-mode-input'),
      modeDescription: document.getElementById('solve-mode-description'),
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

    this._stateDisplay = new SolverStateDisplay(this._solutionDisplay);

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

  reshape() {
    // Terminate any runnings solvers ASAP, so they are less
    // likely to cause problems sending stale data.
    this._terminateSolver();
  }

  getSolutionValues() {
    return this._solutionDisplay.getSolutionValues();
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
      if (document.activeElement.tagName == 'TEXTAREA') return;
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
    for (const promise of this._solverPromises) {
      promise.then(solver => solver.terminate());
    }
    this._solverPromises = [];
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
    this._solutionDisplay.setSolution([]);
    let constraints = this._constraintManager.getConstraints();
    let mode = this._elements.mode.value;
    let auto = this._elements.autoSolve.checked;

    this._historyHandler.update({ mode: mode, q: constraints });

    let description = SolutionController._MODE_DESCRIPTIONS[mode];
    this._elements.modeDescription.textContent = description;

    if (auto || mode === 'step-by-step') {
      this._solve(constraints);
    } else {
      this._resetSolver();
    }
  }

  _resetSolver() {
    this._terminateSolver();
    this._stepHighlighter.setCells([]);
    this._solutionDisplay.setSolution([]);
    this._stateDisplay.clear();
    this._setValidateResult();
    this.debugOutput.clear();
    this._showIterationControls(false);
  }

  async _solve(constraints) {
    const mode = this._elements.mode.value;
    this._replaceAndRunSolver(mode, constraints);
  }

  async _validateLayout() {
    const constraints = this._constraintManager.getLayoutConstraint();
    this._replaceAndRunSolver('validate-layout', constraints);
  }

  async _replaceAndRunSolver(mode, constraints) {
    constraints ||= this._constraintManager.getConstraints();

    this._resetSolver();

    const newSolverPromise = SudokuBuilder.buildInWorker(
      constraints,
      s => this._stateDisplay.setState(s),
      this._solveStatusChanged.bind(this),
      data => this.debugOutput.update(data));
    this._solverPromises.push(newSolverPromise);

    const newSolver = await newSolverPromise;

    if (newSolver.isTerminated()) return;

    const handler = this._modeHandlers[mode].bind(this);

    handler(newSolver)
      .catch(e => {
        if (!e.toString().startsWith('Aborted')) {
          throw (e);
        }
      });
  }

  _setValidateResult(text) {
    this._elements.validateResult.textContent = text || '';
  }

  _solveStatusChanged(isSolving, method) {
    this._isSolving = isSolving;
    this._stateDisplay.setSolveStatus(isSolving, method);

    if (isSolving) {
      this._elements.stop.disabled = false;
      this._elements.start.disabled = true;
      this._elements.forward.disabled = true;
      this._elements.back.disabled = true;
    } else {
      this._elements.stop.disabled = true;
    }
  }

  async _runValidateLayout(solver) {
    const result = await solver.validateLayout();
    this._setValidateResult(result ? 'Valid layout' : 'Invalid layout');
  }

  async _runStepIterator(solver) {
    let step = 0;

    const update = async () => {
      let result = await solver.nthStep(step);

      // Update the grid.
      let selection = [];
      if (result) {
        this._solutionDisplay.setSolution(result.values, result.pencilmarks);
        if (result.values.length > 0 && !result.isSolution) {
          selection.push(result.values[result.values.length - 1].substring(0, 4));
        }
        this._stateDisplay.setStepStatus(
          result.isSolution ? 'Solution' :
            result.hasContradiction ? 'Conflict' : null);
      } else {
        this._stateDisplay.setStepStatus(null);
      }
      this._stepHighlighter.setCells(selection);

      this._elements.forward.disabled = (result == null);
      this._elements.back.disabled = (step == 0);
      this._elements.start.disabled = (step == 0);
      this._elements.stepOutput.textContent = step + 1;
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
  }

  async _runSolutionIterator(solver) {
    let solutions = [];
    let solutionNum = 1;
    let done = false;

    const nextSolution = async () => {
      if (done) return;

      let solution = await solver.nthSolution(solutions.length);

      if (solution) {
        solutions.push(solution);
      } else {
        done = true;
      }
    };

    const update = () => {
      this._solutionDisplay.setSolution(solutions[solutionNum - 1]);

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
    let result = await solver.solveAllPossibilities();
    this._solutionDisplay.setSolution(result);
  }

  async _runCounter(solver) {
    await solver.countSolutions();
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
      const cellId = shape.makeCellId(...shape.splitCellIndex(i));
      const path = this._heatmap.addCell(cellId);
      path.setAttribute('fill', 'rgb(255, 0, 0)');
      path.setAttribute('opacity', values[i] / 1000);
    }
  }

  setValues(values) {
    const shape = this._shape;
    this._textInfo.clear();

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellId(...shape.splitCellIndex(i));
      this._textInfo.setText(cellId, values[i]);
    }
  }
}