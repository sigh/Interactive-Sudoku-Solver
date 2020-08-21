"use strict";

const BOX_SIZE = 3;
const GRID_SIZE = BOX_SIZE*BOX_SIZE;
const ALL_VALUES = (1<<GRID_SIZE)-1;
const COMBINATIONS = (1<<GRID_SIZE);
const NUM_CELLS = GRID_SIZE*GRID_SIZE;

class LookupTable {
  static VALUE = (() => {
    let table = new Uint8Array(COMBINATIONS);
    for (let i = 0; i < GRID_SIZE; i++) {
      table[1 << i] = i+1;
    }
    return table;
  })();

  static COUNT = (() => {
    let table = new Uint8Array(COMBINATIONS);
    for (let i = 1; i < COMBINATIONS; i++) {
      // COUNT is one greater than the count with the last set bit removed.
      table[i] = 1 + table[i & (i-1)];
    }
    return table;
  })();

  static SUM = (() => {
    let table = new Uint8Array(COMBINATIONS);
    for (let i = 1; i < COMBINATIONS; i++) {
      // SUM is the value of the lowest set bit plus the sum  of the rest.
      table[i] = table[i & (i-1)] + LookupTable.VALUE[i & -i];
    }
    return table;
  })();

  static MIN = (() => {
    let table = new Uint8Array(COMBINATIONS);
    for (let i = 1; i < COMBINATIONS; i++) {
      // MIN is the value of the last bit set.
      table[i] = LookupTable.VALUE[i & -i];
    }
    return table;
  })();

  static MAX = (() => {
    let table = new Uint8Array(COMBINATIONS);
    table[1] = LookupTable.VALUE[1];
    for (let i = 2; i < COMBINATIONS; i++) {
      // MAX is greater than the max when everything has been decreased by
      // 1.
      table[i] = 1 + table[i >> 1];
    }
    return table;
  })();

  static _binaryFunctionCache = new Map();
  static _binaryFunctionKey(fn) {
    let key = 0n;
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (fn(i, j)) key |= 1n << BigInt(i*GRID_SIZE+j);
      }
    }
    return key;
  }

  static forBinaryFunction(fn) {
    // Check the cache first.
    let key = this._binaryFunctionKey(fn);
    if (this._binaryFunctionCache.has(key)) {
      return this._binaryFunctionCache.get(key);
    }
    let table = new Uint16Array(COMBINATIONS);
    this._binaryFunctionCache.set(key, table);

    // Populate base cases, where there is a single value set.
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (fn(i+1, j+1)) {
          table[1 << i] |= 1 << j;
        }
      }
    }
    // To fill in the rest, OR together all the valid settings for each value
    // set.
    for (let i = 1; i < COMBINATIONS; i++) {
      table[i] = table[i & (i-1)] | table[i & -i];
    }
    return table;
  }
}

class SudokuSolver {

  constructor(handlers) {
    this._initCellArray();
    this._stack = new Uint8Array(NUM_CELLS);

    this._progress = {
      frequency: 0,
      callback: null,
      extraState: null,
    };

    this._setUpHandlers(handlers);

    this.reset();
  }

  _setUpHandlers(handlers) {
    let cellConflicts = new Array(NUM_CELLS);
    this._cellConstraintHandlers = new Array(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) {
      cellConflicts[i] = new Set();
      this._cellConstraintHandlers[i] = [];
    }

    for (const handler of handlers) {
      // Run any initial enforcement.
      // TODO: Move this into the solve loop so that it is inluded in the
      // timing.
      if (handler.ENFORCE_AT_START) {
        handler.enforceConsistency(this._initialGrid);
      }

      // Add all cells that h
      // andler claims to be attached to the list of
      // handlers for that cell.
      for (const cell of handler.cells) {
        this._cellConstraintHandlers[cell].push(handler);
      }

      // Add handling for conflicting cells.
      let conflictSet = handler.conflictSet();
      for (const c of conflictSet) {
        for (const d of conflictSet) {
          if (c != d) cellConflicts[c].add(d);
        }
      }
    }

    // Set cell conflicts so that they are unique.
    this._cellConflicts = cellConflicts.map(c => new Uint8Array(c));
  }

  reset() {
    this._iter = null;
    this._counters = {
      valuesSearched: 0,
      cellsSearched: 0,
      guesses: 0,
      solutions: 0,
    };
    this._resetStack();
    this._timer = new Timer();
  }

  _resetStack() {
    this._done = false;
    this._grids[0].set(this._initialGrid);
    // Re-initialize the cell indexes in the stack.
    // This is not required, but keeps things deterministic.
    for (let i = 0; i < NUM_CELLS; i++) {
      this._stack[i] = i;
    }
  }

