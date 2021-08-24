"use strict";

const ALL_VALUES = (1<<GRID_SIZE)-1;
const COMBINATIONS = (1<<GRID_SIZE);

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
    this._internalSolver = new SudokuSolver.InternalSolver(handlers);

    this._progressExtraStateFn = null;
    this._progressCallback = null;

    this._reset();
  }

  _reset() {
    this._internalSolver.reset();
    this._iter = null;
    this._timer = new Timer();
  }

  setProgressCallback(callback, frequency) {
    this._progressCallback = callback;
    this._internalSolver.setProgressCallback(
      this._sendProgress.bind(this),
      frequency);
  }

  _sendProgress() {
    let extraState = null;
    if (this._progressExtraStateFn) extraState = this._progressExtraStateFn();
    if (this._progressCallback) this._progressCallback(extraState);
  }

  countSolutions() {
    this._reset();

    // Add a sample solution to the state updates, but only if a different
    // solution is ready.
    let sampleSolution = null;
    this._progressExtraStateFn = () => {
      let result = null;
      if (sampleSolution) {
        result = {solution: sampleSolution};
        sampleSolution = null;
      }
      return result;
    };

    this._timer.runTimed(() => {
      for (const result of this._getIter()) {
        // Only store a sample solution if we don't have one.
        if (sampleSolution == null) {
          sampleSolution = this.constructor._resultToSolution(result)
        }
      }
    });

    // Send progress one last time to ensure the last solution is sent.
    this._sendProgress();

    this._progressExtraStateFn = null;

    return this._internalSolver.counters.solutions;
  }

  nthSolution(n) {
    let result = this._nthIteration(n, false);
    if (!result) return null;

    return this.constructor._resultToSolution(result);
  }

  nthStep(n) {
    let result = this._nthIteration(n, true);
    if (!result) return null;

    return {
      values: this.constructor._resultToSolution(result),
      pencilmarks: this.constructor._makePencilmarks(result.grid, result.stack),
      isSolution: result.isSolution,
      hasContradiction: result.hasContradiction,
    }
  }

  _nthIteration(n, stepByStep) {
    n++;
    let iter = this._getIter(stepByStep);
    // To go backwards we start from the start.
    if (n < iter.count) {
      this._reset();
      iter = this._getIter(stepByStep);
    }

    // Iterate until we have seen n steps.
    let result = null;
    this._timer.runTimed(() => {
      do {
        result = iter.next();
      } while (iter.count < n);
    });

    if (result.done) return null;
    return result.value;
  }

  solveAllPossibilities() {
    this._reset();

    let valuesInSolutions = new Uint16Array(NUM_CELLS);

    // Send the current values with the progress update, if there have
    // been any changes.
    let lastSize = 0;
    this._progressExtraStateFn = () => {
      let pencilmarks = this.constructor._makePencilmarks(valuesInSolutions);
      if (pencilmarks.length == lastSize) return null;
      lastSize = pencilmarks.size;
      return {pencilmarks: pencilmarks};
    };

    this._timer.runTimed(() => {
      this._internalSolver.solveAllPossibilities(valuesInSolutions);
    });

    this._progressExtraStateFn = null;

    return this.constructor._makePencilmarks(valuesInSolutions);
  }

  state() {
    let counters = {...this._internalSolver.counters};
    counters.backtracks = counters.valuesTried - counters.cellsSearched;

    return {
      counters: counters,
      timeMs: this._timer.elapsedMs(),
      done: this._internalSolver.done,
    }
  }

  _getIter(yieldEveryStep) {
    yieldEveryStep = !!yieldEveryStep;

    // If an iterator doesn't exist or is of the wrong type, then create it.
    if (!this._iter || this._iter.yieldEveryStep != yieldEveryStep) {
      this._iter = {
        yieldEveryStep: yieldEveryStep,
        iter: new IteratorWithCount(this._internalSolver.run(yieldEveryStep)),
      };
    }

    return this._iter.iter;
  }

  static _resultToSolution(result) {
    let values = result.grid.map(value => LookupTable.VALUE[value])
    let solution = [];
    for (const cell of result.stack) {
      solution.push(toValueId(...toRowCol(cell), values[cell]));
    }
    return solution;
  }

  static _makePencilmarks(grid, ignoreCells) {
    let ignoreSet = new Set(ignoreCells);

    let pencilmarks = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      if (ignoreSet.has(i)) continue;
      let values = grid[i];
      while (values) {
        let value = values & -values;
        pencilmarks.push(toValueId(...toRowCol(i), LookupTable.VALUE[value]));
        values &= ~value;
      }
    }
    return pencilmarks;
  }
}

