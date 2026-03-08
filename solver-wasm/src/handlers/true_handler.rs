//! No-op constraint handler that always succeeds.
//!
//! Used by the optimizer to mark constraints as trivially satisfied.

use crate::candidate_set::CandidateSet;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

/// No-op handler that always succeeds.
///
/// Mirrors JS `True`.
pub struct True;

impl ConstraintHandler for True {
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

    fn name(&self) -> &'static str {
        "True"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn enforce_returns_true() {
        let handler = True;
        let (mut grid, _) = make_grid(1, 4, None);
        assert!(handler.enforce_consistency(&mut grid, &mut acc()));
    }

    #[test]
    fn has_no_cells() {
        let handler = True;
        assert!(handler.cells().is_empty());
    }
}
