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

ConstraintCollector.Invisible = class Invisible extends ConstraintCollector {
  constructor() {
    super();
    this._constraints = [];
  }

  clear() {
    this._constraints = [];
  }

  addConstraint(constraint) {
    this._constraints.push(constraint);
  }

  getConstraints() {
    return this._constraints;
  }
}

ConstraintCollector._Checkbox = class _Checkbox extends ConstraintCollector {
  IS_SHAPE_AGNOSTIC = true;

  constructor(display, containerId, constraintConfigs) {
    super();

    this._checkboxes = new Map();
    const initSingleCheckbox = (type, config, container, option) => {
      const constraint = new SudokuConstraint[type](...(option ? [option.value] : []));
      const name = constraint.toString();
      const checkboxId = `${containerId}-input-${this._checkboxes.size}`;

      const div = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = checkboxId;
      input.onchange = () => {
        if (config.displayClass) {
          display.toggleItem(constraint, input.checked, config.displayClass);
        }
        this.runUpdateCallback();
      };
      div.appendChild(input);

      const label = document.createElement('label');
      label.htmlFor = checkboxId;
      label.textContent = `${config.text || type} ${option?.text || ''} `;
      div.appendChild(label);

      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.setAttribute('data-text', config.description);
      div.appendChild(tooltip);

      container.appendChild(div);

      this._checkboxes.set(name, {
        element: input,
        constraint,
      });
    };

    const container = document.getElementById(containerId);
    for (const [type, config] of Object.entries(constraintConfigs)) {
      if (config?.value?.options) {
        for (const option of config.value.options) {
          initSingleCheckbox(type, config, container, option);
        }
      } else {
        initSingleCheckbox(type, config, container, null);
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
    super(
      display,
      'global-constraint-checkboxes',
      {
        AntiConsecutive: {
          text: 'Anti-Consecutive',
          description: `No adjacent cells can have consecutive values.`,
        },
        StrictKropki: {
          text: 'Strict Kropki',
          description: `Only explicitly marked cell pairs satisfy Kropki (black/white dot) constraints.`,
        },
        StrictXV: {
          text: 'Strict XV',
          description: `Only explicitly marked cell pairs satisfy XV constraints.`,
        },
        GlobalEntropy: {
          text: 'Global Entropy',
          description: `Each 2x2 box in the grid has to contain a low digit (1, 2, 3), a middle digit (4, 5, 6) and a high digit (7, 8, 9).`,
        },
        AntiTaxicab: {
          text: 'Anti-Taxicab',
          description: `
          A cell that contains a digit x can't have a taxicab distance of
          exactly x from another cell with the digit x.
          A taxicab distance from cell A to cell B is the minimum
          possible distance from cell A to cell B when traversed only through
          adjacent cells.`,
        },
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
        AntiKnight: {
          text: 'Anti-Knight',
          description: `Cells which are a knight's move away cannot have the same value.`,
        },
        AntiKing: {
          text: 'Anti-King',
          description: `Cells which are a king's move away cannot have the same value.`,
        },
        Diagonal: {
          description: `Values along the diagonal must be unique.`,
          value: {
            options: [
              { text: '╱', value: 1 },
              { text: '╲', value: -1 },
            ],
          },
          displayClass: ConstraintDisplays.Diagonal,
        },
        Windoku: {
          description: `Values in the 3x3 windoku boxes must be uniques.`,
          displayClass: ConstraintDisplays.Windoku,
        },
        DisjointSets: {
          text: 'Disjoint Sets',
          description: `No digit may appear in the same position in any two boxes.`,
        },
        NoBoxes: {
          text: 'No Boxes',
          description: `No standard 3x3 box sudoku constraints.`,
          displayClass: ConstraintDisplays.DefaultRegionsInverted,
        },
      });
  }
}

ConstraintCollector.MultiCell = class MultiCell extends ConstraintCollector {
  constructor(display, panel, inputManager) {
    super();
    this._panelConfigs = [];
    this._display = display;
    this._constraintConfigs = this._makeMultiCellConstraintConfig();
    this._panel = panel;
    this._shape = null;

    const selectionForm = document.forms['multi-cell-constraint-input'];
    this._setUp(selectionForm, this._constraintConfigs);

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
        panelText: (constraint) => `Cage (${constraint.sum})`,
        displayClass: ConstraintDisplays.ShadedRegion,
        displayConfig: {
          labelField: 'sum',
        },
        validateFn: (cells, shape) => (
          cells.length <= shape.numValues && cells.length > 1),
        description:
          "Values must add up to the given sum. All values must be unique.",
      },
      Sum: {
        value: {
          placeholder: 'sum',
        },
        panelText: (constraint) => `Sum (${constraint.sum})`,
        displayClass: ConstraintDisplays.ShadedRegion,
        displayConfig: {
          pattern: DisplayItem.CHECKERED_PATTERN,
          labelField: 'sum',
        },
        description:
          "Values must add up to the given sum. Values don't need to be unique. Only up to 16 cells are allowed.",
      },
      Arrow: {
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          startMarker: LineOptions.EMPTY_CIRCLE_MARKER,
          arrow: true
        },
        description:
          "Values along the arrow must sum to the value in the circle.",
      },
      DoubleArrow: {
        validateFn: (cells, shape) => cells.length > 2,
        text: 'Double Arrow',
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          startMarker: LineOptions.EMPTY_CIRCLE_MARKER,
          endMarker: LineOptions.EMPTY_CIRCLE_MARKER
        },
        description:
          "The sum of the values along the line equal the sum of the values in the circles.",
      },
      PillArrow: {
        validateFn: (cells, shape) => cells.length > 2,
        displayClass: ConstraintDisplays.PillArrow,
        value: {
          placeholder: 'pill size',
          options: [
            { text: '2-digit', value: 2 },
            { text: '3-digit', value: 3 },
          ],
        },
        text: 'Pill Arrow',
        description:
          `
          The sum of the values along the line equal the 2-digit or 3-digit
          number in the pill.
          Numbers in the pill are read from left to right, top to bottom.
          `,
      },
      Thermo: {
        text: 'Thermometer',
        description:
          "Values must be in increasing order starting at the bulb.",
        displayClass: ConstraintDisplays.Thermo,
        displayConfig: {
          color: 'rgb(220, 220, 220)',
          width: LineOptions.THICK_LINE_WIDTH,
          startMarker: LineOptions.FULL_CIRCLE_MARKER,
        },
      },
      Whisper: {
        value: {
          placeholder: 'difference',
          default: 5,
        },
        panelText: (constraint) => `Whisper (${constraint.difference})`,
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: { color: 'rgb(255, 200, 255)' },
        description:
          "Adjacent values on the line must differ by at least this amount."
      },
      Renban: {
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: { color: 'rgb(230, 190, 155)' },
        description:
          "Digits on the line must be consecutive and non-repeating, in any order."
      },
      Modular: {
        value: {
          placeholder: 'mod',
          default: 3,
        },
        text: 'Modular Line',
        panelText: (constraint) => `Modular (${constraint.mod})`,
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: { color: 'rgb(230, 190, 155)', dashed: true },
        description:
          `
          Every sequential group of 'mod' cells on a the line must have
          different values when taken modulo 'mod'.
          If mod = 3, then every group of three cells on the line must contain a
          digit from the group 147, one from 258, and one from 369.
          `
      },
      Entropic: {
        text: 'Entropic Line',
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: { color: 'rgb(255, 100, 255)', dashed: true },
        description:
          `
          Every sequential group of 3 cells on a the line must have different
          values from the groups {1,2,3}, {4,5,6}, and {7,8,9}.
          `
      },
      RegionSumLine: {
        text: 'Region Sum Line',
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: { color: 'rgb(100, 200, 100)' },
        description:
          `
          Values on the line have an equal sum N within each
          box it passes through. If a line passes through the
          same box more than once, each individual segment of
          such a line within that box sums to N separately.

          If the grid has no boxes, then jigsaw regions are used instead.
          `
      },
      SumLine: {
        text: 'Sum Line',
        value: {
          placeholder: 'sum',
          default: 10
        },
        panelText: (constraint) => `Sum Line (${constraint.sum})`,
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          color: 'rgb(100, 200, 100)',
          dashed: true,
        },
        description:
          "The line can be divided into segments that each sum to the given sum."
      },
      Between: {
        text: 'Between Line',
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          color: 'rgb(200, 200, 255)',
          startMarker: LineOptions.EMPTY_CIRCLE_MARKER,
          endMarker: LineOptions.EMPTY_CIRCLE_MARKER
        },
        description:
          "Values on the line must be strictly between the values in the circles."
      },
      Lockout: {
        value: {
          placeholder: 'min diff',
          default: 4,
        },
        text: 'Lockout Line',
        panelText: (constraint) => `Lockout (${constraint.minDiff})`,
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          color: 'rgb(200, 200, 255)',
          startMarker: LineOptions.DIAMOND_MARKER,
          endMarker: LineOptions.DIAMOND_MARKER
        },
        description:
          `
          Values on the line must be not be between the values in the diamonds.
          The values in the diamonds must differ by the difference given.`,
      },
      Lunchbox: {
        value: {
          placeholder: 'sum',
          default: 0,
        },
        panelText: (constraint) => `Lunchbox (${constraint.sum})`,
        displayClass: ConstraintDisplays.ShadedRegion,
        displayConfig: {
          lineConfig: { color: 'rgba(100, 100, 100, 0.2)' },
          labelField: 'sum',
        },
        description:
          `The numbers sandwiched between the smallest number and the largest
           number of the lunchbox adds up to the given sum. Numbers must be
           distinct.`
      },
      Palindrome: {
        text: 'Palindrome',
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          color: 'rgb(200, 200, 255)'
        },
        description:
          "The values along the line form a palindrome."
      },
      Zipper: {
        text: 'Zipper Line',
        displayClass: ConstraintDisplays.GenericLine,
        displayConfig: {
          color: 'rgb(180, 180, 255)',
          dashed: true,
        },
        description:
          `
          Digits which are equal distance from the center of the zipper have the
          same sum. For odd length lines, the center digit is the sum.
          `
      },
      WhiteDot: {
        validateFn: ConstraintManager._cellsAreAdjacent,
        displayClass: ConstraintDisplays.Dot,
        displayConfig: { color: 'white' },
        text: '○ ±1',
        panelText: (constraint) => `○ [${constraint.cells}]`,
        description:
          "Kropki white dot: values must be consecutive. Adjacent cells only.",
      },
      BlackDot: {
        validateFn: ConstraintManager._cellsAreAdjacent,
        displayClass: ConstraintDisplays.Dot,
        displayConfig: { color: 'black' },
        text: '● ×÷2',
        panelText: (constraint) => `● [${constraint.cells}]`,
        description:
          "Kropki black dot: one value must be double the other. Adjacent cells only."
      },
      X: {
        validateFn: ConstraintManager._cellsAreAdjacent,
        displayClass: ConstraintDisplays.Letter,
        text: 'x: 10Σ',
        panelText: (constraint) => `X [${constraint.cells}]`,
        description:
          "x: values must add to 10. Adjacent cells only."
      },
      V: {
        validateFn: ConstraintManager._cellsAreAdjacent,
        displayClass: ConstraintDisplays.Letter,
        text: 'v: 5Σ',
        panelText: (constraint) => `V [${constraint.cells}]`,
        description:
          "v: values must add to 5. Adjacent cells only."
      },
      Quad: {
        value: {
          placeholder: 'values',
        },
        validateFn: ConstraintManager._cellsAre2x2Square,
        text: 'Quadruple',
        displayClass: ConstraintDisplays.Quad,
        panelText: (constraint) => `Quad (${constraint.values.join(',')})`,
        description:
          `
        All the given values must be present in the surrounding 2x2 square.
        Select a 2x2 square to enable.`,
      },
      ContainExact: {
        value: {
          placeholder: 'values',
        },
        panelText: (constraint) => `Contain Exact (${constraint.valueStr})`,
        displayClass: ConstraintDisplays.ShadedRegion,
        displayConfig: {
          pattern: DisplayItem.DIAGONAL_PATTERN,
          labelField: 'valueStr',
        },
        text: 'Contain Exact',
        description:
          `The comma-separated values must be present in the selected squares.
           If value is must be contained exactly as many times as is
           repeated in the list.`,
      },
      ContainAtLeast: {
        value: {
          placeholder: 'values',
        },
        panelText: (constraint) => `Contain At Least (${constraint.valueStr})`,
        displayClass: ConstraintDisplays.ShadedRegion,
        displayConfig: {
          pattern: DisplayItem.DIAGONAL_PATTERN,
          labelField: 'valueStr',
        },
        text: 'Contain At Least',
        description:
          `The comma-separated values must be present in the selected squares.
           If value is must be contained at least as many times as is
           repeated in the list.`,
      },
      CountingCircles: {
        panelText: (constraint) => `Counting Circles (${constraint.cells.length})`,
        displayClass: ConstraintDisplays.CountingCircles,
        displayConfig: {
          pattern: DisplayItem.CHECKERED_PATTERN,
        },
        text: 'Counting Circles',
        description:
          `The value in a circles counts the number of circles with the same
           value. Each set of circles is independent.`,
      },
      Indexing: {
        value: {
          options: [
            { text: 'Column', value: SudokuConstraint.Indexing.COL_INDEXING },
            { text: 'Row', value: SudokuConstraint.Indexing.ROW_INDEXING },
          ],
        },
        panelText: (constraint) => `Indexing (${constraint.indexTypeStr()})`,
        validateFn: (cells, shape) => cells.length > 0,
        displayClass: ConstraintDisplays.Indexing,
        description: `
          Column indexing: For a cell in column C, the value (V) of the cell
          tells where the value C is placed in that row. Specifically, if the
          cell has coordinates (R, C) and value V, then cell (R, V) has the
          value C.Row indexing is the same, but for rows.
        `,
      },
    };
  }

  addConstraint(constraint) {
    let config = null;
    if (constraint.type === 'Quad') {
      config = {
        cells: SudokuConstraint.Quad.cells(constraint.topLeftCell),
        name: `Quad (${constraint.values.join(',')})`,
        constraint: constraint,
        displayElem: this._display.drawItem(
          constraint, ConstraintDisplays.Quad, null),
        replaceKey: `Quad-${constraint.topLeftCell}`,
        removeFn: () => { this._removeConstraint(config); },
      };
      for (const other of this._panelConfigs) {
        if (config.replaceKey == other.replaceKey) {
          this._panel.removeItem(other);
          break;
        }
      }
    } else {
      const uiConfig = this._constraintConfigs[constraint.type];
      config = {
        cells: constraint.cells,
        name: uiConfig.panelText?.(constraint) || uiConfig.text,
        constraint: constraint,
        displayElem: this._display.drawItem(
          constraint,
          uiConfig.displayClass,
          uiConfig.displayConfig),
        removeFn: () => { this._removeConstraint(config); },
      };
    }
    this._panel.addItem(config);
    this._panelConfigs.push(config);
  }

  _removeConstraint(config) {
    arrayRemoveValue(this._panelConfigs, config);
  }

  getConstraints() {
    return this._panelConfigs.map(c => c.constraint);
  }

  clear() {
    this._panelConfigs = [];
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

  _setUp(selectionForm, constraintConfigs) {
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

    // Create the options.
    for (const [name, config] of Object.entries(constraintConfigs)) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = config.text;
      option.title = config.description.replace(/\s+/g, ' ').replace(/^\s/, '');
      selectElem.appendChild(option);
      config.elem = option;

      if (config.value) {
        let input;
        if (config.value.options) {
          input = document.createElement('select');
          for (const { text, value } of config.value.options) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            input.appendChild(option);
          }
        } else {
          input = document.createElement('input');
          input.setAttribute('type', 'text');
          input.setAttribute('size', '10');
          input.setAttribute('placeholder', config.value.placeholder);
        }
        input.setAttribute('name', name + '-value');
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
        config.value.elem.focus();
      } else {
        valueContainer.style.visibility = 'hidden';
      }

      if (config.constraintClass.LOOPS_ALLOWED) {
        loopContainer.style.display = 'block';
      } else {
        loopContainer.style.display = 'none';
      }

      descriptionElem.textContent = config.description;

      if (!selectionForm.classList.contains('disabled')) {
        selectionForm['add-constraint'].disabled = config.elem.disabled;
      }
    }

    // Ensure select is initialized (but not selected).
    autoSaveField(selectElem);
    selectElem.onchange();
    document.activeElement?.blur();
  }

  _onNewSelection(selection, selectionForm) {
    // Only enable the selection panel if the selection is long enough.
    const disabled = (selection.length == 0);
    selectionForm['add-constraint'].disabled = disabled;
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

  constructor(display, inputManager, panel) {
    super();
    this._display = display;
    this._shape = null;
    this._panel = panel;

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
    this._panel.clear();
  }

  _removePiece(config) {
    config.cells.forEach(c => this._piecesMap[this._shape.parseCellId(c).cell] = 0);
  }

  _addPiece(cells) {
    if (cells.length != this._shape.gridSize) return;
    const pieceId = ++this._maxPieceId;
    cells.forEach(c => this._piecesMap[this._shape.parseCellId(c).cell] = pieceId);
    const config = {
      pieceId: pieceId,
      cells: cells,
      name: '',
      displayElem: this._display.drawItem({ cells }, ConstraintDisplays.Jigsaw, null),
      removeFn: () => { this._removePiece(config); },
    };
    this._panel.addItem(config);
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

ConstraintCollector.OutsideClue = class OutsideClue extends ConstraintCollector {
  constructor(inputManager, display) {
    super();
    this._display = display;
    this._configs = this.constructor._constraintConfigs();
    display.configureOutsideClues(this._configs);
    this._setUp(inputManager);
  }

  static _mapKey(type, lineId) {
    return `${type}|${lineId}`;
  }

  static _isValidValue(value, config) {
    if (value == '' || value != +value) return false;
    if (+value === 0 && !config.zeroOk) return false;
    return true;
  }

  static CLUE_TYPE_DOUBLE_LINE = 'double-line';
  static CLUE_TYPE_DIAGONAL = 'diagonal';
  static CLUE_TYPE_SINGLE_LINE = 'single-line';

  static _constraintConfigs() {
    return {
      Sandwich: {
        clueType: this.CLUE_TYPE_SINGLE_LINE,
        strTemplate: '$CLUE',
        zeroOk: true,
        description:
          `Values between the 1 and the 9 in the row or column must add to the
          given sum.`,
      },
      XSum: {
        text: 'X-Sum',
        clueType: this.CLUE_TYPE_DOUBLE_LINE,
        strTemplate: '⟨$CLUE⟩',
        description:
          `The sum of the first X numbers must add up to the given sum.
          X is the number in the first cell in the direction of the row or
      column.`,
      },
      Skyscraper: {
        clueType: this.CLUE_TYPE_DOUBLE_LINE,
        strTemplate: '[$CLUE]',
        description:
          `Digits in the grid represent skyscrapers of that height.
          Higher skyscrapers obscure smaller ones.
          Clues outside the grid show the number of visible skyscrapers in that
      row / column from the clue's direction of view.`,
      },
      HiddenSkyscraper: {
        text: 'Hidden Skyscraper',
        clueType: this.CLUE_TYPE_DOUBLE_LINE,
        strTemplate: '|$CLUE|',
        description:
          `Digits in the grid represent skyscrapers of that height.
          Higher skyscrapers obscure smaller ones.
          Clues outside the grid show the first hidden skyscraper in that
          row/column from the clue's direction of view.`,
      },
      FullRank: {
        text: 'Full Rank',
        clueType: this.CLUE_TYPE_DOUBLE_LINE,
        strTemplate: '#$CLUE ',
        elementId: 'full-rank-option',
        description:
          `Considering all rows and columns as numbers read from the direction
          of the clue and ranked from lowest (1) to highest, a clue represents
          where in the ranking that row/column lies.`,
      },
      NumberedRoom: {
        text: 'Numbered Room',
        clueType: this.CLUE_TYPE_DOUBLE_LINE,
        strTemplate: ':$CLUE:',
        elementId: 'numbered-room-option',
        description:
          `Clues outside the grid indicate the digit which has to be placed in
          the Nth cell in the corresponding direction, where N is the digit
          placed in the first cell in that direction.`,
      },
      LittleKiller: {
        text: 'Little Killer',
        clueType: this.CLUE_TYPE_DIAGONAL,
        strTemplate: '$CLUE',
        description:
          `Values along diagonal must add to the given sum. Values may repeat.`,
      },
    };
  }

  _setUp(inputManager) {
    this._constraints = new Map();

    let outsideArrowForm = document.forms['outside-clue-input'];
    const clearOutsideClue = () => {
      let formData = new FormData(outsideArrowForm);
      const lineId = formData.get('id');
      const type = formData.get('type');
      this._display.removeOutsideClue(type, lineId);
      this._constraints.delete(this.constructor._mapKey(type, lineId));
      inputManager.setSelection([]);
      this.runUpdateCallback();
    };
    outsideArrowForm.onsubmit = e => {
      let formData = new FormData(outsideArrowForm);
      let type = formData.get('type');
      let lineId = formData.get('id');

      const config = this._configs[type];
      let value = formData.get('value');
      if (!this.constructor._isValidValue(value, config)) {
        clearOutsideClue();
        return false;
      }
      value = +value;

      this._addConstraint(
        this.constructor._makeConstraint(
          type, config, lineId, value),
        lineId,
        value);

      inputManager.setSelection([]);
      this.runUpdateCallback();
      return false;
    };
    inputManager.addSelectionPreserver(outsideArrowForm);

    document.getElementById('outside-arrow-clear').onclick = clearOutsideClue;
  }

  addConstraint(constraint) {
    const type = constraint.type;
    const config = this._configs[type];

    switch (config.clueType) {
      case ConstraintCollector.OutsideClue.CLUE_TYPE_DIAGONAL:
        this._addConstraint(constraint, constraint.id, constraint.sum);
        break;
      case ConstraintCollector.OutsideClue.CLUE_TYPE_SINGLE_LINE:
        this._addConstraint(constraint, constraint.id + ',1', constraint.sum);
        break;
      case ConstraintCollector.OutsideClue.CLUE_TYPE_DOUBLE_LINE:
        {
          const values = constraint.values();
          if (values[0]) {
            const lineId = constraint.rowCol + ',1';
            this._addConstraint(
              this.constructor._makeConstraint(type, config, lineId, values[0]),
              lineId, values[0]);
          }
          if (values[1]) {
            const lineId = constraint.rowCol + ',-1';
            this._addConstraint(
              this.constructor._makeConstraint(type, config, lineId, values[1]),
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
    this._display.addOutsideClue(constraint.type, lineId, value);
  }

  clear() {
    for (const [key, _] of this._constraints) {
      const [type, lineId] = key.split('|');
      this._display.removeOutsideClue(type, lineId);
    }
    this._constraints = new Map();
  }

  static _makeConstraint(type, config, lineId, value) {
    let [rowCol, dir] = lineId.split(',');

    switch (config?.clueType) {
      case ConstraintCollector.OutsideClue.CLUE_TYPE_DIAGONAL:
        return new SudokuConstraint[type](value, lineId);
      case ConstraintCollector.OutsideClue.CLUE_TYPE_SINGLE_LINE:
        return new SudokuConstraint[type](value, rowCol);
      case ConstraintCollector.OutsideClue.CLUE_TYPE_DOUBLE_LINE:
        return new SudokuConstraint[type](
          rowCol,
          dir == 1 ? value : '',
          dir == 1 ? '' : value);
      default:
        throw ('Unknown arg type for type: ' + type);
    }
  }

  getConstraints() {
    const seen = new Map();

    const constraints = [];
    for (const constraint of this._constraints.values()) {
      const type = constraint.type;
      if (this._configs[type].clueType === ConstraintCollector.OutsideClue.CLUE_TYPE_DOUBLE_LINE) {
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
    this._constraintPanel = this.addReshapeListener(
      new ConstraintPanel(
        document.getElementById('displayed-constraints'),
        this._display, displayContainer, this.runUpdateCallback.bind(this)));

    const jigsawPanel = this.addReshapeListener(
      new ConstraintPanel(
        document.getElementById('displayed-regions'),
        this._display, displayContainer, this.runUpdateCallback.bind(this)));

    const collectors = [
      new ConstraintCollector.Shape(),
      new ConstraintCollector.GlobalCheckbox(this._display),
      new ConstraintCollector.LayoutCheckbox(this._display),
      new ConstraintCollector.Jigsaw(
        this._display, inputManager, jigsawPanel),
      new ConstraintCollector.MultiCell(
        this._display, this._constraintPanel, inputManager),
      new ConstraintCollector.CustomBinary(
        inputManager, this._display, this._constraintPanel),
      new ConstraintCollector.OutsideClue(inputManager, this._display),
      new ConstraintCollector.GivenCandidates(inputManager, this._display),
      new ConstraintCollector.Invisible(),
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
    const inputElem = form['freeform-input'];

    // Allow loading free-form input from other locations.
    this.loadUnsafeFromText = (input) => {
      try {
        this._loadFromText(input);
      } catch (e) {
        errorElem.textContent = e;
        // If we were called from outside the form, then put the value in the
        // so that the user can see the constraint which failed.
        if (inputElem.value != input) inputElem.value = input;
      }
    };

    form.onsubmit = e => {
      e.preventDefault();
      const input = inputElem.value;
      this.loadUnsafeFromText(input);
      return false;
    };
    inputElem.oninput = () => {
      errorElem.textContent = '';
    };
    autoSaveField(inputElem);
  }

  _loadFromText(input) {
    const constraint = SudokuParser.parseText(input);

    this.clear();
    this._constraintCollectors.get('Shape').addConstraint(constraint);
    this._loadConstraint(constraint);

    this.runUpdateCallback();
  }

  _loadConstraint(constraint) {
    switch (constraint.type) {
      case 'Set':
        constraint.constraints.forEach(c => this._loadConstraint(c));
        break;
      case 'Shape':
        // Nothing to do, but ensure it is not added to invisible constraints.
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
    this._constraintPanel.clear();
    for (const collector of this._constraintCollectors.values()) {
      collector.clear();
    }
    this.runUpdateCallback();
  }
}

class ConstraintPanel {
  constructor(panelElement, display, displayContainer, onUpdate) {
    this._panelElement = panelElement;
    this._panelItemHighlighter = displayContainer.createHighlighter('highlighted-cell');
    this._display = display;
    this._shape = null;
    this._onUpdate = onUpdate;
  }

  reshape(shape) {
    this._shape = shape;
  }

  addItem(config) {
    this._panelElement.appendChild(
      this._makePanelItem(config));
  }

  removeItem(config) {
    config.removeFn();
    this._display.removeItem(config.displayElem);
    config.panelItem.parentNode.removeChild(config.panelItem);
  }

  clear() {
    this._panelElement.innerHTML = '';
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
      this.removeItem(config);
      this._panelItemHighlighter.clear();
      this._onUpdate();
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
    inputManager.setGivenLookup((cell) => this._givensMap.get(cell));
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

class GridInputManager {
  constructor(displayContainer) {
    this._shape = null;

    this._callbacks = {
      onNewDigit: [],
      onSetValues: [],
      onSelection: [],
    };
    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    let fakeInput = document.getElementById('fake-input');
    this._fakeInput = fakeInput;

    this._selection = new Selection(displayContainer);
    this._selection.addCallback(cellIds => {
      this._multiValueInputManager.updateSelection(cellIds);
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
    this._multiValueInputManager = new MultiValueInputManager(
      this,
      (...args) => {
        this._runCallbacks(this._callbacks.onSetValues, ...args)
      });
  }

  reshape(shape) {
    this._shape = shape;
    this._multiValueInputManager.reshape(shape);
  }

  onNewDigit(fn) { this._callbacks.onNewDigit.push(fn); }
  onSetValues(fn) { this._callbacks.onSetValues.push(fn); }
  onSelection(fn) { this._callbacks.onSelection.push(fn); }

  setGivenLookup(fn) { this._multiValueInputManager.setGivenLookup(fn); }

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

class DropdownInputManager {
  constructor(inputManager, containerId, onDropdownOpen) {
    this._containerElem = document.getElementById(containerId);
    this._dropdownElem = this._containerElem.getElementsByClassName('dropdown-container')[0];
    this._onDropdownOpen = onDropdownOpen;

    this._setUpDropdownInputManager(inputManager);
  }

  _setUpDropdownInputManager(inputManager) {
    const dropdown = this._dropdownElem;
    dropdown.getElementsByClassName('dropdown-anchor')[0].onclick = (e) => {
      if (this._currentSelection.length == 0) return;
      dropdown.classList.toggle('visible');
    };

    inputManager.addSelectionPreserver(this._containerElem);

    this._currentSelection = [];
  }

  updateSelection(selection) {
    this._currentSelection = selection;
    // Add a delay so that the display doesn't flicker.
    // We don't have to worry about consistency as it uses the
    // latest value of _currentSelection.
    window.setTimeout(() => {
      if (this._currentSelection.length == 0) {
        this._dropdownElem.classList.add('disabled');
      } else {
        this._dropdownElem.classList.remove('disabled');
        this._onDropdownOpen(this._currentSelection);
      }
    }, 100);
  };

  currentSelection() {
    return this._currentSelection.slice();
  }

  containerElem() {
    return this._containerElem;
  }
}

ConstraintCollector.CustomBinary = class CustomBinary extends ConstraintCollector {
  constructor(inputManager, display, panel) {
    super();

    this._dropDownInputManager = new DropdownInputManager(
      inputManager, 'custom-binary-input',
      this._onDropdownOpen.bind(this));

    inputManager.onSelection(
      (selection) => this._dropDownInputManager.updateSelection(selection));

    this._configs = new Map();
    this._shape = null;
    this._display = display;
    this._panel = panel;

    this._setUp();
  }

  reshape(shape) {
    this._shape = shape;
  }

  _onDropdownOpen(selection) {
    if (selection.length > 1) {
      const form = this._dropDownInputManager.containerElem();
      form['add-constraint'].focus();
    }
  }

  _setUp() {
    const form = this._dropDownInputManager.containerElem();
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

      this._add(key, name, this._dropDownInputManager.currentSelection(), type);
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

    const config = {
      name: name || 'Custom',
      originalName: name,
      key: key,
      cells: cells,
      type: type,
      mapKey: `${type}-${key}`,
      displayElem: this._display.drawItem(
        { cells, key, type }, ConstraintDisplays.CustomBinary, null),
      removeFn: () => { this._removeConstraint(config); },
    };
    this._panel.addItem(config);

    const mapKey = config.mapKey;
    if (!this._configs.has(mapKey)) this._configs.set(mapKey, []);
    this._configs.get(mapKey).push(config);
  }

  _removeConstraint(config) {
    const keyConfigs = this._configs.get(config.mapKey);
    const index = keyConfigs.indexOf(config);
    keyConfigs.splice(index, 1);
  }

  getConstraints() {
    const constraints = [];
    for (const configs of this._configs.values()) {
      if (!configs.length) continue;
      const { key, type } = configs[0];
      constraints.push(
        SudokuConstraint[type].makeFromGroups(
          key,
          configs.map(c => ({ name: c.originalName, cells: c.cells }))));
    }
    return constraints;
  }
}

class MultiValueInputManager extends DropdownInputManager {
  constructor(inputManager, onChange) {
    super(inputManager, 'multi-value-cell-input', () => { });
    this._dropdownBody = this._dropdownElem.getElementsByClassName('dropdown-body')[0];
    this._onChange = onChange;
    this._givenLookup = (cell) => undefined;

    this._setUp();
  }

  setGivenLookup(fn) { this._givenLookup = fn; }

  updateSelection(selection) {
    this._currentSelection = [];
    if (selection.length) {
      this._updateForm(this._givenLookup(selection[0]) || []);
    }
    super.updateSelection(selection);
  };

  reshape(shape) {
    clearDOMNode(this._dropdownBody);
    for (let i = 0; i < shape.numValues; i++) {
      const label = document.createElement('label');
      label.classList.add('multi-value-input-option');
      const input = document.createElement('input');
      input.setAttribute('type', 'checkbox');
      label.appendChild(input);
      const span = document.createElement('span');
      span.classList.add('button');
      span.appendChild(document.createTextNode(i + 1));
      label.appendChild(span);
      this._dropdownBody.appendChild(label);
    }

    this._dropdownBody.style.setProperty(
      'grid-template-columns', `repeat(${shape.boxWidth}, 1fr)`);
  }

  _setUp() {
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
    if (setValues.length == inputs.length) return [];
    return setValues;
  }

  _updateForm(values) {
    const inputs = this._containerElem.elements;
    // When the list is empty, check all the boxes as that aligns with the
    // default state.
    const defaultChecked = values.length == 0;
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].checked = defaultChecked;
    }
    for (const value of values) {
      inputs[value - 1].checked = true;
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