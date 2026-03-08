//! Or constraint handler.
//!
//! Enforces a disjunction: at least one of the sub-handlers must be
//! satisfiable. Evaluates each sub-handler on a scratch grid and unions
//! the resulting candidate sets. If no sub-handler is satisfiable, the
//! constraint is contradicted.
//!
//! Mirrors JS `Or` from handlers.js (L3444–L3638).

use std::cell::RefCell;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::{And, ConstraintHandler};

// ============================================================================
// Or handler
// ============================================================================

/// Bit flag stored in `state[0]` to indicate that only one sub-handler
/// remains valid and we can delegate directly to it.
/// JS: `static _FLAG_FINAL = 1 << 15`
const FLAG_FINAL: u16 = 1 << 15;

pub struct Or {
    cells: Vec<CellIndex>,
    /// Sub-handlers (filtered to those that survived initialize).
    handlers: Vec<Box<dyn ConstraintHandler>>,
    /// For each surviving handler: cells that changed during its initialize.
    /// Stored as (cell_index, restricted_mask) pairs.
    initializations: Vec<Vec<(usize, CandidateSet)>>,
    /// Scratch grid for evaluating each sub-handler independently.
    /// Sized to full grid state (cells + extra state).
    scratch_grid: RefCell<Vec<CandidateSet>>,
    /// Union result grid (cell values only).
    result_grid: RefCell<Vec<CandidateSet>>,
    /// Number of actual grid cells (not counting extra state slots).
    num_cells: usize,
    /// Offset in the grid state array where Or's own state starts.
    /// State layout: [count_or_final_index, ...handler_validity_words]
    state_offset: usize,
    /// Number of CandidateSet words used to represent handler validity bits
    /// (`ceil(num_handlers / 16)`).
    num_handler_states: usize,
}

impl Or {
    /// Create an Or handler from the given sub-handlers.
    ///
    /// Sub-handlers that have exclusion cells are automatically wrapped in
    /// an `And` handler to ensure those cells are handled correctly.
    ///
    /// Mirrors JS `Or` constructor.
    pub fn new(mut handlers: Vec<Box<dyn ConstraintHandler>>) -> Self {
        // Wrap handlers that expose exclusion cells in an And handler.
        for h in handlers.iter_mut() {
            if !h.exclusion_cells().is_empty() {
                let old = std::mem::replace(h, Box::new(crate::handlers::True));
                *h = Box::new(And::new(vec![old]));
            }
        }

        // Union of all sub-handler cell sets.
        let mut cell_set: std::collections::BTreeSet<CellIndex> =
            std::collections::BTreeSet::new();
        for h in &handlers {
            cell_set.extend(h.cells().iter().copied());
        }

        Or {
            cells: cell_set.into_iter().collect(),
            handlers,
            initializations: Vec::new(),
            scratch_grid: RefCell::new(Vec::new()),
            result_grid: RefCell::new(Vec::new()),
            num_cells: 0,
            state_offset: 0,
            num_handler_states: 0,
        }
    }

    // -------------------------------------------------------------------
    // State helpers
    // -------------------------------------------------------------------

    /// Check whether sub-handler `hi` has been marked invalid in `grid`.
    /// JS: `_isInvalid(grid, handlerIndex)`
    fn is_invalid(grid: &[CandidateSet], state_offset: usize, hi: usize) -> bool {
        let word = grid[state_offset + 1 + (hi >> 4)].raw();
        (word & (1 << (hi & 15))) == 0
    }

    /// Mark sub-handler `hi` as invalid and update the count / final flag.
    /// JS: `_markAsInvalid(grid, handlerIndex)`
    fn mark_as_invalid(
        &self,
        grid: &mut [CandidateSet],
        hi: usize,
    ) {
        let offset = self.state_offset;
        // Clear the handler's bit.
        let slot = offset + 1 + (hi >> 4);
        let new_word = grid[slot].raw() & !(1u16 << (hi & 15));
        grid[slot] = CandidateSet::from_raw(new_word);

        // Decrement count.
        let count = grid[offset].raw();
        let new_count = count - 1;
        grid[offset] = CandidateSet::from_raw(new_count);

        if new_count == 1 {
            self.set_final_handler(grid);
        }
    }

