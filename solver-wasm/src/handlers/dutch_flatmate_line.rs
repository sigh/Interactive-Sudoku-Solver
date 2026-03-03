//! DutchFlatmateLine constraint handler.
//!
//! For a column of cells, every occurrence of the "mid" value (ceil(numValues/2))
//! must have the value 1 directly above it OR the value `numValues` directly below
//! it (or both).  If a cell is fixed to the mid value, the required neighbour is
//! forced too.
//!
//! Mirrors JS `DutchFlatmateLine` from handlers.js.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

pub struct DutchFlatmateLine {
    cells: Vec<CellIndex>,
    /// Mask for the mid value = ceil(numValues / 2).
    mid: CandidateSet,
    /// Mask for the bottom value = numValues.
    below: CandidateSet,
}

impl DutchFlatmateLine {
    pub fn new(cells: Vec<CellIndex>) -> Self {
        Self {
            cells,
            mid: CandidateSet::EMPTY,
            below: CandidateSet::EMPTY,
        }
    }
}

impl ConstraintHandler for DutchFlatmateLine {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "DutchFlatmateLine"
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        // mid = ceil(numValues / 2)
        let mid_val = (shape.num_values + 1) / 2;
        self.mid = CandidateSet::from_value(mid_val as u8);
        // below = numValues (the maximum value)
        self.below = CandidateSet::from_value(shape.num_values as u8);
        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();
        let target = self.mid;
        let above = CandidateSet::from_value(1);
        let below = self.below;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            if (v & target).is_empty() {
                continue;
            }

            // Check which flatmates are available.
            let has_above = i > 0 && !(grid[cells[i - 1] as usize] & above).is_empty();
            let has_below = i + 1 < num_cells && !(grid[cells[i + 1] as usize] & below).is_empty();

            let ok = (has_above as u8) | ((has_below as u8) << 1);

            if ok == 0 {
                // Neither flatmate is available — remove mid from this cell.
                let new_v = v & !target;
                if new_v.is_empty() {
                    return false;
                }
                grid[cells[i] as usize] = new_v;
            } else if v == target {
                // Cell is fixed to mid — force the single available flatmate.
                if ok == 1 {
                    // Only above is available.
                    grid[cells[i - 1] as usize] = above;
                } else if ok == 2 {
                    // Only below is available.
                    grid[cells[i + 1] as usize] = below;
                }
            }
        }

        true
    }
}
