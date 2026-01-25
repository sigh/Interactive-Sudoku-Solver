// SimpleSolver for sandbox, debug.js, and tests.
//
// Provides a simplified interface to the solver that runs locally
// without web workers.

const { SudokuParser, toShortSolution } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuConstraint } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../solver/sudoku_builder.js' + self.VERSION_PARAM);
const { GridShape } = await import('../grid_shape.js' + self.VERSION_PARAM);
const { Timer } = await import('../util.js' + self.VERSION_PARAM);
const { SolverStats } = await import('./solver_stats.js' + self.VERSION_PARAM);

/**
 * Simple synchronous solver interface.
 *
 * Each method takes constraints and runs a complete solve operation.
 * All operations run synchronously in the current thread.
 *
 * @example
 * const solver = new SimpleSolver();
 * for (const c of constraints) {
 *   const solution = solver.solution(c);
 *   console.log(solution?.toString());
 * }
 */
export class SimpleSolver {
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
   * Count all solutions efficiently.
   * @param {Object|Object[]|string} constraints
   * @param {number} [limit] - Optional limit to count up to
   * @returns {number}
   */
  countSolutions(constraints, limit) {
    const { solver, captureState } = this._build(constraints);
    const count = solver.countSolutions(limit);
    captureState();
    return count;
  }

  /**
   * Find all true candidates (values appearing in valid solutions).
   * This is "All possibilities" mode in the UI.
   * @param {Object|Object[]|string} constraints
   * @param {number} [limit=1] - Candidate count limit to search up to
   * @returns {TrueCandidates|null}
   */
  trueCandidates(constraints, limit = 1) {
    const { solver, shape, captureState } = this._build(constraints);

    // Collect solutions via progress callback.
    const solutions = [];
    solver.setProgressCallback((extraState) => {
      if (extraState?.solutions) {
        solutions.push(...extraState.solutions);
      }
    });

    const counts = solver.solveAllPossibilities(limit);
    captureState();
    return counts ? new TrueCandidates(counts, shape, limit, solutions) : null;
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
    return this._values[cellIndex(this._shape, cellIdOrRow, col)];
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
 * Represents true candidates (values appearing in valid solutions).
 */
export class TrueCandidates {
  constructor(counts, shape, limit, solutions) {
    this._counts = counts;
    this._shape = shape;
    this._limit = limit;
    this._numValues = shape.numValues;
    this._solutions = solutions.map(s => new Solution(s, shape));
  }

  /**
   * Get all witness solutions.
   * @returns {Solution[]}
   */
  get witnessSolutions() {
    return this._solutions;
  }

  /**
   * Get all candidate values at a cell.
   * @param {string|number} cellIdOrRow - Cell ID (e.g., 'R5C3') or row (1-indexed)
   * @param {number} [col] - Column (1-indexed), required if first arg is row
   * @returns {number[]} Array of candidate values (1-indexed)
   */
  valuesAt(cellIdOrRow, col) {
    const idx = cellIndex(this._shape, cellIdOrRow, col);
    const baseIndex = idx * this._numValues;
    const values = [];
    for (let i = 0; i < this._numValues; i++) {
      if (this._counts[baseIndex + i] > 0) {
        values.push(i + 1);
      }
    }
    return values;
  }

  /**
   * Get the count for a specific value at a cell (capped to limit).
   * @param {string|number} cellIdOrRow - Cell ID (e.g., 'R5C3') or row (1-indexed)
   * @param {number} colOrValue - Column (1-indexed) if first arg is row, or value if first arg is cellId
   * @param {number} [value] - The value (1-indexed), required if first arg is row
   * @returns {number} Count of solutions containing this value
   */
  countAt(cellIdOrRow, colOrValue, value) {
    let idx, v;
    if (typeof cellIdOrRow === 'string') {
      idx = cellIndex(this._shape, cellIdOrRow);
      v = colOrValue;
    } else {
      idx = cellIndex(this._shape, cellIdOrRow, colOrValue);
      v = value;
    }
    const countIndex = idx * this._numValues + (v - 1);
    return Math.min(this._counts[countIndex], this._limit);
  }

  /**
   * Iterate over all non-zero candidates.
   * @yields {{ cell: string, value: number, count: number }}
   */
  *[Symbol.iterator]() {
    const numCells = this._shape.numCells;
    for (let i = 0; i < numCells; i++) {
      const baseIndex = i * this._numValues;
      for (let v = 0; v < this._numValues; v++) {
        const count = this._counts[baseIndex + v];
        if (count > 0) {
          yield {
            cell: this._shape.makeCellIdFromIndex(i),
            value: v + 1,
            count: Math.min(count, this._limit),
          };
        }
      }
    }
  }

  /**
   * Get candidates as a string (value for candidates, '.' for non-candidates).
   * @returns {string}
   */
  toString() {
    const numCells = this._shape.numCells;
    const baseCharCode = GridShape.baseCharCode(this._shape);
    const chars = [];
    for (let i = 0; i < numCells; i++) {
      const baseIndex = i * this._numValues;
      for (let v = 0; v < this._numValues; v++) {
        chars.push(this._counts[baseIndex + v] > 0
          ? String.fromCharCode(baseCharCode + v)
          : '.');
      }
    }
    return chars.join('');
  }
}

// Convert cell reference to cell index.
const cellIndex = (shape, cellIdOrRow, col) => {
  if (typeof cellIdOrRow === 'string') {
    return shape.parseCellId(cellIdOrRow).cell;
  }
  // Convert 1-indexed row/col to 0-indexed
  return shape.cellIndex(cellIdOrRow - 1, col - 1);
}

