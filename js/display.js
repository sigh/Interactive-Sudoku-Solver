const {
  createSvgElement,
  deferUntilAnimationFrame,
  clearDOMNode,
  copyToClipboard,
  isIterable,
  setIntersectSize,
} = await import('./util.js' + self.VERSION_PARAM);
const { toShortSolution } = await import('./sudoku_parser.js' + self.VERSION_PARAM);
const { GridShape, CellGraph, SHAPE_9x9 } = await import('./grid_shape.js' + self.VERSION_PARAM);

export class DisplayItem {
  static SVG_PADDING = 29;
  static CELL_SIZE = 52;

  static DIAGONAL_PATTERN = 'diagonal-pattern';
  static SQUARE_PATTERN = 'square-pattern';
  static CHECKERED_PATTERN = 'checked-pattern';
  static HORIZONTAL_LINE_PATTERN = 'horizontal-line-pattern';

  constructor(svg, cellPositioner) {
    this._svg = svg;
    this._shape = null;
    this._cellPositioner = cellPositioner || null;
  }

  reshape(shape) { this._shape = shape; };

  getSvg() {
    return this._svg;
  }

  cellIndexCenter(cellIndex) {
    return this._cellPositioner.cellCenter(cellIndex);
  }

  cellIdCenter(cellId) {
    return this.cellIndexCenter(this._shape.parseCellId(cellId).cell);
  }

  cellIdTopLeftCorner(cellId) {
    const center = this.cellIdCenter(cellId);
    if (!center) return null;
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = center;
    return [x - cellWidth / 2, y - cellWidth / 2 + 2];
  }

  cellIdBottomLeftCorner(cellId) {
    const center = this.cellIdCenter(cellId);
    if (!center) return null;
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = center;
    return [x - cellWidth / 2, y + cellWidth / 2];
  }

  cellIdBottomRightCorner(cellId) {
    const center = this.cellIdCenter(cellId);
    if (!center) return null;
    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = center;
    return [x + cellWidth / 2, y + cellWidth / 2];
  }

  cellCenter(cell) {
    return this.cellIndexCenter(cell);
  }

