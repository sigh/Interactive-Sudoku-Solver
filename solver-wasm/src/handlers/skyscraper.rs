//! Skyscraper constraint handler.
//!
//! Mirrors JS `Skyscraper` (handlers.js ~L1187).

use std::cell::RefCell;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// Skyscraper
// ============================================================================

/// Visibility DP constraint: exactly `num_visible` buildings can be seen
/// from the start of the cell sequence (taller ones hide shorter ones).
///
/// Mirrors JS `Skyscraper`.
pub struct Skyscraper {
    cells: Vec<CellIndex>,
    num_visible: usize,
    /// Bitmask of valid max-heights for the terminal cell:
    /// bits (num_cells-1)..(num_values-1) set.
    terminal_mask: u16,
    /// Number of values in the grid.
    num_values: usize,
    /// For 0-based values: bit mask for internal value 1 (external 0).
    /// External 0 doesn't count as visible.
    zero_mask: u16,
    /// Scratch buffer of size `num_cells * 2 * num_visible`.
    /// Layout: forward states occupy [0 .. num_cells*num_visible),
    /// backward states occupy [num_cells*num_visible .. 2*num_cells*num_visible).
    /// forward[i][j] = states[i * num_visible + j]
    /// backward[i][j] = states[num_cells*num_visible + i*num_visible + j]
    states: RefCell<Vec<u16>>,
}

impl Skyscraper {
    pub fn new(cells: Vec<CellIndex>, num_visible: usize) -> Self {
        Skyscraper {
            cells,
            num_visible,
            terminal_mask: 0,
            num_values: 0,
            zero_mask: 0,
            states: RefCell::new(Vec::new()),
        }
    }
}

impl ConstraintHandler for Skyscraper {
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
        let num_values = shape.num_values as usize;
        let num_cells = self.cells.len();

        // Can't see more buildings than there are cells.
        if self.num_visible > num_cells {
            return false;
        }

        self.num_values = num_values;
        self.zero_mask = if shape.value_offset < 0 { 1 } else { 0 };

        // Terminal mask: max height must be at least num_cells (the minimum
        // possible maximum value with num_cells distinct values from 1..numValues).
        // terminal_mask = (1 << num_values) - (1 << (num_cells - 1))
        // JS uses signed 32-bit arithmetic here; when num_cells > num_values
        // the result is negative, which effectively disables the constraint.
        // We match JS semantics with wrapping arithmetic + u16 truncation.
        self.terminal_mask =
            ((1i32 << num_values).wrapping_sub(1i32 << (num_cells - 1))) as u16;

        // Allocate the combined forward+backward scratch buffer.
        let buf_size = num_cells * 2 * self.num_visible;
        *self.states.borrow_mut() = vec![0u16; buf_size];

        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let target = self.num_visible;
        let num_cells = cells.len();
        let num_values = self.num_values;

        // Bitmask for the maximum value (e.g., 9 in a 9x9 grid).
        let max_value_raw: u16 = 1 << (num_values - 1);
        let zero_mask = self.zero_mask;

        let mut states = self.states.borrow_mut();
        // Clear both halves.
        states.fill(0);

        // ── Forward pass ──────────────────────────────────────────────────
        // forwardStates[i][j] = set of valid "current max heights" when
        // exactly j buildings are visible up to and including cell i.
        //
        // states[i * target + j] = forward[i][j]
        // states[num_cells*target + i*target + j] = backward[i][j]

        // Seed: all values of cell 0 are valid for visibility = 1.
        // With 0-based values, external 0 (internal 1) doesn't count as visible.
        states[0] = grid[cells[0] as usize].raw() & !zero_mask;
        let first_cell_zero = grid[cells[0] as usize].raw() & zero_mask;

        let mut last_max_height_index = num_cells - 1;

        for i in 1..num_cells {
            let v = grid[cells[i] as usize].raw();
            let low_v = v & v.wrapping_neg();
            // Mask of values strictly higher than the minimum value in v.
            // JS: `-(v & -v) << 1` (32-bit); Rust u16 equivalent:
            let higher_than_min_v = low_v.wrapping_neg().wrapping_shl(1);

            let prev_base = (i - 1) * target;
            let curr_base = i * target;

            // j = 0: only Case 1 (hidden) applies.
            states[curr_base] = states[prev_base] & higher_than_min_v;
            // If the first cell could be zero, cell 1 can start the sequence.
            if first_cell_zero != 0 && i == 1 {
                states[curr_base] |= v & !zero_mask;
            }

            let j_max = i.min(target - 1);
            for j in 1..=j_max {
                // Case 1: cells[i] is hidden — visibility stays the same.
                let mut new_state = states[prev_base + j] & higher_than_min_v;

                // Case 2: cells[i] is visible — visibility increments.
                let s = states[prev_base + j - 1];
                let low_s = s & s.wrapping_neg();
                let higher_than_min_s = low_s.wrapping_neg().wrapping_shl(1);
                new_state |= v & higher_than_min_s;

                states[curr_base + j] = new_state;
            }

            if v == max_value_raw {
                last_max_height_index = i;
                break;
            }
        }

