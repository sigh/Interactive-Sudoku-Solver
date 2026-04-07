const { memoize, setPeek } = await import('./util.js' + self.VERSION_PARAM);

const VALUE_BASE = 17;  // for parsing cell IDs

export class GridShape {
  static MIN_SIZE = 1;
  static MAX_SIZE = 16;

  static _isValidDimension(dim) {
    return Number.isInteger(dim) && dim >= this.MIN_SIZE && dim <= this.MAX_SIZE;
  }

  // Public factory for square grids (one arg) or rectangular grids (two args).
  // Optionally accepts a numValues override as the third argument.
  static fromGridSize(numRows, numCols = numRows, numValues = null, valueOffset = 0) {
    if (!this._isValidDimension(numRows) || !this._isValidDimension(numCols)) {
      return null;
    }
    return new GridShape(numRows, numCols, numValues, valueOffset);
  }

  static fromGridSpec(gridSpec) {
    const match = gridSpec.match(/^(\d+)x(\d+)(?:~(\d+)(?:-(\d+))?)?$/);
    if (!match) {
      throw new Error('Invalid grid spec format: ' + gridSpec);
    }

    const numRows = parseInt(match[1]);
    const numCols = parseInt(match[2]);

    let numValues = null;
    let valueOffset = 0;
    if (match[4] !== undefined) {
      // Range: "9x9~0-8"
      const rangeStart = parseInt(match[3]);
      numValues = parseInt(match[4]) - rangeStart + 1;
      valueOffset = rangeStart - 1;
    } else if (match[3] !== undefined) {
      // Bare number: "9x9~10"
      numValues = parseInt(match[3]);
    }

    const shape = this.fromGridSize(numRows, numCols, numValues, valueOffset);
    if (!shape) {
      throw new Error('Invalid grid spec: ' + gridSpec);
    }
    return shape;
  };

  static fromNumCells(numCells) {
    // Only works for square grids
    const gridSize = Math.sqrt(numCells);
    return this.fromGridSize(gridSize);
  }

  static fromNumPencilmarks(numPencilmarks) {
    // Only works for square grids
    const gridSize = Math.cbrt(numPencilmarks);
    return this.fromGridSize(gridSize);
  }

  static makeName(numRows, numCols, numValues, valueOffset) {
    const name = `${numRows}x${numCols}`;
    if (valueOffset !== 0) {
      return `${name}~${1 + valueOffset}-${numValues + valueOffset}`;
    }
    if (numValues !== this.defaultNumValues(numRows, numCols)) {
      return `${name}~${numValues}`;
    }
    return name;
  }

  static baseCharCode(shape) {
    if (shape.numValues + shape.valueOffset > 9) return 'A'.charCodeAt(0);
    return '1'.charCodeAt(0) + shape.valueOffset;
  }

  constructor(numRows, numCols, numValues = null, valueOffset = 0) {
    if (valueOffset !== 0 && valueOffset !== -1) {
      throw Error('Invalid valueOffset: ' + valueOffset);
    }

    this.numRows = numRows;
    this.numCols = numCols;
    this.valueOffset = valueOffset;

    // Derived properties
    const defaultNumValues = this.constructor.defaultNumValues(numRows, numCols);
    this.numValues = numValues ?? defaultNumValues;

    if (!Number.isInteger(this.numValues) || this.numValues < defaultNumValues || this.numValues > this.constructor.MAX_SIZE) {
      throw Error('Invalid numValues: ' + this.numValues);
    }

    this.numGridCells = numRows * numCols;
    this.numPencilmarks = this.numGridCells * this.numValues;

    this.name = this.constructor.makeName(
      numRows, numCols, this.numValues, valueOffset);
    this.gridDimsStr = `${numRows}x${numCols}`;

    this._varCellRegistry = new VarCellRegistry(this.numGridCells);
    this._cellGraph = null;
    this._varCellRegistry.addChangeListener(() => { this._cellGraph = null; });
  }

  cellGraph() {
    return this._cellGraph ??= CellGraph.get(this);
  }

  totalCells() {
    return this.numGridCells + this._varCellRegistry.numVarCells();
  }

  varCellGroups() {
    return this._varCellRegistry.getGroups();
  }

  varCellsForGroup(prefix) {
    return this._varCellRegistry.getCellsForGroup(prefix);
  }

  clearVarCells() {
    this._varCellRegistry.clear();
  }

