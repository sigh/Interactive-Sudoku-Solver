#[cfg(test)]
use super::*;

#[cfg(test)]
use crate::api::types::CellIndex;
#[cfg(test)]
use crate::grid_shape::GridShape;
#[cfg(test)]
use crate::handlers::sum::Sum;
#[cfg(test)]
use crate::handlers::util::handler_util::{
    exclusion_group_sum_info as hu_exclusion_group_sum_info,
    find_exclusion_groups as hu_find_exclusion_groups,
    find_mapped_exclusion_groups as hu_find_mapped_exclusion_groups,
};
#[cfg(test)]
use crate::handlers::{
    AllDifferent, AllDifferentType, BinaryConstraint, False, FullGridRequiredValues,
    GivenCandidates, House, RequiredValues, SameValuesIgnoreCount, True,
};
#[cfg(test)]
use crate::solver::cell_exclusions::CellExclusions;
#[cfg(test)]
use crate::solver::handler_set::HandlerSet;
#[cfg(test)]
use std::collections::{HashMap, HashSet};

/// Build 9×9 sudoku cell exclusions (rows + cols + boxes).
#[cfg(test)]
fn sudoku_9x9_cell_exclusions() -> CellExclusions {
    let mut groups: Vec<Vec<CellIndex>> = Vec::new();
    for r in 0..9u8 {
        groups.push((0..9u8).map(|c| r * 9 + c).collect());
    }
    for c in 0..9u8 {
        groups.push((0..9u8).map(|r| r * 9 + c).collect());
    }
    for br in 0..3u8 {
        for bc in 0..3u8 {
            let mut group = Vec::new();
            for r in 0..3u8 {
                for c in 0..3u8 {
                    group.push((br * 3 + r) * 9 + (bc * 3 + c));
                }
            }
            groups.push(group);
        }
    }
    CellExclusions::from_exclusion_groups(&groups)
}

/// Regression: `optimize_required_values` must NOT create a False handler for a
/// valid `ContainExact~6_6` constraint (cells R6C9, R7C8, R8C7, R9C6 in a 9×9
/// sudoku).
///
/// These cells have exactly one mutual-exclusion pair (R7C8 ↔ R8C7 in box 9),
/// producing 3 exclusion groups with 5 valid placements for count=2 → no infeasibility.
#[test]
fn test_optimize_required_values_6_6_diagonal_no_false() {
    // Cells: R6C9=53, R7C8=61, R8C7=69, R9C6=77 (0-indexed, row*(9)+col).
    let cells: Vec<CellIndex> = vec![53, 61, 69, 77];
    let rv = RequiredValues::new(cells, vec![6, 6], true);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(rv)];
    let mut hs = HandlerSet::new(handlers, GridShape::default_9x9());

    let ce = sudoku_9x9_cell_exclusions();
    let mut ctx = OptimizerCtx::new(9);
    required_values::optimize_required_values(&mut hs, &ce, &mut ctx);

    let falses = hs.get_all_of_type::<crate::handlers::False>();
    assert_eq!(
        falses.len(),
        0,
        "ContainExact~6_6 on R6C9,R7C8,R8C7,R9C6 must not be replaced with False"
    );
}

#[test]
fn test_exclusion_group_sum_info() {
    // Single group of 3 cells: min = 1+2+3=6, range = (9-3)*3=18, max = 24.
    let groups = vec![vec![0, 1, 2]];
    let info = hu_exclusion_group_sum_info(&groups, 9);
    assert_eq!(info.min, 6);
    assert_eq!(info.range, 18);
    assert_eq!(info.max, 24);
}

#[test]
fn test_find_exclusion_groups_greedy() {
    // Cells 0..9 all mutually exclusive (a house row).
    let house: Vec<CellIndex> = (0..9).collect();
    let ce = CellExclusions::from_exclusion_groups(&[house.clone()]);
    let eg_data = hu_find_exclusion_groups(&[0, 1, 2], &ce);
    // All 3 cells should be in one group since they're mutually exclusive.
    assert_eq!(eg_data.groups.len(), 1);
    assert_eq!(eg_data.groups[0].len(), 3);
}

