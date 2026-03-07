//! RequiredValues — cells must contain specific values (with optional repeats).
//!
//! Mirrors JS `RequiredValues`.

use crate::api::types::{CellIndex, Value};
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

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

// ============================================================================
// Unit tests — mirrors tests/handlers/required_values.test.js
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::candidate_set::CandidateSet;
    use crate::grid_shape::GridShape;
    use crate::handlers::util::handler_util::find_exclusion_groups;
    use crate::handlers::ConstraintHandler;
    use crate::solver::cell_exclusions::CellExclusions;
    use crate::solver::grid_state_allocator::GridStateAllocator;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Convert "R<row>C<col>" (1-indexed) to a 0-based cell index in a 9×9
    /// grid.  Panics on malformed input.
    fn cell_id(s: &str) -> CellIndex {
        let bytes = s.as_bytes();
        assert!(
            bytes[0] == b'R' || bytes[0] == b'r',
            "expected cell ID like 'R5C1', got '{}'",
            s
        );
        let mid = bytes.iter().position(|&b| b == b'C' || b == b'c').unwrap();
        let row: usize = s[1..mid].parse().unwrap();
        let col: usize = s[mid + 1..].parse().unwrap();
        ((row - 1) * 9 + (col - 1)) as CellIndex
    }

    fn parse_cells(ids: &[&str]) -> Vec<CellIndex> {
        ids.iter().map(|s| cell_id(s)).collect()
    }

    fn parse_values(s: &str) -> Vec<Value> {
        s.split('_').map(|p| p.parse::<Value>().unwrap()).collect()
    }

    /// Build standard 9×9 sudoku cell exclusions: rows + cols + 3×3 boxes.
    ///
    /// Mirrors `createSudoku9x9CellExclusions()` in the JS test helper.
    fn sudoku_9x9_cell_exclusions() -> CellExclusions {
        let mut groups: Vec<Vec<CellIndex>> = Vec::new();
        // Rows
        for r in 0..9usize {
            let row: Vec<CellIndex> = (0..9).map(|c| (r * 9 + c) as CellIndex).collect();
            groups.push(row);
        }
        // Columns
        for c in 0..9usize {
            let col: Vec<CellIndex> = (0..9).map(|r| (r * 9 + c) as CellIndex).collect();
            groups.push(col);
        }
        // 3×3 boxes
        for br in 0..3usize {
            for bc in 0..3usize {
                let mut boxg: Vec<CellIndex> = Vec::new();
                for r in 0..3usize {
                    for c in 0..3usize {
                        boxg.push(((br * 3 + r) * 9 + (bc * 3 + c)) as CellIndex);
                    }
                }
                groups.push(boxg);
            }
        }
        CellExclusions::from_exclusion_groups(&groups)
    }

    /// Full 9-candidate mask (values 1–9).
    const ALL_CANDIDATES: CandidateSet = CandidateSet::from_raw(0b1_1111_1111);

    /// Initial grid: every cell has all 9 candidates.
    fn full_grid() -> Vec<CandidateSet> {
        vec![ALL_CANDIDATES; 81]
    }

    fn default_shape() -> GridShape {
        GridShape::default_9x9()
    }

    /// Build + initialize a strict RequiredValues handler.
    /// Returns (handler, initial_result).
    fn init_contain_exact(
        val_str: &str,
        cell_ids: &[&str],
        cell_exclusions: &CellExclusions,
    ) -> (RequiredValues, bool) {
        let cells = parse_cells(cell_ids);
        let values = parse_values(val_str);
        let mut handler = RequiredValues::new(cells, values, /* strict */ true);
        let mut grid = full_grid();
        let mut alloc = GridStateAllocator::new(81);
        let ok = handler.initialize(&mut grid, cell_exclusions, default_shape(), &mut alloc);
        (handler, ok)
    }

    // -----------------------------------------------------------------------
    // Tests – find_exclusion_groups
    // -----------------------------------------------------------------------

    #[test]
    fn test_exclusion_groups_9_9_9_cells_yield_3_groups() {
        // ContainExact~9_9_9~R5C1~R6C2~R7C3~R8C4~R9C5.
        // R5C1-R6C2 share box 3; R8C4-R9C5 share box 7; R7C3 is alone.
        let ce = sudoku_9x9_cell_exclusions();
        let cells = parse_cells(&["R5C1", "R6C2", "R7C3", "R8C4", "R9C5"]);
        let data = find_exclusion_groups(&cells, &ce);
        assert_eq!(
            data.groups.len(),
            3,
            "expected 3 groups; got {:?}",
            data.groups
        );
    }

    #[test]
    fn test_exclusion_groups_3_4_4_cells_yield_2_groups() {
        // ContainExact~3_4_4~R1C3~R2C3~R2C4~R1C4.
        // R1C3-R2C3 share col 3; R1C4-R2C4 share col 4; cross-pairs do not.
        let ce = sudoku_9x9_cell_exclusions();
        let cells = parse_cells(&["R1C3", "R2C3", "R2C4", "R1C4"]);
        let data = find_exclusion_groups(&cells, &ce);
        assert_eq!(
            data.groups.len(),
            2,
            "expected 2 groups; got {:?}",
            data.groups
        );
        assert!(
            data.groups.iter().all(|g| g.len() == 2),
            "expected each group to have 2 cells; got {:?}",
            data.groups
        );
    }

    // -----------------------------------------------------------------------
    // Tests – RequiredValues.initialize() with standard 9×9 exclusions
    //
    // Each test corresponds to one ContainExact from the Look-and-say puzzle.
    // -----------------------------------------------------------------------

    #[test]
    fn test_init_6_7_r3c1_r2c1_r1c1() {
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("6_7", &["R3C1", "R2C1", "R1C1"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_3_4_4_four_cells() {
        // 4 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("3_4_4", &["R1C3", "R2C3", "R2C4", "R1C4"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_1_r1c7_r1c8() {
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("1", &["R1C7", "R1C8"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_9_3_five_cells() {
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("9_3", &["R2C9", "R2C8", "R3C8", "R3C7", "R3C6"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_5_5_5_8_seven_cells() {
        // 5 appears 3 times; requires ≥ 3 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact(
            "5_5_5_8",
            &["R3C9", "R4C9", "R5C9", "R5C8", "R5C7", "R6C7", "R6C6"],
            &ce,
        );
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_1_2_five_cells() {
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("1_2", &["R7C9", "R7C8", "R8C8", "R8C7", "R9C7"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_3_3_1_five_cells() {
        // 3 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("3_3_1", &["R7C4", "R8C4", "R8C3", "R8C2", "R7C2"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_6_6_r7c5_r6c5_r6c4_r5c4() {
        // 6 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("6_6", &["R7C5", "R6C5", "R6C4", "R5C4"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_1_1_3_three_cells() {
        // 1 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("1_1_3", &["R6C2", "R6C1", "R7C1"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_8_8_r7c7_r7c6_r8c6_r9c6() {
        // 8 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("8_8", &["R7C7", "R7C6", "R8C6", "R9C6"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_4_2_2_four_cells() {
        // 2 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("4_2_2", &["R5C5", "R4C5", "R4C4", "R4C3"], &ce);
        assert!(ok, "initialize should return true");
    }

    #[test]
    fn test_init_9_9_9_five_cells() {
        // Critical: 9 appears 3 times, cells span 3 different box-groups.
        // R5C1-R6C2 (box3), R7C3 alone, R8C4-R9C5 (box7) → 3 exclusive groups.
        // count(9)=3 ≤ maxGroups=3 → must NOT reject.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("9_9_9", &["R5C1", "R6C2", "R7C3", "R8C4", "R9C5"], &ce);
        assert!(
            ok,
            "initialize should return true for 9_9_9 across 3 box-groups"
        );
    }

    #[test]
    fn test_init_6_6_r6c9_r7c8_r8c7_r9c6() {
        // 6 appears twice; requires ≥ 2 exclusion groups.
        let ce = sudoku_9x9_cell_exclusions();
        let (_, ok) = init_contain_exact("6_6", &["R6C9", "R7C8", "R8C7", "R9C6"], &ce);
        assert!(ok, "initialize should return true");
    }

    // -----------------------------------------------------------------------
    // Tests – enforceConsistency on a full-candidate grid
    // -----------------------------------------------------------------------

    #[test]
    fn test_enforce_consistency_all_look_and_say_constraints_full_grid() {
        let ce = sudoku_9x9_cell_exclusions();
        let constraints: &[(&str, &[&str])] = &[
            ("6_7", &["R3C1", "R2C1", "R1C1"]),
            ("3_4_4", &["R1C3", "R2C3", "R2C4", "R1C4"]),
            ("1", &["R1C7", "R1C8"]),
            ("9_3", &["R2C9", "R2C8", "R3C8", "R3C7", "R3C6"]),
            (
                "5_5_5_8",
                &["R3C9", "R4C9", "R5C9", "R5C8", "R5C7", "R6C7", "R6C6"],
            ),
            ("1_2", &["R7C9", "R7C8", "R8C8", "R8C7", "R9C7"]),
            ("3_3_1", &["R7C4", "R8C4", "R8C3", "R8C2", "R7C2"]),
            ("6_6", &["R7C5", "R6C5", "R6C4", "R5C4"]),
            ("1_1_3", &["R6C2", "R6C1", "R7C1"]),
            ("8_8", &["R7C7", "R7C6", "R8C6", "R9C6"]),
            ("4_2_2", &["R5C5", "R4C5", "R4C4", "R4C3"]),
            ("9_9_9", &["R5C1", "R6C2", "R7C3", "R8C4", "R9C5"]),
            ("6_6", &["R6C9", "R7C8", "R8C7", "R9C6"]),
        ];

        for (val_str, cell_ids) in constraints {
            let (mut handler, init_ok) = init_contain_exact(val_str, cell_ids, &ce);
            assert!(
                init_ok,
                "initialize should return true for ContainExact~{}~{}",
                val_str,
                cell_ids.join("~")
            );
            let mut grid = full_grid();
            let mut acc = crate::solver::handler_accumulator::HandlerAccumulator::new_stub();
            let ok = handler.enforce_consistency(&mut grid, &mut acc);
            assert!(
                ok,
                "enforceConsistency should return true for ContainExact~{}~{}",
                val_str,
                cell_ids.join("~")
            );
        }
    }

    // -----------------------------------------------------------------------
    // Tests – boundary: initialize() rejects count > maxGroups
    // -----------------------------------------------------------------------

    #[test]
    fn test_init_rejects_when_count_exceeds_max_groups() {
        // Two cells in the same row form 1 exclusion group.
        // count(5) = 2 > maxGroups = 1 → initialize must return false.
        let ce = sudoku_9x9_cell_exclusions();
        let cells = vec![cell_id("R1C1"), cell_id("R1C2")]; // same row
        let mut handler = RequiredValues::new(cells, vec![5, 5], /* strict */ true);
        let mut grid = full_grid();
        let mut alloc = GridStateAllocator::new(81);
        let ok = handler.initialize(&mut grid, &ce, default_shape(), &mut alloc);
        assert!(
            !ok,
            "initialize should return false when count > exclusion groups"
        );
    }

    #[test]
    fn test_init_accepts_when_count_equals_max_groups() {
        // Two cells in different rows/cols/boxes form 2 exclusion groups.
        // R1C1(cell 0) and R5C5(cell 40) share no row, col, or box.
        let ce = sudoku_9x9_cell_exclusions();
        let cells = vec![cell_id("R1C1"), cell_id("R5C5")];
        let mut handler = RequiredValues::new(cells, vec![7, 7], /* strict */ true);
        let mut grid = full_grid();
        let mut alloc = GridStateAllocator::new(81);
        let ok = handler.initialize(&mut grid, &ce, default_shape(), &mut alloc);
        assert!(
            ok,
            "initialize should return true when count == exclusion groups"
        );
    }
}
