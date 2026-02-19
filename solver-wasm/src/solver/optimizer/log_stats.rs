//! NFA statistics logging phase.

use super::OptimizerCtx;
use crate::handlers::nfa_constraint::NfaConstraint;
use crate::handlers::ConstraintHandler;
use crate::solver::handler_set::HandlerSet;

/// Log NFA constraint statistics.
///
/// Mirrors JS `_logStats`. For each NFA handler, counts the number of
/// states and transition entries, and detects whether the automaton is
/// a DFA (no state has overlapping symbol masks across transitions).
pub(super) fn log_stats(hs: &mut HandlerSet, ctx: &mut OptimizerCtx) {
    let mask: u32 = (1 << 16) - 1;

    let nfa_data: Vec<(Vec<crate::api::types::CellIndex>, usize, usize, bool)> = hs
        .get_all_of_type::<NfaConstraint>()
        .iter()
        .map(|&(_, h)| {
            let cnfa = h.get_nfa();
            let mut num_transition_entries = 0usize;
            let mut is_dfa = true;
            for state_idx in 0..cnfa.num_states {
                let transitions = cnfa.transitions(state_idx);
                num_transition_entries += transitions.len();
                let mut seen = 0u32;
                for &t in transitions {
                    if (t & mask & seen) != 0 {
                        is_dfa = false;
                    }
                    seen |= t & mask;
                }
            }
            (
                h.cells().to_vec(),
                cnfa.num_states,
                num_transition_entries,
                is_dfa,
            )
        })
        .collect();

    for (cells, num_states, num_entries, is_dfa) in nfa_data {
        let state_type = if is_dfa { " (DFA)" } else { "" };
        ctx.log(
            "_logStats",
            format!(
                "NFAConstraint with {} states, {} transition entries{}",
                num_states, num_entries, state_type
            ),
            None,
            cells,
        );
    }
}