#[test]
fn test_find_exclusion_groups_non_exclusive() {
    // Cells 0,1 are exclusive but 2 is not exclusive with either.
    let mut ce = CellExclusions::new();
    ce.add_mutual_exclusion(0, 1);
    let eg_data = hu_find_exclusion_groups(&[0, 1, 2], &ce);
    // Should get 2 groups: {0,1} and {2}.
    assert_eq!(eg_data.groups.len(), 2);
}

#[test]
fn test_add_house_handlers() {
    // Create a 9-cell AllDifferent — should get promoted to House.
    let cells: Vec<CellIndex> = (0..9).collect();
    let ad = AllDifferent::new(cells, AllDifferentType::WithExclusionCells);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(ad)];
    let mut hs = HandlerSet::new(handlers, GridShape::default_9x9());
    let mut ctx = OptimizerCtx::new(9);
    house::add_house_handlers(&mut hs, &mut ctx);

    let houses = hs.get_all_of_type::<House>();
    assert_eq!(houses.len(), 1);
}

#[test]
fn test_replace_1_cell_sum() {
    // A 1-cell sum with sum=5 should become GivenCandidates.
    let sum = Sum::new_cage(vec![0], 5);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum)];
    let mut hs = HandlerSet::new(handlers, GridShape::default_9x9());
    let ce = CellExclusions::new();
    let mut ctx = OptimizerCtx::new(9);
    sums::replace_size_specific_sum_handlers(&mut hs, &ce, &mut ctx);

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
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum)];
    let mut hs = HandlerSet::new(handlers, GridShape::default_9x9());
    let mut ctx = OptimizerCtx::new(9);
    sums::replace_size_specific_sum_handlers(&mut hs, &ce, &mut ctx);

    let bcs = hs.get_all_of_type::<BinaryConstraint>();
    assert_eq!(bcs.len(), 1);
    let sums = hs.get_all_of_type::<Sum>();
    assert_eq!(sums.len(), 0);
}

/// When a value appears N times in a RequiredValues handler and one cell is
/// forced to that value by exclusions, only ONE occurrence is removed —
/// leaving N-1 still required.
///
/// Regression test for the bug where `retain` removed ALL occurrences instead
/// of one (mirroring JS `arrayRemoveValue` which uses indexOf/splice).
#[test]
fn test_optimize_required_values_removes_only_one_occurrence() {
    use crate::handlers::RequiredValues;

    // Cells 0, 1, 2.  Cells 0 and 1 are mutually exclusive.
    // RequiredValues: value 1 must appear exactly TWICE among the 3 cells.
    //
    // Exclusion groups: {0,1} and {2}.
    // Valid placements of two 1s: {0,2} and {1,2}.
    // Cell 2 is in EVERY combination → forced to 1.
    //
    // After optimising:
    //   - GivenCandidates restricts cell 2 to {1}.
    //   - RequiredValues([0,1], [1]) remains (one more 1 still required).
    let rv = RequiredValues::new(vec![0, 1, 2], vec![1, 1], true);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(rv)];
    let mut hs = HandlerSet::new(handlers, GridShape::default_9x9());

    let mut ce = CellExclusions::new();
    ce.add_mutual_exclusion(0, 1);

    let mut ctx = OptimizerCtx::new(9);
    required_values::optimize_required_values(&mut hs, &ce, &mut ctx);

    // One GivenCandidates should have been added.
    let gcs = hs.get_all_of_type::<GivenCandidates>();
    assert_eq!(gcs.len(), 1, "expected one GivenCandidates for cell 2");

    // The RequiredValues should now cover cells [0,1] with value list [1].
    let rvs = hs.get_all_of_type::<RequiredValues>();
    assert_eq!(rvs.len(), 1, "expected remaining RequiredValues to survive");
    let (_, rv) = rvs[0];
    assert_eq!(rv.values().len(), 1, "one occurrence of 1 should remain");
    assert_eq!(rv.values()[0], 1);
    assert_eq!(rv.cells().len(), 2, "cell 2 should be removed");
}

