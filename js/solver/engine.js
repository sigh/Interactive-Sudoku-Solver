"use strict";

class SudokuSolver {
  constructor(handlers, shape, debugOptions) {
    this._debugger = new SudokuSolver.Debugger(this, debugOptions);
    this._logDebug = this._debugger.getLogDebugFn();
    this._shape = shape;

    this._internalSolver = new SudokuSolver.InternalSolver(
      handlers, shape, this._debugger.getLogDebugFn());

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
        result = { solutions: [sampleSolution] };
        sampleSolution = null;
      }
      return result;
    };

    this._timer.runTimed(() => {
      for (const result of this._getIter()) {
        // Only store a sample solution if we don't have one.
        if (sampleSolution == null) {
          sampleSolution = this.constructor._gridToSolution(result.grid);
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

    return this.constructor._gridToSolution(result.grid);
  }

  nthStep(n, stepGuides) {
    let result = this._nthIteration(n, stepGuides);
    if (!result) return null;

    let pencilmarks = this.constructor._makePencilmarks(result.grid);
    for (const cell of result.cellOrder) {
      pencilmarks[cell] = LookupTables.toValue(result.grid[cell]);
    }

    let latestCell = result.cellOrder.length ?
      this._shape.makeCellIdFromIndex(
        result.cellOrder[result.cellOrder.length - 1]) : null;

    return {
      pencilmarks: pencilmarks,
      latestCell: latestCell,
      isSolution: result.isSolution,
      hasContradiction: result.hasContradiction,
      values: LookupTables.toValuesArray(result.values),
    }
  }

  _nthIteration(n, stepGuides) {
    const yieldEveryStep = !!stepGuides;

    n++;
    let iter = this._getIter(yieldEveryStep);
    // To go backwards we start from the start.
    if (n <= iter.count) {
      this._reset();
      iter = this._getIter(yieldEveryStep);
    }

    if (yieldEveryStep) {
      this._internalSolver.setStepState({
        stepGuides: stepGuides,
        logSteps: false,
      });
    }

    // Iterate until we have seen n steps.
    let result = null;
    this._timer.runTimed(() => {
      do {
        // Only show debug logs for the target step.
        if (yieldEveryStep && this._logDebug && iter.count == n - 1) {
          this._internalSolver.setStepState({ logSteps: true });
          this._logDebug({
            loc: 'nthStep',
            msg: 'Step ' + iter.count,
            important: true
          });
        }
        result = iter.next();
      } while (iter.count < n);
    });

    if (result.done) return null;
    return result.value;
  }

  solveAllPossibilities() {
    this._reset();

    let valuesInSolutions = new Uint16Array(this._shape.numCells);
    let solutions = [];

    // Send the current values with the progress update, if there have
    // been any changes.
    this._progressExtraStateFn = () => {
      if (!solutions.length) return null;
      return {
        solutions: solutions.splice(0).map(
          s => this.constructor._gridToSolution(s)),
      };
    };

    this._timer.runTimed(() => {
      this._internalSolver.solveAllPossibilities(solutions, valuesInSolutions);
    });

    // Send progress one last time to ensure all the solutions are sent.
    this._sendProgress();
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

  debugState() {
    return this._debugger.getDebugState();
  }

  state() {
    const counters = { ...this._internalSolver.counters };

    const state = {
      counters: counters,
      timeMs: this._timer.elapsedMs(),
      done: this._internalSolver.done,
    }

    return state;
  }

  _getIter(yieldEveryStep) {
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

  static _gridToSolution(grid) {
    return grid.map(value => LookupTables.toValue(value));
  }

  static _makePencilmarks(grid) {
    const pencilmarks = [];
    for (let i = 0; i < grid.length; i++) {
      pencilmarks.push(new Set(
        LookupTables.toValuesArray(grid[i])));
    }
    return pencilmarks;
  }
}

SudokuSolver.Debugger = class {
  constructor(solver, debugOptions) {
    this._solver = solver;
    this._debugOptions = {
      enableLogs: false,
      exportBacktrackCounts: false,
    };
    this._hasAnyDebugging = false;
    this._logDebug = null;
    this._pendingDebugLogs = [];

    if (debugOptions) {
      // Only copy over options for known values.
      for (const key of Object.keys(debugOptions)) {
        if (key in this._debugOptions) {
          this._debugOptions[key] = debugOptions[key];
          this._hasAnyDebugging ||= debugOptions[key];
        }
      }
    }

    if (this._debugOptions.enableLogs) {
      this._logDebug = (data) => {
        this._pendingDebugLogs.push(data);
      };
    }
  }

  getDebugState() {
    if (!this._hasAnyDebugging) return null;

    const result = {};
    if (this._pendingDebugLogs.length) {
      result.logs = this._pendingDebugLogs.splice(0);
    }
    if (this._debugOptions.exportBacktrackCounts) {
      result.backtrackCounts = this._solver._internalSolver.getBacktrackTriggers();
    }
    return result;
  }

  getLogDebugFn() {
    return this._logDebug;
  }
};

SudokuSolver.InternalSolver = class {

  constructor(handlerGen, shape, debugLogger) {
    this._shape = shape;
    this._numCells = this._shape.numCells;
    this._logDebug = debugLogger;

    this._initGrid();
    this._candidateSelector = new SudokuSolver.CandidateSelector(
      shape, debugLogger);
    this._recStack = new Uint16Array(shape.numCells + 1);
    this._progressRemainingStack = Array.from(this._recStack).fill(0.0);

    this._runCounter = 0;
    this._progress = {
      frequencyMask: -1,
      callback: null,
    };

    this._handlerSet = this._setUpHandlers(Array.from(handlerGen));

    this._cellAccumulator = new SudokuSolver.CellAccumulator(this._handlerSet);

    this._cellPriorities = this._initCellPriorities();

    this.reset();
  }

  // Cell priorities are used to determine the order in which cells are
  // searched with preference given to cells with higher priority.
  _initCellPriorities() {
    const priorities = new Int32Array(this._shape.numCells);

    // TODO: Determine priorities in a more principled way.
    //  - Add one for each conflict cell.
    //  - Add custom priorities for each constraint based on how restrictive it
    //    is.

    for (const handler of this._handlerSet) {
      const priority = handler.priority();
      for (const cell of handler.cells) {
        priorities[cell] += priority;
      }
    }

    for (const handler of this._handlerSet.getAllofType(SudokuConstraintHandler.Priority)) {
      for (const cell of handler.priorityCells()) {
        priorities[cell] = handler.priority();
      }
    }

    if (this._logDebug) {
      this._logDebug({
        loc: '_initCellPriorities',
        msg: 'Hover for values',
        args: {
          min: Math.min(...priorities),
          max: Math.max(...priorities),
        },
        overlay: priorities,
      });
    }

    return priorities;
  }

  static _findCellConflicts(handlers, shape) {
    const cellConflictSets = [];
    for (let i = 0; i < shape.numCells; i++) {
      cellConflictSets.push(new Set());
    }

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

  // Invalidate the grid, given the handler which said it was impossible.
  // We invalidate the grid by setting cells to zero. We want to set the
  // most meaningful cells to the user.
  _invalidateGrid(grid, handler) {
    // Try to use the handler cells.
    let cells = handler.cells;
    // Otherwise the cells in the conflict set.
    if (!cells.length) cells = handler.conflictSet();
    cells.forEach(c => grid[c] = 0);

    // Otherwise just set the entire grid to 0.
    if (!cells.length) grid.fill(0);
  }

  _setUpHandlers(handlers) {
    const cellConflictSets = this.constructor._findCellConflicts(handlers, this._shape);

    // Set cell conflicts so that they are unique.
    // Sort them, so they are in a predictable order.
    this._cellConflicts = cellConflictSets.map(c => new Uint8Array(c));
    this._cellConflicts.forEach(c => c.sort((a, b) => a - b));

    const handlerSet = new HandlerSet(handlers, this._shape);

    // Optimize handlers.
    new SudokuConstraintOptimizer(this._logDebug).optimize(
      handlerSet, cellConflictSets, this._shape);

    for (const handler of handlerSet) {
      if (!handler.initialize(this._initialGrid, cellConflictSets, this._shape)) {
        this._invalidateGrid(this._initialGrid, handler);
      }
    }

    for (const handler of handlerSet.getAux()) {
      if (!handler.initialize(this._initialGrid, cellConflictSets, this._shape)) {
        this._invalidateGrid(this._initialGrid, handler);
      }
    }

    return handlerSet;
  }

  reset() {
    this._iter = null;
    this._stepState = null;
    this.counters = {
      valuesTried: 0,
      cellsSearched: 0,
      backtracks: 0,
      guesses: 0,
      solutions: 0,
      constraintsProcessed: 0,
      progressRatio: 0,
      progressRatioPrev: 0,
      branchesIgnored: 0,
    };

    // _backtrackTriggers counts the the number of times a cell is responsible
    // for finding a contradiction and causing a backtrack. It is exponentially
    // decayed so that the information reflects the most recent search areas.
    // Cells with a high count are the best candidates for searching as we
    // may find the contradiction faster. Ideally, this allows the search to
    // learn the critical areas of the grid where it is more valuable to search
    // first.
    // _backtrackTriggers are initialized to the cell priorities so that
    // so that the initial part of the search is still able to prioritize cells
    // which may lead to a contradiction.
    this._backtrackTriggers = this._cellPriorities.slice();
    this._uninterestingValues = null;

    this._resetStack();
    this._candidateSelector.reset(this._backtrackTriggers);
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
    this._progressRemainingStack[0] = 1.0;
  }

  _initGrid() {
    const numCells = this._numCells;

    let buffer = new ArrayBuffer(
      (numCells + 1) * numCells * Uint16Array.BYTES_PER_ELEMENT);

    this._grids = [];
    for (let i = 0; i < numCells + 1; i++) {
      this._grids.push(new Uint16Array(
        buffer,
        i * numCells * Uint16Array.BYTES_PER_ELEMENT,
        numCells));
    }
    this._initialGrid = new Uint16Array(numCells);

    const allValues = LookupTables.get(this._shape.numValues).allValues;
    this._initialGrid.fill(allValues);
  }

  _hasInterestingSolutions(grid, uninterestingValues) {
    // We need to check all cells because we maybe validating a cell above
    // us, or finding a value for a cell below us.
    for (let cell = 0; cell < this._numCells; cell++) {
      if (grid[cell] & ~uninterestingValues[cell]) return true;
    }
    return false;
  }

  _logEnforceValue(grid, cell, value, conflicts) {
    const changedCells = conflicts.filter(c => grid[c] & value);
    this._logDebug({
      loc: '_enforceValue',
      msg: 'Enforcing value',
      args: {
        cell: this._shape.makeCellIdFromIndex(cell),
        value: LookupTables.toValue(value),
        cellsChanged: changedCells.length
      },
      cells: changedCells,
    });

    if (changedCells.length) {
      const emptyCells = changedCells.filter(c => !(grid[c] & ~value));
      if (emptyCells.length) {
        this._logDebug({
          loc: '_enforceValue',
          msg: 'Enforcing value caused wipeout',
          cells: emptyCells,
        });
      }
    }
  }

  _enforceValue(grid, cell, cellAccumulator) {
    let value = grid[cell];

    const conflicts = this._cellConflicts[cell];
    const numConflicts = conflicts.length;
    const logSteps = this._stepState !== null && this._stepState.logSteps;
    if (logSteps) {
      this._logEnforceValue(grid, cell, value, conflicts);
    }
    for (let i = 0; i < numConflicts; i++) {
      const conflict = conflicts[i];
      if (grid[conflict] & value) {
        if (!(grid[conflict] ^= value)) return false;
        cellAccumulator.add(conflict);
      }
    }

    // Only enforce aux handlers for the current cell.
    if (!this._enforceAuxHandlers(grid, cell, cellAccumulator, logSteps)) {
      return false;
    }

    return this._enforceConstraints(grid, cellAccumulator, logSteps);
  }

  static _debugGridBuffer = new Uint16Array(SHAPE_MAX.numCells);

  _debugEnforceConsistency(loc, grid, handler, cellAccumulator) {
    const oldGrid = this.constructor._debugGridBuffer;
    oldGrid.set(grid);

    const result = handler.enforceConsistency(grid, cellAccumulator);
    const diff = {};
    let hasDiff = false;
    for (let i = 0; i < grid.length; i++) {
      if (oldGrid[i] != grid[i]) {
        diff[this._shape.makeCellIdFromIndex(i)] = (
          LookupTables.toValuesArray(oldGrid[i] & ~grid[i]));
        hasDiff = true;
      }
    }

    if (hasDiff) {
      this._logDebug({
        loc: loc,
        msg: `${handler.constructor.name} removed: `,
        args: diff,
        cells: handler.cells,
      });
    }
    if (!result) {
      this._logDebug({
        loc: loc,
        msg: `${handler.constructor.name} returned false`,
        cells: handler.cells,
      });
    }

    return result;
  }

  _enforceAuxHandlers(grid, cell, cellAccumulator, logSteps) {
    const counters = this.counters;

    const handlers = this._handlerSet.lookupAux(cell);
    const numHandlers = handlers.length;
    for (let i = 0; i < numHandlers; i++) {
      counters.constraintsProcessed++;
      const h = handlers[i];
      if (logSteps) {
        if (!this._debugEnforceConsistency('_enforceAuxHandlers', grid, h, cellAccumulator)) {
          return false;
        }
      } else {
        if (!h.enforceConsistency(grid, cellAccumulator)) {
          return false;
        }
      }
    }

    return true;
  }

  _enforceConstraints(grid, cellAccumulator, logSteps) {
    const counters = this.counters;

    while (cellAccumulator.hasConstraints()) {
      counters.constraintsProcessed++;
      const c = cellAccumulator.popConstraint();
      if (logSteps) {
        if (!this._debugEnforceConsistency('_enforceConstraints', grid, c, cellAccumulator)) {
          return false;
        }
      } else {
        // TODO: Avoid c being added to cellAccumulator during this time.
        if (!c.enforceConsistency(grid, cellAccumulator)) {
          return false;
        }
      }
    }

    return true;
  }

  setStepState(keys) {
    if (this._stepState == null) {
      this._stepState = {
        stepGuides: null,
        logSteps: false,
        step: 0,
      };
    }
    this._stepState = { ...this._stepState, ...keys };
  }

  static YIELD_ON_SOLUTION = 0;
  static YIELD_ON_STEP = 1;

  static _LOG_BACKTRACK_DECAY_INTERVAL = 14;

  // run runs the solve.
  // yieldWhen can be:
  //  YIELD_ON_SOLUTION to yielding each solution.
  //  YIELD_ON_STEP to yield every step.
  //  n > 1 to yield every n contradictions.
  * run(yieldWhen) {
    const yieldEveryStep = yieldWhen === this.constructor.YIELD_ON_STEP;
    const yieldOnContradiction = yieldWhen > 1 ? yieldWhen : 0;

    // Set up iterator validation.
    if (!this._atStart) throw ('State is not in initial state.');
    this._atStart = false;
    let runCounter = ++this._runCounter;
    const checkRunCounter = () => {
      if (runCounter != this._runCounter) throw ('Iterator no longer valid');
    };

    const counters = this.counters;
    counters.progressRatioPrev += counters.progressRatio;
    counters.progressRatio = 0;

    const progressFrequencyMask = this._progress.frequencyMask;
    const backtrackDecayMask = (1 << this.constructor._LOG_BACKTRACK_DECAY_INTERVAL) - 1;
    let iterationCounterForUpdates = 0;

    {
      // Enforce constraints for all cells.
      let cellAccumulator = this._cellAccumulator;
      cellAccumulator.clear();
      for (let i = 0; i < this._numCells; i++) cellAccumulator.add(i);
      const logSteps = this._stepState !== null && this._stepState.logSteps;
      this._enforceConstraints(this._grids[0], cellAccumulator, logSteps);
    }

    if (yieldEveryStep) {
      this.setStepState({});
      yield {
        grid: this._grids[0],
        isSolution: false,
        cellOrder: [],
        values: 0,
        hasContradiction: false,
      }
      checkRunCounter();
      this._stepState.step = 1;
    }

    let recDepth = 0;
    const recStack = this._recStack;
    recStack[recDepth++] = 0;
    let isNewCellDepth = true;
    let progressDelta = 1.0;
    // The last cell which caused a contradiction at each level.
    const lastContradictionCell = new Int16Array(this._numCells);
    lastContradictionCell.fill(-1);

    while (recDepth) {
      recDepth--;
      const cellDepth = recStack[recDepth];

      let grid = this._grids[recDepth];

      if (isNewCellDepth) {
        isNewCellDepth = false;

        // TODO: Handle fixed cells.

        // We've reached the end, so output a solution!
        if (cellDepth == this._shape.numCells) {
          counters.progressRatio += progressDelta;
          // We've set all the values, and we haven't found a contradiction.
          // This is a solution!
          counters.solutions++;
          yield {
            grid: grid,
            isSolution: true,
            cellOrder: this._candidateSelector.getCellOrder(),
            hasContradiction: false,
          };
          checkRunCounter();
          continue;
        }

        this._progressRemainingStack[recDepth] = progressDelta;

        // Update counters.
        counters.cellsSearched++;
      }

      const [cell, value, count] = this._candidateSelector.selectNextCandidate(
        cellDepth, grid, this._stepState);
      if (count === 0) continue;

      const originalValues = grid[cell];

      {
        // Assume the remaining progress is evenly distributed among the value
        // options.
        progressDelta = this._progressRemainingStack[recDepth] / count;
        this._progressRemainingStack[recDepth] -= progressDelta;

        counters.valuesTried++;
        iterationCounterForUpdates++
      }
      if ((iterationCounterForUpdates & backtrackDecayMask) === 0) {
        // Exponentially decay the counts.
        for (let i = 0; i < this._numCells; i++) {
          this._backtrackTriggers[i] >>= 1;
        }
        // Ensure that the counter doesn't overflow.
        iterationCounterForUpdates &= (1 << 30) - 1;
      }

      if (count !== 1) {
        // We only need to start a new recursion frame when there is more than
        // one value to try.

        recDepth++;
        counters.guesses++;

        // Remove the value from our set of candidates.
        // NOTE: We only have to do this because we will return back to this
        //       stack frame.
        grid[cell] ^= value;

        this._grids[recDepth].set(grid);
        grid = this._grids[recDepth];
      }
      // NOTE: Set this even when count == 1 to allow for other candidate
      //       selection methods.
      grid[cell] = value;

      let cellAccumulator = this._cellAccumulator;
      cellAccumulator.clear();
      cellAccumulator.add(cell);
      // Queue up extra constraints based on prior backtracks. The idea being
      // that constraints that apply this the contradiction cell are likely
      // to turn up a contradiction here if it exists.
      if (lastContradictionCell[cellDepth] >= 0) {
        cellAccumulator.add(lastContradictionCell[cellDepth]);
        // If this is the last value at this level, clear the
        // lastContradictionCell as the next time we reach this level won't be
        // from the same subtree that caused the contradiction.
        if (count === 1) lastContradictionCell[cellDepth] = -1;
      }

      // Propagate constraints.
      let hasContradiction = !this._enforceValue(grid, cell, cellAccumulator);
      if (hasContradiction) {
        // Store the current cells, so that the level immediately above us
        // can act on this information to run extra constraints.
        if (cellDepth > 0) lastContradictionCell[cellDepth - 1] = cell;
        counters.progressRatio += progressDelta;
        counters.backtracks++;
        this._backtrackTriggers[cell]++;

        if (0 !== yieldOnContradiction &&
          0 === counters.backtracks % yieldOnContradiction) {
          yield {
            grid: grid,
            isSolution: false,
            cellOrder: this._candidateSelector.getCellOrder(cellDepth),
            hasContradiction: hasContradiction,
          };
        }
      }

      if ((iterationCounterForUpdates & progressFrequencyMask) === 0) {
        this._progress.callback();
      }

      if (yieldEveryStep) {
        // The value may have been over-written by the constraint enforcer
        // (i.e. if there was a contradiction). Replace it for the output.
        grid[cell] = value;
        yield {
          grid: grid,
          isSolution: false,
          cellOrder: this._candidateSelector.getCellOrder(cellDepth + 1),
          values: originalValues,
          hasContradiction: hasContradiction,
        };
        checkRunCounter();
        this._stepState.step++;
      }

      if (hasContradiction) continue;

      if (this._uninterestingValues) {
        if (!this._hasInterestingSolutions(grid, this._uninterestingValues)) {
          counters.branchesIgnored += progressDelta;
          continue;
        }
      }

      // Recurse to the new cell.
      recStack[recDepth++] = cellDepth + 1;
      isNewCellDepth = true;
    }

    this.done = true;
  }

  solveAllPossibilities(solutions, valuesInSolutions) {
    const counters = this.counters;

    for (const result of this.run()) {
      result.grid.forEach((c, i) => { valuesInSolutions[i] |= c; });
      solutions.push(result.grid.slice(0));

      // Once we have 2 solutions, then start ignoring branches which maybe
      // duplicating existing solution (up to this point, every branch is
      // interesting).
      if (counters.solutions == 2) {
        this._uninterestingValues = valuesInSolutions;
      }
    }
  }

  validateLayout() {
    // Choose just the house handlers.
    const houseHandlers = this._handlerSet.getAllofType(SudokuConstraintHandler.House);

    // Function to fill a house with all values.
    const fillHouse = (house) => {
      house.cells.forEach((c, i) => this._grids[0][c] = 1 << i);
    };

    const attemptLog = [];
    // Arbitrary search limit. Too much lower and there are some cases which get
    // stuck for too long.
    const SEARCH_LIMIT = 200;

    // Function to attempt to solve with one house fixed.
    const attempt = (house) => {
      this._resetStack();

      fillHouse(house);
      // Reduce backtrack triggers so that we don't weight the last runs too
      // heavily.
      // TODO: Do this in a more principled way.
      for (let i = 0; i < this._numCells; i++) {
        this._backtrackTriggers[i] >>= 1;
      }

      for (const result of this.run(SEARCH_LIMIT)) {
        if (result.isSolution) {
          this.counters.branchesIgnored = 1 - this.counters.progressRatio;
          return true;
        }
        attemptLog.push([house, this.counters.progressRatio]);
        return undefined;
      }
      return false;
    };

    // Try doing a short search from every house.
    for (const house of houseHandlers) {
      const result = attempt(house);
      // If the search completed, then we can return the result immediately.
      if (result !== undefined) {
        this.done = true;
        return result;
      }
    }

    // None of the searches completed. Choose the house which had the most
    // progress (i.e. the search covered more of the search space), and do
    // a full search from there.

    // Find the house with the best score.
    attemptLog.sort((a, b) => b[1] - a[1]);
    const bestHouse = attemptLog[0][0];

    this._resetStack();
    fillHouse(bestHouse);

    // Run the final search until we find a solution or prove that one doesn't
    // exist.
    let result = false;
    for (const result of this.run()) { result = true; break; }

    this.done = true;
    return result;
  }

  setProgressCallback(callback, logFrequency) {
    this._progress.callback = callback;
    this._progress.frequencyMask = -1;
    if (callback) {
      this._progress.frequencyMask = (1 << logFrequency) - 1;
    }
  }

}

SudokuSolver.CandidateSelector = class CandidateSelector {
  constructor(shape, debugLogger) {
    this._shape = shape;
    this._cellOrder = new Uint8Array(shape.numCells);
    this._backtrackTriggers = null;
    this._logDebug = debugLogger;
  }

  reset(backtrackTriggers) {
    // Re-initialize the cell indexes in the cellOrder.
    // This is not required, but keeps things deterministic.
    const numCells = this._cellOrder.length;
    for (let i = 0; i < numCells; i++) {
      this._cellOrder[i] = i;
    }

    this._backtrackTriggers = backtrackTriggers;
  }

  getCellOrder(upto) {
    if (upto === undefined) return this._cellOrder;
    return this._cellOrder.subarray(0, upto);
  }

  selectNextCandidate(currentIndex, grid, stepState) {
    const cellOrder = this._cellOrder;
    let [cellIndex, value, count] = this._selectBestCandidate(
      grid, cellOrder, currentIndex);

    // Adjust the value for step-by-step.
    if (stepState) {
      if (stepState.logSteps) {
        this._logSelectNextCandidate(
          'Best candidate:', cellOrder[cellIndex], value, count);
      }

      let adjusted = false;
      [cellIndex, value, count, adjusted] = this._adjustForStepState(
        stepState, grid, cellOrder, currentIndex, cellIndex, value);

      if (adjusted && stepState.logSteps) {
        this._logSelectNextCandidate(
          'Adjusted by user:', cellOrder[cellIndex], value, count);
      }
    }
    const cell = cellOrder[cellIndex];

    // Update cellOrder.
    [cellOrder[cellIndex], cellOrder[currentIndex]] =
      [cellOrder[currentIndex], cellOrder[cellIndex]];

    return [cell, value, count];
  }

  _logSelectNextCandidate(msg, cell, value, count) {
    this._logDebug({
      loc: 'selectNextCandidate',
      msg: msg,
      args: {
        cell: this._shape.makeCellIdFromIndex(cell),
        value: LookupTables.toValue(value),
        numOptions: count,
      },
      cells: [cell],
    });
  }

  _selectBestCandidate(grid, cellOrder, currentIndex) {
    // Quick check - if the first value is a singleton, then just return without
    // the extra bookkeeping.
    {
      const firstValue = grid[cellOrder[currentIndex]];
      if ((firstValue & (firstValue - 1)) === 0) {
        return [currentIndex, firstValue, firstValue !== 0 ? 1 : 0];
      }
    }

    // Find the best cell to explore next.
    const cellIndex = this._selectBestCell(grid, cellOrder, currentIndex);
    const cell = cellOrder[cellIndex];

    // Find the next smallest value to try.
    // NOTE: We will always have a value because:
    //        - we would have returned earlier on domain wipeout.
    //        - we don't add to the stack on the final value in a cell.
    let values = grid[cell];
    let value = values & -values;

    return [cellIndex, value, countOnes16bit(values)];
  }

  _selectBestCell(grid, cellOrder, currentIndex) {
    // Choose cells based on value count and number of conflicts encountered.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts (0 values), so we should never find them here. Even if they
    // exist, it just means we do a few more useless forced cell resolutions.
    // NOTE: If the scoring is more complicated, it can be useful
    // to do an initial pass to detect 1 or 0 value cells (!(v&(v-1))).

    const numCells = grid.length;
    const backtrackTriggers = this._backtrackTriggers;

    // Find the cell with the minimum score.
    let maxScore = -1;
    let bestIndex = 0;

    for (let i = currentIndex; i < numCells; i++) {
      const cell = cellOrder[i];
      const count = countOnes16bit(grid[cell]);
      // If we have a single value then just use it - as it will involve no
      // guessing.
      // NOTE: We could use more efficient check for count() < 1, but it's not
      // worth it as this only happens at most once per loop. The full count()
      // will have to occur anyway for every other iteration.
      if (count <= 1) {
        bestIndex = i;
        maxScore = -1;
        break;
      }

      let score = backtrackTriggers[cell] / count;

      if (score > maxScore) {
        bestIndex = i;
        maxScore = score;
      }
    }

    if (maxScore === 0) {
      // It's rare that maxScore is 0 since all backtrack triggers must be 0.
      // However, in this case we can run a special loop to find the cell with
      // the min count.
      //
      // Looping over the cells again is not a concern since this is rare. It is
      // better to take it out of the main loop.
      bestIndex = this._minCountCellIndex(grid, cellOrder, currentIndex);
    }

    return bestIndex;
  }

  // Find the cell index with the minimum score. Return the index into cellOrder.
  _minCountCellIndex(grid, cellOrder, currentIndex) {
    let minCount = 1 << 16;
    let bestIndex = 0;
    for (let i = currentIndex; i < grid.length; i++) {
      const count = countOnes16bit(grid[cellOrder[i]]);
      if (count < minCount) {
        bestIndex = i;
        minCount = count;
      }
    }
    return bestIndex;
  }

  _adjustForStepState(stepState, grid, cellOrder, currentIndex, cellIndex, value) {
    const step = stepState.step;
    const guide = stepState.stepGuides.get(step) || {};
    let adjusted = false;

    // If there is a cell guide, then use that.
    if (guide.cell) {
      const newCellIndex = cellOrder.indexOf(guide.cell, currentIndex);
      if (newCellIndex !== -1) {
        cellIndex = newCellIndex;
        adjusted = true;
      }
    }

    const cellValues = grid[cellOrder[cellIndex]];

    if (guide.value) {
      // Use the value from the guide.
      value = LookupTables.fromValue(guide.value);
      adjusted = true;
    } else if (guide.cell) {
      // Or if we had a guide cell then choose a value which is valid for that
      // cell.
      value = cellValues & -cellValues;
      adjusted = true;
    }

    return [cellIndex, value, countOnes16bit(cellValues), adjusted];
  }
}

SudokuSolver.CellAccumulator = class {
  // NOTE: This is intended to be created once, and reused.
  constructor(handlerSet) {
    this._handlers = handlerSet.getAll();
    this._cellMap = handlerSet.getCellMap();

    this._linkedList = new Int16Array(this._handlers.length);
    this._linkedList.fill(-2);  // -2 = Not in list.
    this._head = -1;  // -1 = null pointer.
  }

  add(cell) {
    const indexes = this._cellMap[cell];
    const numHandlers = indexes.length;
    for (let j = 0; j < numHandlers; j++) {
      const i = indexes[j];
      if (this._linkedList[i] < -1) {
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
      ll[head] = -2;
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
    this._linkedList[oldHead] = -2;

    return this._handlers[oldHead];
  }
}

class LookupTables {
  static get = memoize((numValues) => {
    return new LookupTables(true, numValues);
  });

  static fromValue = (i) => {
    return 1 << (i - 1);
  };

  static fromValuesArray = (xs) => {
    let result = 0;
    for (const x of xs) {
      result |= this.fromValue(x);
    }
    return result;
  };

  static toValue(v) {
    return 32 - Math.clz32(v);
  };

  static toValuesArray(values) {
    let result = [];
    while (values) {
      let value = values & -values;
      values ^= value;
      result.push(LookupTables.toValue(value));
    }
    return result;
  }

  constructor(do_not_call, numValues) {
    if (!do_not_call) throw ('Use LookupTables.get(shape.numValues)');

    this.allValues = (1 << numValues) - 1;
    this.combinations = 1 << numValues;

    const combinations = this.combinations;

    this.sum = (() => {
      let table = new Uint8Array(combinations);
      for (let i = 1; i < combinations; i++) {
        // SUM is the value of the lowest set bit plus the sum  of the rest.
        table[i] = table[i & (i - 1)] + LookupTables.toValue(i & -i);
      }
      return table;
    })();

    // Combines min and max into a single integer:
    // Layout: [min: 8 bits, max: 8 bits]
    //
    // The extra bits allow these values to be summed to determine the total
    // of mins and maxs.
    this.minMax8Bit = (() => {
      // Initialize the table with MAXs.
      const table = new Uint16Array(combinations);
      table[1] = LookupTables.toValue(1);
      for (let i = 2; i < combinations; i++) {
        // MAX is greater than the max when everything has been decreased by
        // 1.
        table[i] = 1 + table[i >> 1];
      }

      // Add the MINs.
      for (let i = 1; i < combinations; i++) {
        // MIN is the value of the last bit set.
        const min = LookupTables.toValue(i & -i);
        table[i] |= min << 8;
      }

      return table;
    })();

    // The maximum number of cells in a sum is 16 so that it can the count
    // can be stored in 4 bits. This is important for the layout of
    // isFixed in rangeInfo.
    this.MAX_CELLS_IN_SUM = 16;

    // Combines useful info about the range of numbers in a cell.
    // Designed to be summed, so that the aggregate stats can be found.
    // Layout: [isFixed: 4 bits, fixed: 8 bits, min: 8 bits, max: 8 bits]
    //
    // Sum of isFixed gives the number of fixed cells.
    // Sum of fixed gives the sum of fixed cells.
    // Min and max as a in minMax.
    this.rangeInfo = (() => {
      const table = new Uint32Array(combinations);
      for (let i = 1; i < combinations; i++) {
        const minMax = this.minMax8Bit[i];
        const fixed = countOnes16bit(i) == 1 ? LookupTables.toValue(i) : 0;
        const isFixed = fixed ? 1 : 0;
        table[i] = (isFixed << 24) | (fixed << 16) | minMax;
      }
      // If there are no values, set a high value for isFixed to indicate the
      // result is invalid. This is intended to be detectable after summing.
      table[0] = numValues << 24;
      return table;
    })();

    this.reverse = (() => {
      let table = new Uint16Array(combinations);
      for (let i = 0; i < combinations; i++) {
        let rev = 0;
        for (let j = 0; j < numValues; j++) {
          rev |= ((i >> j) & 1) << (numValues - 1 - j);
        }
        table[i] = rev;
      }
      return table;
    })();

    const binaryFunctionKey = (fn) => {
      const keyParts = [];
      for (let i = 1; i <= numValues; i++) {
        let part = 0;
        for (let j = 1; j <= numValues; j++) {
          part |= fn(i, j) << j;
        }
        keyParts.push(part);
      }
      return keyParts.join(',');
    };

    this.forBinaryFunction = memoize((fn) => {
      const table = new Uint16Array(combinations);

      // Populate base cases, where there is a single value set.
      for (let i = 0; i < numValues; i++) {
        for (let j = 0; j < numValues; j++) {
          if (fn(i + 1, j + 1)) {
            table[1 << i] |= 1 << j;
          }
        }
      }

      // To fill in the rest, OR together all the valid settings for each value
      // set.
      for (let i = 1; i < combinations; i++) {
        table[i] = table[i & (i - 1)] | table[i & -i];
      }
      return table;
    },
      binaryFunctionKey);
  }
}
