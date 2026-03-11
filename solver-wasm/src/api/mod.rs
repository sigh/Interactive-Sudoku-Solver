//! Platform-agnostic solver API.
//!
//! This module provides solver construction from JSON input and result
//! conversion helpers. The WASM entry points live in [`wasm`].
//!
//! For a convenient high-level API, see [`crate::simple_solver::SimpleSolver`].

pub mod types;

#[cfg(feature = "wasm")]
pub mod wasm;

use std::collections::HashMap;

use self::types::*;
use crate::candidate_set::CandidateSet;
use crate::constraint;
use crate::constraint::builder as sudoku_builder;
use crate::grid_shape::GridShape;
use crate::solver;

// ============================================================================
// Solver construction
// ============================================================================

/// Build a solver from a `SolverInput`, optionally setting progress frequency.
pub(crate) fn build_solver_from_input(
    parsed: &SolverInput,
    log_frequency: Option<u32>,
) -> Result<solver::Solver, String> {
    let parsed_constraints = constraint::parser::parse(&parsed.constraint_string)?;

    let mut solver =
        sudoku_builder::SudokuBuilder::build(&parsed_constraints, parsed.debug_options.clone())?;

    if let Some(freq) = log_frequency {
        solver.set_progress_frequency(freq);
    }

    Ok(solver)
}

// ============================================================================
// Conversion helpers
// ============================================================================

/// Convert a CandidateSet to a list of values (1-9).
pub(crate) fn candidate_set_to_values(cs: CandidateSet) -> Vec<Value> {
    cs.to_values()
}

/// Convert a `StepResult` (CandidateSet grids) into a `StepOutput` (pencilmarks).
pub(crate) fn step_result_to_output(step: &solver::StepResult, shape: GridShape) -> StepOutput {
    // Build pencilmarks: single values are bare numbers, multi are arrays.
    let pencilmarks: Vec<serde_json::Value> = step
        .grid
        .iter()
        .map(|&cs| {
            let vals = candidate_set_to_values(cs);
            if vals.len() == 1 {
                serde_json::Value::Number(serde_json::Number::from(vals[0]))
            } else {
                serde_json::Value::Array(
                    vals.iter()
                        .map(|&v| serde_json::Value::Number(serde_json::Number::from(v)))
                        .collect(),
                )
            }
        })
        .collect();

    let is_solution = step.step_type == solver::StepType::Solution;
    let has_contradiction = step.step_type == solver::StepType::Contradiction;

    let (values, guess_cell, diff_pencilmarks) = if step.guess_depth >= 0 {
        let guess_cell_index = step.branch_cells[step.guess_depth as usize];
        let values = candidate_set_to_values(step.old_grid[guess_cell_index as usize]);

        // Compute diff pencilmarks (values removed between old_grid and grid).
        let diffs: Vec<Vec<Value>> = (0..step.grid.len())
            .map(|i| {
                let removed = step.old_grid[i] & !step.grid[i];
                candidate_set_to_values(removed)
            })
            .collect();

        let guess_cell_id = shape.cell_id_from_index(guess_cell_index as usize);
        (Some(values), Some(guess_cell_id), Some(diffs))
    } else {
        (None, None, None)
    };

    StepOutput {
        pencilmarks,
        branch_cells: step.branch_cells.clone(),
        is_solution,
        has_contradiction,
        values,
        guess_cell,
        diff_pencilmarks,
    }
}

