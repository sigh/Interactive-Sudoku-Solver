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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn restrict_control_cell_to_valid_indices_on_init() {
        let (mut grid, shape) = make_grid(1, 9, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[0], vm(&[1, 2, 3, 4]));
    }

    #[test]
    fn fail_init_if_control_cell_no_values_within_line_length() {
        let (mut grid, shape) = make_grid(1, 9, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        grid[0] = vm(&[9]);
        assert!(!init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn init_non_standard_grid() {
        let (mut grid, shape) = make_grid(1, 8, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4, 5, 6], 5);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[0], vm(&[1, 2, 3, 4, 5, 6]));
    }

    #[test]
    fn init_clamp_pre_restricted_control_cell() {
        let (mut grid, shape) = make_grid(1, 9, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        grid[0] = vm(&[2, 4, 9]);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[0], vm(&[2, 4]));
    }

    #[test]
    fn init_restrict_to_1_for_single_indexed_cell() {
        let (mut grid, shape) = make_grid(1, 4, None);
        let mut handler = Indexing::new(0, vec![1], 3);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[0], vm(&[1]));
    }

    #[test]
    fn init_noop_when_line_length_equals_num_values() {
        let (mut grid, shape) = make_grid(2, 3, Some(5));
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4, 5], 3);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[0], vm(&[1, 2, 3, 4, 5]));
    }

    #[test]
    fn prune_control_cell_when_indexed_cell_cannot_have_value() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2]); // no 3
        grid[2] = vm(&[3, 4]); // has 3
        grid[3] = vm(&[1, 2]); // no 3
        grid[4] = vm(&[2, 3]); // has 3
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[2, 4]));
    }

    #[test]
    fn remove_indexed_value_from_cells_not_selected() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[2]); // control fixed to 2
        grid[1] = vm(&[1, 2, 3]); // indexed[0] has 3 but control != 1
        grid[2] = vm(&[3, 4]); // indexed[1] selected (control=2)
        grid[3] = vm(&[1, 3]); // indexed[2] has 3 but control != 3
        grid[4] = vm(&[2, 3]); // indexed[3] has 3 but control != 4
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[1, 2]));
        assert_eq!(grid[2], vm(&[3, 4]));
        assert_eq!(grid[3], vm(&[1]));
        assert_eq!(grid[4], vm(&[2]));
    }

    #[test]
    fn fail_when_control_has_no_valid_options() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2]); // no 3
        grid[2] = vm(&[1, 4]); // no 3
        grid[3] = vm(&[1, 2]); // no 3
        grid[4] = vm(&[2, 4]); // no 3
        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn fail_when_removal_empties_indexed_cell() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[2]); // control fixed to 2
        grid[1] = vm(&[3]); // forced to 3 but control != 1
        grid[2] = vm(&[3]); // indexed[1] selected
        grid[3] = vm(&[3]); // forced to 3 but control != 3
        grid[4] = vm(&[3]); // forced to 3 but control != 4
        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn fewer_indexed_cells_than_num_values() {
        let (mut grid, shape) = make_grid(1, 8, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4, 5, 6], 5);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4, 5, 6, 7, 8]);
        grid[1] = vm(&[1, 2, 3, 4, 5]); // has 5
        grid[2] = vm(&[1, 2, 3, 4]); // no 5
        grid[3] = vm(&[5, 6, 7, 8]); // has 5
        grid[4] = vm(&[1, 2, 3]); // no 5
        grid[5] = vm(&[4, 5, 6]); // has 5
        grid[6] = vm(&[7, 8]); // no 5
                               // Re-initialize to restrict control cell
        let (mut grid2, shape2) = make_grid(1, 8, None);
        let mut handler2 = Indexing::new(0, vec![1, 2, 3, 4, 5, 6], 5);
        assert!(init(&mut handler2, &mut grid2, shape2));

        grid2[0] = vm(&[1, 2, 3, 4, 5, 6]);
        grid2[1] = vm(&[1, 2, 3, 4, 5]);
        grid2[2] = vm(&[1, 2, 3, 4]);
        grid2[3] = vm(&[5, 6, 7, 8]);
        grid2[4] = vm(&[1, 2, 3]);
        grid2[5] = vm(&[4, 5, 6]);
        grid2[6] = vm(&[7, 8]);
        let mut a = acc();
        assert!(handler2.enforce_consistency(&mut grid2, &mut a));
        assert_eq!(grid2[0], vm(&[1, 3, 5]));
    }

    #[test]
    fn more_indexed_cells_than_num_values() {
        let (mut grid, shape) = make_grid(2, 5, Some(6));
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4, 5, 6, 7, 8], 4);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4, 5, 6]);
        grid[1] = vm(&[4]); // has 4
        grid[2] = vm(&[1, 2, 3]); // no 4
        grid[3] = vm(&[1, 2, 3]); // no 4
        grid[4] = vm(&[1, 2, 3]); // no 4
        grid[5] = vm(&[4, 5, 6]); // has 4
        grid[6] = vm(&[1, 2, 3]); // no 4
        grid[7] = vm(&[1, 2, 3]); // no 4
        grid[8] = vm(&[1, 2, 3]); // no 4
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[1, 5]));
    }

    #[test]
    fn prune_indexed_cells_based_on_control() {
        let (mut grid, shape) = make_grid(1, 5, None);
        let mut handler = Indexing::new(0, vec![1, 2, 3, 4], 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 3]);
        grid[1] = vm(&[1, 2, 3]); // indexed[0] - control=1 possible
        grid[2] = vm(&[1, 2, 3]); // indexed[1] - control=2 NOT possible
        grid[3] = vm(&[1, 2, 3]); // indexed[2] - control=3 possible
        grid[4] = vm(&[1, 2, 3]); // indexed[3] - control=4 NOT possible
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[1, 2, 3])); // indexed[0] keeps 3
        assert_eq!(grid[2], vm(&[1, 2])); // indexed[1] loses 3
        assert_eq!(grid[3], vm(&[1, 2, 3])); // indexed[2] keeps 3
        assert_eq!(grid[4], vm(&[1, 2])); // indexed[3] loses 3
    }

    // ================================
    // NumberedRoom-style (control in indexedCells)
    // ================================

    #[test]
    fn control_in_indexed_cells_init() {
        let (mut grid, shape) = make_grid(1, 9, None);
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Indexing::new(cells[0], cells.clone(), 7);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(grid[0], vm(&[1, 2, 3, 4]));
    }

    #[test]
    fn control_in_indexed_cells_prune_control() {
        let (mut grid, shape) = make_grid(1, 4, None);
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Indexing::new(cells[0], cells.clone(), 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2]); // if N=2, cell[1] must be 3, but can't
        grid[2] = vm(&[1, 3]); // allows 3 (N=3 possible)
        grid[3] = vm(&[3, 4]); // allows 3 (N=4 possible)
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[1, 3, 4]));
    }

    #[test]
    fn control_in_indexed_cells_remove_from_non_selected() {
        let (mut grid, shape) = make_grid(1, 4, None);
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Indexing::new(cells[0], cells.clone(), 2);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]); // N fixed to 3 (selects cells[2])
        grid[1] = vm(&[1, 2, 4]); // has 2 but cannot be selected (N!=2)
        grid[2] = vm(&[2, 3]); // selected (N=3)
        grid[3] = vm(&[2, 4]); // has 2 but cannot be selected (N!=4)
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[1, 4]));
        assert_eq!(grid[2], vm(&[2, 3]));
        assert_eq!(grid[3], vm(&[4]));
    }

    #[test]
    fn control_in_indexed_cells_fail_forced_in_non_selected() {
        let (mut grid, shape) = make_grid(1, 4, None);
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Indexing::new(cells[0], cells.clone(), 2);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]); // N=3
        grid[1] = vm(&[2]); // forced to indexed value, but N!=2
        grid[2] = vm(&[1, 2, 3, 4]); // selected
        grid[3] = vm(&[1, 2, 3, 4]);
        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn control_in_indexed_cells_fail_no_index_compatible() {
        let (mut grid, shape) = make_grid(1, 4, None);
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Indexing::new(cells[0], cells.clone(), 4);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3]); // can't be 4
        grid[1] = vm(&[1, 2, 3]); // no 4
        grid[2] = vm(&[1, 2, 3]); // no 4
        grid[3] = vm(&[1, 2, 3]); // no 4
        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }
}
