//! DoppelgangerZero constraint handler.
//!
//! For each grid cell in a Doppelganger puzzle, if the cell is 0 then the
//! missing digits for its row, column, and box must all be different.
//! `state_cells` are the state cells tracking the missing digit for each region
//! type that contains `grid_cell` (typically [rowState, colState, boxState]).
//!
//! Mirrors JS `DoppelgangerZero` from handlers.js.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

pub struct DoppelgangerZero {
    cells: Vec<CellIndex>,
    grid_cell: CellIndex,
    state_cells: Vec<CellIndex>,
}

impl DoppelgangerZero {
    pub fn new(grid_cell: CellIndex, state_cells: Vec<CellIndex>) -> Self {
        assert!(
            state_cells.len() >= 2 && state_cells.len() <= 3,
            "DoppelgangerZero supports 2 or 3 state cells"
        );
        let mut cells = Vec::with_capacity(1 + state_cells.len());
        cells.push(grid_cell);
        cells.extend_from_slice(&state_cells);
        DoppelgangerZero {
            cells,
            grid_cell,
            state_cells,
        }
    }
}

impl ConstraintHandler for DoppelgangerZero {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        if shape.value_offset != -1 {
            return false;
        }
        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let v = grid[self.grid_cell as usize];

        // If the grid cell can't be 0, constraint is trivially satisfied.
        // Value 0 with offset -1 is internal value 1 (bit 0), so mask = 1.
        let zero_mask = CandidateSet::from_value(1); // internal value 1 = external 0
        if !v.intersects(zero_mask) {
            return true;
        }

        let s = &self.state_cells;
        let n = s.len();

