use super::StepGuide;
use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::rng::RandomIntGenerator;

// ============================================================================
// CandidateFinderDescription — handler-provided finder specifications
// ============================================================================

/// Description of a candidate finder to be created by `CandidateFinderSet`.
///
/// Handlers return these from `candidate_finders()`. The actual finder
/// objects are created lazily by `CandidateFinderSet::initialize()` using
/// the grid state at the time of first multi-value decision.
///
/// Mirrors JS `CandidateFinders.House` / `CandidateFinders.RequiredValue`.
pub enum CandidateFinderDescription {
    /// House-based finder: detects values appearing in exactly 2 cells.
    House { cells: Vec<CellIndex> },
    /// Required-value finder: for a specific value across a set of cells,
    /// with a multiplier to prioritise rank sets with more clues.
    RequiredValue {
        cells: Vec<CellIndex>,
        value: CandidateSet,
        multiplier: f64,
    },
}

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
    cell_order: Vec<CellIndex>,

    /// Conflict scores for prioritizing cells.
    conflict_scores: ConflictScores,

    /// Saved so full_reset() can reinitialize conflict_scores.
    initial_cell_priorities: Vec<i32>,

    /// Candidate finder set for house-based hidden pair detection.
    candidate_finder_set: CandidateFinderSet,

    /// Per-depth candidate selection state for backtrack reuse.
    candidate_selection_states: Vec<CandidateSelectionState>,

    /// Per-depth flags indicating whether a custom candidate was used.
    candidate_selection_flags: Vec<bool>,

    /// Number of cells in this grid (cached for loop bounds).
    num_cells: usize,

    /// Sampling mode state (for estimated_count_solutions).
    /// When active, values are chosen randomly and only one branch is explored.
    sampling: Option<SamplingState>,
}

/// State for Knuth's random-walk solution estimation.
struct SamplingState {
    /// PRNG matching JS RandomIntGenerator.
    rng: RandomIntGenerator,
    /// Running product of branching factors (weight per depth).
    total_weight: Vec<f64>,
}

impl SamplingState {
    fn new(num_cells: usize) -> Self {
        let mut total_weight = vec![0.0; num_cells + 1];
        total_weight[0] = 1.0;
        SamplingState {
            rng: RandomIntGenerator::new(0),
            total_weight,
        }
    }

    /// Pick a random value from a CandidateSet.
    fn select_random_value(&mut self, values: CandidateSet, count: u32) -> CandidateSet {
        let n = self.rng.random_int(count - 1) as usize;
        // Clear the n lowest set bits, then take the lowest.
        let mut v = values.raw();
        for _ in 0..n {
            v &= v.wrapping_sub(1); // clear lowest set bit
        }
        CandidateSet::from_raw(v).lowest()
    }
}

/// Return value from `select_next_candidate`.
pub struct CandidateSelection {
    /// Index into cell_order past all singletons (next depth to recurse to).
    pub next_depth: usize,
    /// The candidate value to try.
    pub value: CandidateSet,
    /// Number of options we selected from (1 = forced, >1 = guess).
    pub count: u32,
}

impl CandidateSelector {
    pub fn new(
        cell_priorities: &[i32],
        num_values: usize,
        finder_descriptions: Vec<CandidateFinderDescription>,
    ) -> Self {
        let num_cells = cell_priorities.len();
        let mut cell_order = vec![0 as CellIndex; num_cells];
        for (i, slot) in cell_order.iter_mut().enumerate() {
            *slot = i as CellIndex;
        }

        let candidate_selection_states: Vec<_> = (0..num_cells)
            .map(|_| CandidateSelectionState::new())
            .collect();

        CandidateSelector {
            cell_order,
            conflict_scores: ConflictScores::new(cell_priorities, num_values),
            initial_cell_priorities: cell_priorities.to_vec(),
            candidate_finder_set: CandidateFinderSet::new(num_cells, finder_descriptions),
            candidate_selection_states,
            candidate_selection_flags: vec![false; num_cells],
            num_cells,
            sampling: None,
        }
    }

