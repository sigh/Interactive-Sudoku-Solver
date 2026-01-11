"use strict";

const { Timer, IteratorWithCount, arraysAreEqual, setIntersectionToArray, BitSet } = await import('../util.js' + self.VERSION_PARAM);
const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SHAPE_MAX } = await import('../grid_shape.js' + self.VERSION_PARAM);
const { SudokuConstraintOptimizer } = await import('./optimizer.js' + self.VERSION_PARAM);
const { CandidateSelector, SamplingCandidateSelector, ConflictScores, SeenCandidateSet } = await import('./candidate_selector.js' + self.VERSION_PARAM);
const HandlerModule = await import('./handlers.js' + self.VERSION_PARAM);

export class SudokuSolver {
  constructor(handlers, shape, debugOptions) {
    this._debugLogger = new DebugLogger(this, debugOptions);
    this._shape = shape;

    this._internalSolver = new InternalSolver(
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
    return this._runCountFn(() => {
      this._internalSolver.run(InternalSolver.YIELD_NEVER).next();
      return this._internalSolver.counters.solutions;
    });
  }

  estimatedCountSolutions() {
    const estimationCounters = {
      solutions: 0,
      samples: 0,
    };
    return this._runCountFn(() => {
      return this._internalSolver.estimatedCountSolutions(estimationCounters);
    }, estimationCounters);
  }

  _runCountFn(countFn, estimationCounters) {
    this._reset();

    // Add a sample solution to the state updates, but only if a different
    // solution is ready.
    this._internalSolver.unsetSampleSolution();
    this._progressExtraStateFn = () => {
      const sampleSolution = this._internalSolver.getSampleSolution();
      let result = {};
      if (sampleSolution) {
        result.solutions = [SudokuSolverUtil.gridToSolution(sampleSolution)];
        this._internalSolver.unsetSampleSolution();
      }
      if (estimationCounters) {
        result.estimate = { ...estimationCounters };
      }
      return result;
    };

    let result = 0;
    this._timer.runTimed(() => {
      result = countFn();
    });

    // Send progress one last time to ensure the last solution is sent.
    this._sendProgress();

    this._progressExtraStateFn = null;

    return result;
  }

  nthSolution(n) {
    let result = this._nthIteration(n, false);
    if (!result) return null;

    return SudokuSolverUtil.gridToSolution(result.grid);
  }

  nthStep(n, stepGuides) {
    const result = this._nthIteration(n, stepGuides);
    if (!result) return null;

    const pencilmarks = SudokuSolverUtil.makePencilmarks(result.grid);
    for (const cell of result.cellOrder) {
      pencilmarks[cell] = LookupTables.toValue(result.grid[cell]);
    }

    let diffPencilmarks = null;
    if (result.oldGrid) {
      SudokuSolverUtil.removeGridValues(result.oldGrid, result.grid);
      diffPencilmarks = SudokuSolverUtil.makePencilmarks(result.oldGrid);
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

  solveAllPossibilities(candidateSupportThreshold) {
    this._reset();

    const solutions = [];

    // Send the current values with the progress update, if there have
    // been any changes.
    this._progressExtraStateFn = () => {
      if (!solutions.length) return null;
      return {
        solutions: solutions.splice(0).map(
          s => SudokuSolverUtil.gridToSolution(s)),
      };
    };

    let result = null;
    this._timer.runTimed(() => {
      result = this._internalSolver.solveAllPossibilities(
        solutions, candidateSupportThreshold || 1);
    });

    // Send progress one last time to ensure all the solutions are sent.
    this._sendProgress();
    this._progressExtraStateFn = null;

    return result;
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

  debugLogger() {
    return this._debugLogger;
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
            ? InternalSolver.YIELD_ON_STEP
            : InternalSolver.YIELD_ON_SOLUTION))
      };
    }

    return this._iter.iter;
  }
}

