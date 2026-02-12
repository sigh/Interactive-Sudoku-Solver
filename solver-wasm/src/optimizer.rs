//! Optimizer for constraint handlers.
//!
//! Applies a sequence of optimization passes to the handler set before
//! the solver runs. This dramatically reduces backtracks for killer
//! puzzles by:
//!
//! - Promoting AllDifferent constraints to House constraints.
//! - Inferring hidden cage sums (innies/outies).
//! - Combining related sum constraints.
//! - Replacing small sum constraints with specialized handlers.
//! - Adding box-line intersection constraints.
//!
//! Mirrors JS `SudokuConstraintOptimizer` from optimizer.js.

use std::collections::{HashMap, HashSet};

use crate::cell_exclusions::CellExclusions;
use crate::grid::Grid;
use crate::handler::{
    AllDifferent, BinaryConstraint, ConstraintHandler, GivenCandidates, House,
    SameValuesIgnoreCount,
};
use crate::sum_handler::Sum;
use crate::util::{self, NUM_CELLS, NUM_VALUES};

/// Maximum number of cells in optimizer-generated sum constraints.
const MAX_SUM_SIZE: usize = 6;

/// Sum of all values 1..=9.
const MAX_SUM: i32 = (NUM_VALUES as i32 * (NUM_VALUES as i32 + 1)) / 2;

// ============================================================================
// HandlerSet — lightweight wrapper for optimization
// ============================================================================

/// A set of handlers with type queries and cell-to-handler maps.
///
/// This is a simplified Rust version of JS `HandlerSet`, designed
/// for the optimizer's needs: type queries, add/remove/replace,
/// and intersection lookups.
/// Classification of a handler for propagation queue routing.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HandlerKind {
    /// Normal handler — triggered on any cell change.
    Ordinary,
    /// Aux handler — only triggered when a cell is fixed (not on candidate removal).
    /// Mirrors JS `handlerSet.addAux()`. Used for house intersection handlers.
    Aux,
}

struct HandlerSet {
    handlers: Vec<Option<Box<dyn ConstraintHandler>>>,
    /// Whether each handler is essential (vs. performance-only).
    essential: Vec<bool>,
    /// Handler kind (Ordinary vs Aux).
    kind: Vec<HandlerKind>,
    /// For each cell, the list of handler indices that touch it.
    cell_map: Vec<Vec<usize>>,
    /// Seen id strings for deduplication.
    seen: HashSet<String>,
}

impl HandlerSet {
    fn new(handlers: Vec<Box<dyn ConstraintHandler>>) -> Self {
        let mut cell_map = vec![Vec::new(); NUM_CELLS];
        let mut seen = HashSet::new();
        let mut essential = Vec::with_capacity(handlers.len());
        let mut kind = Vec::with_capacity(handlers.len());

        let handlers: Vec<Option<Box<dyn ConstraintHandler>>> = handlers
            .into_iter()
            .enumerate()
            .map(|(idx, h)| {
                seen.insert(h.id_str());
                for &c in h.cells() {
                    cell_map[c as usize].push(idx);
                }
                essential.push(h.is_essential());
                kind.push(HandlerKind::Ordinary);
                Some(h)
            })
            .collect();

        HandlerSet {
            handlers,
            essential,
            kind,
            cell_map,
            seen,
        }
    }

