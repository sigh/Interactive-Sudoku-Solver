pub(crate) mod candidate_selector;
pub(crate) mod cell_exclusions;
pub(crate) mod debug;
mod engine;
pub(crate) mod grid_state_allocator;
pub(crate) mod handler_accumulator;
pub(crate) mod handler_set;
pub(crate) mod lookup_tables;
pub(crate) mod optimizer;

#[cfg(test)]
mod tests;

pub use engine::{Solver, SolverCounters, StepGuide, StepResult, StepType};
