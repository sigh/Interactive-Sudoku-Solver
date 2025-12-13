const {
  autoSaveField,
  clearDOMNode,
  deferUntilAnimationFrame,
  sessionAndLocalStorage,
  toggleDisabled,
  createSvgElement,
  arraysAreEqual,
  MultiMap,
  isIterable
} = await import('./util.js' + self.VERSION_PARAM);
const {
  SudokuConstraint,
  SudokuConstraintBase,
  OutsideConstraintBase,
  CompositeConstraintBase
} = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const {
  DisplayContainer,
  BorderDisplay,
  DisplayItem
} = await import('./display.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
const { ConstraintDisplay } = await import('./constraint_display.js' + self.VERSION_PARAM);
const { GridShape } = await import('./grid_shape.js' + self.VERSION_PARAM);
const { SolutionController } = await import('./solution_controller.js' + self.VERSION_PARAM);
const { UserScriptExecutor } = await import('./user_script_executor.js' + self.VERSION_PARAM);

export const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  const displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  const constraintManager = new ConstraintManager(
    inputManager, displayContainer);

  // Load examples.
  const exampleHandler = new ExampleHandler(constraintManager);

  const controller = new SolutionController(constraintManager, displayContainer);

  const hiddenElements = Array.from(
    document.getElementsByClassName('hide-until-load'));
  hiddenElements.forEach(e => e.classList.remove('hide-until-load'));
};

class ConstraintCategoryInput {
  static IS_LAYOUT = false;
  static IS_SHAPE_AGNOSTIC = false;

  constructor(collection) {
    this.collection = collection;
  }

  // listeners for when constraints are added or removed.
  onAddConstraint(constraint) { }
  onRemoveConstraint(constraint) { }

  clear() { }

  reshape(shape) { }

  setUpdateCallback(fn) {
    this._updateCallback = fn || (() => { });
  }

  runUpdateCallback() {
    this._updateCallback();
  }

  // Find all constraint types that are associated with this category.
  static constraintClasses() {
    const name = this.name;
    const classes = [...Object.values(SudokuConstraint)].filter(
      t => t.CATEGORY === name);
    classes.sort((a, b) => a.displayName().localeCompare(b.displayName()));
    return classes;
  }
}

ConstraintCategoryInput.Shape = class Shape extends ConstraintCategoryInput {
  static IS_LAYOUT = true;

  constructor(collection) {
    super(collection);

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
      const shape = GridShape.fromGridSpec(shapeName);
      if (!shape) throw ('Invalid shape: ' + shapeName);
      this.collection.setShape(shape);
    };
    this._select = select;
  }

  reshape(shape) {
    this._select.value = shape.name;
  }
}

ConstraintCategoryInput.Experimental = class Experimental extends ConstraintCategoryInput {
}

ConstraintCategoryInput.Composite = class Composite extends ConstraintCategoryInput {
  constructor(collection, addUpdateListener) {
    super(collection);
    const form = document.forms['composite-constraint-input'];
    const container = new CollapsibleContainer(
      form.firstElementChild,
      /* defaultOpen= */ false).allowInComposite();
    addUpdateListener(() => container.updateActiveHighlighting());

    this._setUpForm(form, collection);
  }

  _setUpForm(form, collection) {
    form['add-or'].onclick = () => {
      collection.addConstraint(new SudokuConstraint.Or([]));
      return false;
    };
    document.getElementById('add-and-button')
    form['add-and'].onclick = () => {
      collection.addConstraint(new SudokuConstraint.And([]));
      return false;
    };
  }
}

