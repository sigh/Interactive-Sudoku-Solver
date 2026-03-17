//! HandlerUtil — shared utilities for constraint handlers.
//!
//! Mirrors JS `HandlerUtil` from handlers.js. Contains all shared static
//! utility functions used across multiple handlers and the optimizer.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::bit_set::BitSet;
use crate::rng::{shuffle_array, RandomIntGenerator};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::handler_accumulator::HandlerAccumulator;

// ============================================================================
// ExclusionGroupData
// ============================================================================

/// Result of exclusion group finding.
///
/// Mirrors JS `{ groups, sumOfSquares }` return from
/// `HandlerUtil.findExclusionGroups`.
pub struct ExclusionGroupData {
    pub groups: Vec<Vec<CellIndex>>,
    pub sum_of_squares: usize,
}

/// Information about sum range from exclusion groups.
///
/// Mirrors JS `HandlerUtil.exclusionGroupSumInfo` return value.
pub struct ExclusionGroupSumInfo {
    pub range: i32,
    pub min: i32,
    pub max: i32,
}

// ============================================================================
// exposeHiddenSingles
// ============================================================================

/// Expose hidden singles: for each bit in `hidden_singles`, find the cell
/// in `cells` that contains it and fix that cell to that value.
///
/// Returns `false` if a cell has multiple hidden singles (contradiction).
///
/// Mirrors JS `HandlerUtil.exposeHiddenSingles`.
pub(crate) fn expose_hidden_singles(
    grid: &mut [CandidateSet],
    cells: &[CellIndex],
    hidden_singles: CandidateSet,
) -> bool {
    for &cell in cells {
        let value = grid[cell as usize] & hidden_singles;
        if !value.is_empty() {
            // If more than one hidden single maps to this cell → contradiction.
            if !value.is_single() {
                return false;
            }
            grid[cell as usize] = value;
        }
    }
    true
}

// ============================================================================
// enforceRequiredValueExclusions / removeRequiredValueExclusions
// ============================================================================

/// Enforce required value exclusions: for each required value, find which cells
/// contain it and remove it from cells that see all of them.
///
/// If `acc` is `Some`, modified cells are queued for propagation.
/// If `acc` is `None`, modifications happen silently (no propagation).
///
/// Mirrors JS `HandlerUtil.enforceRequiredValueExclusions`.
/// The JS function's `handlerAccumulator` parameter can be null/undefined
/// to skip propagation — modeled here as `Option<&mut HandlerAccumulator>`.
pub(crate) fn enforce_required_value_exclusions(
    grid: &mut [CandidateSet],
    cells: &[CellIndex],
    values: CandidateSet,
    cell_exclusions: &CellExclusions,
    mut acc: Option<&mut HandlerAccumulator>,
) -> bool {
    let mut remaining = values;
    while !remaining.is_empty() {
        let value = remaining.lowest();
        remaining ^= value;

        // Loop through and find the location of the cells that contain `value`.
        // `pair_index` is updated such that if there are exactly two locations
        // it will be the index of that pair into `cellExclusions`.
        let mut pair_index: u16 = 0;
        let mut cell_count: u32 = 0;
        let num_cells = cells.len();
        for i in 0..num_cells {
            if grid[cells[i] as usize].intersects(value) {
                pair_index = (pair_index << 8) | cells[i] as u16;
                cell_count += 1;
            }
        }

        // Lookup the exclusion cells.
        // Use cached lookups matching JS: getPairExclusions / getArray / getListExclusions.
        let exclusion_cells: &[CellIndex] = if cell_count == 2 {
            cell_exclusions.get_pair_exclusions(pair_index)
        } else if cell_count == 1 {
            cell_exclusions.get_array(pair_index as CellIndex)
        } else {
            cell_exclusions.get_list_exclusions(cells)
        };

        if !exclusion_cells.is_empty() {
            if !remove_required_value_exclusions(grid, &exclusion_cells, value, acc.as_deref_mut())
            {
                return false;
            }
        }
    }

    true
}

/// Remove required value exclusions from the given exclusion cells.
///
/// If `acc` is `Some`, modified cells are queued for propagation.
///
/// Mirrors JS `HandlerUtil.removeRequiredValueExclusions`.
pub(crate) fn remove_required_value_exclusions(
    grid: &mut [CandidateSet],
    exclusion_cells: &[CellIndex],
    value: CandidateSet,
    mut acc: Option<&mut HandlerAccumulator>,
) -> bool {
    for &excl_cell in exclusion_cells {
        if grid[excl_cell as usize].intersects(value) {
            grid[excl_cell as usize] ^= value;
            if grid[excl_cell as usize].is_empty() {
                return false;
            }
            if let Some(ref mut a) = acc {
                a.add_for_cell(excl_cell);
            }
        }
    }
    true
}

