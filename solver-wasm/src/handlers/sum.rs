//! Sum — weighted-sum constraint with coefficient groups.
//!
//! Cells are partitioned into groups by coefficient. Each group has
//! exclusion sub-groups used for tighter bound propagation.
//! Mirrors JS `SumHandler`.

use std::cell::RefCell;

use super::util::handler_util::{
    enforce_required_value_exclusions, expose_hidden_singles, find_exclusion_groups,
};
use super::util::sum_data::SumData;
use super::ConstraintHandler;
use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::{self, GridShape};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::solver::lookup_tables::LookupTables;

/// Size of the scratch array for `restrict_cells_with_coefficients`.
/// Matches the JS `static _seenMinMaxs = new Uint32Array(SHAPE_MAX.numCells)`.
const MAX_CELLS: usize = grid_shape::MAX_SIZE as usize * grid_shape::MAX_SIZE as usize;

thread_local! {
    static SEEN_MIN_MAXS: RefCell<[u32; MAX_CELLS]> =
        const { RefCell::new([0u32; MAX_CELLS]) };
}

// ============================================================================
// Coefficient group
// ============================================================================

/// A group of cells sharing the same coefficient in a Sum constraint.
///
/// Mirrors JS `coeffGroup` objects from sum_handler.js.
#[derive(Clone, Debug)]
struct CoeffGroup {
    /// The coefficient (positive or negative integer).
    coeff: i32,
    /// Cell indices in this group.
    cells: Vec<CellIndex>,
    /// Exclusion groups: sub-partitions of `cells` into cliques of mutually
    /// exclusive cells. Each exclusion group's cells can be reasoned about
    /// as an AllDifferent set.
    exclusion_groups: Vec<Vec<CellIndex>>,
}

// ============================================================================
// Exclusion group ID encoding (packed i16)
// ============================================================================

/// Flag: coefficient is exactly 1.
const GROUP_HAS_UNIT_COEFF: i16 = 1 << 13;
/// Flag: absolute value of coefficient is 1.
const GROUP_HAS_ABS_UNIT_COEFF: i16 = 1 << 14;
/// Mask for extracting the coefficient group index from an exclusion group ID.
const COEFF_GROUP_MASK: i16 = (1 << 8) - 1;

/// Pack a coefficient group index, exclusion group index, and coefficient
/// into a single i16 ID.
///
/// Layout: `[negative:1 | absUnit:1 | unit:1 | unused:5 | exclGroupIdx:4 | coeffGroupIdx:8]`
fn make_exclusion_group_id(coeff_group_idx: usize, excl_group_idx: usize, coeff: i32) -> i16 {
    let mut id = (coeff_group_idx as i16) | ((excl_group_idx as i16) << 8);
    if coeff == 1 {
        id |= GROUP_HAS_UNIT_COEFF;
    }
    if coeff.abs() == 1 {
        id |= GROUP_HAS_ABS_UNIT_COEFF;
    }
    if coeff < 0 {
        // Setting the sign bit makes the i16 value negative.
        id |= -1i16 << 15;
    }
    id
}

// ============================================================================
// Flag bits for the Sum handler
// ============================================================================

/// All coefficient groups have absolute-unit coefficients (±1).
const FLAG_ONLY_ABS_UNIT_COEFF: u8 = 0b01;
/// This is a simple cage: single coeff group with coeff=1 and single exclusion group.
const FLAG_CAGE: u8 = 0b10;

// ============================================================================
// Sum handler
// ============================================================================

/// Sum constraint handler for killer sudoku cages.
///
/// Enforces that a weighted sum of cell values equals a target sum.
/// Supports:
/// - Multiple coefficient groups (positive and negative).
/// - Exclusion group partitioning for AllDifferent reasoning.
/// - Complement cells for 9-cell house-based reasoning.
/// - Special fast paths for 1, 2, and 3 unfixed cells.
/// - Cage combination filtering for simple cages.
///
/// Mirrors JS `Sum` from sum_handler.js.
pub struct Sum {
    /// Target sum value.
    sum: i32,
    /// Cells this handler watches (union of all coefficient groups).
    cells: Vec<CellIndex>,
    /// Coefficient groups.
    coeff_groups: Vec<CoeffGroup>,
    /// Per-cell exclusion group ID (packed i16). Indexed by position
    /// in `self.cells`.
    exclusion_group_ids: Vec<i16>,
    /// Complement cells for 9-cell cage reasoning (optional).
    complement_cells: Option<Vec<CellIndex>>,
    /// Cell exclusions reference for enforcing required value exclusions.
    /// Only set when all coefficients are non-negative.
    has_cell_exclusions: bool,
    /// Behaviour flags.
    flags: u8,
    /// Number of values (from shape), set during initialize.
    num_values: u8,
    /// Number of cells (from shape), set during initialize.
    num_cells: usize,
}

