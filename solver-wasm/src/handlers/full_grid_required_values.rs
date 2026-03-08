//! FullGridRequiredValues — propagates value frequency requirements across lines.
//!
//! For non-square grids: if one axis has `numValues` lines of length K,
//! each value must appear in exactly K of those lines.
//!
//! Mirrors JS `FullGridRequiredValues`.

use std::cell::RefCell;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::util::handler_util::expose_hidden_singles;
use super::ConstraintHandler;

/// Full-grid required-values handler for non-square grids.
///
/// Each value must appear in exactly `line_length` of the `num_values` lines.
pub struct FullGridRequiredValues {
    /// All cells in the grid (for handler identity).
    all_cells: Vec<CellIndex>,
    /// Per-line arrays of cell indices.
    lines: Vec<Vec<CellIndex>>,
    /// Number of cells per line (K = min dimension).
    line_length: usize,
    /// Number of values = number of lines.
    num_values: usize,
    /// Per-line scratch: fixed values.
    line_fixed: RefCell<Vec<u16>>,
    /// Per-line scratch: possible (non-fixed) values.
    line_possible: RefCell<Vec<u16>>,
    /// Per-line scratch: hidden singleton candidates.
    line_hidden: RefCell<Vec<u16>>,
}

impl FullGridRequiredValues {
    pub fn new(all_cells: Vec<CellIndex>, lines: Vec<Vec<CellIndex>>) -> Self {
        let num_lines = lines.len();
        let line_length = if lines.is_empty() { 0 } else { lines[0].len() };
        Self {
            all_cells,
            num_values: num_lines,
            line_length,
            lines,
            line_fixed: RefCell::new(vec![0; num_lines]),
            line_possible: RefCell::new(vec![0; num_lines]),
            line_hidden: RefCell::new(vec![0; num_lines]),
        }
    }
}

