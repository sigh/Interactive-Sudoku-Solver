//! FullRank — ranking constraint that orders entries by first-differing cell.
//!
//! Each clue specifies a rank for a row/column entry (forward or reversed).
//! The rank determines ordering between entries: lower rank < higher rank,
//! meaning the sequence of cell values is lexicographically smaller.
//!
//! Mirrors JS `FullRank`.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;
use crate::solver::candidate_selector::CandidateFinderDescription;

/// Tie-breaking mode for FullRank.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TieMode {
    None = 0,
    #[allow(dead_code)]
    OnlyUnclued = 1,
    Any = 2,
}

impl TieMode {
    #[allow(dead_code)]
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => TieMode::None,
            1 => TieMode::OnlyUnclued,
            _ => TieMode::Any,
        }
    }

    pub fn min(self, other: Self) -> Self {
        if (self as u8) < (other as u8) {
            self
        } else {
            other
        }
    }
}

/// A rank clue: specifies the rank for a particular entry (row/col direction).
#[derive(Debug, Clone)]
pub struct RankClue {
    /// The rank value (0-based global rank).
    pub rank: u32,
    /// The first two cells of the entry line (identify which entry).
    pub line: [u8; 2],
}

/// Internal rank-set entry.
struct RankedGiven {
    rank_index: u8,
    entry_idx: usize,
    num_ranks_below: u8,
    num_ranks_above: u8,
}

struct RankSet {
    value: CandidateSet,
    givens: Vec<RankedGiven>,
}

/// FullRank constraint handler.
///
/// Groups clues by value (rank/4), enforces ordering between entries.
pub struct FullRank {
    all_cells: Vec<CellIndex>,
    clues: Vec<RankClue>,
    tie_mode: TieMode,
    /// All entries: rows forward/reverse + cols forward/reverse.
    all_entries: Vec<Vec<CellIndex>>,
    /// Entries without clues.
    unclued_entries: Vec<usize>,
    /// Per-value rank sets.
    rank_sets: Vec<RankSet>,

    // Scratch buffers matching JS instance fields.
    // Wrapped in RefCell because enforce_consistency takes &self.
    /// JS: `_viableEntriesBuffer = new Int16Array(SHAPE_MAX.numValues * 4 + 1)`
    viable_entries_buffer: RefCell<Vec<usize>>,
    /// JS: `_flagsBuffer = new Uint8Array(SHAPE_MAX.numValues * 4)`
    flags_buffer: RefCell<Vec<u8>>,
    /// JS: `_pairBitSetsBuffer = new Uint16Array(shape.numValues)`
    pair_bit_sets_buffer: RefCell<Vec<u16>>,
    /// JS: `_seenPairsBuffer = new Uint32Array(shape.numValues * 4)`
    seen_pairs_buffer: RefCell<Vec<u32>>,
}

impl FullRank {
    pub fn new(num_grid_cells: usize, clues: Vec<RankClue>, tie_mode: TieMode) -> Self {
        // FullRank clues must have unique ranks.
        let mut seen_ranks = HashSet::new();
        for clue in &clues {
            if !seen_ranks.insert(clue.rank) {
                panic!("FullRank clue rank {} is not unique", clue.rank);
            }
        }

        let all_cells: Vec<CellIndex> = (0..num_grid_cells as CellIndex).collect();
        Self {
            all_cells,
            clues,
            tie_mode,
            all_entries: Vec::new(),
            unclued_entries: Vec::new(),
            rank_sets: Vec::new(),
            viable_entries_buffer: RefCell::new(Vec::new()),
            flags_buffer: RefCell::new(Vec::new()),
            pair_bit_sets_buffer: RefCell::new(Vec::new()),
            seen_pairs_buffer: RefCell::new(Vec::new()),
        }
    }

    pub fn clues(&self) -> &[RankClue] {
        &self.clues
    }

    pub fn tie_mode(&self) -> TieMode {
        self.tie_mode
    }

