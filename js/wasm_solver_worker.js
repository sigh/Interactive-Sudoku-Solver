// WASM Solver Worker
//
// This worker loads the Rust WASM solver module and implements the same
// message protocol as the JS solver_worker.js. It receives constraint
// objects, extracts givens + killer cages, and passes them as JSON to
// the Rust solver.

// Set up onmessage handler immediately (same pattern as solver_worker.js).
let resolveWorkerLoaded;
const workerLoadedPromise = new Promise(resolve => {
  resolveWorkerLoaded = resolve;
});
self.onmessage = async (msg) => {
  await workerLoadedPromise;
  handleWorkerMessage(msg);
};

const START_INIT_WORKER = performance.now();

self.VERSION_PARAM = self.location.search;

// Import shared modules (constraint resolution, grid shape).
const { SudokuBuilder } = await import('./solver/sudoku_builder.js' + self.VERSION_PARAM);
const { Timer } = await import('./util.js' + self.VERSION_PARAM);

// Import and initialize the WASM module.
// wasm-pack --target web produces an init() function and named exports.
import init, {
  init_solver,
  count_solutions_with_progress,
  validate_layout_with_progress,
  estimated_count_solutions_with_progress,
  solve_all_possibilities_with_progress,
  nth_solution_with_progress,
  nth_step_with_progress,
} from '../solver-wasm/pkg/solver_wasm.js';

await init();

let workerSolverState = null;
let workerSolverSetUpTime = 0;

// ============================================================================
// Constraint → WASM input conversion
// ============================================================================

/**
 * Convert a resolved constraint to the WASM solver's JSON input format.
 * The constraint string is passed directly to the Rust parser, which is
 * the single source of truth for supported constraint types.
 */
function constraintToWasmInput(constraint, debugOptions) {
  const input = {
    constraintString: constraint.toString(),
  };
  if (debugOptions) {
    input.debugOptions = debugOptions;
  }
  return input;
}

// ============================================================================
// Worker message handling
// ============================================================================

const LOG_UPDATE_FREQUENCY = 13; // 2^13 = 8192 iterations per callback.

/**
 * Parse a SolverProgress JSON string from the WASM solver.
 * Returns { counters, debugData, extra } where debugData is null if no debug
 * information is present, or an object with logs/conflictHeatmap/stackTrace.
 * extra is the raw progress.extra object (may contain sampleSolution and/or
 * estimate fields), or null.
 */
function parseProgress(progressJson) {
  const progress = JSON.parse(progressJson);
  const counters = progress.counters;

  let debugData = null;
  const hasLogs = progress.logs && progress.logs.length > 0;
  const hasHeatmap = progress.conflictHeatmap != null;
  const hasStack = progress.stackTrace != null;

  if (hasLogs || hasHeatmap || hasStack) {
    debugData = {};
    if (hasLogs) debugData.logs = progress.logs;
    if (hasHeatmap) debugData.conflictHeatmap = progress.conflictHeatmap;
    if (hasStack) debugData.stackTrace = progress.stackTrace;
  }

  return { counters, debugData, extra: progress.extra || null };
}

/**
 * Send debug state if there is any debug data from the progress callback.
 */
function sendDebugState(debugData) {
  if (!debugData || !workerSolverState) return;
  debugData.timeMs = workerSolverState.timeMs;
  self.postMessage({
    type: 'debug',
    data: debugData,
  });
}

/**
 * Check a parsed WASM result for an error field and throw if present.
 * This surfaces Rust-side errors (e.g. unsupported constraint types) to the
 * UI via the worker's exception handling path.
 */
function throwOnError(result) {
  if (result && result.error) {
    const err = new Error(result.error);
    err.name = 'InvalidConstraintError';
    throw err;
  }
}

const handleWorkerMessage = (msg) => {
  try {
    let result = handleWorkerMethod(msg.data.method, msg.data.payload);
    sendState();
    self.postMessage({
      type: 'result',
      result: result,
    });
  } catch (e) {
    const error = (e instanceof Error)
      ? { name: e.name, message: e.message, stack: e.stack }
      : { name: 'Error', message: String(e), stack: null };
    self.postMessage({
      type: 'exception',
      method: msg?.data?.method,
      error,
    });
  }
};

