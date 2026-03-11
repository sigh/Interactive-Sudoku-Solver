//! Sum-related optimizer phases.
//!
//! Handles all sum constraint optimizations: non-overlapping subset
//! finding, innie/outie inference, hidden cages, combined sums,
//! size-specific replacements, and complement cells.

use std::collections::{BTreeMap, HashSet};

use super::util::{general_region_overlap_processor, overlap_regions};
use super::{OptimizerCtx, MAX_SUM_SIZE};
use crate::api::types::CellIndex;
use crate::bit_set::BitSet;
use crate::candidate_set::CandidateSet;
use crate::handlers::sum::Sum;
use crate::handlers::util::handler_util::{
    exclusion_group_sum_info as hu_exclusion_group_sum_info,
    find_exclusion_groups_greedy as hu_find_exclusion_groups_greedy,
};
use crate::handlers::{BinaryConstraint, ConstraintHandler, False, GivenCandidates, House, True};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::handler_set::HandlerSet;

/// Orchestrate all sum-related optimization passes.
///
/// Mirrors JS `_optimizeSums`.
pub(super) fn optimize_sums(
    hs: &mut HandlerSet,
    box_regions: &[Vec<CellIndex>],
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) {
    let all_sum_indices: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();

    if all_sum_indices.is_empty() {
        return;
    }

    // Filter to only unit-coefficient sums for most optimizations.
    let safe_sum_indices: Vec<usize> = all_sum_indices
        .iter()
        .copied()
        .filter(|&idx| {
            hs.get(idx)
                .and_then(|h| h.as_any().downcast_ref::<Sum>())
                .is_some_and(|s| s.only_unit_coeffs())
        })
        .collect();

    // Find non-overlapping subset.
    let (mut non_overlapping_indices, mut sum_cells) =
        find_non_overlapping_subset(&safe_sum_indices, hs);

    // Fill in gap (mutates non_overlapping_indices and sum_cells in-place).
    fill_in_sum_gap(&mut non_overlapping_indices, &mut sum_cells, hs, ctx);

    // Innie/outie sum handlers from region overlaps.
    let innie_outie = make_innie_outie_sum_handlers(&non_overlapping_indices, hs, box_regions, ctx);
    for h in innie_outie {
        hs.add_non_essential(h);
    }

    // Hidden cage handlers (complement sums and outies).
    let hidden = make_hidden_cage_handlers(hs, &safe_sum_indices, cell_exclusions, ctx);
    for h in hidden {
        hs.add_non_essential(h);
    }

    // Combined sum handlers (greedy merge).
    let combined = make_combined_sum_handlers(&safe_sum_indices, hs, cell_exclusions, ctx);
    for h in combined {
        hs.add_non_essential(h);
    }

    // Replace 1-cell and 2-cell sums with specialized handlers.
    replace_size_specific_sum_handlers(hs, cell_exclusions, ctx);

    // Add complement cells to remaining sum handlers.
    add_sum_complement_cells(hs);
}

/// Find a maximal non-overlapping subset of sum handlers.
///
/// Greedy bin-packing: sort by overlap count (ascending), pick handlers
/// whose cells don't conflict.
///
/// Mirrors JS `_findNonOverlappingSubset`.
pub(super) fn find_non_overlapping_subset(
    indices: &[usize],
    hs: &HandlerSet,
) -> (Vec<usize>, HashSet<CellIndex>) {
    // Count overlaps for each handler.
    let index_set: HashSet<usize> = indices.iter().copied().collect();

    let mut handlers_by_overlaps: Vec<(usize, usize)> = indices
        .iter()
        .map(|&idx| {
            let intersecting = hs.get_intersecting_indices(idx);
            let overlap_count = intersecting
                .iter()
                .filter(|i| index_set.contains(i))
                .count();
            (idx, overlap_count)
        })
        .collect();

    handlers_by_overlaps.sort_by_key(|&(_, count)| count);

    let mut cells_included: HashSet<CellIndex> = HashSet::new();
    let mut non_overlapping = Vec::new();

    for (idx, _) in handlers_by_overlaps {
        if let Some(h) = hs.get(idx) {
            if h.cells().iter().any(|c| cells_included.contains(c)) {
                continue;
            }
            for &c in h.cells() {
                cells_included.insert(c);
            }
            non_overlapping.push(idx);
        }
    }

    (non_overlapping, cells_included)
}