    /// Build all entry sequences for a shape (rows fwd/rev + cols fwd/rev).
    pub fn build_entries(shape: GridShape) -> Vec<Vec<CellIndex>> {
        let nr = shape.num_rows as usize;
        let nc = shape.num_cols as usize;
        let mut entries = Vec::new();

        for i in 0..nr {
            let row: Vec<CellIndex> = (0..nc).map(|j| (i * nc + j) as CellIndex).collect();
            let rev: Vec<CellIndex> = row.iter().rev().copied().collect();
            entries.push(row);
            entries.push(rev);
        }
        for j in 0..nc {
            let col: Vec<CellIndex> = (0..nr).map(|i| (i * nc + j) as CellIndex).collect();
            let rev: Vec<CellIndex> = col.iter().rev().copied().collect();
            entries.push(col);
            entries.push(rev);
        }

        entries
    }

    /// Find the entry whose first two cells match.
    pub fn entry_from_clue(entries: &[Vec<CellIndex>], clue: &RankClue) -> Option<usize> {
        entries
            .iter()
            .position(|e| e.len() >= 2 && e[0] == clue.line[0] && e[1] == clue.line[1])
    }

    /// Min value (1-indexed) from raw u16, returning 0 for empty set.
    /// Matches JS `LookupTables.minValue` behavior for v=0.
    #[inline]
    fn raw_min_value(v: u16) -> u8 {
        if v == 0 {
            return 0;
        }
        v.trailing_zeros() as u8 + 1
    }

    /// Max value (1-indexed) from raw u16, returning 0 for empty set.
    #[inline]
    fn raw_max_value(v: u16) -> u8 {
        if v == 0 {
            return 0;
        }
        16 - v.leading_zeros() as u8
    }

    /// Port of JS `_enforceOrderedEntryPair`.
    ///
    /// Enforces strict lexicographic ordering: low_entry < high_entry.
    /// Returns false if the entries are forced to be equal (tie violation).
    fn enforce_ordered_entry_pair(
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
        low_entry: &[u8],
        high_entry: &[u8],
    ) -> bool {
        // Track which fixed-equal values can be excluded from future positions.
        let mut equal_values_mask: u16 =
            !(grid[low_entry[0] as usize].raw() & grid[high_entry[0] as usize].raw());
        let entry_length = low_entry.len();

        for i in 1..entry_length {
            let mut low_v = grid[low_entry[i] as usize].raw() & equal_values_mask;
            let mut high_v = grid[high_entry[i] as usize].raw() & equal_values_mask;

            // If both are the same singleton, they're equal — keep looking.
            if low_v == high_v && (low_v & low_v.wrapping_sub(1)) == 0 {
                equal_values_mask &= !low_v;
                continue;
            }

            // Constrain low: max(low) must not exceed max(high).
            let max_high_v = Self::raw_max_value(high_v);
            if Self::raw_max_value(low_v) > max_high_v {
                let mask = ((1u32 << max_high_v as u32) - 1) as u16;
                low_v &= mask & equal_values_mask;
                grid[low_entry[i] as usize] = CandidateSet::from_raw(low_v);
                acc.add_for_cell(low_entry[i]);
            }

            // Constrain high: min(high) must not be below min(low).
            let min_low_v = Self::raw_min_value(low_v);
            if Self::raw_min_value(high_v) < min_low_v {
                let mask = 0xFFFFu16 << (min_low_v - 1);
                high_v &= mask & equal_values_mask;
                grid[high_entry[i] as usize] = CandidateSet::from_raw(high_v);
                acc.add_for_cell(high_entry[i]);
            }

            if low_v == 0 || high_v == 0 {
                return false;
            }

            // If the cells are now equal and fixed, keep constraining.
            if !(low_v == high_v && (low_v & low_v.wrapping_sub(1)) == 0) {
                return true;
            }
            equal_values_mask &= !low_v;
        }

        // Went through every position without finding a difference → tie.
        false
    }