    /// Reset for a new solve run (preserves conflict scores).
    pub fn reset(&mut self) {
        for i in 0..self.num_cells {
            self.cell_order[i] = i as CellIndex;
        }
        self.candidate_selection_flags.fill(false);
        self.candidate_finder_set.initialized = false;
    }

    /// Full reset: cell order, conflict scores, and candidate finder.
    ///
    /// Used by nth_step which always replays from scratch and needs
    /// identical search paths every time.
    pub fn full_reset(&mut self) {
        self.reset();
        let num_values = self.conflict_scores.value_scores.len();
        self.conflict_scores = ConflictScores::new(&self.initial_cell_priorities, num_values);
    }

    /// Get the cell at a given depth in the ordering.
    #[inline(always)]
    pub fn get_cell_at_depth(&self, depth: usize) -> CellIndex {
        self.cell_order[depth]
    }

    /// Get the cell order slice up to the given depth.
    ///
    /// Returns the first `depth` cells in the current ordering.
    /// Mirrors JS `getCellOrder(cellDepth)`.
    pub fn get_cell_order(&self, depth: usize) -> &[CellIndex] {
        &self.cell_order[..depth]
    }

    /// Get the initial cell priorities.
    pub fn initial_cell_priorities(&self) -> &[i32] {
        &self.initial_cell_priorities
    }

    /// Get mutable reference to conflict scores.
    pub fn conflict_scores_mut(&mut self) -> &mut ConflictScores {
        &mut self.conflict_scores
    }

    /// Get immutable reference to conflict scores.
    pub fn conflict_scores(&self) -> &ConflictScores {
        &self.conflict_scores
    }

    /// Enable sampling mode for Knuth random-walk estimation.
    pub fn enable_sampling(&mut self) {
        self.sampling = Some(SamplingState::new(self.num_cells));
    }

    /// Disable sampling mode.
    pub fn disable_sampling(&mut self) {
        self.sampling = None;
    }

    /// Get the solution weight (product of branching factors along the path).
    /// Only valid in sampling mode after a solution has been found.
    pub fn solution_weight(&self) -> f64 {
        self.sampling
            .as_ref()
            .map(|s| s.total_weight[self.num_cells])
            .unwrap_or(0.0)
    }