/// If there are uncovered cells after non-overlapping selection,
/// create a Sum handler for the remaining cells.
///
/// Mirrors JS `_fillInSumGap`. Mutates `non_overlapping` and `sum_cells`
/// in-place (JS: `sumHandlers.push(newHandler)` + `sumCells.add(c)`).
pub(super) fn fill_in_sum_gap(
    non_overlapping: &mut Vec<usize>,
    sum_cells: &mut HashSet<CellIndex>,
    hs: &mut HandlerSet,
    ctx: &mut OptimizerCtx,
) {
    let num_non_sum = hs.shape.num_cells - sum_cells.len();
    if num_non_sum == 0 || num_non_sum >= hs.shape.num_values as usize {
        return;
    }

    // Total sum of all non-overlapping handlers.
    let handlers_sum: i32 = non_overlapping
        .iter()
        .filter_map(|&idx| {
            hs.get(idx)
                .and_then(|h| h.as_any().downcast_ref::<Sum>())
                .map(|s| s.sum())
        })
        .sum();

    // 9 regions × 45 = 405 for standard 9×9.
    let num_regions = hs.shape.num_cells / hs.shape.num_values as usize;
    let remaining_sum = (num_regions as i32 * hs.shape.max_sum) - handlers_sum;

    let remaining_cells: Vec<CellIndex> = (0..hs.shape.num_cells as CellIndex)
        .filter(|c| !sum_cells.contains(c))
        .collect();

    for &c in &remaining_cells {
        sum_cells.insert(c);
    }

    let handler = Sum::new_cage(remaining_cells, remaining_sum);
    ctx.log_add_handler(
        "_fillInSumGap",
        &handler,
        Some(serde_json::json!({ "sum": remaining_sum })),
        false,
    );
    if let Some(idx) = hs.add_non_essential(Box::new(handler)) {
        non_overlapping.push(idx);
    }
}