impl Sum {
    /// Create a new Sum handler for a cage.
    ///
    /// `cells`: cell indices in the cage.
    /// `sum`: target sum.
    /// `coeffs`: optional per-cell coefficients (default: all 1).
    pub fn new(cells: Vec<CellIndex>, sum: i32, coeffs: Option<Vec<i32>>) -> Self {
        let coeffs = coeffs.unwrap_or_else(|| vec![1; cells.len()]);
        assert_eq!(cells.len(), coeffs.len());

        // Deduplicate: if a cell appears multiple times, merge coefficients.
        let mut cell_coeff: Vec<(CellIndex, i32)> = Vec::new();
        for (&c, &coeff) in cells.iter().zip(coeffs.iter()) {
            if let Some(entry) = cell_coeff.iter_mut().find(|(cell, _)| *cell == c) {
                entry.1 += coeff;
            } else {
                cell_coeff.push((c, coeff));
            }
        }

        // Group by coefficient value.
        let mut coeff_map: Vec<(i32, Vec<CellIndex>)> = Vec::new();
        for &(cell, coeff) in &cell_coeff {
            if let Some(entry) = coeff_map.iter_mut().find(|(c, _)| *c == coeff) {
                entry.1.push(cell);
            } else {
                coeff_map.push((coeff, vec![cell]));
            }
        }

        let mut coeff_groups: Vec<CoeffGroup> = coeff_map
            .into_iter()
            .map(|(coeff, mut group_cells)| {
                group_cells.sort();
                CoeffGroup {
                    coeff,
                    cells: group_cells,
                    exclusion_groups: Vec::new(),
                }
            })
            .collect();

        // Sort by descending absolute coefficient for range-restriction efficiency.
        coeff_groups.sort_by(|a, b| b.coeff.abs().cmp(&a.coeff.abs()));

        // Collect all cells.
        let all_cells: Vec<CellIndex> = cell_coeff.iter().map(|&(c, _)| c).collect();

        Sum {
            sum,
            cells: all_cells,
            coeff_groups,
            exclusion_group_ids: Vec::new(),
            complement_cells: None,
            has_cell_exclusions: false,
            flags: 0,
            num_values: 0,
            num_cells: 0,
        }
    }

    /// Create a simple cage handler (all coefficients = 1).
    pub fn new_cage(cells: Vec<CellIndex>, sum: i32) -> Self {
        Self::new(cells, sum, None)
    }

    /// Create a Sum handler enforcing equal sums: sum(cells0) == sum(cells1).
    ///
    /// Equivalent to `Sum::new(cells0 ++ cells1, 0, [1...1, -1...-1])`.
    /// The longer group is placed first with coefficient +1.
    /// Mirrors JS `Sum.makeEqual`.
    pub fn make_equal(cells0: &[CellIndex], cells1: &[CellIndex]) -> Self {
        let (a, b) = if cells0.len() >= cells1.len() {
            (cells0, cells1)
        } else {
            (cells1, cells0)
        };
        let mut cells = Vec::with_capacity(a.len() + b.len());
        cells.extend_from_slice(a);
        cells.extend_from_slice(b);
        let mut coeffs = vec![1i32; cells.len()];
        for i in a.len()..cells.len() {
            coeffs[i] = -1;
        }
        Self::new(cells, 0, Some(coeffs))
    }

    /// Set complement cells for house-based combination filtering.
    pub fn set_complement_cells(&mut self, cells: Vec<CellIndex>) {
        self.complement_cells = Some(cells);
    }

    /// Check if all coefficients are exactly 1.
    pub fn only_unit_coeffs(&self) -> bool {
        self.coeff_groups.iter().all(|g| g.coeff == 1)
    }

    /// Get the target sum.
    pub fn sum(&self) -> i32 {
        self.sum
    }

    /// Get the coefficients (in cell order).
    pub fn coefficients(&self) -> Vec<i32> {
        let mut coeffs = vec![0i32; self.cells.len()];
        for g in &self.coeff_groups {
            for &c in &g.cells {
                if let Some(idx) = self.cells.iter().position(|&x| x == c) {
                    coeffs[idx] = g.coeff;
                }
            }
        }
        coeffs
    }

    // ========================================================================
    // Enforcement: few remaining cells (1, 2, 3 unfixed)
    // ========================================================================

    /// Whether the number of unfixed cells is small enough for exact handling.
    fn has_few_remaining_cells(&self, num_unfixed: usize) -> bool {
        if self.flags & FLAG_ONLY_ABS_UNIT_COEFF != 0 {
            // With pairwise sums table, we can handle up to 3.
            num_unfixed <= 3
        } else {
            // General coefficients: only 1-cell case.
            num_unfixed <= 1
        }
    }

    /// Handle the case when exactly 1 cell remains unfixed.
    fn enforce_one_remaining_cell(&self, grid: &mut [CandidateSet], target_sum: i32) -> bool {
        let cells = &self.cells;

        for (i, &c) in cells.iter().enumerate() {
            let cell = c as usize;
            let v = grid[cell];
            if v.is_single() {
                continue; // Fixed cell — skip.
            }

            // Found the unfixed cell.
            let exclusion_group_id = self.exclusion_group_ids[i];
            if exclusion_group_id & GROUP_HAS_UNIT_COEFF != 0 {
                // coeff = 1: value must equal target_sum.
                if target_sum <= 0 || target_sum > self.num_values as i32 {
                    return false;
                }
                let new_val = v & CandidateSet::from_value(target_sum as u8);
                if new_val.is_empty() {
                    return false;
                }
                grid[cell] = new_val;
                return true;
            } else if exclusion_group_id & GROUP_HAS_ABS_UNIT_COEFF != 0 {
                // coeff = -1: value must equal -target_sum.
                if target_sum >= 0 || -target_sum > self.num_values as i32 {
                    return false;
                }
                let new_val = v & CandidateSet::from_value((-target_sum) as u8);
                if new_val.is_empty() {
                    return false;
                }
                grid[cell] = new_val;
                return true;
            } else {
                // General coefficient.
                let coeff_idx = (exclusion_group_id & COEFF_GROUP_MASK) as usize;
                let coeff = self.coeff_groups[coeff_idx].coeff;
                if target_sum % coeff != 0 {
                    return false;
                }
                let target_value = target_sum / coeff;
                if target_value <= 0 || target_value > self.num_values as i32 {
                    return false;
                }
                let new_val = v & CandidateSet::from_value(target_value as u8);
                if new_val.is_empty() {
                    return false;
                }
                grid[cell] = new_val;
                return true;
            }
        }
        // Should not reach here if num_unfixed == 1.
        false
    }

