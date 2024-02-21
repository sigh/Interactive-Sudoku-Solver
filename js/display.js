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

  _makeDiagonalPattern(id, color) {
    let pattern = createSvgElement('pattern');
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

  clear() {
    clearDOMNode(this._svg);
  }
}

class ClickInterceptor extends DisplayItem {
  constructor() {
    const svg = createSvgElement('svg');
    svg.classList.add('click-interceptor-svg');

    super(svg);

    this._applyGridOffset(svg);
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

    const LINE_HEIGHT = this._shape.gridSize == SHAPE_9x9.gridSize ? 17 : 10;
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
    const charsPerLine = 2 * shape.boxSize - 1;

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

    this._defaultRegions = new DefaultRegions(
      displayContainer.getNewGroup('default-region-group'));
    this._windokuRegions = new WindokuRegionDisplay(
      displayContainer.getNewGroup('windoku-region-group'));
    this._jigsawRegions = new JigsawRegionDisplay(
      displayContainer.getNewGroup('jigsaw-region-group'));

    this._thermoGroup = displayContainer.getNewGroup('thermo-group');
    this._applyGridOffset(this._thermoGroup);
    this._lineConstraintGroup = displayContainer.getNewGroup('line-constraint-group');
    this._applyGridOffset(this._lineConstraintGroup);
    this._adjConstraintGroup = displayContainer.getNewGroup('adj-constraint-group');
    this._applyGridOffset(this._adjConstraintGroup);
    this._killerCageDisplay = new KillerCageDisplay(
      displayContainer.getNewGroup('killer-cage-group'));

    this._diagonalDisplay = new DiagonalDisplay(
      displayContainer.getNewGroup('diagonal-group'));

    this._customBinaryGroup = displayContainer.getNewGroup('custom-binary-group');
    this._applyGridOffset(this._customBinaryGroup);
    this._customBinaryColors = new ColorPicker();

    this._quadGroup = displayContainer.getNewGroup('quad-group');
    this._applyGridOffset(this._quadGroup);

    this._givensDisplay = new GivensDisplay(
      displayContainer.getNewGroup('givens-group'));

    displayContainer.addElement(this._makeArrowhead());
    this._outsideArrows = new OutsideArrowDisplay(
      displayContainer.getNewGroup('outside-arrow-group'),
      inputManager);
    this._borders = new BorderDisplay(
      displayContainer.getNewGroup('border-group'));

    this.clear();  // clear() to initialize.
  }

  reshape(shape) {
    this._shape = shape;
    this._gridDisplay.reshape(shape);
    this._defaultRegions.reshape(shape);
    this._windokuRegions.reshape(shape);
    this._jigsawRegions.reshape(shape);
    this._outsideArrows.reshape(shape);
    this._diagonalDisplay.reshape(shape);
    this._borders.reshape(shape);
    this._givensDisplay.reshape(shape);
    this._killerCageDisplay.reshape(shape);
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
    clearDOMNode(this._thermoGroup);
    clearDOMNode(this._quadGroup);
    clearDOMNode(this._lineConstraintGroup);
    clearDOMNode(this._adjConstraintGroup);

    clearDOMNode(this._customBinaryGroup);
    this._customBinaryColors.clear();

    this._givensDisplay.clear();

    this._diagonalDisplay.clear();

    this._jigsawRegions.clear();

    this._killerCageDisplay.clear();

    this.enableWindokuRegion(false);
    this.useDefaultRegions(true);
  }

  drawRegion(region) {
    return this._jigsawRegions.drawRegion(region);
  }

  removeItem(item) {
    if (!item) return;
    if (this._jigsawRegions.removeItem(item)) return;
    if (this._killerCageDisplay.removeCage(item)) return;
    this._customBinaryColors.removeItem(item);
    item.parentNode.removeChild(item);
  }

  addOutsideArrow(constraintType, lineId, value) {
    this._outsideArrows.addOutsideArrow(constraintType, lineId, value);
  }

  removeOutsideArrow(constraintType, lineId) {
    this._outsideArrows.removeOutsideArrow(constraintType, lineId);
  }

  drawKillerCage(cells, sum, patterned) {
    return this._killerCageDisplay.drawKillerCage(cells, sum, patterned);
  }

