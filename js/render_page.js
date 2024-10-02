// Make these variables global so that debug functions can access them.
let constraintManager, controller;

const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  const displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  constraintManager = new ConstraintManager(
    inputManager, displayContainer);

  controller = new SolutionController(constraintManager, displayContainer);

  const hiddenElements = Array.from(
    document.getElementsByClassName('hide-until-load'));
  hiddenElements.forEach(e => e.classList.remove('hide-until-load'));
};

class ConstraintCollector {
  IS_LAYOUT = false;
  IS_SHAPE_AGNOSTIC = false;

  constructor() { }

  addConstraint(constraint) {
    throw ('Not implemented');
  }

  getConstraints() {
    throw ('Not implemented');
  }

  clear() { }

  reshape(shape) { }

  setUpdateCallback(fn) {
    this._updateCallback = fn || (() => { });
  }

  runUpdateCallback() {
    this._updateCallback();
  }
}

ConstraintCollector.Shape = class Shape extends ConstraintCollector {
  IS_LAYOUT = true;

  constructor() {
    super();
    this._shape = SHAPE_9x9;

    this._setUp();
  }

  _setUp() {
    const select = document.getElementById('shape-select');

    for (let i = GridShape.MIN_SIZE; i <= GridShape.MAX_SIZE; i++) {
      const name = GridShape.makeName(i);
      const option = document.createElement('option');
      option.textContent = name;
      option.value = name;
      select.appendChild(option);
    }

    select.value = this._shape.name;
    select.onchange = () => {
      const shapeName = select.value;
      const shape = GridShape.get(shapeName);
      if (!shape) throw ('Invalid shape: ' + shapeName);
      this._reshape(shape);
    };
    this._select = select;
  }

  _reshape(shape) {
    this._shape = shape;
    this.runUpdateCallback();
  }

  addConstraint(constraint) {
    const shape = constraint.getShape(constraint);
    this._select.value = shape.name;
    this._reshape(shape);
  }

  getShape() {
    return this._shape;
  }

  getConstraints() {
    return [new SudokuConstraint.Shape(this._shape.name)];
  }
}

ConstraintCollector.Experimental = class Experimental extends ConstraintCollector {
  constructor(chipView) {
    super();
    this._chipView = chipView;
    this._chipConfigs = [];
  }

  clear() {
    this._chipConfigs = [];
  }

  _removeConstraint(config) {
    arrayRemoveValue(this._chipConfigs, config);
  }

  addConstraint(constraint) {
    const config = {
      constraint: constraint,
      removeFn: () => { this._removeConstraint(config); },
    };
    this._chipConfigs.push(config);
    this._chipView.addChip(config);
  }

  getConstraints() {
    return this._chipConfigs.map(c => c.constraint);
  }
}

ConstraintCollector.Composite = class Composite extends ConstraintCollector {
  constructor(display, chipView) {
    super();
    this._chipView = chipView;
    this._chipConfigs = [];
    this._display = display;
  }

  clear() {
    this._chipConfigs = [];
  }

  _removeConstraint(config) {
    arrayRemoveValue(this._chipConfigs, config);
  }

  addConstraint(constraint) {
    const config = {
      constraint: constraint,
      displayElem: this._display.drawConstraint(constraint),
      removeFn: () => { this._removeConstraint(config); },
    };
    this._chipConfigs.push(config);
    this._chipView.addChip(config);
  }

  getConstraints() {
    return this._chipConfigs.map(c => c.constraint);
  }
}

ConstraintCollector._Checkbox = class _Checkbox extends ConstraintCollector {
  IS_SHAPE_AGNOSTIC = true;

  constructor(display, containerId, constraintConfigs) {
    super();

    this._checkboxes = new Map();
    const initSingleCheckbox = (type, container, option) => {
      const constraint = new SudokuConstraint[type](...(option ? [option.value] : []));
      const constraintCls = constraint.constructor;
      const key = constraint.toString();
      const checkboxId = `${containerId}-input-${this._checkboxes.size}`;

      const div = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = checkboxId;
      input.onchange = () => {
        const displayClass = constraintCls.DISPLAY_CONFIG?.displayClass;
        if (displayClass) {
          display.toggleItem(
            constraint,
            input.checked,
            ConstraintDisplays[displayClass]);
        }
        PanelHighlighter.toggleHighlightForElement(input, input.checked);
        this.runUpdateCallback();
      };
      div.appendChild(input);

      const label = document.createElement('label');
      label.htmlFor = checkboxId;
      const displayName = constraintCls.displayName();
      label.textContent = `${displayName} ${option?.text || ''} `;
      div.appendChild(label);

      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.setAttribute('data-text', constraintCls.DESCRIPTION);
      div.appendChild(tooltip);

      container.appendChild(div);

      this._checkboxes.set(key, {
        element: input,
        constraint,
      });
    };

    const container = document.getElementById(containerId);
    for (const [type, config] of Object.entries(constraintConfigs)) {
      if (config?.value?.options) {
        for (const option of config.value.options) {
          initSingleCheckbox(type, container, option);
        }
      } else {
        initSingleCheckbox(type, container, null);
      }
    }
  }

  getConstraints() {
    let constraints = [];
    for (const item of this._checkboxes.values()) {

      if (item.element.checked && !item.element.disabled) {
        constraints.push(item.constraint);
      }
    }
    return constraints;
  }

  addConstraint(c) {
    const element = this._checkboxes.get(c.toString()).element;
    element.checked = true;
    element.dispatchEvent(new Event('change'));
  }

  clear() {
    for (const item of this._checkboxes.values()) {
      item.element.checked = false;
    }
  }
}

ConstraintCollector.GlobalCheckbox = class GlobalCheckbox extends ConstraintCollector._Checkbox {
  constructor(display) {
    const element = document.getElementById('global-constraints-container');
    const container = new CollapsibleContainer(element, true);

    super(
      display,
      container.bodyElement().id,
      {
        AntiConsecutive: {},
        StrictKropki: {},
        StrictXV: {},
        GlobalEntropy: {},
        AntiTaxicab: {},
      });
  }
}

ConstraintCollector.LayoutCheckbox = class LayoutCheckbox extends ConstraintCollector._Checkbox {
  IS_LAYOUT = true;

  constructor(display) {
    super(
      display,
      'layout-constraint-checkboxes',
      {
        AntiKnight: {},
        AntiKing: {},
        Diagonal: {
          value: {
            options: [
              { text: '╱', value: 1 },
              { text: '╲', value: -1 },
            ],
          },
        },
        Windoku: {},
        DisjointSets: {},
        NoBoxes: {},
      });
  }
}

