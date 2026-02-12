use crate::grid::Grid;
use crate::util::{self, NUM_CELLS, NUM_VALUES};

/// Candidate cell selector for the backtracking solver.
///
/// Mirrors JS `CandidateSelector` from candidate_selector.js.
/// Determines which cell to branch on next and which value to try,
/// using conflict scores to prioritize cells that frequently cause
/// contradictions. Includes house-based candidate finders that detect
/// values appearing in exactly 2 cells within a house (hidden pairs),
/// enabling more targeted branching.
pub struct CandidateSelector {
    /// Current cell ordering. Cells at the front have been decided;
    /// cells at the back are pending.
    cell_order: [u8; NUM_CELLS],

    /// Conflict scores for prioritizing cells.
    conflict_scores: ConflictScores,

    /// Candidate finder set for house-based hidden pair detection.
    candidate_finder_set: CandidateFinderSet,

    /// Per-depth candidate selection state for backtrack reuse.
    candidate_selection_states: Vec<CandidateSelectionState>,

    /// Per-depth flags indicating whether a custom candidate was used.
    candidate_selection_flags: Vec<bool>,
}

/// Return value from `select_next_candidate`.
pub struct CandidateSelection {
    /// Index into cell_order past all singletons (next depth to recurse to).
    pub next_depth: usize,
    /// The candidate value bitmask to try.
    pub value: u16,
    /// Number of options we selected from (1 = forced, >1 = guess).
    pub count: u32,
}

impl CandidateSelector {
    pub fn new(cell_priorities: &[i32; NUM_CELLS]) -> Self {
        let mut cell_order = [0u8; NUM_CELLS];
        for i in 0..NUM_CELLS {
            cell_order[i] = i as u8;
        }

        let mut candidate_selection_states = Vec::with_capacity(NUM_CELLS);
        for _ in 0..NUM_CELLS {
            candidate_selection_states.push(CandidateSelectionState::new());
        }

        CandidateSelector {
            cell_order,
            conflict_scores: ConflictScores::new(cell_priorities),
            candidate_finder_set: CandidateFinderSet::new(),
            candidate_selection_states,
            candidate_selection_flags: vec![false; NUM_CELLS],
        }
    }

    /// Reset for a new solve run.
    pub fn reset(&mut self) {
        for i in 0..NUM_CELLS {
            self.cell_order[i] = i as u8;
        }
        self.candidate_finder_set.initialized = false;
    }

    /// Get the cell at a given depth in the ordering.
    #[inline(always)]
    pub fn get_cell_at_depth(&self, depth: usize) -> u8 {
        self.cell_order[depth]
    }

    /// Get the cell order up to a given depth.
    pub fn get_cell_order(&self, upto: usize) -> &[u8] {
        &self.cell_order[..upto]
    }

    /// Get mutable reference to conflict scores.
    pub fn conflict_scores_mut(&mut self) -> &mut ConflictScores {
        &mut self.conflict_scores
    }

    /// Select the next candidate cell and value to try.
    ///
    /// `cell_depth`: current depth in the search tree.
    /// `grid`: current grid state.
    /// `is_new_node`: true if we're exploring this node for the first time.
    ///
    /// Returns `CandidateSelection` with the next depth, value, and count.
    /// If count is 0, there's a domain wipeout (contradiction).
    pub fn select_next_candidate(
        &mut self,
        cell_depth: usize,
        grid: &[u16],
        is_new_node: bool,
    ) -> CandidateSelection {
        let (cell_offset, value, count) = self.select_best_candidate(grid, cell_depth, is_new_node);

        if count == 0 {
            return CandidateSelection {
                next_depth: 0,
                value: 0,
                count: 0,
            };
        }

        // Update cell order: move selected cell and singletons to front.
        let next_depth = self.update_cell_order(cell_depth, cell_offset, count, grid);

        if next_depth == 0 {
            return CandidateSelection {
                next_depth: 0,
                value: 0,
                count: 0,
            };
        }

        CandidateSelection {
            next_depth,
            value,
            count,
        }
    }

