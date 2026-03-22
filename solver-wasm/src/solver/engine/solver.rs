//! Outer Solver — owns iteration management (mirrors JS SudokuSolver).

use std::cell::RefCell;
use std::collections::HashMap;

use super::internal_solver::{InternalSolver, RunMode, SolverState};
use super::{
    grid_to_solution, AllPossibilitiesResult, SolveResult, SolverCounters, StepGuide, StepResult,
};
use crate::grid_shape::GridShape;
use crate::handlers::ConstraintHandler;
use crate::solver::debug::{DebugLog, DebugOptions, ProgressExtra, SolverProgress};

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
    /// Build from handlers and grid shape.
    ///
    /// This is the production entry point, called by
    /// [`SudokuBuilder::build`](crate::constraint::builder::SudokuBuilder::build).
    /// The caller provides the complete handler set (including house handlers).
    /// The solver creates its own initial grid internally (all candidates set),
    /// matching JS where `InternalSolver` creates the grid via
    /// `GridStateAllocator` and handlers restrict it during `initialize()`.
    pub fn from_handlers(
        handlers: Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
        num_state_cells: usize,
        debug_options: Option<DebugOptions>,
    ) -> Result<Self, String> {
        let inner = InternalSolver::new(handlers, shape, num_state_cells, debug_options)?;
        Ok(Self { inner })
    }

    /// The grid shape used by this solver.
    pub fn shape(&self) -> GridShape {
        self.inner.shape
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
            let nc = self.inner.shape.num_cells;
            self.inner.run(
                RunMode::MaxSolutions {
                    max_solutions: target,
                },
                progress,
                None,
                &mut |sol| {
                    solution = Some(grid_to_solution(&sol[..nc]));
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
    /// Streams sample solutions via the progress callback's `extra.solutions`
    /// field, matching JS `_runCountFn` → `_progressExtraStateFn` →
    /// `getSampleSolution()` / `unsetSampleSolution()`.
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

        // Shared sample buffer between on_solution and the progress wrapper.
        // Mirrors JS `_sampleSolution`: on_solution captures the first new
        // solution since the last progress tick; the progress wrapper drains
        // and forwards it. RefCell is needed because both closures are passed
        // into run() and share access to the buffer.
        let sample: RefCell<Option<Vec<u8>>> = RefCell::new(None);
        let nc = self.inner.shape.num_cells;

        self.inner.run(
            mode,
            &mut |p| {
                // Drain sample solution and enrich progress, matching JS
                // _progressExtraStateFn → getSampleSolution() + unsetSampleSolution().
                let sol = sample.borrow_mut().take();
                if let Some(values) = sol {
                    let mut enriched = p.clone();
                    let extra = enriched.extra.get_or_insert(ProgressExtra {
                        estimate: None,
                        solutions: None,
                    });
                    extra.solutions = Some(vec![values]);
                    progress(&enriched);
                } else {
                    progress(p);
                }
            },
            None,
            &mut |grid| {
                // Capture first new solution since last drain, matching JS:
                // if (this._sampleSolution[0] === 0) this._sampleSolution.set(grid);
                let mut s = sample.borrow_mut();
                if s.is_none() {
                    *s = Some(grid_to_solution(&grid[..nc]));
                }
            },
        );

        // Final progress with any remaining sample, matching JS
        // _sendProgress() at end of _runCountFn.
        if let Some(values) = sample.into_inner() {
            let mut final_progress = SolverProgress::counters_only(self.inner.counters.clone());
            final_progress.extra = Some(ProgressExtra {
                estimate: None,
                solutions: Some(vec![values]),
            });
            progress(&final_progress);
        }

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
    ///
    /// Sample solutions are streamed via `extra.solutions` in each per-sample
    /// progress tick, matching JS `_runCountFn` behaviour.
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

        // Mirrors JS: this._debugLogger.enableStepLogs = false;
        // Disable verbose step logging for the "replay" phase; set_step_guides
        // will re-enable it for the target step.
        self.inner.debug_options.enable_step_logs = false;

        let target = n + 1; // 1-indexed
        self.inner.set_step_guides(step_guides, target);

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

    /// Set an ad-hoc debug counter (matching JS `debugLogger.setCounter`).
    pub fn set_counter(&mut self, name: String, value: f64) {
        self.inner.set_counter(name, value);
    }

    /// Increment an ad-hoc debug counter (matching JS `debugLogger.incCounter`).
    pub fn inc_counter(&mut self, name: String, value: f64) {
        self.inner.inc_counter(name, value);
    }

    /// Returns true if the solver detected a contradiction during initialization.
    #[cfg(test)]
    pub fn has_initial_contradiction(&self) -> bool {
        self.inner.initial_contradiction
    }

    /// Returns the init_failures list for diagnostic tests.
    #[cfg(test)]
    pub fn init_failures(&self) -> &[(String, Vec<crate::api::types::CellIndex>)] {
        &self.inner.init_failures
    }
}

#[cfg(test)]
mod tests {
    use crate::constraint;
    use crate::constraint::builder::SudokuBuilder;

    /// Diagnostic: Look-and-say must solve correctly and must not fail
    /// during initialization.
    #[test]
    fn test_look_and_say_solver_init() {
        let input = ".ContainExact~6_7~R3C1~R2C1~R1C1\
            .ContainExact~3_4_4~R1C3~R2C3~R2C4~R1C4\
            .ContainExact~1~R1C7~R1C8\
            .ContainExact~9_3~R2C9~R2C8~R3C8~R3C7~R3C6\
            .ContainExact~5_5_5_8~R3C9~R4C9~R5C9~R5C8~R5C7~R6C7~R6C6\
            .ContainExact~1_2~R7C9~R7C8~R8C8~R8C7~R9C7\
            .ContainExact~3_3_1~R7C4~R8C4~R8C3~R8C2~R7C2\
            .ContainExact~6_6~R7C5~R6C5~R6C4~R5C4\
            .ContainExact~1_1_3~R6C2~R6C1~R7C1\
            .ContainExact~8_8~R7C7~R7C6~R8C6~R9C6\
            .ContainExact~4_2_2~R5C5~R4C5~R4C4~R4C3\
            .ContainExact~9_9_9~R5C1~R6C2~R7C3~R8C4~R9C5\
            .ContainExact~6_6~R6C9~R7C8~R8C7~R9C6.";

        let parsed = constraint::parser::parse(input).unwrap();
        let mut solver = SudokuBuilder::build(&parsed, None).unwrap();

        let has_contradiction = solver.has_initial_contradiction();
        let failures = solver.init_failures().to_vec();

        eprintln!("initial_contradiction = {}", has_contradiction);
        for (name, cells) in &failures {
            eprintln!("  init failure: {} cells={:?}", name, cells);
        }

        assert!(
            !has_contradiction,
            "Look-and-say should not have init contradiction. Failures: {:?}",
            failures
        );

        // Should find the unique solution.
        let result = solver.nth_solution(0, &mut |_| {});
        let expected =
            "893456712654217983721839465562741398948623571317985246179362854435178629286594137";
        let got = result
            .solution
            .map(|sol| sol[..81].iter().map(|v| v.to_string()).collect::<String>());
        assert_eq!(
            got.as_deref(),
            Some(expected),
            "Look-and-say wrong solution"
        );
    }
}