ConstraintCollector.MultiCell = class MultiCell extends ConstraintCollector {
  constructor(display, chipView, inputManager) {
    super();
    this._chipConfigs = [];
    this._display = display;
    this._constraintConfigs = this._makeMultiCellConstraintConfig();
    this._chipView = chipView;
    this._shape = null;

    const selectionForm = document.forms['multi-cell-constraint-input'];
    this._setUp(selectionForm, this._constraintConfigs, inputManager);

    this._collapsibleContainer = new CollapsibleContainer(
      selectionForm.firstElementChild, true);

    inputManager.onSelection(
      (selection) => this._onNewSelection(selection, selectionForm));
    inputManager.addSelectionPreserver(selectionForm);

    selectionForm.onsubmit = e => {
      this._handleSelection(selectionForm, inputManager);
      return false;
    };
  }

  _makeMultiCellConstraintConfig() {
    return {
      Cage: {
        value: {
          placeholder: 'sum',
        },
        validateFn: (cells, shape) => (
          cells.length <= shape.numValues && cells.length > 1),
      },
      Sum: {
        value: {
          placeholder: 'sum',
        },
      },
      Arrow: {},
      DoubleArrow: {
        validateFn: (cells, shape) => cells.length > 2,
      },
      PillArrow: {
        validateFn: (cells, shape) => cells.length > 2,
        value: {
          placeholder: 'pill size',
          options: [
            { text: '2-digit', value: 2 },
            { text: '3-digit', value: 3 },
          ],
        },
      },
      Thermo: {},
      Whisper: {
        value: {
          placeholder: 'difference',
          default: 5,
        },
      },
      Renban: {},
      Modular: {
        value: {
          placeholder: 'mod',
          default: 3,
        },
      },
      Entropic: {},
      RegionSumLine: {},
      SumLine: {
        value: {
          placeholder: 'sum',
          default: 10
        },
      },
      Between: {},
      Lockout: {
        value: {
          placeholder: 'min diff',
          default: 4,
        },
      },
      Lunchbox: {
        value: {
          placeholder: 'sum',
          default: 0,
        },
      },
      Palindrome: {},
      Zipper: {},
      WhiteDot: {
        validateFn: ConstraintManager._cellsAreAdjacent,
      },
      BlackDot: {
        validateFn: ConstraintManager._cellsAreAdjacent,
      },
      X: {
        validateFn: ConstraintManager._cellsAreAdjacent,
      },
      V: {
        validateFn: ConstraintManager._cellsAreAdjacent,
      },
      Quad: {
        value: {
          placeholder: 'values',
        },
        validateFn: ConstraintManager._cellsAre2x2Square,
      },
      ContainExact: {
        value: {
          placeholder: 'values',
        },
      },
      ContainAtLeast: {
        value: {
          placeholder: 'values',
        },
      },
      SameValues: {
        value: {
          placeholder: 'numSets',
          default: 2,
          options: (cells) => {
            const options = [];
            for (let i = 2; i <= cells.length; i++) {
              if (cells.length % i == 0) {
                options.push({ text: `${i} sets`, value: i });
              }
            }
            return options;
          },
        },
      },
      AllDifferent: {},
      CountingCircles: {},
      Indexing: {
        value: {
          options: [
            { text: 'Column', value: SudokuConstraint.Indexing.COL_INDEXING },
            { text: 'Row', value: SudokuConstraint.Indexing.ROW_INDEXING },
          ],
        },
        validateFn: (cells, shape) => cells.length > 0,
      },
    };
  }

  addConstraint(constraint) {
    let config = null;
    if (constraint.type === 'Quad') {
      config = {
        constraint: constraint,
        displayElem: this._display.drawConstraint(constraint),
        replaceKey: `Quad-${constraint.topLeftCell}`,
        removeFn: () => { this._removeConstraint(config); },
      };
      for (const other of this._chipConfigs) {
        if (config.replaceKey == other.replaceKey) {
          this._chipView.removeChip(other);
          break;
        }
      }
    } else {
      config = {
        constraint: constraint,
        displayElem: this._display.drawConstraint(constraint),
        removeFn: () => { this._removeConstraint(config); },
      };
    }
    this._chipView.addChip(config);
    this._chipConfigs.push(config);
  }

  _removeConstraint(config) {
    arrayRemoveValue(this._chipConfigs, config);
  }

  getConstraints() {
    return this._chipConfigs.map(c => c.constraint);
  }

  clear() {
    this._chipConfigs = [];
  }

  reshape(shape) {
    this._shape = shape;
  }

  _handleSelection(selectionForm, inputManager) {
    const cells = inputManager.getSelection();
    if (cells.length < 1) throw ('Selection too short.');

    const formData = new FormData(selectionForm);
    const type = formData.get('constraint-type');

    const config = this._constraintConfigs[type];
    if (!config) throw ('Unknown constraint type: ' + type);
    if (config.elem.disabled) throw ('Invalid selection for ' + type);

    if (config.constraintClass.LOOPS_ALLOWED && formData.get('is-loop')) {
      cells.push('LOOP');
    }

    if (config.constraintClass === SudokuConstraint.Quad) {
      const valuesStr = formData.get(type + '-value');
      const values = valuesStr.split(/[, ]+/).map(v => +v).filter(
        v => Number.isInteger(v) && v >= 1 && v <= this._shape.numValues);
      if (values.length) {
        cells.sort();
        const constraint = new SudokuConstraint.Quad(cells[0], ...values);
        this.addConstraint(constraint);
      }
    } else if (
      config.constraintClass === SudokuConstraint.ContainExact ||
      config.constraintClass === SudokuConstraint.ContainAtLeast) {
      const valuesStr = formData.get(type + '-value');
      const values = valuesStr.split(/[, ]+/).map(v => +v).filter(
        v => Number.isInteger(v) && v >= 1 && v <= this._shape.numValues);
      if (values.length) {
        const constraint = new config.constraintClass(values.join('_'), ...cells);
        this.addConstraint(constraint);
      }
    } else if (config.value) {
      const value = formData.get(type + '-value');
      this.addConstraint(
        new config.constraintClass(value, ...cells));
    } else {
      this.addConstraint(
        new config.constraintClass(...cells));
    }

    inputManager.setSelection([]);
    this.runUpdateCallback();
  }

  _setUp(selectionForm, constraintConfigs, inputManager) {
    const selectElem = selectionForm['constraint-type'];
    selectionForm.classList.add('disabled');
    const valueContainer = document.getElementById('multi-cell-constraint-value-container');
    const valueElems = [];

    const loopContainer = document.getElementById('multi-cell-constraint-loop-container');
    loopContainer.style.display = 'none';

    // Initialize defaults.
    for (const [name, config] of Object.entries(constraintConfigs)) {
      config.text ||= name;
      config.constraintClass = SudokuConstraint[name];
      if (!config.constraintClass) {
        throw ('Unknown constraint class: ' + name);
      }
    }

    this._dynamicOptionsFn = new Map();

    // Create the options.
    for (const [type, config] of Object.entries(constraintConfigs)) {
      const option = document.createElement('option');
      const cls = config.constraintClass;
      option.value = type;
      option.textContent = cls.displayName();
      option.title = cls.DESCRIPTION.replace(/\s+/g, ' ').replace(/^\s/, '');
      selectElem.appendChild(option);
      config.elem = option;

      if (config.value) {
        let input;
        if (config.value.options) {
          input = document.createElement('select');
          if (isIterable(config.value.options)) {
            for (const { text, value } of config.value.options) {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = text;
              input.appendChild(option);
            }
          } else if (config.value.options instanceof Function) {
            config.value.dynamicOptionsFn = this._setUpDynamicOptions(
              input, config.value.options);
          } else {
            throw ('Invalid options for ' + type);
          }
        } else {
          input = document.createElement('input');
          input.setAttribute('type', 'text');
          input.setAttribute('size', '8');
          input.setAttribute('placeholder', config.value.placeholder);
        }
        input.setAttribute('name', type + '-value');
        if (config.value.default !== undefined) {
          input.setAttribute('value', config.value.default);
        }
        input.style.display = 'none';
        valueContainer.appendChild(input);
        config.value.elem = input;
        valueElems.push(input);
      }
    }

    // Update the form based on the selected constraint.
    const descriptionElem = document.getElementById('multi-cell-constraint-description');
    selectElem.onchange = () => {
      const value = selectElem.value;
      const config = constraintConfigs[value];
      if (!config) return;

      if (config.value) {
        valueContainer.style.visibility = 'visible';
        for (const elem of valueElems) {
          elem.style.display = 'none';
        }
        config.value.elem.style.display = 'inline';
        if (config.value.dynamicOptionsFn) {
          config.value.dynamicOptionsFn(inputManager.getSelection());
        }
        config.value.elem.focus();
      } else {
        valueContainer.style.visibility = 'hidden';
      }

      if (config.constraintClass.LOOPS_ALLOWED) {
        loopContainer.style.display = 'block';
      } else {
        loopContainer.style.display = 'none';
      }

      descriptionElem.textContent = config.constraintClass.DESCRIPTION;

      if (!selectionForm.classList.contains('disabled')) {
        selectionForm['add-constraint'].disabled = config.elem.disabled;
      }
    }

    // Ensure select is initialized (but not selected).
    autoSaveField(selectElem);
    selectElem.onchange();
    document.activeElement?.blur();
  }

  _setUpDynamicOptions(input, optionsFn) {
    return (cells) => {
      const options = optionsFn(cells);
      if (!options.length) options.push({ text: 'Sets', value: '' });
      clearDOMNode(input);
      for (const { text, value } of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        input.appendChild(option);
      }
      input.disabled = cells.length == 0;
    };
  }

  _onNewSelection(selection, selectionForm) {
    // Only enable the selection panel if the selection is long enough.
    const disabled = (selection.length == 0);
    selectionForm['add-constraint'].disabled = disabled;
    selectionForm.classList.toggle('disabled', disabled);

    if (disabled) {
      // Reenable all the options, so that the user can select them and see
      // their descriptions.
      for (const [_, config] of Object.entries(this._constraintConfigs)) {
        config.elem.disabled = false;
      }
      selectionForm.classList.add('disabled');
      return;
    } else {
      selectionForm.classList.remove('disabled');
    }

    const isSingleCell = selection.length == 1;

    for (const [_, config] of Object.entries(this._constraintConfigs)) {
      if (config.validateFn) {
        const isValid = config.validateFn(selection, this._shape);
        config.elem.disabled = !isValid;
      } else {
        // Unless explicitly allowed by validateFn, we don't allow single cell
        // selections.
        config.elem.disabled = isSingleCell;
      }
    }

    // Disable the add button if the current value is not valid.
    const type = selectionForm['constraint-type'].value;
    const config = this._constraintConfigs[type];
    if (config.elem.disabled) {
      selectionForm['add-constraint'].disabled = true;
    } else if (!isSingleCell) {
      // Focus on the the form so we can immediately press enter, but
      // only if the selection is not a single cell and if the focus has not
      // been set yet.
      //   - If the value input is enabled then focus on it to make it easy to
      //     input a value.
      //   - Otherwise just focus on the submit button.
      const hasNoFocus = (
        document.activeElement === document.body ||
        document.activeElement === null);

      if (hasNoFocus) {
        if (config.value && config.value.elem.select) {
          config.value.elem.select();
        } else {
          selectionForm['add-constraint'].focus();
        }
      }
    }
    // Update dynamic options if needed.
    if (config.value?.dynamicOptionsFn) {
      config.value.dynamicOptionsFn(selection);
    }
  }
}

