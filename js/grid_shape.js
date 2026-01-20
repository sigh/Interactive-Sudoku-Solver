const { memoize } = await import('./util.js' + self.VERSION_PARAM);

export class GridShape {
  static MIN_SIZE = 1;
  static MAX_SIZE = 16;
  static _VALUE_BASE = 17;  // for parsing

  static _isValidDimension(dim) {
    return Number.isInteger(dim) && dim >= this.MIN_SIZE && dim <= this.MAX_SIZE;
  }

  _assertValidNumValues(numValues) {
    const defaultNumValues = this.constructor.defaultNumValues(this.numRows, this.numCols);
    if (!Number.isInteger(numValues) || numValues < defaultNumValues || numValues > this.constructor.MAX_SIZE) {
      throw Error('Invalid numValues: ' + numValues);
    }
  }

  // Internal memoized factory - always takes two arguments
  static _fromResolvedGridSize = memoize((numRows, numCols) => {
    if (!this._isValidDimension(numRows) || !this._isValidDimension(numCols)) {
      return null;
    }
    return new GridShape(undefined, numRows, numCols);
  });

  // Public factory for square grids (one arg) or rectangular grids (two args)
  static fromGridSize(numRows, numCols = numRows) {
    return this._fromResolvedGridSize(numRows, numCols);
  }

  static fromGridSpec(gridSpec) {
    const parts = gridSpec.split('~');
    if (parts.length > 2) {
      throw new Error('Invalid grid spec format: ' + gridSpec);
    }

    const gridDims = parts[0];
    const numValuesPart = parts[1];

    const dims = gridDims.split('x');
    if (dims.length !== 2) {
      throw new Error('Invalid grid spec format: ' + gridSpec);
    }

    const numRows = parseInt(dims[0]);
    const numCols = parseInt(dims[1]);

    if (numRows.toString() !== dims[0] || numCols.toString() !== dims[1]) {
      throw new Error('Invalid grid spec format: ' + gridSpec);
    }

    const shape = this.fromGridSize(numRows, numCols);
    if (!shape) {
      throw new Error('Invalid grid dimensions: ' + gridSpec);
    }

    if (numValuesPart === undefined) {
      return shape;
    }

    const numValues = parseInt(numValuesPart);
    if (numValues.toString() !== numValuesPart) {
      throw new Error('Invalid grid spec format: ' + gridSpec);
    }

    return shape.withNumValues(numValues);
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

  static makeName(numRows, numCols = numRows, numValues = null) {
    let name = `${numRows}x${numCols}`;
    if (numValues !== this.defaultNumValues(numRows, numCols)) {
      name += `~${numValues}`;
    }
    return name;
  }

  static baseCharCode(shape) {
    return shape.numValues < 10 ? '1'.charCodeAt(0) : 'A'.charCodeAt(0);
  }

  constructor(do_not_call, numRows, numCols, numValues) {
    if (do_not_call !== undefined) {
      throw Error('Use GridShape.fromGridSize() instead.');
    }

    // Core dimensions
    this.numRows = numRows;
    this.numCols = numCols;

    // Derived properties
    const defaultNumValues = this.constructor.defaultNumValues(numRows, numCols);
    this.numValues = numValues || defaultNumValues;
    this._assertValidNumValues(this.numValues);

    this.numCells = numRows * numCols;
    this.numPencilmarks = this.numCells * this.numValues;

    // Box dimensions
    [this.boxHeight, this.boxWidth] = this.constructor._boxDims(numRows, numCols, this.numValues);
    this.noDefaultBoxes = (
      this.boxHeight === null || this.boxWidth === null ||
      this.boxHeight === 1 || this.boxWidth === 1);

    this.name = this.constructor.makeName(numRows, numCols, this.numValues);
    this.fullGridSpec = `${this.numRows}x${this.numCols}~${this.numValues}`;

    this.allCells = [];
    for (let i = 0; i < this.numCells; i++) this.allCells.push(i);

    this.maxSum = this.numValues * (this.numValues + 1) / 2;

    Object.freeze(this);
  }

  isSquare() {
    return this.numRows === this.numCols;
  }

  static _boxDims(numRows, numCols, numValues) {
    if (numValues !== this.defaultNumValues(numRows, numCols)) {
      // Non-default numValues => no default boxes
      return [null, null];
    }

    for (let small = Math.floor(Math.sqrt(numValues)); small >= 1; small--) {
      if (numValues % small !== 0) continue;
      const large = numValues / small;

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

  withNumValues(numValues = null) {
    if (numValues === null || numValues === this.numValues) {
      return this;
    }

    this._assertValidNumValues(numValues);

    return new GridShape(undefined, this.numRows, this.numCols, numValues);
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