    /// Port of JS `_enforceUncluedEntriesForGiven`.
    ///
    /// Determines which unclued entries can be less/greater than the given
    /// clued entry, and enforces rank constraints.
    fn enforce_unclued_entries_for_given(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
        viable_entries: &[usize],
        num_viable: usize,
        given: &RankedGiven,
    ) -> bool {
        let entry = &self.all_entries[given.entry_idx];
        let num_ranks_below = given.num_ranks_below as usize;
        let num_ranks_above = given.num_ranks_above as usize;
        let permissive_clues = self.tie_mode == TieMode::Any;
        let initial_v = grid[entry[0] as usize].raw();
        let entry_length = entry.len();

        const IS_SET_FLAG: u8 = 1;
        const IS_LESS_FLAG: u8 = 2;
        const IS_GREATER_FLAG: u8 = 4;
        const IS_NOT_EQUAL: u8 = 8;
        const IS_EITHER_SIDE: u8 = IS_LESS_FLAG | IS_GREATER_FLAG;

        let mut maybe_less_count: usize = 0;
        let mut maybe_greater_count: usize = 0;
        let mut fixed_less_count: usize = 0;
        let mut fixed_greater_count: usize = 0;

        let fixed_base_flags: u8 = IS_SET_FLAG | if permissive_clues { IS_NOT_EQUAL } else { 0 };

        let mut flags_ref = self.flags_buffer.borrow_mut();
        let flags_buffer = &mut *flags_ref;

        for i in 0..num_viable {
            let unclued_idx = self.unclued_entries[viable_entries[i]];
            let e = &self.all_entries[unclued_idx];

            let mut flags: u8 = if grid[e[0] as usize].raw() == initial_v {
                IS_SET_FLAG
            } else {
                0
            };

            let mut equal_values_mask: u16 = !initial_v;

            for j in 1..entry_length {
                let e_v = grid[e[j] as usize].raw() & equal_values_mask;
                let entry_v = grid[entry[j] as usize].raw() & equal_values_mask;

                let min_e = Self::raw_min_value(e_v);
                let max_e = Self::raw_max_value(e_v);
                let min_entry = Self::raw_min_value(entry_v);
                let max_entry = Self::raw_max_value(entry_v);

                if max_e > min_entry {
                    flags |= IS_GREATER_FLAG;
                }
                if min_e < max_entry {
                    flags |= IS_LESS_FLAG;
                }
                if (entry_v & e_v) == 0 {
                    flags |= IS_NOT_EQUAL;
                }

                if (flags & IS_EITHER_SIDE) == IS_EITHER_SIDE {
                    break;
                }
                if min_e > max_entry || max_e < min_entry {
                    break;
                }

                equal_values_mask &= !(e_v & entry_v);
            }

            if !permissive_clues {
                if flags == IS_SET_FLAG {
                    return false;
                }
                flags |= IS_NOT_EQUAL;
            }

            flags_buffer[i] = flags;

            let has_less = (flags & IS_LESS_FLAG) != 0;
            let has_greater = (flags & IS_GREATER_FLAG) != 0;

            if has_greater {
                maybe_greater_count += 1;
                if !has_less && ((!flags) & fixed_base_flags) == 0 {
                    fixed_greater_count += 1;
                }
            }
            if has_less {
                maybe_less_count += 1;
                if !has_greater && ((!flags) & fixed_base_flags) == 0 {
                    fixed_less_count += 1;
                }
            }
        }

        // --- Less direction ---
        if maybe_less_count < num_ranks_below {
            return false;
        }
        if fixed_less_count > num_ranks_below {
            return false;
        }

        if maybe_less_count == num_ranks_below && fixed_less_count < num_ranks_below {
            // All viable less entries must be forced in.
            for i in 0..num_viable {
                if (flags_buffer[i] & IS_LESS_FLAG) != 0 {
                    let unclued_idx = self.unclued_entries[viable_entries[i]];
                    let cell = self.all_entries[unclued_idx][0];
                    grid[cell as usize] = CandidateSet::from_raw(initial_v);
                    acc.add_for_cell(cell);
                }
            }
        } else if fixed_less_count == num_ranks_below && maybe_less_count > num_ranks_below {
            for i in 0..num_viable {
                if flags_buffer[i] == (IS_LESS_FLAG | IS_NOT_EQUAL) {
                    let unclued_idx = self.unclued_entries[viable_entries[i]];
                    let cell = self.all_entries[unclued_idx][0];
                    grid[cell as usize] =
                        CandidateSet::from_raw(grid[cell as usize].raw() & !initial_v);
                    acc.add_for_cell(cell);
                } else if flags_buffer[i]
                    == (IS_LESS_FLAG | IS_GREATER_FLAG | IS_SET_FLAG | IS_NOT_EQUAL)
                {
                    let unclued_idx = self.unclued_entries[viable_entries[i]];
                    let unclued_entry = &self.all_entries[unclued_idx];
                    if !Self::enforce_ordered_entry_pair(grid, acc, entry, unclued_entry) {
                        return false;
                    }
                }
            }
        }

        // --- Greater direction ---
        if fixed_greater_count > num_ranks_above {
            return false;
        }
        if !permissive_clues && maybe_greater_count < num_ranks_above {
            return false;
        }

        if !permissive_clues
            && maybe_greater_count == num_ranks_above
            && fixed_greater_count < num_ranks_above
        {
            for i in 0..num_viable {
                if (flags_buffer[i] & IS_GREATER_FLAG) != 0 {
                    let unclued_idx = self.unclued_entries[viable_entries[i]];
                    let cell = self.all_entries[unclued_idx][0];
                    grid[cell as usize] = CandidateSet::from_raw(initial_v);
                    acc.add_for_cell(cell);
                }
            }
        } else if fixed_greater_count == num_ranks_above && maybe_greater_count > num_ranks_above {
            for i in 0..num_viable {
                if flags_buffer[i] == (IS_GREATER_FLAG | IS_NOT_EQUAL) {
                    let unclued_idx = self.unclued_entries[viable_entries[i]];
                    let cell = self.all_entries[unclued_idx][0];
                    grid[cell as usize] =
                        CandidateSet::from_raw(grid[cell as usize].raw() & !initial_v);
                    acc.add_for_cell(cell);
                } else if flags_buffer[i]
                    == (IS_LESS_FLAG | IS_GREATER_FLAG | IS_SET_FLAG | IS_NOT_EQUAL)
                {
                    let unclued_idx = self.unclued_entries[viable_entries[i]];
                    let unclued_entry = &self.all_entries[unclued_idx];
                    if !Self::enforce_ordered_entry_pair(grid, acc, unclued_entry, entry) {
                        return false;
                    }
                }
            }
        }

        true
    }

