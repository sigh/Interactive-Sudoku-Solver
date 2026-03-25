export class GridShape {
  static MIN_SIZE = 1;
  static MAX_SIZE = 16;
  static _VALUE_BASE = 17;  // for parsing

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

    this.numCells = numRows * numCols;
    this.numPencilmarks = this.numCells * this.numValues;

    this.name = this.constructor.makeName(
      numRows, numCols, this.numValues, valueOffset);
    this.gridDimsStr = `${numRows}x${numCols}`;

    this._stateCellRegistry = new StateCellRegistry(this.numCells);
  }

  totalCells() {
    return this.numCells + this._stateCellRegistry.numStateCells();
  }

  stateCellGroups() {
    return this._stateCellRegistry.getGroups();
  }

  stateCellsForGroup(prefix) {
    return this._stateCellRegistry.getCellsForGroup(prefix);
  }

  clearStateCells() {
    this._stateCellRegistry.clear();
  }

  onStateCellsChanged(fn) {
    this._stateCellRegistry.addChangeListener(fn);
  }

  _allStateCellSpecsForConstraints(constraints) {
    const allSpecs = [];
    for (const c of constraints) {
      allSpecs.push(...(c.constructor.getStateCellGroups?.(this) ?? []));
    }
    return allSpecs;
  }

  removeStateCellsForConstraints(constraints) {
    this._stateCellRegistry.removeGroups(
      this._allStateCellSpecsForConstraints(constraints));
  }

  addStateCellsForConstraints(constraints) {
    this._stateCellRegistry.addGroups(
      this._allStateCellSpecsForConstraints(constraints));
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
    const base = this.constructor._VALUE_BASE;
    return `R${(row + 1).toString(base)}C${(col + 1).toString(base)}`;
  }

  makeCellIdFromIndex = (i) => {
    const namedId = this._stateCellRegistry.getCellId(i);
    if (namedId) return namedId;
    if (i >= this.numCells) return `$${i - this.numCells}`;
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
    // Check registry first — named IDs like 'DGR3' would be mangled by R#C#.
    const registryCell = this._stateCellRegistry.getCellIndex(cellId);
    if (registryCell !== null) return { cell: registryCell };
    if (cellId[0] === '$') {
      return { cell: this.numCells + parseInt(cellId.substring(1)) };
    }
    const base = this.constructor._VALUE_BASE;
    let row = parseInt(cellId[1], base) - 1;
    let col = parseInt(cellId[3], base) - 1;
    return {
      cell: this.cellIndex(row, col),
      row: row,
      col: col,
    };
  }

  static defaultNumValues(numRows, numCols) {
    return Math.max(numRows, numCols);
  }

  isDefaultNumValues() {
    return this.numValues === this.constructor.defaultNumValues(this.numRows, this.numCols);
  }
}

class StateCellRegistry {
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
    const added = [];
    for (const { prefix, count, label, hidden } of specs) {
      if (this._groups.has(prefix)) {
        throw Error(`State cell group prefix '${prefix}' already exists`);
      }
      this._groups.set(prefix, { prefix, count, label, hidden: hidden || false });
      added.push(prefix);
    }
    if (added.length === 0) return;
    this._rebuild();
    this._notify({ added, removed: [] });
  }

  removeGroups(specs) {
    const removed = [];
    for (const { prefix } of specs) {
      if (!this._groups.has(prefix)) continue;
      this._groups.delete(prefix);
      removed.push(prefix);
    }
    if (removed.length === 0) return;
    this._rebuild();
    this._notify({ added: [], removed });
  }

  clear() {
    if (this._groups.size === 0) return;
    const removed = [...this._groups.keys()];
    this._groups.clear();
    this._rebuild();
    this._notify({ added: [], removed });
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
        const id = group.cells.length === 1 ? group.prefix : `${group.prefix}${i}`;
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

  numStateCells() {
    return this._totalCells;
  }

  getCellId(cellIndex) {
    return this._cellToId.get(cellIndex) ?? null;
  }

  getCellIndex(cellId) {
    return this._idToCell.get(cellId) ?? null;
  }
}


export const SHAPE_MAX = GridShape.fromGridSize(GridShape.MAX_SIZE);
export const SHAPE_9x9 = GridShape.fromGridSize(9);