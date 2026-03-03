//! Rellik constraint handler.
//!
//! An "anti-killer" cage where no subset of one or more cells may sum to
//! the target value.
//!
//! Mirrors JS `Rellik` from handlers.js (L3319–L3363).

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// Rellik — anti-sum cage
// ============================================================================

/// Enforces that no subset of cells sums to the target value.
///
/// Named "Rellik" ("Killer" backward). Used in RellikCage puzzles where
/// the displayed number is a forbidden sum rather than a required one.
///
/// Uses a 128-bit bitmask to track achievable remainders, matching JS
/// which uses BigInt to handle sums > 31.
pub struct Rellik {
    cells: Vec<CellIndex>,
    /// Bit `sum` is set: `1u128 << sum`.
    /// JS: `this.sumMask = 1n << BigInt(sum)`
    sum_mask: u128,
}

impl Rellik {
    pub fn new(cells: Vec<CellIndex>, sum: u32) -> Self {
        Rellik {
            cells,
            sum_mask: 1u128 << sum,
        }
    }
}

impl ConstraintHandler for Rellik {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "Rellik"
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        // `remainders` bit k = "it is possible to reduce the target sum to k
        // by choosing some subset of the fixed cells to subtract".
        // Starts with bit `sum` set (no fixed cells examined yet).
        // JS: let remainders = this.sumMask;
        let mut remainders = self.sum_mask;
        let mut fixed_values = CandidateSet::EMPTY;
        let mut unfixed_values = CandidateSet::EMPTY;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            if v.is_single() {
                // Fixed cell: also track sums achievable by subtracting this value.
                // JS: remainders |= remainders >> BigInt(LookupTables.toValue(v))
                remainders |= remainders >> v.value() as u32;
                fixed_values |= v;
            } else {
                unfixed_values |= v;
            }
        }

        // If remainder 0 is reachable from fixed cells alone, the forbidden sum
        // is already achieved — contradiction.
        // JS: if (remainders & 1n) return false;
        if remainders & 1 != 0 {
            return false;
        }

        // `small_remainders` bit k = `remainders` bit k+1 = "remaining target
        // can be k+1", which aligns with the grid bitmask convention (bit k =
        // value k+1).
        // JS: const smallRemainders = Number(BigInt.asUintN(32, remainders)) >> 1;
        let small_remainders = CandidateSet::from_raw((remainders >> 1) as u16);

        // Values that could exactly complete the forbidden sum from some
        // configuration of fixed cells — remove them from unfixed cells.
        // JS: const valuesToRemove = unfixedValues & smallRemainders & ~fixedValues;
        let values_to_remove = unfixed_values & small_remainders & !fixed_values;
        if values_to_remove.is_empty() {
            return true;
        }

        for i in 0..num_cells {
            let cell = cells[i] as usize;
            let v = grid[cell];
            if !(v & values_to_remove).is_empty() {
                grid[cell] = v & !values_to_remove;
                if grid[cell].is_empty() {
                    return false;
                }
                acc.add_for_cell(cells[i]);
            }
        }

        true
    }
}