    /// Port of JS `_enforceSingleRankSet`.
    fn enforce_single_rank_set(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
        rank_set: &RankSet,
    ) -> bool {
        let givens = &rank_set.givens;
        let num_givens = givens.len();

        // Enforce ordering between consecutive clued entries.
        for i in 1..num_givens {
            let lower = &self.all_entries[givens[i - 1].entry_idx];
            let upper = &self.all_entries[givens[i].entry_idx];
            if !Self::enforce_ordered_entry_pair(grid, acc, lower, upper) {
                return false;
            }
        }

        // If all 4 ranks are clued, we're done.
        if num_givens == 4 {
            return true;
        }

        // Find viable unclued entries (first cell can hold the rank's value).
        let mut viable_ref = self.viable_entries_buffer.borrow_mut();
        let viable_entries = &mut *viable_ref;
        let mut num_viable = 0;
        for i in 0..self.unclued_entries.len() {
            let entry_idx = self.unclued_entries[i];
            let first_cell = self.all_entries[entry_idx][0];
            if !(grid[first_cell as usize] & rank_set.value).is_empty() {
                viable_entries[num_viable] = i;
                num_viable += 1;
            }
        }

        // Not enough viable entries to fill remaining ranks.
        if num_viable < 4 - num_givens {
            return false;
        }

        // Enforce unclued entries for each given.
        for given in givens {
            if !self.enforce_unclued_entries_for_given(
                grid,
                acc,
                &viable_entries,
                num_viable,
                given,
            ) {
                return false;
            }
        }

        true
    }