    /// Handle the case when exactly 2 cells remain unfixed.
    fn enforce_two_remaining_cells(
        &self,
        grid: &mut [CandidateSet],
        unfixed_cells: &[CellIndex; 2],
        target_sum: i32,
        exclusion_ids: &[i16; 2],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let tables = LookupTables::get(self.num_values);
        let num_values = self.num_values as usize;

        let mut v0 = grid[unfixed_cells[0] as usize];
        let mut v1 = grid[unfixed_cells[1] as usize];

        // Use the reverse table to find complementary values that sum correctly.
        let shift = target_sum - 1;
        if !(0..32).contains(&shift) {
            return false;
        }
        v1 &= CandidateSet::from_raw(
            ((tables.reverse[usize::from(v0)] as u32) << shift as u32 >> num_values as u32) as u16,
        );
        v0 &= CandidateSet::from_raw(
            ((tables.reverse[usize::from(v1)] as u32) << shift as u32 >> num_values as u32) as u16,
        );

        // If cells are in the same exclusion group, they must be distinct.
        if (target_sum & 1) == 0 && exclusion_ids[0] == exclusion_ids[1] {
            let half = (target_sum >> 1) - 1;
            if (0..16).contains(&half) {
                let mask = !CandidateSet::from_index(half as usize);
                v0 &= mask;
                v1 &= mask;
            }
        }

        if v0.is_empty() || v1.is_empty() {
            return false;
        }

        grid[unfixed_cells[0] as usize] = v0;
        grid[unfixed_cells[1] as usize] = v1;

        // If both cells have the same 2 candidates and we have exclusions,
        // enforce required value exclusions (without propagation, matching JS).
        if v0 == v1 && self.has_cell_exclusions && v0.count() == 2 {
            if !enforce_required_value_exclusions(
                grid,
                unfixed_cells,
                v0,
                acc.cell_exclusions_ref(),
                None, // no propagation for this call
            ) {
                return false;
            }
        }

        true
    }

    /// Handle the case when exactly 3 cells remain unfixed.
    fn enforce_three_remaining_cells(
        &self,
        grid: &mut [CandidateSet],
        unfixed_cells: &[CellIndex; 3],
        sum: i32,
        exclusion_ids: &[i16; 3],
    ) -> bool {
        let sd = SumData::get(self.num_values);
        let tables = LookupTables::get(self.num_values);
        let num_values = self.num_values as usize;

        let mut v0 = grid[unfixed_cells[0] as usize];
        let mut v1 = grid[unfixed_cells[1] as usize];
        let mut v2 = grid[unfixed_cells[2] as usize];

        let ps = sd.pairwise_sums.as_ref().unwrap();

        // Find pairwise sums for each pair of cells.
        let mut sums2 = (ps[(usize::from(v0) << num_values) | usize::from(v1)] as u32) << 2;
        let mut sums1 = (ps[(usize::from(v0) << num_values) | usize::from(v2)] as u32) << 2;
        let mut sums0 = (ps[(usize::from(v1) << num_values) | usize::from(v2)] as u32) << 2;

        // Handle non-distinct pairs (different exclusion groups allow repeats).
        if exclusion_ids[0] != exclusion_ids[1] || exclusion_ids[0] != exclusion_ids[2] {
            if exclusion_ids[0] != exclusion_ids[1] {
                sums2 |= sd.doubles[usize::from(v0 & v1)];
            }
            if exclusion_ids[0] != exclusion_ids[2] {
                sums1 |= sd.doubles[usize::from(v0 & v2)];
            }
            if exclusion_ids[1] != exclusion_ids[2] {
                sums0 |= sd.doubles[usize::from(v1 & v2)];
            }
        }

        // Constrain each cell based on what the other two can sum to.
        let shift = sum - 1;
        if !(0..32).contains(&shift) {
            return false;
        }
        let all_values = CandidateSet::all(self.num_values).raw() as u32;
        v2 &= CandidateSet::from_raw(
            tables.reverse[(((sums2 << num_values as u32) >> shift as u32) & all_values) as usize],
        );
        v1 &= CandidateSet::from_raw(
            tables.reverse[(((sums1 << num_values as u32) >> shift as u32) & all_values) as usize],
        );
        v0 &= CandidateSet::from_raw(
            tables.reverse[(((sums0 << num_values as u32) >> shift as u32) & all_values) as usize],
        );

        if v0.is_empty() || v1.is_empty() || v2.is_empty() {
            return false;
        }

        grid[unfixed_cells[0] as usize] = v0;
        grid[unfixed_cells[1] as usize] = v1;
        grid[unfixed_cells[2] as usize] = v2;

        true
    }

