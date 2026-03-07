//! Solver engine — core backtracking solver with constraint propagation.
//!
//! Split into submodules:
//! - `internal_solver`: The `InternalSolver` search engine.
//! - `solver`: The outer `Solver` wrapper with iteration management.

mod internal_solver;
mod recursion_stack;
mod seen_candidate_set;
mod solver;

pub use solver::Solver;

use super::handler_accumulator::HandlerAccumulator;
use super::debug::DebugLog;
use crate::api::types::{CellIndex, Value};
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use serde::Serialize;

/// Solver counters tracking search statistics.
///
/// Mirrors JS `SudokuSolver.state()` shape. Field names are camelCase
/// in JSON to match the JS worker protocol.
#[derive(Clone, Default, Debug, Serialize)]
pub struct SolverCounters {
    pub solutions: u64,
    pub backtracks: u64,
    pub guesses: u64,
    #[serde(rename = "valuesTried")]
    pub values_tried: u64,
    #[serde(rename = "constraintsProcessed")]
    pub constraints_processed: u64,
    #[serde(rename = "progressRatio")]
    pub progress_ratio: f64,
    #[serde(rename = "nodesSearched")]
    pub nodes_searched: u64,
    #[serde(rename = "branchesIgnored")]
    pub branches_ignored: f64,
    /// Internal field: accumulated progress from previous runs.
    /// Not serialized — only used internally by the engine.
    #[serde(skip)]
    pub progress_ratio_prev: f64,
}

/// Result of a solve operation.
#[derive(Debug)]
pub struct SolveResult {
    pub solution: Option<Vec<u8>>,
    pub counters: SolverCounters,
}

/// Result of a solve-all-possibilities operation.
#[derive(Debug)]
pub struct AllPossibilitiesResult {
    /// Per-cell-per-value counts. Index: `cell * num_values + value_index`.
    /// `value_index` is 0-indexed (value 1 → index 0, value 9 → index 8).
    /// Counts are saturated at the threshold.
    pub candidate_counts: Vec<u8>,
    /// All solutions found (each as a 1-based value-per-cell vector).
    pub solutions: Vec<Vec<u8>>,
    pub counters: SolverCounters,
}

// ============================================================================
// Step-by-step solving types
// ============================================================================

/// What kind of step occurred.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepType {
    Guess,
    Solution,
    Contradiction,
}

/// Raw step data yielded by run_impl (CandidateSet grids, not pencilmarks).
#[derive(Debug, Clone)]
pub struct StepResult {
    /// Current grid state after this step.
    pub grid: Vec<CandidateSet>,
    /// Grid state before the last guess was applied.
    pub old_grid: Vec<CandidateSet>,
    /// What kind of step this is.
    pub step_type: StepType,
    /// Depth of the guess cell in cell_order (-1 if no guess).
    pub guess_depth: i32,
    /// Cell order snapshot up to guess_depth+1 (the branch path).
    pub branch_cells: Vec<CellIndex>,
}

/// A user-provided step guide entry.
#[derive(Debug, Clone)]
pub struct StepGuide {
    pub cell: Option<CellIndex>,
    pub value: Option<Value>,
    pub depth: usize,
}

/// Convert a CandidateSet grid to a solution vector of 1-based values.
///
/// Matches JS `SudokuSolverUtil.gridToSolution()` in engine.js.
pub(crate) fn grid_to_solution(grid: &[CandidateSet]) -> Vec<u8> {
    grid.iter()
        .map(|&c| if c.is_single() { c.value() } else { 0 })
        .collect()
}

/// Run constraint propagation until no more handlers fire.
///
/// Free function to avoid borrow conflicts: the accumulator owns the
/// handlers but we need `&mut` access to both the queue state and
/// the handler's `enforce_consistency` method. By calling `enforce_at`
/// which borrows handler and queue separately, this works.
///
/// Returns `false` if a contradiction was found.
pub(super) fn enforce_constraints_on(
    grid: &mut [CandidateSet],
    accumulator: &mut HandlerAccumulator,
    counters: &mut SolverCounters,
) -> bool {
    while !accumulator.is_empty() {
        let idx = accumulator.take_next();
        counters.constraints_processed += 1;
        if !accumulator.enforce_at(idx, grid) {
            return false;
        }
    }
    true
}

/// Debug variant of constraint propagation with per-handler grid diffing.
///
/// Mirrors JS `_enforceConstraints` when `logSteps` is true, which routes
/// every handler call through `_debugEnforceConsistency`. Produces per-handler
/// log entries showing which candidates each handler removed.
///
/// `scratch` is a reusable buffer (same length as `grid`) for storing the
/// pre-handler grid snapshot, avoiding per-call allocation.
///
/// Returns `false` if a contradiction was found.
pub(super) fn debug_enforce_constraints(
    loc: &str,
    grid: &mut [CandidateSet],
    accumulator: &mut HandlerAccumulator,
    counters: &mut SolverCounters,
    debug_logs: &mut Vec<DebugLog>,
    scratch: &mut [CandidateSet],
    shape: GridShape,
    log_level: u8,
) -> bool {
    while !accumulator.is_empty() {
        let idx = accumulator.take_next();
        counters.constraints_processed += 1;

        // Snapshot the grid before the handler runs.
        scratch[..grid.len()].copy_from_slice(grid);

        // Run the handler (same as enforce_at).
        let result = accumulator.enforce_at(idx, grid);

        // Get handler info for logging.
        let handler = &accumulator.handlers()[idx];
        let handler_name = handler.name();
        let handler_cells = handler.cells();

        // Diff the grid to find removed candidates.
        let num_cells = shape.num_cells;
        let mut changed = false;
        for i in 0..num_cells {
            if scratch[i] != grid[i] {
                changed = true;
                break;
            }
        }

        if changed {
            let mut args = serde_json::Map::new();
            let mut candidates: Vec<Vec<Value>> = vec![Vec::new(); num_cells];
            for i in 0..num_cells {
                if scratch[i] != grid[i] {
                    let removed = (scratch[i] & !grid[i]).to_values();
                    let cell_id = shape.cell_id_from_index(i);
                    args.insert(
                        cell_id,
                        serde_json::Value::Array(
                            removed.iter().map(|&v| serde_json::Value::Number(v.into())).collect(),
                        ),
                    );
                    candidates[i] = removed;
                }
            }

            debug_logs.push(DebugLog {
                loc: loc.to_string(),
                msg: format!("{} removed: ", handler_name),
                args: Some(serde_json::Value::Object(args)),
                important: false,
                cells: handler_cells.to_vec(),
                candidates,
                overlay: Vec::new(),
            });
        } else if log_level >= 2 {
            debug_logs.push(DebugLog {
                loc: loc.to_string(),
                msg: format!("{} ran", handler_name),
                args: None,
                important: false,
                cells: handler_cells.to_vec(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }

        if !result {
            debug_logs.push(DebugLog {
                loc: loc.to_string(),
                msg: format!("{} returned false", handler_name),
                args: None,
                important: false,
                cells: handler_cells.to_vec(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
            return false;
        }
    }
    true
}
