class DisplayContainer {
  constructor(container) {
    const padding = DisplayItem.SVG_PADDING;
    container.style.padding = `${padding}px`;
    this._container = container;

    const svg = createSvgElement('svg');
    svg.classList.add('sudoku-display-svg');
    svg.classList.add('main-sudoku-display-svg');

    this._mainSvg = svg;
    this._container.append(svg);

    this._highlightDisplay = new HighlightDisplay(
      this.getNewGroup('highlight-group'));

    this._clickInterceptor = new ClickInterceptor();
    this._container.append(this._clickInterceptor.getSvg());
  }

  reshape(shape) {
    this._container.className = '';
    this._container.classList.add('sudoku-grid');
    this._container.classList.add(`size-${shape.name}`);

    const padding = DisplayItem.SVG_PADDING;
    const sideLength = DisplayItem.CELL_SIZE * shape.gridSize + padding*2;
    this._mainSvg.setAttribute('height', sideLength);
    this._mainSvg.setAttribute('width', sideLength);

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

  cellIdCenter(cellId) {
    const {row, col} = this._shape.parseCellId(cellId);
    return DisplayItem._cellCenter(row, col);
  }

  cellIdCorner(cellId) {
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = this.cellIdCenter(cellId);
    return [x - cellWidth/2, y - cellWidth/2 + 2];
  }

  cellCenter(cell) {
    return DisplayItem._cellCenter(...this._shape.splitCellIndex(cell));
  }

  static _cellCenter(row, col) {
    const cellSize = DisplayItem.CELL_SIZE;
    return [col*cellSize + cellSize/2, row*cellSize + cellSize/2];
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
      'M', x-cellWidth/2+1, y-cellWidth/2+1,
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

  clear() {
    clearDOMNode(this._svg);
  }
}

class ClickInterceptor extends DisplayItem {
  constructor() {
    const svg = createSvgElement('svg');
    svg.classList.add('sudoku-display-svg');
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
    const row = y/DisplayItem.CELL_SIZE|0;
    const col = x/DisplayItem.CELL_SIZE|0;
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
    const [x, y] = this.cellIdCorner(cellId);
    const textNode = this.makeTextNode(str, x, y, 'info-overlay-item');
    this._svg.append(textNode);
  }
}

class SolutionDisplay extends DisplayItem {
  constructor(constraintManager, svg) {
    super(svg);
    this._solutionValues = [];
    this._constraintManager = constraintManager;

    this._applyGridOffset(svg);

    this.setSolution = deferUntilAnimationFrame(this.setSolution.bind(this));
  }

  reshape(shape) {
    // This clears the solution, but importantly it overwrites any pending
    // setSolution calls.
    this.setSolution();
    super.reshape(shape);
  }

  // Display solution on grid.
  //  - If solution contains mutiple values for single cell, they will be shown
  //    as pencil marks.
  //  - Anything in pencilmarks will always be shown as pencil marks.
  setSolution(solution, pencilmarks) {
    pencilmarks = pencilmarks || [];
    solution = solution || [];
    this._solutionValues = [];

    // If we have no solution, just hide it instead.
    // However, we wait a bit so that we don't fliker if the solution is updated
    // again immediatly.
    if (!solution.length && !pencilmarks.length) {
      window.setTimeout(() => {
        // Ensure there is still no solution.
        if (this._solutionValues.length == 0) {
          this._svg.classList.add('hidden-solution');
        }
      }, 10);
      return;
    }

    clearDOMNode(this._svg);

    let cellValues = new Map();
    let pencilmarkCell = new Set();

    const handleValue = (valueId) => {
      let {cellId, value} = this._shape.parseValueId(valueId);
      this._solutionValues.push(valueId);

      if (!cellValues.has(cellId)) cellValues.set(cellId, []);
      cellValues.get(cellId).push(value);
      return cellId;
    };
    for (const valueId of solution) {
      handleValue(valueId);
    }
    for (const valueId of pencilmarks) {
      let cellId = handleValue(valueId);
      pencilmarkCell.add(cellId);
    }

    for (const cellId of this._constraintManager.getFixedCells()) {
      cellValues.delete(cellId);
    }

    const LINE_HEIGHT = this._shape.gridSize == SHAPE_9x9.gridSize ? 17 : 10;
    const START_OFFSET = -DisplayItem.CELL_SIZE/2+2;
    for (const [cellId, values] of cellValues) {
      const [x, y] = this.cellIdCenter(cellId);

      if (values.length == 1 && !pencilmarkCell.has(cellId)) {
        this._svg.append(this.makeTextNode(
          values[0], x, y, 'solution-value'));
      } else {
        let offset = START_OFFSET;
        for (const line of this._formatMultiSolution(values)) {
          this._svg.append(this.makeTextNode(
            line, x, y+offset, 'solution-multi-value'));
          offset += LINE_HEIGHT;
        }
      }
    }

    this._svg.classList.remove('hidden-solution');
  }

  _makeTemplateArray = memoize((shape) => {
    const charsPerLine = 2*shape.boxSize-1;

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
    const slots = [...this._makeTemplateArray(this._shape)];
    for (const v of values) {
      slots[v*2-2] = v;
    }
    return slots.join('').split(/\n/);
  }

  getSolutionValues() {
    return [this._solutionValues, this._shape];
  }
}

class HighlightDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);

    this._shape = null;
    this._applyGridOffset(svg);
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

    this._constraintGroup = displayContainer.getNewGroup('constraint-group');
    this._applyGridOffset(this._constraintGroup);

    // TODO: Split out fixedValue and killer cages into their
    // own classes.
    this._fixedValueGroup = displayContainer.getNewGroup('fixed-value-group');
    this._applyGridOffset(this._fixedValueGroup);

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
    this._borders.reshape(shape);
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
    clearDOMNode(this._constraintGroup);

    clearDOMNode(this._fixedValueGroup);
    this._fixedValueMap = new Map();

    this.killerCellColors = new Map();
    this.killerCages = new Map();
    this._diagonals = [null, null];

    this._jigsawRegions.clear();

    this.enableWindokuRegion(false);
    this.useDefaultRegions(true);
  }

