//! Lockout constraint handler.
//!
//! The two endpoint cells (first and last) must differ by at least `min_diff`.
//! All intermediate cells must have values that are NOT in the "locked out"
//! range between the two endpoint values.
//!
//! Mirrors JS `Lockout` from handlers.js.

use crate::api::types::{CellIndex, Value};
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::binary_constraint::BinaryConstraint;
use super::{fn_to_binary_key, ConstraintHandler};

pub struct Lockout {
    cells: Vec<CellIndex>,
    min_diff: u8,
    ends: [CellIndex; 2],
    mids: Vec<CellIndex>,
    binary_constraint: Option<BinaryConstraint>,
}

impl Lockout {
    pub fn new(min_diff: u8, cells: Vec<CellIndex>) -> Self {
        let ends = [cells[0], cells[cells.len() - 1]];
        let mids = cells[1..cells.len() - 1].to_vec();
        Self {
            cells,
            min_diff,
            ends,
            mids,
            binary_constraint: None,
        }
    }
}

impl ConstraintHandler for Lockout {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "Lockout"
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        &self.ends
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let min_diff = self.min_diff as usize;
        let key = fn_to_binary_key(
            &|a: Value, b: Value| (a as i32 - b as i32).unsigned_abs() as usize >= min_diff,
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

        if self.mids.is_empty() {
            return true;
        }

        let ve0 = grid[self.ends[0] as usize];
        let ve1 = grid[self.ends[1] as usize];

        let min0 = ve0.min_value();
        let max0 = ve0.max_value();
        let min1 = ve1.min_value();
        let max1 = ve1.max_value();

        // Compute the lockout mask: values that are NOT locked out.
        // A mid value is locked out if it's in the closed interval [lo_endpoint, hi_endpoint].
        // When min0 > max1, endpoint0 is the higher endpoint.
        //   allowed = values < max1 (strictly)  OR  values > min0 (strictly)
        // In bit representation (bit i = value i+1):
        //   values < max1: bits 0..max1-2   = (1 << (max1-1)) - 1
        //   values > min0: bits min0..      = !((1 << min0) - 1)
        let mask: Option<CandidateSet> = if min0 > max1 {
            // Cell 0 is the higher endpoint.
            let low_bits = (1u16 << (max1 - 1)).wrapping_sub(1); // values < max1
            let high_bits = !((1u16 << min0) - 1); // values > min0
            Some(CandidateSet::from_raw(low_bits | high_bits))
        } else if min1 > max0 {
            // Cell 1 is the higher endpoint.
            let low_bits = (1u16 << (max0 - 1)).wrapping_sub(1); // values < max0
            let high_bits = !((1u16 << min1) - 1); // values > min1
            Some(CandidateSet::from_raw(low_bits | high_bits))
        } else {
            // The ranges overlap — we cannot determine which endpoint is larger.
            None
        };

        if let Some(mask) = mask {
            for &mid in &self.mids {
                let v = grid[mid as usize] & mask;
                if v.is_empty() {
                    return false;
                }
                grid[mid as usize] = v;
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
    fn init_constrains_endpoints_by_min_diff() {
        // 4 cells, numValues=6, min_diff=4.
        // Endpoints must differ by ≥ 4.
        let (mut grid, shape) = make_grid(1, 6, Some(6));
        let ce = CellExclusions::with_num_cells(6);
        let mut handler = Lockout::new(4, vec![0, 1, 2, 3]);
        assert!(init_with(&mut handler, &mut grid, shape, &ce));

        // BinaryConstraint.initialize doesn't prune; enforce does.
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // With min_diff=4 and numValues=6: valid pairs are (1,5)(1,6)(2,6)(5,1)(6,1)(6,2).
        // So endpoint 0 can be {1,2,5,6} and endpoint 3 can be {1,2,5,6}.
        assert_eq!(grid[0], vm(&[1, 2, 5, 6]));
        assert_eq!(grid[3], vm(&[1, 2, 5, 6]));
    }

    #[test]
    fn mids_exclude_lockout_range() {
        // endpoints fixed: cell 0=1, cell 3=6. Lockout range is [1,6] exclusive = {2,3,4,5}.
        // Mids must NOT have values in {2,3,4,5} → but no values outside [1,6]...
        // Actually, lockout means values NOT strictly between endpoints.
        // With numValues=8, min_diff=4: endpoints 1 and 6.
        // Mids cannot have values in closed interval [1,6] — wait, that's wrong.
        // Lockout: values NOT in the range between endpoints. So < max1 or > min0.
        // If end0=6, end1=1: mids cannot be in (1,6) exclusive.
        // But with numValues=8, there are values 7,8 outside the range.
        let (mut grid, shape) = make_grid(2, 4, Some(8));
        let ce = CellExclusions::with_num_cells(8);
        let mut handler = Lockout::new(4, vec![0, 1, 2, 3]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[6]);
        grid[3] = vm(&[1]);
        // Mids get locked-out range removed.
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Allowed: values < 1 (none) or values > 6 → {7, 8}.
        // Wait, mask allows values < max1(=1) OR values > min0(=6).
        // values < 1: none (bit -1 doesn't exist). values > 6: {7, 8}.
        assert_eq!(grid[1], vm(&[7, 8]));
        assert_eq!(grid[2], vm(&[7, 8]));
    }

    #[test]
    fn fail_when_lockout_covers_all_values() {
        // numValues=4, endpoints 1 and 4. Lockout covers {2,3}.
        // Mids can only be < 1 (none) or > 4 (none) → fail.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = Lockout::new(3, vec![0, 1, 2, 3]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[1]);
        grid[3] = vm(&[4]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn short_line_endpoints_only() {
        // Just 2 cells. No mids to constrain.
        let (mut grid, shape) = make_grid(1, 6, Some(6));
        let ce = CellExclusions::with_num_cells(6);
        let mut handler = Lockout::new(3, vec![0, 1]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn overlapping_ranges_no_pruning() {
        // When endpoint ranges overlap, no lockout mask is applied to mids.
        // Use numValues=6, min_diff=2. Endpoints = {1,2,3} and {1,2,3}.
        // Valid pairs: (1,3)(3,1)(1,4)(4,1)... but after BC, both still have
        // multiple values. The mid ranges overlap so no mid pruning.
        let (mut grid, shape) = make_grid(1, 6, Some(6));
        let ce = CellExclusions::with_num_cells(6);
        let mut handler = Lockout::new(2, vec![0, 1, 2]);
        init_with(&mut handler, &mut grid, shape, &ce);

        // Endpoints with overlapping ranges (min0=1,max0=4, min1=2,max1=5 →
        // min0 < max1 and min1 < max0 → ranges overlap).
        grid[0] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[2, 3, 4, 5]);
        let before_mid = grid[1];

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], before_mid, "mid should not be pruned when ranges overlap");
    }
}
