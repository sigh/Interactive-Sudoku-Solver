use crate::util::NUM_CELLS;

/// Tracks which cells must have mutually exclusive values (AllDifferent).
///
/// Mirrors JS `CellExclusions` from engine.js. For each cell, stores the
/// set of cells that cannot have the same value.
///
/// Caches pair and list intersection results for fast lookup during
/// constraint enforcement.
pub struct CellExclusions {
    /// For each cell, the sorted list of cells that are mutually exclusive.
    arrays: Vec<Vec<u8>>,

    /// Cache for pair exclusions: intersection of two cells' exclusion lists.
    /// Key: `(cell0 << 8) | cell1`
    pair_cache: Vec<Option<Vec<u8>>>,

    /// Whether we've finalized the exclusion sets.
    sealed: bool,

    /// The underlying sets (used only during construction).
    pub(crate) sets: Vec<Vec<u8>>,
}

impl CellExclusions {
    /// Create empty cell exclusions (no relationships).
    pub fn new() -> Self {
        let mut sets = Vec::with_capacity(NUM_CELLS);
        for _ in 0..NUM_CELLS {
            sets.push(Vec::new());
        }
        CellExclusions {
            arrays: Vec::new(),
            pair_cache: Vec::new(),
            sealed: false,
            sets,
        }
    }

    /// Build cell exclusions from a list of exclusion groups.
    ///
    /// Each group is a set of cells that must all have different values
    /// (typically the cells of a House or AllDifferent constraint).
    pub fn from_exclusion_groups(groups: &[Vec<u8>]) -> Self {
        let mut ce = Self::new();
        for group in groups {
            for i in 0..group.len() {
                for j in (i + 1)..group.len() {
                    ce.add_mutual_exclusion(group[i], group[j]);
                }
            }
        }
        ce
    }

    /// Add a mutual exclusion between two cells.
    pub fn add_mutual_exclusion(&mut self, cell0: u8, cell1: u8) {
        debug_assert!(!self.sealed);
        if cell0 == cell1 {
            return;
        }
        // Use sorted insertion to keep uniqueness
        insert_unique(&mut self.sets[cell0 as usize], cell1);
        insert_unique(&mut self.sets[cell1 as usize], cell0);
    }

    /// Mark two cells as having the same value (share exclusions).
    /// Used by the optimizer for complement cell merging.
    pub fn are_same_value(&mut self, cell0: u8, cell1: u8) {
        if cell0 == cell1 {
            return;
        }
        debug_assert!(!self.sealed);
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
    pub fn is_mutually_exclusive(&self, cell0: u8, cell1: u8) -> bool {
        // Use the underlying sets (works before and after sealing).
        self.sets[cell0 as usize].contains(&cell1)
    }

    /// Check if all cells in a group are mutually exclusive with each other.
    pub fn are_mutually_exclusive(&self, cells: &[u8]) -> bool {
        for i in 0..cells.len() {
            for j in (i + 1)..cells.len() {
                if !self.is_mutually_exclusive(cells[i], cells[j]) {
                    return false;
                }
            }
        }
        true
    }

    /// Seal the exclusion data and return the sorted arrays for iteration.
    /// After sealing, no more exclusions can be added.
    fn seal(&mut self) {
        if self.sealed {
            return;
        }
        self.sealed = true;
        self.arrays = self
            .sets
            .iter()
            .map(|s| {
                let mut v = s.clone();
                v.sort();
                v
            })
            .collect();
        // Initialize pair cache (lazily populated).
        self.pair_cache = vec![None; NUM_CELLS * NUM_CELLS];
    }

    /// Get the exclusion array for a cell (seals on first call).
    pub fn get_array(&mut self, cell: u8) -> &[u8] {
        self.seal();
        &self.arrays[cell as usize]
    }

    /// Get exclusions common to a pair of cells.
    /// Key: `(cell0 << 8) | cell1`. Caches the result.
    pub fn get_pair_exclusions(&mut self, pair_index: u16) -> &[u8] {
        self.seal();
        let cell0 = (pair_index >> 8) as usize;
        let cell1 = (pair_index & 0xFF) as usize;
        let cache_key = cell0 * NUM_CELLS + cell1;

        if self.pair_cache[cache_key].is_none() {
            // Check reverse key.
            let rev_key = cell1 * NUM_CELLS + cell0;
            if self.pair_cache[rev_key].is_some() {
                let cloned = self.pair_cache[rev_key].clone();
                self.pair_cache[cache_key] = cloned;
            } else {
                // Compute intersection.
                let intersection = sorted_intersect(&self.arrays[cell0], &self.arrays[cell1]);
                self.pair_cache[cache_key] = Some(intersection);
            }
        }

        self.pair_cache[cache_key].as_ref().unwrap()
    }

    /// Get exclusions common to all cells in a list.
    pub fn get_list_exclusions(&self, cells: &[u8]) -> Vec<u8> {
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
    pub fn exclusion_count(&self, cell: u8) -> usize {
        self.sets[cell as usize].len()
    }
}

/// Insert a value into a sorted vec, maintaining sorted order and uniqueness.
fn insert_unique(vec: &mut Vec<u8>, val: u8) {
    match vec.binary_search(&val) {
        Ok(_) => {} // already present
        Err(pos) => vec.insert(pos, val),
    }
}

/// Compute the sorted intersection of two sorted slices.
fn sorted_intersect(a: &[u8], b: &[u8]) -> Vec<u8> {
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
    use crate::grid::Grid;

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
        let mut ce = CellExclusions::from_exclusion_groups(&[group]);
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
        let row0: Vec<u8> = Grid::row_cells(0).iter().map(|&c| c as u8).collect();
        let col0: Vec<u8> = Grid::col_cells(0).iter().map(|&c| c as u8).collect();
        let row1: Vec<u8> = Grid::row_cells(1).iter().map(|&c| c as u8).collect();
        let col1: Vec<u8> = Grid::col_cells(1).iter().map(|&c| c as u8).collect();

        let mut ce = CellExclusions::from_exclusion_groups(&[row0, col0, row1, col1]);

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
