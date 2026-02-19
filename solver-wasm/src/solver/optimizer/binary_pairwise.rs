//! Binary pairwise optimizer phase.

use super::OptimizerCtx;
use crate::handlers::{BinaryConstraint, BinaryPairwise, ConstraintHandler};
use crate::solver::handler_set::HandlerSet;

/// Replace 2-cell BinaryPairwise handlers with BinaryConstraint.
///
/// Mirrors JS `_optimizeBinaryPairwise`.
pub(super) fn optimize_binary_pairwise(hs: &mut HandlerSet, ctx: &mut OptimizerCtx) {
    let bp_data: Vec<(usize, String, Vec<crate::api::types::CellIndex>)> = hs
        .get_all_of_type::<BinaryPairwise>()
        .iter()
        .map(|&(idx, h)| (idx, h.key().to_string(), h.cells().to_vec()))
        .collect();

    for (idx, key, cells) in bp_data {
        if cells.len() != 2 {
            continue;
        }
        // Validate to preserve behaviour.
        if let Some(h) = hs.get(idx) {
            if let Some(bp) = h.as_any().downcast_ref::<BinaryPairwise>() {
                let _ = bp.validate(hs.shape.num_values);
            }
        }
        let new_handler = BinaryConstraint::from_key(cells[0], cells[1], key, hs.shape.num_values);
        ctx.log_replace("_optimizeBinaryPairwise", &new_handler, None);
        hs.replace(idx, Box::new(new_handler));
    }
}
