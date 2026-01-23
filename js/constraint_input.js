const {
  autoSaveField,
  clearDOMNode,
  deferUntilAnimationFrame,
  sessionAndLocalStorage,
  toggleDisabled,
  MultiMap,
  isIterable
} = await import('./util.js' + self.VERSION_PARAM);
const {
  SudokuConstraint,
  SudokuConstraintBase,
  OutsideConstraintBase,
  binaryKeyToFnString,
  encodedNFAToJsSpec
} = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const { GridShape } = await import('./grid_shape.js' + self.VERSION_PARAM);

export class CollapsibleContainer {
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

export class ConstraintCategoryInput {
  static IS_LAYOUT = false;

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
    const input = document.getElementById('shape-input');
    const dropdown = document.getElementById('shape-dropdown');
    const items = dropdown.querySelectorAll('.shape-dropdown-item');
    let highlightedIndex = -1;

    const setHighlight = (index) => {
      items.forEach((item, i) => item.classList.toggle('highlighted', i === index));
      highlightedIndex = index;
    };

    const showDropdown = () => dropdown.classList.add('dropdown-open');
    const hideDropdown = () => {
      dropdown.classList.remove('dropdown-open');
      setHighlight(-1);
    };

    const applyShape = () => {
      const shapeName = input.value.trim();
      if (!shapeName) return;
      try {
        const shape = GridShape.fromGridSpec(shapeName);
        if (shape) {
          input.setCustomValidity('');
          this.collection.setShape(shape);
        }
      } catch (e) {
        input.setCustomValidity(e.toString());
      }
      hideDropdown();
    };

    // Click and hover handlers for dropdown items
    items.forEach((item, i) => {
      item.onmousedown = (e) => {
        e.preventDefault();
        input.value = item.textContent;
        applyShape();
      };
      item.onmouseenter = () => setHighlight(i);
    });

    dropdown.onmouseleave = () => setHighlight(-1);

    input.addEventListener('focus', () => {
      showDropdown();
      input.select();
    });
    input.addEventListener('click', showDropdown);
    input.addEventListener('input', showDropdown);
    input.addEventListener('blur', () => {
      hideDropdown();
      applyShape();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        showDropdown();
        setHighlight(Math.min(highlightedIndex + 1, items.length - 1));
        input.select();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        showDropdown();
        setHighlight(Math.max(highlightedIndex - 1, 0));
        input.select();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // If an item is highlighted and the entire input is selected.
        // Check that to ensure that the user intends to select the highlighted
        // item, rather than just pressing enter to accept the current input.
        const allSelected =
          input.selectionStart === 0 &&
          input.selectionEnd === input.value.length;
        if (highlightedIndex >= 0 && allSelected) {
          input.value = items[highlightedIndex].textContent;
        }
        applyShape();
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    });

    this._input = input;
  }