    /// Select the next candidate cell and value to try, with optional
    /// step guide override.
    ///
    /// `cell_depth`: current depth in the search tree.
    /// `grid`: current grid state.
    /// `is_new_node`: true if we're exploring this node for the first time.
    /// `step_guide`: optional step guide to override cell/value selection.
    ///
    /// Mirrors JS `selectNextCandidate` + `_adjustForStepState`.
    /// If a step guide is provided and matches the current depth, the
    /// cell and/or value selection is overridden.
    ///
    /// Returns `CandidateSelection` with the next depth, value, and count.
    /// If count is 0, there's a domain wipeout (contradiction).
    pub fn select_next_candidate(
        &mut self,
        cell_depth: usize,
        grid: &[CandidateSet],
        is_new_node: bool,
        step_guide: Option<&StepGuide>,
    ) -> CandidateSelection {
        // Sampling mode: force single-branch exploration.
        if self.sampling.is_some() {
            if !is_new_node {
                // On backtrack, return count=0 to stop exploring.
                return CandidateSelection {
                    next_depth: 0,
                    value: CandidateSet::EMPTY,
                    count: 0,
                };
            }
        }

        let (mut cell_offset, mut value, mut count) =
            self.select_best_candidate(grid, cell_depth, is_new_node);

        if count == 0 {
            return CandidateSelection {
                next_depth: 0,
                value: CandidateSet::EMPTY,
                count: 0,
            };
        }

        // Apply step guide override if present and matching depth.
        if let Some(guide) = step_guide {
            if guide.depth == cell_depth {
                let mut adjusted = false;

                // Override cell if specified.
                if let Some(guide_cell) = guide.cell {
                    let new_offset = self.cell_order_index_of(guide_cell, cell_depth);
                    if new_offset < self.num_cells && self.cell_order[new_offset] == guide_cell {
                        cell_offset = new_offset;
                        adjusted = true;
                    }
                }

                let cell_values = grid[self.cell_order[cell_offset] as usize];

                if let Some(guide_value) = guide.value {
                    // Override value.
                    value = CandidateSet::from_value(guide_value);
                    adjusted = true;
                } else if guide.cell.is_some() {
                    // If we had a guide cell but no guide value, pick
                    // the lowest bit of the cell's values.
                    value = cell_values.lowest();
                    adjusted = true;
                }

                if adjusted {
                    count = grid[self.cell_order[cell_offset] as usize].count();
                    self.candidate_selection_flags[cell_depth] = false;
                }
            }
        }

        // Update cell order: move selected cell and singletons to front.
        let next_depth = self.update_cell_order(cell_depth, cell_offset, count, grid);

        if next_depth == 0 {
            return CandidateSelection {
                next_depth: 0,
                value: CandidateSet::EMPTY,
                count: 0,
            };
        }

        // Sampling mode: pick a random value and track weight.
        if let Some(ref mut sampling) = self.sampling {
            if count > 1 {
                let cell = self.cell_order[cell_depth] as usize;
                value = sampling.select_random_value(grid[cell], count);
            }
            sampling.total_weight[next_depth] = sampling.total_weight[cell_depth] * count as f64;
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
        grid: &[CandidateSet],
        cell_depth: usize,
        is_new_node: bool,
    ) -> (usize, CandidateSet, u32) {
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
        if first_value.is_single() {
            return (
                cell_depth,
                first_value,
                if !first_value.is_empty() { 1 } else { 0 },
            );
        }

        if first_value.is_empty() {
            return (cell_depth, CandidateSet::EMPTY, 0);
        }

        // Find the best cell to explore next.
        let mut cell_offset = self.select_best_cell(grid, cell_depth);
        let cell = self.cell_order[cell_offset] as usize;
        let values = grid[cell];
        let mut count = values.count();

        // Choose the smallest value (lowest bit).
        let mut value = values.lowest();

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
        //  - Not in sampling mode (mirrors JS `!this._optionSelector`).
        if is_new_node && count > 2 && scores[cell] > 0 && self.sampling.is_none() {
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
    fn cell_order_index_of(&self, cell: CellIndex, from: usize) -> usize {
        for i in from..self.num_cells {
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
        grid: &[CandidateSet],
        cell_depth: usize,
        initial_score: f64,
    ) -> bool {
        let scores = &self.conflict_scores.scores;
        let mut min_cs = (initial_score * 2.0).ceil() as i32;
        let mut found_candidate = false;

        // We need to track which finders have been checked.
        self.candidate_finder_set.clear_marks();

        // Working state for the best result found.
        // Reuse the existing cells Vec to avoid per-call allocation
        // (matching JS where result.cells is mutated in place).
        let mut best_score = initial_score;
        let mut best_value = CandidateSet::EMPTY;
        let mut best_cells = std::mem::take(&mut self.candidate_selection_states[cell_depth].cells);
        best_cells.clear();

        let finder_set = &mut self.candidate_finder_set;

        for i in cell_depth..self.num_cells {
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
            // Put the cells vec back even if nothing found.
            self.candidate_selection_states[cell_depth].cells = best_cells;
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
    fn select_best_cell(&self, grid: &[CandidateSet], cell_depth: usize) -> usize {
        let scores = &self.conflict_scores.scores;

        let (max_value, max_value_score) = self.conflict_scores.get_max_value_score();

        let mut max_score: f64 = -1.0;
        let mut best_offset = cell_depth;

        for i in cell_depth..self.num_cells {
            let cell = self.cell_order[i] as usize;
            let count = grid[cell].count();

            // If we have a single value, use it immediately (no guessing).
            if count <= 1 {
                best_offset = i;
                max_score = -1.0;
                break;
            }

            let mut score_unnormalized = scores[cell] as f64;

            // If a value has been particularly conflict-prone recently, prefer
            // searching cells that contain that value.
            if grid[cell].intersects(max_value) {
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
    fn min_count_cell_index(&self, grid: &[CandidateSet], cell_depth: usize) -> usize {
        let mut min_count = u32::MAX;
        let mut best_offset = cell_depth;

        for i in cell_depth..self.num_cells {
            let count = grid[self.cell_order[i] as usize].count();
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
        grid: &[CandidateSet],
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
        let num_cells = cell_order.len();
        while scan_offset == front_offset && scan_offset < num_cells {
            let v = grid[cell_order[scan_offset] as usize];
            if v.is_single() {
                front_offset += 1;
                if v.is_empty() {
                    return 0;
                }
            }
            scan_offset += 1;
        }

        // Find the rest of the singletons.
        while scan_offset < num_cells {
            let v = grid[cell_order[scan_offset] as usize];
            if v.is_single() {
                if v.is_empty() {
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
    pub scores: Vec<i32>,

    /// Per-value conflict scores.
    value_scores: Vec<u32>,

    /// Countdown to next decay.
    decay_countdown: u32,
}

impl ConflictScores {
    const DECAY_FREQUENCY: u32 = 1 << 14;

    pub fn new(initial_scores: &[i32], num_values: usize) -> Self {
        ConflictScores {
            scores: initial_scores.to_vec(),
            value_scores: vec![0; num_values],
            decay_countdown: Self::DECAY_FREQUENCY,
        }
    }

    /// Increment the conflict score for a cell/value pair.
    pub fn increment(&mut self, cell: CellIndex, value_mask: CandidateSet) {
        self.scores[cell as usize] += 1;

        let value_index = value_mask.index();
        if value_index < self.value_scores.len() {
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
    pub fn get_max_value_score(&self) -> (CandidateSet, u32) {
        let mut max: u32 = 0;
        let mut value = CandidateSet::EMPTY;
        let mut min: u32 = u32::MAX;

        for i in 0..self.value_scores.len() {
            let s = self.value_scores[i];
            if s > max {
                max = s;
                value = CandidateSet::from_value((i + 1) as u8);
            }
            if s > 0 && s < min {
                min = s;
            }
        }

        if max < self.value_scores.len() as u32 || (max << 1) <= min * 3 {
            return (CandidateSet::EMPTY, 0);
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
    cells: Vec<CellIndex>,
}

impl HouseCandidateFinder {
    fn new(cells: Vec<CellIndex>) -> Self {
        HouseCandidateFinder { cells }
    }

    /// Score a specific value that appears in exactly 2 cells.
    ///
    /// Returns true if this candidate beats the current best.
    fn score_value(
        &self,
        grid: &[CandidateSet],
        v: CandidateSet,
        conflict_scores: &[i32],
        best_score: &mut f64,
        best_value: &mut CandidateSet,
        best_cells: &mut Vec<CellIndex>,
    ) -> bool {
        let mut cell0: CellIndex = 0;
        let mut cell1: CellIndex = 0;
        let mut max_cs: i32 = 0;

        for &c in &self.cells {
            if grid[c as usize].intersects(v) {
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
        grid: &[CandidateSet],
        conflict_scores: &[i32],
        best_score: &mut f64,
        best_value: &mut CandidateSet,
        best_cells: &mut Vec<CellIndex>,
    ) -> bool {
        let mut all_values = CandidateSet::EMPTY;
        let mut more_than_one = CandidateSet::EMPTY;
        let mut more_than_two = CandidateSet::EMPTY;

        for &c in &self.cells {
            let v = grid[c as usize];
            more_than_two |= more_than_one & v;
            more_than_one |= all_values & v;
            all_values |= v;
        }

        let mut exactly_two = more_than_one & !more_than_two;
        let mut found_candidate = false;

        while !exactly_two.is_empty() {
            let v = exactly_two.lowest();
            exactly_two ^= v;
            found_candidate =
                self.score_value(grid, v, conflict_scores, best_score, best_value, best_cells)
                    || found_candidate;
        }
        found_candidate
    }
}

// ============================================================================
// RequiredValueCandidateFinder
// ============================================================================

/// A candidate finder for a specific required value across a set of cells.
///
/// Mirrors JS `CandidateFinders.RequiredValue` from candidate_selector.js.
/// Finds cells containing a specific value and scores them by the maximum
/// conflict score divided by the number of matching cells, scaled by a
/// multiplier.
struct RequiredValueCandidateFinder {
    cells: Vec<CellIndex>,
    value: CandidateSet,
    multiplier: f64,
}

impl RequiredValueCandidateFinder {
    fn new(cells: Vec<CellIndex>, value: CandidateSet, multiplier: f64) -> Self {
        RequiredValueCandidateFinder {
            cells,
            value,
            multiplier,
        }
    }

    /// Mirrors JS `RequiredValue.maybeFindCandidate`.
    fn maybe_find_candidate(
        &self,
        grid: &[CandidateSet],
        conflict_scores: &[i32],
        best_score: &mut f64,
        best_value: &mut CandidateSet,
        best_cells: &mut Vec<CellIndex>,
    ) -> bool {
        let value = self.value;

        // Count valid cells (ones which contain the value).
        // Track the maximum conflict score.
        let mut count = 0u32;
        let mut max_cs: i32 = 0;
        for &c in &self.cells {
            if grid[c as usize].intersects(value) {
                count += 1;
                let cs = conflict_scores[c as usize];
                if cs > max_cs {
                    max_cs = cs;
                }
            }
        }

        // If count is 1, the value is already resolved.
        if count < 2 {
            return false;
        }

        let score = max_cs as f64 * self.multiplier / count as f64;
        // NOTE: We replace the result if the score is equal.
        if score < *best_score {
            return false;
        }

        *best_score = score;
        *best_value = value;
        best_cells.clear();
        for &c in &self.cells {
            if grid[c as usize].intersects(value) {
                best_cells.push(c);
            }
        }
        true
    }
}

// ============================================================================
// CandidateFinder — enum wrapping all finder types
// ============================================================================

/// Unified candidate finder, dispatching to the concrete type.
enum CandidateFinder {
    House(HouseCandidateFinder),
    RequiredValue(RequiredValueCandidateFinder),
}

impl CandidateFinder {
    fn cells(&self) -> &[CellIndex] {
        match self {
            CandidateFinder::House(f) => &f.cells,
            CandidateFinder::RequiredValue(f) => &f.cells,
        }
    }

    fn maybe_find_candidate(
        &self,
        grid: &[CandidateSet],
        conflict_scores: &[i32],
        best_score: &mut f64,
        best_value: &mut CandidateSet,
        best_cells: &mut Vec<CellIndex>,
    ) -> bool {
        match self {
            CandidateFinder::House(f) => {
                f.maybe_find_candidate(grid, conflict_scores, best_score, best_value, best_cells)
            }
            CandidateFinder::RequiredValue(f) => {
                f.maybe_find_candidate(grid, conflict_scores, best_score, best_value, best_cells)
            }
        }
    }
}

// ============================================================================
// CandidateFinderSet
// ============================================================================

/// Set of candidate finders, lazily initialized from descriptions.
///
/// Mirrors JS `CandidateFinderSet` from candidate_selector.js.
/// Stores `CandidateFinderDescription`s provided by handlers and builds
/// actual finders on lazy initialization with the current grid state.
/// Maps cells to finder indices for efficient lookup.
struct CandidateFinderSet {
    finders: Vec<CandidateFinder>,
    indexes_by_cell: Vec<Vec<usize>>,
    marked: Vec<bool>,
    initialized: bool,
    /// Finder descriptions collected from handlers at construction time.
    /// Consumed during `initialize()`.
    descriptions: Vec<CandidateFinderDescription>,
}

impl CandidateFinderSet {
    fn new(num_cells: usize, descriptions: Vec<CandidateFinderDescription>) -> Self {
        let indexes_by_cell: Vec<Vec<usize>> = (0..num_cells).map(|_| Vec::new()).collect();

        CandidateFinderSet {
            finders: Vec::new(),
            indexes_by_cell,
            marked: Vec::new(),
            initialized: false,
            descriptions,
        }
    }

    /// Initialize the finder set from handler-provided descriptions.
    ///
    /// Called lazily on the first multi-value decision, with the current
    /// grid state. For `RequiredValue` finders, cells are filtered using
    /// `filter_cells_by_value` (matching JS `CandidateFinders.filterCellsByValue`).
    fn initialize(&mut self, grid: &[CandidateSet]) {
        let mut finders = Vec::with_capacity(self.descriptions.len());

        for desc in &self.descriptions {
            match desc {
                CandidateFinderDescription::House { cells } => {
                    finders.push(CandidateFinder::House(HouseCandidateFinder::new(
                        cells.clone(),
                    )));
                }
                CandidateFinderDescription::RequiredValue {
                    cells,
                    value,
                    multiplier,
                } => {
                    let filtered = Self::filter_cells_by_value(cells, grid, *value);
                    if !filtered.is_empty() {
                        finders.push(CandidateFinder::RequiredValue(
                            RequiredValueCandidateFinder::new(filtered, *value, *multiplier),
                        ));
                    }
                }
            }
        }

        // Map cells to finder indices.
        for ibc in self.indexes_by_cell.iter_mut() {
            ibc.clear();
        }
        for (i, finder) in finders.iter().enumerate() {
            for &cell in finder.cells() {
                self.indexes_by_cell[cell as usize].push(i);
            }
        }

        self.marked = vec![false; finders.len()];
        self.finders = finders;
        self.initialized = true;
    }

    /// Filter cells to those containing `value_mask` and not yet fixed.
    ///
    /// Mirrors JS `CandidateFinders.filterCellsByValue`.
    /// Returns empty if only 1 cell matches (value already resolved).
    fn filter_cells_by_value(
        cells: &[CellIndex],
        grid: &[CandidateSet],
        value_mask: CandidateSet,
    ) -> Vec<CellIndex> {
        let mut result = Vec::new();
        for &c in cells {
            let v = grid[c as usize];
            // Include if cell contains the value AND is not fixed (has >1 candidate).
            if v.intersects(value_mask) && v.count() > 1 {
                result.push(c);
            }
        }
        // If only 1 cell matches, don't bother — value is effectively resolved.
        if result.len() == 1 {
            result.clear();
        }
        result
    }

    fn clear_marks(&mut self) {
        self.marked.fill(false);
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
    value: CandidateSet,
    cells: Vec<CellIndex>,
}

impl CandidateSelectionState {
    fn new() -> Self {
        CandidateSelectionState {
            score: 0.0,
            value: CandidateSet::EMPTY,
            cells: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NUM_CELLS: usize = 81;
    const NUM_VALUES: usize = 9;

    #[test]
    fn test_initial_cell_order() {
        let priorities = vec![0i32; NUM_CELLS];
        let selector = CandidateSelector::new(&priorities, NUM_VALUES, vec![]);
        for i in 0..NUM_CELLS {
            assert_eq!(selector.cell_order[i], i as u8);
        }
    }

    #[test]
    fn test_conflict_scores_decay() {
        let mut scores = ConflictScores::new(&vec![0; NUM_CELLS], NUM_VALUES);
        scores.scores[5] = 100;
        scores.decay();
        assert_eq!(scores.scores[5], 50);
        scores.decay();
        assert_eq!(scores.scores[5], 25);
    }

    #[test]
    fn test_select_singleton() {
        let priorities = vec![0i32; NUM_CELLS];
        let mut selector = CandidateSelector::new(&priorities, NUM_VALUES, vec![]);

        let mut grid = vec![CandidateSet::all(9); NUM_CELLS];
        grid[0] = CandidateSet::from_value(5); // singleton

        let result = selector.select_next_candidate(0, &grid, true, None);
        assert_eq!(result.value, CandidateSet::from_value(5));
        assert_eq!(result.count, 1);
        assert!(result.next_depth >= 1);
    }
}
