pub mod grid;
pub mod util;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
use serde::{Deserialize, Serialize};

// ============================================================================
// Serde types for the WASM boundary
// ============================================================================

#[cfg(feature = "wasm")]
#[derive(Deserialize)]
struct SolverInput {
    puzzle: String,
    #[serde(default)]
    cages: Vec<CageInput>,
}

#[cfg(feature = "wasm")]
#[derive(Deserialize)]
struct CageInput {
    cells: Vec<usize>,
    sum: u32,
}

#[cfg(feature = "wasm")]
#[derive(Serialize)]
struct SolverOutput {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    solution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    counters: SolverCounters,
}

#[derive(Clone, Default)]
#[cfg_attr(feature = "wasm", derive(Serialize))]
pub struct SolverCounters {
    pub solutions: u64,
    pub backtracks: u64,
    pub guesses: u64,
    #[cfg_attr(feature = "wasm", serde(rename = "valuesTried"))]
    pub values_tried: u64,
    #[cfg_attr(feature = "wasm", serde(rename = "constraintsProcessed"))]
    pub constraints_processed: u64,
    #[cfg_attr(feature = "wasm", serde(rename = "progressRatio"))]
    pub progress_ratio: f64,
}

// ============================================================================
// WASM entry points
// ============================================================================

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_sudoku(input: &str) -> String {
    let result = solve_sudoku_impl(input);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        format!(
            r#"{{"success":false,"error":"Serialization error: {}","counters":{{}}}}"#,
            e
        )
    })
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn solve_sudoku_with_progress(
    input: &str,
    callback: &js_sys::Function,
    log_frequency: u32,
) -> String {
    // TODO: Wire up progress callback in Sprint 4
    let _ = (callback, log_frequency);
    let result = solve_sudoku_impl(input);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        format!(
            r#"{{"success":false,"error":"Serialization error: {}","counters":{{}}}}"#,
            e
        )
    })
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn count_solutions_with_progress(
    input: &str,
    callback: &js_sys::Function,
    log_frequency: u32,
    limit: u32,
) -> String {
    // TODO: Wire up count + progress in Sprint 4
    let _ = (input, callback, log_frequency, limit);
    let result = CountOutput {
        count: 0,
        counters: SolverCounters::default(),
    };
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"count":0,"counters":{}}"#.to_string())
}

#[cfg(feature = "wasm")]
#[derive(Serialize)]
struct CountOutput {
    count: u64,
    counters: SolverCounters,
}

// ============================================================================
// Shared implementation (used by both WASM and native)
// ============================================================================

#[cfg(feature = "wasm")]
fn solve_sudoku_impl(input: &str) -> SolverOutput {
    let parsed: Result<SolverInput, _> = serde_json::from_str(input);
    let parsed = match parsed {
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

    match grid::Grid::from_str(&parsed.puzzle) {
        Ok(grid) => {
            // TODO: Solve in Sprint 1
            let _ = grid;
            SolverOutput {
                success: false,
                solution: None,
                error: Some("Solver not yet implemented".to_string()),
                counters: SolverCounters::default(),
            }
        }
        Err(e) => SolverOutput {
            success: false,
            solution: None,
            error: Some(format!("Invalid puzzle: {}", e)),
            counters: SolverCounters::default(),
        },
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
}
