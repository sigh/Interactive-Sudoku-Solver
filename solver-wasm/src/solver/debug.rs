//! Debug logging types for the WASM solver.
//!
//! These types mirror the JS `DebugLogger` data structures in `engine.js`.
//! They are serialized to JSON and sent to the UI via `type: 'debug'`
//! worker messages.

use crate::api::types::{CellIndex, Value};
use serde::{Deserialize, Serialize};

// ============================================================================
// Debug options (input from JS)
// ============================================================================

/// Debug configuration passed from the UI at solver init time.
///
/// Mirrors JS `debugOptions` in `DebugLogger` constructor.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugOptions {
    /// Log level: 0 = off, 1 = normal, 2 = verbose.
    #[serde(default)]
    pub log_level: u8,

    /// Enable per-constraint diff logging during the target step.
    /// Mirrors JS `debugOptions.enableStepLogs`.
    #[serde(default)]
    pub enable_step_logs: bool,

    /// Export conflict heatmap data in progress callbacks.
    #[serde(default)]
    pub export_conflict_heatmap: bool,

    /// Export stack trace data in progress callbacks (for flame graph).
    #[serde(default)]
    pub export_stack_trace: bool,
}

// ============================================================================
// Debug log entry
// ============================================================================

/// A single debug log entry, matching JS `DebugLogger.log()` data shape.
///
/// These are accumulated during solver setup and (optionally) execution,
/// then drained and sent to the UI.
#[derive(Debug, Clone, Default, Serialize)]
pub struct DebugLog {
    /// Location identifier (e.g. "setup", "_enforceConstraints").
    pub loc: String,

    /// Human-readable message.
    pub msg: String,

    /// Extra structured data (JSON-compatible).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,

    /// Whether this log entry should be highlighted.
    #[serde(default, skip_serializing_if = "is_false")]
    pub important: bool,

    /// Cell indices relevant to this log entry (for hover highlighting).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cells: Vec<CellIndex>,

    /// Per-cell removed candidates (for step-by-step constraint diffs).
    /// Each entry is a vec of removed values for the corresponding cell index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<Vec<Value>>,

    /// Per-cell value overlay (for hover display).
    /// In JS this is an array of numbers shown as hover text on cells.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overlay: Vec<f64>,
}

fn is_false(v: &bool) -> bool {
    !v
}

// ============================================================================
// Stack trace (for flame graph)
// ============================================================================

/// Snapshot of the solver's backtracking stack.
///
/// Mirrors JS `InternalSolver.getStackTrace()` which returns
/// `{cells: Uint16Array, values: Uint16Array}`.
#[derive(Debug, Clone, Serialize)]
pub struct StackTrace {
    /// Cell indices in search order (depth 0..N).
    pub cells: Vec<u16>,

    /// Value at each depth (as the single-bit value, not the mask).
    pub values: Vec<u16>,
}

// ============================================================================
// Solver progress (extended progress callback data)
// ============================================================================

/// Extended progress data passed to the progress callback.
///
/// Extra state attached to progress callbacks for count/estimation mode.
/// Mirrors the JS `extra` object shape from `_progressExtraStateFn`.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressExtra {
    /// Running estimate data (present during `estimatedCountSolutions`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimate: Option<EstimateProgress>,

    /// Sample solutions discovered since the last progress tick.
    /// Each entry is a value array (1-indexed, e.g. [1,2,3,...,9,...]),
    /// matching JS `gridToSolution()` format. Present during count/estimate
    /// operations, matching JS `_progressExtraStateFn` → `getSampleSolution`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solutions: Option<Vec<Vec<u8>>>,
}

/// Running estimate counts sent in progress callbacks.
/// Mirrors JS `estimationCounters`: `{ solutions: estimate, samples: count }`.
#[derive(Debug, Clone, Serialize)]
pub struct EstimateProgress {
    /// Running average estimated solution count.
    pub solutions: f64,
    /// Number of Monte Carlo samples taken so far.
    pub samples: u64,
}

/// Contains the standard performance counters plus optional debug data
/// (conflict heatmap, stack trace, logs). The WASM bridge serializes
/// this entire struct to JSON for the JS progress callback.
#[derive(Debug, Clone, Serialize)]
pub struct SolverProgress {
    /// Standard performance counters (always present).
    pub counters: super::SolverCounters,

    /// Per-cell conflict scores (81 values). Present when
    /// `DebugOptions.export_conflict_heatmap` is enabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_heatmap: Option<Vec<i32>>,

    /// Current backtracking stack trace. Present when
    /// `DebugOptions.export_stack_trace` is enabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace: Option<StackTrace>,

    /// Pending debug log entries (drained on each callback).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub logs: Vec<DebugLog>,

    /// Optional extra state (estimation data, sample solutions, etc.).
    /// Present during `estimatedCountSolutions`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<ProgressExtra>,
}

impl SolverProgress {
    /// Create a minimal progress with just counters and no debug data.
    pub fn counters_only(counters: super::SolverCounters) -> Self {
        SolverProgress {
            counters,
            conflict_heatmap: None,
            stack_trace: None,
            logs: Vec::new(),
            extra: None,
        }
    }
}
