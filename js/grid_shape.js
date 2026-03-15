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
    if (shape.numValues >= 10) return 'A'.charCodeAt(0);
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

    Object.freeze(this);
  }

  minValue() {
    return 1 + this.valueOffset;
  }

  maxValue() {
    return this.numValues + this.valueOffset;
  }

  allValues() {
    const min = this.minValue();
    return Array.from({length: this.numValues}, (_, i) => min + i);
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
      ...this.parseCellId(cellId),
    };
  }

  parseCellId = (cellId) => {
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

export const SHAPE_MAX = GridShape.fromGridSize(GridShape.MAX_SIZE);
export const SHAPE_9x9 = GridShape.fromGridSize(9);