const SOLVER_INITIALIZE_AT_START = true;

SudokuSolver.InternalSolver = class {

  constructor(handlers) {
    this._initCellArray();
    this._stack = new Uint8Array(NUM_CELLS);

    this._runCounter = 0;
    this._progress = {
      frequency: 0,
      callback: null,
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

    handlers = Array.from(handlers);
    for (const handler of handlers) {
      // Add all cells that the handler claims to be attached to the list of
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
    // Sort them, so they are in a predictable order.
    this._cellConflicts = cellConflicts.map(c => new Uint8Array(c));
    this._cellConflicts.forEach(c => c.sort((a, b) => a-b));

    // TODO: Include as part of the solver for timing?
    for (const handler of handlers) {
      handler.initialize(this._initialGrid, this._cellConflicts);
    }
  }

  reset() {
    this._iter = null;
    this.counters = {
      valuesTried: 0,
      cellsSearched: 0,
      guesses: 0,
      solutions: 0,
      constraintsProcessed: 0,
    };
    this._resetStack();
  }

  _resetStack() {
    // If we are at the start anyway, then there is nothing to do.
    if (this._atStart) return;

    this._runCounter++;

    this.done = false;
    this._atStart = true;
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

  // Find the best cell and bring it to the front. This means that it will
  // be processed next.
  _updateCellOrder(stack, grid) {
    // Do a first pass to check if there are any cells with 1 (or 0) cells set.
    // Since these can be resolved with no back-tracking, we return immediately.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts, so we should never find them here. Even if they exist, it
    // just means we do a few more useless forced cell resolutions.
    for (let i = 0; i < stack.length; i++) {
      let v = grid[stack[i]];
      if (!(v&(v-1))) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        return;
      }
    }

    // From here ALL cells have at least 2 candidates.
    // Choose one with the smallest count.
    let minScore = GRID_SIZE + 1;

    for (let i = 0; i < stack.length; i++) {
      let count = LookupTable.COUNT[grid[stack[i]]];
      if (count < minScore) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        minScore = count;
      }
    }
  }

  _enforceValue(grid, value, cell) {
    grid[cell] = value;

    let cellAccumulator = new SudokuSolver.CellAccumulator(this);
    cellAccumulator.add(cell);

    const conflicts = this._cellConflicts[cell];
    const numConflicts = conflicts.length;
    for (let i = 0; i < numConflicts; i++) {
      const conflict = conflicts[i];
      if (grid[conflict] & value) {
        if (!(grid[conflict] &= ~value)) return false;
        cellAccumulator.add(conflict);
      }
    }

    return this._enforceConstraints(grid, cellAccumulator);
  }

  _enforceConstraints(grid, cellAccumulator) {
    let counters = this.counters;

    while (cellAccumulator.hasConstraints()) {
      counters.constraintsProcessed++;
      let c = cellAccumulator.popConstraint();
      if (!c.enforceConsistency(grid)) return false;
    }

    return true;
  }

  // run runs the solver yielding each solution, and optionally at
  // each step.
  *run(yieldEveryStep) {
    yieldEveryStep = yieldEveryStep || false;

    // Set up iterator validation.
    if (!this._atStart) throw('State is not in initial state.');
    this._atStart = false;
    let runCounter = ++this._runCounter;
    const checkRunCounter = () => {
      if (runCounter != this._runCounter) throw('Iterator no longer valid');
    };

    let depth = 0;
    let stack = this._stack;
    let counters = this.counters;

    if (SOLVER_INITIALIZE_AT_START) {
      // Enforce constraints for all cells.
      let cellAccumulator = new SudokuSolver.CellAccumulator(this);
      for (let i = 0; i < NUM_CELLS; i++) cellAccumulator.add(i);
      this._enforceConstraints(this._grids[0], cellAccumulator);
    }

    if (yieldEveryStep) {
      yield {
        grid: this._grids[0],
        isSolution: false,
        stack: [],
        hasContradiction: false,
      }
      checkRunCounter();
    }

    this._updateCellOrder(stack.subarray(depth), this._grids[depth]);
    depth++;
    counters.cellsSearched++;

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

      counters.valuesTried++;
      if (value != values) counters.guesses++;

      // Copy current cell values.
      depth++;
      this._grids[depth].set(grid);
      grid = this._grids[depth];

      // Propogate constraints.
      grid[cell] = value;
      let hasContradiction = !this._enforceValue(grid, value, cell);

      if (counters.valuesTried % progressFrequency == 0) {
        this._progress.callback();
      }
      if (yieldEveryStep) {
        // The value may have been over-written by the constraint enforcer
        // (i.e. if there was a contradiction). Replace it for the output.
        grid[cell] = value;
        yield {
          grid: grid,
          isSolution: false,
          stack: stack.subarray(0, depth),
          hasContradiction: hasContradiction,
        };
        checkRunCounter();
      }

      if (hasContradiction) continue;

      if (depth == NUM_CELLS) {
        // We've set all the values, and we haven't found a contradiction.
        // This is a solution!
        counters.solutions++;
        yield {
          grid: grid,
          isSolution: true,
          stack: stack,
          hasContradiction: false,
        };
        checkRunCounter();
        continue;
      }

      this._updateCellOrder(stack.subarray(depth), grid);
      counters.cellsSearched++;
      depth++;
    }

    this.done = true;
  }

  solveAllPossibilities(valuesInSolutions) {
    // TODO: Do all forced reductions first to avoid having to do them for
    // each iteration.

    // Search for solutions.
    // Keep searching until we we see a redudant solution:
    //  - We want to avoid searching for all solutions, as there might be so
    //    many that it is intractable (e.g. empty grid).
    //  - On the other-hand, we don't want to abort too early and lose all the
    //    state/knowledge gained from the current search.
    const search = () => {
      for (const solution of this.run()) {
        const grid = solution.grid;
        if (grid.every((c, i) => valuesInSolutions[i] & c)) {
          return false;
        }
        grid.forEach((c, i) => { valuesInSolutions[i] |= c; });
      }
      return true;
    };

    const foundAllSolutions = search();

    // If the initial search found all the solutions, then we are done.
    if (foundAllSolutions) return;

    this._resetStack();
    for (let i = 0; i < NUM_CELLS; i++) {
      for (let v = 1; v < ALL_VALUES; v <<= 1) {
        // We already know this is a value is in a solution.
        if (valuesInSolutions[i] & v) continue;
        // This is NOT a a valid value.
        if (!(this._grids[0][i] & v)) continue;

        // Fix the current value and attempt to solve.
        this._grids[0][i] = v;
        search();
        this._resetStack();
      }
    }
  }

  setProgressCallback(callback, frequency) {
    this._progress.callback = callback;
    this._progress.frequency = frequency;
  }
}

