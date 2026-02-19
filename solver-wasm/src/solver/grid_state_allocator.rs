use crate::candidate_set::CandidateSet;

/// Allocator for extra grid state slots beyond the regular cell array.
///
/// Mirrors JS `GridStateAllocator` from engine.js. During handler
/// initialization, handlers can `allocate()` extra slots that are
/// appended after the regular grid cells. These slots are included in
/// every recursion stack frame and are automatically saved/restored
/// during backtracking.
///
/// Usage:
/// 1. Create with `new(num_cells)`.
/// 2. Pass `&mut self` to each handler's `initialize()`.
/// 3. Handlers call `allocate(&[initial_values])` to reserve slots.
/// 4. Call `make_grid_state(grid_cells)` to produce the initial state.
/// 5. `grid_state_size()` gives the total length for recursion frames.
pub struct GridStateAllocator {
    /// Number of regular grid cells (start of extra state region).
    num_cells: usize,
    /// Extra state initial values, appended after grid cells.
    extra_state: Vec<CandidateSet>,
}

impl GridStateAllocator {
    /// Create a new allocator for a grid with `num_cells` cells.
    pub fn new(num_cells: usize) -> Self {
        GridStateAllocator {
            num_cells,
            extra_state: Vec::new(),
        }
    }

    /// Allocate extra state slots with the given initial values.
    ///
    /// Returns the absolute offset into the grid state array where
    /// these slots start. Handlers store this offset and use it to
    /// index into the `grid` slice during `enforce_consistency`.
    ///
    /// Mirrors JS `GridStateAllocator.allocate(state)`.
    pub fn allocate(&mut self, initial_values: &[CandidateSet]) -> usize {
        let start = self.num_cells + self.extra_state.len();
        self.extra_state.extend_from_slice(initial_values);
        start
    }

    /// Total size of the grid state (cells + extra state).
    pub fn grid_state_size(&self) -> usize {
        self.num_cells + self.extra_state.len()
    }

    /// Produce the initial grid state by concatenating grid cells
    /// with the extra state.
    ///
    /// Mirrors JS `GridStateAllocator.makeGridState()`.
    pub fn make_grid_state(&self, grid_cells: &[CandidateSet]) -> Vec<CandidateSet> {
        debug_assert_eq!(grid_cells.len(), self.num_cells);
        let mut state = Vec::with_capacity(self.grid_state_size());
        state.extend_from_slice(grid_cells);
        state.extend_from_slice(&self.extra_state);
        state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allocate_returns_correct_offsets() {
        let mut alloc = GridStateAllocator::new(81);
        assert_eq!(alloc.grid_state_size(), 81);

        let off1 = alloc.allocate(&[CandidateSet::EMPTY]);
        assert_eq!(off1, 81);
        assert_eq!(alloc.grid_state_size(), 82);

        let off2 = alloc.allocate(&[CandidateSet::EMPTY, CandidateSet::EMPTY]);
        assert_eq!(off2, 82);
        assert_eq!(alloc.grid_state_size(), 84);
    }

    #[test]
    fn test_make_grid_state() {
        let mut alloc = GridStateAllocator::new(4);
        let v1 = CandidateSet::from_value(1);
        let v2 = CandidateSet::from_value(2);
        alloc.allocate(&[v1, v2]);

        let cells = vec![CandidateSet::all(9); 4];
        let state = alloc.make_grid_state(&cells);
        assert_eq!(state.len(), 6);
        assert_eq!(state[4], v1);
        assert_eq!(state[5], v2);
    }

    #[test]
    fn test_no_extra_state() {
        let alloc = GridStateAllocator::new(81);
        assert_eq!(alloc.grid_state_size(), 81);

        let cells = vec![CandidateSet::all(9); 81];
        let state = alloc.make_grid_state(&cells);
        assert_eq!(state.len(), 81);
    }
}
