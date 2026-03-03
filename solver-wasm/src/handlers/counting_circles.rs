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
        let tables = LookupTables::get(num_values);

        // Collect all value bitmasks whose digit-sum equals numCells.
        // Mirrors JS `_sumCombinations(numValues)[numCells]`.
        let target_sum = num_cells as u8;
        let combinations: Vec<CandidateSet> = (0..tables.combinations)
            .filter(|&i| tables.sum[i] == target_sum)
            .map(|i| CandidateSet::from_raw(i as u16))
            .collect();

        if combinations.is_empty() {
            return false;
        }

        let eg_data = find_exclusion_groups(&self.cells, cell_exclusions);
        let num_groups = eg_data.groups.len();

        // Restrict cells to values that can actually appear given the exclusion
        // group count.  No value can appear more times than there are groups.
        let max_groups_mask = CandidateSet::from_raw((1u16 << num_groups) - 1);
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
        for j in (1..=self.num_values).rev() {
            let v = CandidateSet::from_value(j);
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
