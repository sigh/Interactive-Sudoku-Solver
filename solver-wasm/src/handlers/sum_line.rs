//! SumLine constraint handler.
//!
//! The sum of every non-overlapping segment of the line must equal `sum`.
//! Uses forward/backward partial-sum state propagation.
//!
//! Each state is a bitmask where bit k being set means the partial sum at
//! that position can be k (mod `sum`).  A sum of at most 30 is required so
//! the state fits in a u32.
//!
//! Mirrors JS `SumLine` from handlers.js.

use std::cell::RefCell;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

pub struct SumLine {
    cells: Vec<CellIndex>,
    sum: u32,
    /// Initial partial-sum state.
    /// Non-loop: bit 0 set only (partial sum starts at 0).
    /// Loop: all bits 0..sum set ((1 << sum) - 1).
    initial_state: u32,
    /// Working states array, length = cells.len() + 1.
    states: RefCell<Vec<u32>>,
}

impl SumLine {
    pub fn new(cells: Vec<CellIndex>, is_loop: bool, sum: u32) -> Self {
        let num_cells = cells.len();
        let initial_state = if is_loop { (1u32 << sum) - 1 } else { 1 };
        Self {
            cells,
            sum,
            initial_state,
            states: RefCell::new(vec![0u32; num_cells + 1]),
        }
    }

    /// One forward + backward pass.
    ///
    /// Returns `false` if a cell becomes empty (contradiction).
    /// Mirrors JS `_singlePass`.
    fn single_pass(&self, grid: &mut [CandidateSet], states: &mut [u32]) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();
        let sum = self.sum;

        // Forward pass: propagate partial sums left-to-right.
        for i in 0..num_cells {
            let mut next_state = 0u32;
            let values = grid[cells[i] as usize];
            for v in values.iter() {
                let val = v.min_value() as u32;
                next_state |= states[i] << val;
            }
            // Modular wrap: if bit `sum` is set, also set bit 0
            // (partial sum has completed a full cycle).
            next_state |= (next_state >> sum) & 1;
            states[i + 1] = next_state;
        }

        // Loop closure: intersect forward-projected final state with the
        // starting state so only consistent loop points survive.
        // JS: `states[0] = (states[numCells] &= states[0])`
        let new_s0 = states[num_cells] & states[0];
        states[num_cells] = new_s0;
        states[0] = new_s0;

        // Backward pass: eliminate values that are inconsistent with the
        // possible partial sums on both sides of each cell.
        for i in (0..num_cells).rev() {
            let mut new_before = 0u32;
            let mut possible_values = 0u16;
            let values = grid[cells[i] as usize];
            for v in values.iter() {
                let val = v.min_value() as u32;
                let after_state = states[i + 1];
                // Unwrap modular: bit 0 is equivalent to bit `sum`.
                let possible_before =
                    (after_state | ((after_state & 1) << sum)) >> val;
                new_before |= possible_before;
                if possible_before & states[i] != 0 {
                    possible_values |= v.raw();
                }
            }
            if possible_values == 0 {
                return false;
            }
            grid[cells[i] as usize] = CandidateSet::from_raw(possible_values);
            states[i] &= new_before;
        }

        true
    }

    /// Quick feasibility check when multiple partial sums remain.
    ///
    /// Verifies that the total sum of all cells can be a multiple of `sum`.
    /// Mirrors JS `_checkTotalSum`.
    fn check_total_sum(&self, grid: &[CandidateSet]) -> bool {
        let sum = self.sum;
        let mut min_max: u32 = 0;
        for &cell in &self.cells {
            min_max += grid[cell as usize].min_max_packed();
        }
        // min_max_packed layout: [min in upper 16 bits, max in lower 16 bits].
        let max_total = (min_max & 0xffff) as u32;
        let min_total = (min_max >> 16) as u32;

        if max_total < sum {
            return false;
        }
        let max_remainder = max_total % sum;
        if max_remainder == 0 {
            return true;
        }
        // For total to be a multiple of sum, min and max must straddle a multiple.
        min_total < max_total - max_remainder
    }
}

impl ConstraintHandler for SumLine {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "SumLine"
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

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        _acc: &mut HandlerAccumulator,
    ) -> bool {
        let num_cells = self.cells.len();
        let mut states = self.states.borrow_mut();

        states[0] = self.initial_state;
        // Set final state to 0 (≠ initial_state) so the loop runs at least once.
        states[num_cells] = 0;

        // Iterate until the loop-closure point stabilises.
        while states[0] != states[num_cells] {
            if !self.single_pass(grid, &mut states) {
                return false;
            }
        }

        let partial_sums = states[0];
        // If the partial sum is unique, there is exactly one valid loop point.
        // JS: `!(partialSums & (partialSums - 1))`
        if partial_sums & partial_sums.wrapping_sub(1) == 0 {
            return true;
        }

        // Multiple partial sums remain; verify total is achievable.
        self.check_total_sum(grid)
    }
}