class ExampleHandler {
  constructor(constraintManager) {
    this._ignoreConstraintChanges = false;
    this._exampleSelect = this._setUp();
    this._constraintManager = constraintManager;
  }

  _setUp() {
    let exampleSelect = document.getElementById('example-select');

    for (const example of DISPLAYED_EXAMPLES) {
      let option = document.createElement('option');
      option.textContent = example.name;
      exampleSelect.appendChild(option);
    }

    let link = exampleSelect.nextElementSibling;
    exampleSelect.onchange = () => {
      if (exampleSelect.selectedIndex) {
        const exampleName = exampleSelect.options[exampleSelect.selectedIndex].text;
        const example = PUZZLE_INDEX.get(exampleName);
        link.href = example.src;
        link.style.display = 'inline-block';

        this._ignoreConstraintChanges = true;
        this._constraintManager.loadUnsafeFromText(example.input);
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

ConstraintCollector.Jigsaw = class Jigsaw extends ConstraintCollector {
  IS_LAYOUT = true;

  constructor(display, inputManager, chipView) {
    super();
    this._display = display;
    this._shape = null;
    this._chipView = chipView;

    this._piecesMap = [];
    this._maxPieceId = 0;

    this._setUpButton(inputManager);
  }

  _setUpButton(inputManager) {
    const button = document.getElementById('add-jigsaw-button');
    button.onclick = () => {
      const cells = inputManager.getSelection();
      this._addPiece(cells);
      this.runUpdateCallback();
    };

    button.disabled = true;
    inputManager.onSelection((selection) => {
      const isValid = this._cellsAreValidJigsawPiece(selection);
      button.disabled = !isValid;
      if (isValid && !this._isEmpty()) {
        button.focus();
      }
    });
  }

  reshape(shape) {
    this._shape = shape;
    this._piecesMap = Array(shape.numCells).fill(0);
  }

  _isEmpty() {
    return this._piecesMap.every(x => x == 0);
  }

  getConstraints() {
    if (this._isEmpty()) return [];

    const baseCharCode = SudokuParser.shapeToBaseCharCode(this._shape);

    const indexMap = new Map();
    const grid = Array(this._shape.numCells).fill('-');
    this._piecesMap.forEach((p, i) => {
      if (!indexMap.has(p)) indexMap.set(p, indexMap.size);
      grid[i] = String.fromCharCode(
        baseCharCode + indexMap.get(p));
    });
    return [new SudokuConstraint.Jigsaw(grid.join(''))];
  }

  addConstraint(constraint) {
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
        this._addPiece(cells.map(c => shape.makeCellIdFromIndex(c)));
      }
    }
  }

  clear() {
    this._piecesMap.fill(0);
  }

  _removePiece(config) {
    config.constraint.cells.forEach(c => this._piecesMap[this._shape.parseCellId(c).cell] = 0);
    PanelHighlighter.toggleHighlightForElement(this._chipView.element(), false);
  }

  _addPiece(cells) {
    if (cells.length != this._shape.gridSize) return;
    const pieceId = ++this._maxPieceId;
    cells.forEach(c => this._piecesMap[this._shape.parseCellId(c).cell] = pieceId);
    const pieceConstraint = new ConstraintCollector.Jigsaw.JigsawPiece(...cells);
    const config = {
      constraint: pieceConstraint,
      pieceId: pieceId,
      displayElem: this._display.drawConstraint(pieceConstraint),
      removeFn: () => { this._removePiece(config); },
    };
    PanelHighlighter.toggleHighlightForElement(this._chipView.element(), true);
    this._chipView.addChip(config);
  }

  _cellsAreValidJigsawPiece(cells) {
    const shape = this._shape;
    if (cells.length != shape.gridSize) return false;
    // Check that we aren't overlapping an existing tile.
    if (cells.some(c => this._piecesMap[shape.parseCellId(c).cell] != 0)) {
      return false;
    }
    return true;
  }
}

// Fake constraint for collecting jigsaw pieces.
ConstraintCollector.Jigsaw.JigsawPiece = class JigsawPiece extends SudokuConstraintBase {
  static DISPLAY_CONFIG = { displayClass: 'Jigsaw' };

  constructor(...cells) {
    super(arguments);
    this.cells = cells;
  }

  static displayName() { return ''; }
}

ConstraintCollector.OutsideClue = class OutsideClue extends ConstraintCollector {
  constructor(inputManager, display) {
    super();
    this._display = display;
    this._configs = this.constructor._constraintConfigs();
    this._setUp(inputManager);
    this._outsideArrowMap = new Map();
    this._constraints = new Map();
  }

  static _isValidValue(value, zeroOk) {
    if (value == '' || value != +value) return false;
    if (+value === 0 && !zeroOk) return false;
    return true;
  }

  static _constraintConfigs() {
    const configs = {
      Sandwich: {},
      XSum: {},
      Skyscraper: {},
      HiddenSkyscraper: {},
      FullRank: {},
      NumberedRoom: {},
      LittleKiller: {},
    };

    for (const [type, config] of Object.entries(configs)) {
      config.class = SudokuConstraint[type];
    }

    return configs;
  }

  reshape(shape) {
    super.reshape(shape);
    this._outsideArrowMap.clear();
    const diagonalCellMap = SudokuConstraint.LittleKiller.cellMap(shape);
    for (const arrowId in diagonalCellMap) {
      this._outsideArrowMap.set(
        arrowId,
        [OutsideConstraintBase.CLUE_TYPE_DIAGONAL]);
    }
    for (const [arrowId, cells] of SudokuConstraintBase.fullLineCellMap(shape)) {
      if (cells.length <= 1) continue;
      const clueTypes = [OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE];
      if (arrowId.endsWith(',1')) {
        clueTypes.push(OutsideConstraintBase.CLUE_TYPE_SINGLE_LINE);
      }
      this._outsideArrowMap.set(arrowId, clueTypes);
    }
  }

  _setUp(inputManager) {
    const outsideClueForm = document.forms['outside-clue-input'];
    this._outsideClueForm = outsideClueForm;

    this._collapsibleContainer = new CollapsibleContainer(
      outsideClueForm.firstElementChild, false);

    this._populateOutsideClueForm(
      outsideClueForm, this._configs);

    const clearOutsideClue = () => {
      let formData = new FormData(outsideClueForm);
      const arrowId = formData.get('id');
      const type = formData.get('type');
      this._removeConstraint(type, arrowId);
      inputManager.setSelection([]);
      this.runUpdateCallback();
    };
    outsideClueForm.onsubmit = e => {
      let formData = new FormData(outsideClueForm);
      let type = formData.get('type');
      let arrowId = formData.get('id');

      const config = this._configs[type];
      let value = formData.get('value');
      const zeroOk = SudokuConstraint[type].ZERO_VALUE_OK;
      if (!this.constructor._isValidValue(value, zeroOk)) {
        clearOutsideClue();
        return false;
      }
      value = +value;

      this._addConstraint(
        SudokuConstraint[type].makeFromArrowId(arrowId, value));

      inputManager.setSelection([]);
      this.runUpdateCallback();
      return false;
    };
    inputManager.addSelectionPreserver(outsideClueForm);
    inputManager.onOutsideArrowSelection(
      this._handleOutsideArrowSelection.bind(this));

    document.getElementById('outside-arrow-clear').onclick = clearOutsideClue;
  }

  _handleOutsideArrowSelection(arrowId) {
    const form = this._outsideClueForm;
    if (arrowId === null) {
      form.firstElementChild.disabled = true;
      return;
    }

    this._collapsibleContainer.toggleOpen(true);

    form.firstElementChild.disabled = false;
    form.id.value = arrowId;
    form.value.select();

    const clueTypes = this._outsideArrowMap.get(arrowId);

    const configs = this._configs;
    for (const config of Object.values(configs)) {
      config.elem.disabled = !clueTypes.includes(config.class.CLUE_TYPE);
    }

    // Ensure that the selected type is valid for this arrow.
    if (this._constraints.has(arrowId)) {
      // If we have existing clues, then make sure the selection matches ones
      // of them.
      const activeConstraintTypes = this._constraints.get(arrowId);
      if (!activeConstraintTypes.has(form.type.value)) {
        form.type.value = activeConstraintTypes.keys().next().value;
        form.dispatchEvent(new Event('change'));
      }
    } else if (!clueTypes.includes(configs[form.type.value]?.class.CLUE_TYPE)) {
      // Otherwise then select any valid clue type.
      for (const [type, config] of Object.entries(configs)) {
        if (clueTypes.includes(config.class.CLUE_TYPE)) {
          form.type.value = type;
          form.dispatchEvent(new Event('change'));
          break;
        }
      }
    }
  }

  _populateOutsideClueForm(form, configs) {
    const container = form.getElementsByClassName(
      'outside-arrow-clue-types')[0];

    for (const type of Object.keys(configs)) {
      const div = document.createElement('div');

      const id = `${type}-option`;

      const input = document.createElement('input');
      input.id = id;
      input.type = 'radio';
      input.name = 'type';
      input.value = type;
      div.appendChild(input);

      const constraintCls = SudokuConstraint[type];

      const label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = constraintCls.displayName() + ' ';
      const tooltip = document.createElement('span');
      tooltip.classList.add('tooltip');
      tooltip.setAttribute('data-text', constraintCls.DESCRIPTION);
      label.appendChild(tooltip);
      div.appendChild(label);

      configs[type].elem = input;

      container.appendChild(div);
    }

    autoSaveField(form, 'type');
  }


  addConstraint(constraint) {
    for (const splitConstraint of constraint.split()) {
      this._addConstraint(splitConstraint);
    }
  }

  _addConstraint(constraint) {
    const clues = constraint.clues();
    if (clues.length !== 1) {
      throw ('_addConstraint must be called with a single-valued constraint.');
    }
    const arrowId = clues[0].arrowId;
    const type = constraint.type;
    if (!this._constraints.has(arrowId)) {
      this._constraints.set(arrowId, new Map());
    }
    this._constraints.get(arrowId).set(type, constraint);
    this._display.addOutsideClue(constraint);
  }

  _removeConstraint(type, arrowId) {
    const lineMap = this._constraints.get(arrowId);
    const constraint = lineMap?.get(type);
    if (constraint) {
      this._display.removeOutsideClue(constraint);

      lineMap.delete(type);
      if (!lineMap.size) this._constraints.delete(arrowId);
    }
  }

  clear() {
    for (const [arrowId, arrowIdMap] of this._constraints.entries()) {
      for (const type of arrowIdMap.keys()) {
        this._removeConstraint(type, arrowId);
      }
    }
  }

  getConstraints() {
    const seen = new Map();

    const constraints = [];
    for (const lineMap of this._constraints.values()) {
      for (const constraint of lineMap.values()) {
        const type = constraint.type;
        if (constraint.constructor.CLUE_TYPE === OutsideConstraintBase.CLUE_TYPE_DOUBLE_LINE) {
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
      }
    };
    return constraints;
  }
}

class ConstraintManager {
  constructor(inputManager, displayContainer) {
    this._shape = null;
    this._reshapeListeners = [];
    this.setUpdateCallback();

    this.addReshapeListener(displayContainer);
    this.addReshapeListener(inputManager);

    this._display = this.addReshapeListener(new ConstraintDisplay(
      inputManager, displayContainer));
    this._constraintCollectors = new Map();
    this._setUp(inputManager, displayContainer);

    // Initialize the shape.
    const shapeCollector = this._constraintCollectors.get('Shape');
    shapeCollector.setUpdateCallback(() => {
      this._reshape(shapeCollector.getShape());
      this.runUpdateCallback();
    });
    this._reshape(shapeCollector.getShape());
  }

  _reshape(shape) {
    if (this._shape === shape) return;

    const preservedConstraints = this._getShapeAgnosticConstraints();

    this.clear();
    this._shape = shape;
    for (const listener of this._reshapeListeners) {
      listener.reshape(shape);
    }

    this._loadConstraint(preservedConstraints);

    this.runUpdateCallback();
  }

  addReshapeListener(listener) {
    this._reshapeListeners.push(listener);
    // Ensure the listener is initialized with the current shape if it exists.
    if (this._shape) listener.reshape(this._shape);
    return listener;
  }

  setUpdateCallback(fn) {
    this._updateCallback = fn || (() => { });
  }

  runUpdateCallback() {
    this._exampleHandler.newConstraintLoaded();
    this._updateCallback(this);
  }

  _setUp(inputManager, displayContainer) {
    const chipViews = new Map();
    this._chipHighlighter = displayContainer.createHighlighter(
      'highlighted-cells');
    this._constraintSelector = this.addReshapeListener(
      new ConstraintSelector(displayContainer));

    for (const type of ['ordinary', 'composite', 'jigsaw']) {
      const chipView = this.addReshapeListener(
        new ConstraintChipView(
          document.getElementById(`${type}-chip-view`),
          this._display, this._chipHighlighter, this._constraintSelector,
          this.runUpdateCallback.bind(this)));
      chipViews.set(type, chipView);
    };
    this._chipViews = chipViews;

    {
      const layoutContainer = new CollapsibleContainer(
        document.getElementById('layout-constraint-container'), true);
      inputManager.addSelectionPreserver(layoutContainer.anchorElement());
    }

    const collectors = [
      new ConstraintCollector.Shape(),
      new ConstraintCollector.GlobalCheckbox(this._display),
      new ConstraintCollector.LayoutCheckbox(this._display),
      new ConstraintCollector.Jigsaw(
        this._display, inputManager, chipViews.get('jigsaw')),
      new ConstraintCollector.MultiCell(
        this._display, chipViews.get('ordinary'), inputManager),
      new ConstraintCollector.CustomBinary(
        inputManager, this._display, chipViews.get('ordinary')),
      new ConstraintCollector.OutsideClue(inputManager, this._display),
      new ConstraintCollector.GivenCandidates(inputManager, this._display),
      new ConstraintCollector.Experimental(chipViews.get('ordinary')),
      new ConstraintCollector.Composite(this._display, chipViews.get('composite')),
    ];

    for (const collector of collectors) {
      this._constraintCollectors.set(collector.constructor.name, collector);
      this.addReshapeListener(collector);
      collector.setUpdateCallback(this.runUpdateCallback.bind(this));
    }

    // Load examples.
    this._exampleHandler = new ExampleHandler(this);

    this._setUpFreeFormInput();

    // Clear button.
    document.getElementById('clear-constraints-button').onclick = () => this.clear();

    // Copy to clipboard.
    document.getElementById('copy-constraints-button').onclick = () => {
      navigator.clipboard.writeText(this.getConstraints());
    };
  }

  _setUpFreeFormInput() {
    // Free-form.
    const form = document.forms['freeform-constraint-input'];
    const errorElem = document.getElementById('freeform-constraint-input-error');
    const warningElem = document.getElementById('freeform-constraint-input-warning');
    const inputElem = form['freeform-input'];

    const clearMessages = () => {
      errorElem.textContent = '';
      warningElem.textContent = '';
    };

    // Allow loading free-form input from other locations.
    this.loadUnsafeFromText = (input) => {
      try {
        const constraint = this._loadFromText(input);
        clearMessages();
        warningElem.textContent = this._experimentalConstraintWarning(constraint);
      } catch (e) {
        errorElem.textContent = e;
        // If we were called from outside the form, then put the value in the
        // so that the user can see the constraint which failed.
        if (inputElem.value != input) inputElem.value = input;
      }
    };

    form.onsubmit = e => {
      e.preventDefault();
      clearMessages();
      const input = inputElem.value;
      this.loadUnsafeFromText(input);
      return false;
    };
    autoSaveField(inputElem);
  }

  _experimentalConstraintWarning(constraint) {
    const experimentalConstraints = new Set();
    constraint.forEachTopLevel(c => {
      if (c.constructor.COLLECTOR_CLASS === 'Experimental'
        || c.constructor.COLLECTOR_CLASS === 'Composite') {
        experimentalConstraints.add(c.type);
      }
    });
    if (experimentalConstraints.size === 0) return '';

    return (
      `Warning: ${[...experimentalConstraints]} constraints are experimental.
       They may not work in all situations.`);
  }

  _loadFromText(input) {
    const constraint = SudokuParser.parseText(input);

    this.clear();
    this._constraintCollectors.get('Shape').addConstraint(constraint);
    this._loadConstraint(constraint);

    this.runUpdateCallback();

    return constraint;
  }

  _loadConstraint(constraint) {
    switch (constraint.type) {
      case 'Set':
        constraint.constraints.forEach(c => this._loadConstraint(c));
        break;
      case 'Shape':
        // Nothing to do, but ensure it is not handle by its collector.
        break;
      default:
        {
          const collectorClass = constraint.constructor.COLLECTOR_CLASS;
          this._constraintCollectors.get(collectorClass).addConstraint(constraint);
        }
        break;
    }
  }

  static _cellsAre2x2Square(cells, shape) {
    if (cells.length != 4) return false;
    cells = cells.map(
      c => shape.parseCellId(c)).sort((a, b) => a.cell - b.cell);
    let { row, col } = cells[0];
    return (
      (cells[1].row == row && cells[1].col == col + 1) &&
      (cells[2].row == row + 1 && cells[2].col == col) &&
      (cells[3].row == row + 1 && cells[3].col == col + 1));
  }

  static _cellsAreAdjacent(cells, shape) {
    if (cells.length != 2) return false;
    // Manhattan distance is exactly 1.
    let cell0 = shape.parseCellId(cells[0]);
    let cell1 = shape.parseCellId(cells[1]);
    return 1 == Math.abs(cell0.row - cell1.row) + Math.abs(cell0.col - cell1.col);
  }

  _getShapeAgnosticConstraints() {
    const constraints = [];
    for (const collector of this._constraintCollectors.values()) {
      if (collector.IS_SHAPE_AGNOSTIC) {
        constraints.push(...collector.getConstraints());
      }
    }
    return new SudokuConstraint.Set(constraints);
  }

  getLayoutConstraints() {
    const constraints = [];
    for (const collector of this._constraintCollectors.values()) {
      if (collector.IS_LAYOUT) {
        constraints.push(...collector.getConstraints());
      }
    }
    return new SudokuConstraint.Set(constraints);
  }

  getConstraints() {
    const constraints = [];
    for (const collector of this._constraintCollectors.values()) {
      constraints.push(...collector.getConstraints());
    }

    return new SudokuConstraint.Set(constraints);
  }

  getFixedCells() {
    return this._constraintCollectors.get('GivenCandidates').getFixedCells();
  }

  clear() {
    this._display.clear();
    PanelHighlighter.clear();
    for (const chipView of this._chipViews.values()) {
      chipView.clear();
    }
    this._chipHighlighter.clear();
    this._constraintSelector.clear();
    for (const collector of this._constraintCollectors.values()) {
      collector.clear();
    }
    this.runUpdateCallback();
  }
}

class ConstraintChipView {
  constructor(chipViewElement, display, chipHighlighter, constraintSelector, onUpdate) {
    this._chipViewElement = chipViewElement;
    this._chipHighlighter = chipHighlighter;
    this._constraintSelector = constraintSelector;
    this._display = display;
    this._shape = null;
    this._onUpdate = onUpdate;
  }

  reshape(shape) {
    this._shape = shape;
  }

  element() {
    return this._chipViewElement;
  }

  addChip(config) {
    this._chipViewElement.appendChild(
      this._makeChip(config));
  }

  removeChip(config) {
    config.removeFn();
    if (config.displayElem) {
      this._display.removeItem(config.displayElem);
    }
    config.chip.parentNode.removeChild(config.chip);
  }

  clear() {
    this._chipViewElement.innerHTML = '';
  }

  _makeChip(config) {
    const constraint = config.constraint;

    const chip = document.createElement('div');
    chip.className = 'chip';

    const removeChipButton = document.createElement('button');
    removeChipButton.innerHTML = '&#x00D7;';
    chip.appendChild(removeChipButton);

    const chipLabel = document.createElement('div');
    chipLabel.className = 'chip-label';
    chipLabel.textContent = constraint.chipLabel();

    if (config.displayElem) {
      const chipIcon = this._makeChipIcon(config.displayElem);
      if (constraint.constructor.IS_COMPOSITE) {
        chipLabel.appendChild(chipIcon);
      } else {
        chip.append(chipIcon);
      }
    }

    chip.appendChild(chipLabel);

    config.chip = chip;

    chip.addEventListener('click', (e) => {
      // If the remove button is clicked then remove the chip.
      if (e.target.closest('button') === removeChipButton) {
        if (this._constraintSelector.currentSelection() === constraint) {
          this._constraintSelector.clear();
        }
        this.removeChip(config);
        this._chipHighlighter.clear();
        this._onUpdate();
        return;
      }

      // Otherwise if we are looking at the current chip then toggle the
      // selection.
      if (e.target.closest('.chip') !== chip) return;
      this._constraintSelector.toggle(constraint, chip);
    });

    chip.addEventListener('mouseover', (e) => {
      if (e.target.closest('.chip') !== chip) return;
      if (this._chipHighlighter.key() === chip) return;
      this._chipHighlighter.setCells(
        constraint.displayCells(this._shape), chip);
    });
    chip.addEventListener('mouseleave', () => {
      this._chipHighlighter.clear();
    });

    if (constraint.constructor.IS_COMPOSITE) {
      const subView = document.createElement('div');
      subView.className = 'chip-view';
      for (const subConstraint of constraint.constraints) {
        subView.appendChild(this._makeChip({
          constraint: subConstraint,
          removeFn: () => {
            arrayRemoveValue(constraint.constraints, subConstraint);
          },
        }));
      }
      chip.appendChild(subView);
    }

    return chip;
  }

  _CHIP_ICON_SIZE_PX = 28;

  _makeChipIcon(displayElem) {
    const svg = createSvgElement('svg');
    svg.classList.add('chip-icon');

    const borders = createSvgElement('g');
    const borderDisplay = new BorderDisplay(
      borders, 'rgb(255, 255, 255)');
    borderDisplay.reshape(this._shape);
    svg.append(borders);

    // Determine the correct scale to fit our icon size.
    const gridSizePixels = borderDisplay.gridSizePixels();
    const scale = this._CHIP_ICON_SIZE_PX / gridSizePixels;
    const transform = `scale(${scale})`;

    borders.setAttribute('transform', transform);
    borders.setAttribute('stoke-width', 0);

    const elem = displayElem.cloneNode(true);
    elem.setAttribute('transform', transform);
    elem.setAttribute('stroke-width', 15);
    elem.setAttribute('opacity', 1);

    svg.append(elem);

    // Set the size (as well as minSize so it doesn't get squished).
    const cssSize = this._CHIP_ICON_SIZE_PX + 'px';
    svg.style.height = cssSize;
    svg.style.width = cssSize;
    svg.style.minHeight = cssSize;
    svg.style.minWidth = cssSize;
    // Undo the opacity (for killer cages).
    svg.style.filter = 'saturate(100)';

    return svg;
  }
}

class ConstraintSelector {
  static _SELECTED_CHIP_CLASS = 'selected-chip';

  constructor(displayContainer) {
    this._highlighter = displayContainer.createHighlighter('selected-constraint-cells');
    this._currentSelection = null;
    this._shape = null;
  }

  reshape(shape) {
    this._shape = shape;
  }

  select(constraint, chip) {
    this.clear();
    this._currentSelection = { chip, constraint };
    chip.classList.add(ConstraintSelector._SELECTED_CHIP_CLASS);
    this._highlighter.setCells(constraint.displayCells(this._shape));
  }

  toggle(constraint, chip) {
    if (constraint === this.currentSelection()) {
      this.clear();
    } else {
      this.select(constraint, chip);
    }
  }

  currentSelection() {
    if (this._currentSelection) {
      return this._currentSelection.constraint;
    }
    return null;
  }

  clear() {
    if (this._currentSelection) {
      this._currentSelection.chip.classList.remove(
        ConstraintSelector._SELECTED_CHIP_CLASS);
      this._highlighter.clear();
      this._currentSelection = null;
    }
  }
}

class Highlight {
  constructor(display, cssClass) {
    this._cells = new Map();
    this._cssClass = cssClass;

    this._display = display;
    this._key = undefined;
  }

  key() {
    return this._key;
  }

  setCells(cellIds, key) {
    if (key && key === this._key) return;
    this.clear();
    for (const cellId of cellIds) this.addCell(cellId);
    this._key = key;
  }

  size() {
    return this._cells.size;
  }

  getCells() {
    return Array.from(this._cells.keys());
  }

  addCell(cell) {
    if (!this._cells.has(cell)) {
      const path = this._display.highlightCell(cell, this._cssClass);
      this._cells.set(cell, path);
      return path;
    }
  }

  removeCell(cell) {
    const path = this._cells.get(cell);
    if (path) {
      this._display.removeHighlight(path);
      this._cells.delete(cell);
    }
  }

  clear() {
    for (const path of this._cells.values()) {
      this._display.removeHighlight(path)
    }
    this._cells.clear();
    this._key = undefined;
  }
}

class Selection {
  constructor(displayContainer) {
    this._highlight = displayContainer.createHighlighter('selected-cells');

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
    if (cellIds.length > 0) this._maybeAddOutsideClickListener();
    this._runCallback();
  }
  getCells() { return this._highlight.getCells(); }
  size() { return this._highlight.size(); }

  cellIdCenter(cellId) {
    return this._clickInterceptor.cellIdCenter(cellId);
  }

  _setUpMouseHandlers(container) {
    // Make the container selectable.
    container.tabIndex = 0;

    const cellFuzziness = 1.4 * (DisplayItem.CELL_SIZE / 2);

    let currCell = null;
    let currCenter = null;
    let isDeselecting = false;
    const pointerMoveFn = (e) => {
      const target = this._clickInterceptor.cellAt(e.offsetX, e.offsetY);
      if (target === null || target === currCell) return;

      // Make current cell hitbox larger so that we can more easily
      // select diagonals without hitting adjacent cells.
      const dx = Math.abs(e.offsetX - currCenter[0]);
      const dy = Math.abs(e.offsetY - currCenter[1]);
      if (Math.max(dx, dy) < cellFuzziness) return;

      if (currCell === null) {
        isDeselecting = this._highlight.getCells().some(cell => cell === target);
      }

      currCell = target;
      currCenter = this._clickInterceptor.cellIdCenter(currCell);

      if (isDeselecting) {
        this._highlight.removeCell(currCell);
      } else {
        this._highlight.addCell(currCell);
      }
    };
    container.addEventListener('pointerdown', e => {
      // If the shift key is pressed, continue adding to the selection.
      if (!e.shiftKey) {
        this.setCells([]);
      }
      container.addEventListener('pointermove', pointerMoveFn);
      this._maybeAddOutsideClickListener();
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

    {
      let outsideClickListenerEnabled = false;
      const outsideClickListener = e => {
        // Don't do anything if the click is inside one of the elements where
        // we want to retain clicks.
        for (const elem of this._selectionPreservers) {
          if (elem.contains(e.target)) return;
        }
        // Otherwise clear the selection.
        this.setCells([]);
        document.body.removeEventListener('click', outsideClickListener);
        outsideClickListenerEnabled = false;
      };
      this._maybeAddOutsideClickListener = () => {
        if (!outsideClickListenerEnabled) {
          document.body.addEventListener('click', outsideClickListener);
          outsideClickListenerEnabled = true;
        }
      }
    }
  }

  addSelectionPreserver(elem) {
    this._selectionPreservers.push(elem);
  }
}

ConstraintCollector.GivenCandidates = class GivenCandidates extends ConstraintCollector {
  constructor(inputManager, display) {
    super();
    this._shape = null;
    this._givensMap = new Map();
    this._display = display;

    inputManager.onNewDigit(this._inputDigit.bind(this));
    inputManager.onSetValues(this._setValues.bind(this));

    this._multiValueInputPanel = new MultiValueInputPanel(
      inputManager,
      this._setValues.bind(this),
      (cell) => this._givensMap.get(cell));
  }

  reshape(shape) {
    this._shape = shape;
    this._multiValueInputPanel.reshape(shape);
  }

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

    this._multiValueInputPanel.updateFromCells([cell]);
    this._setValues([cell], [newValue]);
  }

  _setValues(cells, values) {
    for (const cell of cells) {
      this._setValuesNoUpdate(cell, values);
    }
    this._givensUpdated();
  }

  _setValuesNoUpdate(cell, values) {
    const numValues = this._shape.numValues;
    values = values.filter(v => v && v > 0 && v <= numValues);
    if (values && values.length) {
      this._givensMap.set(cell, values);
    } else {
      this._givensMap.delete(cell);
    }
  }

  addConstraint(constraint) {
    const valueIds = constraint.values;
    for (const valueId of valueIds) {
      const parsed = this._shape.parseValueId(valueId);
      this._setValuesNoUpdate(parsed.cellId, parsed.values);
    }
    this._givensUpdated();
  }

  _givensUpdated() {
    this._display.drawGivens(this._givensMap);
    this.runUpdateCallback();
  }

  getConstraints() {
    const valueIds = [];
    for (const [cell, values] of this._givensMap) {
      valueIds.push(`${cell}_${values.join('_')}`);
    }
    return [new SudokuConstraint.Givens(...valueIds)];
  }

  getFixedCells() {
    let cells = [];
    for (const [cell, values] of this._givensMap) {
      if (values.length === 1) cells.push(cell);
    }
    return cells;
  }

  clear() {
    this._givensMap = new Map();
    this._display.drawGivens(this._givensMap);
  }
}

class MultiValueInputPanel {
  constructor(inputManager, onChange, givenLookup) {
    this._form = document.getElementById('multi-value-cell-input');
    this._collapsibleContainer = new CollapsibleContainer(
      this._form.firstElementChild, false);

    this._inputManager = inputManager;

    inputManager.addSelectionPreserver(this._form);
    this.updateFromCells = deferUntilAnimationFrame(
      this.updateFromCells.bind(this));
    inputManager.onSelection(
      this.updateFromCells.bind(this));

    this._onChange = onChange;
    this._givenLookup = givenLookup;
    this._allValues = [];

    this._setUp();
  }

  updateFromCells(selection) {
    toggleDisabled(this._collapsibleContainer.element(), selection.length == 0);
    if (selection.length) {
      this._updateForm(
        this._givenLookup(selection[0]) || this._allValues);
    } else {
      this._updateForm([]);
    }
  };

  reshape(shape) {
    clearDOMNode(this._inputContainer);
    this._valueButtons = [];

    this._allValues = Array.from({ length: shape.numValues }, (_, i) => i + 1);

    for (let i = 0; i < this._allValues.length; i++) {
      const label = document.createElement('label');
      label.classList.add('multi-value-input-option');
      const input = document.createElement('input');
      input.setAttribute('type', 'checkbox');
      label.appendChild(input);
      const span = document.createElement('span');
      span.classList.add('button');
      span.appendChild(document.createTextNode(this._allValues[i]));
      label.appendChild(span);
      this._inputContainer.appendChild(label);
      this._valueButtons.push(input);
    }

    const numbersPerLine = Math.ceil(Math.sqrt(shape.numValues));
    this._inputContainer.style.setProperty(
      'grid-template-columns', `repeat(${numbersPerLine}, 1fr)`);
  }

  _setUp() {
    const form = this._form;
    form.onchange = () => {
      const selection = this._inputManager.getSelection();
      if (selection.length == 0) return;

      this._onChange(selection, this._getCheckedValues());
    };

    const collapsibleBody = this._collapsibleContainer.bodyElement();

    this._inputContainer = document.createElement('div');
    collapsibleBody.append(this._inputContainer);
    this._valueButtons = [];

    collapsibleBody.append(document.createElement('hr'));

    const buttonContainer = document.createElement('div');
    buttonContainer.style.setProperty(
      'grid-template-columns', `repeat(2, 1fr)`);
    collapsibleBody.append(buttonContainer);
    const addButton = (text, valueFilter) => {
      const button = document.createElement('button');
      button.textContent = text;
      button.onclick = () => {
        this._updateForm(this._allValues.filter(valueFilter));
        this._form.dispatchEvent(new Event('change'));
        return false;
      }
      button.classList.add('multi-value-input-control');
      buttonContainer.append(button);
    };

    addButton('None', _ => false);
    addButton('All', _ => true);
    addButton('Odd', v => v % 2 == 1);
    addButton('Even', v => v % 2 == 0);
  }

  _getCheckedValues() {
    const numValues = this._allValues.length;
    const setValues = [];
    for (let i = 0; i < numValues; i++) {
      if (this._valueButtons[i].checked) {
        setValues.push(this._allValues[i]);
      }
    }
    if (setValues.length === numValues) return [];
    return setValues;
  }

  _updateForm(values) {
    for (let i = 0; i < this._allValues.length; i++) {
      this._valueButtons[i].checked = false;
    }
    for (const value of values) {
      this._valueButtons[value - 1].checked = true;
    }
  }
}

class GridInputManager {
  constructor(displayContainer) {
    this._shape = null;

    this._callbacks = {
      onNewDigit: [],
      onSetValues: [],
      onSelection: [],
      onOutsideArrowSelection: [],
    };
    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    let fakeInput = document.getElementById('fake-input');
    this._fakeInput = fakeInput;

    this._selection = new Selection(displayContainer);
    this._selection.addCallback(cellIds => {
      // Blur the active selection, so that callbacks can tell if something
      // has already set the focus.
      document.activeElement.blur();
      if (cellIds.length == 1) {
        const [x, y] = this._selection.cellIdCenter(cellIds[0]);
        fakeInput.style.top = y + 'px';
        fakeInput.style.left = x + 'px';
        fakeInput.select();
      }
      this._runCallbacks(this._callbacks.onSelection, cellIds);
    });

    this._setUpKeyBindings();
  }

  reshape(shape) { this._shape = shape; }

  onNewDigit(fn) { this._callbacks.onNewDigit.push(fn); }
  onSetValues(fn) { this._callbacks.onSetValues.push(fn); }
  onSelection(fn) { this._callbacks.onSelection.push(fn); }
  onOutsideArrowSelection(fn) { this._callbacks.onOutsideArrowSelection.push(fn); }

  updateOutsideArrowSelection(arrowId) {
    this._runCallbacks(this._callbacks.onOutsideArrowSelection, arrowId);
  }

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
        this._runCallbacks(this._callbacks.onSetValues, [cell], []);
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
      if (document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'INPUT') return;
      if (this._selection.size() == 0) return;
      switch (event.key) {
        case 'Backspace':
          this._runCallbacks(
            this._callbacks.onSetValues, this._selection.getCells(), []);
          break;
        case 'f':
          let i = 1;
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onSetValues, [cell], [i++]);
          }
          break;
      }
    });
  }
}