    /// Promote to final-handler mode once only one sub-handler remains.
    /// Finds the surviving handler index and encodes it alongside FLAG_FINAL.
    /// JS: `_setFinalHandler(state, offset)`
    fn set_final_handler(&self, grid: &mut [CandidateSet]) {
        let offset = self.state_offset;
        // Set the final flag first.
        grid[offset] = CandidateSet::from_raw(FLAG_FINAL);
        for i in 0..self.num_handler_states {
            let flags = grid[offset + 1 + i].raw();
            if flags != 0 {
                let bit_pos = flags.trailing_zeros() as u16;
                let handler_index = (i as u16) * 16 + bit_pos;
                let v = grid[offset].raw() | handler_index;
                grid[offset] = CandidateSet::from_raw(v);
                return;
            }
        }
        // Should never happen — there is always exactly one bit set when
        // set_final_handler is called.
        panic!("Or::set_final_handler: no valid handler found");
    }

    /// Apply per-handler initialization masks to a grid slice.
    /// Returns `false` if any cell becomes empty after restricting.
    /// JS: `_assignInitializations(grid, handlerIndex)`
    fn assign_initializations(
        grid: &mut [CandidateSet],
        init: &[(usize, CandidateSet)],
    ) -> bool {
        for &(cell, mask) in init {
            grid[cell] &= mask;
            if grid[cell].is_empty() {
                return false;
            }
        }
        true
    }
}

impl ConstraintHandler for Or {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "Or"
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let grid_len = initial_grid.len();
        let mut scratch: Vec<CandidateSet> = initial_grid.to_vec();

        let mut initialization_cells: std::collections::BTreeSet<usize> =
            std::collections::BTreeSet::new();
        let mut valid_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        let mut initializations: Vec<Vec<(usize, CandidateSet)>> = Vec::new();

        // Drain self.handlers so we can move each handler out.
        for mut h in self.handlers.drain(..) {
            // Reset scratch to the current initial state each time.
            scratch[..grid_len].copy_from_slice(initial_grid);

            if !h.initialize(&mut scratch, cell_exclusions, shape, state_allocator) {
                // This handler is infeasible; skip it.
                continue;
            }

            // Record cells that the handler's initialize modified.
            let mut init: Vec<(usize, CandidateSet)> = Vec::new();
            for i in 0..shape.num_cells as usize {
                if scratch[i] != initial_grid[i] {
                    init.push((i, scratch[i]));
                    initialization_cells.insert(i);
                }
            }

            valid_handlers.push(h);
            initializations.push(init);
        }

        if valid_handlers.is_empty() {
            return false;
        }

        self.handlers = valid_handlers;
        self.initializations = initializations;
        self.num_cells = shape.num_cells as usize;

        // Build Or's own state array.
        // Layout: state[0] = count (or FLAG_FINAL | handler_index)
        //         state[1..=num_handler_states] = handler validity bitmasks.
        let n = self.handlers.len();
        self.num_handler_states = (n + 15) >> 4;
        let mut state = vec![CandidateSet::EMPTY; 1 + self.num_handler_states];

        for i in 0..n {
            let word = state[1 + (i >> 4)].raw() | (1u16 << (i & 15));
            state[1 + (i >> 4)] = CandidateSet::from_raw(word);
        }

        if n == 1 {
            // Directly go to final-handler mode.
            // set_final_handler needs &mut [CandidateSet] starting at offset 0.
            // We operate on the local `state` slice here.
            state[0] = CandidateSet::from_raw(FLAG_FINAL);
            let flags = state[1].raw();
            let bit_pos = flags.trailing_zeros() as u16;
            let v = state[0].raw() | bit_pos;
            state[0] = CandidateSet::from_raw(v);
        } else {
            state[0] = CandidateSet::from_raw(n as u16);
        }

        self.state_offset = state_allocator.allocate(&state);

        // Expand watched cells to include cells changed by any initializations.
        if !initialization_cells.is_empty() {
            let mut watched: std::collections::BTreeSet<CellIndex> =
                self.cells.iter().copied().collect();
            for &c in &initialization_cells {
                watched.insert(c as CellIndex);
            }
            self.cells = watched.into_iter().collect();
        }