    /// Get all handlers of a specific type.
    fn get_all_of_type<T: 'static>(&self) -> Vec<(usize, &T)> {
        self.handlers
            .iter()
            .enumerate()
            .filter_map(|(idx, h)| {
                h.as_ref()
                    .and_then(|h| h.as_any().downcast_ref::<T>())
                    .map(|t| (idx, t))
            })
            .collect()
    }

    /// Get handler reference by index.
    fn get(&self, idx: usize) -> Option<&dyn ConstraintHandler> {
        self.handlers[idx].as_ref().map(|h| h.as_ref())
    }

    /// Get mutable handler reference by index.
    fn get_mut(&mut self, idx: usize) -> Option<&mut Box<dyn ConstraintHandler>> {
        self.handlers[idx].as_mut()
    }

    /// Add a handler (non-essential, ordinary). Returns its index. Deduplicates by id_str.
    fn add_non_essential(&mut self, handler: Box<dyn ConstraintHandler>) -> Option<usize> {
        self.add_with_kind(handler, HandlerKind::Ordinary)
    }

    /// Add a handler (non-essential, aux — only triggered on fixed cell).
    fn add_aux(&mut self, handler: Box<dyn ConstraintHandler>) -> Option<usize> {
        self.add_with_kind(handler, HandlerKind::Aux)
    }

    /// Internal: add a handler with a given kind.
    fn add_with_kind(
        &mut self,
        handler: Box<dyn ConstraintHandler>,
        hk: HandlerKind,
    ) -> Option<usize> {
        let id = handler.id_str();
        if self.seen.contains(&id) {
            return None;
        }
        self.seen.insert(id);

        let idx = self.handlers.len();
        for &c in handler.cells() {
            self.cell_map[c as usize].push(idx);
        }
        self.essential.push(false);
        self.kind.push(hk);
        self.handlers.push(Some(handler));
        Some(idx)
    }

    /// Replace a handler at the given index.
    fn replace(&mut self, idx: usize, new_handler: Box<dyn ConstraintHandler>) {
        // Remove old cells from map.
        if let Some(old) = &self.handlers[idx] {
            let old_cells: Vec<u8> = old.cells().to_vec();
            for &c in &old_cells {
                self.cell_map[c as usize].retain(|&i| i != idx);
            }
        }
        // Add new cells to map.
        for &c in new_handler.cells() {
            self.cell_map[c as usize].push(idx);
        }
        self.handlers[idx] = Some(new_handler);
    }

    /// Get handler indices that share any cell with the given handler.
    fn get_intersecting_indices(&self, handler_idx: usize) -> HashSet<usize> {
        let mut result = HashSet::new();
        if let Some(h) = &self.handlers[handler_idx] {
            for &c in h.cells() {
                for &idx in &self.cell_map[c as usize] {
                    if idx != handler_idx {
                        result.insert(idx);
                    }
                }
            }
        }
        result
    }

    /// Consume and return all handlers with their essential flags and kinds.
    fn drain(self) -> Vec<(Box<dyn ConstraintHandler>, bool, HandlerKind)> {
        self.handlers
            .into_iter()
            .zip(self.essential.into_iter())
            .zip(self.kind.into_iter())
            .filter_map(|((h, e), k)| h.map(|h| (h, e, k)))
            .collect()
    }
}

// ============================================================================
// Optimizer
// ============================================================================

/// Optimizes constraint handlers for better solver performance.
pub struct Optimizer;

impl Optimizer {
    /// Run all optimization passes on the handler set.
    ///
    /// Takes ownership of the handlers and returns the optimized set.
    /// Also mutates cell_exclusions if needed (e.g., adding exclusions
    /// from new handlers).
    pub fn optimize(
        handlers: Vec<Box<dyn ConstraintHandler>>,
        cell_exclusions: &mut CellExclusions,
    ) -> Vec<(Box<dyn ConstraintHandler>, bool, HandlerKind)> {
        let mut hs = HandlerSet::new(handlers);

        Self::add_house_handlers(&mut hs);

        Self::optimize_sums(&mut hs, cell_exclusions);

        Self::add_house_intersections(&mut hs);

        hs.drain()
    }

    // ========================================================================
    // add_house_handlers
    // ========================================================================

    /// Promote 9-cell AllDifferent constraints to House constraints.
    ///
    /// Mirrors JS `_addHouseHandlers`.
    fn add_house_handlers(hs: &mut HandlerSet) {
        let ad_indices: Vec<(usize, Vec<u8>)> = hs
            .get_all_of_type::<AllDifferent>()
            .iter()
            .filter_map(|&(idx, _ad)| {
                let excl = hs.get(idx)?.exclusion_cells();
                if excl.len() == NUM_VALUES {
                    Some((idx, excl.to_vec()))
                } else {
                    None
                }
            })
            .collect();

        for (_, cells) in ad_indices {
            hs.add_non_essential(Box::new(House::new(cells)));
        }
    }

    // ========================================================================
    // optimize_sums — orchestrator
    // ========================================================================