class CollapsibleContainer {
  constructor(element, defaultOpen) {
    this._element = element;
    this._setUp(defaultOpen);
  }

  _setUp(defaultOpen) {
    const element = this._element;
    element.classList.add('collapsible-container');

    const anchor = element.firstElementChild;
    anchor.classList.add('collapsible-anchor');
    anchor.onclick = (e) => this.toggleOpen();
    this._anchorElement = anchor;

    const body = anchor.nextElementSibling;
    body.classList.add('collapsible-body');
    this._bodyElement = body;

    this._element.classList.toggle('container-open', defaultOpen);

    // Handle auto-save.
    const autoSaveId = element.getAttribute('id') || element.parentNode.getAttribute('id');
    if (!autoSaveId) {
      console.error('Collapsible container must have an id attribute.');
      return;
    }
    this._autoSaveKey = `autoSave-collapsible-${autoSaveId}`;
    const savedValue = sessionAndLocalStorage.getItem(this._autoSaveKey);
    if (savedValue) this.toggleOpen(savedValue === 'true');
  }

  isOpen() {
    return this._element.classList.contains('container-open');
  }

  toggleOpen(open) {
    const oldIsOpen = this.isOpen();
    const newIsOpen = this._element.classList.toggle('container-open', open);
    if (oldIsOpen !== newIsOpen) {
      sessionAndLocalStorage.setItem(this._autoSaveKey, newIsOpen.toString());
    }
  }

