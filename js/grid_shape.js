const { memoize } = await import('./util.js' + self.VERSION_PARAM);

export class GridShape {
  static MIN_SIZE = 1;
  static MAX_SIZE = 16;
  static isValidGridSize(size) {
    return Number.isInteger(size) && size >= this.MIN_SIZE && size <= this.MAX_SIZE;
  }

  static fromGridSize = memoize((gridSize) => {
    if (!this.isValidGridSize(gridSize)) return null;
    return new GridShape(undefined, gridSize);
  });

  static fromGridSpec(gridSpec) {
    const parts = gridSpec.split('x');
    const gridSize = parseInt(parts[0]);
    if (parts.length != 2 || parts[0] !== parts[1] ||
      gridSize.toString() !== parts[0]) {
      throw ('Invalid grid spec format: ' + gridSpec);
    }
    return this.fromGridSize(gridSize);
  };

  static fromNumCells(numCells) {
    const gridSize = Math.sqrt(numCells);
    return this.fromGridSize(gridSize);
  }
  static fromNumPencilmarks(numPencilmarks) {
    const gridSize = Math.cbrt(numPencilmarks);
    return this.fromGridSize(gridSize);
  }

  static makeName(gridSize) {
    return `${gridSize}x${gridSize}`;
  }

  static baseCharCode(shape) {
    return shape.numValues < 10 ? '1'.charCodeAt(0) : 'A'.charCodeAt(0);
  }

  constructor(do_not_call, gridSize) {
    if (do_not_call !== undefined) {
      throw Error('Use GridShape.fromGridSize() instead.');
    }

    // Core dimensions - for now, always square
    this.numRows = gridSize;
    this.numCols = gridSize;

    // Legacy property - will be removed once all usages are migrated
    this.gridSize = gridSize;

    [this.boxHeight, this.boxWidth] = this.constructor._boxDims(gridSize);
    this.numValues = gridSize;
    this.numCells = this.numRows * this.numCols;
    this.numPencilmarks = this.numCells * this.numValues;
    this.noDefaultBoxes = this.boxHeight === 1 || this.boxWidth === 1;

    this.name = this.constructor.makeName(gridSize);

    this._valueBase = this.numValues + 1;

    this.allCells = [];
    for (let i = 0; i < this.numCells; i++) this.allCells.push(i);

    this.maxSum = this.numValues * (this.numValues + 1) / 2;

    Object.freeze(this);
  }

  static _boxDims(gridSize) {
    for (let i = Math.sqrt(gridSize) | 0; i >= 1; i--) {
      if (gridSize % i === 0) {
        return [i, gridSize / i];
      }
    }
    throw ('Invalid grid size: ' + gridSize);
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