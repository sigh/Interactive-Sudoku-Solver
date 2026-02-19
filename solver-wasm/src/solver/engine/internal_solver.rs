//! Internal search engine.
//!
//! Contains `InternalSolver` — the core iterative backtracking solver
//! with constraint propagation, conflict-score-based cell selection,
//! and singleton priority processing.

use std::collections::HashMap;

use super::recursion_stack::RecursionStack;
use super::seen_candidate_set::SeenCandidateSet;
use super::{
    enforce_constraints_on, AllPossibilitiesResult, SolveResult, SolverCounters, StepGuide,
    StepResult, StepType,
};
use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid::Grid;
use crate::grid_shape::GridShape;
use crate::handlers::{ConstraintHandler, UniqueValueExclusion};
use crate::solver::candidate_selector::CandidateSelector;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::debug::{self, DebugLog, DebugOptions, SolverProgress, StackTrace};
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::solver::handler_set::HandlerSet;
use crate::solver::optimizer::Optimizer;

/// Saved search state for resumable solving (used by `nth_solution`).
pub(super) struct ResumeState {
    pub(super) rec_depth: usize,
    pub(super) iteration_counter: u64,
}

/// Mutable state tracked across step yields within a single run_impl call.
struct StepState {
    /// User-provided step guides (step_number → guide).
    step_guides: HashMap<u64, StepGuide>,
    /// Current step number (1-indexed, incremented after each yield).
    step: u64,
    /// Target step number — run_impl stops when step reaches this.
    target: u64,
    /// Grid snapshot before the current guess.
    old_grid: Vec<CandidateSet>,
    /// Cell depth of the pending guess (-1 = none).
    pending_guess_depth: i32,
    /// Value of the pending guess.
    pending_guess_value: CandidateSet,
    /// The step result, set when a yield point is reached.
    result: Option<StepResult>,
}

impl StepState {
    fn new(num_cells: usize) -> Self {
        StepState {
            step_guides: HashMap::new(),
            step: 1,
            target: 0,
            old_grid: vec![CandidateSet::EMPTY; num_cells],
            pending_guess_depth: -1,
            pending_guess_value: CandidateSet::EMPTY,
            result: None,
        }
    }
}

/// The inner search engine.
///
/// Mirrors JS `InternalSolver` from engine.js. Uses iterative
/// backtracking with constraint propagation, conflict-score-based
/// cell selection, and singleton priority processing.
///
/// Constructed via [`Solver::from_handlers`], not directly.
/// The outer [`Solver`] wraps this and owns iteration management.
pub(crate) struct InternalSolver {
    /// Grid shape (dimensions and value count).
    pub(super) shape: GridShape,

    /// The handler accumulator (owns all handlers + propagation queue).
    pub(super) accumulator: HandlerAccumulator,

    /// Candidate selector for cell/value ordering.
    pub(super) candidate_selector: CandidateSelector,

    /// Pre-allocated recursion stack.
    pub(super) rec_stack: RecursionStack,

    /// Initial grid state (after handler initialization + initial propagation).
    pub(super) initial_grid: Vec<CandidateSet>,

    /// Whether the initial grid was found to be contradictory.
    pub(super) initial_contradiction: bool,

    /// Bitmask for progress callback frequency (2^logFreq - 1).
    /// Callback fires when `iteration_counter & mask == 0`.
    progress_frequency_mask: u64,

    /// Saved search state for resumable solving. Set when `run_impl`
    /// exits early (max_solutions reached); cleared on fresh `run()` calls
    /// or when the search space is exhausted.
    pub(super) resume_state: Option<ResumeState>,

    /// Step state for step-by-step solving.
    step_state: StepState,

    /// Debug options controlling what debug data to export.
    debug_options: DebugOptions,

    /// Accumulated debug log entries, drained on each progress tick.
    debug_logs: Vec<DebugLog>,

    /// Handler init failures recorded during construction.
    /// Stored as (handler_name, cells) pairs for deferred logging.
    init_failures: Vec<(String, Vec<CellIndex>)>,

    /// Debug logs from the optimizer, stored for deferred emission.
    optimizer_debug_logs: Vec<DebugLog>,

    /// Persistent SeenCandidateSet for solve_all_possibilities. Preserves
    /// allocation across calls, matching JS `InternalSolver._seenCandidateSet`.
    seen_candidate_set: SeenCandidateSet,

    /// First solution captured during counting. Matches JS `_sampleSolution`.
    /// Non-empty when a solution has been captured; empty otherwise.
    sample_solution: Vec<CandidateSet>,

    /// Current recursion depth during search. Matches JS `_currentRecFrame`.
    /// `None` when not inside a `run_impl` call.
    current_rec_depth: Option<usize>,

    /// Whether the search is complete (all solutions found or max reached).
    /// Matches JS `this.done`.
    pub(super) done: bool,

    /// Whether the solver is in its initial state (before first `run`).
    /// Matches JS `this._atStart`.
    pub(super) at_start: bool,
}