    /// The main candidate selection logic, mirroring JS `_selectBestCandidate`.
    ///
    /// Returns `(cell_offset, value, count)`.
    fn select_best_candidate(
        &mut self,
        grid: &[u16],
        cell_depth: usize,
        is_new_node: bool,
    ) -> (usize, u16, u32) {
        if is_new_node {
            // Clear any previous candidate selection state.
            self.candidate_selection_flags[cell_depth] = false;
        } else {
            // If we have a special candidate state, then use that.
            if self.candidate_selection_flags[cell_depth] {
                let state = &mut self.candidate_selection_states[cell_depth];
                let count = state.cells.len() as u32;
                if count > 0 {
                    let cell = state.cells.pop().unwrap();
                    let value = state.value;
                    let cell_offset = self.cell_order_index_of(cell, cell_depth);
                    return (cell_offset, value, count);
                }
            }
        }

        // Quick check - if the first value is a singleton, then just return
        // without the extra bookkeeping.
        let first_value = grid[self.cell_order[cell_depth] as usize];
        if util::is_single(first_value) {
            return (
                cell_depth,
                first_value,
                if first_value != 0 { 1 } else { 0 },
            );
        }

        if first_value == 0 {
            return (cell_depth, 0, 0);
        }

        // Find the best cell to explore next.
        let mut cell_offset = self.select_best_cell(grid, cell_depth);
        let cell = self.cell_order[cell_offset] as usize;
        let values = grid[cell];
        let mut count = util::count_ones(values);

        // Choose the smallest value (lowest bit).
        let mut value = util::lowest_bit(values);

        if count > 1 {
            // Wait until our first guess to initialize the candidate finder set.
            if !self.candidate_finder_set.initialized {
                self.candidate_finder_set.initialize(grid);
            }
        }

        let scores = &self.conflict_scores.scores;

        // Optionally explore custom candidates nominated by house constraints.
        //  - Exploring this node for the first time.
        //  - Currently exploring a cell with more than 2 values.
        //  - Have non-zero conflict scores.
        if is_new_node && count > 2 && scores[cell] > 0 {
            let score = scores[cell] as f64 / count as f64;
            self.candidate_selection_states[cell_depth].score = score;

            if self.find_custom_candidates(grid, cell_depth, score) {
                let state = &mut self.candidate_selection_states[cell_depth];
                count = state.cells.len() as u32;
                value = state.value;

                let popped_cell = state.cells.pop().unwrap();
                cell_offset = self.cell_order_index_of(popped_cell, cell_depth);
                self.candidate_selection_flags[cell_depth] = true;
            }
        }

        (cell_offset, value, count)
    }

    /// Find the index of a cell in cell_order starting from `from`.
    fn cell_order_index_of(&self, cell: u8, from: usize) -> usize {
        for i in from..NUM_CELLS {
            if self.cell_order[i] == cell {
                return i;
            }
        }
        // Should never happen.
        from
    }

    /// Find custom candidates using house-based hidden pair detection.
    ///
    /// Mirrors JS `_findCustomCandidates`.
    /// Returns true if a better candidate was found.
    fn find_custom_candidates(
        &mut self,
        grid: &[u16],
        cell_depth: usize,
        initial_score: f64,
    ) -> bool {
        let scores = &self.conflict_scores.scores;
        let mut min_cs = (initial_score * 2.0).ceil() as i32;
        let mut found_candidate = false;

        // We need to track which finders have been checked.
        self.candidate_finder_set.clear_marks();

        // Working state for the best result found.
        let mut best_score = initial_score;
        let mut best_value: u16 = 0;
        let mut best_cells: Vec<u8> = Vec::new();

        let finder_set = &mut self.candidate_finder_set;

        for i in cell_depth..NUM_CELLS {
            let cell = self.cell_order[i] as usize;
            // Ignore cells which are too low in priority.
            if scores[cell] < min_cs {
                continue;
            }

            // Copy indexes to avoid borrow conflict.
            let num_indexes = finder_set.indexes_by_cell[cell].len();
            for j in 0..num_indexes {
                let idx = finder_set.indexes_by_cell[cell][j];
                if !finder_set.marked[idx] {
                    finder_set.marked[idx] = true;

                    if finder_set.finders[idx].maybe_find_candidate(
                        grid,
                        scores,
                        &mut best_score,
                        &mut best_value,
                        &mut best_cells,
                    ) {
                        min_cs = (best_score * 2.0).ceil() as i32;
                        found_candidate = true;
                    }
                }
            }
        }

        if !found_candidate {
            return false;
        }

        // Sort cells so that the highest scoring cells are last (searched first
        // via pop).
        best_cells.sort_by(|a, b| scores[*a as usize].cmp(&scores[*b as usize]));

        let state = &mut self.candidate_selection_states[cell_depth];
        state.score = best_score;
        state.value = best_value;
        state.cells = best_cells;

        true
    }

