//! House — all-different constraint over a full row, column or box.
//!
//! Mirrors JS `House`.

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::util::handler_util::expose_hidden_singles;
use super::ConstraintHandler;
use crate::solver::candidate_selector::CandidateFinderDescription;

// ============================================================================
// House — hidden singles + completeness check
// ============================================================================

/// Enforces that a set of cells contains all values 1..=9 exactly once.
///
/// Detects hidden singles (values that appear in only one cell) and
/// exposes them by fixing the cell.
///
/// Mirrors JS `House`.
pub struct House {
    cells: Vec<CellIndex>,
    all_values: CandidateSet,
}

impl House {
    pub fn new(cells: Vec<CellIndex>) -> Self {
        House {
            cells,
            all_values: CandidateSet::EMPTY,
        }
    }
}

impl ConstraintHandler for House {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.all_values = CandidateSet::all(shape.num_values);
        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], _acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        let mut all_values = CandidateSet::EMPTY;
        let mut at_least_two = CandidateSet::EMPTY;
        let mut fixed_values = CandidateSet::EMPTY;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            at_least_two |= all_values & v;
            all_values |= v;
            // Avoid branching: is_single check via bit trick.
            fixed_values |= if v.is_single() { v } else { CandidateSet::EMPTY };
        }

        // If not all values are represented, contradiction.
        if all_values != self.all_values {
            return false;
        }

        // If all values are fixed, we're done.
        if fixed_values == self.all_values {
            return true;
        }

        // Hidden singles: values that appear in exactly one cell.
        let hidden_singles = all_values & !at_least_two & !fixed_values;
        if !hidden_singles.is_empty() && !expose_hidden_singles(grid, cells, hidden_singles) {
            return false;
        }

        true
    }

    fn candidate_finders(&self, _shape: GridShape) -> Vec<CandidateFinderDescription> {
        vec![CandidateFinderDescription::House {
            cells: self.cells.clone(),
        }]
    }

    fn name(&self) -> &'static str {
        "House"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_house_hidden_singles() {
        let cells: Vec<u8> = (0..9).collect();
        let mut handler = House::new(cells);

        let mut grid = [CandidateSet::EMPTY; 81];
        let ce = CellExclusions::new();
        assert!(handler.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        // Set up a grid where value 1 only appears in cell 0.
        grid[0] = CandidateSet::from_raw(0b111); // {1,2,3}
        grid[1] = CandidateSet::from_raw(0b110); // {2,3}
        grid[2] = CandidateSet::from_raw(0b110); // {2,3}
                                                 // Cells 3-8: all have {4,5,6,7,8,9} = bits 3..8
        for i in 3..9 {
            grid[i] = CandidateSet::from_raw(0b111111000);
        }

        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));

        // Cell 0 should be fixed to {1} (hidden single).
        assert_eq!(grid[0], CandidateSet::from_value(1));
    }

    #[test]
    fn test_house_contradiction_missing_value() {
        let cells: Vec<u8> = (0..9).collect();
        let mut handler = House::new(cells);

        let mut grid = [CandidateSet::EMPTY; 81];
        let ce = CellExclusions::new();
        assert!(handler.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        // Only values {1,2,...,8} — value 9 is missing.
        for i in 0..9 {
            grid[i] = CandidateSet::from_raw(0b011111111); // {1..8}
        }

        let mut acc = HandlerAccumulator::new_stub();
        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }
}
