class DisplayContainer {
  constructor(container) {
    const svg = createSvgElement('svg');

    this._mainSvg = svg;
    container.append(svg);

    this._highlightDisplay = new HighlightDisplay(
      this.getNewGroup('highlight-group'));

    this._clickInterceptor = new ClickInterceptor();
    container.append(this._clickInterceptor.getSvg());
  }

  reshape(shape) {
    const padding = DisplayItem.SVG_PADDING;
    const sideLength = DisplayItem.CELL_SIZE * shape.gridSize + padding * 2;
    this._mainSvg.setAttribute('height', sideLength);
    this._mainSvg.setAttribute('width', sideLength);
    this._mainSvg.setAttribute('class', `size-${shape.name}`);

    this._highlightDisplay.reshape(shape);
    this._clickInterceptor.reshape(shape);
  }

  createHighlighter(cssClass) {
    return new Highlight(this._highlightDisplay, cssClass);
  }

  getNewGroup(groupName) {
    const group = createSvgElement('g');
    group.id = groupName;
    this._mainSvg.append(group);
    return group;
  }

  addElement(element) {
    this._mainSvg.append(element);
  }

  getClickInterceptor() {
    return this._clickInterceptor
  }
}

class DisplayItem {
  static SVG_PADDING = 27;
  static CELL_SIZE = 52;

  static DIAGONAL_PATTERN = 'diagonal-pattern';
  static SQUARE_PATTERN = 'square-pattern';
  static CHECKERED_PATTERN = 'checked-pattern';

  constructor(svg) {
    this._svg = svg;
    this._shape = null;
  }

  reshape(shape) { this._shape = shape; };

  getSvg() {
    return this._svg;
  }

  cellIndexCenter(cellIndex) {
    const [row, col] = this._shape.splitCellIndex(cellIndex);
    return DisplayItem._cellCenter(row, col);
  }

  cellIdCenter(cellId) {
    const { row, col } = this._shape.parseCellId(cellId);
    return DisplayItem._cellCenter(row, col);
  }

  cellIdTopLeftCorner(cellId) {
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = this.cellIdCenter(cellId);
    return [x - cellWidth / 2, y - cellWidth / 2 + 2];
  }

  cellIdBottomLeftCorner(cellId) {
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = this.cellIdCenter(cellId);
    return [x - cellWidth / 2, y + cellWidth / 2];
  }

  cellIdBottomRightCorner(cellId) {
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = this.cellIdCenter(cellId);
    return [x + cellWidth / 2, y + cellWidth / 2];
  }

  cellCenter(cell) {
    return DisplayItem._cellCenter(...this._shape.splitCellIndex(cell));
  }

  static _cellCenter(row, col) {
    const cellSize = DisplayItem.CELL_SIZE;
    return [col * cellSize + cellSize / 2, row * cellSize + cellSize / 2];
  }

  makeTextNode(str, x, y, cls) {
    const text = createSvgElement('text');
    text.appendChild(document.createTextNode(str));
    text.setAttribute('class', cls);
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    return text;
  };

  _applyGridOffset(elem) {
    const padding = this.constructor.SVG_PADDING;
    elem.setAttribute('transform', `translate(${padding},${padding})`);
  }

  _makeCellSquare(cell) {
    const cellWidth = DisplayItem.CELL_SIZE;

    const [x, y] = this.cellCenter(cell);
    const path = createSvgElement('path');
    const directions = [
      'M', x - cellWidth / 2 + 1, y - cellWidth / 2 + 1,
      'l', 0, cellWidth,
      'l', cellWidth, 0,
      'l', 0, -cellWidth,
      'l', -cellWidth, 0,
    ];
    path.setAttribute('d', directions.join(' '));
    return path;
  }

  _CIRCLE_RADIUS = 20;

  _makeCircleAtPoint([x, y]) {
    let circle = createSvgElement('circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', this._CIRCLE_RADIUS);

    return circle;
  }

  _makePath(coords) {
    const line = createSvgElement('path');

    const parts = [];
    for (const c of coords) {
      parts.push('L', ...c);
    }
    parts[0] = 'M';

    line.setAttribute('d', parts.join(' '));
    line.setAttribute('fill', 'transparent');
    return line;
  }

