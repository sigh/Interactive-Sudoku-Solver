//! Optimizer for constraint handlers.
//!
//! Applies a sequence of optimization passes to the handler set before
//! the solver runs. This dramatically reduces backtracks for killer
//! puzzles by:
//!
//! - Promoting AllDifferent constraints to House constraints.
//! - Inferring hidden cage sums (innies/outies).
//! - Combining related sum constraints.
//! - Replacing small sum constraints with specialized handlers.
//! - Adding box-line intersection constraints.
//!
//! Mirrors JS `SudokuConstraintOptimizer` from optimizer.js.
//!
//! Each optimization phase lives in a separate submodule.

mod binary_pairwise;
mod full_rank;
mod house;
mod jigsaw;
mod log_stats;
mod non_square;
mod required_values;
mod sums;
mod taxicab;
pub(super) mod util;

#[cfg(test)]
mod tests;

use super::cell_exclusions::CellExclusions;
use super::debug::{DebugLog, DebugOptions};
use super::handler_set::HandlerSet;
use crate::api::types::CellIndex;
use crate::grid_shape::GridShape;
use crate::handlers::{fn_to_binary_key, BoxInfo, ConstraintHandler};

/// Maximum number of cells in optimizer-generated sum constraints.
pub(super) const MAX_SUM_SIZE: usize = 6;

// ============================================================================
// Optimizer
// ============================================================================

/// Optimizes constraint handlers for better solver performance.
pub struct Optimizer;

/// Context for collecting debug logs during optimization.
pub(super) struct OptimizerCtx {
    pub(super) logs: Vec<DebugLog>,
    /// Cached equals key for BinaryConstraint, computed once per optimize run.
    pub(super) equals_key: String,
    /// Whether debug logging is enabled. When false, expensive diagnostic
    /// phases (e.g. NFA stats) are skipped.
    /// Mirrors JS: `this._debugLogger = debugLogger.enableLogs ? debugLogger : null;`
    /// where `enableLogs = logLevel > 0`.
    pub(super) enable_logs: bool,
}

impl OptimizerCtx {
    pub(super) fn new(num_values: u8, debug_options: Option<&DebugOptions>) -> Self {
        // JS: this._debugLogger = debugLogger.enableLogs ? debugLogger : null;
        // JS: enableLogs = logLevel > 0
        let enable_logs = debug_options.map_or(false, |o| o.log_level > 0);
        Self {
            logs: Vec::new(),
            equals_key: fn_to_binary_key(&|a: u8, b: u8| a == b, num_values),
            enable_logs,
        }
    }

    /// Log a handler addition, matching JS `_logAddHandler`.
    pub(super) fn log_add_handler(
        &mut self,
        loc: &str,
        handler: &dyn ConstraintHandler,
        args: Option<serde_json::Value>,
        aux: bool,
    ) {
        let aux_suffix = if aux { " (aux)" } else { "" };
        self.logs.push(DebugLog {
            loc: loc.to_string(),
            msg: format!("Add: {}{}", handler.name(), aux_suffix),
            args: Some(args.unwrap_or(serde_json::Value::Null)),
            important: false,
            cells: handler.cells().to_vec(),
            candidates: Vec::new(),
            overlay: Vec::new(),
        });
    }

    /// Log a handler replacement.
    pub(super) fn log_replace(
        &mut self,
        loc: &str,
        handler: &dyn ConstraintHandler,
        args: Option<serde_json::Value>,
    ) {
        self.logs.push(DebugLog {
            loc: loc.to_string(),
            msg: format!("Replace with: {}", handler.name()),
            args: Some(args.unwrap_or(serde_json::Value::Null)),
            important: false,
            cells: handler.cells().to_vec(),
            candidates: Vec::new(),
            overlay: Vec::new(),
        });
    }

    /// Log an arbitrary message.
    pub(super) fn log(
        &mut self,
        loc: &str,
        msg: String,
        args: Option<serde_json::Value>,
        cells: Vec<CellIndex>,
    ) {
        self.logs.push(DebugLog {
            loc: loc.to_string(),
            msg,
            args: Some(args.unwrap_or(serde_json::Value::Null)),
            important: false,
            cells,
            candidates: Vec::new(),
            overlay: Vec::new(),
        });
    }
}

impl Optimizer {
    /// Run all optimization passes on the handler set.
    ///
    /// Mutates the handler set in place, returning debug logs.
    /// Also mutates cell_exclusions if needed (e.g., adding exclusions
    /// from new handlers).
    pub fn optimize(
        hs: &mut HandlerSet,
        cell_exclusions: &mut CellExclusions,
        shape: GridShape,
        debug_options: Option<&DebugOptions>,
    ) -> Vec<DebugLog> {
        let mut ctx = OptimizerCtx::new(shape.num_values, debug_options);

        // Get box regions from BoxInfo handler if available, else from shape.
        let box_regions = hs
            .get_all_of_type::<BoxInfo>()
            .first()
            .map(|(_, bi)| bi.box_regions().to_vec())
            .unwrap_or_else(|| shape.box_regions());

        house::add_extra_cell_exclusions(hs, cell_exclusions, &mut ctx);

        house::add_house_handlers(hs, &mut ctx);

        if !shape.is_square() {
            non_square::optimize_non_square_grids(hs, &box_regions, &mut ctx);
        }

        sums::optimize_sums(hs, &box_regions, cell_exclusions, &mut ctx);

        jigsaw::optimize_jigsaw(hs, &box_regions, &mut ctx);

        full_rank::optimize_full_rank(hs, &mut ctx);

        required_values::optimize_required_values(hs, cell_exclusions, &mut ctx);

        taxicab::optimize_taxicab(hs, cell_exclusions, &mut ctx);

        binary_pairwise::optimize_binary_pairwise(hs, &mut ctx);

        house::add_house_intersections(hs, &box_regions, &mut ctx);

        log_stats::log_stats(hs, &mut ctx);

        ctx.logs
    }
}
