//! WASM entry points.
//!
//! The JS worker calls [`init_solver`] once (which builds the solver and
//! stores it in thread-local storage), then calls method functions
//! (`nth_solution_with_progress`, `count_solutions_with_progress`, etc.)
//! that reuse the stored solver. This mirrors how the JS solver worker
//! builds once during `init` and then calls methods on the stored solver.

use std::cell::RefCell;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::api::types::{
    AllPossibilitiesOutput, CountOutput, EstimateOutput, SolverInput, SolverOutput,
};
use crate::api::{build_solver_from_input, parse_step_guides, step_result_to_output};
use crate::grid;
use crate::solver::debug::SolverProgress;
use crate::solver::{self, SolverCounters};

// ============================================================================
// Helpers
// ============================================================================

fn serialize_or_error<T: Serialize>(result: &T) -> String {
    serde_json::to_string(result).unwrap_or_else(|e| {
        format!(
            r#"{{"success":false,"error":"Serialization error: {}","counters":{{}}}}"#,
            e
        )
    })
}

/// Create a progress closure that serializes progress data to JSON and calls
/// the JS callback. Used by all WASM entry points with progress support.
fn make_js_progress_fn<'a>(callback: &'a js_sys::Function) -> impl FnMut(&SolverProgress) + 'a {
    let this = JsValue::null();
    move |progress: &SolverProgress| {
        if let Ok(json) = serde_json::to_string(progress) {
            let _ = callback.call1(&this, &JsValue::from_str(&json));
        }
    }
}

// ============================================================================
// Entry points (init_solver required)
// ============================================================================

thread_local! {
    /// Persistent solver shared by all stateful WASM entry points.
    ///
    /// Set by [`init_solver`], used by [`nth_solution_with_progress`],
    /// [`nth_step_with_progress`], [`count_solutions_with_progress`], and
    /// [`solve_all_possibilities_with_progress`].
    static SOLVER: RefCell<Option<solver::Solver>> = const { RefCell::new(None) };
}

/// Build a solver from JSON input and store it for later method calls.
///
/// Returns an empty string on success, or an error message on failure.
/// All construction errors (unsupported constraints, invalid puzzles, etc.)
/// surface here — matching how the JS solver throws during `SudokuBuilder.build`.
///
/// The solver is reused by all subsequent stateful method calls.
#[wasm_bindgen]
pub fn init_solver(input: &str, log_frequency: u32) -> String {
    let parsed: SolverInput = match serde_json::from_str(input) {
        Ok(p) => p,
        Err(e) => return format!("Failed to parse input: {}", e),
    };

    let solver = match build_solver_from_input(&parsed, Some(log_frequency)) {
        Ok(s) => s,
        Err(e) => return e,
    };

    SOLVER.with(|cell| {
        *cell.borrow_mut() = Some(solver);
    });

    String::new()
}

/// Count solutions with a progress callback.
///
/// Requires [`init_solver`] to have been called first.
/// Returns JSON `CountOutput { count, counters }`.
/// `limit`: max solutions to find (0 = unlimited).
#[wasm_bindgen]
pub fn count_solutions_with_progress(callback: &js_sys::Function, limit: u32) -> String {
    SOLVER.with(|cell| {
        let mut opt = cell.borrow_mut();
        let solver = match opt.as_mut() {
            Some(s) => s,
            None => {
                return serialize_or_error(&CountOutput {
                    count: 0,
                    error: Some("Solver not initialized".to_string()),
                    counters: SolverCounters::default(),
                });
            }
        };

        let mut progress = make_js_progress_fn(callback);
        let (count, counters) = solver.count_solutions_with_progress(limit as u64, &mut progress);

        serialize_or_error(&CountOutput {
            count,
            error: None,
            counters,
        })
    })
}

/// Validate the layout by attempting to find any solution.
///
/// Requires [`init_solver`] to have been called first.
/// Returns JSON `SolverOutput { success, solution, counters }`.
#[wasm_bindgen]
pub fn validate_layout_with_progress(callback: &js_sys::Function) -> String {
    SOLVER.with(|cell| {
        let mut opt = cell.borrow_mut();
        let solver = match opt.as_mut() {
            Some(s) => s,
            None => {
                return serialize_or_error(&SolverOutput {
                    success: false,
                    solution: None,
                    error: Some("Solver not initialized".to_string()),
                    counters: SolverCounters::default(),
                });
            }
        };

        let mut progress = make_js_progress_fn(callback);
        let result = solver.validate_layout_with_progress(&mut progress);

        let solution_str = result
            .solution
            .map(|cells| grid::Grid { cells }.to_puzzle_string());

        serialize_or_error(&SolverOutput {
            success: solution_str.is_some(),
            solution: solution_str,
            error: None,
            counters: result.counters,
        })
    })
}

