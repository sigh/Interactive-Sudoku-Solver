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

  constructor() {
    this._initCellArray();
    this._stack = new Array(NUM_CELLS);
    this._depth = 0;

    this._progress = {
      frequency: 0,
      callback: null,
      extraState: null,
    };

    this.reset();
  }

  reset() {
    this._done = false;
    this._iter = null;
    this._counters = {
      nodesSearched: 0,
      columnsSearched: 0,
      guesses: 0,
      solutions: 0,
    };
    this._cells[0].fill(ALL_VALUES);
    this._timer = new Timer();
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


  _selectNextCell(cells, depth) {
    return depth;
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
      stack[depth] = this._selectNextCell(this._cells[depth], depth);
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

      stack[depth] = this._selectNextCell(cells, depth);
      // Cell has no possible values, skip it.
      if (!cells[stack[depth]]) continue;

      counters.columnsSearched++;
      depth++;
    }

    this._done = true;
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
    let result = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      let values = cells[i];
      while(values) {
        let value = values & -values;
        result.push(valueId(i/GRID_SIZE|0, i%GRID_SIZE|0, LookupTable.VALUES[value]-1));
        values &= ~value;
      }
    }
    return {
      values: result,
    }
  }

  solveAllPossibilities() {
    throw('Unimplimented');
  }
}

let solver = new SudokuSolver();
