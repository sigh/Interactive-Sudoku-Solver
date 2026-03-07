//! Interactive Sudoku Solver — Rust/WASM engine.
//!
//! This crate provides the core constraint-propagation + backtracking solver,
//! a high-level constraint type system, and both native (CLI) and WASM entry
//! points.
//!
//! ## Crate layout
//!
//! | Module | Purpose |
//! |--------|---------|
//! | [`api`] | Solver construction, result conversion, WASM entry points |
//! | [`api::types`] | Serde boundary types (JSON input/output structs) |
//! | [`candidate_set`] | `CandidateSet` newtype for candidate bitmasks |
//! | [`constraint`] | High-level `Constraint` enum |
//! | [`constraint::parser`] | Parser: URL strings → `Vec<Constraint>` |
//! | [`constraint::builder`] | Builder: `Vec<Constraint>` → `Solver` |
//! | [`solver`] | Core backtracking engine |
//! | [`grid`] | 9×9 grid representation |
//! | [`rng`] | SplitMix32 PRNG and Fisher-Yates shuffle |
//! | [`handlers`] | `ConstraintHandler` trait + concrete handlers |
//! | [`handlers::sum`] | Sum/killer-cage constraint handler |

// ============================================================================
// Modules
// ============================================================================
pub mod api;
pub(crate) mod bit_set;
pub(crate) mod candidate_set;
pub mod constraint;
pub mod grid_shape;
pub(crate) mod handlers;
pub(crate) mod nfa;
pub(crate) mod rng;
pub mod simple_solver;
pub(crate) mod solver;
