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

  constructor(constraints) {
    this._initCellArray();
    this._stack = new Uint8Array(NUM_CELLS);

    this._progress = {
      frequency: 0,
      callback: null,
      extraState: null,
    };

    constraints.apply(this);

    this.reset();
  }

  reset() {
    this._iter = null;
    this._counters = {
      nodesSearched: 0,
      columnsSearched: 0,
      guesses: 0,
      solutions: 0,
    };
    this._resetStack();
    this._timer = new Timer();
  }

  _resetStack() {
    this._depth = 0;
    this._done = false;
    this._cells[0].set(this._initialCells);
    // Re-initialize the cell indexes in the stack.
    // This is not required, but keeps things deterministic.
    for (let i = 0; i < NUM_CELLS; i++) {
      this._stack[i] = i;
    }
  }

  _initCellArray() {
    let buffer = new ArrayBuffer(
      (NUM_CELLS+1) * NUM_CELLS * Uint16Array.BYTES_PER_ELEMENT);

    this._cells = new Array(NUM_CELLS+1);
    for (let i = 0; i < NUM_CELLS+1; i++) {
      this._cells[i] = new Uint16Array(
        buffer,
        i*NUM_CELLS*Uint16Array.BYTES_PER_ELEMENT,
        NUM_CELLS);
    }
    this._initialCells = new Uint16Array(NUM_CELLS);
    this._initialCells.fill(ALL_VALUES);

    this._cellConflicts = new Array(NUM_CELLS);
    this._cellConstraintHandlers = new Array(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) {
      this._cellConflicts[i] = [];
      this._cellConstraintHandlers[i] = [];
    }
  }

  _sendProgress() {
    this._progress.callback(
      this._progress.extraState ? this._progress.extraState() : null);
  }

  _getIter(iterationsUntilYield) {
    // If an iterator doesn't exist, then create it.
    if (!this._iter) {
      this._iter = this._runSolver(iterationsUntilYield);
    }

    return this._iter;
  }


  // Find the best cell and bring it to the front. This means that it will
  // be processed next.
  _sortStackByBestCell(stack, cells) {
    let counts = LookupTable.COUNT;
    let minCount = counts[cells[stack[0]]];

    // Find the cell with the lowest count. If we see a count of 1, then we
    // know we can't get any better (any domain wipeouts should have already
    // been rejected).
    for (let i = 0; i < stack.length && minCount > 1; i++) {
      let count = counts[cells[stack[i]]];
      if (count < minCount) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        minCount = count;
      }
    }
  }

  _enforceConstraints(cells, cell) {
    let value = cells[cell];
    let cellAccumulator = new CellAccumulator(this);
    cellAccumulator.add(cell);

    for (const conflict of this._cellConflicts[cell]) {
      if (cells[conflict] & value) {
        if (!(cells[conflict] &= ~value)) return false;
        cellAccumulator.add(conflict);
      }
    }

    while (cellAccumulator.hasConstraints()) {
      let c = cellAccumulator.popConstraint();
      if (!c.enforceConsistency(cells)) return false;
    }

    return true;
  }

  static _cellsToSolution(cells) {
    let values = cells.map(value => LookupTable.VALUE[value])
    let result = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      result.push(valueId(i/GRID_SIZE|0, i%GRID_SIZE|0, values[i]-1));
    }
    return result;
  }

  // _runSolver runs the solver yielding each solution, and optionally at
  // intermediate steps.
  // The value returned to yield determines how many steps to run for (-1 for
  // no limit).
  *_runSolver(iterationsUntilYield) {
    if (this._done) return true;

    let depth = 0;
    let stack = this._stack;
    let counters = this._counters;

    if (depth === 0) {
      this._sortStackByBestCell(stack.subarray(depth), this._cells[depth]);
      depth++;
      counters.columnsSearched++;
    }

    let progressFrequency = this._progress.frequency;
    iterationsUntilYield = iterationsUntilYield || -1;

    while (depth) {
      depth--;
      let cell = stack[depth];
      let cells = this._cells[depth];
      let values = cells[cell];

      // We've run out of legal values in this cell, so backtrack.
      if (!values) continue;

      // Find the next smallest to try, and remove it from our set of
      // candidates.
      let value = values & -values;
      cells[cell] &= ~value;

      counters.nodesSearched++;
      if (value != values) counters.guesses++;
      iterationsUntilYield--;

      // Copy current cell values.
      depth++;
      this._cells[depth].set(cells);
      cells = this._cells[depth];

      // Propogate constraints.
      cells[cell] = value;
      let hasContradiction = !this._enforceConstraints(cells, cell);

      if (counters.nodesSearched % progressFrequency == 0) {
        this._sendProgress();
      }
      if (!iterationsUntilYield) {
        this._depth = depth;
        iterationsUntilYield = (yield null) || -1;
      }

      if (hasContradiction) continue;

      if (depth == NUM_CELLS) {
        // We've set all the values, and we haven't found a contradiction.
        // This is a solution!
        counters.solutions++;
        this._depth = depth;
        iterationsUntilYield = (yield cells) || -1;
        continue;
      }

      this._sortStackByBestCell(stack.subarray(depth), cells);
      // Cell has no possible values, backtrack.
      if (!cells[stack[depth]]) continue;

      counters.columnsSearched++;
      depth++;
    }

    this._done = true;
  }

  // Solve until maxSolutions are found, and returns leaving the stack
  // fully unwound.
  _solve(maxSolutions, solutionFn) {
    let iter = this._runSolver();

    for (let i = 0; i < maxSolutions; i++) {
      let result = iter.next();
      if (result.done) break;
      solutionFn(result.value);
    }

    this._resetStack();
  }

  _solveAllPossibilities(validRows) {
    // TODO: Do all forced reductions first to avoid having to do them for
    // each iteration.

    // Do initial solve to see if we have 0, 1 or many solutions.
    this._solve(2,
      (cells) => {
        cells.forEach((c, i) => { validRows[i] |= c; } );
      });

    let numSolutions = this._counters.solutions;

    // If there are 1 or 0 solutions, there is nothing else to do.
    // If there are 2 or more, then we have to check all possibilities.
    if (numSolutions > 1) {
      for (let i = 0; i < NUM_CELLS; i++) {
        for (let v = 1; v < ALL_VALUES; v <<= 1) {
          // We already know this is a valid row.
          if (validRows[i] & v) continue;
          // This is NOT a valid row.
          if (!(this._cells[0][i] & v)) continue;

          // Fix the current value and attempt to solve.
          // Solve will also reset any changes we made to this._cells[0].
          this._cells[0][i] = v;
          this._solve(1, (cells) => {
            cells.forEach((c, i) => { validRows[i] |= c; } );
          });
        }
      }
    }

    this._done = this._counters.solutions < 2;
  }


  state() {
    let counters = {...this._counters};
    counters.backtracks = counters.nodessearched - counters.columnssearched;

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

    return SudokuSolver._cellsToSolution(result.value);
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
    for (let stack of this._getIter()) {
      // Only store a sample solution if we don't have one.
      if (sampleSolution == null) {
        sampleSolution = SudokuSolver._cellsToSolution(stack)
      }
    }
    this._timer.pause();

    // Send progress one last time to ensure the last solution is sent.
    this._sendProgress();

    this._progress.extraState = null;

    return this._counters.solutions;
  }

  static _makePencilmarks(cells) {
    let pencilmarks = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      let values = cells[i];
      while (values) {
        let value = values & -values;
        pencilmarks.push(valueId(i/GRID_SIZE|0, i%GRID_SIZE|0, LookupTable.VALUE[value]-1));
        values &= ~value;
      }
    }
    return pencilmarks;
  }

  goToStep(n) {
    // Easiest way to go backwards is to start from the start again.
    if (n < this._counters.nodesSearched) this.reset();

    let iter = this._getIter(1);

    // Iterate until we have seen n steps.
    this._timer.unpause();
    while (this._counters.nodesSearched + this._done < n && !this._done) {
      iter.next(1);
    }
    this._timer.pause();

    if (this._done) return null;

    let cells = this._cells[this._depth];
    return {
      values: SudokuSolver._makePencilmarks(cells),
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
  constructor() {
    this.dirty = 0;
  }
}


SudokuSolver.NonetConstraintHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells) {
    super();
    this._constraintCells = cells;
  }

  enforceConsistency(cells) {
    // TODO: Ignore hidden singles we've already found.
    // TODO: Ignore nonets we've already processed.
    let allValues = 0;
    let uniqueValues = 0;
    for (const cell of this._constraintCells) {
      let v = cells[cell];
      uniqueValues &= ~v;
      uniqueValues |= (v&~allValues);
      allValues |= v;
    }
    if (allValues != ALL_VALUES) return false;

    // Search for hidden singles.
    if (uniqueValues) {
      for (const cell of this._constraintCells) {
        if (cells[cell] & uniqueValues) {
          cells[cell] &= uniqueValues;
          // We also want it to be true that cells[cell] now only has a single
          // value, but that should always be true here.
        }
      }
    }

    return true;
  }
}

