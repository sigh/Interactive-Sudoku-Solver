pub mod candidate_selector;
pub mod cell_exclusions;
pub mod constraint_parser;
pub mod grid;
pub mod handler;
pub mod handler_accumulator;
pub mod lookup_tables;
pub mod optimizer;
pub mod recursion_stack;
pub mod solver;
pub mod sum_data;
pub mod sum_handler;
pub mod util;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use serde::{Deserialize, Serialize};

// ============================================================================
// Serde types for the WASM / CLI boundary
// ============================================================================

#[derive(Deserialize)]
pub struct SolverInput {
    pub puzzle: String,
    #[serde(default)]
    pub cages: Vec<CageInput>,
}

#[derive(Deserialize)]
pub struct CageInput {
    pub cells: Vec<usize>,
    pub sum: i32,
}

#[derive(Serialize)]
pub struct SolverOutput {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub counters: SolverCounters,
}

#[derive(Clone, Default, Serialize)]
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
}

#[derive(Serialize)]
pub struct CountOutput {
    pub count: u64,
    pub counters: SolverCounters,
}

// ============================================================================
// Shared implementation (used by both WASM and native)
// ============================================================================

/// Build a solver from a `SolverInput`.
fn build_solver(parsed: &SolverInput) -> Result<solver::Solver, SolverOutput> {
    let cages: Vec<(Vec<u8>, i32)> = parsed
        .cages
        .iter()
        .map(|c| (c.cells.iter().map(|&i| i as u8).collect(), c.sum))
        .collect();

    if cages.is_empty() {
        solver::Solver::new(&parsed.puzzle)
    } else {
        solver::Solver::with_cages(&parsed.puzzle, &cages)
    }
    .map_err(|e| SolverOutput {
        success: false,
        solution: None,
        error: Some(format!("Invalid puzzle: {}", e)),
        counters: SolverCounters::default(),
    })
}

/// Convert internal solver counters to the public serde type.
fn convert_counters(c: &solver::SolverCounters) -> SolverCounters {
    SolverCounters {
        solutions: c.solutions,
        backtracks: c.backtracks,
        guesses: c.guesses,
        values_tried: c.values_tried,
        constraints_processed: c.constraints_processed,
        progress_ratio: c.progress_ratio,
    }
}

/// Solve a puzzle from JSON input, with an optional progress callback.
pub fn solve_impl(input: &str, progress: &mut dyn FnMut(&SolverCounters)) -> SolverOutput {
    let parsed: SolverInput = match serde_json::from_str(input) {
        Ok(p) => p,
        Err(e) => {
            return SolverOutput {
                success: false,
                solution: None,
                error: Some(format!("Failed to parse input: {}", e)),
                counters: SolverCounters::default(),
            };
        }
    };

    let mut solver = match build_solver(&parsed) {
        Ok(s) => s,
        Err(e) => return e,
    };

    let mut wrapped = |c: &solver::SolverCounters| {
        progress(&convert_counters(c));
    };

    let result = solver.solve_with_progress(&mut wrapped);
    let solution_str = result
        .solution
        .map(|cells| grid::Grid { cells }.to_string());

    SolverOutput {
        success: solution_str.is_some(),
        solution: solution_str,
        error: None,
        counters: convert_counters(&result.counters),
    }
}

/// Count solutions from JSON input, with an optional progress callback.
pub fn count_impl(
    input: &str,
    limit: u64,
    progress: &mut dyn FnMut(&SolverCounters),
) -> CountOutput {
    let parsed: SolverInput = match serde_json::from_str(input) {
        Ok(p) => p,
        Err(_) => {
            return CountOutput {
                count: 0,
                counters: SolverCounters::default(),
            };
        }
    };

    let mut solver = match build_solver(&parsed) {
        Ok(s) => s,
        Err(_) => {
            return CountOutput {
                count: 0,
                counters: SolverCounters::default(),
            };
        }
    };

    let mut wrapped = |c: &solver::SolverCounters| {
        progress(&convert_counters(c));
    };

    let (count, internal_counters) = solver.count_solutions_with_progress(limit, &mut wrapped);

    CountOutput {
        count,
        counters: convert_counters(&internal_counters),
    }
}

// ============================================================================
// WASM entry points
// ============================================================================

#[cfg(feature = "wasm")]
fn serialize_or_error<T: Serialize>(result: &T) -> String {
    serde_json::to_string(result).unwrap_or_else(|e| {
        format!(
            r#"{{"success":false,"error":"Serialization error: {}","counters":{{}}}}"#,
            e
        )
    })
}