  drawRegion(region) {
    return this._jigsawRegions.drawRegion(region);
  }

  removeItem(item) {
    if (!item) return;
    if (this._jigsawRegions.removeItem(item)) return;

    item.parentNode.removeChild(item);
    if (this.killerCages.has(item)) {
      for (const cellId of this.killerCages.get(item)) {
        this.killerCellColors.delete(cellId);
      }
      this.killerCages.delete(item);
    }
  }

  static _addTextBackground(elem) {
    let bbox = elem.getBBox();
    let rect = createSvgElement('rect');

    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);

    elem.parentNode.insertBefore(rect, elem);
    return rect;
  }

  static KILLER_CAGE_COLORS = [
    'green',
    'red',
    'blue',
    'yellow',
    'cyan',
    'brown',
    'black',
    'purple',
    'orange',
  ];

  _chooseKillerCageColor(cellIds) {
    // Use a greedy algorithm to choose the graph color.
    let conflictingColors = new Set();
    for (const cellId of cellIds) {
      let {row, col} = this._shape.parseCellId(cellId);
      // Lookup all  adjacent cells, it doesn't matter if they valid or not.
      conflictingColors.add(this.killerCellColors.get(this._shape.makeCellId(row, col+1)));
      conflictingColors.add(this.killerCellColors.get(this._shape.makeCellId(row, col-1)));
      conflictingColors.add(this.killerCellColors.get(this._shape.makeCellId(row+1, col)));
      conflictingColors.add(this.killerCellColors.get(this._shape.makeCellId(row-1, col)));
    }
    // Return the first color that doesn't conflict.
    for (const color of this.constructor.KILLER_CAGE_COLORS) {
      if (!conflictingColors.has(color)) return color;
    }
    // Otherwse select a random color.
    return `rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;
  }

  addOutsideArrow(id, sum) {
    this._outsideArrows.addOutsideArrow(id, sum);
  }

  removeOutsideArrow(initialCell) {
    this._outsideArrows.removeOutsideArrow(initialCell);
  }

  drawKillerCage(cells, sum) {
    let x,y;

    const cage = createSvgElement('g');
    const color = this._chooseKillerCageColor(cells);

    for (const cellId of cells) {
      const path = this._makeCellSquare(this._shape.parseCellId(cellId).cell);
      path.setAttribute('fill', color);
      path.setAttribute('opacity', '0.1');

      cage.appendChild(path);
    }
    this.killerCages.set(cage, [...cells]);
    cells.forEach(cell => this.killerCellColors.set(cell, color));

    // Draw the sum in the top-left most cell. Luckly, this is the sort order.
    cells.sort();
    [x, y] = this.cellIdCorner(cells[0]);

    let text = createSvgElement('text');
    text.appendChild(document.createTextNode(sum));
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('class', 'killer-cage-sum');
    cage.append(text);
    this._constraintGroup.append(cage);

    let textBackground = ConstraintDisplay._addTextBackground(text);
    textBackground.setAttribute('fill', 'rgb(200, 200, 200)');

    return cage;
  }

  drawDot(cells, fillColor) {
    if (cells.length != 2) throw(`White dot must be two cells: ${cells}`)

    // Find the midpoint between the squares.
    let [x0, y0] = this.cellIdCenter(cells[0]);
    let [x1, y1] = this.cellIdCenter(cells[1]);
    let x = (x0+x1)/2;
    let y = (y0+y1)/2;

    let dot = createSvgElement('circle');
    dot.setAttribute('fill', fillColor);
    dot.setAttribute('stroke', 'black');
    dot.setAttribute('stroke-width', 1);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 4);

    this._constraintGroup.append(dot);

    return dot;
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
    const [dx, dy] = [p1[0]-p0[0], p1[1]-p0[1]];
    const frac = this._CIRCLE_RADIUS/Math.sqrt(dx*dx+dy*dy);
    p0[0] += dx*frac;
    p0[1] += dy*frac;
  }

  drawArrow(cells) {
    if (cells.length < 2) throw(`Arrow too short: ${cells}`)

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

    this._constraintGroup.append(arrow);

    return arrow;
  }

  _drawConstraintLine(cells, color) {
    if (cells.length < 2) throw(`Line too short: ${cells}`)

    const line = this._makePath(cells.map(c => this.cellIdCenter(c)));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', 5);
    line.setAttribute('stroke-linecap', 'round');

    this._constraintGroup.append(line);

    return line;
  }

  drawWhisper(cells) {
    return this._drawConstraintLine(cells, 'rgb(255, 200, 255)');
  }

  drawBetween(cells) {
    const len = cells.length;
    if (len < 2) throw(`Line too short: ${cells}`)

    let between  = createSvgElement('g');
    between.setAttribute('stroke', 'rgb(200, 200, 200)');
    between.setAttribute('stroke-width', 3);
    between.setAttribute('stroke-linecap', 'round');
    between.setAttribute('fill', 'transparent');

    // Draw the circle.
    between.appendChild(this._makeCircle(cells[0]));
    between.appendChild(this._makeCircle(cells[len-1]));

    const points = cells.map(c => this.cellIdCenter(c));
    this._removeCircleFromLine(points[0], points[1])
    this._removeCircleFromLine(points[len-1], points[len-2])
    const path = this._makePath(points);
    between.appendChild(path);

    this._constraintGroup.append(between);

    return between;
  }

  drawPalindrome(cells) {
    return this._drawConstraintLine(cells, 'rgb(200, 200, 255)');
  }

  drawThermometer(cells) {
    if (cells.length < 2) throw(`Thermo too short: ${cells}`)

    let thermo = createSvgElement('g');
    thermo.setAttribute('fill', 'rgb(200, 200, 200)');
    thermo.setAttribute('stroke', 'rgb(200, 200, 200)');

    // Draw the circle.
    thermo.appendChild(this._makeCircle(cells[0]));

    // Draw the line.
    const path = this._makePath(cells.map(c => this.cellIdCenter(c)));
    path.setAttribute('stroke-width', 15);
    path.setAttribute('stroke-linecap', 'round');
    thermo.appendChild(path);

    this._constraintGroup.append(thermo);

    return thermo;
  }

  drawDiagonal(direction) {
    const size = DisplayItem.CELL_SIZE*this._shape.gridSize;
    const line = this._makePath([
      [0, direction > 0 ? size : 0],
      [size, direction > 0 ? 0 : size],
    ]);
    line.setAttribute('stroke-width', 1);
    line.setAttribute('stroke', 'rgb(255, 0, 0)');

    this._constraintGroup.appendChild(line);
    this._diagonals[direction > 0] = line;

    return line;
  }

  removeDiagonal(direction) {
    let item = this._diagonals[direction > 0];
    if (item) this.removeItem(item);
  }

  drawFixedValue(cell, value) {
    // Clear the old value.
    const oldText = this._fixedValueMap.get(cell);
    if (oldText) {
      this._fixedValueGroup.removeChild(oldText);
      this._fixedValueMap.delete(cell);
    }

    // If we are unsetting the cell, nothing else to do.
    if (value === '' || value === undefined) return;

    // Create and append the new node.
    const text = createSvgElement('text');
    text.setAttribute('class', 'fixed-value');
    text.appendChild(document.createTextNode(value));
    const [x, y] = this.cellIdCenter(cell);
    text.setAttribute('x', x);
    text.setAttribute('y', y);

    this._fixedValueGroup.append(text);

    this._fixedValueMap.set(cell, text);
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
    const gridSize = cellSize*shape.gridSize;

    const grid = this.getSvg();

    for (let i = 1; i < gridSize; i++) {
      grid.append(this._makePath([
        [0, i*cellSize],
        [gridSize, i*cellSize],
      ]));
      grid.append(this._makePath([
        [i*cellSize, 0],
        [i*cellSize, gridSize],
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
    return DisplayItem.CELL_SIZE*this._shape.gridSize;
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
    const gridSizePixels = cellSize*shape.gridSize;
    const svg = this.getSvg();

    for (let i = shape.boxSize; i < shape.gridSize; i+=shape.boxSize) {
      svg.appendChild(this._makePath([
        [0, i*cellSize],
        [gridSizePixels, i*cellSize],
      ]));
      svg.appendChild(this._makePath([
        [i*cellSize, 0],
        [i*cellSize, gridSizePixels],
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

    // Windoku only works for 9x9, but we can just be agnostic to that here.
    for (const region of SudokuConstraint.Windoku.REGIONS) {
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

      const cellUp    = this._shape.cellIndex(row-1, col);
      const cellDown  = this._shape.cellIndex(row+1, col);
      const cellLeft  = this._shape.cellIndex(row, col-1);
      const cellRight = this._shape.cellIndex(row, col+1);

      if (!cellSet.has(cellLeft)) {
        g.appendChild(this._makePath([
          [col*cellSize, row*cellSize],
          [col*cellSize, (row+1)*cellSize],
        ]));
      }
      if (!cellSet.has(cellRight)) {
        g.appendChild(this._makePath([
          [(col+1)*cellSize, row*cellSize],
          [(col+1)*cellSize, (row+1)*cellSize],
        ]));
      }
      if (!cellSet.has(cellUp)) {
        g.appendChild(this._makePath([
          [col*cellSize, row*cellSize],
          [(col+1)*cellSize, row*cellSize],
        ]));
      }
      if (!cellSet.has(cellDown)) {
        g.appendChild(this._makePath([
          [col*cellSize, (row+1)*cellSize],
          [(col+1)*cellSize, (row+1)*cellSize],
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
    const selectionForm = document.forms['multi-cell-constraint-input'].firstElementChild;

    let selectedArrow = null;
    inputManager.onSelection((cells) => {
      if (selectedArrow) selectedArrow.classList.remove('selected-arrow');
      selectedArrow = null;
      form.firstElementChild.disabled = true;
    });
    const formOptions = [
      document.getElementById('little-killer-option'),
      document.getElementById('sandwich-option'),
    ];

    this._handleClick = (type, id, cells, arrowSvg) => {
      inputManager.setSelection(cells);
      selectionForm.disabled = true;
      form.firstElementChild.disabled = false;
      form.type.value = type;
      form.id.value = id;
      form.sum.select();

      for (let option of formOptions) option.disabled = true;
      document.getElementById(type+'-option').disabled = false;

      selectedArrow = arrowSvg;
      selectedArrow.classList.add('selected-arrow');
    };

    this._outsideArrowMap = null;
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();
    this._outsideArrowMap = new Map();

    const littleKillerCellMap = SudokuConstraint.LittleKiller.cellMap(shape);
    for (const id in littleKillerCellMap) {
      this._addArrow('little-killer', id, littleKillerCellMap[id]);
    }
    const sandwichCellMap = SudokuConstraint.Sandwich.cellMap(shape);
    for (const id in sandwichCellMap) {
      this._addArrow('sandwich', id, sandwichCellMap[id]);
    }
  }

  addOutsideArrow(id, sum) {
    const elem = this._outsideArrowMap.get(id);
    elem.classList.add('active-arrow');

    const text = elem.lastChild;
    if (text.lastChild) text.removeChild(text.lastChild);
    text.appendChild(document.createTextNode(sum));

    return elem;
  }

  removeOutsideArrow(initialCell) {
    const elem = this._outsideArrowMap.get(initialCell);
    elem.classList.remove('active-arrow');

    const text = elem.lastChild;
    if (text.lastChild) text.removeChild(text.lastChild);
  }

  _addArrow(type, id, cells) {
    const shape = this._shape;

    const cell0 = shape.parseCellId(cells[0]);
    const cell1 = shape.parseCellId(cells[1]);

    const arrowSvg = this._makeArrow(
      cell0.row, cell0.col,
      cell1.row-cell0.row,
      cell1.col-cell0.col);
    this.getSvg().appendChild(arrowSvg);

    this._outsideArrowMap.set(id, arrowSvg);
    arrowSvg.onclick = () => this._handleClick(type, id, cells, arrowSvg);
    arrowSvg.classList.add(type);
  };

  _makeArrow(row, col, dr, dc) {
    const shape = this._shape;

    const [x, y] = this.cellIdCenter(shape.makeCellId(row, col));
    const cellSize = DisplayItem.CELL_SIZE;

    const arrowLen = 0.2;
    const arrowX = x - dc * cellSize*(0.5 + arrowLen);
    const arrowY = y - dr * cellSize*(0.5 + arrowLen);
    const d = cellSize*arrowLen-1;
    const dx = dc*d;
    const dy = dr*d;

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
    hitbox.setAttribute('x', arrowX + dx/2 - hitboxSize/2);
    hitbox.setAttribute('y', arrowY + dy/2 - hitboxSize/2);
    hitbox.setAttribute('height', hitboxSize);
    hitbox.setAttribute('width', hitboxSize);
    hitbox.setAttribute('fill', 'transparent');

    let text = createSvgElement('text');
    let textOffsetFactor = dx*dy ? 0.6 : 0;
    text.setAttribute('x', arrowX-dx*textOffsetFactor);
    text.setAttribute('y', arrowY-dy*textOffsetFactor);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('style',
      'font-size: 16; font-family: monospace; font-weight: bold;');

    let arrow = createSvgElement('g');
    arrow.appendChild(hitbox);
    arrow.appendChild(path);
    arrow.appendChild(text);
    arrow.classList.add('outside-arrow');

    return arrow;
  };
}