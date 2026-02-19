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