/// When all N cells are forced (every cell required in every combo), the
/// RequiredValues handler should be deleted entirely.
#[test]
fn test_optimize_required_values_all_forced_deletes_handler() {
    use crate::handlers::RequiredValues;

    // 3 cells, no exclusions.  Value 1 must appear 3 times.
    // The only valid combination is all 3 cells → every cell forced.
    // After optimising: 3 GivenCandidates entries (merged into one handler),
    // RequiredValues deleted.
    let rv = RequiredValues::new(vec![0, 1, 2], vec![1, 1, 1], true);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(rv)];
    let mut hs = HandlerSet::new(handlers, GridShape::default_9x9());

    let ce = CellExclusions::new();
    let mut ctx = OptimizerCtx::new(9);
    required_values::optimize_required_values(&mut hs, &ce, &mut ctx);

    let rvs = hs.get_all_of_type::<RequiredValues>();
    assert_eq!(
        rvs.len(),
        0,
        "RequiredValues should be deleted when all cells forced"
    );

    let gcs = hs.get_all_of_type::<GivenCandidates>();
    assert_eq!(gcs.len(), 1, "GivenCandidates should cover forced cells");
}

// ============================================================================
// find_known_required_values tests
// ============================================================================

/// Helper: create a CellExclusions with only the given mutual exclusions.
#[cfg(test)]
fn excl_from_pairs(num_cells: usize, pairs: &[(CellIndex, CellIndex)]) -> CellExclusions {
    let _ = num_cells;
    let mut ce = CellExclusions::new();
    for &(a, b) in pairs {
        ce.add_mutual_exclusion(a, b);
    }
    ce
}

/// Helper: get mapped exclusion groups for testing (mirrors JS findMappedExclusionGroups).
#[cfg(test)]
fn mapped_groups(cells: &[CellIndex], ce: &CellExclusions, num_cells: usize) -> Vec<Vec<u8>> {
    let mut eg = hu_find_mapped_exclusion_groups(cells, ce, num_cells);
    eg.groups.sort_by_key(|g| g.len());
    eg.groups
}