  reshape(shape) {
    this._input.value = shape.name;
    this._input.setCustomValidity('');
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

class CheckboxCategoryInput extends ConstraintCategoryInput {
  constructor(collection, containerId) {
    super(collection);

    this._checkboxes = new Map();
    this._selects = new Map();
    this._shape = null;

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
          removeAllOfType(this.collection, constraint);
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

    const initSelectDropdown = (constraintClass, container, argConfig) => {
      const selectId = `${containerId}-select-${this._selects.size}`;

      // Create a template constraint so we can compute uniqueness keys and type.
      const defaultValue = argConfig.default ?? argConfig.options?.[0]?.value;
      if (defaultValue === undefined) {
        throw new Error(
          `Select constraint ${constraintClass.name} must define a default or at least one option.`);
      }
      const templateConstraint = new constraintClass(defaultValue);

      const div = document.createElement('div');

      const label = document.createElement('label');
      label.htmlFor = selectId;
      label.textContent = `${constraintClass.displayName()}: `;
      div.appendChild(label);

      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.setAttribute('data-text', constraintClass.DESCRIPTION);
      div.appendChild(tooltip);

      const select = document.createElement('select');
      select.id = selectId;

      for (const opt of (argConfig.options || [])) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.text;
        select.appendChild(option);
      }

      // Default selection should reflect default behaviour.
      // If the selected value matches the default, we keep the constraint unset
      // (implicit default) to keep serialized strings clean.
      select.value = defaultValue;

      select.onchange = () => {
        const value = select.value;
        removeAllOfType(this.collection, templateConstraint);
        if (value !== defaultValue) {
          this.collection.addConstraint(new constraintClass(value));
        }
      };
      div.appendChild(select);

      container.appendChild(div);

      this._selects.set(templateConstraint.type, {
        element: select,
        constraintClass,
        defaultValue,
      });
    };

    const container = document.getElementById(containerId);
    const constraintClasses = this.constructor.constraintClasses();

    // Render checkboxes first, then select dropdowns.
    // This keeps the UI predictable when mixing input types.
    for (const constraintClass of constraintClasses) {
      const argConfig = constraintClass.ARGUMENT_CONFIG;
      if (argConfig?.inputType === 'select') continue;

      if (argConfig) {
        for (const option of constraintClass.ARGUMENT_CONFIG.options) {
          initSingleCheckbox(constraintClass, container, option);
        }
      } else {
        initSingleCheckbox(constraintClass, container, null);
      }
    }

    for (const constraintClass of constraintClasses) {
      const argConfig = constraintClass.ARGUMENT_CONFIG;
      if (argConfig?.inputType !== 'select') continue;
      initSelectDropdown(constraintClass, container, argConfig);
    }
  }

  onAddConstraint(c) {
    const checkbox = this._checkboxes.get(c.toString());
    if (checkbox) {
      checkbox.element.checked = true;
      return;
    }

    const select = this._selects.get(c.type);
    if (select) {
      // For select constraints, the first arg is the selected value.
      select.element.value = c.args[0] ?? select.defaultValue;
    }
  }

  onRemoveConstraint(c) {
    const checkbox = this._checkboxes.get(c.toString());
    if (checkbox) {
      checkbox.element.checked = false;
      return;
    }

    const select = this._selects.get(c.type);
    if (select) {
      select.element.value = select.defaultValue;
    }
  }

  clear() {
    for (const item of this._checkboxes.values()) {
      item.element.checked = false;
    }

    for (const item of this._selects.values()) {
      item.element.value = item.defaultValue;
    }
  }

  reshape(shape) {
    this._shape = shape;

    for (const item of this._checkboxes.values()) {
      const requiresSquare = item.constraint.constructor.REQUIRE_SQUARE_GRID;
      const disabled = requiresSquare && !shape.isSquare();
      item.element.disabled = disabled;
      item.element.parentElement.classList.toggle('disabled', disabled);
    }
  }
}

ConstraintCategoryInput.Global = class Global extends CheckboxCategoryInput {
  constructor(collection, addUpdateListener) {
    const element = document.getElementById('global-constraints-container');
    const container = new CollapsibleContainer(
      element, /* defaultOpen= */ true);
    addUpdateListener(() => container.updateActiveHighlighting());

    super(collection, container.bodyElement().id);
  }
}

ConstraintCategoryInput.LayoutCheckbox = class LayoutCheckbox extends CheckboxCategoryInput {
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
    if (cells.length < 1) throw new Error('Selection too short.');

    const formData = new FormData(selectionForm);
    const type = formData.get('constraint-type');

    const constraintClass = SudokuConstraint[type];
    const typeData = this._typeMap.get(type);
    if (!typeData) throw new Error('Unknown constraint type: ' + type);
    if (typeData.elem.disabled) throw new Error('Invalid selection for ' + type);

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
            throw new Error('Invalid options for ' + type);
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
      input.disabled = cells.length === 0;
    };
  }

  _onNewSelection(selection, selectionForm) {
    // Only enable the selection panel if the selection is long enough.
    const disabled = (selection.length === 0);
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

    const isSingleCell = selection.length === 1;

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
    const currValue = values.length === 1 ? values[0] : 0;
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

ConstraintCategoryInput.Region = class Region extends ConstraintCategoryInput {
  static IS_LAYOUT = true;

  constructor(collection, inputManager, chipView) {
    super(collection);
    this._shape = null;
    this._chipView = chipView;
    this._button = document.getElementById('add-jigsaw-button');

    this._regionSizeSelect = document.getElementById('region-size-select');

    this._setUpButton(inputManager);
    this._setUpRegionSizeSelect();
  }

  _setUpRegionSizeSelect() {
    const select = this._regionSizeSelect;

    select.onchange = () => {
      if (!this._shape) return;
      const selected = +select.value;

      this.collection.removeAllConstraints();
      if (selected !== this._shape.numValues) {
        this.collection.addConstraint(new SudokuConstraint.RegionSize(selected));
      }
    };
  }

  _updateRegionSizeSelectForShape(shape) {
    const select = this._regionSizeSelect;

    // Hide when numValues is default.
    if (shape.isDefaultNumValues()) {
      select.parentNode.style.display = 'none';
      return;
    }

    select.parentNode.style.display = 'block';

    const defaultNumValues = GridShape.defaultNumValues(
      shape.numRows, shape.numCols);
    const numValues = shape.numValues;

    // Populate options (exactly two values).
    clearDOMNode(select);
    for (const v of [defaultNumValues, numValues]) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }

    // Default selection is numValues (no constraint).
    select.value = numValues;
  }

  _setUpButton(inputManager) {
    const button = this._button;
    button.onclick = () => {
      const cells = inputManager.getSelection();
      this.collection.addConstraint(
        new SudokuConstraint.Jigsaw(this._shape.name, ...cells));
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
    this._updateRegionSizeSelectForShape(shape);
  }

  _cellsAreValidJigsawPiece(cells) {
    const shape = this._shape;
    if (!shape) return false;

    const requiredLength = shape.isDefaultNumValues()
      ? shape.numValues : +this._regionSizeSelect.value;
    if (cells.length !== requiredLength) return false;

    // Check that we don't conflict with any existing constraints.
    for (const cell of cells) {
      if (this.collection.getConstraintsByKey(cell).some(
        c => c.constructor.CATEGORY === this.constructor.name)) {
        return false;
      }
    }

    return true;
  }

  onAddConstraint(c) {
    if (c.type === SudokuConstraint.RegionSize.name) {
      this._regionSizeSelect.value = c.size;
    }
  }

  onRemoveConstraint(c) {
    if (c.type === SudokuConstraint.RegionSize.name) {
      this._regionSizeSelect.value = this._shape?.numValues;
    }
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

// Base class for JavaScript constraint inputs that share the tabbed panel.
class JavaScriptCategoryInput extends ConstraintCategoryInput {
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
    // Check offsetParent to ensure the element is actually visible.
    const isVisible = this._form[this._addButtonName].offsetParent !== null;

    if (isPanelOpen && isActiveTab && isEnabled && isVisible) {
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

ConstraintCategoryInput.Pairwise = class Pairwise extends JavaScriptCategoryInput {
  constructor(collection, inputManager, userScriptExecutor) {
    super(collection, inputManager, 'custom-pairwise-tab', 'add-pairwise-constraint');
    this._userScriptExecutor = userScriptExecutor;
    this._setUp();
  }

  _setUp() {
    const form = this._form;
    const errorElem = document.getElementById(
      'custom-pairwise-input-error');

    autoSaveField(form, 'pairwise-name');
    autoSaveField(form, 'chain-mode');
    autoSaveField(form, 'function');

    form['add-pairwise-constraint'].onclick = async e => {
      return this._runWithSpinner(async () => {
        const formData = new FormData(form);
        const name = formData.get('pairwise-name');
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

  populateForm(constraint, numValues) {
    // Open panel.
    this._panel.classList.add('container-open');

    // Switch to pairwise tab.
    const tabButton = this._panel.parentElement.querySelector(
      '[data-tab="custom-pairwise-tab"]');
    tabButton?.click();

    // Populate fields.
    this._form['pairwise-name'].value = constraint.name || '';
    this._form['chain-mode'].value = constraint.type;
    this._form['function'].value = binaryKeyToFnString(constraint.key, numValues);
    this._form['function'].focus();
  }
}

ConstraintCategoryInput.StateMachine = class StateMachine extends JavaScriptCategoryInput {
  constructor(collection, inputManager, userScriptExecutor) {
    super(collection, inputManager, 'state-machine-tab', 'add-state-machine-constraint');
    this._userScriptExecutor = userScriptExecutor;

    this._codeFieldNames = [
      'start-state', 'transition-body', 'accept-body', 'max-depth', 'unified-code'];

    this._splitContainer = document.getElementById('state-machine-split-input');
    this._unifiedContainer = document.getElementById('state-machine-unified-input');

    this._setUp();
  }

  _isUnifiedMode() {
    return this._form['unified-mode'].checked;
  }

  // Convert split field values to unified code.
  _splitToUnified(startExpression, transitionBody, acceptBody, maxDepthExpression) {
    const indent = (s) => s.replace(/^/gm, '  ');
    const maxDepthLine = maxDepthExpression ? `\n\nmaxDepth = ${maxDepthExpression};` : '';
    return `
      startState = ${startExpression};

      function transition(state, value) {
      ${indent(transitionBody)}
      }

      function accept(state) {
      ${indent(acceptBody)}
      }${maxDepthLine}
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
            form['accept-body'].value,
            form['max-depth'].value);
        } else {
          // Unified → Split: parse then extract.
          const { startExpression, transitionBody, acceptBody, maxDepthExpression } =
            await this._userScriptExecutor.convertUnifiedToSplit(
              form['unified-code'].value);
          form['start-state'].value = startExpression;
          form['transition-body'].value = transitionBody;
          form['accept-body'].value = acceptBody;
          form['max-depth'].value = maxDepthExpression;
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
              acceptBody: formData.get('accept-body'),
              maxDepthExpression: formData.get('max-depth'),
            };

          const shape = this._shape || SudokuConstraint.Shape.DEFAULT_SHAPE;
          const cells = this._inputManager.getSelection();
          const encodedNFA = await this._userScriptExecutor.compileStateMachine(
            spec, shape.numValues, cells.length, isUnified);

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

  populateForm(constraint, numValues) {
    // Open the Custom JavaScript Constraints panel.
    this._panel.classList.add('container-open');

    // Switch to the State Machine tab.
    const tabButton = this._panel.parentElement.querySelector(
      '[data-tab="state-machine-tab"]');
    tabButton?.click();

    // Populate name field.
    this._form['state-machine-name'].value = constraint.name || '';

    // Switch to unified mode to show the generated code.
    this._form['unified-mode'].checked = true;
    this._form['unified-mode'].dispatchEvent(new Event('change'));

    // Convert the encoded NFA back to JavaScript and populate unified mode.
    const jsSpec = encodedNFAToJsSpec(constraint.encodedNFA);
    this._form['unified-code'].value = jsSpec;
    this._form['unified-code'].focus();
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
    toggleDisabled(this._collapsibleContainer.element(), selection.length === 0);
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
      if (selection.length === 0) return;

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

const removeAllOfType = (collection, constraint) => {
  // We need to remove the exact constraint objects (not necessarily
  // the constraint we store ourselves).
  for (const uniquenessKey of constraint.uniquenessKeys()) {
    for (const c of collection.getConstraintsByKey(uniquenessKey)) {
      if (c.type === constraint.type) {
        collection.removeConstraint(c);
      }
    }
  }
};