  element() {
    return this._element;
  }

  bodyElement() {
    return this._bodyElement;
  }

  anchorElement() {
    return this._anchorElement;
  }
}

ConstraintCollector.CustomBinary = class CustomBinary extends ConstraintCollector {
  constructor(inputManager, display, chipView) {
    super();

    this._form = document.getElementById('custom-binary-input');
    this._collapsibleContainer = new CollapsibleContainer(
      this._form.firstElementChild, false);
    inputManager.addSelectionPreserver(this._form);

    inputManager.onSelection(
      deferUntilAnimationFrame(this._onSelection.bind(this)));

    this._configs = new Map();
    this._shape = null;
    this._display = display;
    this._chipView = chipView;
    this._inputManager = inputManager;

    this._setUp();
  }

  reshape(shape) {
    this._shape = shape;
  }

  _onSelection(selection) {
    const form = this._form;
    toggleDisabled(this._collapsibleContainer.element(), selection.length <= 1);
    if (selection.length > 1 && this._collapsibleContainer.isOpen()) {
      // If the function is empty, focus on it. Otherwise focus on the
      // add button.
      if (form['function'].value === '') {
        form['function'].focus();
      } else {
        form['add-constraint'].focus();
      }
    }
  }

  _setUp() {
    const form = this._form;
    const errorElem = document.getElementById(
      'custom-binary-input-function-error');
    form.onsubmit = e => {
      const formData = new FormData(form);
      const name = formData.get('name');
      const type = formData.get('chain-mode');
      const fnStr = formData.get('function');

      let key = null;
      try {
        const fn = Function(
          `return ((a,b)=>${fnStr})`)();
        key = SudokuConstraint[type].fnToKey(
          fn, this._shape.numValues);
      } catch (e) {
        errorElem.textContent = e;
        return false;
      }

      this._add(key, name, this._inputManager.getSelection(), type);
      this.runUpdateCallback();

      return false;
    };
    form['function'].oninput = () => {
      errorElem.textContent = '';
    };
  }

  clear() {
    this._configs.clear();
  }

  addConstraint(constraint) {
    for (const { name, cells } of
      SudokuConstraint.Binary.parseGroups(constraint.items, true)) {
      this._add(constraint.key, name, cells, constraint.type);
    }
  }

  _add(key, name, cells, type) {
    if (type != 'Binary' && type != 'BinaryX') {
      return false;
    }

    const displayConstraint = new ConstraintCollector.CustomBinary.CustomBinaryLine(
      type, key, name, ...cells);
    const config = {
      constraint: displayConstraint,
      displayElem: this._display.drawConstraint(displayConstraint),
      removeFn: () => { this._removeConstraint(displayConstraint); },
    };
    this._chipView.addChip(config);

    const groupId = displayConstraint.groupId();
    if (!this._configs.has(groupId)) this._configs.set(groupId, []);
    this._configs.get(groupId).push(config);
  }

  _removeConstraint(displayConstraint) {
    const groupId = displayConstraint.groupId();
    const keyConfigs = this._configs.get(groupId);
    arrayRemoveValue(keyConfigs, displayConstraint);
  }

  getConstraints() {
    const constraints = [];
    for (const configs of this._configs.values()) {
      if (!configs.length) continue;
      const displayConstraints = configs.map(c => c.constraint);
      const { key, type } = displayConstraints[0];
      constraints.push(
        SudokuConstraint[type].makeFromGroups(
          key, displayConstraints));
    }
    return constraints;
  }
}

