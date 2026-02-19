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