ConstraintCategoryInput._Checkbox = class _Checkbox extends ConstraintCategoryInput {
  static IS_SHAPE_AGNOSTIC = true;

  constructor(collection, containerId) {
    super(collection);

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
          this.collection.addConstraint(constraint);
        } else {
          // We need to remove the exact constraint objects (not necessarily
          // the constraint we store ourselves).
          for (const uniquenessKey of constraint.uniquenessKeys()) {
            for (const c of this.collection.getConstraintsByKey(uniquenessKey)) {
              if (c.type === constraint.type) {
                this.collection.removeConstraint(c);
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

ConstraintCategoryInput.GlobalCheckbox = class GlobalCheckbox extends ConstraintCategoryInput._Checkbox {
  constructor(collection, addUpdateListener) {
    const element = document.getElementById('global-constraints-container');
    const container = new CollapsibleContainer(
      element, /* defaultOpen= */ true);
    addUpdateListener(() => container.updateActiveHighlighting());

    super(collection, container.bodyElement().id);
  }
}

ConstraintCategoryInput.LayoutCheckbox = class LayoutCheckbox extends ConstraintCategoryInput._Checkbox {
  static IS_LAYOUT = true;

  constructor(collection) {
    super(collection, 'layout-constraint-checkboxes');
  }
}

ConstraintCategoryInput.LinesAndSets = class LinesAndSets extends ConstraintCategoryInput {
  static DEFAULT_TYPE = 'Cage';

  constructor(collection, inputManager) {
    super(collection);
    this._shape = null;

    this._constraintClasses = this.constructor.constraintClasses();
    this._typeMap = new Map();
    this._validationFns = new MultiMap();

    const selectionForm = document.forms['multi-cell-constraint-input'];
    this._selectionForm = selectionForm;
    this._setUp(selectionForm, this._constraintClasses, inputManager);

    this._collapsibleContainer = new CollapsibleContainer(
      selectionForm.firstElementChild,
      /* defaultOpen= */ true).allowInComposite();

    inputManager.onSelection(
      (selection) => this._onNewSelection(selection, selectionForm));
    inputManager.addSelectionPreserver(selectionForm);
    inputManager.registerFocusPanel(
      selectionForm, () => this._getFocusTarget());

    selectionForm.onsubmit = e => {
      this._handleSelection(selectionForm, inputManager);
      return false;
    };
  }

  _getFocusTarget() {
    // Focus on the form so we can immediately press enter.
    //   - If the value input is enabled then focus on it to make it easy to
    //     input a value.
    //   - Otherwise just focus on the submit button.
    const form = this._selectionForm;
    if (form['add-constraint'].disabled) return null;

    const type = form['constraint-type'].value;
    const typeData = this._typeMap.get(type);
    if (typeData?.valueElem && !typeData.valueElem.disabled) {
      return typeData.valueElem;
    }
    return form['add-constraint'];
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
        this.collection.addConstraint(constraint);
      }
    } else if (
      constraintClass === SudokuConstraint.ContainExact ||
      constraintClass === SudokuConstraint.ContainAtLeast) {
      const valuesStr = formData.get(type + '-value');
      const values = valuesStr.split(/[, ]+/).map(v => +v).filter(
        v => Number.isInteger(v) && v >= 1 && v <= this._shape.numValues);
      if (values.length) {
        const constraint = new constraintClass(values.join('_'), ...cells);
        this.collection.addConstraint(constraint);
      }
    } else if (constraintClass.ARGUMENT_CONFIG) {
      const value = formData.get(type + '-value');
      this.collection.addConstraint(
        new constraintClass(value, ...cells));
    } else {
      this.collection.addConstraint(
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
        } else if (argConfig.long) {
          input = document.createElement('textarea');
          input.setAttribute('rows', '3');
          input.setAttribute('cols', '10');
          input.setAttribute('size', '8');
          input.setAttribute('placeholder', argConfig.label);
          // Allow submitting the form with enter, so it behaves like all
          // other inputs.
          // Shift-enter adds a new line.
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              selectionForm.requestSubmit();
            }
          });
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
      this._validationFns.add(
        constraintClass.VALIDATE_CELLS_FN, option);
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

  _onNewSelection(selection, selectionForm) {
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
      return;
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
    const exampleSelect = document.querySelector('#example-select-container select');
    exampleSelect.onchange = () => { };  // Ignore changes until initialized.
    this._populateExampleSelect(exampleSelect);
    return exampleSelect;
  }

  async _populateExampleSelect(exampleSelect) {
    const { DISPLAYED_EXAMPLES, PUZZLE_INDEX } = await import('../data/example_puzzles.js' + self.VERSION_PARAM);

    for (const example of DISPLAYED_EXAMPLES) {
      const option = document.createElement('option');
      option.textContent = example.name;
      exampleSelect.appendChild(option);
    }

    const link = exampleSelect.nextElementSibling;
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
    exampleSelect.disabled = false;
    exampleSelect.onchange();
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

ConstraintCategoryInput.Jigsaw = class Jigsaw extends ConstraintCategoryInput {
  static IS_LAYOUT = true;

  constructor(collection, inputManager, chipView) {
    super(collection);
    this._shape = null;
    this._chipView = chipView;
    this._button = document.getElementById('add-jigsaw-button');

    this._setUpButton(inputManager);
  }

  _setUpButton(inputManager) {
    const button = this._button;
    button.onclick = () => {
      const cells = inputManager.getSelection();
      this.collection.addConstraint(
        new SudokuConstraint.Jigsaw(...cells));
      this.runUpdateCallback();
    };

    button.disabled = true;
    inputManager.onSelection((selection) => {
      const isValid = this._cellsAreValidJigsawPiece(selection);
      button.disabled = !isValid;
    });

    // Register for focus restoration.
    inputManager.registerFocusPanel(
      button.closest('fieldset') || button.parentElement,
      () => !button.disabled ? button : null);
  }

  reshape(shape) {
    this._shape = shape;
    this.clear();
  }

  _cellsAreValidJigsawPiece(cells) {
    const shape = this._shape;
    if (cells.length != shape.gridSize) return false;

    // Check that we don't conflict with any existing constraints.
    for (const cell of cells) {
      if (this.collection.getConstraintsByKey(cell).some(
        c => c.constructor.CATEGORY === this.constructor.name)) {
        return false;
      }
    }

    return true;
  }
}

ConstraintCategoryInput.OutsideClue = class OutsideClue extends ConstraintCategoryInput {
  constructor(collection, inputManager) {
    super(collection);
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
      const constraints = this.collection.getConstraintsByKey(arrowId).filter(
        c => c.type === type);
      for (const constraint of constraints) {
        this.collection.removeConstraint(constraint);
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

      this.collection.addConstraint(new constraintClass(arrowId, value));

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
    const constraintsForArrow = this.collection.getConstraintsByKey(arrowId).filter(
      c => c.constructor.CATEGORY === this.constructor.name);

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

class ConstraintCollectionBase {
  addConstraint(constraint) { throw Error('Not implemented'); }
  removeConstraint(constraint) { throw Error('Not implemented'); }
  updateConstraint(constraint) { throw Error('Not implemented'); }

  getConstraintsByKey(key) { return []; }

  setShape(shape) { throw Error('Not implemented'); }

  getCollectionForComposite(constraint) {
    throw Error('Not implemented');
  }
}


// Allows `addConstraint` calls to be redirected to a different collection.
class SelectedConstraintCollection extends ConstraintCollectionBase {
  constructor(rootCollection) {
    super();
    this._rootCollection = rootCollection;
    this._currentCollection = rootCollection;
  }

  setCollection(collection) {
    this._currentCollection = collection || this._rootCollection;
  }

  isSelected() {
    return this._currentCollection !== this._rootCollection;
  }

  addConstraint(constraint) {
    if (this.isSelected() && CompositeConstraintBase.allowedConstraintClass(constraint.constructor)) {
      this._currentCollection.addConstraint(constraint);
    } else {
      this._rootCollection.addConstraint(constraint);
    }
  }

  removeConstraint(constraint) {
    this._rootCollection.removeConstraint(constraint);
  }

  setShape(shape) {
    this._rootCollection.setShape(shape);
  }

  getConstraintsByKey(key) {
    return this._rootCollection.getConstraintsByKey(key);
  }
}

class RootConstraintCollection extends ConstraintCollectionBase {
  constructor(display, chipViews, constraintCategoryInputs, collectionFactor, reshapeListener, updateListener) {
    super();
    this._uniquenessKeySet = new UniquenessKeySet();
    this._constraintMap = new Map();
    this._display = display;
    this._chipViews = chipViews;
    this._reshapeListener = reshapeListener;
    this._updateListener = updateListener;
    this._constraintCategoryInputs = constraintCategoryInputs;
    this._collectionFactory = collectionFactor;
  }

  clear() {
    this._uniquenessKeySet.clear();
    this._constraintMap.clear();
  }

  constraints() {
    return this._constraintMap.keys();
  }

  addConstraint(constraint) {
    if (this._constraintMap.has(constraint)) return;
    if (constraint.constructor === SudokuConstraint.Shape) return;

    const constraintState = {};

    const matches = this._uniquenessKeySet.matchConstraint(constraint);
    for (const match of matches) {
      this.removeConstraint(match);
    }

    if (constraint.constructor.DISPLAY_CONFIG) {
      constraintState.displayElem = this._display.drawConstraint(constraint);
    }
    const chipView = this._chipViewForConstraint(constraint);
    if (chipView) {
      constraintState.chip = chipView.addChip(
        constraint,
        constraintState.displayElem?.cloneNode(true),
        this);
      if (constraint.constructor.IS_COMPOSITE) {
        constraintState.collection = this._collectionFactory(
          constraint, constraintState.chip, this);
      }
    }
    this._constraintMap.set(constraint, constraintState);
    this._uniquenessKeySet.addConstraint(constraint);

    this._constraintCategoryInputs.get(
      constraint.constructor.CATEGORY).onAddConstraint(
        constraint);
    this._updateListener();
  }

  removeConstraint(constraint) {
    if (!this._constraintMap.has(constraint)) return;
    const constraintState = this._constraintMap.get(constraint);
    if (constraintState.chip) {
      ConstraintChipView.removeChip(constraintState.chip);
    }
    if (constraintState.displayElem) {
      this._display.removeConstraint(
        constraint, constraintState.displayElem);
    }
    this._constraintMap.delete(constraint);
    this._uniquenessKeySet.removeConstraint(constraint);
    this._constraintCategoryInputs.get(
      constraint.constructor.CATEGORY).onRemoveConstraint(
        constraint);
    this._updateListener();
  }

  updateConstraint(constraint) {
    const constraintState = this._constraintMap.get(constraint);
    if (!constraintState) return;

    if (constraintState.displayElem) {
      this._display.removeConstraint(
        constraint, constraintState.displayElem);
      constraintState.displayElem = this._display.drawConstraint(constraint);
    }
    const chip = constraintState.chip;
    if (chip) {
      this._chipViewForConstraint(constraint).replaceChipIcon(
        chip,
        constraintState.displayElem?.cloneNode(true));
    }
    this._updateListener();
  }

  setShape(shape) {
    this._reshapeListener(shape);
  }

  getCollectionForComposite(c) {
    return this._constraintMap.get(c)?.collection;
  }

  getConstraintsByKey(key) {
    return this._uniquenessKeySet.getKey(key);
  }

  _chipViewForConstraint(constraint) {
    switch (constraint.constructor.CATEGORY) {
      case 'LinesAndSets':
      case 'Pairwise':
      case 'Experimental':
      case 'StateMachine':
        return this._chipViews.get('ordinary');
      case 'Jigsaw':
        return this._chipViews.get('jigsaw');
      case 'Composite':
        return this._chipViews.get('composite');
    }

    return null;
  }
}

class CompositeConstraintCollection extends ConstraintCollectionBase {
  constructor(parentConstraint, parentCollection, chipView, display, constraintSelector, collectionFactory) {
    super();
    this._display = display;
    this._constraintSelector = constraintSelector;
    this._constraintMap = new Map();
    this._collectionFactory = collectionFactory;
    this._parentCollection = parentCollection;
    this._chipView = chipView;

    this._parentConstraint = parentConstraint;
    for (const child of parentConstraint.constraints) {
      this._addWithoutUpdate(child);
    }
  }

  _addWithoutUpdate(c) {
    const chip = this._chipView.addChip(
      c, this._display.makeConstraintIcon(c), this);
    const constraintState = { chip };
    this._constraintMap.set(c, constraintState);
    if (c.constructor.IS_COMPOSITE) {
      constraintState.collection = this._collectionFactory(
        c, chip, this);
    }
    return constraintState;
  }

  addConstraint(c) {
    this._parentConstraint.addChild(c);
    const constraintState = this._addWithoutUpdate(c);
    this._parentCollection.updateConstraint(this._parentConstraint);
    this._constraintSelector.updateLatest(
      c, constraintState.chip);
  }

  removeConstraint(c) {
    this._parentConstraint.removeChild(c);
    const constraintState = this._constraintMap.get(c);
    if (constraintState?.chip) {
      ConstraintChipView.removeChip(constraintState.chip);
    }
    this._constraintMap.delete(c);
    this._parentCollection.updateConstraint(this._parentConstraint);
  }

  updateConstraint(c) {
    const constraintState = this._constraintMap.get(c);
    if (!constraintState) return;

    const chip = constraintState.chip;
    this._chipView.replaceChipIcon(
      chip,
      this._display.makeConstraintIcon(c));
    this._parentCollection.updateConstraint(this._parentConstraint);
  }

  getCollectionForComposite(c) {
    return this._constraintMap.get(c)?.collection;
  }
}

class ConstraintManager {
  constructor(inputManager, displayContainer) {
    this._shape = SudokuConstraint.Shape.DEFAULT_SHAPE;
    this._reshapeListeners = [];
    this._updateListeners = [];
    this.runUpdateCallback = deferUntilAnimationFrame(
      this.runUpdateCallback.bind(this));

    this.addReshapeListener(displayContainer);
    this.addReshapeListener(inputManager);

    this._display = this.addReshapeListener(new ConstraintDisplay(
      inputManager, displayContainer));
    this._constraintCategoryInputs = new Map();
    this._userScriptExecutor = new UserScriptExecutor();
    this._setUp(inputManager, displayContainer);

    this.runUpdateCallback();
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
      c => this._rootCollection.addConstraint(c));

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

  _setUp(inputManager, displayContainer) {
    let selectedConstraintCollection = null;
    const constraintPanel = document.getElementById(
      'constraint-panel-container');
    this._constraintSelector = this.addReshapeListener(
      new ConstraintSelector(
        displayContainer, this._display,
        (collection) => {
          selectedConstraintCollection.setCollection(collection);
          constraintPanel.classList.toggle(
            'composite-constraint-selected', !!collection);
        }));
    this.addUpdateListener(
      () => this._constraintSelector.onConstraintsUpdated());

    const chipViews = new Map();
    this._chipHighlighter = displayContainer.createCellHighlighter('chip-hover');
    for (const type of ['ordinary', 'composite', 'jigsaw']) {
      const chipView = this.addReshapeListener(
        new ConstraintChipView(
          document.querySelector(`.chip-view[data-chip-view-type="${type}"]`),
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

    this._rootCollection = new RootConstraintCollection(
      this._display,
      chipViews,
      this._constraintCategoryInputs,
      this._makeCompositeCollection.bind(this),
      this._reshape.bind(this),
      this.runUpdateCallback.bind(this));

    selectedConstraintCollection = new SelectedConstraintCollection(this._rootCollection);

    const categoryInputs = [
      new ConstraintCategoryInput.Shape(selectedConstraintCollection),
      new ConstraintCategoryInput.GlobalCheckbox(
        selectedConstraintCollection, this.addUpdateListener.bind(this)),
      new ConstraintCategoryInput.LayoutCheckbox(selectedConstraintCollection),
      new ConstraintCategoryInput.Jigsaw(
        selectedConstraintCollection, inputManager, chipViews.get('jigsaw')),
      new ConstraintCategoryInput.LinesAndSets(
        selectedConstraintCollection, inputManager),
      new ConstraintCategoryInput.Pairwise(
        selectedConstraintCollection, inputManager, this._userScriptExecutor),
      new ConstraintCategoryInput.StateMachine(
        selectedConstraintCollection, inputManager, this._userScriptExecutor),
      new ConstraintCategoryInput.OutsideClue(
        selectedConstraintCollection, inputManager),
      new ConstraintCategoryInput.GivenCandidates(
        selectedConstraintCollection, inputManager),
      new ConstraintCategoryInput.Experimental(selectedConstraintCollection),
      new ConstraintCategoryInput.Composite(
        selectedConstraintCollection, this.addUpdateListener.bind(this)),
    ];

    for (const categoryInput of categoryInputs) {
      this._constraintCategoryInputs.set(
        categoryInput.constructor.name, categoryInput);
      this.addReshapeListener(categoryInput);
      categoryInput.setUpdateCallback(this.runUpdateCallback.bind(this));
    }

    this._setUpCustomConstraintTabs();
    this._setUpFreeFormInput();

    // Clear button.
    document.getElementById('clear-constraints-button').onclick = () => this.clear();

    // Copy to clipboard.
    document.getElementById('copy-constraints-button').onclick = () => {
      navigator.clipboard.writeText(this.getConstraints());
    };

    // Dim constraints toggle.
    this._setUpDimConstraints();
  }

  _makeCompositeCollection(constraint, chip, parentCollection) {
    const subView = this._makeCompositeConstraintView(chip);
    const collection = new CompositeConstraintCollection(
      constraint,
      parentCollection,
      subView,
      this._display,
      this._constraintSelector,
      this._makeCompositeCollection.bind(this));
    // If we create an empty composite collection, then select it.
    // This makes it easier to immediately add constraints to it.
    if (constraint.constraints.length == 0) {
      this._constraintSelector.select(
        constraint, chip, collection);
    }
    return collection;
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

  _setUpFreeFormInput() {
    // Free-form.
    const form = document.forms['freeform-constraint-input'];
    const errorElem = document.getElementById('error-panel').appendChild(
      document.createElement('div'));
    const inputElem = form['freeform-input'];

    // Allow loading free-form input from other locations.
    this.loadUnsafeFromText = (input) => {
      try {
        this._loadFromText(input);
        clearDOMNode(errorElem);
      } catch (e) {
        errorElem.textContent = e;
        // If we were called from outside the form, then put the value in the
        // so that the user can see the constraint which failed.
        if (inputElem.value != input) inputElem.value = input;
      }
    };

    form.onsubmit = e => {
      e.preventDefault();
      clearDOMNode(errorElem);
      const input = inputElem.value;
      this.loadUnsafeFromText(input);
      return false;
    };
    autoSaveField(form, 'freeform-input');
  }

  _loadFromText(input) {
    const constraint = SudokuParser.parseText(input);

    this.clear();

    this._rootCollection.setShape(constraint.getShape());
    constraint.forEachTopLevel(c => this._rootCollection.addConstraint(c));

    this.runUpdateCallback();

    return constraint;
  }

  _getConstraints(filterFn) {
    const constraints = [new SudokuConstraint.Shape(this._shape.name)];
    for (const constraint of this._rootCollection.constraints()) {
      if (filterFn(constraint)) {
        constraints.push(constraint);
      }
    }
    return new SudokuConstraint.Set(constraints);
  }

  _getShapeAgnosticConstraints() {
    return this._getConstraints(
      c => ConstraintCategoryInput[c.constructor.CATEGORY].IS_SHAPE_AGNOSTIC);
  }

  getLayoutConstraints() {
    return this._getConstraints(
      c => ConstraintCategoryInput[c.constructor.CATEGORY].IS_LAYOUT);
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
    for (const categoryInput of this._constraintCategoryInputs.values()) {
      categoryInput.clear();
    }
    this._rootCollection.clear();
    this.runUpdateCallback();
  }

  _setUpDimConstraints() {
    const dimConstraintsInput = document.getElementById('dim-constraints-input');
    const sudokuGrid = document.getElementById('sudoku-grid');

    autoSaveField(dimConstraintsInput);

    // Apply initial state
    if (dimConstraintsInput.checked) {
      sudokuGrid.classList.add('constraints-dimmed');
    }

    // Handle toggle
    dimConstraintsInput.onchange = () => {
      sudokuGrid.classList.toggle('constraints-dimmed', dimConstraintsInput.checked);
    };
  }

  _setUpCustomConstraintTabs() {
    const panel = document.getElementById('custom-constraint-panel');

    // Set up collapsible behavior.
    new CollapsibleContainer(panel, /* defaultOpen= */ false).allowInComposite();

    const tabButtons = panel.querySelectorAll('.tab-container button');
    const tabContents = panel.querySelectorAll('.tab-content');

    for (const button of tabButtons) {
      button.onclick = () => {
        const tabId = button.dataset.tab;
        for (const btn of tabButtons) btn.classList.toggle('active', btn === button);
        for (const content of tabContents) content.classList.toggle('active', content.id === tabId);
        sessionAndLocalStorage.setItem('custom-constraint-tab', tabId);
      };
    }

    // Restore saved tab.
    const savedTab = sessionAndLocalStorage.getItem('custom-constraint-tab');
    if (savedTab) {
      const savedButton = panel.querySelector(`.tab-container button[data-tab="${savedTab}"]`);
      if (savedButton) savedButton.click();
    }
  }
}

class UniquenessKeySet {
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

  addChip(constraint, iconElem, collection) {
    const chip = this._makeChip(constraint, iconElem, collection);
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

  _makeChip(constraint, iconElem, collection) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (constraint.constructor.IS_COMPOSITE) {
      chip.classList.add('composite-chip');
    }

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
        collection.removeConstraint(constraint);
        this._onUpdate();
        return;
      }

      // Otherwise if we are looking at the current chip then toggle the
      // selection.
      if (e.target.closest('.chip') !== chip) return;
      this._constraintSelector.toggle(
        constraint, chip, collection.getCollectionForComposite(constraint));
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

  replaceChipIcon(chip, newIcon) {
    const iconElem = this.constructor._makeChipIcon(newIcon, this._shape);
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
      this._currentState.displayElem = this._drawConstraint(constraint);
    }
  }

  _drawConstraint(constraint) {
    const item = this._display.drawConstraint(constraint);
    item.classList.add(this._cssClass);
    return item;
  }

  refreshConstraint() {
    if (!this._currentState) return false;

    const { chip, constraint } = this._currentState;

    // If the chip has been removed, then clear the selection.
    if (!chip.isConnected) {
      this.clear();
      return false;
    }

    // Check if the constraint cells have changed at all.
    const cells = constraint.getCells(this._shape);
    if (arraysAreEqual(cells, this._highlighter.getCells())) {
      return true;
    }

    // Updated the highlighted cells.
    this._highlighter.setCells(cells);
    // Update the displayed constraint (if required).
    if (this._currentState.displayElem) {
      this._display.removeConstraint(
        constraint, this._currentState.displayElem);
      this._currentState.displayElem = this._drawConstraint(constraint);
    }

    return true;
  }


  clear() {
    if (!this._currentState) return;

    this._currentState.chip.classList.remove(
      this._cssClass);
    this._highlighter.clear();
    if (this._currentState.displayElem) {
      this._display.removeConstraint(
        this._currentState.constraint,
        this._currentState.displayElem);
    }
    this._currentState = null;
  }

  currentConstraint() {
    return this._currentState?.constraint;
  }
}

class ConstraintSelector {
  constructor(displayContainer, display, onCollectionSelectCallback) {
    this._selectionHighlighter = new ConstraintHighlighter(
      displayContainer, display, 'selected-constraint');
    this._latestHighlighter = new ConstraintHighlighter(
      displayContainer, display, 'latest-constraint');
    this._runOnCollectionSelect = onCollectionSelectCallback || (() => { });

    this._escapeListener = null;
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
    if (!this._selectionHighlighter.refreshConstraint()) {
      this.clear();
    } else {
      this._latestHighlighter.refreshConstraint();
    }
  }

  updateLatest(constraint, chip) {
    if (constraint !== this._selectionHighlighter.currentConstraint()) {
      this._latestHighlighter.setConstraint(constraint, chip);
    }
  }

  select(constraint, chip, collection) {
    this._selectionHighlighter.setConstraint(constraint, chip);
    this._runOnCollectionSelect(collection);
    this._latestHighlighter.clear();

    if (!this._escapeListener) {
      this._escapeListener = window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.clear();
      });
    }
  }

  toggle(constraint, chip, collection) {
    if (constraint === this._selectionHighlighter.currentConstraint()) {
      this.clear();
    } else {
      this.select(constraint, chip, collection);
    }
  }

  clear() {
    this._selectionHighlighter.clear();
    this._runOnCollectionSelect(null);
    this._latestHighlighter.clear();
    if (this._escapeListener) {
      window.removeEventListener('keydown', this._escapeListener);
      this._escapeListener = null;
    }
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

ConstraintCategoryInput.GivenCandidates = class GivenCandidates extends ConstraintCategoryInput {
  constructor(collection, inputManager) {
    super(collection);
    this._shape = null;

    inputManager.onNewDigit(this._inputDigit.bind(this));

    this._multiValueInputPanel = new MultiValueInputPanel(
      inputManager,
      this._setValues.bind(this),
      (cell) => this._getCellValues(cell));
  }

  _getCellConstraints(cell) {
    return this.collection.getConstraintsByKey(cell).filter(
      c => c.constructor.CATEGORY === this.constructor.name);
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
    const numValues = this._shape.numValues;

    let newValue;
    if (digit === null || digit > numValues) {
      newValue = 0;
    } else {
      newValue = currValue * 10 + digit;
      if (newValue > numValues) newValue = digit;
    }

    this._multiValueInputPanel.updateFromCells([cell]);
    this._setValues([cell], newValue ? [newValue] : []);
  }

  _setValues(cells, values) {
    for (const cell of cells) {
      if (values.length) {
        this.collection.addConstraint(
          new SudokuConstraint.Given(cell, ...values));
      } else {
        for (const c of this._getCellConstraints(cell)) {
          this.collection.removeConstraint(c);
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
      const elem = this._valueButtons[value - 1]
      // Check elem in case the value is out of range.
      if (elem) elem.checked = true;
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

    this._setUpPanelFocusTracking();

    this._selection = new Selection(displayContainer);
    this._selection.addCallback((cellIds, finishedSelecting) => {
      if (cellIds.length == 1) {
        const [x, y] = this._selection.cellIdCenter(cellIds[0]);
        fakeInput.style.top = y + 'px';
        fakeInput.style.left = x + 'px';
      }
      // Run callbacks first so panels can update their state.
      this._runCallbacks(
        this._callbacks.onSelection, cellIds, finishedSelecting);
      // Then restore focus based on the updated state.
      if (finishedSelecting) {
        if (cellIds.length == 1) {
          fakeInput.select();
        } else {
          // For multi-cell selections, restore focus to the last active panel.
          this._restorePanelFocus();
        }
      }
    });

    this._setUpKeyBindings();
  }

  // Track which panel the user last interacted with, so we can restore focus
  // after grid selection. Panels register with a container and a function that
  // returns the element to focus (or null if focus shouldn't be restored).
  _setUpPanelFocusTracking() {
    this._getSelectionFocusTarget = null;

    // Clear on any click within the constraint panel (capture phase).
    // Panel-specific handlers then set it if the click is within them.
    const constraintPanel = document.getElementById('constraint-panel-container');
    constraintPanel.addEventListener('click', () => {
      this._getSelectionFocusTarget = null;
    }, /* useCapture= */ true);
  }

  _restorePanelFocus() {
    const target = this._getSelectionFocusTarget && this._getSelectionFocusTarget();
    if (target) target.select ? target.select() : target.focus();
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
  registerFocusPanel(container, getFocusTarget) {
    container.addEventListener('click', () => {
      this._getSelectionFocusTarget = getFocusTarget;
    });
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

// Base class for JavaScript constraint inputs that share the tabbed panel.
ConstraintCategoryInput.JavaScriptConstraint = class JavaScriptConstraint extends ConstraintCategoryInput {
  constructor(collection, inputManager, tabContentId, addButtonName) {
    super(collection);

    this._form = document.getElementById('custom-constraint-input');
    this._panel = document.getElementById('custom-constraint-panel');
    this._tabContent = document.getElementById(tabContentId);
    this._addButtonName = addButtonName;
    this._onSelection([]);  // Set up in disabled state.
    inputManager.addSelectionPreserver(this._form);

    inputManager.onSelection(
      deferUntilAnimationFrame(this._onSelection.bind(this)));

    // Register for focus restoration. Only return a focus target if this
    // specific tab is active and the panel is open.
    inputManager.registerFocusPanel(
      this._tabContent,
      () => this._getFocusTarget());

    this._shape = null;
    this._inputManager = inputManager;
  }

  reshape(shape) {
    this._shape = shape;
  }

  async _runWithSpinner(task) {
    const btn = this._form[this._addButtonName];
    const spinner = btn.querySelector('.spinner');

    btn.disabled = true;
    if (spinner) spinner.classList.add('active');

    try {
      await task();
    } finally {
      if (spinner) spinner.classList.remove('active');
      this._onSelection(this._inputManager.getSelection());
    }
  }

  _getFocusTarget() {
    const isPanelOpen = this._panel.classList.contains('container-open');
    const isActiveTab = this._tabContent.classList.contains('active');
    const isEnabled = !this._form[this._addButtonName].disabled;

    if (isPanelOpen && isActiveTab && isEnabled) {
      return this._form[this._addButtonName];
    }
    return null;
  }

  _onSelection(selection) {
    const hasEnoughCells = selection.length > 1;
    this._tabContent.classList.toggle('disabled', !hasEnoughCells);
    this._form[this._addButtonName].disabled = !hasEnoughCells;

    // Also toggle disabled styling on the panel (but not the fieldset itself
    // so that tab switching and toggles still work).
    this._form.firstElementChild.classList.toggle('disabled', !hasEnoughCells);
  }
}

ConstraintCategoryInput.Pairwise = class Pairwise extends ConstraintCategoryInput.JavaScriptConstraint {
  constructor(collection, inputManager, userScriptExecutor) {
    super(collection, inputManager, 'custom-binary-tab', 'add-binary-constraint');
    this._userScriptExecutor = userScriptExecutor;
    this._setUp();
  }

  _setUp() {
    const form = this._form;
    const errorElem = document.getElementById(
      'custom-binary-input-error');

    autoSaveField(form, 'binary-name');
    autoSaveField(form, 'chain-mode');
    autoSaveField(form, 'function');

    form['add-binary-constraint'].onclick = async e => {
      return this._runWithSpinner(async () => {
        const formData = new FormData(form);
        const name = formData.get('binary-name');
        const type = formData.get('chain-mode');
        const fnStr = formData.get('function');

        const typeCls = SudokuConstraint[type];

        let key = null;
        try {
          key = await this._userScriptExecutor.compilePairwise(
            type, fnStr, this._shape.numValues);
        } catch (e) {
          errorElem.textContent = e;
          return false;
        }

        const cells = this._inputManager.getSelection();
        this.collection.addConstraint(new typeCls(key, name, ...cells));
        this._inputManager.setSelection([]);

        return false;
      });
    };
    form['function'].oninput = () => {
      errorElem.textContent = '';
    };
  }
}

ConstraintCategoryInput.StateMachine = class StateMachine extends ConstraintCategoryInput.JavaScriptConstraint {
  constructor(collection, inputManager, userScriptExecutor) {
    super(collection, inputManager, 'state-machine-tab', 'add-state-machine-constraint');
    this._userScriptExecutor = userScriptExecutor;

    this._codeFieldNames = [
      'start-state', 'transition-body', 'accept-body', 'unified-code'];

    this._splitContainer = document.getElementById('state-machine-split-input');
    this._unifiedContainer = document.getElementById('state-machine-unified-input');

    this._setUp();
  }

  _isUnifiedMode() {
    return this._form['unified-mode'].checked;
  }

  // Convert split field values to unified code.
  _splitToUnified(startExpression, transitionBody, acceptBody) {
    const indent = (s) => s.replace(/^/gm, '  ');
    return `
      startState = ${startExpression};

      function transition(state, value) {
      ${indent(transitionBody)}
      }

      function accept(state) {
      ${indent(acceptBody)}
      }
    `.trim().replace(/^ {6}/gm, '');
  }

  _setUp() {
    const form = this._form;
    const errorElem = document.getElementById(
      'state-machine-input-error');

    autoSaveField(form, 'state-machine-name');
    autoSaveField(form, 'unified-mode');
    for (const fieldName of this._codeFieldNames) {
      autoSaveField(form, fieldName);
    }

    const unifiedModeInput = form['unified-mode'];

    const updateModeDisplay = () => {
      const isUnified = this._isUnifiedMode();
      this._splitContainer.style.display = isUnified ? 'none' : '';
      this._unifiedContainer.style.display = isUnified ? '' : 'none';
    };
    updateModeDisplay();

    // Handle mode toggle.
    unifiedModeInput.addEventListener('change', async () => {
      const isUnified = this._isUnifiedMode();
      updateModeDisplay();

      // Sync content when switching modes.
      try {
        if (isUnified) {
          // Split → Unified: just template the text directly.
          form['unified-code'].value = this._splitToUnified(
            form['start-state'].value,
            form['transition-body'].value,
            form['accept-body'].value);
        } else {
          // Unified → Split: parse then extract.
          const { startExpression, transitionBody, acceptBody } =
            await this._userScriptExecutor.convertUnifiedToSplit(
              form['unified-code'].value);
          form['start-state'].value = startExpression;
          form['transition-body'].value = transitionBody;
          form['accept-body'].value = acceptBody;
        }
      } catch (e) {
        // If parsing fails, keep existing values.
      }
      errorElem.textContent = '';
    });

    form['add-state-machine-constraint'].onclick = async _ => {
      return this._runWithSpinner(async () => {
        const formData = new FormData(form);
        const name = formData.get('state-machine-name');

        try {
          const isUnified = this._isUnifiedMode();
          const spec = isUnified
            ? formData.get('unified-code')
            : {
              startExpression: formData.get('start-state'),
              transitionBody: formData.get('transition-body'),
              acceptBody: formData.get('accept-body')
            };

          const shape = this._shape || SudokuConstraint.Shape.DEFAULT_SHAPE;
          const encodedNFA = await this._userScriptExecutor.compileStateMachine(
            spec, shape.numValues, isUnified);

          const cells = this._inputManager.getSelection();
          this.collection.addConstraint(new SudokuConstraint.NFA(
            encodedNFA, name, ...cells));
          this._inputManager.setSelection([]);
        } catch (err) {
          errorElem.textContent = err.message || err;
        }

        return false;
      });
    };

    // Clear error on input for all fields.
    for (const fieldName of this._codeFieldNames) {
      form[fieldName].addEventListener(
        'input', () => errorElem.textContent = '');
    }
  }
}