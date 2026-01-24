const {
  GridDisplay,
  BorderDisplay,
  DisplayItem,
  ColorPicker,
  CellValueDisplay,
  GridGraph
} = await import('./display.js' + self.VERSION_PARAM);
const { LineOptions, CellArgs } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);
const { createSvgElement, clearDOMNode } = await import('./util.js' + self.VERSION_PARAM);
const { SudokuConstraint, SudokuConstraintBase } = await import('./sudoku_constraint.js' + self.VERSION_PARAM);

const constraintDisplayOrder = () => [
  DefaultRegionsInverted,
  Windoku,
  Jigsaw,
  BorderedRegion,
  Indexing,
  Thermo,
  PillArrow,
  GenericLine,
  CustomLine,
  ShadedRegion,
  CountingCircles,
  Diagonal,
  Dot,
  Letter,
  GreaterThan,
  Quad,
  Givens,
  OutsideClue,
];

class BaseConstraintDisplayItem extends DisplayItem {
  static IS_LAYOUT = false;
  static IS_DIMMABLE = false;

  constructor(svg) {
    super(svg);

    svg.classList.add(
      this.constructor.IS_LAYOUT ? 'layout-constraint' : 'non-layout-constraint');

    if (this.constructor.IS_DIMMABLE) {
      svg.classList.add('dimmable-constraint');
    }
  }

  clear() {
    clearDOMNode(this._svg);
  }

  // drawItem should return an item that can be passed to removeItem to remove
  // the item from the display.
  // The returned item should be an svg element.
  drawItem(constraint, options) { throw new Error('Unimplemented'); }

  // By default, makeIcon returns a shaded grey region for the cells in the
  // constraint.
  makeIcon(constraint, options) {
    const cells = constraint.getCells(this._shape);
    if (!cells.length) return null;
    const cellIds = cells.map(c => this._shape.parseCellId(c).cell);

    const g = createSvgElement('g');

    g.setAttribute('fill', 'lightgray');
    for (const cell of cellIds) {
      g.appendChild(this._makeCellSquare(cell));
    }

    return g;
  }

  removeItem(item) {
    item.parentNode?.removeChild(item);
  }