class SudokuSolverUtil {
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

class DebugLogger {
  constructor(solver, debugOptions) {
    this._solver = solver;
    this._debugOptions = {
      logLevel: 0,
      enableStepLogs: false,
      exportConflictHeatmap: false,
      exportStackTrace: false,
    };
    this._hasAnyDebugging = false;
    this._pendingDebugLogs = [];
    this._adhHocCounters = new Map();

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

  setCounter(name, value) {
    this._adhHocCounters.set(name, value);
  }

  incCounter(name, value) {
    if (value === undefined) value = 1;
    this._adhHocCounters.set(
      name, (this._adhHocCounters.get(name) || 0) + value);
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
    if (this._debugOptions.exportConflictHeatmap) {
      result.conflictHeatmap =
        this._solver._internalSolver.getConflictScores().scores.slice();
    }
    if (this._debugOptions.exportStackTrace) {
      const stackTrace = this._solver._internalSolver.getStackTrace();
      result.stackTrace = stackTrace;
    }
    if (this._adhHocCounters.size) {
      result.counters = this._adhHocCounters;
    }
    return result;
  }
};

class InternalSolver {

  constructor(handlerGen, shape, debugLogger) {
    this._shape = shape;
    this._numCells = this._shape.numCells;
    this._debugLogger = debugLogger;

    this._runCounter = 0;
    this._progress = {
      frequencyMask: -1,
      callback: null,
    };

    this._handlerSet = this._setUpHandlers(Array.from(handlerGen));

    this._seenCandidateSet = new SeenCandidateSet(shape.numCells, shape.numValues);

    this._handlerAccumulator = new HandlerAccumulator(this._handlerSet);
    this._candidateSelector = new CandidateSelector(
      shape, this._handlerSet, debugLogger, this._seenCandidateSet);

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

    for (const handler of this._handlerSet.getAllofType(HandlerModule.Priority)) {
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
    const cellExclusions = new CellExclusions(
      handlerSet, this._shape);

    // Optimize handlers.
    new SudokuConstraintOptimizer(this._debugLogger).optimize(
      handlerSet, cellExclusions, this._shape);

    // Add the exclusion handlers.
    for (let i = 0; i < this._numCells; i++) {
      handlerSet.addSingletonHandlers(
        new HandlerModule.UniqueValueExclusion(i));
    }

    const stateAllocator = new GridStateAllocator(this._shape);

    // Initialize handlers.
    for (const handler of handlerSet) {
      const initialCells = handler.cells;
      if (!handler.initialize(stateAllocator.mutableGridCells(), cellExclusions, this._shape, stateAllocator)) {
        if (this._debugLogger.enableLogs) {
          this._debugLogger.log({
            loc: '_setUpHandlers',
            msg: handler.constructor.name + ' returned false',
            cells: handler.cells,
          });
        }

        stateAllocator.invalidateGrid(handler);
      }

      if (initialCells !== handler.cells) {
        handlerSet.updateCells(
          handlerSet.getIndex(handler),
          initialCells,
          handler.cells);
      }
    }

    this._initialGridState = stateAllocator.makeGridState();

    for (const handler of handlerSet) {
      handler.postInitialize(this._initialGridState);
    }

    return handlerSet;
  }

  reset() {
    this._iter = null;
    this._stepState = null;
    this._currentRecFrame = null;
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

    // _conflictScores are initialized to the cell priorities so that
    // so that the initial part of the search is still able to prioritize cells
    // which may lead to a contradiction.
    // NOTE: _conflictScores must not be reassigned as we pass the reference
    // to the candidateSelector.
    this._conflictScores = new ConflictScores(
      this._cellPriorities,
      this._shape.numValues);
    this._seenCandidateSet.reset();

    // Setup sample solution in a set state, so that by default we don't
    // populate it.
    this._sampleSolution = this._initialGridState.slice(0, this._numCells);

    this._resetRun();
  }

  _resetRun() {
    // Preserve conflict scores between runs (since this is currently only
    // used internally).
    // Candidate selector must be made aware of the new conflict scores.
    this._candidateSelector.reset(this._conflictScores);

    this.done = false;
    this._atStart = true;
  }

  static _debugValueBuffer = new Uint16Array(SHAPE_MAX.numCells);
  getStackTrace() {
    if (this._atStart || this.done || !this._currentRecFrame) return null;

    const stackFrame = this._currentRecFrame;
    const cellDepth = stackFrame.cellDepth;
    const values = this.constructor._debugValueBuffer.subarray(0, cellDepth);

    const cells = this._candidateSelector.getCellOrder(cellDepth);
    for (let i = 0; i < cellDepth; i++) {
      values[i] = LookupTables.toValue(stackFrame.gridCells[cells[i]]);
    }

    return { cells, values };
  }

  _setCandidateSelector(selector) {
    this._candidateSelector = selector;
  }

  getConflictScores() {
    return this._conflictScores;
  }

  getSampleSolution() {
    return this._sampleSolution[0] ? this._sampleSolution : null;
  }

  unsetSampleSolution() {
    this._sampleSolution[0] = 0;
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
    const gridStateSize = this._initialGridState.length;

    const stateBuffer = new ArrayBuffer(
      (numCells + 1) * gridStateSize * Uint16Array.BYTES_PER_ELEMENT);

    const recStack = [];
    for (let i = 0; i < numCells + 1; i++) {
      recStack.push({
        cellDepth: 0,
        progressRemaining: 1.0,
        lastContradictionCell: -1,
        newNode: true,
        gridState: new Uint16Array(
          stateBuffer,
          i * gridStateSize * Uint16Array.BYTES_PER_ELEMENT,
          gridStateSize),
        // Grid is a subset of state.
        gridCells: new Uint16Array(
          stateBuffer,
          i * gridStateSize * Uint16Array.BYTES_PER_ELEMENT,
          numCells),
      });
    }

    return recStack;
  }

  static YIELD_ON_SOLUTION = 0;
  static YIELD_ON_STEP = -2;
  static YIELD_NEVER = -1;
  static YIELD_EVERY_BACKTRACK = 1;

  // run runs the solve.
  // yieldWhen can be:
  //  YIELD_ON_SOLUTION to yielding each solution.
  //  YIELD_ON_STEP to yield every step.
  //  n > 1 to yield every n backtracks, before the backtrack is applied.
  * run(yieldWhen) {
    const yieldEveryStep = yieldWhen === this.constructor.YIELD_ON_STEP;
    const yieldOnBacktrack = yieldWhen > 0 ? yieldWhen : 0;

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
    let iterationCounterForUpdates = 0;

    const recStack = this._recStack;
    let recDepth = 0;
    {
      // Setup initial recursion frame.
      const initialRecFrame = recStack[recDepth];
      initialRecFrame.gridState.set(this._initialGridState);
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

    if (this._debugLogger.logLevel >= 2) {
      this._debugLogger.log({ loc: 'run', msg: 'Start run-loop' }, 2);
    }

    recDepth++;
    while (recDepth) {
      let recFrame = recStack[--recDepth];

      const cellDepth = recFrame.cellDepth;
      this._currentRecFrame = recFrame;
      let grid = recFrame.gridCells;

      const [nextDepth, value, count] =
        this._candidateSelector.selectNextCandidate(
          cellDepth, grid, this._stepState, recFrame.newNode);
      recFrame.newNode = false;
      if (count === 0) continue;

      // The first nextCell maybe a guess, but the rest are singletons.
      if (yieldEveryStep) {
        this._stepState.oldGrid.set(grid);
      }

      // Assume the remaining progress is evenly distributed among the value
      // options.
      const progressDelta = recFrame.progressRemaining / count;
      recFrame.progressRemaining -= progressDelta;

      // We are enforcing several values at once.
      counters.valuesTried += nextDepth - cellDepth;

      // Determine the set of cells/constraints to enforce next.
      const handlerAccumulator = this._handlerAccumulator;
      handlerAccumulator.reset(nextDepth === this._numCells);
      for (let i = cellDepth; i < nextDepth; i++) {
        handlerAccumulator.addForFixedCell(
          this._candidateSelector.getCellAtDepth(i));
      }
      // Queue up extra constraints based on prior backtracks. The idea being
      // that constraints that apply this the contradiction cell are likely
      // to turn up a contradiction here if it exists.
      // NOTE: This must use the value of lastContradictionCell before recFrame
      //       is updated.
      if (recFrame.lastContradictionCell >= 0) {
        handlerAccumulator.addForCell(recFrame.lastContradictionCell);
      }

      const cell = this._candidateSelector.getCellAtDepth(cellDepth);
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

      iterationCounterForUpdates++;
      if ((iterationCounterForUpdates & progressFrequencyMask) === 0) {
        this._progress.callback();
        iterationCounterForUpdates &= (1 << 30) - 1;
      }

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
        this._conflictScores.increment(cell, value);

        if (0 !== yieldOnBacktrack &&
          0 === counters.backtracks % yieldOnBacktrack) {
          yield {
            grid: grid,
            isSolution: false,
            cellOrder: this._candidateSelector.getCellOrder(cellDepth),
            hasContradiction: hasContradiction,
          };
        }
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

      if (this._seenCandidateSet.enabledInSolver) {
        if (!this._seenCandidateSet.hasInterestingSolutions(grid)) {
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
        counters.backtracks++;
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

    this._currentRecFrame = null;
    this.done = true;

    if (this._debugLogger.logLevel >= 2) {
      this._debugLogger.log({ loc: 'run', msg: 'Done' }, 2);
    }
  }

  solveAllPossibilities(solutions, candidateSupportThreshold) {
    const counters = this.counters;

    const seenCandidateSet = this._seenCandidateSet;
    seenCandidateSet.resetWithThreshold(candidateSupportThreshold);

    for (const result of this.run(InternalSolver.YIELD_ON_SOLUTION)) {
      seenCandidateSet.addSolutionGrid(result.grid);
      solutions.push(result.grid.slice(0));

      // Once we have 2 solutions, then start ignoring branches which maybe
      // duplicating existing solution (up to this point, every branch is
      // interesting).
      if (counters.solutions == 2) {
        seenCandidateSet.enabledInSolver = true;
      }
    }

    return seenCandidateSet.getCandidateCounts();
  }

  validateLayout() {
    const originalInitialGridState = this._initialGridState.slice();
    const result = this._validateLayout(originalInitialGridState);
    this._initialGridState = originalInitialGridState;
    return result;
  }

  _validateLayout(originalInitialGridState) {
    // Choose just the house handlers.
    const houseHandlers = this._handlerSet.getAllofType(HandlerModule.House);

    // Function to fill a house with all values.
    const fillHouse = (house) => {
      this._initialGridState.set(originalInitialGridState);
      house.cells.forEach((c, i) => this._initialGridState[c] = 1 << i);
    };

    const attemptLog = [];
    // Arbitrary search limit. Too much lower and there are some cases which get
    // stuck for too long.
    const SEARCH_LIMIT = 200;

    const finalize = (result) => {
      this.done = true;
      if (!result) return null;

      this.counters.branchesIgnored = 1 - this.counters.progressRatio;
      return SudokuSolverUtil.gridToSolution(result.grid);
    };

    // Function to attempt to solve with one house fixed.
    const attempt = (house) => {
      this._resetRun();

      fillHouse(house);
      // Reduce backtrack triggers so that we don't weight the last runs too
      // heavily.
      // TODO: Do this in a more principled way.
      this._conflictScores.decay();

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
    for (const result of this.run(InternalSolver.YIELD_ON_SOLUTION)) {
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

  estimatedCountSolutions(estimationCounters) {
    const originalCandidateSelector = this._candidateSelector;

    let result = this._estimatedCountSolutions(estimationCounters);

    this._candidateSelector = originalCandidateSelector;
    return result;
  }

  _estimatedCountSolutions(estimationCounters) {
    // Solution count estimate is based on the algorithm from:
    // "Estimating the Efficiency of Backtrack Programs" Knuth (1975)
    // https://www.ams.org/journals/mcom/1975-29-129/S0025-5718-1975-0373371-6/S0025-5718-1975-0373371-6.pdf
    //
    // For each sample, we run a regular search but randomly select the
    // candidate values at each step, and stop after one branch.

    let totalEstimate = 0;
    let numSamples = 0;

    // Use a fixed seed so the result is deterministic.
    // TODO: Allows us to save and restore the original.
    this._candidateSelector = new SamplingCandidateSelector(
      this._shape, this._handlerSet, this._debugLogger, this._seenCandidateSet);

    while (true) {
      this._resetRun();

      // Run a search and stop after one backtrack.
      for (const result of this.run(InternalSolver.YIELD_EVERY_BACKTRACK)) {
        if (result.isSolution) {
          totalEstimate += this._candidateSelector.getSolutionWeight();
        }
        break;
      }

      numSamples++;
      estimationCounters.solutions = totalEstimate / numSamples;
      estimationCounters.samples = numSamples;

      // Ensure that there are progress callbacks.
      // However, we don't want the progress callback to report done.
      this.done = false;
      this._progress.callback();
    }
  }
}

class HandlerAccumulator {
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
        this._allHandlers[index] = new HandlerModule.And(
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

export class CellExclusions {
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

    this._sealed = false;
  }

  clone() {
    const clone = new CellExclusions(null, null);
    clone._cellExclusionSets = this._cellExclusionSets.map(s => new Set(s));
    clone._sealed = this._sealed;
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
          if (c == d) break;
          cellExclusionSets[c].add(d);
          cellExclusionSets[d].add(c);
        }
      }
    }

    return cellExclusionSets;
  }

  addMutualExclusion(cell1, cell2) {
    if (this._sealed) {
      throw ('Cannot add exclusions after caching.');
    }
    this._cellExclusionSets[cell1].add(cell2);
    this._cellExclusionSets[cell2].add(cell1);
  }

  // Assume cell0 and cell1 are the same value, and hence can share exclusions.
  areSameValue(cell0, cell1) {
    if (cell0 == cell1) return;
    if (this._sealed) {
      throw ('Cannot add exclusions after caching.');
    }
    for (const c of this._cellExclusionSets[cell0]) {
      this._cellExclusionSets[cell1].add(c);
    }
    for (const c of this._cellExclusionSets[cell1]) {
      this._cellExclusionSets[cell0].add(c);
    }
  }

  isMutuallyExclusive(cell1, cell2) {
    return this._cellExclusionSets[cell1].has(cell2);
  }

  areMutuallyExclusive(cells) {
    const numCells = cells.length;
    for (let i = 0; i < numCells; i++) {
      const iSet = this._cellExclusionSets[cells[i]];
      for (let j = i + 1; j < numCells; j++) {
        if (!iSet.has(cells[j])) return false;
      }
    }
    return true;
  }

  getArray(cell) {
    if (this._cellExclusionArrays.length === 0) {
      this._sealed = true;
      // Store an array version for fast iteration.
      // Sort the cells so they are in predictable order.
      this._cellExclusionArrays = (
        this._cellExclusionSets.map(c => [...c]));
      this._cellExclusionArrays.forEach(c => c.sort((a, b) => a - b));
    }

    return this._cellExclusionArrays[cell];
  }

  getBitSet(cell) {
    if (!this._cellExclusionBitSets) {
      this._sealed = true;
      this._cellExclusionBitSets = new Array(this._cellExclusionSets.length);
    }
    if (!this._cellExclusionBitSets[cell]) {
      const bitSet = new BitSet(this._cellExclusionSets.length);
      for (const c of this._cellExclusionSets[cell]) {
        bitSet.add(c);
      }
      this._cellExclusionBitSets[cell] = bitSet;
    }
    return this._cellExclusionBitSets[cell];
  }

  getPairExclusions(pairIndex) {
    this._sealed = true;
    let result = this._pairExclusions.get(pairIndex);
    if (result === undefined) {
      result = this._computePairExclusions(pairIndex >> 8, pairIndex & 0xff);
      this._pairExclusions.set(pairIndex, result);
    }

    return result;
  }

  getListExclusions(cells) {
    this._sealed = true;
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

class GridStateAllocator {
  constructor(shape) {
    this._offset = shape.numCells;
    this._extraState = [];

    this._gridCells = new Uint16Array(shape.numCells);
    const allValues = LookupTables.get(shape.numValues).allValues
    this._gridCells.fill(allValues);
  }

  allocate(state) {
    const start = this._offset + this._extraState.length;
    this._extraState.push(...state);
    return start;
  }

  mutableGridCells() {
    return this._gridCells;
  }

  // Invalidate the grid, given the handler which said it was impossible.
  // We invalidate the grid by setting cells to zero. We want to set the
  // most meaningful cells to the user.
  invalidateGrid(handler) {
    // Try to use the handler cells.
    let cells = handler.cells;
    // Otherwise use the exclusionCells.
    if (!cells.length) cells = handler.exclusionCells();
    cells.forEach(c => this._gridCells[c] = 0);

    // Otherwise just set the entire grid to 0.
    if (!cells.length) this._gridCells.fill(0);
  }


  makeGridState() {
    const gridCells = this._gridCells;
    const gridState = new gridCells.constructor(
      gridCells.length + this._extraState.length);
    gridState.set(gridCells);
    gridState.set(this._extraState, gridCells.length);
    return gridState;
  }
}

export class HandlerSet {
  constructor(handlers, shape) {
    this._allHandlers = [];
    this._seen = new Map();
    this._ordinaryIndexLookup = new Map();

    this._singletonHandlerMap = [];
    this._ordinaryHandlerMap = [];
    this._auxHandlerMap = [];
    for (let i = 0; i < shape.numCells; i++) {
      this._ordinaryHandlerMap.push([]);
      this._auxHandlerMap.push([]);
      this._singletonHandlerMap.push([]);
    }

    this.add(...handlers);
  }

  getAllofType(type) {
    return this._allHandlers.filter(h => h.constructor === type);
  }

  getAll() {
    return this._allHandlers;
  }

  getOrdinaryHandlerMap() {
    return this._ordinaryHandlerMap;
  }

  getAuxHandlerMap() {
    return this._auxHandlerMap;
  }

  getIntersectingIndexes(handler) {
    const handlerIndex = this._ordinaryIndexLookup.get(handler);
    const intersectingHandlers = new Set();
    for (const c of handler.cells) {
      this._ordinaryHandlerMap[c].forEach(i => intersectingHandlers.add(i));
    }
    intersectingHandlers.delete(handlerIndex);
    return intersectingHandlers;
  }

  getIndex(handler) {
    return this._ordinaryIndexLookup.get(handler);
  }

  getHandler(index) {
    return this._allHandlers[index];
  }

  getSingletonHandlerMap() {
    return this._singletonHandlerMap;
  }

  replace(oldHandler, newHandler) {
    newHandler.essential = oldHandler.essential;

    const index = this._allHandlers.indexOf(oldHandler);

    this._allHandlers[index] = newHandler;
    if (!arraysAreEqual(oldHandler.cells, newHandler.cells)) {
      this.updateCells(index, oldHandler.cells, newHandler.cells);
    }
  }

  updateCells(index, oldCells, newCells) {
    for (const c of oldCells) {
      const indexInMap = this._ordinaryHandlerMap[c].indexOf(index);
      this._ordinaryHandlerMap[c].splice(indexInMap, 1);
    }
    newCells.forEach(c => this._ordinaryHandlerMap[c].push(index));
  }

  delete(handler) {
    this.replace(handler, new HandlerModule.True());
  }

  _addOrdinary(handler, index) {
    if (index === undefined) {
      index = this._addToAll(handler);
    } else {
      this._allHandlers[index] = handler;
    }

    handler.cells.forEach(c => this._ordinaryHandlerMap[c].push(index));
    this._ordinaryIndexLookup.set(handler, index);
  }

  add(...handlers) {
    for (const h of handlers) {
      if (h.constructor.SINGLETON_HANDLER) {
        this.addSingletonHandlers(h);
      } else {
        if (!this._addToSeen(h)) continue;
        this._addOrdinary(h);
      }
    }
  }

  addNonEssential(...handlers) {
    for (const h of handlers) {
      h.essential = false;
      if (!this._addToSeen(h)) continue;
      this._addOrdinary(h);
    }
  }

  addAux(...handlers) {
    for (const h of handlers) {
      h.essential = false;
      if (!this._addToSeen(h)) continue;
      this._addAux(h);
    }
  }

  addSingletonHandlers(...handlers) {
    for (const h of handlers) {
      if (!this._addToSeen(h)) {
        throw ('Singleton handlers must be unique');
      }

      const index = this._addToAll(h);
      this._singletonHandlerMap[h.cells[0]].push(index);
    }
  }

  // Return:
  //   true if we added it to see.
  //   false if it already existed.
  _addToSeen(h) {
    if (this._seen.has(h.idStr)) {
      // Make sure we mark the handler as essential if either
      // is essential.
      this._seen.get(h.idStr).essential ||= h.essential;
      return false;
    }
    this._seen.set(h.idStr, h);
    return true;
  }

  _addAux(handler) {
    const index = this._addToAll(handler);
    handler.cells.forEach(
      c => this._auxHandlerMap[c].push(index));
  }

  _addToAll(handler) {
    const index = this._allHandlers.length;
    this._allHandlers.push(handler);
    return index;
  }

  [Symbol.iterator]() {
    return this._allHandlers[Symbol.iterator]();
  }
}