#[test]
fn test_find_required_values_simple_exclusion() {
    let ce = excl_from_pairs(3, &[(0, 1)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 2, &ce, &mut restrictions, &groups);
    assert!(result);

    let v = 1u16 << 0; // value 1 mask
    assert_eq!(restrictions.get(&2), Some(&v));
    assert!(!restrictions.contains_key(&0));
    assert!(!restrictions.contains_key(&1));
}

#[test]
fn test_find_required_values_forced() {
    let ce = excl_from_pairs(3, &[(0, 1), (1, 2)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 2, &ce, &mut restrictions, &groups);
    assert!(result);

    let v = 1u16 << 0;
    assert_eq!(restrictions.get(&0), Some(&v));
    assert_eq!(restrictions.get(&2), Some(&v));
    assert_eq!(restrictions.get(&1), Some(&!v));
}

#[test]
fn test_find_required_values_no_restrictions() {
    let ce = excl_from_pairs(3, &[]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 2, &ce, &mut restrictions, &groups);
    assert!(result);
    assert!(restrictions.is_empty());
}

#[test]
fn test_find_required_values_all_required() {
    let ce = excl_from_pairs(3, &[]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 3, &ce, &mut restrictions, &groups);
    assert!(result);

    let v = 1u16 << 0;
    assert_eq!(restrictions.get(&0), Some(&v));
    assert_eq!(restrictions.get(&1), Some(&v));
    assert_eq!(restrictions.get(&2), Some(&v));
}

#[test]
fn test_find_required_values_impossible() {
    let ce = excl_from_pairs(3, &[(0, 1), (1, 2), (0, 2)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 2, &ce, &mut restrictions, &groups);
    assert!(!result);
}

#[test]
fn test_find_required_values_max_iterations_exceeded() {
    let ce = excl_from_pairs(12, &[]);
    let cells: Vec<CellIndex> = (0..12).collect();
    let groups = mapped_groups(&cells, &ce, 12);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    // 12C6 = 924 > max_nodes (120) — should abort and return true with no restrictions.
    let result =
        required_values::find_known_required_values(&cells, 1, 6, &ce, &mut restrictions, &groups);
    assert!(result);
    assert!(restrictions.is_empty());
}

#[test]
fn test_find_required_values_merge_existing_restrictions() {
    let ce = excl_from_pairs(3, &[(0, 1), (1, 2)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let v = 1u16 << 0; // value 1
    let other_val = 1u16 << 1; // value 2

    restrictions.insert(0, v | other_val);
    restrictions.insert(2, other_val);

    let result =
        required_values::find_known_required_values(&cells, 1, 2, &ce, &mut restrictions, &groups);
    assert!(result);

    // Cell 0: (v | other_val) & v => v.
    assert_eq!(restrictions.get(&0), Some(&v));
    // Cell 2: other_val & v => 0.
    assert_eq!(restrictions.get(&2), Some(&0));
    // Cell 1: !0u16 & !v => !v.
    assert_eq!(restrictions.get(&1), Some(&!v));
}

#[test]
fn test_find_required_values_partial_overlap() {
    let ce = excl_from_pairs(4, &[(0, 1)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2, 3];
    let groups = mapped_groups(&cells, &ce, 4);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 3, &ce, &mut restrictions, &groups);
    assert!(result);

    let v = 1u16 << 0;
    assert_eq!(restrictions.get(&2), Some(&v));
    assert_eq!(restrictions.get(&3), Some(&v));
    assert!(!restrictions.contains_key(&0));
    assert!(!restrictions.contains_key(&1));
}

#[test]
fn test_find_required_values_count_greater_than_cells() {
    let ce = excl_from_pairs(3, &[]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 4, &ce, &mut restrictions, &groups);
    assert!(!result);
}

#[test]
fn test_find_required_values_count_greater_than_groups() {
    let ce = excl_from_pairs(4, &[(0, 1), (2, 3)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2, 3];
    let groups = mapped_groups(&cells, &ce, 4);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    // 2 groups of size 2, max pickable = 2, but count = 3.
    let result =
        required_values::find_known_required_values(&cells, 1, 3, &ce, &mut restrictions, &groups);
    assert!(!result);
}

#[test]
fn test_find_required_values_must_pick_from_all_groups() {
    let ce = excl_from_pairs(3, &[]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let groups = mapped_groups(&cells, &ce, 3);
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    let result =
        required_values::find_known_required_values(&cells, 1, 3, &ce, &mut restrictions, &groups);
    assert!(result);

    let v = 1u16 << 0;
    assert_eq!(restrictions.get(&0), Some(&v));
    assert_eq!(restrictions.get(&1), Some(&v));
    assert_eq!(restrictions.get(&2), Some(&v));
}

#[test]
fn test_find_required_values_suboptimal_grouping() {
    let ce = excl_from_pairs(3, &[(1, 2)]);
    let cells: Vec<CellIndex> = vec![0, 1, 2];
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    // Manually provide suboptimal groups: {0}, {1}, {2}.
    let exclusion_groups = vec![vec![0u8], vec![1u8], vec![2u8]];

    let result = required_values::find_known_required_values(
        &cells,
        1,
        2,
        &ce,
        &mut restrictions,
        &exclusion_groups,
    );
    assert!(result);

    let v = 1u16 << 0;
    assert_eq!(restrictions.get(&0), Some(&v));
    assert!(!restrictions.contains_key(&1));
    assert!(!restrictions.contains_key(&2));
}

#[test]
fn test_find_required_values_empty_group() {
    let ce = excl_from_pairs(2, &[]);
    let cells: Vec<CellIndex> = vec![0, 1];
    let mut restrictions: HashMap<CellIndex, u16> = HashMap::new();

    // Manually provide groups with an empty group.
    let exclusion_groups: Vec<Vec<u8>> = vec![vec![0], vec![], vec![1]];

    let result = required_values::find_known_required_values(
        &cells,
        1,
        1,
        &ce,
        &mut restrictions,
        &exclusion_groups,
    );
    assert!(result);
    assert!(restrictions.is_empty());
}

// ============================================================================
// replace_size_specific_sum_handlers tests
// ============================================================================

#[test]
fn test_replace_numvalues_sum_mutually_exclusive_true_or_false() {
    let shape = GridShape::default_9x9();
    let cells: Vec<CellIndex> = (0..9).collect();

    // All cells mutually exclusive.
    let mut ce = CellExclusions::new();
    for i in 0..cells.len() {
        for j in (i + 1)..cells.len() {
            ce.add_mutual_exclusion(cells[i], cells[j]);
        }
    }

    // Sum == maxSum → True.
    {
        let sum = Sum::new_cage(cells.clone(), shape.max_sum);
        let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum)];
        let mut hs = HandlerSet::new(handlers, shape);
        let mut ctx = OptimizerCtx::new(9);
        sums::replace_size_specific_sum_handlers(&mut hs, &ce, &mut ctx);

        assert_eq!(hs.get_all_of_type::<Sum>().len(), 0);
        assert_eq!(hs.get_all_of_type::<True>().len(), 1);
        assert_eq!(hs.get_all_of_type::<False>().len(), 0);
    }

    // Sum != maxSum → False.
    {
        let sum = Sum::new_cage(cells.clone(), shape.max_sum - 1);
        let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum)];
        let mut hs = HandlerSet::new(handlers, shape);
        let mut ctx = OptimizerCtx::new(9);
        sums::replace_size_specific_sum_handlers(&mut hs, &ce, &mut ctx);

        assert_eq!(hs.get_all_of_type::<Sum>().len(), 0);
        assert_eq!(hs.get_all_of_type::<True>().len(), 0);
        assert_eq!(hs.get_all_of_type::<False>().len(), 1);
    }
}

// ============================================================================
// fill_in_sum_gap tests
// ============================================================================

#[cfg(test)]
fn all_cells(shape: GridShape) -> Vec<CellIndex> {
    (0..shape.num_cells as CellIndex).collect()
}

#[test]
fn test_fill_in_sum_gap_all_cells_covered() {
    let shape = GridShape::default_9x9();
    let mut sum_cells: HashSet<CellIndex> = all_cells(shape).into_iter().collect();
    let mut non_overlapping: Vec<usize> = Vec::new();
    let mut hs = HandlerSet::new(vec![], shape);
    let mut ctx = OptimizerCtx::new(9);

    let before = hs.get_all_of_type::<Sum>().len();
    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);
    let after = hs.get_all_of_type::<Sum>().len();
    assert_eq!(after, before);
}

#[test]
fn test_fill_in_sum_gap_gap_too_large() {
    let shape = GridShape::default_9x9();
    // Only 72 cells covered, gap is 9 (>= numValues).
    let mut sum_cells: HashSet<CellIndex> = (0..72).collect();
    let mut non_overlapping: Vec<usize> = Vec::new();
    let mut hs = HandlerSet::new(vec![], shape);
    let mut ctx = OptimizerCtx::new(9);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);
    assert_eq!(hs.get_all_of_type::<Sum>().len(), 0);
}

#[test]
fn test_fill_in_sum_gap_creates_handler_for_small_gap() {
    let shape = GridShape::default_9x9();
    // Cover 78 cells, leave 3 uncovered (cells 78, 79, 80).
    let covered: Vec<CellIndex> = (0..78).collect();
    let mut sum_cells: HashSet<CellIndex> = covered.iter().copied().collect();

    // Total grid sum for 9x9 = 9 * 45 = 405.
    // Covered sum = 405 - 6 = 399 (assuming uncovered cells sum to 6).
    let sum_handler = Sum::new_cage(covered, 399);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    assert_eq!(sums.len(), 2); // Original + new gap handler.
                               // Find the new one (3 cells).
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 3).unwrap().1;
    assert_eq!(gap_handler.sum(), 6);
    assert_eq!(sum_cells.len(), 81);
}

