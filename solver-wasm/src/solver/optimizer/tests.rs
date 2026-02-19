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
use crate::handlers::{AllDifferent, AllDifferentType, BinaryConstraint, GivenCandidates, House};
#[cfg(test)]
use crate::solver::cell_exclusions::CellExclusions;
#[cfg(test)]
use crate::solver::handler_set::HandlerSet;

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