    /// Port of JS `_enforceUniqueRanks`.
    ///
    /// Whole-grid tie check for `TieMode::None`. Only rejects when fully-fixed
    /// entries have identical digit sequences.
    fn enforce_unique_ranks(&self, grid: &[CandidateSet]) -> bool {
        let all_entries = &self.all_entries;
        if all_entries.is_empty() {
            return true;
        }

        let last_index = all_entries[0].len() - 1;
        let mid_index = last_index >> 1;
        let num_values = last_index + 1;

        let mut pair_ref = self.pair_bit_sets_buffer.borrow_mut();
        let pair_bit_sets = &mut *pair_ref;
        pair_bit_sets[..num_values].fill(0);
        let mut seen_ref = self.seen_pairs_buffer.borrow_mut();
        let seen_pairs = &mut *seen_ref;
        seen_pairs[..num_values * 4].fill(0);

        let mut has_duplicate_pair = false;

        // Process forward/reverse entry pairs together.
        let mut i = 0;
        while i < all_entries.len() {
            let entry = &all_entries[i];

            let first_v = grid[entry[0] as usize].raw();
            if (first_v & first_v.wrapping_sub(1)) != 0 {
                i += 2;
                continue;
            }
            let last_v = grid[entry[last_index] as usize].raw();
            if (last_v & last_v.wrapping_sub(1)) != 0 {
                i += 2;
                continue;
            }
            let mid_v = grid[entry[mid_index] as usize].raw();
            if (mid_v & mid_v.wrapping_sub(1)) != 0 {
                i += 2;
                continue;
            }

            let (norm_first, norm_last, index) = if first_v > last_v {
                (last_v, first_v, i + 1)
            } else {
                (first_v, last_v, i)
            };
            // JS: `if (!firstV) continue;`
            if norm_first == 0 {
                i += 2;
                continue;
            }

            let value_index = CandidateSet::from_raw(norm_first).index();

            if (pair_bit_sets[value_index] & norm_last) != 0 {
                has_duplicate_pair = true;
            } else {
                pair_bit_sets[value_index] |= norm_last;
            }

            seen_pairs[index] = ((norm_first | norm_last) as u32) << 16 | index as u32;

            i += 2;
        }

        if !has_duplicate_pair {
            return true;
        }

        seen_pairs[..num_values * 4].sort();

        // Iterate backwards, grouping by key (high 16 bits).
        let mut end = num_values * 4;
        while end > 0 {
            let key = seen_pairs[end - 1] >> 16;
            if key == 0 {
                break;
            }
            let mut start = end - 1;
            while start > 0 && (seen_pairs[start - 1] >> 16) == key {
                start -= 1;
            }

            if end - start > 1 {
                for a in (start + 1)..end {
                    let entry_a = &all_entries[(seen_pairs[a] & 0xffff) as usize];
                    for b in start..a {
                        let entry_b = &all_entries[(seen_pairs[b] & 0xffff) as usize];

                        let mut is_tie = true;
                        for j in 1..last_index {
                            let v_a = grid[entry_a[j] as usize].raw();
                            let v_b = grid[entry_b[j] as usize].raw();
                            if v_a != v_b || (v_a & v_a.wrapping_sub(1)) != 0 {
                                is_tie = false;
                                break;
                            }
                        }

                        if is_tie {
                            return false;
                        }
                    }
                }
            }

            end = start;
        }

        true
    }
}