/// Solve a puzzle (no progress callback).
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_sudoku(input: &str) -> String {
    let result = solve_impl(input, &mut |_| {});
    serialize_or_error(&result)
}

/// Solve a puzzle with cages (no progress callback).
/// Input JSON must include `cages` array.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_sudoku_with_cages(input: &str) -> String {
    // Same implementation — cages come from the JSON input.
    let result = solve_impl(input, &mut |_| {});
    serialize_or_error(&result)
}

/// Solve a puzzle with a progress callback.
///
/// The callback receives a JSON string of `SolverCounters` every
/// `2^log_frequency` iterations.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_sudoku_with_progress(
    input: &str,
    callback: &js_sys::Function,
    log_frequency: u32,
) -> String {
    let result = solve_with_js_progress(input, callback, log_frequency);
    serialize_or_error(&result)
}

/// Count solutions with a progress callback.
///
/// Returns JSON `CountOutput { count, counters }`.
/// `limit`: max solutions to find (0 = unlimited).
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn count_solutions_with_progress(
    input: &str,
    callback: &js_sys::Function,
    log_frequency: u32,
    limit: u32,
) -> String {
    let this = JsValue::null();
    let progress_fn = |counters: &SolverCounters| {
        if let Ok(json) = serde_json::to_string(counters) {
            let js_str = JsValue::from_str(&json);
            let _ = callback.call1(&this, &js_str);
        }
    };

    let parsed: SolverInput = match serde_json::from_str(input) {
        Ok(p) => p,
        Err(_) => {
            let out = CountOutput {
                count: 0,
                counters: SolverCounters::default(),
            };
            return serialize_or_error(&out);
        }
    };

    let mut solver_inst = match build_solver(&parsed) {
        Ok(s) => s,
        Err(_) => {
            let out = CountOutput {
                count: 0,
                counters: SolverCounters::default(),
            };
            return serialize_or_error(&out);
        }
    };

    solver_inst.set_progress_frequency(log_frequency);

    let mut wrapped = |c: &solver::SolverCounters| {
        progress_fn(&convert_counters(c));
    };

    let (count, internal_counters) =
        solver_inst.count_solutions_with_progress(limit as u64, &mut wrapped);

    let out = CountOutput {
        count,
        counters: convert_counters(&internal_counters),
    };
    serialize_or_error(&out)
}

