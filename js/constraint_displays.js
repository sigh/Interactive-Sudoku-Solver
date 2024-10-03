class ConstraintDisplays {
  static displayOrder() {
    return [
      this.DefaultRegionsInverted,
      this.Windoku,
      this.Jigsaw,
      this.BorderedRegion,
      this.Indexing,
      this.Thermo,
      this.PillArrow,
      this.GenericLine,
      this.CustomBinary,
      this.ShadedRegion,
      this.CountingCircles,
      this.Diagonal,
      this.Dot,
      this.Letter,
      this.Quad,
      this.OutsideClue,
    ]
  }
}

class BaseConstraintDisplayItem extends DisplayItem {
  static IS_LAYOUT = false;

  constructor(svg) {
    super(svg);

    svg.classList.add(
      this.constructor.IS_LAYOUT ? 'layout-constraint' : 'non-layout-constraint');
  }

  clear() {
    clearDOMNode(this._svg);
  }

  // drawItem should return an item that can be passed to removeItem to remove
  // the item from the display.
  // If the item can be displayed as an icon, the returned value should be an
  // svg element.
  drawItem(constraint, options) { throw 'Unimplemented'; }

  removeItem(item) {
    item.parentNode.removeChild(item);
    return true;
  }

  toggleItem(constraint, enable) { throw 'Unimplemented'; }

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

  _drawConstraintLineMarker(marker, points, index) {
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
        throw (`Unknown marker: ${marker}`);
    }
  }

  _drawConstraintLine(cells, options, container) {
    const len = cells.length;
    if (len < 2) throw (`Line too short: ${cells}`)

    if (options.constructor != LineOptions) {
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
      g.append(this._drawConstraintLineMarker(
        startMarker, points, 0));
    }
    if (endMarker) {
      g.append(this._drawConstraintLineMarker(
        endMarker, points, len - 1));
    }
    if (nodeMarker) {
      for (let i = 1; i < len - 1; i++) {
        g.append(this._drawConstraintLineMarker(
          nodeMarker, points, i));
      }
    }

    // Make and style the path.
    const path = this._makePath(points);
    if (options.arrow) {
      path.setAttribute('marker-end', 'url(#arrowhead)');
    }
    if (options.dashed) {
      path.setAttribute(
        'stroke-dasharray',
        (options.width / 2) + ' ' + (options.width * 2));
    }
    g.append(path);

    container.append(g);

    return g;
  }

  static _isStrictDiagonal(graph, cellSet, cell, dir0, dir1) {
    return (
      !cellSet.has(graph.adjacent(cell, dir0))
      && !cellSet.has(graph.adjacent(cell, dir1))
      && cellSet.has(graph.diagonal(cell, dir0, dir1)));
  }

  _makeRegionBorder(graph, cellSet, shape, cutSize) {
    const g = createSvgElement('g');

    const cellSize = DisplayItem.CELL_SIZE;
    cutSize ||= 0;
    const cls = this.constructor;

    const borderEdgeParts = (cell, row, col, edgeType) => {
      // Points with any offsets applied.
      const parts = [
        [col * cellSize, row * cellSize],
        [col * cellSize, row * cellSize]];

      // Apply offsets to create the basic border.
      const direction = (edgeType == GridGraph.RIGHT || edgeType == GridGraph.DOWN) ? 1 : 0;
      const orientation = (edgeType == GridGraph.UP || edgeType == GridGraph.DOWN) ? 1 : 0;
      parts[0][orientation] += direction * cellSize;
      parts[1][orientation] += direction * cellSize;
      parts[1][1 - orientation] += cellSize;

      // If we don't need to cut across to diagonals, we're done.
      if (cutSize == 0) return parts;

      const rowOffset = direction ? cutSize : -cutSize;
      const diagStartType = orientation ? GridGraph.LEFT : GridGraph.UP;
      const diagEndType = orientation ? GridGraph.RIGHT : GridGraph.DOWN;

      // NOTE: The diagonal extended from the LEFT/RIGHT edges.
      if (cls._isStrictDiagonal(graph, cellSet, cell, edgeType, diagEndType)) {
        parts[1][1 - orientation] -= cutSize;
        if (orientation == 0) {
          parts.push([parts[1][0] + rowOffset, parts[1][1] + cutSize]);
        }
      }
      // Update the start second, otherwise the indexes are messed up if we
      // unshift.
      if (cls._isStrictDiagonal(graph, cellSet, cell, edgeType, diagStartType)) {
        parts[0][1 - orientation] += cutSize;
        if (orientation == 0) {
          parts.unshift([parts[0][0] + rowOffset, parts[0][1] - cutSize]);
        }
      }

      return parts;
    }

    for (const cell of cellSet) {
      const edges = graph.cellEdges(cell);
      const [row, col] = shape.splitCellIndex(cell);
      for (let edgeType = 0; edgeType < edges.length; edgeType++) {
        if (!cellSet.has(edges[edgeType])) {
          g.appendChild(
            this._makePath(
              borderEdgeParts(cell, row, col, edgeType)));
        }
      }
    }

    return g;
  }
}

