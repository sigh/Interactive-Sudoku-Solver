//! Lunchbox (Sandwich) constraint handler.
//!
//! Numbers sandwiched between the smallest (1) and largest (numValues)
//! numbers in the row/column must sum to a given value.
//! When `is_house = false` (user-picked Lunchbox), the sandwich is between
//! the smallest and largest values present anywhere in the cell set.
//!
//! Mirrors JS `Lunchbox` (handlers.js ~L1452).

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::solver::lookup_tables::LookupTables;

use super::ConstraintHandler;

// ============================================================================
// Lunchbox
// ============================================================================

/// Lunchbox / Sandwich constraint.
///
/// `sum` = the required sum of values between the two sentinels.
/// `is_house` = true when cells.len() == num_values (full row/column);
///    in this case the sentinels are always value 1 and value numValues
///    (the `border_mask` values).
/// When `is_house` = false, any pair of cells can act as sentinels, and
/// the permissible inner values are those strictly between the two sentinel
/// values.
///
/// Mirrors JS `Lunchbox`.
pub struct Lunchbox {
    cells: Vec<CellIndex>,
    sum: u32,
    is_house: bool,
    /// Bitmask for the two sentinel values (1 and numValues).
    border_mask: u16,
    /// Bitmask for all non-sentinel values.
    value_mask: u16,
    /// (min_dist, max_dist) — range of valid distances between sentinels.
    min_dist: usize,
    max_dist: usize,
    /// Precomputed combinations by distance.
    /// `combinations[d]` = list of bitmasks (each having d-1 bits set, no
    /// border bits) whose value-sum equals `self.sum`.
    /// Indexed: d = 1 (adjacent sentinels, 0 inner cells) → d = max_dist.
    combinations: Vec<Vec<u16>>,
}

impl Lunchbox {
    pub fn new(cells: Vec<CellIndex>, sum: u32) -> Self {
        Lunchbox {
            cells,
            sum,
            is_house: false,
            border_mask: 0,
            value_mask: 0,
            min_dist: 0,
            max_dist: 0,
            combinations: Vec::new(),
        }
    }

    /// Bitmask for the sentinel values: bit 0 (value 1) and bit (nv-1) (value nv).
    fn border_mask_for(num_values: usize) -> u16 {
        1u16 | (1u16 << (num_values - 1))
    }

    /// Maximum possible sum between the sentinels (sum of all non-sentinel values).
    fn max_sum(num_values: usize) -> u32 {
        (num_values as u32 * (num_values as u32 - 1) / 2) - 1
    }
}

impl ConstraintHandler for Lunchbox {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let num_values = shape.num_values as usize;
        let num_cells = self.cells.len();

        self.is_house = num_cells == num_values;

        let border_mask = Self::border_mask_for(num_values);
        let all_values = CandidateSet::all(shape.num_values).raw();
        self.border_mask = border_mask;
        self.value_mask = all_values & !border_mask;

        let max_possible_sum = Self::max_sum(num_values);
        if self.sum > max_possible_sum {
            // No valid combinations exist for this sum.
            return false;
        }

        let lt = LookupTables::get(shape.num_values);

        // Build combinations table indexed by distance d (= j - i).
        // d = 1 means adjacent sentinels (0 inner cells), d = numCells-1 max.
        let max_dist = num_cells - 1;
        let mut combinations: Vec<Vec<u16>> = vec![vec![]; max_dist + 1];
        let total_combos = lt.combinations as u16;

        for i in 0u16..total_combos {
            // Combinations that include a border value are not valid inner sets.
            if i & border_mask != 0 {
                continue;
            }
            if lt.sum[i as usize] as u32 != self.sum {
                continue;
            }
            // d = (number of bits in i) + 1
            let d = (i.count_ones() as usize) + 1;
            if d <= max_dist {
                combinations[d].push(i);
            }
        }

        // Find distance range [min_dist, max_dist_valid].
        let (mut min_dist, mut max_dist_valid) = (max_dist + 1, 0usize);
        for d in 1..=max_dist {
            if !combinations[d].is_empty() {
                if d < min_dist {
                    min_dist = d;
                }
                if d > max_dist_valid {
                    max_dist_valid = d;
                }
            }
        }

        if min_dist > max_dist_valid {
            // No valid distances — constraint can never be satisfied.
            return false;
        }

        self.min_dist = min_dist;
        self.max_dist = max_dist_valid;
        self.combinations = combinations;
        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let is_house = self.is_house;
        let cells = &self.cells;
        let num_cells = cells.len();
        let border_mask = self.border_mask;
        let value_mask = self.value_mask;

        // Cache grid values as raw u16 for fast access.
        let mut values = [0u16; 16];
        for i in 0..num_cells {
            values[i] = grid[cells[i] as usize].raw();
        }