impl InternalSolver {
    /// Build from a complete handler list (caller provides houses).
    ///
    /// Mirrors JS `SudokuSolver._setUpHandlers` + `new InternalSolver`.
    /// Sorts handlers, runs the constraint optimizer, adds singleton
    /// handlers, initialises everything, and builds cell maps.
    pub(crate) fn new(
        grid: Grid,
        mut handlers: Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
    ) -> Result<Self, String> {
        let num_cells = shape.num_cells;
        let num_values = shape.num_values as usize;

        // Step 1: Sort handlers BEFORE optimizer (matching JS behavior).
        // JS sorts by (cells.length, constructor.name, cells.join(',')) before
        // the optimizer runs. The optimizer only appends new handlers at the end.
        handlers.sort_by(|a, b| {
            let len_cmp = a.cells().len().cmp(&b.cells().len());
            if len_cmp != std::cmp::Ordering::Equal {
                return len_cmp;
            }
            let name_cmp = a.name().cmp(b.name());
            if name_cmp != std::cmp::Ordering::Equal {
                return name_cmp;
            }
            // Tertiary: cells (numeric lexicographic).
            a.cells().cmp(b.cells())
        });

        // Step 2: Create HandlerSet from sorted handlers.
        let mut handler_set = HandlerSet::new(handlers, shape);

        // Step 3: Build cell exclusions from all handlers' exclusion_cells.
        let mut cell_exclusions = CellExclusions::with_num_cells(num_cells);
        for handler in handler_set.iter() {
            let excl = handler.exclusion_cells();
            for i in 0..excl.len() {
                for j in (i + 1)..excl.len() {
                    cell_exclusions.add_mutual_exclusion(excl[i], excl[j]);
                }
            }
        }

        // Step 4: Run the optimizer (mutates handler_set in place).
        let optimizer_debug_logs =
            Optimizer::optimize(&mut handler_set, &mut cell_exclusions, shape);

        // Step 5: Add UniqueValueExclusion singleton handlers.
        for i in 0..num_cells {
            handler_set.add_singleton_handler(Box::new(UniqueValueExclusion::new(i as CellIndex)));
        }

        // Step 6: Initialize all handlers.
        let mut state_allocator = GridStateAllocator::new(num_cells);
        let (initial_grid, grid_state_size, initial_contradiction, init_failures) =
            handler_set.initialize_handlers(&grid, &cell_exclusions, &mut state_allocator);

        // Step 7: Build cell priorities and collect candidate finders
        // (must happen before consuming handler_set).
        let cell_priorities = handler_set.build_cell_priorities();
        let finder_descriptions = handler_set.collect_candidate_finders();

        // Step 8: Consume handler_set into accumulator parts.
        let (all_handlers, singleton_map, ordinary_map, aux_map, essential_flags) =
            handler_set.into_accumulator_parts();

        let accumulator = HandlerAccumulator::new(
            all_handlers,
            singleton_map,
            ordinary_map,
            aux_map,
            essential_flags,
            cell_exclusions,
        );

        let candidate_selector =
            CandidateSelector::new(&cell_priorities, num_values, finder_descriptions);
        let rec_stack = RecursionStack::new(num_cells, grid_state_size);

        let mut solver = InternalSolver {
            shape,
            accumulator,
            candidate_selector,
            rec_stack,
            initial_grid,
            initial_contradiction,
            progress_frequency_mask: (1u64 << 13) - 1, // default: every 8192 iterations
            resume_state: None,
            step_state: StepState::new(num_cells),
            debug_options: DebugOptions::default(),
            debug_logs: Vec::new(),
            init_failures,
            optimizer_debug_logs,
            seen_candidate_set: SeenCandidateSet::new(1, num_cells, num_values),
            sample_solution: Vec::new(),
            current_rec_depth: None,
            done: false,
            at_start: true,
        };

        // Generate setup debug logs unconditionally (matches JS which
        // always logs handler lists during _setUpHandlers).
        solver.generate_setup_logs();

        Ok(solver)
    }

    /// Solve and return the first solution found (if any).
    pub fn solve(&mut self) -> SolveResult {
        self.solve_with_progress(&mut |_| {})
    }

