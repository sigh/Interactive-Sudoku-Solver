//! GivenCandidates — fix initial cell candidates from givens/clues.
//!
//! Mirrors JS `GivenCandidates`.
//!
//! Stores **external** values (before offset conversion) for each cell.
//! Conversion to internal bitmasks happens during `initialize()` using
//! `shape.value_offset`, exactly like the JS version.

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// GivenCandidates — restrict cells during initialization
// ============================================================================

/// A cell's given value(s), stored as external values.
///
/// Mirrors the JS `_valueMap` entries which can be either a single number
/// or an iterable of numbers.
#[derive(Clone, Debug)]
pub enum GivenValue {
    /// A single external value — JS: `fromOffsetValue(v, offset)`.
    Single(i32),
    /// Multiple external values — JS: `fromOffsetValuesArray(vs, offset)`.
    Multiple(Vec<i32>),
}

/// Sets initial candidate values for specific cells.
///
/// This handler only acts during `initialize` — it has no runtime
/// enforcement cost.
///
/// Mirrors JS `GivenCandidates`.
pub struct GivenCandidates {
    /// (cell, external_values) pairs.
    value_map: Vec<(CellIndex, GivenValue)>,
}

impl GivenCandidates {
    pub fn new(value_map: Vec<(CellIndex, GivenValue)>) -> Self {
        GivenCandidates { value_map }
    }
}

impl ConstraintHandler for GivenCandidates {
    fn cells(&self) -> &[CellIndex] {
        &[]
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let offset = shape.value_offset;
        for (cell, value) in &self.value_map {
            let mask = match value {
                GivenValue::Single(v) => CandidateSet::from_offset_value(*v, offset),
                GivenValue::Multiple(vs) => {
                    CandidateSet::from_offset_values(vs.iter().copied(), offset)
                }
            };
            initial_grid[*cell as usize] &= mask;
            if initial_grid[*cell as usize].is_empty() {
                return false;
            }
        }
        true
    }

    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        true // No runtime enforcement.
    }

    fn name(&self) -> &'static str {
        "GivenCandidates"
    }

    fn id_str(&self) -> String {
        format!("GC-{:?}", self.value_map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_given_candidates() {
        let mut handler = GivenCandidates::new(vec![
            (0, GivenValue::Single(5)),
            (1, GivenValue::Multiple(vec![3, 7])),
        ]);
        let mut grid = [CandidateSet::all(9); 81];
        let ce = CellExclusions::new();
        assert!(handler.initialize(
            &mut grid,
            &ce,
            GridShape::default_9x9(),
            &mut GridStateAllocator::new(81)
        ));
        assert_eq!(grid[0], CandidateSet::from_value(5));
        assert_eq!(
            grid[1],
            CandidateSet::from_value(3) | CandidateSet::from_value(7)
        );
    }
}
