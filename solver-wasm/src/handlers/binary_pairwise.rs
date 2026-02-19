//! BinaryPairwise — applies a binary relation between ALL consecutive (or all) cell pairs.
//!
//! Mirrors JS `BinaryPairwise`. Uses the same lookup table as `BinaryConstraint`
//! but operates on N cells with an N-way prefix/suffix consistency pass.
//!
//! When the key represents an all-different constraint, also enforces:
//! - Valid combination filtering via _exactCombinationsTable / _validCombinationInfoTable
//! - Required value exclusions (hidden singles + cell exclusion propagation)
//! - Unique value support checking

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::binary_constraint::{get_binary_tables, BinaryTablePair};
use super::util::handler_util::{enforce_required_value_exclusions, expose_hidden_singles};
use super::ConstraintHandler;

// BinaryPairwise is ported from JS but not yet wired into the Rust builder.
#[allow(dead_code)]

// ============================================================================
// Memoized table caches (matching JS static memoized methods)
// ============================================================================

type ExactCombKey = (String, u8);
type ValidCombKey = (String, u8, usize);

fn exact_comb_cache() -> &'static Mutex<HashMap<ExactCombKey, Arc<Vec<u8>>>> {
    static CACHE: OnceLock<Mutex<HashMap<ExactCombKey, Arc<Vec<u8>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn valid_comb_cache() -> &'static Mutex<HashMap<ValidCombKey, Arc<Vec<u32>>>> {
    static CACHE: OnceLock<Mutex<HashMap<ValidCombKey, Arc<Vec<u32>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Build exact-combinations table for an all-different binary key.
///
/// Mirrors JS `BinaryPairwise._exactCombinationsTable`.
/// `exact[mask]` is 1 if exactly the values in `mask` form a valid assignment.
fn build_exact_combinations(key: &str, num_values: u8) -> Arc<Vec<u8>> {
    let cache_key = (key.to_string(), num_values);
    {
        let cache = exact_comb_cache().lock().unwrap();
        if let Some(v) = cache.get(&cache_key) {
            return v.clone();
        }
    }

    let tables = get_binary_tables(key, num_values);
    let table = &tables[0];
    let combinations = 1usize << (num_values as usize);
    let mut exact = vec![0u8; combinations];

    // Seed with valid pairs.
    for i in 0..num_values as usize {
        for j in 0..num_values as usize {
            let v = (1usize << i) | (1usize << j);
            if table[v] != CandidateSet::EMPTY {
                exact[v] = 1;
            }
        }
    }

    // Build up larger combinations.
    for i in 0..combinations {
        if CandidateSet::from_raw(i as u16).count() < 3 {
            continue;
        }
        let i_min = i & i.wrapping_neg();
        let i_rest = i ^ i_min;
        if exact[i_rest] == 0 {
            continue;
        }
        // Check i_min is consistent with the rest.
        let i_rest_cs = CandidateSet::from_raw(i_rest as u16);
        if (i_rest_cs & !table[i_min]) == CandidateSet::EMPTY {
            exact[i] = 1;
        }
    }

    let arc = Arc::new(exact);
    exact_comb_cache()
        .lock()
        .unwrap()
        .insert(cache_key, arc.clone());
    arc
}

/// Build valid-combination-info table.
///
/// Mirrors JS `BinaryPairwise._validCombinationInfoTable`.
/// Lower 16 bits = valid values, upper 16 bits = required values.
fn build_valid_combination_info(key: &str, num_values: u8, num_cells: usize) -> Arc<Vec<u32>> {
    let cache_key = (key.to_string(), num_values, num_cells);
    {
        let cache = valid_comb_cache().lock().unwrap();
        if let Some(v) = cache.get(&cache_key) {
            return v.clone();
        }
    }

    let exact = build_exact_combinations(key, num_values);
    let combinations = 1usize << (num_values as usize);
    let mut info = vec![0u32; combinations];

    for i in 0..combinations {
        let count = CandidateSet::from_raw(i as u16).count() as usize;
        if count < num_cells {
            continue;
        }
        if count == num_cells {
            if exact[i] != 0 {
                info[i] = ((i as u32) << 16) | (i as u32);
            }
            continue;
        }

        // Combine all valid subsets.
        info[i] = 0xffff << 16;
        let mut i_bits = i;
        while i_bits != 0 {
            let i_bit = i_bits & i_bits.wrapping_neg();
            i_bits ^= i_bit;
            if info[i ^ i_bit] != 0 {
                info[i] |= info[i ^ i_bit] & 0xffff;
                info[i] &= info[i ^ i_bit] | 0xffff;
            }
        }
        // Clear if there were no valid values.
        if info[i] & 0xffff == 0 {
            info[i] = 0;
        }
    }

    let arc = Arc::new(info);
    valid_comb_cache()
        .lock()
        .unwrap()
        .insert(cache_key, arc.clone());
    arc
}