SudokuSolver.CellAccumulator = class {
  constructor(solver) {
    this._handlers = solver._cellConstraintHandlers;

    // We keep the invariant that:
    //   this._extraConstraints contains c <=> c.dirty == this._generation
    this._constraints = [];
    this._generation = ++this.constructor.dirtyGeneration;
  }

  static dirtyGeneration = 0;

  add(cell) {
    const handlers = this._handlers[cell];
    const numHandlers = handlers.length;
    for (let i = 0; i < numHandlers; i++) {
      const c = handlers[i];
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
  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
    this.cells = new Uint8Array(cells || []);
    // Dirty bit for determining if the constraint needs to be enforced.
    this.dirty = 0;
  }

  enforceConsistency(grid) {
    return true;
  }

  conflictSet() {
    return [];
  }

  initialize(initialGrid, cellConflicts) {
    return;
  }
}

SudokuSolver.FixedCellsHandler = class extends SudokuSolver.ConstraintHandler{
  constructor(valueMap) {
    super();
    this._valueMap = valueMap;
  }

  enforceConsistency(grid) {
    for (const [cell, value] of this._valueMap) {
      grid[cell] = 1 << (value-1);
    }
  }

  initialize(initialGrid) {
    this.enforceConsistency(initialGrid);
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
    for (let i = 0; i < GRID_SIZE; i++) {
      let v = grid[this.cells[i]];
      uniqueValues &= ~v;
      uniqueValues |= (v&~allValues);
      allValues |= v;
    }
    if (allValues != ALL_VALUES) return false;
    // NOTE: This is only useful if everywhere else aborts when a domain wipeout
    // if found.
    // i.e. If all values are unique values, and there are no cells with no
    // values, then this constraint must be satisfied.
    if (uniqueValues == ALL_VALUES) return true;

    if (uniqueValues) {
      // We have hidden singles. Find and constrain them.
      for (let i = 0; i < GRID_SIZE; i++) {
        let cell = this.cells[i];
        let value = grid[cell] & uniqueValues;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value&(value-1)) return false;
          grid[cell] = value;
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

class SumHandlerUtil {
  static cellsAllConflict(cells, cellConflicts) {
    let conflicts = cellConflicts[cells[0]];
    for (let i = 1; i < cells.length; i++) {
      if (!conflicts.includes(cells[i])) {
        return false;
      }
    }
    return true;
  }

  static restrictValueRange(grid, cells, sumMinusMin, maxMinusSum) {
    // Remove any values which aren't possible because they would cause the sum
    // to be too high.
    for (let i = 0; i < cells.length; i++) {
      let value = grid[cells[i]];
      // If there is a single value, then the range is always fine.
      if (!(value&(value-1))) continue;

      let cellMin = LookupTable.MIN[value];
      let cellMax = LookupTable.MAX[value];
      let range = cellMax - cellMin;

      if (sumMinusMin < range) {
        let x = sumMinusMin + cellMin;
        // Remove any values GREATER than x. Even if all other squares
        // take their minimum values, these are too big.
        if (!(value &= ((1<<x)-1))) return false;
        grid[cells[i]] = value;
      }

      if (maxMinusSum < range) {
        // Remove any values LESS than x. Even if all other squares
        // take their maximum values, these are too small.
        let x = cellMax - maxMinusSum;
        if (!(value &= -(1<<(x-1)))) return false;
        grid[cells[i]] = value;
      }
    }

    return true;
  }

  // Restricts cell values to those sets which could make one of the provided
  // sums.
  // Returns 0 if no sums are possible, otherwise a bitwise OR of 1<<(sum-1).
  static restrictCellsUnique(grid, sums, cells) {
    const numCells = cells.length;

    // Check that we can make the current sum with the unfixed values remaining.
    let fixedValues = 0;
    let allValues = 0;
    let uniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      let value = grid[cells[i]];
      uniqueValues &= ~value;
      uniqueValues |= (value&~allValues);
      allValues |= value;
      if (!(value&(value-1))) fixedValues |= value;
    }
    // Check if we have enough unique values.
    if (LookupTable.COUNT[allValues] < numCells) return 0;
    // Check if we have fixed all the values.
    if (allValues == fixedValues) {
      let sum = LookupTable.SUM[fixedValues];
      if (sums.length == 1 && sum != sums[0]) return 0;
      return 1<<(sum-1);
    }

    let unfixedValues = allValues & ~fixedValues;
    let requiredUniques = uniqueValues;
    let possibilities = 0;
    let numUnfixed = cells.length - LookupTable.COUNT[fixedValues];
    let unfixedCageSums = SumHandlerUtil.KILLER_CAGE_SUMS[numUnfixed];

    let sumValue = 0;
    for (let i = 0; i < sums.length; i++) {
      let sum = sums[i];

      let sumOptions = unfixedCageSums[sum - LookupTable.SUM[fixedValues]];
      if (!sumOptions) continue;

      let isPossible = false;
      for (let j = 0; j < sumOptions.length; j++) {
        let option = sumOptions[j];
        if ((option & unfixedValues) === option) {
          possibilities |= option;
          requiredUniques &= option;
          isPossible = true;
        }
      }
      if (isPossible) sumValue |= 1<<(sum-1);
    }

    if (!possibilities) return 0;

    // Remove any values that aren't part of any solution.
    let valuesToRemove = unfixedValues & ~possibilities;
    if (valuesToRemove) {
      for (let i = 0; i < numCells; i++) {
        // Safe to apply to every cell, since we know that none of the
        // fixedValues are in unfixedValues.
        if (!(grid[cells[i]] &= ~valuesToRemove)) return 0;
      }
    }

    // requiredUniques are values that appear in all possible solutions AND
    // are unique. Thus, we can enforce these values.
    // NOTE: This is the same as the NonetHandler uniqueness check.
    if (requiredUniques) {
      for (let i = 0; i < numCells; i++) {
        let value = grid[cells[i]] & requiredUniques;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value&(value-1)) return 0;
          grid[cells[i]] = value;
        }
      }
    }

    return sumValue;
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

SudokuSolver.ArrowHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells) {
    super(cells);
    [this._sumCell, ...this._arrowCells] = cells;
    this._arrowCellsConflict = false;  // Are the values in the arrow unique.
  }

  initialize(initialGrid, cellConflicts) {
    this._arrowCellsConflict = SumHandlerUtil.cellsAllConflict(
      this._arrowCells, cellConflicts);

    this.enforceConsistency(initialGrid);
  }

  enforceConsistency(grid) {
    const arrowCells = this._arrowCells;
    const numCells = arrowCells.length;

    //  Determine sumMin and sumMax based on arrow.
    let sumMin = 0;
    let sumMax = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[arrowCells[i]];
      sumMin += LookupTable.MIN[v];
      sumMax += LookupTable.MAX[v];
    }

    // Constraint sumCell.
    let sums = grid[this._sumCell];
    // Remove any values GREATER than sumMax.
    if (sumMax < GRID_SIZE && !(sums &= ((1<<sumMax)-1))) return false;
    // Remove any values LESS than sumMin.
    if (sumMin > GRID_SIZE || !(sums &= -(1<<(sumMin-1)))) return false;
    grid[this._sumCell] = sums;

    // We've reached the exact sum.
    if (sumMin == sumMax) return true;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    let sumMinusMin = LookupTable.MAX[sums] - sumMin;
    let maxMinusSum = -LookupTable.MIN[sums] + sumMax;

    if (!SumHandlerUtil.restrictValueRange(grid, this._arrowCells,
                                           sumMinusMin, maxMinusSum)) {
      return false;
    }

    if (this._arrowCellsConflict) {
      // Create a list of all the sums.
      let sumList = [];
      while (sums) {
        let sumValue = sums & -sums;
        sums &= ~sumValue;
        sumList.push(LookupTable.VALUE[sumValue]);
      }

      // Restrict the sum and arrow cells values.
      grid[this._sumCell] &= SumHandlerUtil.restrictCellsUnique(
        grid, sumList, this._arrowCells);
      if (grid[this._sumCell] === 0) return false;
    }

    return true;
  }
}