/// Create innie/outie sum handlers from region overlap analysis.
///
/// For rows, columns, and boxes: accumulate consecutive regions into
/// a super-region, find sum pieces that overlap more than half, and
/// infer new sum constraints from the symmetric difference.
///
/// Mirrors JS `_makeInnieOutieSumHandlers`.
pub(super) fn make_innie_outie_sum_handlers(
    non_overlapping: &[usize],
    hs: &HandlerSet,
    box_regions: &[Vec<CellIndex>],
    ctx: &mut OptimizerCtx,
) -> Vec<Box<dyn ConstraintHandler>> {
    let mut new_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

    // Collect pieces: (cells, sum).
    let pieces: Vec<(Vec<CellIndex>, i32)> = non_overlapping
        .iter()
        .filter_map(|&idx| {
            hs.get(idx)
                .and_then(|h| h.as_any().downcast_ref::<Sum>())
                .map(|s| (s.cells_vec(), s.sum()))
        })
        .collect();

    let cells_in_sum: HashSet<CellIndex> =
        pieces.iter().flat_map(|(c, _)| c.iter().copied()).collect();

    let has_cells_without_sum =
        |cells: &HashSet<CellIndex>| -> bool { cells.iter().any(|c| !cells_in_sum.contains(c)) };

    // Get region groups: rows (forward/reverse), cols (forward/reverse), boxes.
    let regions = overlap_regions(hs.shape, box_regions);

    for region_group in &regions {
        general_region_overlap_processor(
            region_group,
            &pieces,
            hs.shape.num_values as usize,
            |super_region, pieces_region, used_pieces| {
                let diff_a: HashSet<CellIndex> =
                    super_region.difference(pieces_region).copied().collect();
                let diff_b: HashSet<CellIndex> =
                    pieces_region.difference(super_region).copied().collect();

                // No diff → no new constraint.
                if diff_a.is_empty() && diff_b.is_empty() {
                    return;
                }
                // Too large → not useful.
                if diff_a.len() + diff_b.len() > hs.shape.num_values as usize {
                    return;
                }
                // Can only handle negative coefficients when diff is small.
                if diff_a.len() > 2 && diff_b.len() > 2 {
                    return;
                }

                if !(has_cells_without_sum(&diff_a) || has_cells_without_sum(&diff_b))
                    && diff_a.len() + diff_b.len() > MAX_SUM_SIZE
                {
                    return;
                }

                let mut sum_delta: i32 =
                    -(super_region.len() as i32 * hs.shape.max_sum / hs.shape.num_values as i32);
                for (_cells, s) in used_pieces {
                    sum_delta += s;
                }

                // Ensure diff_a is smaller (or swap).
                let (small, big, sum_delta) = if diff_a.len() > diff_b.len() {
                    (diff_b, diff_a, -sum_delta)
                } else {
                    (diff_a, diff_b, sum_delta)
                };

                if small.is_empty() {
                    let mut cells: Vec<CellIndex> = big.into_iter().collect();
                    cells.sort();
                    let handler = Sum::new_cage(cells, sum_delta);
                    ctx.log_add_handler(
                        "_makeInnieOutieSumHandlers",
                        &handler,
                        Some(serde_json::json!({ "sum": sum_delta })),
                        false,
                    );
                    new_handlers.push(Box::new(handler));
                } else {
                    let mut cells: Vec<CellIndex> = big.into_iter().collect();
                    cells.sort();
                    let mut small_vec: Vec<CellIndex> = small.into_iter().collect();
                    small_vec.sort();
                    let big_len = cells.len();
                    cells.extend_from_slice(&small_vec);
                    let coeffs: Vec<i32> = cells
                        .iter()
                        .enumerate()
                        .map(|(i, _)| if i < big_len { 1 } else { -1 })
                        .collect();
                    let neg_cells: Vec<CellIndex> = small_vec;
                    let handler = Sum::new(cells, sum_delta, Some(coeffs));
                    ctx.log_add_handler(
                        "_makeInnieOutieSumHandlers",
                        &handler,
                        Some(serde_json::json!({
                            "sum": sum_delta,
                            "negativeCells": neg_cells,
                        })),
                        false,
                    );
                    new_handlers.push(Box::new(handler));
                }
            },
        );
    }

    new_handlers
}

