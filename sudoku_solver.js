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

  // Combines min and max into a single integer:
  // Layout: [min: 7 bits, range: 7 bits]
  //
  // The extra bits allow these values to be summed to determine the total
  // of mins and maxs.
  static MIN_MAX = (() => {
    // Initialize the table with MAXs.
    const table = new Uint16Array(COMBINATIONS);
    table[1] = LookupTable.VALUE[1];
    for (let i = 2; i < COMBINATIONS; i++) {
      // MAX is greater than the max when everything has been decreased by
      // 1.
      table[i] = 1 + table[i >> 1];
    }

    // Add the MINs.
    for (let i = 1; i < COMBINATIONS; i++) {
      // MIN is the value of the last bit set.
      const min = LookupTable.VALUE[i & -i];
      table[i] |= min<<7;
    }

    return table;
  })();

  // Combines useful info about the range of numbers in a cell.
  // Designed to be summed, so that the aggregate stats can be found.
  // Layout: [isFixed: 7 bits, fixed: 7 bits, min: 7 bits, range: 7 bits]
  //
  // Sum of isFixed gives the number of fixed cells.
  // Sum of fixed gives the sum of fixed cells.
  // Min and max as a in Lookup.MIN_MAX.
  static RANGE_INFO = (() => {
    const table = new Uint32Array(COMBINATIONS);
    for (let i = 1; i < COMBINATIONS; i++) {
      const minMax = this.MIN_MAX[i];
      const fixed = this.VALUE[i];
      const isFixed = fixed > 0 ? 1 : 0;
      table[i] = (isFixed<<21)|(fixed<<14)|minMax;
    }
    // If there are no values, set a high value for isFixed to indicate the
    // result is invalid. This is intended to be detectable after summing.
    table[0] = GRID_SIZE << 21;
    return table;
  })();

  static REVERSE = (() => {
    let table = new Uint16Array(COMBINATIONS);
    for (let i = 0; i < COMBINATIONS; i++) {
      let rev = 0;
      for (let j = 0; j < GRID_SIZE; j++) {
        rev |= ((i>>j)&1)<<(GRID_SIZE-1-j);
      }
      table[i] = rev;
    }
    return table;
  })();

  static _binaryFunctionCache = new Map();
  static _binaryFunctionKey(fn) {
    let keyParts = [];
    for (let i = 1; i <= GRID_SIZE; i++) {
      let part = 0;
      for (let j = 1; j <= GRID_SIZE; j++) {
        part |= fn(i, j) << j;
      }
      keyParts.push(part);
    }
    return keyParts.join(',');
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

  setProgressCallback(callback, logFrequency) {
    this._progressCallback = callback;
    this._internalSolver.setProgressCallback(
      this._sendProgress.bind(this),
      logFrequency);
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

SudokuSolver.ConstraintOptimizer = class {
  static _NONET_SUM = GRID_SIZE*(GRID_SIZE+1)/2;

  static optimize(handlers, cellConflictSets) {
    handlers = this._addNonetHandlers(handlers);

    handlers = this._findHiddenCages(handlers);

    handlers = this._sizeSpecificSumHandlers(handlers, cellConflictSets);

    return handlers;
  }

  // Add nonet handlers for any AllDifferentHandler which have 9 cells.
  static _addNonetHandlers(handlers) {
    for (const h of handlers) {
      if (h instanceof SudokuSolver.AllDifferentHandler) {
        const c = h.conflictSet();
        if (c.length == GRID_SIZE) {
          handlers.push(new SudokuSolver.NonetHandler(c));
        }
      }
    }

    return handlers;
  }

  // Find 2-cell constraints and replace them with binary constraints.
  // Only handles sums at the moment.
  static _sizeSpecificSumHandlers(handlers, cellConflictSets) {
    for (let i = 0; i < handlers.length; i++) {
      const h = handlers[i];
      if (!(h instanceof SudokuSolver.SumHandler)) continue;

      switch (h.cells.length) {
        case 1:
          handlers[i] = new SudokuSolver.FixedCellsHandler(
            new Map([[h.cells[0], h.sum()]]));
          break;

        case 2:
          const hasConflict = cellConflictSets[h.cells[0]].has(h.cells[1]);
          handlers[i] = new SudokuSolver.BinaryConstraintHandler(
            h.cells[0], h.cells[1],
            (a, b) => a+b == h.sum() && (!hasConflict || a != b));
          break;

        case 3:
          handlers[i] = new SudokuSolver.ThreeCellSumHandler(h.cells, h.sum());
          break;
      }
    }

    return handlers;
  }

  // Find sets of cells which we can infer have a known sum and unique values.
  static _findHiddenCages(handlers) {
    // TODO: Consider how this interactions with fixed cells.
    const sumHandlers = handlers.filter(h => h instanceof SudokuSolver.SumHandler);
    if (sumHandlers.length == 0) return handlers;

    const nonetHandlers = handlers.filter(h => h instanceof SudokuSolver.NonetHandler);

    // For now assume that sum constraints don't overlap.
    const cellMap = new Array(NUM_CELLS);
    for (const h of sumHandlers) {
      for (const c of h.cells) {
        cellMap[c] = h;
      }
    }

    for (const h of nonetHandlers) {
      const constraintMap = new Map();
      // Map from constraints to cell.
      for (const c of h.cells) {
        const k = cellMap[c];
        if (k) {
          if (constraintMap.has(k)) {
            constraintMap.get(k).push(c);
          } else {
            constraintMap.set(k, [c])
          }
        }
      }
      if (!constraintMap.size) continue;

      // Find contraints which have cells entirely within this nonet.
      const constrainedCells = [];
      let constrainedSum = 0;
      for (const [k, cells] of constraintMap) {
        if (k.cells.length == cells.length) {
          constrainedCells.push(...cells);
          constrainedSum += k.sum();
        }
      }

      // No constraints within this nonet.
      if (constrainedCells.length == 0) continue;
      // The remaining 8-cell will already be constrained after the first
      // pass.
      if (constrainedCells.length == 1) continue;
      // Nothing left to constrain.
      if (constrainedCells.length == GRID_SIZE) continue;

      const complementCells = setDifference(h.cells, constrainedCells);
      const complementSum = this._NONET_SUM - constrainedSum;
      handlers.push(new SudokuSolver.SumHandler(
        complementCells, complementSum));
    }

    return handlers;
  }
}

const SOLVER_INITIALIZE_AT_START = true;

SudokuSolver.InternalSolver = class {

  constructor(handlerGen) {
    this._initCellArray();
    this._stack = new Uint8Array(NUM_CELLS);

    this._runCounter = 0;
    this._progress = {
      frequencyMask: -1,
      callback: null,
    };

    this._handlers = this._setUpHandlers(Array.from(handlerGen));

    // Priorities go from 0->255, with 255 being the best.
    // This can be used to prioritize which cells to search.
    this._cellPriorities = this._initCellPriorities();

    this.reset();
  }

  _initCellPriorities() {
    let priorities = new Uint8Array(NUM_CELLS);

    for (const handler of this._handlers) {
      // The most constrainted cells have the best priorities.
      // For now just look at the most restricted constraint the cell is part
      // of.
      for (const cell of handler.cells) {
        priorities[cell] = Math.min(
          priorities[cell], GRID_SIZE-handler.cells.length);
      }
    }

    return priorities;
  }

  static _findCellConflicts(handlers) {
    const cellConflictSets = new Array(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) cellConflictSets[i] = new Set();

    for (const h of handlers) {
      const conflictSet = h.conflictSet();
      for (const c of conflictSet) {
        for (const d of conflictSet) {
          if (c != d) cellConflictSets[c].add(d);
        }
      }
    }

    return cellConflictSets;
  }

  _setUpHandlers(handlers) {
    const cellConflictSets = this.constructor._findCellConflicts(handlers);

    // Set cell conflicts so that they are unique.
    // Sort them, so they are in a predictable order.
    this._cellConflicts = cellConflictSets.map(c => new Uint8Array(c));
    this._cellConflicts.forEach(c => c.sort((a, b) => a-b));

    // Optimize handlers.
    handlers = SudokuSolver.ConstraintOptimizer.optimize(
      handlers, cellConflictSets);;

    // Add all cells that the handler claims to be attached to the list of
    // handlers for that cell.
    this._cellConstraintHandlers = new Array(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) {
      this._cellConstraintHandlers[i] = [];
    }
    for (const handler of handlers) {
      for (const cell of handler.cells) {
        this._cellConstraintHandlers[cell].push(handler);
      }
    }

    // TODO: Include as part of the solver for timing?
    for (const handler of handlers) {
      handler.initialize(this._initialGrid, cellConflictSets);
    }

    return handlers;
  }

  reset() {
    this._iter = null;
    this.counters = {
      valuesTried: 0,
      cellsSearched: 0,
      backtracks: 0,
      guesses: 0,
      solutions: 0,
      constraintsProcessed: 0,
    };

    // _backtrackTriggers counts the the number of times a cell is responsible
    // for finding a contradition and causing a backtrack.
    // Cells with a high count are the best candidates for searching as we
    // may find the contradition faster. Ideally, this allows the search to
    // learn the critical areas of the grid where it is more valuable to search
    // first.
    // _backtrackTriggers are exponentially decayed so that the search can
    // learn new parts of the search space effectively.
    this._backtrackTriggers = Array.from(this._cellPriorities);

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
    // Choose the cell with the smallest count.
    // Return immediately if we find any cells with 1 or 0 values set.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts (0 values), so we should never find them here. Even if they
    // exist, it just means we do a few more useless forced cell resolutions.
    // NOTE: If the scoring is more complicated than counts, it can be useful
    // to do an initial pass to detect 1 or 0 value cells (~(v&(v-1))).

    // Find the cell with the minimum score (remaining possibilities in the
    // cell).
    // Break ties with the hit count.
    let minScore = GRID_SIZE + 1;
    let maxTriggerCount = 0;

    for (let i = 0; i < stack.length; i++) {
      const cell = stack[i];
      const count = LookupTable.COUNT[grid[cell]];
      // If we have a single value then just use it - as it will involve no
      // guessing.
      if (count <= 1) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        return;
      }

      const triggerCount = this._backtrackTriggers[cell];
      if (count < minScore || count == minScore && triggerCount > maxTriggerCount ) {
        [stack[i], stack[0]] = [stack[0], stack[i]];
        minScore = count;
        maxTriggerCount = triggerCount;
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

    const progressFrequencyMask = this._progress.frequencyMask;

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
      if (hasContradiction) {
        counters.backtracks++;
        // Exponentially decay the counts.
        if (counters.backtracks % (NUM_CELLS*NUM_CELLS) == 0) {
          for (let i = 0; i < NUM_CELLS; i++) {
            this._backtrackTriggers[i]>>=1;
          }
        }
        this._backtrackTriggers[cell]++;
      }

      if ((counters.valuesTried & progressFrequencyMask) === 0) {
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

  setProgressCallback(callback, logFrequency) {
    this._progress.callback = callback;
    this._progress.frequencyMask = -1;
    if (callback) {
      this._progress.frequencyMask = (1<<logFrequency)-1;
    }
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

  initialize(initialGrid) {
    for (const [cell, value] of this._valueMap) {
      initialGrid[cell] = 1 << (value-1);
    }
  }
}

SudokuSolver.AllDifferentHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(conflictCells) {
    super();
    conflictCells.sort((a, b) => a - b);
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
    const cells = this.cells;

    let allValues = 0;
    let uniqueValues = 0;
    let fixedValues = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      let v = grid[cells[i]];
      uniqueValues &= ~v;
      uniqueValues |= (v&~allValues);
      allValues |= v;
      if (!(v&(v-1))) fixedValues |= v;
    }
    if (allValues != ALL_VALUES) return false;
    if (fixedValues == ALL_VALUES) return true;

    uniqueValues &= ~fixedValues;
    if (uniqueValues) {
      // We have hidden singles. Find and constrain them.
      for (let i = 0; i < GRID_SIZE; i++) {
        let cell = cells[i];
        let value = grid[cell] & uniqueValues;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value&(value-1)) return false;
          grid[cell] = value;
          if (!(uniqueValues &= ~value)) break;
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
    return (
      (grid[this.cells[0]] &= this._tables[1][grid[this.cells[1]]]) &&
      (grid[this.cells[1]] &= this._tables[0][grid[this.cells[0]]]))
  }
}

class SumHandlerUtil {

  static findConflictSets(cells, cellConflicts) {
    let currentSet = [];
    let conflictSets = [currentSet];

    for (const cell of cells) {
      // Determine if this cell is in a conflict set with every cell in the
      // current set. Otherwise start a new set.
      for (const conflictCell of currentSet) {
        if (!cellConflicts[cell].has(conflictCell)) {
          currentSet = [];
          conflictSets.push(currentSet);
          break;
        }
      }
      currentSet.push(cell);
    }

    return conflictSets;
  }

  static restrictValueRange(grid, cells, sumMinusMin, maxMinusSum) {
    // Remove any values which aren't possible because they would cause the sum
    // to be too high.
    for (let i = 0; i < cells.length; i++) {
      let value = grid[cells[i]];
      // If there is a single value, then the range is always fine.
      if (!(value&(value-1))) continue;

      const minMax = LookupTable.MIN_MAX[value];
      const cellMin = minMax >> 7;
      const cellMax = minMax & 0x7f;
      const range = cellMax-cellMin;

      if (sumMinusMin < range) {
        const x = sumMinusMin + cellMin;
        // Remove any values GREATER than x. Even if all other squares
        // take their minimum values, these are too big.
        if (!(value &= ((1<<x)-1))) return false;
        grid[cells[i]] = value;
      }

      if (maxMinusSum < range) {
        // Remove any values LESS than x. Even if all other squares
        // take their maximum values, these are too small.
        const x = cellMax - maxMinusSum;
        if (!(value &= -(1<<(x-1)))) return false;
        grid[cells[i]] = value;
      }
    }

    return true;
  }

  // Restricts cell values to only combinations which could make one of the
  // provided sums. Assumes cells are all in the same conflict set.
  // Returns a mask for the valid sum values (thus 0 if none are possible).
  static restrictCellsSingleConflictSet(grid, targetSums, cells) {
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
    const fixedSum = LookupTable.SUM[fixedValues];

    // Check if we have enough unique values.
    if (LookupTable.COUNT[allValues] < numCells) return 0;
    // Check if we have fixed all the values.
    if (allValues == fixedValues) {
      if (targetSums.length == 1 && fixedSum != targetSums[0]) return 0;
      return 1<<(fixedSum-1);
    }

    const unfixedValues = allValues & ~fixedValues;
    let requiredUniques = uniqueValues;
    const numUnfixed = cells.length - LookupTable.COUNT[fixedValues];

    // For each possible targetSum, find the possible cell value settings.
    let possibilities = 0;
    const unfixedCageSums = SumHandlerUtil.KILLER_CAGE_SUMS[numUnfixed];
    let sumValue = 0;
    for (let i = 0; i < targetSums.length; i++) {
      let sum = targetSums[i];

      const sumOptions = unfixedCageSums[sum - fixedSum];
      if (!sumOptions) continue;

      let isPossible = false;
      for (let j = 0; j < sumOptions.length; j++) {
        const option = sumOptions[j];
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
    const valuesToRemove = unfixedValues & ~possibilities;
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

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMins = new Uint16Array(GRID_SIZE);
  static _seenMaxs = new Uint16Array(GRID_SIZE);

  // Restricts cell values to only the ranges that are possible taking into
  // account uniqueness constraints between values.
  // Returns a mask for the valid sum values (thus 0 if none are possible).
  static restrictCellsMultiConflictSet(
        grid, minTargetSum, maxTargetSum, cells, conflictSets) {
    const numSets = conflictSets.length;

    // Find a set of miniumum and maximum unique values which can be set,
    // taking into account uniqueness within constraint sets.
    // From this determine the minimum and maximum possible sums.

    let seenMins = this._seenMins;
    let seenMaxs = this._seenMaxs;
    let strictMin = 0;
    let strictMax = 0;

    for (let s = 0; s < numSets; s++) {
      let set = conflictSets[s];
      let seenMin = 0;
      let seenMax = 0;

      for (let i = 0; i < set.length; i++) {
        const minMax = LookupTable.MIN_MAX[grid[set[i]]];
        const min = minMax>>7;
        const max = minMax&0x7f;

        const minShift = min-1;
        const maxShift = GRID_SIZE - max;

        // Set the smallest unset value >= min.
        // i.e. Try to add min to seenMin, but it if already exists then find
        // the next smallest value.
        let x = ~(seenMin >> minShift);
        seenMin |= (x & -x) << minShift;
        // Set the largest unset value <= max.
        x = ~(seenMax >> maxShift);
        seenMax |= (x & -x) << maxShift;
      }

      if (seenMin > ALL_VALUES || seenMax > ALL_VALUES) return 0;

      seenMax = LookupTable.REVERSE[seenMax];
      strictMin += LookupTable.SUM[seenMin];
      strictMax += LookupTable.SUM[seenMax];

      seenMins[s] = seenMin;
      seenMaxs[s] = seenMax;
    }

    // Calculate degrees of freedom in the cell values.
    // i.e. How much leaway is there from the min and max value of each cell.
    let minDof = maxTargetSum - strictMin;
    let maxDof = strictMax - minTargetSum;
    if (minDof < 0 || maxDof < 0) return 0;
    if (minDof >= GRID_SIZE-1 && maxDof >= GRID_SIZE-1) return -1;

    // Restrict values based on the degrees of freedom.
    for (let s = 0; s < numSets; s++) {
      let seenMin = seenMins[s];
      let seenMax = seenMaxs[s];
      // If min and max are the same, then the values can't be constrained
      // anymore (and a positive dof guarentees that they are ok).
      if (seenMin == seenMax) continue;

      let valueMask = -1;

      if (minDof < GRID_SIZE-1) {
        for (let j = minDof; j--;) seenMin |= seenMin<<1;
        valueMask = seenMin;
      }

      if (maxDof < GRID_SIZE-1) {
        for (let j = maxDof; j--;) seenMax |= seenMax>>1;
        valueMask &= seenMax;
      }

      // If the value mask could potentially remove some values, then apply
      // the mask to the valeus in the set.
      if (~valueMask & ALL_VALUES) {
        let set = conflictSets[s];
        for (let i = 0; i < set.length; i++) {
          if (!(grid[set[i]] &= valueMask)) {
            return 0;
          }
        }
      }
    }

    // If we have a range of sums, then restrict the sum based on the degrees
    // of freedom.
    if (minTargetSum != maxTargetSum) {
      let sumMask = ALL_VALUES;
      if (minTargetSum > maxDof) {
        sumMask = ALL_VALUES << (minTargetSum-1-maxDof);
      }
      if (GRID_SIZE > maxTargetSum+minDof) {
        sumMask &= ALL_VALUES >> (GRID_SIZE-(maxTargetSum+minDof));
      }
      return sumMask;
    }

    // Return a permissive mask, since if there is there is only one target
    // sum then restricting it is moot. If the sum was invalid, this function
    // would already have returned 0.
    return -1;
  }

  static enforceThreeCellConsistency(grid, cells, sum, conflictMap) {
    let v0 = grid[cells[0]];
    let v1 = grid[cells[1]];
    let v2 = grid[cells[2]];

    // Find each set of pairwise sums.
    let sums2 = this._PAIRWISE_SUMS[(v0<<GRID_SIZE)|v1]<<2;
    let sums1 = this._PAIRWISE_SUMS[(v0<<GRID_SIZE)|v2]<<2;
    let sums0 = this._PAIRWISE_SUMS[(v1<<GRID_SIZE)|v2]<<2;

    // If the cell values are possibly repeated, then handle that.
    if (conflictMap !== null) {
      if (conflictMap[0] != conflictMap[1]) {
        sums2 |= this._DOUBLES[v0&v1];
      }
      if (conflictMap[0] != conflictMap[2]) {
        sums1 |= this._DOUBLES[v0&v2];
      }
      if (conflictMap[1] != conflictMap[2]) {
        sums0 |= this._DOUBLES[v1&v2];
      }
    }

    // Constrain each value based on the possible sums of the other two.
    // NOTE: We don't care if a value is reused in the result, as that will
    // be removed in one of the other two cases.
    const shift = sum-1;
    v2 &= LookupTable.REVERSE[((sums2 << GRID_SIZE)>>shift) & ALL_VALUES];
    v1 &= LookupTable.REVERSE[((sums1 << GRID_SIZE)>>shift) & ALL_VALUES];
    v0 &= LookupTable.REVERSE[((sums0 << GRID_SIZE)>>shift) & ALL_VALUES];

    if (!(v1 && v1 && v2)) return false;

    grid[cells[0]] = v0;
    grid[cells[1]] = v1;
    grid[cells[2]] = v2;

    return true;
  }

  // Precompute the sums for all pairs of cells. Assumes cells must be unique.
  //
  // For cell values a and b:
  // _PAIRWISE_SUMS[(a<<GRID_SIZE)|b] = sum>>2;
  // (The shift is so the result fits in 16 bits).
  static _PAIRWISE_SUMS = (() => {
    const table = new Uint16Array(COMBINATIONS*COMBINATIONS);

    for (let i = 0; i < COMBINATIONS; i++) {
      for (let j = i; j < COMBINATIONS; j++) {
        let result = 0;
        for (let k = 1; k <= GRID_SIZE; k++) {
          // Check if j contains k.
          const kInJ = (j>>(k-1))&1;
          if (kInJ) {
            // Add k to all values in i.
            let s = i<<k;
            // Remove 2*k, as we require the values to be unique.
            s &= ~(1<<(2*k-1));
            // Store s-2, so we don't overrun 16 bits.
            // (Note, we have an extra one from the sum already).
            s >>= 2;
            result |= s;
          }
        }
        table[(i<<GRID_SIZE)|j] = table[(j<<GRID_SIZE)|i] = result;
      }
    }

    return table;
  })();

  // Store the sum of a+a for all combinations of a.
  static _DOUBLES = (() => {
    const table = new Uint32Array(COMBINATIONS);

    for (let j = 0; j < COMBINATIONS; j++) {
      let result = 0;
      for (let k = 1; k <= GRID_SIZE; k++) {
        // Check if j contains k.
        const kInJ = (j>>(k-1))&1;
        if (kInJ) {
          const s = 1<<(2*k-1);
          result |= s;
        }
      }
      table[j] = result;
    }
    return table;
  })();

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
    this._conflictSets = null;
  }

  initialize(initialGrid, cellConflicts) {
    this._conflictSets = SumHandlerUtil.findConflictSets(
      this._arrowCells, cellConflicts);
  }

  enforceConsistency(grid) {
    const arrowCells = this._arrowCells;
    const numCells = arrowCells.length;

    //  Determine sumMin and sumMax based on arrow.
    let minMaxSum = 0;
    for (let i = 0; i < numCells; i++) {
      minMaxSum += LookupTable.MIN_MAX[grid[arrowCells[i]]];
    }

    const sumMin = minMaxSum>>7;
    const sumMax = minMaxSum&0x7f;

    // Constraint sumCell.
    let sums = grid[this._sumCell];

    // Remove any values GREATER than sumMax.
    if (sumMax < GRID_SIZE && !(sums &= ((1<<sumMax)-1))) return false;
    // Remove any values LESS than sumMin.
    if (sumMin > GRID_SIZE || !(sums &= -(1<<(sumMin-1)))) return false;
    grid[this._sumCell] = sums;

    // We've reached the exact sum.
    if (sumMin == sumMax) return true;

    const minMaxTarget = LookupTable.MIN_MAX[sums];
    const minTarget = minMaxTarget>>7;
    const maxTarget = minMaxTarget&0x7f;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    const sumMinusMin = maxTarget - sumMin;
    const maxMinusSum = -minTarget + sumMax;

    if (!SumHandlerUtil.restrictValueRange(grid, this._arrowCells,
                                           sumMinusMin, maxMinusSum)) {
      return false;
    }

    if (this._conflictSets.length == 1) {
      // Create a list of all the sums.
      let sumList = [];
      while (sums) {
        let sumValue = sums & -sums;
        sums &= ~sumValue;
        sumList.push(LookupTable.VALUE[sumValue]);
      }

      // Restrict the sum and arrow cells values.
      grid[this._sumCell] &= SumHandlerUtil.restrictCellsSingleConflictSet(
        grid, sumList, this._arrowCells);
    } else {
      grid[this._sumCell] &= SumHandlerUtil.restrictCellsMultiConflictSet(
        grid, minTarget, maxTarget, this._arrowCells,
        this._conflictSets);
    }
    if (grid[this._sumCell] === 0) return false;

    return true;
  }
}

// Solve 3-cell sums exactly with a 512 KB lookup table.
SudokuSolver.ThreeCellSumHandler = class extends SudokuSolver.ConstraintHandler {
  _sum = 0;
  _conflictMap = null;

  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
  }

  initialize(initialGrid, cellConflicts) {
    const conflictSets = SumHandlerUtil.findConflictSets(
      this.cells, cellConflicts);
    if (conflictSets.length > 1) {
      this._conflictMap = new Uint8Array(this.cells.length);

      conflictSets.forEach(
        (s,i) => s.forEach(
          c => this._conflictMap[this.cells.indexOf(c)] = i));
    }
  }

  enforceConsistency(grid) {
    return SumHandlerUtil.enforceThreeCellConsistency(
      grid, this.cells, this._sum, this._conflictMap);
  }

}

SudokuSolver.SumHandler = class extends SudokuSolver.ConstraintHandler {
  _conflictSets;
  _conflictMap;
  _sum;
  _sumList = [0];

  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._sumList[0] = this._sum;
  }

  sum() {
    return this._sum;
  }

  initialize(initialGrid, cellConflicts) {
    this._conflictSets = SumHandlerUtil.findConflictSets(
      this.cells, cellConflicts);

    this._conflictMap = new Uint8Array(this.cells.length);
    this._conflictSets.forEach(
      (s,i) => s.forEach(
        c => this._conflictMap[this.cells.indexOf(c)] = i));
  }

  static _valueBuffer = new Uint16Array(GRID_SIZE);
  static _conflictMapBuffer = new Uint8Array(GRID_SIZE);
  static _cellBuffer = new Uint8Array(GRID_SIZE);

  // Optimize the {1-3}-cell case by solving it exactly and efficiently.
  // REQUIRES that:
  //  - The number of unfixed cells is accurate.
  //  - None of the values are zero.
  _enforceFewRemainingCells(grid, targetSum, numUnfixed) {
    const cells = this.cells;

    const cellBuffer = this.constructor._cellBuffer;
    const valueBuffer = this.constructor._valueBuffer;
    const conflictMapBuffer = this.constructor._conflictMapBuffer;

    let j = 0;
    for (let i = cells.length-1; i >= 0; i--) {
      const c = cells[i];
      const v = grid[c];
      if (v&(v-1)) {
        conflictMapBuffer[j] = this._conflictMap[i];
        cellBuffer[j] = c;
        valueBuffer[j] = v;
        j++;
      }
    }

    switch (numUnfixed) {
      case 1: {
        // Set value to the target sum exactly.
        const v = valueBuffer[0] & (1<<(targetSum-1));
        return (grid[cellBuffer[0]] = v);
      }

      case 2: {
        let v0 = valueBuffer[0];
        let v1 = valueBuffer[1];

        // Remove any values which don't have their counterpart value to add to
        // targetSum.
        v1 &= (LookupTable.REVERSE[v0] << (targetSum-1)) >> GRID_SIZE;
        v0 &= (LookupTable.REVERSE[v1] << (targetSum-1)) >> GRID_SIZE;

        // If the cells are in the same conflict set, also ensure the sum is
        // distict values.
        if ((targetSum&1) == 0 &&
            conflictMapBuffer[0] === conflictMapBuffer[1]) {
          // targetSum/2 can't be valid value.
          const mask = ~(1 << ((targetSum>>1)-1));
          v0 &= mask;
          v1 &= mask;
        }

        if (!(v1 && v0)) return false;

        grid[cellBuffer[0]] = v0;
        grid[cellBuffer[1]] = v1;
        return true;
      }

      case 3: {
        return SumHandlerUtil.enforceThreeCellConsistency(
          grid, cellBuffer, targetSum,
          this._conflictSets.length == 1 ? null : conflictMapBuffer);
      }
    }
  }

  enforceConsistency(grid) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    let rangeInfoSum = 0;
    for (let i = 0; i < numCells; i++) {
      rangeInfoSum += LookupTable.RANGE_INFO[grid[cells[i]]];
    }

    const maxSum = rangeInfoSum & 0x7f;
    const minSum = (rangeInfoSum>>7) & 0x7f;
    // It is impossible to make the target sum.
    if (sum < minSum || maxSum < sum) return false;
    // We've reached the target sum exactly.
    // NOTE: Uniqueness constraint is already enforced by the solver via confictCells.
    if (minSum == maxSum) return true;

    const numUnfixed = numCells - (rangeInfoSum>>21);
    // A large fixed value indicates a cell has a 0, hence is already
    // unsatisfiable.
    if (numUnfixed < 0) return false;

    // If there are few remaining values then handle them explicitly.
    if (numUnfixed <= 3) {
      const fixedSum = (rangeInfoSum>>14) & 0x7f;
      const targetSum = sum - fixedSum;
      return this._enforceFewRemainingCells(grid, targetSum, numUnfixed);
    }

    if (sum - minSum < GRID_SIZE || maxSum - sum < GRID_SIZE) {
      if (!SumHandlerUtil.restrictValueRange(grid, cells,
                                             sum - minSum, maxSum - sum)) {
        return false;
      }
    }

    if (this._conflictSets.length == 1) {
      return (0 !== SumHandlerUtil.restrictCellsSingleConflictSet(
        grid, this._sumList, cells));
    } else {
      return (0 !== SumHandlerUtil.restrictCellsMultiConflictSet(
        grid, sum, sum, cells, this._conflictSets));
    }
  }
}

SudokuSolver.SandwichHandler = class extends SudokuSolver.ConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._distances = SudokuSolver.SandwichHandler._DISTANCE_RANGE[+sum];
    this._combinations = SudokuSolver.SandwichHandler._COMBINATIONS[+sum];
  }

  static _BORDER_MASK = 1 | (1 << (GRID_SIZE-1));
  static _MAX_SUM = 35;
  static _VALUE_MASK = ~this._BORDER_MASK & ALL_VALUES;

  // Possible combinations for values between the 1 and 9 for each possible sum.
  // Grouped by distance.
  static _COMBINATIONS = (() => {
    let table = [];
    const maxD = GRID_SIZE-1;
    for (let i = 0; i <= this._MAX_SUM; i++) {
      table[i] = new Array(maxD);
      for (let d = 0; d <= maxD; d++) table[i][d] = [];
    }

    for (let i = 0; i < COMBINATIONS; i++) {
      if (i & this._BORDER_MASK) continue;
      let sum = LookupTable.SUM[i];
      table[sum][LookupTable.COUNT[i]+1].push(i);
    }

    for (let i = 0; i <= this._MAX_SUM; i++) {
      for (let d = 0; d <= maxD; d++) {
        table[i][d] = new Uint16Array(table[i][d]);
      }
    }

    return table;
  })();

  // Distance range between the 1 and 9 for each possible sum.
  // Map combination to [min, max].
  static _DISTANCE_RANGE = (() => {
    let table = [];
    for (let i = 0; i <= this._MAX_SUM; i++) {
      let row = this._COMBINATIONS[i];

      let j = 0;
      while (j < row.length && !row[j].length) j++;
      let dMin = j;
      while (j < row.length && row[j].length) j++;
      let dMax = j-1;

      table.push([dMin, dMax]);
    }
    return table;
  })();

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _validSettings = new Uint16Array(GRID_SIZE);
  static _cellValues = new Uint16Array(GRID_SIZE);

  enforceConsistency(grid) {
    const cells = this.cells;
    const borderMask = SudokuSolver.SandwichHandler._BORDER_MASK;

    // Cache the grid values for faster lookup.
    let values = SudokuSolver.SandwichHandler._cellValues;
    let numBorders = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      let v = values[i] = grid[cells[i]];
      if (v & borderMask) numBorders++;
    }

    // If there are exactly two borders, then we know exactly which cells
    // form the sum. Perform a range check.
    // NOTE: This doesn't save any consistency checks, but does short-circuit
    // all the extra work below, so saves a small bit of time.
    if (numBorders < 2) return false;
    if (numBorders === 2) {
      let i = 0;
      let minMaxSum = 0;
      while (!(values[i++] & borderMask));
      while (!(values[i] & borderMask)) {
        minMaxSum += LookupTable.MIN_MAX[values[i]];
        i++;
      }

      const sum = this._sum;
      const minSum = minMaxSum>>7;
      const maxSum = minMaxSum&0x7f;
      // It is impossible to make the target sum.
      if (sum < minSum || maxSum < sum) return false;
      // We've reached the target sum exactly.
      if (minSum == maxSum) return true;
    }

    // Build up a set of valid cell values.
    let validSettings = SudokuSolver.SandwichHandler._validSettings;
    validSettings.fill(0);

    // Iterate over each possible starting index for the first 1 or 9.
    // Check if the other values are consistant with the required sum.
    // Given that the values must form a nonet, this is sufficient to ensure
    // that the constraint is fully satisfied.
    const valueMask = SudokuSolver.SandwichHandler._VALUE_MASK;
    const [minDist, maxDist] = this._distances;
    const maxIndex = GRID_SIZE - minDist;
    let prefixValues = 0;
    let pPrefix = 0;
    for (let i = 0; i < maxIndex; i++) {
      let v = values[i];
      // If we don't have a 1 or 9, move onto the next index.
      if (!(v &= borderMask)) continue;
      // Determine what the matching 1 or 9 value needs to be.
      const vRev = borderMask & ((v>>8) | (v<<8));

      // For each possible gap:
      //  - Determine the currently possible values inside the gap.
      //  - Find every valid combination that can be made from these values.
      //  - Use them to determine the possible inside and outside values.
      let innerValues = 0;
      let pInner = i+1;
      for (let j = i+minDist; j <= i+maxDist && j < GRID_SIZE; j++) {
        if (!(values[j] & vRev)) continue;

        while (pInner < j) innerValues |= values[pInner++];
        while (pPrefix < i) prefixValues |= values[pPrefix++];
        let outerValues = prefixValues;
        for (let k=pInner+1; k < GRID_SIZE; k++) outerValues |= values[k];

        let combinations = this._combinations[j-i];
        let innerPossibilities = 0;
        let outerPossibilities = 0;
        for (let k = 0; k < combinations.length; k++) {
          let c = combinations[k];
          // Check if the inner values can create the combination, and the
          // outer values can create the complement.
          if (!((~innerValues & c) | (~outerValues & ~c & valueMask))) {
            innerPossibilities |= c;
            outerPossibilities |= ~c;
          }
        }
        outerPossibilities &= valueMask;
        // If we have either innerPossibilities or outerPossibilities it means
        // we have at least one valid setting. Either maybe empty if there
        // are 0 cells in the inner or outer range.
        if (innerPossibilities || outerPossibilities) {
          let k = 0;
          while (k < i) validSettings[k++] |= outerPossibilities;
          validSettings[k++] |= v;
          while (k < j) validSettings[k++] |= innerPossibilities;
          validSettings[k++] |= vRev;
          while (k < GRID_SIZE) validSettings[k++] |= outerPossibilities;
        }
      }
    }

    for (let i = 0; i < GRID_SIZE; i++) {
      if (!(grid[cells[i]] &= validSettings[i])) return false;
    }

    return true;
  }
}
