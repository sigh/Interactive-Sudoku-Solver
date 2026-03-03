//! ValueIndexing constraint handler.
//!
//! An arrow points from a "value cell" toward a target. The "control cell"
//! (second cell on the line) indicates how many cells away the target digit is.
//! Specifically, if the value cell has digit X and the control cell has digit N,
//! then the cell N positions along the line (the N-th indexed cell) must also
//! contain X.
//!
//! Constructor signature (matching JS): `ValueIndexing(valueCell, controlCell, ...indexedCells)`
//!
//! Mirrors JS `ValueIndexing` from handlers.js.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

pub struct ValueIndexing {
    cells: Vec<CellIndex>,
    value_cell: CellIndex,
    control_cell: CellIndex,
    indexed_cells: Vec<CellIndex>,
}

impl ValueIndexing {
    /// Create a new ValueIndexing handler.
    ///
    /// `cells` must be `[value_cell, control_cell, indexed_cells...]`.
    pub fn new(cells: Vec<CellIndex>) -> Self {
        assert!(cells.len() >= 3, "ValueIndexing requires at least 3 cells");
        let value_cell = cells[0];
        let control_cell = cells[1];
        let indexed_cells = cells[2..].to_vec();
        Self {
            cells,
            value_cell,
            control_cell,
            indexed_cells,
        }
    }
}

impl ConstraintHandler for ValueIndexing {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "ValueIndexing"
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        // Clamp the control cell to the number of indexed cells.
        let num_cells = self.indexed_cells.len();
        let mask = CandidateSet::from_raw((1u16 << num_cells) - 1);
        initial_grid[self.control_cell as usize] &= mask;
        if initial_grid[self.control_cell as usize].is_empty() {
            return false;
        }
        !initial_grid[self.value_cell as usize].is_empty()
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let indexed_cells = &self.indexed_cells;
        let num_cells = indexed_cells.len();
        let control_cell = self.control_cell as usize;
        let value_cell = self.value_cell as usize;

        let original_control = grid[control_cell];
        let original_values = grid[value_cell];

        let mut possible_values = CandidateSet::EMPTY;
        let mut possible_control = CandidateSet::EMPTY;

        let mut bit = CandidateSet::from_value(1);
        for i in 0..num_cells {
            if !(original_control & bit).is_empty() {
                let cell_vals = grid[indexed_cells[i] as usize] & original_values;
                if !cell_vals.is_empty() {
                    possible_values = possible_values | cell_vals;
                    possible_control = possible_control | bit;
                }
            }
            bit <<= 1;
        }

        // If there is a single valid control value, constrain the indexed cell.
        if possible_control.is_single() && !possible_control.is_empty() {
            let index = possible_control.min_value() as usize - 1;
            let cell = indexed_cells[index] as usize;
            let new_v = grid[cell] & possible_values;
            if new_v.is_empty() {
                return false;
            }
            grid[cell] = new_v;
        }

        if possible_values != original_values {
            if possible_values.is_empty() {
                return false;
            }
            grid[value_cell] = possible_values;
            acc.add_for_cell(self.value_cell);
        }

        if possible_control != original_control {
            if possible_control.is_empty() {
                return false;
            }
            grid[control_cell] = possible_control;
            acc.add_for_cell(self.control_cell);
        }

        true
    }
}
