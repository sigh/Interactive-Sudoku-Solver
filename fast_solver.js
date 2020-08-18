const BOX_SIZE = 3;
const GRID_SIZE = BOX_SIZE*BOX_SIZE;
const ALL_VALUES = (1<<GRID_SIZE)-1;
const COMBINATIONS = (1<<GRID_SIZE);
const NUM_CELLS = GRID_SIZE*GRID_SIZE;

class LookupTable {
  static _emptyTable() {
    return new Uint8Array(COMBINATIONS);
  }

  static VALUES = (() => {
    let table = LookupTable._emptyTable();
    for (let i = 0; i < GRID_SIZE; i++) {
      table[1 << i] = i+1;
    }
    return table;
  })();

  static COUNTS = (() => {
    let table = LookupTable._emptyTable();
    for (let i = 1; i < COMBINATIONS; i++) {
      // Count is one greater than the count with the last bit removed.
      table[i] = 1 + table[i & (i-1)];
    }
    return table;
  })();
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
    let counts = LookupTable.COUNTS;
    let minCount = counts[cells[stack[0]]];

    // Find the cell with the lowest count. If we see a count of 1, then we
    // know we can't get any better (any domain wipeouts should have already
    // been rejected).
    for (let i = 0; i < stack.length && minCount > 1; i++) {
      let count = counts[cells[stack[i]]];
      if (count < minCount) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        count = minCount;
      }
    }
  }

  _enforceConstraints(cells, cell) {
    let value = cells[cell];
    let removeValue = ~cells[cell];

    let row = cell/GRID_SIZE|0;
    let col = cell%GRID_SIZE|0;
    for (let i = 0; i < GRID_SIZE; i++) {
      if (i != col) {
        if (!(cells[GRID_SIZE*row+i] &= removeValue)) return false;
      }
      if (i != row) {
        if (!(cells[GRID_SIZE*i+col] &= removeValue)) return false;
      }

      let bi = i/BOX_SIZE|0;
      let bj = i%BOX_SIZE|0;
      let bc = ((row/BOX_SIZE|0)*BOX_SIZE + bi)*GRID_SIZE + (col/BOX_SIZE|0)*BOX_SIZE + bj;
      if (bc != cell) {
        if (!(cells[bc] &= removeValue)) return false;
      }
    }

    return true;
  }

  static _cellsToSolution(cells) {
    let values = cells.map(value => LookupTable.VALUES[value])
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
        pencilmarks.push(valueId(i/GRID_SIZE|0, i%GRID_SIZE|0, LookupTable.VALUES[value]-1));
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

SudokuSolver.Constraint = class {
  static parseValueId(valueId) {
    return {
      row: +valueId[1]-1,
      col: +valueId[3]-1,
      value: +valueId[5],
    };
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
      let {row, col, value} = SudokuSolver.Constraint.parseValueId(valueId);
      solver._initialCells[row*GRID_SIZE + col] = (1 << (value-1));
    }
  }
}
