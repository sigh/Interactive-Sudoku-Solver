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
};
#[cfg(test)]
use crate::handlers::{
    AllDifferent, AllDifferentType, BinaryConstraint, GivenCandidates, House, RequiredValues,
};
#[cfg(test)]
use crate::solver::cell_exclusions::CellExclusions;
#[cfg(test)]
use crate::solver::handler_set::HandlerSet;

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
    assert_eq!(rvs.len(), 0, "RequiredValues should be deleted when all cells forced");

    let gcs = hs.get_all_of_type::<GivenCandidates>();
    assert_eq!(gcs.len(), 1, "GivenCandidates should cover forced cells");
}