ConstraintDisplays.Jigsaw = class Jigsaw extends BaseConstraintDisplayItem {
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
      item.parentNode.removeChild(item);
      this._regionElems.delete(item);
      this._updateMissingRegion();
      return true;
    }
    return false;
  }

  drawItem(constraint, _) {
    const region = constraint.cells;
    const shape = this._shape;
    const cellSet = new Set(region.map(c => shape.parseCellId(c).cell));
    const graph = GridGraph.get(shape);

    const g = this._makeRegionBorder(graph, cellSet, shape);
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

ConstraintDisplays.Indexing = class Indexing extends BaseConstraintDisplayItem {
  drawItem(constraint) {
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
      indexType == SudokuConstraint.Indexing.ROW_INDEXING ?
        this._INDEXING_ROW_COLOR : this._INDEXING_COL_COLOR));
    return patternId;
  }
}

ConstraintDisplays.GenericLine = class GenericLine extends BaseConstraintDisplayItem {
  drawItem(constraint, options) {
    // TODO: Inline cellArgs.
    const cellArgs = new CellArgs(constraint.cells, constraint.type);
    const cells = cellArgs.cells().slice();
    if (cellArgs.isLoop()) {
      cells.push(cells[0]);
    }
    return this._drawConstraintLine(cells, options, this._svg);
  }
}

ConstraintDisplays.Thermo = class Thermo extends ConstraintDisplays.GenericLine { }

ConstraintDisplays.CustomBinary = class CustomBinary extends ConstraintDisplays.GenericLine {
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
      item.parentNode.removeChild(item);
      return true;
    }
    return false;
  }

  drawItem(constraint, _) {
    const cells = constraint.cells;

    const colorKey = `${constraint.key}-${constraint.type}`;
    const color = this._colorPicker.pickColor(colorKey);

    const elem = this._drawConstraintLine(
      cells,
      {
        color,
        width: LineOptions.THIN_LINE_WIDTH,
        nodeMarker: LineOptions.SMALL_FULL_CIRCLE_MARKER,
        startMarker: (constraint.type !== 'BinaryX') ? LineOptions.SMALL_EMPTY_CIRCLE_MARKER : undefined,
        dashed: true,
      },
      this._svg);
    this._colorPicker.addItem(elem, color, colorKey);

    return elem;
  }
}

ConstraintDisplays.PillArrow = class PillArrow extends ConstraintDisplays.GenericLine {
  _nextMaskId = 0;

  drawItem(constraint, _) {
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

      const maxX = Math.max(...points.map(p => p[0]));
      const maxY = Math.max(...points.map(p => p[1]));

      const rect = createSvgElement('rect');
      rect.setAttribute('fill', 'white');
      rect.setAttribute('stroke-width', 0);
      rect.setAttribute('width', maxX + pillWidth * 2);
      rect.setAttribute('height', maxY + pillWidth * 2);
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
      pill.setAttribute('mask', `url(#${maskId})`);
      g.append(pill);
    }

    // Draw the arrow.
    {
      const arrow = this._makePath(points.slice(pillSize - 1));
      arrow.setAttribute('marker-end', 'url(#arrowhead)');
      arrow.setAttribute('mask', `url(#${maskId})`);
      g.append(arrow);
    }

    this._svg.append(g);

    return g;
  }
}

ConstraintDisplays.Dot = class Dot extends BaseConstraintDisplayItem {
  drawItem(constraint, options) {
    const cells = constraint.cells;
    if (cells.length != 2) throw (`Dot must be provided two cells: ${cells}`);

    // Find the midpoint between the squares.
    let [x0, y0] = this.cellIdCenter(cells[0]);
    let [x1, y1] = this.cellIdCenter(cells[1]);
    let x = (x0 + x1) / 2;
    let y = (y0 + y1) / 2;

    let dot = createSvgElement('circle');
    dot.setAttribute('fill', options.color);
    dot.setAttribute('stroke', 'black');
    dot.setAttribute('stroke-width', 1);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 4);

    this._svg.append(dot);

    return dot;
  }
}

