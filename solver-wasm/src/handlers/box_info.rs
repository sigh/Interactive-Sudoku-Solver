//! BoxInfo — stores box regions for jigsaw puzzles.
//!
//! Mirrors JS `BoxInfo`. A thin handler that holds box region data
//! so the optimizer can retrieve custom box regions instead of
//! falling back to shape-based defaults.

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

// BoxInfo is ported from JS but not yet wired into the Rust builder.
#[allow(dead_code)]
pub struct BoxInfo {
    box_regions: Vec<Vec<CellIndex>>,
}

#[allow(dead_code)]
impl BoxInfo {
    pub fn new(box_regions: Vec<Vec<CellIndex>>) -> Self {
        Self { box_regions }
    }

    pub fn box_regions(&self) -> &[Vec<CellIndex>] {
        &self.box_regions
    }
}

impl ConstraintHandler for BoxInfo {
    fn cells(&self) -> &[CellIndex] {
        &[]
    }

    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        true
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        true
    }

    fn name(&self) -> &'static str {
        "BoxInfo"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn stores_box_regions() {
        let regions = vec![vec![0, 1, 2], vec![3, 4, 5]];
        let handler = BoxInfo::new(regions.clone());
        assert_eq!(handler.box_regions(), &regions);
    }

    #[test]
    fn enforce_returns_true() {
        let handler = BoxInfo::new(vec![vec![0, 1]]);
        let (mut grid, _) = make_grid(1, 4, None);
        assert!(handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn initialize_returns_true() {
        let mut handler = BoxInfo::new(vec![vec![0]]);
        let (mut grid, shape) = make_grid(1, 4, None);
        assert!(init(&mut handler, &mut grid, shape));
    }
}
