//! Constraint handler definitions.
//!
//! Each handler implements the `ConstraintHandler` trait.

mod all_different;
mod and;
mod between;
mod binary_constraint;
mod binary_pairwise;
mod box_info;
mod counting_circles;
mod dutch_flatmate_line;
mod equal_size_partitions;
mod false_handler;
mod full_grid_required_values;
mod full_rank;
mod given_candidates;
mod hidden_skyscraper;
mod house;
mod indexing;
mod jigsaw_piece;
mod local_squishable;
mod lockout;
mod lunchbox;
pub(crate) mod nfa_constraint;
mod or;
pub(crate) mod placeholder;
mod priority;
mod rellik;
pub(crate) mod required_values;
mod same_values;
mod same_values_ignore_count;
mod skyscraper;
pub(crate) mod sum;
mod sum_line;
#[cfg(test)]
pub(crate) mod test_util;
mod true_handler;
mod unique_value_exclusion;
pub(crate) mod util;
mod value_dependent_exclusion;
mod value_dependent_exclusion_house;
mod value_indexing;

pub use all_different::{AllDifferent, AllDifferentType};
pub use and::And;
pub use between::Between;
pub use binary_constraint::{fn_to_binary_key, fn_to_binary_key_with_offset, BinaryConstraint};
pub use binary_pairwise::BinaryPairwise;
pub use box_info::BoxInfo;
pub use counting_circles::CountingCircles;
pub use dutch_flatmate_line::DutchFlatmateLine;
pub use equal_size_partitions::EqualSizePartitions;
pub use false_handler::False;
pub use full_grid_required_values::FullGridRequiredValues;
pub use full_rank::{FullRank, RankClue, TieMode};
pub use given_candidates::{GivenCandidates, GivenValue};
pub use hidden_skyscraper::HiddenSkyscraper;
pub use house::House;
pub use indexing::Indexing;
pub use jigsaw_piece::JigsawPiece;
pub use local_squishable::LocalSquishable2x2;
pub use lockout::Lockout;
pub use lunchbox::Lunchbox;
pub use nfa_constraint::NfaConstraint;
pub use or::Or;
pub(crate) use placeholder::Placeholder;
pub use priority::Priority;
pub use rellik::Rellik;
pub use required_values::RequiredValues;
pub use same_values::SameValues;
pub use same_values_ignore_count::SameValuesIgnoreCount;
pub use skyscraper::Skyscraper;
pub use sum_line::SumLine;
pub use true_handler::True;
pub use unique_value_exclusion::UniqueValueExclusion;
pub use value_dependent_exclusion::ValueDependentUniqueValueExclusion;
pub use value_dependent_exclusion_house::ValueDependentUniqueValueExclusionHouse;
pub use value_indexing::ValueIndexing;

use std::any::Any;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::candidate_selector::CandidateFinderDescription;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

// ============================================================================
// AsAny — blanket trait for downcast support
// ============================================================================

/// Provides `as_any` and `as_any_mut` via a blanket impl so that every
/// `ConstraintHandler` implementor gets downcasting for free.
pub trait AsAny: 'static {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

impl<T: 'static> AsAny for T {
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

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
pub trait ConstraintHandler: AsAny {
    /// The cells this handler watches. When any of these cells change,
    /// `enforce_consistency` is called.
    fn cells(&self) -> &[CellIndex];

    /// Enforce the constraint on the grid.
    ///
    /// Returns `false` if the grid is contradictory (impossible to satisfy).
    /// Returns `true` if the grid is (potentially) valid.
    ///
    /// When this handler removes candidates from cells, it must call
    /// `acc.add_for_cell(cell)` for each modified cell.
    fn enforce_consistency(&self, grid: &mut [CandidateSet], acc: &mut HandlerAccumulator) -> bool;

    /// One-time initialization after construction.
    ///
    /// Called with the initial grid state, cell exclusions, shape, and
    /// a state allocator. Handlers that need per-backtrack-frame mutable
    /// state call `state_allocator.allocate()` to reserve extra grid slots.
    ///
    /// May modify `initial_grid` (e.g., to set given values).
    /// Returns `false` if the initial state is contradictory.
    fn initialize(
        &mut self,
        _initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        _shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        true
    }

    /// Called after all handlers have been initialized. Receives the
    /// full initial grid state (including any extra allocated slots).
    ///
    /// Mirrors JS `SudokuConstraintHandler.postInitialize(readonlyGridState)`.
    fn post_initialize(&mut self, _initial_grid_state: &[CandidateSet]) {}

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
    fn exclusion_cells(&self) -> &[CellIndex] {
        &[]
    }

    /// Handler type name, matching JS `constructor.name`.
    /// Used for debug logging, sorting, and optimizer log messages.
    fn name(&self) -> &'static str;

    /// Unique ID string for deduplication in the optimizer.
    fn id_str(&self) -> String {
        format!("{}-{:?}", self.name(), self.cells())
    }

    /// Whether this handler is essential for correctness (vs. performance-only).
    fn is_essential(&self) -> bool {
        true
    }

    /// Candidate finder specifications for custom branching heuristics.
    ///
    /// Returns descriptions of candidate finders this handler provides.
    /// These are used by `CandidateFinderSet` to build finders that guide
    /// the solver's cell/value selection during backtracking.
    ///
    /// Mirrors JS `SudokuConstraintHandler.candidateFinders(grid, shape)`.
    /// The `shape` parameter provides grid dimensions for computing cell
    /// regions (e.g., edge rows/columns). Actual grid-state filtering
    /// happens lazily during `CandidateFinderSet::initialize()`.
    fn candidate_finders(&self, _shape: GridShape) -> Vec<CandidateFinderDescription> {
        vec![]
    }
}
