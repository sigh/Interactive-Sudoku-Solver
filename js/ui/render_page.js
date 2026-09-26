const {
  autoSaveField,
  clearDOMNode,
  deferUntilAnimationFrame,
  sessionAndLocalStorage,
  copyToClipboard,
  dynamicJSFileLoader,
  dynamicCSSFileLoader,
  createSourceLinkIcon,
} = await import('../util.js' + self.VERSION_PARAM);
const { SudokuConstraint, UserScriptExecutor } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { DisplayContainer } = await import('./display.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../cell_geometry.js' + self.VERSION_PARAM);
const { ConstraintDisplay } = await import('./constraint_display.js' + self.VERSION_PARAM);
const { SolutionController } = await import('./solution_controller.js' + self.VERSION_PARAM);
const { CollapsibleContainer, ConstraintCategoryInput } = await import('./constraint_input.js' + self.VERSION_PARAM);
const { BottomDrawer, LazyDrawerManager } = await import('./bottom_drawer.js' + self.VERSION_PARAM);
const {
  SelectedConstraintCollection,
  RootConstraintCollection,
  CompositeConstraintCollection,
  ConstraintChipView,
  ConstraintSelector,
} = await import('./constraint_collection.js' + self.VERSION_PARAM);
const { GridInputManager } = await import('./grid_input.js' + self.VERSION_PARAM);

const bindGlobalShortcut = (key, action) => {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === key) {
      e.preventDefault();
      action();
    }
  });
};

