//! RequiredValues — cells must contain specific values (with optional repeats).
//!
//! Mirrors JS `RequiredValues`.

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::{CellIndex, Value};

use super::util::handler_util::{expose_hidden_singles, find_exclusion_groups};
use super::ConstraintHandler;

/// Flat array mapping value → count, for values 1..=16.
/// Avoids HashMap overhead for small integer keys.
#[derive(Clone)]
pub struct ValueCounts {
    /// counts[v - 1] = number of times value `v` appears.
    counts: [u8; 16],
    /// Number of distinct values.
    num_distinct: usize,
}

impl ValueCounts {
    fn new() -> Self {
        Self {
            counts: [0u8; 16],
            num_distinct: 0,
        }
    }

    fn increment(&mut self, value: Value) {
        let idx = (value - 1) as usize;
        if self.counts[idx] == 0 {
            self.num_distinct += 1;
        }
        self.counts[idx] += 1;
    }

    /// Get the count for a given value (1-indexed).
    pub fn get(&self, value: Value) -> u8 {
        self.counts[(value - 1) as usize]
    }

    /// Number of distinct values.
    pub fn len(&self) -> usize {
        self.num_distinct
    }

    /// Iterate over (value, count) pairs for values with count > 0.
    pub fn iter(&self) -> impl Iterator<Item = (Value, u8)> + '_ {
        self.counts
            .iter()
            .enumerate()
            .filter(|(_, &c)| c > 0)
            .map(|(i, &c)| ((i + 1) as u8, c))
    }
}

/// RequiredValues constraint handler.
///
/// The cells listed must collectively contain all the specified values.
/// If `strict` is true, each value must appear exactly the specified number
/// of times (not more).
pub struct RequiredValues {
    cells: Vec<CellIndex>,
    values: Vec<Value>,
    strict: bool,
    /// Flat array from value → required count.
    value_counts: ValueCounts,
    /// Bitmask of all required values.
    value_mask: CandidateSet,
    /// Bitmask of values with count == 1.
    single_values: CandidateSet,
    /// Repeated value entries: (value_mask, count, other_values_mask) triples.
    repeated_values: Vec<(CandidateSet, usize, CandidateSet)>,
}

impl RequiredValues {
    pub fn new(cells: Vec<CellIndex>, values: Vec<Value>, strict: bool) -> Self {
        let mut value_counts = ValueCounts::new();
        for &v in &values {
            value_counts.increment(v);
        }

        let value_mask = CandidateSet::from_values(values.iter().copied());
        let single_values = CandidateSet::from_values(
            values
                .iter()
                .filter(|&&v| value_counts.get(v) == 1)
                .copied(),
        );

        let mut repeated_values = Vec::new();
        for (value, count) in value_counts.iter() {
            if count > 1 {
                let v = CandidateSet::from_value(value);
                let other = value_mask ^ v;
                repeated_values.push((v, count as usize, other));
            }
        }

        Self {
            cells,
            values,
            strict,
            value_counts,
            value_mask,
            single_values,
            repeated_values,
        }
    }

    /// Get the value counts.
    pub fn value_counts(&self) -> &ValueCounts {
        &self.value_counts
    }

    /// Get the raw values array.
    pub fn values(&self) -> &[u8] {
        &self.values
    }
}

impl ConstraintHandler for RequiredValues {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[CellIndex] {
        if self.value_counts.len() == self.cells.len() {
            &self.cells
        } else {
            &[]
        }
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        // Validate: no value appears more times than there are exclusion groups.
        let eg_data = find_exclusion_groups(&self.cells, cell_exclusions);
        let max_count = eg_data.groups.len();
        for (_, count) in self.value_counts.iter() {
            if count as usize > max_count {
                return false;
            }
        }

        // If #values == #cells, restrict all cells to only the required values.
        if self.values.len() == self.cells.len() {
            for &cell in &self.cells {
                let restricted = initial_grid[cell as usize] & self.value_mask;
                if restricted.is_empty() {
                    return false;
                }
                initial_grid[cell as usize] = restricted;
            }
        }

        // Remove required values from cells that see ALL of our cells.
        let common_exclusions = cell_exclusions.get_list_exclusions(&self.cells);
        for &cell in common_exclusions {
            let v = initial_grid[cell as usize];
            let restricted = v & !self.value_mask;
            if restricted.is_empty() && v != CandidateSet::EMPTY {
                return false;
            }
            initial_grid[cell as usize] = restricted;
        }

        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // Enforce repeated values first.
        for &(target, target_count, _) in &self.repeated_values {
            let mut count = 0usize;
            let mut fixed_count = 0usize;
            for i in 0..num_cells {
                let v = grid[cells[i] as usize];
                if v.intersects(target) {
                    count += 1;
                }
                if v == target {
                    fixed_count += 1;
                }
            }

            if count < target_count {
                return false;
            }
            if self.strict && fixed_count > target_count {
                return false;
            }
            if count == target_count && fixed_count != target_count {
                // Must fix all cells that contain this value.
                for i in 0..num_cells {
                    if grid[cells[i] as usize].intersects(target) {
                        grid[cells[i] as usize] = target;
                    }
                }
            }
        }

        // Gather statistics.
        let mut all_values = CandidateSet::EMPTY;
        let mut non_unique = CandidateSet::EMPTY;
        let mut fixed_values = CandidateSet::EMPTY;
        let mut num_fixed = 0u32;
        let mut fixed_non_unique = CandidateSet::EMPTY;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            if v.is_single() {
                fixed_non_unique = fixed_non_unique | (fixed_values & v);
                fixed_values = fixed_values | v;
                num_fixed += 1;
            }
            non_unique = non_unique | (all_values & v);
            all_values = all_values | v;
        }

        let value_mask = self.value_mask;

        // All required values must still be possible.
        if (value_mask & !all_values) != CandidateSet::EMPTY {
            return false;
        }

        // Strict: no single-count value should be fixed in two cells.
        if self.strict && (fixed_non_unique & self.single_values) != CandidateSet::EMPTY {
            return false;
        }

        // If all required values are already fixed, nothing more to do.
        if (value_mask & !fixed_values) == CandidateSet::EMPTY {
            return true;
        }

        // Expose hidden singles.
        let hidden_singles = self.single_values & !non_unique & !fixed_values;
        if !hidden_singles.is_empty() {
            if !expose_hidden_singles(grid, cells, hidden_singles) {
                return false;
            }
            fixed_values = fixed_values | hidden_singles;
            num_fixed += hidden_singles.count();
        }

        // If remaining values == remaining cells, constrain non-fixed cells
        // to only the remaining values.
        let remaining_values = value_mask & !fixed_values;
        let remaining_cells = num_cells as u32 - num_fixed;
        if remaining_values.count() == remaining_cells {
            for i in 0..num_cells {
                let v = grid[cells[i] as usize];
                if (v & !fixed_values) == CandidateSet::EMPTY {
                    continue;
                }
                if (v & !remaining_values) != CandidateSet::EMPTY {
                    let next = v & remaining_values;
                    if next.is_empty() {
                        return false;
                    }
                    grid[cells[i] as usize] = next;
                }
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "RequiredValues"
    }
}
