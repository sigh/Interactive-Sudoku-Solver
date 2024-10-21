// Make these variables global so that debug functions can access them.
let constraintManager, controller;

const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  const displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  constraintManager = new ConstraintManager(
    inputManager, displayContainer);

  // Load examples.
  const exampleHandler = new ExampleHandler(constraintManager);

  controller = new SolutionController(constraintManager, displayContainer);

  const hiddenElements = Array.from(
    document.getElementsByClassName('hide-until-load'));
  hiddenElements.forEach(e => e.classList.remove('hide-until-load'));
};

class ConstraintCollector {
  static IS_LAYOUT = false;
  static IS_SHAPE_AGNOSTIC = false;

  constructor(router) {
    this.router = router;
  }

  // listeners for when constraints are added or removed.
  onAddConstraint(constraint) { }
  onRemoveConstraint(constraint) { }

  clear() { }

  reshape(shape) { }

  setUpdateCallback(fn) {
    this._updateCallback = fn || (() => { });
  }

  // TODO: Do we need this?
  runUpdateCallback() {
    this._updateCallback();
  }

  // Find all constraint types that are associated with this collector.
  static constraintClasses() {
    const name = this.name;
    const classes = [...Object.values(SudokuConstraint)].filter(
      t => t.COLLECTOR_CLASS === name);
    classes.sort((a, b) => a.displayName().localeCompare(b.displayName()));
    return classes;
  }
}

ConstraintCollector.Shape = class Shape extends ConstraintCollector {
  static IS_LAYOUT = true;

  constructor(router) {
    super(router);

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

    select.onchange = () => {
      const shapeName = select.value;
      const shape = GridShape.get(shapeName);
      if (!shape) throw ('Invalid shape: ' + shapeName);
      this.router.setShape(shape);
    };
    this._select = select;
  }

  reshape(shape) {
    this._select.value = shape.name;
  }
}

ConstraintCollector.Experimental = class Experimental extends ConstraintCollector {
}

ConstraintCollector.Composite = class Composite extends ConstraintCollector { }

