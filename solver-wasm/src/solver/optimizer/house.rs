//! House-related optimizer phases.
//!
//! - `add_house_handlers`: Promote AllDifferent to House.
//! - `add_house_intersections`: Box-line intersection constraints.
//! - `add_extra_cell_exclusions`: Share exclusions for equal-value cells.

use super::OptimizerCtx;
use crate::api::types::CellIndex;
use crate::handlers::{
    AllDifferent, BinaryConstraint, BinaryPairwise, ConstraintHandler, House, SameValuesIgnoreCount,
};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::handler_set::HandlerSet;

/// Promote 9-cell AllDifferent constraints to House constraints.
///
/// Mirrors JS `_addHouseHandlers`.
pub(super) fn add_house_handlers(hs: &mut HandlerSet, ctx: &mut OptimizerCtx) {
    let ad_indices: Vec<(usize, Vec<CellIndex>)> = hs
        .get_all_of_type::<AllDifferent>()
        .iter()
        .filter_map(|&(idx, _ad)| {
            let excl = hs.get(idx)?.exclusion_cells();
            if excl.len() == hs.shape.num_values as usize {
                Some((idx, excl.to_vec()))
            } else {
                None
            }
        })
        .collect();

    for (_, cells) in ad_indices {
        let handler = House::new(cells);
        ctx.log_add_handler("_addHouseHandlers", &handler, None, false);
        hs.add_non_essential(Box::new(handler));
    }
}

/// Add SameValuesIgnoreCount for house intersections.
///
/// For each pair of House handlers with a box-sized intersection
/// (3 cells for standard 9×9), the cells in the symmetric difference
/// must contain the same set of values.
///
/// This implements box-line reduction / pointing pairs.
///
/// Mirrors JS `_addHouseIntersections`.
pub(super) fn add_house_intersections(
    hs: &mut HandlerSet,
    box_regions: &[Vec<CellIndex>],
    ctx: &mut OptimizerCtx,
) {
    // Intersections are not useful without boxes.
    if box_regions.is_empty() {
        return;
    }
    let box_size = box_regions[0].len();
    // If boxes aren't houses, intersections won't help.
    if box_size != hs.shape.num_values as usize {
        return;
    }

    let house_data: Vec<(usize, Vec<CellIndex>)> = hs
        .get_all_of_type::<House>()
        .iter()
        .map(|&(idx, h)| (idx, h.cells().to_vec()))
        .collect();

    // Use box dimensions from shape.
    let (box_height, box_width) = match hs.shape.box_dims {
        Some((bh, bw)) => (bh as usize, bw as usize),
        None => return,
    };

    let num_handlers = house_data.len();
    for i in 1..num_handlers {
        for j in 0..i {
            let cells_i = &house_data[i].1;
            let cells_j = &house_data[j].1;

            let intersection_size = cells_i.iter().filter(|c| cells_j.contains(c)).count();

            if intersection_size != box_width && intersection_size != box_height {
                continue;
            }

            let diff_i: Vec<CellIndex> = cells_i
                .iter()
                .copied()
                .filter(|c| !cells_j.contains(c))
                .collect();
            let diff_j: Vec<CellIndex> = cells_j
                .iter()
                .copied()
                .filter(|c| !cells_i.contains(c))
                .collect();

            let handler = SameValuesIgnoreCount::new(vec![diff_i, diff_j]);
            ctx.log_add_handler("_addHouseIntersections", &handler, None, true);
            hs.add_aux(Box::new(handler));
        }
    }
}

/// If two cells must have the same value (BinaryConstraint/BinaryPairwise
/// with equals key), share their cell exclusions.
///
/// Mirrors JS `_addExtraCellExclusions`.
pub(super) fn add_extra_cell_exclusions(
    hs: &mut HandlerSet,
    cell_exclusions: &mut CellExclusions,
    ctx: &mut OptimizerCtx,
) {
    let equals_key = &ctx.equals_key;

    // BinaryConstraint handlers.
    let bc_data: Vec<(String, Vec<CellIndex>)> = hs
        .get_all_of_type::<BinaryConstraint>()
        .iter()
        .map(|&(_, h)| (h.key().to_string(), h.cells().to_vec()))
        .collect();
    for (key, cells) in &bc_data {
        if key != equals_key {
            continue;
        }
        for i in 1..cells.len() {
            for j in 0..i {
                cell_exclusions.share_exclusions(cells[i], cells[j]);
            }
        }
    }

    // BinaryPairwise handlers.
    let bp_data: Vec<(String, Vec<CellIndex>)> = hs
        .get_all_of_type::<BinaryPairwise>()
        .iter()
        .map(|&(_, h)| (h.key().to_string(), h.cells().to_vec()))
        .collect();
    for (key, cells) in &bp_data {
        if key != equals_key {
            continue;
        }
        for i in 1..cells.len() {
            for j in 0..i {
                cell_exclusions.share_exclusions(cells[i], cells[j]);
            }
        }
    }
}