        // Anything after the first max-value cell can't also be the max value.
        for i in (last_max_height_index + 1)..num_cells {
            let c = cells[i] as usize;
            if grid[c].raw() & max_value_raw != 0 {
                let new_v = grid[c].raw() & !max_value_raw;
                if new_v == 0 {
                    return false;
                }
                grid[c] = CandidateSet::from_raw(new_v);
                // Note: no addForCell here, matching JS Skyscraper behaviour.
            }
        }

        // ── Terminal state ────────────────────────────────────────────────
        let terminal_state =
            states[last_max_height_index * target + target - 1] & self.terminal_mask;
        if terminal_state == 0 {
            return false;
        }

        let bwd_off = num_cells * target;
        states[bwd_off + last_max_height_index * target + target - 1] = terminal_state;

        // ── Backward pass ─────────────────────────────────────────────────
        for i in (1..=last_max_height_index).rev() {
            let old_base = (i - 1) * target;
            let cur_bwd_base = bwd_off + i * target;
            let new_bwd_base = bwd_off + (i - 1) * target;

            let mut value_mask = 0u16;

            for j in 0..target {
                let current_state = states[cur_bwd_base + j];
                if current_state == 0 {
                    continue;
                }

                // Case 1: cells[i] is hidden.
                {
                    let valid_states = states[old_base + j] & current_state;
                    if valid_states != 0 {
                        states[new_bwd_base + j] |= valid_states;
                        let max_s = CandidateSet::from_raw(valid_states).max_value();
                        // Values strictly below max_s: (1 << (max_s - 1)) - 1
                        value_mask |= (1u16 << (max_s - 1)).wrapping_sub(1);
                    }
                }

                // Case 2: cells[i] is visible (j > 0).
                if j > 0 {
                    let visible_state = current_state & grid[cells[i] as usize].raw();
                    if visible_state != 0 {
                        let max_s = CandidateSet::from_raw(visible_state).max_value();
                        // Previous states: old[j-1] & values strictly below max_s.
                        let below_max_s = (1u16 << (max_s - 1)).wrapping_sub(1);
                        let valid_states = states[old_base + j - 1] & below_max_s;
                        if valid_states != 0 {
                            states[new_bwd_base + j - 1] |= valid_states;
                            value_mask |= visible_state;
                        }
                    }
                }
            }

            // Apply the computed value mask to cells[i].
            // Note: no addForCell, matching JS Skyscraper behaviour.

            // If the first cell could be zero, cell 1's backward-validated
            // values are valid as the first visible building.
            if first_cell_zero != 0 && i == 1 {
                value_mask |= states[bwd_off + target] & grid[cells[1] as usize].raw();
            }

            let c = cells[i] as usize;
            let new_v = grid[c].raw() & value_mask;
            if new_v == 0 {
                return false;
            }
            grid[c] = CandidateSet::from_raw(new_v);
        }

        // The first cell is valid for exactly those values where backward[0][0] is set.
        // If the first cell can be zero, preserve that candidate.
        let back_0_0 = states[bwd_off];
        let c0 = cells[0] as usize;
        let new_v = grid[c0].raw() & (back_0_0 | first_cell_zero);
        if new_v == 0 {
            return false;
        }
        grid[c0] = CandidateSet::from_raw(new_v);

