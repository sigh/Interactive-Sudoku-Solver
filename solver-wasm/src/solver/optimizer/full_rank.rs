//! FullRank optimizer phase.

use std::collections::HashSet;

use super::OptimizerCtx;
use crate::handlers::{BinaryConstraint, ConstraintHandler, FullRank, RankClue, TieMode, True};
use crate::solver::handler_set::HandlerSet;

/// Merge FullRank handlers, deduplicate clue ranks, create BinaryConstraints
/// for duplicate-rank entries.
///
/// Mirrors JS `_optimizeFullRank`.
pub(super) fn optimize_full_rank(hs: &mut HandlerSet, ctx: &mut OptimizerCtx) {
    let rank_info: Vec<(usize, Vec<RankClue>, TieMode)> = hs
        .get_all_of_type::<FullRank>()
        .iter()
        .map(|&(idx, h)| (idx, h.clues().to_vec(), h.tie_mode()))
        .collect();

    if rank_info.is_empty() {
        return;
    }

    let entries = FullRank::build_entries(hs.shape);
    let equals_key = ctx.equals_key.clone();

    // Collect all clues and determine min tie mode.
    let mut all_clues = Vec::new();
    let mut tie_mode = TieMode::Any;
    for (idx, clues, tm) in &rank_info {
        all_clues.extend_from_slice(clues);
        tie_mode = tie_mode.min(*tm);
        // Replace original handler with True.
        let true_handler = True;
        hs.replace(*idx, Box::new(true_handler));
    }

    // Dedupe clues by rank. For duplicates, create BinaryConstraint equals.
    let mut deduped_clues: Vec<RankClue> = Vec::new();
    let mut seen_ranks: HashSet<u32> = HashSet::new();

    for clue in &all_clues {
        if !seen_ranks.contains(&clue.rank) {
            seen_ranks.insert(clue.rank);
            deduped_clues.push(clue.clone());
            continue;
        }

        // Duplicate rank — find the existing clue and create equals constraints.
        for existing in &deduped_clues {
            if clue.rank != existing.rank {
                continue;
            }

            let a_entry = FullRank::entry_from_clue(&entries, clue);
            let b_entry = FullRank::entry_from_clue(&entries, existing);
            if let (Some(a_idx), Some(b_idx)) = (a_entry, b_entry) {
                let a_cells = &entries[a_idx];
                let b_cells = &entries[b_idx];
                for j in 0..a_cells.len().min(b_cells.len()) {
                    if a_cells[j] == b_cells[j] {
                        continue;
                    }
                    let eq = BinaryConstraint::from_key(
                        a_cells[j],
                        b_cells[j],
                        equals_key.clone(),
                        hs.shape.num_values,
                    );
                    ctx.log_add_handler("_optimizeFullRank", &eq, None, false);
                    hs.add_essential(Box::new(eq));
                }
            }
            break;
        }
    }

    // Create the merged FullRank handler.
    let handler = FullRank::new(hs.shape.num_cells, deduped_clues, tie_mode);
    ctx.log(
        "_optimizeFullRank",
        format!("Combine: FullRank"),
        None,
        handler.cells().to_vec(),
    );
    hs.add_essential(Box::new(handler));
}