// ============================================================================
// BinaryPairwise struct
// ============================================================================

/// BinaryPairwise constraint handler.
///
/// Enforces that ALL consecutive pairs of cells satisfy a binary relation
/// given by a Base64 key. Uses a prefix/suffix arc-consistency loop.
pub struct BinaryPairwise {
    cells: Vec<CellIndex>,
    key: String,
    num_values: u8,
    tables: Arc<BinaryTablePair>,
    is_all_different: bool,
    id_str: String,
    /// Prefix cache for arc consistency (interior mutable scratch space).
    prefix_cache: RefCell<Vec<CandidateSet>>,
    /// Valid combination info table (only for all-different keys).
    valid_combination_info: Option<Arc<Vec<u32>>>,
    /// Whether to run exposeHiddenSingles during required-value enforcement.
    enable_hidden_singles: bool,
}

#[allow(dead_code)]
impl BinaryPairwise {
    pub fn new(key: String, cells: Vec<CellIndex>, num_values: u8) -> Self {
        let tables = get_binary_tables(&key, num_values);
        let id_str = {
            let mut s = String::from("BinaryPairwise-");
            s.push_str(&key);
            for &c in &cells {
                s.push('-');
                s.push_str(&c.to_string());
            }
            s
        };
        let prefix_cache = vec![CandidateSet::EMPTY; cells.len() + 1];
        let is_all_different = Self::check_all_different(&tables[0], num_values);
        Self {
            cells,
            key,
            num_values,
            tables,
            is_all_different,
            id_str,
            prefix_cache: RefCell::new(prefix_cache),
            valid_combination_info: None,
            enable_hidden_singles: false,
        }
    }

    /// Get the binary key string.
    pub fn key(&self) -> &str {
        &self.key
    }

    /// Enable hidden singles enforcement (called by optimizer).
    pub fn enable_hidden_singles(&mut self) {
        self.enable_hidden_singles = true;
    }

    /// Validate that the key is symmetric (required for BinaryPairwise).
    ///
    /// Returns `Ok(())` if symmetric, `Err(msg)` otherwise.
    pub fn validate(&self, num_values: u8) -> Result<(), String> {
        let tables = get_binary_tables(&self.key, num_values);
        let nv = num_values as usize;
        for i in 0..nv {
            for j in (i + 1)..nv {
                let v = CandidateSet::from_raw((1 << i) | (1 << j));
                if tables[0][usize::from(v)] != tables[1][usize::from(v)] {
                    return Err(format!("BinaryPairwise key is not symmetric: {}", self.key));
                }
            }
        }
        Ok(())
    }

    fn check_all_different(table: &[CandidateSet], num_values: u8) -> bool {
        for i in 0..num_values as usize {
            let v = CandidateSet::from_raw(1 << i);
            if (table[usize::from(v)] & v) != CandidateSet::EMPTY {
                return false;
            }
        }
        true
    }

    #[inline]
    fn scratch(&self) -> std::cell::RefMut<'_, Vec<CandidateSet>> {
        self.prefix_cache.borrow_mut()
    }

    /// Enforce required value exclusions for all-different constraints.
    ///
    /// Mirrors JS `BinaryPairwise._enforceRequiredValues`.
    fn enforce_required_values(
        &self,
        grid: &mut [CandidateSet],
        cells: &[CellIndex],
        required_values: CandidateSet,
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let num_cells = cells.len();

        // Gather statistics.
        let mut all_values = CandidateSet::EMPTY;
        let mut non_unique_values = CandidateSet::EMPTY;
        let mut fixed_values = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            non_unique_values = non_unique_values | (all_values & v);
            all_values = all_values | v;
            // Branchless: fixedValues |= (!(v & (v-1))) * v in JS.
            if v.is_single() {
                fixed_values = fixed_values | v;
            }
        }

        if all_values == fixed_values {
            return true;
        }

        // Run exposeHiddenSingles if enabled.
        if self.enable_hidden_singles {
            let hidden_singles = required_values & !non_unique_values & !fixed_values;
            if !hidden_singles.is_empty() {
                if !expose_hidden_singles(grid, cells, hidden_singles) {
                    return false;
                }
            }
        }

        // Enforce non-unique required values (skip fixed — main loop handles those).
        let non_unique_required = required_values & non_unique_values & !fixed_values;
        if !non_unique_required.is_empty() {
            let ce = std::mem::take(acc.cell_exclusions());
            let ok =
                enforce_required_value_exclusions(grid, cells, non_unique_required, &ce, Some(acc));
            *acc.cell_exclusions() = ce;
            if !ok {
                return false;
            }
        }

        true
    }

    /// Check if unique values in a cell depend on unique values in the same
    /// cell for support.
    ///
    /// Mirrors JS `BinaryPairwise._enforceCellUniqueValues`.
    fn enforce_cell_unique_values(
        &self,
        grid: &mut [CandidateSet],
        cells: &[CellIndex],
        unique_values: CandidateSet,
        all_values: CandidateSet,
    ) -> bool {
        let valid_comb_info = match &self.valid_combination_info {
            Some(v) => v,
            None => return true,
        };

        for i in 0..cells.len() {
            let v = grid[cells[i] as usize];
            let cell_unique = v & unique_values;
            // Only interesting if multiple unique values in this cell.
            if cell_unique.count() <= 1 {
                continue;
            }
            let mut values = cell_unique;
            while !values.is_empty() {
                let value = values.lowest();
                values ^= value;
                // Since unique values are mutually exclusive, check valid
                // combinations without the other cell unique values.
                let info = valid_comb_info[usize::from(all_values ^ (cell_unique ^ value))];
                // Check if the value is still part of a valid combination.
                if CandidateSet::from_raw((info & 0xffff) as u16) & value == CandidateSet::EMPTY {
                    let v_new = grid[cells[i] as usize] & !value;
                    if v_new.is_empty() {
                        return false;
                    }
                    grid[cells[i] as usize] = v_new;
                }
            }
        }

        true
    }
}