#[test]
fn test_fill_in_sum_gap_4x6_grid() {
    let shape = GridShape::new(4, 6).unwrap();
    // 4x6: 24 cells, numValues=6, maxSum=21, total=4*21=84.
    let covered: Vec<CellIndex> = (0..22).collect();
    let mut sum_cells: HashSet<CellIndex> = covered.iter().copied().collect();

    let sum_handler = Sum::new_cage(covered, 84 - 11);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 2).unwrap().1;
    assert_eq!(gap_handler.sum(), 11);
    let mut gap_cells: Vec<CellIndex> = gap_handler.cells().to_vec();
    gap_cells.sort();
    assert_eq!(gap_cells, vec![22, 23]);
}

#[test]
fn test_fill_in_sum_gap_6x4_grid() {
    let shape = GridShape::new(6, 4).unwrap();
    // 6x4: 24 cells, numValues=6, maxSum=21, total=4*21=84.
    let covered: Vec<CellIndex> = (0..20).collect();
    let mut sum_cells: HashSet<CellIndex> = covered.iter().copied().collect();

    let sum_handler = Sum::new_cage(covered, 84 - 14);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 4).unwrap().1;
    assert_eq!(gap_handler.sum(), 14);
}

#[test]
fn test_fill_in_sum_gap_6x8_grid() {
    let shape = GridShape::new(6, 8).unwrap();
    // 6x8: 48 cells, numValues=8, maxSum=36, total=6*36=216.
    let covered: Vec<CellIndex> = (0..45).collect();
    let mut sum_cells: HashSet<CellIndex> = covered.iter().copied().collect();

    let sum_handler = Sum::new_cage(covered, 216 - 15);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 3).unwrap().1;
    assert_eq!(gap_handler.sum(), 15);
}

