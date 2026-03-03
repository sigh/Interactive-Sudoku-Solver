//! ValueDependentUniqueValueExclusionHouse — house-level value-dependent exclusion.
//!
//! For each value appearing in exactly 2 cells within the house, looks up
//! the cached pair exclusion cells for that pair and removes the value from
//! those cells.
//!
//! Mirrors JS `ValueDependentUniqueValueExclusionHouse`.

use std::rc::Rc;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::solver::cell_exclusions::{CellExclusions, PairIndex};
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

/// House-level value-dependent exclusion handler.
///
/// Stores per-value `CellExclusions` objects (indexed 0..num_values),
/// shared across all house handlers via `Rc` (matching JS where all houses
/// share the same `valueCellExclusions` array by reference).
///
/// During enforcement, calls `getPairExclusions(pairIndex)` on the
/// appropriate `CellExclusions` — the cached O(1) lookup.
pub struct ValueDependentUniqueValueExclusionHouse {
    cells: Vec<CellIndex>,
    /// Per-value CellExclusions (indexed 0..num_values, value 1..=num_values).
    /// JS: `this._valueCellExclusions` — shared by reference across all houses.
    value_cell_exclusions: Rc<Vec<CellExclusions>>,
}

impl ValueDependentUniqueValueExclusionHouse {
    pub fn new(cells: Vec<CellIndex>, value_cell_exclusions: Rc<Vec<CellExclusions>>) -> Self {
        Self {
            cells,
            value_cell_exclusions,
        }
    }
}

impl ConstraintHandler for ValueDependentUniqueValueExclusionHouse {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // Find values that appear in exactly 2 cells.
        let mut all_values = CandidateSet::EMPTY;
        let mut more_than_one = CandidateSet::EMPTY;
        let mut more_than_two = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            more_than_two = more_than_two | (more_than_one & v);
            more_than_one = more_than_one | (all_values & v);
            all_values = all_values | v;
        }

        let mut exactly_two = more_than_one & !more_than_two;

        while !exactly_two.is_empty() {
            let v = exactly_two.lowest();
            exactly_two = exactly_two ^ v;

            if !self.handle_exactly_two(grid, v, acc) {
                return false;
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "ValueDependentUniqueValueExclusionHouse"
    }
}

impl ValueDependentUniqueValueExclusionHouse {
    /// Handle a value that appears in exactly two cells.
    ///
    /// Mirrors JS `_handleExactlyTwo`.
    fn handle_exactly_two(
        &self,
        grid: &mut [CandidateSet],
        v: CandidateSet,
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // Build pair index matching JS: `pairIndex = (pairIndex << 8) | cells[i]`
        let mut pair_index: PairIndex = 0;
        for i in 0..num_cells {
            if grid[cells[i] as usize].intersects(v) {
                pair_index = (pair_index << 8) | cells[i] as u16;
            }
        }

        let index = v.index();
        let exclusion_cells = self.value_cell_exclusions[index].get_pair_exclusions(pair_index);

        if !exclusion_cells.is_empty() {
            for &excl_cell in exclusion_cells {
                if grid[excl_cell as usize].intersects(v) {
                    grid[excl_cell as usize] ^= v;
                    if grid[excl_cell as usize].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(excl_cell);
                }
            }
        }

        true
    }
}