        true
    }

    fn name(&self) -> &'static str {
        "Skyscraper"
    }

    fn id_str(&self) -> String {
        format!("Skyscraper-{}-{:?}", self.num_visible, self.cells)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn skyscraper_init_valid_visibility() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        assert!(init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn skyscraper_fail_init_visibility_gt_num_cells() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 5);
        let (mut grid, shape) = make_grid(1, 4, None);
        assert!(!init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn skyscraper_allow_visibility_eq_num_cells() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 4);
        let (mut grid, shape) = make_grid(1, 4, None);
        assert!(init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn skyscraper_visibility_1_requires_max_in_first_cell() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        for i in 0..4 {
            grid[i] = vm(&[1, 2, 3, 4]);
        }
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[0],
            vm(&[4]),
            "first cell should be forced to max value"
        );
    }

    #[test]
    fn skyscraper_visibility_n_requires_ascending() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 4);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        for i in 0..4 {
            grid[i] = vm(&[1, 2, 3, 4]);
        }
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[1]));
        assert_eq!(grid[1], vm(&[2]));
        assert_eq!(grid[2], vm(&[3]));
        assert_eq!(grid[3], vm(&[4]));
    }

    #[test]
    fn skyscraper_visibility_2_constrain() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3]);
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_forward_pass_visibility_tracking() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]);
        grid[1] = vm(&[1]);
        grid[2] = vm(&[2]);
        grid[3] = vm(&[4]);
        let mut a = acc();
        assert!(
            handler.enforce_consistency(&mut grid, &mut a),
            "[3,1,2,4] should give visibility 2"
        );
    }

    #[test]
    fn skyscraper_fail_when_visibility_cannot_be_achieved() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 3);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[4]);
        grid[1] = vm(&[1, 2, 3]);
        grid[2] = vm(&[1, 2, 3]);
        grid[3] = vm(&[1, 2, 3]);
        let mut a = acc();
        assert!(
            !handler.enforce_consistency(&mut grid, &mut a),
            "should fail when max is first but visibility=3 required"
        );
    }

    #[test]
    fn skyscraper_backward_pass_prune() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3]);
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_remove_max_from_cells_after_first_max() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3]);
        grid[1] = vm(&[4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[1, 2, 3, 4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[2].raw() & vm(&[4]).raw(),
            0,
            "cell 2 should not have 4"
        );
        assert_eq!(
            grid[3].raw() & vm(&[4]).raw(),
            0,
            "cell 3 should not have 4"
        );
    }

    #[test]
    fn skyscraper_short_row_init() {
        let cells: Vec<CellIndex> = (0..6).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 6, Some(9));
        assert!(init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn skyscraper_short_row_terminal_height_eq_num_cells() {
        let cells: Vec<CellIndex> = (0..6).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 6, Some(9));
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[5]);
        grid[1] = vm(&[1]);
        grid[2] = vm(&[2]);
        grid[3] = vm(&[3]);
        grid[4] = vm(&[4]);
        grid[5] = vm(&[6]);
        let mut a = acc();
        assert!(
            handler.enforce_consistency(&mut grid, &mut a),
            "should accept terminal height 6 when numCells=6"
        );
    }

    #[test]
    fn skyscraper_short_row_terminal_height_gt_num_cells() {
        let cells: Vec<CellIndex> = (0..6).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 6, Some(9));
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[5]);
        grid[1] = vm(&[1]);
        grid[2] = vm(&[2]);
        grid[3] = vm(&[3]);
        grid[4] = vm(&[4]);
        grid[5] = vm(&[9]);
        let mut a = acc();
        assert!(
            handler.enforce_consistency(&mut grid, &mut a),
            "should accept terminal height 9 when numCells=6"
        );
    }

    #[test]
    fn skyscraper_short_row_visibility_1_first_cell_ge_num_cells() {
        let cells: Vec<CellIndex> = (0..6).collect();
        let mut handler = Skyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 6, Some(9));
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[0],
            vm(&[6, 7, 8, 9]),
            "first cell should only have values >= numCells"
        );
    }

    #[test]
    fn skyscraper_long_row_init() {
        // 12 cells but only values 1-9
        let cells: Vec<CellIndex> = (0..12).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(3, 4, Some(9));
        assert!(init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn skyscraper_single_cell_visibility_1() {
        let cells: Vec<CellIndex> = vec![0];
        let mut handler = Skyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 1, Some(4));
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_two_cells_visibility_1() {
        let cells: Vec<CellIndex> = (0..2).collect();
        let mut handler = Skyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 2, Some(4));
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[0],
            vm(&[2, 3, 4]),
            "first cell should have values >= numCells"
        );
    }

    #[test]
    fn skyscraper_two_cells_visibility_2() {
        let cells: Vec<CellIndex> = (0..2).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 2, Some(4));
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[1, 2, 3]), "first cell should be 1,2,3");
        assert_eq!(
            grid[1],
            vm(&[2, 3, 4]),
            "second cell should be >= 2 (numCells)"
        );
    }

    #[test]
    fn skyscraper_fail_empty_cell() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = CandidateSet::EMPTY;
        let mut a = acc();
        assert!(
            !handler.enforce_consistency(&mut grid, &mut a),
            "should fail when a cell is empty"
        );
    }

    #[test]
    fn skyscraper_prune_visibility_1() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        handler.enforce_consistency(&mut grid, &mut a);
        assert_eq!(grid[0], vm(&[4]), "first cell should be forced to 4");
        assert_eq!(
            grid[1].raw() & vm(&[4]).raw(),
            0,
            "cell 1 should not have 4"
        );
        assert_eq!(
            grid[2].raw() & vm(&[4]).raw(),
            0,
            "cell 2 should not have 4"
        );
        assert_eq!(
            grid[3].raw() & vm(&[4]).raw(),
            0,
            "cell 3 should not have 4"
        );
    }

    #[test]
    fn skyscraper_validate_2_4_1_3_visibility_2() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[4]);
        grid[2] = vm(&[1]);
        grid[3] = vm(&[3]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_validate_1_2_3_4_visibility_4() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 4);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[3]);
        grid[3] = vm(&[4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_reject_1_2_3_4_for_visibility_3() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 3);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[3]);
        grid[3] = vm(&[4]);
        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_validate_3_2_4_1_visibility_2() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[4]);
        grid[3] = vm(&[1]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn skyscraper_9x9_visibility_1_forces_first_to_9() {
        let cells: Vec<CellIndex> = (0..9).collect();
        let mut handler = Skyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 9, None);
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[0], vm(&[9]));
    }

    #[test]
    fn skyscraper_9x9_visibility_9_forces_ascending() {
        let cells: Vec<CellIndex> = (0..9).collect();
        let mut handler = Skyscraper::new(cells, 9);
        let (mut grid, shape) = make_grid(1, 9, None);
        init(&mut handler, &mut grid, shape);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        for i in 0..9 {
            assert_eq!(
                grid[i],
                vm(&[i as u8 + 1]),
                "cell {} should be {}",
                i,
                i + 1
            );
        }
    }

    #[test]
    fn skyscraper_idempotent() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = Skyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3]);
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[4]);

        handler.enforce_consistency(&mut grid, &mut acc());
        let after1: Vec<CandidateSet> = grid.to_vec();

        handler.enforce_consistency(&mut grid, &mut acc());
        let after2: Vec<CandidateSet> = grid.to_vec();

        assert_eq!(after1, after2, "second call should not change grid");
    }

    // =====================================================================
    // Offset (0-indexed) tests (ported from JS tests/handlers/skyscraper.test.js)
    // =====================================================================

    #[test]
    fn offset_vis1_zero_in_first_cell_allowed() {
        // 0-indexed 4x4: internal 1-4, offset=-1.
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 1);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[1, 2, 3, 4]);

        assert!(enforce(&handler, &mut grid));
        // Both max value and zero should be allowed in first cell.
        assert!(grid[0].intersects(CandidateSet::from_value(4)),
                "first cell should allow max value");
        assert!(grid[0].intersects(CandidateSet::from_value(1)),
                "first cell should allow zero (internal 1)");
    }

    #[test]
    fn offset_vis4_with_zero_impossible_in_4_cells() {
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 4);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]); // zero (external 0)
        grid[1] = vm(&[2, 3, 4]);
        grid[2] = vm(&[2, 3, 4]);
        grid[3] = vm(&[2, 3, 4]);

        assert!(!enforce(&handler, &mut grid),
                "zero first + vis=4 impossible in 4 cells");
    }

    #[test]
    fn offset_zero_first_cell_vis3_succeeds() {
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 3);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]); // zero — not visible
        grid[1] = vm(&[2]); // ext 1 — visible
        grid[2] = vm(&[3]); // ext 2 — visible
        grid[3] = vm(&[4]); // ext 3 — visible

        assert!(enforce(&handler, &mut grid), "[0,1,2,3] should give visibility 3");
    }

    #[test]
    fn offset_zero_first_vis4_should_fail() {
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 4);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]); // zero
        grid[1] = vm(&[2]);
        grid[2] = vm(&[3]);
        grid[3] = vm(&[4]);

        assert!(!enforce(&handler, &mut grid), "[0,1,2,3] has only 3 visible, not 4");
    }

    #[test]
    fn offset_zero_in_non_first_cell_no_effect() {
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 1);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[4]); // ext 3, visible
        grid[1] = vm(&[1]); // ext 0, hidden
        grid[2] = vm(&[2]); // ext 1, hidden
        grid[3] = vm(&[3]); // ext 2, hidden

        assert!(enforce(&handler, &mut grid), "[3,0,1,2] should give visibility 1");
    }

    #[test]
    fn offset_propagation_zero_candidate_first_cell() {
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 2);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 3]); // ext 0 or 2
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[1, 2, 3, 4]);

        assert!(enforce(&handler, &mut grid));
        assert!(grid[0].intersects(CandidateSet::from_value(1)),
                "first cell should keep zero candidate");
        assert!(grid[0].intersects(CandidateSet::from_value(3)),
                "first cell should keep non-zero candidate");
    }

    #[test]
    fn offset_0_unchanged_behavior() {
        // Standard 1-indexed, vis=4 forces ascending 1,2,3,4.
        let (mut grid, shape) = make_grid(1, 4, None);
        let mut handler = Skyscraper::new(vec![0, 1, 2, 3], 4);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2, 3, 4]);
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[1, 2, 3, 4]);

        assert!(enforce(&handler, &mut grid));
        assert_eq!(grid[0], vm(&[1]));
        assert_eq!(grid[1], vm(&[2]));
        assert_eq!(grid[2], vm(&[3]));
        assert_eq!(grid[3], vm(&[4]));
    }
}
