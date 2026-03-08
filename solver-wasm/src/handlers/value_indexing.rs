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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn restrict_control_cell_on_init() {
        // valueCell=0, controlCell=1, indexedCells=[2,3,4] (3 cells)
        let (mut grid, shape) = make_grid(1, 9, None);
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4]);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[1], vm(&[1, 2, 3]));
    }

    #[test]
    fn fail_init_if_value_cell_empty() {
        let (mut grid, shape) = make_grid(1, 4, None);
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3]);
        grid[0] = CandidateSet::EMPTY;
        assert!(!init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn pass_init_with_restricted_control_cell() {
        // valueCell=0, controlCell=1, indexedCells=[2,3] (2 cells)
        let (mut grid, shape) = make_grid(1, 4, None);
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3]);
        grid[1] = vm(&[1, 2, 3, 4]);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[1], vm(&[1, 2]));
    }

    #[test]
    fn prune_control_cell_based_on_value_compatibility() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]);           // value cell only 3
        grid[1] = vm(&[1, 2, 3]);     // control cell
        grid[2] = vm(&[1, 2]);        // indexed[0] no 3
        grid[3] = vm(&[3, 4]);        // indexed[1] has 3
        grid[4] = vm(&[2, 4]);        // indexed[2] no 3
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[2]));
    }

    #[test]
    fn constrain_indexed_cell_when_control_fixed() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[2, 3]);        // value cell
        grid[1] = vm(&[2]);           // control fixed to 2 (indexed[1])
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[1, 2, 3, 4]); // this is indexed[1]
        grid[4] = vm(&[1, 2, 3, 4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[3], vm(&[2, 3]));
    }

    #[test]
    fn fail_when_no_valid_control_value_pair() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[4]);           // value cell only 4
        grid[1] = vm(&[1, 2, 3]);     // control cell
        grid[2] = vm(&[1, 2]);        // no 4
        grid[3] = vm(&[2, 3]);        // no 4
        grid[4] = vm(&[1, 3]);        // no 4
        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn short_indexed_array() {
        // 8 values, 6 indexed cells
        let (mut grid, shape) = make_grid(2, 5, Some(8));
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4, 5, 6, 7]);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[1], vm(&[1, 2, 3, 4, 5, 6]));
    }

    #[test]
    fn enforce_on_rectangular_grid() {
        let (mut grid, shape) = make_grid(2, 5, Some(8));
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4, 5, 6, 7]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[7, 8]);            // value cell
        grid[1] = vm(&[1, 2, 3, 4, 5, 6]); // control
        grid[2] = vm(&[1, 2, 3, 4, 5, 6]); // indexed[0] no 7,8
        grid[3] = vm(&[7, 8]);            // indexed[1] has 7,8
        grid[4] = vm(&[1, 2, 3]);         // indexed[2]
        grid[5] = vm(&[4, 5, 6, 7]);      // indexed[3] has 7
        grid[6] = vm(&[1, 8]);            // indexed[4] has 8
        grid[7] = vm(&[2, 3, 4]);         // indexed[5]
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[2, 4, 5]));
    }

    #[test]
    fn single_indexed_cell() {
        let (mut grid, shape) = make_grid(1, 3, Some(4));
        let mut handler = ValueIndexing::new(vec![0, 1, 2]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[2, 3]);
        grid[1] = vm(&[1]);
        grid[2] = vm(&[2, 3, 4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[2], vm(&[2, 3]));
    }

    #[test]
    fn update_both_value_and_control_cells() {
        let (mut grid, shape) = make_grid(2, 3, Some(4));
        let mut handler = ValueIndexing::new(vec![0, 1, 2, 3, 4, 5]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1]);
        grid[3] = vm(&[2]);
        grid[4] = vm(&[3]);
        grid[5] = vm(&[4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[1, 2, 3, 4]));
        assert_eq!(grid[1], vm(&[1, 2, 3, 4]));
    }

    #[test]
    fn more_indexed_cells_than_values() {
        // 6 values, 10 indexed cells (12 total cells: value + control + 10 indexed).
        // Control cell should be limited to values 1-6 by numValues, not by indexed count.
        let (mut grid, shape) = make_grid(3, 4, Some(6));
        let mut handler = ValueIndexing::new(
            vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        );
        assert!(init(&mut handler, &mut grid, shape));
        // Control cell (cell 1) should have values 1-6 (min of numValues, indexed count).
        assert_eq!(grid[1], vm(&[1, 2, 3, 4, 5, 6]));
    }
}
