// Solver API for sandbox, debug.js, and tests.
//
// Provides a simplified interface to the solver that runs locally
// without web workers.

const { SudokuParser, toShortSolution } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../solver/sudoku_builder.js' + self.VERSION_PARAM);
const { Timer } = await import('../util.js' + self.VERSION_PARAM);

/**
 * Represents a single solution to a puzzle.
 */
export class Solution {
  constructor(values, shape) {
    this._values = values;
    this._shape = shape;
  }

  /**
   * Get the value at a cell.
   * @param {string|number} cellIdOrRow - Cell ID (e.g., 'R5C3') or row (1-indexed)
   * @param {number} [col] - Column (1-indexed), required if first arg is row
   * @returns {number} The value at the cell (1-9 for standard grid)
   */
  valueAt(cellIdOrRow, col) {
    let cellIndex;
    if (typeof cellIdOrRow === 'string') {
      const parsed = this._shape.parseCellId(cellIdOrRow);
      cellIndex = parsed.cell;
    } else {
      // Convert 1-indexed row/col to 0-indexed
      cellIndex = this._shape.cellIndex(cellIdOrRow - 1, col - 1);
    }
    return this._values[cellIndex];
  }

  /**
   * Iterate over all cells in the solution.
   * @yields {{ cell: string, value: number }}
   */
  *[Symbol.iterator]() {
    for (let i = 0; i < this._values.length; i++) {
      yield {
        cell: this._shape.makeCellIdFromIndex(i),
        value: this._values[i],
      };
    }
  }

  /**
   * Get the solution as a short string (e.g., 81 chars for 9x9).
   * @returns {string}
   */
  toString() {
    return toShortSolution(this._values, this._shape);
  }

  /**
   * Compare with another solution or string.
   * @param {Solution|string} other
   * @returns {boolean}
   */
  equals(other) {
    const otherStr = other instanceof Solution ? other.toString() : other;
    return this.toString() === otherStr;
  }

  /**
   * Get the raw values array.
   * @returns {Uint8Array}
   */
  getArray() {
    return this._values;
  }
}

/**
 * Contains performance statistics from the solve operation.
 */
export class SolverStats {
  constructor(state) {
    const counters = state?.counters || {};

    // Timing
    this.setupTimeMs = state?.puzzleSetupTime || 0;
    this.runtimeMs = state?.timeMs || 0;

    // Counters
    this.solutions = counters.solutions || 0;
    this.guesses = counters.guesses || 0;
    this.backtracks = counters.backtracks || 0;
    this.nodesSearched = counters.nodesSearched || 0;
    this.constraintsProcessed = counters.constraintsProcessed || 0;
    this.valuesTried = counters.valuesTried || 0;
    this.branchesIgnored = counters.branchesIgnored || 0;
  }
}

/**
 * Main solver interface.
 *
 * Each method takes constraints and runs a complete solve operation.
 * All operations run synchronously in the current thread.
 *
 * @example
 * const solver = new Solver();
 * for (const c of constraints) {
 *   const solution = solver.solution(c);
 *   console.log(solution?.toString());
 * }
 */
export class SolverAPI {
  constructor() {
    this._state = null;
  }

  /**
   * Build solver from constraints and capture state after running.
   * @private
   */
  _build(constraints) {
    if (typeof constraints === 'string') {
      constraints = SudokuParser.parseText(constraints);
    } else if (Array.isArray(constraints)) {
      constraints = new SudokuConstraint.Container(constraints);
    }

    const timer = new Timer();
    let solver;
    timer.runTimed(() => {
      const resolved = SudokuBuilder.resolveConstraint(constraints);
      solver = SudokuBuilder.build(resolved);
    });

    const setupTimeMs = timer.elapsedMs();
    return {
      solver,
      shape: constraints.getShape(),
      captureState: () => {
        const state = solver.state?.();
        if (state) state.puzzleSetupTime = setupTimeMs;
        this._state = state;
      },
    };
  }

  /**
   * Find any solution.
   * @param {Object|Object[]|string} constraints
   * @returns {Solution|null}
   */
  solution(constraints) {
    const { solver, shape, captureState } = this._build(constraints);
    const values = solver.nthSolution(0);
    captureState();
    return values ? new Solution(values, shape) : null;
  }

  /**
   * Find the unique solution.
   * @param {Object|Object[]|string} constraints
   * @returns {Solution|null} The solution if exactly one exists, null otherwise
   */
  uniqueSolution(constraints) {
    const { solver, shape, captureState } = this._build(constraints);
    const first = solver.nthSolution(0);
    if (!first) {
      captureState();
      return null;
    }
    if (solver.nthSolution(1)) {
      captureState();
      return null;
    }
    captureState();
    return new Solution(first, shape);
  }

  /**
   * Iterator over solutions.
   * @param {Object|Object[]|string} constraints
   * @param {number} [limit]
   * @yields {Solution}
   */
  *solutions(constraints, limit) {
    const { solver, shape, captureState } = this._build(constraints);
    for (let n = 0; limit === undefined || n < limit; n++) {
      const values = solver.nthSolution(n);
      if (!values) break;
      captureState();
      yield new Solution(values, shape);
    }
    captureState();
  }

  /**
   * Get solutions as an array.
   * @param {Object|Object[]|string} constraints
   * @param {number} [limit]
   * @returns {Solution[]}
   */
  solutionArray(constraints, limit) {
    return [...this.solutions(constraints, limit)];
  }

  /**
   * Count all solutions efficiently.
   * @param {Object|Object[]|string} constraints
   * @returns {number}
   */
  countSolutions(constraints) {
    const { solver, captureState } = this._build(constraints);
    const count = solver.countSolutions();
    captureState();
    return count;
  }

  /**
   * Validate that a layout (e.g., jigsaw) has valid solutions.
   * Non-layout constraints are ignored.
   * @param {Object|Object[]|string} constraints
   * @returns {Solution|null} A sample solution if valid, null if invalid
   */
  validateLayout(constraints) {
    const { solver, shape, captureState } = this._build(constraints);
    const values = solver.validateLayout();
    captureState();
    return values ? new Solution(values, shape) : null;
  }

  /**
   * Get statistics from the last solve operation.
   * @returns {SolverStats}
   */
  latestStats() {
    return new SolverStats(this._state);
  }
}