#[test]
fn test_fill_in_sum_gap_multiple_handlers() {
    let shape = GridShape::default_9x9();
    // Total = 405. Three handlers covering different regions.
    let cells1: Vec<CellIndex> = (0..27).collect();
    let cells2: Vec<CellIndex> = (27..54).collect();
    let cells3: Vec<CellIndex> = (54..76).collect();

    let mut sum_cells: HashSet<CellIndex> = HashSet::new();
    for &c in cells1.iter().chain(cells2.iter()).chain(cells3.iter()) {
        sum_cells.insert(c);
    }

    let h1 = Sum::new_cage(cells1, 135);
    let h2 = Sum::new_cage(cells2, 135);
    let h3 = Sum::new_cage(cells3, 110);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> =
        vec![Box::new(h1), Box::new(h2), Box::new(h3)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 5).unwrap().1;
    assert_eq!(gap_handler.sum(), 25);
}

#[test]
fn test_fill_in_sum_gap_single_cell() {
    let shape = GridShape::default_9x9();
    let covered: Vec<CellIndex> = (0..80).collect();
    let mut sum_cells: HashSet<CellIndex> = covered.iter().copied().collect();

    let sum_handler = Sum::new_cage(covered, 400);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 1).unwrap().1;
    assert_eq!(gap_handler.sum(), 5);
    assert_eq!(gap_handler.cells(), &[80]);
}

#[test]
fn test_fill_in_sum_gap_numvalues_minus_1() {
    let shape = GridShape::default_9x9();
    // Gap of 8 cells (numValues-1).
    let covered: Vec<CellIndex> = (0..73).collect();
    let mut sum_cells: HashSet<CellIndex> = covered.iter().copied().collect();

    let remaining_sum = 36;
    let sum_handler = Sum::new_cage(covered, 405 - remaining_sum);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let mut hs = HandlerSet::new(handlers, shape);
    let mut non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    sums::fill_in_sum_gap(&mut non_overlapping, &mut sum_cells, &mut hs, &mut ctx);

    let sums = hs.get_all_of_type::<Sum>();
    let gap_handler = sums.iter().find(|(_, s)| s.cells().len() == 8).unwrap().1;
    assert_eq!(gap_handler.sum(), remaining_sum);
}

// ============================================================================
// overlap_regions tests
// ============================================================================

#[test]
fn test_overlap_regions_square_9x9() {
    let shape = GridShape::default_9x9();
    let regions = util::overlap_regions(shape, &[]);

    // 4 region sets: rows, rows reversed, cols, cols reversed.
    assert_eq!(regions.len(), 4);
    assert_eq!(regions[0].len(), 9);
    assert_eq!(regions[2].len(), 9);
}

#[test]
fn test_overlap_regions_4x6_rows_only() {
    let shape = GridShape::new(4, 6).unwrap();
    let regions = util::overlap_regions(shape, &[]);

    // numValues=6, numCols=6 → rows are houses. numRows=4 → cols are NOT houses.
    assert_eq!(regions.len(), 2); // rows forward + rows reversed
    assert_eq!(regions[0].len(), 4); // 4 rows
    assert_eq!(regions[0][0].len(), 6); // 6 cells per row
}