ConstraintCollector._Checkbox = class _Checkbox extends ConstraintCollector {
  static IS_SHAPE_AGNOSTIC = true;

  constructor(router, containerId) {
    super(router);

    this._checkboxes = new Map();
    const initSingleCheckbox = (constraintClass, container, option) => {
      const constraint = new constraintClass(...(option ? [option.value] : []));
      const constraintCls = constraint.constructor;
      const key = constraint.toString();
      const checkboxId = `${containerId}-input-${this._checkboxes.size}`;

      const div = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = checkboxId;
      input.onchange = () => {
        if (input.checked) {
          this.router.addConstraint(constraint);
        } else {
          // We need to remove the exact constraint objects (not necessarily
          // the constraint we store ourselves).
          for (const uniquenessKey of constraint.uniquenessKeys()) {
            for (const c of this.router.getConstraintsByKey(uniquenessKey)) {
              if (c.type === constraint.type) {
                this.router.removeConstraint(c);
              }
            }
          }
        }
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
    const constraintClasses = this.constructor.constraintClasses();
    for (const constraintClass of constraintClasses) {
      if (constraintClass.ARGUMENT_CONFIG) {
        for (const option of constraintClass.ARGUMENT_CONFIG.options) {
          initSingleCheckbox(constraintClass, container, option);
        }
      } else {
        initSingleCheckbox(constraintClass, container, null);
      }
    }
  }

  onAddConstraint(c) {
    const checkbox = this._checkboxes.get(c.toString());
    const element = checkbox.element;
    element.checked = true;
  }

  onRemoveConstraint(c) {
    const element = this._checkboxes.get(c.toString()).element;
    element.checked = false;
  }

  clear() {
    for (const item of this._checkboxes.values()) {
      item.element.checked = false;
    }
  }
}

ConstraintCollector.GlobalCheckbox = class GlobalCheckbox extends ConstraintCollector._Checkbox {
  constructor(router, addUpdateListener) {
    const element = document.getElementById('global-constraints-container');
    const container = new CollapsibleContainer(
      element, /* defaultOpen= */ true);
    addUpdateListener(() => container.updateActiveHighlighting());

    super(router, container.bodyElement().id);
  }
}

ConstraintCollector.LayoutCheckbox = class LayoutCheckbox extends ConstraintCollector._Checkbox {
  static IS_LAYOUT = true;

  constructor(router) {
    super(router, 'layout-constraint-checkboxes');
  }
}

ConstraintCollector.LinesAndSets = class LinesAndSets extends ConstraintCollector {
  static DEFAULT_TYPE = 'Cage';

  constructor(router, inputManager) {
    super(router);
    this._shape = null;

    this._constraintClasses = this.constructor.constraintClasses();
    this._typeMap = new Map();
    this._validationFns = new Map();

    const selectionForm = document.forms['multi-cell-constraint-input'];
    this._setUp(selectionForm, this._constraintClasses, inputManager);

    this._collapsibleContainer = new CollapsibleContainer(
      selectionForm.firstElementChild,
      /* defaultOpen= */ true).allowInComposite();

    inputManager.onSelection(
      (selection, finishedSelecting) =>
        this._onNewSelection(selection, selectionForm, finishedSelecting));
    inputManager.addSelectionPreserver(selectionForm);

    selectionForm.onsubmit = e => {
      this._handleSelection(selectionForm, inputManager);
      return false;
    };
  }

  reshape(shape) {
    this._shape = shape;
  }

  _handleSelection(selectionForm, inputManager) {
    const cells = inputManager.getSelection();
    if (cells.length < 1) throw ('Selection too short.');

    const formData = new FormData(selectionForm);
    const type = formData.get('constraint-type');

    const constraintClass = SudokuConstraint[type];
    const typeData = this._typeMap.get(type);
    if (!typeData) throw ('Unknown constraint type: ' + type);
    if (typeData.elem.disabled) throw ('Invalid selection for ' + type);

    if (constraintClass.LOOPS_ALLOWED && formData.get('is-loop')) {
      cells.push('LOOP');
    }

    if (constraintClass === SudokuConstraint.Quad) {
      const valuesStr = formData.get(type + '-value');
      const values = valuesStr.split(/[, ]+/).map(v => +v).filter(
        v => Number.isInteger(v) && v >= 1 && v <= this._shape.numValues);
      if (values.length) {
        cells.sort();
        const constraint = new SudokuConstraint.Quad(cells[0], ...values);
        this.router.addConstraint(constraint);
      }
    } else if (
      constraintClass === SudokuConstraint.ContainExact ||
      constraintClass === SudokuConstraint.ContainAtLeast) {
      const valuesStr = formData.get(type + '-value');
      const values = valuesStr.split(/[, ]+/).map(v => +v).filter(
        v => Number.isInteger(v) && v >= 1 && v <= this._shape.numValues);
      if (values.length) {
        const constraint = new constraintClass(values.join('_'), ...cells);
        this.router.addConstraint(constraint);
      }
    } else if (constraintClass.ARGUMENT_CONFIG) {
      const value = formData.get(type + '-value');
      this.router.addConstraint(
        new constraintClass(value, ...cells));
    } else {
      this.router.addConstraint(
        new constraintClass(...cells));
    }

    inputManager.setSelection([]);
    this.runUpdateCallback();
  }

  _setUp(selectionForm, constraintClasses, inputManager) {
    const selectElem = selectionForm['constraint-type'];
    selectionForm.classList.add('disabled');
    const valueContainer = document.getElementById('multi-cell-constraint-value-container');
    const valueElems = [];

    const loopContainer = document.getElementById('multi-cell-constraint-loop-container');
    loopContainer.style.display = 'none';

    // Create the options.
    for (const constraintClass of constraintClasses) {
      const type = constraintClass.name;
      const typeData = {};
      this._typeMap.set(constraintClass.name, typeData);

      const option = document.createElement('option');
      option.value = type;
      option.textContent = constraintClass.displayName();
      option.title = constraintClass.DESCRIPTION.replace(/\s+/g, ' ').replace(/^\s/, '');
      selectElem.appendChild(option);
      typeData.elem = option;

      if (constraintClass.ARGUMENT_CONFIG) {
        const argConfig = constraintClass.ARGUMENT_CONFIG;
        let input;
        if (argConfig.options) {
          input = document.createElement('select');
          if (isIterable(argConfig.options)) {
            for (const { text, value } of argConfig.options) {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = text;
              input.appendChild(option);
            }
          } else if (argConfig.options instanceof Function) {
            typeData.dynamicOptionsFn = this._setUpDynamicOptions(
              input, argConfig.options);
          } else {
            throw ('Invalid options for ' + type);
          }
        } else {
          input = document.createElement('input');
          input.setAttribute('type', 'text');
          input.setAttribute('size', '8');
          input.setAttribute('placeholder', argConfig.label);
        }
        input.setAttribute('name', type + '-value');
        if (argConfig.default !== undefined) {
          input.setAttribute('value', argConfig.default);
        }
        input.style.display = 'none';
        valueContainer.appendChild(input);
        typeData.valueElem = input;
        valueElems.push(input);
      }

      // Validation functions are grouped so that each only needs to be
      // called once.
      const validationFn = constraintClass.VALIDATE_CELLS_FN;
      if (!this._validationFns.has(validationFn)) {
        this._validationFns.set(validationFn, []);
      }
      this._validationFns.get(validationFn).push(option);
    }

    // Update the form based on the selected constraint.
    const descriptionElem = document.getElementById('multi-cell-constraint-description');
    selectElem.onchange = () => {
      const type = selectElem.value;
      const typeData = this._typeMap.get(type);
      if (!typeData) return;

      if (typeData.valueElem) {
        valueContainer.style.visibility = 'visible';
        for (const elem of valueElems) {
          elem.style.display = 'none';
        }
        typeData.valueElem.style.display = 'inline';
        if (typeData.dynamicOptionsFn) {
          typeData.dynamicOptionsFn(inputManager.getSelection());
        }
        typeData.valueElem.focus();
      } else {
        valueContainer.style.visibility = 'hidden';
      }

      const constraintClass = SudokuConstraint[type];
      if (constraintClass.LOOPS_ALLOWED) {
        loopContainer.style.display = 'block';
      } else {
        loopContainer.style.display = 'none';
      }

      descriptionElem.textContent = constraintClass.DESCRIPTION;

      if (!selectionForm.classList.contains('disabled')) {
        selectionForm['add-constraint'].disabled = typeData.elem.disabled;
      }
    };

    // Set cage as the default.
    this._typeMap.get(this.constructor.DEFAULT_TYPE).elem.selected = true;

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

  _onNewSelection(selection, selectionForm, finishedSelecting) {
    // Only enable the selection panel if the selection is long enough.
    const disabled = (selection.length == 0);
    selectionForm['add-constraint'].disabled = disabled;
    selectionForm.classList.toggle('disabled', disabled);

    if (disabled) {
      // Reenable all the options, so that the user can select them and see
      // their descriptions.
      for (const typeData of this._typeMap.values()) {
        typeData.elem.disabled = false;
      }
      selectionForm.classList.add('disabled');
      return;
    } else {
      selectionForm.classList.remove('disabled');
    }

    const isSingleCell = selection.length == 1;

    for (const [validationFn, elems] of this._validationFns) {
      // Call the validation function, or by default disallow single cell
      // selections.
      const isValid = (
        validationFn ? validationFn(selection, this._shape) : !isSingleCell);

      for (const elem of elems) elem.disabled = !isValid;
    }

    // Disable the add button if the current value is not valid.
    const type = selectionForm['constraint-type'].value;
    const typeData = this._typeMap.get(type);
    if (typeData.elem.disabled) {
      selectionForm['add-constraint'].disabled = true;
    } else if (!isSingleCell && finishedSelecting) {
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
        if (typeData.valueElem?.select) {
          typeData.valueElem.select();
        } else {
          selectionForm['add-constraint'].focus();
        }
      }
    }
    // Update dynamic options if needed.
    if (typeData.dynamicOptionsFn) {
      typeData.dynamicOptionsFn(selection);
    }
  }
}

class ExampleHandler {
  constructor(constraintManager) {
    this._ignoreConstraintChanges = false;
    this._exampleSelect = this._setUp();
    this._constraintManager = constraintManager;
    constraintManager.addUpdateListener(
      this.newConstraintLoaded.bind(this));
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
    } else {
      this._ignoreConstraintChanges = false;
    }
  }
}

ConstraintCollector.Jigsaw = class Jigsaw extends ConstraintCollector {
  static IS_LAYOUT = true;

  constructor(router, inputManager, chipView) {
    super(router);
    this._shape = null;
    this._chipView = chipView;

    this._setUpButton(inputManager);
  }

  _setUpButton(inputManager) {
    const button = document.getElementById('add-jigsaw-button');
    button.onclick = () => {
      const cells = inputManager.getSelection();
      this.router.addConstraint(
        new SudokuConstraint.Jigsaw(...cells));
      this.runUpdateCallback();
    };

    button.disabled = true;
    inputManager.onSelection((selection, finishedSelecting) => {
      const isValid = this._cellsAreValidJigsawPiece(selection);
      button.disabled = !isValid;
      if (finishedSelecting && isValid && !this._isEmpty()) {
        button.focus();
      }
    });
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();
  }

  _isEmpty() {
    return this._chipView.isEmpty();
  }

  _cellsAreValidJigsawPiece(cells) {
    const shape = this._shape;
    if (cells.length != shape.gridSize) return false;

    // Check that we don't conflict with any existing constraints.
    for (const cell of cells) {
      if (this.router.getConstraintsByKey(cell).some(
        c => c.constructor.COLLECTOR_CLASS === this.constructor.name)) {
        return false;
      }
    }

    return true;
  }
}

ConstraintCollector.OutsideClue = class OutsideClue extends ConstraintCollector {
  constructor(router, inputManager) {
    super(router);
    this._outsideArrowMap = new Map();

    this._setUp(inputManager);
  }

  static _isValidValue(value, zeroOk) {
    if (value == '' || value != +value) return false;
    if (+value === 0 && !zeroOk) return false;
    return true;
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
      outsideClueForm.firstElementChild,
      /* defaultOpen= */ false).allowInComposite();

    this._populateOutsideClueForm(outsideClueForm);

    const clearOutsideClue = () => {
      let formData = new FormData(outsideClueForm);
      const arrowId = formData.get('id');
      const type = formData.get('type');
      const constraints = this.router.getConstraintsByKey(arrowId).filter(
        c => c.type === type);
      for (const constraint of constraints) {
        this.router.removeConstraint(constraint);
      }
      inputManager.setSelection([]);
    };
    outsideClueForm.onsubmit = e => {
      let formData = new FormData(outsideClueForm);
      let type = formData.get('type');
      let arrowId = formData.get('id');

      let value = formData.get('value');
      const constraintClass = SudokuConstraint[type];
      const zeroOk = constraintClass.ZERO_VALUE_OK;
      if (!this.constructor._isValidValue(value, zeroOk)) {
        clearOutsideClue();
        return false;
      }
      value = +value;

      this.router.addConstraint(new constraintClass(arrowId, value));

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

    // Enable only constraint types which are valid for this arrow.
    for (const input of form.type) {
      const constraintClass = SudokuConstraint[input.value];
      input.disabled = !clueTypes.includes(constraintClass.CLUE_TYPE);
    }

    // Find all existing constraints for this arrow.
    const constraintsForArrow = this.router.getConstraintsByKey(arrowId).filter(
      c => c.constructor.COLLECTOR_CLASS === this.constructor.name);

    // Ensure that the selected type is valid for this arrow.
    if (constraintsForArrow.length) {
      // If we have existing clues, then make sure the selection matches ones
      // of them.
      if (!constraintsForArrow.some(c => c.type === form.type.value)) {
        form.type.value = constraintsForArrow[0].type;
        form.dispatchEvent(new Event('change'));
      }
    } else if (!clueTypes.includes(SudokuConstraint[form.type.value]?.CLUE_TYPE)) {
      // Otherwise then select any valid clue type.
      for (const input of form.type) {
        const constraintClass = SudokuConstraint[input.value];
        if (clueTypes.includes(constraintClass.CLUE_TYPE)) {
          form.type.value = constraintClass.name;
          form.dispatchEvent(new Event('change'));
          break;
        }
      }
    }
  }

  _populateOutsideClueForm(form) {
    const container = form.getElementsByClassName(
      'outside-arrow-clue-types')[0];

    for (const constraintClass of this.constructor.constraintClasses()) {
      const type = constraintClass.name;
      const div = document.createElement('div');

      const id = `${type}-option`;

      const input = document.createElement('input');
      input.id = id;
      input.type = 'radio';
      input.name = 'type';
      input.value = type;
      div.appendChild(input);

      const label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = constraintClass.displayName() + ' ';
      const tooltip = document.createElement('span');
      tooltip.classList.add('tooltip');
      tooltip.setAttribute('data-text', constraintClass.DESCRIPTION);
      label.appendChild(tooltip);
      div.appendChild(label);

      container.appendChild(div);
    }

    autoSaveField(form, 'type');
  }
}

class ConstraintRouter {
  constructor(fns, uniquenessKeySet) {
    this.addConstraint = fns.addConstraint;
    this.removeConstraint = fns.removeConstraint;
    this.updateConstraint = fns.updateConstraint;
    this.getConstraintsByKey = (key) => uniquenessKeySet.getKey(key);
    this.setShape = fns.setShape;
    this.getRouterForComposite = fns.getRouterForComposite;
  }
}

// Allows `addConstraint` calls to be redirected to a different router.
class SelectedConstraintRouter {
  constructor(rootRouter) {
    this._rootRouter = rootRouter;
    this._currentRouter = rootRouter;
  }

  setRouter(router) {
    this._currentRouter = router || this._rootRouter;
  }

  isSelected() {
    return this._currentRouter !== this._rootRouter;
  }

  addConstraint(constraint) {
    if (this.isSelected() && CompositeConstraintBase.allowedConstraintClass(constraint.constructor)) {
      this._currentRouter.addConstraint(constraint);
    } else {
      this._rootRouter.addConstraint(constraint);
    }
  }

  removeConstraint(constraint) {
    this._rootRouter.removeConstraint(constraint);
  }

  setShape(shape) {
    this._rootRouter.setShape(shape);
  }

  getConstraintsByKey(key) {
    return this._rootRouter.getConstraintsByKey(key);
  }
}

class ConstraintManager {
  constructor(inputManager, displayContainer) {
    this._shape = null;
    this._reshapeListeners = [];
    this._updateListeners = [];
    this.runUpdateCallback = deferUntilAnimationFrame(
      this.runUpdateCallback.bind(this));

    this.addReshapeListener(displayContainer);
    this.addReshapeListener(inputManager);

    this._display = this.addReshapeListener(new ConstraintDisplay(
      inputManager, displayContainer));
    this._constraintCollectors = new Map();
    this._setUp(inputManager, displayContainer);

    this._constraintPanel = document.getElementById(
      'constraint-panel-container');

    // Initialize the shape.
    this._reshape(SudokuConstraint.Shape.DEFAULT_SHAPE);
  }

  _reshape(shape) {
    if (this._shape === shape) return;

    const preservedConstraints = this._getShapeAgnosticConstraints();

    this.clear();
    this._shape = shape;
    for (const listener of this._reshapeListeners) {
      listener.reshape(shape);
    }

    preservedConstraints.forEachTopLevel(
      c => this._constraintRouter.addConstraint(c));

    this.runUpdateCallback();
  }

  addReshapeListener(listener) {
    this._reshapeListeners.push(listener);
    // Ensure the listener is initialized with the current shape if it exists.
    if (this._shape) listener.reshape(this._shape);
    return listener;
  }

  addUpdateListener(listener) {
    this._updateListeners.push(listener);
    return listener;
  }

  runUpdateCallback() {
    for (const listener of this._updateListeners) {
      listener(this);
    }
  }

  _routerSelected(router) {
    if (!router) {
      // Reset back to the root router.
      this._selectedConstraintRouter.setRouter();
      this._constraintPanel.classList.remove('composite-constraint-selected');
    } else {
      // Enable adding to the given router.
      this._selectedConstraintRouter.setRouter(router);
      this._constraintPanel.classList.add('composite-constraint-selected');
    }
  }

  _setUp(inputManager, displayContainer) {
    const chipViews = new Map();
    this._chipHighlighter = displayContainer.createCellHighlighter('chip-hover');
    this._constraintSelector = this.addReshapeListener(
      new ConstraintSelector(
        displayContainer, this._display,
        this._routerSelected.bind(this)));
    this.addUpdateListener(
      () => this._constraintSelector.onConstraintsUpdated());

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
        document.getElementById('layout-constraint-container'),
        /* defaultOpen= */ true);
      inputManager.addSelectionPreserver(layoutContainer.anchorElement());
      this.addUpdateListener(() => layoutContainer.updateActiveHighlighting());
    }

    this._constraints = new Map();
    const uniquenessKeySet = new ConstraintManager.UniquenessKeySet();
    this._uniquenessKeySet = uniquenessKeySet;
    // TODO: These should be made into class functions, but only after
    // composite handling has been figured out.
    const constraintRouter = new ConstraintRouter({
      addConstraint: (constraint) => {
        if (this._constraints.has(constraint)) return;

        const constraintState = {};

        const matches = this._uniquenessKeySet.matchConstraint(constraint);
        for (const match of matches) {
          this._constraintRouter.removeConstraint(match);
        }

        if (constraint.constructor.DISPLAY_CONFIG) {
          constraintState.displayElem = this._display.drawConstraint(constraint);
        }
        const chipView = this._chipViewForConstraint(constraint);
        if (chipView) {
          constraintState.chip = chipView.addChip(
            constraint,
            constraintState.displayElem?.cloneNode(true),
            this._constraintRouter);
          if (constraint.constructor.IS_COMPOSITE) {
            const subView = this._makeCompositeConstraintView(
              constraintState.chip);
            constraintState.router = this._makeCompositeConstraintRouter(
              constraint, subView, this._constraintRouter);
          }
        }
        this._constraints.set(constraint, constraintState);
        this._uniquenessKeySet.addConstraint(constraint);

        this._constraintCollectors.get(
          constraint.constructor.COLLECTOR_CLASS).onAddConstraint(
            constraint);
        this.runUpdateCallback();
      },
      removeConstraint: (constraint) => {
        if (!this._constraints.has(constraint)) return;
        const constraintState = this._constraints.get(constraint);
        if (constraintState.chip) {
          ConstraintChipView.removeChip(constraintState.chip);
        }
        if (constraintState.displayElem) {
          this._display.removeConstraint(constraint);
        }
        this._constraints.delete(constraint);
        this._uniquenessKeySet.removeConstraint(constraint);
        this._constraintCollectors.get(
          constraint.constructor.COLLECTOR_CLASS).onRemoveConstraint(
            constraint);
        // TODO: Make run update callback only get called by the user
        // interactions.
        this.runUpdateCallback();
      },
      updateConstraint: (constraint) => {
        const constraintState = this._constraints.get(constraint);
        if (!constraintState) return;

        if (constraintState.displayElem) {
          this._display.removeConstraint(constraint);
          constraintState.displayElem = this._display.drawConstraint(constraint);
        }
        const chip = constraintState.chip;
        if (chip) {
          ConstraintChipView.replaceChipIcon(
            chip,
            constraintState.displayElem?.cloneNode(true),
            this._shape);
        }
        this.runUpdateCallback();
      },
      setShape: (shape) => {
        this._reshape(shape);
        this._constraintRouter.addConstraint(
          new SudokuConstraint.Shape(shape.name));
      },
      getRouterForComposite: (c) => {
        return this._constraints.get(c)?.router;
      }
    },
      uniquenessKeySet);
    this._constraintRouter = constraintRouter;

    const selectedConstraintRouter = new SelectedConstraintRouter(
      constraintRouter);
    this._selectedConstraintRouter = selectedConstraintRouter;

    const collectors = [
      new ConstraintCollector.Shape(selectedConstraintRouter),
      new ConstraintCollector.GlobalCheckbox(
        selectedConstraintRouter, this.addUpdateListener.bind(this)),
      new ConstraintCollector.LayoutCheckbox(selectedConstraintRouter),
      new ConstraintCollector.Jigsaw(
        selectedConstraintRouter, inputManager, chipViews.get('jigsaw')),
      new ConstraintCollector.LinesAndSets(
        selectedConstraintRouter, inputManager),
      new ConstraintCollector.CustomBinary(
        selectedConstraintRouter, inputManager),
      new ConstraintCollector.OutsideClue(
        selectedConstraintRouter, inputManager),
      new ConstraintCollector.GivenCandidates(
        selectedConstraintRouter, inputManager),
      new ConstraintCollector.Experimental(selectedConstraintRouter),
      new ConstraintCollector.Composite(selectedConstraintRouter),
    ];

    for (const collector of collectors) {
      this._constraintCollectors.set(collector.constructor.name, collector);
      this.addReshapeListener(collector);
      collector.setUpdateCallback(this.runUpdateCallback.bind(this));
    }

    this._setUpFreeFormInput();

    // Clear button.
    document.getElementById('clear-constraints-button').onclick = () => this.clear();

    // Copy to clipboard.
    document.getElementById('copy-constraints-button').onclick = () => {
      navigator.clipboard.writeText(this.getConstraints());
    };
  }

  _makeCompositeConstraintView(chip) {
    const subViewElem = ConstraintChipView.addSubChipView(chip);
    const subView = new ConstraintChipView(
      subViewElem, this._display, this._chipHighlighter,
      this._constraintSelector,
      this.runUpdateCallback.bind(this));
    // Shape is constant for composite constraints.
    subView.reshape(this._shape);
    return subView;
  }

  _makeCompositeConstraintRouter(
    constraint, chipView, parentRouter) {
    const constraintMap = new Map();

    const addWithoutUpdate = (c) => {
      const chip = chipView.addChip(
        c, this._display.makeConstraintIcon(c), router);
      const constraintState = { chip };
      constraintMap.set(c, constraintState);
      if (c.constructor.IS_COMPOSITE) {
        const subView = this._makeCompositeConstraintView(chip);
        constraintState.router = this._makeCompositeConstraintRouter(
          c, subView, router);
      }
      return constraintState;
    }

    const router = new ConstraintRouter({
      addConstraint: (c) => {
        constraint.addChild(c);
        const constraintState = addWithoutUpdate(c);
        parentRouter.updateConstraint(constraint);
        this._constraintSelector.updateLatest(
          c, constraintState.chip);
      },
      removeConstraint: (c) => {
        constraint.removeChild(c);
        const constraintState = constraintMap.get(c);
        if (constraintState?.chip) {
          ConstraintChipView.removeChip(constraintState.chip);
        }
        constraintMap.delete(c);
        parentRouter.updateConstraint(constraint);
      },
      updateConstraint: (c) => {
        const constraintState = constraintMap.get(c);
        if (!constraintState) return;

        const chip = constraintState.chip;
        ConstraintChipView.replaceChipIcon(
          chip,
          this._display.makeConstraintIcon(c),
          this._shape);
        parentRouter.updateConstraint(constraint);
      },
      setShape: () => {
        throw ('Cannot set shape on composite constraint.');
      },
      getRouterForComposite: (c) => {
        return constraintMap.get(c)?.router;
      }
    },
      new ConstraintManager.UniquenessKeySet());

    for (const child of constraint.constraints) {
      addWithoutUpdate(child);
    }

    return router;
  }

  _chipViewForConstraint(constraint) {
    switch (constraint.constructor.COLLECTOR_CLASS) {
      case 'LinesAndSets':
      case 'CustomBinary':
      case 'Experimental':
        return this._chipViews.get('ordinary');
      case 'Jigsaw':
        return this._chipViews.get('jigsaw');
      case 'Composite':
        return this._chipViews.get('composite');
    }

    return null;
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

    this._constraintRouter.setShape(constraint.getShape());
    constraint.forEachTopLevel(c => this._constraintRouter.addConstraint(c));

    this.runUpdateCallback();

    return constraint;
  }

  _getConstraints(filterFn) {
    const constraints = [];
    for (const constraint of this._constraints.keys()) {
      if (filterFn(constraint)) {
        constraints.push(constraint);
      }
    }
    return new SudokuConstraint.Set(constraints);
  }

  _getShapeAgnosticConstraints() {
    return this._getConstraints(
      c => ConstraintCollector[c.constructor.COLLECTOR_CLASS].IS_SHAPE_AGNOSTIC);
  }

  getLayoutConstraints() {
    return this._getConstraints(
      c => ConstraintCollector[c.constructor.COLLECTOR_CLASS].IS_LAYOUT);
  }

  getConstraints() {
    return this._getConstraints(_ => true);
  }

  clear() {
    this._display.clear();
    for (const chipView of this._chipViews.values()) {
      chipView.clear();
    }
    this._chipHighlighter.clear();
    this._constraintSelector.clear();
    for (const collector of this._constraintCollectors.values()) {
      collector.clear();
    }
    this._constraints.clear();
    this._uniquenessKeySet.clear();
    this.runUpdateCallback();
  }
}