/// Create hidden cage handlers (complement sums and outie sums).
///
/// For each House handler, finds sum constraints that overlap with it:
/// - Cages fully inside → create complement sum for remaining cells.
/// - Cages sticking out by 1 cell → create outie sum with negative
///   coefficient.
/// - Cages partially overlapping → create sum intersection handler.
///
/// Mirrors JS `_makeHiddenCageHandlers`.
fn make_hidden_cage_handlers(
    hs: &mut HandlerSet,
    safe_sum_indices: &[usize],
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) -> Vec<Box<dyn ConstraintHandler>> {
    let mut new_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

    // Get all House handler indices and cells.
    let house_data: Vec<(usize, Vec<CellIndex>)> = hs
        .get_all_of_type::<House>()
        .iter()
        .map(|&(idx, h)| (idx, h.cells().to_vec()))
        .collect();

    let sum_index_set: HashSet<usize> = safe_sum_indices.iter().copied().collect();

    for &(house_idx, ref house_cells) in &house_data {
        let house_set: HashSet<CellIndex> = house_cells.iter().copied().collect();

        // Find sum handlers that intersect with this house.
        let intersecting = hs.get_intersecting_indices(house_idx);
        let current_sum_indices: Vec<usize> = intersecting
            .iter()
            .copied()
            .filter(|i| sum_index_set.contains(i))
            .collect();

        if current_sum_indices.is_empty() {
            continue;
        }

        // Find non-overlapping subset among these sum handlers.
        let (filtered_indices, _) = find_non_overlapping_subset(&current_sum_indices, hs);

        // Sum intersection handler.
        if let Some(handler) = add_sum_intersection_handler(
            hs,
            house_idx,
            &filtered_indices,
            &intersecting,
            &house_data,
            cell_exclusions,
            ctx,
        ) {
            new_handlers.push(handler);
        }

        // Classify handlers: fully inside vs outies.
        let mut constrained_cells: Vec<CellIndex> = Vec::new();
        let mut constrained_sum: i32 = 0;
        let mut outies: Vec<usize> = Vec::new();

        for &idx in &filtered_indices {
            if let Some(h) = hs.get(idx) {
                if let Some(sum_h) = h.as_any().downcast_ref::<Sum>() {
                    let handler_cells = sum_h.cells_vec();
                    let overlap_size = handler_cells
                        .iter()
                        .filter(|c| house_set.contains(c))
                        .count();

                    if overlap_size == handler_cells.len() {
                        // Fully inside.
                        constrained_cells.extend_from_slice(&handler_cells);
                        constrained_sum += sum_h.sum();

                        // Also set complement cells on this handler.
                        let complement: Vec<CellIndex> = house_cells
                            .iter()
                            .copied()
                            .filter(|c| !handler_cells.contains(c))
                            .collect();
                        if let Some(h_mut) = hs.get_mut(idx) {
                            if let Some(sum_mut) = h_mut.as_any_mut().downcast_mut::<Sum>() {
                                sum_mut.set_complement_cells(complement);
                            }
                        }
                    } else if handler_cells.len() - overlap_size == 1 {
                        // Outie: sticks out by 1 cell.
                        outies.push(idx);
                    }
                }
            }
        }

        // Short-circuit if nothing useful.
        if outies.is_empty() && constrained_cells.is_empty() {
            continue;
        }

        let complement_cells: Vec<CellIndex> = house_cells
            .iter()
            .copied()
            .filter(|c| !constrained_cells.contains(c))
            .collect();
        let complement_sum = hs.shape.max_sum - constrained_sum;

        // Create outie handlers.
        for &outie_idx in &outies {
            if let Some(h) = hs.get(outie_idx) {
                if let Some(sum_h) = h.as_any().downcast_ref::<Sum>() {
                    let handler_cells = sum_h.cells_vec();
                    let remaining_cells: Vec<CellIndex> = complement_cells
                        .iter()
                        .copied()
                        .filter(|c| !handler_cells.contains(c))
                        .collect();

                    if remaining_cells.len() + 1 > MAX_SUM_SIZE {
                        continue;
                    }

                    let extra_cells: Vec<CellIndex> = handler_cells
                        .iter()
                        .copied()
                        .filter(|c| !house_set.contains(c))
                        .collect();
                    let remaining_sum = complement_sum - sum_h.sum();

                    let mut cells = remaining_cells.clone();
                    let big_len = cells.len();
                    cells.extend_from_slice(&extra_cells);
                    let coeffs: Vec<i32> = cells
                        .iter()
                        .enumerate()
                        .map(|(i, _)| if i < big_len { 1 } else { -1 })
                        .collect();

                    let handler = Sum::new(cells, remaining_sum, Some(coeffs));
                    ctx.log_add_handler(
                        "_makeHiddenCageHandlers",
                        &handler,
                        Some(serde_json::json!({
                            "offset": remaining_sum,
                            "negativeCells": extra_cells,
                        })),
                        false,
                    );
                    new_handlers.push(Box::new(handler));
                }
            }
        }

        // Create complement handler.
        if constrained_cells.len() <= 1 || constrained_cells.len() >= hs.shape.num_values as usize {
            continue;
        }

        let mut complement_handler = Sum::new_cage(complement_cells.clone(), complement_sum);
        ctx.log_add_handler(
            "_makeHiddenCageHandlers",
            &complement_handler,
            Some(serde_json::json!({ "sum": complement_sum })),
            false,
        );
        complement_handler.set_complement_cells(constrained_cells);
        new_handlers.push(Box::new(complement_handler));
    }

    new_handlers
}