    /// Dispatch to the right few-remaining-cells handler.
    fn enforce_few_remaining_cells(
        &self,
        grid: &mut [CandidateSet],
        target_sum: i32,
        num_unfixed: usize,
        acc: &mut HandlerAccumulator,
    ) -> bool {
        if num_unfixed == 1 {
            return self.enforce_one_remaining_cell(grid, target_sum);
        }

        // Collect unfixed cells and their exclusion IDs.
        let mut unfixed_cells = [0 as CellIndex; 3];
        let mut exclusion_ids = [0i16; 3];
        let mut num_reversed: usize = 0;
        let mut reversed_cells = [0 as CellIndex; 3];

        let tables = LookupTables::get(self.num_values);
        let mut adjusted_sum = target_sum;

        let mut j = 0;
        for i in 0..self.cells.len() {
            let c = self.cells[i];
            let v = grid[c as usize];
            if !v.is_single() {
                // Unfixed cell.
                let eid = self.exclusion_group_ids[i];
                exclusion_ids[j] = eid;
                unfixed_cells[j] = c;

                // If negative coefficient, reverse the bitmask.
                if eid < 0 {
                    grid[c as usize] = CandidateSet::from_raw(tables.reverse[usize::from(v)]);
                    adjusted_sum += (self.num_values as i32) + 1;
                    reversed_cells[num_reversed] = c;
                    num_reversed += 1;
                } else if eid & GROUP_HAS_UNIT_COEFF == 0 {
                    unreachable!(
                        "enforceFewRemainingCells only handles ±1 coefficients for 2-3 cells"
                    );
                }

                j += 1;
            }
        }

        let result = if num_unfixed == 2 {
            self.enforce_two_remaining_cells(
                grid,
                &[unfixed_cells[0], unfixed_cells[1]],
                adjusted_sum,
                &[exclusion_ids[0], exclusion_ids[1]],
                acc,
            )
        } else {
            self.enforce_three_remaining_cells(
                grid,
                &[unfixed_cells[0], unfixed_cells[1], unfixed_cells[2]],
                adjusted_sum,
                &[exclusion_ids[0], exclusion_ids[1], exclusion_ids[2]],
            )
        };

        // Un-reverse the reversed cells.
        for &rc in &reversed_cells[..num_reversed] {
            let c = rc as usize;
            grid[c] = CandidateSet::from_raw(tables.reverse[usize::from(grid[c])]);
        }

        result
    }

    // ========================================================================
    // Enforcement: range restriction
    // ========================================================================

    /// Restrict cell value ranges based on min/max sum feasibility.
    fn restrict_value_range(
        grid: &mut [CandidateSet],
        cells: &[CellIndex],
        coeff: i32,
        mut sum_minus_min: i32,
        mut max_minus_sum: i32,
    ) -> bool {
        if coeff != 1 {
            if coeff > 0 {
                let inv = 1.0 / coeff as f64;
                sum_minus_min = (sum_minus_min as f64 * inv) as i32;
                max_minus_sum = (max_minus_sum as f64 * inv) as i32;
            } else {
                let inv = -1.0 / coeff as f64;
                let tmp_smm = sum_minus_min;
                sum_minus_min = (max_minus_sum as f64 * inv) as i32;
                max_minus_sum = (tmp_smm as f64 * inv) as i32;
            }
        }

        for i in 0..cells.len() {
            let v = grid[cells[i] as usize];
            // Skip singletons.
            if v.is_single() {
                continue;
            }

            let vr = v.raw();
            let clz32v = (vr as u32).leading_zeros() as i32;
            let range = ((vr & vr.wrapping_neg()) as u32).leading_zeros() as i32 - clz32v;

            if sum_minus_min < range {
                // Remove values that are too large.
                let x = (vr as u32) << sum_minus_min as u32;
                let low_bit = x & x.wrapping_neg();
                let new_v = vr & ((low_bit << 1).wrapping_sub(1)) as u16;
                if new_v == 0 {
                    return false;
                }
                grid[cells[i] as usize] = CandidateSet::from_raw(new_v);
            }

            if max_minus_sum < range {
                // Remove values that are too small.
                let mask = ((-0x80000000i32) >> (clz32v + max_minus_sum)) as u32;
                let new_v = vr & mask as u16;
                if new_v == 0 {
                    return false;
                }
                grid[cells[i] as usize] = CandidateSet::from_raw(new_v);
            }
        }

        true
    }

    // ========================================================================
    // Enforcement: cage combinations (single exclusion group)
    // ========================================================================

    /// Restrict cells in a single-exclusion-group cage using combination
    /// filtering and hidden singles.
    fn restrict_cells_single_exclusion_group(
        &self,
        grid: &mut [CandidateSet],
        sum: i32,
        cells: &[CellIndex],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let sd = SumData::get(self.num_values);
        let tables = LookupTables::get(self.num_values);
        let num_cells = cells.len();

        // Compute fixed and all value stats.
        let mut fixed_values = CandidateSet::EMPTY;
        let mut all_values = CandidateSet::EMPTY;
        let mut non_unique_values = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            non_unique_values |= all_values & v;
            all_values |= v;
            // Branchless fixed-value accumulation.
            // JS: fixedValues |= (!(v & (v - 1))) * v;
            let mask = CandidateSet::from_raw(0u16.wrapping_sub(v.is_single() as u16));
            fixed_values |= v & mask;
        }

