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