/// Create a Sum handler from cages sticking out of a house.
///
/// Mirrors JS `_addSumIntersectionHandler`. The `intersecting_indices`
/// parameter is pre-computed by the caller (matching JS where the caller
/// passes `intersectingHouseHandlers`).
fn add_sum_intersection_handler(
    hs: &HandlerSet,
    house_idx: usize,
    filtered_sum_indices: &[usize],
    intersecting_indices: &HashSet<usize>,
    all_house_data: &[(usize, Vec<CellIndex>)],
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) -> Option<Box<dyn ConstraintHandler>> {
    let house_cells = hs.get(house_idx)?.cells().to_vec();
    let house_set: HashSet<CellIndex> = house_cells.iter().copied().collect();

    let mut total_sum: i32 = 0;
    let mut cells: HashSet<CellIndex> = HashSet::new();
    let mut uncovered: HashSet<CellIndex> = house_set.clone();

    for &idx in filtered_sum_indices {
        if let Some(h) = hs.get(idx) {
            if let Some(sum_h) = h.as_any().downcast_ref::<Sum>() {
                total_sum += sum_h.sum();
                for &c in sum_h.cells_vec().iter() {
                    cells.insert(c);
                    uncovered.remove(&c);
                }
            }
        }
    }

    // Try to fill holes with house handlers.
    if !uncovered.is_empty() {
        for &(other_house_idx, ref other_cells) in all_house_data {
            if uncovered.is_empty() {
                break;
            }
            if other_house_idx == house_idx {
                continue;
            }
            if !intersecting_indices.contains(&other_house_idx) {
                continue;
            }

            let other_set: HashSet<CellIndex> = other_cells.iter().copied().collect();

            // Must not overlap existing cells.
            if cells.intersection(&other_set).count() > 0 {
                continue;
            }
            // Must cover some uncovered cells.
            let intersect_size = uncovered.intersection(&other_set).count();
            if intersect_size == 0 || intersect_size == 1 {
                continue;
            }
            // Intersection with house must equal intersection with uncovered.
            let house_intersect = house_set.intersection(&other_set).count();
            if intersect_size != house_intersect {
                continue;
            }

            total_sum += hs.shape.max_sum;
            for &c in other_cells {
                cells.insert(c);
                uncovered.remove(&c);
            }
        }
    }

    if !uncovered.is_empty() {
        return None;
    }

    // Remove house cells — we care about cells outside the house.
    for &c in &house_cells {
        cells.remove(&c);
    }
    total_sum -= hs.shape.max_sum;

    // Remove completely contained houses.
    if cells.len() >= hs.shape.num_values as usize {
        for (_, other_cells) in all_house_data {
            if cells.len() < hs.shape.num_values as usize {
                break;
            }
            let other_set: HashSet<CellIndex> = other_cells.iter().copied().collect();
            if other_set.intersection(&cells).count() == hs.shape.num_values as usize {
                total_sum -= hs.shape.max_sum;
                for &c in other_cells {
                    cells.remove(&c);
                }
            }
        }
    }

    if cells.is_empty() {
        return None;
    }

    let mut cells_array: Vec<CellIndex> = cells.into_iter().collect();
    cells_array.sort();

    // Use exclusion groups to estimate restrictiveness.
    let eg_data = hu_find_exclusion_groups_greedy(&cells_array, cell_exclusions, false, None);
    let info = hu_exclusion_group_sum_info(&eg_data.groups, hs.shape.num_values);

    if total_sum < info.min || total_sum > info.max {
        // Infeasible — return a False handler.
        return Some(Box::new(False::new(cells_array)));
    }

    let dof = std::cmp::min(total_sum - info.min, info.max - total_sum);
    if info.range == 0 || info.range <= 4 * dof {
        ctx.log(
            "_addSumIntersectionHandler",
            "Skip".to_string(),
            Some(serde_json::json!({
                "sum": total_sum,
                "range": info.range,
            })),
            cells_array.clone(),
        );
        return None;
    }

    let handler = Sum::new_cage(cells_array, total_sum);
    ctx.log_add_handler(
        "_addSumIntersectionHandler",
        &handler,
        Some(serde_json::json!({
            "sum": total_sum,
            "size": handler.cells().len(),
            "minSum": info.min,
            "maxSum": info.max,
            "range": info.range,
        })),
        false,
    );
    Some(Box::new(handler))
}