  _removeCircleFromPath(p0, p1) {
    const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]];
    const frac = this._CIRCLE_RADIUS / Math.sqrt(dx * dx + dy * dy);
    p0[0] += dx * frac;
    p0[1] += dy * frac;
  }

  _DIAMOND_SIZE = 20;

  _makeDiamondAtPoint([x, y]) {
    let diamond = createSvgElement('path');
    let size = this._DIAMOND_SIZE;
    let parts = [
      'M', x, y - size,
      'L', x + size, y,
      'L', x, y + size,
      'L', x - size, y,
      'Z'
    ];
    diamond.setAttribute('d', parts.join(' '));

    return diamond;
  }

  _makeConstraintLineMarker(marker, points, index) {
    const point = points[index];
    switch (marker) {
      case LineOptions.EMPTY_CIRCLE_MARKER:
        {
          const circle = this._makeCircleAtPoint(point);
          circle.setAttribute('fill', 'transparent');
          if (index > 0) {
            this._removeCircleFromPath(point, points[index - 1]);
          }
          if (index < points.length - 1) {
            this._removeCircleFromPath(point, points[index + 1]);
          }
          return circle;
        }
      case LineOptions.FULL_CIRCLE_MARKER:
        {
          const circle = this._makeCircleAtPoint(point);
          circle.setAttribute('stroke-width', 0);
          return circle;
        }
      case LineOptions.SMALL_EMPTY_CIRCLE_MARKER:
        {
          const circle = this._makeCircleAtPoint(point);
          circle.setAttribute('r', LineOptions.THIN_LINE_WIDTH * 2);
          circle.setAttribute('fill', 'transparent');
          circle.setAttribute('stroke-width', 1);
          return circle;
        }
      case LineOptions.SMALL_FULL_CIRCLE_MARKER:
        {
          const circle = this._makeCircleAtPoint(point);
          circle.setAttribute('r', LineOptions.THIN_LINE_WIDTH);
          return circle;
        }
      case LineOptions.DIAMOND_MARKER:
        {
          const diamond = this._makeDiamondAtPoint(point);
          diamond.setAttribute('stroke-width', 0);
          return diamond;
        }
      default:
        throw new Error(`Unknown marker: ${marker}`);
    }
  }

  _makeConstraintLine(cells, options) {
    const len = cells.length;
    if (len < 2) throw new Error(`Line too short: ${cells}`);

    if (options.constructor !== LineOptions) {
      options = new LineOptions(options);
    }
    const g = createSvgElement('g');
    g.setAttribute('stroke', options.color);
    g.setAttribute('fill', options.color);
    g.setAttribute('stroke-width', options.width);
    g.setAttribute('stroke-linecap', 'round');

    const points = cells.map(c => this.cellIdCenter(c));

    // Default start and end markers to nodeMarker if not provided.
    let { startMarker, endMarker, nodeMarker } = options;
    if (nodeMarker) {
      startMarker ||= nodeMarker;
      endMarker ||= nodeMarker;
    }

    // Add the markers.
    if (startMarker) {
      g.append(this._makeConstraintLineMarker(
        startMarker, points, 0));
    }
    if (endMarker) {
      g.append(this._makeConstraintLineMarker(
        endMarker, points, len - 1));
    }
    if (nodeMarker) {
      for (let i = 1; i < len - 1; i++) {
        g.append(this._makeConstraintLineMarker(
          nodeMarker, points, i));
      }
    }

    // Make and style the path.
    const path = this._makePath(points);
    if (options.arrow) {
      path.setAttribute('marker-end', 'url(#arrowhead)');
    }
    if (options.dashed) {
      const pattern = options.dashed === true ? '0.5 2' : options.dashed;
      const parts = pattern.split(' ').map(s => parseFloat(s) * options.width);
      path.setAttribute('stroke-dasharray', parts.join(' '));
    }
    g.append(path);

    return g;
  }

  _drawIntersection(g, cellSet, shape, row, col, cornerCut, inset) {
    // Determine which of the 4 cells touching grid point (row, col) are in region.
    const inRegion = (r, c) => {
      if (r < 0 || r >= shape.numRows || c < 0 || c >= shape.numCols) return false;
      return cellSet.has(shape.cellIndex(r, c));
    };

    const tl = inRegion(row - 1, col - 1);
    const tr = inRegion(row - 1, col);
    const bl = inRegion(row, col - 1);
    const br = inRegion(row, col);
    const count = tl + tr + bl + br;

    if (count === 0 || count === 4) return;

    const cellSize = DisplayItem.CELL_SIZE;
    const x = col * cellSize;
    const y = row * cellSize;
    const half = cellSize / 2;

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

  _makeRegionBorder(cellSet, shape, cornerCut, inset = 0) {
    const g = createSvgElement('g');
    const seen = new Set();

    const numIntersectionCols = shape.numCols + 1;
    for (const cell of cellSet) {
      const [row, col] = shape.splitCellIndex(cell);
      // Process each corner of this cell
      for (const [r, c] of [[row, col], [row, col + 1], [row + 1, col], [row + 1, col + 1]]) {
        const key = r * numIntersectionCols + c;
        if (seen.has(key)) continue;
        seen.add(key);
        this._drawIntersection(g, cellSet, shape, r, c, cornerCut, inset);
      }
    }

    return g;
  }
}