  _initCellArray() {
    let buffer = new ArrayBuffer(
      (NUM_CELLS+1) * NUM_CELLS * Uint16Array.BYTES_PER_ELEMENT);

    this._grids = new Array(NUM_CELLS+1);
    for (let i = 0; i < NUM_CELLS+1; i++) {
      this._grids[i] = new Uint16Array(
        buffer,
        i*NUM_CELLS*Uint16Array.BYTES_PER_ELEMENT,
        NUM_CELLS);
    }
    this._initialGrid = new Uint16Array(NUM_CELLS);
    this._initialGrid.fill(ALL_VALUES);
  }

  _sendProgress() {
    this._progress.callback(
      this._progress.extraState ? this._progress.extraState() : null);
  }

  _getIter(yieldEveryStep) {
    // If an iterator doesn't exist, then create it.
    if (!this._iter) {
      this._iter = this._runSolver(yieldEveryStep);
    }

    return this._iter;
  }


  // Find the best cell and bring it to the front. This means that it will
  // be processed next.
  _updateCellOrder(stack, grid) {
    let counts = LookupTable.COUNT;
    let minCount = counts[grid[stack[0]]];

    // Find the cell with the lowest count. If we see a count of 1, then we
    // know we can't get any better (any domain wipeouts should have already
    // been rejected).
    for (let i = 0; i < stack.length && minCount > 1; i++) {
      let count = counts[grid[stack[i]]];
      if (count < minCount) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        minCount = count;
      }
    }
  }

  _enforceConstraints(grid, cell) {
    let value = grid[cell];
    let cellAccumulator = new CellAccumulator(this);
    cellAccumulator.add(cell);

    for (const conflict of this._cellConflicts[cell]) {
      if (grid[conflict] & value) {
        if (!(grid[conflict] &= ~value)) return false;
        cellAccumulator.add(conflict);
      }
    }

    while (cellAccumulator.hasConstraints()) {
      let c = cellAccumulator.popConstraint();
      if (!c.enforceConsistency(grid)) return false;
    }

    return true;
  }

  static _resultToSolution(result) {
    let values = result.grid.map(value => LookupTable.VALUE[value])
    let solution = [];
    for (const cell of result.stack) {
      solution.push(valueId(cell/GRID_SIZE|0, cell%GRID_SIZE|0, values[cell]-1));
    }
    return solution;
  }

  // _runSolver runs the solver yielding each solution, and optionally at
  // each step.
  *_runSolver(yieldEveryStep) {
    yieldEveryStep = yieldEveryStep || false;
    if (this._done) return true;

    let depth = 0;
    let stack = this._stack;
    let counters = this._counters;

    if (depth === 0) {
      this._updateCellOrder(stack.subarray(depth), this._grids[depth]);
      depth++;
      counters.cellsSearched++;
    }

    let progressFrequency = this._progress.frequency;

    while (depth) {
      depth--;
      let cell = stack[depth];
      let grid = this._grids[depth];
      let values = grid[cell];

      // We've run out of legal values in this cell, so backtrack.
      if (!values) continue;

      // Find the next smallest to try, and remove it from our set of
      // candidates.
      let value = values & -values;
      grid[cell] &= ~value;

      counters.valuesSearched++;
      if (value != values) counters.guesses++;

      // Copy current cell values.
      depth++;
      this._grids[depth].set(grid);
      grid = this._grids[depth];

      // Propogate constraints.
      grid[cell] = value;
      let hasContradiction = !this._enforceConstraints(grid, cell);

      if (counters.valuesSearched % progressFrequency == 0) {
        this._sendProgress();
      }
      if (yieldEveryStep) {
        let yieldValue = {
          grid: grid,
          isSolution: !hasContradiction && (depth == NUM_CELLS),
          stack: stack.subarray(0, depth),
          hasContradiction: hasContradiction,
        };
        yieldEveryStep = (yield yieldValue) || false;
      }

      if (hasContradiction) continue;

      if (depth == NUM_CELLS) {
        // We've set all the values, and we haven't found a contradiction.
        // This is a solution!
        counters.solutions++;
        let yieldValue = {
          grid: grid,
          isSolution: true,
          stack: stack,
          hasContradiction: false,
        };
        yieldEveryStep = (yield yieldValue) || false;
        continue;
      }

      this._updateCellOrder(stack.subarray(depth), grid);
      // Cell has no possible values, backtrack.
      if (!grid[stack[depth]]) continue;

      counters.cellsSearched++;
      depth++;
    }

    this._done = true;
  }

  // Solve until maxSolutions are found, and returns leaving the stack
  // fully unwound.
  *_solve(maxSolutions) {
    let i = 0;
    for (const solution of this._runSolver()) {
      yield solution.grid;
      if (++i == maxSolutions) break;
    }
    this._resetStack();
  }

  _solveAllPossibilities(validRows) {
    // TODO: Do all forced reductions first to avoid having to do them for
    // each iteration.

    // Do initial solve to see if we have 0, 1 or many solutions.
    for (const grid of this._solve(2)) {
      grid.forEach((c, i) => { validRows[i] |= c; } );
    }

    let numSolutions = this._counters.solutions;

    // If there are 1 or 0 solutions, there is nothing else to do.
    // If there are 2 or more, then we have to check all possibilities.
    if (numSolutions > 1) {
      for (let i = 0; i < NUM_CELLS; i++) {
        for (let v = 1; v < ALL_VALUES; v <<= 1) {
          // We already know this is a valid row.
          if (validRows[i] & v) continue;
          // This is NOT a valid row.
          if (!(this._grids[0][i] & v)) continue;

          // Fix the current value and attempt to solve.
          // Solve will also reset any changes we made to this._grids[0].
          this._grids[0][i] = v;
          for (const grid of this._solve(1)) {
            grid.forEach((c, i) => { validRows[i] |= c; } );
          };
        }
      }
    }

    this._done = this._counters.solutions < 2;
  }


  state() {
    let counters = {...this._counters};
    counters.backtracks = counters.valuesSearched - counters.cellsSearched;

    return {
      counters: counters,
      timeMs: this._timer.elapsedMs(),
      done: this._done,
      extra: null,
    }
  }

  setProgressCallback(callback, frequency) {
    this._progress.callback = callback;
    this._progress.frequency = frequency;
  }

  nextSolution() {
    let iter = this._getIter();

    this._timer.unpause();
    let result = this._iter.next();
    this._timer.pause();

    if (result.done) return null;

    return SudokuSolver._resultToSolution(result.value);
  }

  countSolutions(updateFrequency) {
    this.reset();

    // Add a sample solution to the state updates, but only if a different
    // solution is ready.
    let sampleSolution = null;
    this._progress.extraState = () => {
      let result = null;
      if (sampleSolution) {
        result = {solution: sampleSolution};
        sampleSolution = null;
      }
      return result;
    };

    this._timer.unpause();
    for (const result of this._getIter()) {
      // Only store a sample solution if we don't have one.
      if (sampleSolution == null) {
        sampleSolution = SudokuSolver._resultToSolution(result)
      }
    }
    this._timer.pause();

    // Send progress one last time to ensure the last solution is sent.
    this._sendProgress();

    this._progress.extraState = null;

    return this._counters.solutions;
  }

  static _makePencilmarks(grid, ignoreCells) {
    let ignoreSet = new Set(ignoreCells);

    let pencilmarks = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      if (ignoreSet.has(i)) continue;
      let values = grid[i];
      while (values) {
        let value = values & -values;
        pencilmarks.push(valueId(i/GRID_SIZE|0, i%GRID_SIZE|0, LookupTable.VALUE[value]-1));
        values &= ~value;
      }
    }
    return pencilmarks;
  }

  goToStep(n) {
    n++;

    // Easiest way to go backwards is to start from the start again.
    if (n < this._counters.valuesSearched) this.reset();

    let iter = this._getIter(true);
    let result = null;

    // Iterate until we have seen n steps.
    this._timer.unpause();
    while (this._counters.valuesSearched + this._done < n && !this._done) {
      result = iter.next(true).value;
    }
    this._timer.pause();

    if (this._done) return null;

    return {
      values: SudokuSolver._resultToSolution(result),
      pencilmarks: SudokuSolver._makePencilmarks(result.grid, result.stack),
      isSolution: result.isSolution,
      hasContradiction: result.hasContradiction,
    }
  }

  solveAllPossibilities() {
    this.reset();

    let validRows = new Uint16Array(NUM_CELLS);

    // Send the current valid rows with the progress update, if there have
    // been any changes.
    let lastSize = 0;
    this._progress.extraState = () => {
      let pencilmarks = SudokuSolver._makePencilmarks(validRows);
      if (pencilmarks.length == lastSize) return null;
      lastSize = pencilmarks.size;
      return {pencilmarks: pencilmarks};
    };

    this._timer.unpause();
    this._solveAllPossibilities(validRows);
    this._timer.pause();

    this._progress.extraState = null;

    return SudokuSolver._makePencilmarks(validRows);
  }
}

