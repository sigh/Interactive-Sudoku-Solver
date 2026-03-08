//! Between constraint handler.
//!
//! Enforces that every intermediate cell on a between-line has a value
//! strictly between the two endpoint values.
//!
//! Mirrors JS `Between` from handlers.js.

use crate::api::types::{CellIndex, Value};
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::binary_constraint::BinaryConstraint;
use super::util::handler_util::find_exclusion_groups;
use super::{fn_to_binary_key, ConstraintHandler};

/// Between constraint: intermediate cells must have values strictly
/// between the two endpoint values.
pub struct Between {
    cells: Vec<CellIndex>,
    ends: [CellIndex; 2],
    mids: Vec<CellIndex>,
    binary_constraint: Option<BinaryConstraint>,
}

impl Between {
    /// Create a new Between handler for the given line of cells.
    ///
    /// The first and last cells are the endpoints; all others are
    /// intermediate cells that must be strictly between the endpoints.
    pub fn new(cells: Vec<CellIndex>) -> Self {
        let ends = [cells[0], cells[cells.len() - 1]];
        let mids = cells[1..cells.len() - 1].to_vec();
        Self {
            cells,
            ends,
            mids,
            binary_constraint: None,
        }
    }
}

impl ConstraintHandler for Between {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "Between"
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        // The ends must be unique if there are any cells in the middle.
        if self.mids.is_empty() {
            &[]
        } else {
            &self.ends
        }
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let eg_data = find_exclusion_groups(&self.mids, cell_exclusions);
        let max_group_size = eg_data.groups.iter().map(|g| g.len()).max().unwrap_or(0);
        let min_ends_delta = if max_group_size > 0 {
            max_group_size + 1
        } else {
            0
        };

        let key = fn_to_binary_key(
            &move |a: Value, b: Value| {
                (a as i32 - b as i32).unsigned_abs() as usize >= min_ends_delta
            },
            shape.num_values,
        );
        let bc = BinaryConstraint::from_key(self.ends[0], self.ends[1], key, shape.num_values);
        self.binary_constraint = Some(bc);
        self.binary_constraint.as_mut().unwrap().initialize(
            initial_grid,
            cell_exclusions,
            shape,
            state_allocator,
        )
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        // Constrain the ends to be consistent with each other.
        if let Some(ref bc) = self.binary_constraint {
            if !bc.enforce_consistency(grid, acc) {
                return false;
            }
        }

        let ends_combined = grid[self.ends[0] as usize] | grid[self.ends[1] as usize];

        // Constrain the mids by masking out any values that can never be
        // between the ends. Uses the exclusive range of the combined endpoints.
        if ends_combined.count() < 2 {
            // If only one value in both ends combined, no intermediate
            // value can be strictly between — contradiction if there are mids.
            if !self.mids.is_empty() {
                return false;
            }
            return true;
        }

        let mask = ends_combined.value_range_exclusive();
        let mut fixed_values = CandidateSet::EMPTY;
        for &mid in &self.mids {
            let v = grid[mid as usize] & mask;
            if v.is_empty() {
                return false;
            }
            grid[mid as usize] = v;
            if v.is_single() {
                fixed_values = fixed_values | v;
            }
        }

        // Constrain the ends by masking out anything which rules out one
        // of the mids.
        if !fixed_values.is_empty() {
            let exclude = fixed_values.value_range_inclusive();
            let inv_mask = !exclude;
            for &end in &self.ends {
                let new_val = grid[end as usize] & inv_mask;
                if new_val.is_empty() {
                    return false;
                }
                grid[end as usize] = new_val;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn init_constrains_endpoints_via_binary() {
        // 4 cells, numValues=4. Endpoints [0,3], mids [1,2].
        // Mids form 1 exclusion group of size 2 → min_ends_delta = 3.
        // So endpoints must differ by ≥ 3 → only (1,4) or (4,1).
        let (mut grid, shape) = make_grid(1, 4, None);
        let ce = unique_exclusions(4);
        let mut handler = Between::new(vec![0, 1, 2, 3]);
        assert!(init_with(&mut handler, &mut grid, shape, &ce));
        // BinaryConstraint.initialize doesn't prune; enforce does.
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Endpoints should be restricted to {1,4}.
        assert_eq!(grid[0], vm(&[1, 4]));
        assert_eq!(grid[3], vm(&[1, 4]));
    }

    #[test]
    fn mids_clamped_between_endpoints() {
        let (mut grid, shape) = make_grid(1, 6, Some(6));
        let ce = unique_exclusions(6);
        let mut handler = Between::new(vec![0, 1, 2, 3, 4, 5]);
        init_with(&mut handler, &mut grid, shape, &ce);

        // Fix endpoints: 1 and 6.
        grid[0] = vm(&[1]);
        grid[5] = vm(&[6]);
        // Mids should be in range (1,6) exclusive = {2,3,4,5}.
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        for i in 1..5 {
            assert_eq!(
                grid[i] & vm(&[1]),
                CandidateSet::EMPTY,
                "mid cell {} should not contain 1",
                i
            );
            assert_eq!(
                grid[i] & vm(&[6]),
                CandidateSet::EMPTY,
                "mid cell {} should not contain 6",
                i
            );
        }
    }

    #[test]
    fn fail_when_no_valid_intermediate_range() {
        // Endpoints both fixed to same value → no range for mids.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = Between::new(vec![0, 1, 2, 3]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[3]);
        grid[3] = vm(&[3]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn short_line_two_endpoints_only() {
        // 2 cells (endpoints only, no mids).
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = Between::new(vec![0, 1]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn fixed_mid_constrains_endpoints() {
        // Mid fixed to 3 → endpoints cannot be 3.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = Between::new(vec![0, 1, 2]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[3]); // mid fixed to 3
        grid[2] = vm(&[1, 2, 3, 4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Endpoints should not contain 3 (it's in the inclusive range of fixed mids).
        assert_eq!(grid[0] & vm(&[3]), CandidateSet::EMPTY);
        assert_eq!(grid[2] & vm(&[3]), CandidateSet::EMPTY);
    }
}