        // ── House-specific short-circuit ──────────────────────────────────
        if is_house {
            // Count how many cells have at least one border bit.
            let mut num_borders = 0usize;
            for i in 0..num_cells {
                if values[i] & border_mask != 0 {
                    num_borders += 1;
                }
            }
            if num_borders < 2 {
                return false;
            }
            if num_borders == 2 {
                // Exactly two known border cells — do a range check.
                let mut idx = 0;
                while values[idx] & border_mask == 0 {
                    idx += 1;
                }
                idx += 1;
                let mut min_max_sum = 0u32;
                while values[idx] & border_mask == 0 {
                    let p = CandidateSet::from_raw(values[idx]).min_max_packed();
                    min_max_sum = min_max_sum.wrapping_add(p);
                    idx += 1;
                }
                let min_sum = min_max_sum >> 16;
                let max_sum_val = min_max_sum & 0xffff;
                if self.sum < min_sum || max_sum_val < self.sum {
                    return false;
                }
                if min_sum == max_sum_val {
                    return true;
                }
            }
        }

        // ── Build valid-settings array ─────────────────────────────────────
        let mut valid_settings = [0u16; 16];

        let min_dist = self.min_dist;
        let max_dist = self.max_dist;
        let max_index = num_cells.saturating_sub(min_dist);

        // Accumulate prefix union incrementally.
        let mut prefix_values: u16 = 0;
        let mut p_prefix = 0usize;
        // `shift` = numCells - 1 (for rotating the border sentinel bits).
        let shift = (num_cells - 1) as u32;

        for i in 0..max_index {
            let mut vi = values[i];
            let mut v_rev: u16 = 0;

            if is_house {
                vi &= border_mask;
                if vi == 0 {
                    continue;
                }
                // Compute the matching sentinel value for the other side.
                // JS: `borderMask & ((vi >> shift) | (vi << shift))`
                // Using 32-bit to match JS overflow behaviour:
                let vi32 = vi as u32;
                v_rev = (border_mask as u32 & ((vi32 >> shift) | (vi32 << shift))) as u16;
            }

            // Accumulate inner values as j advances.
            let mut inner_values: u16 = 0;
            let mut p_inner = i + 1;

            let j_start = i + min_dist;
            let j_end = (i + max_dist + 1).min(num_cells);

            for j in j_start..j_end {
                let mut vj = values[j];

                let cur_value_mask;
                if is_house {
                    vj &= v_rev;
                    if vj == 0 {
                        // Accumulate inner_values anyway so we stay in sync.
                        while p_inner < j {
                            inner_values |= values[p_inner];
                            p_inner += 1;
                        }
                        continue;
                    }
                    cur_value_mask = value_mask;
                } else {
                    // Non-house: inner values must be strictly between vi and vj.
                    cur_value_mask = (CandidateSet::from_raw(vi | vj)).value_range_exclusive().raw();
                }

                // Accumulate inner_values for cells i+1..=j-1.
                while p_inner < j {
                    inner_values |= values[p_inner];
                    p_inner += 1;
                }
                // Accumulate prefix_values for cells 0..=i-1.
                while p_prefix < i {
                    prefix_values |= values[p_prefix];
                    p_prefix += 1;
                }

                // Outer values = all cells outside [i..=j], restricted to cur_value_mask.
                let mut outer_values = prefix_values;
                for k in (p_inner + 1)..num_cells {
                    outer_values |= values[k];
                }
                outer_values &= cur_value_mask;
                let num_outer_cells = num_cells - (j - i) - 1;

                let combinations = &self.combinations[j - i];
                let disallowed_inside = !(inner_values & cur_value_mask);

                let mut inner_possibilities: u16 = 0;
                let mut outer_possibilities: u16 = 0;
                let mut inner_ranges: u16 = cur_value_mask;
                let mut found_valid = false;

                for &c in combinations {
                    // Check all bits in c are within inner_values.
                    if disallowed_inside & c != 0 {
                        continue;
                    }
                    // Check enough outer values exist (not in c).
                    let complement_outer = (!c) & outer_values;
                    if (complement_outer.count_ones() as usize) >= num_outer_cells {
                        inner_possibilities |= c;
                        outer_possibilities |= !c;
                        inner_ranges &=
                            CandidateSet::from_raw(c).value_range_inclusive().raw();
                        found_valid = true;
                    }
                }

                if found_valid {
                    outer_possibilities &= outer_values;
                    let not_inner_ranges = !inner_ranges;

                    let mut k = 0usize;
                    while k < i {
                        valid_settings[k] |= outer_possibilities;
                        k += 1;
                    }
                    valid_settings[k] |= vi & not_inner_ranges;
                    k += 1;
                    while k < j {
                        valid_settings[k] |= inner_possibilities;
                        k += 1;
                    }
                    valid_settings[k] |= vj & not_inner_ranges;
                    k += 1;
                    while k < num_cells {
                        valid_settings[k] |= outer_possibilities;
                        k += 1;
                    }
                }
            }
        }

        // Apply valid_settings to the grid.
        for i in 0..num_cells {
            let v = values[i];
            let new_v = v & valid_settings[i];
            if new_v == 0 {
                return false;
            }
            if v != new_v {
                let c = cells[i] as usize;
                grid[c] = CandidateSet::from_raw(new_v);
                acc.add_for_cell(cells[i]);
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "Lunchbox"
    }

    fn id_str(&self) -> String {
        format!("Lunchbox-{}-{:?}", self.sum, self.cells)
    }
}
