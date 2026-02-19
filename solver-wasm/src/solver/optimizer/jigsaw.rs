//! Jigsaw-related optimizer phases.
//!
//! - `optimize_jigsaw`: Jigsaw intersections and law of leftover.

use super::util::{general_region_overlap_processor, overlap_regions};
use super::{OptimizerCtx, MAX_SUM_SIZE};
use crate::api::types::CellIndex;
use crate::handlers::{ConstraintHandler, House, JigsawPiece, SameValuesIgnoreCount};
use crate::solver::handler_set::HandlerSet;

/// Jigsaw optimizations: house intersections + law of leftover.
///
/// Mirrors JS `_optimizeJigsaw`.
pub(super) fn optimize_jigsaw(
    hs: &mut HandlerSet,
    box_regions: &[Vec<CellIndex>],
    ctx: &mut OptimizerCtx,
) {
    let jigsaw_data: Vec<Vec<CellIndex>> = hs
        .get_all_of_type::<JigsawPiece>()
        .iter()
        .map(|&(_, h)| h.cells().to_vec())
        .collect();
    if jigsaw_data.is_empty() {
        return;
    }

    // Jigsaw intersections.
    make_jigsaw_intersections(hs, ctx);

    // Law of leftover.
    make_jigsaw_law_of_leftover(hs, &jigsaw_data, box_regions, ctx);
}

/// SameValuesIgnoreCount for overlapping jigsaw houses.
///
/// Mirrors JS `_makeJigsawIntersections`.
fn make_jigsaw_intersections(hs: &mut HandlerSet, ctx: &mut OptimizerCtx) {
    let house_data: Vec<Vec<CellIndex>> = hs
        .get_all_of_type::<House>()
        .iter()
        .map(|&(_, h)| h.cells().to_vec())
        .collect();

    for h0 in &house_data {
        for h1 in &house_data {
            if std::ptr::eq(h0, h1) {
                continue;
            }

            let diff0: Vec<CellIndex> = h0.iter().copied().filter(|c| !h1.contains(c)).collect();
            if diff0.is_empty() || diff0.len() > MAX_SUM_SIZE || diff0.len() == h0.len() - 1 {
                continue;
            }

            let diff1: Vec<CellIndex> = h1.iter().copied().filter(|c| !h0.contains(c)).collect();

            let handler = SameValuesIgnoreCount::new(vec![diff0, diff1]);
            ctx.log_add_handler("_makeJigsawIntersections", &handler, None, false);
            hs.add_non_essential(Box::new(handler));
        }
    }
}

/// Law of leftover: overlay jigsaw pieces on region groups.
///
/// Mirrors JS `_makeJigsawLawOfLeftoverHandlers`.
fn make_jigsaw_law_of_leftover(
    hs: &mut HandlerSet,
    jigsaw_pieces: &[Vec<CellIndex>],
    box_regions: &[Vec<CellIndex>],
    ctx: &mut OptimizerCtx,
) {
    let num_values = hs.shape.num_values as usize;
    let regions = overlap_regions(hs.shape, box_regions);

    for region_group in &regions {
        let pieces_with_dummy: Vec<(Vec<CellIndex>, i32)> =
            jigsaw_pieces.iter().map(|p| (p.clone(), 0i32)).collect();

        general_region_overlap_processor(
            region_group,
            &pieces_with_dummy,
            num_values,
            |super_region, pieces_region, _used_pieces| {
                if super_region.len() != pieces_region.len() {
                    return;
                }

                let diff_a: Vec<CellIndex> =
                    super_region.difference(pieces_region).copied().collect();
                if diff_a.is_empty() {
                    return;
                }
                let diff_b: Vec<CellIndex> =
                    pieces_region.difference(super_region).copied().collect();
                if diff_a.len() >= num_values {
                    return;
                }

                let handler = SameValuesIgnoreCount::new(vec![
                    diff_a.iter().copied().collect(),
                    diff_b.iter().copied().collect(),
                ]);
                ctx.log_add_handler("_makeJigsawLawOfLeftoverHandlers", &handler, None, false);
                hs.add_non_essential(Box::new(handler));
            },
        );
    }
}
