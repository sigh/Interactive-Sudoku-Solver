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
      const diff = SudokuSolver.Util.gridDifference(
        result.oldGrid, result.grid);
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

    let valuesInSolutions = new Uint16Array(this._shape.numCells);
    let solutions = [];

    // Send the current values with the progress update, if there have
    // been any changes.
    this._progressExtraStateFn = () => {
      if (!solutions.length) return null;
      return {
        solutions: solutions.splice(0).map(
          s => SudokuSolver.Util.gridToSolution(s)),
      };
    };

    this._timer.runTimed(() => {
      this._internalSolver.solveAllPossibilities(solutions, valuesInSolutions);
    });

    // Send progress one last time to ensure all the solutions are sent.
    this._sendProgress();
    this._progressExtraStateFn = null;

    return SudokuSolver.Util.makePencilmarks(valuesInSolutions);
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

  static gridDifference(gridA, gridB) {
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

    this._recStack = this._initStack();
    {
      this._initialGrid = this._recStack[0].grid.slice();
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
    this._candidateSelector = new SudokuSolver.CandidateSelector(
      shape, this._handlerSet, debugLogger);

    this._cellPriorities = this._initCellPriorities();

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
      handlerSet.addExclusionHandlers(
        new SudokuConstraintHandler.UniqueValueExclusion(i));
    }

    // Initialize handlers.
    for (const handler of handlerSet) {
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
    // We need to check all cells because we maybe validating a cell above
    // us, or finding a value for a cell below us.
    for (let cell = 0; cell < this._numCells; cell++) {
      if (grid[cell] & ~uninterestingValues[cell]) return true;
    }
    return false;
  }

  static _debugGridBuffer = new Uint16Array(SHAPE_MAX.numCells);

  _debugEnforceConsistency(loc, grid, handler, handlerAccumulator) {
    const oldGrid = this.constructor._debugGridBuffer.subarray(0, grid.length);
    oldGrid.set(grid);

    const result = handler.enforceConsistency(grid, handlerAccumulator);

    if (!arraysAreEqual(oldGrid, grid)) {
      const diff = {};
      const candidates = new Array(grid.length);
      candidates.fill(null);
      for (let i = 0; i < grid.length; i++) {
        if (oldGrid[i] != grid[i]) {
          candidates[i] = LookupTables.toValuesArray(oldGrid[i] & ~grid[i]);
          diff[this._shape.makeCellIdFromIndex(i)] = candidates[i];
        }
      }

      this._debugLogger.log({
        loc: loc,
        msg: `${handler.constructor.name} removed: `,
        args: diff,
        cells: handler.cells,
        candidates: candidates,
      });
    } else if (this._debugLogger.logLevel >= 2) {
      this._debugLogger.log({
        loc: loc,
        msg: `${handler.constructor.name} ran`,
        cells: handler.cells,
      }, 2);
    }
    if (!result) {
      this._debugLogger.log({
        loc: loc,
        msg: `${handler.constructor.name} returned false`,
        cells: handler.cells,
      });
    }

    return result;
  }

  _enforceConstraints(grid, handlerAccumulator) {
    const counters = this.counters;
    const logSteps = this._debugLogger.enableStepLogs;

    while (!handlerAccumulator.isEmpty()) {
      const c = handlerAccumulator.takeNext();
      counters.constraintsProcessed++;
      if (logSteps) {
        if (!this._debugEnforceConsistency('_enforceConstraints', grid, c, handlerAccumulator)) {
          return false;
        }
      } else {
        if (!c.enforceConsistency(grid, handlerAccumulator)) {
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

    const gridBuffer = new ArrayBuffer(
      (numCells + 1) * numCells * Uint16Array.BYTES_PER_ELEMENT);

    const recStack = [];
    for (let i = 0; i < numCells + 1; i++) {
      recStack.push({
        cellDepth: 0,
        progressRemaining: 1.0,
        lastContradictionCell: -1,
        newNode: true,
        grid: new Uint16Array(
          gridBuffer,
          i * numCells * Uint16Array.BYTES_PER_ELEMENT,
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
      initialRecFrame.grid.set(this._initialGrid);
      initialRecFrame.cellDepth = 0;
      initialRecFrame.lastContradictionCell = -1;
      initialRecFrame.progressRemaining = 1.0;
      initialRecFrame.newNode = true;

      // Enforce constraints for all cells.
      const handlerAccumulator = this._handlerAccumulator;
      handlerAccumulator.reset(false);
      for (let i = 0; i < this._numCells; i++) handlerAccumulator.addForCell(i);
      this._enforceConstraints(initialRecFrame.grid, handlerAccumulator);

      if (yieldEveryStep) {
        this.setStepState({});
        yield {
          grid: initialRecFrame.grid,
          oldGrid: null,
          isSolution: false,
          cellOrder: [],
          values: 0,
          hasContradiction: false,
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
      let grid = recFrame.grid;

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

        recFrame = recStack[++recDepth];
        counters.guesses++;

        // Remove the value from our set of candidates.
        // NOTE: We only have to do this because we will return back to this
        //       stack frame.
        grid[cell] ^= value;

        recFrame.grid.set(grid);
        grid = recFrame.grid;
      }
      // NOTE: Set this even when count == 1 to allow for other candidate
      //       selection methods.
      grid[cell] = value;

      // Propagate constraints.
      const hasContradiction = !this._enforceConstraints(
        grid, handlerAccumulator);
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

    this._resetRun();
    fillHouse(bestHouse);

    // Run the final search until we find a solution or prove that one doesn't
    // exist.
    let result = false;
    for (const _ of this.run()) { result = true; break; }

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
  constructor(shape, handlerSet, debugLogger) {
    this._shape = shape;
    this._cellOrder = new Uint8Array(shape.numCells);
    this._backtrackTriggers = null;
    this._debugLogger = debugLogger;

    this._candidateSelectionStates = this._initCandidateSelectionStates(shape);
    // _candidateSelectionFlags is used to track whether the
    // _candidateSelectionStates entry is valid.
    this._candidateSelectionFlags = new Uint8Array(shape.numCells);

    const houseHandlerSet = new HandlerSet(
      handlerSet.getAllofType(SudokuConstraintHandler.House), shape);
    this._houseHandlerAccumulator = new SudokuSolver.HandlerAccumulator(
      houseHandlerSet);
  }

  reset(backtrackTriggers) {
    // Re-initialize the cell indexes in the cellOrder.
    // This is not required, but keeps things deterministic.
    const numCells = this._cellOrder.length;
    for (let i = 0; i < numCells; i++) {
      this._cellOrder[i] = i;
    }

    this._backtrackTriggers = backtrackTriggers;

    this._candidateSelectionFlags.fill(0);
  }

  getCellOrder(upto) {
    if (upto === undefined) return this._cellOrder;
    return this._cellOrder.subarray(0, upto);
  }

  // selectNextCandidate find the next candidate to try.
  // Returns [nextCells, value, count]:
  //   nextCells[0]: The cell which contains the next candidate.
  //   value: The candidate value in the nextCells[0].
  //   count: The number of options we selected from:
  //      - If `count` == 1, then this is a known value and the solver will
  //        not return to this node.
  //      - Most of the time, `count` will equal the number of values in
  //        nextCells[0], but it may be less if we are branching on something
  //        other than the cell (e.g. a digit within a house).
  //   nextCells[1:]: Singleton cells which can be enforced at the same time.
  selectNextCandidate(cellDepth, grid, stepState, isNewNode) {
    const cellOrder = this._cellOrder;
    let [cellOffset, value, count] = this._selectBestCandidate(
      grid, cellOrder, cellDepth, isNewNode);

    // Adjust the value for step-by-step.
    if (stepState) {
      if (this._debugLogger.enableStepLogs) {
        this._logSelectNextCandidate(
          'Best candidate:', cellOrder[cellOffset], value, count, cellDepth);
      }

      let adjusted = false;
      [cellOffset, value, adjusted] = this._adjustForStepState(
        stepState, grid, cellOrder, cellDepth, cellOffset, value);

      if (adjusted) {
        count = countOnes16bit(grid[cellOrder[cellOffset]]);
        this._candidateSelectionFlags[cellDepth] = 0;
        if (this._debugLogger.enableStepLogs) {
          this._logSelectNextCandidate(
            'Adjusted by user:', cellOrder[cellOffset], value, count, cellDepth);
        }
      }
    }

    const nextCellDepth = this._updateCellOrder(
      cellDepth, cellOffset, count, grid);

    if (this._debugLogger.enableStepLogs) {
      if (nextCellDepth != cellDepth + 1) {
        this._debugLogger.log({
          loc: 'selectNextCandidate',
          msg: 'Found extra singles',
          args: {
            count: nextCellDepth - cellDepth - 1,
          },
          cells: cellOrder.subarray(cellDepth + 1, nextCellDepth),
        });
      }
    }

    return [cellOrder.subarray(cellDepth, nextCellDepth), value, count];
  }

  _updateCellOrder(cellDepth, cellOffset, count, grid) {
    const cellOrder = this._cellOrder;
    let frontOffset = cellDepth;

    // Swap cellOffset into the next position, so that it will be processed
    // next.
    [cellOrder[cellOffset], cellOrder[frontOffset]] =
      [cellOrder[frontOffset], cellOrder[cellOffset]];
    frontOffset++;
    cellOffset++;

    // If count was greater than 1, there were no singletons.
    if (count > 1) return frontOffset;

    // Move all singletons to the front of the cellOrder.
    const numCells = grid.length;

    // First skip past any values which are already at the front.
    while (cellOffset == frontOffset && cellOffset < numCells) {
      const v = grid[cellOrder[cellOffset++]];
      if (!(v & (v - 1))) frontOffset++;
    }

    // Find the rest of the values which are singletons.
    while (cellOffset < numCells) {
      const v = grid[cellOrder[cellOffset]];
      if (!(v & (v - 1))) {
        [cellOrder[cellOffset], cellOrder[frontOffset]] =
          [cellOrder[frontOffset], cellOrder[cellOffset]];
        frontOffset++;
      }
      cellOffset++;
    }

    return frontOffset;
  }

  _logSelectNextCandidate(msg, cell, value, count, cellDepth) {
    this._debugLogger.log({
      loc: 'selectNextCandidate',
      msg: msg,
      args: {
        cell: this._shape.makeCellIdFromIndex(cell),
        value: LookupTables.toValue(value),
        numOptions: count,
        cellDepth: cellDepth,
        state: (
          this._candidateSelectionFlags[cellDepth] ?
            this._candidateSelectionStates[cellDepth] : null),
      },
      cells: [cell],
    });
  }

  _selectBestCandidate(grid, cellOrder, cellDepth, isNewNode) {
    // If we have a special candidate state, then use that.
    // It will always be a singleton.
    if (this._candidateSelectionFlags[cellDepth]) {
      const state = this._candidateSelectionStates[cellDepth];
      this._candidateSelectionFlags[cellDepth] = 0;
      return [cellOrder.indexOf(state.cell1), state.value, 1];
    }

    // Quick check - if the first value is a singleton, then just return without
    // the extra bookkeeping.
    {
      const firstValue = grid[cellOrder[cellDepth]];
      if ((firstValue & (firstValue - 1)) === 0) {
        return [cellDepth, firstValue, firstValue !== 0 ? 1 : 0];
      }
    }

    // Find the best cell to explore next.
    let cellOffset = this._selectBestCell(grid, cellOrder, cellDepth);
    const cell = cellOrder[cellOffset];

    // Find the next smallest value to try.
    // NOTE: We will always have a value because:
    //        - we would have returned earlier on domain wipeout.
    //        - we don't add to the stack on the final value in a cell.
    let values = grid[cell];
    let value = values & -values;
    let count = countOnes16bit(values);

    // Consider branching on a single digit within a house. Only to this if we
    // are:
    //  - Exploring this node for the first time. If we have backtracked here
    //    it is less likely that this will yield a better candidate.
    //  - Currently exploring a cell with more than 2 values.
    //  - Have non-zero backtrackTriggers (and thus score).
    if (isNewNode && count > 2 && this._backtrackTriggers[cell] > 0) {
      const score = this._backtrackTriggers[cell] / count;

      const state = this._candidateSelectionStates[cellDepth];
      if (this._findCandidatesByHouse(grid, score, state)) {
        count = 2;
        value = state.value;
        cellOffset = cellOrder.indexOf(state.cell0);
        this._candidateSelectionFlags[cellDepth] = 1;
      }
    }

    return [cellOffset, value, count];
  }

  _selectBestCell(grid, cellOrder, cellDepth) {
    // Choose cells based on value count and number of backtracks it caused.
    // NOTE: The constraint handlers are written such that they detect domain
    // wipeouts (0 values), so we should never find them here. Even if they
    // exist, it just means we do a few more useless forced cell resolutions.
    // NOTE: If the scoring is more complicated, it can be useful
    // to do an initial pass to detect 1 or 0 value cells (!(v&(v-1))).

    const numCells = grid.length;
    const backtrackTriggers = this._backtrackTriggers;

    // Find the cell with the minimum score.
    let maxScore = -1;
    let bestOffset = 0;

    for (let i = cellDepth; i < numCells; i++) {
      const cell = cellOrder[i];
      const count = countOnes16bit(grid[cell]);
      // If we have a single value then just use it - as it will involve no
      // guessing.
      // NOTE: We could use more efficient check for count() < 1, but it's not
      // worth it as this only happens at most once per loop. The full count()
      // will have to occur anyway for every other iteration.
      if (count <= 1) {
        bestOffset = i;
        maxScore = -1;
        break;
      }

      let score = backtrackTriggers[cell] / count;

      if (score > maxScore) {
        bestOffset = i;
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
      bestOffset = this._minCountCellIndex(grid, cellOrder, cellDepth);
    }

    return bestOffset;
  }

  // Find the cell index with the minimum score. Return the index into cellOrder.
  _minCountCellIndex(grid, cellOrder, cellDepth) {
    let minCount = 1 << 16;
    let bestOffset = 0;
    for (let i = cellDepth; i < grid.length; i++) {
      const count = countOnes16bit(grid[cellOrder[i]]);
      if (count < minCount) {
        bestOffset = i;
        minCount = count;
      }
    }
    return bestOffset;
  }

  _adjustForStepState(stepState, grid, cellOrder, cellDepth, cellOffset, value) {
    const step = stepState.step;
    const guide = stepState.stepGuides.get(step) || {};
    let adjusted = false;

    // If there is a cell guide, then use that.
    if (guide.cell) {
      const newCellOffset = cellOrder.indexOf(guide.cell, cellDepth);
      if (newCellOffset !== -1) {
        cellOffset = newCellOffset;
        adjusted = true;
      }
    }

    const cellValues = grid[cellOrder[cellOffset]];

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

    return [cellOffset, value, adjusted];
  }

  _findCandidatesByHouse(grid, score, result) {
    const numCells = grid.length;
    // Determine the minimum value that backtrackTriggers can take to beat the
    // current score.
    const minBt = Math.ceil(score * 2) | 0;

    // Add all handlers with cells which can potentially beat the current score.
    const backtrackTriggers = this._backtrackTriggers;
    const handlerAccumulator = this._houseHandlerAccumulator;
    handlerAccumulator.resetActiveHandler();
    for (let i = 0; i < numCells; i++) {
      if (backtrackTriggers[i] >= minBt) {
        const v = grid[i];
        if (v & (v - 1)) {
          handlerAccumulator.addForCell(i);
        }
      }
    }

    // Subtract 1 so that we will replace the result if the score is equal.
    result.bt = minBt - 1;

    // Find all candidates with exactly two values.
    while (!handlerAccumulator.isEmpty()) {
      const handler = handlerAccumulator.takeNext();
      const cells = handler.cells;
      const numCells = cells.length;

      let allValues = 0;
      let moreThanOne = 0;
      let moreThanTwo = 0;
      for (let i = 0; i < numCells; i++) {
        const v = grid[cells[i]];
        moreThanTwo |= moreThanOne & v;
        moreThanOne |= allValues & v;
        allValues |= v;
      }

      let exactlyTwo = moreThanOne & ~moreThanTwo;
      while (exactlyTwo) {
        let v = exactlyTwo & -exactlyTwo;
        exactlyTwo ^= v;
        this._scoreHouseCandidateValue(grid, cells, v, result);
      }
    }

    return result.bt >= minBt;
  }

  _scoreHouseCandidateValue(grid, cells, v, bestResult) {
    let numCells = cells.length;
    let cell0 = 0;
    let cell1 = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & v) {
        [cell0, cell1] = [cell1, cells[i]];
      }
    }

    let bt0 = this._backtrackTriggers[cell0];
    let bt1 = this._backtrackTriggers[cell1];

    // If either of the cells beat the current score.
    if (bt0 > bestResult.bt || bt1 > bestResult.bt) {
      // Make bt0 the larger of the two.
      // Also make cell0 the cell with the larger backtrack trigger, since cell0
      // is searched first. NOTE: This turns out ot be a bit faster, but means
      // we usually find the solution later in the search.
      if (bt0 < bt1) {
        [bt0, bt1] = [bt1, bt0];
        [cell0, cell1] = [cell1, cell0];
      }

      bestResult.bt = bt0; // max(bt[cell_i])
      bestResult.value = v;
      bestResult.cell0 = cell0;
      bestResult.cell1 = cell1;
    }
  }

  // This needs to match the fields populated by _scoreHouseCandidateValue.
  _initCandidateSelectionStates(shape) {
    const candidateSelectionStates = [];
    for (let i = 0; i < shape.numCells; i++) {
      candidateSelectionStates.push({
        bt: 0,
        value: 0,
        cell0: 0,
        cell1: 0
      });
    }
    return candidateSelectionStates;
  }
}

SudokuSolver.HandlerAccumulator = class {
  // NOTE: This is intended to be created once, and reused.
  constructor(handlerSet) {
    this._allHandlers = handlerSet.getAll();
    this._auxHandlers = handlerSet.getAuxHandlerMap();
    this._exclusionHandlers = new Uint16Array(
      handlerSet.getExclusionHandlerMap());

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
    this._pushIndex(this._exclusionHandlers[cell]);
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

SudokuSolver.CellExclusions = class {
  constructor(handlerSet, shape) {
    this._cellExclusionSets = this.constructor._makeCellExclusionSets(
      handlerSet, shape);

    // Store an array version for fast iteration.
    // Sort the cells so they are in predictable order.
    this._cellExclusionArrays = (
      this._cellExclusionSets.map(c => new Uint8Array(c)));
    this._cellExclusionArrays.forEach(c => c.sort((a, b) => a - b));

    // Indexing of pairs:
    //   pairExclusions[(i << 8) | j] = [cells which are excluded by both i and j]
    this._pairExclusions = new Map();
    // Indexing of lists:
    //   listExclusions[obj] = [cells which are excluded by all cells in obj]
    //   obj must match exactly.
    this._listExclusions = new Map();
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

  isMutuallyExclusive(cell1, cell2) {
    return this._cellExclusionSets[cell1].has(cell2);
  }

  getArray(cell) {
    return this._cellExclusionArrays[cell];
  }

  getPairExclusions(pairIndex) {
    return this._pairExclusions.get(pairIndex);
  }

  getListExclusions(cells) {
    return this._listExclusions.get(cells);
  }

  cacheCellTuples(cells) {
    const numCells = cells.length;

    for (let i = 0; i < numCells; i++) {
      for (let j = i + 1; j < numCells; j++) {
        this._cachePair(cells[i], cells[j]);
      }
    }

    this.cacheCellList(cells);
  }

  cacheCellList(cells) {
    const numCells = cells.length;

    // Find the intersection of all exclusions.
    let allCellExclusions = this._cellExclusionSets[cells[0]];
    for (let i = 1; i < numCells && allCellExclusions.size; i++) {
      allCellExclusions = setIntersection(
        allCellExclusions, this._cellExclusionSets[cells[i]]);
    }

    // Only add it if it's not empty.
    if (allCellExclusions.size) {
      this._listExclusions.set(cells, new Uint8Array(allCellExclusions));
    }
  }

  _cachePair(cell0, cell1) {
    const key = (cell0 << 8) | cell1;

    // Check if we've already cached the pair.
    if (this._pairExclusions.has(key)) return;

    // If we've cached the reverse order, then use that.
    const revKey = (cell1 << 8) | cell0;
    if (this._pairExclusions.has(revKey)) {
      this._pairExclusions.set(key, this._pairExclusions.get(revKey));
      return;
    }

    // Otherwise, calculate the intersection.
    const exclusionSet = setIntersection(
      this._cellExclusionSets[cell0],
      this._cellExclusionSets[cell1]);
    this._pairExclusions.set(key, new Uint8Array(exclusionSet));

    return;
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