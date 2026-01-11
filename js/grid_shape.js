const { memoize } = await import('./util.js' + self.VERSION_PARAM);

export class GridShape {
  static MIN_SIZE = 1;
  static MAX_SIZE = 16;

  static _isValidDimension(dim) {
    return Number.isInteger(dim) && dim >= this.MIN_SIZE && dim <= this.MAX_SIZE;
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
    const parts = gridSpec.split('x');
    if (parts.length !== 2) {
      throw ('Invalid grid spec format: ' + gridSpec);
    }

    const numRows = parseInt(parts[0]);
    const numCols = parseInt(parts[1]);

    if (numRows.toString() !== parts[0] || numCols.toString() !== parts[1]) {
      throw ('Invalid grid spec format: ' + gridSpec);
    }

    const shape = this.fromGridSize(numRows, numCols);
    if (!shape) {
      throw ('Invalid grid dimensions: ' + gridSpec);
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

  static makeName(numRows, numCols = numRows) {
    return `${numRows}x${numCols}`;
  }

  static baseCharCode(shape) {
    return shape.numValues < 10 ? '1'.charCodeAt(0) : 'A'.charCodeAt(0);
  }

  constructor(do_not_call, numRows, numCols) {
    if (do_not_call !== undefined) {
      throw Error('Use GridShape.fromGridSize() instead.');
    }

    // Core dimensions
    this.numRows = numRows;
    this.numCols = numCols;

    // Derived properties
    this.numValues = Math.max(numRows, numCols);
    this.numCells = numRows * numCols;
    this.numPencilmarks = this.numCells * this.numValues;

    // Box dimensions
    [this.boxHeight, this.boxWidth] = this.constructor._boxDims(numRows, numCols);
    this.noDefaultBoxes = this.boxHeight === 1 || this.boxWidth === 1;

    this.name = this.constructor.makeName(numRows, numCols);

    this._valueBase = this.numValues + 1;

    this.allCells = [];
    for (let i = 0; i < this.numCells; i++) this.allCells.push(i);

    this.maxSum = this.numValues * (this.numValues + 1) / 2;

    Object.freeze(this);
  }

  static _boxDims(numRows, numCols) {
    // Find (boxH, boxW) where boxH * boxW = numValues that tiles the grid.
    // Prefer squarer boxes by starting from sqrt and working down.
    const numValues = Math.max(numRows, numCols);

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

    // Unreachable: small=1 always works since numValues = max(numRows, numCols)
    return [1, numValues];
  }

  makeValueId = (cellIndex, n) => {
    const cellId = this.makeCellIdFromIndex(cellIndex);
    return `${cellId}_${n}`;
  }

  makeCellId = (row, col) => {
    return `R${(row + 1).toString(this._valueBase)}C${(col + 1).toString(this._valueBase)}`;
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
    let row = parseInt(cellId[1], this._valueBase) - 1;
    let col = parseInt(cellId[3], this._valueBase) - 1;
    return {
      cell: this.cellIndex(row, col),
      row: row,
      col: col,
    };
  }
}

export const SHAPE_MAX = GridShape.fromGridSize(GridShape.MAX_SIZE);
export const SHAPE_9x9 = GridShape.fromGridSize(9);