        let fixed_sum = tables.sum[usize::from(fixed_values)] as i32;
        if fixed_sum > sum {
            return false;
        }

        // Check unique value count.
        if (all_values.count() as usize) < num_cells {
            return false;
        }
        // If all fixed, check sum.
        if all_values == fixed_values {
            return fixed_sum == sum;
        }

        let unfixed_values = all_values & !fixed_values;
        let mut required_unfixed = unfixed_values;
        let num_unfixed = num_cells - fixed_values.count() as usize;

        let remaining_sum = (sum - fixed_sum) as usize;
        if remaining_sum > sd.max_cage_sum || num_unfixed > self.num_values as usize {
            return false;
        }

        let options = &sd.killer_cage_sums[num_unfixed][remaining_sum];
        let mut possibilities = CandidateSet::EMPTY;
        for &option in options {
            if (option & !unfixed_values).is_empty() {
                possibilities |= option;
                required_unfixed &= option;
            }
        }
        if possibilities.is_empty() {
            return false;
        }

        // Remove values that aren't part of any valid combination.
        let values_to_remove = unfixed_values & !possibilities;
        if !values_to_remove.is_empty() {
            for i in 0..num_cells {
                if grid[cells[i] as usize].intersects(values_to_remove) {
                    grid[cells[i] as usize] &= !values_to_remove;
                    if grid[cells[i] as usize].is_empty() {
                        return false;
                    }
                }
            }
        }

        // Hidden singles among required unfixed values.
        let hidden_singles = required_unfixed & !non_unique_values;
        if !hidden_singles.is_empty() && !expose_hidden_singles(grid, cells, hidden_singles) {
            return false;
        }

        // Enforce required value exclusions if we have cell exclusions.
        if !self.has_cell_exclusions {
            return true;
        }

        let non_unique_required = required_unfixed & non_unique_values;
        if !non_unique_required.is_empty() {
            let ce = std::mem::take(acc.cell_exclusions());
            let ok =
                enforce_required_value_exclusions(grid, cells, non_unique_required, &ce, Some(acc));
            *acc.cell_exclusions() = ce;
            if !ok {
                return false;
            }
        }

