// ============================================================================
// Priority handler — adjusts cell selection priorities.
//
// Mirrors JS `SudokuConstraintHandler.Priority` from handlers.js.
//
// This handler purely adjusts the priorities of cells to influence
// initial cell selection order. It does NOT register cells (so it
// is never invoked during solving or constraint propagation).
// ============================================================================

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;

use super::{ConstraintHandler, HandlerAccumulator};

/// Priority handler — overrides cell priorities for candidate selection.
pub struct Priority {
    /// The cells whose priorities are overridden.
    priority_cells: Vec<CellIndex>,
    /// The priority value to set (overrides, not adds).
    priority_value: i32,
}

impl Priority {
    pub fn new(priority_cells: Vec<CellIndex>, priority_value: i32) -> Self {
        Priority {
            priority_cells,
            priority_value,
        }
    }

    /// The cells whose priorities this handler overrides.
    pub fn priority_cells(&self) -> &[CellIndex] {
        &self.priority_cells
    }

    /// The priority value.
    pub fn priority_value(&self) -> i32 {
        self.priority_value
    }
}

impl ConstraintHandler for Priority {
    fn cells(&self) -> &[CellIndex] {
        // Don't register cells — this handler should never be invoked
        // during solving or added to any cell's handler list.
        &[]
    }

    fn enforce_consistency(
        &self,
        _grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        // No-op — this handler never enforces constraints.
        true
    }

    fn priority(&self) -> i32 {
        self.priority_value
    }

    fn name(&self) -> &'static str {
        "Priority"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_priority_value() {
        let handler = Priority::new(vec![0, 1], 42);
        assert_eq!(handler.priority(), 42);
    }

    #[test]
    fn stores_priority_cells() {
        let handler = Priority::new(vec![3, 5, 7], 10);
        assert_eq!(handler.priority_cells(), &[3, 5, 7]);
    }

    #[test]
    fn has_no_registered_cells() {
        let handler = Priority::new(vec![0, 1], 5);
        assert!(handler.cells().is_empty());
    }
}