  _makeSquarePattern(id, color) {
    const pattern = createSvgElement('pattern');
    pattern.id = id;
    const squareSize = DisplayItem.CELL_SIZE / 10;
    pattern.setAttribute('width', squareSize * 2);
    pattern.setAttribute('height', squareSize * 2);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');

    let rect = createSvgElement('rect');
    rect.setAttribute('width', squareSize);
    rect.setAttribute('height', squareSize);
    rect.setAttribute('x', squareSize / 2);
    rect.setAttribute('y', squareSize / 2);
    rect.setAttribute('fill', color);
    pattern.appendChild(rect);

    return pattern;
  }

  _makeDiagonalPattern(id, color) {
    const pattern = createSvgElement('pattern');
    pattern.id = id;
    const hatchWidth = '10';
    pattern.setAttribute('width', hatchWidth);
    pattern.setAttribute('height', hatchWidth);
    pattern.setAttribute('patternTransform', 'rotate(45 0 0)');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    let line = createSvgElement('line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '10');
    line.setAttribute('style', `stroke:${color}; stroke-width:${hatchWidth}`);
    pattern.appendChild(line);

    return pattern;
  }

  _makeCheckeredPattern(id, color) {
    const pattern = createSvgElement('pattern');
    pattern.id = id;
    const hatchWidth = DisplayItem.CELL_SIZE / 5;
    pattern.setAttribute('width', hatchWidth * 2);
    pattern.setAttribute('height', hatchWidth * 2);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');

    let rect = createSvgElement('rect');
    rect.setAttribute('width', hatchWidth);
    rect.setAttribute('height', hatchWidth);
    rect.setAttribute('x', 0);
    rect.setAttribute('y', 0);
    rect.setAttribute('fill', color);
    pattern.appendChild(rect);

    rect = createSvgElement('rect');
    rect.setAttribute('width', hatchWidth);
    rect.setAttribute('height', hatchWidth);
    rect.setAttribute('x', hatchWidth);
    rect.setAttribute('y', hatchWidth);
    rect.setAttribute('fill', color);
    pattern.appendChild(rect);

    return pattern;
  }

  clear() {
    clearDOMNode(this._svg);
  }
}

class ClickInterceptor extends DisplayItem {
  constructor() {
    const svg = createSvgElement('svg');
    svg.classList.add('click-interceptor-svg');

    super(svg);

    // Note: _applyGridOffset won't work here because this is a DOM element
    // not an element inside the svg (breaks in Safari).
    const padding = DisplayItem.SVG_PADDING;
    svg.style.transform = `translate(${padding}px,${padding}px)`;
  }

  reshape(shape) {
    super.reshape(shape);

    const sideLength = DisplayItem.CELL_SIZE * shape.gridSize;
    const svg = this.getSvg();
    svg.setAttribute('height', sideLength);
    svg.setAttribute('width', sideLength);
  }

  cellAt(x, y) {
    const shape = this._shape;
    const row = y / DisplayItem.CELL_SIZE | 0;
    const col = x / DisplayItem.CELL_SIZE | 0;
    if (row < 0 || row >= shape.gridSize) return null;
    if (col < 0 || col >= shape.gridSize) return null;
    return shape.makeCellId(row, col);
  }
}

class InfoTextDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);
    this._applyGridOffset(svg);
  }

  setText(cellId, str) {
    const [x, y] = this.cellIdBottomLeftCorner(cellId);
    const textNode = this.makeTextNode(str, x + 2, y - 2, 'info-overlay-item');
    this._svg.append(textNode);
  }
}

class CellValueDisplay extends DisplayItem {
  MULTI_VALUE_CLASS = 'cell-multi-value';
  SINGLE_VALUE_CLASS = 'cell-single-value';

  constructor(svg) {
    super(svg);
    this._applyGridOffset(svg);
  }