export const initPage = () => {
  // Create grid.
  const container = document.getElementById('sudoku-grid');
  const displayContainer = new DisplayContainer(container);
  const inputManager = new GridInputManager(displayContainer);

  const constraintManager = new ConstraintManager(
    inputManager, displayContainer);

  // Load examples.
  new ExampleHandler(constraintManager);

  const bottomDrawer = new BottomDrawer('bottom-drawer');

  new SolutionController(constraintManager, displayContainer, bottomDrawer);

  // Set up sandbox integration.
  const sandboxHandler = new SandboxHandler(constraintManager, bottomDrawer);

  new LazyDrawerManager({
    tabId: 'raw-strings',
    modulePath: '../debug/raw_strings_panel.js',
    factory: (module, bodyElement) => new module.RawStringsPanel(
      constraintManager, displayContainer, bodyElement),
  }, bottomDrawer);

  const puzzleSelectorManager = new LazyDrawerManager({
    tabId: 'puzzle-selector',
    modulePath: '../debug/puzzle_selector_panel.js',
    factory: (module, bodyElement) => new module.PuzzleSelectorPanel(
      constraintManager, bodyElement,
      (path) => sandboxHandler.openWithScript(path)),
  }, bottomDrawer);

  // Ctrl/Cmd+P to toggle the puzzle selector.
  bindGlobalShortcut('p', () => puzzleSelectorManager.toggle());

  setUpHeaderSettingsDropdown();

  setUpTooltipPortal();

  setUpConstraintSearch(constraintManager);

  setUpPageInfoDismiss();

  const hiddenElements = Array.from(
    document.getElementsByClassName('hide-until-load'));
  hiddenElements.forEach(e => e.classList.remove('hide-until-load'));

  document.querySelector('.page-header-logo').scrollIntoView();
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

const setUpConstraintSearch = (constraintManager) => {
  const searchButton = document.getElementById('constraint-search-button');
  const searchInput = document.getElementById('constraint-search-input');
  const datalist = document.getElementById('constraint-search-list');

  // Build a map of constraint display names to their constraint classes.
  const constraintMap = new Map();

  // Get all constraint classes from SudokuConstraint.
  for (const [name, constraintClass] of Object.entries(SudokuConstraint)) {
    if (!constraintClass.CATEGORY || constraintClass.CATEGORY === 'Experimental') continue;

    const displayName = `${constraintClass.displayName()} [${name}]`;
    constraintMap.set(displayName, constraintClass);
  }

  // Populate the datalist.
  const sortedNames = [...constraintMap.keys()].sort();
  for (const name of sortedNames) {
    const option = document.createElement('option');
    option.value = name;
    datalist.appendChild(option);
  }

  // Toggle search input visibility.
  const searchIcon = searchButton.querySelector('img');
  const toggleSearch = (open) => {
    const isOpen = open ?? searchInput.hidden;
    searchInput.hidden = !isOpen;
    searchIcon.src = isOpen ? 'img/search-off-48.png' : 'img/search-48.png';
    if (isOpen) {
      searchInput.value = '';
      searchInput.focus();
    }
  };

  searchButton.addEventListener('mousedown', (e) => {
    // Prevent blur from firing before click.
    e.preventDefault();
  });
  searchButton.addEventListener('click', () => toggleSearch());

  // Handle constraint selection.
  const selectConstraint = (selectedValue) => {
    const constraintClass = constraintMap.get(selectedValue);
    if (!constraintClass) return;

    toggleSearch(false);

    const categoryInput = constraintManager.getCategoryInput(constraintClass.CATEGORY);
    const element = categoryInput?.getConstraintInputElement(constraintClass);
    if (element) {
      // Open all parent collapsible containers.
      let container = element.closest('.collapsible-container');
      while (container) {
        container.classList.add('container-open');
        container = container.parentElement?.closest('.collapsible-container');
      }

      // Activate the tab containing the element (if any).
      const tabContent = element.closest('.tab-content');
      if (tabContent) {
        const tabButton = tabContent.parentElement?.querySelector(
          `.tab-container [data-tab="${tabContent.id}"]`);
        tabButton?.click();
      }
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus();

      // Brief highlight animation.
      element.classList.remove('constraint-search-highlight');
      void element.offsetWidth; // Force reflow to restart animation.
      element.classList.add('constraint-search-highlight');
      element.addEventListener('animationend', () => {
        element.classList.remove('constraint-search-highlight');
      }, { once: true });
    }
  };

  searchInput.addEventListener('change', () => {
    selectConstraint(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleSearch(false);
    }
  });

  searchInput.addEventListener('blur', () => {
    toggleSearch(false);
  });
};

const setUpPageInfoDismiss = () => {
  const pageInfo = document.querySelector('.page-info');
  const closeButton = pageInfo.querySelector('.page-info-close');
  const storageKey = 'page-info-dismissed';

  if (!localStorage.getItem(storageKey)) {
    pageInfo.hidden = false;
  }

  closeButton.addEventListener('click', () => {
    pageInfo.hidden = true;
    localStorage.setItem(storageKey, 'true');
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
    const { DISPLAYED_EXAMPLE_GROUPS, PUZZLE_INDEX } = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);

    for (const group of DISPLAYED_EXAMPLE_GROUPS) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = group.name;
      for (const example of group.puzzles) {
        const option = document.createElement('option');
        option.value = example.name;
        option.textContent = example.displayName ?? example.name;
        optGroup.appendChild(option);
      }
      exampleSelect.appendChild(optGroup);
    }

    const sourceLinks = document.querySelector(
      '#example-select-container .example-source-links');
    exampleSelect.onchange = () => {
      const example = PUZZLE_INDEX.get(exampleSelect.value);
      this._renderSourceLinks(sourceLinks, example?.src);
      this._ignoreConstraintChanges = true;
      if (example) {
        this._constraintManager.loadUnsafeFromText(example.input);
      }
    };
    exampleSelect.disabled = false;
    exampleSelect.onchange();
  }

  _renderSourceLinks(container, src) {
    const sources = (Array.isArray(src) ? src : [src]).filter(Boolean);
    clearDOMNode(container);
    container.hidden = sources.length === 0;
    if (!sources.length) return;

    const label = document.createElement('span');
    label.className = 'example-source-label';
    label.textContent = sources.length === 1 ? 'Source:' : 'Sources:';
    container.append(
      label,
      ...sources.map(src => createSourceLinkIcon(src, 'example-source-link')));
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

export class ConstraintManager {
  constructor(inputManager, displayContainer) {
    this._geometry = CellGeometry.newDefault();
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

  _reshape(geometry) {
    if (this._geometry === geometry) return;

    this._clear();
    this._geometry = geometry;

    for (const listener of this._reshapeListeners) {
      listener.reshape(geometry);
    }

    for (const panel of this._panelsRequiringSudokuGrid) {
      panel.style.display =
        geometry.gridType !== CellGeometry.SUDOKU_GRID_TYPE ? 'none' : '';
    }

    this.runUpdateCallback();
  }

  addReshapeListener(listener) {
    this._reshapeListeners.push(listener);
    // Ensure the listener is initialized with the current geometry if it exists.
    if (this._geometry) listener.reshape(this._geometry);
    return listener;
  }

  addUpdateListener(listener) {
    this._updateListeners.push(listener);
    return listener;
  }

  getCategoryInput(category) {
    return this._constraintCategoryInputs.get(category);
  }

  runUpdateCallback(options) {
    for (const listener of this._updateListeners) {
      listener(this, options);
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

    // Callback for chip action buttons.
    this._chipActionCallback = (constraint, collection) => {
      if (constraint instanceof SudokuConstraint.Replicate) {
        constraint.toggleTargetCells(inputManager.getSelection(), this._geometry);
        collection.updateConstraint(constraint);
        return;
      }
      const categoryInput = this._constraintCategoryInputs.get(
        constraint.constructor.CATEGORY);
      categoryInput.populateForm?.(constraint, this._geometry.numValues, this._geometry.valueOffset);
    };

    const chipViews = new Map();
    this._chipHighlighter = displayContainer.createCellHighlighter('chip-hover');
    for (const type of ['ordinary', 'composite', 'jigsaw']) {
      const chipView = this.addReshapeListener(
        new ConstraintChipView(
          document.querySelector(`.chip-view[data-chip-view-type="${type}"]`),
          this._display, this._chipHighlighter, this._constraintSelector,
          this.runUpdateCallback.bind(this),
          this._chipActionCallback));
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

    this._rootCollection = this.addReshapeListener(
      new RootConstraintCollection(
        this._display,
        chipViews,
        this._constraintCategoryInputs,
        this._makeCompositeCollection.bind(this),
        this._reshape.bind(this),
        this.runUpdateCallback.bind(this)));

    displayContainer.onVarCellRemove(
      (prefix) => this._rootCollection.removeConstraintForVarPrefix(prefix));

    selectedConstraintCollection = new SelectedConstraintCollection(this._rootCollection);

    const categoryInputs = [
      new ConstraintCategoryInput.Shape(selectedConstraintCollection),
      new ConstraintCategoryInput.Global(
        selectedConstraintCollection, this.addUpdateListener.bind(this)),
      new ConstraintCategoryInput.LayoutCheckbox(selectedConstraintCollection),
      new ConstraintCategoryInput.CellGroup(selectedConstraintCollection),
      new ConstraintCategoryInput.Region(
        selectedConstraintCollection, inputManager, chipViews.get('jigsaw')),
      new ConstraintCategoryInput.LinesAndSets(
        selectedConstraintCollection, inputManager),
      new ConstraintCategoryInput.ChaosConstruction(
        selectedConstraintCollection, inputManager, this.addUpdateListener.bind(this)),
      new ConstraintCategoryInput.Pairwise(
        selectedConstraintCollection, inputManager, this._userScriptExecutor),
      new ConstraintCategoryInput.StateMachine(
        selectedConstraintCollection, inputManager, this._userScriptExecutor),
      new ConstraintCategoryInput.OutsideClue(
        selectedConstraintCollection, inputManager),
      new ConstraintCategoryInput.OutsideClueOption(selectedConstraintCollection),
      new ConstraintCategoryInput.GivenCandidates(
        selectedConstraintCollection, inputManager),
      new ConstraintCategoryInput.Experimental(selectedConstraintCollection),
      new ConstraintCategoryInput.Composite(
        selectedConstraintCollection, this.addUpdateListener.bind(this), inputManager),
    ];

    for (const categoryInput of categoryInputs) {
      this._constraintCategoryInputs.set(
        categoryInput.constructor.name, categoryInput);
      this.addReshapeListener(categoryInput);
      categoryInput.setUpdateCallback(this.runUpdateCallback.bind(this));
    }

    this._panelsRequiringSudokuGrid = ['layout-constraint-container',
      'outside-clue-container']
      .map(id => document.getElementById(id));

    this._setUpCustomConstraintTabs();
    this._setUpFreeFormInput();

    // Clear button.
    document.getElementById('clear-constraints-button').onclick =
      () => this._clear();

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
      this.runUpdateCallback.bind(this),
      this._chipActionCallback);
    // Shape is constant for composite constraints.
    subView.reshape(this._geometry);
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
        if (inputElem.value !== input) inputElem.value = input;
        // Open the panel so the error is visible.
        errorElem.closest('.collapsible-container')
          ?.classList.add('container-open');
      }
    };

    form.onsubmit = e => {
      e.preventDefault();
      clearDOMNode(errorElem);
      const input = inputElem.value;
      this.loadUnsafeFromText(input);
      // Solve even if auto-solve is off.
      // Future constraint changes in the same frame supersedes this force —
      // which is intended: the result should follow the user's latest action.
      this.runUpdateCallback({ forceSolve: true });
      return false;
    };

    document.getElementById('freeform-load-current-button').onclick = () => {
      clearDOMNode(errorElem);
      inputElem.value = this.getConstraints().toString();
      form.dispatchEvent(new Event('change'));
      inputElem.focus();
    };

    autoSaveField(form, 'freeform-input');
  }

  _loadFromText(input) {
    const constraint = SudokuParser.parseText(input);

    this._clear();

    const geometry = constraint.getGeometry();
    this._rootCollection.setShape(geometry);

    const constraints = [];
    constraint.forEachTopLevel(c => constraints.push(c));
    this._rootCollection.addConstraints(constraints);

    this.runUpdateCallback();

    return constraint;
  }

  _getConstraints(filterFn) {
    const constraints = [new SudokuConstraint.Shape(this._geometry.name)];
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

  _clear() {
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

class SandboxHandler {
  constructor(constraintManager, bottomDrawer) {
    this._constraintManager = constraintManager;
    this._bottomDrawer = bottomDrawer;
    this._loadingPromise = null;
    this._container = document.getElementById('sandbox-container');
    this._tabId = 'sandbox';

    this._setUpListeners();
    this._checkForCodeParam();
  }

  _setUpListeners() {
    const toggle = document.getElementById('show-sandbox-input');

    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        this._openSandbox();
      } else {
        this._bottomDrawer.closeTab(this._tabId);
        this._updateCodeParam(false);
      }
    });

    // Sync toggle when tab is closed via the drawer.
    this._bottomDrawer.onTabClose(this._tabId, () => {
      toggle.checked = false;
      this._updateCodeParam(false);
    });

    // Ctrl/Cmd+` to toggle sandbox.
    bindGlobalShortcut('`', () => {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change'));
    });
  }

  _checkForCodeParam() {
    // Auto-open sandbox if ?code= is in URL.
    const url = new URL(window.location);
    if (url.searchParams.has('code')) {
      const toggle = document.getElementById('show-sandbox-input');
      toggle.checked = true;
      this._openSandbox();
    }
  }

  // Open the sandbox on a script-built puzzle's generating source, for editing
  // (the reverse of the selector running a script into the grid).
  async openWithScript(path) {
    document.getElementById('show-sandbox-input').checked = true;
    await this._openSandbox();
    await this._sandbox?.loadScriptFromPath(path);
  }

  _updateCodeParam(isOpen) {
    const url = new URL(window.location);

    if (isOpen && !url.searchParams.has('code')) {
      url.searchParams.set('code', '');
      window.history.replaceState({}, '', url);
    } else if (!isOpen && url.searchParams.has('code')) {
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url);
    }
  }

  async _openSandbox() {
    this._bottomDrawer.openTab(this._tabId);

    this._loadingPromise ||= this._loadSandbox();
    await this._loadingPromise;

    this._updateCodeParam(true);
  }

  async _loadSandbox() {
    try {
      // Load sandbox dependencies.
      await Promise.all([
        dynamicCSSFileLoader('css/sandbox.css' + self.VERSION_PARAM)(),
        dynamicCSSFileLoader('lib/prism-tomorrow.min.css')(),
      ]);
      await dynamicJSFileLoader('lib/prism.min.js')();
      await dynamicJSFileLoader('lib/prism-javascript.min.js')();

      const { EmbeddedSandbox } = await import('../sandbox/embedded_sandbox.js' + self.VERSION_PARAM);

      this._sandbox = new EmbeddedSandbox(
        this._container,
        (constraintStr) => {
          this._constraintManager.loadUnsafeFromText(constraintStr);
          this._constraintManager.runUpdateCallback();
        },
        () => this._constraintManager.getConstraints().toString(),
      );

      this._container.querySelector('.loading-notice').hidden = true;
      this._container.querySelector('.lazy-body').hidden = false;
    } catch (e) {
      const loadingElement = this._container.querySelector('.loading-notice');
      loadingElement.textContent = `Failed to load sandbox: ${e.message}`;
      loadingElement.classList.remove('notice-info');
      loadingElement.classList.add('notice-error');
    }
  }
}
