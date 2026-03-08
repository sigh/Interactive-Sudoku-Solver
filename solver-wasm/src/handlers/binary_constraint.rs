//! BinaryConstraint — pairwise binary relation between two cells.
//!
//! Lookup tables are cached per (key, num_values) pair.
//! Mirrors JS `BinaryConstraint`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::{CellIndex, Value};

use super::ConstraintHandler;

// ============================================================================
// Base64 binary key encoding (matches JS fnToBinaryKey / Base64Codec)
// ============================================================================

/// URL-safe Base64 character set (RFC 4648 §5), matching JS `Base64Codec.BASE64_CHARS`.
const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Encode a predicate function into a Base64 binary key string.
///
/// Matches JS `fnToBinaryKey(fn, numValues)`. The truth table for
/// `pred(a, b)` where `a, b ∈ 1..=num_values` is packed into 6-bit
/// groups and encoded as URL-safe Base64 characters.
pub fn fn_to_binary_key(pred: &dyn Fn(Value, Value) -> bool, num_values: u8) -> String {
    const NUM_BITS: usize = 6;
    let nv = num_values as usize;
    let mut array: Vec<u8> = Vec::new();
    let mut v: u8 = 0;
    let mut v_index: usize = 0;

    for i in 1..=nv {
        for j in 1..=nv {
            if pred(i as Value, j as Value) {
                v |= 1 << v_index;
            }
            v_index += 1;
            if v_index == NUM_BITS {
                array.push(v);
                v_index = 0;
                v = 0;
            }
        }
    }
    array.push(v);

    // Trim trailing zeros.
    while array.last() == Some(&0) {
        array.pop();
    }

    array
        .iter()
        .map(|&b| BASE64_CHARS[b as usize] as char)
        .collect()
}

/// Decode a Base64 binary key string into a 6-bit array.
fn decode_binary_key(key: &str) -> Vec<u8> {
    static REVERSE: OnceLock<[u8; 128]> = OnceLock::new();
    let reverse = REVERSE.get_or_init(|| {
        let mut table = [0u8; 128];
        for (i, &ch) in BASE64_CHARS.iter().enumerate() {
            table[ch as usize] = i as u8;
        }
        table
    });

    key.bytes().map(|b| reverse[b.min(127) as usize]).collect()
}

// ============================================================================
// Table cache — shared tables for the same key
// ============================================================================

/// A pair of lookup tables for a binary constraint:
/// - `[0][mask_of_cell0]` → allowed values for cell1
/// - `[1][mask_of_cell1]` → allowed values for cell0
pub type BinaryTablePair = [Vec<CandidateSet>; 2];

fn table_cache() -> &'static Mutex<HashMap<(String, u8), Arc<BinaryTablePair>>> {
    static CACHE: OnceLock<Mutex<HashMap<(String, u8), Arc<BinaryTablePair>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Get or build binary constraint tables for a given key and num_values.
///
/// Tables are cached so multiple constraints with the same key
/// share a single allocation (matching JS `LookupTables.forBinaryKey`).
pub fn get_binary_tables(key: &str, num_values: u8) -> Arc<BinaryTablePair> {
    let cache_key = (key.to_string(), num_values);
    let mut cache = table_cache().lock().unwrap();
    if let Some(tables) = cache.get(&cache_key) {
        return tables.clone();
    }

    let tables = build_tables_from_key(key, num_values);
    let arc = Arc::new(tables);
    cache.insert(cache_key, arc.clone());
    arc
}