class CellAccumulator {
  constructor(solver) {
    this._solver = solver;

    // We keep the invariant that:
    //   this._extraConstraints contains c <=> c.dirty == this._generation
    this._constraints = [];
    this._generation = ++this.constructor.dirtyGeneration;
  }

  static dirtyGeneration = 0;

  add(cell) {
    for (const c of this._solver._cellConstraintHandlers[cell]) {
      if (c.dirty != this._generation) {
        c.dirty = this._generation;
        this._constraints.push(c);
      }
    }
  }

  hasConstraints() {
    return this._constraints.length > 0;
  }

  popConstraint() {
    let c = this._constraints.pop();
    c.dirty = 0;
    return c;
  }
}

SudokuSolver.ConstraintHandler = class {
  // If true, then enforce the constraint before solving.
  ENFORCE_AT_START = false;

  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
    this.cells = cells || [];
    // Dirty bit for determining if the constraint needs to be enforced.
    this.dirty = 0;
  }

  enforceConsistency(grid) {
    return true;
  }

  conflictSet() {
    return [];
  }
}

SudokuSolver.FixedCellsHandler = class extends SudokuSolver.ConstraintHandler{
  ENFORCE_AT_START = true;

  constructor(valueMap) {
    super();
    this._valueMap = valueMap;
  }

  enforceConsistency(grid) {
    for (const [cell, value] of this._valueMap) {
      grid[cell] = 1 << (value-1);
    }
  }
}

