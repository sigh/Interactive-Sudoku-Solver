use crate::candidate_set::CandidateSet;

/// Pre-allocated recursion stack for the iterative backtracking solver.
///
/// Mirrors the JS `_initStack` + `recStack` pattern from engine.js.
/// Each frame holds a complete grid snapshot so we can backtrack
/// without copying.
pub struct RecursionStack {
    frames: Vec<RecursionFrame>,
}

/// A single recursion frame.
pub struct RecursionFrame {
    /// Current search depth (number of cells decided).
    pub cell_depth: usize,

    /// Fraction of search space remaining in this subtree.
    pub progress_remaining: f64,

    /// Cell that caused the last contradiction (-1 = none).
    /// Used to prioritize constraint checking after backtrack.
    pub last_contradiction_cell: i16,

    /// Whether this is a new node (first visit) or a backtrack revisit.
    pub new_node: bool,

    /// Complete grid state snapshot.
    pub grid: Vec<CandidateSet>,
}

impl RecursionFrame {
    fn new(num_cells: usize) -> Self {
        RecursionFrame {
            cell_depth: 0,
            progress_remaining: 1.0,
            last_contradiction_cell: -1i16,
            new_node: true,
            grid: vec![CandidateSet::EMPTY; num_cells],
        }
    }
}

impl RecursionStack {
    /// Create a new recursion stack with `num_cells + 1` frames.
    ///
    /// We need at most num_cells + 1 frames because the maximum search
    /// depth is num_cells (one per cell), plus one for the initial frame.
    ///
    /// `grid_state_size` is the total size of each grid state array,
    /// which may be larger than `num_cells` if handlers allocated
    /// extra state slots via `GridStateAllocator`.
    pub fn new(num_cells: usize, grid_state_size: usize) -> Self {
        let mut frames = Vec::with_capacity(num_cells + 1);
        for _ in 0..=num_cells {
            frames.push(RecursionFrame::new(grid_state_size));
        }
        RecursionStack { frames }
    }

    /// Get a reference to a frame at a given depth.
    #[inline(always)]
    pub fn frame(&self, depth: usize) -> &RecursionFrame {
        &self.frames[depth]
    }

    /// Get a mutable reference to a frame at a given depth.
    #[inline(always)]
    pub fn frame_mut(&mut self, depth: usize) -> &mut RecursionFrame {
        &mut self.frames[depth]
    }

    /// Copy the grid from one frame to another.
    ///
    /// This is the hot path for branching: before guessing a value,
    /// we copy the current grid to the next frame.
    #[inline(always)]
    pub fn copy_grid(&mut self, from: usize, to: usize) {
        let (a, b) = if from < to {
            let (left, right) = self.frames.split_at_mut(to);
            (&left[from], &mut right[0])
        } else {
            let (left, right) = self.frames.split_at_mut(from);
            (&right[0], &mut left[to])
        };
        b.grid.copy_from_slice(&a.grid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NUM_CELLS: usize = 81;

    #[test]
    fn test_stack_creation() {
        let stack = RecursionStack::new(NUM_CELLS, NUM_CELLS);
        assert_eq!(stack.frames.len(), NUM_CELLS + 1);
    }

    #[test]
    fn test_copy_grid() {
        let mut stack = RecursionStack::new(NUM_CELLS, NUM_CELLS);
        stack.frames[0].grid = vec![CandidateSet::all(9); NUM_CELLS];
        stack.frames[0].grid[0] = CandidateSet::from_value(1);

        stack.copy_grid(0, 1);
        assert_eq!(stack.frames[1].grid[0], CandidateSet::from_value(1));
        assert_eq!(stack.frames[1].grid[1], CandidateSet::all(9));
    }

    #[test]
    fn test_frame_defaults() {
        let frame = RecursionFrame::new(81);
        assert_eq!(frame.cell_depth, 0);
        assert_eq!(frame.last_contradiction_cell, -1);
        assert!(frame.new_node);
    }
}
