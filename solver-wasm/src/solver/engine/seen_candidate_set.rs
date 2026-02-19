//! SeenCandidateSet — tracks which candidates have appeared in found solutions.
//!
//! Mirrors JS `SeenCandidateSet` from candidate_selector.js. Used by
//! `solve_all_possibilities` to prune branches once all candidates in
//! a region have been accounted for.

use crate::candidate_set::CandidateSet;

/// Tracks which candidates have been seen across solutions, and provides
/// branch pruning for `solve_all_possibilities`.
///
/// For each cell, records how many solutions contain each value. Once a
/// value's count reaches the threshold, it is marked as "seen" in a
/// per-cell bitmask. After 2+ solutions, any branch whose grid contains
/// no unseen candidates is skipped (it would only produce redundant info).
pub(crate) struct SeenCandidateSet {
    /// Per-cell bitmask of values that have reached the threshold.
    candidates: Vec<CandidateSet>,
    /// Per-cell-per-value count. Index: `cell * num_values + value_index`.
    candidate_counts: Vec<u8>,
    /// Count threshold. When a value's count reaches this, it is added
    /// to the `candidates` bitmask.
    threshold: u8,
    /// Whether pruning is active (enabled after 2 solutions).
    pub enabled: bool,
    /// Last cell that had an unseen candidate (fast-path check).
    last_interesting_cell: usize,
    /// Number of values (for index arithmetic).
    num_values: usize,
}

impl SeenCandidateSet {
    /// Create a new set with the given threshold.
    pub fn new(threshold: u8, num_cells: usize, num_values: usize) -> Self {
        debug_assert!(threshold >= 1);
        SeenCandidateSet {
            candidates: vec![CandidateSet::EMPTY; num_cells],
            candidate_counts: vec![0u8; num_cells * num_values],
            threshold,
            enabled: false,
            last_interesting_cell: 0,
            num_values,
        }
    }

    /// Record a solution grid.
    pub fn add_solution(&mut self, grid: &[CandidateSet]) {
        let threshold = self.threshold;
        let num_values = self.num_values;
        for (i, &value) in grid.iter().enumerate() {
            let value_index = value.index();
            let count_idx = i * num_values + value_index;
            let incremented = self.candidate_counts[count_idx].saturating_add(1);
            if incremented <= threshold {
                self.candidate_counts[count_idx] = incremented;
                if incremented == threshold {
                    self.candidates[i] |= value;
                }
            }
        }
    }

    /// Check if the grid contains any cell with an unseen candidate.
    #[inline]
    pub fn has_interesting_solutions(&mut self, grid: &[CandidateSet]) -> bool {
        // Fast path: check the last interesting cell first.
        {
            let cell = self.last_interesting_cell;
            if !(grid[cell] & !self.candidates[cell]).is_empty() {
                return true;
            }
        }
        for (cell, &value) in grid.iter().enumerate() {
            if !(value & !self.candidates[cell]).is_empty() {
                self.last_interesting_cell = cell;
                return true;
            }
        }
        false
    }

    /// Get the raw candidate counts slice.
    pub fn candidate_counts(&self) -> &[u8] {
        &self.candidate_counts
    }

    /// Reset the set, preserving allocations.
    pub fn reset(&mut self) {
        self.candidates.fill(CandidateSet::EMPTY);
        self.candidate_counts.fill(0);
        self.enabled = false;
        self.last_interesting_cell = 0;
    }

    /// Reset with a new threshold, preserving allocations.
    pub fn reset_with_threshold(&mut self, threshold: u8) {
        self.threshold = threshold.max(1);
        self.reset();
    }
}