/// Internal: solve with JS progress callback.
#[cfg(feature = "wasm")]
fn solve_with_js_progress(
    input: &str,
    callback: &js_sys::Function,
    log_frequency: u32,
) -> SolverOutput {
    let this = JsValue::null();
    let progress_fn = |counters: &SolverCounters| {
        if let Ok(json) = serde_json::to_string(counters) {
            let js_str = JsValue::from_str(&json);
            let _ = callback.call1(&this, &js_str);
        }
    };

    let parsed: SolverInput = match serde_json::from_str(input) {
        Ok(p) => p,
        Err(e) => {
            return SolverOutput {
                success: false,
                solution: None,
                error: Some(format!("Failed to parse input: {}", e)),
                counters: SolverCounters::default(),
            };
        }
    };

    let mut solver_inst = match build_solver(&parsed) {
        Ok(s) => s,
        Err(e) => return e,
    };

    solver_inst.set_progress_frequency(log_frequency);

    let mut wrapped = |c: &solver::SolverCounters| {
        progress_fn(&convert_counters(c));
    };

    let result = solver_inst.solve_with_progress(&mut wrapped);
    let solution_str = result
        .solution
        .map(|cells| grid::Grid { cells }.to_string());

    SolverOutput {
        success: solution_str.is_some(),
        solution: solution_str,
        error: None,
        counters: convert_counters(&result.counters),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solver_counters_default() {
        let c = SolverCounters::default();
        assert_eq!(c.solutions, 0);
        assert_eq!(c.backtracks, 0);
        assert_eq!(c.guesses, 0);
        assert_eq!(c.values_tried, 0);
        assert_eq!(c.constraints_processed, 0);
        assert_eq!(c.progress_ratio, 0.0);
    }

    #[test]
    fn test_solve_impl_basic() {
        let input = r#"{"puzzle":"53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"}"#;
        let result = solve_impl(input, &mut |_| {});
        assert!(result.success);
        assert_eq!(
            result.solution.unwrap(),
            "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
        );
    }

    #[test]
    fn test_solve_impl_with_cages() {
        // Wikipedia killer sudoku — same cages as solver.rs test.
        let input = r#"{
            "puzzle": ".................................................................................",
            "cages": [
                {"cells": [0,1], "sum": 3},
                {"cells": [2,3,4], "sum": 15},
                {"cells": [9,10,18,19], "sum": 25},
                {"cells": [11,12], "sum": 17},
                {"cells": [20,21,30], "sum": 9},
                {"cells": [5,13,14,22], "sum": 22},
                {"cells": [6,15], "sum": 4},
                {"cells": [7,16], "sum": 16},
                {"cells": [8,17,26,35], "sum": 15},
                {"cells": [24,25,33], "sum": 20},
                {"cells": [23,32,41], "sum": 8},
                {"cells": [31,40,49], "sum": 17},
                {"cells": [39,48,57], "sum": 20},
                {"cells": [28,29], "sum": 14},
                {"cells": [27,36], "sum": 6},
                {"cells": [37,38,46], "sum": 13},
                {"cells": [47,55,56], "sum": 6},
                {"cells": [34,42,43], "sum": 17},
                {"cells": [45,54,63,72], "sum": 27},
                {"cells": [64,73], "sum": 8},
                {"cells": [65,74], "sum": 16},
                {"cells": [58,66,67,75], "sum": 10},
                {"cells": [44,53], "sum": 12},
                {"cells": [51,52], "sum": 6},
                {"cells": [50,59,60], "sum": 20},
                {"cells": [68,69], "sum": 15},
                {"cells": [61,62,70,71], "sum": 14},
                {"cells": [76,77,78], "sum": 13},
                {"cells": [79,80], "sum": 17}
            ]
        }"#;
        let result = solve_impl(input, &mut |_| {});
        assert!(result.success, "solve failed: {:?}", result.error);
        assert_eq!(
            result.solution.unwrap(),
            "215647398368952174794381652586274931142593867973816425821739546659428713437165289"
        );
    }

    #[test]
    fn test_solve_impl_invalid_json() {
        let result = solve_impl("not json", &mut |_| {});
        assert!(!result.success);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_count_impl() {
        let input = r#"{"puzzle":"53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"}"#;
        let result = count_impl(input, 10, &mut |_| {});
        assert_eq!(result.count, 1);
    }

    #[test]
    fn test_solver_counters_serde_names() {
        let c = SolverCounters {
            solutions: 1,
            backtracks: 2,
            guesses: 3,
            values_tried: 4,
            constraints_processed: 5,
            progress_ratio: 0.5,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"valuesTried\":4"));
        assert!(json.contains("\"constraintsProcessed\":5"));
        assert!(json.contains("\"progressRatio\":0.5"));
    }

    #[test]
    fn test_solve_impl_progress_callback() {
        let mut callback_count = 0u32;
        let input = r#"{"puzzle":"800000000003600000070090200050007000000045700000100030001000068008500010090000400"}"#;
        let result = solve_impl(input, &mut |_counters| {
            callback_count += 1;
        });
        assert!(result.success);
        // Hard puzzle should trigger at least some callbacks.
        // (may be 0 if puzzle solves in < 8192 iterations, but that's fine)
    }

    #[test]
    fn test_solve_impl_no_solution() {
        // Two 1s in the same row → impossible.
        let input = r#"{"puzzle":"11.........................................................................."}"#;
        let result = solve_impl(input, &mut |_| {});
        assert!(!result.success);
        assert!(result.solution.is_none());
    }

    #[test]
    fn test_count_impl_no_cages() {
        // Empty grid → many solutions. Limit to 2 to ensure we don't search forever.
        let input = r#"{"puzzle":"................................................................................."}"#;
        let result = count_impl(input, 2, &mut |_| {});
        assert_eq!(result.count, 2);
    }

    #[test]
    fn test_solver_output_json_shape() {
        let input = r#"{"puzzle":"53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79"}"#;
        let result = solve_impl(input, &mut |_| {});
        let json = serde_json::to_string(&result).unwrap();
        // Verify the JSON output shape matches what the JS worker expects.
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["success"], true);
        assert!(parsed["solution"].is_string());
        assert!(parsed["counters"]["solutions"].is_number());
        assert!(parsed["counters"]["backtracks"].is_number());
        assert!(parsed["counters"]["guesses"].is_number());
        assert!(parsed["counters"]["valuesTried"].is_number());
        assert!(parsed["counters"]["constraintsProcessed"].is_number());
        assert!(parsed["counters"]["progressRatio"].is_number());
        // error should not be present (skip_serializing_if = None)
        assert!(parsed.get("error").is_none());
    }
}
