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

    fn vm(values: &[u8]) -> CandidateSet {
        let mut raw: u16 = 0;
        for &v in values {
            raw |= 1 << (v - 1);
        }
        CandidateSet::from_raw(raw)
    }

    // =========================================================================
    // compressNFA tests
    // =========================================================================

    #[test]
    fn compress_nfa_preserve_transitions_and_states() {
        let mut nfa = regex_to_nfa("(1|2)3", 3).unwrap();
        let cnfa = compress_nfa(&mut nfa);

        // Find starting state.
        let start = (0..cnfa.num_states)
            .find(|&i| cnfa.starting_states.has(i))
            .expect("should have a starting state");

        let get_next = |state: usize, value: u8| -> Vec<usize> {
            let mask = vm(&[value]).raw();
            cnfa.transitions(state)
                .iter()
                .filter(|&&e| (e as u16) & mask != 0)
                .map(|&e| (e >> 16) as usize)
                .collect::<Vec<_>>()
        };

        let states_after_1 = get_next(start, 1);
        let states_after_2 = get_next(start, 2);
        assert!(!states_after_1.is_empty(), "1 should transition from start");
        assert!(!states_after_2.is_empty(), "2 should transition from start");
        assert!(get_next(start, 3).is_empty(), "3 is not valid from start");

        // Follow path to accepting.
        let accepting_states = get_next(states_after_1[0], 3);
        assert!(!accepting_states.is_empty(), "3 should transition after 1");
        assert!(cnfa.accepting_states.has(accepting_states[0]));
    }

    #[test]
    fn compress_nfa_track_starting_states() {
        let mut nfa = regex_to_nfa("12", 2).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        let start_count = (0..cnfa.num_states)
            .filter(|&i| cnfa.starting_states.has(i))
            .count();
        assert!(start_count >= 1);
    }

    #[test]
    fn compress_nfa_track_accepting_states() {
        let mut nfa = regex_to_nfa("12", 2).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        let accept_count = (0..cnfa.num_states)
            .filter(|&i| cnfa.accepting_states.has(i))
            .count();
        assert!(accept_count >= 1);
    }

    #[test]
    fn compress_nfa_combine_symbol_masks() {
        let mut nfa = regex_to_nfa("[12]", 2).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        let start = (0..cnfa.num_states)
            .find(|&i| cnfa.starting_states.has(i))
            .unwrap();
        let transitions = cnfa.transitions(start);
        assert_eq!(transitions.len(), 1, "should combine into single transition");
        let entry_mask = transitions[0] as u16;
        assert_eq!(entry_mask, vm(&[1, 2]).raw());
    }

    #[test]
    fn compress_nfa_compact_entry_format() {
        let mut nfa = regex_to_nfa("12", 2).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        let start = (0..cnfa.num_states)
            .find(|&i| cnfa.starting_states.has(i))
            .unwrap();
        let transitions = cnfa.transitions(start);
        let entry = transitions[0];
        let entry_mask = entry as u16;
        let target_state = (entry >> 16) as usize;
        assert!(entry_mask > 0, "mask should be non-zero");
        assert!(target_state < cnfa.num_states, "target state should be valid");
    }

    // =========================================================================
    // Basic enforcement tests
    // =========================================================================

    #[test]
    fn nfa_prune_cells_to_supported_values() {
        let handler = make_handler("12", 4, vec![0, 1]);
        let all = vm(&[1, 2, 3, 4]);
        let mut grid = vec![all, all];
        let mut acc = HandlerAccumulator::new_stub();

        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], vm(&[1]));
        assert_eq!(grid[1], vm(&[2]));
    }

    #[test]
    fn nfa_return_false_no_valid_path() {
        let handler = make_handler("12", 4, vec![0, 1]);
        let mut grid = vec![vm(&[2]), vm(&[2])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn nfa_no_touch_already_supported() {
        let handler = make_handler("12", 4, vec![0, 1]);
        let mut grid = vec![vm(&[1]), vm(&[2])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        // No cells should have been modified (already at supported values).
        // We verify by checking the grid didn't change.
        assert_eq!(grid[0], vm(&[1]));
        assert_eq!(grid[1], vm(&[2]));
    }

    #[test]
    fn nfa_report_only_changed_cells() {
        let handler = make_handler("12", 4, vec![0, 1]);
        let all = vm(&[1, 2, 3, 4]);
        let mut grid = vec![vm(&[1]), all]; // cell 0 already constrained
        let mut acc = HandlerAccumulator::new_stub();
        handler.enforce_consistency(&mut grid, &mut acc);
        // Only cell 1 was pruned.
        assert_eq!(grid[1], vm(&[2]));
    }

    // =========================================================================
    // Forward pass tests
    // =========================================================================

    #[test]
    fn forward_fail_first_cell_no_valid_transition() {
        let handler = make_handler("12", 2, vec![0, 1]);
        let mut grid = vec![vm(&[2]), vm(&[1, 2])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn forward_fail_middle_cell_blocks_path() {
        let handler = make_handler("123", 3, vec![0, 1, 2]);
        let mut grid = vec![vm(&[1]), vm(&[3]), vm(&[1, 2, 3])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn forward_track_reachable_states_through_alternation() {
        let handler = make_handler("(12|13)", 3, vec![0, 1]);
        let mut grid = vec![vm(&[1]), vm(&[2, 3])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[1], vm(&[2, 3]));
    }

    // =========================================================================
    // Backward pass tests
    // =========================================================================

    #[test]
    fn backward_fail_final_states_not_accepting() {
        let handler = make_handler("123", 3, vec![0, 1, 2]);
        let mut grid = vec![vm(&[1]), vm(&[2]), vm(&[1])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn backward_prune_values_not_reaching_accepting() {
        let handler = make_handler("(12|34)", 4, vec![0, 1]);
        let mut grid = vec![vm(&[1, 3]), vm(&[2])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], vm(&[1]));
    }

    #[test]
    fn backward_prune_unreachable_states() {
        let handler = make_handler("1[23]", 3, vec![0, 1]);
        let mut grid = vec![vm(&[1, 2, 3]), vm(&[2])];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], vm(&[1]));
    }

    // =========================================================================
    // Cell configurations tests
    // =========================================================================

    #[test]
    fn nfa_non_contiguous_cell_indices() {
        let handler = make_handler("12", 4, vec![5, 10]);
        let all = vm(&[1, 2, 3, 4]);
        let mut grid = vec![all; 15];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[5], vm(&[1]));
        assert_eq!(grid[10], vm(&[2]));
        assert_eq!(grid[0], all); // untouched
    }

    #[test]
    fn nfa_single_cell() {
        let handler = make_handler("[12]", 4, vec![0]);
        let all = vm(&[1, 2, 3, 4]);
        let mut grid = vec![all];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], vm(&[1, 2]));
    }

    #[test]
    fn nfa_longer_cell_sequences() {
        let handler = make_handler("1234", 4, vec![0, 1, 2, 3]);
        let all = vm(&[1, 2, 3, 4]);
        let mut grid = vec![all; 4];
        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));
        assert_eq!(grid[0], vm(&[1]));
        assert_eq!(grid[1], vm(&[2]));
        assert_eq!(grid[2], vm(&[3]));
        assert_eq!(grid[3], vm(&[4]));
    }

    // =========================================================================
    // State reuse tests
    // =========================================================================

    #[test]
    fn nfa_reusable_across_multiple_calls() {
        let handler = make_handler("12", 4, vec![0, 1]);
        let all = vm(&[1, 2, 3, 4]);

        // Call 1: success.
        let mut grid1 = vec![all, all];
        assert!(handler.enforce_consistency(&mut grid1, &mut HandlerAccumulator::new_stub()));
        assert_eq!(grid1[0], vm(&[1]));

        // Call 2: success with different grid.
        let mut grid2 = vec![vm(&[1, 2]), vm(&[2, 3])];
        assert!(handler.enforce_consistency(&mut grid2, &mut HandlerAccumulator::new_stub()));
        assert_eq!(grid2[0], vm(&[1]));

        // Call 3: failure.
        let mut grid3 = vec![vm(&[2]), vm(&[2])];
        assert!(!handler.enforce_consistency(&mut grid3, &mut HandlerAccumulator::new_stub()));

        // Call 4: success after failure.
        let mut grid4 = vec![vm(&[1, 2]), vm(&[1, 2])];
        assert!(handler.enforce_consistency(&mut grid4, &mut HandlerAccumulator::new_stub()));
        assert_eq!(grid4[0], vm(&[1]));
    }

    #[test]
    fn nfa_internal_state_cleared_between_calls() {
        let handler = make_handler("(12|21)", 2, vec![0, 1]);

        let mut grid1 = vec![vm(&[1]), vm(&[2])];
        assert!(handler.enforce_consistency(&mut grid1, &mut HandlerAccumulator::new_stub()));

        let mut grid2 = vec![vm(&[2]), vm(&[1])];
        assert!(handler.enforce_consistency(&mut grid2, &mut HandlerAccumulator::new_stub()));
    }

    // =========================================================================
    // getNFA test
    // =========================================================================

    #[test]
    fn nfa_get_nfa_returns_compressed_nfa() {
        let mut nfa = regex_to_nfa("12", 4).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        let num_states = cnfa.num_states;
        let handler = NfaConstraint::new(vec![0, 1], cnfa);
        // Verify it returns the same NFA by checking num_states matches.
        assert_eq!(handler.get_nfa().num_states, num_states);
    }
}