/// Estimate the number of solutions using Knuth's random-walk method.
///
/// Requires [`init_solver`] to have been called first.
/// Returns JSON `EstimateOutput { estimate, samples, counters }`.
///
/// `max_samples`: maximum Monte Carlo samples (0 = unlimited / run until
/// the worker is terminated, matching JS behavior).
///
/// Progress callbacks include `extra.estimate` with the running average.
#[wasm_bindgen]
pub fn estimated_count_solutions_with_progress(
    callback: &js_sys::Function,
    max_samples: u32,
) -> String {
    SOLVER.with(|cell| {
        let mut opt = cell.borrow_mut();
        let solver = match opt.as_mut() {
            Some(s) => s,
            None => {
                return serialize_or_error(&EstimateOutput {
                    estimate: 0.0,
                    samples: 0,
                    error: Some("Solver not initialized".to_string()),
                    counters: SolverCounters::default(),
                });
            }
        };

        let mut progress = make_js_progress_fn(callback);
        let (estimate, samples, counters) =
            solver.estimated_count_solutions(max_samples as u64, &mut progress);

        serialize_or_error(&EstimateOutput {
            estimate,
            samples,
            error: None,
            counters,
        })
    })
}

/// Solve all possibilities with a progress callback.
///
/// Requires [`init_solver`] to have been called first.
/// Returns JSON `AllPossibilitiesOutput { candidateCounts, solutions,
/// numSolutions, counters }`.
/// `threshold`: candidate support threshold (1–255).
#[wasm_bindgen]
pub fn solve_all_possibilities_with_progress(callback: &js_sys::Function, threshold: u8) -> String {
    SOLVER.with(|cell| {
        let mut opt = cell.borrow_mut();
        let solver = match opt.as_mut() {
            Some(s) => s,
            None => {
                return serialize_or_error(&AllPossibilitiesOutput {
                    candidate_counts: Vec::new(),
                    solutions: Vec::new(),
                    num_solutions: 0,
                    error: Some("Solver not initialized".to_string()),
                    counters: SolverCounters::default(),
                });
            }
        };

        let mut progress = make_js_progress_fn(callback);
        let result = solver.solve_all_possibilities(threshold, &mut progress);

        let solutions: Vec<String> = result
            .solutions
            .iter()
            .map(|sol| grid::Grid { cells: sol.clone() }.to_puzzle_string())
            .collect();

        serialize_or_error(&AllPossibilitiesOutput {
            candidate_counts: result.candidate_counts,
            solutions,
            num_solutions: result.counters.solutions,
            error: None,
            counters: result.counters,
        })
    })
}

/// Find the nth solution (0-indexed) with a progress callback.
///
/// Requires [`init_solver`] to have been called first. The solver is kept
/// in thread-local storage so that sequential forward calls
/// (`nthSolution(0)`, `nthSolution(1)`, …) are incremental.
///
/// Returns JSON `SolverOutput { success, solution, counters }`.
#[wasm_bindgen]
pub fn nth_solution_with_progress(n: u32, callback: &js_sys::Function) -> String {
    SOLVER.with(|cell| {
        let mut opt = cell.borrow_mut();
        let solver = match opt.as_mut() {
            Some(s) => s,
            None => {
                return serialize_or_error(&SolverOutput {
                    success: false,
                    solution: None,
                    error: Some("Solver not initialized".to_string()),
                    counters: SolverCounters::default(),
                });
            }
        };

        let mut progress = make_js_progress_fn(callback);
        let result = solver.nth_solution(n as u64, &mut progress);

        let solution_str = result
            .solution
            .map(|cells| grid::Grid { cells }.to_puzzle_string());

        serialize_or_error(&SolverOutput {
            success: solution_str.is_some(),
            solution: solution_str,
            error: None,
            counters: result.counters,
        })
    })
}

/// Find the nth step (0-indexed) with a progress callback.
///
/// Requires [`init_solver`] to have been called first.
///
/// `step_guides_json`: JSON object mapping step numbers to guides, e.g.
///   `{"3": {"cell": 42, "value": 5, "depth": 0}}`.
///
/// Returns JSON `StepOutput` or `"null"` if no more steps exist.
#[wasm_bindgen]
pub fn nth_step_with_progress(
    n: u32,
    step_guides_json: &str,
    callback: &js_sys::Function,
) -> String {
    SOLVER.with(|cell| {
        let mut opt = cell.borrow_mut();
        let solver = match opt.as_mut() {
            Some(s) => s,
            None => {
                return serialize_or_error(&SolverOutput {
                    success: false,
                    solution: None,
                    error: Some("Solver not initialized".to_string()),
                    counters: SolverCounters::default(),
                });
            }
        };

        let step_guides = parse_step_guides(step_guides_json);
        let mut progress = make_js_progress_fn(callback);
        let result = solver.nth_step(n as u64, step_guides, &mut progress);

        match result {
            Some(step) => {
                let output = step_result_to_output(&step);
                serialize_or_error(&output)
            }
            None => "null".to_string(),
        }
    })
}