    /// Select the best cell to explore based on conflict scores.
    ///
    /// Uses the standard heuristic: minimize count / maximize conflict score.
    /// This is MRV (Minimum Remaining Values) with conflict-based tiebreaking.
    fn select_best_cell(&self, grid: &[u16], cell_depth: usize) -> usize {
        let scores = &self.conflict_scores.scores;

        let (max_value, max_value_score) = self.conflict_scores.get_max_value_score();

        let mut max_score: f64 = -1.0;
        let mut best_offset = cell_depth;

        for i in cell_depth..NUM_CELLS {
            let cell = self.cell_order[i] as usize;
            let count = util::count_ones(grid[cell]);

            // If we have a single value, use it immediately (no guessing).
            if count <= 1 {
                best_offset = i;
                max_score = -1.0;
                break;
            }

            let mut score_unnormalized = scores[cell] as f64;

            // If a value has been particularly conflict-prone recently, prefer
            // searching cells that contain that value.
            if (grid[cell] & max_value) != 0 {
                score_unnormalized += max_value_score as f64 * 0.2;
            }

            if score_unnormalized > max_score * count as f64 {
                best_offset = i;
                max_score = score_unnormalized / count as f64;
            }
        }

        if max_score == 0.0 {
            // All conflict scores are 0 — fall back to min-count.
            best_offset = self.min_count_cell_index(grid, cell_depth);
        }

        best_offset
    }

    /// Find the cell with the minimum candidate count.
    fn min_count_cell_index(&self, grid: &[u16], cell_depth: usize) -> usize {
        let mut min_count = u32::MAX;
        let mut best_offset = cell_depth;

        for i in cell_depth..NUM_CELLS {
            let count = util::count_ones(grid[self.cell_order[i] as usize]);
            if count < min_count {
                best_offset = i;
                min_count = count;
            }
        }
        best_offset
    }

    /// Update cell order: move the selected cell to `cell_depth`, then
    /// move all singletons to the front.
    ///
    /// Returns the next depth (past all singletons).
    fn update_cell_order(
        &mut self,
        cell_depth: usize,
        cell_offset: usize,
        count: u32,
        grid: &[u16],
    ) -> usize {
        let cell_order = &mut self.cell_order;
        let mut front_offset = cell_depth;

        // Swap selected cell into position.
        cell_order.swap(cell_offset, front_offset);
        front_offset += 1;
        let mut scan_offset = cell_offset + 1;

        // A 0-domain cell is an immediate contradiction.
        if count == 0 {
            return 0;
        }

        // If count > 1, there were no singletons to collect.
        if count > 1 {
            return front_offset;
        }

        // Move all singletons to the front.
        // First skip past values already at the front.
        while scan_offset == front_offset && scan_offset < NUM_CELLS {
            let v = grid[cell_order[scan_offset] as usize];
            if util::is_single(v) {
                front_offset += 1;
                if v == 0 {
                    return 0;
                }
            }
            scan_offset += 1;
        }

        // Find the rest of the singletons.
        while scan_offset < NUM_CELLS {
            let v = grid[cell_order[scan_offset] as usize];
            if util::is_single(v) {
                if v == 0 {
                    return 0;
                }
                cell_order.swap(scan_offset, front_offset);
                front_offset += 1;
            }
            scan_offset += 1;
        }

        front_offset
    }
}

// ============================================================================
// ConflictScores
// ============================================================================

/// Tracks how often each cell causes a conflict (backtrack).
///
/// Mirrors JS `ConflictScores` from candidate_selector.js.
/// Exponentially decayed so information reflects recent search areas.
pub struct ConflictScores {
    /// Per-cell conflict scores.
    pub scores: [i32; NUM_CELLS],

    /// Per-value conflict scores.
    value_scores: [u32; NUM_VALUES],

