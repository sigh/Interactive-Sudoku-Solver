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
            &move |a: Value, b: Value| (a as i32 - b as i32).unsigned_abs() as usize >= min_ends_delta,
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
