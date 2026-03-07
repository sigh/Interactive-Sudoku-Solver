//! Serde types for the WASM / CLI boundary.
//!
//! These structs define the JSON shapes for communication between the
//! JavaScript frontend (or CLI) and the Rust solver. Input types derive
//! `Deserialize`; output types derive `Serialize`.

use serde::{Deserialize, Serialize};

use crate::solver::debug::DebugOptions;
use crate::solver::SolverCounters;

// ============================================================================
// Core type aliases
// ============================================================================

/// Cell index (0..255). All grid cell references use this type.
pub type CellIndex = u8;

/// Sudoku value (1..=16). Distinguished from cell indices and byte counts.
pub type Value = u8;

// ============================================================================
// Input types
// ============================================================================

/// JSON input for the solver.
///
/// The `constraint_string` is the full URL-format constraint string.
/// The Rust parser handles all supported constraint types directly.
#[derive(Deserialize)]
pub struct SolverInput {
    #[serde(rename = "constraintString")]
    pub constraint_string: String,
    /// Debug options from the UI (log level, conflict heatmap, stack trace).
    #[serde(default, rename = "debugOptions")]
    pub debug_options: Option<DebugOptions>,
}

// ============================================================================
// Output types
// ============================================================================

/// JSON output for a solve request.
#[derive(Serialize)]
pub struct SolverOutput {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub counters: SolverCounters,
}

/// JSON output for a count-solutions request.
#[derive(Serialize)]
pub struct CountOutput {
    pub count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub counters: SolverCounters,
}

/// JSON output for an all-possibilities request.
#[derive(Serialize)]
pub struct AllPossibilitiesOutput {
    /// Per-cell-per-value counts, length = 81 * 9 = 729.
    /// Index: `cell * 9 + value_index` (value_index 0 = value 1).
    /// Counts are saturated at the threshold.
    #[serde(rename = "candidateCounts")]
    pub candidate_counts: Vec<u8>,
    /// All solutions found, each as an 81-character string ('1'-'9').
    pub solutions: Vec<String>,
    /// Number of solutions found.
    #[serde(rename = "numSolutions")]
    pub num_solutions: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub counters: SolverCounters,
}

/// Step result serialized for the JS StepByStepModeHandler.
///
/// Matches the shape expected by `_handleStep` in solver_runner.js:
/// `{ pencilmarks, branchCells, isSolution, hasContradiction,
///    values?, guessCell?, diffPencilmarks? }`
#[derive(Serialize)]
pub struct StepOutput {
    /// Per-cell pencilmarks. Single values are bare numbers; multi-values are arrays.
    pub pencilmarks: Vec<serde_json::Value>,
    /// Cell indices forming the branch path.
    #[serde(rename = "branchCells")]
    pub branch_cells: Vec<CellIndex>,
    /// Whether this step is a solution.
    #[serde(rename = "isSolution")]
    pub is_solution: bool,
    /// Whether this step hit a contradiction.
    #[serde(rename = "hasContradiction")]
    pub has_contradiction: bool,
    /// The candidate values for the guess cell (present when guess_depth >= 0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<Value>>,
    /// The guess cell ID (e.g. "R5C3"), matching JS `makeCellIdFromIndex`.
    #[serde(rename = "guessCell", skip_serializing_if = "Option::is_none")]
    pub guess_cell: Option<String>,
    /// Per-cell diff pencilmarks (values removed since old_grid).
    #[serde(rename = "diffPencilmarks", skip_serializing_if = "Option::is_none")]
    pub diff_pencilmarks: Option<Vec<Vec<Value>>>,
}

/// JSON output for an estimated-count-solutions request.
/// In practice this is rarely sent because the estimation loop runs until
/// the worker is terminated, but it's available if `max_samples > 0`.
#[derive(Serialize)]
pub struct EstimateOutput {
    /// Running average estimated solution count.
    pub estimate: f64,
    /// Number of Monte Carlo samples completed.
    pub samples: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub counters: SolverCounters,
}