// ============================================================================
// findExclusionGroups / findExclusionGroupsGreedy
// ============================================================================

/// Find the best exclusion group partitioning for the given cells.
///
/// Tries multiple strategies (first, best, random shuffles) and returns
/// the one with the highest sum-of-squares score.
///
/// Mirrors JS `HandlerUtil.findExclusionGroups`.
pub(crate) fn find_exclusion_groups(
    cells: &[CellIndex],
    cell_exclusions: &CellExclusions,
) -> ExclusionGroupData {
    if cells.is_empty() {
        return ExclusionGroupData {
            groups: vec![],
            sum_of_squares: 0,
        };
    }
    if cells.len() == 1 {
        return ExclusionGroupData {
            groups: vec![cells.to_vec()],
            sum_of_squares: 1,
        };
    }

    let max_cell = cells.iter().copied().max().unwrap_or(0) as usize;
    let mut bitset = BitSet::with_capacity(max_cell + 1);

    // Try FIRST strategy.
    let mut best = find_exclusion_groups_greedy(cells, cell_exclusions, true, Some(&mut bitset));

    if cells.len() >= 4 && best.groups.len() > 1 {
        // Try BEST strategy.
        let data = find_exclusion_groups_greedy(cells, cell_exclusions, false, Some(&mut bitset));
        if data.sum_of_squares > best.sum_of_squares {
            best = data;
        }

        // Try random shuffles (deterministic seed matching JS RandomIntGenerator(0)).
        let mut rng = RandomIntGenerator::new(0);
        let mut shuffled: Vec<CellIndex> = cells.to_vec();
        for _ in 0..2 {
            shuffle_array(&mut shuffled, &mut rng);
            let data =
                find_exclusion_groups_greedy(&shuffled, cell_exclusions, true, Some(&mut bitset));
            if data.sum_of_squares > best.sum_of_squares {
                best = data;
            }
        }
    }

    best
}

/// Greedy clique partitioning.
///
/// `first_strategy`: if true, pick cells in the given order (GREEDY_STRATEGY_FIRST);
/// if false, pick the cell with the most mutual exclusions (GREEDY_STRATEGY_BEST).
///
/// If `bitset` is provided, it is cleared and reused as the `unassigned` set;
/// otherwise a new BitSet is allocated internally.
///
/// Mirrors JS `HandlerUtil.findExclusionGroupsGreedy`.
pub(crate) fn find_exclusion_groups_greedy(
    cells: &[CellIndex],
    cell_exclusions: &CellExclusions,
    first_strategy: bool,
    bitset: Option<&mut BitSet>,
) -> ExclusionGroupData {
    let mut owned_bitset;
    let unassigned: &mut BitSet = match bitset {
        Some(bs) => bs,
        None => {
            let max_cell = cells.iter().copied().max().unwrap_or(0) as usize;
            owned_bitset = BitSet::with_capacity(max_cell + 1);
            &mut owned_bitset
        }
    };
    unassigned.clear();
    for &c in cells {
        unassigned.add(c as usize);
    }
    let mut num_unassigned = cells.len();

    let mut groups = Vec::new();

    while num_unassigned > 0 {
        let mut candidates = unassigned.clone();
        let mut num_candidates = num_unassigned;
        let mut group: Vec<CellIndex> = Vec::new();

        while num_candidates > 0 {
            let mut best_cell: i32 = -1;
            let mut best_score: i32 = -1;

            if first_strategy {
                // Choose the first available cell in the order of `cells`.
                for &cell in cells {
                    if candidates.has(cell as usize) {
                        best_cell = cell as i32;
                        break;
                    }
                }
                if best_cell != -1 {
                    best_score = candidates
                        .intersect_count(cell_exclusions.get_bit_set(best_cell as CellIndex))
                        as i32;
                }
            } else {
                // Choose the cell which is mutually exclusive with the most candidates.
                candidates.for_each_bit(|cell| {
                    let score =
                        candidates.intersect_count(cell_exclusions.get_bit_set(cell as CellIndex)) as i32;
                    if score > best_score || (score == best_score && (cell as i32) < best_cell) {
                        best_score = score;
                        best_cell = cell as i32;
                        // Can't do better than excluding all candidates.
                        if best_score == num_candidates as i32 - 1 {
                            return false;
                        }
                    }
                    true
                });
            }

            // This can only happen if there are self-exclusions.
            // In this case, just give up and add all remaining candidates
            // to the group.
            if best_cell == -1 {
                candidates.for_each_bit(|cell| {
                    group.push(cell as CellIndex);
                    true
                });
                break;
            }

            group.push(best_cell as CellIndex);
            candidates.remove(best_cell as usize);
            if best_score != num_candidates as i32 - 1 {
                candidates.intersect(cell_exclusions.get_bit_set(best_cell as CellIndex));
            }
            num_candidates = best_score as usize;
        }

        for &c in &group {
            unassigned.remove(c as usize);
        }
        num_unassigned -= group.len();
        groups.push(group);
    }

    let sum_of_squares = exclusion_group_score(&groups);
    ExclusionGroupData {
        groups,
        sum_of_squares,
    }
}