    /// Orchestrate all sum-related optimization passes.
    ///
    /// Mirrors JS `_optimizeSums`.
    fn optimize_sums(hs: &mut HandlerSet, cell_exclusions: &CellExclusions) {
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
                    .map_or(false, |s| s.only_unit_coeffs())
            })
            .collect();

        // Find non-overlapping subset.
        let (non_overlapping_indices, mut sum_cells) =
            Self::find_non_overlapping_subset(&safe_sum_indices, hs);

        // Fill in gap.
        let gap_handlers = Self::fill_in_sum_gap(&non_overlapping_indices, &mut sum_cells, hs);
        for h in gap_handlers {
            hs.add_non_essential(h);
        }

        // Innie/outie sum handlers from region overlaps.
        let innie_outie = Self::make_innie_outie_sum_handlers(&non_overlapping_indices, hs);
        for h in innie_outie {
            hs.add_non_essential(h);
        }

        // Hidden cage handlers (complement sums and outies).
        let hidden = Self::make_hidden_cage_handlers(hs, &safe_sum_indices, cell_exclusions);
        for h in hidden {
            hs.add_non_essential(h);
        }

        // Combined sum handlers (greedy merge).
        let combined = Self::make_combined_sum_handlers(&safe_sum_indices, hs, cell_exclusions);
        for h in combined {
            hs.add_non_essential(h);
        }

        // Replace 1-cell and 2-cell sums with specialized handlers.
        Self::replace_size_specific_sum_handlers(hs, cell_exclusions);

        // Add complement cells to remaining sum handlers.
        Self::add_sum_complement_cells(hs);
    }

    // ========================================================================
    // find_non_overlapping_subset
    // ========================================================================

    /// Find a maximal non-overlapping subset of sum handlers.
    ///
    /// Greedy bin-packing: sort by overlap count (ascending), pick handlers
    /// whose cells don't conflict.
    ///
    /// Mirrors JS `_findNonOverlappingSubset`.
    fn find_non_overlapping_subset(
        indices: &[usize],
        hs: &HandlerSet,
    ) -> (Vec<usize>, HashSet<u8>) {
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

        let mut cells_included: HashSet<u8> = HashSet::new();
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

    // ========================================================================
    // fill_in_sum_gap
    // ========================================================================

    /// If there are uncovered cells after non-overlapping selection,
    /// create a Sum handler for the remaining cells.
    ///
    /// Mirrors JS `_fillInSumGap`.
    fn fill_in_sum_gap(
        non_overlapping: &[usize],
        sum_cells: &mut HashSet<u8>,
        hs: &HandlerSet,
    ) -> Vec<Box<dyn ConstraintHandler>> {
        let num_non_sum = NUM_CELLS - sum_cells.len();
        if num_non_sum == 0 || num_non_sum >= NUM_VALUES {
            return Vec::new();
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
        let num_regions = NUM_CELLS / NUM_VALUES;
        let remaining_sum = (num_regions as i32 * MAX_SUM) - handlers_sum;

        let remaining_cells: Vec<u8> = (0..NUM_CELLS as u8)
            .filter(|c| !sum_cells.contains(c))
            .collect();

        for &c in &remaining_cells {
            sum_cells.insert(c);
        }

        vec![Box::new(Sum::new_cage(remaining_cells, remaining_sum))]
    }

    // ========================================================================
    // make_innie_outie_sum_handlers
    // ========================================================================

    /// Create innie/outie sum handlers from region overlap analysis.
    ///
    /// For rows, columns, and boxes: accumulate consecutive regions into
    /// a super-region, find sum pieces that overlap more than half, and
    /// infer new sum constraints from the symmetric difference.
    ///
    /// Mirrors JS `_makeInnieOutieSumHandlers`.
    fn make_innie_outie_sum_handlers(
        non_overlapping: &[usize],
        hs: &HandlerSet,
    ) -> Vec<Box<dyn ConstraintHandler>> {
        let mut new_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

        // Collect pieces: (cells, sum).
        let pieces: Vec<(Vec<u8>, i32)> = non_overlapping
            .iter()
            .filter_map(|&idx| {
                hs.get(idx)
                    .and_then(|h| h.as_any().downcast_ref::<Sum>())
                    .map(|s| (s.cells_vec(), s.sum()))
            })
            .collect();

        let cells_in_sum: HashSet<u8> =
            pieces.iter().flat_map(|(c, _)| c.iter().copied()).collect();

        let has_cells_without_sum =
            |cells: &HashSet<u8>| -> bool { cells.iter().any(|c| !cells_in_sum.contains(c)) };

        // Get region groups: rows (forward/reverse), cols (forward/reverse), boxes.
        let regions = overlap_regions();

        for region_group in &regions {
            general_region_overlap_processor(
                region_group,
                &pieces,
                |super_region, pieces_region, used_pieces| {
                    let diff_a: HashSet<u8> =
                        super_region.difference(&pieces_region).copied().collect();
                    let diff_b: HashSet<u8> =
                        pieces_region.difference(&super_region).copied().collect();

                    // No diff → no new constraint.
                    if diff_a.is_empty() && diff_b.is_empty() {
                        return;
                    }
                    // Too large → not useful.
                    if diff_a.len() + diff_b.len() > NUM_VALUES {
                        return;
                    }
                    // Can only handle negative coefficients when diff is small.
                    if diff_a.len() > 2 && diff_b.len() > 2 {
                        return;
                    }

                    if !(has_cells_without_sum(&diff_a) || has_cells_without_sum(&diff_b)) {
                        if diff_a.len() + diff_b.len() > MAX_SUM_SIZE {
                            return;
                        }
                    }

                    let mut sum_delta: i32 =
                        -(super_region.len() as i32 * MAX_SUM / NUM_VALUES as i32);
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
                        let mut cells: Vec<u8> = big.into_iter().collect();
                        cells.sort();
                        new_handlers.push(Box::new(Sum::new_cage(cells, sum_delta)));
                    } else {
                        let mut cells: Vec<u8> = big.into_iter().collect();
                        cells.sort();
                        let mut small_vec: Vec<u8> = small.into_iter().collect();
                        small_vec.sort();
                        let big_len = cells.len();
                        cells.extend_from_slice(&small_vec);
                        let coeffs: Vec<i32> = cells
                            .iter()
                            .enumerate()
                            .map(|(i, _)| if i < big_len { 1 } else { -1 })
                            .collect();
                        new_handlers.push(Box::new(Sum::new(cells, sum_delta, Some(coeffs))));
                    }
                },
            );
        }

        new_handlers
    }

    // ========================================================================
    // make_hidden_cage_handlers
    // ========================================================================

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
    ) -> Vec<Box<dyn ConstraintHandler>> {
        let mut new_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

        // Get all House handler indices and cells.
        let house_data: Vec<(usize, Vec<u8>)> = hs
            .get_all_of_type::<House>()
            .iter()
            .map(|&(idx, h)| (idx, h.cells().to_vec()))
            .collect();

        let sum_index_set: HashSet<usize> = safe_sum_indices.iter().copied().collect();

        for &(house_idx, ref house_cells) in &house_data {
            let house_set: HashSet<u8> = house_cells.iter().copied().collect();

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
            let (filtered_indices, _) = Self::find_non_overlapping_subset(&current_sum_indices, hs);

            // Sum intersection handler.
            if let Some(handler) = Self::add_sum_intersection_handler(
                hs,
                house_idx,
                &filtered_indices,
                &house_data,
                cell_exclusions,
            ) {
                new_handlers.push(handler);
            }

            // Classify handlers: fully inside vs outies.
            let mut constrained_cells: Vec<u8> = Vec::new();
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
                            let complement: Vec<u8> = house_cells
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

            let complement_cells: Vec<u8> = house_cells
                .iter()
                .copied()
                .filter(|c| !constrained_cells.contains(c))
                .collect();
            let complement_sum = MAX_SUM - constrained_sum;

            // Create outie handlers.
            for &outie_idx in &outies {
                if let Some(h) = hs.get(outie_idx) {
                    if let Some(sum_h) = h.as_any().downcast_ref::<Sum>() {
                        let handler_cells = sum_h.cells_vec();
                        let remaining_cells: Vec<u8> = complement_cells
                            .iter()
                            .copied()
                            .filter(|c| !handler_cells.contains(c))
                            .collect();

                        if remaining_cells.len() + 1 > MAX_SUM_SIZE {
                            continue;
                        }

                        let extra_cells: Vec<u8> = handler_cells
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

                        new_handlers.push(Box::new(Sum::new(cells, remaining_sum, Some(coeffs))));
                    }
                }
            }

            // Create complement handler.
            if constrained_cells.len() <= 1 || constrained_cells.len() >= NUM_VALUES {
                continue;
            }

            let mut complement_handler = Sum::new_cage(complement_cells.clone(), complement_sum);
            complement_handler.set_complement_cells(constrained_cells);
            new_handlers.push(Box::new(complement_handler));
        }

        new_handlers
    }

    // ========================================================================
    // add_sum_intersection_handler
    // ========================================================================

    /// Create a Sum handler from cages sticking out of a house.
    ///
    /// Mirrors JS `_addSumIntersectionHandler`.
    fn add_sum_intersection_handler(
        hs: &HandlerSet,
        house_idx: usize,
        filtered_sum_indices: &[usize],
        all_house_data: &[(usize, Vec<u8>)],
        cell_exclusions: &CellExclusions,
    ) -> Option<Box<dyn ConstraintHandler>> {
        let house_cells = hs.get(house_idx)?.cells().to_vec();
        let house_set: HashSet<u8> = house_cells.iter().copied().collect();

        let mut total_sum: i32 = 0;
        let mut cells: HashSet<u8> = HashSet::new();
        let mut uncovered: HashSet<u8> = house_set.clone();

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
            // Get intersecting house handler indices.
            let intersecting = hs.get_intersecting_indices(house_idx);

            for &(other_house_idx, ref other_cells) in all_house_data {
                if uncovered.is_empty() {
                    break;
                }
                if other_house_idx == house_idx {
                    continue;
                }
                if !intersecting.contains(&other_house_idx) {
                    continue;
                }

                let other_set: HashSet<u8> = other_cells.iter().copied().collect();

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

                total_sum += MAX_SUM;
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
        total_sum -= MAX_SUM;

        // Remove completely contained houses.
        if cells.len() >= NUM_VALUES {
            for &(_, ref other_cells) in all_house_data {
                if cells.len() < NUM_VALUES {
                    break;
                }
                let other_set: HashSet<u8> = other_cells.iter().copied().collect();
                if other_set.intersection(&cells).count() == NUM_VALUES {
                    total_sum -= MAX_SUM;
                    for &c in other_cells {
                        cells.remove(&c);
                    }
                }
            }
        }

        if cells.is_empty() {
            return None;
        }

        let mut cells_array: Vec<u8> = cells.into_iter().collect();
        cells_array.sort();

        // Use exclusion groups to estimate restrictiveness.
        let groups = find_exclusion_groups_greedy(&cells_array, cell_exclusions);
        let info = exclusion_group_sum_info(&groups);

        if total_sum < info.min || total_sum > info.max {
            // Infeasible — but we don't have a False handler, so just skip.
            return None;
        }

        let dof = std::cmp::min(total_sum - info.min, info.max - total_sum);
        if info.range == 0 || info.range <= 4 * dof {
            return None;
        }

        Some(Box::new(Sum::new_cage(cells_array, total_sum)))
    }

    // ========================================================================
    // make_combined_sum_handlers
    // ========================================================================

    /// Greedy merge of sum constraints to create combined handlers.
    ///
    /// Mirrors JS `_makeCombinedSumHandlers`.
    fn make_combined_sum_handlers(
        safe_sum_indices: &[usize],
        hs: &HandlerSet,
        cell_exclusions: &CellExclusions,
    ) -> Vec<Box<dyn ConstraintHandler>> {
        let mut new_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

        // Build records for each sum handler.
        struct Record {
            key: String,
            cells: Vec<u8>,
            cells_set: HashSet<u8>,
            sum: i32,
            score: i32,
            original: bool,
        }

        let score_of = |groups: &[Vec<u8>], dof: i32| -> i32 {
            let mut score: i32 = 0;
            for g in groups {
                let k = g.len() as i32;
                score += k * (NUM_VALUES as i32 - k) - dof;
            }
            score
        };

        let make_record = |cells: Vec<u8>, sum: i32, original: bool| -> Option<Record> {
            let groups = find_exclusion_groups_greedy(&cells, cell_exclusions);
            let info = exclusion_group_sum_info(&groups);

            if sum < info.min || sum > info.max {
                return None;
            }

            let dof = std::cmp::min(sum - info.min, info.max - sum);
            let key = cells
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");

            Some(Record {
                key,
                cells_set: cells.iter().copied().collect(),
                cells,
                sum,
                score: score_of(&groups, dof),
                original,
            })
        };

        // Initialize records.
        let mut active: HashMap<String, Record> = HashMap::new();
        for &idx in safe_sum_indices {
            if let Some(h) = hs.get(idx) {
                if let Some(sum_h) = h.as_any().downcast_ref::<Sum>() {
                    let mut cells = sum_h.cells_vec();
                    cells.sort();
                    if let Some(rec) = make_record(cells, sum_h.sum(), true) {
                        active.insert(rec.key.clone(), rec);
                    }
                }
            }
        }

        // Check if two records are related (share enough exclusion edges).
        let are_related = |r1: &Record, r2: &Record| -> bool {
            if r1.cells_set.intersection(&r2.cells_set).count() > 0 {
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
                if cell_exclusions.sets[cell as usize]
                    .iter()
                    .any(|c| big.cells_set.contains(c))
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
            combined_cells: Vec<u8>,
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
                let mut combined_cells: Vec<u8> =
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
                if let Some(rec) =
                    make_record(cand.combined_cells.clone(), cand.combined_sum, false)
                {
                    let r1_score = active[&cand.key1].score;
                    let r2_score = active[&cand.key2].score;

                    // Only merge if strictly better than both.
                    if rec.score > r1_score && rec.score > r2_score && rec.score > best_score {
                        best_score = rec.score;
                        best_idx = Some(i);
                    }
                }
                i += 1;
            }

            if best_idx.is_none() {
                break;
            }

            let best_i = best_idx.unwrap();
            let best_cand = candidates.swap_remove(best_i);

            // Remove inputs, add merged.
            active.remove(&best_cand.key1);
            active.remove(&best_cand.key2);

            if let Some(rec) = make_record(best_cand.combined_cells, best_cand.combined_sum, false)
            {
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
                    let mut combined_cells: Vec<u8> = merged
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
            new_handlers.push(Box::new(Sum::new_cage(rec.cells.clone(), rec.sum)));
        }

        new_handlers
    }

    // ========================================================================
    // replace_size_specific_sum_handlers
    // ========================================================================

    /// Replace 1-cell sums with GivenCandidates and 2-cell sums with
    /// BinaryConstraint.
    ///
    /// Mirrors JS `_replaceSizeSpecificSumHandlers`.
    fn replace_size_specific_sum_handlers(hs: &mut HandlerSet, cell_exclusions: &CellExclusions) {
        let sum_entries: Vec<(usize, Vec<u8>, i32, Vec<i32>)> = hs
            .get_all_of_type::<Sum>()
            .iter()
            .map(|&(idx, sum_h)| (idx, sum_h.cells_vec(), sum_h.sum(), sum_h.coefficients()))
            .collect();

        for (idx, cells, sum, coeffs) in sum_entries {
            let new_handler: Option<Box<dyn ConstraintHandler>> = match cells.len() {
                1 => {
                    let coeff = coeffs[0];
                    if sum % coeff != 0 {
                        // Impossible — use GivenCandidates with 0 mask.
                        Some(Box::new(GivenCandidates::new(vec![(cells[0], 0)])))
                    } else {
                        let value = (sum / coeff) as u8;
                        if value >= 1 && value <= NUM_VALUES as u8 {
                            Some(Box::new(GivenCandidates::new(vec![(
                                cells[0],
                                util::value_bit(value as u16),
                            )])))
                        } else {
                            Some(Box::new(GivenCandidates::new(vec![(cells[0], 0)])))
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
                        cell0, cell1, pred,
                    )))
                }
                n if n == NUM_VALUES => {
                    // Check if all unit coefficients and mutually exclusive.
                    let all_unit = coeffs.iter().all(|&c| c == 1);
                    if !all_unit {
                        None
                    } else if !cell_exclusions.are_mutually_exclusive(&cells) {
                        None
                    } else if sum == MAX_SUM {
                        // True — the constraint is automatically satisfied.
                        // Replace with a no-op GivenCandidates.
                        Some(Box::new(GivenCandidates::new(Vec::new())))
                    } else {
                        // False — impossible sum for all-different 9 cells.
                        Some(Box::new(GivenCandidates::new(vec![(cells[0], 0)])))
                    }
                }
                _ => None,
            };

            if let Some(handler) = new_handler {
                hs.replace(idx, handler);
            }
        }
    }

    // ========================================================================
    // add_sum_complement_cells
    // ========================================================================

    /// For each Sum with unit coefficients, find a common House handler
    /// and attach complement cells.
    ///
    /// Mirrors JS `_addSumComplementCells`.
    fn add_sum_complement_cells(hs: &mut HandlerSet) {
        let house_indices: Vec<(usize, Vec<u8>)> = hs
            .get_all_of_type::<House>()
            .iter()
            .map(|&(idx, h)| (idx, h.cells().to_vec()))
            .collect();

        let sum_entries: Vec<(usize, Vec<u8>)> = hs
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

        for (sum_idx, sum_cells) in sum_entries {
            // Find a house that contains all cells of this sum.
            let house = house_indices
                .iter()
                .find(|(_, house_cells)| sum_cells.iter().all(|c| house_cells.contains(c)));

            if let Some((_, house_cells)) = house {
                let complement: Vec<u8> = house_cells
                    .iter()
                    .copied()
                    .filter(|c| !sum_cells.contains(c))
                    .collect();

                if !complement.is_empty() {
                    if let Some(h) = hs.get_mut(sum_idx) {
                        if let Some(sum_h) = h.as_any_mut().downcast_mut::<Sum>() {
                            sum_h.set_complement_cells(complement);
                        }
                    }
                }
            }
        }
    }

    // ========================================================================
    // add_house_intersections
    // ========================================================================

    /// Add SameValuesIgnoreCount for house intersections.
    ///
    /// For each pair of House handlers with a box-sized intersection
    /// (3 cells for standard 9×9), the cells in the symmetric difference
    /// must contain the same set of values.
    ///
    /// This implements box-line reduction / pointing pairs.
    ///
    /// Mirrors JS `_addHouseIntersections`.
    fn add_house_intersections(hs: &mut HandlerSet) {
        let house_data: Vec<(usize, Vec<u8>)> = hs
            .get_all_of_type::<House>()
            .iter()
            .map(|&(idx, h)| (idx, h.cells().to_vec()))
            .collect();

        // For standard 9×9: box dimensions are 3×3, so intersection size is 3.
        let box_width: usize = 3;
        let box_height: usize = 3;

        let num_handlers = house_data.len();
        for i in 1..num_handlers {
            for j in 0..i {
                let cells_i = &house_data[i].1;
                let cells_j = &house_data[j].1;

                let intersection_size = cells_i.iter().filter(|c| cells_j.contains(c)).count();

                if intersection_size != box_width && intersection_size != box_height {
                    continue;
                }

                let diff_i: Vec<u8> = cells_i
                    .iter()
                    .copied()
                    .filter(|c| !cells_j.contains(c))
                    .collect();
                let diff_j: Vec<u8> = cells_j
                    .iter()
                    .copied()
                    .filter(|c| !cells_i.contains(c))
                    .collect();

                let handler = SameValuesIgnoreCount::new(vec![diff_i, diff_j]);
                hs.add_aux(Box::new(handler));
            }
        }
    }
}

