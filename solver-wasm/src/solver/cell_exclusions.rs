use std::cell::Cell;
use std::collections::HashMap;
use crate::bit_set::BitSet;
use crate::api::types::CellIndex;

/// Tracks which cells must have mutually exclusive values (AllDifferent).
///
/// Mirrors JS `CellExclusions` from engine.js. For each cell, stores the
/// set of cells that cannot have the same value.
///
/// Uses interior mutability for lazy cache population, matching JS's
/// pattern where `getPairExclusions()` and `getArray()` internally
/// populate caches while presenting a shared reference to callers.
/// This is safe in single-threaded WASM.
pub struct CellExclusions {
    /// For each cell, the sorted list of cells that are mutually exclusive.
    /// Built during construction via `add_mutual_exclusion`.
    pub(crate) sets: Vec<Vec<CellIndex>>,

    /// Number of cells.
    num_cells: usize,

    // ---- Lazy caches (interior mutability, matching JS) ----

    /// Whether caches have been populated. Once sealed, no more exclusions
    /// can be added.
    sealed: Cell<bool>,

    /// Sorted copy of `sets`, populated on first cache access.
    /// Matches JS `_cellExclusionArrays`.
    // SAFETY: Only mutated in `seal()` which runs at most once (guarded by
    // `sealed` flag). Only read after sealing. Single-threaded WASM.
    arrays: std::cell::UnsafeCell<Vec<Vec<CellIndex>>>,

    /// Pair exclusion cache. Sparse map keyed by `cell0 * num_cells + cell1`.
    /// Matches JS `_pairExclusions` Map.
    // SAFETY: Only mutated in `get_pair_exclusions()` which is non-reentrant.
    // Single-threaded WASM.
    pair_cache: std::cell::UnsafeCell<HashMap<usize, Vec<CellIndex>>>,

    /// List exclusion cache. Keyed by cell list content.
    /// Matches JS `_listExclusions` Map (keyed by reference identity in JS;
    /// content-keyed here for correctness).
    // SAFETY: Only mutated in `get_list_exclusions()` which is non-reentrant.
    // Single-threaded WASM.
    list_cache: std::cell::UnsafeCell<HashMap<Vec<CellIndex>, Vec<CellIndex>>>,

    /// Per-cell BitSet cache. Lazily populated.
    /// Matches JS `_cellExclusionBitSets`.
    // SAFETY: Only mutated in `get_bit_set()` which is non-reentrant.
    // Single-threaded WASM.
    bitset_cache: std::cell::UnsafeCell<Vec<Option<BitSet>>>,
}

impl Default for CellExclusions {
    /// Produces an empty (zero-cell) placeholder, suitable only as a
    /// temporary stand-in during `std::mem::take`.
    fn default() -> Self {
        Self::with_num_cells(0)
    }
}

