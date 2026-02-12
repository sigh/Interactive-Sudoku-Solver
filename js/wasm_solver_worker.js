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
  solve_sudoku,
  solve_sudoku_with_cages,
  solve_sudoku_with_progress,
  count_solutions_with_progress,
} from '../solver-wasm/pkg/solver_wasm.js';

await init();

let workerSolverState = null;
let workerSolverSetUpTime = 0;

// ============================================================================
// Constraint → WASM input conversion
// ============================================================================

/**
 * Extract an 81-character puzzle string from a resolved constraint.
 * Walks all children for 'Given' constraints and places them in the grid.
 */
function extractGivens(constraint, shape) {
  const puzzle = new Array(shape.numCells).fill('.');

  const walk = (c) => {
    if (c.type === 'Given') {
      const cellIndex = shape.parseCellId(c.cell).cell;
      if (c.values.length === 1) {
        puzzle[cellIndex] = String(c.values[0]);
      }
    }
    if (c.constraints) {
      for (const child of c.constraints) {
        walk(child);
      }
    }
  };

  walk(constraint);
  return puzzle.join('');
}

/**
 * Extract killer cages from a resolved constraint.
 * Returns an array of { cells: number[], sum: number }.
 */
function extractCages(constraint, shape) {
  const cages = [];

  const walk = (c) => {
    if (c.type === 'Cage' && c.sum !== 0) {
      const cells = c.cells.map(cellId => shape.parseCellId(cellId).cell);
      cages.push({ cells, sum: c.sum });
    }
    if (c.constraints) {
      for (const child of c.constraints) {
        walk(child);
      }
    }
  };

  walk(constraint);
  return cages;
}

/**
 * Convert a resolved constraint to the WASM solver's JSON input format.
 */
function constraintToWasmInput(constraint, shape) {
  return {
    puzzle: extractGivens(constraint, shape),
    cages: extractCages(constraint, shape),
  };
}

/**
 * Check if a constraint set is supported by the WASM solver.
 * Returns null if supported, or a string explaining why not.
 */
function getWasmUnsupportedReason(constraint) {
  const supportedTypes = new Set([
    'Container', 'Set', 'Given', 'Cage', 'Shape',
  ]);

  const walk = (c) => {
    if (!supportedTypes.has(c.type)) {
      return `Unsupported constraint type: ${c.type}`;
    }
    if (c.constraints) {
      for (const child of c.constraints) {
        const reason = walk(child);
        if (reason) return reason;
      }
    }
    return null;
  };

  return walk(constraint);
}

// ============================================================================
// Worker message handling
// ============================================================================

const LOG_UPDATE_FREQUENCY = 13; // 2^13 = 8192 iterations per callback.

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
        const shape = constraint.getShape();

        // Check if the constraint is supported.
        const unsupported = getWasmUnsupportedReason(constraint);
        if (unsupported) {
          throw new Error(unsupported);
        }

        wasmInput = constraintToWasmInput(constraint, shape);
      });
      workerSolverSetUpTime = timer.elapsedMs();

      // Store the input and log frequency for later method calls.
      workerSolverState = {
        input: JSON.stringify(wasmInput),
        logFrequency: payload.logUpdateFrequency || LOG_UPDATE_FREQUENCY,
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
      timer.runTimed(() => {
        const onProgress = (countersJson) => {
          const counters = JSON.parse(countersJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
        };

        const resultJson = solve_sudoku_with_progress(
          workerSolverState.input,
          onProgress,
          workerSolverState.logFrequency,
        );
        result = JSON.parse(resultJson);
      });

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = true;

      if (!result.success) {
        return { values: null, pencilmarks: null };
      }

      // Convert solution string to the format expected by the UI:
      // An array where values[i] = the value at cell i (1-9).
      const solution = result.solution;
      const values = [];
      for (let i = 0; i < solution.length; i++) {
        values.push(parseInt(solution[i], 10));
      }

      // For solveAllPossibilities, we return the solution as if each cell
      // has exactly one possible value.
      const pencilmarks = values.map(v => [v]);

      return {
        values,
        pencilmarks,
        solutions: [values],
      };
    }

    case 'nthSolution': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const timer = new Timer();
      let result;
      timer.runTimed(() => {
        const onProgress = (countersJson) => {
          const counters = JSON.parse(countersJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
        };

        const resultJson = solve_sudoku_with_progress(
          workerSolverState.input,
          onProgress,
          workerSolverState.logFrequency,
        );
        result = JSON.parse(resultJson);
      });

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

    case 'countSolutions': {
      if (!workerSolverState) throw new Error('Solver not initialized');

      const timer = new Timer();
      let result;
      const limit = payload || 0;
      timer.runTimed(() => {
        const onProgress = (countersJson) => {
          const counters = JSON.parse(countersJson);
          workerSolverState.counters = counters;
          workerSolverState.timeMs = timer.elapsedMs();
          sendState();
        };

        const resultJson = count_solutions_with_progress(
          workerSolverState.input,
          onProgress,
          workerSolverState.logFrequency,
          limit,
        );
        result = JSON.parse(resultJson);
      });

      workerSolverState.counters = result.counters;
      workerSolverState.timeMs = timer.elapsedMs();
      workerSolverState.done = true;

      return result.count;
    }

    case 'validateLayout':
      // Not applicable for WASM solver — always valid for supported constraints.
      return true;

    case 'nthStep':
      throw new Error('Step-by-step solving is not supported by the WASM solver');

    case 'estimatedCountSolutions':
      throw new Error('Estimated count is not supported by the WASM solver');
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
