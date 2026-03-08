//! Shared test helpers for handler unit tests.
//!
//! Usage: `use crate::handlers::test_util::*;`

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

/// Build a `CandidateSet` from 1-indexed values.
/// Mirrors JS `valueMask(...values)`.
pub fn vm(values: &[u8]) -> CandidateSet {
    let mut mask = 0u16;
    for &v in values {
        mask |= 1u16 << (v - 1);
    }
    CandidateSet::from_raw(mask)
}

/// Create a grid filled with all candidates for a `rows × cols` grid.
/// If `nv` is `Some(n)`, override `num_values` (for short/long rows).
pub fn make_grid(rows: u8, cols: u8, nv: Option<u8>) -> (Vec<CandidateSet>, GridShape) {
    let shape = match nv {
        Some(n) => GridShape::build(rows, cols, n),
        None => GridShape::new(rows, cols).unwrap(),
    };
    let all = CandidateSet::all(shape.num_values);
    let grid = vec![all; shape.num_cells];
    (grid, shape)
}

/// Create a no-propagation stub accumulator.
pub fn acc() -> HandlerAccumulator {
    HandlerAccumulator::new_stub()
}

/// Create a stub accumulator tracking `n` cells.
pub fn acc_n(n: usize) -> HandlerAccumulator {
    HandlerAccumulator::new_stub_with_num_cells(n)
}

/// Initialize a handler with default (empty) `CellExclusions`.
pub fn init(
    handler: &mut dyn ConstraintHandler,
    grid: &mut [CandidateSet],
    shape: GridShape,
) -> bool {
    let ce = CellExclusions::with_num_cells(grid.len());
    let mut alloc = GridStateAllocator::new(grid.len());
    handler.initialize(grid, &ce, shape, &mut alloc)
}

/// Initialize a handler with caller-supplied `CellExclusions`.
pub fn init_with(
    handler: &mut dyn ConstraintHandler,
    grid: &mut [CandidateSet],
    shape: GridShape,
    ce: &CellExclusions,
) -> bool {
    let mut alloc = GridStateAllocator::new(grid.len());
    handler.initialize(grid, ce, shape, &mut alloc)
}

/// Run `enforce_consistency` with a fresh stub accumulator.
pub fn enforce(handler: &dyn ConstraintHandler, grid: &mut [CandidateSet]) -> bool {
    handler.enforce_consistency(grid, &mut acc())
}

/// Create `CellExclusions` with all-pairs mutual exclusion (all-different).
pub fn unique_exclusions(num_cells: usize) -> CellExclusions {
    let mut ce = CellExclusions::with_num_cells(num_cells);
    for i in 0..num_cells as CellIndex {
        for j in (i + 1)..num_cells as CellIndex {
            ce.add_mutual_exclusion(i, j);
        }
    }
    ce
}
