//! JigsawPiece — marker handler for irregular jigsaw regions.
//!
//! Has no solving logic; used by the optimizer to identify jigsaw pieces
//! and create intersection/law-of-leftover handlers.

use crate::candidate_set::CandidateSet;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

/// Marker handler for a jigsaw piece (irregular region).
///
/// Mirrors JS `JigsawPiece`. No enforce logic — always returns true.
// JigsawPiece is ported from JS but not yet wired into the Rust builder.
#[allow(dead_code)]
pub struct JigsawPiece {
    cells: Vec<CellIndex>,
}

#[allow(dead_code)]
impl JigsawPiece {
    pub fn new(cells: Vec<CellIndex>) -> Self {
        Self { cells }
    }
}

impl ConstraintHandler for JigsawPiece {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        true
    }

    fn name(&self) -> &'static str {
        "JigsawPiece"
    }
}
