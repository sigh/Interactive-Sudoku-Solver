//! SameValues — enforces that multiple cell-sets contain the same multiset
//! of values (including count enforcement).
//!
//! Mirrors JS `SameValues` (handlers.js ~L1704).

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::util::handler_util::find_exclusion_groups;
use super::ConstraintHandler;

// ============================================================================
// SameValues
// ============================================================================

/// Enforces that multiple cell-sets contain the same multiset of values,
/// including exact count enforcement.
///
/// Mirrors JS `SameValues` (extends SudokuConstraintHandler, with
/// `_enforceCounts` logic).
pub struct SameValues {
    cell_sets: Vec<Vec<CellIndex>>,
    all_cells: Vec<CellIndex>,
    max_exclusion_size: usize,
    num_exclusion_sets: usize,
    all_values: CandidateSet,
    state_offset: Option<usize>,
}

impl SameValues {
    pub fn new(sets: Vec<Vec<CellIndex>>) -> Self {
        let cell_sets: Vec<Vec<CellIndex>> = sets
            .into_iter()
            .map(|mut s| {
                s.sort();
                s
            })
            .collect();
        let all_cells: Vec<CellIndex> =
            cell_sets.iter().flat_map(|s| s.iter().copied()).collect();
        SameValues {
            cell_sets,
            all_cells,
            max_exclusion_size: 1,
            num_exclusion_sets: 0,
            all_values: CandidateSet::EMPTY,
            state_offset: None,
        }
    }

    /// The core count-enforcement logic.
    ///
    /// Mirrors JS `SameValues._enforceCounts`.
    fn enforce_counts(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
        value_intersection: CandidateSet,
    ) -> bool {
        let num_sets = self.cell_sets.len();
        let set_len = self.cell_sets[0].len();
        let mut count_buffer = vec![0usize; num_sets];
        let mut required_buffer = vec![0usize; num_sets];
        let mut min_totals = 0usize;

        // Iterate over each value in value_intersection (lowest first).
        let mut vi = value_intersection;
        while !vi.is_empty() {
            let v = vi.lowest();
            vi = vi & !v;

            let mut min_count = set_len;
            let mut max_required = 0usize;

            for i in 0..num_sets {
                let s = &self.cell_sets[i];
                let mut count = 0usize;
                let mut num_required = 0usize;
                for &c in s {
                    let gv = grid[c as usize];
                    if (gv & v) != CandidateSet::EMPTY {
                        count += 1;
                    }
                    if gv == v {
                        num_required += 1;
                    }
                }
                if count < min_count {
                    min_count = count;
                }
                if num_required > max_required {
                    max_required = num_required;
                }
                count_buffer[i] = count;
                required_buffer[i] = num_required;
            }

            if max_required > self.num_exclusion_sets {
                return false;
            }
            if max_required > min_count {
                return false;
            }

            if max_required == min_count {
                for i in 0..num_sets {
                    let s = &self.cell_sets[i];
                    if required_buffer[i] == max_required && count_buffer[i] > max_required {
                        // Remove v from non-fixed cells in this set.
                        for j in 0..set_len {
                            let c = s[j];
                            let gv = grid[c as usize];
                            if (gv & v) != CandidateSet::EMPTY && gv != v {
                                grid[c as usize] = gv & !v;
                                if grid[c as usize].is_empty() {
                                    return false;
                                }
                                acc.add_for_cell(c);
                            }
                        }
                    } else if count_buffer[i] == max_required && required_buffer[i] < max_required {
                        // Fix cells that have v to only v.
                        for j in 0..set_len {
                            let c = s[j];
                            let gv = grid[c as usize];
                            if (gv & v) != CandidateSet::EMPTY && gv != v {
                                grid[c as usize] = v;
                                acc.add_for_cell(c);
                            }
                        }
                    }
                }
            }

            min_totals += min_count;
        }

        if min_totals < set_len {
            return false;
        }
        true
    }
}

impl ConstraintHandler for SameValues {
    fn cells(&self) -> &[CellIndex] {
        &self.all_cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.all_values = CandidateSet::all(shape.num_values);
        if self.cell_sets.len() < 2 {
            return true;
        }
        let set_len = self.cell_sets[0].len();
        if !self.cell_sets.iter().all(|s| s.len() == set_len) {
            return false;
        }

        self.num_exclusion_sets = set_len;

        // Check if any set is mutually exclusive (all cells see each other).
        for set in &self.cell_sets {
            if cell_exclusions.are_mutually_exclusive(set) {
                self.num_exclusion_sets = 1;
                self.max_exclusion_size = set.len();
                if set.len() > 2 && self.cell_sets.len() > 2 {
                    self.state_offset =
                        Some(state_allocator.allocate(&[CandidateSet::EMPTY]));
                }
                return true;
            }
        }

        // For non-mutual-exclusive sets, find the minimum exclusion group count
        // and maximum group size across all sets.
        // Mirrors JS: `for (const set of this._cellSets) { ... findExclusionGroups ... }`
        for set in &self.cell_sets {
            let eg = find_exclusion_groups(set, cell_exclusions);
            if eg.groups.len() < self.num_exclusion_sets {
                self.num_exclusion_sets = eg.groups.len();
            }
            let largest = eg.groups.iter().map(|g| g.len()).max().unwrap_or(0);
            if largest > self.max_exclusion_size {
                self.max_exclusion_size = largest;
            }
        }

        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        if self.cell_sets.len() < 2 {
            return true;
        }

        if let Some(offset) = self.state_offset {
            if !grid[offset].is_empty() {
                return true;
            }
        }

        let mut value_intersection = self.all_values;
        let mut all_values_seen = CandidateSet::EMPTY;
        let set_len = self.cell_sets[0].len();
        for set in &self.cell_sets {
            let mut values = CandidateSet::EMPTY;
            for &c in set {
                values |= grid[c as usize];
            }
            value_intersection &= values;
            all_values_seen |= values;
        }

        // Check there are enough values to fill the exclusion sets.
        let intersection_size = value_intersection.count();
        if (intersection_size as usize) < self.max_exclusion_size {
            return false;
        }

        // Restrict all cells to only use values in the intersection.
        // Iterate in reverse order within each set to match JS.
        if all_values_seen != value_intersection {
            for set in &self.cell_sets {
                for i in (0..set_len).rev() {
                    let c = set[i];
                    if (grid[c as usize] & !value_intersection) != CandidateSet::EMPTY {
                        grid[c as usize] &= value_intersection;
                        if grid[c as usize].is_empty() {
                            return false;
                        }
                        acc.add_for_cell(c);
                    }
                }
            }
        }

        // If all values are distinct in a single exclusion set, short-circuit.
        if self.num_exclusion_sets == 1 {
            if let Some(offset) = self.state_offset {
                if (intersection_size as usize) == self.max_exclusion_size {
                    grid[offset] = CandidateSet::from_raw(1);
                }
            }
            return true;
        }

        // Full count enforcement (only when num_exclusion_sets > 1).
        self.enforce_counts(grid, acc, value_intersection)
    }

    fn priority(&self) -> i32 {
        // Double the default priority, matching JS `SameValues.priority`.
        self.cells().len() as i32 * 2
    }

    fn name(&self) -> &'static str {
        "SameValues"
    }

    fn id_str(&self) -> String {
        format!("SameValues-{:?}", self.cell_sets)
    }
}