    /// Solve with a progress callback.
    ///
    /// The callback receives `&SolverProgress` periodically during search.
    /// The frequency is controlled by `set_progress_frequency`.
    pub fn solve_with_progress(
        &mut self,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> SolveResult {
        let mut counters = SolverCounters::default();

        if self.initial_contradiction {
            return SolveResult {
                solution: None,
                counters,
            };
        }

        let mut solution = None;
        self.run(&mut counters, 1, 0, progress, None, &mut |sol| {
            solution = Some(sol.to_vec());
        });

        SolveResult { solution, counters }
    }

    /// Validate the layout by attempting to find any solution.
    ///
    /// Returns the first solution found, or `None` if the layout is invalid
    /// (no solutions exist). Mirrors JS `InternalSolver.validateLayout()`.
    pub fn validate_layout(&mut self) -> SolveResult {
        self.validate_layout_with_progress(&mut |_| {})
    }

    /// Validate the layout with a progress callback.
    ///
    /// Uses a house-filling warmup heuristic: try a bounded search
    /// (200 backtracks) with each house pre-filled, then do a full
    /// search with the most promising house. This matches the JS
    /// `InternalSolver._validateLayout()`.
    pub fn validate_layout_with_progress(
        &mut self,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> SolveResult {
        // Always mark done after validate_layout, matching JS finalize().
        self.done = true;

        if self.initial_contradiction {
            return SolveResult {
                solution: None,
                counters: SolverCounters::default(),
            };
        }

        let original_initial_grid = self.initial_grid.clone();

        // Collect house handler cells (Vec<Vec<CellIndex>>).
        let house_cells: Vec<Vec<CellIndex>> = self
            .accumulator
            .handlers()
            .iter()
            .filter(|h| h.name() == "House")
            .map(|h| h.cells().to_vec())
            .collect();

        // Non-standard grids may not have any house handlers. In that case,
        // validate by finding any solution under the full constraint set.
        if house_cells.is_empty() {
            let result = self.solve_with_progress(progress);
            self.initial_grid = original_initial_grid;
            return result;
        }

        const SEARCH_LIMIT: u64 = 200;

        // Function to fill a house with all distinct single-candidate values.
        let fill_house = |initial_grid: &mut Vec<CandidateSet>,
                          cells: &[CellIndex],
                          original: &[CandidateSet]| {
            initial_grid.copy_from_slice(original);
            for (i, &c) in cells.iter().enumerate() {
                initial_grid[c as usize] = CandidateSet::from_value((i + 1) as u8);
            }
        };

        // Try a short search from every house.
        let mut attempt_log: Vec<(usize, f64)> = Vec::new(); // (house_index, progress_ratio)

        for (house_idx, cells) in house_cells.iter().enumerate() {
            // _resetRun: reset candidate selector (preserving conflict scores).
            self.candidate_selector.reset();
            fill_house(&mut self.initial_grid, cells, &original_initial_grid);
            self.candidate_selector.conflict_scores_mut().decay();

            let mut counters = SolverCounters::default();
            let mut solution = None;
            self.run(&mut counters, 1, SEARCH_LIMIT, progress, None, &mut |sol| {
                solution = Some(sol.to_vec());
            });

            if let Some(sol) = solution {
                // Found a solution — finalize.
                counters.branches_ignored = 1.0 - counters.progress_ratio;
                self.initial_grid = original_initial_grid;
                return SolveResult {
                    solution: Some(sol),
                    counters,
                };
            }

            if counters.backtracks < SEARCH_LIMIT {
                // Search exhausted before limit — no solutions exist.
                counters.branches_ignored = 1.0 - counters.progress_ratio;
                self.initial_grid = original_initial_grid;
                return SolveResult {
                    solution: None,
                    counters,
                };
            }

            // Hit the limit — record progress for ranking.
            attempt_log.push((house_idx, counters.progress_ratio));
        }

        // None completed. Pick the house with the best progress_ratio
        // and do a full search.
        attempt_log.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let best_house_idx = attempt_log[0].0;

        self.candidate_selector.reset();
        fill_house(
            &mut self.initial_grid,
            &house_cells[best_house_idx],
            &original_initial_grid,
        );

        let mut counters = SolverCounters::default();
        let mut solution = None;
        self.run(&mut counters, 1, 0, progress, None, &mut |sol| {
            solution = Some(sol.to_vec());
        });

        counters.branches_ignored = 1.0 - counters.progress_ratio;
        self.initial_grid = original_initial_grid;
        SolveResult { solution, counters }
    }

    /// Count solutions up to a given limit (0 = unlimited).
    pub fn count_solutions(&mut self, limit: u64) -> (u64, SolverCounters) {
        self.count_solutions_with_progress(limit, &mut |_| {})
    }

    /// Count solutions with a progress callback.
    pub fn count_solutions_with_progress(
        &mut self,
        limit: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (u64, SolverCounters) {
        let mut counters = SolverCounters::default();

        if self.initial_contradiction {
            return (0, counters);
        }

        self.run(&mut counters, limit, 0, progress, None, &mut |_| {});
        (counters.solutions, counters)
    }

    /// Solve all possibilities: find every solution and track per-cell
    /// per-value candidate counts.
    ///
    /// Mirrors JS `InternalSolver.solveAllPossibilities()`.
    ///
    /// `threshold`: candidate support threshold (1–255). A candidate is
    /// marked as "seen" when it appears in at least `threshold` solutions.
    /// Once all candidates in a branch are seen, the branch is pruned.
    ///
    /// The `progress` callback receives `&SolverProgress` periodically.
    pub fn solve_all_possibilities(
        &mut self,
        threshold: u8,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> AllPossibilitiesResult {
        let num_cells = self.shape.num_cells;
        let num_values = self.shape.num_values as usize;
        let mut counters = SolverCounters::default();

        if self.initial_contradiction {
            return AllPossibilitiesResult {
                candidate_counts: vec![0u8; num_cells * num_values],
                solutions: Vec::new(),
                counters,
            };
        }

        self.seen_candidate_set.reset_with_threshold(threshold);
        let mut solutions = Vec::new();

        // Temporarily take the SeenCandidateSet out of self to avoid
        // double-borrow issues (run needs &mut self + &mut seen).
        let mut seen =
            std::mem::replace(&mut self.seen_candidate_set, SeenCandidateSet::new(1, 0, 0));

        self.run(
            &mut counters,
            0, // no limit
            0, // no backtrack limit
            progress,
            Some(&mut seen),
            &mut |sol| {
                solutions.push(sol.to_vec());
            },
        );

        let candidate_counts = seen.candidate_counts().to_vec();
        // Put the SeenCandidateSet back.
        self.seen_candidate_set = seen;

        AllPossibilitiesResult {
            candidate_counts,
            solutions,
            counters,
        }
    }

    /// Estimate the number of solutions using Knuth's random-walk method.
    ///
    /// Uses Monte Carlo sampling: each sample takes a single random path
    /// through the search tree, weighting by branching factors. The
    /// estimate converges to the true count as samples increase.
    ///
    /// Mirrors JS `InternalSolver.estimatedCountSolutions()`.
    ///
    /// `max_samples`: stop after this many samples (0 = unlimited).
    /// `progress`: callback receiving `&SolverProgress` periodically,
    ///   with `solutions` set to the running estimate and `extra_samples`
    ///   to the number of completed samples.
    ///
    /// Returns `(estimate, sample_count, counters)`.
    pub fn estimated_count_solutions(
        &mut self,
        max_samples: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (f64, u64, SolverCounters) {
        let mut total_estimate = 0.0f64;
        let mut num_samples = 0u64;
        let mut counters = SolverCounters::default();

        if self.initial_contradiction {
            return (0.0, 0, counters);
        }

        // Enable sampling mode on the candidate selector.
        self.candidate_selector.enable_sampling();

        loop {
            let mut found_solution = false;
            // Use run() which clears resume state and resets selector.
            self.run(
                &mut counters,
                1, // max 1 solution per sample
                0, // no backtrack limit
                &mut |_| {},
                None,
                &mut |_sol| {
                    found_solution = true;
                },
            );

            if found_solution {
                total_estimate += self.candidate_selector.solution_weight();
            }

            num_samples += 1;
            let estimate = total_estimate / num_samples as f64;

            // Report progress with estimate data in `extra`, matching JS
            // `_progressExtraStateFn` which sets `extra.estimate`.
            let mut progress_counters = counters.clone();
            progress_counters.solutions = num_samples;
            let mut solver_progress = SolverProgress::counters_only(progress_counters);
            solver_progress.extra = Some(debug::ProgressExtra {
                estimate: Some(debug::EstimateProgress {
                    solutions: estimate,
                    samples: num_samples,
                }),
            });
            progress(&solver_progress);

            if max_samples > 0 && num_samples >= max_samples {
                break;
            }
        }

        // Disable sampling mode.
        self.candidate_selector.disable_sampling();

        let estimate = if num_samples > 0 {
            total_estimate / num_samples as f64
        } else {
            0.0
        };
        (estimate, num_samples, counters)
    }

    /// Find the nth step (0-indexed).
    ///
    /// Mirrors the JS `SudokuSolver.nthStep(n, stepGuides)` pattern.
    ///
    /// Always replays the search from scratch. Because the search is
    /// deterministic, this always produces the same step for the same
    /// index, regardless of navigation history. This avoids the
    /// fragility of trying to save and resume mid-loop state.
    ///
    /// Returns `Some(StepResult)` if step `n` exists, `None` if the
    /// search is exhausted before reaching that step.
    pub fn nth_step(
        &mut self,
        n: u64,
        step_guides: HashMap<u64, StepGuide>,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> Option<StepResult> {
        if self.initial_contradiction {
            return None;
        }

        // Always start fresh — this is the key correctness guarantee.
        // The search is deterministic, so replaying from the start
        // always produces identical steps.
        self.resume_state = None;

        // Full reset: cell order AND conflict scores. Without this,
        // accumulated conflict scores from previous runs would change
        // the cell selection order, making the search non-deterministic
        // across calls.
        self.candidate_selector.full_reset();

        // Set up step state for this run.
        self.step_state = StepState::new(self.shape.num_cells);
        self.step_state.step_guides = step_guides;
        self.step_state.target = n + 1; // 1-indexed target

        // Log the step marker (matching JS nthStep).
        if self.debug_options.log_level >= 1 {
            self.debug_logs.push(DebugLog {
                loc: "nthStep".to_string(),
                msg: format!("Step {}", n),
                args: None,
                important: true,
                cells: Vec::new(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }

        let mut counters = SolverCounters::default();
        self.run_impl(&mut counters, 0, 0, progress, None, &mut |_| {}, true);

        self.step_state.result.take()
    }

    /// Return the captured sample solution, if any.
    /// Matches JS `getSampleSolution()`.
    pub fn get_sample_solution(&self) -> Option<&[CandidateSet]> {
        if self.sample_solution.is_empty() {
            None
        } else {
            Some(&self.sample_solution)
        }
    }

    /// Clear the captured sample solution.
    /// Matches JS `unsetSampleSolution()`.
    pub fn unset_sample_solution(&mut self) {
        self.sample_solution.clear();
    }

    /// Return a stack trace of the current search state.
    /// Matches JS `getStackTrace()`.
    ///
    /// Returns `None` if not currently inside a search, or if the search
    /// is done / at start. Otherwise returns (cells, values) where `cells`
    /// are the cell indices in selection order and `values` are the assigned
    /// values (1-indexed) at each depth.
    pub fn get_stack_trace(&self) -> Option<(Vec<CellIndex>, Vec<u8>)> {
        if self.at_start || self.done {
            return None;
        }
        let rec_depth = self.current_rec_depth?;
        let cell_depth = self.rec_stack.frame(rec_depth).cell_depth;
        if cell_depth == 0 {
            return None;
        }

        let cells: Vec<CellIndex> = (0..cell_depth)
            .map(|i| self.candidate_selector.get_cell_at_depth(i))
            .collect();

        let grid = &self.rec_stack.frame(rec_depth).grid;
        let values: Vec<u8> = cells.iter().map(|&c| grid[c as usize].value()).collect();

        Some((cells, values))
    }

    /// Replace the candidate selector. Matches JS `_setCandidateSelector()`.
    pub fn set_candidate_selector(&mut self, selector: CandidateSelector) {
        self.candidate_selector = selector;
    }

    /// Whether the search is complete. Matches JS `this.done`.
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Whether the solver is in its initial state. Matches JS `this._atStart`.
    pub fn is_at_start(&self) -> bool {
        self.at_start
    }

    /// Full reset: reinitialize everything for a fresh search.
    /// Matches JS `InternalSolver.reset()`.
    ///
    /// Resets counters, conflict scores (from cell priorities),
    /// seenCandidateSet, sampleSolution, and calls `reset_run()`.
    pub fn reset(&mut self) {
        self.current_rec_depth = None;

        // Reinitialize conflict scores from cell priorities.
        self.candidate_selector.full_reset();

        // Reset seenCandidateSet.
        self.seen_candidate_set.reset();

        // Clear sample solution.
        self.sample_solution.clear();

        self.reset_run();
    }

    /// Partial reset: prepare for a new run while preserving conflict scores.
    /// Matches JS `InternalSolver._resetRun()`.
    ///
    /// Resets candidate selector cell order (not conflict scores),
    /// sets done=false, at_start=true.
    pub fn reset_run(&mut self) {
        // Preserve conflict scores — just reset cell order.
        self.candidate_selector.reset();
        self.done = false;
        self.at_start = true;
    }

    /// Set the log2 progress frequency. The progress callback is called
    /// every `2^log_freq` iterations. Default is 13 (every 8192 iterations),
    /// matching the JS solver.
    pub fn set_progress_frequency(&mut self, log_freq: u32) {
        self.progress_frequency_mask = if log_freq > 0 {
            (1u64 << log_freq) - 1
        } else {
            u64::MAX // disabled
        };
    }

    /// Set debug options controlling what debug data to export.
    pub fn set_debug_options(&mut self, opts: DebugOptions) {
        self.debug_options = opts;
    }

    /// Generate handler setup debug logs.
    ///
    /// Called unconditionally at the end of construction. Populates
    /// `self.debug_logs` with handler list, init failures, and cell
    /// priorities, mirroring the JS `_setUpHandlers` and
    /// `_initCellPriorities` logs. The consumer decides which to emit
    /// based on debug level.
    fn generate_setup_logs(&mut self) {
        // Emit optimizer logs (level 1, matching JS optimizer debug output).
        // These were collected during construction and stored for deferred emission.
        if !self.optimizer_debug_logs.is_empty() {
            self.debug_logs.append(&mut self.optimizer_debug_logs);
        }

        let handlers = self.accumulator.handlers();

        // Log handler list (level 2, matching JS _setUpHandlers).
        for h in handlers.iter() {
            if h.is_singleton() {
                continue; // Skip UniqueValueExclusion singletons.
            }
            self.debug_logs.push(DebugLog {
                loc: "_setUpHandlers".to_string(),
                msg: format!("Handler: {}", h.name()),
                args: None,
                important: false,
                cells: h.cells().to_vec(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }

        // Log handler init failures (level 1, matching JS _setUpHandlers).
        for (name, cells) in &self.init_failures {
            self.debug_logs.push(DebugLog {
                loc: "_setUpHandlers".to_string(),
                msg: format!("{} returned false", name),
                args: None,
                important: false,
                cells: cells.clone(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }

        // Log cell priorities (level 1, matching JS _initCellPriorities).
        let priorities: Vec<f64> = self
            .candidate_selector
            .initial_cell_priorities()
            .iter()
            .map(|&p| p as f64)
            .collect();
        self.debug_logs.push(DebugLog {
            loc: "_initCellPriorities".to_string(),
            msg: "Hover for values".to_string(),
            args: Some(serde_json::json!({
                "min": priorities.iter().cloned().fold(f64::INFINITY, f64::min) as i32,
                "max": priorities.iter().cloned().fold(f64::NEG_INFINITY, f64::max) as i32,
            })),
            important: false,
            cells: Vec::new(),
            candidates: Vec::new(),
            overlay: priorities,
        });
    }

    /// Build a `SolverProgress` from current state, draining pending logs.
    fn build_progress(&mut self, counters: &SolverCounters, rec_depth: usize) -> SolverProgress {
        let conflict_heatmap = if self.debug_options.export_conflict_heatmap {
            Some(self.candidate_selector.conflict_scores().scores.to_vec())
        } else {
            None
        };

        let stack_trace = if self.debug_options.export_stack_trace && rec_depth > 0 {
            // Build stack trace from the current recursion frame.
            let frame = self.rec_stack.frame(rec_depth);
            let cell_depth = frame.cell_depth;
            let cells_slice = self.candidate_selector.get_cell_order(cell_depth);
            let cells: Vec<u16> = cells_slice.iter().map(|&c| c as u16).collect();
            let values: Vec<u16> = cells_slice
                .iter()
                .map(|&c| {
                    let v = frame.grid[c as usize];
                    // Convert single-bit mask to 1-indexed value.
                    if !v.is_empty() && v.is_single() {
                        v.value() as u16
                    } else {
                        0
                    }
                })
                .collect();
            Some(StackTrace { cells, values })
        } else {
            None
        };

        let logs = std::mem::take(&mut self.debug_logs);

        SolverProgress {
            counters: counters.clone(),
            conflict_heatmap,
            stack_trace,
            logs,
            extra: None,
        }
    }

    /// Core backtracking solver — always starts fresh.
    ///
    /// Clears any saved resume state before and after, and delegates to
    /// `run_impl`. Used by `solve_with_progress`,
    /// `count_solutions_with_progress`, and `solve_all_possibilities`.
    fn run(
        &mut self,
        counters: &mut SolverCounters,
        max_solutions: u64,
        max_backtracks: u64,
        progress: &mut dyn FnMut(&SolverProgress),
        seen: Option<&mut SeenCandidateSet>,
        on_solution: &mut dyn FnMut(&[CandidateSet]),
    ) {
        self.resume_state = None;
        self.run_impl(
            counters,
            max_solutions,
            max_backtracks,
            progress,
            seen,
            on_solution,
            false,
        );
        // Discard any state saved by run_impl — callers of run()
        // do not use resume, so don't leak it into nth_solution.
        self.resume_state = None;
    }

    /// Core iterative backtracking solver (resumable).
    ///
    /// Mirrors JS `InternalSolver.run()`. Calls `on_solution` for each
    /// solution found; the caller decides whether to collect or count them.
    ///
    /// If `self.resume_state` is `Some`, the search resumes from the saved
    /// position. Otherwise a fresh search is initialised.
    ///
    /// `max_solutions`: stop after finding this many solutions (0 = unlimited).
    /// `max_backtracks`: stop after this many backtracks (0 = unlimited).
    ///   Used by `validate_layout` to do bounded searches.
    /// `seen`: optional SeenCandidateSet for all-possibilities mode pruning.
    /// `step_mode`: when `true`, the solver operates in step mode using
    ///   `self.step_state`. It yields at guess, contradiction, and solution
    ///   points by returning early. The step result is stored in
    ///   `self.step_state.result`. Step mode never saves resume state;
    ///   `nth_step` always replays from scratch for correctness.
    pub(super) fn run_impl(
        &mut self,
        counters: &mut SolverCounters,
        max_solutions: u64,
        max_backtracks: u64,
        progress: &mut dyn FnMut(&SolverProgress),
        mut seen: Option<&mut SeenCandidateSet>,
        on_solution: &mut dyn FnMut(&[CandidateSet]),
        step_mode: bool,
    ) {
        let progress_mask = self.progress_frequency_mask;
        let num_cells = self.shape.num_cells;

        let mut rec_depth: usize;
        let mut iteration_counter: u64;

        if let Some(saved) = self.resume_state.take() {
            // ── Resume from saved state (nth_solution only) ──────────
            rec_depth = saved.rec_depth;
            iteration_counter = saved.iteration_counter;
        } else {
            // ── Fresh initialisation ──────────────────────────────────
            iteration_counter = 0;

            // Mark solver as no longer at start (matches JS `this._atStart = false`).
            self.at_start = false;

            // Accumulate progress from previous runs (matches JS
            // `counters.progressRatioPrev += counters.progressRatio`).
            counters.progress_ratio_prev += counters.progress_ratio;
            counters.progress_ratio = 0.0;

            // Reset candidate selector.
            self.candidate_selector.reset();

            // Set up initial recursion frame.
            rec_depth = 0;
            {
                let frame = self.rec_stack.frame_mut(rec_depth);
                frame.grid.copy_from_slice(&self.initial_grid);
                frame.cell_depth = 0;
                frame.last_contradiction_cell = -1;
                frame.progress_remaining = 1.0;
                frame.new_node = true;

                // Initial constraint propagation: enqueue all cells.
                self.accumulator.reset(false);
                for i in 0..num_cells {
                    self.accumulator.add_for_cell(i as CellIndex);
                }

                if !enforce_constraints_on(&mut frame.grid, &mut self.accumulator, counters) {
                    // Initial grid is contradictory — ensure a zero in the
                    // cell range so the initial iteration will fail.
                    // Only fill cells 0..num_cells (not handler state beyond).
                    if !frame.grid[..num_cells].contains(&CandidateSet::EMPTY) {
                        frame.grid[..num_cells].fill(CandidateSet::EMPTY);
                    }
                }
            }

            // In step mode, capture the initial old_grid.
            if step_mode {
                self.step_state.old_grid = self.rec_stack.frame(rec_depth).grid.clone();
                self.step_state.pending_guess_depth = -1;
                self.step_state.pending_guess_value = CandidateSet::EMPTY;
            }

            counters.nodes_searched += 1;
            rec_depth += 1;
        }

        if self.debug_options.log_level >= 2 {
            self.debug_logs.push(DebugLog {
                loc: "run".to_string(),
                msg: "Start run-loop".to_string(),
                args: None,
                important: false,
                cells: Vec::new(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }

        while rec_depth > 0 {
            rec_depth -= 1;

            // Track current recursion depth (matches JS `_currentRecFrame`).
            self.current_rec_depth = Some(rec_depth);

            // Read frame data.
            let cell_depth: usize;
            let last_contradiction_cell: i16;
            let is_new_node: bool;
            {
                let frame = self.rec_stack.frame(rec_depth);
                cell_depth = frame.cell_depth;
                last_contradiction_cell = frame.last_contradiction_cell;
                is_new_node = frame.new_node;
            }

            // Select next candidate with optional step guide override.
            let step_guide = if step_mode {
                self.step_state
                    .step_guides
                    .get(&self.step_state.step)
                    .cloned()
            } else {
                None
            };

            let selection = {
                let grid = &self.rec_stack.frame(rec_depth).grid;
                self.candidate_selector.select_next_candidate(
                    cell_depth,
                    grid,
                    is_new_node,
                    step_guide.as_ref(),
                )
            };

            // Mark this node as visited.
            self.rec_stack.frame_mut(rec_depth).new_node = false;

            let next_depth = selection.next_depth;
            let value = selection.value;
            let count = selection.count;

            if count == 0 {
                continue;
            }

            // Progress tracking.
            let progress_remaining = self.rec_stack.frame(rec_depth).progress_remaining;
            let progress_delta = progress_remaining / count as f64;
            self.rec_stack.frame_mut(rec_depth).progress_remaining -= progress_delta;

            // ── GUESS YIELD POINT ────────────────────────────────────
            if step_mode && count > 1 && is_new_node {
                if self.step_state.step >= self.step_state.target {
                    let grid = self.rec_stack.frame(rec_depth).grid.clone();
                    let branch_depth = cell_depth + 1;
                    let branch_cells: Vec<CellIndex> = (0..branch_depth)
                        .map(|i| self.candidate_selector.get_cell_at_depth(i))
                        .collect();

                    self.step_state.result = Some(StepResult {
                        grid,
                        old_grid: self.step_state.old_grid.clone(),
                        step_type: StepType::Guess,
                        guess_depth: cell_depth as i32,
                        branch_cells,
                    });
                    return;
                }
                self.step_state.step += 1;
            }
            // ─────────────────────────────────────────────────────────

            // In step mode, track old_grid and pending guess for
            // contradiction/solution display.
            if step_mode && (!is_new_node || count != 1) {
                self.step_state.old_grid = self.rec_stack.frame(rec_depth).grid.clone();
                self.step_state.pending_guess_depth = cell_depth as i32;
                self.step_state.pending_guess_value = value;
            }

            // Count values tried (all singletons up to the guess cell).
            counters.values_tried += (next_depth - cell_depth) as u64;

            // Set up constraint propagation.
            self.accumulator.reset(next_depth == num_cells);
            for i in cell_depth..next_depth {
                self.accumulator
                    .add_for_fixed_cell(self.candidate_selector.get_cell_at_depth(i));
            }

            // Queue constraints for the last contradiction cell.
            if last_contradiction_cell >= 0 {
                self.accumulator
                    .add_for_cell(last_contradiction_cell as CellIndex);
            }

            let cell = self.candidate_selector.get_cell_at_depth(cell_depth);

            if count != 1 {
                // Multiple options: branch.
                // Copy grid to next frame.
                let old_depth = rec_depth;
                rec_depth += 1;
                counters.guesses += 1;

                self.rec_stack.copy_grid(old_depth, rec_depth);

                // Remove the value from our candidates in the old frame.
                self.rec_stack.frame_mut(old_depth).grid[cell as usize] ^= value;
            }

            // Fix the cell to the selected value.
            self.rec_stack.frame_mut(rec_depth).grid[cell as usize] = value;

            // Progress callback (every 2^logFreq iterations).
            iteration_counter += 1;
            if (iteration_counter & progress_mask) == 0 {
                let p = self.build_progress(counters, rec_depth);
                progress(&p);
                iteration_counter &= (1 << 30) - 1;
            }

            // Propagate constraints.
            let has_contradiction = {
                let grid = &mut self.rec_stack.frame_mut(rec_depth).grid;
                !enforce_constraints_on(grid, &mut self.accumulator, counters)
            };

            if has_contradiction {
                // Record contradiction cell for parent frame.
                if rec_depth > 0 {
                    self.rec_stack
                        .frame_mut(rec_depth - 1)
                        .last_contradiction_cell = cell as i16;
                }
                counters.progress_ratio += progress_delta;
                counters.backtracks += 1;
                self.candidate_selector
                    .conflict_scores_mut()
                    .increment(cell, value);

                // ── CONTRADICTION YIELD POINT ────────────────────────
                if step_mode {
                    if self.step_state.step >= self.step_state.target {
                        // Make the pending guess visible in the grid.
                        let guess_depth = self.step_state.pending_guess_depth;
                        if guess_depth >= 0 {
                            let guess_cell = self
                                .candidate_selector
                                .get_cell_at_depth(guess_depth as usize);
                            let guess_value = self.step_state.pending_guess_value;
                            self.rec_stack.frame_mut(rec_depth).grid[guess_cell as usize] =
                                guess_value;
                        }

                        let grid = self.rec_stack.frame(rec_depth).grid.clone();
                        let branch_depth = if guess_depth >= 0 {
                            (guess_depth + 1) as usize
                        } else {
                            0
                        };
                        let branch_cells: Vec<CellIndex> = (0..branch_depth)
                            .map(|i| self.candidate_selector.get_cell_at_depth(i))
                            .collect();

                        self.step_state.result = Some(StepResult {
                            grid,
                            old_grid: self.step_state.old_grid.clone(),
                            step_type: StepType::Contradiction,
                            guess_depth: self.step_state.pending_guess_depth,
                            branch_cells,
                        });
                        return;
                    }
                    self.step_state.step += 1;
                }
                // ─────────────────────────────────────────────────────

                // ── BACKTRACK LIMIT CHECK ────────────────────────────
                if max_backtracks > 0 && counters.backtracks >= max_backtracks {
                    break;
                }
                // ─────────────────────────────────────────────────────

                continue;
            }

            // All-possibilities pruning: skip branches with no unseen candidates.
            if let Some(ref mut s) = seen {
                if s.enabled {
                    let grid = &self.rec_stack.frame(rec_depth).grid;
                    if !s.has_interesting_solutions(grid) {
                        counters.branches_ignored += progress_delta;
                        continue;
                    }
                }
            }

            // Check if we've found a solution.
            if next_depth == num_cells {
                counters.progress_ratio += progress_delta;
                counters.solutions += 1;
                counters.backtracks += 1;

                let solution = &self.rec_stack.frame(rec_depth).grid;

                // Capture first solution as sample (matches JS _sampleSolution).
                if self.sample_solution.is_empty() {
                    self.sample_solution = solution.to_vec();
                }

                // Record in SeenCandidateSet and enable pruning after 2 solutions.
                if let Some(ref mut s) = seen {
                    s.add_solution(solution);
                    if counters.solutions == 2 {
                        s.enabled = true;
                    }
                }

                on_solution(solution);

                // ── SOLUTION YIELD POINT ─────────────────────────────
                if step_mode {
                    if self.step_state.step >= self.step_state.target {
                        let guess_depth = self.step_state.pending_guess_depth;
                        let branch_depth = if guess_depth >= 0 {
                            (guess_depth + 1) as usize
                        } else {
                            0
                        };
                        let branch_cells: Vec<CellIndex> = (0..branch_depth)
                            .map(|i| self.candidate_selector.get_cell_at_depth(i))
                            .collect();

                        self.step_state.result = Some(StepResult {
                            grid: solution.clone(),
                            old_grid: self.step_state.old_grid.clone(),
                            step_type: StepType::Solution,
                            guess_depth,
                            branch_cells,
                        });
                        return;
                    }
                    self.step_state.step += 1;
                }
                // ─────────────────────────────────────────────────────

                if max_solutions > 0 && counters.solutions >= max_solutions {
                    // Save state so the search can be resumed later
                    // (used by nth_solution).
                    self.resume_state = Some(ResumeState {
                        rec_depth,
                        iteration_counter,
                    });
                    return;
                }
                continue;
            }

            // Recurse: set up the next frame.
            counters.nodes_searched += 1;
            let frame = self.rec_stack.frame_mut(rec_depth);
            frame.cell_depth = next_depth;
            frame.new_node = true;
            frame.progress_remaining = progress_delta;
            frame.last_contradiction_cell = -1;
            rec_depth += 1;
        }

        // Search space exhausted — clear resume state and current rec depth.
        self.resume_state = None;
        self.current_rec_depth = None;
        self.done = true;

        if self.debug_options.log_level >= 2 {
            self.debug_logs.push(DebugLog {
                loc: "run".to_string(),
                msg: "Done".to_string(),
                args: None,
                important: false,
                cells: Vec::new(),
                candidates: Vec::new(),
                overlay: Vec::new(),
            });
        }
    }
}
