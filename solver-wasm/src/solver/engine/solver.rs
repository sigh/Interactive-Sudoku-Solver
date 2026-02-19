//! Outer Solver — owns iteration management (mirrors JS SudokuSolver).

use std::collections::HashMap;

use super::internal_solver::InternalSolver;
use super::{AllPossibilitiesResult, SolveResult, SolverCounters, StepGuide, StepResult};
use crate::candidate_set::CandidateSet;
use crate::grid::Grid;
use crate::grid_shape::GridShape;
use crate::handlers::ConstraintHandler;
use crate::solver::candidate_selector::CandidateSelector;
use crate::solver::debug::{DebugOptions, SolverProgress};

/// Public solver wrapper.
///
/// Owns the [`InternalSolver`] (search engine) and iteration management
/// state (`resume_counters`). This mirrors the JS `SudokuSolver` /
/// `InternalSolver` split: `InternalSolver` handles the core search,
/// while `Solver` adds `nth_solution` navigation.
///
/// Constructed via [`SudokuBuilder::build`](crate::constraint::builder::SudokuBuilder::build).
pub struct Solver {
    inner: InternalSolver,
    /// Cumulative counters across resumed `nth_solution` calls.
    resume_counters: Option<SolverCounters>,
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
        Ok(Self {
            inner,
            resume_counters: None,
        })
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

        // Recover cumulative counters from previous calls, if any.
        let mut counters = self.resume_counters.take().unwrap_or_default();

        let target = n + 1; // we need `target` total solutions

        // Reset if going backwards (already found too many) or if no
        // resume state exists (first call, or search previously exhausted).
        // This mirrors the JS: `if (n <= iter.count) { this._reset(); }`
        if counters.solutions >= target || self.inner.resume_state.is_none() {
            counters = SolverCounters::default();
            self.inner.resume_state = None;
        }

        // run_impl will resume if resume_state is set, or init if not.
        // max_solutions = target: stop once we've found enough.
        let mut solution = None;
        self.inner.run_impl(
            &mut counters,
            target,
            0, // no backtrack limit
            progress,
            None,
            &mut |sol| {
                solution = Some(sol.to_vec());
            },
            false,
        );

        // If the search exhausted before reaching the target, there is
        // no nth solution — return None.
        if counters.solutions < target {
            solution = None;
        }

        // Save counters for next call.
        self.resume_counters = Some(counters.clone());

        SolveResult { solution, counters }
    }

    // ── Delegation to InternalSolver ─────────────────────────────────

    pub fn solve(&mut self) -> SolveResult {
        self.inner.solve()
    }

    pub fn solve_with_progress(
        &mut self,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> SolveResult {
        self.inner.solve_with_progress(progress)
    }

    pub fn validate_layout(&mut self) -> SolveResult {
        self.inner.validate_layout()
    }

    pub fn validate_layout_with_progress(
        &mut self,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> SolveResult {
        self.inner.validate_layout_with_progress(progress)
    }

    pub fn count_solutions(&mut self, limit: u64) -> (u64, SolverCounters) {
        self.inner.count_solutions(limit)
    }

    pub fn count_solutions_with_progress(
        &mut self,
        limit: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (u64, SolverCounters) {
        self.inner.count_solutions_with_progress(limit, progress)
    }

    pub fn solve_all_possibilities(
        &mut self,
        threshold: u8,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> AllPossibilitiesResult {
        self.inner.solve_all_possibilities(threshold, progress)
    }

    pub fn estimated_count_solutions(
        &mut self,
        max_samples: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (f64, u64, SolverCounters) {
        self.inner.estimated_count_solutions(max_samples, progress)
    }

    pub fn nth_step(
        &mut self,
        n: u64,
        step_guides: HashMap<u64, StepGuide>,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> Option<StepResult> {
        self.inner.nth_step(n, step_guides, progress)
    }

    pub fn get_sample_solution(&self) -> Option<&[CandidateSet]> {
        self.inner.get_sample_solution()
    }

    pub fn unset_sample_solution(&mut self) {
        self.inner.unset_sample_solution()
    }

    pub fn get_stack_trace(&self) -> Option<(Vec<crate::api::types::CellIndex>, Vec<u8>)> {
        self.inner.get_stack_trace()
    }

    pub fn set_candidate_selector(&mut self, selector: CandidateSelector) {
        self.inner.set_candidate_selector(selector)
    }

    pub fn is_done(&self) -> bool {
        self.inner.is_done()
    }

    pub fn is_at_start(&self) -> bool {
        self.inner.is_at_start()
    }

    pub fn reset(&mut self) {
        self.inner.reset()
    }

    pub fn reset_run(&mut self) {
        self.inner.reset_run()
    }

    pub fn set_progress_frequency(&mut self, log_freq: u32) {
        self.inner.set_progress_frequency(log_freq)
    }

    pub fn set_debug_options(&mut self, opts: DebugOptions) {
        self.inner.set_debug_options(opts)
    }
}
