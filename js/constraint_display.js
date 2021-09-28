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

    let constraintGroup = createSvgElement('g');
    constraintGroup.setAttribute('transform', `translate(${padding},${padding})`);
    svg.append(constraintGroup);

    svg.append(this._makeArrowhead());
    svg.append(this._makeLittleKillers(gridSelection));

    container.prepend(svg);

    this._svg = constraintGroup;
    this._gridSelection = gridSelection;
    this.clear();  // clear() to initialize.
  }

  _makeLittleKillers(gridSelection) {
    let g = createSvgElement('g');
    let padding = ConstraintDisplay.SVG_PADDING;
    g.setAttribute('transform', `translate(${padding},${padding})`);

    const makeArrow = (row, col, dr, dc) => {
      const [x, y] = ConstraintDisplay.cellCenter(toCellId(row, col));
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

  static cellCenter(cellId) {
    let {row, col} = parseCellId(cellId);
    let cellSize = ConstraintDisplay.CELL_SIZE;
    return [col*cellSize + cellSize/2, row*cellSize + cellSize/2];
  }

  clear() {
    let svg = this._svg;
    while (svg.lastChild) {
      svg.removeChild(svg.lastChild);
    }
    this.killerCellColors = new Map();
    this.killerCages = new Map();
    this._diagonals = [null, null];
  }

  removeItem(item) {
    this._svg.removeChild(item);
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
    const cellWidth = ConstraintDisplay.CELL_SIZE-1;
    let x,y;

    let cage = createSvgElement('svg');
    let color = this._chooseKillerCageColor(cells);

    for (const cell of cells) {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      let path = createSvgElement('path');
      let directions = [
        'M', x-cellWidth/2+1, y-cellWidth/2+1,
        'l', 0, cellWidth,
        'l', cellWidth, 0,
        'l', 0, -cellWidth,
        'l', -cellWidth, 0,
      ];
      path.setAttribute('d', directions.join(' '));
      path.setAttribute('fill', color);
      path.setAttribute('opacity', '0.1');
      cage.appendChild(path);
    }
    this.killerCages.set(cage, [...cells]);
    cells.forEach(cell => this.killerCellColors.set(cell, color));

    // Draw the sum in the top-left most cell. Luckly, this is the sort order.
    cells.sort();
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);

    let text = createSvgElement('text');
    text.appendChild(document.createTextNode(sum));
    text.setAttribute('x', x - cellWidth/2 + 1);
    text.setAttribute('y', y - cellWidth/2 + 2);
    text.setAttribute('dominant-baseline', 'hanging');
    text.setAttribute('style',
      'font-size: 10; font-family: monospace; font-weight: bold;');
    cage.append(text);
    this._svg.append(cage);

    let textBackground = ConstraintDisplay._addTextBackground(text);
    textBackground.setAttribute('fill', 'rgb(200, 200, 200)');

    return cage;
  }

  drawDot(cells, fillColor) {
    if (cells.length != 2) throw(`White dot must be two cells: ${cells}`)

    // Find the midpoint between the squares.
    let [x0, y0] = ConstraintDisplay.cellCenter(cells[0]);
    let [x1, y1] = ConstraintDisplay.cellCenter(cells[1]);
    let x = (x0+x1)/2;
    let y = (y0+y1)/2;

    let dot = createSvgElement('circle');
    dot.setAttribute('fill', fillColor);
    dot.setAttribute('stroke', 'black');
    dot.setAttribute('stroke-width', 1);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 4);

    this._svg.append(dot);

    return dot;
  }

  drawArrow(cells) {
    if (cells.length < 2) throw(`Arrow too short: ${cells}`)

    let arrow = createSvgElement('svg');
    arrow.setAttribute('fill', 'transparent');
    arrow.setAttribute('stroke', 'rgb(200, 200, 200)');
    arrow.setAttribute('stroke-width', 3);
    arrow.setAttribute('stroke-linecap', 'round');

    let x, y;
    // Draw the circle.
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);
    let circle = createSvgElement('circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 15);
    arrow.appendChild(circle);

    // Draw the line.
    let directions = [];
    cells.forEach((cell) => {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      directions.push('L');
      directions.push(x);
      directions.push(y);
    });
    directions[0] = 'M';  // Replace the first direction to a move.

    let path = createSvgElement('path');
    path.setAttribute('d', directions.join(' '));
    path.setAttribute('stroke-dashoffset', -15);
    path.setAttribute('stroke-dasharray', path.getTotalLength());
    path.setAttribute('marker-end', 'url(#arrowhead)');

    arrow.appendChild(path);

    this._svg.append(arrow);

    return arrow;
  }

  _drawLine(cells, color) {
    if (cells.length < 2) throw(`Thermo too short: ${cells}`)

    let line = createSvgElement('svg');
    line.setAttribute('fill', 'transparent');
    line.setAttribute('stroke', color);

    let directions = [];
    cells.forEach((cell) => {
      const [x, y] = ConstraintDisplay.cellCenter(cell);
      directions.push('L');
      directions.push(x);
      directions.push(y);
    });
    directions[0] = 'M';  // Replace the first direction to a move.
    let path = createSvgElement('path');
    path.setAttribute('d', directions.join(' '));
    path.setAttribute('stroke-width', 5);
    path.setAttribute('stroke-linecap', 'round');

    line.appendChild(path);

    this._svg.append(line);

    return line;
  }

  drawWhisper(cells) {
    return this._drawLine(cells, 'rgb(255, 200, 255)');
  }

  drawPalindrome(cells) {
    return this._drawLine(cells, 'rgb(200, 200, 255)');
  }

  drawThermometer(cells) {
    if (cells.length < 2) throw(`Thermo too short: ${cells}`)

    let thermo = createSvgElement('svg');
    thermo.setAttribute('fill', 'rgb(200, 200, 200)');
    thermo.setAttribute('stroke', 'rgb(200, 200, 200)');

    let x, y;
    // Draw the circle.
    [x, y] = ConstraintDisplay.cellCenter(cells[0]);
    let circle = createSvgElement('circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 15);
    thermo.appendChild(circle);

    // Draw the line.
    let directions = [];
    cells.forEach((cell) => {
      [x, y] = ConstraintDisplay.cellCenter(cell);
      directions.push('L');
      directions.push(x);
      directions.push(y);
    });
    directions[0] = 'M';  // Replace the first direction to a move.
    let path = createSvgElement('path');
    path.setAttribute('d', directions.join(' '));
    path.setAttribute('stroke-width', 15);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'transparent');
    thermo.appendChild(path);

    this._svg.append(thermo);

    return thermo;
  }

  drawDiagonal(direction) {
    let size = ConstraintDisplay.CELL_SIZE*GRID_SIZE;
    let line = createSvgElement('path');
    let directions = [
      'M', 0, direction > 0 ? size : 0,
      'L', size, direction > 0 ? 0 : size,
    ];
    line.setAttribute('d', directions.join(' '));
    line.setAttribute('stroke-width', 1);
    line.setAttribute('fill', 'transparent');
    line.setAttribute('stroke', 'rgb(255, 0, 0)');

    this._svg.appendChild(line);
    this._diagonals[direction > 0] = line;

    return line;
  }

  removeDiagonal(direction) {
    let item = this._diagonals[direction > 0];
    if (item) this.removeItem(item);
  }
}