SudokuSolver.BinaryConstraintHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells, tables) {
    super();
    this._constraintCells = cells;
    this._tables = tables;
  }

  enforceConsistency(cells) {
    let v0 = cells[this._constraintCells[0]];
    let v1 = cells[this._constraintCells[1]];

    v0 &= this._tables[1][v1];
    v1 &= this._tables[0][v0];

    cells[this._constraintCells[0]] = v0;
    cells[this._constraintCells[1]] = v1;

    return v0 && v1;
  }
}

SudokuSolver.SumHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells, sum) {
    super();
    this._constraintCells = cells;
    this._sum = sum;
  }

  enforceConsistency(cells) {
    // Check that the given sum is within the min and max possible sums.
    let min = 0;
    let max = 0;
    for (const cell of this._constraintCells) {
      min += LookupTable.MIN[cells[cell]];
      max += LookupTable.MAX[cells[cell]];
    }

    // It is impossible to make the target sum.
    if (this._sum < min || this._sum > max) return false;
    // We've reached the target sum exactly.
    if (this._sum == min && this._sum == max) return true;

    // Check that we can make the current sum with the unique values remaining.
    // NOTE: This is only valid if we assume unique values.
    let fixedValues = 0;
    let allValues = 0;
    for (const cell of this._constraintCells) {
      let value = cells[cell];
      allValues |= value;
      if (!(value&(value-1))) fixedValues |= value;
    }

    let sumOptions = SudokuSolver.SumHandler.KILLER_CAGE_SUMS
        [this._constraintCells.length - LookupTable.COUNT[fixedValues]]
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
      for (const cell of this._constraintCells) {
        // Safe to apply to every cell, since we know that none of the
        // fixedValues are in unfixedValues.
        cells[cell] &= ~valuesToRemove;
      }
    }

    // TODO: The possiblities check above can't check if the required values
    // are in different cells.
    // Consider porting the range check here as well.

    return true;
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