        true
    }

    fn post_initialize(&mut self, initial_grid_state: &[CandidateSet]) {
        // Forward to sub-handlers first.
        for h in &mut self.handlers {
            h.post_initialize(initial_grid_state);
        }
        // Allocate our scratch and result grids sized to the full grid state.
        *self.scratch_grid.borrow_mut() = initial_grid_state.to_vec();
        *self.result_grid.borrow_mut() = initial_grid_state.to_vec();
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let offset = self.state_offset;
        let state_val = grid[offset].raw();

        // Fast path: only one handler remains — delegate directly.
        // JS: `if ((grid[this._stateOffset] & this.constructor._FLAG_FINAL))`
        if state_val & FLAG_FINAL != 0 {
            let hi = (state_val & !FLAG_FINAL) as usize;
            let init = &self.initializations[hi];
            if !Self::assign_initializations(grid, init) {
                return false;
            }
            return self.handlers[hi].enforce_consistency(grid, acc);
        }

        let num_cells = self.num_cells;
        // Create a no-op accumulator for scratch-grid evaluation.
        // Mirrors JS `DummyHandlerAccumulator`.
        let mut dummy_acc = HandlerAccumulator::new_no_propagate(num_cells);

        // Zero the cell portion of the result grid.
        {
            let mut result = self.result_grid.borrow_mut();
            for j in 0..num_cells {
                result[j] = CandidateSet::EMPTY;
            }
        }

        let mut any_valid = false;

        for i in 0..self.handlers.len() {
            if Self::is_invalid(grid, offset, i) {
                continue;
            }

            // Copy current full grid state to scratch.
            {
                let mut scratch = self.scratch_grid.borrow_mut();
                scratch[..grid.len()].copy_from_slice(grid);
            }

            // Apply this handler's initialization to scratch.
            let init_ok = {
                let mut scratch = self.scratch_grid.borrow_mut();
                Self::assign_initializations(&mut scratch, &self.initializations[i])
            };
            if !init_ok {
                self.mark_as_invalid(grid, i);
                continue;
            }

            // Run the handler on the scratch grid.
            let handler_ok = {
                let mut scratch = self.scratch_grid.borrow_mut();
                self.handlers[i].enforce_consistency(&mut scratch, &mut dummy_acc)
            };
            if !handler_ok {
                self.mark_as_invalid(grid, i);
                continue;
            }

            any_valid = true;

            // Union scratch cell values into result; copy extra state to grid.
            {
                let scratch = self.scratch_grid.borrow();
                let mut result = self.result_grid.borrow_mut();
                for j in 0..num_cells {
                    result[j] |= scratch[j];
                }
                // Extra state slots are written directly to the live grid.
                for j in num_cells..grid.len() {
                    grid[j] = scratch[j];
                }
            }
        }

        if !any_valid {
            return false;
        }

        // Copy unioned cell values back to the live grid.
        let result = self.result_grid.borrow();
        for j in 0..num_cells {
            grid[j] = result[j];
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;
    use crate::handlers::{True, False};
    use crate::solver::grid_state_allocator::GridStateAllocator;

    /// Initialize an Or handler with proper state allocation.
    fn init_or(
        handler: &mut Or,
        grid: &mut Vec<CandidateSet>,
        shape: GridShape,
    ) -> bool {
        let ce = CellExclusions::with_num_cells(grid.len());
        let mut alloc = GridStateAllocator::new(grid.len());
        let ok = handler.initialize(grid, &ce, shape, &mut alloc);
        if ok {
            let state = alloc.make_grid_state(grid);
            *grid = state;
            handler.post_initialize(grid);
        }
        ok
    }

    #[test]
    fn all_handlers_fail_returns_false() {
        let h1: Box<dyn ConstraintHandler> = Box::new(False::new(vec![0]));
        let h2: Box<dyn ConstraintHandler> = Box::new(False::new(vec![0]));
        let mut handler = Or::new(vec![h1, h2]);

        let (mut grid, shape) = make_grid(1, 4, Some(4));
        assert!(!init_or(&mut handler, &mut grid, shape));
    }

    #[test]
    fn single_valid_handler_delegates() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(False::new(vec![0]));
        let mut handler = Or::new(vec![h1, h2]);

        let (mut grid, shape) = make_grid(1, 4, Some(4));
        assert!(init_or(&mut handler, &mut grid, shape));

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn multiple_valid_handlers_union() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(True);
        let mut handler = Or::new(vec![h1, h2]);

        let (mut grid, shape) = make_grid(1, 4, Some(4));
        assert!(init_or(&mut handler, &mut grid, shape));

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn init_prunes_infeasible_handlers() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(False::new(vec![0]));
        let h3: Box<dyn ConstraintHandler> = Box::new(True);
        let mut handler = Or::new(vec![h1, h2, h3]);

        let (mut grid, shape) = make_grid(1, 4, Some(4));
        assert!(init_or(&mut handler, &mut grid, shape));

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }
}
