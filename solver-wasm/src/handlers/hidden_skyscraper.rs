//! HiddenSkyscraper constraint handler.
//!
//! The first "hidden" skyscraper constraint: the `first_hidden_value`
//! must be the first value in the sequence that is hidden (obscured by
//! a taller building before it).
//!
//! Mirrors JS `HiddenSkyscraper` (handlers.js ~L1367).

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

pub struct HiddenSkyscraper {
    cells: Vec<CellIndex>,
    /// The raw external hidden value (before offset conversion).
    first_hidden_value: u8,
    /// The target value bitmask (single bit for the hidden value).
    target_v: CandidateSet,
}

impl HiddenSkyscraper {
    pub fn new(cells: Vec<CellIndex>, first_hidden_value: u8) -> Self {
        HiddenSkyscraper {
            cells,
            first_hidden_value,
            target_v: CandidateSet::EMPTY,
        }
    }
}

impl ConstraintHandler for HiddenSkyscraper {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.target_v = CandidateSet::from_offset_value(
            self.first_hidden_value as i32,
            shape.value_offset,
        );
        // The first cell is always visible, so it can never be the hidden value.
        // Mirrors JS: `if (!(initialGridCells[this.cells[0]] &= ~this._targetV)) return false;`
        let c0 = self.cells[0] as usize;
        let new_v = initial_grid[c0] & !self.target_v;
        if new_v.is_empty() {
            return false;
        }
        initial_grid[c0] = new_v;
        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();
        let target_v = self.target_v;
        let target_raw = target_v.raw();

        // Mask of values strictly higher than target_v.
        // JS: `const moreThanTarget = -targetV << 1`
        let more_than_target = target_raw.wrapping_neg().wrapping_shl(1);

        // The first cell is always visible.
        let mut allowed_skyscrapers = grid[cells[0] as usize].raw();
        let mut i = 1usize;
        let mut first_target_index = 0usize;

        while i < num_cells {
            let cell = cells[i];
            let mut v = grid[cell as usize].raw();

            // Mask of values strictly above the minimum of allowedSkyscrapers.
            let low_allowed = allowed_skyscrapers & allowed_skyscrapers.wrapping_neg();
            let allowed_mask = low_allowed.wrapping_neg().wrapping_shl(1);

            if first_target_index == 0 {
                // Haven't found the target yet.
                if v & target_raw != 0 {
                    if allowed_skyscrapers & more_than_target != 0 {
                        // Target is valid at this position.
                        first_target_index = i;
                    } else {
                        // Can't place target here — remove it.
                        v &= !target_raw;
                    }
                }
                // Only allow values higher than the current max, plus the target.
                v &= allowed_mask | target_raw;
            }

            if grid[cell as usize].raw() != v {
                if v == 0 {
                    return false;
                }
                grid[cell as usize] = CandidateSet::from_raw(v);
                acc.add_for_cell(cell);
            }

            // Update allowed skyscrapers: non-target values higher than the current max.
            allowed_skyscrapers = v & !target_raw & allowed_mask;

            if allowed_skyscrapers == 0 {
                break;
            }
            i += 1;
        }

        // If we never found a valid position for the target, fail.
        if first_target_index == 0 {
            return false;
        }

        // Clear the target from all cells after first_target_index.
        let mut k = i + 1;
        while k < num_cells {
            let cell = cells[k];
            if grid[cell as usize].raw() & target_raw != 0 {
                let new_v = grid[cell as usize].raw() & !target_raw;
                if new_v == 0 {
                    return false;
                }
                grid[cell as usize] = CandidateSet::from_raw(new_v);
                acc.add_for_cell(cell);
            }
            k += 1;
        }

        // Backward pass: filter out early values that grow too fast to allow
        // the target to be reachable. JS sets `allowedSkyscrapers = -1`
        // (all bits set) which in Rust u16 is u16::MAX, meaning all values
        // are allowed from the end.
        let mut allowed_skyscrapers: u16 = u16::MAX;
        let mut j = first_target_index as isize - 1;
        while j >= 0 {
            let v = grid[cells[j as usize] as usize].raw();
            let new_v = v & allowed_skyscrapers;
            if new_v != v {
                if new_v == 0 {
                    return false;
                }
                grid[cells[j as usize] as usize] = CandidateSet::from_raw(new_v);
                acc.add_for_cell(cells[j as usize]);
            }
            // Next allowed: all values strictly below max(new_v).
            // JS: `(1 << (LookupTables.maxValue(newV) - 1)) - 1`
            let max_v = CandidateSet::from_raw(new_v).max_value();
            allowed_skyscrapers = (1u16 << (max_v - 1)).wrapping_sub(1);
            j -= 1;
        }

