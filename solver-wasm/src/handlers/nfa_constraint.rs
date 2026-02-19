//! NFA constraint handler — forward/backward pass enforcement.
//!
//! Mirrors JS `NFAConstraint` from `nfa_handler.js`.
//!
//! The handler enforces a linear regex/NFA constraint by propagating
//! reachable states forward then pruning unsupported values backward.
//! Uses the compressed NFA format where transition entries pack
//! `(target_state << 16) | symbol_mask` into `u32` values.

use std::cell::RefCell;

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::nfa::CompressedNfa;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

/// NFA constraint handler.
///
/// Enforces a compiled NFA (regex or state-machine) against a linear sequence
/// of cells via forward/backward pass over candidate sets.
pub struct NfaConstraint {
    cells: Vec<CellIndex>,
    cnfa: CompressedNfa,
    /// Per-step bitset of reachable NFA states (interior-mutable scratch space).
    /// `states_words[step * words_per_set .. (step+1) * words_per_set]`.
    states_words: RefCell<Vec<u32>>,
    /// Number of u32 words per state bitset.
    words_per_set: usize,
}



impl NfaConstraint {
    pub fn new(cells: Vec<CellIndex>, cnfa: CompressedNfa) -> Self {
        let num_states = cnfa.num_states;
        let words_per_set = (num_states + 31) / 32;
        let num_slots = cells.len() + 1;
        let states_words = vec![0u32; num_slots * words_per_set];
        Self {
            cells,
            cnfa,
            states_words: RefCell::new(states_words),
            words_per_set,
        }
    }

    /// Get the compressed NFA (for optimizer inspection).
    pub fn get_nfa(&self) -> &CompressedNfa {
        &self.cnfa
    }

    // ================================================================
    // Scratch buffer access (interior mutability via RefCell)
    // ================================================================

    /// Get a mutable reference to the scratch buffer.
    ///
    /// Called from `enforce_consistency`, which runs single-threaded.
    /// The buffer is reset at the start of each call.
    #[inline]
    fn scratch(&self) -> std::cell::RefMut<'_, Vec<u32>> {
        self.states_words.borrow_mut()
    }
}

impl ConstraintHandler for NfaConstraint {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let num_cells = self.cells.len();
        let wps = self.words_per_set;
        let mut sw = self.scratch();

        // Clear all state bitsets.
        sw.fill(0);

        // ================================================================
        // Forward pass: find all states reachable from start.
        // ================================================================

        // Copy starting states into step 0.
        for w in 0..wps {
            sw[w] = self.cnfa.starting_states.words()[w];
        }

        for i in 0..num_cells {
            let cell = self.cells[i];
            let values = grid[cell as usize].raw();
            let step_start = i * wps;
            let next_step_start = (i + 1) * wps;

            for word_idx in 0..wps {
                let mut word = sw[step_start + word_idx];
                while word != 0 {
                    let lowest_bit = word & word.wrapping_neg();
                    word ^= lowest_bit;
                    let state_idx = word_idx * 32 + lowest_bit.trailing_zeros() as usize;

                    let transitions = self.cnfa.transitions(state_idx);
                    for &entry in transitions {
                        // Low 16 bits = symbol mask, high 16 bits = target state.
                        if (values as u32) & entry != 0 {
                            let target = (entry >> 16) as usize;
                            sw[next_step_start + target / 32] |=
                                1 << (target % 32);
                        }
                    }
                }
            }

            // Check if step i+1 is empty.
            if sw[next_step_start..next_step_start + wps].iter().all(|&w| w == 0) {
                return false;
            }
        }

        // ================================================================
        // Backward pass: prune unsupported values.
        // ================================================================

        // Intersect final step with accepting states.
        let final_start = num_cells * wps;
        for w in 0..wps {
            sw[final_start + w] &= self.cnfa.accepting_states.words()[w];
        }
        if sw[final_start..final_start + wps].iter().all(|&w| w == 0) {
            return false;
        }