/// Score: sum of squares of group sizes. Larger groups are preferred.
///
/// Mirrors JS `HandlerUtil._exclusionGroupScore`.
fn exclusion_group_score(groups: &[Vec<CellIndex>]) -> usize {
    groups.iter().map(|g| g.len() * g.len()).sum()
}

// ============================================================================
// findMappedExclusionGroups / exclusionGroupSumInfo
// ============================================================================

/// Find exclusion groups with cell indices mapped to positions in the
/// `cells` array.
///
/// Mirrors JS `HandlerUtil.findMappedExclusionGroups`.
pub(crate) fn find_mapped_exclusion_groups(
    cells: &[CellIndex],
    cell_exclusions: &CellExclusions,
    num_cells: usize,
) -> ExclusionGroupData {
    let data = find_exclusion_groups(cells, cell_exclusions);

    let mut cell_to_index = vec![0usize; num_cells];
    for (i, &c) in cells.iter().enumerate() {
        cell_to_index[c as usize] = i;
    }

    let mapped_groups: Vec<Vec<CellIndex>> = data
        .groups
        .into_iter()
        .map(|group| {
            group
                .iter()
                .map(|&c| cell_to_index[c as usize] as CellIndex)
                .collect()
        })
        .collect();

    ExclusionGroupData {
        groups: mapped_groups,
        sum_of_squares: data.sum_of_squares,
    }
}

/// Compute sum range info from exclusion groups.
///
/// Mirrors JS `HandlerUtil.exclusionGroupSumInfo`.
pub(crate) fn exclusion_group_sum_info(
    groups: &[Vec<CellIndex>],
    num_values: u8,
    value_offset: i8,
) -> ExclusionGroupSumInfo {
    let mut range: i32 = 0;
    let mut min: i32 = 0;
    let mut total_cells: i32 = 0;

    for g in groups {
        let s = g.len() as i32;
        range += (num_values as i32 - s) * s;
        min += (s * (s + 1)) >> 1;
        total_cells += s;
    }
    min += total_cells * value_offset as i32;

    ExclusionGroupSumInfo {
        range,
        min,
        max: range + min,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expose_hidden_singles() {
        let mut grid = [CandidateSet::EMPTY; 81];
        grid[0] = CandidateSet::from_raw(0b111); // {1,2,3}
        grid[1] = CandidateSet::from_raw(0b110); // {2,3}
        grid[2] = CandidateSet::from_raw(0b1100); // {3,4}
        let cells = [0u8, 1, 2];
        let hidden = CandidateSet::from_value(1);
        assert!(expose_hidden_singles(&mut grid, &cells, hidden));
        assert_eq!(grid[0], CandidateSet::from_value(1));
    }

    #[test]
    fn test_find_exclusion_groups_same_row() {
        let row: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[row]);
        let data = find_exclusion_groups(&[0, 1, 2], &ce);
        assert_eq!(
            data.groups.len(),
            1,
            "Cells in same row should be one group"
        );
        assert_eq!(data.groups[0].len(), 3);
    }

    #[test]
    fn test_find_exclusion_groups_separate() {
        let ce = CellExclusions::new(); // 81 cells, no exclusions
        let data = find_exclusion_groups(&[0, 40, 80], &ce);
        assert_eq!(
            data.groups.len(),
            3,
            "Unrelated cells should be separate groups"
        );
    }

    #[test]
    fn test_exclusion_group_sum_info_basic() {
        let groups = vec![vec![0u8, 1, 2]];
        let info = exclusion_group_sum_info(&groups, 9, 0);
        assert_eq!(info.min, 6); // 3*4/2
        assert_eq!(info.range, 18); // (9-3)*3
        assert_eq!(info.max, 24);
    }
}