class Jigsaw extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;

  constructor(svg) {
    super(svg);

    this._regionGroup = createSvgElement('g');
    svg.append(this._regionGroup);

    this._regionElems = null;

    this._missingRegion = createSvgElement('g');
    this._missingRegion.setAttribute('fill', 'rgb(0, 0, 0)');
    this._missingRegion.setAttribute('opacity', '0.05');
    svg.append(this._missingRegion);

    this._colorPicker = new ColorPicker();

    this.clear();
  }

  clear() {
    this._colorPicker.clear();
    clearDOMNode(this._regionGroup);
    this._regionElems = new Map();
    this._updateMissingRegion();
  }

  removeItem(item) {
    if (this._regionElems.has(item)) {
      this._colorPicker.removeItem(item);
      item.parentNode?.removeChild(item);
      this._regionElems.delete(item);
      this._updateMissingRegion();
    }
  }

  drawItem(constraint, _) {
    const region = constraint.cells;
    const shape = this._shape;
    const cellSet = new Set(region.map(c => shape.parseCellId(c).cell));
    const graph = GridGraph.get(shape);

    const g = this._makeRegionBorder(cellSet, shape, /* cornerCut= */ false);
    g.setAttribute('stroke-width', 2);
    g.setAttribute('stroke', 'rgb(100, 100, 100)');
    g.setAttribute('stroke-linecap', 'round');

    if (!graph.cellsAreConnected(cellSet)) {
      const color = this._colorPicker.pickColor();
      for (const cell of cellSet) {
        const path = this._makeCellSquare(cell);
        path.setAttribute('fill', color);
        path.setAttribute('opacity', 0.1);
        g.appendChild(path);
      }
      this._colorPicker.addItem(g, color, ...cellSet);
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
    if (this._regionElems.size === 0) return;

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

class Indexing extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  drawItem(constraint, _) {
    const cells = constraint.cells;
    const g = createSvgElement('g');

    const patternId = this._makePattern(g, constraint.indexType);
    const fill = `url(#${patternId})`

    for (const cellId of cells) {
      const path = this._makeCellSquare(
        this._shape.parseCellId(cellId).cell);
      path.setAttribute('fill', fill);
      path.setAttribute('opacity', '0.2');

      g.appendChild(path);
    }

    this._svg.append(g);
    return g;
  }

  _INDEXING_COL_COLOR = 'rgb(255, 150, 150)';
  _INDEXING_ROW_COLOR = 'rgb(50, 200, 50)';
  _nextPatternId = 0;

  _makePattern(g, indexType) {
    const patternId = this._nextPatternId++;
    g.appendChild(this._makeSquarePattern(
      patternId,
      indexType === SudokuConstraint.Indexing.ROW_INDEXING ?
        this._INDEXING_ROW_COLOR : this._INDEXING_COL_COLOR));
    return patternId;
  }
}

class GenericLine extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  drawItem(constraint, options) {
    const item = this._makeItem(constraint, options);
    this._svg.append(item);

    return item;
  }

  makeIcon(constraint, options) {
    return this._makeItem(constraint, options);
  }

  _makeItem(constraint, options) {
    // TODO: Inline cellArgs.
    const cellArgs = new CellArgs(constraint.cells, constraint.type);
    const cells = cellArgs.cells().slice();
    if (cellArgs.isLoop()) {
      cells.push(cells[0]);
    }

    return this._makeConstraintLine(cells, options);
  }
}

class Thermo extends GenericLine { }

class CustomLine extends GenericLine {
  constructor(svg) {
    super(svg);
    this._colorPicker = new ColorPicker();
  }

  clear() {
    super.clear();
    this._colorPicker.clear();
  }

  removeItem(item) {
    if (this._colorPicker.removeItem(item)) {
      item.parentNode?.removeChild(item);
    }
  }

  makeIcon(constraint, options) {
    return this._makeItem(constraint, options);
  }

  drawItem(constraint, options) {
    const item = this._makeItem(constraint, options);
    this._svg.append(item);
    return item;
  }

  _makeItem(constraint, options) {
    const cells = constraint.cells;

    const colorKey = `${constraint.displayKey()}-${constraint.type}`;
    // Note: We want the colors to be consistent, even for makeIcon.
    const color = this._colorPicker.pickColor(colorKey);

    const elem = this._makeConstraintLine(
      cells,
      {
        color,
        width: LineOptions.THIN_LINE_WIDTH,
        nodeMarker: options.nodeMarker,
        startMarker: LineOptions.SMALL_FULL_CIRCLE_MARKER,
        dashed: options.dashed || true,
      });

    this._colorPicker.addItem(elem, color, colorKey);

    return elem;
  }
}

class PillArrow extends GenericLine {
  _nextMaskId = 0;

  drawItem(constraint, _) {
    const item = this._makeItem(constraint, false);
    this._svg.append(item);
    return item;
  }

  makeIcon(constraint, _) {
    return this._makeItem(constraint, true);
  }

  _makeItem(constraint, isIcon) {
    const cells = constraint.cells;
    const pillSize = constraint.pillSize;

    const pillWidth = this._CIRCLE_RADIUS * 2;

    // Create with default line options.
    const options = new LineOptions();
    const g = createSvgElement('g');
    g.setAttribute('stroke', options.color);
    g.setAttribute('fill', options.color);
    g.setAttribute('stroke-width', options.width);
    g.setAttribute('stroke-linecap', 'round');

    const points = cells.map(c => this.cellIdCenter(c));
    const pillPoints = points.slice(0, pillSize);

    // Make the mask for the inside of the pill.
    const maskId = 'pill-mask-' + this._nextMaskId++;
    {
      const mask = createSvgElement('mask');
      mask.setAttribute('id', maskId);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');

      const rect = createSvgElement('rect');
      rect.setAttribute('fill', 'white');
      rect.setAttribute('stroke-width', 0);
      rect.setAttribute('width', '100%');
      rect.setAttribute('height', '100%');
      mask.append(rect);

      const pillInside = this._makePath(pillPoints);
      pillInside.setAttribute('stroke-width', pillWidth - 2 * options.width);
      pillInside.setAttribute('stroke', 'black');
      mask.append(pillInside);
      g.append(mask);
    }

    // Draw the pill.
    {
      const pill = this._makePath(pillPoints);
      pill.setAttribute('stroke-width', pillWidth);
      if (!isIcon) {
        pill.setAttribute('mask', `url(#${maskId})`);
      }
      g.append(pill);
    }

    // Draw the arrow.
    {
      const arrow = this._makePath(points.slice(pillSize - 1));
      arrow.setAttribute('marker-end', 'url(#arrowhead)');
      if (!isIcon) {
        arrow.setAttribute('mask', `url(#${maskId})`);
      }
      g.append(arrow);
    }

    return g;
  }
}

