// ============================================================================
// And handler — composite handler delegating to multiple sub-handlers.
//
// Mirrors JS `SudokuConstraintHandler.And` from handlers.js.
//
// Used by `HandlerAccumulator` when multiple singleton handlers are mapped
// to the same cell. Delegates `enforce_consistency` to each sub-handler in
// order; returns false as soon as any sub-handler finds a contradiction.
// ============================================================================

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;

use super::{ConstraintHandler, HandlerAccumulator};

/// Composite handler — calls each sub-handler's `enforce_consistency` in order.
pub struct And {
    /// Union of all sub-handler cells.
    cells: Vec<CellIndex>,
    /// Sub-handlers to delegate to.
    handlers: Vec<Box<dyn ConstraintHandler>>,
}

impl And {
    /// Create an And handler wrapping the given sub-handlers.
    ///
    /// The `cells` list is the sorted union of all sub-handler cells.
    /// Sub-handlers must already be fully initialised.
    pub fn new(handlers: Vec<Box<dyn ConstraintHandler>>) -> Self {
        let mut cell_set: std::collections::BTreeSet<CellIndex> =
            std::collections::BTreeSet::new();
        for h in &handlers {
            cell_set.extend(h.cells().iter().copied());
        }
        And {
            cells: cell_set.into_iter().collect(),
            handlers,
        }
    }
}

impl ConstraintHandler for And {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        for h in &self.handlers {
            if !h.enforce_consistency(grid, acc) {
                return false;
            }
        }
        true
    }

    fn name(&self) -> &'static str {
        "And"
    }

    fn is_singleton(&self) -> bool {
        // Preserve singleton status when all sub-handlers are singletons.
        self.handlers.iter().all(|h| h.is_singleton())
    }
}