        true
    }

    // ========================================================================
    // Enforcement: multi-group range restriction with coefficients
    // ========================================================================

    /// Restrict cell ranges using uniqueness-aware min/max sums across
    /// exclusion groups, supporting non-unit coefficients.
    fn restrict_cells_with_coefficients(
        &self,
        grid: &mut [CandidateSet],
        sum: i32,
        coeff_groups: &[CoeffGroup],
    ) -> bool {
        let tables = LookupTables::get(self.num_values);
        let num_values = self.num_values as i32;
        let all_values_raw = CandidateSet::all(self.num_values).raw();

        // First pass: compute strict min/max across all groups.
        let mut strict_min: i32 = 0;
        let mut strict_max: i32 = 0;

        // Store per-exclusion-group seen-min-max for the second pass.
        // Matches JS static field `_seenMinMaxs`.
        SEEN_MIN_MAXS.with_borrow_mut(|seen_min_maxs| {
            let mut seen_count: usize = 0;

            for g in coeff_groups {
                let coeff = g.coeff;
                for eg in &g.exclusion_groups {
                    let v0 = grid[eg[0] as usize].raw();
                    let mut seen_min: u16 = v0 & v0.wrapping_neg();
                    let mut seen_max: u16 =
                        ((all_values_raw as u32 + 1) >> (32 - (v0 as u32).leading_zeros())) as u16;

                    for j in 1..eg.len() {
                        let v = grid[eg[j] as usize].raw();

                        let x = !(seen_min | ((v & v.wrapping_neg()).wrapping_sub(1)));
                        seen_min |= x & x.wrapping_neg();

                        let max_bit = self.num_values as u32 - (32 - (v as u32).leading_zeros());
                        let y_mask = (!0u16) << max_bit;
                        let y = !seen_max & y_mask;
                        seen_max |= y & y.wrapping_neg();
                    }

                    if (seen_min | seen_max) > all_values_raw {
                        return false;
                    }

                    let seen_max_rev = tables.reverse[seen_max as usize];
                    let min_sum = tables.sum[seen_min as usize] as i32;
                    let max_sum = tables.sum[seen_max_rev as usize] as i32;

                    if coeff == 1 {
                        strict_max += max_sum;
                        strict_min += min_sum;
                    } else if coeff > 0 {
                        strict_max += coeff * max_sum;
                        strict_min += coeff * min_sum;
                    } else {
                        strict_min += coeff * max_sum;
                        strict_max += coeff * min_sum;
                    }

                    let packed = if seen_min != seen_max_rev {
                        (seen_min as u32) | ((seen_max_rev as u32) << 16)
                    } else {
                        0
                    };
                    seen_min_maxs[seen_count] = packed;
                    seen_count += 1;
                }
            }

            let min_dof = sum - strict_min;
            let max_dof = strict_max - sum;
            if min_dof < 0 || max_dof < 0 {
                return false;
            }

            // Second pass: restrict values based on dof.
            let mut index = 0;
            for g in coeff_groups {
                let coeff = g.coeff;
                let dof_lim = (num_values - 1) * coeff.abs();
                if min_dof >= dof_lim && max_dof >= dof_lim {
                    index += g.exclusion_groups.len();
                    continue;
                }

                let mut min_dof_set = min_dof;
                let mut max_dof_set = max_dof;
                if coeff != 1 {
                    if coeff > 0 {
                        let inv = 1.0 / coeff as f64;
                        min_dof_set = (min_dof_set as f64 * inv) as i32;
                        max_dof_set = (max_dof_set as f64 * inv) as i32;
                    } else {
                        let inv = -1.0 / coeff as f64;
                        let tmp = min_dof_set;
                        min_dof_set = (max_dof_set as f64 * inv) as i32;
                        max_dof_set = (tmp as f64 * inv) as i32;
                    }
                }

                for eg in &g.exclusion_groups {
                    let seen_min_max = seen_min_maxs[index];
                    index += 1;

                    if seen_min_max == 0 {
                        continue;
                    }

                    let seen_min = seen_min_max as u16;
                    let seen_max = (seen_min_max >> 16) as u16;

                    let mut value_mask: u16 = !0;

                    if min_dof_set < (num_values - 1) {
                        let mut expanded = seen_min as u32;
                        for _ in 0..min_dof_set {
                            expanded |= expanded << 1;
                        }
                        value_mask = expanded as u16;
                    }

                    if max_dof_set < (num_values - 1) {
                        let mut expanded = seen_max as u32;
                        for _ in 0..max_dof_set {
                            expanded |= expanded >> 1;
                        }
                        value_mask &= expanded as u16;
                    }

                    // Apply the mask.
                    let mask = CandidateSet::from_raw(value_mask);
                    if ((!mask) & CandidateSet::all(self.num_values)) != CandidateSet::EMPTY {
                        for &cell in eg {
                            grid[cell as usize] &= mask;
                            if grid[cell as usize].is_empty() {
                                return false;
                            }
                        }
                    }
                }
            }

            true
        }) // end SEEN_MIN_MAXS.with_borrow_mut
    }

    // ========================================================================
    // Enforcement: complement cells
    // ========================================================================

    /// Cage combination filtering using complement cells.
    fn enforce_combinations_with_complement(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let sd = SumData::get(self.num_values);
        let set0 = &self.cells;
        let set1 = self.complement_cells.as_ref().unwrap();
        let sum = self.sum as usize;

        let mut values0 = CandidateSet::EMPTY;
        for &c in set0 {
            values0 |= grid[c as usize];
        }
        let mut values1 = CandidateSet::EMPTY;
        for &c in set1 {
            values1 |= grid[c as usize];
        }

        if set0.len() > self.num_values as usize || sum > sd.max_cage_sum {
            return true; // Can't use cage sums table.
        }

        let cage_sums = &sd.killer_cage_sums[set0.len()][sum];
        let mut possibilities0 = CandidateSet::EMPTY;
        let mut possibilities1 = CandidateSet::EMPTY;

        for &option in cage_sums {
            // Branchlessly check that the option is consistent with both sets.
            // JS: const includeOption = -(!(option & ~values0) & !(~option & ~values1 & allValues));
            let c1 = (option & !values0).is_empty() as u16;
            let c2 = (!option & !values1 & CandidateSet::all(self.num_values)).is_empty() as u16;
            let include_mask = CandidateSet::from_raw(0u16.wrapping_sub(c1 & c2));
            possibilities0 |= option & include_mask;
            possibilities1 |= !option & include_mask;
        }
        if possibilities0.is_empty() {
            return false;
        }

        // Remove values not in any valid combination.
        let vtr0 = values0 & !possibilities0;
        if !vtr0.is_empty() {
            for &c in set0 {
                if grid[c as usize].intersects(vtr0) {
                    grid[c as usize] &= !vtr0;
                    if grid[c as usize].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(c);
                }
            }
        }
        let vtr1 = values1 & !possibilities1;
        if !vtr1.is_empty() {
            for &c in set1 {
                if grid[c as usize].intersects(vtr1) {
                    grid[c as usize] &= !vtr1;
                    if grid[c as usize].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(c);
                }
            }
        }

        true
    }
}

// ============================================================================
// ConstraintHandler trait implementation
// ============================================================================