  renderGridValues(grid) {
    this.clear();
    const svg = this.getSvg();

    const LINE_HEIGHT = this._shape.gridSize <= SHAPE_9x9.gridSize ? 17 : 10;
    const START_OFFSET = -DisplayItem.CELL_SIZE / 2 + 2;
    for (let i = 0; i < grid.length; i++) {
      const value = grid[i];
      if (!value) continue;

      const [x, y] = this.cellIndexCenter(i);

      if (isIterable(value)) {
        let offset = START_OFFSET;
        for (const line of this._formatMultiSolution(value)) {
          svg.append(this.makeTextNode(
            line, x, y + offset, this.MULTI_VALUE_CLASS));
          offset += LINE_HEIGHT;
        }
      } else if (value) {
        svg.append(this.makeTextNode(
          value, x, y, this.SINGLE_VALUE_CLASS));
      }
    }
  }

  static _makeTemplateArray = memoize((shape) => {
    const charsPerLine = 2 * shape.boxWidth - 1;

    let charCount = 0;
    const slots = [];
    for (let i = 1; i <= shape.numValues; i++) {
      const slot = i < 10 ? ' ' : '  ';
      slots.push(slot);
      charCount += slot.length + 1;

      if (charCount >= charsPerLine) {
        slots.push('\n');
        charCount = 0;
      } else {
        slots.push(' ');
      }
    }

    return slots;
  });

  _formatMultiSolution(values) {
    const slots = [...this.constructor._makeTemplateArray(this._shape)];
    for (const v of values) {
      slots[v * 2 - 2] = v;
    }
    return this._multiSolutionToLines(slots);
  }

  _multiSolutionToLines(slots) {
    return slots.join('').split(/\n/);
  }
}

class SolutionDisplay extends CellValueDisplay {
  constructor(svg) {
    super(svg);
    this._currentSolution = [];

    this.setSolution = deferUntilAnimationFrame(this.setSolution.bind(this));
    this._copyElem = document.getElementById('copy-solution-button');
    this._copyElem.onclick = () => {
      const solutionText = toShortSolution(this._currentSolution, this._shape);
      navigator.clipboard.writeText(solutionText);
    };
    this._fixedCellIndexes = [];
  }

  reshape(shape) {
    // This clears the solution, but importantly it overwrites any pending
    // setSolution calls.
    this.setSolution();
    super.reshape(shape);
  }

  setNewConstraints(constraintManager) {
    // Update fixed cell indexes, as we can cache them as long as the
    // constraints remain the same.
    // We need to know them to avoid displaying a solution value over these
    // cells.
    this._fixedCellIndexes = [];
    const fixedCells = constraintManager.getFixedCells();
    for (const cellId of fixedCells) {
      const index = this._shape.parseCellId(cellId).cell;
      this._fixedCellIndexes.push(index);
    }
  }

  // Display solution on grid.
  //  - If solution cell contains a container then it will be displayed as
  //    pencilmarks.
  setSolution(solution) {
    solution = solution || [];
    this._currentSolution = solution.slice();

    // If we have no solution, just hide it instead.
    // However, we wait a bit so that we don't flicker if the solution is updated
    // again immediately.
    if (!solution.length) {
      window.setTimeout(() => {
        // Ensure there is still no solution.
        if (this._currentSolution.length == 0) {
          this.clear();
          this._copyElem.disabled = true;
        }
      }, 10);
      return;
    }

    // We don't want to show anything for cells where the value was
    // fixed.
    if (this._fixedCellIndexes.length) {
      solution = solution.slice();
      for (const index of this._fixedCellIndexes) {
        solution[index] = null;
      }
    }

    this.renderGridValues(solution);

    this._copyElem.disabled = (
      !this._currentSolution.every(v => v && isFinite(v)));
  }
}

class GivensDisplay extends CellValueDisplay {
  drawGivens(givensMap) {
    // Quickly clear the givens display if there are no givens.
    if (!givensMap.size) {
      clearDOMNode(this.getSvg());
      return;
    }

    let grid = new Array(this._shape.numCells).fill(null);
    for (const [cell, values] of givensMap) {
      const index = this._shape.parseCellId(cell).cell;
      grid[index] = values.length == 1 ? values[0] : values;
    }

    // NOTE: We re-render the entire grid each time, but we already do this for
    // solutions which is much more common.
    // This allows us to share code with the solution display.
    this.renderGridValues(grid);
  }

  _multiSolutionToLines(slots) {
    const REPLACE_CHAR = '●';
    slots = slots.map(v => {
      if (typeof v !== 'number') return v;
      if (v < 10) return REPLACE_CHAR;
      return REPLACE_CHAR + ' ';
    });
    return super._multiSolutionToLines(slots);
  }
}

class HighlightDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);

    this._shape = null;
    this._applyGridOffset(svg);
  }

  static makeRadialGradient(id) {
    const gradient = createSvgElement('radialGradient');
    gradient.id = id;

    let stop;

    stop = createSvgElement('stop');
    stop.setAttribute('offset', '70%');
    stop.setAttribute('stop-opacity', '0');
    stop.setAttribute('stop-color', 'rgb(0,255,0)');
    gradient.append(stop);

    stop = createSvgElement('stop');
    stop.setAttribute('offset', '100%');
    stop.setAttribute('stop-opacity', '1');
    stop.setAttribute('stop-color', 'rgb(0,255,0)');
    gradient.append(stop);

    return gradient;
  }

  highlightCell(cellId, cssClass) {
    const parsed = this._shape.parseCellId(cellId);

    const path = this._makeCellSquare(parsed.cell);
    if (cssClass) {
      path.setAttribute('class', cssClass);
    }

    this._svg.appendChild(path);

    return path;
  }

  removeHighlight(path) {
    this._svg.removeChild(path);
  }
}

class ConstraintDisplay extends DisplayItem {
  constructor(inputManager, displayContainer) {
    super();

    this._gridDisplay = new GridDisplay(
      displayContainer.getNewGroup('base-grid-group'));

    this._constraintDisplays = new Map();
    for (const displayClass of ConstraintDisplays.displayOrder()) {
      const name = displayClass.name;
      const groupName = name.toLowerCase() + '-group';
      const group = displayContainer.getNewGroup(groupName);
      this._constraintDisplays.set(name, new displayClass(group));
      this._applyGridOffset(group);
    }

    this._givensDisplay = new GivensDisplay(
      displayContainer.getNewGroup('givens-group'));

    displayContainer.addElement(this._makeArrowhead());
    this._outsideClues = new OutsideClueDisplay(
      displayContainer.getNewGroup('outside-arrow-group'),
      inputManager);
    this._borders = new BorderDisplay(
      displayContainer.getNewGroup('border-group'));

    this.clear();  // clear() to initialize.
  }

  reshape(shape) {
    this._shape = shape;
    this._gridDisplay.reshape(shape);
    for (const display of this._constraintDisplays.values()) {
      display.reshape(shape);
    }
    this._outsideClues.reshape(shape);
    this._borders.reshape(shape);
    this._givensDisplay.reshape(shape);
  }

  // Reusable arrowhead marker.
  _makeArrowhead() {
    let arrowhead = createSvgElement('marker');
    arrowhead.id = 'arrowhead';
    arrowhead.setAttribute('refX', '3');
    arrowhead.setAttribute('refY', '2');
    arrowhead.setAttribute('markerWidth', '4');
    arrowhead.setAttribute('markerHeight', '5');
    arrowhead.setAttribute('orient', 'auto');
    let arrowPath = createSvgElement('path');
    arrowPath.setAttribute('d', 'M 0 0 L 3 2 L 0 4');
    arrowPath.setAttribute('fill', 'none');
    arrowPath.setAttribute('stroke-width', 1);
    arrowPath.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrowhead.appendChild(arrowPath);

    return arrowhead;
  }

  clear() {
    this._givensDisplay.clear();

    for (const display of this._constraintDisplays.values()) {
      display.clear();
    }
  }

  removeItem(item) {
    if (!item) return;
    if (this._constraintDisplays.get('Jigsaw').removeItem(item)) return;
    if (this._constraintDisplays.get('ShadedRegion').removeItem(item)) return;
    if (this._constraintDisplays.get('CustomBinary').removeItem(item)) return;
    if (this._constraintDisplays.get('CountingCircles').removeItem(item)) return;
    item.parentNode.removeChild(item);
  }

  configureOutsideClues(configs) {
    this._outsideClues.configure(configs);
  }

  addOutsideClue(constraintType, lineId, value) {
    this._outsideClues.addOutsideClue(constraintType, lineId, value);
  }

  removeOutsideClue(constraintType, lineId) {
    this._outsideClues.removeOutsideClue(constraintType, lineId);
  }

