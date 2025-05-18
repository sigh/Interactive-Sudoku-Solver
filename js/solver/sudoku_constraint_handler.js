export class SudokuConstraintHandler {
  static SINGLETON_HANDLER = false;

  static _defaultId = 0;

  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
    // cells must not be written to. They can be updated during initialization,
    // but it must replace the array, not modify it.
    this.cells = new Uint8Array(cells || []);
    // By default all constraints are essential for correctness.
    // The optimizer may add non-essential constraints to improve performance.
    this.essential = true;

    const id = this.constructor._defaultId++;
    // By default every id is unique.
    this.idStr = this.constructor.name + '-' + id.toString();
  }

  // Enforce the constraint on the grid and return:
  // - `false` if the grid is invalid.
  // - `true` if the grid is valid.
  // - `true` if there are still unknown values and the grid
  //          might be valid.
  enforceConsistency(grid, handlerAccumulator) {
    return true;
  }

  // List of cells which must not have the same values as each other.
  exclusionCells() {
    return [];
  }

  // Initialize the grid before solving starts.
  // Return `false` if the grid is invalid, `true` otherwise.
  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return true;
  }

  // Run after all handlers have been initialized and initialGridCells is populated
  // and includes the full state.
  // readonlyGridState must not be written to! This will lead to incorrect
  // results if the handler is used from within an Or constraint.
  postInitialize(readonlyGridState) { }

  priority() {
    // By default, constraints which constrain more cells have higher priority.
    return this.cells.length;
  }

  candidateFinders(grid, shape) {
    return [];
  }

  debugName() {
    return this.constructor.name;
  }
}

SudokuConstraintHandler.NoBoxes = class NoBoxes extends SudokuConstraintHandler { }

// This handler purely exists to manually adjust the priorities of cells to
// adjust initial cell selection.
SudokuConstraintHandler.Priority = class Priority extends SudokuConstraintHandler {
  constructor(cells, priority) {
    // Don't register cells, so that this handler doesn't get added to the cells
    // and is not invoked during solving or any other calculations.
    super();
    this._priorityCells = cells;
    this._priority = priority;
  }

  priority() {
    return this._priority;
  }

  priorityCells() {
    return this._priorityCells;
  }
}

SudokuConstraintHandler.True = class True extends SudokuConstraintHandler {
}

SudokuConstraintHandler.False = class False extends SudokuConstraintHandler {
  constructor(cells) {
    // The cells with which to associate the failure.
    super(cells);

    if (cells.length === 0) throw 'False needs cells to be effective.';
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return false;
  }
  enforceConsistency(grid, handlerAccumulator) { return false; }
}