SudokuSolver.AllDifferentHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(conflictCells) {
    super();
    this._conflictCells = conflictCells;
  }

  conflictSet() {
    return this._conflictCells;
  }
}

SudokuSolver.NonetHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells) {
    super(cells);
  }

  enforceConsistency(grid) {
    // TODO: Ignore hidden singles we've already found.
    // TODO: Ignore nonets we've already processed.
    let allValues = 0;
    let uniqueValues = 0;
    for (const cell of this.cells) {
      let v = grid[cell];
      uniqueValues &= ~v;
      uniqueValues |= (v&~allValues);
      allValues |= v;
    }
    if (allValues != ALL_VALUES) return false;

    // Search for hidden singles.
    if (uniqueValues) {
      for (const cell of this.cells) {
        if (grid[cell] & uniqueValues) {
          grid[cell] &= uniqueValues;
          // We also want it to be true that grid[cell] now only has a single
          // value, but that should always be true here.
        }
      }
    }

    return true;
  }

  conflictSet() {
    return this.cells;
  }
}

SudokuSolver.BinaryConstraintHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cell1, cell2, fn) {
    super([cell1, cell2]);
    this._tables = [
      LookupTable.forBinaryFunction(fn),
      LookupTable.forBinaryFunction((a, b) => fn(b, a)),
    ];
  }

  enforceConsistency(grid) {
    let v0 = grid[this.cells[0]];
    let v1 = grid[this.cells[1]];

    v0 &= this._tables[1][v1];
    v1 &= this._tables[0][v0];

    grid[this.cells[0]] = v0;
    grid[this.cells[1]] = v1;

    return v0 && v1;
  }
}

SudokuSolver.SumHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = sum;
  }

  enforceConsistency(grid) {
    // Check that the given sum is within the min and max possible sums.
    let min = 0;
    let max = 0;
    for (const cell of this.cells) {
      min += LookupTable.MIN[grid[cell]];
      max += LookupTable.MAX[grid[cell]];
    }

    // It is impossible to make the target sum.
    if (this._sum < min || this._sum > max) return false;
    // We've reached the target sum exactly.
    if (this._sum == min && this._sum == max) return true;

    // Check that we can make the current sum with the unique values remaining.
    // NOTE: This is only valid if we assume unique values.
    let fixedValues = 0;
    let allValues = 0;
    for (const cell of this.cells) {
      let value = grid[cell];
      allValues |= value;
      if (!(value&(value-1))) fixedValues |= value;
    }

    let sumOptions = SudokuSolver.SumHandler.KILLER_CAGE_SUMS
        [this.cells.length - LookupTable.COUNT[fixedValues]]
        [this._sum - LookupTable.SUM[fixedValues]];
    if (!sumOptions) return false;

    let unfixedValues = allValues & ~fixedValues;
    let possible = 0;
    for (const option of sumOptions) {
      if ((option & unfixedValues) === option) possible |= option;
    }
    if (!possible) return false;

    // Remove any values that aren't part of any solution.
    let valuesToRemove = unfixedValues & ~possible;
    if (valuesToRemove) {
      for (const cell of this.cells) {
        // Safe to apply to every cell, since we know that none of the
        // fixedValues are in unfixedValues.
        grid[cell] &= ~valuesToRemove;
      }
    }

    // TODO: The possiblities check above can't check if the required values
    // are in different cells.
    // Consider porting the range check here as well.

    return true;
  }

  conflictSet() {
    return this.cells;
  }

  static KILLER_CAGE_SUMS = (() => {
    let table = [];
    for (let n = 0; n < GRID_SIZE+1; n++) {
      let totals = [];
      table.push(totals);
      for (let i = 0; i < (GRID_SIZE*(GRID_SIZE+1)/2)+1; i++) {
        totals.push([]);
      }
    }

    let counts = LookupTable.COUNT;
    let sums = LookupTable.SUM;
    for (let i = 0; i < COMBINATIONS; i++) {
      table[counts[i]][sums[i]].push(i);
    }

    return table;
  })();
}