impl CellExclusions {
    /// Create empty cell exclusions for a standard 9×9 grid (test only).
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_num_cells(81)
    }

    /// Create empty cell exclusions for a grid with `num_cells` cells.
    pub fn with_num_cells(num_cells: usize) -> Self {
        let mut sets = Vec::with_capacity(num_cells);
        for _ in 0..num_cells {
            sets.push(Vec::new());
        }
        CellExclusions {
            sets,
            num_cells,
            sealed: Cell::new(false),
            arrays: std::cell::UnsafeCell::new(Vec::new()),
            pair_cache: std::cell::UnsafeCell::new(HashMap::new()),
            list_cache: std::cell::UnsafeCell::new(HashMap::new()),
            bitset_cache: std::cell::UnsafeCell::new(Vec::new()),
        }
    }

    /// Build cell exclusions from a list of exclusion groups.
    ///
    /// Each group is a set of cells that must all have different values
    /// (typically the cells of a House or AllDifferent constraint).
    ///
    /// Infers `num_cells` from the maximum cell index in the groups.
    pub fn from_exclusion_groups(groups: &[Vec<CellIndex>]) -> Self {
        let num_cells = groups
            .iter()
            .flat_map(|g| g.iter())
            .map(|&c| c as usize + 1)
            .max()
            .unwrap_or(0);
        let mut ce = Self::with_num_cells(num_cells);
        for group in groups {
            for i in 0..group.len() {
                for j in (i + 1)..group.len() {
                    ce.add_mutual_exclusion(group[i], group[j]);
                }
            }
        }
        ce
    }

    /// Clone the cell exclusions (unsealed state).
    /// Used by the taxicab optimizer to create per-value copies.
    pub fn clone_unsealed(&self) -> Self {
        CellExclusions {
            sets: self.sets.clone(),
            num_cells: self.num_cells,
            sealed: Cell::new(false),
            arrays: std::cell::UnsafeCell::new(Vec::new()),
            pair_cache: std::cell::UnsafeCell::new(HashMap::new()),
            list_cache: std::cell::UnsafeCell::new(HashMap::new()),
            bitset_cache: std::cell::UnsafeCell::new(Vec::new()),
        }
    }

    /// Add a mutual exclusion between two cells.
    pub fn add_mutual_exclusion(&mut self, cell0: CellIndex, cell1: CellIndex) {
        debug_assert!(!self.sealed.get());
        if cell0 == cell1 {
            return;
        }
        // Use sorted insertion to keep uniqueness
        insert_unique(&mut self.sets[cell0 as usize], cell1);
        insert_unique(&mut self.sets[cell1 as usize], cell0);
    }

    /// Mark two cells as sharing exclusions (same-value relationship).
    /// Used by the optimizer for complement cell merging.
    pub fn share_exclusions(&mut self, cell0: CellIndex, cell1: CellIndex) {
        if cell0 == cell1 {
            return;
        }
        debug_assert!(!self.sealed.get());
        // Copy cell0's exclusions to cell1 and vice versa.
        let excl0 = self.sets[cell0 as usize].clone();
        let excl1 = self.sets[cell1 as usize].clone();
        for &c in &excl0 {
            insert_unique(&mut self.sets[cell1 as usize], c);
        }
        for &c in &excl1 {
            insert_unique(&mut self.sets[cell0 as usize], c);
        }
    }

    /// Check if two cells are mutually exclusive.
    #[inline]
    pub fn is_mutually_exclusive(&self, cell0: CellIndex, cell1: CellIndex) -> bool {
        // Use binary_search since sets are maintained in sorted order.
        self.sets[cell0 as usize].binary_search(&cell1).is_ok()
    }

    /// Check if all cells in a group are mutually exclusive with each other.
    pub fn are_mutually_exclusive(&self, cells: &[CellIndex]) -> bool {
        for i in 0..cells.len() {
            for j in (i + 1)..cells.len() {
                if !self.is_mutually_exclusive(cells[i], cells[j]) {
                    return false;
                }
            }
        }
        true
    }

    /// Seal the exclusion data and populate lazy caches.
    /// After sealing, no more exclusions can be added.
    ///
    /// Uses interior mutability so it can be called via `&self`,
    /// matching JS's pattern where `getArray()` lazily seals.
    pub(crate) fn seal(&self) {
        if self.sealed.get() {
            return;
        }
        self.sealed.set(true);
        // SAFETY: Single-threaded WASM. seal() runs only once (guarded by Cell).
        unsafe {
            let arrays = &mut *self.arrays.get();
            // sets are already sorted (maintained by insert_unique), just clone.
            *arrays = self.sets.clone();
        }
    }

    /// Get the exclusion array for a cell.
    /// Seals on first call, matching JS `getArray(cell)`.
    #[inline]
    pub fn get_array(&self, cell: CellIndex) -> &[CellIndex] {
        self.seal();
        // SAFETY: arrays is immutable after seal(). Single-threaded WASM.
        unsafe { &(*self.arrays.get())[cell as usize] }
    }

    /// Get exclusions common to a pair of cells.
    /// Key: `(cell0 << 8) | cell1`. Lazily caches the result.
    /// Matches JS `getPairExclusions(pairIndex)`.
    pub fn get_pair_exclusions(&self, pair_index: u16) -> &[CellIndex] {
        self.seal();
        let cell0 = (pair_index >> 8) as usize;
        let cell1 = (pair_index & 0xFF) as usize;
        let cache_key = cell0 * self.num_cells + cell1;

        // SAFETY: Single-threaded WASM. This method is non-reentrant.
        // Vec<u8> heap data is pointer-stable even if the HashMap rehashes,
        // because moving a Vec only relocates the struct (ptr/len/cap),
        // not the heap allocation it points to.
        unsafe {
            let cache = &mut *self.pair_cache.get();
            if let Some(data) = cache.get(&cache_key) {
                return std::slice::from_raw_parts(data.as_ptr(), data.len());
            }
            // Check reverse key — return its data directly to avoid cloning.
            let rev_key = cell1 * self.num_cells + cell0;
            if let Some(data) = cache.get(&rev_key) {
                return std::slice::from_raw_parts(data.as_ptr(), data.len());
            }
            // Compute and store.
            let intersection = sorted_intersect(
                &(*self.arrays.get())[cell0],
                &(*self.arrays.get())[cell1],
            );
            let entry = cache.entry(cache_key).or_insert(intersection);
            std::slice::from_raw_parts(entry.as_ptr(), entry.len())
        }
    }

    /// Get exclusions common to all cells in a list.
    /// Caches results matching JS `getListExclusions()` / `_listExclusions` Map.
    pub fn get_list_exclusions(&self, cells: &[CellIndex]) -> &[CellIndex] {
        self.seal();
        // SAFETY: Single-threaded WASM. This method is non-reentrant.
        // The list_cache lives as long as `self`. We only insert entries
        // (never remove), so returned references remain valid.
        unsafe {
            let cache = &mut *self.list_cache.get();
            if let Some(existing) = cache.get(cells) {
                return std::slice::from_raw_parts(existing.as_ptr(), existing.len());
            }
            let result = self.compute_list_exclusions(cells);
            let entry = cache.entry(cells.to_vec()).or_insert(result);
            std::slice::from_raw_parts(entry.as_ptr(), entry.len())
        }
    }

    /// Compute the sorted intersection of exclusion sets for all cells in a list.
    fn compute_list_exclusions(&self, cells: &[CellIndex]) -> Vec<CellIndex> {
        if cells.is_empty() {
            return Vec::new();
        }
        let mut result = self.sets[cells[0] as usize].clone();
        for &cell in &cells[1..] {
            let other = &self.sets[cell as usize];
            result = sorted_intersect(&result, other);
            if result.is_empty() {
                break;
            }
        }
        result
    }

    /// Get the number of exclusions for a cell.
    pub fn exclusion_count(&self, cell: CellIndex) -> usize {
        self.sets[cell as usize].len()
    }

    /// Get a BitSet of exclusions for a cell.
    /// Lazily cached, matching JS `getBitSet(cell)`.
    pub fn get_bit_set(&self, cell: CellIndex) -> &BitSet {
        self.seal();
        // SAFETY: Single-threaded WASM. Non-reentrant. Cache lives as long
        // as `self`. We only populate entries (never remove).
        unsafe {
            let cache = &mut *self.bitset_cache.get();
            if cache.is_empty() {
                cache.resize_with(self.num_cells, || None);
            }
            let idx = cell as usize;
            if cache[idx].is_none() {
                // Matches JS: new BitSet(this._cellExclusionSets.length)
                let mut bs = BitSet::with_capacity(self.num_cells);
                for &c in &self.sets[idx] {
                    bs.add(c as usize);
                }
                cache[idx] = Some(bs);
            }
            cache[idx].as_ref().unwrap()
        }
    }
}