class Dot extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  drawItem(constraint, options) {
    const g = createSvgElement('g');
    g.setAttribute('fill', options.color);
    g.setAttribute('stroke', 'black');
    g.setAttribute('stroke-width', 1);

    for (const [a, b] of constraint.adjacentPairs(this._shape)) {
      // Find the midpoint between the squares.
      let [x0, y0] = this.cellIndexCenter(a);
      let [x1, y1] = this.cellIndexCenter(b);
      let x = (x0 + x1) / 2;
      let y = (y0 + y1) / 2;

      let dot = createSvgElement('circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', 4);
      g.append(dot);
    }

    this._svg.append(g);

    return g;
  }
}
class Letter extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  drawItem(constraint, _) {
    const letter = constraint.type.toLowerCase();

    const g = createSvgElement('g');

    for (const [a, b] of constraint.adjacentPairs(this._shape)) {

      // Find the midpoint between the squares.
      let [x0, y0] = this.cellIndexCenter(a);
      let [x1, y1] = this.cellIndexCenter(b);
      let x = (x0 + x1) / 2;
      let y = (y0 + y1) / 2;

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
    }

    this._svg.append(g);

    return g;
  }
}

class ShadedRegion extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  constructor(svg) {
    super(svg);
    this._unusedPatternId = 0;
    this._cellColors = new ColorPicker();

    this.clear();
  }

  clear() {
    super.clear();
    this._cellColors.clear();
  }

  removeItem(item) {
    if (this._cellColors.removeItem(item)) {
      item.parentNode?.removeChild(item);
    }
  }

  drawItem(constraint, options) {
    const item = this._makeItem(constraint, options, null);
    this._svg.append(item);
    return item;
  }

  makeIcon(constraint, options) {
    return this._makeItem(constraint, options, 'blue');
  }

  _makeItem(constraint, options, colorOverride) {
    const cells = constraint.cells;
    const label = constraint[options?.labelField];

    const region = this._makeRegion(
      cells, label, options?.pattern, colorOverride);

    if (options?.lineConfig) {
      const line = this._makeConstraintLine(cells, options.lineConfig);
      region.append(line);
    }

    return region;
  }

  _makeRegion(cells, label, pattern, colorOverride) {
    let x, y;

    const region = createSvgElement('g');

    const cellIndexes = cells.map(c => this._shape.parseCellId(c).cell);
    const color = colorOverride || this._chooseCellColor(cellIndexes);

    let patternId = null;
    if (pattern) {
      patternId = 'shaded-region-' + this._unusedPatternId++;
      let patternSvg = null;
      switch (pattern) {
        case DisplayItem.SQUARE_PATTERN:
          patternSvg = this._makeSquarePattern(patternId, color);
          break;
        case DisplayItem.DIAGONAL_PATTERN:
          patternSvg = this._makeDiagonalPattern(patternId, color);
          break;
        case DisplayItem.CHECKERED_PATTERN:
          patternSvg = this._makeCheckeredPattern(patternId, color);
          break;
        case DisplayItem.HORIZONTAL_LINE_PATTERN:
          patternSvg = this._makeHorizontalLinePattern(patternId, color);
          break;
        default:
          throw new Error(`Unknown pattern: ${pattern}`);
      }
      region.appendChild(patternSvg);
    }

    for (const cell of cellIndexes) {
      const path = this._makeCellSquare(cell);
      if (pattern) {
        path.setAttribute('fill', `url(#${patternId})`);
      } else {
        path.setAttribute('fill', color);
      }
      path.setAttribute('opacity', '0.1');

      region.appendChild(path);
    }

    if (!colorOverride) {
      this._cellColors.addItem(region, color, ...cellIndexes);
    }

    // Draw the sum in the top-left most cell. Luckily, this is the sort order.
    const topLeftCell = cells.reduce((a, b) => a < b ? a : b);
    [x, y] = this.cellIdTopLeftCorner(topLeftCell);

    if (label !== undefined) {
      const text = this.makeTextNode(label, x, y, 'shaded-region-label');
      region.append(text);
      text.setAttribute('filter', 'url(#text-bg-filter)');
    }

    return region;
  }

  _chooseCellColor(cellIds) {
    const shape = this._shape;
    // Use a greedy algorithm to choose the graph color.
    const adjacentCells = [];
    const graph = GridGraph.get(shape);
    for (const cell of cellIds) {
      for (const adjCell of graph.cellEdges(cell)) {
        if (adjCell !== null) adjacentCells.push(adjCell);
      }
    }
    return this._cellColors.pickColor(null, adjacentCells);
  }
}

