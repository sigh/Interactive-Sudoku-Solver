//! Simple synchronous solver interface — Rust port of `js/sandbox/simple_solver.js`.
//!
//! Provides a high-level API for solving puzzles without touching engine
//! internals. This is the API that anything other than the WASM entry
//! points should use (CLI, tests, etc.).
//!
//! # Examples
//!
//! ```
//! use solver_wasm::simple_solver::SimpleSolver;
//!
//! let mut solver = SimpleSolver::new();
//! let solution = solver.solution("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79").unwrap();
//! assert!(solution.is_some());
//! ```

use std::fmt;
use std::time::Instant;

use crate::constraint::builder::SudokuBuilder;
use crate::constraint::parser;
use crate::grid_shape::GridShape;
use crate::solver::{Solver, SolverCounters};

// ---------------------------------------------------------------------------
// SimpleSolver
// ---------------------------------------------------------------------------

/// Simple synchronous solver interface.
///
/// Each method takes a constraint string, builds a solver, runs it, and
/// returns the result. Mirrors JS `SimpleSolver` in
/// `js/sandbox/simple_solver.js`.
///
/// The solver captures counters from the last operation, accessible via
/// [`latest_counters`](SimpleSolver::latest_counters).
pub struct SimpleSolver {
    counters: Option<SolverCounters>,
    /// Setup time (parse + build) in milliseconds, from the last operation.
    setup_time_ms: f64,
    /// Runtime (solver execution) in milliseconds, from the last operation.
    runtime_ms: f64,
}

impl SimpleSolver {
    pub fn new() -> Self {
        Self {
            counters: None,
            setup_time_ms: 0.0,
            runtime_ms: 0.0,
        }
    }

    /// Parse and build a solver from a constraint string, measuring setup time.
    ///
    /// Mirrors JS `SimpleSolver._build(constraints)`.
    fn build(input: &str) -> Result<(Solver, GridShape, f64), String> {
        let start = Instant::now();
        let parsed = parser::parse(input)?;
        let shape = parsed.shape;
        let solver = SudokuBuilder::build(&parsed)?;
        let setup_ms = start.elapsed().as_secs_f64() * 1000.0;
        Ok((solver, shape, setup_ms))
    }

    /// Find any solution.
    ///
    /// Mirrors JS `SimpleSolver.solution(constraints)`.
    pub fn solution(&mut self, input: &str) -> Result<Option<Solution>, String> {
        let (mut solver, shape, setup_ms) = Self::build(input)?;
        let start = Instant::now();
        let result = solver.nth_solution(0, &mut |_| {});
        self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;
        self.counters = Some(result.counters);
        self.setup_time_ms = setup_ms;
        Ok(result.solution.map(|values| Solution::new(values, shape)))
    }

    /// Find the unique solution. Returns `None` if there are zero or
    /// multiple solutions.
    ///
    /// Mirrors JS `SimpleSolver.uniqueSolution(constraints)`.
    pub fn unique_solution(&mut self, input: &str) -> Result<Option<Solution>, String> {
        let (mut solver, shape, setup_ms) = Self::build(input)?;
        let start = Instant::now();
        let first_result = solver.nth_solution(0, &mut |_| {});
        let first_values = match first_result.solution {
            Some(v) => v,
            None => {
                self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;
                self.counters = Some(first_result.counters);
                self.setup_time_ms = setup_ms;
                return Ok(None);
            }
        };
        let second_result = solver.nth_solution(1, &mut |_| {});
        self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;
        self.counters = Some(second_result.counters);
        self.setup_time_ms = setup_ms;
        if second_result.solution.is_some() {
            return Ok(None);
        }
        Ok(Some(Solution::new(first_values, shape)))
    }

