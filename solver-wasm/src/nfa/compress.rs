//! Compressed NFA for fast constraint propagation.
//!
//! Mirrors JS `compressNFA` from `nfa_handler.js` and the `CompressedNFA`
//! class. Packs transition entries into `u32` values:
//! `[state: upper 16 bits | mask: lower 16 bits]`.

use super::Nfa;
use crate::bit_set::BitSet;

/// Compressed NFA optimized for fast constraint propagation.
///
/// Each transition entry is a `u32`: `(target_state << 16) | symbol_mask`.
/// The low 16 bits can be directly AND-tested against a `CandidateSet`'s
/// raw `u16` value to check for matching symbols in one operation.
pub struct CompressedNfa {
    pub num_states: usize,
    /// Bit `i` set ⇔ state `i` is accepting.
    pub accepting_states: BitSet,
    /// Bit `i` set ⇔ state `i` is a start state.
    pub starting_states: BitSet,
    /// Per-state transition lists. Each entry is `(target_state << 16) | mask`.
    /// All lists are slices into `transition_backing`.
    pub transition_offsets: Vec<(usize, usize)>, // (start, len) into transition_backing
    /// Single backing array for all transition entries (memory locality).
    pub transition_backing: Vec<u32>,
}

impl CompressedNfa {
    /// Get the transition list for a state.
    #[inline]
    pub fn transitions(&self, state: usize) -> &[u32] {
        let (start, len) = self.transition_offsets[state];
        &self.transition_backing[start..start + len]
    }

    /// Check if a state is accepting.
    #[inline]
    #[allow(dead_code)]
    pub fn is_accepting(&self, state: usize) -> bool {
        self.accepting_states.has(state)
    }

    /// Check if a state is a start state.
    #[inline]
    #[allow(dead_code)]
    pub fn is_start(&self, state: usize) -> bool {
        self.starting_states.has(state)
    }
}

/// Build a transition entry: `(target_state << 16) | symbol_mask`.
#[inline]
fn make_transition_entry(mask: u16, state: u16) -> u32 {
    ((state as u32) << 16) | (mask as u32)
}

/// Compress an NFA into the solver-internal format.
///
/// The NFA is sealed and epsilon-closed before compression.
/// Each (state, symbol) transition is grouped by target state, with symbol
/// masks OR'd together, producing one `u32` entry per unique target.
///
/// Mirrors JS `compressNFA()` from `nfa_handler.js`.
pub fn compress_nfa(nfa: &mut Nfa) -> CompressedNfa {
    nfa.seal();
    nfa.close_over_epsilon_transitions();

    let num_states = nfa.num_states();
    assert!(
        num_states <= (1 << 16),
        "NFA has too many states to represent ({} > {})",
        num_states,
        1 << 16
    );

    let mut accepting_states = BitSet::with_capacity(num_states);
    let mut starting_states = BitSet::with_capacity(num_states);

    for &id in nfa.start_ids() {
        starting_states.add(id);
    }

    // Build per-state transition lists.
    let mut all_raw: Vec<Vec<u32>> = Vec::with_capacity(num_states);
    let mut total_transitions = 0;

    for state_id in 0..num_states {
        if nfa.is_accepting(state_id) {
            accepting_states.add(state_id);
        }

        let state_trans = nfa.state_transitions(state_id);

        // Group transitions by target state, combining symbol masks.
        // Use a small vec since most states have few targets.
        let mut target_masks: Vec<(usize, u16)> = Vec::new();

        for (sym_idx, targets) in state_trans.iter().enumerate() {
            if targets.is_empty() {
                continue;
            }
            let mask = 1u16 << sym_idx;
            for &target in targets {
                if let Some(entry) = target_masks.iter_mut().find(|(t, _)| *t == target) {
                    entry.1 |= mask;
                } else {
                    target_masks.push((target, mask));
                }
            }
        }

        let entries: Vec<u32> = target_masks
            .iter()
            .map(|&(target, mask)| make_transition_entry(mask, target as u16))
            .collect();
        total_transitions += entries.len();
        all_raw.push(entries);
    }

    // Flatten into a single backing array.
    let mut transition_backing = Vec::with_capacity(total_transitions);
    let mut transition_offsets = Vec::with_capacity(num_states);

    for raw_list in &all_raw {
        let start = transition_backing.len();
        transition_backing.extend_from_slice(raw_list);
        transition_offsets.push((start, raw_list.len()));
    }

    CompressedNfa {
        num_states,
        accepting_states,
        starting_states,
        transition_offsets,
        transition_backing,
    }
}