// Dummy constraint for displaying custom binary constraints.
ConstraintCollector.CustomBinary.CustomBinaryLine = class CustomBinaryLine extends SudokuConstraintBase {
  static DISPLAY_CONFIG = {
    displayClass: 'CustomBinary',
  }

  constructor(type, key, name, ...cells) {
    super(arguments);
    this.type = type;
    this.key = key;
    this.name = name;
    this.cells = cells;
  }

  groupId() {
    return `${this.type}-${this.key}`;
  }

  chipLabel() {
    if (this.name) return `"${this.name}"`;
    return 'Custom';
  }
}

// A info overlay which is lazily loaded.
class InfoOverlay {
  constructor(displayContainer) {
    this._shape = null;

    this._heatmap = displayContainer.createHighlighter();
    this._textInfo = new InfoTextDisplay(
      displayContainer.getNewGroup('text-info-group'));

    this._onNextTextChangeFn = null;
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();

    this._textInfo.reshape(shape);
  }

  clear() {
    this._heatmap.clear();
    this._clearTextInfo();
  }

  _clearTextInfo() {
    this._textInfo.clear();
    if (this._onNextTextChangeFn) {
      this._onNextTextChangeFn();
      this._onNextTextChangeFn = null;
    }
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

  setValues(values, onChange) {
    const shape = this._shape;
    this._clearTextInfo();
    if (onChange) this._onNextTextChangeFn = onChange;

    if (!values) return;

    for (let i = 0; i < values.length; i++) {
      const cellId = shape.makeCellIdFromIndex(i);
      this._textInfo.setText(cellId, values[i]);
    }
  }
}

class PanelHighlighter {
  static highlightMap = new Map();

  static _HIGHLIGHT_CLASS = 'constraint-panel-highlight';

  static toggleHighlightForElement(element, enable) {
    const group = element.closest('.constraint-panel');
    if (!this.highlightMap.has(group)) {
      this.highlightMap.set(group, new Set());
    }
    const groupSet = this.highlightMap.get(group);

    if (enable) {
      group.classList.add(this._HIGHLIGHT_CLASS);
      groupSet.add(element);
    } else {
      groupSet.delete(element);
      if (groupSet.size === 0) {
        group.classList.remove(this._HIGHLIGHT_CLASS);
      }
    }
  }

  static clear() {
    for (const [group, elements] of this.highlightMap) {
      group.classList.remove(this._HIGHLIGHT_CLASS);
      elements.clear();
    }
  }
}