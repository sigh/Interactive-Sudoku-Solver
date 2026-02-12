use std::any::Any;

use crate::cell_exclusions::CellExclusions;
use crate::handler_accumulator::HandlerAccumulator;
use crate::util::{self, ALL_VALUES, NUM_VALUES};

// ============================================================================
// ConstraintHandler trait
// ============================================================================

/// Trait for all constraint handlers.
///
/// Mirrors JS `SudokuConstraintHandler` from handlers.js.
///
/// Handlers are invoked during constraint propagation to enforce their
/// invariants on the grid. The solver calls `enforce_consistency` whenever
/// a cell touched by this handler changes.
pub trait ConstraintHandler {
    /// The cells this handler watches. When any of these cells change,
    /// `enforce_consistency` is called.
    fn cells(&self) -> &[u8];

    /// Enforce the constraint on the grid.
    ///
    /// Returns `false` if the grid is contradictory (impossible to satisfy).
    /// Returns `true` if the grid is (potentially) valid.
    ///
    /// When this handler removes candidates from cells, it must call
    /// `acc.add_for_cell(cell)` for each modified cell.
    fn enforce_consistency(&self, grid: &mut [u16], acc: &mut HandlerAccumulator) -> bool;

    /// One-time initialization after construction.
    ///
    /// Called with the initial grid state and cell exclusions.
    /// May modify `initial_grid` (e.g., to set given values).
    /// Returns `false` if the initial state is contradictory.
    fn initialize(&mut self, _initial_grid: &mut [u16], _cell_exclusions: &CellExclusions) -> bool {
        true
    }

    /// Whether this is a singleton handler (one per cell, pushed to
    /// front of propagation queue).
    fn is_singleton(&self) -> bool {
        false
    }

    /// Priority for initial cell ordering. Higher = more constrained.
    fn priority(&self) -> i32 {
        self.cells().len() as i32
    }

    /// Cells that must have mutually exclusive values.
    /// Used to build the CellExclusions graph.
    fn exclusion_cells(&self) -> &[u8] {
        &[]
    }

    /// Debug name for logging.
    fn debug_name(&self) -> String {
        "Handler".to_string()
    }

    /// Short type name for normalized dump comparison with JS.
    fn handler_type_name(&self) -> &'static str {
        "Handler"
    }

    /// Unique ID string for deduplication.
    fn id_str(&self) -> String {
        self.debug_name()
    }

    /// Whether this handler is essential for correctness (vs. performance-only).
    fn is_essential(&self) -> bool {
        true
    }

    /// Downcast support for optimizer type queries.
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

// ============================================================================
// Placeholder — used by HandlerAccumulator::enforce_at to temporarily swap
// a handler out of the vec.
// ============================================================================

/// A no-op handler used as a temporary placeholder during `enforce_at`.
pub struct Placeholder;