/// Build binary constraint tables from a Base64-encoded key.
///
/// Matches JS `LookupTables.forBinaryKey(key)`.
fn build_tables_from_key(key: &str, num_values: u8) -> BinaryTablePair {
    let nv = num_values as usize;
    let combinations = 1usize << nv;
    let mut table0 = vec![CandidateSet::EMPTY; combinations];
    let mut table1 = vec![CandidateSet::EMPTY; combinations];

    let key_arr = decode_binary_key(key);
    let mut key_index: usize = 0;
    let mut v_index: usize = 0;
    let mut current = key_arr.first().copied().unwrap_or(0);

    for i in 0..nv {
        for j in 0..nv {
            if current & 1 != 0 {
                table0[1 << i] |= CandidateSet::from_index(j);
                table1[1 << j] |= CandidateSet::from_index(i);
            }
            current >>= 1;
            v_index += 1;
            if v_index == 6 {
                v_index = 0;
                key_index += 1;
                current = key_arr.get(key_index).copied().unwrap_or(0);
            }
        }
    }

    // Fill in multi-value masks by ORing together single-value entries.
    for mask in 1..combinations {
        table0[mask] = table0[mask & (mask - 1)] | table0[mask & mask.wrapping_neg()];
        table1[mask] = table1[mask & (mask - 1)] | table1[mask & mask.wrapping_neg()];
    }

    [table0, table1]
}

/// Check if binary constraint tables represent a transitive relation.
///
/// A transitive relation means: if `(X, V)` is valid and `(V, Y)` is valid,
/// then `(X, Y)` must also be valid.
///
/// Matches JS `LookupTables.binaryKeyIsTransitive(key)`.
fn binary_key_is_transitive(tables: &BinaryTablePair, num_values: u8) -> bool {
    let nv = num_values as usize;
    for i in 0..nv {
        let v = CandidateSet::from_index(i);
        let mut valid_pred = tables[1][usize::from(v)];
        let valid_succ = tables[0][usize::from(v)];

        while !valid_pred.is_empty() {
            let x = valid_pred.lowest();
            valid_pred ^= x;
            if (valid_succ & !tables[0][usize::from(x)]) != CandidateSet::EMPTY {
                return false;
            }
        }
    }
    true
}

// ============================================================================
// BinaryConstraint — 2-cell relation via lookup tables
// ============================================================================

/// Enforces a binary relation between two cells using lookup tables.
///
/// For each possible candidate set of one cell, the table gives the
/// set of allowed values for the other cell. This handles any 2-cell
/// constraint: sum, difference, ordering, etc.
///
/// Tables are shared (via `Arc`) between constraints with the same key,
/// matching JS `LookupTables.forBinaryKey` memoization.
///
/// Mirrors JS `BinaryConstraint`.
pub struct BinaryConstraint {
    cells: [CellIndex; 2],
    /// Shared tables: tables[0][mask0] → allowed1, tables[1][mask1] → allowed0.
    tables: Arc<BinaryTablePair>,
    /// Base64 key string for deduplication and table caching.
    key: String,
    /// The num_values these tables were built with.
    num_values: u8,
    /// Pair exclusion cells for required-value reasoning.
    /// Empty if the relation is transitive (e.g. `a < b` for Thermo).
    pair_exclusion_cells: Vec<CellIndex>,
}

impl BinaryConstraint {
    /// Create a BinaryConstraint from a predicate.
    ///
    /// The predicate is encoded as a Base64 key and tables are cached,
    /// so multiple constraints with the same predicate share tables.
    pub fn from_predicate(
        cell0: CellIndex,
        cell1: CellIndex,
        pred: impl Fn(u8, u8) -> bool,
        num_values: u8,
    ) -> Self {
        let key = fn_to_binary_key(&pred, num_values);
        Self::from_key(cell0, cell1, key, num_values)
    }

    /// Create a BinaryConstraint from a precomputed Base64 key.
    ///
    /// This is the primary constructor for `Pair` constraints where the
    /// key comes from the frontend constraint string.
    pub fn from_key(cell0: CellIndex, cell1: CellIndex, key: String, num_values: u8) -> Self {
        let tables = get_binary_tables(&key, num_values);
        BinaryConstraint {
            cells: [cell0, cell1],
            tables,
            key,
            num_values,
            pair_exclusion_cells: Vec::new(),
        }
    }

    /// Get the binary key string.
    pub fn key(&self) -> &str {
        &self.key
    }
}

impl ConstraintHandler for BinaryConstraint {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        // Only set up pair exclusion cells if the key is NOT transitive.
        // Transitive relations (e.g. Thermo's `a < b`) can never have
        // required value exclusions between the two cells.
        // Matches JS: `if (!isTransitive) { ... }`
        if !binary_key_is_transitive(&self.tables, self.num_values) {
            let pair_index = (self.cells[0] as u16) << 8 | self.cells[1] as u16;
            let excl = cell_exclusions.get_pair_exclusions(pair_index);
            if !excl.is_empty() {
                self.pair_exclusion_cells = excl.to_vec();
            }
        }