    /// Countdown to next decay.
    decay_countdown: u32,
}

impl ConflictScores {
    const DECAY_FREQUENCY: u32 = 1 << 14;

    pub fn new(initial_scores: &[i32; NUM_CELLS]) -> Self {
        ConflictScores {
            scores: *initial_scores,
            value_scores: [0; NUM_VALUES],
            decay_countdown: Self::DECAY_FREQUENCY,
        }
    }

    /// Increment the conflict score for a cell/value pair.
    pub fn increment(&mut self, cell: u8, value_mask: u16) {
        self.scores[cell as usize] += 1;

        let value_index = value_mask.trailing_zeros() as usize;
        if value_index < NUM_VALUES {
            self.value_scores[value_index] += 1;
        }

        self.decay_countdown -= 1;
        if self.decay_countdown == 0 {
            self.decay();
        }
    }

    /// Decay all scores (halve cell scores, quarter value scores).
    pub fn decay(&mut self) {
        for s in self.scores.iter_mut() {
            *s >>= 1;
        }
        for s in self.value_scores.iter_mut() {
            *s >>= 2;
        }
        self.decay_countdown = Self::DECAY_FREQUENCY;
    }

    /// Returns the value bitmask and score of the most conflict-prone value.
    /// Returns (0, 0) if there is insufficient spread or significance.
    ///
    /// Mirrors JS `ConflictScores.getMaxValueScore()`.
    pub fn get_max_value_score(&self) -> (u16, u32) {
        let mut max: u32 = 0;
        let mut value: u16 = 0;
        let mut min: u32 = u32::MAX;

        for i in 0..NUM_VALUES {
            let s = self.value_scores[i];
            if s > max {
                max = s;
                value = 1 << i;
            }
            if s > 0 && s < min {
                min = s;
            }
        }

        // Only return a value if there is sufficient spread (max > 1.5 * min),
        // and the max is significant compared to the number of values.
        // JS: if (max < this._numValues || (max << 1) <= min * 3)
        if max < NUM_VALUES as u32 || (max << 1) <= min * 3 {
            return (0, 0);
        }

        (value, max)
    }
}

// ============================================================================
// HouseCandidateFinder
// ============================================================================

/// A candidate finder for a single house (row, column, or box).
///
/// Mirrors JS `CandidateFinders.House` from candidate_selector.js.
/// Detects values that appear in exactly 2 cells within the house,
/// and proposes those as branching candidates.
struct HouseCandidateFinder {
    cells: Vec<u8>,
}

impl HouseCandidateFinder {
    fn new(cells: Vec<u8>) -> Self {
        HouseCandidateFinder { cells }
    }

    /// Score a specific value that appears in exactly 2 cells.
    ///
    /// Returns true if this candidate beats the current best.
    fn score_value(
        &self,
        grid: &[u16],
        v: u16,
        conflict_scores: &[i32; NUM_CELLS],
        best_score: &mut f64,
        best_value: &mut u16,
        best_cells: &mut Vec<u8>,
    ) -> bool {
        let mut cell0: u8 = 0;
        let mut cell1: u8 = 0;
        let mut max_cs: i32 = 0;

        for &c in &self.cells {
            if (grid[c as usize] & v) != 0 {
                cell0 = cell1;
                cell1 = c;
                let cs = conflict_scores[c as usize];
                if cs > max_cs {
                    max_cs = cs;
                }
            }
        }

        let score = max_cs as f64 * 0.5;
        // NOTE: We replace the result if the score is equal.
        // It is better on the benchmarks.
        if score < *best_score {
            return false;
        }

        *best_score = score;
        *best_value = v;
        best_cells.clear();
        best_cells.push(cell1);
        best_cells.push(cell0);
        true
    }

