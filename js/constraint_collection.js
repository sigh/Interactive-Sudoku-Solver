// The page's constraint collections, their chips, and constraint selection.
const {
  clearDOMNode,
  createSvgElement,
  arraysAreEqual,
  MultiMap,
} = await import('./util.js' + self.VERSION_PARAM);
const { SudokuConstraint, CompositeConstraintBase } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const { DisplayItem } = await import('./display.js' + self.VERSION_PARAM);

class ConstraintCollectionBase {
  addConstraint(constraint) { throw Error('Not implemented'); }
  removeConstraint(constraint) { throw Error('Not implemented'); }
  updateConstraint(constraint) { throw Error('Not implemented'); }
  removeAllConstraints() { throw Error('Not implemented'); }

  getConstraintsByKey(key) { return []; }
  getConstraintsByType(type) { return []; }

  setShape(geometry) { throw Error('Not implemented'); }

  getCollectionForComposite(constraint) {
    throw Error('Not implemented');
  }
}


// Allows `addConstraint` calls to be redirected to a different collection.
export class SelectedConstraintCollection extends ConstraintCollectionBase {
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

  setShape(geometry) {
    this._rootCollection.setShape(geometry);
  }

  getConstraintsByKey(key) {
    return this._rootCollection.getConstraintsByKey(key);
  }

  getConstraintsByType(type) {
    return this._rootCollection.getConstraintsByType(type);
  }
}

