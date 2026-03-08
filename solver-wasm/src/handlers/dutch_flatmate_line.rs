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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    // numValues=9 => target=5, above=1, below=9

    #[test]
    fn remove_target_from_cell_with_no_valid_flatmate() {
        let (mut grid, shape) = make_grid(1, 3, Some(9));
        let cells = (0..3).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        grid[0] = vm(&[2, 3, 4]);
        grid[1] = vm(&[5, 6]);
        grid[2] = vm(&[2, 3, 4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1] & vm(&[5]), CandidateSet::EMPTY);
        assert_eq!(grid[1], vm(&[6]));
    }

    #[test]
    fn fail_if_removing_target_wipes_cell() {
        let (mut grid, shape) = make_grid(1, 3, Some(9));
        let cells = (0..3).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        grid[0] = vm(&[2, 3, 4]);
        grid[1] = vm(&[5]); // only target
        grid[2] = vm(&[2, 3, 4]);

        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn force_above_flatmate_when_target_fixed_and_only_above_possible() {
        let (mut grid, shape) = make_grid(1, 3, Some(9));
        let cells = (0..3).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        grid[0] = vm(&[1, 2]); // can be above (1)
        grid[1] = vm(&[5]);    // fixed to target
        grid[2] = vm(&[2, 3, 4]); // cannot be below (9)

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[1]));
    }

    #[test]
    fn force_below_flatmate_when_target_fixed_and_only_below_possible() {
        let (mut grid, shape) = make_grid(1, 3, Some(9));
        let cells = (0..3).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        grid[0] = vm(&[2, 3, 4]); // cannot be above (1)
        grid[1] = vm(&[5]);       // fixed to target
        grid[2] = vm(&[8, 9]);    // can be below (9)

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[2], vm(&[9]));
    }

    #[test]
    fn prune_target_at_edge_if_only_neighbor_cannot_be_flatmate() {
        let (mut grid, shape) = make_grid(1, 2, Some(9));
        let cells = (0..2).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        grid[0] = vm(&[5, 6]);
        grid[1] = vm(&[2, 3, 4]); // cannot be 1 or 9

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[6]));
    }

    #[test]
    fn work_on_short_lines_where_below_cannot_exist() {
        // 6-cell line, numValues=8 => target=ceil(8/2)=4, above=1, below=8
        let (mut grid, shape) = make_grid(1, 6, Some(8));
        let cells = (0..6).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        // Remove 8 everywhere
        for i in 0..6 {
            grid[i] = grid[i] & !vm(&[8]);
        }

        // Fix target (4) at index 2
        grid[2] = vm(&[4]);

        // Only valid flatmate is above (1) on the left
        grid[1] = vm(&[1, 2]);
        grid[3] = vm(&[2, 3, 5, 6, 7]); // cannot be 1; 8 already removed

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[1]));
        for i in 0..6 {
            assert_eq!(grid[i] & vm(&[8]), CandidateSet::EMPTY);
        }
    }

    #[test]
    fn fail_when_neither_flatmate_can_exist_in_line() {
        // numValues=8 => target=4, above=1, below=8
        let (mut grid, shape) = make_grid(1, 3, Some(8));
        let cells = (0..3).collect();
        let mut handler = DutchFlatmateLine::new(cells);
        assert!(init(&mut handler, &mut grid, shape));

        // Remove both flatmate values (1 and 8) everywhere
        for i in 0..3 {
            grid[i] = grid[i] & !(vm(&[1]) | vm(&[8]));
        }

        // Target is 4, forced in middle
        grid[1] = vm(&[4]);

        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }
}
