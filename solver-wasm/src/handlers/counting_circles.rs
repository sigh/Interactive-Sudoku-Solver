//! CountingCircles constraint handler.
//!
//! A set of cells where digit v must appear exactly v times within the set.
//! Equivalently, the sum of all cell values equals the number of cells, and
//! every value v present occurs exactly v times.
//!
//! Mirrors JS `CountingCircles` from handlers.js.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::solver::lookup_tables::LookupTables;

use super::util::handler_util::find_exclusion_groups;
use super::ConstraintHandler;

pub struct CountingCircles {
    cells: Vec<CellIndex>,
    /// All bitmasks (subsets of 1..=numValues) whose value-sum equals numCells.
    combinations: Vec<CandidateSet>,
    num_values: u8,
    /// Value offset from grid shape.
    value_offset: i8,
    /// Per-cell bitmask: bit i set if this cell belongs to exclusion group i.
    exclusion_map: Vec<u16>,
    /// The exclusion groups from `find_exclusion_groups`.
    exclusion_groups: Vec<Vec<CellIndex>>,
    /// Complement cells for each exclusion group (cells that see the whole group).
    exclusion_complements: Vec<Vec<CellIndex>>,
}

impl CountingCircles {
    pub fn new(mut cells: Vec<CellIndex>) -> Self {
        // Cells are sorted in the constructor (mirrors JS: cells.sort((a,b)=>a-b)).
        cells.sort();
        Self {
            cells,
            combinations: Vec::new(),
            num_values: 0,
            value_offset: 0,
            exclusion_map: Vec::new(),
            exclusion_groups: Vec::new(),
            exclusion_complements: Vec::new(),
        }
    }
}

impl ConstraintHandler for CountingCircles {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "CountingCircles"
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let num_cells = self.cells.len();
        let num_values = shape.num_values;
        let value_offset = shape.value_offset;
        self.value_offset = value_offset;

        // With offset, external 0 can't appear (0 occurrences = contradiction),
        // so valid external values are 1..(numValues+valueOffset).
        // Use maxValue() for the lookup table to get the right combinations.
        let max_value = shape.max_value() as u8;
        let tables = LookupTables::get(max_value);

        // Collect all value bitmasks whose digit-sum equals numCells.
        let target_sum = num_cells as u8;
        let mut combinations: Vec<CandidateSet> = (0..tables.combinations)
            .filter(|&i| tables.sum[i] == target_sum)
            .map(|i| CandidateSet::from_raw(i as u16))
            .collect();

        if combinations.is_empty() {
            return false;
        }

        // With offset, shift combinations to align with internal value bits.
        if value_offset != 0 {
            let shift = (-value_offset) as u32;
            combinations = combinations
                .iter()
                .map(|&c| CandidateSet::from_raw(c.raw() << shift))
                .collect();
        }

        let eg_data = find_exclusion_groups(&self.cells, cell_exclusions);
        let num_groups = eg_data.groups.len();

        // Restrict cells to values that can actually appear given the exclusion
        // group count.  No value can appear more times than there are groups.
        let max_groups_mask = CandidateSet::from_raw(
            (1u16 << (num_groups as i32 - value_offset as i32) as u32) - 1,
        );
        let allowed_values = combinations
            .iter()
            .fold(CandidateSet::EMPTY, |a, &c| a | c)
            & max_groups_mask;

        for &cell in &self.cells {
            let new_v = initial_grid[cell as usize] & allowed_values;
            if new_v.is_empty() {
                return false;
            }
            initial_grid[cell as usize] = new_v;
        }

        // Build per-cell exclusion group membership bitmask.
        // exclusion_map[pos] = 1 << group_index for the cell at position `pos`.
        let mut exclusion_map = vec![0u16; num_cells];
        for (group_idx, group) in eg_data.groups.iter().enumerate() {
            for &cell in group {
                if let Some(pos) = self.cells.iter().position(|&c| c == cell) {
                    exclusion_map[pos] = 1 << group_idx;
                }
            }
        }

        // Precompute complement cells for each exclusion group.
        let exclusion_complements: Vec<Vec<CellIndex>> = eg_data
            .groups
            .iter()
            .map(|g| cell_exclusions.get_list_exclusions(g).to_vec())
            .collect();

