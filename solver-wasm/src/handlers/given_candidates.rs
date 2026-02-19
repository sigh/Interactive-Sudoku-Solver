//! GivenCandidates — fix initial cell candidates from givens/clues.
//!
//! Mirrors JS `GivenCandidates`.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// GivenCandidates — restrict cells during initialization
// ============================================================================

/// Sets initial candidate values for specific cells.
///
/// This handler only acts during `initialize` — it has no runtime
/// enforcement cost.
///
/// Mirrors JS `GivenCandidates`.
pub struct GivenCandidates {
    /// (cell, value_mask) pairs.
    values: Vec<(CellIndex, CandidateSet)>,
}

impl GivenCandidates {
    pub fn new(values: Vec<(CellIndex, CandidateSet)>) -> Self {
        GivenCandidates { values }
    }
}

impl ConstraintHandler for GivenCandidates {
    fn cells(&self) -> &[CellIndex] {
        &[]
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        for &(cell, mask) in &self.values {
            initial_grid[cell as usize] &= mask;
            if initial_grid[cell as usize].is_empty() {
                return false;
            }
        }
        true
    }

    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        true // No runtime enforcement.
    }

    fn name(&self) -> &'static str {
        "GivenCandidates"
    }

    fn id_str(&self) -> String {
        format!("GC-{:?}", self.values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_given_candidates() {
        let mut handler = GivenCandidates::new(vec![
            (0, CandidateSet::from_value(5)),
            (1, CandidateSet::from_value(3) | CandidateSet::from_value(7)),
        ]);
        let mut grid = [CandidateSet::all(9); 81];
        let ce = CellExclusions::new();
        assert!(handler.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));
        assert_eq!(grid[0], CandidateSet::from_value(5));
        assert_eq!(
            grid[1],
            CandidateSet::from_value(3) | CandidateSet::from_value(7)
        );
    }
}