/// Greedy merge of sum constraints to create combined handlers.
///
/// Mirrors JS `_makeCombinedSumHandlers`.
fn make_combined_sum_handlers(
    safe_sum_indices: &[usize],
    hs: &HandlerSet,
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) -> Vec<Box<dyn ConstraintHandler>> {
    let mut new_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

    // Build records for each sum handler.
    struct Record {
        key: String,
        cells: Vec<CellIndex>,
        cells_bit_set: BitSet,
        sum: i32,
        range: i32,
        dof: i32,
        score: i32,
        original: bool,
    }

    let num_values = hs.shape.num_values as i32;
    let score_of = |groups: &[Vec<u8>], dof: i32| -> i32 {
        let mut score: i32 = 0;
        for g in groups {
            let k = g.len() as i32;
            score += k * (num_values - k) - dof;
        }
        score
    };

    let make_record = |cells: Vec<CellIndex>, sum: i32, original: bool| -> Option<Record> {
        let eg_data = hu_find_exclusion_groups_greedy(&cells, cell_exclusions, false, None);
        let info = hu_exclusion_group_sum_info(&eg_data.groups, hs.shape.num_values);

        if sum < info.min || sum > info.max {
            return None;
        }

        let dof = std::cmp::min(sum - info.min, info.max - sum);
        let mut cells_bit_set = BitSet::with_capacity(hs.shape.num_cells as usize);
        for &c in &cells {
            cells_bit_set.add(c as usize);
        }
        let key = cells
            .iter()
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join(",");

        Some(Record {
            key,
            cells,
            cells_bit_set,
            sum,
            range: info.range,
            dof,
            score: score_of(&eg_data.groups, dof),
            original,
        })
    };

    // Initialize records.
    // Use BTreeMap for deterministic iteration order, matching JS Map's
    // insertion-order semantics for tie-breaking in the greedy merge loop.
    let mut active: BTreeMap<String, Record> = BTreeMap::new();
    for &idx in safe_sum_indices {
        if let Some(h) = hs.get(idx) {
            if let Some(sum_h) = h.as_any().downcast_ref::<Sum>() {
                let mut cells = sum_h.cells_vec();
                cells.sort();
                if let Some(rec) = make_record(cells, sum_h.sum(), true) {
                    // Prefer first occurrence if duplicates exist (matches JS).
                    active.entry(rec.key.clone()).or_insert(rec);
                }
            }
        }
    }

    // Check if two records are related (non-overlapping with enough exclusion edges).
    // Mirrors JS `areRelatedNonOverlapping`.
    let are_related = |r1: &Record, r2: &Record| -> bool {
        // Disallow overlap.
        if r1.cells_bit_set.has_intersection(&r2.cells_bit_set) {
            return false;
        }
        const MIN_OVERLAP: usize = 6;
        let (small, big) = if r2.cells.len() < r1.cells.len() {
            (r2, r1)
        } else {
            (r1, r2)
        };
        if small.cells.len() < MIN_OVERLAP {
            return false;
        }
        let mut count = 0;
        for &cell in &small.cells {
            if cell_exclusions
                .get_bit_set(cell)
                .has_intersection(&big.cells_bit_set)
            {
                count += 1;
                if count >= MIN_OVERLAP {
                    return true;
                }
            }
        }
        false
    };

    // Build candidates.
    struct Candidate {
        key1: String,
        key2: String,
        combined_key: String,
        combined_cells: Vec<CellIndex>,
        combined_sum: i32,
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    let keys: Vec<String> = active.keys().cloned().collect();
    for i in 0..keys.len() {
        for j in (i + 1)..keys.len() {
            let r1 = &active[&keys[i]];
            let r2 = &active[&keys[j]];
            if !are_related(r1, r2) {
                continue;
            }
            let mut combined_cells: Vec<CellIndex> =
                r1.cells.iter().chain(r2.cells.iter()).copied().collect();
            combined_cells.sort();
            let combined_key = combined_cells
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");

            candidates.push(Candidate {
                key1: keys[i].clone(),
                key2: keys[j].clone(),
                combined_key,
                combined_cells,
                combined_sum: r1.sum + r2.sum,
            });
        }
    }

    // Greedy merge loop.
    loop {
        let mut best_idx: Option<usize> = None;
        let mut best_score: i32 = i32::MIN;
        let mut best_key: Option<String> = None;

        let mut i = 0;
        while i < candidates.len() {
            let cand = &candidates[i];

            // Skip invalidated candidates.
            if !active.contains_key(&cand.key1)
                || !active.contains_key(&cand.key2)
                || active.contains_key(&cand.combined_key)
            {
                candidates.swap_remove(i);
                continue;
            }

            // Score the combined record.
            if let Some(rec) = make_record(cand.combined_cells.clone(), cand.combined_sum, false) {
                let r1_score = active[&cand.key1].score;
                let r2_score = active[&cand.key2].score;

                // Accept if strictly better than both inputs,
                // or (fallback) better than their sum.
                let dominated = rec.score > r1_score && rec.score > r2_score;
                let sum_better = rec.score > r1_score + r2_score;
                if dominated || sum_better {
                    // Deterministic tie-breaker: prefer lexicographically-larger
                    // combined key (matches JS `isBetterCandidate`).
                    let is_better = rec.score > best_score
                        || (rec.score == best_score
                            && best_key.as_ref().map_or(true, |k| cand.combined_key > *k));
                    if is_better {
                        best_score = rec.score;
                        best_key = Some(cand.combined_key.clone());
                        best_idx = Some(i);
                    }
                }
            }
            i += 1;
        }

        let Some(best_i) = best_idx else {
            break;
        };

        let best_cand = candidates.swap_remove(best_i);

        // Remove inputs, add merged.
        active.remove(&best_cand.key1);
        active.remove(&best_cand.key2);

        if let Some(rec) = make_record(best_cand.combined_cells, best_cand.combined_sum, false) {
            let merged_key = rec.key.clone();
            active.insert(merged_key.clone(), rec);

            // Add new candidates involving the merged record.
            let remaining_keys: Vec<String> = active.keys().cloned().collect();
            for other_key in remaining_keys {
                if other_key == merged_key {
                    continue;
                }
                let merged = &active[&merged_key];
                let other = &active[&other_key];
                if !are_related(merged, other) {
                    continue;
                }
                let mut combined_cells: Vec<CellIndex> = merged
                    .cells
                    .iter()
                    .chain(other.cells.iter())
                    .copied()
                    .collect();
                combined_cells.sort();
                let combined_key = combined_cells
                    .iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(",");

                candidates.push(Candidate {
                    key1: merged_key.clone(),
                    key2: other_key,
                    combined_key,
                    combined_cells,
                    combined_sum: merged.sum + other.sum,
                });
            }
        }
    }

    // Collect non-original records with positive score.
    for rec in active.values() {
        if rec.original || rec.score <= 0 {
            continue;
        }
        let handler = Sum::new_cage(rec.cells.clone(), rec.sum);
        ctx.log(
            "_makeCombinedSumHandlers",
            "Add: Sum".to_string(),
            Some(serde_json::json!({
                "sum": rec.sum,
                "range": rec.range,
                "dof": rec.dof,
                "score": rec.score,
            })),
            rec.cells.clone(),
        );
        new_handlers.push(Box::new(handler));
    }

    new_handlers
}

/// Replace 1-cell sums with GivenCandidates and 2-cell sums with
/// BinaryConstraint.
///
/// Mirrors JS `_replaceSizeSpecificSumHandlers`.
pub(super) fn replace_size_specific_sum_handlers(
    hs: &mut HandlerSet,
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) {
    let sum_entries: Vec<(usize, Vec<CellIndex>, i32, Vec<i32>)> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, sum_h)| (idx, sum_h.cells_vec(), sum_h.sum(), sum_h.coefficients()))
        .collect();

    for (idx, cells, sum, coeffs) in sum_entries {
        let new_handler: Option<Box<dyn ConstraintHandler>> = match cells.len() {
            1 => {
                let coeff = coeffs[0];
                if sum % coeff != 0 {
                    // Impossible — no integer value satisfies value * coeff == sum.
                    Some(Box::new(False::new(cells.clone())))
                } else {
                    let value = (sum / coeff) as u8;
                    if value >= 1 && value <= hs.shape.num_values {
                        Some(Box::new(GivenCandidates::new(vec![(
                            cells[0],
                            CandidateSet::from_value(value),
                        )])))
                    } else {
                        Some(Box::new(False::new(cells.clone())))
                    }
                }
            }
            2 => {
                let cell0 = cells[0];
                let cell1 = cells[1];
                let c0 = coeffs[0];
                let c1 = coeffs[1];
                let mutually_exclusive = cell_exclusions.is_mutually_exclusive(cell0, cell1);

                let pred = move |a: u8, b: u8| -> bool {
                    let val = a as i32 * c0 + b as i32 * c1;
                    val == sum && (!mutually_exclusive || a != b)
                };

                Some(Box::new(BinaryConstraint::from_predicate(
                    cell0,
                    cell1,
                    pred,
                    hs.shape.num_values,
                )))
            }
            n if n == hs.shape.num_values as usize => {
                // Check if all unit coefficients and mutually exclusive.
                let all_unit = coeffs.iter().all(|&c| c == 1);
                if !all_unit || !cell_exclusions.are_mutually_exclusive(&cells) {
                    None
                } else if sum == hs.shape.max_sum {
                    // True — the constraint is automatically satisfied.
                    Some(Box::new(True))
                } else {
                    // False — impossible sum for all-different N cells.
                    Some(Box::new(False::new(cells.clone())))
                }
            }
            _ => None,
        };

        if let Some(handler) = new_handler {
            ctx.log_replace("_replaceSizeSpecificSumHandlers", handler.as_ref(), None);
            hs.replace(idx, handler);
        }
    }
}