impl ConstraintHandler for Placeholder {
    fn cells(&self) -> &[u8] {
        &[]
    }
    fn enforce_consistency(&self, _grid: &mut [u16], _acc: &mut HandlerAccumulator) -> bool {
        true
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

// ============================================================================
// UniqueValueExclusion — singleton handler
// ============================================================================

/// When a cell is fixed to a single value, remove that value from all
/// cells that share an AllDifferent constraint with it.
///
/// Mirrors JS `UniqueValueExclusion`.
pub struct UniqueValueExclusion {
    cell: u8,
    exclusion_cells: Vec<u8>,
}

impl UniqueValueExclusion {
    pub fn new(cell: u8) -> Self {
        UniqueValueExclusion {
            cell,
            exclusion_cells: Vec::new(),
        }
    }
}

impl ConstraintHandler for UniqueValueExclusion {
    fn cells(&self) -> &[u8] {
        std::slice::from_ref(&self.cell)
    }

    fn is_singleton(&self) -> bool {
        true
    }

    fn priority(&self) -> i32 {
        0
    }

    fn initialize(&mut self, _initial_grid: &mut [u16], cell_exclusions: &CellExclusions) -> bool {
        self.exclusion_cells = cell_exclusions.sets[self.cell as usize].clone();
        true
    }

    fn enforce_consistency(&self, grid: &mut [u16], acc: &mut HandlerAccumulator) -> bool {
        let value = grid[self.cell as usize];
        let exclusion_cells = &self.exclusion_cells;

        for &excl_cell in exclusion_cells {
            if grid[excl_cell as usize] & value != 0 {
                grid[excl_cell as usize] ^= value;
                if grid[excl_cell as usize] == 0 {
                    return false;
                }
                acc.add_for_cell(excl_cell);
            }
        }

        true
    }

    fn debug_name(&self) -> String {
        format!("UniqueValueExclusion({})", self.cell)
    }

    fn handler_type_name(&self) -> &'static str {
        "UniqueValueExclusion"
    }

    fn id_str(&self) -> String {
        format!("UVE-{}", self.cell)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

// ============================================================================
// House — hidden singles + completeness check
// ============================================================================

/// Enforces that a set of cells contains all values 1..=9 exactly once.
///
/// Detects hidden singles (values that appear in only one cell) and
/// exposes them by fixing the cell.
///
/// Mirrors JS `House`.
pub struct House {
    cells: Vec<u8>,
    all_values: u16,
}

impl House {
    pub fn new(cells: Vec<u8>) -> Self {
        House {
            cells,
            all_values: ALL_VALUES,
        }
    }
}

impl ConstraintHandler for House {
    fn cells(&self) -> &[u8] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[u8] {
        &self.cells
    }

    fn enforce_consistency(&self, grid: &mut [u16], _acc: &mut HandlerAccumulator) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();

        let mut all_values: u16 = 0;
        let mut at_least_two: u16 = 0;
        let mut fixed_values: u16 = 0;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            at_least_two |= all_values & v;
            all_values |= v;
            // Avoid branching: is_single check via bit trick.
            fixed_values |= if util::is_single(v) { v } else { 0 };
        }

        // If not all values are represented, contradiction.
        if all_values != self.all_values {
            return false;
        }

        // If all values are fixed, we're done.
        if fixed_values == self.all_values {
            return true;
        }

        // Hidden singles: values that appear in exactly one cell.
        let hidden_singles = all_values & !at_least_two & !fixed_values;
        if hidden_singles != 0 {
            if !expose_hidden_singles(grid, cells, hidden_singles) {
                return false;
            }
        }

        true
    }

    fn debug_name(&self) -> String {
        format!("House({:?})", self.cells)
    }

    fn handler_type_name(&self) -> &'static str {
        "House"
    }