  onVarCellsChanged(fn) {
    this._varCellRegistry.addChangeListener(fn);
  }

  _allVarCellSpecsForConstraints(constraints) {
    const allSpecs = [];
    for (const c of constraints) {
      allSpecs.push(...c.getVarCellGroups(this));
    }
    return allSpecs;
  }

  removeVarCellsForConstraints(constraints) {
    this._varCellRegistry.removeGroups(
      this._allVarCellSpecsForConstraints(constraints));
  }

  addVarCellsForConstraints(constraints) {
    this._varCellRegistry.addGroups(
      this._allVarCellSpecsForConstraints(constraints));
  }

  minValue() {
    return 1 + this.valueOffset;
  }

  maxValue() {
    return this.numValues + this.valueOffset;
  }

  allValues() {
    const min = this.minValue();
    return Array.from({ length: this.numValues }, (_, i) => min + i);
  }

  isSquare() {
    return this.numRows === this.numCols;
  }

  // Compute box dimensions for a target region size.
  // Returns [boxHeight, boxWidth] or [null, null] if no valid box dimensions.
  static boxDimsForSize(numRows, numCols, targetSize) {
    for (let small = Math.floor(Math.sqrt(targetSize)); small >= 2; small--) {
      if (targetSize % small !== 0) continue;
      const large = targetSize / small;

      // Try both orientations
      if (numRows % small === 0 && numCols % large === 0) {
        return [small, large];
      }
      if (large !== small && numRows % large === 0 && numCols % small === 0) {
        return [large, small];
      }
    }

    // No valid box dimensions
    return [null, null];
  }

  makeValueId = (cellIndex, n) => {
    const cellId = this.makeCellIdFromIndex(cellIndex);
    return `${cellId}_${n}`;
  }

  makeCellId = (row, col) => {
    const base = VALUE_BASE;
    return `R${(row + 1).toString(base)}C${(col + 1).toString(base)}`;
  }

  makeCellIdFromIndex = (i) => {
    const namedId = this._varCellRegistry.getCellId(i);
    if (namedId) return namedId;
    if (i >= this.numGridCells) return `$${i - this.numGridCells}`;
    return this.makeCellId(...this.splitCellIndex(i));
  }

  cellIndex = (row, col) => {
    return row * this.numCols + col;
  }

  splitCellIndex = (cell) => {
    return [cell / this.numCols | 0, cell % this.numCols | 0];
  }

  parseValueId = (valueId) => {
    let [cellId, ...values] = valueId.split('_');
    return {
      values: values.map(v => parseInt(v)),
      cellId: cellId,
    };
  }

  parseCellId = (cellId) => {
    if ((cellId[0] === 'R' || cellId[0] === 'r') &&
      (cellId[2] === 'C' || cellId[2] === 'c')) {
      const row = CELL_ID_CHAR[cellId.charCodeAt(1)];
      const col = CELL_ID_CHAR[cellId.charCodeAt(3)];
      if (row < this.numRows && col < this.numCols) {
        return { cell: this.cellIndex(row, col), row, col };
      }
      throw new Error('Invalid cell ID: ' + cellId);
    }
    if (cellId[0] === '$') {
      return { cell: this.numGridCells + parseInt(cellId.substring(1)) };
    }
    const registryCell = this._varCellRegistry.getCellIndex(cellId);
    if (registryCell !== null) return { cell: registryCell };
    throw new Error('Invalid cell ID: ' + cellId);
  }

  static defaultNumValues(numRows, numCols) {
    return Math.max(numRows, numCols);
  }

  isDefaultNumValues() {
    return this.numValues === this.constructor.defaultNumValues(this.numRows, this.numCols);
  }
}

class VarCellRegistry {
  constructor(cellIndexOffset = 0) {
    this._cellIndexOffset = cellIndexOffset;
    this._groups = new Map();
    this._sortedGroups = [];
    this._totalCells = 0;
    this._cellToId = new Map();
    this._idToCell = new Map();
    this._changeListeners = [];
  }

  addGroups(specs) {
    let anyAdded = false;
    for (const { prefix, count, label, hidden, columns } of specs) {
      if (this._groups.has(prefix)) {
        throw Error(`Var cell group prefix '${prefix}' already exists`);
      }
      this._groups.set(prefix, {
        prefix, count, label,
        hidden: hidden || false,
        columns: columns || 0,
      });
      anyAdded = true;
    }
    if (!anyAdded) return;
    this._rebuild();
    this._notify({ removedCellIds: [] });
  }