#[test]
fn test_overlap_regions_6x4_cols_only() {
    let shape = GridShape::new(6, 4).unwrap();
    let regions = util::overlap_regions(shape, &[]);

    // numValues=6, numRows=6 → cols are houses. numCols=4 → rows are NOT houses.
    assert_eq!(regions.len(), 2); // cols forward + cols reversed
    assert_eq!(regions[0].len(), 4); // 4 columns
    assert_eq!(regions[0][0].len(), 6); // 6 cells per column
}

#[test]
fn test_overlap_regions_5x7_rows_only() {
    let shape = GridShape::new(5, 7).unwrap();
    let regions = util::overlap_regions(shape, &[]);

    // numValues=7, numCols=7 → rows are houses. numRows=5 → cols are NOT.
    assert_eq!(regions.len(), 2);
    assert_eq!(regions[0].len(), 5); // 5 rows
    assert_eq!(regions[0][0].len(), 7); // 7 cells per row
}

// ============================================================================
// optimize_non_square_grids tests
// ============================================================================

#[test]
fn test_non_square_8x9_adds_aux() {
    let shape = GridShape::new(8, 9).unwrap();
    let mut handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = Vec::new();

    // Add AllDifferent for all rows and columns.
    for r in 0..shape.num_rows as usize {
        let cells: Vec<CellIndex> = shape.row_cells(r).iter().map(|&c| c as CellIndex).collect();
        handlers.push(Box::new(AllDifferent::new(
            cells,
            AllDifferentType::WithExclusionCells,
        )));
    }
    for c in 0..shape.num_cols as usize {
        let cells: Vec<CellIndex> = shape.col_cells(c).iter().map(|&c| c as CellIndex).collect();
        handlers.push(Box::new(AllDifferent::new(
            cells,
            AllDifferentType::WithExclusionCells,
        )));
    }

    let mut hs = HandlerSet::new(handlers, shape);
    let mut ctx = OptimizerCtx::new(shape.num_values);
    non_square::optimize_non_square_grids(&mut hs, &[], &mut ctx);

    let added = hs.get_all_of_type::<FullGridRequiredValues>();
    assert_eq!(added.len(), 1);
}

#[test]
fn test_non_square_8x9_numvalues_10_skips() {
    let shape = GridShape::new(8, 9).unwrap().with_num_values(10).unwrap();
    let mut handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = Vec::new();

    for r in 0..shape.num_rows as usize {
        let cells: Vec<CellIndex> = shape.row_cells(r).iter().map(|&c| c as CellIndex).collect();
        handlers.push(Box::new(AllDifferent::new(
            cells,
            AllDifferentType::WithExclusionCells,
        )));
    }
    for c in 0..shape.num_cols as usize {
        let cells: Vec<CellIndex> = shape.col_cells(c).iter().map(|&c| c as CellIndex).collect();
        handlers.push(Box::new(AllDifferent::new(
            cells,
            AllDifferentType::WithExclusionCells,
        )));
    }

    let mut hs = HandlerSet::new(handlers, shape);
    let mut ctx = OptimizerCtx::new(shape.num_values);
    non_square::optimize_non_square_grids(&mut hs, &[], &mut ctx);

    let added = hs.get_all_of_type::<FullGridRequiredValues>();
    assert_eq!(added.len(), 0);
}

#[test]
fn test_non_square_1x9_skips() {
    let shape = GridShape::new(1, 9).unwrap();
    let mut handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = Vec::new();

    for r in 0..shape.num_rows as usize {
        let cells: Vec<CellIndex> = shape.row_cells(r).iter().map(|&c| c as CellIndex).collect();
        handlers.push(Box::new(AllDifferent::new(
            cells,
            AllDifferentType::WithExclusionCells,
        )));
    }
    for c in 0..shape.num_cols as usize {
        let cells: Vec<CellIndex> = shape.col_cells(c).iter().map(|&c| c as CellIndex).collect();
        handlers.push(Box::new(AllDifferent::new(
            cells,
            AllDifferentType::WithExclusionCells,
        )));
    }

    let mut hs = HandlerSet::new(handlers, shape);
    let mut ctx = OptimizerCtx::new(shape.num_values);
    non_square::optimize_non_square_grids(&mut hs, &[], &mut ctx);

    let added = hs.get_all_of_type::<FullGridRequiredValues>();
    assert_eq!(added.len(), 0);
}

