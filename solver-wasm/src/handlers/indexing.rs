//! Indexing constraint handler.
//!
//! For a given control cell and its corresponding row (or column), the cell's
//! value V indicates which position in the row/column contains the value equal
//! to the control cell's column (or row) number.
//!
//! More precisely: the control cell's value selects one of the `indexed_cells`
//! by 1-based position. The selected indexed cell must contain `indexed_value`.
//!
//! Constructor signature (matching JS):
//!   `Indexing(controlCell, indexedCells, indexedValue)`
//!
//! Mirrors JS `Indexing` from handlers.js.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

pub struct Indexing {
    cells: Vec<CellIndex>,
    control_cell: CellIndex,
    indexed_cells: Vec<CellIndex>,
    indexed_value: CandidateSet,
}

impl Indexing {
    /// Create a new Indexing handler.
    ///
    /// `control_cell` is the cell whose value V (1-based) selects
    /// `indexed_cells[V-1]` as the cell that must contain `indexed_value`.
    pub fn new(control_cell: CellIndex, indexed_cells: Vec<CellIndex>, indexed_value: u8) -> Self {
        let mut cells = vec![control_cell];
        cells.extend_from_slice(&indexed_cells);
        Self {
            cells,
            control_cell,
            indexed_cells,
            indexed_value: CandidateSet::from_value(indexed_value),
        }
    }
}

impl ConstraintHandler for Indexing {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "Indexing"
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        // Clamp control cell to the line length so that N is always a valid index.
        let line_length = self.indexed_cells.len();
        let allowed_mask = CandidateSet::from_raw((1u16 << line_length) - 1);
        initial_grid[self.control_cell as usize] &= allowed_mask;
        !initial_grid[self.control_cell as usize].is_empty()
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.indexed_cells;
        let num_cells = cells.len();
        let control_idx = self.control_cell as usize;
        let indexed_value = self.indexed_value;

        let original_control = grid[control_idx];
        let mut control_value = original_control;

        let mut bit = CandidateSet::from_value(1);
        for i in 0..num_cells {
            let cell = cells[i] as usize;
            let v = grid[cell];

            if !(v & indexed_value).is_empty() {
                if (control_value & bit).is_empty() {
                    // This cell can't have the indexed value — control doesn't allow it.
                    let new_v = v & !indexed_value;
                    if new_v.is_empty() {
                        return false;
                    }
                    grid[cell] = new_v;
                    acc.add_for_cell(cells[i]);
                }
            } else {
                // The control value can't select this index.
                control_value = control_value & !bit;
                if control_value.is_empty() {
                    return false;
                }
            }

            bit <<= 1;
        }

        if control_value != original_control {
            grid[control_idx] = control_value;
            acc.add_for_cell(self.control_cell);
        }

        true
    }
}