        if v == zero_mask {
            // Grid cell is definitely 0.
            for i in 0..n {
                let si = grid[s[i] as usize];
                if !si.is_single() {
                    continue;
                }
                for j in 0..n {
                    if j == i {
                        continue;
                    }
                    if grid[s[j] as usize].intersects(si) {
                        grid[s[j] as usize] &= !si;
                        if grid[s[j] as usize].is_empty() {
                            return false;
                        }
                        acc.add_for_cell(s[j]);
                    }
                }
            }
        } else {
            // Grid cell might be 0. Remove 0 if state cells can't all differ.
            let s0 = grid[s[0] as usize];
            let s1 = grid[s[1] as usize];
            let s2 = if n == 3 {
                grid[s[2] as usize]
            } else {
                CandidateSet::EMPTY
            };
            let state_cell_conflict =
                (s0.is_single() && (s0 == s1 || s0 == s2)) || (s1.is_single() && s1 == s2);
            if state_cell_conflict {
                grid[self.grid_cell as usize] &= !zero_mask;
                if grid[self.grid_cell as usize].is_empty() {
                    return false;
                }
                acc.add_for_cell(self.grid_cell);
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "DoppelgangerZero"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    // 0-indexed value mask: vm0(&[0]) = display value 0 = internal value 1.
    fn vm0(vals: &[u8]) -> CandidateSet {
        vm(&vals.iter().map(|v| v + 1).collect::<Vec<_>>())
    }

    const ZERO: CandidateSet = CandidateSet::from_value(1); // internal 1 = external 0

    fn make_context(
        num_state_cells: usize,
    ) -> (
        DoppelgangerZero,
        Vec<CandidateSet>,
        GridShape,
        usize,
        Vec<usize>,
    ) {
        // 9x9 grid with 10 values (0-9), offset -1.
        let shape = GridShape::build_with_offset(9, 9, 10, -1);
        let all = CandidateSet::all(shape.num_values);
        let total = shape.num_cells + 1 + num_state_cells; // extra cells for grid_cell(0) + state
        let grid = vec![all; total];
        let grid_cell: usize = 0;
        let state_cells: Vec<usize> = (1..=num_state_cells).collect();
        let handler = DoppelgangerZero::new(
            grid_cell as CellIndex,
            state_cells.iter().map(|&i| i as CellIndex).collect(),
        );
        (handler, grid, shape, grid_cell, state_cells)
    }

    fn init_handler(handler: &mut DoppelgangerZero, grid: &mut [CandidateSet], shape: GridShape) {
        assert!(init(handler, grid, shape));
    }

    // =========================================================================
    // Constructor tests
    // =========================================================================

    #[test]
    fn constructor_accepts_2_state_cells() {
        let handler = DoppelgangerZero::new(0, vec![1, 2]);
        assert_eq!(handler.cells().len(), 3);
    }

    #[test]
    fn constructor_accepts_3_state_cells() {
        let handler = DoppelgangerZero::new(0, vec![1, 2, 3]);
        assert_eq!(handler.cells().len(), 4);
    }

    #[test]
    #[should_panic]
    fn constructor_rejects_1_state_cell() {
        DoppelgangerZero::new(0, vec![1]);
    }

    #[test]
    #[should_panic]
    fn constructor_rejects_4_state_cells() {
        DoppelgangerZero::new(0, vec![1, 2, 3, 4]);
    }

    // =========================================================================
    // Initialization tests
    // =========================================================================

    #[test]
    fn initialize_succeeds_with_offset_minus_1() {
        let (mut handler, mut grid, shape, _, _) = make_context(3);
        assert!(init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn initialize_fails_with_offset_0() {
        let shape = GridShape::build(9, 9, 9); // offset 0
        let all = CandidateSet::all(shape.num_values);
        let mut grid = vec![all; shape.num_cells + 4];
        let mut handler = DoppelgangerZero::new(0, vec![1, 2, 3]);
        assert!(!init(&mut handler, &mut grid, shape));
    }

    // =========================================================================
    // enforceConsistency - gridCell can't be 0
    // =========================================================================

    #[test]
    fn noop_when_grid_cell_cannot_be_0() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        // gridCell has no 0 bit.
        grid[grid_cell] = vm0(&[1, 2, 3]);
        grid[state_cells[0]] = vm0(&[1]);
        grid[state_cells[1]] = vm0(&[1]);
        grid[state_cells[2]] = vm0(&[1]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Grid should be unchanged -- we verify state cells are unmodified.
        assert_eq!(grid[state_cells[0]], vm0(&[1]));
        assert_eq!(grid[state_cells[1]], vm0(&[1]));
        assert_eq!(grid[state_cells[2]], vm0(&[1]));
    }

    // =========================================================================
    // enforceConsistency - gridCell fixed to 0 (v === ZERO)
    // =========================================================================

    #[test]
    fn v1_fixed_state_cell_excludes_from_others_3_state() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[3]); // fixed
        grid[state_cells[1]] = vm0(&[2, 3, 4]); // contains 3
        grid[state_cells[2]] = vm0(&[3, 5]); // contains 3

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[state_cells[1]],
            vm0(&[2, 4]),
            "s1 should have 3 removed"
        );
        assert_eq!(grid[state_cells[2]], vm0(&[5]), "s2 should have 3 removed");
    }

    #[test]
    fn v1_fixed_state_cell_excludes_from_others_2_state() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(2);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[5]);
        grid[state_cells[1]] = vm0(&[3, 5, 7]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[state_cells[1]], vm0(&[3, 7]));
    }

    #[test]
    fn v1_multiple_fixed_state_cells_exclude_from_each_other() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[3]); // fixed
        grid[state_cells[1]] = vm0(&[5]); // fixed
        grid[state_cells[2]] = vm0(&[3, 5, 7]); // contains both

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[state_cells[2]],
            vm0(&[7]),
            "s2 should have 3 and 5 removed"
        );
    }

    #[test]
    fn v1_returns_false_when_exclusion_empties_cell() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(2);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[3]);
        grid[state_cells[1]] = vm0(&[3]); // same, will be emptied

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn v1_no_change_when_fixed_cells_already_differ() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[1]);
        grid[state_cells[1]] = vm0(&[2]);
        grid[state_cells[2]] = vm0(&[3]);

        let s0_before = grid[state_cells[0]];
        let s1_before = grid[state_cells[1]];
        let s2_before = grid[state_cells[2]];

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[state_cells[0]], s0_before);
        assert_eq!(grid[state_cells[1]], s1_before);
        assert_eq!(grid[state_cells[2]], s2_before);
    }

    #[test]
    fn v1_no_change_when_no_state_cell_is_fixed() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[1, 2]);
        grid[state_cells[1]] = vm0(&[1, 2]);
        grid[state_cells[2]] = vm0(&[1, 2]);

        let s0_before = grid[state_cells[0]];
        let s1_before = grid[state_cells[1]];
        let s2_before = grid[state_cells[2]];

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[state_cells[0]], s0_before);
        assert_eq!(grid[state_cells[1]], s1_before);
        assert_eq!(grid[state_cells[2]], s2_before);
    }

    #[test]
    fn v1_fixed_cell_does_not_exclude_nonoverlapping() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[3]);
        grid[state_cells[1]] = vm0(&[4, 5]);
        grid[state_cells[2]] = vm0(&[6, 7]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[state_cells[1]], vm0(&[4, 5]));
        assert_eq!(grid[state_cells[2]], vm0(&[6, 7]));
    }

    // =========================================================================
    // enforceConsistency - gridCell might be 0 (conflict check)
    // =========================================================================

    #[test]
    fn conflict_removes_0_when_two_state_cells_same_fixed_s0_s1() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1, 2]);
        grid[state_cells[0]] = vm0(&[5]);
        grid[state_cells[1]] = vm0(&[5]); // same as s0
        grid[state_cells[2]] = vm0(&[7]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert!(
            !grid[grid_cell].intersects(ZERO),
            "0 should be removed from gridCell"
        );
    }

    #[test]
    fn conflict_removes_0_when_s0_equals_s2() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1]);
        grid[state_cells[0]] = vm0(&[3]);
        grid[state_cells[1]] = vm0(&[4]);
        grid[state_cells[2]] = vm0(&[3]); // same as s0

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert!(!grid[grid_cell].intersects(ZERO));
    }

    #[test]
    fn conflict_removes_0_when_s1_equals_s2() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1]);
        grid[state_cells[0]] = vm0(&[2]);
        grid[state_cells[1]] = vm0(&[6]);
        grid[state_cells[2]] = vm0(&[6]); // same as s1

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert!(!grid[grid_cell].intersects(ZERO));
    }

    #[test]
    fn conflict_returns_false_when_grid_cell_only_0_and_conflict() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        // gridCell === ZERO enters pairwise branch; s0 == s1 → s1 emptied → false.
        grid[grid_cell] = ZERO;
        grid[state_cells[0]] = vm0(&[5]);
        grid[state_cells[1]] = vm0(&[5]);
        grid[state_cells[2]] = vm0(&[7]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn conflict_no_change_when_no_state_cell_fixed() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1, 2]);
        grid[state_cells[0]] = vm0(&[3, 4]);
        grid[state_cells[1]] = vm0(&[3, 4]);
        grid[state_cells[2]] = vm0(&[3, 4]);

        let before = grid[grid_cell];
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[grid_cell], before, "gridCell should not change");
    }

    #[test]
    fn conflict_no_change_when_all_distinct() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(3);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1]);
        grid[state_cells[0]] = vm0(&[3]);
        grid[state_cells[1]] = vm0(&[4]);
        grid[state_cells[2]] = vm0(&[5]);

        let before = grid[grid_cell];
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[grid_cell], before);
    }

    #[test]
    fn conflict_2_state_cells_removes_0_on_conflict() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(2);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1]);
        grid[state_cells[0]] = vm0(&[4]);
        grid[state_cells[1]] = vm0(&[4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert!(!grid[grid_cell].intersects(ZERO));
    }

    #[test]
    fn conflict_2_state_cells_no_conflict_when_distinct() {
        let (mut handler, mut grid, shape, grid_cell, state_cells) = make_context(2);
        init_handler(&mut handler, &mut grid, shape);

        grid[grid_cell] = vm0(&[0, 1]);
        grid[state_cells[0]] = vm0(&[4]);
        grid[state_cells[1]] = vm0(&[5]);

        let before = grid[grid_cell];
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[grid_cell], before);
    }
}
