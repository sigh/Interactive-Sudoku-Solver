//! Required-values optimizer phase.
//!
//! Finds forced/forbidden values via combinatorial DFS, creates
//! GivenCandidates restrictions.

use std::collections::HashMap;

use super::util::elementary_symmetric_sum;
use super::OptimizerCtx;
use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::handlers::required_values::ValueCounts;
use crate::handlers::util::handler_util::find_mapped_exclusion_groups;
use crate::handlers::{ConstraintHandler, False, GivenCandidates, RequiredValues};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::handler_set::HandlerSet;

/// Find forced/forbidden values via combinatorial DFS, create GivenCandidates.
///
/// Mirrors JS `_optimizeRequiredValues`.
pub(super) fn optimize_required_values(
    hs: &mut HandlerSet,
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) {
    let rv_info: Vec<(usize, Vec<CellIndex>, Vec<u8>, ValueCounts)> = hs
        .get_all_of_type::<RequiredValues>()
        .iter()
        .map(|&(idx, h)| {
            (
                idx,
                h.cells().to_vec(),
                h.values().to_vec(),
                h.value_counts().clone(),
            )
        })
        .collect();

    if rv_info.is_empty() {
        return;
    }

    let all_values_mask: u16 = (1u16 << hs.shape.num_values) - 1;

    for (idx, cells, values, value_counts) in &rv_info {
        let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();
        let mut eg_data =
            find_mapped_exclusion_groups(cells, cell_exclusions, hs.shape.num_cells as usize);
        // Sort groups by size.
        eg_data.groups.sort_by_key(|g| g.len());

        let mut invalid = false;

        for (value, count) in value_counts.iter() {
            if count > 1 {
                if !find_known_required_values(
                    cells,
                    value,
                    count as usize,
                    cell_exclusions,
                    &mut restrictions,
                    &eg_data.groups,
                ) {
                    invalid = true;
                    break;
                }
            }
        }

        if invalid {
            let false_handler = False::new(cells.clone());
            ctx.log_replace("_optimizeRequiredValues", &false_handler, None);
            hs.replace(*idx, Box::new(false_handler));
            continue;
        }

        if restrictions.is_empty() {
            continue;
        }

        let value_mask: u16 = {
            let mut m = 0u16;
            for &v in values {
                m |= 1u16 << (v - 1);
            }
            m
        };

        let mut new_values = values.clone();
        let mut new_cells = cells.clone();
        let mut given_map: HashMap<CellIndex, CandidateSet> = HashMap::new();

        for (&cell, &v) in &restrictions {
            let values_arr: Vec<u8> = (1..=hs.shape.num_values)
                .filter(|&val| v & (1u16 << (val - 1)) != 0)
                .collect();

            given_map.insert(cell, CandidateSet::from_raw(v & all_values_mask));

            if values_arr.len() == 1 {
                // Remove only the FIRST occurrence of the value, mirroring
                // JS `arrayRemoveValue` which uses indexOf/splice (removes only
                // one element). Using `retain` would remove ALL occurrences,
                // incorrectly dropping the remaining sub-constraint.
                if let Some(pos) = new_values.iter().position(|&x| x == values_arr[0]) {
                    new_values.remove(pos);
                }
                new_cells.retain(|&c| c != cell);
            }
            if v & value_mask == 0 {
                new_cells.retain(|&c| c != cell);
            }
        }

        // Create GivenCandidates handler to restrict values.
        if !given_map.is_empty() {
            let gc_values: Vec<(CellIndex, CandidateSet)> = given_map.into_iter().collect();
            let gc = GivenCandidates::new(gc_values);
            ctx.log_add_handler("_optimizeRequiredValues", &gc, None, false);
            hs.add_essential(Box::new(gc));
        }

        // Update the RequiredValues handler if cells were removed.
        if new_values.is_empty() {
            hs.delete(*idx);
        } else if new_cells.len() != cells.len() {
            let new_handler = RequiredValues::new(new_cells, new_values, false);
            ctx.log_replace("_optimizeRequiredValues", &new_handler, None);
            hs.replace(*idx, Box::new(new_handler));
        }
    }
}