class CountingCircles extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  constructor(svg) {
    super(svg);
    this._circleColors = new ColorPicker();
  }

  clear() {
    super.clear();
    this._circleColors.clear();
  }

  removeItem(item) {
    if (this._circleColors.removeItem(item)) {
      item.parentNode?.removeChild(item);
    }
  }

  drawItem(constraint, _) {
    const item = this._makeItem(constraint, null);
    this._svg.append(item);
    return item;
  }

  makeIcon(constraint, _) {
    return this._makeItem(constraint, 'blue');
  }

  _makeItem(constraint, colorOverride) {
    const cells = constraint.cells;
    const region = createSvgElement('g');
    const color = colorOverride || this._circleColors.pickColor();

    for (const cellId of cells) {
      const point = this.cellIdCenter(cellId);
      const circle = this._makeCircleAtPoint(point);
      circle.setAttribute('stroke', color);
      circle.setAttribute('fill', 'transparent');
      circle.setAttribute('stroke-width', 2);
      circle.setAttribute('opacity', '0.3');

      region.appendChild(circle);
    }

    if (!colorOverride) {
      this._circleColors.addItem(region, color, ...cells);
    }

    return region;
  }
}

class Quad extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  drawItem(constraint) {
    const topLeftCell = constraint.topLeftCell;
    const values = constraint.values;

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
    const offset = numValues === 1 ? 0 : QUAD_TEXT_OFFSET;
    for (let i = 0; i < numValues; i++) {
      const value = values[i];
      const x = cx + Math.cos(startAngle + i * angleInc) * offset;
      const y = 1 + cy + Math.sin(startAngle + i * angleInc) * offset;
      const text = this.makeTextNode(value, x, y, 'quad-value');
      quad.appendChild(text);
    }

    this._svg.append(quad);

    return quad;
  }
}

class Diagonal extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;
  DIRECTIONS = [1, -1];

  constructor(svg) {
    super(svg);

    svg.setAttribute('stroke-width', 1);
    svg.setAttribute('stroke', 'rgb(255, 0, 0)');
  }

  drawItem(constraint, _) {
    const direction = constraint.direction;
    const shape = this._shape;

    const gridWidth = DisplayItem.CELL_SIZE * shape.numCols;
    const gridHeight = DisplayItem.CELL_SIZE * shape.numRows;
    const line = this._makePath([
      [0, direction > 0 ? gridHeight : 0],
      [gridWidth, direction > 0 ? 0 : gridHeight],
    ]);

    this.getSvg().appendChild(line);

    return line;
  }

  clear() {
    super.clear();
  }
}

class Windoku extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;

  constructor(svg) {
    super(svg);

    svg.setAttribute('fill', 'rgb(255, 0, 255)');
    svg.setAttribute('opacity', '0.1');

    this.clear();
  }

  clear() {
    this.removeItem(null);
  }

  reshape(shape) {
    super.reshape(shape);
    super.clear();

    const svg = this.getSvg();

    for (const region of SudokuConstraint.Windoku.regions(shape)) {
      for (const cell of region) {
        svg.append(this._makeCellSquare(cell));
      }
    }
  }

  drawItem(constraint, _) {
    this.getSvg().setAttribute('display', null);
    return this.getSvg();
  }

  removeItem(item) {
    this.getSvg().setAttribute('display', 'none');
  }
}