    /// Find candidate values that appear in exactly 2 cells within this house.
    ///
    /// Mirrors JS `House.maybeFindCandidate`.
    fn maybe_find_candidate(
        &self,
        grid: &[u16],
        conflict_scores: &[i32; NUM_CELLS],
        best_score: &mut f64,
        best_value: &mut u16,
        best_cells: &mut Vec<u8>,
    ) -> bool {
        let mut all_values: u16 = 0;
        let mut more_than_one: u16 = 0;
        let mut more_than_two: u16 = 0;

        for &c in &self.cells {
            let v = grid[c as usize];
            more_than_two |= more_than_one & v;
            more_than_one |= all_values & v;
            all_values |= v;
        }

        let mut exactly_two = more_than_one & !more_than_two;
        let mut found_candidate = false;

        while exactly_two != 0 {
            let v = exactly_two & exactly_two.wrapping_neg(); // lowest bit
            exactly_two ^= v;
            found_candidate =
                self.score_value(grid, v, conflict_scores, best_score, best_value, best_cells)
                    || found_candidate;
        }
        found_candidate
    }
}

// ============================================================================
// CandidateFinderSet
// ============================================================================

/// Set of candidate finders, lazily initialized.
///
/// Mirrors JS `CandidateFinderSet` from candidate_selector.js.
/// Maps cells to finder indices for efficient lookup.
struct CandidateFinderSet {
    finders: Vec<HouseCandidateFinder>,
    indexes_by_cell: Vec<Vec<usize>>,
    marked: Vec<bool>,
    initialized: bool,
}

impl CandidateFinderSet {
    fn new() -> Self {
        let mut indexes_by_cell = Vec::with_capacity(NUM_CELLS);
        for _ in 0..NUM_CELLS {
            indexes_by_cell.push(Vec::new());
        }

        CandidateFinderSet {
            finders: Vec::new(),
            indexes_by_cell,
            marked: Vec::new(),
            initialized: false,
        }
    }

    /// Initialize the finder set with house data.
    ///
    /// Called lazily on the first multi-value decision, with the current
    /// grid state (matching JS behavior).
    fn initialize(&mut self, _grid: &[u16]) {
        // Create finders for all 27 houses.
        let houses = Grid::all_houses();
        let mut finders = Vec::with_capacity(houses.len());

        for house in &houses {
            let cells: Vec<u8> = house.iter().map(|&c| c as u8).collect();
            finders.push(HouseCandidateFinder::new(cells));
        }

        // Map cells to finder indices.
        for ibc in self.indexes_by_cell.iter_mut() {
            ibc.clear();
        }
        for (i, finder) in finders.iter().enumerate() {
            for &cell in &finder.cells {
                self.indexes_by_cell[cell as usize].push(i);
            }
        }

        self.marked = vec![false; finders.len()];
        self.finders = finders;
        self.initialized = true;
    }

    fn get_indexes_for_cell(&self, cell: usize) -> &[usize] {
        &self.indexes_by_cell[cell]
    }

    fn is_marked(&self, index: usize) -> bool {
        self.marked[index]
    }

    fn mark(&mut self, index: usize) {
        self.marked[index] = true;
    }

    fn clear_marks(&mut self) {
        for m in self.marked.iter_mut() {
            *m = false;
        }
    }
}

// ============================================================================
// CandidateSelectionState
// ============================================================================

/// Per-depth state for custom candidate selection.
///
/// Mirrors JS `_candidateSelectionStates` entries.
struct CandidateSelectionState {
    score: f64,
    value: u16,
    cells: Vec<u8>,
}

impl CandidateSelectionState {
    fn new() -> Self {
        CandidateSelectionState {
            score: 0.0,
            value: 0,
            cells: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_cell_order() {
        let priorities = [0i32; NUM_CELLS];
        let selector = CandidateSelector::new(&priorities);
        for i in 0..NUM_CELLS {
            assert_eq!(selector.cell_order[i], i as u8);
        }
    }

    #[test]
    fn test_conflict_scores_decay() {
        let mut scores = ConflictScores::new(&[0; NUM_CELLS]);
        scores.scores[5] = 100;
        scores.decay();
        assert_eq!(scores.scores[5], 50);
        scores.decay();
        assert_eq!(scores.scores[5], 25);
    }

    #[test]
    fn test_select_singleton() {
        let priorities = [0i32; NUM_CELLS];
        let mut selector = CandidateSelector::new(&priorities);

        let mut grid = [util::ALL_VALUES; NUM_CELLS];
        grid[0] = util::value_bit(5); // singleton

        let result = selector.select_next_candidate(0, &grid, true);
        assert_eq!(result.value, util::value_bit(5));
        assert_eq!(result.count, 1);
        assert!(result.next_depth >= 1);
    }
}