ConstraintManager.UniquenessKeySet = class UniquenessKeySet {
  constructor() {
    this._uniquenessKeys = new MultiMap();
  }

  matchConstraint(constraint) {
    const keys = constraint.uniquenessKeys();
    const matches = [];
    for (const key of keys) {
      for (const c of this._uniquenessKeys.get(key)) {
        if (c.type === constraint.type) {
          matches.push(c);
        }
      }
    }

    return matches;
  }

  addConstraint(constraint) {
    const keys = constraint.uniquenessKeys();
    for (const key of keys) {
      this._uniquenessKeys.add(key, constraint);
    }
  }

  removeConstraint(constraint) {
    const keys = constraint.uniquenessKeys();
    for (const key of keys) {
      this._uniquenessKeys.delete(key, constraint);
    }
  }

  getKey(key) {
    return this._uniquenessKeys.get(key) || [];
  }

  clear() {
    this._uniquenessKeys.clear();
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

  addChip(constraint, iconElem, router) {
    const chip = this._makeChip(constraint, iconElem, router);
    this._chipViewElement.appendChild(chip);
    return chip;
  }

  static removeChip(chip) {
    // Remove chip if it hasn't already been removed.
    chip.parentNode?.removeChild(chip);
  }

  clear() {
    clearDOMNode(this._chipViewElement);
  }

  isEmpty() {
    return !this._chipViewElement.hasChildNodes();
  }

  _makeChip(constraint, iconElem, router) {
    const chip = document.createElement('div');
    chip.className = 'chip';

    const removeChipButton = document.createElement('button');
    removeChipButton.innerHTML = '&#x00D7;';
    chip.appendChild(removeChipButton);

    const chipLabel = document.createElement('div');
    chipLabel.className = 'chip-label';
    chipLabel.textContent = constraint.chipLabel();

    if (iconElem) {
      const chipIcon = this.constructor._makeChipIcon(iconElem, this._shape);
      if (constraint.constructor.IS_COMPOSITE) {
        chipLabel.appendChild(chipIcon);
      } else {
        chip.append(chipIcon);
      }
    }

    chip.appendChild(chipLabel);

    chip.addEventListener('click', (e) => {
      // If the remove button is clicked then remove the chip.
      if (e.target.closest('button') === removeChipButton) {
        this._chipHighlighter.clear();
        router.removeConstraint(constraint);
        this._onUpdate();
        return;
      }

      // Otherwise if we are looking at the current chip then toggle the
      // selection.
      if (e.target.closest('.chip') !== chip) return;
      this._constraintSelector.toggle(
        constraint, chip, router.getRouterForComposite(constraint));
    });

    chip.addEventListener('mouseover', (e) => {
      if (e.target.closest('.chip') !== chip) return;
      if (this._chipHighlighter.key() === chip) return;
      this._chipHighlighter.setCells(
        constraint.getCells(this._shape), chip);
    });
    chip.addEventListener('mouseleave', () => {
      this._chipHighlighter.clear();
    });

    return chip;
  }

  static addSubChipView(chip) {
    const subViewElem = document.createElement('div');
    subViewElem.className = 'chip-view sub-chip-view';
    chip.appendChild(subViewElem);
    return subViewElem;
  }

  static replaceChipIcon(chip, newIcon, shape) {
    const iconElem = this._makeChipIcon(newIcon, shape);
    const oldElem = chip.querySelector(
      ':scope > .chip-label > .chip-icon',
      ':scope > .chip-icon');
    oldElem.replaceWith(iconElem);
  }

  static _CHIP_ICON_SIZE_PX = 28;

  static _makeChipIcon(elem, shape) {
    const svg = createSvgElement('svg');
    svg.classList.add('chip-icon');

    const borders = createSvgElement('g');
    const borderDisplay = new BorderDisplay(
      borders, 'rgb(255, 255, 255)');
    borderDisplay.reshape(shape);
    svg.append(borders);

    // Determine the correct scale to fit our icon size.
    const gridSizePixels = borderDisplay.gridSizePixels();
    const scale = this._CHIP_ICON_SIZE_PX / gridSizePixels;
    const transform = `scale(${scale})`;

    borders.setAttribute('transform', transform);
    borders.setAttribute('stoke-width', 0);

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
    // Undo the opacity.
    svg.style.filter = 'saturate(100)';

    return svg;
  }
}

class ConstraintHighlighter {
  constructor(displayContainer, display, cssClass) {
    this._highlighter = displayContainer.createCellHighlighter(cssClass);
    this._cssClass = cssClass;
    this._display = display;
    this._currentState = null;
    this._shape = null;
  }

  reshape(shape) {
    this._shape = shape;
  }

  _isInSubChipView(chip) {
    return chip.closest('.sub-chip-view') !== null;
  }

  setConstraint(constraint, chip) {
    this.clear();
    this._currentState = { chip, constraint };
    chip.classList.add(this._cssClass);
    this._highlighter.setCells(constraint.getCells(this._shape));
    if (this._isInSubChipView(chip)) {
      const item = this._display.drawConstraint(constraint);
      item.classList.add(this._cssClass);
      this._currentState.displayed = true;
    }
  }

  refreshConstraint() {
    if (!this._currentState) return;

    const { chip, constraint } = this._currentState;

    // If the chip has been removed, then clear the selection.
    if (!chip.isConnected) {
      this.clear();
      return;
    }

    // Updated the highlighted cells.
    this._highlighter.setCells(constraint.getCells(this._shape));
  }


  clear() {
    if (!this._currentState) return;

    this._currentState.chip.classList.remove(
      this._cssClass);
    this._highlighter.clear();
    if (this._currentState.displayed) {
      this._display.removeConstraint(this._currentState.constraint);
    }
    this._currentState = null;
  }

  currentConstraint() {
    return this._currentState?.constraint;
  }
}

class ConstraintSelector {
  constructor(displayContainer, display, onRouterSelectCallback) {
    this._selectionHighlighter = new ConstraintHighlighter(
      displayContainer, display, 'selected-constraint');
    this._latestHighlighter = new ConstraintHighlighter(
      displayContainer, display, 'latest-constraint');
    this._runOnRouterSelect = onRouterSelectCallback || (() => { });
  }

  reshape(shape) {
    this._selectionHighlighter.reshape(shape);
    this._latestHighlighter.reshape(shape);
  }

  onConstraintsUpdated() {
    // Update the cells in the highlighter, since the current cells for the
    // current selection may have changed (for composite constraints).
    // This is simpler than listening for updates to individual constraints.
    //   - Most of the time, nothing is selected so no updates are required.
    //   - This will only be called once per update action.
    this._selectionHighlighter.refreshConstraint();
    this._latestHighlighter.refreshConstraint();
  }

  updateLatest(constraint, chip) {
    this._latestHighlighter.setConstraint(constraint, chip);
  }

  select(constraint, chip, router) {
    this._selectionHighlighter.setConstraint(constraint, chip);
    this._runOnRouterSelect(router);
    this._latestHighlighter.clear();
  }

  toggle(constraint, chip, router) {
    if (constraint === this._selectionHighlighter.currentConstraint()) {
      this.clear();
    } else {
      this.select(constraint, chip, router);
    }
  }

  clear() {
    this._selectionHighlighter.clear();
    this._runOnRouterSelect(null);
    this._latestHighlighter.clear();
  }
}

class Selection {
  constructor(displayContainer) {
    this._highlight = displayContainer.createCellHighlighter('selected-cells');

    this._clickInterceptor = displayContainer.getClickInterceptor();

    this._selectionPreservers = [this._clickInterceptor.getSvg()];

    this._setUpMouseHandlers(this._clickInterceptor.getSvg());

    this._callbacks = [];
  }

  addCallback(fn) {
    this._callbacks.push(fn);
  }

  _runCallback(finishedSelecting) {
    this._callbacks.forEach(fn => fn(
      [...this._highlight.getCells()], finishedSelecting));
  }

  setCells(cellIds) {
    this._highlight.setCells(cellIds);
    if (cellIds.length > 0) this._maybeAddOutsideClickListener();
    this._runCallback(false);
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
      this._runCallback(false);
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
      this._runCallback(true);
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
  constructor(router, inputManager) {
    super(router);
    this._shape = null;

    inputManager.onNewDigit(this._inputDigit.bind(this));

    this._multiValueInputPanel = new MultiValueInputPanel(
      inputManager,
      this._setValues.bind(this),
      (cell) => this._getCellValues(cell));
  }

  _getCellConstraints(cell) {
    return this.router.getConstraintsByKey(cell).filter(
      c => c.constructor.COLLECTOR_CLASS === this.constructor.name);
  }

  _getCellValues(cell) {
    return this._getCellConstraints(cell).flatMap(c => c.values);
  }

  reshape(shape) {
    this._shape = shape;
    this._multiValueInputPanel.reshape(shape);
  }

  _inputDigit(cell, digit) {
    const values = this._getCellValues(cell);
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
    this._setValues([cell], newValue ? [newValue] : []);
  }

  _setValues(cells, values) {
    for (const cell of cells) {
      if (values.length) {
        this.router.addConstraint(
          new SudokuConstraint.Given(cell, ...values));
      } else {
        for (const c of this._getCellConstraints(cell)) {
          this.router.removeConstraint(c);
        }
      }
    }
  }
}

class MultiValueInputPanel {
  constructor(inputManager, onChange, givenLookup) {
    this._form = document.getElementById('multi-value-cell-input');
    this._collapsibleContainer = new CollapsibleContainer(
      this._form.firstElementChild,
      /* defaultOpen= */ false).allowInComposite();

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
      const values = this._givenLookup(selection[0]);
      this._updateForm(
        values.length ? values : this._allValues);
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
      onSelection: [],
      onOutsideArrowSelection: [],
    };
    // fake-input is an invisible text input which is used to ensure that
    // numbers can be entered on mobile.
    let fakeInput = document.getElementById('fake-input');
    this._fakeInput = fakeInput;

    this._selection = new Selection(displayContainer);
    this._selection.addCallback((cellIds, finishedSelecting) => {
      // Blur the active selection, so that callbacks can tell if something
      // has already set the focus.
      if (finishedSelecting) {
        document.activeElement.blur();
      }
      if (cellIds.length == 1) {
        const [x, y] = this._selection.cellIdCenter(cellIds[0]);
        fakeInput.style.top = y + 'px';
        fakeInput.style.left = x + 'px';
        if (finishedSelecting) {
          fakeInput.select();
        }
      }
      this._runCallbacks(
        this._callbacks.onSelection, cellIds, finishedSelecting);
    });

    this._setUpKeyBindings();
  }

  reshape(shape) { this._shape = shape; }

  onNewDigit(fn) { this._callbacks.onNewDigit.push(fn); }
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
        this._runCallbacks(this._callbacks.onNewDigit, cell, null);
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
            this._callbacks.onNewDigit, this._selection.getCells(), null);
          break;
        case 'f':
          let i = 1;
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onNewDigit, cell, i / 10 | 0);
            this._runCallbacks(this._callbacks.onNewDigit, cell, i % 10);
            i++;
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

  allowInComposite() {
    this._element.classList.add('allow-in-composite');
    return this;
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

    this.toggleOpen(defaultOpen);

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
    return this;
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

  _hasActiveElement() {
    // Calculate this directly from the DOM so we know the visuals are always
    // synced up.
    // We could make this more efficient by caching the elements.
    const checkboxes = this._bodyElement.querySelectorAll(
      'input[type="checkbox"]');
    for (const checkbox of checkboxes) {
      if (checkbox.checked) return true;
    }
    const chipViews = this._bodyElement.querySelectorAll('.chip-view');
    for (const chipView of chipViews) {
      if (chipView.hasChildNodes()) return true;
    }
    return false;
  }

  updateActiveHighlighting() {
    const hasActive = this._hasActiveElement();
    this._element.classList.toggle('constraint-panel-highlight', hasActive);
  }
}