/// Find values which must or must not be in certain cells.
///
/// DFS over exclusion groups, counting how many valid placements exist
/// for `count` copies of `value` among the cells.
///
/// Returns false if no valid combination exists (infeasible).
///
/// Mirrors JS `_findKnownRequiredValues`.
fn find_known_required_values(
    cells: &[CellIndex],
    value: u8,
    count: usize,
    cell_exclusions: &CellExclusions,
    restrictions: &mut HashMap<CellIndex, u16>,
    exclusion_groups: &[Vec<u8>],
) -> bool {
    let num_cells = cells.len();
    let num_groups = exclusion_groups.len();
    if count > num_groups {
        return false;
    }

    // Complexity estimation.
    let group_sizes: Vec<usize> = exclusion_groups.iter().map(|g| g.len()).collect();
    let max_nodes = 120.0;
    if elementary_symmetric_sum(&group_sizes, count) > max_nodes {
        return true;
    }

    let mut occurrences = vec![0i32; num_cells];
    let mut num_combinations: i32 = 0;

    // DFS with stack.
    const STATE_INITIAL: i16 = -2;
    const STATE_SKIP: i16 = -1;

    // Use 256-bit bitsets for forbidden cells instead of HashSets.
    // Each bitset is [u64; 4] = 32 bytes (vs HashSet allocation + hashing).
    type CellBits = [u64; 4];

    #[inline(always)]
    fn bits_set(set: &mut CellBits, cell: CellIndex) {
        set[cell as usize >> 6] |= 1u64 << (cell & 63);
    }
    #[inline(always)]
    fn bits_has(set: &CellBits, cell: CellIndex) -> bool {
        (set[cell as usize >> 6] >> (cell & 63)) & 1 != 0
    }

    let mut stack = vec![0i16; num_groups];
    if num_groups > 0 {
        stack[0] = STATE_INITIAL;
    }
    let mut stack_depth: isize = 0;
    let mut picked_counts = vec![0usize; num_groups + 1];
    // Forbidden cells at each depth (bitset instead of HashSet).
    let mut forbidden: Vec<CellBits> = vec![[0u64; 4]; num_groups + 1];

    while stack_depth >= 0 {
        let group_index = stack_depth as usize;
        let group = &exclusion_groups[group_index];

        let mut choice = stack[group_index] + 1;

        if choice == STATE_SKIP + 1 {
            // STATE_INITIAL + 1 = -1 = STATE_SKIP
        }

        if choice == STATE_SKIP {
            let remaining_groups = num_groups - 1 - group_index;
            if picked_counts[group_index] + remaining_groups < count {
                choice += 1; // Can't skip.
            }
        }

        if choice >= 0 {
            let forbidden_set = &forbidden[group_index];
            while (choice as usize) < group.len() {
                let cell_index = group[choice as usize] as usize;
                if !bits_has(forbidden_set, cells[cell_index]) {
                    break;
                }
                choice += 1;
            }
        }

        // choice == -1 means SKIP. In Rust, `(-1i16) as usize == usize::MAX`
        // so we MUST guard with `choice >= 0` before the unsigned comparison —
        // otherwise a skip choice would incorrectly trigger backtracking.
        // Mirrors JS `if (choice >= group.length)` which is correctly false for -1.
        if choice >= 0 && (choice as usize) >= group.len() {
            stack_depth -= 1;
            continue;
        }

        stack[group_index] = choice;

        let mut next_picked_count = picked_counts[group_index];
        if choice >= 0 {
            next_picked_count += 1;
        }

        if next_picked_count == count {
            num_combinations += 1;
            for i in 0..=group_index {
                let c = stack[i];
                if c >= 0 {
                    occurrences[exclusion_groups[i][c as usize] as usize] += 1;
                }
            }
        } else {
            let next_depth = group_index + 1;
            if next_depth < num_groups {
                picked_counts[next_depth] = next_picked_count;
                forbidden[next_depth] = forbidden[group_index];
                if choice >= 0 {
                    let cell_index = group[choice as usize] as usize;
                    let cell = cells[cell_index];
                    for &excl_cell in &cell_exclusions.sets[cells[cell_index] as usize] {
                        bits_set(&mut forbidden[next_depth], excl_cell);
                    }
                    // Also add the cell itself to forbidden.
                    bits_set(&mut forbidden[next_depth], cell);
                }
                stack[next_depth] = STATE_INITIAL;
                stack_depth += 1;
            }
        }
    }

    if num_combinations == 0 {
        return false;
    }

    let v_mask = 1u16 << (value - 1);
    for i in 0..num_cells {
        if occurrences[i] == num_combinations {
            // Cell must contain this value.
            let entry = restrictions.entry(cells[i]).or_insert(!0u16);
            *entry &= v_mask;
        } else if occurrences[i] == 0 {
            // Cell must NOT contain this value.
            let entry = restrictions.entry(cells[i]).or_insert(!0u16);
            *entry &= !v_mask;
        }
    }

    true
}