// ============================================================================
// Utility functions
// ============================================================================

/// Information about sum range from exclusion groups.
struct SumInfo {
    range: i32,
    min: i32,
    max: i32,
}

/// Compute sum range info from exclusion groups.
///
/// Mirrors JS `HandlerUtil.exclusionGroupSumInfo`.
fn exclusion_group_sum_info(groups: &[Vec<u8>]) -> SumInfo {
    let mut range: i32 = 0;
    let mut min: i32 = 0;

    for g in groups {
        let s = g.len() as i32;
        range += (NUM_VALUES as i32 - s) * s;
        min += (s * (s + 1)) >> 1;
    }

    SumInfo {
        range,
        min,
        max: range + min,
    }
}

/// Greedy exclusion group partitioning.
///
/// Partitions cells into groups where cells within each group are
/// mutually exclusive. Uses a greedy "best-fit" strategy.
///
/// Mirrors JS `HandlerUtil.findExclusionGroupsGreedy`.
fn find_exclusion_groups_greedy(cells: &[u8], cell_exclusions: &CellExclusions) -> Vec<Vec<u8>> {
    let mut unassigned: HashSet<u8> = cells.iter().copied().collect();
    let mut groups: Vec<Vec<u8>> = Vec::new();

    while !unassigned.is_empty() {
        let mut candidates: HashSet<u8> = unassigned.clone();
        let mut group: Vec<u8> = Vec::new();

        while !candidates.is_empty() {
            // Pick the candidate with the most exclusions to other candidates.
            let mut best_cell: Option<u8> = None;
            let mut best_score: usize = 0;

            for &cell in &candidates {
                let score = cell_exclusions.sets[cell as usize]
                    .iter()
                    .filter(|c| candidates.contains(c))
                    .count();
                if best_cell.is_none()
                    || score > best_score
                    || (score == best_score && cell < best_cell.unwrap())
                {
                    best_score = score;
                    best_cell = Some(cell);
                }
            }

            let cell = match best_cell {
                Some(c) => c,
                None => break,
            };

            group.push(cell);
            candidates.remove(&cell);

            if best_score < candidates.len() {
                // Intersect candidates with this cell's exclusions.
                let excl: HashSet<u8> = cell_exclusions.sets[cell as usize]
                    .iter()
                    .copied()
                    .collect();
                candidates = candidates.intersection(&excl).copied().collect();
            }
        }

        for &cell in &group {
            unassigned.remove(&cell);
        }
        groups.push(group);
    }

    groups
}