// ============================================================================
// make_innie_outie_sum_handlers tests
// ============================================================================

#[test]
fn test_innie_outie_two_row_coverage() {
    let shape = GridShape::default_9x9();
    let row0: Vec<CellIndex> = (0..9).collect();
    let row1: Vec<CellIndex> = (9..18).collect();

    let h0 = Sum::new_cage(row0, 45);
    let h1 = Sum::new_cage(row1, 45);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> =
        vec![Box::new(h0), Box::new(h1)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    assert!(result
        .iter()
        .all(|h| h.as_any().downcast_ref::<Sum>().is_some()));
}

#[test]
fn test_innie_outie_cage_crossing_house() {
    let shape = GridShape::default_9x9();
    // Cage covering all of row 0 plus cell 9 from row 1.
    let mut cells: Vec<CellIndex> = (0..9).collect();
    cells.push(9);
    let sum_handler = Sum::new_cage(cells, 50);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    assert!(result
        .iter()
        .all(|h| h.as_any().downcast_ref::<Sum>().is_some()));
}

#[test]
fn test_innie_outie_integer_sums() {
    let shape = GridShape::default_9x9();
    let row0: Vec<CellIndex> = (0..9).collect();
    let sum_handler = Sum::new_cage(row0, 45);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(9);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    for h in &result {
        let s = h.as_any().downcast_ref::<Sum>().unwrap();
        assert!(s.sum() == (s.sum() as i32)); // Integer check.
    }
}

#[test]
fn test_innie_outie_4x6_rows_only() {
    let shape = GridShape::new(4, 6).unwrap();
    let row0: Vec<CellIndex> = (0..6).collect();
    let sum_handler = Sum::new_cage(row0, 21);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    assert!(result
        .iter()
        .all(|h| h.as_any().downcast_ref::<Sum>().is_some()));
}

#[test]
fn test_innie_outie_6x4_cols_only() {
    let shape = GridShape::new(6, 4).unwrap();
    // First column: cells 0, 4, 8, 12, 16, 20.
    let col0: Vec<CellIndex> = (0..6).map(|r| r * 4).collect();
    let sum_handler = Sum::new_cage(col0, 21);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    assert!(result
        .iter()
        .all(|h| h.as_any().downcast_ref::<Sum>().is_some()));
}

#[test]
fn test_innie_outie_empty_handlers() {
    let shape = GridShape::default_9x9();
    let hs = HandlerSet::new(vec![], shape);
    let mut ctx = OptimizerCtx::new(9);

    let result = sums::make_innie_outie_sum_handlers(&[], &hs, &[], &mut ctx);
    assert!(result.is_empty());
}

#[test]
fn test_innie_outie_4x4_grid() {
    let shape = GridShape::square(4).unwrap();
    let row0: Vec<CellIndex> = (0..4).collect();
    let sum_handler = Sum::new_cage(row0, 10);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> = vec![Box::new(sum_handler)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    for h in &result {
        let s = h.as_any().downcast_ref::<Sum>().unwrap();
        assert!(s.sum() == (s.sum() as i32));
    }
}

#[test]
fn test_innie_outie_6x6_grid() {
    let shape = GridShape::square(6).unwrap();
    let row0: Vec<CellIndex> = (0..6).collect();
    let row1: Vec<CellIndex> = (6..12).collect();
    let h0 = Sum::new_cage(row0, 21);
    let h1 = Sum::new_cage(row1, 21);
    let handlers: Vec<Box<dyn crate::handlers::ConstraintHandler>> =
        vec![Box::new(h0), Box::new(h1)];
    let hs = HandlerSet::new(handlers, shape);
    let non_overlapping: Vec<usize> = hs
        .get_all_of_type::<Sum>()
        .iter()
        .map(|&(idx, _)| idx)
        .collect();
    let mut ctx = OptimizerCtx::new(shape.num_values);

    let result = sums::make_innie_outie_sum_handlers(&non_overlapping, &hs, &[], &mut ctx);
    for h in &result {
        let s = h.as_any().downcast_ref::<Sum>().unwrap();
        assert!(s.sum() == (s.sum() as i32));
    }
}
