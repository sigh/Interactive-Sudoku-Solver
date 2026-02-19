//! ValueDependentUniqueValueExclusion — per-value cell exclusion (e.g. Taxicab).
//!
//! When a cell is fixed to value V, exclude V from value-dependent neighbours.
//!
//! Mirrors JS `ValueDependentUniqueValueExclusion`.

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

/// Per-value cell exclusion handler (singleton: one per cell).
///
/// `value_to_cell_map[v-1]` is the list of cells that must not contain value `v`
/// when this cell is set to `v`.
// Ported from JS but not yet wired into the Rust builder.
#[allow(dead_code)]
pub struct ValueDependentUniqueValueExclusion {
    cell: CellIndex,
    /// Indexed by value_index (0-based): cells excluded when `cell` = value_index+1.
    value_to_cell_map: Vec<Vec<CellIndex>>,
}

#[allow(dead_code)]
impl ValueDependentUniqueValueExclusion {
    pub fn new(cell: CellIndex, value_to_cell_map: Vec<Vec<CellIndex>>) -> Self {
        Self {
            cell,
            value_to_cell_map,
        }
    }

    /// Get the exclusion cells for a 1-based value.
    pub fn get_value_cell_exclusions(&self, value: u8) -> &[CellIndex] {
        if value == 0 || (value as usize) > self.value_to_cell_map.len() {
            &[]
        } else {
            &self.value_to_cell_map[(value - 1) as usize]
        }
    }
}

impl ConstraintHandler for ValueDependentUniqueValueExclusion {
    fn cells(&self) -> &[CellIndex] {
        std::slice::from_ref(&self.cell)
    }

    fn is_singleton(&self) -> bool {
        true
    }

    fn priority(&self) -> i32 {
        0
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        // Remove cells that are already in the normal exclusion set
        // (they're already handled by standard uniqueness).
        let exclusions: std::collections::HashSet<CellIndex> =
            cell_exclusions.sets[self.cell as usize].iter().copied().collect();
        for map in &mut self.value_to_cell_map {
            map.retain(|c| !exclusions.contains(c));
        }
        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let v = grid[self.cell as usize];

        // Only trigger when the cell is fixed (singleton value).
        let index = v.index();

        let exclusion_cells = &self.value_to_cell_map[index];
        for &excl_cell in exclusion_cells {
            if grid[excl_cell as usize].intersects(v) {
                grid[excl_cell as usize] ^= v;
                if grid[excl_cell as usize].is_empty() {
                    return false;
                }
                acc.add_for_cell(excl_cell);
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "ValueDependentUniqueValueExclusion"
    }
}