/// Get overlap regions for standard 9×9 grid.
///
/// Returns region groups: rows (forward), rows (reverse), cols (forward),
/// cols (reverse), boxes.
///
/// Mirrors JS `_overlapRegions` for standard grid.
fn overlap_regions() -> Vec<Vec<Vec<u8>>> {
    let mut regions = Vec::new();

    // Rows forward and reverse.
    let rows: Vec<Vec<u8>> = (0..9)
        .map(|r| Grid::row_cells(r).iter().map(|&c| c as u8).collect())
        .collect();
    regions.push(rows.clone());
    let mut rows_rev = rows;
    rows_rev.reverse();
    regions.push(rows_rev);

    // Cols forward and reverse.
    let cols: Vec<Vec<u8>> = (0..9)
        .map(|c| Grid::col_cells(c).iter().map(|&c| c as u8).collect())
        .collect();
    regions.push(cols.clone());
    let mut cols_rev = cols;
    cols_rev.reverse();
    regions.push(cols_rev);

    // Boxes.
    let boxes: Vec<Vec<u8>> = (0..9)
        .map(|b| Grid::box_cells(b).iter().map(|&c| c as u8).collect())
        .collect();
    regions.push(boxes);

    regions
}

/// General region overlap processor.
///
/// Accumulates regions one at a time, greedily adding "pieces" (sum handler
/// cells) that overlap more than half with the growing super-region.
/// After each region addition (starting from the 2nd), calls the callback
/// with the super-region, pieces-region, and used pieces.
///
/// Mirrors JS `_generalRegionOverlapProcessor`.
fn general_region_overlap_processor(
    regions: &[Vec<u8>],
    pieces: &[(Vec<u8>, i32)],
    mut callback: impl FnMut(&HashSet<u8>, &HashSet<u8>, &[(&Vec<u8>, i32)]),
) {
    let num_values = NUM_VALUES;
    let mut super_region: HashSet<u8> = HashSet::new();
    let mut remaining_pieces: HashSet<usize> = (0..pieces.len()).collect();
    let mut used_pieces: Vec<(&Vec<u8>, i32)> = Vec::new();
    let mut pieces_region: HashSet<u8> = HashSet::new();

    let mut count = 0;
    for region in regions {
        count += 1;
        if count >= num_values {
            break;
        }

        // Add region to super-region.
        for &c in region {
            super_region.insert(c);
        }

        // Add pieces with enough overlap.
        let remaining_copy: Vec<usize> = remaining_pieces.iter().copied().collect();
        for p_idx in remaining_copy {
            let (ref p_cells, p_sum) = pieces[p_idx];
            let intersection_size = p_cells.iter().filter(|c| super_region.contains(c)).count();
            if intersection_size > p_cells.len() / 2 {
                remaining_pieces.remove(&p_idx);
                for &c in p_cells.iter() {
                    pieces_region.insert(c);
                }
                used_pieces.push((p_cells, p_sum));
            }
        }

        // Skip the first region.
        if count == 1 {
            continue;
        }

        callback(&super_region, &pieces_region, &used_pieces);
    }
}