  drawItem(constraint, displayClass, config) {
    return this._constraintDisplays.get(
      displayClass.name).drawItem(constraint, config);
  }

  toggleItem(constraint, enable, displayClass) {
    return this._constraintDisplays.get(
      displayClass.name).toggleItem(constraint, enable);
  }

  drawGivens(givensMap) {
    this._givensDisplay.drawGivens(givensMap);
  }
}

class GridDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);

    this._applyGridOffset(svg);
    svg.setAttribute('stroke-width', 1);
    svg.setAttribute('stroke', 'rgb(150, 150, 150)');
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();

    const cellSize = DisplayItem.CELL_SIZE;
    const gridSize = cellSize * shape.gridSize;

    const grid = this.getSvg();

    for (let i = 1; i < gridSize; i++) {
      grid.append(this._makePath([
        [0, i * cellSize],
        [gridSize, i * cellSize],
      ]));
      grid.append(this._makePath([
        [i * cellSize, 0],
        [i * cellSize, gridSize],
      ]));
    }
  }
}

class BorderDisplay extends DisplayItem {
  constructor(svg, fill) {
    super(svg);

    this._applyGridOffset(svg);
    svg.setAttribute('stroke-width', 2);
    svg.setAttribute('stroke', 'rgb(0, 0, 0)');

    this._fill = fill;
  }

  gridSizePixels() {
    return DisplayItem.CELL_SIZE * this._shape.gridSize;
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();

    const gridSizePixels = this.gridSizePixels();

    const path = this._makePath([
      [0, 0],
      [0, gridSizePixels],
      [gridSizePixels, gridSizePixels],
      [gridSizePixels, 0],
      [0, 0],
    ]);
    if (this._fill) path.setAttribute('fill', this._fill);
    this.getSvg().append(path);
  }
}

class OutsideClueDisplay extends DisplayItem {
  constructor(svg, inputManager) {
    super(svg);
    this._applyGridOffset(svg);
    this._configs = {};
    inputManager.addSelectionPreserver(svg);

    const form = document.forms['outside-arrow-input'];

    let selectedArrow = null;
    inputManager.onSelection((cells) => {
      if (selectedArrow) selectedArrow.classList.remove('selected-arrow');
      selectedArrow = null;
      form.firstElementChild.disabled = true;
    });

    this._handleClick = (lineId, cells) => {
      const arrow = this._outsideArrowMap.get(lineId);

      inputManager.setSelection(cells);
      form.firstElementChild.disabled = false;
      form.id.value = lineId;
      form.value.select();

      const clueTypes = arrow.clueTypes;
      const configs = this._configs;
      for (const config of Object.values(configs)) {
        config.elem.disabled = !arrow.clueTypes.has(config.clueType);
      }

      // Ensure that the selected type is valid for this arrow.
      if (!clueTypes.has(configs[form.type.value]?.clueType)) {
        // If possible, select an arrow type that is already present.
        if (arrow.currentValues.size) {
          form.type.value = arrow.currentValues.keys().next().value;
        } else {
          for (const [type, config] of Object.entries(configs)) {
            if (clueTypes.has(config.clueType)) {
              form.type.value = type;
              break;
            }
          }
        }
      }

      selectedArrow = arrow.svg;
      selectedArrow.classList.add('selected-arrow');
    };

    this._outsideArrowMap = null;
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();
    this._outsideArrowMap = new Map();

    const diagonalCellMap = SudokuConstraint.LittleKiller.cellMap(shape);
    for (const lineId in diagonalCellMap) {
      this._addArrowSvg(
        'diagonal-arrow', lineId, diagonalCellMap[lineId],
        [OutsideClueConstraints.CLUE_TYPE_DIAGONAL]);
    }
    for (const [lineId, cells] of SudokuConstraintBase.fullLineCellMap(shape)) {
      const clueTypes = [OutsideClueConstraints.CLUE_TYPE_DOUBLE_LINE];
      if (lineId.endsWith(',1')) {
        clueTypes.push(OutsideClueConstraints.CLUE_TYPE_SINGLE_LINE);
      }
      this._addArrowSvg('full-line-arrow', lineId, cells, clueTypes);
    }
  }

