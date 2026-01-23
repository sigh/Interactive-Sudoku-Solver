const {
  autoSaveField,
  clearDOMNode,
  deferUntilAnimationFrame,
  sessionAndLocalStorage,
  createSvgElement,
  copyToClipboard,
  arraysAreEqual,
  MultiMap,
  dynamicJSFileLoader,
  dynamicCSSFileLoader,
  isKeyEventFromEditableElement,
} = await import('./util.js' + self.VERSION_PARAM);
const {
  SudokuConstraint,
  CompositeConstraintBase,
  UserScriptExecutor
} = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const {
  DisplayContainer,
  BorderDisplay,
  DisplayItem
} = await import('./display.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
const { ConstraintDisplay } = await import('./constraint_display.js' + self.VERSION_PARAM);
const { SolutionController } = await import('./solution_controller.js' + self.VERSION_PARAM);
const {
  CollapsibleContainer,
  ConstraintCategoryInput
} = await import('./constraint_input.js' + self.VERSION_PARAM);

export const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  const displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  const constraintManager = new ConstraintManager(
    inputManager, displayContainer);

  // Load examples.
  new ExampleHandler(constraintManager);

  new SolutionController(constraintManager, displayContainer);

  // Set up sandbox integration.
  new SandboxHandler(constraintManager);

  setUpHeaderSettingsDropdown();

  setUpTooltipPortal();

  const hiddenElements = Array.from(
    document.getElementsByClassName('hide-until-load'));
  hiddenElements.forEach(e => e.classList.remove('hide-until-load'));
};

const setUpTooltipPortal = () => {
  // Tooltips are used all over the constraints panel; that panel is now a
  // scroll container which would clip CSS ::after tooltips. Render a single
  // tooltip bubble on <body> instead.
  const bubble = document.createElement('div');
  bubble.className = 'tooltip-portal-bubble';
  bubble.hidden = true;
  document.body.appendChild(bubble);

  const EDGE_PX = 8;
  const OFFSET_PX = 8;

  const hide = () => {
    bubble.hidden = true;
  };

  const positionBubble = (target) => {
    const rect = target.getBoundingClientRect();

    // Prefer below the icon.
    let left = rect.left;
    let top = rect.bottom + OFFSET_PX;

    const bubbleWidth = bubble.offsetWidth;
    const bubbleHeight = bubble.offsetHeight;

    left = Math.min(left, window.innerWidth - bubbleWidth - EDGE_PX);
    left = Math.max(left, EDGE_PX);

    // If it would run off the bottom, flip above.
    if (top + bubbleHeight + EDGE_PX > window.innerHeight) {
      top = rect.top - bubbleHeight - OFFSET_PX;
    }
    top = Math.max(top, EDGE_PX);

    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  };

  const showFor = (target) => {
    const template = target.querySelector('template');
    if (template) {
      bubble.replaceChildren(template.content.cloneNode(true));
      bubble.hidden = false;
      positionBubble(target);
      return;
    }

    const text = target.getAttribute('data-text');
    if (!text) return;

    bubble.textContent = text;
    bubble.hidden = false;
    positionBubble(target);
  };

  // Bind once: tooltips are expected to exist after init.
  const tooltips = Array.from(document.querySelectorAll('.tooltip'));
  for (const tooltip of tooltips) {
    tooltip.addEventListener('mouseenter', () => showFor(tooltip));
    tooltip.addEventListener('mouseleave', hide);
  }

  // Keep things simple: scrolling/resizing hides any visible tooltip.
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide, { passive: true });
};

const setUpHeaderSettingsDropdown = () => {
  const dropdown = document.querySelector('.page-header-settings');
  const button = document.getElementById('page-header-settings-button');
  const menu = dropdown.querySelector('.dropdown-menu');

  const onDocumentClick = (e) => {
    if (!dropdown.contains(e.target)) setOpen(false);
  };

  let isOpen = false;

  const setOpen = (open) => {
    if (open === isOpen) return;

    isOpen = open;
    menu.classList.toggle('dropdown-open', isOpen);
    if (isOpen) {
      document.addEventListener('click', onDocumentClick);
    } else {
      document.removeEventListener('click', onDocumentClick);
    }
  };

  button.addEventListener('click', (e) => {
    e.preventDefault();
    setOpen(!isOpen);
  });
};

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