  removeGroups(specs) {
    const removedCellIds = [];
    for (const { prefix } of specs) {
      const group = this._groups.get(prefix);
      if (!group) continue;
      for (const cellIndex of group.cells) {
        removedCellIds.push(this._cellToId.get(cellIndex));
      }
      this._groups.delete(prefix);
    }
    if (removedCellIds.length === 0) return;
    this._rebuild();
    this._notify({ removedCellIds });
  }

  clear() {
    if (this._groups.size === 0) return;
    const removedCellIds = [...this._cellToId.values()];
    this._groups.clear();
    this._rebuild();
    this._notify({ removedCellIds });
  }

  _rebuild() {
    this._cellToId.clear();
    this._idToCell.clear();

    const sorted = [...this._groups.values()].sort(
      (a, b) => a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0);

    let next = this._cellIndexOffset;
    for (const group of sorted) {
      group.cells = Array.from({ length: group.count }, (_, i) => next + i);
      next += group.count;

      for (let i = 0; i < group.cells.length; i++) {
        const id = group.cells.length === 1 ? group.prefix : `${group.prefix}${i + 1}`;
        this._cellToId.set(group.cells[i], id);
        this._idToCell.set(id, group.cells[i]);
      }
    }

    this._sortedGroups = sorted;
    this._totalCells = next - this._cellIndexOffset;
  }

  _notify(change) {
    for (const listener of this._changeListeners) {
      listener(change);
    }
  }

  addChangeListener(fn) { this._changeListeners.push(fn); }

  getGroups() {
    return [...this._sortedGroups];
  }

  getCellsForGroup(prefix) {
    return this._groups.get(prefix)?.cells || null;
  }

  numVarCells() {
    return this._totalCells;
  }

  getCellId(cellIndex) {
    return this._cellToId.get(cellIndex) ?? null;
  }

  getCellIndex(cellId) {
    return this._idToCell.get(cellId) ?? null;
  }
}

export class CellGraph {
  static LEFT = 0;
  static RIGHT = 1;
  static UP = 2;
  static DOWN = 3;

  static _gridGraph = memoize(
    (shape) => {
      const graph = [];
      const cells = Array.from({ length: shape.numGridCells }, (_, i) => i);
      CellGraph._addEdges(graph, cells, shape.numCols);
      return new CellGraph(graph);
    },
    (shape) => shape.gridDimsStr);

  static get(shape) {
    const base = this._gridGraph(shape);
    const groups = shape.varCellGroups();
    if (!groups.length) return base;

    const graph = base._graph.slice();
    const defaultColumns = shape.numCols;
    for (const group of groups) {
      const cells = group.cells;
      if (!cells || !cells.length) continue;
      this._addEdges(graph, cells, group.columns || defaultColumns);
    }

    return new CellGraph(graph);
  }

  static _addEdges(graph, cells, columns) {
    for (let j = 0; j < cells.length; j++) {
      const c = j % columns;
      const adj = [null, null, null, null];

      if (c > 0) adj[CellGraph.LEFT] = cells[j - 1];
      if (c < columns - 1 && j + 1 < cells.length) adj[CellGraph.RIGHT] = cells[j + 1];
      if (j - columns >= 0) adj[CellGraph.UP] = cells[j - columns];
      if (j + columns < cells.length) adj[CellGraph.DOWN] = cells[j + columns];

      graph[cells[j]] = adj;
    }
  }

  constructor(graph) {
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

  neighborCountIn(cell, cellSet) {
    let count = 0;
    for (const adj of this._graph[cell]) {
      if (adj !== null && cellSet.has(adj)) count++;
    }
    return count;
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

const CELL_ID_CHAR = new Uint8Array(128).fill(255);
for (let i = 1; i <= GridShape.MAX_SIZE; i++) {
  const c = i.toString(VALUE_BASE);
  CELL_ID_CHAR[c.charCodeAt(0)] = i - 1;
  CELL_ID_CHAR[c.toUpperCase().charCodeAt(0)] = i - 1;
}

export const SHAPE_MAX = GridShape.fromGridSize(GridShape.MAX_SIZE);
export const SHAPE_9x9 = GridShape.fromGridSize(9);