        // Store results.  Re-derive allowed_values without the groups mask for
        // safety (combinations are unfiltered; filtering happens in enforce).
        let _ = allowed_values; // already applied above
        self.combinations = combinations;
        self.num_values = num_values;
        self.exclusion_map = exclusion_map;
        self.exclusion_groups = eg_data.groups;
        self.exclusion_complements = exclusion_complements;

        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // Gather current cell statistics.
        let mut all_values = CandidateSet::EMPTY;
        let mut fixed_values = CandidateSet::EMPTY;
        let mut unfixed_values = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            all_values = all_values | v;
            if v.is_single() {
                fixed_values = fixed_values | v;
            } else {
                unfixed_values = unfixed_values | v;
            }
        }

        // Filter stored combinations: keep those consistent with the current grid.
        // allowed_values = OR of valid combinations; required_values = AND.
        let mut required_values = all_values;
        let mut allowed_values = CandidateSet::EMPTY;
        for &c in &self.combinations {
            // Combination must contain every fixed value ...
            if !(fixed_values & !c).is_empty() {
                continue;
            }
            // ... and must not reference values absent from all cells.
            if !(c & !all_values).is_empty() {
                continue;
            }
            allowed_values = allowed_values | c;
            required_values = required_values & c;
        }
        if allowed_values.is_empty() {
            return false;
        }

        // Restrict all cells to valid values.
        if allowed_values != all_values {
            for i in 0..num_cells {
                let new_v = grid[cells[i] as usize] & allowed_values;
                if new_v.is_empty() {
                    return false;
                }
                grid[cells[i] as usize] = new_v;
            }
        }

        // Per-value constraint.  Iterate from highest to lowest since larger
        // values are more constrained.
        let exclusion_map = &self.exclusion_map;
        let value_offset = self.value_offset;
        for j in (1..=(self.num_values as i32 + value_offset as i32)).rev() {
            let v = CandidateSet::from_offset_value(j, value_offset);
            if (v & allowed_values).is_empty() {
                continue;
            }

            let mut total_count: u32 = 0;
            let mut fixed_count: u32 = 0;
            let mut v_excl_groups: u16 = 0;
            for i in 0..num_cells {
                if grid[cells[i] as usize].intersects(v) {
                    total_count += 1;
                    if grid[cells[i] as usize] == v {
                        fixed_count += 1;
                    }
                    v_excl_groups |= exclusion_map[i];
                }
            }
            let num_excl_groups = v_excl_groups.count_ones();

            if fixed_count > j as u32 {
                // Too many cells already fixed to this value.
                return false;
            }

            if num_excl_groups < j as u32 {
                // Not enough exclusion groups to host j instances.
                if (v & required_values).is_empty() {
                    // Value is not required — remove it.
                    for i in 0..num_cells {
                        if grid[cells[i] as usize].intersects(v) {
                            let new_v = grid[cells[i] as usize] & !v;
                            if new_v.is_empty() {
                                return false;
                            }
                            grid[cells[i] as usize] = new_v;
                        }
                    }
                } else {
                    return false;
                }
            } else if total_count == j as u32 {
                // Exact count: if required and unfixed, fix all cells that hold v.
                if !(v & required_values & unfixed_values).is_empty() {
                    for i in 0..num_cells {
                        if grid[cells[i] as usize].intersects(v) {
                            grid[cells[i] as usize] = v;
                        }
                    }
                }
            } else if num_excl_groups == j as u32
                && !(v & required_values & unfixed_values).is_empty()
            {
                // Exactly j exclusion groups contain v and v is required/unfixed.
                // Check each group for a forced assignment or complement removal.
                let mut veg = v_excl_groups;
                while veg != 0 {
                    let vgroup = veg & veg.wrapping_neg();
                    veg ^= vgroup;
                    let group_index = vgroup.trailing_zeros() as usize;
                    let group = &self.exclusion_groups[group_index];

                    let mut unique_cell: CellIndex = 0;
                    let mut count: u32 = 0;
                    for &cell in group {
                        if grid[cell as usize].intersects(v) {
                            count += 1;
                            if count > 1 {
                                break;
                            }
                            unique_cell = cell;
                        }
                    }

                    if count == 1 {
                        // Only one cell in this group can hold v — fix it.
                        grid[unique_cell as usize] = v;
                    } else {
                        // Multiple candidates — remove v from complement cells.
                        for &comp_cell in &self.exclusion_complements[group_index] {
                            if grid[comp_cell as usize].intersects(v) {
                                let new_v = grid[comp_cell as usize] & !v;
                                if new_v.is_empty() {
                                    return false;
                                }
                                grid[comp_cell as usize] = new_v;
                            }
                        }
                    }
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

    #[test]
    fn init_restricts_to_valid_combinations() {
        // 3 cells, numValues=4. Sum of values must = 3. Valid combos:
        // {1,1,1}=mask 0x01, but value-sum per set: just {3}→mask=0x04 gives sum=3,
        // or {1,2}→1+2=3. So combination masks where sum=3.
        // bit 0=val 1, bit 1=val 2. mask 0b0100=val 3.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1, 2]);
        assert!(init_with(&mut handler, &mut grid, shape, &ce));
        // After init, cells should only have values from valid combination masks.
        // Value 4 cannot be in any combo with sum 3, so it should be removed.
        for i in 0..3 {
            assert_eq!(grid[i] & vm(&[4]), CandidateSet::EMPTY,
                "cell {} should not contain value 4", i);
        }
    }

    #[test]
    fn fixed_values_filter_combinations() {
        // 3 cells, numValues=4. Cell 0 fixed to 1.
        // Sum must be 3. With digit-v-appears-v-times and sum=numCells:
        // 1 appears 1 time, 2 appears 2 times → {1,2,2} → sum = 1+2+2 = 5 ≠ 3.
        // Only valid: {1,1,1} → all cells = 1, sum = 3. ← but 1 appears 3 times, need 1 time!
        // Actually: value 3 appears 0 times. Value sum = numCells = 3.
        // {3} → 3 appears once, actually need 3 times (digit v appears v times).
        // Wait, rethinking: mask for sum=3 with numValues=4:
        //   Individual values: 1+2=3? No, mask must have sum(values_in_mask) = numCells.
        //   mask {1,2} = bit 0 | bit 1 → sum = 1+2 = 3 ✓
        //   mask {3} = bit 2 → sum = 3 ✓
        // The combination masks are just which values CAN appear, not frequencies.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1, 2]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[1]); // fixed to 1
        let mut a = acc();
        let result = handler.enforce_consistency(&mut grid, &mut a);
        assert!(result);
        // After fixing cell 0 to 1, combo {3} is invalidated (doesn't contain 1).
        // Only combo {1,2} survives. Value 2 must appear twice, and each unfixed
        // cell has its own exclusion group → both fixed to {2}.
        assert_eq!(grid[1], vm(&[2]));
        assert_eq!(grid[2], vm(&[2]));
    }

    #[test]
    fn fail_when_no_valid_combination() {
        // 3 cells, numValues=4. Fix all to 4 → sum=12 ≠ 3.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1, 2]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[4]);
        grid[1] = vm(&[4]);
        grid[2] = vm(&[4]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn too_many_fixed_values_fail() {
        // 2 cells, numValues=4. Sum must be 2.
        // Combo {2}→sum=2, combo {1}+...→sum=1. Only {2} works, but need 2 to appear 2 times.
        // Fix both to 2 (fixedCount=2, j=2 → exactly right, pass).
        // Fix both to 1 (fixedCount=2, j=1 → too many → fail).
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[1]);

        let mut a = acc();
        // Both cells fixed to 1, but value 1 needs to appear exactly 1 time → fail.
        // Actually: combo filtering first. Combos for sum=2: {2}, {1}+overflow? No: mask with bit-sum=2 = {2}.
        // Cell 0 fixed to 1, but {2} doesn't contain 1 → allowed_values empty → false.
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn exact_count_fixes_cells() {
        // 2 cells, numValues=4. Sum=2. Only combo: {2} (sum=2).
        // Both cells start with {2, ...}, after enforce both should be {2}.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1]);
        init_with(&mut handler, &mut grid, shape, &ce);

        // After init, allowed values from combos with sum=2: just {2}.
        // So cells already restricted to {2}. Enforce should confirm both = {2}.
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[2]));
        assert_eq!(grid[1], vm(&[2]));
    }

    // =====================================================================
    // Offset (0-indexed) tests (ported from JS tests/handlers/counting_circles.test.js)
    // =====================================================================

    #[test]
    fn offset_init_excludes_external_0_and_shifts_combos() {
        // 2 cells, offset=-1, numValues=4: external 0-3, internal 1-4.
        // External 0 can't appear. Valid external values: {1,2,3}.
        // Combos with external sum=2: {2} → internal {3}. Both cells must be 3.
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1]);
        init_with(&mut handler, &mut grid, shape, &ce);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[3]));
        assert_eq!(grid[1], vm(&[3]));
    }

    #[test]
    fn offset_enforce_uses_shifted_counts() {
        // 3 cells, offset=-1. Fix cell 0 to internal 2 (ext 1) → only
        // combo {2,3} survives. Internal 3 (ext 2) must appear twice.
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1, 2]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[2]); // internal 2 (external 1 → appears once)

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[3]));
        assert_eq!(grid[2], vm(&[3]));
    }

    #[test]
    fn offset_too_many_of_a_value_fails() {
        // Internal 2 (external 1) should appear exactly 1 time.
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1, 2]);
        init_with(&mut handler, &mut grid, shape, &ce);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[2]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn offset_0_unchanged_behavior() {
        // Same as the non-offset "exact count" test. 2 cells, sum=2, combo: {2}.
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let ce = CellExclusions::with_num_cells(4);
        let mut handler = CountingCircles::new(vec![0, 1]);
        init_with(&mut handler, &mut grid, shape, &ce);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[2]));
        assert_eq!(grid[1], vm(&[2]));
    }
}