impl ConstraintHandler for FullGridRequiredValues {
    fn cells(&self) -> &[CellIndex] {
        &self.all_cells
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let num_lines = self.num_values;
        let line_length = self.line_length;

        let mut line_fixed_ref = self.line_fixed.borrow_mut();
        let line_fixed = &mut *line_fixed_ref;
        let mut line_possible_ref = self.line_possible.borrow_mut();
        let line_possible = &mut *line_possible_ref;
        let mut line_hidden_ref = self.line_hidden.borrow_mut();
        let line_hidden = &mut *line_hidden_ref;

        // Phase 1: Gather per-line statistics.
        for li in 0..num_lines {
            let line = &self.lines[li];
            let mut all_values: u16 = 0;
            let mut at_least_two: u16 = 0;
            let mut fixed: u16 = 0;

            for &cell in line {
                let v = grid[cell as usize].raw();
                at_least_two |= all_values & v;
                all_values |= v;
                // A value is fixed if it's a singleton.
                if v & (v - 1) == 0 {
                    fixed |= v;
                }
            }

            line_fixed[li] = fixed;
            line_possible[li] = all_values & !fixed;
            line_hidden[li] = all_values & !at_least_two & !fixed;
        }

        // Phase 2: Per-value propagation.
        let mut required_possible_values: u16 = 0;

        for value_index in 0..self.num_values {
            let value_mask: u16 = 1 << value_index;

            let mut satisfied: u32 = 0;
            let mut possible: u32 = 0;
            for li in 0..num_lines {
                if line_fixed[li] & value_mask != 0 {
                    satisfied += 1;
                }
                if line_possible[li] & value_mask != 0 {
                    possible += 1;
                }
            }

            if satisfied > line_length as u32 {
                return false;
            }
            if satisfied + possible < line_length as u32 {
                return false;
            }

            if satisfied == line_length as u32 {
                // This value is fully satisfied. Remove it from lines where
                // it's still possible (not yet fixed).
                let inv_mask = !value_mask;
                for li in 0..num_lines {
                    if line_possible[li] & value_mask == 0 {
                        continue;
                    }
                    let line = &self.lines[li];
                    for &cell in line {
                        let v = grid[cell as usize].raw();
                        let next = v & inv_mask;
                        if next != v {
                            if next == 0 {
                                return false;
                            }
                            grid[cell as usize] = CandidateSet::from_raw(next);
                            acc.add_for_cell(cell);
                        }
                    }
                }
                continue;
            }

            if satisfied + possible == line_length as u32 {
                required_possible_values |= value_mask;
            }
        }

        // Phase 3: Handle required possible values.
        if required_possible_values != 0 {
            for li in 0..num_lines {
                let hidden_singles =
                    CandidateSet::from_raw(line_hidden[li] & required_possible_values);
                if !hidden_singles.is_empty() {
                    if !expose_hidden_singles(grid, &self.lines[li], hidden_singles) {
                        return false;
                    }
                }

                let all_required = (line_possible[li] & required_possible_values) | line_fixed[li];
                let used_cell_count = all_required.count_ones() as usize;
                if used_cell_count > line_length {
                    return false;
                }
                if used_cell_count == line_length {
                    let remove_values = !all_required;
                    for &cell in &self.lines[li] {
                        let v = grid[cell as usize].raw();
                        if v & remove_values != 0 {
                            let next = v & all_required;
                            if next == 0 {
                                return false;
                            }
                            grid[cell as usize] = CandidateSet::from_raw(next);
                            acc.add_for_cell(cell);
                        }
                    }
                }
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "FullGridRequiredValues"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    fn make_lines_3x2() -> Vec<Vec<CellIndex>> {
        vec![vec![0, 1], vec![2, 3], vec![4, 5]]
    }

    fn make_lines_4x3() -> Vec<Vec<CellIndex>> {
        vec![
            vec![0, 1, 2],
            vec![3, 4, 5],
            vec![6, 7, 8],
            vec![9, 10, 11],
        ]
    }

    #[test]
    fn forbids_value_when_satisfied_eq_required() {
        let (mut grid, _shape) = make_grid(2, 3, Some(3));
        let lines = make_lines_3x2();
        let cells: Vec<CellIndex> = (0..6).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        // Value 1 fixed in two lines (required = 2), so must be removed from line 2
        grid[0] = vm(&[1]);
        grid[2] = vm(&[1]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[4] & vm(&[1]), CandidateSet::EMPTY);
        assert_eq!(grid[5] & vm(&[1]), CandidateSet::EMPTY);
    }

    #[test]
    fn fail_when_satisfied_gt_required() {
        let (mut grid, _shape) = make_grid(2, 3, Some(3));
        let lines = make_lines_3x2();
        let cells: Vec<CellIndex> = (0..6).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        // Value 1 fixed in all 3 lines, but required = 2
        grid[0] = vm(&[1]);
        grid[2] = vm(&[1]);
        grid[4] = vm(&[1]);

        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn fail_when_satisfied_plus_possible_lt_required() {
        let (mut grid, _shape) = make_grid(2, 3, Some(3));
        let lines = make_lines_3x2();
        let cells: Vec<CellIndex> = (0..6).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        let v2 = vm(&[2]);
        // Remove 2 from line 1 and line 2
        grid[2] = grid[2] & !v2;
        grid[3] = grid[3] & !v2;
        grid[4] = grid[4] & !v2;
        grid[5] = grid[5] & !v2;

        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn force_value_when_single_candidate_cell() {
        let (mut grid, _shape) = make_grid(2, 3, Some(3));
        let lines = make_lines_3x2();
        let cells: Vec<CellIndex> = (0..6).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        let v3 = vm(&[3]);

        // line 0 satisfied (cell 1 fixed to 3)
        grid[1] = v3;
        // line 1: only cell 2 can be 3
        grid[2] = vm(&[1, 3]);
        grid[3] = vm(&[1, 2]);
        // line 2: make value 3 impossible
        grid[4] = grid[4] & !v3;
        grid[5] = grid[5] & !v3;

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[2], v3);
    }

    #[test]
    fn prune_non_required_values_when_required_exactly_fill_line() {
        let (mut grid, _shape) = make_grid(3, 4, Some(4));
        let lines = make_lines_4x3();
        let cells: Vec<CellIndex> = (0..12).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        let v1 = vm(&[1]);
        let v2 = vm(&[2]);
        let v3 = vm(&[3]);
        let v4 = vm(&[4]);

        // Remove 3 from line 1
        for &cell in &[3, 4, 5] {
            grid[cell as usize] = grid[cell as usize] & !v3;
        }
        // Remove 2 from line 2
        for &cell in &[6, 7, 8] {
            grid[cell as usize] = grid[cell as usize] & !v2;
        }
        // Remove 1 from line 3
        for &cell in &[9, 10, 11] {
            grid[cell as usize] = grid[cell as usize] & !v1;
        }

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Line 0 has required values {1,2,3} which exactly fill line length=3
        // so value 4 should be removed from all cells in line 0
        for &cell in &[0, 1, 2] {
            assert_eq!(grid[cell as usize] & v4, CandidateSet::EMPTY);
        }
    }

    #[test]
    fn fail_when_line_has_too_many_required_values() {
        let (mut grid, _shape) = make_grid(3, 4, Some(4));
        let lines = make_lines_4x3();
        let cells: Vec<CellIndex> = (0..12).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        let v1 = vm(&[1]);
        let v2 = vm(&[2]);
        let v3 = vm(&[3]);
        let v4 = vm(&[4]);

        // Make ALL values required by removing each from exactly one line
        for &cell in &[3, 4, 5] {
            grid[cell as usize] = grid[cell as usize] & !v1;
        }
        for &cell in &[6, 7, 8] {
            grid[cell as usize] = grid[cell as usize] & !v2;
        }
        for &cell in &[9, 10, 11] {
            grid[cell as usize] = grid[cell as usize] & !v3;
        }
        // Also remove 4 from line 1 so 4 becomes required too
        for &cell in &[3, 4, 5] {
            grid[cell as usize] = grid[cell as usize] & !v4;
        }

        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn fail_multiple_hidden_singles_in_one_cell() {
        let (mut grid, _shape) = make_grid(2, 3, Some(3));
        let lines = make_lines_3x2();
        let cells: Vec<CellIndex> = (0..6).collect();
        let handler = FullGridRequiredValues::new(cells, lines);

        let v1 = vm(&[1]);
        let v2 = vm(&[2]);
        let v3 = vm(&[3]);

        // Line 0: cell 0 = 1, cell 1 = {2,3}
        grid[0] = v1;
        grid[1] = v2 | v3;

        // Make value 2 required: satisfied in line 1, possible in line 0, impossible in line 2
        grid[2] = v2;
        grid[3] = v1 | v2;
        grid[4] = grid[4] & !v2;
        grid[5] = grid[5] & !v2;

        // Make value 3 required: satisfied in line 2, possible in line 0, impossible in line 1
        grid[4] = v3;
        grid[5] = v1 | v3;
        grid[2] = grid[2] & !v3;
        grid[3] = grid[3] & !v3;

        assert!(!handler.enforce_consistency(&mut grid, &mut acc()));
    }
}