impl Sum {
    /// Get cells as a Vec (for optimizer use).
    pub fn cells_vec(&self) -> Vec<u8> {
        self.cells().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handler::AllDifferentType;

    #[test]
    fn test_exclusion_group_sum_info() {
        // Single group of 3 cells: min = 1+2+3=6, range = (9-3)*3=18, max = 24.
        let groups = vec![vec![0, 1, 2]];
        let info = exclusion_group_sum_info(&groups);
        assert_eq!(info.min, 6);
        assert_eq!(info.range, 18);
        assert_eq!(info.max, 24);
    }

    #[test]
    fn test_find_exclusion_groups_greedy() {
        // Cells 0..9 all mutually exclusive (a house row).
        let house: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[house.clone()]);
        let groups = find_exclusion_groups_greedy(&[0, 1, 2], &ce);
        // All 3 cells should be in one group since they're mutually exclusive.
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 3);
    }

    #[test]
    fn test_find_exclusion_groups_non_exclusive() {
        // Cells 0,1 are exclusive but 2 is not exclusive with either.
        let mut ce = CellExclusions::new();
        ce.add_mutual_exclusion(0, 1);
        let groups = find_exclusion_groups_greedy(&[0, 1, 2], &ce);
        // Should get 2 groups: {0,1} and {2}.
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn test_add_house_handlers() {
        // Create a 9-cell AllDifferent — should get promoted to House.
        let cells: Vec<u8> = (0..9).collect();
        let ad = AllDifferent::new(cells, AllDifferentType::WithExclusionCells);
        let handlers: Vec<Box<dyn ConstraintHandler>> = vec![Box::new(ad)];
        let mut hs = HandlerSet::new(handlers);
        Optimizer::add_house_handlers(&mut hs);

        let houses = hs.get_all_of_type::<House>();
        assert_eq!(houses.len(), 1);
    }

    #[test]
    fn test_replace_1_cell_sum() {
        // A 1-cell sum with sum=5 should become GivenCandidates.
        let sum = Sum::new_cage(vec![0], 5);
        let handlers: Vec<Box<dyn ConstraintHandler>> = vec![Box::new(sum)];
        let mut hs = HandlerSet::new(handlers);
        let ce = CellExclusions::new();
        Optimizer::replace_size_specific_sum_handlers(&mut hs, &ce);

        let gcs = hs.get_all_of_type::<GivenCandidates>();
        assert_eq!(gcs.len(), 1);
        let sums = hs.get_all_of_type::<Sum>();
        assert_eq!(sums.len(), 0);
    }

    #[test]
    fn test_replace_2_cell_sum() {
        // A 2-cell sum with sum=7, cells are mutually exclusive.
        let sum = Sum::new_cage(vec![0, 1], 7);
        let mut ce = CellExclusions::new();
        ce.add_mutual_exclusion(0, 1);
        let handlers: Vec<Box<dyn ConstraintHandler>> = vec![Box::new(sum)];
        let mut hs = HandlerSet::new(handlers);
        Optimizer::replace_size_specific_sum_handlers(&mut hs, &ce);

        let bcs = hs.get_all_of_type::<BinaryConstraint>();
        assert_eq!(bcs.len(), 1);
        let sums = hs.get_all_of_type::<Sum>();
        assert_eq!(sums.len(), 0);
    }
}