    fn id_str(&self) -> String {
        format!("House-{:?}", self.cells)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

// ============================================================================
// AllDifferent — exclusion-based propagation
// ============================================================================

/// Enforces that a set of cells all have different values.
///
/// By default, propagation is handled via the CellExclusions graph
/// (PROPAGATE_WITH_EXCLUSION_CELLS). When used inside an And/Or handler,
/// it can propagate directly (PROPAGATE_WITH_ENFORCER).
///
/// Mirrors JS `AllDifferent`.
pub struct AllDifferent {
    cells: Vec<u8>,
    exclusion_cells: Vec<u8>,
    enforcement_type: AllDifferentType,
}

#[derive(Clone, Copy, PartialEq)]
pub enum AllDifferentType {
    /// Propagation via CellExclusions (default).
    WithExclusionCells,
    /// Direct propagation via enforceConsistency.
    WithEnforcer,
}

impl AllDifferent {
    pub fn new(exclusion_cells: Vec<u8>, enforcement_type: AllDifferentType) -> Self {
        let cells = if enforcement_type == AllDifferentType::WithEnforcer {
            exclusion_cells.clone()
        } else {
            Vec::new() // No cells to watch — handled via exclusion graph.
        };

        let mut sorted = exclusion_cells;
        sorted.sort();
        sorted.dedup();

        AllDifferent {
            cells,
            exclusion_cells: sorted,
            enforcement_type,
        }
    }
}

impl ConstraintHandler for AllDifferent {
    fn cells(&self) -> &[u8] {
        &self.cells
    }

    fn exclusion_cells(&self) -> &[u8] {
        if self.enforcement_type == AllDifferentType::WithExclusionCells {
            &self.exclusion_cells
        } else {
            &[]
        }
    }

    fn initialize(&mut self, _initial_grid: &mut [u16], _cell_exclusions: &CellExclusions) -> bool {
        self.exclusion_cells.len() <= NUM_VALUES
    }

    fn enforce_consistency(&self, grid: &mut [u16], _acc: &mut HandlerAccumulator) -> bool {
        // Only called when enforcement_type is WithEnforcer.
        let cells = &self.cells;
        let num_cells = cells.len();

        for i in 0..num_cells {
            let cell = cells[i] as usize;
            let v = grid[cell];
            if !util::is_single(v) {
                continue;
            }
            for j in 0..num_cells {
                if i != j {
                    grid[cells[j] as usize] &= !v;
                    if grid[cells[j] as usize] == 0 {
                        return false;
                    }
                }
            }
        }
        true
    }

    fn debug_name(&self) -> String {
        format!("AllDifferent({:?})", self.exclusion_cells)
    }

    fn handler_type_name(&self) -> &'static str {
        "AllDifferent"
    }

    fn id_str(&self) -> String {
        format!("AD-{:?}", self.exclusion_cells)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

// ============================================================================
// BinaryConstraint — 2-cell relation via lookup tables
// ============================================================================

/// Number of possible bitmask combinations for NUM_VALUES bits.
const COMBINATIONS: usize = 1 << NUM_VALUES;

/// Enforces a binary relation between two cells using lookup tables.
///
/// For each possible candidate set of one cell, the table gives the
/// set of allowed values for the other cell. This handles any 2-cell
/// constraint: sum, difference, ordering, etc.
///
/// Mirrors JS `BinaryConstraint`.
pub struct BinaryConstraint {
    cells: [u8; 2],
    /// tables[0][mask_of_cell0] → allowed values for cell1
    /// tables[1][mask_of_cell1] → allowed values for cell0
    tables: [Vec<u16>; 2],
    /// Key string for deduplication.
    key: String,
    /// Pair exclusion cells for required-value reasoning (optional).
    pair_exclusion_cells: Vec<u8>,
}

impl BinaryConstraint {
    /// Create a BinaryConstraint from a predicate.
    ///
    /// `pred(a, b)` returns true if value pair (a, b) is allowed,
    /// where a ∈ 1..=9 and b ∈ 1..=9.
    pub fn from_predicate(cell0: u8, cell1: u8, pred: impl Fn(u8, u8) -> bool) -> Self {
        let key = build_binary_key(&pred);
        Self::new(cell0, cell1, key, &pred)
    }

    /// Create a BinaryConstraint from a precomputed key and predicate.
    pub fn new(cell0: u8, cell1: u8, key: String, pred: &dyn Fn(u8, u8) -> bool) -> Self {
        let mut table0 = vec![0u16; COMBINATIONS]; // cell0 mask → allowed cell1
        let mut table1 = vec![0u16; COMBINATIONS]; // cell1 mask → allowed cell0

        // Populate base cases (single-value masks).
        for i in 0..NUM_VALUES {
            for j in 0..NUM_VALUES {
                if pred((i + 1) as u8, (j + 1) as u8) {
                    table0[1 << i] |= 1 << j;
                    table1[1 << j] |= 1 << i;
                }
            }
        }

        // Fill in multi-value masks by ORing together single-value entries.
        for mask in 1..COMBINATIONS {
            table0[mask] = table0[mask & (mask - 1)] | table0[mask & mask.wrapping_neg()];
            table1[mask] = table1[mask & (mask - 1)] | table1[mask & mask.wrapping_neg()];
        }

        BinaryConstraint {
            cells: [cell0, cell1],
            tables: [table0, table1],
            key,
            pair_exclusion_cells: Vec::new(),
        }
    }
}

impl ConstraintHandler for BinaryConstraint {
    fn cells(&self) -> &[u8] {
        &self.cells
    }

    fn initialize(&mut self, _initial_grid: &mut [u16], cell_exclusions: &CellExclusions) -> bool {
        // Cache pair exclusion cells for required-value reasoning.
        self.pair_exclusion_cells =
            cell_exclusions.get_list_exclusions(&[self.cells[0], self.cells[1]]);

        // Check that the initial all-values mask is compatible.
        self.tables[0][ALL_VALUES as usize] != 0
    }

    fn enforce_consistency(&self, grid: &mut [u16], acc: &mut HandlerAccumulator) -> bool {
        let v0 = grid[self.cells[0] as usize];
        let v1 = grid[self.cells[1] as usize];

        let v0_new = v0 & self.tables[1][v1 as usize];
        let v1_new = v1 & self.tables[0][v0 as usize];

        if v0_new == 0 || v1_new == 0 {
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

        // Required-value exclusion: if both cells are unfixed and share a
        // value that is forced to appear in both, remove it from common
        // exclusion cells.
        if self.pair_exclusion_cells.is_empty() {
            return true;
        }
        if util::is_single(v0_new) || util::is_single(v1_new) {
            return true;
        }

        let mut common_values = v0_new & v1_new;
        let mut required_values: u16 = 0;
        while common_values != 0 {
            let value = common_values & common_values.wrapping_neg();
            common_values ^= value;

            // Check if removing this value from cell0 forces cell1 to have
            // exactly this value.
            if self.tables[0][v0_new as usize ^ value as usize] & v1_new == value {
                required_values |= value;
            }
        }

        while required_values != 0 {
            let value = required_values & required_values.wrapping_neg();
            required_values ^= value;

            for &excl_cell in &self.pair_exclusion_cells {
                if grid[excl_cell as usize] & value != 0 {
                    grid[excl_cell as usize] ^= value;
                    if grid[excl_cell as usize] == 0 {
                        return false;
                    }
                    acc.add_for_cell(excl_cell);
                }
            }
        }

        true
    }

    fn debug_name(&self) -> String {
        format!("BinaryConstraint({},{})", self.cells[0], self.cells[1])
    }

    fn handler_type_name(&self) -> &'static str {
        "BinaryConstraint"
    }

    fn id_str(&self) -> String {
        format!("BC-{}-{}-{}", self.key, self.cells[0], self.cells[1])
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// Build a binary key string from a predicate (for deduplication).
///
/// Encodes the 9x9 truth table as a compact string.
pub fn build_binary_key(pred: &dyn Fn(u8, u8) -> bool) -> String {
    let mut bits = Vec::new();
    for i in 1..=NUM_VALUES {
        for j in 1..=NUM_VALUES {
            bits.push(if pred(i as u8, j as u8) { '1' } else { '0' });
        }
    }
    bits.iter().collect()
}

// ============================================================================
// SameValuesIgnoreCount — pointing pairs / box-line reduction
// ============================================================================

/// Enforces that two sets of cells contain the same set of possible values.
///
/// This is a simplified version used by the optimizer for house
/// intersections (box-line reduction / pointing pairs). It does not
/// enforce count constraints.
///
/// Each cell set represents the "difference" between two overlapping
/// houses. The constraint ensures their union of values is identical.
///
/// Mirrors JS `SameValuesIgnoreCount` (extends `SameValues` but skips
/// `_enforceCounts`).
pub struct SameValuesIgnoreCount {
    /// The cell sets (each must have the same length).
    cell_sets: Vec<Vec<u8>>,
    /// All cells (flattened, for the `cells()` trait method).
    all_cells: Vec<u8>,
    /// Largest exclusion group size within any set.
    max_exclusion_size: usize,
}

impl SameValuesIgnoreCount {
    pub fn new(sets: Vec<Vec<u8>>) -> Self {
        // Sort each set for canonical ordering.
        let cell_sets: Vec<Vec<u8>> = sets
            .into_iter()
            .map(|mut s| {
                s.sort();
                s
            })
            .collect();

        let all_cells: Vec<u8> = cell_sets.iter().flat_map(|s| s.iter().copied()).collect();

        SameValuesIgnoreCount {
            cell_sets,
            all_cells,
            max_exclusion_size: 1,
        }
    }
}

impl ConstraintHandler for SameValuesIgnoreCount {
    fn cells(&self) -> &[u8] {
        &self.all_cells
    }

    fn initialize(&mut self, _initial_grid: &mut [u16], cell_exclusions: &CellExclusions) -> bool {
        // Check the set lengths are equal.
        if self.cell_sets.len() < 2 {
            return true;
        }
        let set_len = self.cell_sets[0].len();
        if !self.cell_sets.iter().all(|s| s.len() == set_len) {
            return false;
        }

        // Find the maximum exclusion group size.
        for set in &self.cell_sets {
            if cell_exclusions.are_mutually_exclusive(set) {
                self.max_exclusion_size = set.len();
                break;
            }
        }

        true
    }

    fn enforce_consistency(&self, grid: &mut [u16], acc: &mut HandlerAccumulator) -> bool {
        if self.cell_sets.len() < 2 {
            return true;
        }

        // Compute value union for each set, and the overall intersection.
        let mut value_intersection: u16 = ALL_VALUES;
        for set in &self.cell_sets {
            let mut values: u16 = 0;
            for &c in set {
                values |= grid[c as usize];
            }
            value_intersection &= values;
        }

        // Check there are enough values to fill the exclusion sets.
        let intersection_size = util::count_ones(value_intersection);
        if intersection_size < self.max_exclusion_size as u32 {
            return false;
        }

        // Enforce: restrict all cells to only use values in the intersection.
        // Iterate cells in reverse order within each set to match JS ordering
        // (JS uses `for (let j = setLen - 1; j >= 0; j--)`), which affects the
        // order that handlers are enqueued via add_for_cell.
        for set in &self.cell_sets {
            for i in (0..set.len()).rev() {
                let c = set[i];
                if grid[c as usize] & !value_intersection != 0 {
                    grid[c as usize] &= value_intersection;
                    if grid[c as usize] == 0 {
                        return false;
                    }
                    acc.add_for_cell(c);
                }
            }
        }

        true
    }

    fn priority(&self) -> i32 {
        0 // Optimizer-created, don't inflate priority.
    }

    fn is_essential(&self) -> bool {
        false
    }

    fn debug_name(&self) -> String {
        format!("SameValuesIgnoreCount({:?})", self.cell_sets)
    }

    fn handler_type_name(&self) -> &'static str {
        "SameValuesIgnoreCount"
    }

    fn id_str(&self) -> String {
        format!("SVIC-{:?}", self.cell_sets)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

// ============================================================================
// GivenCandidates — restrict cells during initialization
// ============================================================================

/// Sets initial candidate values for specific cells.
///
/// This handler only acts during `initialize` — it has no runtime
/// enforcement cost.
///
/// Mirrors JS `GivenCandidates`.
pub struct GivenCandidates {
    /// (cell, value_mask) pairs.
    values: Vec<(u8, u16)>,
}

impl GivenCandidates {
    pub fn new(values: Vec<(u8, u16)>) -> Self {
        GivenCandidates { values }
    }
}

impl ConstraintHandler for GivenCandidates {
    fn cells(&self) -> &[u8] {
        &[]
    }

    fn initialize(&mut self, initial_grid: &mut [u16], _cell_exclusions: &CellExclusions) -> bool {
        for &(cell, mask) in &self.values {
            initial_grid[cell as usize] &= mask;
            if initial_grid[cell as usize] == 0 {
                return false;
            }
        }
        true
    }

    fn enforce_consistency(&self, _grid: &mut [u16], _acc: &mut HandlerAccumulator) -> bool {
        true // No runtime enforcement.
    }

    fn debug_name(&self) -> String {
        "GivenCandidates".to_string()
    }

    fn handler_type_name(&self) -> &'static str {
        "GivenCandidates"
    }

    fn id_str(&self) -> String {
        format!("GC-{:?}", self.values)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

// ============================================================================
// Utility functions
// ============================================================================

/// Expose hidden singles: for each bit in `hidden_singles`, find the cell
/// in `cells` that contains it and fix that cell to that value.
///
/// Returns `false` if a cell has multiple hidden singles (contradiction).
///
/// Mirrors JS `HandlerUtil.exposeHiddenSingles`.
fn expose_hidden_singles(grid: &mut [u16], cells: &[u8], hidden_singles: u16) -> bool {
    for &cell in cells {
        let value = grid[cell as usize] & hidden_singles;
        if value != 0 {
            // If more than one hidden single maps to this cell → contradiction.
            if !util::is_single(value) {
                return false;
            }
            grid[cell as usize] = value;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expose_hidden_singles() {
        // Cell 0 has {1,2,3}, cell 1 has {2,3}, cell 2 has {3,4}.
        // Value 1 is a hidden single in cell 0.
        let mut grid = [0u16; 81];
        grid[0] = 0b111; // {1,2,3}
        grid[1] = 0b110; // {2,3}
        grid[2] = 0b1100; // {3,4}
        let cells = [0u8, 1, 2];
        let hidden = 0b1; // value 1
        assert!(expose_hidden_singles(&mut grid, &cells, hidden));
        assert_eq!(grid[0], 0b1); // fixed to {1}
    }

    #[test]
    fn test_unique_value_exclusion() {
        let mut handler = UniqueValueExclusion::new(0);
        // Manually set up exclusion cells (normally done via initialize).
        handler.exclusion_cells = vec![1, 2, 3];

        let mut grid = [ALL_VALUES; 81];
        grid[0] = util::value_bit(5); // cell 0 fixed to 5

        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));

        // Value 5 should be removed from cells 1, 2, 3.
        for &cell in &[1u8, 2, 3] {
            assert_eq!(grid[cell as usize] & util::value_bit(5), 0);
        }
        // Other cells unchanged.
        assert_eq!(grid[4], ALL_VALUES);
    }

    #[test]
    fn test_house_hidden_singles() {
        let cells: Vec<u8> = (0..9).collect();
        let handler = House::new(cells);

        let mut grid = [0u16; 81];
        // Set up a grid where value 1 only appears in cell 0.
        grid[0] = 0b111; // {1,2,3}
        grid[1] = 0b110; // {2,3}
        grid[2] = 0b110; // {2,3}
                         // Cells 3-8: all have {4,5,6,7,8,9} = bits 3..8
        for i in 3..9 {
            grid[i] = 0b111111000;
        }

        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));

        // Cell 0 should be fixed to {1} (hidden single).
        assert_eq!(grid[0], 0b1);
    }

    #[test]
    fn test_house_contradiction_missing_value() {
        let cells: Vec<u8> = (0..9).collect();
        let handler = House::new(cells);

        let mut grid = [0u16; 81];
        // Only values {1,2,...,8} — value 9 is missing.
        for i in 0..9 {
            grid[i] = 0b011111111; // {1..8}
        }

        let mut acc = HandlerAccumulator::new_stub();
        assert!(!handler.enforce_consistency(&mut grid, &mut acc));
    }

    #[test]
    fn test_given_candidates() {
        let mut handler = GivenCandidates::new(vec![
            (0, util::value_bit(5)),
            (1, util::value_bit(3) | util::value_bit(7)),
        ]);
        let mut grid = [ALL_VALUES; 81];
        let ce = CellExclusions::new();
        assert!(handler.initialize(&mut grid, &ce));
        assert_eq!(grid[0], util::value_bit(5));
        assert_eq!(grid[1], util::value_bit(3) | util::value_bit(7));
    }

    #[test]
    fn test_all_different_enforcer() {
        let cells = vec![0u8, 1, 2];
        let handler = AllDifferent::new(cells, AllDifferentType::WithEnforcer);

        let mut grid = [ALL_VALUES; 81];
        grid[0] = util::value_bit(5); // fix cell 0 to 5

        let mut acc = HandlerAccumulator::new_stub();
        assert!(handler.enforce_consistency(&mut grid, &mut acc));

        // Value 5 removed from cells 1 and 2.
        assert_eq!(grid[1] & util::value_bit(5), 0);
        assert_eq!(grid[2] & util::value_bit(5), 0);
    }
}
