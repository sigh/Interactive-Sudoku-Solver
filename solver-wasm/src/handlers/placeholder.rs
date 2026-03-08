//! No-op placeholder handler used during constraint propagation.
//!
//! When `HandlerAccumulator::enforce_at` needs to call a handler's
//! `enforce_consistency` while passing `&mut self`, it temporarily swaps
//! the real handler out of the `Vec` and replaces it with this placeholder.

use crate::candidate_set::CandidateSet;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

/// No-op handler used as a temporary placeholder when swapping a real handler
/// out of a `Vec<Box<dyn ConstraintHandler>>` during `enforce_at`.
pub(crate) struct Placeholder;

impl ConstraintHandler for Placeholder {
    fn cells(&self) -> &[CellIndex] {
        &[]
    }
    fn name(&self) -> &'static str {
        "Placeholder"
    }
    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn enforce_returns_true() {
        let handler = Placeholder;
        let (mut grid, _) = make_grid(1, 4, None);
        assert!(handler.enforce_consistency(&mut grid, &mut acc()));
    }
}