    /// Collect up to `limit` solutions. If `limit` is `None`, collects
    /// all solutions (use with care — may be very large or infinite).
    ///
    /// Mirrors JS `SimpleSolver.solutions(constraints, limit)`.
    pub fn solutions(
        &mut self,
        input: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Solution>, String> {
        let (mut solver, shape, setup_ms) = Self::build(input)?;
        let start = Instant::now();
        let mut solutions = Vec::new();
        let mut n = 0u64;
        loop {
            if let Some(lim) = limit {
                if solutions.len() >= lim {
                    break;
                }
            }
            let result = solver.nth_solution(n, &mut |_| {});
            self.counters = Some(result.counters);
            match result.solution {
                Some(values) => solutions.push(Solution::new(values, shape)),
                None => break,
            }
            n += 1;
        }
        self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;
        self.setup_time_ms = setup_ms;
        Ok(solutions)
    }

    /// Count solutions up to `limit` (0 or `None` = unlimited).
    ///
    /// Mirrors JS `SimpleSolver.countSolutions(constraints, limit)`.
    pub fn count_solutions(&mut self, input: &str, limit: Option<u64>) -> Result<u64, String> {
        let (mut solver, _shape, setup_ms) = Self::build(input)?;
        let start = Instant::now();
        let (count, counters) = solver.count_solutions(limit.unwrap_or(0), &mut |_| {});
        self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;
        self.counters = Some(counters);
        self.setup_time_ms = setup_ms;
        Ok(count)
    }

    /// Find all true candidates (values appearing in valid solutions).
    ///
    /// Mirrors JS `SimpleSolver.trueCandidates(constraints, limit)`.
    pub fn true_candidates(
        &mut self,
        input: &str,
        limit: u8,
    ) -> Result<Option<TrueCandidates>, String> {
        let (mut solver, shape, setup_ms) = Self::build(input)?;
        let start = Instant::now();
        let result = solver.solve_all_possibilities(limit, &mut |_| {});
        self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;

        if result.counters.solutions == 0 {
            self.counters = Some(result.counters);
            self.setup_time_ms = setup_ms;
            return Ok(None);
        }

        let witness_solutions: Vec<Solution> = result
            .solutions
            .into_iter()
            .map(|values| Solution::new(values, shape))
            .collect();

        self.counters = Some(result.counters);
        self.setup_time_ms = setup_ms;

        Ok(Some(TrueCandidates {
            counts: result.candidate_counts,
            shape,
            limit,
            num_values: shape.num_values as usize,
            witness_solutions,
        }))
    }

    /// Validate a layout (e.g. jigsaw) by checking whether any solution
    /// exists.
    ///
    /// Mirrors JS `SimpleSolver.validateLayout(constraints)`.
    pub fn validate_layout(&mut self, input: &str) -> Result<Option<Solution>, String> {
        let (mut solver, shape, setup_ms) = Self::build(input)?;
        let start = Instant::now();
        let result = solver.validate_layout(&mut |_| {});
        self.runtime_ms = start.elapsed().as_secs_f64() * 1000.0;
        self.counters = Some(result.counters);
        self.setup_time_ms = setup_ms;
        Ok(result.solution.map(|values| Solution::new(values, shape)))
    }

    /// Get counters from the last solve operation.
    ///
    /// Mirrors JS `SimpleSolver.latestStats()`.
    pub fn latest_counters(&self) -> Option<&SolverCounters> {
        self.counters.as_ref()
    }

    /// Setup time (parse + build) in milliseconds from the last operation.
    ///
    /// Mirrors JS `SolverStats.setupTimeMs` (from `state.puzzleSetupTime`).
    pub fn setup_time_ms(&self) -> f64 {
        self.setup_time_ms
    }

    /// Runtime (solver execution) in milliseconds from the last operation.
    ///
    /// Mirrors JS `SolverStats.runtimeMs` (from `state.timeMs`).
    pub fn runtime_ms(&self) -> f64 {
        self.runtime_ms
    }
}

// ---------------------------------------------------------------------------
// Solution
// ---------------------------------------------------------------------------

/// A single solution — 1-based values per cell.
///
/// Mirrors JS `Solution` in `js/sandbox/simple_solver.js`.
pub struct Solution {
    values: Vec<u8>,
    shape: GridShape,
}

impl Solution {
    fn new(values: Vec<u8>, shape: GridShape) -> Self {
        Self { values, shape }
    }

    /// Value at a cell index (0-based). Returns 0 for unsolved cells.
    pub fn value_at(&self, index: usize) -> u8 {
        self.values[index]
    }

    /// The raw values slice.
    pub fn values(&self) -> &[u8] {
        &self.values
    }

    /// The grid shape.
    pub fn shape(&self) -> GridShape {
        self.shape
    }
}

/// Display as a short solution string (e.g. 81 chars for 9×9).
///
/// Mirrors JS `Solution.toString()` → `toShortSolution()`.
impl fmt::Display for Solution {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = parser::to_short_solution(&self.values, self.shape);
        f.write_str(&s)
    }
}

impl PartialEq for Solution {
    fn eq(&self, other: &Self) -> bool {
        self.values == other.values && self.shape == other.shape
    }
}

impl PartialEq<str> for Solution {
    fn eq(&self, other: &str) -> bool {
        self.to_string() == other
    }
}

impl fmt::Debug for Solution {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Solution({})", self)
    }
}

// ---------------------------------------------------------------------------
// TrueCandidates
// ---------------------------------------------------------------------------

/// True candidates — per-cell-per-value counts from an exhaustive solve.
///
/// Mirrors JS `TrueCandidates` in `js/sandbox/simple_solver.js`.
pub struct TrueCandidates {
    /// Flat array: `counts[cell * num_values + (value - 1)]`.
    counts: Vec<u8>,
    shape: GridShape,
    limit: u8,
    num_values: usize,
    witness_solutions: Vec<Solution>,
}

impl TrueCandidates {
    /// All witness solutions found during the search.
    pub fn witness_solutions(&self) -> &[Solution] {
        &self.witness_solutions
    }

    /// Candidate values at a cell index (1-based values).
    pub fn values_at(&self, cell_index: usize) -> Vec<u8> {
        let base = cell_index * self.num_values;
        let mut values = Vec::new();
        for i in 0..self.num_values {
            if self.counts[base + i] > 0 {
                values.push((i + 1) as u8);
            }
        }
        values
    }

    /// Count for a specific value (1-based) at a cell, capped at `limit`.
    pub fn count_at(&self, cell_index: usize, value: u8) -> u8 {
        let idx = cell_index * self.num_values + (value as usize - 1);
        self.counts[idx].min(self.limit)
    }

    /// The grid shape.
    pub fn shape(&self) -> GridShape {
        self.shape
    }

    /// The raw candidate counts slice.
    pub fn counts(&self) -> &[u8] {
        &self.counts
    }
}

/// Display as a candidate string: value chars for candidates, '.' for
/// non-candidates.
///
/// Mirrors JS `TrueCandidates.toString()`.
impl fmt::Display for TrueCandidates {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let base_char = self.shape.base_char_code();
        let num_cells = self.shape.num_cells as usize;
        for i in 0..num_cells {
            let base_idx = i * self.num_values;
            for v in 0..self.num_values {
                if self.counts[base_idx + v] > 0 {
                    write!(f, "{}", char::from(base_char + v as u8))?;
                } else {
                    write!(f, ".")?;
                }
            }
        }
        Ok(())
    }
}

impl fmt::Debug for TrueCandidates {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "TrueCandidates({} cells, {} solutions)",
            self.shape.num_cells,
            self.witness_solutions.len()
        )
    }
}
