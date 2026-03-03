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
        // A value is locked out if it lies strictly between the two endpoints.
        // We can only constrain when one endpoint range is definitively above
        // the other (no overlap between their min/max ranges).
        let mask: Option<CandidateSet> = if min0 > max1 {
            // Cell 0 is the larger endpoint.
            // Locked-out range: (max1 .. min0) exclusive.
            // Allowed: values <= max1 OR values >= min0.
            let locked_out =
                CandidateSet::from_raw((((1u32 << (min0 - 1)) - 1) ^ ((1u32 << max1) - 1)) as u16);
            Some(!locked_out)
        } else if min1 > max0 {
            // Cell 1 is the larger endpoint.
            // Locked-out range: (max0 .. min1) exclusive.
            let locked_out =
                CandidateSet::from_raw((((1u32 << (min1 - 1)) - 1) ^ ((1u32 << max0) - 1)) as u16);
            Some(!locked_out)
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