ConstraintCollector.CustomBinary = class CustomBinary extends ConstraintCollector {
  constructor(router, inputManager) {
    super(router);

    this._form = document.getElementById('custom-binary-input');
    this._collapsibleContainer = new CollapsibleContainer(
      this._form.firstElementChild,
      /* defaultOpen= */ false).allowInComposite();
    inputManager.addSelectionPreserver(this._form);

    inputManager.onSelection(
      deferUntilAnimationFrame(this._onSelection.bind(this)));

    this._shape = null;
    this._inputManager = inputManager;

    this._setUp();
  }

  reshape(shape) {
    this._shape = shape;
  }

  _onSelection(selection, finishedSelecting) {
    const form = this._form;
    toggleDisabled(this._collapsibleContainer.element(), selection.length <= 1);
    if (finishedSelecting
      && selection.length > 1
      && this._collapsibleContainer.isOpen()) {
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

      const typeCls = SudokuConstraint[type];

      let key = null;
      try {
        const fn = Function(
          `return ((a,b)=>${fnStr})`)();
        key = typeCls.fnToKey(fn, this._shape.numValues);
      } catch (e) {
        errorElem.textContent = e;
        return false;
      }

      const cells = this._inputManager.getSelection();
      this.router.addConstraint(new typeCls(key, name, ...cells));

      return false;
    };
    form['function'].oninput = () => {
      errorElem.textContent = '';
    };
  }
}

// A info overlay which is lazily loaded.
class InfoOverlay {
  constructor(displayContainer) {
    this._shape = null;

    this._heatmap = displayContainer.createCellHighlighter();
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