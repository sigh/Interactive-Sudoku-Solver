//! LocalSquishable2x2 — base for GlobalEntropy and GlobalMod constraints.
//!
//! For a 2×2 region, enforces that cells collectively contain one candidate
//! from each "triad group", using a squish-and-check approach.
//!
//! The "squish" operation collapses each group's values to a single
//! representative bit so that standard hidden-singles/pairs logic applies
//! at the group level, then the restriction is unsquished back to the
//! original value space.
//!
//! Mirrors JS `_Squishable2x2`, `LocalEntropy`, `LocalMod3` from handlers.js.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::util::handler_util::enforce_required_value_exclusions;
use super::ConstraintHandler;

/// Shared implementation for `LocalEntropy` and `LocalMod3`.
///
/// Parameters distinguish which triad grouping to enforce:
/// - `squished_mask`: one representative bit per triad group.
/// - `triads`: full value masks for each group (unsquished).
/// - `squish_offset`: bits to right-shift to collapse a group to its representative.
pub struct LocalSquishable2x2 {
    cells: Vec<CellIndex>,
    /// Raw bitmask with one bit per triad group (squished space).
    squished_mask: u16,
    /// One mask per triad in full (unsquished) value space.
    triads: Vec<CandidateSet>,
    /// Right-shift distance to fold values into their group representative bit.
    squish_offset: u32,
}

impl LocalSquishable2x2 {
    /// Construct a `LocalEntropy` handler for a 2×2 region.
    ///
    /// Triads: `{1,2,3}`, `{4,5,6}`, `{7,8,9}`.  Squish offset: 1.
    /// Mirrors JS `LocalEntropy`.
    pub fn entropy(cells: Vec<CellIndex>) -> Self {
        Self {
            cells,
            squished_mask: 0x049, // fromValuesArray([1,4,7]) = bits 0,3,6
            triads: vec![
                CandidateSet::from_raw(0x007), // [1,2,3] = bits 0,1,2
                CandidateSet::from_raw(0x038), // [4,5,6] = bits 3,4,5
                CandidateSet::from_raw(0x1C0), // [7,8,9] = bits 6,7,8
            ],
            squish_offset: 1,
        }
    }

    /// Construct a `LocalMod3` handler for a 2×2 region.
    ///
    /// Triads: `{1,4,7}`, `{2,5,8}`, `{3,6,9}`.  Squish offset: 3.
    /// Mirrors JS `LocalMod3`.
    pub fn mod3(cells: Vec<CellIndex>) -> Self {
        Self {
            cells,
            squished_mask: 0x007, // fromValuesArray([1,2,3]) = bits 0,1,2
            triads: vec![
                CandidateSet::from_raw(0x049), // [1,4,7] = bits 0,3,6
                CandidateSet::from_raw(0x092), // [2,5,8] = bits 1,4,7
                CandidateSet::from_raw(0x124), // [3,6,9] = bits 2,5,8
            ],
            squish_offset: 3,
        }
    }

    /// Inner `_enforceRequiredValues` (JS).
    ///
    /// Operates on unsquished grid values. For each triad, if exactly one value
    /// from the triad is still possible and it is not yet fixed, enforce
    /// required-value exclusions.
    fn enforce_required_values(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        let mut all_values = CandidateSet::EMPTY;
        let mut fixed_values = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            all_values = all_values | v;
            if v.is_single() {
                fixed_values = fixed_values | v;
            }
        }

        // All cells already fixed — nothing to do.
        if all_values == fixed_values {
            return true;
        }

        for &triad in &self.triads {
            let triad_value = triad & all_values;
            // Skip if 0 or >1 values from the triad remain possible.
            if triad_value.is_empty() || !triad_value.is_single() {
                continue;
            }
            // Skip if this single value is already determined (fixed).
            if !(triad_value & fixed_values).is_empty() {
                continue;
            }
            // Exactly one unfixed value from this triad — enforce exclusions.
            let ce = std::mem::take(acc.cell_exclusions());
            let ok = enforce_required_value_exclusions(grid, cells, triad_value, &ce, Some(acc));
            *acc.cell_exclusions() = ce;
            if !ok {
                return false;
            }
        }

        true
    }
}

impl ConstraintHandler for LocalSquishable2x2 {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "LocalSquishable2x2"
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();
        let squished_mask = CandidateSet::from_raw(self.squished_mask);
        let squish_offset = self.squish_offset;
        let squish_offset2 = squish_offset << 1;

        // Squish each cell's candidates: OR shifted copies, mask to group bits.
        // This collapses e.g. {1,2,3} to a single representative bit.
        let mut values_buf = [CandidateSet::EMPTY; 4];
        let mut all_squished = CandidateSet::EMPTY;
        let mut at_least_two = CandidateSet::EMPTY;
        let mut at_least_three = CandidateSet::EMPTY;
        let mut fixed_squished = CandidateSet::EMPTY;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            let sq = (v | (v >> squish_offset) | (v >> squish_offset2)) & squished_mask;
            values_buf[i] = sq;
            at_least_three = at_least_three | (at_least_two & sq);
            at_least_two = at_least_two | (all_squished & sq);
            all_squished = all_squished | sq;
            if sq.is_single() {
                fixed_squished = fixed_squished | sq;
            }
        }

        // Every triad group must be represented somewhere.
        if all_squished != squished_mask {
            return false;
        }
        // All groups already pinned — done.
        if fixed_squished == squished_mask {
            return true;
        }

        // Hidden singles in squished space: a group bit appears in exactly one cell.
        let hidden_singles = all_squished & !at_least_two & !fixed_squished;
        if !hidden_singles.is_empty() {
            for i in 0..num_cells {
                let value = values_buf[i] & hidden_singles;
                if !value.is_empty() {
                    // Multiple hidden singles in one cell — contradiction.
                    if !value.is_single() {
                        return false;
                    }
                    // Unsquish: include all original values from this group.
                    let unsquished = value | (value << squish_offset) | (value << squish_offset2);
                    grid[cells[i] as usize] &= unsquished;
                    acc.add_for_cell(cells[i]);
                }
            }
            fixed_squished = fixed_squished | hidden_singles;
        }

        // Hidden pairs in squished space: two group bits, each in exactly two cells.
        let exactly_two = at_least_two & !at_least_three & !fixed_squished;
        if !exactly_two.is_empty() && !exactly_two.is_single() {
            for i in 0..num_cells - 1 {
                let v = values_buf[i] & exactly_two;
                // Need at least 2 bits for a pair.
                if v.is_empty() || v.is_single() {
                    continue;
                }
                for j in i + 1..num_cells {
                    // Cell j must cover all bits of v.
                    if (v & !values_buf[j]).is_empty() {
                        let unsquished = v | (v << squish_offset) | (v << squish_offset2);
                        grid[cells[i] as usize] &= unsquished;
                        grid[cells[j] as usize] &= unsquished;
                    }
                }
            }
        }

        self.enforce_required_values(grid, acc)
    }
}