  drawDot(cells, fillColor) {
    if (cells.length != 2) throw (`Dot must be two cells: ${cells}`);

    // Find the midpoint between the squares.
    let [x0, y0] = this.cellIdCenter(cells[0]);
    let [x1, y1] = this.cellIdCenter(cells[1]);
    let x = (x0 + x1) / 2;
    let y = (y0 + y1) / 2;

    let dot = createSvgElement('circle');
    dot.setAttribute('fill', fillColor);
    dot.setAttribute('stroke', 'black');
    dot.setAttribute('stroke-width', 1);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 4);

    this._adjConstraintGroup.append(dot);

    return dot;
  }

  drawCustomBinary(cells, key, type) {
    const g = createSvgElement('g');
    this._customBinaryGroup.append(g);

    const LINE_WIDTH = 2;

    g.setAttribute('stroke-width', LINE_WIDTH);

    const colorKey = `${key}-${type}`;
    const color = this._customBinaryColors.pickColor(colorKey);
    this._customBinaryColors.addItem(g, color, colorKey);
    g.setAttribute('fill', color);
    g.setAttribute('stroke', color);

    const centers = cells.map(c => this.cellIdCenter(c));

    // Draw the line.
    const path = this._makePath(centers);
    path.setAttribute('stroke-dasharray', '2');
    g.appendChild(path);

    // Draw the circles.
    for (let i = 0; i < cells.length; i++) {
      const circle = this._makeCircle(cells[i]);
      if (i == 0 && type != 'BinaryX') {
        circle.setAttribute('r', LINE_WIDTH * 2);
        circle.setAttribute('fill', 'transparent');
        circle.setAttribute('stroke-width', 1);
      } else {
        circle.setAttribute('r', LINE_WIDTH);
      }
      g.appendChild(circle);
    }

    return g;
  }

  drawXV(cells, letter) {
    if (cells.length != 2) throw (`XV be two cells: ${cells}`);

    // Find the midpoint between the squares.
    let [x0, y0] = this.cellIdCenter(cells[0]);
    let [x1, y1] = this.cellIdCenter(cells[1]);
    let x = (x0 + x1) / 2;
    let y = (y0 + y1) / 2;

    const g = createSvgElement('g');

    // Create a white background using a larger font weight.
    let text = this.makeTextNode(letter, x, y, 'xv-display');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('style', 'font-size: 20; font-weight: 900;');
    text.setAttribute('fill', 'white');
    g.append(text);

    // Create the actual text.
    text = this.makeTextNode(letter, x, y, 'xv-display');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('style', 'font-size: 20; font-weight: 100;');
    g.append(text);

    this._adjConstraintGroup.append(g);

    return text;
  }

  _CIRCLE_RADIUS = 15;

  _makeCircle(cell) {
    const [x, y] = this.cellIdCenter(cell);
    let circle = createSvgElement('circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', this._CIRCLE_RADIUS);

    return circle;
  }

  _removeCircleFromLine(p0, p1) {
    const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]];
    const frac = this._CIRCLE_RADIUS / Math.sqrt(dx * dx + dy * dy);
    p0[0] += dx * frac;
    p0[1] += dy * frac;
  }

  drawArrow(cells) {
    if (cells.length < 2) throw (`Arrow too short: ${cells}`)

    let arrow = createSvgElement('g');
    arrow.setAttribute('fill', 'transparent');
    arrow.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrow.setAttribute('stroke-width', 3);
    arrow.setAttribute('stroke-linecap', 'round');

    // Draw the circle.
    arrow.appendChild(this._makeCircle(cells[0]));

    const points = cells.map(c => this.cellIdCenter(c));
    this._removeCircleFromLine(points[0], points[1])

    // Draw the line.
    const path = this._makePath(points);
    path.setAttribute('marker-end', 'url(#arrowhead)');

    arrow.appendChild(path);

    this._lineConstraintGroup.append(arrow);

    return arrow;
  }

  drawDoubleArrow(cells) {
    if (cells.length < 2) throw (`Arrow too short: ${cells}`)

    let arrow = createSvgElement('g');
    arrow.setAttribute('fill', 'transparent');
    arrow.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrow.setAttribute('stroke-width', 3);
    arrow.setAttribute('stroke-linecap', 'round');

    // Draw the circles.
    arrow.appendChild(this._makeCircle(cells[0]));
    arrow.appendChild(this._makeCircle(
      cells[cells.length - 1]));

    const points = cells.map(c => this.cellIdCenter(c));
    this._removeCircleFromLine(points[0], points[1])
    this._removeCircleFromLine(
      points[points.length - 2], points[points.length - 1])

    // Draw the line.
    const path = this._makePath(points);

    arrow.appendChild(path);

    this._lineConstraintGroup.append(arrow);

    return arrow;
  }

  _drawConstraintLine(cells, color) {
    if (cells.length < 2) throw (`Line too short: ${cells}`)

    const line = this._makePath(cells.map(c => this.cellIdCenter(c)));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', 5);
    line.setAttribute('stroke-linecap', 'round');

    this._lineConstraintGroup.append(line);

    return line;
  }

  drawWhisper(cells) {
    return this._drawConstraintLine(cells, 'rgb(255, 200, 255)');
  }

  drawRenban(cells) {
    return this._drawConstraintLine(cells, 'rgb(230, 190, 155)');
  }

  drawRegionSumLine(cells) {
    return this._drawConstraintLine(cells, 'rgb(100, 255, 100)');
  }

  drawBetween(cells) {
    const len = cells.length;
    if (len < 2) throw (`Line too short: ${cells}`)

    let between = createSvgElement('g');
    between.setAttribute('stroke', 'rgb(200, 200, 255)');
    between.setAttribute('stroke-width', 3);
    between.setAttribute('stroke-linecap', 'round');
    between.setAttribute('fill', 'transparent');

    // Draw the circle.
    between.appendChild(this._makeCircle(cells[0]));
    between.appendChild(this._makeCircle(cells[len - 1]));

    const points = cells.map(c => this.cellIdCenter(c));
    this._removeCircleFromLine(points[0], points[1])
    this._removeCircleFromLine(points[len - 1], points[len - 2])
    const path = this._makePath(points);
    between.appendChild(path);

    this._lineConstraintGroup.append(between);

    return between;
  }

  drawPalindrome(cells) {
    return this._drawConstraintLine(cells, 'rgb(200, 200, 255)');
  }

  drawThermometer(cells) {
    if (cells.length < 2) throw (`Thermo too short: ${cells}`)

    let thermo = createSvgElement('g');
    thermo.setAttribute('fill', 'rgb(220, 220, 220)');
    thermo.setAttribute('stroke', 'rgb(220, 220, 220)');

    // Draw the circle.
    thermo.appendChild(this._makeCircle(cells[0]));

    // Draw the line.
    const path = this._makePath(cells.map(c => this.cellIdCenter(c)));
    path.setAttribute('stroke-width', 15);
    path.setAttribute('stroke-linecap', 'round');
    thermo.appendChild(path);

    this._thermoGroup.append(thermo);

    return thermo;
  }

  drawQuad(topLeftCell, values) {
    const quad = createSvgElement('g');
    const QUAD_CIRCLE_RADIUS = 10;
    const QUAD_TEXT_OFFSET = 5;

    const [cx, cy] = this.cellIdBottomRightCorner(topLeftCell);
    const circle = createSvgElement('circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', QUAD_CIRCLE_RADIUS);
    circle.setAttribute('fill', 'white');
    circle.setAttribute('stroke', 'black');
    circle.setAttribute('stroke-width', 1);
    quad.appendChild(circle);

    // Space out values evenly around the circle.
    const numValues = values.length;
    const angleInc = 2 * Math.PI / numValues;
    const startAngle = numValues > 2 ? - Math.PI / 2 : Math.PI;
    const offset = numValues == 1 ? 0 : QUAD_TEXT_OFFSET;
    for (let i = 0; i < numValues; i++) {
      const value = values[i];
      const x = cx + Math.cos(startAngle + i * angleInc) * offset;
      const y = 1 + cy + Math.sin(startAngle + i * angleInc) * offset;
      const text = this.makeTextNode(value, x, y, 'quad-value');
      quad.appendChild(text);
    }

    this._quadGroup.append(quad);

    return quad;
  }

  drawDiagonal(direction) {
    this._diagonalDisplay.drawDiagonal(direction);
  }

  removeDiagonal(direction) {
    this._diagonalDisplay.removeDiagonal(direction);
  }

  drawGivens(givensMap) {
    this._givensDisplay.drawGivens(givensMap);
  }

  useDefaultRegions(enable) {
    this._defaultRegions.enable(enable);
  }

  enableWindokuRegion(enable) {
    this._windokuRegions.enableWindokuRegion(enable);
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

class DefaultRegions extends DisplayItem {
  constructor(svg) {
    super(svg);

    this._applyGridOffset(svg);
    svg.setAttribute('stroke-width', 2);
    svg.setAttribute('stroke', 'rgb(0, 0, 0)');
    svg.setAttribute('stroke-linecap', 'round');
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();

    const cellSize = DisplayItem.CELL_SIZE;
    const gridSizePixels = cellSize * shape.gridSize;
    const svg = this.getSvg();

    for (let i = shape.boxSize; i < shape.gridSize; i += shape.boxSize) {
      svg.appendChild(this._makePath([
        [0, i * cellSize],
        [gridSizePixels, i * cellSize],
      ]));
      svg.appendChild(this._makePath([
        [i * cellSize, 0],
        [i * cellSize, gridSizePixels],
      ]));
    }
  }

  enable(enable) {
    this.getSvg().setAttribute('display', enable ? null : 'none');
  }
}

class WindokuRegionDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);
    this._applyGridOffset(svg);

    svg.setAttribute('fill', 'rgb(255, 0, 255)');
    svg.setAttribute('opacity', '0.1');

    this.enableWindokuRegion(false);
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();

    const svg = this.getSvg();

    for (const region of SudokuConstraint.Windoku.regions(shape)) {
      for (const cell of region) {
        svg.append(this._makeCellSquare(cell));
      }
    }
  }

  enableWindokuRegion(enable) {
    this.getSvg().setAttribute('display', enable ? null : 'none');
  }
}

class JigsawRegionDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);
    this._applyGridOffset(svg);

    this._regionGroup = createSvgElement('g');
    svg.append(this._regionGroup);

    this._regionElems = null;

    this._missingRegion = createSvgElement('g');
    this._missingRegion.setAttribute('fill', 'rgb(0, 0, 0)');
    this._missingRegion.setAttribute('opacity', '0.05');
    svg.append(this._missingRegion);

    this.clear();
  }

  clear() {
    clearDOMNode(this._regionGroup);
    this._regionElems = new Map();
    this._updateMissingRegion();
  }

  removeItem(item) {
    if (this._regionElems.has(item)) {
      item.parentNode.removeChild(item);
      this._regionElems.delete(item);
      this._updateMissingRegion();
      return true;
    }
    return false;
  }

  drawRegion(region) {
    const cellSet = new Set(region.map(c => this._shape.parseCellId(c).cell));

    const g = createSvgElement('g');
    g.setAttribute('stroke-width', 2);
    g.setAttribute('stroke', 'rgb(100, 100, 100)');
    g.setAttribute('stroke-linecap', 'round');

    const cellSize = DisplayItem.CELL_SIZE;

    for (const cell of cellSet) {
      const [row, col] = this._shape.splitCellIndex(cell);

      const cellUp = this._shape.cellIndex(row - 1, col);
      const cellDown = this._shape.cellIndex(row + 1, col);
      const cellLeft = this._shape.cellIndex(row, col - 1);
      const cellRight = this._shape.cellIndex(row, col + 1);

      if (!cellSet.has(cellLeft)) {
        g.appendChild(this._makePath([
          [col * cellSize, row * cellSize],
          [col * cellSize, (row + 1) * cellSize],
        ]));
      }
      if (!cellSet.has(cellRight)) {
        g.appendChild(this._makePath([
          [(col + 1) * cellSize, row * cellSize],
          [(col + 1) * cellSize, (row + 1) * cellSize],
        ]));
      }
      if (!cellSet.has(cellUp)) {
        g.appendChild(this._makePath([
          [col * cellSize, row * cellSize],
          [(col + 1) * cellSize, row * cellSize],
        ]));
      }
      if (!cellSet.has(cellDown)) {
        g.appendChild(this._makePath([
          [col * cellSize, (row + 1) * cellSize],
          [(col + 1) * cellSize, (row + 1) * cellSize],
        ]));
      }
    }

    this._regionGroup.appendChild(g);
    this._regionElems.set(g, region);
    this._updateMissingRegion();

    return g;
  }

  _updateMissingRegion() {
    // Clear missing region.
    const svg = this._missingRegion;
    while (svg.lastChild) {
      svg.removeChild(svg.lastChild);
    }

    // Don't shade in anything if there are no jigsaw pieces.
    if (this._regionElems.size == 0) return;

    // Find the current missing cells.
    const missingCells = new Set();
    for (let i = 0; i < this._shape.numCells; i++) missingCells.add(i);
    this._regionElems.forEach(
      cs => cs.forEach(c => missingCells.delete(this._shape.parseCellId(c).cell)));

    // Shade in the missing cells.
    for (const cell of missingCells) {
      svg.appendChild(this._makeCellSquare(cell));
    }
  }
}