ConstraintDisplays.Letter = class Letter extends BaseConstraintDisplayItem {
  drawItem(constraint, _) {
    const cells = constraint.cells;
    const letter = constraint.type.toLowerCase();

    if (cells.length != 2) throw (`Letter must be provided two cells: ${cells}`);

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

    this._svg.append(g);

    return g;
  }
}

ConstraintDisplays.ShadedRegion = class ShadedRegion extends BaseConstraintDisplayItem {
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
      item.parentNode.removeChild(item);
      return true;
    }
    return false;
  }

  drawItem(constraint, options) {
    const cells = constraint.cells;
    const label = constraint[options?.labelField];

    const region = this._drawRegion(cells, label, options?.pattern);

    if (options?.lineConfig) {
      this._drawConstraintLine(cells, options.lineConfig, region);
    }

    return region;
  }

  _drawRegion(cells, label, pattern) {
    let x, y;

    const region = createSvgElement('g');

    const cellIndexes = cells.map(c => this._shape.parseCellId(c).cell);
    const color = this._chooseCellColor(cellIndexes);

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
        default:
          throw `Unknown pattern: ${pattern}`;
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
    this._cellColors.addItem(region, color, ...cellIndexes);

    // Draw the sum in the top-left most cell. Luckily, this is the sort order.
    const topLeftCell = cells.reduce((a, b) => a < b ? a : b);
    [x, y] = this.cellIdTopLeftCorner(topLeftCell);

    this.getSvg().append(region);

    if (label !== undefined) {
      const text = this.makeTextNode(label, x, y, 'shaded-region-label');
      region.append(text);

      let textBackground = this.constructor._addTextBackground(text);
      textBackground.setAttribute('fill', 'rgb(200, 200, 200)');
    }

    return region;
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

ConstraintDisplays.CountingCircles = class CountingCircles extends BaseConstraintDisplayItem {
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
      item.parentNode.removeChild(item);
      return true;
    }
    return false;
  }

  drawItem(constraint, _) {
    const cells = constraint.cells;
    const region = createSvgElement('g');
    const color = this._circleColors.pickColor();

    for (const cellId of cells) {
      const point = this.cellIdCenter(cellId);
      const circle = this._makeCircleAtPoint(point);
      circle.setAttribute('stroke', color);
      circle.setAttribute('fill', 'transparent');
      circle.setAttribute('stroke-width', 2);
      circle.setAttribute('opacity', '0.3');

      region.appendChild(circle);
    }

    this._circleColors.addItem(region, color, ...cells);
    this.getSvg().append(region);

    return region;
  }
}

