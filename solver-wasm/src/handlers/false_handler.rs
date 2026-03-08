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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn enforce_returns_false() {
        let handler = False::new(vec![0, 1]);
        let (mut grid, _) = make_grid(1, 4, None);
        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn initialize_returns_false() {
        let mut handler = False::new(vec![0]);
        let (mut grid, shape) = make_grid(1, 4, None);
        assert!(!init(&mut handler, &mut grid, shape));
    }
}