impl ConstraintHandler for BinaryPairwise {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        if self.is_all_different {
            self.valid_combination_info = Some(build_valid_combination_info(
                &self.key,
                self.num_values,
                self.cells.len(),
            ));
        }

        let all = CandidateSet::all(self.num_values);
        let mut prefix = self.scratch();
        prefix[0] = all;
        !self.tables[0][usize::from(all)].is_empty()
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();
        let table = &self.tables[0]; // Symmetric, so table[0] == table[1].
        let mut prefix = self.scratch();

        let all_values = CandidateSet::all(self.num_values);
        prefix[0] = all_values;

        let mut all_changed = 0u32;
        let mut new_changed = 1u32;

        while new_changed != 0 {
            let first_cell = (new_changed & new_changed.wrapping_neg()).trailing_zeros() as usize;
            new_changed = 0;

            // Forward pass: build prefix.
            for i in first_cell..num_cells {
                prefix[i + 1] = prefix[i] & table[usize::from(grid[cells[i] as usize])];
            }

            // Backward pass: enforce and compute suffix.
            let mut suffix = all_values;
            for i in (0..num_cells).rev() {
                let v = grid[cells[i] as usize];
                let v_new = v & prefix[i] & suffix;
                if v != v_new {
                    if v_new.is_empty() {
                        return false;
                    }
                    grid[cells[i] as usize] = v_new;
                    new_changed |= 1 << i;
                }
                suffix = suffix & table[usize::from(v)];
            }
            all_changed |= new_changed;
        }

        // Queue changed cells.
        let mut changed = all_changed;
        while changed != 0 {
            let bit = changed & changed.wrapping_neg();
            changed ^= bit;
            let idx = bit.trailing_zeros() as usize;
            acc.add_for_cell(cells[idx]);
        }

        // --- All-different path ---
        if !self.is_all_different {
            return true;
        }

        let valid_comb_info = match &self.valid_combination_info {
            Some(v) => v,
            None => return true,
        };

        let mut all_vals = CandidateSet::EMPTY;
        let mut non_unique_values = CandidateSet::EMPTY;
        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            non_unique_values = non_unique_values | (all_vals & v);
            all_vals = all_vals | v;
        }

        // Filter out values which aren't in any valid combination.
        let info_entry = valid_comb_info[usize::from(all_vals)];
        let valid_values = CandidateSet::from_raw((info_entry & 0xffff) as u16);
        if valid_values.is_empty() {
            return false;
        }
        if valid_values != all_vals {
            for i in 0..num_cells {
                let v = grid[cells[i] as usize];
                if (v & !valid_values) != CandidateSet::EMPTY {
                    let v_new = v & valid_values;
                    if v_new.is_empty() {
                        return false;
                    }
                    grid[cells[i] as usize] = v_new;
                    acc.add_for_cell(cells[i]);
                }
            }
        }

        // Enforce required values.
        let required_values = CandidateSet::from_raw(((info_entry >> 16) & 0xffff) as u16);
        if !required_values.is_empty() {
            if !self.enforce_required_values(grid, cells, required_values, acc) {
                return false;
            }
        }

        // Check if unique values in a cell depend on unique values in the
        // same cell for support.
        let unique_values = valid_values & !non_unique_values;
        if unique_values.count() > 1 {
            if !self.enforce_cell_unique_values(grid, cells, unique_values, valid_values) {
                return false;
            }
        }

        true
    }

    fn name(&self) -> &'static str {
        "BinaryPairwise"
    }

    fn id_str(&self) -> String {
        self.id_str.clone()
    }
}