/// Insert a value into a sorted vec, maintaining sorted order and uniqueness.
fn insert_unique(vec: &mut Vec<CellIndex>, val: CellIndex) {
    match vec.binary_search(&val) {
        Ok(_) => {} // already present
        Err(pos) => vec.insert(pos, val),
    }
}

/// Compute the sorted intersection of two sorted slices.
fn sorted_intersect(a: &[CellIndex], b: &[CellIndex]) -> Vec<CellIndex> {
    let mut result = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                result.push(a[i]);
                i += 1;
                j += 1;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid_shape::GridShape;

    #[test]
    fn test_mutual_exclusion() {
        let mut ce = CellExclusions::new();
        ce.add_mutual_exclusion(0, 1);
        ce.add_mutual_exclusion(0, 2);
        assert!(ce.is_mutually_exclusive(0, 1));
        assert!(ce.is_mutually_exclusive(1, 0));
        assert!(ce.is_mutually_exclusive(0, 2));
        assert!(!ce.is_mutually_exclusive(1, 2));
    }

    #[test]
    fn test_from_exclusion_groups() {
        // A single row: cells 0..9
        let group: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[group]);
        let excl = ce.get_array(0);
        assert_eq!(excl.len(), 8); // excluded from 8 other cells
        assert!(!excl.contains(&0));
        assert!(excl.contains(&1));
        assert!(excl.contains(&8));
    }

    #[test]
    fn test_pair_exclusions() {
        // Cells 0 and 1 are in the same row; cells 0 and 9 are in the same column.
        // Their intersection should be cell 0's row-mates ∩ cell 9's column-mates.
        let shape = GridShape::default_9x9();
        let row0: Vec<u8> = shape.row_cells(0).iter().map(|&c| c as u8).collect();
        let col0: Vec<u8> = shape.col_cells(0).iter().map(|&c| c as u8).collect();
        let row1: Vec<u8> = shape.row_cells(1).iter().map(|&c| c as u8).collect();
        let col1: Vec<u8> = shape.col_cells(1).iter().map(|&c| c as u8).collect();

        let ce = CellExclusions::from_exclusion_groups(&[row0, col0, row1, col1]);

        // Cell 0 and cell 1 are both in row 0 → their pair exclusions are the
        // intersection of their individual exclusion sets.
        let pair = ce.get_pair_exclusions((0 << 8) | 1);
        // They share the rest of row 0 as common exclusions.
        for &c in &[2u8, 3, 4, 5, 6, 7, 8] {
            assert!(pair.contains(&c), "pair should contain cell {}", c);
        }
    }

    #[test]
    fn test_are_mutually_exclusive() {
        let group: Vec<u8> = (0..9).collect();
        let ce = CellExclusions::from_exclusion_groups(&[group]);
        assert!(ce.are_mutually_exclusive(&[0, 1, 2]));
        assert!(!ce.are_mutually_exclusive(&[0, 1, 9])); // 9 not in group
    }

    #[test]
    fn test_no_self_exclusion() {
        let mut ce = CellExclusions::new();
        ce.add_mutual_exclusion(5, 5); // should be a no-op
        assert!(!ce.is_mutually_exclusive(5, 5));
    }
}
