class ConstraintDisplay {
  static SVG_PADDING = 27;
  static CELL_SIZE = 52;

  constructor(container, gridSelection) {
    let svg = createSvgElement('svg');
    let padding = ConstraintDisplay.SVG_PADDING;
    let sideLength = ConstraintDisplay.CELL_SIZE * GRID_SIZE + padding*2;
    svg.setAttribute('height', sideLength);
    svg.setAttribute('width', sideLength);
    svg.classList.add('sudoku-constraint-svg');

    container.style.padding = `${padding}px`;

    svg.append(this._makeGrid());

    this._initializeRegions(svg);

    const constraintGroup = createSvgElement('g');
    this._constraintGroup = constraintGroup;
    this._applyGridOffset(constraintGroup);
    svg.append(constraintGroup);

    svg.append(this._makeArrowhead());
    svg.append(this._makeLittleKillers(gridSelection));

    svg.append(this.makeBorders());

    container.prepend(svg);

    this._gridSelection = gridSelection;
    this.clear();  // clear() to initialize.
  }

  _initializeRegions(svg) {
    this._defaultRegions = this._makeDefaultRegions();
    svg.append(this._defaultRegions);

    this._regionContainer = createSvgElement('g');

    this._regionGroup = createSvgElement('g');

    this._applyGridOffset(this._regionContainer);
    this._regionContainer.append(this._regionGroup);

    this._missingRegion = createSvgElement('g');
    this._missingRegion.setAttribute('fill', 'rgb(0, 0, 0)');
    this._missingRegion.setAttribute('opacity', '0.05');
    this._regionContainer.append(this._missingRegion);

    svg.append(this._regionContainer);

    this._windokuRegion = createSvgElement('g');
    this._windokuRegion.setAttribute('fill', 'rgb(255, 0, 255)');
    this._windokuRegion.setAttribute('opacity', '0.1');
    for (const region of SudokuConstraint.Windoku.REGIONS) {
      for (const cell of region) {
        this._windokuRegion.append(this._makeCellSquare(cell));
      }
    }
    this.enableWindokuRegion(false);
    this._regionContainer.append(this._windokuRegion);
  }

