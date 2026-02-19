//! UniqueValueExclusion — when a cell is fixed, remove its value from
//! exclusion neighbours.
//!
//! Mirrors JS `UniqueValueExclusion`.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// UniqueValueExclusion — singleton handler
// ============================================================================

/// When a cell is fixed to a single value, remove that value from all
/// cells that share an AllDifferent constraint with it.
///
/// Mirrors JS `UniqueValueExclusion`.
pub struct UniqueValueExclusion {
    cell: CellIndex,
    pub(crate) exclusion_cells: Vec<CellIndex>,
}

impl UniqueValueExclusion {
    pub fn new(cell: CellIndex) -> Self {
        UniqueValueExclusion {
            cell,
            exclusion_cells: Vec::new(),
        }
    }
}

impl ConstraintHandler for UniqueValueExclusion {
    fn cells(&self) -> &[CellIndex] {
        std::slice::from_ref(&self.cell)
    }

    fn is_singleton(&self) -> bool {
        true
    }

    fn priority(&self) -> i32 {
        0
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.exclusion_cells = cell_exclusions.get_array(self.cell).to_vec();
        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let value = grid[self.cell as usize];
        let exclusion_cells = &self.exclusion_cells;

        for &excl_cell in exclusion_cells {
            if grid[excl_cell as usize].intersects(value) {
                grid[excl_cell as usize] ^= value;
                if grid[excl_cell as usize].is_empty() {
                    return false;
                }
                acc.add_for_cell(excl_cell);
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "UniqueValueExclusion"
    }

    fn id_str(&self) -> String {
        format!("UVE-{}", self.cell)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unique_value_exclusion() {
        let mut handler = UniqueValueExclusion::new(0);
        // Manually set up exclusion cells (normally done via initialize).
        handler.exclusion_cells = vec![1, 2, 3];

        let mut grid = [CandidateSet::all(9); 81];
        grid[0] = CandidateSet::from_value(5); // cell 0 fixed to 5

        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));

        // Value 5 should be removed from cells 1, 2, 3.
        for &cell in &[1u8, 2, 3] {
            assert!(!grid[cell as usize].intersects(CandidateSet::from_value(5)));
        }
        // Other cells unchanged.
        assert_eq!(grid[4], CandidateSet::all(9));
    }
}