class DefaultRegionsInverted extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;

  constructor(svg) {
    super(svg);

    svg.setAttribute('stroke-width', 2);
    svg.setAttribute('stroke', 'rgb(0, 0, 0)');
    svg.setAttribute('stroke-linecap', 'round');

    this.clear();
  }

  clear() {
    this.removeItem(null);
  }

  reshape(shape) {
    super.reshape(shape);
    super.clear();

    const cellSize = DisplayItem.CELL_SIZE;
    const gridWidthPixels = cellSize * shape.numCols;
    const gridHeightPixels = cellSize * shape.numRows;
    const svg = this.getSvg();

    if (shape.noDefaultBoxes) return;

    for (let i = shape.boxWidth; i < shape.numCols; i += shape.boxWidth) {
      svg.appendChild(this._makePath([
        [i * cellSize, 0],
        [i * cellSize, gridHeightPixels],
      ]));
    }
    for (let i = shape.boxHeight; i < shape.numRows; i += shape.boxHeight) {
      svg.appendChild(this._makePath([
        [0, i * cellSize],
        [gridWidthPixels, i * cellSize],
      ]));
    }
  }

  drawItem(constraint, _) {
    this.getSvg().setAttribute('display', 'none');
    return this.getSvg();
  }

  removeItem(_) {
    this.getSvg().setAttribute('display', null);
  }
}

class BorderedRegion extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  constructor(svg) {
    super(svg);
    this._items = [];
    this._colorPicker = new ColorPicker();
  }

  clear() {
    super.clear();
    this._colorPicker.clear();
  }

  removeItem(item) {
    if (this._colorPicker.removeItem(item)) {
      item.parentNode?.removeChild(item);
    }
  }

  drawItem(constraint, options) {
    const item = this._makeItem(constraint, options, null);
    this._svg.append(item);
    return item;
  }

  makeIcon(constraint, options) {
    return this._makeItem(constraint, options, 'gray');
  }

  _makeItem(constraint, options, colorOverride) {
    const shape = this._shape;
    const color = colorOverride || this._colorPicker.pickColor();

    let groups = null;
    if (options.splitFn) {
      groups = options.splitFn(constraint);
    } else {
      groups = [constraint.getCells(shape)];
    }

    const g = createSvgElement('g');

    const fillOpacity = options.fillOpacity;
    for (const group of groups) {
      const cellSet = new Set(group.map(c => shape.parseCellId(c).cell));

      if (fillOpacity !== undefined) {
        for (const cell of cellSet) {
          const path = this._makeCellSquare(cell);
          path.setAttribute('fill', color);
          path.setAttribute('opacity', String(fillOpacity));
          g.append(path);
        }
      }

      const border = this._makeRegionBorder(
        cellSet,
        shape,
        /* cornerCut= */ true,
        options.inset);
      g.append(border);
    }

    const strokeWidth = options.strokeWidth ?? (
      options.inset ? options.inset * 2 : 5);
    g.setAttribute('stroke-width', strokeWidth);
    g.setAttribute('stroke', color);
    if (options.dashed) g.setAttribute('stroke-dasharray', '8 2');
    g.setAttribute('opacity', options.opacity ?? 0.4);
    g.setAttribute('stroke-linejoin', 'round');

    if (!colorOverride) {
      this._colorPicker.addItem(g, color, groups.flat());
    }

    return g;
  }
}

class OutsideClue extends BaseConstraintDisplayItem {
  constructor(svg, inputManager) {
    super(svg);
    inputManager.addSelectionPreserver(svg);

    let selectedArrow = null;
    inputManager.onSelection((cells) => {
      if (selectedArrow) selectedArrow.classList.remove('selected-arrow');
      selectedArrow = null;
      inputManager.updateOutsideArrowSelection(null);
    });

    this._handleClick = (arrowId, cells) => {
      inputManager.setSelection(cells);
      inputManager.updateOutsideArrowSelection(arrowId);

      const arrow = this._outsideArrowMap.get(arrowId);
      selectedArrow = arrow.svg;
      selectedArrow.classList.add('selected-arrow');
    };

    this._outsideArrowMap = new Map();
  }

  clear() {
    for (const arrowId of this._outsideArrowMap.keys()) {
      const textNode = this._getArrowTextElement(arrowId);
      clearDOMNode(textNode);
      this._updateValueLayout(textNode);
    }
  }

  reshape(shape) {
    super.reshape(shape);
    super.clear();
    this._outsideArrowMap.clear();

    const diagonalCellMap = SudokuConstraint.LittleKiller.cellMap(shape);
    for (const arrowId in diagonalCellMap) {
      this._addArrowSvg(
        'diagonal-arrow', arrowId, diagonalCellMap[arrowId]);
    }
    for (const [arrowId, cells] of SudokuConstraintBase.fullLineCellMap(shape)) {
      if (cells.length > 1) {
        this._addArrowSvg('full-line-arrow', arrowId, cells);
      }
    }
  }

