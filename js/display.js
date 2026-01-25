const {
  createSvgElement,
  deferUntilAnimationFrame,
  clearDOMNode,
  copyToClipboard,
  memoize,
  isIterable,
  setPeek
} = await import('./util.js' + self.VERSION_PARAM);
const { toShortSolution } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
const { SHAPE_9x9 } = await import('./grid_shape.js' + self.VERSION_PARAM);

export class DisplayItem {
  static SVG_PADDING = 29;
  static CELL_SIZE = 52;

  static DIAGONAL_PATTERN = 'diagonal-pattern';
  static SQUARE_PATTERN = 'square-pattern';
  static CHECKERED_PATTERN = 'checked-pattern';
  static HORIZONTAL_LINE_PATTERN = 'horizontal-line-pattern';

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
    if (str) text.appendChild(document.createTextNode(str));
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

  _makeHorizontalLinePattern(id, color) {
    const pattern = createSvgElement('pattern');
    pattern.id = id;
    const lineSpacing = DisplayItem.CELL_SIZE / 10;
    pattern.setAttribute('width', lineSpacing);
    pattern.setAttribute('height', lineSpacing);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    let line = createSvgElement('line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', lineSpacing);
    line.setAttribute('y2', '0');
    line.setAttribute('style', `stroke:${color}; stroke-width:${lineSpacing}`);
    pattern.appendChild(line);

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

export class CellValueDisplay extends DisplayItem {
  static MULTI_VALUE_CLASS = 'cell-multi-value';
  static SINGLE_VALUE_CLASS = 'cell-single-value';

  static GIVENS_MASK_ID = 'givens-mask';

  constructor(svg, valueFn) {
    super(svg);
    this._applyGridOffset(svg);

    this._valueFn = valueFn || (v => v);
    this._valueMap = [];
    this._valueOffsets = [];
  }

  reshape(shape) {
    super.reshape(shape);
    this._valueMap = [];
    for (let i = 0; i <= shape.numValues; i++) {
      this._valueMap.push(this._valueFn(i));
    }

    this._valueOffsets = this._calculateMultiValueLayout(shape);
  }

  _calculateMultiValueLayout(shape) {
    // Pre-compute multi-value layout parameters.

    // Note: font size is not quite the same to allow for larger gaps in the
    // large grid.
    const fontSize = shape.numValues <= SHAPE_9x9.numValues ? 15 : 10;
    const fontWidth = fontSize * 0.6;
    const lineHeight = fontSize + 2;
    const valuesPerLine = Math.ceil(Math.sqrt(shape.numValues));
    const yOffset = -DisplayItem.CELL_SIZE / 2 + fontSize;
    const totalWidth = (valuesPerLine * 2 - 1) * fontWidth;
    const xOffset = (-totalWidth + fontWidth) / 2;
    // Position offsets [dx, dy] for each value (1-indexed).
    const valueOffsets = [null]; // index 0 unused
    for (let v = 1; v <= shape.numValues; v++) {
      const col = (v - 1) % valuesPerLine;
      const row = (v - 1) / valuesPerLine | 0;
      valueOffsets.push([
        xOffset + col * 2 * fontWidth,
        yOffset + row * lineHeight,
      ]);
    }
    return valueOffsets;
  }

  static makeGivensMask() {
    const mask = createSvgElement('mask');
    mask.id = this.GIVENS_MASK_ID;
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('class', 'non-layout-constraint');
    mask.append(this._makeMaskRect());
    return mask;
  }

  static clearMask() {
    const mask = document.getElementById(this.GIVENS_MASK_ID);
    if (!mask) return;

    clearDOMNode(mask);
    mask.append(this._makeMaskRect());
  }

  static _makeMaskRect() {
    const rect = createSvgElement('rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', 'white');
    return rect;
  }

  maskCell(cellId) {
    const mask = document.getElementById(this.constructor.GIVENS_MASK_ID);

    const { cell } = this._shape.parseCellId(cellId);
    const square = this._makeCellSquare(cell);
    square.setAttribute('fill', 'black');
    mask.append(square);
    return square;
  }

  renderGridValues(grid, colorFn) {
    this.clear();
    const svg = this.getSvg();

    for (let i = 0; i < grid.length; i++) {
      const value = grid[i];
      if (!value) continue;
      svg.append(this.makeGridValue(i, value, colorFn));
    }
  }

  makeGridValue(cellIndex, value, colorFn) {
    const [x, y] = this.cellIndexCenter(cellIndex);

    if (isIterable(value)) {
      const valueMap = this._valueMap;
      const valueOffsets = this._valueOffsets;

      const g = createSvgElement('g');
      g.classList.add(this.constructor.MULTI_VALUE_CLASS);
      for (const v of value) {
        const [dx, dy] = valueOffsets[v];
        const text = createSvgElement('text');
        text.setAttribute('x', x + dx);
        text.setAttribute('y', y + dy);
        const color = colorFn?.(cellIndex, v);
        if (color) text.setAttribute('fill', color);
        text.textContent = valueMap[v];
        g.append(text);
      }
      return g;
    }

    if (value) {
      const text = this.makeTextNode(value, x, y, this.constructor.SINGLE_VALUE_CLASS);
      const color = colorFn?.(cellIndex, value);
      if (color) text.setAttribute('fill', color);
      return text;
    }
    return null;
  }
}

export class ColorPicker {
  // Default color list.
  COLOR_LIST = [
    'teal',
    'red',
    'orange',
    'purple',
    'deeppink',
    'brown',
    'dodgerblue',
    'black',
    'olive',
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
  pickColor(key = null, avoidKeys) {
    if (key !== null && this._keyToColors.has(key)) {
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

export class GridGraph {
  static LEFT = 0;
  static RIGHT = 1;
  static UP = 2;
  static DOWN = 3;

  static _VERIFIED_CALL_TOKEN = {};

  static get = memoize(
    (shape) => new this(this._VERIFIED_CALL_TOKEN, shape),
    (shape) => shape.gridDimsStr);

  constructor(verifiedCallToken, shape) {
    if (verifiedCallToken !== this.constructor._VERIFIED_CALL_TOKEN) {
      throw new Error('Use GridGraph.get(shape)');
    }

    const graph = [];
    for (let i = 0; i < shape.numCells; i++) {
      graph.push([null, null, null, null]);
    }

    const numRows = shape.numRows;
    const numCols = shape.numCols;
    const cls = this.constructor;

    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        const cell = shape.cellIndex(row, col);
        const adj = graph[cell];

        if (row > 0) adj[cls.UP] = shape.cellIndex(row - 1, col);
        if (row < numRows - 1) adj[cls.DOWN] = shape.cellIndex(row + 1, col);
        if (col > 0) adj[cls.LEFT] = shape.cellIndex(row, col - 1);
        if (col < numCols - 1) adj[cls.RIGHT] = shape.cellIndex(row, col + 1);
      }
    }

    this._graph = graph;
  }

  cellEdges(cell) {
    return this._graph[cell];
  }

  adjacent(cell, dir) {
    return this._graph[cell][dir];
  }

  diagonal(cell, dir0, dir1) {
    const cell1 = this._graph[cell][dir0];
    return cell1 && this._graph[cell1][dir1];
  }

  cellsAreConnected(cellSet) {
    const seen = new Set();
    const stack = [setPeek(cellSet)];
    const graph = this._graph;
    seen.add(stack[0]);

    while (stack.length > 0) {
      const cell = stack.pop();

      for (const adjCell of graph[cell]) {
        if (adjCell === null || seen.has(adjCell) || !cellSet.has(adjCell)) continue;
        stack.push(adjCell);
        seen.add(adjCell);
      }
    }

    return seen.size === cellSet.size;
  }
}

export class DisplayContainer {
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
    const width = DisplayItem.CELL_SIZE * shape.numCols + padding * 2;
    const height = DisplayItem.CELL_SIZE * shape.numRows + padding * 2;
    this._mainSvg.setAttribute('height', height);
    this._mainSvg.setAttribute('width', width);
    this._mainSvg.setAttribute(
      'class',
      shape.numValues <= SHAPE_9x9.numValues
        ? 'grid-size-small' : 'grid-size-large');

    this._highlightDisplay.reshape(shape);
    this._clickInterceptor.reshape(shape);
  }

  toggleLayoutView(enable) {
    this._mainSvg.classList.toggle('layout-view', enable);
  }

  createCellHighlighter(cssClass) {
    return new CellHighlighter(this._highlightDisplay, cssClass);
  }

  getNewGroup(groupClass) {
    const group = createSvgElement('g');
    group.classList.add(groupClass);
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

    const width = DisplayItem.CELL_SIZE * shape.numCols;
    const height = DisplayItem.CELL_SIZE * shape.numRows;
    const svg = this.getSvg();
    svg.setAttribute('height', height);
    svg.setAttribute('width', width);
  }

  cellAt(x, y) {
    const shape = this._shape;
    const row = y / DisplayItem.CELL_SIZE | 0;
    const col = x / DisplayItem.CELL_SIZE | 0;
    if (row < 0 || row >= shape.numRows) return null;
    if (col < 0 || col >= shape.numCols) return null;
    return shape.makeCellId(row, col);
  }
}

export class InfoTextDisplay extends DisplayItem {
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


export class SolutionDisplay extends CellValueDisplay {
  constructor(svg, copyElem) {
    super(svg);
    this._currentSolution = [];

    this.setSolution = deferUntilAnimationFrame(this.setSolution.bind(this));
    this._copyElem = copyElem || null;
    if (this._copyElem) {
      this._copyElem.onclick = () => {
        const solutionText = toShortSolution(this._currentSolution, this._shape);
        copyToClipboard(solutionText, this._copyElem);
      };
    }

    svg.setAttribute('mask', `url(#${this.constructor.GIVENS_MASK_ID})`);
  }

  reshape(shape) {
    // This clears the solution, but importantly it overwrites any pending
    // setSolution calls.
    this.setSolution();
    super.reshape(shape);
  }

  // Display solution on grid.
  //  - If solution cell contains a container then it will be displayed as
  //    pencilmarks.
  //  - colorFn(cellIndex, value): optional function returning color for a candidate.
  setSolution(solution, colorFn) {
    solution = solution || [];
    this._currentSolution = solution.slice();

    // If we have no solution, just hide it instead.
    // However, we wait a bit so that we don't flicker if the solution is updated
    // again immediately.
    if (!solution.length) {
      window.setTimeout(() => {
        // Ensure there is still no solution.
        if (this._currentSolution.length === 0) {
          this.clear();
          if (this._copyElem) this._copyElem.disabled = true;
        }
      }, 10);
      return;
    }

    this.renderGridValues(solution, colorFn);

    if (this._copyElem) {
      this._copyElem.disabled = (
        !this._currentSolution.every(v => v && isFinite(v)));
    }
  }
}

export class HighlightDisplay extends DisplayItem {
  constructor(svg) {
    super(svg);

    this._shape = null;
    this._applyGridOffset(svg);
    this._groups = new Map();
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

  _getGroup(cssClass) {
    if (this._groups.has(cssClass)) return this._groups.get(cssClass);

    const group = createSvgElement('g');
    group.classList.add(cssClass);
    this._svg.append(group);
    this._groups.set(cssClass, group);

    return group;
  }

  highlightCell(cellId, cssClass) {
    const parsed = this._shape.parseCellId(cellId);

    const path = this._makeCellSquare(parsed.cell);
    const svg = cssClass ? this._getGroup(cssClass) : this._svg;

    svg.appendChild(path);

    return path;
  }

  removeHighlight(path) {
    path.parentNode.removeChild(path);
  }
}

export class GridDisplay extends DisplayItem {
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
    const gridWidth = cellSize * shape.numCols;
    const gridHeight = cellSize * shape.numRows;

    const grid = this.getSvg();

    // Horizontal lines
    for (let i = 1; i < shape.numRows; i++) {
      grid.append(this._makePath([
        [0, i * cellSize],
        [gridWidth, i * cellSize],
      ]));
    }
    // Vertical lines
    for (let i = 1; i < shape.numCols; i++) {
      grid.append(this._makePath([
        [i * cellSize, 0],
        [i * cellSize, gridHeight],
      ]));
    }
  }
}

export class BorderDisplay extends DisplayItem {
  constructor(svg, fill) {
    super(svg);

    this._applyGridOffset(svg);
    svg.setAttribute('stroke-width', 2);
    svg.setAttribute('stroke', 'rgb(0, 0, 0)');

    this._fill = fill;
  }

  gridWidthPixels() {
    return DisplayItem.CELL_SIZE * this._shape.numCols;
  }

  gridHeightPixels() {
    return DisplayItem.CELL_SIZE * this._shape.numRows;
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();

    const gridWidth = this.gridWidthPixels();
    const gridHeight = this.gridHeightPixels();

    const path = this._makePath([
      [0, 0],
      [0, gridHeight],
      [gridWidth, gridHeight],
      [gridWidth, 0],
      [0, 0],
    ]);
    if (this._fill) path.setAttribute('fill', this._fill);
    this.getSvg().append(path);
  }
}

class CellHighlighter {
  constructor(display, cssClass) {
    this._cells = new Map();
    this._cssClass = cssClass;

    this._display = display;
    this._key = undefined;
  }

  key() {
    return this._key;
  }

  setCells(cellIds, key) {
    if (key && key === this._key) return;
    this.clear();
    for (const cellId of cellIds) this.addCell(cellId);
    this._key = key;
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
    this._key = undefined;
  }
}
