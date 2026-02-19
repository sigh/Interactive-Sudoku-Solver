//! AllDifferent — exclusion-based propagation.
//!
//! Enforces that a set of cells all have different values.
//! Mirrors JS `AllDifferent`.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// AllDifferent — exclusion-based propagation
// ============================================================================

/// Enforces that a set of cells all have different values.
///
/// By default, propagation is handled via the CellExclusions graph
/// (PROPAGATE_WITH_EXCLUSION_CELLS). When used inside an And/Or handler,
/// it can propagate directly (PROPAGATE_WITH_ENFORCER).
///
/// Mirrors JS `AllDifferent`.
#[derive(Debug)]
pub struct AllDifferent {
    cells: Vec<CellIndex>,
    exclusion_cells: Vec<CellIndex>,
    enforcement_type: AllDifferentType,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AllDifferentType {
    /// Propagation via CellExclusions (default).
    WithExclusionCells,
    /// Direct propagation via enforceConsistency.
    WithEnforcer,
}

impl AllDifferent {
    pub fn new(exclusion_cells: Vec<CellIndex>, enforcement_type: AllDifferentType) -> Self {
        let cells = if enforcement_type == AllDifferentType::WithEnforcer {
            exclusion_cells.clone()
        } else {
            Vec::new() // No cells to watch — handled via exclusion graph.
        };

        let mut sorted = exclusion_cells;
        sorted.sort();
        sorted.dedup();

        AllDifferent {
            cells,
            exclusion_cells: sorted,
            enforcement_type,
        }
    }
}

impl ConstraintHandler for AllDifferent {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        if self.enforcement_type == AllDifferentType::WithExclusionCells {
            &self.exclusion_cells
        } else {
            &[]
        }
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.exclusion_cells.len() <= shape.num_values as usize
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        // Only called when enforcement_type is WithEnforcer.
        let cells = &self.cells;
        let num_cells = cells.len();

        for i in 0..num_cells {
            let cell = cells[i] as usize;
            let v = grid[cell];
            if !v.is_single() {
                continue;
            }
            for j in 0..num_cells {
                if i != j {
                    grid[cells[j] as usize] &= !v;
                    if grid[cells[j] as usize].is_empty() {
                        return false;
                    }
                }
            }
        }
        true
    }

    fn name(&self) -> &'static str {
        "AllDifferent"
    }

    fn id_str(&self) -> String {
        format!("AD-{:?}", self.exclusion_cells)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_different_enforcer() {
        let cells = vec![0u8, 1, 2];
        let handler = AllDifferent::new(cells, AllDifferentType::WithEnforcer);

        let mut grid = [CandidateSet::all(9); 81];
        grid[0] = CandidateSet::from_value(5); // fix cell 0 to 5

        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));

        // Value 5 removed from cells 1 and 2.
        assert!(!grid[1].intersects(CandidateSet::from_value(5)));
        assert!(!grid[2].intersects(CandidateSet::from_value(5)));
    }
}
