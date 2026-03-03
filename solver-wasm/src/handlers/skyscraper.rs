//! Skyscraper and HiddenSkyscraper constraint handlers.
//!
//! Mirrors JS `Skyscraper` and `HiddenSkyscraper` (handlers.js ~L1187, ~L1367).

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

        // Terminal mask: max height must be at least num_cells (the minimum
        // possible maximum value with num_cells distinct values from 1..numValues).
        // terminal_mask = (1 << num_values) - (1 << (num_cells - 1))
        self.terminal_mask =
            ((1u32 << num_values) - (1u32 << (num_cells - 1))) as u16;

        // Allocate the combined forward+backward scratch buffer.
        let buf_size = num_cells * 2 * self.num_visible;
        *self.states.borrow_mut() = vec![0u16; buf_size];

        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], _acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let target = self.num_visible;
        let num_cells = cells.len();
        let num_values = self.num_values;

        // Bitmask for the maximum value (e.g., 9 in a 9x9 grid).
        let max_value_raw: u16 = 1 << (num_values - 1);

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
        states[0] = grid[cells[0] as usize].raw();

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
            let c = cells[i] as usize;
            let new_v = grid[c].raw() & value_mask;
            if new_v == 0 {
                return false;
            }
            grid[c] = CandidateSet::from_raw(new_v);
        }

        // The first cell is valid for exactly those values where backward[0][0] is set.
        let back_0_0 = states[bwd_off];
        let c0 = cells[0] as usize;
        let new_v = grid[c0].raw() & back_0_0;
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
// HiddenSkyscraper
// ============================================================================

/// The first "hidden" skyscraper constraint: the `first_hidden_value`
/// must be the first value in the sequence that is hidden (obscured by
/// a taller building before it).
///
/// Mirrors JS `HiddenSkyscraper`.
pub struct HiddenSkyscraper {
    cells: Vec<CellIndex>,
    /// The target value bitmask (single bit for the hidden value).
    target_v: CandidateSet,
}

impl HiddenSkyscraper {
    pub fn new(cells: Vec<CellIndex>, first_hidden_value: u8) -> Self {
        HiddenSkyscraper {
            cells,
            target_v: CandidateSet::from_value(first_hidden_value),
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
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
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
            self.target_v.min_value(),
            self.cells
        )
    }
}