        // Check that the initial all-values mask is compatible.
        let all = CandidateSet::all(self.num_values);
        !self.tables[0][usize::from(all)].is_empty()
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let v0 = grid[self.cells[0] as usize];
        let v1 = grid[self.cells[1] as usize];

        let v0_new = v0 & self.tables[1][usize::from(v1)];
        let v1_new = v1 & self.tables[0][usize::from(v0)];

        if v0_new.is_empty() || v1_new.is_empty() {
            return false;
        }

        grid[self.cells[0] as usize] = v0_new;
        grid[self.cells[1] as usize] = v1_new;

        if v0 != v0_new {
            acc.add_for_cell(self.cells[0]);
        }
        if v1 != v1_new {
            acc.add_for_cell(self.cells[1]);
        }

        // Required-value exclusion: only relevant for non-transitive keys
        // and when both cells are unfixed.
        if self.pair_exclusion_cells.is_empty() {
            return true;
        }
        if v0_new.is_single() || v1_new.is_single() {
            return true;
        }

        // Check values that appear in both cells.
        let mut common_values = v0_new & v1_new;
        let mut required_values = CandidateSet::EMPTY;
        while !common_values.is_empty() {
            let value = common_values.lowest();
            common_values ^= value;

            // Check if removing this value from cell0 forces cell1 to have
            // exactly this value.
            if self.tables[0][usize::from(v0_new ^ value)] & v1_new == value {
                required_values |= value;
            }
        }