  _makeLittleKillers(gridSelection) {
    const g = createSvgElement('g');
    this._applyGridOffset(g);

    const makeArrow = (row, col, dr, dc) => {
      const [x, y] = ConstraintDisplay.cellIdCenter(toCellId(row, col));
      const cellSize = ConstraintDisplay.CELL_SIZE;

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

    let form = document.forms['outside-arrow-input'];
    let selectionForm = document.forms['multi-cell-constraint-input'].firstElementChild;
    let selectedArrow = null;
    gridSelection.addCallback(() => {
      if (selectedArrow) selectedArrow.classList.remove('selected-arrow');
      selectedArrow = null;
      form.firstElementChild.disabled = true;
    });
    let formOptions = [
      document.getElementById('little-killer-option'),
      document.getElementById('sandwich-option'),
    ];
    let handleClick = (type, id, cells, arrowSvg) => {
      gridSelection.setCells(cells);
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

    this._outsideArrowMap = {};
    const addArrow = (type, id, cells) => {
      let cell0 = parseCellId(cells[0]);
      let cell1 = parseCellId(cells[1]);

      let arrowSvg = makeArrow(
        cell0.row, cell0.col,
        cell1.row-cell0.row,
        cell1.col-cell0.col);
      g.appendChild(arrowSvg);

      this._outsideArrowMap[id] = arrowSvg;
      arrowSvg.onclick = () => handleClick(type, id, cells, arrowSvg);
      arrowSvg.classList.add(type);
    };

    for (const id in SudokuConstraint.LittleKiller.CELL_MAP) {
      addArrow('little-killer', id, SudokuConstraint.LittleKiller.CELL_MAP[id]);
    }
    for (const id in SudokuConstraint.Sandwich.CELL_MAP) {
      addArrow('sandwich', id, SudokuConstraint.Sandwich.CELL_MAP[id]);
    }

    return g;
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

  static cellIdCenter(cellId) {
    const {row, col} = parseCellId(cellId);
    return ConstraintDisplay._cellCenter(row, col);
  }

  static cellCenter(cell) {
    return ConstraintDisplay._cellCenter(...toRowCol(cell));
  }

  static _cellCenter(row, col) {
    const cellSize = ConstraintDisplay.CELL_SIZE;
    return [col*cellSize + cellSize/2, row*cellSize + cellSize/2];
  }

  clear() {
    let svg = this._constraintGroup;
    while (svg.lastChild) {
      svg.removeChild(svg.lastChild);
    }
    svg = this._regionGroup;
    while (svg.lastChild) {
      svg.removeChild(svg.lastChild);
    }

    this.killerCellColors = new Map();
    this.killerCages = new Map();
    this._diagonals = [null, null];

    this._regionElems = new Map();
    this._updateMissingRegion();

    this.enableWindokuRegion(false);
    this.useDefaultRegions(true);
  }

  removeItem(item) {
    if (!item) return;
    item.parentNode.removeChild(item);
    if (this._regionElems.has(item)) {
      this._regionElems.delete(item);
      this._updateMissingRegion();
    } else if (this.killerCages.has(item)) {
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
      let {row, col} = parseCellId(cellId);
      // Lookup all  adjacent cells, it doesn't matter if they valid or not.
      conflictingColors.add(this.killerCellColors.get(toCellId(row, col+1)));
      conflictingColors.add(this.killerCellColors.get(toCellId(row, col-1)));
      conflictingColors.add(this.killerCellColors.get(toCellId(row+1, col)));
      conflictingColors.add(this.killerCellColors.get(toCellId(row-1, col)));
    }
    // Return the first color that doesn't conflict.
    for (const color of this.constructor.KILLER_CAGE_COLORS) {
      if (!conflictingColors.has(color)) return color;
    }
    // Otherwse select a random color.
    return `rgb(${Math.random()*255|0},${Math.random()*255|0},${Math.random()*255|0})`;
  }

  addOutsideArrow(id, sum) {
    let elem = this._outsideArrowMap[id];
    elem.classList.add('active-arrow');

    let text = elem.lastChild;
    if (text.lastChild) text.removeChild(text.lastChild);
    text.appendChild(document.createTextNode(sum));

    return elem;
  }

  removeOutsideArrow(initialCell) {
    let elem = this._outsideArrowMap[initialCell];
    elem.classList.remove('active-arrow');

    let text = elem.lastChild;
    if (text.lastChild) text.removeChild(text.lastChild);
  }

  drawKillerCage(cells, sum) {
    const cellWidth = ConstraintDisplay.CELL_SIZE;
    let x,y;

    const cage = createSvgElement('g');
    const color = this._chooseKillerCageColor(cells);

    for (const cellId of cells) {
      const path = this._makeCellSquare(parseCellId(cellId).cell);
      path.setAttribute('fill', color);
      path.setAttribute('opacity', '0.1');

      cage.appendChild(path);
    }
    this.killerCages.set(cage, [...cells]);
    cells.forEach(cell => this.killerCellColors.set(cell, color));

    // Draw the sum in the top-left most cell. Luckly, this is the sort order.
    cells.sort();
    [x, y] = ConstraintDisplay.cellIdCenter(cells[0]);

    let text = createSvgElement('text');
    text.appendChild(document.createTextNode(sum));
    text.setAttribute('x', x - cellWidth/2);
    text.setAttribute('y', y - cellWidth/2 + 2);
    text.setAttribute('dominant-baseline', 'hanging');
    text.setAttribute('style',
      'font-size: 10; font-family: monospace; font-weight: bold;');
    cage.append(text);
    this._constraintGroup.append(cage);

    let textBackground = ConstraintDisplay._addTextBackground(text);
    textBackground.setAttribute('fill', 'rgb(200, 200, 200)');

    return cage;
  }

  drawDot(cells, fillColor) {
    if (cells.length != 2) throw(`White dot must be two cells: ${cells}`)

    // Find the midpoint between the squares.
    let [x0, y0] = ConstraintDisplay.cellIdCenter(cells[0]);
    let [x1, y1] = ConstraintDisplay.cellIdCenter(cells[1]);
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
    const [x, y] = ConstraintDisplay.cellIdCenter(cell);
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

    const points = cells.map(ConstraintDisplay.cellIdCenter);
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

    const line = this._makePath(cells.map(ConstraintDisplay.cellIdCenter));
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

    const points = cells.map(ConstraintDisplay.cellIdCenter);
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
    const path = this._makePath(cells.map(ConstraintDisplay.cellIdCenter));
    path.setAttribute('stroke-width', 15);
    path.setAttribute('stroke-linecap', 'round');
    thermo.appendChild(path);

    this._constraintGroup.append(thermo);

    return thermo;
  }

  drawDiagonal(direction) {
    const size = ConstraintDisplay.CELL_SIZE*GRID_SIZE;
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

  _makeGrid() {
    const grid = createSvgElement('g');
    this._applyGridOffset(grid);
    const cellSize = ConstraintDisplay.CELL_SIZE;
    const gridSize = cellSize*GRID_SIZE;

    grid.setAttribute('stroke-width', 1);
    grid.setAttribute('stroke', 'rgb(150, 150, 150)');

    for (let i = 1; i < GRID_SIZE; i++) {
      grid.append(this._makePath([
        [0, i*cellSize],
        [gridSize, i*cellSize],
      ]));
      grid.append(this._makePath([
        [i*cellSize, 0],
        [i*cellSize, gridSize],
      ]));
    }

    return grid;
  }

  makeBorders(fill) {
    const cellSize = ConstraintDisplay.CELL_SIZE;
    const gridSize = cellSize*GRID_SIZE;

    const g = createSvgElement('g');
    this._applyGridOffset(g);
    g.setAttribute('stroke-width', 2);
    g.setAttribute('stroke', 'rgb(0, 0, 0)');
    const path = this._makePath([
      [0, 0],
      [0, gridSize],
      [gridSize, gridSize],
      [gridSize, 0],
      [0, 0],
    ]);
    if (fill) path.setAttribute('fill', fill);
    g.append(path);

    return g;
  }

  _makeDefaultRegions() {
    const grid = createSvgElement('g');
    this._applyGridOffset(grid);
    const cellSize = ConstraintDisplay.CELL_SIZE;
    const gridSize = cellSize*GRID_SIZE;

    grid.setAttribute('stroke-width', 2);
    grid.setAttribute('stroke', 'rgb(0, 0, 0)');
    grid.setAttribute('stroke-linecap', 'round');

    for (let i = BOX_SIZE; i < GRID_SIZE; i+=BOX_SIZE) {
      grid.appendChild(this._makePath([
        [0, i*cellSize],
        [gridSize, i*cellSize],
      ]));
      grid.appendChild(this._makePath([
        [i*cellSize, 0],
        [i*cellSize, gridSize],
      ]));
    }

    return grid;
  }

  useDefaultRegions(enable) {
    this._defaultRegions.setAttribute('display', enable ? null : 'none');
  }

  enableWindokuRegion(enable) {
    this._windokuRegion.setAttribute('display', enable ? null : 'none');
  }

  _makeCellSquare(cell) {
    const cellWidth = ConstraintDisplay.CELL_SIZE;

    const [x, y] = ConstraintDisplay.cellCenter(cell);
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
    for (let i = 0; i < NUM_CELLS; i++) missingCells.add(i);
    this._regionElems.forEach(
      cs => cs.forEach(c => missingCells.delete(parseCellId(c).cell)));

    // Shade in the missing cells.
    for (const cell of missingCells) {
      svg.appendChild(this._makeCellSquare(cell));
    }
  }

  drawRegion(region) {
    const cellSet = new Set(region.map(c => parseCellId(c).cell));

    const g = createSvgElement('g');
    g.setAttribute('stroke-width', 2);
    g.setAttribute('stroke', 'rgb(100, 100, 100)');
    g.setAttribute('stroke-linecap', 'round');

    const cellSize = ConstraintDisplay.CELL_SIZE;
    const gridSize = cellSize*GRID_SIZE;

    for (const cell of cellSet) {
      const [row, col] = toRowCol(cell);

      const cellUp    = toCellIndex(row-1, col);
      const cellDown  = toCellIndex(row+1, col);
      const cellLeft  = toCellIndex(row, col-1);
      const cellRight = toCellIndex(row, col+1);

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

  _applyGridOffset(elem) {
    const padding = this.constructor.SVG_PADDING;
    elem.setAttribute('transform', `translate(${padding},${padding})`);
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
}
