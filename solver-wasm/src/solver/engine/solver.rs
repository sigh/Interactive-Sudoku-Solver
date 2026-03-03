//! Outer Solver — owns iteration management (mirrors JS SudokuSolver).

use std::collections::HashMap;

use super::internal_solver::{InternalSolver, RunMode, SolverState};
use super::{AllPossibilitiesResult, SolveResult, SolverCounters, StepGuide, StepResult};
use crate::grid::Grid;
use crate::grid_shape::GridShape;
use crate::handlers::ConstraintHandler;
use crate::solver::debug::{DebugLog, DebugOptions, SolverProgress};

/// Public solver wrapper.
///
/// Owns the [`InternalSolver`] (search engine). Counters are owned by
/// `inner` and accumulate across `nth_solution` calls. Mirrors the JS
/// `SudokuSolver` / `InternalSolver` split.
///
/// Constructed via [`SudokuBuilder::build`](crate::constraint::builder::SudokuBuilder::build).
pub struct Solver {
    inner: InternalSolver,
}

impl Solver {
    /// Build from a grid, full handler set, and grid shape.
    ///
    /// This is the production entry point, called by
    /// [`SudokuBuilder::build`](crate::constraint::builder::SudokuBuilder::build).
    /// The caller provides the complete handler set (including house handlers).
    pub fn from_handlers(
        grid: Grid,
        handlers: Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
    ) -> Result<Self, String> {
        let inner = InternalSolver::new(grid, handlers, shape)?;
        Ok(Self { inner })
    }

    /// Find the nth solution (0-indexed), resuming the search when possible.
    ///
    /// Mirrors the JS `SudokuSolver.nthSolution(n)` pattern. The solver
    /// caches its search state so that sequential forward calls
    /// (`nth_solution(0)`, `nth_solution(1)`, …) are incremental — each
    /// call only searches for one additional solution.
    ///
    /// Going backwards (`n < solutions_already_found`) resets the search
    /// and replays from the start.
    ///
    /// Mirrors JS `SudokuSolver.nthSolution(n)`.
    pub fn nth_solution(
        &mut self,
        n: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> SolveResult {
        if self.inner.initial_contradiction {
            return SolveResult {
                solution: None,
                counters: SolverCounters::default(),
            };
        }

        let target = n + 1; // need `target` total solutions to reach solution n (0-indexed)
        let mut solution = None;

        // Reset if going backwards or if the solver is in an intermediate state
        // (e.g. after nth_step interrupted a search), where run() would panic.
        if target <= self.inner.counters.solutions || self.inner.state == SolverState::Incomplete {
            // Going backwards or invalid state: full reset (fresh conflict
            // scores + counters), matching JS.
            self.inner.reset();
        }

        if self.inner.state != SolverState::Exhausted {
            self.inner.run(
                RunMode::MaxSolutions {
                    max_solutions: target,
                },
                progress,
                None,
                &mut |sol| {
                    solution = Some(sol.to_vec());
                },
            );
        }

        // If the search exhausted before reaching the target, there is no nth solution.
        if self.inner.counters.solutions < target {
            solution = None;
        }

        SolveResult {
            solution,
            counters: self.inner.counters.clone(),
        }
    }

    /// Solve and return the first solution found (if any).
    ///
    /// Pass `&mut |_| {}` as `progress` to disable progress reporting.
    pub fn solve(&mut self, progress: &mut dyn FnMut(&SolverProgress)) -> SolveResult {
        if self.inner.initial_contradiction {
            return SolveResult {
                solution: None,
                counters: SolverCounters::default(),
            };
        }
        self.inner.reset();
        let mut solution = None;
        self.inner.run(
            RunMode::MaxSolutions { max_solutions: 1 },
            progress,
            None,
            &mut |sol| {
                solution = Some(sol.to_vec());
            },
        );
        SolveResult {
            solution,
            counters: self.inner.counters.clone(),
        }
    }

    /// Validate the layout by attempting to find any solution.
    ///
    /// Uses a house-filling warmup heuristic to quickly identify invalid layouts.
    /// Pass `&mut |_| {}` as `progress` to disable progress reporting.
    pub fn validate_layout(&mut self, progress: &mut dyn FnMut(&SolverProgress)) -> SolveResult {
        self.inner.reset();
        self.inner.validate_layout(progress)
    }

    /// Count solutions up to `limit` (0 = unlimited).
    ///
    /// Pass `&mut |_| {}` as `progress` to disable progress reporting.
    pub fn count_solutions(
        &mut self,
        limit: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (u64, SolverCounters) {
        if self.inner.initial_contradiction {
            return (0, SolverCounters::default());
        }
        self.inner.reset();
        let mode = if limit == 0 {
            RunMode::Exhaustive
        } else {
            RunMode::MaxSolutions {
                max_solutions: limit,
            }
        };
        self.inner.run(mode, progress, None, &mut |_| {});
        (self.inner.counters.solutions, self.inner.counters.clone())
    }

    /// Solve all possibilities: find every solution and track per-cell
    /// per-value candidate counts.
    pub fn solve_all_possibilities(
        &mut self,
        threshold: u8,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> AllPossibilitiesResult {
        self.inner.reset();
        self.inner.solve_all_possibilities(threshold, progress)
    }

    /// Estimate the number of solutions using Knuth's random-walk method.
    pub fn estimated_count_solutions(
        &mut self,
        max_samples: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (f64, u64, SolverCounters) {
        self.inner.reset();
        self.inner.estimated_count_solutions(max_samples, progress)
    }

    /// Find the nth step (0-indexed).
    ///
    /// Mirrors JS `SudokuSolver.nthStep(n, stepGuides)`. Always replays
    /// from scratch for determinism (same step every time for same index).
    ///
    /// Returns `Some(StepResult)` if step `n` exists, `None` if the
    /// search is exhausted before reaching that step.
    pub fn nth_step(
        &mut self,
        n: u64,
        step_guides: HashMap<u64, StepGuide>,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> Option<StepResult> {
        if self.inner.initial_contradiction {
            return None;
        }

        // Always start fresh — guarantees determinism.
        self.inner.reset();
        self.inner.set_step_guides(step_guides);

        // Log the step marker (matching JS nthStep debug log).
        if self.inner.debug_options.log_level >= 1 {
            self.inner.debug_logs.push(DebugLog {
                loc: "nthStep".to_string(),
                msg: format!("Step {}", n),
                args: None,
                important: true,
                cells: Vec::new(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }

        // target is 1-indexed: step n (0-indexed) is event number n+1.
        self.inner
            .run(RunMode::Step { target: n + 1 }, progress, None, &mut |_| {});

        self.inner.take_step_result()
    }

    /// Set the log2 progress frequency.
    pub fn set_progress_frequency(&mut self, log_freq: u32) {
        self.inner.set_progress_frequency(log_freq)
    }

    /// Set debug options controlling what debug data to export.
    pub fn set_debug_options(&mut self, opts: DebugOptions) {
        self.inner.set_debug_options(opts)
    }
}