class ConstraintCollectionBase {
  addConstraint(constraint) { throw Error('Not implemented'); }
  removeConstraint(constraint) { throw Error('Not implemented'); }
  updateConstraint(constraint) { throw Error('Not implemented'); }
  removeAllConstraints() { throw Error('Not implemented'); }

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

  removeAllConstraints() {
    this._rootCollection.removeAllConstraints();
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

  removeAllConstraints() {
    for (const constraint of this._constraintMap.keys()) {
      this.removeConstraint(constraint);
    }
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
      case 'Region':
        if (constraint instanceof SudokuConstraint.Jigsaw) {
          return this._chipViews.get('jigsaw');
        }
        break;
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

  removeAllConstraints() {
    for (const constraint of this._constraintMap.keys()) {
      this.removeConstraint(constraint);
    }
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

  _updateNonDefaultNumValuesWarning() {
    if (!this._shape) return;

    this._nonDefaultNumValuesWarningElem.style.display =
      (!this._shape.isDefaultNumValues()) ? '' : 'none';
  }

  _reshape(shape) {
    if (this._shape === shape) return;

    this.clear();
    this._shape = shape;

    this._updateNonDefaultNumValuesWarning();
    for (const listener of this._reshapeListeners) {
      listener.reshape(shape);
    }

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

  runUpdateCallback(options) {
    for (const listener of this._updateListeners) {
      listener(this, options);
    }
  }

  _setUp(inputManager, displayContainer) {
    this._nonDefaultNumValuesWarningElem = document.getElementById('numvalues-experimental-warning');
    this._updateNonDefaultNumValuesWarning();

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

    // Callback for populating the form from a constraint chip.
    this._populateFormCallback = (constraint) => {
      const categoryInput = this._constraintCategoryInputs.get(
        constraint.constructor.CATEGORY);
      categoryInput.populateForm?.(constraint, this._shape.numValues);
    };

    const chipViews = new Map();
    this._chipHighlighter = displayContainer.createCellHighlighter('chip-hover');
    for (const type of ['ordinary', 'composite', 'jigsaw']) {
      const chipView = this.addReshapeListener(
        new ConstraintChipView(
          document.querySelector(`.chip-view[data-chip-view-type="${type}"]`),
          this._display, this._chipHighlighter, this._constraintSelector,
          this.runUpdateCallback.bind(this),
          this._populateFormCallback));
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
      new ConstraintCategoryInput.Global(
        selectedConstraintCollection, this.addUpdateListener.bind(this)),
      new ConstraintCategoryInput.LayoutCheckbox(selectedConstraintCollection),
      new ConstraintCategoryInput.Region(
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
    const copyButton = document.getElementById('copy-constraints-button');
    copyButton.onclick = () => {
      copyToClipboard(this.getConstraints(), copyButton);
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
    if (constraint.constraints.length === 0) {
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
      this._populateFormCallback);
    // Shape is constant for composite constraints.
    subView.reshape(this._shape);
    return subView;
  }

  _setUpFreeFormInput() {
    // Free-form.
    const form = document.forms['freeform-constraint-input'];

    new CollapsibleContainer(
      document.getElementById('freeform-constraint-panel'),
      /* defaultOpen= */ false);

    const inputElem = form['freeform-input'];

    const errorElem = document.createElement('div');
    errorElem.className = 'notice notice-error';
    inputElem.parentElement.appendChild(errorElem);

    inputElem.addEventListener('input', () => {
      clearDOMNode(errorElem);
    });

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
      this.runUpdateCallback({ forceSolve: true });
      return false;
    };

    document.getElementById('freeform-load-current-button').onclick = () => {
      clearDOMNode(errorElem);
      inputElem.value = this.getConstraints().toString();
      inputElem.focus();
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
    return new SudokuConstraint.Container(constraints);
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

    const dimWarning = document.getElementById('dim-constraints-warning');

    autoSaveField(dimConstraintsInput);

    // Apply initial state
    if (dimConstraintsInput.checked) {
      sudokuGrid.classList.add('constraints-dimmed');
    }

    dimWarning.style.display = dimConstraintsInput.checked ? '' : 'none';

    // Handle toggle
    dimConstraintsInput.onchange = () => {
      sudokuGrid.classList.toggle('constraints-dimmed', dimConstraintsInput.checked);
      dimWarning.style.display = dimConstraintsInput.checked ? '' : 'none';
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
  constructor(chipViewElement, display, chipHighlighter, constraintSelector, onUpdate, populateFormCallback) {
    this._chipViewElement = chipViewElement;
    this._chipHighlighter = chipHighlighter;
    this._constraintSelector = constraintSelector;
    this._display = display;
    this._shape = null;
    this._onUpdate = onUpdate;
    this._populateFormCallback = populateFormCallback;
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

    // Add populate form button for constraints that support it.
    const categoryClass = ConstraintCategoryInput[constraint.constructor.CATEGORY];
    if (categoryClass.prototype?.populateForm) {
      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.className = 'chip-load-button';
      const icon = document.createElement('img');
      icon.src = 'img/publish-48.png';
      icon.alt = 'Load into panel';
      loadButton.appendChild(icon);
      loadButton.title = 'Load into panel';
      loadButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this._populateFormCallback?.(constraint);
      });
      chip.appendChild(loadButton);
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
    const gridWidthPixels = borderDisplay.gridWidthPixels();
    const gridHeightPixels = borderDisplay.gridHeightPixels();
    const maxGridPixels = Math.max(gridWidthPixels, gridHeightPixels);
    const scale = this._CHIP_ICON_SIZE_PX / maxGridPixels;
    const transform = `scale(${scale})`;

    borders.setAttribute('transform', transform);
    borders.setAttribute('stroke-width', 0);

    elem.setAttribute('transform', transform);
    elem.setAttribute('stroke-width', 15);
    elem.setAttribute('opacity', 1);

    svg.append(elem);

    // Set the size (as well as minSize so it doesn't get squished).
    // Keep the longest dimension at _CHIP_ICON_SIZE_PX and scale the other
    // dimension proportionally, so rectangular grids don't look squashed.
    svg.style.width = (gridWidthPixels * scale) + 'px';
    svg.style.height = (gridHeightPixels * scale) + 'px';
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
    let activePointerId = null;
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

    const endPointerSelection = (e) => {
      if (activePointerId === null) return;
      if (e?.pointerId !== activePointerId) return;

      container.removeEventListener('pointermove', pointerMoveFn);
      this._runCallback(true);

      try {
        container.releasePointerCapture(activePointerId);
      } catch {
        // Ignore; capture may already be released.
      }

      activePointerId = null;
      e?.preventDefault();
    };

    container.addEventListener('pointerdown', e => {
      // Only track one active pointer at a time.
      if (activePointerId !== null) return;

      // If the shift key is pressed, continue adding to the selection.
      if (!e.shiftKey) {
        this.setCells([]);
      }

      activePointerId = e.pointerId;
      try {
        container.setPointerCapture(activePointerId);
      } catch {
        // Ignore; capture may fail in some environments.
      }

      container.addEventListener('pointermove', pointerMoveFn);
      this._maybeAddOutsideClickListener();
      currCell = null;
      currCenter = [Infinity, Infinity];
      pointerMoveFn(e);
      e.preventDefault();
    });
    container.addEventListener('pointerup', endPointerSelection);
    container.addEventListener('pointercancel', endPointerSelection);
    container.addEventListener('lostpointercapture', endPointerSelection);
    container.addEventListener('touchmove', e => {
      if (e.touches.length === 1) e.preventDefault();
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
      if (cellIds.length === 1) {
        const [x, y] = this._selection.cellIdCenter(cellIds[0]);
        fakeInput.style.top = y + 'px';
        fakeInput.style.left = x + 'px';
      }
      // Run callbacks first so panels can update their state.
      this._runCallbacks(
        this._callbacks.onSelection, cellIds, finishedSelecting);
      // Then restore focus based on the updated state.
      if (finishedSelecting) {
        if (cellIds.length === 1) {
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
      if (cells.length !== 1) return null;
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
      const numRows = shape.numRows;
      const numCols = shape.numCols;
      row = (row + dr + numRows) % numRows;
      col = (col + dc + numCols) % numCols;

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
      if (isKeyEventFromEditableElement(event)) return;
      if (this._selection.size() == 0) return;
      switch (event.key) {
        case 'Backspace':
        case '0':
          for (const cell of this._selection.getCells()) {
            this._runCallbacks(this._callbacks.onNewDigit, cell, null);
          }
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

class SandboxHandler {
  constructor(constraintManager) {
    this._constraintManager = constraintManager;
    this._loadingPromise = null;
    this._container = document.getElementById('sandbox-container');
    this._collapsible = null;

    this._setUpListeners();
    this._checkForCodeParam();
  }

  _setUpListeners() {
    const openLink = document.getElementById('open-sandbox-link');

    openLink.addEventListener('click', (e) => {
      e.preventDefault();
      this._openSandbox();
      this._container.scrollIntoView();
    });

    // Ctrl/Cmd+` to toggle sandbox.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        this._toggleSandbox();
      }
    });
  }

  _toggleSandbox() {
    if (this._container.style.display === 'none') {
      this._openSandbox();
      this._container.scrollIntoView();
    } else if (this._collapsible) {
      this._collapsible.toggleOpen();
      this._updateCodeParam();
    }
  }

  _checkForCodeParam() {
    // Auto-open sandbox if ?code= is in URL.
    const url = new URL(window.location);
    if (url.searchParams.has('code')) {
      this._openSandbox();
    }
  }

  _updateCodeParam() {
    const url = new URL(window.location);
    const isOpen = this._collapsible?.isOpen();

    if (isOpen && !url.searchParams.has('code')) {
      url.searchParams.set('code', '');
      window.history.replaceState({}, '', url);
    } else if (!isOpen && url.searchParams.has('code')) {
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url);
    }
  }

  async _openSandbox() {
    this._container.style.display = '';

    this._loadingPromise ||= this._loadSandbox();
    await this._loadingPromise;

    // Ensure it's expanded when opened.
    this._collapsible?.toggleOpen(true);
    this._updateCodeParam();
  }

  async _loadSandbox() {
    try {
      // Set up collapsible behavior (do this first so the panel is styled.
      this._collapsible = new CollapsibleContainer(this._container, /* defaultOpen= */ true);

      // Load sandbox dependencies.
      await Promise.all([
        dynamicCSSFileLoader('css/sandbox.css' + self.VERSION_PARAM)(),
        dynamicCSSFileLoader('lib/prism-tomorrow.min.css')(),
      ]);
      await dynamicJSFileLoader('lib/prism.min.js')();
      await dynamicJSFileLoader('lib/prism-javascript.min.js')();

      const { EmbeddedSandbox } = await import('./sandbox/embedded_sandbox.js' + self.VERSION_PARAM);

      // Override the default anchor click to also update URL param.
      const anchor = this._collapsible.anchorElement();
      const originalOnClick = anchor.onclick;
      anchor.onclick = (e) => {
        originalOnClick(e);
        this._updateCodeParam();
      };

      new EmbeddedSandbox(
        this._container,
        (constraintStr) => {
          this._constraintManager.loadUnsafeFromText(constraintStr);
          this._constraintManager.runUpdateCallback();
        },
        () => this._constraintManager.getConstraints().toString(),
      );

      this._container.classList.add('lazy-loaded');
    } catch (e) {
      const loadingElement = this._container.querySelector('.lazy-loading');
      loadingElement.textContent = `Failed to load sandbox: ${e.message}`;
      loadingElement.classList.remove('notice-info');
      loadingElement.classList.add('notice-error');
    }
  }
}
