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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn forbidden_sum_value_removed_from_unfixed() {
        // cells [0,1,2], forbidden sum=5. Cell 0 fixed to 2.
        // Remainder after subtracting 2: 5 and 3 reachable.
        // Value 3 should be removed from unfixed cells.
        let (mut grid, _) = make_grid(1, 4, Some(4));
        let handler = Rellik::new(vec![0, 1, 2], 5);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[1, 3, 4]);
        grid[2] = vm(&[1, 3, 4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Value 3 removed (2+3=5), value 5 is already > numValues.
        assert_eq!(grid[1] & vm(&[3]), CandidateSet::EMPTY);
        assert_eq!(grid[2] & vm(&[3]), CandidateSet::EMPTY);
    }

    #[test]
    fn pass_when_no_dangerous_values() {
        let (mut grid, _) = make_grid(1, 4, Some(4));
        let handler = Rellik::new(vec![0, 1, 2], 9);

        // No fixed cells, sum=9 — no single unfixed value can be removed.
        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[1, 2]);
        grid[2] = vm(&[1, 2]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn fail_when_fixed_cells_achieve_forbidden_sum() {
        // cells [0,1], forbidden sum=5. Fixed 2+3=5 → fail.
        let (mut grid, _) = make_grid(1, 4, Some(4));
        let handler = Rellik::new(vec![0, 1], 5);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[3]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn multiple_fixed_values_accumulate() {
        // cells [0,1,2], sum=6. Cell 0=1, Cell 1=2.
        // Remainders: 6, 5 (6-1), 4 (6-2), 3 (5-2). Bit 0 not set → ok.
        // Values that complete sum: 6,5,4,3 → remove 3,4 from unfixed (5,6 > numValues).
        let (mut grid, _) = make_grid(1, 4, Some(4));
        let handler = Rellik::new(vec![0, 1, 2], 6);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[1, 2, 3, 4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        assert_eq!(grid[2] & vm(&[3]), CandidateSet::EMPTY);
    }
}