/// For each Sum with unit coefficients, find a common House handler
/// and attach complement cells.
///
/// Mirrors JS `_addSumComplementCells`.  Uses progressive intersection of
/// the per-cell ordinary handler map (matching JS `_findCommonHandlers`)
/// instead of brute-force containment checks.
fn add_sum_complement_cells(hs: &mut HandlerSet) {
    let house_handler_indices: Vec<usize> = hs
        .get_all_of_type::<House>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();

    let sum_entries: Vec<(usize, Vec<CellIndex>)> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .filter_map(|&(idx, sum_h)| {
            if sum_h.only_unit_coeffs() {
                Some((idx, sum_h.cells_vec()))
            } else {
                None
            }
        })
        .collect();

    // Phase 1: compute complement cells via progressive intersection.
    let mut updates: Vec<(usize, Vec<CellIndex>)> = Vec::new();
    for (sum_idx, sum_cells) in &sum_entries {
        let common = find_common_house_handlers(
            sum_cells,
            hs.ordinary_map(),
            &house_handler_indices,
        );
        if common.is_empty() {
            continue;
        }
        if let Some(handler) = hs.get(common[0]) {
            let complement: Vec<CellIndex> = handler
                .cells()
                .iter()
                .copied()
                .filter(|c| !sum_cells.contains(c))
                .collect();
            updates.push((*sum_idx, complement));
        }
    }

    // Phase 2: apply mutations.
    for (sum_idx, complement) in updates {
        if let Some(h) = hs.get_mut(sum_idx) {
            if let Some(sum_h) = h.as_any_mut().downcast_mut::<Sum>() {
                sum_h.set_complement_cells(complement);
            }
        }
    }
}

/// Find handler indices common to all cells via progressive intersection.
///
/// Mirrors JS `_findCommonHandlers`: starts with `initial` (house handler
/// indices), then for each cell intersects with `ordinary_map[cell]`,
/// short-circuiting when the intersection becomes empty.
fn find_common_house_handlers(
    cells: &[CellIndex],
    ordinary_map: &[Vec<usize>],
    initial: &[usize],
) -> Vec<usize> {
    use std::collections::HashSet;
    let mut common: Vec<usize> = initial.to_vec();
    for &c in cells {
        let cell_handlers: HashSet<usize> =
            ordinary_map[c as usize].iter().copied().collect();
        common.retain(|idx| cell_handlers.contains(idx));
        if common.is_empty() {
            return common;
        }
    }
    common
}
