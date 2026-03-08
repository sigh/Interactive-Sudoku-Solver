//! ValueDependentUniqueValueExclusionHouse — house-level value-dependent exclusion.
//!
//! For each value appearing in exactly 2 cells within the house, looks up
//! the cached pair exclusion cells for that pair and removes the value from
//! those cells.
//!
//! Mirrors JS `ValueDependentUniqueValueExclusionHouse`.

use std::rc::Rc;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::solver::cell_exclusions::{CellExclusions, PairIndex};
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

/// House-level value-dependent exclusion handler.
///
/// Stores per-value `CellExclusions` objects (indexed 0..num_values),
/// shared across all house handlers via `Rc` (matching JS where all houses
/// share the same `valueCellExclusions` array by reference).
///
/// During enforcement, calls `getPairExclusions(pairIndex)` on the
/// appropriate `CellExclusions` — the cached O(1) lookup.
pub struct ValueDependentUniqueValueExclusionHouse {
    cells: Vec<CellIndex>,
    /// Per-value CellExclusions (indexed 0..num_values, value 1..=num_values).
    /// JS: `this._valueCellExclusions` — shared by reference across all houses.
    value_cell_exclusions: Rc<Vec<CellExclusions>>,
}

impl ValueDependentUniqueValueExclusionHouse {
    pub fn new(cells: Vec<CellIndex>, value_cell_exclusions: Rc<Vec<CellExclusions>>) -> Self {
        Self {
            cells,
            value_cell_exclusions,
        }
    }
}

impl ConstraintHandler for ValueDependentUniqueValueExclusionHouse {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // Find values that appear in exactly 2 cells.
        let mut all_values = CandidateSet::EMPTY;
        let mut more_than_one = CandidateSet::EMPTY;
        let mut more_than_two = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            more_than_two = more_than_two | (more_than_one & v);
            more_than_one = more_than_one | (all_values & v);
            all_values = all_values | v;
        }

        let mut exactly_two = more_than_one & !more_than_two;

        while !exactly_two.is_empty() {
            let v = exactly_two.lowest();
            exactly_two = exactly_two ^ v;

            if !self.handle_exactly_two(grid, v, acc) {
                return false;
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "ValueDependentUniqueValueExclusionHouse"
    }
}

impl ValueDependentUniqueValueExclusionHouse {
    /// Handle a value that appears in exactly two cells.
    ///
    /// Mirrors JS `_handleExactlyTwo`.
    fn handle_exactly_two(
        &self,
        grid: &mut [CandidateSet],
        v: CandidateSet,
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // Build pair index matching JS: `pairIndex = (pairIndex << 8) | cells[i]`
        let mut pair_index: PairIndex = 0;
        for i in 0..num_cells {
            if grid[cells[i] as usize].intersects(v) {
                pair_index = (pair_index << 8) | cells[i] as u16;
            }
        }

        let index = v.index();
        let exclusion_cells = self.value_cell_exclusions[index].get_pair_exclusions(pair_index);

        if !exclusion_cells.is_empty() {
            for &excl_cell in exclusion_cells {
                if grid[excl_cell as usize].intersects(v) {
                    grid[excl_cell as usize] ^= v;
                    if grid[excl_cell as usize].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(excl_cell);
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

    fn empty_vce(num_values: usize, num_cells: usize) -> Rc<Vec<CellExclusions>> {
        Rc::new(
            (0..num_values)
                .map(|_| CellExclusions::with_num_cells(num_cells))
                .collect(),
        )
    }

    #[test]
    fn no_exactly_two_returns_true() {
        // All values appear in all 4 cells (more than 2) — no pruning.
        let (mut grid, _) = make_grid(1, 4, Some(4));
        let vce = empty_vce(4, 4);
        let handler = ValueDependentUniqueValueExclusionHouse::new(vec![0, 1, 2, 3], vce);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn exactly_two_with_empty_pair_exclusions() {
        // Value 1 in exactly cells 0 and 1. No pair exclusions → no pruning.
        let (mut grid, _) = make_grid(1, 4, Some(4));
        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[1, 3]);
        grid[2] = vm(&[2, 3, 4]);
        grid[3] = vm(&[2, 3, 4]);

        let vce = empty_vce(4, 4);
        let handler = ValueDependentUniqueValueExclusionHouse::new(vec![0, 1, 2, 3], vce);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn exactly_two_with_pair_exclusions_removes_value() {
        // Value 1 appears in exactly cells 0 and 1. Pair exclusion for (0,1)
        // on value 1 includes cell 4 (outside the house). Cell 4 loses value 1.
        let (mut grid, _) = make_grid(2, 3, Some(4));
        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[1, 3]);
        grid[2] = vm(&[2, 3, 4]); // no value 1
        grid[3] = vm(&[2, 3, 4]); // no value 1
        grid[4] = vm(&[1, 2, 3, 4]); // outside house, has value 1
        grid[5] = vm(&[2, 3, 4]);

        let mut vce_vec: Vec<CellExclusions> =
            (0..4).map(|_| CellExclusions::with_num_cells(6)).collect();
        // For value index 0 (value 1): cells 0 and 1 both exclude cell 4.
        vce_vec[0].add_mutual_exclusion(0, 4);
        vce_vec[0].add_mutual_exclusion(1, 4);
        let vce = Rc::new(vce_vec);

        let handler = ValueDependentUniqueValueExclusionHouse::new(vec![0, 1, 2, 3], vce);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Cell 4 should have value 1 removed.
        assert_eq!(grid[4] & vm(&[1]), CandidateSet::EMPTY);
        assert!(grid[4].intersects(vm(&[2, 3, 4])));
    }
}