impl ConstraintHandler for Sum {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        // Sum handlers never contribute to AllDifferent exclusions.
        // Cages get a separate AllDifferent handler for that purpose
        // (matching JS behavior). This ensures LittleKiller sums
        // (which allow repeating digits) are not treated as cages.
        &[]
    }

    fn priority(&self) -> i32 {
        // Smaller cages get higher priority, but all sums get at least
        // num_values priority.
        let n = self.num_values as i32;
        let len = self.cells.len() as i32;
        std::cmp::max(n * 2 - len, n)
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.num_values = shape.num_values;
        self.num_cells = shape.num_cells as usize;

        // Partition each coefficient group's cells into exclusion groups.
        for g in &mut self.coeff_groups {
            g.exclusion_groups = find_exclusion_groups(&g.cells, cell_exclusions).groups;
        }

        // Enforce max group size of 15 cells (rangeInfo summing constraint).
        {
            let max_group_size = 15;
            let original_count = self.coeff_groups.len();
            for i in 0..original_count {
                while self.coeff_groups[i].cells.len() > max_group_size {
                    // Split off the last exclusion groups to form a new coeff group.
                    let coeff = self.coeff_groups[i].coeff;
                    let egs = &mut self.coeff_groups[i].exclusion_groups;

                    let mut new_cells: Vec<u8> = Vec::new();
                    let mut new_egs: Vec<Vec<u8>> = Vec::new();

                    while !egs.is_empty()
                        && egs.last().unwrap().len() <= max_group_size - new_cells.len()
                    {
                        let eg = egs.pop().unwrap();
                        new_cells.extend_from_slice(&eg);
                        new_egs.push(eg);
                    }

                    if new_cells.is_empty() {
                        // Last exclusion group is exactly 16+ cells.
                        let eg = egs.last_mut().unwrap();
                        let split: Vec<u8> = eg.drain(..max_group_size).collect();
                        new_cells = split.clone();
                        new_egs.push(split);
                    }

                    // Remove new_cells from the original group.
                    self.coeff_groups[i]
                        .cells
                        .retain(|c| !new_cells.contains(c));

                    self.coeff_groups.push(CoeffGroup {
                        coeff,
                        cells: new_cells,
                        exclusion_groups: new_egs,
                    });
                }
            }
        }

        // Re-sort by descending absolute coefficient.
        self.coeff_groups
            .sort_by(|a, b| b.coeff.abs().cmp(&a.coeff.abs()));

        // Build exclusion group ID map.
        let mut cell_lookup = vec![0u8; self.num_cells];
        for (i, &c) in self.cells.iter().enumerate() {
            cell_lookup[c as usize] = i as u8;
        }

        self.exclusion_group_ids = vec![0i16; self.cells.len()];
        for (gi, g) in self.coeff_groups.iter().enumerate() {
            for (ei, eg) in g.exclusion_groups.iter().enumerate() {
                let eid = make_exclusion_group_id(gi, ei, g.coeff);
                for &cell in eg {
                    let idx = cell_lookup[cell as usize] as usize;
                    self.exclusion_group_ids[idx] = eid;
                }
            }
        }

        // Set flags.
        if self.coeff_groups.iter().all(|g| g.coeff.abs() == 1) {
            self.flags |= FLAG_ONLY_ABS_UNIT_COEFF;
        }
        if self.only_unit_coeffs()
            && self.coeff_groups.len() == 1
            && self.coeff_groups[0].exclusion_groups.len() == 1
        {
            self.flags |= FLAG_CAGE;
        }

        // Only use cell exclusions if there are no negative coefficients.
        let has_negative = self.coeff_groups.iter().any(|g| g.coeff < 0);
        self.has_cell_exclusions = !has_negative;

        // Validate sum.
        let sum = self.sum;
        if self.flags & FLAG_CAGE != 0 && sum as usize > SumData::get(self.num_values).max_cage_sum
        {
            return false;
        }

        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let sum = self.sum;
        let coeff_groups = &self.coeff_groups;
        let tables = LookupTables::get(self.num_values);
        let range_info = &tables.range_info;

        // Calculate aggregate stats.
        let mut max_sum: i32 = 0;
        let mut min_sum: i32 = 0;
        let mut num_unfixed: i32 = self.cells.len() as i32;
        let mut fixed_sum: i32 = 0;

        for g in coeff_groups {
            let coeff = g.coeff;
            let mut range_info_sum: u32 = 0;
            for &cell in &g.cells {
                range_info_sum += range_info[usize::from(grid[cell as usize])];
            }

            num_unfixed -= (range_info_sum >> 24) as i32;

            if coeff == 1 {
                max_sum += (range_info_sum & 0xFF) as i32;
                min_sum += ((range_info_sum >> 8) & 0xFF) as i32;
                fixed_sum += ((range_info_sum >> 16) & 0xFF) as i32;
            } else if coeff < 0 {
                max_sum += coeff * (((range_info_sum >> 8) & 0xFF) as i32);
                min_sum += coeff * ((range_info_sum & 0xFF) as i32);
                fixed_sum += coeff * (((range_info_sum >> 16) & 0xFF) as i32);
            } else {
                max_sum += coeff * ((range_info_sum & 0xFF) as i32);
                min_sum += coeff * (((range_info_sum >> 8) & 0xFF) as i32);
                fixed_sum += coeff * (((range_info_sum >> 16) & 0xFF) as i32);
            }
        }

        // Impossible to make the target sum.
        if sum < min_sum || max_sum < sum {
            return false;
        }
        // Sum is exactly reached — no more work needed.
        if min_sum == max_sum {
            return true;
        }

        // A large fixed value indicates an empty cell (0 in grid).
        if num_unfixed <= 0 {
            return false;
        }

        let has_few_unfixed = self.has_few_remaining_cells(num_unfixed as usize);

        if has_few_unfixed {
            let target_sum = sum - fixed_sum;
            if !self.enforce_few_remaining_cells(grid, target_sum, num_unfixed as usize, acc) {
                return false;
            }
        } else {
            let num_values = self.num_values as i32;
            let sum_minus_min = sum - min_sum;
            let max_minus_sum = max_sum - sum;

            for g in coeff_groups {
                let coeff = g.coeff;
                let dof_lim = num_values * coeff.abs();
                if sum_minus_min >= dof_lim && max_minus_sum >= dof_lim {
                    break;
                }
                if !Self::restrict_value_range(grid, &g.cells, coeff, sum_minus_min, max_minus_sum)
                {
                    return false;
                }
            }
        }

        if self.complement_cells.is_some() {
            return self.enforce_combinations_with_complement(grid, acc);
        }

        // If few-cells handler already ran, we've done all we can.
        if has_few_unfixed {
            return true;
        }

        if self.flags & FLAG_CAGE != 0 {
            if !self.restrict_cells_single_exclusion_group(grid, self.sum, &self.cells, acc) {
                return false;
            }
        } else if !self.restrict_cells_with_coefficients(grid, sum, coeff_groups) {
            return false;
        }

        true
    }

    fn name(&self) -> &'static str {
        "Sum"
    }

    fn id_str(&self) -> String {
        let mut parts = vec![format!("Sum|{}", self.sum)];
        for g in &self.coeff_groups {
            let cells_str: Vec<String> = g.cells.iter().map(|c| c.to_string()).collect();
            parts.push(format!("{}:{}", g.coeff, cells_str.join(",")));
        }
        parts.join("|")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::grid_state_allocator::GridStateAllocator;

    #[test]
    fn test_sum_new_basic() {
        let sum = Sum::new_cage(vec![0, 1], 3);
        assert_eq!(sum.sum(), 3);
        assert_eq!(sum.cells.len(), 2);
        assert!(sum.only_unit_coeffs());
    }

    #[test]
    fn test_sum_new_with_coefficients() {
        let sum = Sum::new(vec![0, 1], 5, Some(vec![1, -1]));
        assert_eq!(sum.sum(), 5);
        assert!(!sum.only_unit_coeffs());
    }

    #[test]
    fn test_sum_duplicate_cells() {
        let sum = Sum::new(vec![0, 0, 1], 5, Some(vec![1, 2, 1]));
        assert_eq!(sum.cells.len(), 2);
    }

    #[test]
    fn test_sum_enforce_one_cell() {
        let mut sum = Sum::new_cage(vec![0], 5);
        let ce = CellExclusions::new();
        let mut grid = [CandidateSet::all(9); 81];
        assert!(sum.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        let mut acc = HandlerAccumulator::new_stub();
        assert!(sum.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], CandidateSet::from_value(5));
    }

    #[test]
    fn test_sum_enforce_two_cells() {
        let cells = vec![0u8, 1];
        let mut sum = Sum::new_cage(cells.clone(), 3);

        let row: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[row]);

        let mut grid = [CandidateSet::all(9); 81];
        assert!(sum.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        let mut acc = HandlerAccumulator::new_stub();
        assert!(sum.enforce_consistency(&mut grid, &mut acc));

        let expected = CandidateSet::from_value(1) | CandidateSet::from_value(2);
        assert_eq!(grid[0], expected);
        assert_eq!(grid[1], expected);
    }

    #[test]
    fn test_sum_enforce_impossible() {
        let mut sum = Sum::new_cage(vec![0, 1], 20);
        let row: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[row]);
        let mut grid = [CandidateSet::all(9); 81];
        assert!(sum.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        let mut acc = HandlerAccumulator::new_stub();
        assert!(!sum.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn test_sum_three_cells() {
        let cells = vec![0u8, 1, 2];
        let mut sum = Sum::new_cage(cells.clone(), 6);

        let row: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[row]);

        let mut grid = [CandidateSet::all(9); 81];
        assert!(sum.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        let mut acc = HandlerAccumulator::new_stub();
        assert!(sum.enforce_consistency(&mut grid, &mut acc));

        let expected =
            CandidateSet::from_value(1) | CandidateSet::from_value(2) | CandidateSet::from_value(3);
        for &c in &cells {
            assert_eq!(
                grid[c as usize], expected,
                "Cell {} should have candidates {{1,2,3}}",
                c
            );
        }
    }

    #[test]
    fn test_exclusion_group_partitioning() {
        use crate::handlers::util::handler_util::find_exclusion_groups;
        let row: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[row]);
        let data = find_exclusion_groups(&[0, 1, 2], &ce);
        assert_eq!(
            data.groups.len(),
            1,
            "Cells in same row should be one group"
        );
        assert_eq!(data.groups[0].len(), 3);
    }

    #[test]
    fn test_exclusion_groups_separate() {
        use crate::handlers::util::handler_util::find_exclusion_groups;
        let ce = CellExclusions::new();
        let data = find_exclusion_groups(&[0, 40, 80], &ce);
        assert_eq!(
            data.groups.len(),
            3,
            "Unrelated cells should be separate groups"
        );
    }

    #[test]
    fn test_sum_cage_combinations() {
        let cells = vec![0u8, 1, 2];
        let mut sum = Sum::new_cage(cells.clone(), 24);

        let row: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[row]);

        let mut grid = [CandidateSet::all(9); 81];
        assert!(sum.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));

        let mut acc = HandlerAccumulator::new_stub();
        assert!(sum.enforce_consistency(&mut grid, &mut acc));

        let expected =
            CandidateSet::from_value(7) | CandidateSet::from_value(8) | CandidateSet::from_value(9);
        for &c in &cells {
            assert_eq!(grid[c as usize], expected);
        }
    }
}