const handleWorkerMethod = (method, payload) => {
  switch (method) {
    case 'init': {
      const timer = new Timer();
      let wasmInput;
      timer.runTimed(() => {
        const constraint = SudokuBuilder.resolveConstraint(payload.constraint);
        wasmInput = constraintToWasmInput(constraint, payload.debugOptions);
      });
      workerSolverSetUpTime = timer.elapsedMs();

      const inputJson = JSON.stringify(wasmInput);
      const logFrequency = payload.logUpdateFrequency || LOG_UPDATE_FREQUENCY;

      // Build the solver eagerly. All construction errors (unsupported
      // constraints, invalid puzzles, etc.) surface here — matching
      // how the JS solver throws during SudokuBuilder.build.
      const buildError = init_solver(inputJson, logFrequency);
      if (buildError) {
        const err = new Error(buildError);
        err.name = 'InvalidConstraintError';
        throw err;
      }

      workerSolverState = {
        debugOptions: payload.debugOptions || null,
        counters: {
          solutions: 0,
          backtracks: 0,
          guesses: 0,
          valuesTried: 0,
          constraintsProcessed: 0,
          progressRatio: 0,
        },
        timeMs: 0,
        done: false,
      };

      return true;
    }

    case 'solveAllPossibilities': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const timer = new Timer();
      let result;
      const threshold = payload.candidateSupportThreshold || 1;
      timer.runTimed(() => {
        const onProgress = (progressJson) => {
          const { counters, debugData } = parseProgress(progressJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
          sendDebugState(debugData);
        };

        const resultJson = solve_all_possibilities_with_progress(
          onProgress,
          threshold,
        );
        result = JSON.parse(resultJson);
      });

      throwOnError(result);

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = true;

      // Convert solution strings to value arrays and send as extra state
      // so AllPossibilitiesModeHandler.add() can process them.
      const solutions = result.solutions.map(solStr => {
        const values = [];
        for (let i = 0; i < solStr.length; i++) {
          values.push(parseInt(solStr[i], 10));
        }
        return values;
      });

      if (solutions.length > 0) {
        sendState({ solutions });
      }

      // Return candidateCounts as a Uint8Array (matching JS solver).
      return new Uint8Array(result.candidateCounts);
    }

    case 'nthSolution': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const n = payload;
      const timer = new Timer();
      let result;
      timer.runTimed(() => {
        const onProgress = (progressJson) => {
          const { counters, debugData } = parseProgress(progressJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
          sendDebugState(debugData);
        };

        const resultJson = nth_solution_with_progress(
          n,
          onProgress,
        );
        result = JSON.parse(resultJson);
      });

      throwOnError(result);

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = !result.success;

      if (!result.success) return null;

      const solution = result.solution;
      const values = [];
      for (let i = 0; i < solution.length; i++) {
        values.push(parseInt(solution[i], 10));
      }
      return values;
    }

    case 'countSolutions': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const timer = new Timer();
      let result;
      const limit = payload || 0;
      timer.runTimed(() => {
        const onProgress = (progressJson) => {
          const { counters, debugData, extra } = parseProgress(progressJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState(extra || undefined);
          sendDebugState(debugData);
        };

        const resultJson = count_solutions_with_progress(
          onProgress,
          limit,
        );
        result = JSON.parse(resultJson);
      });

      throwOnError(result);

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = true;

      return result.count;
    }

    case 'validateLayout': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const timer = new Timer();
      let result;
      timer.runTimed(() => {
        const onProgress = (progressJson) => {
          const { counters, debugData } = parseProgress(progressJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
          sendDebugState(debugData);
        };

        const resultJson = validate_layout_with_progress(onProgress);
        result = JSON.parse(resultJson);
      });

      throwOnError(result);

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = true;

      if (!result.success) return null;

      const solution = result.solution;
      const values = [];
      for (let i = 0; i < solution.length; i++) {
        values.push(parseInt(solution[i], 10));
      }
      return values;
    }

    case 'nthStep': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const [n, stepGuides] = payload;
      const timer = new Timer();
      let result;
      timer.runTimed(() => {
        const onProgress = (progressJson) => {
          const { counters, debugData } = parseProgress(progressJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
          sendDebugState(debugData);
        };

        // Convert the Map to a plain object for JSON serialization.
        const guidesObj = {};
        if (stepGuides) {
          for (const [step, guide] of stepGuides) {
            guidesObj[step] = guide;
          }
        }
        const guidesJson = JSON.stringify(guidesObj);

        const resultJson = nth_step_with_progress(
          n,
          guidesJson,
          onProgress,
        );
        result = JSON.parse(resultJson);
      });

      throwOnError(result);

      workerSolverState.timeMs = timer.elapsedMs();

      if (result === null) {
        workerSolverState.done = true;
        return null;
      }

      return result;
    }

    case 'estimatedCountSolutions': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const timer = new Timer();
      let result;
      timer.runTimed(() => {
        const onProgress = (progressJson) => {
          const { counters, debugData, extra } = parseProgress(progressJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState(extra || undefined);
          sendDebugState(debugData);
        };

        // max_samples=0 means unlimited (run until worker is terminated),
        // matching the JS SudokuSolver.estimatedCountSolutions() behavior.
        const resultJson = estimated_count_solutions_with_progress(onProgress, 0);
        result = JSON.parse(resultJson);
      });

      throwOnError(result);

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = true;

      return result.estimate;
    }
  }

  throw new Error(`Unknown method ${method}`);
};

const sendState = (extraState) => {
  if (!workerSolverState) return;

  const state = {
    counters: { ...workerSolverState.counters },
    timeMs: workerSolverState.timeMs,
    done: workerSolverState.done,
    puzzleSetupTime: workerSolverSetUpTime,
  };

  if (extraState) {
    state.extra = extraState;
  }

  self.postMessage({
    type: 'state',
    state: state,
  });
};

const END_INIT_WORKER = performance.now();
const workerSetupMs = Math.ceil(END_INIT_WORKER - START_INIT_WORKER);

console.log(`WASM worker initialized in ${Math.ceil(workerSetupMs)}ms`);

// Resolve the promise to indicate the worker is fully loaded.
resolveWorkerLoaded();