  makeTextNode(str, x, y, cls) {
    const text = createSvgElement('text');
    if (str !== null) text.appendChild(document.createTextNode(str));
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
    const center = this.cellCenter(cell);
    if (!center) return null;

    const cellWidth = DisplayItem.CELL_SIZE;
    const [x, y] = center;
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

  static _NO_EDGES = [null, null, null, null];

  // Draw a border around the region covered by cellSet, as an SVG group of
  // path segments. cornerCut chamfers diagonal bridges; inset shrinks inward.
  _makeRegionBorder(cellSet, shape, cornerCut, inset = 0) {
    const g = createSvgElement('g');
    const seen = new Set();
    const graph = shape.cellGraph();
    const half = DisplayItem.CELL_SIZE / 2;
    const { LEFT, RIGHT, UP, DOWN } = CellGraph;

    for (const cell of cellSet) {
      const [cx, cy] = this.cellCenter(cell);
      const edges = graph.cellEdges(cell);
      const lCell = edges[LEFT];
      const rCell = edges[RIGHT];
      const uCell = edges[UP];
      const dCell = edges[DOWN];
      const uEdges = uCell !== null ? graph.cellEdges(uCell)
        : DisplayItem._NO_EDGES;
      const dEdges = dCell !== null ? graph.cellEdges(dCell)
        : DisplayItem._NO_EDGES;

      //   tl | tr    Each corner is where four cells meet.
      //   ---+---    Neighbors are resolved via cellEdges;
      //   bl | br    diagonals via the neighbor's edges.
      for (const [ix, iy, tlCell, trCell, blCell, brCell] of [
        [cx - half, cy - half, uEdges[LEFT], uCell, lCell, cell],
        [cx + half, cy - half, uCell, uEdges[RIGHT], cell, rCell],
        [cx - half, cy + half, lCell, cell, dEdges[LEFT], dCell],
        [cx + half, cy + half, cell, rCell, dCell, dEdges[RIGHT]],
      ]) {
        // Deduplicate shared intersections using a cell-index key.
        // Each cell is the BR of exactly one intersection (its top-left
        // corner), BL of one (top-right), etc. The offset distinguishes
        // which position the keying cell occupies.
        const key = brCell !== null ? (brCell << 2)
          : blCell !== null ? (blCell << 2) + 1
            : trCell !== null ? (trCell << 2) + 2
              : (tlCell << 2) + 3;
        if (seen.has(key)) continue;
        seen.add(key);
        this._drawIntersection(
          g,
          cellSet.has(tlCell), cellSet.has(trCell),
          cellSet.has(blCell), cellSet.has(brCell),
          ix, iy, cornerCut, inset);
      }
    }

    return g;
  }

  // Draw border segments at an intersection point where four cells meet.
  //
  //   tl | tr        The border is drawn between cells that are
  //   ---+---        inside the region and cells that are outside.
  //   bl | br
  //
  // g         - SVG group to append path elements to.
  // tl/tr/bl/br - Whether each adjacent cell is in the region.
  // x, y      - Pixel coordinates of the intersection point.
  // cornerCut - Add a chamfer where two diagonal cells meet (count=2).
  // inset     - Pixel offset to shrink the border inward.
  _drawIntersection(g, tl, tr, bl, br, x, y, cornerCut, inset) {
    const count = tl + tr + bl + br;
    if (count === 0 || count === 4) return;

    const half = DisplayItem.CELL_SIZE / 2;

    if (count === 1 || count === 3) {
      // Corner (90° or 270°)
      const insetX = (count === 1 ? (tl || bl) : (tl && bl)) ? -1 : 1;
      const insetY = (count === 1 ? (tl || tr) : (tl && tr)) ? -1 : 1;
      const edgeDir = count === 1 ? 1 : -1;
      const cx = x + inset * insetX;
      const cy = y + inset * insetY;
      g.appendChild(this._makePath([
        [x + half * insetX * edgeDir, cy],
        [cx, cy],
        [cx, y + half * insetY * edgeDir],
      ]));
      return;
    }

    // count === 2: diagonal or straight

    // Diagonal: two paths with corner cuts
    if (tl !== tr && tl !== bl) {
      const DIAGONAL_CORNER_CUT_SIZE = 10;  // Size of corner cut for diagonal bridges

      const d = (tl && br) ? -1 : 1;
      const cut = cornerCut ? DIAGONAL_CORNER_CUT_SIZE : 0;
      const x1 = x + inset * d;
      const y1 = y + inset;
      g.appendChild(this._makePath([
        [x1, y - half],
        [x1, y1 - cut],
        [x1 - d * cut, y1],
        [x - d * half, y1],
      ]));
      const x2 = x - inset * d;
      const y2 = y - inset;
      g.appendChild(this._makePath([
        [x + d * half, y2],
        [x2 + d * cut, y2],
        [x2, y2 + cut],
        [x2, y + half],
      ]));
      return;
    }

    // Straight edge
    const isHorizontal = (tl === tr);
    const insetDir = tl ? -1 : 1;
    if (isHorizontal) {
      const yOff = inset * insetDir;
      g.appendChild(this._makePath([
        [x - half, y + yOff],
        [x + half, y + yOff],
      ]));
    } else {
      const xOff = inset * insetDir;
      g.appendChild(this._makePath([
        [x + xOff, y - half],
        [x + xOff, y + half],
      ]));
    }
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

  constructor(svg, valueFn, cellPositioner) {
    super(svg, cellPositioner);
    this._applyGridOffset(svg);

    this._valueFn = valueFn || (v => v);
    this._valueMap = [];
    this._valueOffsets = [];
  }

  reshape(shape) {
    super.reshape(shape);
    this._valueMap = [];
    for (let v of shape.allValues()) {
      this._valueMap[v] = this._valueFn(v);
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
    // Position offsets indexed by value.
    const minValue = shape.minValue();
    const valueOffsets = [];
    for (let i = 0; i < shape.numValues; i++) {
      const v = minValue + i;
      const col = i % valuesPerLine;
      const row = i / valuesPerLine | 0;
      valueOffsets[v] = [
        xOffset + col * 2 * fontWidth,
        yOffset + row * lineHeight,
      ];
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
      if (value == null) continue;
      const pos = this.cellIndexCenter(i);
      if (!pos) continue;
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

    if (value !== null && !isIterable(value)) {
      const text = this.makeTextNode(
        value, x, y+2, this.constructor.SINGLE_VALUE_CLASS);
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

export class DisplayContainer {
  constructor(container) {
    const svg = createSvgElement('svg');

    this._mainSvg = svg;
    container.append(svg);

    this._cellPositioner = new CellPositioner();

    this._highlightDisplay = new HighlightDisplay(
      this.getNewGroup('highlight-group'), this._cellPositioner);

    this._onRemoveVarCellGroup = null;
    this._varCellDisplay = new VarCellDisplay(
      this.getNewGroup('var-cell-group'),
      (prefix) => this._onRemoveVarCellGroup?.(prefix));

    this._clickInterceptor = new ClickInterceptor(this._cellPositioner);
    container.append(this._clickInterceptor.getSvg());
  }

  reshape(shape) {
    const padding = DisplayItem.SVG_PADDING;
    const width = DisplayItem.CELL_SIZE * shape.numCols + padding * 2;
    const height = DisplayItem.CELL_SIZE * shape.numRows + padding * 2;
    this._baseHeight = height;
    this._mainSvg.setAttribute('height', height);
    this._mainSvg.setAttribute('width', width);
    this._mainSvg.setAttribute(
      'class',
      shape.numValues <= SHAPE_9x9.numValues
        ? 'grid-size-small' : 'grid-size-large');

    this._cellPositioner.reshape(shape);
    this._highlightDisplay.reshape(shape);
    this._clickInterceptor.reshape(shape);

    shape.onVarCellsChanged(
      () => this._updateVarCells(shape.varCellGroups()));
  }

  _setExtraHeight(extraHeight) {
    this._mainSvg.setAttribute(
      'height', this._baseHeight + extraHeight);
  }

  toggleLayoutView(enable) {
    this._mainSvg.classList.toggle('layout-view', enable);
  }

  getCellPositioner() { return this._cellPositioner; }

  _updateVarCells(groups) {
    const { extraHeight, layout } = this._cellPositioner.setVarCellGroups(
      groups);
    this._setExtraHeight(extraHeight);
    this._varCellDisplay.render(layout);
    this._clickInterceptor.setVarCellLayout(layout);
  }

  createCellHighlighter(cssClass) {
    return new CellHighlighter(this._highlightDisplay, cssClass);
  }

  createRegionHighlighter(cssClass, inset = 0) {
    return new RegionHighlighter(this._highlightDisplay, cssClass, inset);
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

  onVarCellRemove(callback) {
    this._onRemoveVarCellGroup = callback;
  }
}

class ClickInterceptor extends DisplayItem {
  constructor(cellPositioner) {
    const svg = createSvgElement('svg');
    svg.classList.add('click-interceptor-svg');
    svg.setAttribute('pointer-events', 'none');

    super(svg, cellPositioner);

    // Note: _applyGridOffset won't work here because this is a DOM element
    // not an element inside the svg (breaks in Safari).
    const padding = DisplayItem.SVG_PADDING;
    svg.style.transform = `translate(${padding}px,${padding}px)`;

    this._gridRect = createSvgElement('rect');
    this._gridRect.setAttribute('fill', 'transparent');
    this._gridRect.setAttribute('pointer-events', 'all');
    svg.appendChild(this._gridRect);

    this._varCellRects = [];
  }

  reshape(shape) {
    super.reshape(shape);

    const width = DisplayItem.CELL_SIZE * shape.numCols;
    this._gridWidth = width;
    this._gridHeight = DisplayItem.CELL_SIZE * shape.numRows;
    const svg = this.getSvg();
    svg.setAttribute('height', this._gridHeight);
    svg.setAttribute('width', width);

    this._gridRect.setAttribute('width', width);
    this._gridRect.setAttribute('height', this._gridHeight);

    this._clearVarCellRects();
  }

  setVarCellLayout(layout) {
    this._clearVarCellRects();
    const svg = this.getSvg();
    const cellSize = DisplayItem.CELL_SIZE;
    let maxBottom = this._gridHeight;

    for (const { columns, rows, y } of layout) {
      const rect = createSvgElement('rect');
      rect.setAttribute('x', 0);
      rect.setAttribute('y', y);
      rect.setAttribute('width', columns * cellSize);
      rect.setAttribute('height', rows * cellSize);
      rect.setAttribute('fill', 'transparent');
      rect.setAttribute('pointer-events', 'all');
      svg.appendChild(rect);
      this._varCellRects.push(rect);
      maxBottom = Math.max(maxBottom, y + rows * cellSize);
    }

    svg.setAttribute('height', maxBottom);
  }

  _clearVarCellRects() {
    for (const rect of this._varCellRects) rect.remove();
    this._varCellRects = [];
  }

  cellAt(x, y) {
    const cellIndex = this._cellPositioner.cellIndexAt(x, y);
    if (cellIndex === null) return null;
    return this._shape.makeCellIdFromIndex(cellIndex);
  }
}

export class InfoTextDisplay extends DisplayItem {
  constructor(svg, cellPositioner) {
    super(svg, cellPositioner);
    this._applyGridOffset(svg);
  }

  setText(cellId, str) {
    const pos = this.cellIdBottomLeftCorner(cellId);
    if (!pos) return;
    const [x, y] = pos;
    const textNode = this.makeTextNode(str, x + 2, y - 2, 'info-overlay-item');
    this._svg.append(textNode);
  }
}


export class SolutionDisplay extends CellValueDisplay {
  constructor(svg, copyElem, cellPositioner) {
    super(svg, null, cellPositioner);
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
      const numCells = this._shape.numGridCells;
      this._copyElem.disabled = (
        !this._currentSolution.slice(0, numCells).every(
          v => v != null && isFinite(v)));
    }
  }
}

export class HighlightDisplay extends DisplayItem {
  constructor(svg, cellPositioner) {
    super(svg, cellPositioner);

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
    if (!path) return null;

    const svg = cssClass ? this._getGroup(cssClass) : this._svg;

    svg.appendChild(path);

    return path;
  }

  // Draw a single border around the region covered by cellIds (cf. how
  // BorderedRegion constraints are drawn), returning the element for removal.
  highlightRegion(cellIds, cssClass, inset = 0) {
    const cellSet = new Set(
      cellIds.map(id => this._shape.parseCellId(id).cell));
    const region = this._makeRegionBorder(
      cellSet, this._shape, /* cornerCut= */ true, inset);
    // Shade the interior, behind the border.
    for (const cell of cellSet) {
      const square = this._makeCellSquare(cell);
      if (!square) continue;
      square.setAttribute('stroke', 'none');
      region.insertBefore(square, region.firstChild);
    }
    if (cssClass) region.classList.add(cssClass);
    this._svg.append(region);
    return region;
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

export class ChaosRegionBorderDisplay extends DisplayItem {
  static BORDER_COLOR = 'rgb(0, 100, 255)';
  static IN_PROGRESS_BORDER_WIDTH = 2;
  static COMPLETE_BORDER_WIDTH = 3;

  constructor(svg, cellPositioner) {
    super(svg, cellPositioner);
    this._applyGridOffset(svg);
    svg.setAttribute('stroke', this.constructor.BORDER_COLOR);
    svg.setAttribute('stroke-width', this.constructor.IN_PROGRESS_BORDER_WIDTH);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('fill', 'none');
  }

  reshape(shape) {
    super.reshape(shape);
    this.clear();
  }

  setSolution(solution, searchComplete = false) {
    this.clear();
    if (!solution?.length) return;
    this.getSvg().setAttribute('stroke-width', searchComplete
      ? this.constructor.COMPLETE_BORDER_WIDTH
      : this.constructor.IN_PROGRESS_BORDER_WIDTH);

    const regionCells = this._shape.varCellsForGroup('CC');
    if (!regionCells || regionCells.length !== this._shape.numGridCells) return;
    const graph = this._shape.cellGraph();

    for (let cell = 0; cell < this._shape.numGridCells; cell++) {
      const right = graph.adjacent(cell, CellGraph.RIGHT);
      if (right !== null) this._drawBorderIfDisjoint(solution, regionCells, cell, right);
      const down = graph.adjacent(cell, CellGraph.DOWN);
      if (down !== null) this._drawBorderIfDisjoint(solution, regionCells, cell, down);
    }
  }

  _drawBorderIfDisjoint(solution, regionCells, cellA, cellB) {
    if (!this._regionValuesAreDisjoint(
      solution[regionCells[cellA]], solution[regionCells[cellB]])) return;

    this.getSvg().append(
      this._makeCellBorder(cellA, cellB),
      this._makeCellBorder(regionCells[cellA], regionCells[cellB]));
  }

  _regionValuesAreDisjoint(valueA, valueB) {
    if (!isIterable(valueA)) {
      if (!isIterable(valueB)) return valueA !== valueB;
      return !valueB.has(valueA);
    }
    if (!isIterable(valueB)) return !valueA.has(valueB);
    return setIntersectSize(valueA, valueB) === 0;
  }

  _makeCellBorder(cellA, cellB) {
    const [xA, yA] = this.cellIndexCenter(cellA);
    const [xB, yB] = this.cellIndexCenter(cellB);
    const cellSize = DisplayItem.CELL_SIZE;
    const x = (xA + xB) / 2;
    const y = (yA + yB) / 2;

    if (xA === xB) {
      return this._makePath([[x - cellSize / 2, y], [x + cellSize / 2, y]]);
    }
    return this._makePath([[x, y - cellSize / 2], [x, y + cellSize / 2]]);
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
      if (!path) return;
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

// Like CellHighlighter, but draws a single border around the whole cell set
// (as bordered-region constraints are drawn) rather than per-cell.
class RegionHighlighter {
  constructor(display, cssClass, inset = 0) {
    this._display = display;
    this._cssClass = cssClass;
    this._inset = inset;
    this._cells = [];
    this._element = null;
  }

  setCells(cellIds) {
    this.clear();
    this._cells = [...cellIds];
    if (this._cells.length) {
      this._element = this._display.highlightRegion(
        this._cells, this._cssClass, this._inset);
    }
  }

  getCells() {
    return [...this._cells];
  }

  clear() {
    if (this._element) {
      this._display.removeHighlight(this._element);
      this._element = null;
    }
    this._cells = [];
  }
}

export class VarCellDisplay extends DisplayItem {
  constructor(svg, onRemove) {
    super(svg);
    this._onRemove = onRemove;
  }

  render(layout) {
    this.clear();
    if (!layout?.length) return;

    const cellSize = DisplayItem.CELL_SIZE;
    const padding = DisplayItem.SVG_PADDING;
    const labelHeight = CellPositioner.VAR_CELL_LABEL_HEIGHT;

    const svg = this.getSvg();
    svg.setAttribute('transform', `translate(${padding},${padding})`);

    for (const { group, columns, rows, yLabel, y } of layout) {
      const count = group.cells.length;
      const lastRowCols = ((count - 1) % columns) + 1;
      const groupWidth = columns * cellSize;
      const lastRowWidth = lastRowCols * cellSize;
      const groupHeight = rows * cellSize;
      const lineGroup = createSvgElement('g');
      lineGroup.setAttribute('stroke', 'rgb(180, 180, 180)');
      lineGroup.setAttribute('stroke-width', 1);
      lineGroup.setAttribute('fill', 'none');

      // Internal vertical lines.
      for (let col = 1; col < columns; col++) {
        const x1 = col * cellSize;
        const yEnd = col < lastRowCols
          ? y + groupHeight : y + (rows - 1) * cellSize;
        const line = createSvgElement('line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y);
        line.setAttribute('x2', x1);
        line.setAttribute('y2', yEnd);
        lineGroup.append(line);
      }

      // Internal horizontal lines.
      for (let row = 1; row < rows; row++) {
        const width = row === rows - 1 ? lastRowWidth : groupWidth;
        const line = createSvgElement('line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', y + row * cellSize);
        line.setAttribute('x2', width);
        line.setAttribute('y2', y + row * cellSize);
        lineGroup.append(line);
      }

      // Border path (accounting for partial last row).
      const border = createSvgElement('path');
      const lastRowY = y + (rows - 1) * cellSize;
      const topWidth = rows > 1 ? groupWidth : lastRowWidth;
      const d = [
        'M0,', y,
        'h', topWidth,
        'v', lastRowY - y,
        'h', lastRowWidth - topWidth,
        'v', cellSize,
        'h', -lastRowWidth,
        'Z',
      ].join('');
      border.setAttribute('d', d);
      border.setAttribute('stroke', 'rgb(100, 100, 100)');
      border.setAttribute('stroke-width', 1.5);
      border.setAttribute('fill', 'none');
      lineGroup.append(border);

      svg.append(lineGroup);

      // Close button.
      const close = createSvgElement('text');
      close.textContent = '\u00D7';
      close.setAttribute('x', 0);
      close.setAttribute('y', yLabel + labelHeight / 2 + 1);
      close.setAttribute('class', 'var-cell-close');
      close.addEventListener('click', () => this._onRemove(group.prefix));
      svg.append(close);

      // Draw label above the row.
      const label = createSvgElement('text');
      label.setAttribute('x', 14);
      label.setAttribute('y', yLabel + labelHeight - 3);
      label.setAttribute('class', 'var-cell-label');
      const groupPrefix = GridShape.displayCellId(group.prefix);
      const groupLabel = group.label ? `: ${group.label}` : '';
      label.textContent = `${groupPrefix}${groupLabel}`;
      svg.append(label);
    }
  }

  clear() {
    clearDOMNode(this._svg);
  }
}

class CellPositioner {
  static VAR_CELL_GAP = 20;
  static VAR_CELL_LABEL_HEIGHT = 14;

  constructor() {
    this._shape = null;
    this._centers = [];
    this._varCellLayout = { extraHeight: 0, layout: [] };
  }

  reshape(shape) {
    this._shape = shape;

    // Precompute grid cell centers.
    const cellSize = DisplayItem.CELL_SIZE;
    const numCols = shape.numCols;
    const centers = new Array(shape.numGridCells);
    for (let i = 0; i < shape.numGridCells; i++) {
      const row = i / numCols | 0;
      const col = i % numCols | 0;
      centers[i] = [col * cellSize + cellSize / 2, row * cellSize + cellSize / 2];
    }
    this._centers = centers;
    this._varCellLayout = { extraHeight: 0, layout: [] };
  }

  setVarCellGroups(groups) {
    const result = this._computeVarCellLayout(groups);
    this._varCellLayout = result;

    // Update centers with var cell positions.
    const cellSize = DisplayItem.CELL_SIZE;
    const centers = this._centers.slice(0, this._shape.numGridCells);
    for (const { group, columns, y } of result.layout) {
      for (let i = 0; i < group.cells.length; i++) {
        const col = i % columns;
        const row = i / columns | 0;
        centers[group.cells[i]] = [
          col * cellSize + cellSize / 2,
          y + row * cellSize + cellSize / 2,
        ];
      }
    }
    this._centers = centers;

    return result;
  }

  varCellLayout() {
    return this._varCellLayout;
  }

  cellIndexAt(x, y) {
    const cellSize = DisplayItem.CELL_SIZE;
    const shape = this._shape;

    // Grid cells.
    const row = y / cellSize | 0;
    const col = x / cellSize | 0;
    if (row >= 0 && row < shape.numRows && col >= 0 && col < shape.numCols) {
      return shape.cellIndex(row, col);
    }

    // Var cells.
    for (const { group, columns, rows, y: cellY } of this._varCellLayout.layout) {
      if (y >= cellY && y < cellY + rows * cellSize) {
        const r = (y - cellY) / cellSize | 0;
        const c = x / cellSize | 0;
        const idx = r * columns + c;
        if (c >= 0 && c < columns && idx < group.cells.length) {
          return group.cells[idx];
        }
        return null;
      }
    }
    return null;
  }

  _computeVarCellLayout(groups) {
    if (!groups?.length) return { extraHeight: 0, layout: [] };

    const cellSize = DisplayItem.CELL_SIZE;
    const gap = CellPositioner.VAR_CELL_GAP;
    const labelHeight = CellPositioner.VAR_CELL_LABEL_HEIGHT;
    const gridHeight = cellSize * this._shape.numRows;
    const defaultColumns = this._shape.numCols;

    let yNext = gridHeight + gap;
    const layout = [];

    for (const group of groups) {
      if (group.hidden || !group.cells.length) continue;

      const columns = group.columns || defaultColumns;
      const rows = Math.ceil(group.cells.length / columns);
      const yLabel = yNext;
      const y = yLabel + labelHeight;

      layout.push({ group, columns, rows, yLabel, y });
      yNext = y + rows * cellSize;
    }

    return {
      extraHeight: yNext - gridHeight,
      layout
    };
  }

  totalCells() {
    return this._shape.totalCells();
  }

  cellCenter(cellIndex) {
    return this._centers[cellIndex]?.slice() || null;
  }
}