export class RootConstraintCollection extends ConstraintCollectionBase {
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
    this._geometry = null;
  }

  reshape(geometry) {
    this._geometry = geometry;
    geometry.onVarCellsChanged(({ removedCellIds }) => {
      // Remove constraints whose cells no longer exist.
      if (removedCellIds.length) {
        for (const c of [...this._constraintMap.keys()]) {
          if (!c.isDefinedFor(geometry)) {
            this.removeConstraint(c);
          }
        }
      }

      // Redraw all displayed constraints, as cell positions may have shifted.
      for (const [c, state] of this._constraintMap) {
        if (state.displayElem) {
          this.updateConstraint(c);
        }
      }
    });
  }

  clear() {
    this._uniquenessKeySet.clear();
    this._constraintMap.clear();
    this._geometry.clearVarCells();
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

    // Register var cells first: an over-limit constraint throws here (and the
    // error bubbles up to the user) before any chip/display state is created.
    this._geometry.addVarCellsForConstraints([constraint]);

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

    this._geometry.removeVarCellsForConstraints([constraint]);
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
    if (chip && constraintState.displayElem) {
      this._chipViewForConstraint(constraint).replaceChipIcon(
        chip,
        constraintState.displayElem.cloneNode(true));
    }
    this._updateListener();
  }

  removeAllConstraints() {
    for (const constraint of this._constraintMap.keys()) {
      this.removeConstraint(constraint);
    }
  }

  setShape(geometry) {
    // Split out var cells so we can keep them across shape changes.
    const [varConstraints, otherConstraints] =
      this._splitVarCellConstraints(this._constraintMap.keys());
    const domainKept =
      geometry.numValues === this._geometry.numValues &&
      geometry.valueOffset === this._geometry.valueOffset;
    // If the value range changes then clear all other constraints.
    const carried = domainKept
      ? [...varConstraints, ...otherConstraints] : varConstraints;

    this._reshapeListener(geometry);

    // Keep only the constraints which still reference valid cells.
    for (const c of carried) {
      if (c.isDefinedFor(geometry)) this.addConstraint(c);
    }
  }

  // Add constraints with var-cell-defining ones first, so their cell IDs are
  // available to the constraints that use them.
  addConstraints(constraints) {
    const [varConstraints, otherConstraints] =
      this._splitVarCellConstraints(constraints);
    for (const c of varConstraints) this.addConstraint(c);
    for (const c of otherConstraints) this.addConstraint(c);
  }

  // The var-cell-defining constraints, then the rest.
  _splitVarCellConstraints(constraints) {
    const varConstraints = [];
    const otherConstraints = [];
    for (const c of constraints) {
      (c.getVarCellGroups(this._geometry).length
        ? varConstraints : otherConstraints).push(c);
    }
    return [varConstraints, otherConstraints];
  }

  getCollectionForComposite(c) {
    return this._constraintMap.get(c)?.collection;
  }

  getConstraintsByKey(key) {
    return this._uniquenessKeySet.getKey(key);
  }

  getConstraintsByType(type) {
    return [...this._constraintMap.keys()].filter(c => c.type === type);
  }

  constraintForVarPrefix(prefix) {
    for (const c of this._constraintMap.keys()) {
      if (c.getVarCellGroups(this._geometry).some(g => g.prefix === prefix)) {
        return c;
      }
    }
    return null;
  }

  removeConstraintForVarPrefix(prefix) {
    const constraint = this.constraintForVarPrefix(prefix);
    if (constraint) this.removeConstraint(constraint);
  }

  _chipViewForConstraint(constraint) {
    switch (constraint.constructor.CATEGORY) {
      case 'LinesAndSets':
      case 'ChaosConstruction':
      case 'Pairwise':
      case 'CellGroup':
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

export class CompositeConstraintCollection extends ConstraintCollectionBase {
  constructor(parentConstraint, parentCollection, chipView, display, constraintSelector, collectionFactory) {
    super();
    this._display = display;
    this._constraintSelector = constraintSelector;
    this._constraintMap = new Map();
    this._collectionFactory = collectionFactory;
    this._parentCollection = parentCollection;
    this._chipView = chipView;
    this._uniquenessKeySet = new UniquenessKeySet();

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
    this._uniquenessKeySet.addConstraint(c);
    if (c.constructor.IS_COMPOSITE) {
      constraintState.collection = this._collectionFactory(
        c, chip, this);
    }
    return constraintState;
  }

  addConstraint(c) {
    // Enforce uniqueness within And/Replicate, but not Or where branches are
    // alternatives so duplicate constraint types are valid.
    if (this._parentConstraint.constructor !== SudokuConstraint.Or) {
      for (const match of this._uniquenessKeySet.matchConstraint(c)) {
        this.removeConstraint(match);
      }
    }

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
    this._uniquenessKeySet.removeConstraint(c);
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

export class UniquenessKeySet {
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

export class ConstraintChipView {
  constructor(chipViewElement, display, chipHighlighter, constraintSelector, onUpdate, chipActionCallback) {
    this._chipViewElement = chipViewElement;
    this._chipHighlighter = chipHighlighter;
    this._constraintSelector = constraintSelector;
    this._display = display;
    this._geometry = null;
    this._onUpdate = onUpdate;
    this._chipActionCallback = chipActionCallback;
  }

  reshape(geometry) {
    this._geometry = geometry;
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
      const chipIcon = this.constructor._makeChipIcon(iconElem, this._geometry);
      if (constraint.constructor.IS_COMPOSITE) {
        chipLabel.appendChild(chipIcon);
      } else {
        chip.append(chipIcon);
      }
    }

    // Add action button for constraints that declare one.
    const chipAction = constraint.constructor.CHIP_ACTION;
    if (chipAction) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'chip-load-button';
      const icon = document.createElement('img');
      icon.src = chipAction.icon;
      icon.alt = chipAction.title;
      actionButton.appendChild(icon);
      actionButton.title = chipAction.title;
      actionButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this._chipActionCallback?.(constraint, collection);
      });
      chip.appendChild(actionButton);
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
        constraint.getCells(this._geometry), chip);
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
    const iconElem = this.constructor._makeChipIcon(newIcon, this._geometry);
    const oldElem = chip.querySelector(
      ':scope > .chip-label > .chip-icon, :scope > .chip-icon');
    oldElem.replaceWith(iconElem);
  }

  static _CHIP_ICON_SIZE_PX = 28;

  static _makeChipIcon(elem, geometry) {
    const svg = createSvgElement('svg');
    svg.classList.add('chip-icon');

    const numRows = geometry.numRows;
    const numCols = geometry.numCols;
    const widthPixels = DisplayItem.CELL_SIZE * numCols;
    const heightPixels = DisplayItem.CELL_SIZE * numRows;
    const scale = this._CHIP_ICON_SIZE_PX / Math.max(widthPixels, heightPixels);
    const transform = `scale(${scale})`;

    const background = createSvgElement('rect');
    background.setAttribute('width', widthPixels);
    background.setAttribute('height', heightPixels);
    background.setAttribute('fill', 'rgb(255, 255, 255)');
    background.setAttribute('transform', transform);
    svg.append(background);

    elem.setAttribute('transform', transform);
    elem.setAttribute('stroke-width', 15);
    elem.setAttribute('opacity', 1);

    svg.append(elem);

    // Set the size (as well as minSize so it doesn't get squished).
    // Keep the longest dimension at _CHIP_ICON_SIZE_PX and scale the other
    // dimension proportionally, so rectangular grids don't look squashed.
    svg.style.width = (widthPixels * scale) + 'px';
    svg.style.height = (heightPixels * scale) + 'px';
    // Undo the opacity.
    svg.style.filter = 'saturate(100)';

    return svg;
  }
}

export class ConstraintHighlighter {
  constructor(displayContainer, display, cssClass) {
    this._highlighter = displayContainer.createCellHighlighter(cssClass);
    this._cssClass = cssClass;
    this._display = display;
    this._currentState = null;
    this._geometry = null;
  }

  reshape(geometry) {
    this._geometry = geometry;
  }

  _isInSubChipView(chip) {
    return chip.closest('.sub-chip-view') !== null;
  }

  setConstraint(constraint, chip) {
    this.clear();
    this._currentState = { chip, constraint };
    chip.classList.add(this._cssClass);
    this._highlighter.setCells(constraint.getCells(this._geometry));
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
    const cells = constraint.getCells(this._geometry);
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

export class ConstraintSelector {
  constructor(displayContainer, display, onCollectionSelectCallback) {
    this._selectionHighlighter = new ConstraintHighlighter(
      displayContainer, display, 'selected-constraint');
    this._latestHighlighter = new ConstraintHighlighter(
      displayContainer, display, 'latest-constraint');
    this._runOnCollectionSelect = onCollectionSelectCallback || (() => { });

    this._escapeListener = null;
  }

  reshape(geometry) {
    this._selectionHighlighter.reshape(geometry);
    this._latestHighlighter.reshape(geometry);
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
      this._escapeListener = (e) => {
        if (e.key === 'Escape') this.clear();
      };
      window.addEventListener('keydown', this._escapeListener);
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