  drawItem(constraint, displayConfig) {
    const { arrowId, value } = constraint;

    const textNode = this._getArrowTextElement(arrowId);
    if (!textNode) return null;  // Invalid arrowId.

    const valueString = displayConfig.clueTemplate.replace('$CLUE', value);
    const tspan = createSvgElement('tspan');
    tspan.appendChild(document.createTextNode(valueString));
    textNode.appendChild(tspan);

    this._updateValueLayout(textNode);

    return tspan;
  }

  removeItem(item) {
    const textNode = item.parentNode;
    if (textNode) {
      textNode.removeChild(item);
      this._updateValueLayout(textNode);
    }
  }

  _getArrowTextElement(arrowId) {
    return this._outsideArrowMap.get(arrowId)?.svg.lastChild;
  }

  _updateValueLayout(textNode) {
    const tspans = textNode.childNodes;

    {
      const elem = textNode.parentNode;
      // If there are no values, set it inactive and stop.
      if (!tspans.length) {
        elem.classList.remove('active-arrow');
        return;
      }

      elem.classList.add('active-arrow');
    }

    if (textNode.classList.contains('vertical-text')) {
      // For rows, we need to show the values vertically.
      // Adjust the tspan positions.

      // Set the x position to the default for the text element.
      // This is as if we were positioning a single value.
      const x = textNode.getAttribute('x');
      // The spacing between each value (in line-height units).
      const spacingEm = 1.2;
      // The initial y value needs to be adjusted for the fact we have
      // multiple lines. We are adjusting from a baseline of a single line.
      const initialDyEm = -spacingEm * (tspans.length - 1) / 2;
      for (let i = 0; i < tspans.length; i++) {
        const tspan = tspans[i];
        tspan.setAttribute('x', x);
        tspan.setAttribute('dy', (i === 0 ? initialDyEm : spacingEm) + 'em');
      }
    }

    // Choose font size based on the number of values.
    const fontSize = 17 - 2 * tspans.length;
    textNode.setAttribute('style', `font-size: ${fontSize}px`);
  }

  _addArrowSvg(arrowType, arrowId, cells) {
    const shape = this._shape;

    const parsedCells = cells.map(c => shape.parseCellId(c));

    const cell0 = parsedCells[0];
    const cell1 = parsedCells[1];

    const arrowSvg = this._makeArrow(
      cell0.row, cell0.col,
      cell1.row - cell0.row,
      cell1.col - cell0.col);
    this.getSvg().appendChild(arrowSvg);

    this._outsideArrowMap.set(
      arrowId,
      { svg: arrowSvg, cells: parsedCells.map(p => p.cell) });
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
    let textOffsetFactor = dx * dy ? 0.6 : 0.4;
    text.setAttribute('x', arrowX - dx * textOffsetFactor);
    text.setAttribute('y', arrowY - dy * textOffsetFactor);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    if (dr === 0) text.classList.add('vertical-text');

    let arrow = createSvgElement('g');
    arrow.appendChild(hitbox);
    arrow.appendChild(path);
    arrow.appendChild(text);
    arrow.classList.add('outside-arrow');

    return arrow;
  };
}

class Givens extends BaseConstraintDisplayItem {
  constructor(svg) {
    super(svg);

    const REPLACE_CHAR = '●';
    const valueFn = v => {
      return REPLACE_CHAR + (v < 10 ? '' : ' ');
    };

    this._maskMap = new Map();

    this._cellDisplay = new CellValueDisplay(svg, valueFn);
  }

  reshape(shape) {
    super.reshape(shape);
    this._cellDisplay.reshape(shape);
  }

  drawItem(constraint) {
    const values = constraint.values;
    const item = this._cellDisplay.makeGridValue(
      this._shape.parseCellId(constraint.cell).cell,
      values.length === 1 ? values[0] : values);
    this._svg.append(item);

    if (values.length === 1) {
      this._maskMap.set(
        item, this._cellDisplay.maskCell(constraint.cell));
    }

    return item;
  }

  removeItem(item) {
    super.removeItem(item);

    const maskItem = this._maskMap.get(item);
    if (maskItem) {
      maskItem.parentNode?.removeChild(maskItem);
      this._maskMap.delete(item);
    }
  }

  clear() {
    super.clear();
    this._cellDisplay.constructor.clearMask();
    this._maskMap.clear();
  }
}

class GreaterThan extends BaseConstraintDisplayItem {
  static IS_DIMMABLE = true;

  drawItem(constraint, options) {
    const result = createSvgElement("g");
    result.setAttribute('fill', 'transparent');
    result.setAttribute('stroke', 'black');
    result.setAttribute('stroke-width', 1.5);
    result.setAttribute('stroke-linecap', 'round');

    for (const [cell0, cell1] of constraint.adjacentPairs(this._shape)) {
      result.appendChild(this._drawGreaterThanDecoration(cell0, cell1));
    }

    this._svg.append(result);
    return result;
  }

