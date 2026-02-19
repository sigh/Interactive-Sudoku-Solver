//! SameValuesIgnoreCount — enforces that multiple cell-sets contain the
//! same set of values (ignoring multiplicities).
//!
//! Mirrors JS `SameValuesIgnoreCount`.

use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::api::types::CellIndex;

use super::ConstraintHandler;

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
    cell_sets: Vec<Vec<CellIndex>>,
    /// All cells (flattened, for the `cells()` trait method).
    all_cells: Vec<CellIndex>,
    /// Largest exclusion group size within any set.
    max_exclusion_size: usize,
    /// Number of exclusion groups (1 = all distinct).
    num_exclusion_sets: usize,
    /// All values bitmask (set from shape during initialize).
    all_values: CandidateSet,
    /// Grid state offset for short-circuit caching, or `None`.
    ///
    /// When all cells in a mutually-exclusive set are resolved
    /// (intersection size == max_exclusion_size), we write a non-zero
    /// marker at this offset so future calls can return early.
    ///
    /// Mirrors JS `SameValues._stateOffset`.
    state_offset: Option<usize>,
}

impl SameValuesIgnoreCount {
    pub fn new(sets: Vec<Vec<CellIndex>>) -> Self {
        // Sort each set for canonical ordering.
        let cell_sets: Vec<Vec<CellIndex>> = sets
            .into_iter()
            .map(|mut s| {
                s.sort();
                s
            })
            .collect();

        let all_cells: Vec<CellIndex> = cell_sets.iter().flat_map(|s| s.iter().copied()).collect();

        SameValuesIgnoreCount {
            cell_sets,
            all_cells,
            max_exclusion_size: 1,
            num_exclusion_sets: 0,
            all_values: CandidateSet::EMPTY,
            state_offset: None,
        }
    }
}

impl ConstraintHandler for SameValuesIgnoreCount {
    fn cells(&self) -> &[CellIndex] {
        &self.all_cells
    }

    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        cell_exclusions: &CellExclusions,
        shape: GridShape,
        state_allocator: &mut GridStateAllocator,
    ) -> bool {
        self.all_values = CandidateSet::all(shape.num_values);
        // Check the set lengths are equal.
        if self.cell_sets.len() < 2 {
            return true;
        }
        let set_len = self.cell_sets[0].len();
        if !self.cell_sets.iter().all(|s| s.len() == set_len) {
            return false;
        }

        self.num_exclusion_sets = set_len;

        // Find the maximum exclusion group size.
        for set in &self.cell_sets {
            if cell_exclusions.are_mutually_exclusive(set) {
                self.num_exclusion_sets = 1;
                self.max_exclusion_size = set.len();
                // Allocate a short-circuit state slot when worthwhile:
                // only for >2 cells per set and >2 sets.
                // Matches JS: set.length > 2 && this._cellSets.length > 2
                if set.len() > 2 && self.cell_sets.len() > 2 {
                    self.state_offset =
                        Some(state_allocator.allocate(&[CandidateSet::EMPTY]));
                }
                return true;
            }
        }

        true
    }

    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool {
        if self.cell_sets.len() < 2 {
            return true;
        }

        // Short-circuit: if we previously determined the constraint is
        // fully resolved, skip enforcement. Matches JS early exit.
        if let Some(offset) = self.state_offset {
            if !grid[offset].is_empty() {
                return true;
            }
        }

        // Compute value union for each set, and the overall intersection.
        let mut value_intersection = self.all_values;
        for set in &self.cell_sets {
            let mut values = CandidateSet::EMPTY;
            for &c in set {
                values |= grid[c as usize];
            }
            value_intersection &= values;
        }

        // Check there are enough values to fill the exclusion sets.
        let intersection_size = value_intersection.count();
        if (intersection_size as usize) < self.max_exclusion_size {
            return false;
        }

        // Enforce: restrict all cells to only use values in the intersection.
        // Iterate cells in reverse order within each set to match JS ordering
        // (JS uses `for (let j = setLen - 1; j >= 0; j--)`), which affects the
        // order that handlers are enqueued via add_for_cell.
        for set in &self.cell_sets {
            for i in (0..set.len()).rev() {
                let c = set[i];
                if (grid[c as usize] & !value_intersection) != CandidateSet::EMPTY {
                    grid[c as usize] &= value_intersection;
                    if grid[c as usize].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(c);
                }
            }
        }

        // If all values are distinct and fully resolved, mark as done.
        if self.num_exclusion_sets == 1 {
            if let Some(offset) = self.state_offset {
                if (intersection_size as usize) == self.max_exclusion_size {
                    grid[offset] = CandidateSet::from_raw(1);
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

    fn name(&self) -> &'static str {
        "SameValuesIgnoreCount"
    }

    fn id_str(&self) -> String {
        format!("SVIC-{:?}", self.cell_sets)
    }
}