        // Remove required value exclusions.
        while !required_values.is_empty() {
            let value = required_values.lowest();
            required_values ^= value;

            for &excl_cell in &self.pair_exclusion_cells {
                if grid[excl_cell as usize].intersects(value) {
                    grid[excl_cell as usize] ^= value;
                    if grid[excl_cell as usize].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(excl_cell);
                }
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "BinaryConstraint"
    }

    fn id_str(&self) -> String {
        format!(
            "BinaryConstraint-{}-{}-{}",
            self.key, self.cells[0], self.cells[1]
        )
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fn_to_binary_key_less_than() {
        let key = fn_to_binary_key(&|a: u8, b: u8| a < b, 9);
        // Verify round-trip: build tables from key, check a few entries.
        let tables = build_tables_from_key(&key, 9);
        // For cell0 = {1} (bit 0), allowed cell1 values should be {2..9}.
        let allowed = tables[0][usize::from(CandidateSet::from_value(1))];
        for v in 2..=9u8 {
            assert!(
                allowed.intersects(CandidateSet::from_value(v)),
                "1 < {} should be allowed",
                v
            );
        }
        assert!(
            !allowed.intersects(CandidateSet::from_value(1)),
            "1 < 1 should not be allowed"
        );
    }

    #[test]
    fn test_fn_to_binary_key_equals() {
        let key = fn_to_binary_key(&|a: u8, b: u8| a == b, 9);
        let tables = build_tables_from_key(&key, 9);
        // For cell0 = {5}, allowed cell1 should be {5}.
        let allowed = tables[0][usize::from(CandidateSet::from_value(5))];
        assert_eq!(allowed, CandidateSet::from_value(5));
    }

    #[test]
    fn test_table_caching() {
        let key1 = fn_to_binary_key(&|a: u8, b: u8| a < b, 9);
        let key2 = fn_to_binary_key(&|a: u8, b: u8| a < b, 9);
        assert_eq!(key1, key2, "Same predicate should produce same key");

        let tables1 = get_binary_tables(&key1, 9);
        let tables2 = get_binary_tables(&key2, 9);
        assert!(
            Arc::ptr_eq(&tables1, &tables2),
            "Same key should share tables"
        );
    }

    #[test]
    fn test_different_predicates_different_keys() {
        let key_lt = fn_to_binary_key(&|a: u8, b: u8| a < b, 9);
        let key_gt = fn_to_binary_key(&|a: u8, b: u8| a > b, 9);
        assert_ne!(key_lt, key_gt);
    }

    #[test]
    fn test_transitive_less_than() {
        let key = fn_to_binary_key(&|a: u8, b: u8| a < b, 9);
        let tables = get_binary_tables(&key, 9);
        assert!(binary_key_is_transitive(&tables, 9), "a < b is transitive");
    }

    #[test]
    fn test_non_transitive_abs_diff_1() {
        let key = fn_to_binary_key(&|a: u8, b: u8| (a as i32 - b as i32).abs() == 1, 9);
        let tables = get_binary_tables(&key, 9);
        assert!(
            !binary_key_is_transitive(&tables, 9),
            "|a - b| == 1 is not transitive"
        );
    }

    #[test]
    fn test_from_predicate_shares_tables() {
        let bc1 = BinaryConstraint::from_predicate(0, 1, |a, b| a < b, 9);
        let bc2 = BinaryConstraint::from_predicate(2, 3, |a, b| a < b, 9);
        assert!(
            Arc::ptr_eq(&bc1.tables, &bc2.tables),
            "Same predicate should share tables"
        );
    }

    #[test]
    fn test_from_key_builds_correctly() {
        let key = fn_to_binary_key(&|a: u8, b: u8| a + b == 10, 9);
        let bc = BinaryConstraint::from_key(0, 1, key, 9);
        // cell0 = {1}: allowed cell1 should be {9}
        let allowed = bc.tables[0][usize::from(CandidateSet::from_value(1))];
        assert_eq!(allowed, CandidateSet::from_value(9));
        // cell0 = {5}: allowed cell1 should be {5}
        let allowed = bc.tables[0][usize::from(CandidateSet::from_value(5))];
        assert_eq!(allowed, CandidateSet::from_value(5));
    }

    fn vm(values: &[u8]) -> CandidateSet {
        let mut raw: u16 = 0;
        for &v in values {
            raw |= 1 << (v - 1);
        }
        CandidateSet::from_raw(raw)
    }

    fn make_handler(pred: impl Fn(u8, u8) -> bool, nv: u8, cell0: CellIndex, cell1: CellIndex) -> BinaryConstraint {
        BinaryConstraint::from_predicate(cell0, cell1, pred, nv)
    }

    fn init_handler(handler: &mut BinaryConstraint, grid: &mut [CandidateSet], ce: &CellExclusions) -> bool {
        let shape = GridShape::square(1).unwrap(); // shape doesn't matter for binary
        let mut alloc = GridStateAllocator::new(grid.len());
        handler.initialize(grid, ce, shape, &mut alloc)
    }

    // =========================================================================
    // Initialization tests
    // =========================================================================

    #[test]
    fn binary_init_valid_key() {
        let nv = 4;
        let all = CandidateSet::all(nv);
        let mut grid = vec![all; 4];
        let mut handler = make_handler(|a, b| a != b, nv, 0, 1);
        let ce = CellExclusions::with_num_cells(4);
        assert_eq!(init_handler(&mut handler, &mut grid, &ce), true);
    }

    #[test]
    fn binary_init_fail_no_legal_values() {
        let nv = 4;
        let all = CandidateSet::all(nv);
        let mut grid = vec![all; 4];
        let mut handler = make_handler(|_a, _b| false, nv, 0, 1);
        let ce = CellExclusions::with_num_cells(4);
        assert_eq!(init_handler(&mut handler, &mut grid, &ce), false);
    }

    #[test]
    fn binary_store_key() {
        let key = fn_to_binary_key(&|a: u8, b: u8| a < b, 4);
        let handler = BinaryConstraint::from_key(0, 1, key.clone(), 4);
        assert_eq!(handler.key(), key);
    }

    #[test]
    fn binary_unique_id_str() {
        let key = fn_to_binary_key(&|a: u8, b: u8| a < b, 4);
        let h1 = BinaryConstraint::from_key(0, 1, key.clone(), 4);
        let h2 = BinaryConstraint::from_key(0, 2, key.clone(), 4);
        let h3 = BinaryConstraint::from_key(0, 1, key.clone(), 4);
        assert_ne!(h1.id_str(), h2.id_str());
        assert_eq!(h1.id_str(), h3.id_str());
    }

    // =========================================================================
    // Not-equal constraint (a != b)
    // =========================================================================

    #[test]
    fn not_equal_no_prune_when_unfixed() {
        let mut handler = make_handler(|a, b| a != b, 4, 0, 1);
        let mut grid = vec![vm(&[1, 2]), vm(&[1, 2, 3])];
        let ce = CellExclusions::with_num_cells(2);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[1, 2, 3]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[1, 2]));
        assert_eq!(grid[1], vm(&[1, 2, 3]));
    }