  _drawGreaterThanDecoration(cell0, cell1) {
    // Find the midpoint between the squares.
    const [x0, y0] = this.cellIndexCenter(cell0);
    const [x1, y1] = this.cellIndexCenter(cell1);
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;
    const cellSize = DisplayItem.CELL_SIZE;
    const COMPARISON_SIZE = 0.1 * cellSize;
    const INSET = 0;
    const SQUASH = 0.4;
    const dC = Math.sign(x1 - x0);
    const dR = Math.sign(y1 - y0);
    if (dC === 0) {
      // Vertical comparison
      if (dR === 0) throw new Error("Can't have self comparison");
      return this._makePath([
        [x - COMPARISON_SIZE, y - dR * COMPARISON_SIZE * SQUASH - dR * INSET],
        [x, y + dR * COMPARISON_SIZE * SQUASH - dR * INSET],
        [x + COMPARISON_SIZE, y - dR * COMPARISON_SIZE * SQUASH - dR * INSET]
      ]);
    } else if (dR === 0) {
      // Horizontal comparison
      if (dC === 0) throw new Error("Can't have self comparison");
      return this._makePath([
        [x - dC * COMPARISON_SIZE * SQUASH - dC * INSET, y - COMPARISON_SIZE],
        [x + dC * COMPARISON_SIZE * SQUASH - dC * INSET, y],
        [x - dC * COMPARISON_SIZE * SQUASH - dC * INSET, y + COMPARISON_SIZE]
      ]);
    }
    throw new Error("Invalid comparison direction");
  }
}

export class ConstraintDisplay extends DisplayItem {
  constructor(inputManager, displayContainer) {
    super();

    displayContainer.addElement(this.constructor._makeArrowhead());
    displayContainer.addElement(this.constructor._makeTextBgFilter());
    displayContainer.addElement(CellValueDisplay.makeGivensMask());

    this._gridDisplay = new GridDisplay(
      displayContainer.getNewGroup('base-grid-group'));

    this._constraintDisplays = new Map();
    for (const displayClass of constraintDisplayOrder()) {
      const name = displayClass.name;
      const groupClass = name.toLowerCase() + '-group';
      const group = displayContainer.getNewGroup(groupClass);
      this._constraintDisplays.set(
        name, new displayClass(group, inputManager));
      this._applyGridOffset(group);
    }

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
    this._borders.reshape(shape);
  }

  // Reusable arrowhead marker.
  static _makeArrowhead() {
    const arrowhead = createSvgElement('marker');
    arrowhead.id = 'arrowhead';
    arrowhead.setAttribute('refX', '3');
    arrowhead.setAttribute('refY', '2');
    arrowhead.setAttribute('markerWidth', '4');
    arrowhead.setAttribute('markerHeight', '5');
    arrowhead.setAttribute('orient', 'auto');
    const arrowPath = createSvgElement('path');
    arrowPath.setAttribute('d', 'M 0 0 L 3 2 L 0 4');
    arrowPath.setAttribute('fill', 'none');
    arrowPath.setAttribute('stroke-width', 1);
    arrowPath.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrowhead.appendChild(arrowPath);

    return arrowhead;
  }

  static _makeTextBgFilter() {
    const filter = createSvgElement('filter');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '1');
    filter.setAttribute('height', '1');
    filter.setAttribute('id', 'text-bg-filter');

    const flood = createSvgElement('feFlood');
    flood.setAttribute('flood-color', 'rgba(255,255,255,0.6)');
    filter.appendChild(flood);

    const composite = createSvgElement('feComposite');
    composite.setAttribute('in', 'SourceGraphic');
    filter.appendChild(composite);

    return filter;
  }

  clear() {
    for (const display of this._constraintDisplays.values()) {
      display.clear();
    }
  }

  removeConstraint(constraint, item) {
    const displayClass = constraint.constructor.DISPLAY_CONFIG.displayClass;
    return this._constraintDisplays.get(displayClass).removeItem(item);
  }

  drawConstraint(constraint) {
    const config = constraint.constructor.DISPLAY_CONFIG;
    const item = this._constraintDisplays.get(
      config.displayClass).drawItem(constraint, config);
    return item;
  }

  makeConstraintIcon(constraint) {
    const config = constraint.constructor.DISPLAY_CONFIG;
    if (!config) return null;
    return this._constraintDisplays.get(
      config.displayClass).makeIcon(constraint, config);
  }
}