        true
    }

    fn name(&self) -> &'static str {
        "HiddenSkyscraper"
    }

    fn id_str(&self) -> String {
        format!(
            "HiddenSkyscraper-{}-{:?}",
            self.first_hidden_value,
            self.cells
        )
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
    fn hidden_skyscraper_remove_target_from_first_cell_on_init() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = HiddenSkyscraper::new(cells, 3);
        let (mut grid, shape) = make_grid(1, 4, None);
        assert!(init(&mut handler, &mut grid, shape));
        assert_eq!(
            grid[0],
            vm(&[1, 2, 4]),
            "first cell should not contain target value 3"
        );
    }

    #[test]
    fn hidden_skyscraper_fail_init_if_first_cell_only_has_target() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = HiddenSkyscraper::new(cells, 3);
        let (mut grid, shape) = make_grid(1, 4, None);
        grid[0] = vm(&[3]);
        assert!(!init(&mut handler, &mut grid, shape));
    }

    #[test]
    fn hidden_skyscraper_allow_target_when_can_be_hidden() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = HiddenSkyscraper::new(cells, 3);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[4]);
        let mut a = acc();
        assert!(
            handler.enforce_consistency(&mut grid, &mut a),
            "should pass when 3 can be hidden behind 4"
        );
    }

    #[test]
    fn hidden_skyscraper_remove_target_where_cannot_be_hidden() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = HiddenSkyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]);           // first cell is 1, so 2 can be hidden by > 2
        grid[1] = vm(&[2, 3]);        // 2 here can be hidden (1 < 3)
        grid[2] = vm(&[2, 4]);
        grid[3] = vm(&[1, 2, 3, 4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn hidden_skyscraper_remove_target_after_first_valid_position() {
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = HiddenSkyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 4, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[2, 4]);
        grid[3] = vm(&[1, 2, 4]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(
            grid[2].raw() & vm(&[2]).raw(),
            0,
            "cell 2 should not contain 2"
        );
        assert_eq!(
            grid[3].raw() & vm(&[2]).raw(),
            0,
            "cell 3 should not contain 2"
        );
    }

    #[test]
    fn hidden_skyscraper_backward_pass_filter() {
        let cells: Vec<CellIndex> = (0..5).collect();
        let mut handler = HiddenSkyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 5, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3, 4, 5]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[1, 3, 4, 5]);
        grid[3] = vm(&[1, 3, 4, 5]);
        grid[4] = vm(&[1, 3, 4, 5]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn hidden_skyscraper_short_row() {
        let cells: Vec<CellIndex> = (0..6).collect();
        let mut handler = HiddenSkyscraper::new(cells, 4);
        let (mut grid, shape) = make_grid(1, 6, Some(8));
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[5, 6, 7, 8]);
        grid[1] = vm(&[4]);
        let mut a = acc();
        assert!(
            handler.enforce_consistency(&mut grid, &mut a),
            "should work on rectangular grid"
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
    fn hidden_skyscraper_long_row() {
        let cells: Vec<CellIndex> = (0..10).collect();
        let mut handler = HiddenSkyscraper::new(cells, 3);
        let (mut grid, shape) = make_grid(2, 5, Some(6));
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[4, 5, 6]);
        grid[1] = vm(&[3]);
        let mut a = acc();
        assert!(
            handler.enforce_consistency(&mut grid, &mut a),
            "should work with more cells than values"
        );
        for i in 2..10 {
            assert_eq!(
                grid[i].raw() & vm(&[3]).raw(),
                0,
                "cell {} should not have 3",
                i
            );
        }
    }

    #[test]
    fn hidden_skyscraper_minimum_valid_scenario() {
        let cells: Vec<CellIndex> = (0..2).collect();
        let mut handler = HiddenSkyscraper::new(cells, 1);
        let (mut grid, shape) = make_grid(1, 2, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[1, 2]);
        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[1], vm(&[1]), "1 must be in cell 1");
    }

    #[test]
    fn hidden_skyscraper_fail_when_target_cannot_be_placed() {
        let cells: Vec<CellIndex> = (0..3).collect();
        let mut handler = HiddenSkyscraper::new(cells, 2);
        let (mut grid, shape) = make_grid(1, 3, None);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[1, 3]);
        grid[2] = vm(&[1, 3]);
        let mut a = acc();
        assert!(
            !handler.enforce_consistency(&mut grid, &mut a),
            "should fail when 2 cannot be hidden"
        );
    }

    // =====================================================================
    // Offset (0-indexed) tests (ported from JS hidden_skyscraper.test.js)
    // =====================================================================

    #[test]
    fn offset_external_1_maps_to_internal_2() {
        // External firstHidden=1, offset=-1 → internal 2.
        let (mut grid, shape) = make_grid_offset(1, 4, 4, -1);
        let cells: Vec<CellIndex> = (0..4).collect();
        let mut handler = HiddenSkyscraper::new(cells, 1); // external value 1
        init(&mut handler, &mut grid, shape);

        // First cell should not contain internal 2 (the target).
        assert_eq!(
            grid[0] & CandidateSet::from_value(2),
            CandidateSet::EMPTY,
            "first cell should not contain the target (internal 2)"
        );
        assert_eq!(grid[0], vm(&[1, 3, 4]));
    }

    #[test]
    fn offset_enforce_consistency_works_with_offset() {
        // External firstHidden=0, offset=-1 → internal 1.
        let (mut grid, shape) = make_grid_offset(1, 3, 3, -1);
        let cells: Vec<CellIndex> = (0..3).collect();
        let mut handler = HiddenSkyscraper::new(cells, 0); // external value 0
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[3]); // Internal 3: > internal 1, hides it
        grid[1] = vm(&[1]); // Internal 1 is here and hidden
        grid[2] = vm(&[1, 2, 3]);

        assert!(enforce(&handler, &mut grid));
        // Internal 1 should be cleared from cell 2 (after first hidden found).
        assert_eq!(
            grid[2] & CandidateSet::from_value(1),
            CandidateSet::EMPTY,
            "cell 2 should not have internal 1"
        );
    }
}