SudokuSolver.Constraint = class {
  static parseValueId(valueId) {
    return {
      cell: this.parseCellId(valueId),
      value: +valueId[5],
    };
  }

  static parseCellId(cellId) {
    let row = +cellId[1]-1;
    let col = +cellId[3]-1;
    return row*GRID_SIZE+col;
  }
}

SudokuSolver.ConstraintSet = class extends SudokuSolver.Constraint {
  constructor(constraints) {
    super();
    this._constraints = constraints;
  }

  apply(solver) {
    for (const constraint of this._constraints) {
      constraint.apply(solver);
    }
  }
}

SudokuSolver.FixedCells = class extends ConstraintSolver.Constraint {
  constructor(valueIds) {
    super();
    this._valueIds = valueIds;
  }

  apply(solver) {
    for (const valueId of this._valueIds) {
      let {cell, value} = SudokuSolver.Constraint.parseValueId(valueId);
      solver._initialCells[cell] = (1 << (value-1));
    }
  }
}

SudokuSolver.AllDifferent = class extends ConstraintSolver.Constraint {
  constructor(cells) {
    super();
    this._cells = cells;
  }

  apply(solver) {
    let cells = this._cells;
    for (const cell of cells) {
      let conflicts = solver._cellConflicts[cell];
      let currentConflicts = new Set(conflicts);
      for (const conflictCell of cells) {
        if (cell != conflictCell && !currentConflicts.has(conflictCell)) {
          conflicts.push(conflictCell);
        }
      }
    }

    if (cells.length == 9) {
      let handler = new SudokuSolver.NonetConstraintHandler(cells);
      for (const cell of cells) {
        solver._cellConstraintHandlers[cell].push(handler);
      }
    }
  }
}

SudokuSolver.BinaryConstraint = class extends ConstraintSolver.Constraint {
  constructor(cell1, cell2, fn) {
    super();
    this._cells = [cell1, cell2];
    this._fn = fn;
  }

  apply(solver) {
    let tables = [
      LookupTable.forBinaryFunction(this._fn),
      LookupTable.forBinaryFunction((a, b) => this._fn(b, a)),
    ];
    let handler = new SudokuSolver.BinaryConstraintHandler(this._cells, tables);
    for (const cell of this._cells) {
      solver._cellConstraintHandlers[cell].push(handler);
    }
  }

}

SudokuSolver.Sum = class extends ConstraintSolver.Constraint {
  constructor(cells, sum) {
    super();
    this._cells = cells;
    this._sum = sum;
  }

  apply(solver) {
    (new SudokuSolver.AllDifferent(this._cells)).apply(solver);

    let handler = new SudokuSolver.SumHandler(this._cells, this._sum);
    for (const cell of this._cells) {
      solver._cellConstraintHandlers[cell].push(handler);
    }
  }

}