/// Parse step guides from JSON.
///
/// Input: `{"3": {"cell": 42, "value": 5, "depth": 0}}`.
/// Output: HashMap<u64, StepGuide>.
pub(crate) fn parse_step_guides(json: &str) -> HashMap<u64, solver::StepGuide> {
    let mut guides = HashMap::new();

    let parsed: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return guides,
    };

    if let serde_json::Value::Object(map) = parsed {
        for (key, val) in map {
            let step_num: u64 = match key.parse() {
                Ok(n) => n,
                Err(_) => continue,
            };

            let cell = val
                .get("cell")
                .and_then(|v| v.as_u64())
                .map(|v| v as CellIndex);
            let value = val.get("value").and_then(|v| v.as_u64()).map(|v| v as u8);
            let depth = val.get("depth").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

            guides.insert(step_num, solver::StepGuide { cell, value, depth });
        }
    }

    guides
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simple_solver::SimpleSolver;
    use crate::solver::SolverCounters;

    #[test]
    fn test_solve_basic() {
        let constraint_str =
            "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
        let mut ss = SimpleSolver::new();
        let sol = ss.solution(constraint_str).unwrap().unwrap();
        assert_eq!(
            sol.to_string(),
            "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
        );
    }

    #[test]
    fn test_solve_killer() {
        let constraint_str = ".Cage~3~R1C1~R1C2.Cage~15~R1C3~R1C4~R1C5.Cage~25~R2C1~R2C2~R3C1~R3C2.Cage~17~R2C3~R2C4.Cage~9~R3C3~R3C4~R4C4.Cage~22~R1C6~R2C5~R2C6~R3C5.Cage~4~R1C7~R2C7.Cage~16~R1C8~R2C8.Cage~15~R1C9~R2C9~R3C9~R4C9.Cage~20~R3C7~R3C8~R4C7.Cage~8~R3C6~R4C6~R5C6.Cage~17~R4C5~R5C5~R6C5.Cage~20~R5C4~R6C4~R7C4.Cage~14~R4C2~R4C3.Cage~6~R4C1~R5C1.Cage~13~R5C2~R5C3~R6C2.Cage~6~R6C3~R7C2~R7C3.Cage~17~R4C8~R5C7~R5C8.Cage~27~R6C1~R7C1~R8C1~R9C1.Cage~8~R8C2~R9C2.Cage~16~R8C3~R9C3.Cage~10~R7C5~R8C4~R8C5~R9C4.Cage~12~R5C9~R6C9.Cage~6~R6C7~R6C8.Cage~20~R6C6~R7C6~R7C7.Cage~15~R8C6~R8C7.Cage~14~R7C8~R7C9~R8C8~R8C9.Cage~13~R9C5~R9C6~R9C7.Cage~17~R9C8~R9C9";
        let mut ss = SimpleSolver::new();
        let sol = ss.solution(constraint_str).unwrap().unwrap();
        assert_eq!(
            sol.to_string(),
            "215647398368952174794381652586274931142593867973816425821739546659428713437165289"
        );
    }

    #[test]
    fn test_solve_invalid_input() {
        let mut ss = SimpleSolver::new();
        let result = ss.solution("not a valid constraint string at all!!!");
        assert!(result.is_err());
    }

    #[test]
    fn test_solve_no_solution() {
        let mut ss = SimpleSolver::new();
        let result = ss.solution(
            "11...............................................................................",
        );
        // Two 1s in the same row → impossible (no solution or parse error).
        match result {
            Ok(sol) => assert!(sol.is_none()),
            Err(_) => {} // Also acceptable if caught during build.
        }
    }

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
    fn test_solver_counters_serde_names() {
        let c = SolverCounters {
            solutions: 1,
            backtracks: 2,
            guesses: 3,
            values_tried: 4,
            constraints_processed: 5,
            progress_ratio: 0.5,
            nodes_searched: 6,
            branches_ignored: 0.1,
            progress_ratio_prev: 0.0,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"valuesTried\":4"));
        assert!(json.contains("\"constraintsProcessed\":5"));
        assert!(json.contains("\"progressRatio\":0.5"));
        assert!(json.contains("\"nodesSearched\":6"));
        assert!(json.contains("\"branchesIgnored\":0.1"));
        // progressRatioPrev is intentionally not serialized.
        assert!(!json.contains("progressRatioPrev"));
    }

    #[test]
    fn test_solver_output_json_shape() {
        // Verify that SolverOutput serializes to the JSON shape the JS
        // worker expects.
        let output = SolverOutput {
            success: true,
            solution: Some("123456789".to_string()),
            error: None,
            counters: SolverCounters::default(),
        };
        let json = serde_json::to_string(&output).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["success"], true);
        assert!(parsed["solution"].is_string());
        assert!(parsed["counters"]["solutions"].is_number());
        assert!(parsed["counters"]["backtracks"].is_number());
        assert!(parsed["counters"]["guesses"].is_number());
        assert!(parsed["counters"]["valuesTried"].is_number());
        assert!(parsed["counters"]["constraintsProcessed"].is_number());
        assert!(parsed["counters"]["progressRatio"].is_number());
        // error should not be present (skip_serializing_if = None).
        assert!(parsed.get("error").is_none());
    }

    #[test]
    fn test_nth_solution_via_solver() {
        // Test the Solver::nth_solution API used by the WASM entry point.
        let puzzle =
            "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
        let parsed = crate::constraint::parser::parse(puzzle).unwrap();
        let mut solver = crate::constraint::builder::SudokuBuilder::build(&parsed, None).unwrap();

        // nth_solution(0) should return the unique solution.
        let r0 = solver.nth_solution(0, &mut |_| {});
        assert!(r0.solution.is_some());

        // nth_solution(1) should return None (only 1 solution exists).
        let r1 = solver.nth_solution(1, &mut |_| {});
        assert!(r1.solution.is_none());
    }

    #[test]
    fn test_nth_solution_incremental_counters() {
        // Sequential forward calls should accumulate counters.
        let empty = ".".repeat(81);
        let parsed = crate::constraint::parser::parse(&empty).unwrap();
        let mut solver = crate::constraint::builder::SudokuBuilder::build(&parsed, None).unwrap();

        let r0 = solver.nth_solution(0, &mut |_| {});
        let vt0 = r0.counters.values_tried;

        let r1 = solver.nth_solution(1, &mut |_| {});
        let vt1 = r1.counters.values_tried;

        // Cumulative values_tried should increase.
        assert!(
            vt1 > vt0,
            "values_tried should increase: {} vs {}",
            vt0,
            vt1
        );
    }
}