ConstraintDisplays.Quad = class Quad extends BaseConstraintDisplayItem {
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
    const offset = numValues == 1 ? 0 : QUAD_TEXT_OFFSET;
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

ConstraintDisplays.Diagonal = class Diagonal extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;
  DIRECTIONS = [1, -1];

  constructor(svg) {
    super(svg);
    this._diagonals = [null, null];

    svg.setAttribute('stroke-width', 1);
    svg.setAttribute('stroke', 'rgb(255, 0, 0)');
  }

  _directionIndex(direction) {
    return direction > 0;
  }

  toggleItem(constraint, enable) {
    if (enable) {
      this._drawDiagonal(constraint.direction);
    } else {
      this._removeDiagonal(constraint.direction);
    }
  }

  _drawDiagonal(direction) {
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

  _removeDiagonal(direction) {
    const index = this._directionIndex(direction);
    let item = this._diagonals[index];
    if (item) item.parentNode.removeChild(item);
    this._diagonals[index] = null;
  }

  clear() {
    for (const direction of this.DIRECTIONS) {
      this._removeDiagonal(direction);
    }
  }

  reshape(shape) {
    super.reshape(shape);

    // Redraw the diagonals with the correct shape.
    for (const direction of this.DIRECTIONS) {
      const index = this._directionIndex(direction);
      if (this._diagonals[index]) {
        this._removeDiagonal(direction);
        this._drawDiagonal(direction);
      }
    }
  }
}

ConstraintDisplays.Windoku = class Windoku extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;

  constructor(svg) {
    super(svg);

    svg.setAttribute('fill', 'rgb(255, 0, 255)');
    svg.setAttribute('opacity', '0.1');

    this.clear();
  }

  clear() {
    this.toggleItem(null, false);
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

  toggleItem(_, enable) {
    this.getSvg().setAttribute('display', enable ? null : 'none');
  }
}

ConstraintDisplays.DefaultRegionsInverted = class DefaultRegionsInverted extends BaseConstraintDisplayItem {
  static IS_LAYOUT = true;

  constructor(svg) {
    super(svg);

    svg.setAttribute('stroke-width', 2);
    svg.setAttribute('stroke', 'rgb(0, 0, 0)');
    svg.setAttribute('stroke-linecap', 'round');

    this.clear();
  }

  clear() {
    this.toggleItem(null, false);
  }

  reshape(shape) {
    super.reshape(shape);
    super.clear();

    const cellSize = DisplayItem.CELL_SIZE;
    const gridSizePixels = cellSize * shape.gridSize;
    const svg = this.getSvg();

    if (shape.noDefaultBoxes) return;

    for (let i = shape.boxWidth; i < shape.gridSize; i += shape.boxWidth) {
      svg.appendChild(this._makePath([
        [i * cellSize, 0],
        [i * cellSize, gridSizePixels],
      ]));
    }
    for (let i = shape.boxHeight; i < shape.gridSize; i += shape.boxHeight) {
      svg.appendChild(this._makePath([
        [0, i * cellSize],
        [gridSizePixels, i * cellSize],
      ]));
    }
  }

  toggleItem(_, enable) {
    this.getSvg().setAttribute('display', enable ? 'none' : null);
  }
}

ConstraintDisplays.BorderedRegion = class BorderedRegion extends BaseConstraintDisplayItem {
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
      item.parentNode.removeChild(item);
      return true;
    }
    return false;
  }

  drawItem(constraint, options) {
    const shape = this._shape;
    const graph = GridGraph.get(shape);
    const color = this._colorPicker.pickColor();

    let groups = null;
    if (options.splitFn) {
      groups = options.splitFn(constraint);
    } else {
      groups = [constraint.displayCells(shape)];
    }

    const g = createSvgElement('g');

    for (const group of groups) {
      const cellSet = new Set(group.map(c => shape.parseCellId(c).cell));

      const border = this._makeRegionBorder(graph, cellSet, shape, 10);
      g.append(border);
    }

    g.setAttribute('stroke-width', 5);
    g.setAttribute('stroke', color);
    if (options.dashed) g.setAttribute('stroke-dasharray', '8 2');
    g.setAttribute('opacity', options.opacity || 0.4);

    this._colorPicker.addItem(g, color, groups.flat());
    this._svg.append(g);

    return g;
  }
}

ConstraintDisplays.OutsideClue = class OutsideClue extends BaseConstraintDisplayItem {
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
    for (const [arrowId, config] of this._outsideArrowMap) {
      if (config.currentValues.length) {
        config.currentValues = [];
        this._updateArrowValues(arrowId);
      }
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

  static _valueString(constraint) {
    const clues = constraint.clues();
    if (clues.length !== 1) {
      throw Error(
        'Constraints passed to OutsideClueDisplay must have exactly one clue');
    }
    const value = clues[0].value;
    const type = constraint.type;

    return SudokuConstraint[type].DISPLAY_CONFIG.clueTemplate.replace(
      '$CLUE', value);
  }

  drawItem(constraint, displayConfig) {
    const clues = constraint.clues();
    if (clues.length !== 1) {
      throw Error(
        'Constraints passed to OutsideClueDisplay must have exactly one clue');
    }
    const { arrowId, value } = clues[0];

    const valueString = displayConfig.clueTemplate.replace('$CLUE', value);

    this._outsideArrowMap.get(arrowId).currentValues.push(valueString);
    this._updateArrowValues(arrowId);

    return { arrowId, valueString };
  }

  removeItem(item) {
    const { arrowId, valueString } = item;

    arrayRemoveValue(
      this._outsideArrowMap.get(arrowId).currentValues,
      valueString);
    this._updateArrowValues(arrowId);

    return true;
  }

  _updateArrowValues(arrowId) {
    const arrow = this._outsideArrowMap.get(arrowId);
    const elem = arrow.svg;

    // Remove all the old values.
    const textNode = elem.lastChild;
    clearDOMNode(textNode);

    // If there are no values, set it inactive and stop.
    const numValues = arrow.currentValues.length;
    if (!numValues) {
      elem.classList.remove('active-arrow');
      return;
    }

    elem.classList.add('active-arrow');

    // Construct the output strings.
    const valueStrings = arrow.currentValues;
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
    const fontSize = 17 - 2 * numValues;
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
      { svg: arrowSvg, currentValues: [] });
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

    let arrow = createSvgElement('g');
    arrow.appendChild(hitbox);
    arrow.appendChild(path);
    arrow.appendChild(text);
    arrow.classList.add('outside-arrow');

    return arrow;
  };
}