  static _makeOutsideClueForm(container, configs) {
    clearDOMNode(container);
    for (const [type, config] of Object.entries(configs)) {
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
      label.textContent = type + ' ';
      const tooltip = document.createElement('span');
      tooltip.classList.add('tooltip');
      tooltip.setAttribute('data-text', config.description);
      label.appendChild(tooltip);
      div.appendChild(label);

      config.elem = input;

      container.appendChild(div);
    }
  }

  configure(configs) {
    this._configs = configs;
    this.constructor._makeOutsideClueForm(
      document.getElementById('outside-arrow-type-options'), configs);
  }

  addOutsideClue(constraintType, arrowId, value) {
    this._outsideArrowMap.get(arrowId).currentValues.set(constraintType, value);
    this._updateArrowValues(arrowId);
  }

  removeOutsideClue(constraintType, arrowId) {
    this._outsideArrowMap.get(arrowId).currentValues.delete(constraintType);
    this._updateArrowValues(arrowId);
  }

  _updateArrowValues(arrowId) {
    const arrow = this._outsideArrowMap.get(arrowId);
    const elem = arrow.svg;

    // Remove all the old values.
    const textNode = elem.lastChild;
    clearDOMNode(textNode);

    // If there are no values, set it inactive and stop.
    const numValues = arrow.currentValues.size;
    if (!numValues) {
      elem.classList.remove('active-arrow');
      return;
    }

    elem.classList.add('active-arrow');

    // Construct the output strings.
    const configs = this._configs;
    const valueStrings = [];
    for (const [type, value] of arrow.currentValues) {
      valueStrings.push(
        configs[type].strTemplate.replace('$CLUE', value));
    }
    if (numValues == 1 || !arrowId.includes(',') || arrowId.startsWith('C')) {
      // For little killers and for columns, the values can be shown
      // horizontally. (For little killers, its because we know there can only
      // be one).
      // This is also trivially true for single values.
      const text = valueStrings.join('');
      textNode.appendChild(document.createTextNode(text));
    } else {
      // For rows, we need to show the values vertically.

      // Set the x position to the default for the text element.
      // This is as if we were positioning a single value.
      const x = textNode.getAttribute('x');
      // The spacing between each value (in line-height units).
      const spacingEm = 1.2;
      // The initial y value needs to be adjusted for the fact we have
      // multiple lines. We are adjusting from a baseline of a single line.
      const initialDyEm = -spacingEm * (numValues - 1) / 2;
      for (let i = 0; i < numValues; i++) {
        const str = valueStrings[i];
        const tspan = createSvgElement('tspan');
        tspan.setAttribute('x', x);
        tspan.setAttribute('dy', (i == 0 ? initialDyEm : spacingEm) + 'em');
        tspan.appendChild(document.createTextNode(str));
        textNode.appendChild(tspan);
      }
    }

    // Choose font size based on the number of values.
    const fontSize = 17 - 2 * arrow.currentValues.size;
    textNode.setAttribute('style', `font-size: ${fontSize}px`);
  }

  _addArrowSvg(arrowType, arrowId, cells, clueTypes) {
    const shape = this._shape;

    const cell0 = shape.parseCellId(cells[0]);
    const cell1 = shape.parseCellId(cells[1]);

    const arrowSvg = this._makeArrow(
      cell0.row, cell0.col,
      cell1.row - cell0.row,
      cell1.col - cell0.col);
    this.getSvg().appendChild(arrowSvg);

    this._outsideArrowMap.set(
      arrowId,
      { svg: arrowSvg, clueTypes: new Set(clueTypes), currentValues: new Map() });
    arrowSvg.onclick = () => this._handleClick(arrowId, cells);
    arrowSvg.classList.add(arrowType);
  };

