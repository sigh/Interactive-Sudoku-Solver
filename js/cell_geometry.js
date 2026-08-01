const { memoize, setPeek } = await import('./util.js' + self.VERSION_PARAM);

const VALUE_BASE = 17;  // for parsing cell IDs

// Upper bound on grid + var cells. A cell index is stored in 16 bits throughout
// the solver, so this must stay below 2^16.
export const MAX_SEARCH_CELLS = 1000;

export class CellGeometry {
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
    return new CellGeometry(numRows, numCols, numValues, valueOffset);
  }

  // The dimensions are given literally ("9x9"), or taken from a cell group
  // ("VA" — the group's own constraint declares them, and the main grid does
  // not exist).
  static fromShapeSpec(shapeSpec) {
    const match = shapeSpec.match(
      /^(?:(\d+)x(\d+)|([A-Z]+))(?:~(\d+)(?:-(\d+))?)?$/);
    if (!match) {
      throw new Error('Invalid shape spec format: ' + shapeSpec);
    }

    const mainCellGroup = match[3];
    const numRows = parseInt(match[1]);
    const numCols = parseInt(match[2]);

    let numValues = null;
    let valueOffset = 0;
    if (match[5] !== undefined) {
      // Range: "9x9~0-8"
      const rangeStart = parseInt(match[4]);
      numValues = parseInt(match[5]) - rangeStart + 1;
      valueOffset = rangeStart - 1;
    } else if (match[4] !== undefined) {
      // Bare number: "9x9~10"
      numValues = parseInt(match[4]);
    }

    if (!mainCellGroup) {
      const geometry = this.fromGridSize(numRows, numCols, numValues, valueOffset);
      if (!geometry) {
        throw new Error('Invalid shape dimensions: ' + shapeSpec);
      }
      return geometry;
    }

    if (numValues === null) {
      throw new Error('A value range is required for a cell group shape: ' + shapeSpec);
    }
    return new CellGeometry(0, 0, numValues, valueOffset, mainCellGroup);
  }

  // The default grid geometry (9x9), as a fresh instance that is safe to add
  // var cells to — unlike the shared GEOMETRY_* singletons.
  static newDefault() {
    return this.fromGridSize(GEOMETRY_9x9.numRows, GEOMETRY_9x9.numCols);
  }

  static makeName(numRows, numCols, numValues, valueOffset, mainCellGroup = null) {
    const dims = `${numRows}x${numCols}`;
    const range = valueOffset !== 0
      ? `${1 + valueOffset}-${numValues + valueOffset}` : `${numValues}`;
    if (mainCellGroup) {
      return `${mainCellGroup}~${range}`;
    }
    if (valueOffset !== 0 || numValues !== this.defaultNumValues(numRows, numCols)) {
      return `${dims}~${range}`;
    }
    return dims;
  }

  constructor(numRows, numCols, numValues = null, valueOffset = 0, mainCellGroup = null) {
    if (valueOffset !== 0 && valueOffset !== -1) {
      throw Error('Invalid valueOffset: ' + valueOffset);
    }

    this.numRows = numRows;
    this.numCols = numCols;
    this.valueOffset = valueOffset;

    // Derived properties
    const defaultNumValues = this.constructor.defaultNumValues(numRows, numCols);
    this.numValues = numValues ?? defaultNumValues;

    // At least one value; the main grid's dimensions floor numValues
    // when they exist.
    const minNumValues = Math.max(1, defaultNumValues);
    if (!Number.isInteger(this.numValues) || this.numValues < minNumValues || this.numValues > this.constructor.MAX_SIZE) {
      throw Error('Invalid numValues: ' + this.numValues);
    }

    // The cell group solved in the main grid's place, or null.
    this.mainCellGroup = mainCellGroup;
    this.numGridCells = numRows * numCols;

    this.name = this.constructor.makeName(
      numRows, numCols, this.numValues, valueOffset, mainCellGroup);
    this.gridDimsStr = `${numRows}x${numCols}`;
    this.dimsSpec = mainCellGroup ?? this.gridDimsStr;

    this._varCellRegistry = new VarCellRegistry(
      this.numGridCells, numCols, mainCellGroup);
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

  // The primary's dimensions as [rows, columns]: the grid's, or the primary
  // group's when it stands in for the grid (null while that group is
  // missing).
  primaryDims() {
    if (!this.mainCellGroup) return [this.numRows, this.numCols];
    const primary = this.varCellGroups().find(
      g => g.prefix === this.mainCellGroup);
    return primary ? [primary.count / primary.columns, primary.columns] : null;
  }

  primaryDimsStr() {
    const dims = this.primaryDims();
    return dims ? `${dims[0]}x${dims[1]}` : '';
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
    const specs = this._allVarCellSpecsForConstraints(constraints);

    // Reject too many cells before mutating the registry, so the geometry is
    // never left in an inconsistent state (and we never attempt a huge allocation).
    const newVarCells = specs.reduce((sum, g) => sum + g.count, 0);
    const total = this.totalCells() + newVarCells;
    if (total > MAX_SEARCH_CELLS) {
      const added = specs.map(g => `${g.label || g.prefix}`).join(', ');
      throw new Error(
        `Adding ${added} cells would exceed the ${MAX_SEARCH_CELLS}-cell limit ` +
        `(${this.totalCells()} cells already in use).`);
    }

    // The primary group takes the grid's place (other groups default their
    // columns to it), so it must declare dimensions.
    const primary = specs.find(
      g => g.prefix === this.mainCellGroup && !g.columns);
    if (primary) {
      throw new Error(
        `Cell group '${primary.prefix}' needs explicit dimensions ` +
        'to be the primary.');
    }

    this._varCellRegistry.addGroups(specs);
  }

  // The same shape with a different value range.
  withValueRange(min, max) {
    return new CellGeometry(
      this.numRows, this.numCols, max - min + 1, min - 1, this.mainCellGroup);
  }

  // The same value range with a cell group in the main grid's place.
  withMainCellGroup(prefix) {
    return new CellGeometry(0, 0, this.numValues, this.valueOffset, prefix);
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
    return this.numGridCells > 0 && this.numRows === this.numCols;
  }

  static displayCellId(cellId) {
    if (cellId[0] === 'V') return '$' + cellId.substring(1);
    return cellId;
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

  makeValueId(cellIndex, n) {
    const cellId = this.makeCellIdFromIndex(cellIndex);
    return `${cellId}_${n}`;
  }

  makeCellId(row, col) {
    const base = VALUE_BASE;
    return `R${(row + 1).toString(base)}C${(col + 1).toString(base)}`;
  }

  makeCellIdFromIndex(cellIndex) {
    const namedId = this._varCellRegistry.getCellId(cellIndex);
    if (namedId) return namedId;
    return this.makeCellId(...this.splitCellIndex(cellIndex));
  }

  cellIndex(row, col) {
    return row * this.numCols + col;
  }

  splitCellIndex(cellIndex) {
    return [cellIndex / this.numCols | 0, cellIndex % this.numCols | 0];
  }

  parseValueId(valueId) {
    let [cellId, ...valueStrs] = valueId.split('_');
    const minValue = this.minValue();
    const maxValue = this.maxValue();
    const values = valueStrs.map(v => {
      const n = parseInt(v, 10);
      // Reject NaN, out-of-range values, and trailing garbage (e.g. '2x').
      if (!(n >= minValue && n <= maxValue) || `${n}` !== v) {
        throw new Error('Invalid value ID: ' + valueId);
      }
      return n;
    });
    return { values, cellId };
  }

  parseCellId(cellId) {
    if (cellId.length === 4 &&
      (cellId[0] === 'R' || cellId[0] === 'r') &&
      (cellId[2] === 'C' || cellId[2] === 'c')) {
      const row = CELL_ID_CHAR[cellId.charCodeAt(1)];
      const col = CELL_ID_CHAR[cellId.charCodeAt(3)];
      if (row < this.numRows && col < this.numCols) {
        return { cellIndex: this.cellIndex(row, col), row, col };
      }
      throw new Error('Invalid cell ID: ' + cellId);
    }
    const registryCell = this._varCellRegistry.getCellIndex(cellId);
    if (registryCell !== null) return { cellIndex: registryCell };
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
  constructor(cellIndexOffset = 0, gridColumns = 0, mainCellGroup = null) {
    this._cellIndexOffset = cellIndexOffset;
    this._gridColumns = gridColumns;
    this._mainCellGroup = mainCellGroup;
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
        throw Error(`Cell group prefix '${prefix}' already exists`);
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

    // Count-only groups take their columns from the grid, or the primary
    // group when it stands in for the grid. The stored specs keep the
    // declared columns.
    const defaultColumns = this._gridColumns ||
      this._groups.get(this._mainCellGroup)?.columns || 0;

    let next = this._cellIndexOffset;
    const resolved = [];
    for (const group of sorted) {
      group.cells = Array.from({ length: group.count }, (_, i) => next + i);
      next += group.count;

      for (let i = 0; i < group.cells.length; i++) {
        const id = group.cells.length === 1 ? group.prefix : `${group.prefix}${i + 1}`;
        this._cellToId.set(group.cells[i], id);
        this._idToCell.set(id, group.cells[i]);
      }

      resolved.push(
        group.columns ? group : { ...group, columns: defaultColumns });
    }

    this._sortedGroups = resolved;
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
  static _OPPOSITE = [this.RIGHT, this.LEFT, this.DOWN, this.UP];

  static _gridGraph = memoize(
    (geometry) => {
      const graph = [];
      const cells = Array.from({ length: geometry.numGridCells }, (_, i) => i);
      CellGraph._addEdges(graph, cells, geometry.numCols);
      return new CellGraph(graph);
    },
    (geometry) => geometry.gridDimsStr);

  static get(geometry) {
    const base = this._gridGraph(geometry);
    const groups = geometry.varCellGroups();
    if (!groups.length) return base;

    const graph = base._graph.slice();
    for (const group of groups) {
      const cells = group.cells;
      if (!cells.length || !group.columns) continue;
      this._addEdges(graph, cells, group.columns);
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
    this._positionCache = [];
  }

  cellEdges(cell) {
    return this._graph[cell];
  }

  adjacent(cell, dir) {
    return this._graph[cell][dir];
  }

  // Step |dRow| rows then |dCol| cols from cell (sign gives direction).
  // Returns null on stepping past a boundary.
  traverse(cell, dRow, dCol) {
    return this._traverse(cell, dRow, dCol, false);
  }

  // Like traverse, but stepping past a boundary wraps to the opposite edge of
  // the row/column within the same subgraph rather than returning null.
  wrappingTraverse(cell, dRow, dCol) {
    return this._traverse(cell, dRow, dCol, true);
  }

  _traverse(cell, dRow, dCol, wrap) {
    cell = this._traverseAxis(
      cell, dRow > 0 ? CellGraph.DOWN : CellGraph.UP, Math.abs(dRow), wrap);
    if (cell === null) return null;
    return this._traverseAxis(
      cell, dCol > 0 ? CellGraph.RIGHT : CellGraph.LEFT, Math.abs(dCol), wrap);
  }

  // Step `count` times along dir. At a boundary: return null, or if wrap, keep
  // going from the far cell on the opposite edge of this line.
  _traverseAxis(cell, dir, count, wrap) {
    for (; count > 0; count--) {
      const next = this._graph[cell][dir];
      if (next !== null) {
        cell = next;
      } else if (wrap) {
        const back = CellGraph._OPPOSITE[dir];
        for (let n = this._graph[cell][back]; n !== null; n = this._graph[cell][back]) {
          cell = n;
        }
      } else {
        return null;
      }
    }
    return cell;
  }

  // Returns [row, col, origin] where origin is the top-left cell of the
  // subgraph. Two cells share a subgraph iff their origins match.
  cellPosition(cell) {
    if (!this._graph[cell]) return null;
    const cached = this._positionCache[cell];
    if (cached) return cached;

    let current = cell;
    let dRow = 0;
    let dCol = 0;
    while (true) {
      const currentCached = this._positionCache[current];
      if (currentCached) {
        return this._positionCache[cell] = [
          currentCached[0] + dRow,
          currentCached[1] + dCol,
          currentCached[2],
        ];
      }

      const edges = this._graph[current];
      const left = edges[CellGraph.LEFT];
      if (left !== null) {
        dCol++;
        current = left;
        continue;
      }

      const up = edges[CellGraph.UP];
      if (up !== null) {
        dRow++;
        current = up;
        continue;
      }

      return this._positionCache[cell] = [dRow, dCol, current];
    }
  }

  diagonal(cell, dir0, dir1) {
    const cell1 = this._graph[cell][dir0];
    return cell1 === null ? null : this._graph[cell1][dir1];
  }

  // Returns the boundary cells of the region containing `cell`, in clockwise
  // cyclic order starting from its top-left.
  perimeter(cell) {
    const CW = [CellGraph.RIGHT, CellGraph.DOWN, CellGraph.LEFT, CellGraph.UP];
    // Hug the wall: turn left if possible, else straight, right, or back.
    const TURNS = [3, 0, 1, 2];
    const start = this.cellPosition(cell)[2];  // top-left of the region
    const boundary = [];
    let current = start;
    let facing = 0;  // index into CW; start heading right along the top edge
    do {
      boundary.push(current);
      for (const turn of TURNS) {
        const f = (facing + turn) % 4;
        const next = this._graph[current][CW[f]];
        if (next !== null) { current = next; facing = f; break; }
      }
    } while (current !== start);
    return boundary;
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
for (let i = 1; i <= CellGeometry.MAX_SIZE; i++) {
  const c = i.toString(VALUE_BASE);
  CELL_ID_CHAR[c.charCodeAt(0)] = i - 1;
  CELL_ID_CHAR[c.toUpperCase().charCodeAt(0)] = i - 1;
}

export const GEOMETRY_MAX = CellGeometry.fromGridSize(CellGeometry.MAX_SIZE);
export const GEOMETRY_9x9 = CellGeometry.fromGridSize(9);