        for i in (0..num_cells).rev() {
            let cell = self.cells[i];
            let values = grid[cell as usize].raw();
            let mut supported_values = 0u16;
            let step_start = i * wps;
            let next_step_start = (i + 1) * wps;

            for word_idx in 0..wps {
                let mut word = sw[step_start + word_idx];
                let mut kept_word = 0u32;

                while word != 0 {
                    let lowest_bit = word & word.wrapping_neg();
                    word ^= lowest_bit;
                    let state_idx = word_idx * 32 + lowest_bit.trailing_zeros() as usize;

                    let transitions = self.cnfa.transitions(state_idx);
                    let mut state_supported = 0u16;

                    for &entry in transitions {
                        let masked = (values as u32) & entry;
                        if masked != 0 {
                            let target = (entry >> 16) as usize;
                            // Check if target is set in next step.
                            if (sw[next_step_start + target / 32] & (1 << (target % 32))) != 0 {
                                state_supported |= masked as u16;
                            }
                        }
                    }

                    if state_supported != 0 {
                        kept_word |= lowest_bit;
                        supported_values |= state_supported;
                    }
                }

                sw[step_start + word_idx] = kept_word;
            }

            if supported_values == 0 {
                return false;
            }

            if values != supported_values {
                grid[cell as usize] = CandidateSet::from_raw(supported_values);
                acc.add_for_cell(cell);
            }
        }

        true
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        true
    }

    fn name(&self) -> &'static str {
        "NFAConstraint"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nfa::{compress_nfa, regex_to_nfa};

    /// Helper: build an NFA constraint from a regex and cells.
    fn make_handler(pattern: &str, num_values: u8, cells: Vec<CellIndex>) -> NfaConstraint {
        let mut nfa = regex_to_nfa(pattern, num_values).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        NfaConstraint::new(cells, cnfa)
    }

    #[test]
    fn test_nfa_literal_enforces() {
        // Pattern "123" on 3 cells. Only (1,2,3) should survive.
        let handler = make_handler("123", 9, vec![0, 1, 2]);
        let all = CandidateSet::from_raw(0x1FF); // values 1-9
        let mut grid = vec![all; 3];
        let mut acc = HandlerAccumulator::new_stub();

        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], CandidateSet::from_raw(1 << 0)); // value 1
        assert_eq!(grid[1], CandidateSet::from_raw(1 << 1)); // value 2
        assert_eq!(grid[2], CandidateSet::from_raw(1 << 2)); // value 3
    }

    #[test]
    fn test_nfa_alternation() {
        // Pattern "1|2" on 1 cell. Values 1 and 2 should survive.
        let handler = make_handler("1|2", 9, vec![0]);
        let all = CandidateSet::from_raw(0x1FF);
        let mut grid = vec![all; 1];
        let mut acc = HandlerAccumulator::new_stub();

        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], CandidateSet::from_raw((1 << 0) | (1 << 1))); // 1 or 2
    }

    #[test]
    fn test_nfa_contradiction() {
        // Pattern "123" on 3 cells, but cell 0 can only be 5.
        let handler = make_handler("123", 9, vec![0, 1, 2]);
        let all = CandidateSet::from_raw(0x1FF);
        let mut grid = vec![all; 3];
        grid[0] = CandidateSet::from_raw(1 << 4); // only value 5
        let mut acc = HandlerAccumulator::new_stub();

        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn test_nfa_wildcard() {
        // Pattern ".2." — middle cell must be 2, outer cells can be anything.
        let handler = make_handler(".2.", 9, vec![0, 1, 2]);
        let all = CandidateSet::from_raw(0x1FF);
        let mut grid = vec![all; 3];
        let mut acc = HandlerAccumulator::new_stub();

        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], all); // wildcard: all values
        assert_eq!(grid[1], CandidateSet::from_raw(1 << 1)); // must be 2
        assert_eq!(grid[2], all); // wildcard: all values
    }
}