    #[test]
    fn not_equal_prune_when_one_fixed() {
        let mut handler = make_handler(|a, b| a != b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[1, 2, 3]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[2]));
        assert_eq!(grid[1], vm(&[1, 3]));
    }

    #[test]
    fn not_equal_fail_same_value() {
        let mut handler = make_handler(|a, b| a != b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[2]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), false);
    }

    // =========================================================================
    // Less-than constraint (a < b)
    // =========================================================================

    #[test]
    fn less_than_prune_high_from_first() {
        let mut handler = make_handler(|a, b| a < b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[3]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[1, 2]));
        assert_eq!(grid[1], vm(&[3]));
    }

    #[test]
    fn less_than_prune_low_from_second() {
        let mut handler = make_handler(|a, b| a < b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[1, 2, 3, 4]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[2]));
        assert_eq!(grid[1], vm(&[3, 4]));
    }

    #[test]
    fn less_than_prune_both() {
        let mut handler = make_handler(|a, b| a < b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[2, 3, 4]);
        grid[1] = vm(&[1, 2, 3]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[2]));
        assert_eq!(grid[1], vm(&[3]));
    }

    #[test]
    fn less_than_fail_no_valid_pair() {
        let mut handler = make_handler(|a, b| a < b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[3, 4]);
        grid[1] = vm(&[1, 2]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), false);
    }

    // =========================================================================
    // Equals constraint (a == b)
    // =========================================================================

    #[test]
    fn equals_intersect_candidates() {
        let mut handler = make_handler(|a, b| a == b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1, 2, 3]);
        grid[1] = vm(&[2, 3, 4]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[2, 3]));
        assert_eq!(grid[1], vm(&[2, 3]));
    }

    #[test]
    fn equals_fail_no_common() {
        let mut handler = make_handler(|a, b| a == b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[3, 4]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), false);
    }

    // =========================================================================
    // Difference >= 2
    // =========================================================================

    #[test]
    fn diff_ge_2_prune_adjacent() {
        let mut handler = make_handler(|a, b| (a as i32 - b as i32).unsigned_abs() >= 2, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[1, 2, 3, 4]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[1], vm(&[4]));
    }

    #[test]
    fn diff_ge_2_fail_too_close() {
        let mut handler = make_handler(|a, b| (a as i32 - b as i32).unsigned_abs() >= 2, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[2]);
        grid[1] = vm(&[1, 2, 3]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), false);
    }

    // =========================================================================
    // Touched/unchanged
    // =========================================================================

    #[test]
    fn no_touch_when_unchanged() {
        let mut handler = make_handler(|a, b| a < b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        // Neither cell was changed.
        assert_eq!(grid[0], vm(&[1]));
        assert_eq!(grid[1], vm(&[2]));
    }

    #[test]
    fn report_only_changed_cells() {
        let mut handler = make_handler(|a, b| a < b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[1, 2, 3, 4]);
        let mut a = HandlerAccumulator::new_stub();
        handler.enforce_consistency(&mut grid, &mut a);
        // Only cell 1 was pruned.
        assert_eq!(grid[1], vm(&[2, 3, 4]));
    }

    // =========================================================================
    // Reusability
    // =========================================================================

    #[test]
    fn binary_reusable_across_calls() {
        let mut handler = make_handler(|a, b| a != b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        // First call.
        grid[0] = vm(&[1]);
        grid[1] = vm(&[1, 2, 3]);
        assert_eq!(handler.enforce_consistency(&mut grid, &mut HandlerAccumulator::new_stub()), true);
        assert_eq!(grid[1], vm(&[2, 3]));

        // Second call with different values.
        grid[0] = vm(&[3]);
        grid[1] = vm(&[2, 3, 4]);
        assert_eq!(handler.enforce_consistency(&mut grid, &mut HandlerAccumulator::new_stub()), true);
        assert_eq!(grid[1], vm(&[2, 4]));

        // Third call that fails.
        grid[0] = vm(&[2]);
        grid[1] = vm(&[2]);
        assert_eq!(handler.enforce_consistency(&mut grid, &mut HandlerAccumulator::new_stub()), false);
    }

    // =========================================================================
    // Non-contiguous cells
    // =========================================================================

    #[test]
    fn binary_non_contiguous_cells() {
        let mut handler = make_handler(|a, b| a < b, 5, 5, 15);
        let all = CandidateSet::all(5);
        let mut grid = vec![all; 20];
        let ce = CellExclusions::with_num_cells(20);
        init_handler(&mut handler, &mut grid, &ce);

        grid[5] = vm(&[1, 2, 3, 4, 5]);
        grid[15] = vm(&[2]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[5], vm(&[1]));
    }

    // =========================================================================
    // Asymmetric constraints
    // =========================================================================

    #[test]
    fn asymmetric_double() {
        let mut handler = make_handler(|a, b| a * 2 == b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[1, 2, 3, 4]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[1, 2]));
        assert_eq!(grid[1], vm(&[2, 4]));
    }

    #[test]
    fn asymmetric_fixed_value() {
        let mut handler = make_handler(|a, b| a * 2 == b, 4, 0, 1);
        let all = CandidateSet::all(4);
        let mut grid = vec![all; 4];
        let ce = CellExclusions::with_num_cells(4);
        init_handler(&mut handler, &mut grid, &ce);

        grid[0] = vm(&[1, 2, 3, 4]);
        grid[1] = vm(&[4]);
        let mut a = HandlerAccumulator::new_stub();
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[2]));
    }

    // =========================================================================
    // Required-value exclusions
    // =========================================================================

    #[test]
    fn required_values_pair_exclusion() {
        // Cells 0, 1, 2 all in one house. Pair exclusion for (0,1) = [2].
        let ce = CellExclusions::from_exclusion_groups(&[vec![0, 1, 2]]);

        let nv = 3u8;
        let mut handler = make_handler(|a, b| a != b, nv, 0, 1);
        let all = CandidateSet::all(nv);
        let mut grid = vec![all; 3];
        let shape = GridShape::square(1).unwrap();
        let mut alloc = GridStateAllocator::new(3);
        handler.initialize(&mut grid, &ce, shape, &mut alloc);

        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[1, 2]);
        grid[2] = vm(&[1, 2, 3]);
        let mut a = HandlerAccumulator::new_stub_with_num_cells(3);
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        assert_eq!(grid[0], vm(&[1, 2]));
        assert_eq!(grid[1], vm(&[1, 2]));
        assert_eq!(grid[2], vm(&[3]));
    }

    #[test]
    fn required_values_skip_transitive_key() {
        // a == b is transitive, so required-value exclusions should NOT run.
        let ce = CellExclusions::from_exclusion_groups(&[vec![0, 1, 2]]);

        let nv = 3u8;
        let mut handler = make_handler(|a, b| a == b, nv, 0, 1);
        let all = CandidateSet::all(nv);
        let mut grid = vec![all; 3];
        let shape = GridShape::square(1).unwrap();
        let mut alloc = GridStateAllocator::new(3);
        handler.initialize(&mut grid, &ce, shape, &mut alloc);

        grid[0] = vm(&[1, 2]);
        grid[1] = vm(&[1, 2]);
        grid[2] = vm(&[1, 2, 3]);
        let mut a = HandlerAccumulator::new_stub_with_num_cells(3);
        assert_eq!(handler.enforce_consistency(&mut grid, &mut a), true);
        // Transitive key → no pair exclusion.
        assert_eq!(grid[2], vm(&[1, 2, 3]));
    }
}