class OutsideArrowDisplay extends DisplayItem {
  constructor(svg, inputManager) {
    super(svg);
    this._applyGridOffset(svg);
    inputManager.addSelectionPreserver(svg);

    const form = document.forms['outside-arrow-input'];

    let selectedArrow = null;
    inputManager.onSelection((cells) => {
      if (selectedArrow) selectedArrow.classList.remove('selected-arrow');
      selectedArrow = null;
      form.firstElementChild.disabled = true;
    });
    const formOptions = new Map([
      ['LittleKiller', document.getElementById('little-killer-option')],
      ['Sandwich', document.getElementById('sandwich-option')],
      ['XSum', document.getElementById('xsum-option')],
      ['Skyscraper', document.getElementById('skyscraper-option')],
    ]);

    this._handleClick = (lineId, cells) => {
      const arrow = this._outsideArrowMap.get(lineId);

      inputManager.setSelection(cells);
      form.firstElementChild.disabled = false;
      form.id.value = lineId;
      form.value.select();

      const types = arrow.constraintTypes;
      for (let [type, option] of formOptions) {
        option.disabled = !types.includes(type);
      }

      // Ensure that the selected type is valid for this arrow.
      if (!types.includes(form.type.value)) {
        // If possible, select an arrow type that is already present.
        if (arrow.currentValues.size) {
          form.type.value = arrow.currentValues.keys().next().value;
        } else {
          form.type.value = types[0];
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

    const littleKillerCellMap = SudokuConstraint.LittleKiller.cellMap(shape);
    for (const lineId in littleKillerCellMap) {
      this._addArrowSvg('diagonal-arrow', lineId, littleKillerCellMap[lineId]);
      this._outsideArrowMap.get(lineId).constraintTypes.push('LittleKiller');
    }
    for (const [lineId, cells] of SudokuConstraintBase.fullLineCellMap(shape)) {
      this._addArrowSvg('full-line-arrow', lineId, cells);
      if (lineId.endsWith(',1')) {
        this._outsideArrowMap.get(lineId).constraintTypes.push('Sandwich');
      }
      this._outsideArrowMap.get(lineId).constraintTypes.push('XSum');
      this._outsideArrowMap.get(lineId).constraintTypes.push('Skyscraper');
    }
  }

  addOutsideArrow(constraintType, arrowId, value) {
    this._outsideArrowMap.get(arrowId).currentValues.set(constraintType, value);
    this._updateArrowValues(arrowId);
  }

  removeOutsideArrow(constraintType, arrowId) {
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
    const valueStrings = [];
    for (const [type, value] of arrow.currentValues) {
      let valueStr = value;
      switch (type) {
        case 'XSum':
          valueStr = `⟨${value}⟩`;
          break;
        case 'Skyscraper':
          valueStr = `[${value}]`;
          break;
      }
      valueStrings.push(valueStr);
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

  _addArrowSvg(arrowType, arrowId, cells) {
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
      { svg: arrowSvg, constraintTypes: [], currentValues: new Map() });
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

class DiagonalDisplay extends DisplayItem {
  DIRECTIONS = [1, -1];

  constructor(svg) {
    super(svg);
    this._applyGridOffset(svg);
    this._diagonals = [null, null];

    svg.setAttribute('stroke-width', 1);
    svg.setAttribute('stroke', 'rgb(255, 0, 0)');
  }

  _directionIndex(direction) {
    return direction > 0;
  }

  drawDiagonal(direction) {
    const index = this._directionIndex(direction);
    if (this._diagonals[index]) return this._diagonals[index];

    const shape = this._shape;

    const size = DisplayItem.CELL_SIZE * shape.gridSize;
    const line = this._makePath([
      [0, direction > 0 ? size : 0],
      [size, direction > 0 ? 0 : size],
    ]);

    this.getSvg().appendChild(line);
    this._diagonals[index] = line;

    return line;
  }

  removeDiagonal(direction) {
    const index = this._directionIndex(direction);
    let item = this._diagonals[index];
    if (item) item.parentNode.removeChild(item);
    this._diagonals[index] = null;
  }

  clear() {
    for (const direction of this.DIRECTIONS) {
      this.removeDiagonal(direction);
    }
  }

  reshape(shape) {
    super.reshape(shape);

    // Redraw the diagonals with the correct shape.
    for (const direction of this.DIRECTIONS) {
      const index = this._directionIndex(direction);
      if (this._diagonals[index]) {
        this.removeDiagonal(direction);
        this.drawDiagonal(direction);
      }
    }
  }
}

class KillerCageDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);
    this._applyGridOffset(svg);
    this._unusedPatternId = 0;
    this._killerCellColors = new ColorPicker();

    this.clear();
  }

  clear() {
    super.clear();
    this._killerCellColors.clear();
  }

  removeCage(item) {
    if (this._killerCellColors.removeItem(item)) {
      item.parentNode.removeChild(item);
      return true;
    }
    return false;
  }

  drawKillerCage(cells, sum, patterned) {
    let x, y;

    const cage = createSvgElement('g');
    const color = this._chooseKillerCageColor(cells);

    let patternId = null;
    if (patterned) {
      patternId = 'sum-pattern-' + this._unusedPatternId++;
      cage.appendChild(this._makeDiagonalPattern(patternId, color));
    }

    for (const cellId of cells) {
      const path = this._makeCellSquare(this._shape.parseCellId(cellId).cell);
      if (patterned) {
        path.setAttribute('fill', `url(#${patternId})`);
      } else {
        path.setAttribute('fill', color);
      }
      path.setAttribute('opacity', '0.1');

      cage.appendChild(path);
    }
    this._killerCellColors.addItem(cage, color, ...cells);

    // Draw the sum in the top-left most cell. Luckily, this is the sort order.
    cells.sort();
    [x, y] = this.cellIdTopLeftCorner(cells[0]);

    const text = this.makeTextNode(
      sum, x, y, 'killer-cage-sum');
    cage.append(text);
    this.getSvg().append(cage);

    let textBackground = this.constructor._addTextBackground(text);
    textBackground.setAttribute('fill', 'rgb(200, 200, 200)');

    return cage;
  }

  static _addTextBackground(elem) {
    const bbox = elem.getBBox();
    const rect = createSvgElement('rect');

    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);

    elem.parentNode.insertBefore(rect, elem);
    return rect;
  }

  _chooseKillerCageColor(cellIds) {
    const shape = this._shape;
    // Use a greedy algorithm to choose the graph color.
    const adjacentCells = [];
    for (const cellId of cellIds) {
      let { row, col } = shape.parseCellId(cellId);
      // Lookup all adjacent cells, it doesn't matter if they valid or not.
      adjacentCells.push(shape.makeCellId(row, col + 1));
      adjacentCells.push(shape.makeCellId(row, col - 1));
      adjacentCells.push(shape.makeCellId(row + 1, col));
      adjacentCells.push(shape.makeCellId(row - 1, col));
    }
    return this._killerCellColors.pickColor(null, adjacentCells);
  }
}

class ColorPicker {
  // Default color list.
  COLOR_LIST = [
    'green',
    'red',
    'blue',
    'orange',
    'cyan',
    'brown',
    'black',
    'purple',
    'gold',
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
    this._itemToKeys.set(item, keys);
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