"use strict";

class SudokuSolver {
  constructor(handlers, shape, debugOptions) {
    this._debugLogger = new SudokuSolver.DebugLogger(this, debugOptions);
    this._shape = shape;

    this._internalSolver = new SudokuSolver.InternalSolver(
      handlers, shape, this._debugLogger);

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
    this._internalSolver.unsetSampleSolution();
    this._progressExtraStateFn = () => {
      const sampleSolution = this._internalSolver.getSampleSolution();
      let result = null;
      if (sampleSolution) {
        result = {
          solutions: [SudokuSolver.Util.gridToSolution(sampleSolution)]
        };
        this._internalSolver.unsetSampleSolution();
      }
      return result;
    };

    this._timer.runTimed(() => {
      this._internalSolver.run(SudokuSolver.InternalSolver.YIELD_NEVER).next();
    });

    // Send progress one last time to ensure the last solution is sent.
    this._sendProgress();

    this._progressExtraStateFn = null;

    return this._internalSolver.counters.solutions;
  }

  nthSolution(n) {
    let result = this._nthIteration(n, false);
    if (!result) return null;

    return SudokuSolver.Util.gridToSolution(result.grid);
  }

  nthStep(n, stepGuides) {
    const result = this._nthIteration(n, stepGuides);
    if (!result) return null;

    const pencilmarks = SudokuSolver.Util.makePencilmarks(result.grid);
    for (const cell of result.cellOrder) {
      pencilmarks[cell] = LookupTables.toValue(result.grid[cell]);
    }

    let diffPencilmarks = null;
    if (result.oldGrid) {
      SudokuSolver.Util.removeGridValues(result.oldGrid, result.grid);
      diffPencilmarks = SudokuSolver.Util.makePencilmarks(result.oldGrid);
    }

    const latestCell = result.cellOrder.length ?
      this._shape.makeCellIdFromIndex(
        result.cellOrder[result.cellOrder.length - 1]) : null;

    return {
      pencilmarks: pencilmarks,
      diffPencilmarks: diffPencilmarks,
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
      });
      this._debugLogger.enableStepLogs = false;
    }

    // Iterate until we have seen n steps.
    let result = null;
    this._timer.runTimed(() => {
      do {
        // Only show debug logs for the target step.
        if (yieldEveryStep && this._debugLogger.enableLogs && iter.count == n - 1) {
          this._debugLogger.enableStepLogs = true;
          this._debugLogger.log({
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

    const solutions = [];

    // Send the current values with the progress update, if there have
    // been any changes.
    this._progressExtraStateFn = () => {
      if (!solutions.length) return null;
      return {
        solutions: solutions.splice(0).map(
          s => SudokuSolver.Util.gridToSolution(s)),
      };
    };

    let valuesInSolutions = null;
    this._timer.runTimed(() => {
      valuesInSolutions = this._internalSolver.solveAllPossibilities(
        solutions);
    });

    // Send progress one last time to ensure all the solutions are sent.
    this._sendProgress();
    this._progressExtraStateFn = null;

    return SudokuSolver.Util.makePencilmarks(valuesInSolutions);
  }

  validateLayout() {
    this._reset();

    let result = null;
    this._timer.runTimed(() => {
      result = this._internalSolver.validateLayout();
    });

    return result;
  }

  debugState() {
    return this._debugLogger.getDebugState();
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
}

SudokuSolver.Util = class {
  static gridToSolution(grid) {
    return grid.map(value => LookupTables.toValue(value));
  }

  static makePencilmarks(grid) {
    const pencilmarks = [];
    for (let i = 0; i < grid.length; i++) {
      pencilmarks.push(new Set(
        LookupTables.toValuesArray(grid[i])));
    }
    return pencilmarks;
  }

  static removeGridValues(gridA, gridB) {
    for (let i = 0; i < gridA.length; i++) {
      gridA[i] &= ~gridB[i];
    }
  }
};

SudokuSolver.DebugLogger = class {
  constructor(solver, debugOptions) {
    this._solver = solver;
    this._debugOptions = {
      logLevel: 0,
      enableStepLogs: false,
      exportBacktrackCounts: false,
    };
    this._hasAnyDebugging = false;
    this._pendingDebugLogs = [];

    if (debugOptions) {
      // Only copy over options for known values.
      for (const key of Object.keys(debugOptions)) {
        if (key in this._debugOptions) {
          this._debugOptions[key] = debugOptions[key];
          this._hasAnyDebugging ||= !!debugOptions[key];
        }
      }
    }

    this.logLevel = +this._debugOptions.logLevel;
    this.enableLogs = this.logLevel > 0;
    this.enableStepLogs = this._debugOptions.enableStepLogs;
  }

  log(data, level) {
    if (!this.enableLogs) {
      // We throw so we catch accidentally checked calls to log() because
      // they would hurt performance (even just creating the data object).
      throw ('Debug logs are not enabled');
    }

    level ||= 1;
    if (level > this.logLevel) return;

    this._pendingDebugLogs.push(data);
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
};

SudokuSolver.InternalSolver = class {

  constructor(handlerGen, shape, debugLogger) {
    this._shape = shape;
    this._numCells = this._shape.numCells;
    this._debugLogger = debugLogger;

    {
      this._initialGrid = new Uint16Array(shape.numCells);
      const allValues = LookupTables.get(this._shape.numValues).allValues;
      this._initialGrid.fill(allValues);
    }

    this._runCounter = 0;
    this._progress = {
      frequencyMask: -1,
      callback: null,
    };

    this._handlerSet = this._setUpHandlers(Array.from(handlerGen));

    this._handlerAccumulator = new SudokuSolver.HandlerAccumulator(this._handlerSet);
    this._candidateSelector = new CandidateSelector(
      shape, this._handlerSet, debugLogger);

    this._cellPriorities = this._initCellPriorities();

    this._recStack = this._initStack();

    this.reset();
  }

  // Cell priorities are used to determine the order in which cells are
  // searched with preference given to cells with higher priority.
  _initCellPriorities() {
    const priorities = new Int32Array(this._shape.numCells);

    // TODO: Determine priorities in a more principled way.
    //  - Add one for each exclusion cell.
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

    if (this._debugLogger.enableLogs) {
      this._debugLogger.log({
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

  // Invalidate the grid, given the handler which said it was impossible.
  // We invalidate the grid by setting cells to zero. We want to set the
  // most meaningful cells to the user.
  _invalidateGrid(grid, handler) {
    // Try to use the handler cells.
    let cells = handler.cells;
    // Otherwise use the exclusionCells.
    if (!cells.length) cells = handler.exclusionCells();
    cells.forEach(c => grid[c] = 0);

    // Otherwise just set the entire grid to 0.
    if (!cells.length) grid.fill(0);
  }

  _setUpHandlers(handlers) {
    // Sort initial handlers so that the solver performance doesn't
    // depend on the input order.
    // TODO: Do this in a more principled way. Consider doing this
    //       twice - once now and once after the optimizer runs.
    handlers.sort((a, b) => {
      // Put the handlers with the least cells first.
      // This just worked out better.
      // Most puzzles don't seem to depend too much on this order, but
      // it makes a 2x difference for some.
      if (a.cells.length != b.cells.length) {
        return a.cells.length - b.cells.length;
      }
      // After this it doesn't matter, as long as it is deterministic.
      // There still might be equal handlers after comparing cells and
      // the handler type, but that is ok.
      if (a.constructor.name != b.constructor.name) {
        return a.constructor.name.localeCompare(b.constructor.name);
      }
      // Put cell comparison last as it is the most expensive.
      const aCells = a.cells.join(',');
      const bCells = b.cells.join(',');
      return aCells.localeCompare(bCells);
    });

    const handlerSet = new HandlerSet(handlers, this._shape);

    if (this._debugLogger?.logLevel >= 2) {
      for (const h of handlerSet) {
        this._debugLogger.log({
          loc: '_setUpHandlers',
          msg: 'Handler: ' + h.constructor.name,
          cells: h.cells,
        }, 2);
      }
    }

    // Create lookups for which cells must have mutually exclusive values.
    const cellExclusions = new SudokuSolver.CellExclusions(
      handlerSet, this._shape);
    this._cellExclusions = cellExclusions;

    // Optimize handlers.
    new SudokuConstraintOptimizer(this._debugLogger).optimize(
      handlerSet, cellExclusions, this._shape);

    // Add the exclusion handlers.
    for (let i = 0; i < this._numCells; i++) {
      handlerSet.addSingletonHandlers(
        new SudokuConstraintHandler.UniqueValueExclusion(i));
    }

    // Initialize handlers.
    for (const handler of handlerSet) {
      const initialCells = handler.cells;
      if (!handler.initialize(this._initialGrid, cellExclusions, this._shape)) {
        if (this._debugLogger.enableLogs) {
          this._debugLogger.log({
            loc: '_setUpHandlers',
            msg: handler.constructor.name + ' returned false',
            cells: handler.cells,
          });
        }

        this._invalidateGrid(this._initialGrid, handler);
      }

      if (initialCells !== handler.cells) {
        handlerSet.updateCells(
          handlerSet.getIndex(handler),
          initialCells,
          handler.cells);
      }
    }

    return handlerSet;
  }

  reset() {
    this._iter = null;
    this._stepState = null;
    this.counters = {
      valuesTried: 0,
      nodesSearched: 0,
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
    // NOTE: _backtrackTriggers must not be reassigned as we pass the reference
    // to the candidateSelector.
    this._backtrackTriggers = this._cellPriorities.slice();
    this._uninterestingValues = null;

    this._resetRun();
  }

  _resetRun() {
    // Preserve backtrack triggers between runs (since this is currently only
    // used internally).
    // Candidate selector must be made aware of the new backtrack triggers.
    this._candidateSelector.reset(this._backtrackTriggers);

    // Setup sample solution so that we create new ones by default.
    this._sampleSolution = this._initialGrid.slice();

    this.done = false;
    this._atStart = true;
  }

  getBacktrackTriggers() {
    return this._backtrackTriggers.slice();
  }

  getSampleSolution() {
    return this._sampleSolution[0] ? this._sampleSolution : null;
  }

  unsetSampleSolution() {
    this._sampleSolution[0] = 0;
  }

  _hasInterestingSolutions(grid, uninterestingValues) {
    const valuesInSolutions = uninterestingValues.valuesInSolutions;
    // Check the last cell which was interesting, in case it is still
    // interesting.
    {
      const cell = uninterestingValues.lastInterestingCell;
      if (grid[cell] & ~valuesInSolutions[cell]) return true;
    }

    // We need to check all cells because we maybe validating a cell above
    // us, or finding a value for a cell below us.
    for (let cell = 0; cell < this._numCells; cell++) {
      if (grid[cell] & ~valuesInSolutions[cell]) {
        uninterestingValues.lastInterestingCell = cell;
        return true;
      }
    }
    return false;
  }

  static _debugGridBuffer = new Uint16Array(SHAPE_MAX.numCells);

  _debugEnforceConsistency(loc, gridState, handler, handlerAccumulator) {
    const oldGridState = this.constructor._debugGridBuffer.subarray(0, gridState.length);
    oldGridState.set(gridState);

    const result = handler.enforceConsistency(gridState, handlerAccumulator);
    const handlerName = handler.debugName();

    if (!arraysAreEqual(oldGridState, gridState)) {
      const diff = {};
      const numCells = this._numCells;
      const candidates = new Array(numCells);
      candidates.fill(null);
      for (let i = 0; i < numCells; i++) {
        if (oldGridState[i] != gridState[i]) {
          candidates[i] = LookupTables.toValuesArray(oldGridState[i] & ~gridState[i]);
          diff[this._shape.makeCellIdFromIndex(i)] = candidates[i];
        }
      }

      this._debugLogger.log({
        loc: loc,
        msg: `${handlerName} removed: `,
        args: diff,
        cells: handler.cells,
        candidates: candidates,
      });
    } else if (this._debugLogger.logLevel >= 2) {
      this._debugLogger.log({
        loc: loc,
        msg: `${handlerName} ran`,
        cells: handler.cells,
      }, 2);
    }
    if (!result) {
      this._debugLogger.log({
        loc: loc,
        msg: `${handlerName} returned false`,
        cells: handler.cells,
      });
    }

    return result;
  }

  _enforceConstraints(gridState, handlerAccumulator) {
    const counters = this.counters;
    const logSteps = this._debugLogger.enableStepLogs;

    while (!handlerAccumulator.isEmpty()) {
      const c = handlerAccumulator.takeNext();
      counters.constraintsProcessed++;
      if (logSteps) {
        if (!this._debugEnforceConsistency('_enforceConstraints', gridState, c, handlerAccumulator)) {
          return false;
        }
      } else {
        if (!c.enforceConsistency(gridState, handlerAccumulator)) {
          return false;
        }
      }
    }

    return true;
  }

  setStepState(updates) {
    if (this._stepState == null) {
      this._stepState = {
        stepGuides: null,
        step: 0,
        oldGrid: new Uint16Array(this._numCells),
      };
    }
    for (const [key, value] of Object.entries(updates)) {
      this._stepState[key] = value;
    }
  }

  _initStack() {
    const numCells = this._numCells;

    const extraStateProvider = new SudokuSolver.ExtraStateProvider(numCells);
    for (const handler of this._handlerSet) {
      handler.allocateExtraState(extraStateProvider);
    }
    const stateSize = numCells + extraStateProvider.totalSize();

    const stateBuffer = new ArrayBuffer(
      (numCells + 1) * stateSize * Uint16Array.BYTES_PER_ELEMENT);

    const recStack = [];
    for (let i = 0; i < numCells + 1; i++) {
      recStack.push({
        cellDepth: 0,
        progressRemaining: 1.0,
        lastContradictionCell: -1,
        newNode: true,
        gridState: new Uint16Array(
          stateBuffer,
          i * stateSize * Uint16Array.BYTES_PER_ELEMENT,
          stateSize),
        // Grid is a subset of state.
        gridCells: new Uint16Array(
          stateBuffer,
          i * stateSize * Uint16Array.BYTES_PER_ELEMENT,
          numCells),
      });
    }

    return recStack;
  }

  static YIELD_ON_SOLUTION = 0;
  static YIELD_ON_STEP = 1;
  static YIELD_NEVER = -1;

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
    const runCounter = ++this._runCounter;
    const checkRunCounter = () => {
      if (runCounter != this._runCounter) throw ('Iterator no longer valid');
    };

    // This is required because we may call run multiple times.
    const counters = this.counters;
    counters.progressRatioPrev += counters.progressRatio;
    counters.progressRatio = 0;

    const progressFrequencyMask = this._progress.frequencyMask;
    const backtrackDecayMask = (1 << this.constructor._LOG_BACKTRACK_DECAY_INTERVAL) - 1;
    let iterationCounterForUpdates = 0;

    const recStack = this._recStack;
    let recDepth = 0;
    {
      // Setup initial recursion frame.
      const initialRecFrame = recStack[recDepth];
      initialRecFrame.gridState.fill(0);
      initialRecFrame.gridCells.set(this._initialGrid);
      initialRecFrame.cellDepth = 0;
      initialRecFrame.lastContradictionCell = -1;
      initialRecFrame.progressRemaining = 1.0;
      initialRecFrame.newNode = true;

      // Enforce constraints for all cells.
      const handlerAccumulator = this._handlerAccumulator;
      handlerAccumulator.reset(false);
      for (let i = 0; i < this._numCells; i++) handlerAccumulator.addForCell(i);
      if (!this._enforceConstraints(initialRecFrame.gridState, handlerAccumulator)) {
        // If the initial grid is invalid, then ensure it has a zero so that the
        // initial iteration will fail.
        if (initialRecFrame.gridCells.indexOf(0) == -1) initialRecFrame.gridCells.fill(0);
      }

      if (yieldEveryStep) {
        this.setStepState({});
        yield {
          grid: initialRecFrame.gridCells,
          oldGrid: null,
          isSolution: false,
          cellOrder: [],
          values: 0,
          hasContradiction: initialRecFrame.gridCells.indexOf(0) != -1,
        }
        checkRunCounter();
        this._stepState.step = 1;
      }

      counters.nodesSearched++;
    }

    recDepth++;
    while (recDepth) {
      let recFrame = recStack[--recDepth];

      const cellDepth = recFrame.cellDepth;
      let grid = recFrame.gridCells;

      const [nextCells, value, count] =
        this._candidateSelector.selectNextCandidate(
          cellDepth, grid, this._stepState, recFrame.newNode);
      recFrame.newNode = false;
      if (count === 0) continue;

      const nextDepth = cellDepth + nextCells.length;
      // The first nextCell maybe a guess, but the rest are singletons.
      const cell = nextCells[0];
      if (yieldEveryStep) {
        this._stepState.oldGrid.set(grid);
      }

      // Assume the remaining progress is evenly distributed among the value
      // options.
      const progressDelta = recFrame.progressRemaining / count;
      recFrame.progressRemaining -= progressDelta;

      {
        // We are enforcing several values at once.
        counters.valuesTried += nextCells.length;

        iterationCounterForUpdates++;
        if ((iterationCounterForUpdates & backtrackDecayMask) === 0) {
          // Exponentially decay the counts.
          for (let i = 0; i < this._numCells; i++) {
            this._backtrackTriggers[i] >>= 1;
          }
          // Ensure that the counter doesn't overflow.
          iterationCounterForUpdates &= (1 << 30) - 1;
        }
      }

      // Determine the set of cells/constraints to enforce next.
      const handlerAccumulator = this._handlerAccumulator;
      handlerAccumulator.reset(nextDepth == this._numCells);
      for (let i = 0; i < nextCells.length; i++) {
        handlerAccumulator.addForFixedCell(nextCells[i]);
      }
      // Queue up extra constraints based on prior backtracks. The idea being
      // that constraints that apply this the contradiction cell are likely
      // to turn up a contradiction here if it exists.
      // NOTE: This must use the value of lastContradictionCell before recFrame
      //       is updated.
      if (recFrame.lastContradictionCell >= 0) {
        handlerAccumulator.addForCell(recFrame.lastContradictionCell);
      }

      if (count !== 1) {
        // We only need to start a new recursion frame when there is more than
        // one value to try.

        const oldGridState = recFrame.gridState;
        recFrame = recStack[++recDepth];
        counters.guesses++;

        // Remove the value from our set of candidates.
        // NOTE: We only have to do this because we will return back to this
        //       stack frame.
        grid[cell] ^= value;

        recFrame.gridState.set(oldGridState);
        grid = recFrame.gridCells;
      }
      // NOTE: Set this even when count == 1 to allow for other candidate
      //       selection methods.
      grid[cell] = value;

      // Propagate constraints.
      const hasContradiction = !this._enforceConstraints(
        recFrame.gridState, handlerAccumulator);
      if (hasContradiction) {
        // Store the current cells, so that the level immediately above us
        // can act on this information to run extra constraints.
        if (recDepth > 0) {
          recStack[recDepth - 1].lastContradictionCell = cell;
        }
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
          oldGrid: this._stepState.oldGrid,
          isSolution: false,
          cellOrder: this._candidateSelector.getCellOrder(cellDepth + 1),
          values: this._stepState.oldGrid[cell],
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

      // If we've enforced all cells, then we have a solution!
      if (nextDepth === this._shape.numCells) {
        counters.progressRatio += progressDelta;
        // We've set all the values, and we haven't found a contradiction.
        // This is a solution!
        counters.solutions++;
        if (this._sampleSolution[0] === 0) {
          this._sampleSolution.set(grid);
        }
        if (yieldWhen !== this.constructor.YIELD_NEVER) {
          yield {
            grid: grid,
            isSolution: true,
            cellOrder: this._candidateSelector.getCellOrder(),
            hasContradiction: false,
          };
        }
        checkRunCounter();
        continue;
      }

      // Recurse to the new cell, skipping past all the cells we enforced.
      counters.nodesSearched++;
      recFrame.cellDepth = nextDepth;
      recFrame.newNode = true;
      recFrame.progressRemaining = progressDelta;
      recFrame.lastContradictionCell = -1;
      recDepth++;
    }

    this.done = true;
  }

  solveAllPossibilities(solutions) {
    const counters = this.counters;

    const valuesInSolutions = new Uint16Array(this._numCells);

    for (const result of this.run()) {
      result.grid.forEach((c, i) => { valuesInSolutions[i] |= c; });
      solutions.push(result.grid.slice(0));

      // Once we have 2 solutions, then start ignoring branches which maybe
      // duplicating existing solution (up to this point, every branch is
      // interesting).
      if (counters.solutions == 2) {
        this._uninterestingValues = {
          valuesInSolutions: valuesInSolutions,
          lastInterestingCell: 0,
        };
      }
    }
    return valuesInSolutions;
  }

  validateLayout() {
    const originalInitialGrid = this._initialGrid.slice();
    const result = this._validateLayout(originalInitialGrid);
    this._initialGrid = originalInitialGrid;
    return result;
  }

  _validateLayout(originalInitialGrid) {
    // Choose just the house handlers.
    const houseHandlers = this._handlerSet.getAllofType(SudokuConstraintHandler.House);

    // Function to fill a house with all values.
    const fillHouse = (house) => {
      this._initialGrid.set(originalInitialGrid);
      house.cells.forEach((c, i) => this._initialGrid[c] = 1 << i);
    };

    const attemptLog = [];
    // Arbitrary search limit. Too much lower and there are some cases which get
    // stuck for too long.
    const SEARCH_LIMIT = 200;

    const finalize = (result) => {
      this.done = true;
      if (!result) return null;

      this.counters.branchesIgnored = 1 - this.counters.progressRatio;
      return SudokuSolver.Util.gridToSolution(result.grid);
    };

    // Function to attempt to solve with one house fixed.
    const attempt = (house) => {
      this._resetRun();

      fillHouse(house);
      // Reduce backtrack triggers so that we don't weight the last runs too
      // heavily.
      // TODO: Do this in a more principled way.
      for (let i = 0; i < this._numCells; i++) {
        this._backtrackTriggers[i] >>= 1;
      }

      for (const result of this.run(SEARCH_LIMIT)) {
        if (result.isSolution) {
          return result;
        }
        attemptLog.push([house, this.counters.progressRatio]);
        return undefined;
      }
      return null;
    };

    // Try doing a short search from every house.
    for (const house of houseHandlers) {
      const result = attempt(house);
      // If the search completed, then we can return the result immediately.
      if (result !== undefined) {
        return finalize(result);
      }
    }

    // None of the searches completed. Choose the house which had the most
    // progress (i.e. the search covered more of the search space), and do
    // a full search from there.

    // Find the house with the best score.
    attemptLog.sort((a, b) => b[1] - a[1]);
    const bestHouse = attemptLog[0][0];

    this._resetRun();
    fillHouse(bestHouse);

    // Run the final search until we find a solution or prove that one doesn't
    // exist.
    for (const result of this.run()) {
      return finalize(result);
    }

    return finalize(null);
  }

  setProgressCallback(callback, logFrequency) {
    this._progress.callback = callback;
    this._progress.frequencyMask = -1;
    if (callback) {
      this._progress.frequencyMask = (1 << logFrequency) - 1;
    }
  }
}

SudokuSolver.HandlerAccumulator = class {
  // NOTE: This is intended to be created once, and reused.
  constructor(handlerSet) {
    this._allHandlers = handlerSet.getAll();
    this._auxHandlers = handlerSet.getAuxHandlerMap();

    const singletonMap = handlerSet.getSingletonHandlerMap();
    this._singletonHandlers = new Uint16Array(singletonMap.length);
    for (let i = 0; i < singletonMap.length; i++) {
      const handlers = singletonMap[i];
      const index = handlers[0];
      this._singletonHandlers[i] = index;
      if (handlers.length > 1) {
        this._allHandlers[index] = new SudokuConstraintHandler.And(
          ...handlers.map(i => this._allHandlers[i]));
      }
    }

    const allOrdinaryHandlers = handlerSet.getOrdinaryHandlerMap();
    // Create a mapping of just the essential ordinary handlers.
    const essentialOrdinaryHandlers = [];
    for (let i = 0; i < allOrdinaryHandlers.length; i++) {
      const list = allOrdinaryHandlers[i];
      essentialOrdinaryHandlers.push(
        list.filter(index => this._allHandlers[index].essential));
    }

    // We have two lookups for ordinary handlers, depending on whether we want
    // to include non-essential handlers.
    this._ordinaryHandlersByEssential = [
      allOrdinaryHandlers,
      essentialOrdinaryHandlers,
    ];

    this._linkedList = new Int16Array(this._allHandlers.length);
    this._linkedList.fill(-2);  // -2 = Not in list.
    this._head = -1;  // -1 = null pointer.
    this._tail = -1;  // If list is empty, tail can be any value.

    // The index of the last handler returned by takeNext().
    // This is stored so that we can avoid adding it back to the queue while
    // it is being processed.
    this._activeHandlerIndex = -1;

    this._setSkipNonEssentialFlag(false);
  }

  // Reset and clear the accumulator.
  // If `skipNonEssential` is set then only essential handlers will be
  // accumulated. This is useful when only fixed values remain.
  reset(skipNonEssential) {
    this._setSkipNonEssentialFlag(skipNonEssential);
    this._clear();
    this.resetActiveHandler();
  }

  // Use this when we know that the list is already empty.
  resetActiveHandler() {
    this._activeHandlerIndex = -1;
  }

  // Add handlers for a fixed cell (cell with a known/single value).
  addForFixedCell(cell) {
    // Push exclusion handlers to the front of the queue.
    this._pushIndex(this._singletonHandlers[cell]);
    // Push aux handlers if we are not skipping non-essentials.
    // Aux handlers are only added when we are fixing a cell.
    if (!this._skipNonEssential) {
      this._enqueueIndexes(this._auxHandlers[cell], -1);
    }
    // Add the ordinary handlers.
    this._enqueueIndexes(this._ordinaryHandlers[cell], -1);
  }

  // Add handlers for ordinary updates to a cell.
  addForCell(cell) {
    this._enqueueIndexes(
      this._ordinaryHandlers[cell],
      this._activeHandlerIndex);
  }

  _setSkipNonEssentialFlag(skipNonEssential) {
    this._skipNonEssential = !!skipNonEssential;
    this._ordinaryHandlers = this._ordinaryHandlersByEssential[
      +this._skipNonEssential];
  }

  _clear() {
    const ll = this._linkedList;
    let head = this._head;
    while (head >= 0) {
      const newHead = ll[head];
      ll[head] = -2;
      head = newHead;
    }
    this._head = -1;
  }


  // Enqueue indexes to the back of the queue.
  _enqueueIndexes(indexes, ignore) {
    const numHandlers = indexes.length;
    for (let j = 0; j < numHandlers; j++) {
      const i = indexes[j];
      if (i === ignore || this._linkedList[i] !== -2) continue;

      if (this._head == -1) {
        this._head = i;
      } else {
        this._linkedList[this._tail] = i;
      }
      this._tail = i;
      this._linkedList[i] = -1;
    }
  }

  // Push an index to the front of the queue.
  _pushIndex(index) {
    if (this._linkedList[index] < -1) {
      if (this._head == -1) {
        this._tail = index;
      }
      this._linkedList[index] = this._head;
      this._head = index;
    }
  }

  isEmpty() {
    return this._head == -1;
  }

  takeNext() {
    const oldHead = this._head;
    this._head = this._linkedList[oldHead];
    this._linkedList[oldHead] = -2;
    this._activeHandlerIndex = oldHead;

    return this._allHandlers[oldHead];
  }
}

SudokuSolver.DummyHandlerAccumulator = class {
  addForCell(cell) { }
}

SudokuSolver.CellExclusions = class {
  constructor(handlerSet, shape) {
    this._cellExclusionSets = [];
    if (handlerSet !== null) {
      this._cellExclusionSets = this.constructor._makeCellExclusionSets(
        handlerSet, shape);
    }

    this._cellExclusionArrays = [];

    // Indexing of pairs:
    //   pairExclusions[(i << 8) | j] = [cells which are excluded by both i and j]
    this._pairExclusions = new Map();
    // Indexing of lists:
    //   listExclusions[obj] = [cells which are excluded by all cells in obj]
    //   obj must match exactly.
    this._listExclusions = new Map();
  }

  clone() {
    const clone = new SudokuSolver.CellExclusions(null, null);
    clone._cellExclusionSets = this._cellExclusionSets.map(s => new Set(s));
    return clone;
  }

  static _makeCellExclusionSets(handlerSet, shape) {
    const cellExclusionSets = [];
    for (let i = 0; i < shape.numCells; i++) {
      cellExclusionSets.push(new Set());
    }

    for (const h of handlerSet) {
      const exclusionCells = h.exclusionCells();
      for (const c of exclusionCells) {
        for (const d of exclusionCells) {
          if (c != d) cellExclusionSets[c].add(d);
        }
      }
    }

    return cellExclusionSets;
  }

  addMutualExclusion(cell1, cell2) {
    if (this._cellExclusionArrays.length > 0) {
      throw ('Cannot add exclusions after caching.');
    }
    this._cellExclusionSets[cell1].add(cell2);
  }

  isMutuallyExclusive(cell1, cell2) {
    return this._cellExclusionSets[cell1].has(cell2);
  }

  getArray(cell) {
    if (this._cellExclusionArrays.length === 0) {
      // Store an array version for fast iteration.
      // Sort the cells so they are in predictable order.
      this._cellExclusionArrays = (
        this._cellExclusionSets.map(c => [...c]));
      this._cellExclusionArrays.forEach(c => c.sort((a, b) => a - b));
    }

    return this._cellExclusionArrays[cell];
  }

  getPairExclusions(pairIndex) {
    let result = this._pairExclusions.get(pairIndex);
    if (result === undefined) {
      result = this._computePairExclusions(pairIndex >> 8, pairIndex & 0xff);
      this._pairExclusions.set(pairIndex, result);
    }

    return result;
  }

  getListExclusions(cells) {
    let result = this._listExclusions.get(cells);
    if (result === undefined) {
      result = this._computeListExclusions(cells);
      this._listExclusions.set(cells, result);
    }
    return result;
  }

  _computeListExclusions(cells) {
    const numCells = cells.length;

    // Find the intersection of all exclusions.
    let allCellExclusions = [...this._cellExclusionSets[cells[0]]];
    for (let i = 1; i < numCells && allCellExclusions.length; i++) {
      allCellExclusions = setIntersectionToArray(
        this._cellExclusionSets[cells[i]], allCellExclusions);
    }

    return allCellExclusions;
  }

  _computePairExclusions(cell0, cell1) {
    // If we've cached the reverse order, then use that.
    const revKey = (cell1 << 8) | cell0;
    if (this._pairExclusions.has(revKey)) {
      return this._pairExclusions.get(revKey);
    }

    // Otherwise, calculate the intersection.
    return setIntersectionToArray(
      this._cellExclusionSets[cell0],
      this._cellExclusionSets[cell1]);
  }
}

SudokuSolver.ExtraStateProvider = class {
  _totalSize = 0;

  constructor(numCells) {
    this._offset = numCells;
  }

  allocate(size) {
    const start = this._totalSize + this._offset;
    this._totalSize += size;
    return start;
  }

  totalSize() {
    return this._totalSize;
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

  static maxValue(v) {
    return 32 - Math.clz32(v);
  };

  static minValue(v) {
    return 32 - Math.clz32(v & -v);
  };

  // Combines min and max into a single integer:
  // Layout: [min: 16 bits, max: 16 bits]
  // The extra bits allow these values to be summed to determine the total
  // of mins and maxs.
  // 16-bits ensures we won't overflow.
  // (Since we only support 16x16 grids,the max sum is 16*16*16 = 4096)
  static minMax16bitValue(v) {
    return 0x200020 - (Math.clz32(v & -v) << 16) - Math.clz32(v);
  }

  static valueRangeInclusive(v) {
    return (1 << (32 - Math.clz32(v))) - (v & -v);
  };

  static valueRangeExclusive(v) {
    return (1 << (31 - Math.clz32(v))) - ((v & -v) << 1);
  };

  static toIndex(v) {
    return 31 - Math.clz32(v);
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

    // Combines useful info about the range of numbers in a cell.
    // Designed to be summed, so that the aggregate stats can be found.
    // Layout: [isFixed: 4 bits, fixed: 8 bits, min: 8 bits, max: 8 bits]
    //
    // Sum of isFixed gives the number of fixed cells.
    // Sum of fixed gives the sum of fixed cells.
    this.rangeInfo = (() => {
      const table = new Uint32Array(combinations);
      for (let i = 1; i < combinations; i++) {
        const max = LookupTables.maxValue(i);
        const min = LookupTables.minValue(i);
        const fixed = (i & (i - 1)) ? 0 : LookupTables.toValue(i);
        const isFixed = fixed ? 1 : 0;
        table[i] = ((isFixed << 24) | (fixed << 16) | (min << 8) | max);
      }
      // If there are no values, set a high value for isFixed to indicate the
      // result is invalid. This is intended to be detectable after summing.
      table[0] = numValues << 24;
      return table;
    })();

    this.reverse = (() => {
      let table = new Uint16Array(combinations);
      for (let i = 1; i <= numValues; i++) {
        table[LookupTables.fromValue(i)] =
          LookupTables.fromValue(numValues + 1 - i);
      }
      for (let i = 1; i < combinations; i++) {
        table[i] = table[i & (i - 1)] | table[i & -i];
      }
      return table;
    })();

    const NUM_BITS_BASE64 = 6;
    const keyArr = new Uint8Array(
      Base64Codec.lengthOf6BitArray(numValues * numValues));

    this.forBinaryKey = memoize((key) => {
      const table = new Uint16Array(combinations);
      const tableInv = new Uint16Array(combinations);

      keyArr.fill(0);
      Base64Codec.decodeTo6BitArray(key, keyArr);

      // Populate base cases, where there is a single value set.
      let keyIndex = 0;
      let vIndex = 0;
      for (let i = 0; i < numValues; i++) {
        for (let j = 0; j < numValues; j++) {
          const v = keyArr[keyIndex] & 1;
          table[1 << i] |= v << j;
          tableInv[1 << j] |= v << i;

          keyArr[keyIndex] >>= 1;
          if (++vIndex == NUM_BITS_BASE64) {
            vIndex = 0;
            keyIndex++;
          }
        }
      }

      // To fill in the rest, OR together all the valid settings for each value
      // set.
      for (let i = 1; i < combinations; i++) {
        table[i] = table[i & (i - 1)] | table[i & -i];
        tableInv[i] = tableInv[i & (i - 1)] | tableInv[i & -i];
      }
      return [table, tableInv];
    });
  }
}