impl ConstraintHandler for FullRank {
    fn cells(&self) -> &[CellIndex] {
        &self.all_cells
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        if shape.num_rows != shape.num_values || shape.num_cols != shape.num_values {
            return false;
        }

        let entries = Self::build_entries(shape);
        self.all_entries = entries;

        let mut is_clued = vec![false; self.all_entries.len()];
        let mut rank_map: HashMap<u16, Vec<RankedGiven>> =
            HashMap::new();

        for clue in &self.clues {
            let value = CandidateSet::from_value(((clue.rank + 3) / 4) as u8);
            let entry_idx = match Self::entry_from_clue(&self.all_entries, clue) {
                Some(idx) => idx,
                None => return false,
            };
            is_clued[entry_idx] = true;

            let rank_index = ((clue.rank + 3) & 3) as u8;
            rank_map.entry(value.raw()).or_default().push(RankedGiven {
                rank_index,
                entry_idx,
                num_ranks_below: 0,
                num_ranks_above: 0,
            });

            // Fix the first cell to this value.
            let first_cell = self.all_entries[entry_idx][0];
            let restricted = initial_grid[first_cell as usize] & value;
            if restricted.is_empty() {
                return false;
            }
            initial_grid[first_cell as usize] = restricted;
        }

        self.unclued_entries = (0..self.all_entries.len())
            .filter(|&i| !is_clued[i])
            .collect();

        // Allocate scratch buffers matching JS sizes.
        let nv = shape.num_values as usize;
        let max_nv = crate::grid_shape::MAX_SIZE as usize;
        *self.viable_entries_buffer.borrow_mut() = vec![0usize; max_nv * 4 + 1];
        *self.flags_buffer.borrow_mut() = vec![0u8; max_nv * 4];
        *self.pair_bit_sets_buffer.borrow_mut() = vec![0u16; nv];
        *self.seen_pairs_buffer.borrow_mut() = vec![0u32; nv * 4];

        for (value_raw, mut givens) in rank_map {
            givens.sort_by_key(|g| g.rank_index);
            let n = givens.len();
            for i in 0..n {
                let rank_idx = givens[i].rank_index;
                givens[i].num_ranks_below = rank_idx - i as u8;
                givens[i].num_ranks_above = (3 - rank_idx) - (n as u8 - 1 - i as u8);
            }
            self.rank_sets.push(RankSet {
                value: CandidateSet::from_raw(value_raw),
                givens,
            });
        }

        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        for rs in &self.rank_sets {
            if !self.enforce_single_rank_set(grid, acc, rs) {
                return false;
            }
        }

        if self.tie_mode == TieMode::None {
            return self.enforce_unique_ranks(grid);
        }

        true
    }

    fn candidate_finders(&self, shape: GridShape) -> Vec<CandidateFinderDescription> {
        let mut finders = Vec::new();
        let num_rows = shape.num_rows as usize;
        let num_cols = shape.num_cols as usize;

        for rs in &self.rank_sets {
            let value = rs.value;

            // Determine which edges don't have clues.
            // flags[0]=top row, [1]=left col, [2]=bottom row, [3]=right col.
            let mut flags = [true; 4];
            for given in &rs.givens {
                let entry = &self.all_entries[given.entry_idx];
                let cell0 = entry[0] as usize;
                let row = cell0 / num_cols;
                let col = cell0 % num_cols;
                if row == 0 {
                    flags[0] = false;
                }
                if col == 0 {
                    flags[1] = false;
                }
                if row == num_rows - 1 {
                    flags[2] = false;
                }
                if col == num_cols - 1 {
                    flags[3] = false;
                }
            }

            // Multiplier: prioritise rank sets with more clues.
            let remaining = flags.iter().filter(|&&f| f).count();
            let multiplier = (4 - remaining) as f64;

            // Add a candidate finder for each remaining (uncovered) edge.
            if flags[0] {
                // Top row (row 0).
                let cells: Vec<CellIndex> =
                    (0..num_cols).map(|j| j as CellIndex).collect();
                finders.push(CandidateFinderDescription::RequiredValue {
                    cells,
                    value,
                    multiplier,
                });
            }
            if flags[1] {
                // Left column (col 0).
                let cells: Vec<CellIndex> =
                    (0..num_rows).map(|i| (i * num_cols) as CellIndex).collect();
                finders.push(CandidateFinderDescription::RequiredValue {
                    cells,
                    value,
                    multiplier,
                });
            }
            if flags[2] {
                // Bottom row (last row).
                let start = (num_rows - 1) * num_cols;
                let cells: Vec<CellIndex> =
                    (start..start + num_cols).map(|c| c as CellIndex).collect();
                finders.push(CandidateFinderDescription::RequiredValue {
                    cells,
                    value,
                    multiplier,
                });
            }
            if flags[3] {
                // Right column (last col).
                let cells: Vec<CellIndex> = (0..num_rows)
                    .map(|i| (i * num_cols + num_cols - 1) as CellIndex)
                    .collect();
                finders.push(CandidateFinderDescription::RequiredValue {
                    cells,
                    value,
                    multiplier,
                });
            }
        }

        finders
    }

    fn name(&self) -> &'static str {
        "FullRank"
    }
}
