//! Constraint handler that always fails.
//!
//! Used by the optimizer to mark constraints as impossible.

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

/// Handler that always fails.
///
/// Mirrors JS `False`. The cells are associated for error reporting.
pub struct False {
    cells: Vec<CellIndex>,
}

impl False {
    pub fn new(cells: Vec<CellIndex>) -> Self {
        assert!(!cells.is_empty(), "False needs cells to be effective.");
        Self { cells }
    }
}

impl ConstraintHandler for False {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        false
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        false
    }

    fn name(&self) -> &'static str {
        "False"
    }
}
