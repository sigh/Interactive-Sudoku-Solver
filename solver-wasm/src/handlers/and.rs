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
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::{AllDifferent, AllDifferentType, ConstraintHandler};

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
    /// Mirrors JS `And` constructor: for any sub-handler that exposes
    /// `exclusion_cells()`, an enforcer `AllDifferent` is automatically added
    /// so that the exclusion constraint is applied when the `And` is evaluated
    /// on a scratch grid (e.g. inside an `Or` alternative).
    ///
    /// The `cells` list is the sorted union of all sub-handler cells
    /// (including enforcer cells added here).
    pub fn new(initial_handlers: Vec<Box<dyn ConstraintHandler>>) -> Self {
        let mut handlers: Vec<Box<dyn ConstraintHandler>> = initial_handlers;

        // For each original handler with exclusion cells, add an enforcer
        // AllDifferent so that the exclusion is enforced on scratch grids.
        // Mirrors JS: `handlers.push(new AllDifferent(exclusionCells, PROPAGATE_WITH_ENFORCER))`
        let mut enforcers: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        for h in &handlers {
            let excl = h.exclusion_cells();
            if !excl.is_empty() {
                enforcers.push(Box::new(AllDifferent::new(
                    excl.to_vec(),
                    AllDifferentType::WithEnforcer,
                )));
            }
        }
        handlers.extend(enforcers);

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

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        state_allocator: &mut GridStateAllocator,
    ) -> bool {
        for h in &mut self.handlers {
            if !h.initialize(initial_grid, cell_exclusions, shape, state_allocator) {
                return false;
            }
        }
        true
    }

    fn post_initialize(&mut self, initial_grid_state: &[CandidateSet]) {
        for h in &mut self.handlers {
            h.post_initialize(initial_grid_state);
        }
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
