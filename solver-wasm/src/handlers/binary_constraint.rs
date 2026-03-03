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
}