  _makeArrow(row, col, dr, dc) {
    const shape = this._shape;

    const [x, y] = this.cellIdCenter(shape.makeCellId(row, col));
    const cellSize = DisplayItem.CELL_SIZE;

    const arrowLen = 0.2;
    const arrowX = x - dc * cellSize * (0.5 + arrowLen);
    const arrowY = y - dr * cellSize * (0.5 + arrowLen);
    const d = cellSize * arrowLen - 1;
    const dx = dc * d;
    const dy = dr * d;

    let directions = [
      'M', arrowX, arrowY,
      'L', arrowX + dx, arrowY + dy,
    ];
    let path = createSvgElement('path');
    path.setAttribute('d', directions.join(' '));

    path.setAttribute('marker-end', 'url(#arrowhead)');
    path.setAttribute('fill', 'transparent');
    path.setAttribute('stroke', 'rgb(200, 200, 200)');
    path.setAttribute('stroke-width', 3);
    path.setAttribute('stroke-linecap', 'round');

    let hitboxSize = d + 8;
    let hitbox = createSvgElement('rect');
    hitbox.setAttribute('x', arrowX + dx / 2 - hitboxSize / 2);
    hitbox.setAttribute('y', arrowY + dy / 2 - hitboxSize / 2);
    hitbox.setAttribute('height', hitboxSize);
    hitbox.setAttribute('width', hitboxSize);
    hitbox.setAttribute('fill', 'transparent');

    let text = createSvgElement('text');
    let textOffsetFactor = dx * dy ? 0.6 : 0;
    text.setAttribute('x', arrowX - dx * textOffsetFactor);
    text.setAttribute('y', arrowY - dy * textOffsetFactor);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');

    let arrow = createSvgElement('g');
    arrow.appendChild(hitbox);
    arrow.appendChild(path);
    arrow.appendChild(text);
    arrow.classList.add('outside-arrow');

    return arrow;
  };
}

class ColorPicker {
  // Default color list.
  COLOR_LIST = [
    'green',
    'red',
    'orange',
    'cyan',
    'brown',
    'black',
    'purple',
    'gold',
    'lightblue',
  ];

  constructor() {
    this._keyToColors = new Map();
    this._itemToKeys = new Map();
    this._keyToItems = new Map();
  }

  // Pick a color:
  // - If there is already a color for the given key then use that.
  // - Otherwise pick a color that is not used by any of the avoidKeys.
  // - If avoidKeys is not set then avoid all used keys.
  pickColor(key, avoidKeys) {
    if (key != null && this._keyToColors.has(key)) {
      return this._keyToColors.get(key);
    }

    let avoidColors = null;
    if (!avoidKeys) {
      avoidColors = new Set(this._keyToColors.values());
    } else {
      avoidColors = new Set(
        avoidKeys.map(k => this._keyToColors.get(k)));
    }

    for (const color of this.COLOR_LIST) {
      if (!avoidColors.has(color)) return color;
    }

    return this.constructor._randomColor();
  }

  static _randomColor() {
    return `rgb(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0})`;
  }

  addItem(item, color, ...keys) {
    this._itemToKeys.set(item, new Set(keys));
    for (const key of keys) {
      this._keyToColors.set(key, color);

      if (!this._keyToItems.has(key)) {
        this._keyToItems.set(key, new Set());
      }
      this._keyToItems.get(key).add(item);
    }
  }

  removeItem(item) {
    if (!this._itemToKeys.has(item)) return false;

    for (const key of this._itemToKeys.get(item)) {
      const keyItems = this._keyToItems.get(key);
      keyItems.delete(item);
      // If there are no more items with this key, then remove it.
      if (!keyItems.size) {
        this._keyToColors.delete(key);
        this._keyToItems.delete(key);
      }
    }

    this._itemToKeys.delete(item);

    return true;
  }

  clear() {
    this._keyToColors.clear();
    this._itemToKeys.clear();
    this._keyToItems.clear();
  }
};

class LineOptions {
  color = 'rgb(200, 200, 200)';
  width = 5;
  startMarker;
  endMarker;
  nodeMarker;
  arrow = false;
  dashed = false;

  static DEFAULT_COLOR = 'rgb(200, 200, 200)';
  static THIN_LINE_WIDTH = 2;
  static THICK_LINE_WIDTH = 15;

  static FULL_CIRCLE_MARKER = 1;
  static EMPTY_CIRCLE_MARKER = 2;
  static SMALL_FULL_CIRCLE_MARKER = 3;
  static SMALL_EMPTY_CIRCLE_MARKER = 4;
  static DIAMOND_MARKER = 5;

  constructor(options) {
    Object.assign(this, options);
  }

}