SudokuSolver.SumHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._sumList = [+sum];
    this._cellsAllConflict = false;  // Are the values in the arrow unique.
  }

  initialize(initialGrid, cellConflicts) {
    this._cellsAllConflict = SumHandlerUtil.cellsAllConflict(
      this.cells, cellConflicts);

    this.enforceConsistency(initialGrid);
  }


  enforceConsistency(grid) {
    const cells = this.cells;
    const numCells = cells.length;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    let sumMinusMin = this._sum;
    let maxMinusSum = -this._sum;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      let min = LookupTable.MIN[v];
      let max = LookupTable.MAX[v];
      sumMinusMin -= min;
      maxMinusSum += max;
    }

    // It is impossible to make the target sum.
    if (sumMinusMin < 0 || maxMinusSum < 0) return false;
    // We've reached the target sum exactly.
    if (sumMinusMin == 0 && maxMinusSum == 0) return true;

    if (sumMinusMin < GRID_SIZE || maxMinusSum < GRID_SIZE) {
      if (!SumHandlerUtil.restrictValueRange(grid, cells,
                                             sumMinusMin, maxMinusSum)) {
        return false;
      }
    }

    if (this._cellsAllConflict) {
      // TODO: Try to do this if just the remaining cells conflict.
      return 0 !== SumHandlerUtil.restrictCellsUnique(grid, this._sumList, this.cells);
    }

    return true;
  }
}

SudokuSolver.CageHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._sumList = [+sum];
  }

  enforceConsistency(grid) {
    const cells = this.cells;
    const numCells = cells.length;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    let sumMinusMin = this._sum;
    let maxMinusSum = -this._sum;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      let min = LookupTable.MIN[v];
      let max = LookupTable.MAX[v];
      sumMinusMin -= min;
      maxMinusSum += max;
    }

    // It is impossible to make the target sum.
    if (sumMinusMin < 0 || maxMinusSum < 0) return false;
    // We've reached the target sum exactly.
    if (sumMinusMin == 0 && maxMinusSum == 0) return true;

    if (sumMinusMin < GRID_SIZE || maxMinusSum < GRID_SIZE) {
      if (!SumHandlerUtil.restrictValueRange(grid, cells,
                                             sumMinusMin, maxMinusSum)) {
        return false;
      }
    }

    return 0 !== SumHandlerUtil.restrictCellsUnique(grid, this._sumList, this.cells);
  }

  conflictSet() {
    return this.cells;
  }
}
