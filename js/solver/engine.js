"use strict";

var EXPORT_CONFLICT_HEATMAP = false;

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

  validateLayout() {
    this._reset();

    let result = false;
    this._timer.runTimed(() => {
      result = this._internalSolver.validateLayout();
    });

    return result;
  }

  state() {
    const counters = {...this._internalSolver.counters};

    const state = {
      counters: counters,
      timeMs: this._timer.elapsedMs(),
      done: this._internalSolver.done,
    }

    if (EXPORT_CONFLICT_HEATMAP) {
      state.backtrackTriggers = this._internalSolver.getBacktrackTriggers();
    }

    return state;
  }

  _getIter(yieldEveryStep) {
    yieldEveryStep = !!yieldEveryStep;

    // If an iterator doesn't exist or is of the wrong type, then create it.
    if (!this._iter || this._iter.yieldEveryStep != yieldEveryStep) {
      this._iter = {
        yieldEveryStep: yieldEveryStep,
        iter: new IteratorWithCount(this._internalSolver.run(
          yieldEveryStep
          ? SudokuSolver.InternalSolver.YIELD_ON_STEP
          : SudokuSolver.InternalSolver.YIELD_ON_SOLUTION))
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

SudokuSolver.InternalSolver = class {

  constructor(handlerGen) {
    this._initCellArray();
    this._stack = new Uint8Array(NUM_CELLS);
    this._progressRatioStack = new Array(NUM_CELLS);
    this._progressRatioStack.fill(1);

    this._runCounter = 0;
    this._progress = {
      frequencyMask: -1,
      callback: null,
    };

    this._handlers = this._setUpHandlers(Array.from(handlerGen));

    this._cellAccumulator = new SudokuSolver.CellAccumulator(this._handlers);

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
    handlers = SudokuConstraintOptimizer.optimize(
      handlers, cellConflictSets);

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
      maxDepth: 0,
      progressRatio: 0,
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

  getBacktrackTriggers() {
    return this._backtrackTriggers.slice();
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
  _updateCellOrder(stack, depth, grid) {
    // Choose the cell with the smallest count.
    // Return immediately if we find any cells with 1 or 0 values set.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts (0 values), so we should never find them here. Even if they
    // exist, it just means we do a few more useless forced cell resolutions.
    // NOTE: If the scoring is more complicated than counts, it can be useful
    // to do an initial pass to detect 1 or 0 value cells (~(v&(v-1))).

    const triggerCounts = this._backtrackTriggers;
    const stackLen = stack.length;

    // Find the cell with the minimum score (remaining possibilities in the
    // cell).
    // Break ties with the hit count.
    let minScore = GRID_SIZE + 1;
    let maxTriggerCount = 0;
    let bestIndex = 0;

    for (let i = depth; i < stackLen; i++) {
      const cell = stack[i];
      const count = LookupTable.COUNT[grid[cell]];
      // If we have a single value then just use it - as it will involve no
      // guessing.
      if (count <= 1) {
        bestIndex = i;
        minScore = 1;
        break;
      }

      if (count < minScore || count == minScore && triggerCounts[cell] > maxTriggerCount ) {
        bestIndex = i;
        minScore = count;
        maxTriggerCount = triggerCounts[cell];
      }
    }

    [stack[bestIndex], stack[depth]] = [stack[depth], stack[bestIndex]];

    return minScore;
  }

  _enforceValue(grid, value, cell) {
    grid[cell] = value;

    let cellAccumulator = this._cellAccumulator;
    cellAccumulator.clear();
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

  static YIELD_ON_SOLUTION = 0;
  static YIELD_ON_STEP = 1;

  static _BACKTRACK_DECAY_INTERVAL = NUM_CELLS*NUM_CELLS;

  // run runs the solve.
  // yieldWhen can be:
  //  YIELD_ON_SOLUTION to yielding each solution.
  //  YIELD_ON_STEP to yield every step.
  //  n > 1 to yield every n contraditions.
  *run(yieldWhen) {
    const yieldEveryStep = yieldWhen === this.constructor.YIELD_ON_STEP;
    const yieldOnContradiction = yieldWhen > 1 ? yieldWhen : 0;

    // Set up iterator validation.
    if (!this._atStart) throw('State is not in initial state.');
    this._atStart = false;
    let runCounter = ++this._runCounter;
    const checkRunCounter = () => {
      if (runCounter != this._runCounter) throw('Iterator no longer valid');
    };

    let depth = 0;
    const stack = this._stack;
    const counters = this.counters;
    const progressRatioStack = this._progressRatioStack;

    {
      // Enforce constraints for all cells.
      let cellAccumulator = this._cellAccumulator;
      cellAccumulator.clear();
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

    {
      const count = this._updateCellOrder(stack, depth, this._grids[depth]);
      depth++;
      progressRatioStack[depth] = progressRatioStack[depth-1]/count;
      counters.cellsSearched++;
    }

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
        counters.progressRatio += progressRatioStack[depth];
        counters.backtracks++;
        // Exponentially decay the counts.
        if (0 === counters.backtracks % this.constructor._BACKTRACK_DECAY_INTERVAL) {
          for (let i = 0; i < NUM_CELLS; i++) {
            this._backtrackTriggers[i]>>=1;
          }
        }
        this._backtrackTriggers[cell]++;
        if (depth > counters.maxDepth) {
          counters.maxDepth = depth;
        }

        if (0 !== yieldOnContradiction &&
            0 === counters.backtracks % yieldOnContradiction) {
          yield {
            grid: grid,
            isSolution: false,
            stack: stack.subarray(0, depth),
            hasContradiction: hasContradiction,
          };
        }
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
        counters.progressRatio += progressRatioStack[depth];
        // We've set all the values, and we haven't found a contradiction.
        // This is a solution!
        counters.solutions++;
        counters.maxDepth = NUM_CELLS;
        yield {
          grid: grid,
          isSolution: true,
          stack: stack,
          hasContradiction: false,
        };
        checkRunCounter();
        continue;
      }

      {
        const count = this._updateCellOrder(stack, depth, grid);
        counters.cellsSearched++;
        depth++;
        progressRatioStack[depth] = progressRatioStack[depth-1]/count;
      }
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

  validateLayout() {
    // All handlers should be nonet handlers, but let's filter just in case.
    const nonetHandlers = this._handlers.filter(
      h => h instanceof SudokuConstraintHandler.Nonet);

    // Fill the nonet with values 1->9.
    const fillNonet = (nonet) => {
      nonet.cells.forEach((c, i) => this._grids[0][c] = 1<<i);
    }

    // Choose the nonet with the the most conflicted cells.
    const chooseNonet = () => {
      let bestNonet = null;
      let maxScore = -1;
      for (const h of nonetHandlers) {
        const score = h.cells.map(
          c => this._backtrackTriggers[c]).reduce((a, b)=>a+b);
        if (score > maxScore) {
          bestNonet = h;
          maxScore = score;
        }
      }

      return bestNonet;
    };

    const attempLog = [];
    const SEARCH_LIMIT = 10000;

    // Do a attempt to solve.
    const attempt = () => {
      this._resetStack();
      this.counters.maxDepth = 0;

      const nonet = chooseNonet();
      fillNonet(nonet);

      for (const result of this.run(SEARCH_LIMIT)) {
        if (result.isSolution) return true;
        attempLog.push([nonet, this.counters.maxDepth]);
        return undefined;
      }
      return false;
    }

    // Do a small number of short attempts.
    // Each time the most promising nonet will be chosen as a seed, ideally
    // getting closer to the best choice.
    for (let i = 0; i < 5; i++) {
      const result = attempt();
      if (result !== undefined) return result;
    }

    // Stop messing around, and commit.
    this._resetStack();

    // Unfortunately, the same nonet can't be chosen twice, so we don't know
    // if we've landed on the best one.
    // Assume that we've hit a stable state where we alternate between the best
    // nonet and another, thus just look at the last two.
    const attemptOptions = attempLog.slice(-2);
    // Sort by score, putting the min score first.
    attemptOptions.sort((a,b) => a[1]-b[1]);
    // Find the nonet with the best score.
    const bestNonet = attemptOptions[0][0];
    fillNonet(bestNonet);

    // Run the final search until we find a solution or prove that one doesn't
    // exist.
    for (const result of this.run()) return true;
    return false;
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
  // NOTE: This is intended to be created once, and reused.
  constructor(handlers, cellMap) {
    this._handlers = handlers;
    this._cellMap = this.constructor._makeCellMap(handlers);

    this._linkedList = new Int16Array(this._handlers.length);
    this._linkedList.fill(-1);
    this._head = -1;
  }

  static _makeCellMap(handlers) {
    // Add all cells that the handler claims to be attached to the list of
    // handlers for that cell.
    const cellHandlerMap = new Array(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) {
      cellHandlerMap[i] = [];
    }
    for (let i = 0; i < handlers.length; i++) {
      for (const cell of handlers[i].cells) {
        cellHandlerMap[cell].push(i);
      }
    }
    return cellHandlerMap;
  }

  add(cell) {
    const indexes = this._cellMap[cell];
    const numHandlers = indexes.length;
    for (let j = 0; j < numHandlers; j++) {
      const i = indexes[j];
      if (this._linkedList[i] < 0) {
        this._linkedList[i] = this._head;
        this._head = i;
      }
    }
  }

  clear() {
    const ll = this._linkedList;
    let head = this._head;
    while (head >= 0) {
      const newHead = ll[head];
      ll[head] = -1;
      head = newHead;
    }
    this._head = -1;
  }

  hasConstraints() {
    return this._head >= 0;
  }

  popConstraint() {
    const oldHead = this._head;
    this._head = this._linkedList[oldHead];
    this._linkedList[oldHead] = -1;

    return this._handlers[oldHead];
  }
}

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
    const keyParts = [];
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
    const key = this._binaryFunctionKey(fn);
    if (this._binaryFunctionCache.has(key)) {
      return this._binaryFunctionCache.get(key);
    }

    const table = new Uint16Array(COMBINATIONS);
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
