//! Internal search engine.
//!
//! Contains `InternalSolver` — the core iterative backtracking solver
//! with constraint propagation, conflict-score-based cell selection,
//! and singleton priority processing.

use std::collections::HashMap;

use super::recursion_stack::RecursionStack;
use super::seen_candidate_set::SeenCandidateSet;
use super::{
    debug_enforce_constraints, enforce_constraints_on, grid_to_solution, AllPossibilitiesResult,
    SolveResult, SolverCounters, StepGuide, StepResult, StepType,
};
use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::handlers::{ConstraintHandler, UniqueValueExclusion};
use crate::solver::candidate_selector::{CandidateDebugLogger, CandidateSelector};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::debug::{self, DebugLog, DebugOptions, SolverProgress, StackTrace};
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;
use crate::solver::handler_set::HandlerSet;
use crate::solver::optimizer::Optimizer;

/// Search state, mirroring JS `InternalSolver.STATE_*` constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SolverState {
    /// Initial state after construction or `reset_run()`. Ready for a fresh `run()`.
    /// Mirrors JS `STATE_UNSTARTED`.
    Unstarted,
    /// Search is running or was interrupted without a save point.
    /// `run()` is not valid until `reset_run()` is called.
    /// Mirrors JS `STATE_INCOMPLETE`.
    Incomplete,
    /// Search paused at a `MaxSolutions` limit; saved position is valid.
    /// Calling `run()` with `MaxSolutions` will continue from that position.
    /// Mirrors JS `STATE_RESUMABLE`.
    Resumable,
    /// Search space fully exhausted. Call `reset_run()` before running again.
    /// Mirrors JS `STATE_EXHAUSTED`.
    Exhausted,
}

/// Termination mode for [`InternalSolver::run`], mirroring JS `yieldWhen` + `maxSolutions`.
#[derive(Clone, Copy)]
pub(super) enum RunMode {
    /// Run until the search space is exhausted, reporting every solution.
    /// Mirrors JS `run(YIELD_ON_SOLUTION, 0)`.
    Exhaustive,

    /// Stop after `max_solutions` solutions. Saves the search position so
    /// the caller can optionally continue via `resume()` using the returned
    /// `RunToken`. Mirrors JS `run(YIELD_ON_SOLUTION, n)` with iterator reuse.
    MaxSolutions { max_solutions: u64 },

    /// Stop after `max_backtracks` backtracks (≥ 1), or on the first solution —
    /// whichever comes first.
    /// `max_backtracks: 1` gives Knuth sampling: one root-to-backtrack path.
    /// A larger value (e.g. 200) is used for `validate_layout` warmup probes.
    /// Mirrors JS `run(YIELD_EVERY_BACKTRACK)` with break after n backtracks.
    MaxBacktracks { max_backtracks: u64 },

    /// Step-by-step mode: stop at event `target` (1-indexed; guess,
    /// contradiction, and solution are all events) and store the result in
    /// `self.step_state.result`.
    /// Mirrors JS `run(YIELD_ON_STEP)` targeting step n.
    Step { target: u64 },
}

/// Mutable state tracked across step yields within a single run_impl call.
struct StepState {
    /// User-provided step guides (step_number → guide).
    step_guides: HashMap<u64, StepGuide>,
    /// Current step number (1-indexed, incremented after each yield).
    step: u64,
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

    /// Current search state. Mirrors JS `InternalSolver._state`.
    pub(super) state: SolverState,

    /// Saved recursion depth; valid when `state == Resumable`.
    /// Mirrors JS `InternalSolver._recDepth`.
    rec_depth: usize,

    /// Saved iteration counter; valid when `state == Resumable`.
    /// Mirrors JS `InternalSolver._iterationCounter`.
    iteration_counter: u64,

    /// Step state for step-by-step solving.
    step_state: StepState,

    /// Debug options controlling what debug data to export.
    pub(super) debug_options: DebugOptions,

    /// Reusable scratch buffer for `debug_enforce_constraints` grid snapshots.
    /// Mirrors JS `InternalSolver._debugGridBuffer`.
    debug_grid_buffer: Vec<CandidateSet>,

    /// Reusable buffer for stack-trace cell indices in `build_progress`.
    /// Mirrors JS `InternalSolver._debugValueBuffer` reuse pattern.
    stack_trace_cells_buf: Vec<u16>,

    /// Reusable buffer for stack-trace values in `build_progress`.
    stack_trace_values_buf: Vec<u16>,

    /// Accumulated debug log entries, drained on each progress tick.
    pub(super) debug_logs: Vec<DebugLog>,

    /// Handler init failures recorded during construction.
    /// Stored as (handler_name, cells) pairs for deferred logging.
    pub(super) init_failures: Vec<(String, Vec<CellIndex>)>,

    /// Debug logs from the optimizer, stored for deferred emission.
    optimizer_debug_logs: Vec<DebugLog>,

    /// Persistent SeenCandidateSet for solve_all_possibilities. Preserves
    /// allocation across calls, matching JS `InternalSolver._seenCandidateSet`.
    seen_candidate_set: SeenCandidateSet,

    /// Current recursion depth during search. Matches JS `_currentRecFrame`.
    /// `None` when not inside a `run_loop` call.
    current_rec_depth: Option<usize>,

    /// Search counters. Owned by `InternalSolver`, matching JS `this.counters`.
    /// Cleared by `reset()`, preserved by `reset_run()`.
    pub(super) counters: SolverCounters,

    /// Ad-hoc debug counters, matching JS `DebugLogger._adhHocCounters`.
    pub(super) ad_hoc_counters: HashMap<String, f64>,
}

impl InternalSolver {
    /// Build from a complete handler list (caller provides houses).
    ///
    /// Mirrors JS `SudokuSolver._setUpHandlers` + `new InternalSolver`.
    /// Sorts handlers, runs the constraint optimizer, adds singleton
    /// handlers, initialises everything, and builds cell maps.
    pub(crate) fn new(
        mut handlers: Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
        debug_options: Option<DebugOptions>,
    ) -> Result<Self, String> {
        let num_cells = shape.num_cells;
        let num_values = shape.num_values as usize;

        // Create the initial grid with all candidates set.
        // Matches JS where InternalSolver creates the grid via
        // GridStateAllocator and handlers restrict it during initialize().
        let initial_cells = vec![CandidateSet::all(shape.num_values); num_cells];

        // Step 1: Sort handlers BEFORE optimizer (matching JS behavior).
        // JS sorts by (cells.length, constructor.name, cells.join(',')) where
        // cells.join(',') uses string comparison (localeCompare). This differs
        // from numeric comparison when cell indices have different numbers of
        // digits (e.g. "9,1" > "10,1" in JS but 9 < 10 numerically).
        // We match JS by joining cells as comma-separated decimal strings.
        handlers.sort_by(|a, b| {
            let len_cmp = a.cells().len().cmp(&b.cells().len());
            if len_cmp != std::cmp::Ordering::Equal {
                return len_cmp;
            }
            let name_cmp = a.name().cmp(b.name());
            if name_cmp != std::cmp::Ordering::Equal {
                return name_cmp;
            }
            // Tertiary: JS uses cells.join(',') with string (locale) comparison.
            // Build comma-joined decimal strings to match JS sort order exactly.
            let a_key: String = a
                .cells()
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let b_key: String = b
                .cells()
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");
            a_key.cmp(&b_key)
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
        // Pass debug_options so the optimizer can check enableLogs,
        // matching JS: `new SudokuConstraintOptimizer(this._debugLogger)`
        // where the optimizer stores the logger only if enableLogs is true.
        let optimizer_debug_logs =
            Optimizer::optimize(&mut handler_set, &mut cell_exclusions, shape, debug_options.as_ref());

        // Step 5: Add UniqueValueExclusion singleton handlers.
        for i in 0..num_cells {
            handler_set.add_singleton_handler(Box::new(UniqueValueExclusion::new(i as CellIndex)));
        }

        // Step 6: Initialize all handlers.
        let mut state_allocator = GridStateAllocator::new(num_cells);
        let (initial_grid, grid_state_size, initial_contradiction, init_failures) =
            handler_set.initialize_handlers(&initial_cells, &cell_exclusions, &mut state_allocator);

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
            progress_frequency_mask: u64::MAX, // default: disabled (matches JS default of mask=-1)
            state: SolverState::Unstarted,
            rec_depth: 0,
            iteration_counter: 0,
            step_state: StepState::new(num_cells),
            debug_options: debug_options.unwrap_or_default(),
            debug_grid_buffer: vec![CandidateSet::EMPTY; num_cells],
            stack_trace_cells_buf: Vec::new(),
            stack_trace_values_buf: Vec::new(),
            debug_logs: Vec::new(),
            init_failures,
            optimizer_debug_logs,
            seen_candidate_set: SeenCandidateSet::new(1, num_cells, num_values),
            current_rec_depth: None,
            counters: SolverCounters::default(),
            ad_hoc_counters: HashMap::new(),
        };

        // Generate setup debug logs unconditionally (matches JS which
        // always logs handler lists during _setUpHandlers).
        solver.generate_setup_logs();

        Ok(solver)
    }

    /// Validate the layout by attempting to find any solution.
    ///
    /// Uses a house-filling warmup heuristic: try a bounded search
    /// (200 backtracks) with each house pre-filled, then do a full
    /// search with the most promising house. This matches the JS
    /// `InternalSolver._validateLayout()`.
    pub(super) fn validate_layout(
        &mut self,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> SolveResult {
        if self.initial_contradiction {
            self.state = SolverState::Exhausted;
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
            self.reset_run();
            let mut solution = None;
            self.run(
                RunMode::MaxSolutions { max_solutions: 1 },
                progress,
                None,
                &mut |sol| {
                    solution = Some(grid_to_solution(sol));
                },
            );
            self.initial_grid = original_initial_grid;
            self.state = SolverState::Exhausted;
            return SolveResult {
                solution,
                counters: self.counters.clone(),
            };
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
            self.reset_run();
            fill_house(&mut self.initial_grid, cells, &original_initial_grid);
            self.candidate_selector.conflict_scores_mut().decay();

            let mut solution = None;
            self.run(
                RunMode::MaxBacktracks {
                    max_backtracks: SEARCH_LIMIT,
                },
                progress,
                None,
                &mut |sol| {
                    solution = Some(grid_to_solution(sol));
                },
            );

            if let Some(sol) = solution {
                // Found a solution — finalize.
                self.counters.branches_ignored = 1.0 - self.counters.progress_ratio;
                self.initial_grid = original_initial_grid;
                return SolveResult {
                    solution: Some(sol),
                    counters: self.counters.clone(),
                };
            }

            if self.counters.backtracks < SEARCH_LIMIT {
                // Search exhausted before limit — no solutions exist.
                self.counters.branches_ignored = 1.0 - self.counters.progress_ratio;
                self.initial_grid = original_initial_grid;
                return SolveResult {
                    solution: None,
                    counters: self.counters.clone(),
                };
            }

            // Hit the limit — record progress for ranking.
            attempt_log.push((house_idx, self.counters.progress_ratio));
        }

        // None completed. Pick the house with the best progress_ratio
        // and do a full search.
        attempt_log.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let best_house_idx = attempt_log[0].0;

        self.reset_run();
        fill_house(
            &mut self.initial_grid,
            &house_cells[best_house_idx],
            &original_initial_grid,
        );

        let mut solution = None;
        self.run(
            RunMode::MaxSolutions { max_solutions: 1 },
            progress,
            None,
            &mut |sol| {
                solution = Some(grid_to_solution(sol));
            },
        );

        self.counters.branches_ignored = 1.0 - self.counters.progress_ratio;
        self.initial_grid = original_initial_grid;
        self.state = SolverState::Exhausted;
        SolveResult {
            solution,
            counters: self.counters.clone(),
        }
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
    pub(super) fn solve_all_possibilities(
        &mut self,
        threshold: u8,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> AllPossibilitiesResult {
        let num_cells = self.shape.num_cells;
        let num_values = self.shape.num_values as usize;

        if self.initial_contradiction {
            return AllPossibilitiesResult {
                candidate_counts: vec![0u8; num_cells * num_values],
                solutions: Vec::new(),
                counters: self.counters.clone(),
            };
        }

        self.seen_candidate_set.reset_with_threshold(threshold);
        let mut solutions = Vec::new();

        // Temporarily take the SeenCandidateSet out of self to avoid
        // double-borrow issues (run needs &mut self + &mut seen).
        let mut seen =
            std::mem::replace(&mut self.seen_candidate_set, SeenCandidateSet::new(1, 0, 0));

        self.run(RunMode::Exhaustive, progress, Some(&mut seen), &mut |sol| {
            solutions.push(grid_to_solution(sol));
        });

        let candidate_counts = seen.candidate_counts().to_vec();
        // Put the SeenCandidateSet back.
        self.seen_candidate_set = seen;

        AllPossibilitiesResult {
            candidate_counts,
            solutions,
            counters: self.counters.clone(),
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
    pub(super) fn estimated_count_solutions(
        &mut self,
        max_samples: u64,
        progress: &mut dyn FnMut(&SolverProgress),
    ) -> (f64, u64, SolverCounters) {
        let mut total_estimate = 0.0f64;
        let mut num_samples = 0u64;

        if self.initial_contradiction {
            return (0.0, 0, self.counters.clone());
        }

        // Enable sampling mode on the candidate selector.
        self.candidate_selector.enable_sampling();

        loop {
            let mut found_solution = false;
            let mut sample_values: Option<Vec<u8>> = None;
            // Mirrors JS `_resetRun()` + `run({ maxBacktracks: 1 })` in the
            // estimation loop: one root-to-backtrack path per sample.
            self.reset_run();
            self.run(
                RunMode::MaxBacktracks { max_backtracks: 1 },
                &mut |_| {},
                None,
                &mut |sol| {
                    found_solution = true;
                    sample_values = Some(super::grid_to_solution(sol));
                },
            );

            if found_solution {
                total_estimate += self.candidate_selector.solution_weight();
            }

            num_samples += 1;
            let estimate = total_estimate / num_samples as f64;

            // Report progress with estimate + sample, matching JS
            // `_progressExtraStateFn` which sets `extra.estimate` and
            // `extra.solutions`.
            let mut progress_counters = self.counters.clone();
            progress_counters.solutions = num_samples;
            let mut solver_progress = SolverProgress::counters_only(progress_counters);
            solver_progress.extra = Some(debug::ProgressExtra {
                estimate: Some(debug::EstimateProgress {
                    solutions: estimate,
                    samples: num_samples,
                }),
                solutions: sample_values.map(|s| vec![s]),
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
        (estimate, num_samples, self.counters.clone())
    }

    /// Prepare step state for an upcoming `run(RunMode::Step { .. })` call.
    ///
    /// Sets step guides and resets the step counters. Called by
    /// `Solver::nth_step` before invoking `run()`.
    ///
    /// Mirrors JS `_initStepState(stepMode)` including the
    /// `enableStepLogs` toggle.
    pub(super) fn set_step_guides(&mut self, step_guides: HashMap<u64, StepGuide>, target: u64) {
        self.step_state = StepState::new(self.shape.num_cells);
        self.step_state.step_guides = step_guides;
        // Mirrors JS: if (this._debugLogger.enableLogs) {
        //   this._debugLogger.enableStepLogs = (1 === stepMode.n);
        // }
        if self.debug_options.log_level >= 1 {
            self.debug_options.enable_step_logs = target == 1;
        }
    }

    /// Increment step counter and toggle `enable_step_logs` for the target.
    ///
    /// Mirrors JS `_incStep()`:
    /// ```js
    /// const step = ++this._stepState.step;
    /// if (this._debugLogger.enableLogs) {
    ///   this._debugLogger.enableStepLogs = (step === this._stepState.stepTarget);
    /// }
    /// ```
    fn inc_step(&mut self, step_target: u64) {
        self.step_state.step += 1;
        if self.debug_options.log_level >= 1 {
            self.debug_options.enable_step_logs = self.step_state.step == step_target;
        }
    }

    /// Extract the step result produced by the last `run(RunMode::Step)` call.
    ///
    /// Returns `Some(StepResult)` if a step was found, `None` otherwise.
    pub(super) fn take_step_result(&mut self) -> Option<StepResult> {
        self.step_state.result.take()
    }

    /// Set the log2 progress frequency.
    ///
    /// The callback fires every `2^log_freq` iterations.
    /// `log_freq == 0` disables progress (matches JS `frequencyMask = -1`).
    ///
    /// Mirrors JS `InternalSolver.setProgressCallback(cb, logFrequency)`.
    pub(super) fn set_progress_frequency(&mut self, log_freq: u32) {
        self.progress_frequency_mask = if log_freq > 0 {
            (1u64 << log_freq) - 1
        } else {
            u64::MAX // disabled: check `(counter & MAX) == 0` is never true for counter > 0
        };
    }

    /// Set an ad-hoc debug counter (matching JS `debugLogger.setCounter`).
    pub(super) fn set_counter(&mut self, name: String, value: f64) {
        self.ad_hoc_counters.insert(name, value);
    }

    /// Increment an ad-hoc debug counter (matching JS `debugLogger.incCounter`).
    pub(super) fn inc_counter(&mut self, name: String, value: f64) {
        let entry = self.ad_hoc_counters.entry(name).or_insert(0.0);
        *entry += value;
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
    fn build_progress(&mut self, rec_depth: usize) -> SolverProgress {
        let conflict_heatmap = if self.debug_options.export_conflict_heatmap {
            Some(self.candidate_selector.conflict_scores().scores.to_vec())
        } else {
            None
        };

        let stack_trace = if self.debug_options.export_stack_trace && rec_depth > 0 {
            // Build stack trace from the current recursion frame.
            // Reuse pre-allocated buffers matching JS _debugValueBuffer pattern.
            let frame = self.rec_stack.frame(rec_depth);
            let cell_depth = frame.cell_depth;
            let cells_slice = self.candidate_selector.get_cell_order(cell_depth);

            self.stack_trace_cells_buf.clear();
            self.stack_trace_cells_buf
                .extend(cells_slice.iter().map(|&c| c as u16));

            self.stack_trace_values_buf.clear();
            self.stack_trace_values_buf
                .extend(cells_slice.iter().map(|&c| {
                    let v = frame.grid[c as usize];
                    if !v.is_empty() && v.is_single() {
                        v.value() as u16
                    } else {
                        0
                    }
                }));

            Some(StackTrace {
                cells: self.stack_trace_cells_buf.clone(),
                values: self.stack_trace_values_buf.clone(),
            })
        } else {
            None
        };

        let logs = std::mem::take(&mut self.debug_logs);

        SolverProgress {
            counters: self.counters.clone(),
            conflict_heatmap,
            stack_trace,
            logs,
            ad_hoc_counters: self.ad_hoc_counters.clone(),
            extra: None,
        }
    }

    /// Start a fresh search, discarding any saved resume position.
    ///
    /// Bumps the internal generation counter, invalidating any outstanding
    /// `RunToken` from a previous run. Owns all fresh-start initialisation:
    /// resets the candidate selector, sets up the initial recursion frame,
    /// runs initial constraint propagation, then hands off to `run_loop(1, 0, ...)`.
    ///
    /// Returns `Some(RunToken)` when stopped early in `MaxSolutions` mode with
    /// the search position saved. Pass the token to `resume()` to continue.
    /// Returns `None` when the search exhausts naturally, or when the mode
    /// never saves position (`Exhaustive`, `MaxBacktracks`, `Step`).
    /// Full reset: fresh conflict scores, cleared sample solution, then
    /// partial reset.
    ///
    /// Mirrors JS `InternalSolver.reset()`. Called by the outer `Solver`
    /// before each public operation that expects a clean slate (same as JS
    /// `SudokuSolver._reset()` → `InternalSolver.reset()`).
    pub(super) fn reset(&mut self) {
        self.counters = SolverCounters::default();
        self.candidate_selector.full_reset();
        self.seen_candidate_set.reset();
        self.step_state = StepState::new(self.shape.num_cells);
        self.current_rec_depth = None;
        self.reset_run();
    }

    /// Partial reset: preserve conflict scores, reset cell ordering and state.
    ///
    /// Mirrors JS `InternalSolver._resetRun()`. Used internally (inside
    /// `validate_layout` attempt loops and `estimated_count_solutions` loop)
    /// where conflict scores should carry over between sub-runs.
    pub(super) fn reset_run(&mut self) {
        self.candidate_selector.reset();
        self.rec_depth = 0;
        self.iteration_counter = 0;
        self.state = SolverState::Unstarted;
    }

    /// Run the solver.
    ///
    /// If in `Unstarted` state, starts a fresh search via `init_run()`.
    /// If in `Resumable` state, continues from the saved position;
    /// `mode` must be `MaxSolutions` with `max_solutions` exceeding the
    /// current solution count.
    /// Any other state panics — call `reset_run()` first.
    ///
    /// Mirrors JS `InternalSolver.run(mode, onSolution)`.
    pub(super) fn run(
        &mut self,
        mode: RunMode,
        progress: &mut dyn FnMut(&SolverProgress),
        seen: Option<&mut SeenCandidateSet>,
        on_solution: &mut dyn FnMut(&[CandidateSet]),
    ) {
        match self.state {
            SolverState::Unstarted => {
                self.init_run(mode);
            }
            SolverState::Resumable => {
                let RunMode::MaxSolutions { max_solutions } = mode else {
                    panic!("run() from Resumable state requires MaxSolutions mode");
                };
                assert!(
                    max_solutions > self.counters.solutions,
                    "run() maxSolutions ({max_solutions}) must exceed current solution count ({})",
                    self.counters.solutions
                );
            }
            _ => {
                panic!("run() requires Unstarted or Resumable state; call reset_run() first");
            }
        }

        let rec_depth = self.rec_depth;
        let iteration_counter = self.iteration_counter;
        self.state = SolverState::Incomplete;
        self.run_loop(
            rec_depth,
            iteration_counter,
            mode,
            progress,
            seen,
            on_solution,
        );
    }

    /// Initialise for a fresh run from `Unstarted` state.
    ///
    /// Mirrors JS `InternalSolver._initRun(mode)`. Resets progress ratios,
    /// sets up the initial recursion frame, runs initial constraint
    /// propagation, and sets `rec_depth = 1`.
    ///
    /// Note: `candidate_selector.reset()` is NOT called here — it must
    /// have been called already (by `reset_run()` or implicitly by
    /// fresh construction). This matches JS where `_initRun` never calls
    /// `candidateSelector.reset()` (that is `_resetRun`'s responsibility).
    fn init_run(&mut self, mode: RunMode) {
        let num_cells = self.shape.num_cells;
        let step_mode = matches!(mode, RunMode::Step { .. });

        self.counters.progress_ratio_prev += self.counters.progress_ratio;
        self.counters.progress_ratio = 0.0;

        {
            let frame = self.rec_stack.frame_mut(0);
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

            if !enforce_constraints_on(&mut frame.grid, &mut self.accumulator, &mut self.counters) {
                // Initial grid is contradictory — ensure a zero in the
                // cell range so the initial iteration will fail.
                if !frame.grid[..num_cells].contains(&CandidateSet::EMPTY) {
                    frame.grid[..num_cells].fill(CandidateSet::EMPTY);
                }
            }
        }

        // In step mode, capture the initial old_grid before first candidate selection.
        if step_mode {
            self.step_state.old_grid = self.rec_stack.frame(0).grid.clone();
            self.step_state.pending_guess_depth = -1;
            self.step_state.pending_guess_value = CandidateSet::EMPTY;
        }

        self.counters.nodes_searched += 1;
        // rec_depth starts at 1 (frame 0 is initialised above).
        self.rec_depth = 1;
        self.iteration_counter = 0;
    }

    /// Core iterative backtracking loop.
    ///
    /// Pure loop body — no initialisation, no state restoration.
    /// Starts immediately at `rec_depth` / `iteration_counter` and runs
    /// until a termination condition fires or the search space is exhausted.
    ///
    /// `run()` owns fresh-start initialisation and calls `run_loop(1, 0, ...)`.
    /// On resume, `run()` reads `self.rec_depth`/`self.iteration_counter` and
    /// calls `run_loop` with those saved values.
    ///
    /// `mode`: controls the termination condition and step behaviour.
    ///   See [`RunMode`] for the available modes.
    /// `seen`: optional `SeenCandidateSet` for all-possibilities mode pruning.
    fn run_loop(
        &mut self,
        mut rec_depth: usize,
        mut iteration_counter: u64,
        mode: RunMode,
        progress: &mut dyn FnMut(&SolverProgress),
        mut seen: Option<&mut SeenCandidateSet>,
        on_solution: &mut dyn FnMut(&[CandidateSet]),
    ) {
        let step_mode = matches!(mode, RunMode::Step { .. });
        let step_target = if let RunMode::Step { target } = mode {
            target
        } else {
            0
        };
        let progress_mask = self.progress_frequency_mask;
        let num_cells = self.shape.num_cells;

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

            // Build debug logger for candidate selection (mirrors JS
            // constructor injection of _debugLogger into CandidateSelector).
            let mut candidate_dbg = if self.debug_options.log_level >= 1 {
                Some(CandidateDebugLogger {
                    log_level: self.debug_options.log_level,
                    enable_step_logs: self.debug_options.enable_step_logs,
                    debug_logs: &mut self.debug_logs,
                    shape: &self.shape,
                })
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
                    candidate_dbg.as_mut(),
                )
            };
            drop(candidate_dbg);

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
                if self.step_state.step >= step_target {
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
                self.inc_step(step_target);
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
            self.counters.values_tried += (next_depth - cell_depth) as u64;

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
                self.counters.guesses += 1;

                self.rec_stack.copy_grid(old_depth, rec_depth);

                // Remove the value from our candidates in the old frame.
                self.rec_stack.frame_mut(old_depth).grid[cell as usize] ^= value;
            }

            // Fix the cell to the selected value.
            self.rec_stack.frame_mut(rec_depth).grid[cell as usize] = value;

            // Progress callback (every 2^logFreq iterations).
            iteration_counter += 1;
            if (iteration_counter & progress_mask) == 0 {
                let p = self.build_progress(rec_depth);
                progress(&p);
                iteration_counter &= (1 << 30) - 1;
            }

            // Propagate constraints.
            // Mirrors JS _enforceConstraints: branches on logSteps
            // (enableStepLogs) to route through _debugEnforceConsistency.
            let has_contradiction = if self.debug_options.enable_step_logs {
                let grid = &mut self.rec_stack.frame_mut(rec_depth).grid;
                !debug_enforce_constraints(
                    "_enforceConstraints",
                    grid,
                    &mut self.accumulator,
                    &mut self.counters,
                    &mut self.debug_logs,
                    &mut self.debug_grid_buffer,
                    self.shape,
                    self.debug_options.log_level,
                )
            } else {
                let grid = &mut self.rec_stack.frame_mut(rec_depth).grid;
                !enforce_constraints_on(grid, &mut self.accumulator, &mut self.counters)
            };

            if has_contradiction {
                // Record contradiction cell for parent frame.
                if rec_depth > 0 {
                    self.rec_stack
                        .frame_mut(rec_depth - 1)
                        .last_contradiction_cell = cell as i16;
                }
                self.counters.progress_ratio += progress_delta;
                self.counters.backtracks += 1;
                self.candidate_selector
                    .conflict_scores_mut()
                    .increment(cell, value);

                // ── CONTRADICTION YIELD POINT ────────────────────────
                if step_mode {
                    if self.step_state.step >= step_target {
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
                    self.inc_step(step_target);
                }
                // ─────────────────────────────────────────────────────

                // ── TERMINATION CHECK (after backtrack) ──────────────
                if let RunMode::MaxBacktracks { max_backtracks } = mode {
                    if self.counters.backtracks >= max_backtracks {
                        return;
                    }
                }
                // ─────────────────────────────────────────────────────

                continue;
            }

            // All-possibilities pruning: skip branches with no unseen candidates.
            if let Some(ref mut s) = seen {
                if s.enabled {
                    let grid = &self.rec_stack.frame(rec_depth).grid;
                    if !s.has_interesting_solutions(grid) {
                        self.counters.branches_ignored += progress_delta;
                        continue;
                    }
                }
            }

            // Check if we've found a solution.
            if next_depth == num_cells {
                self.counters.progress_ratio += progress_delta;
                self.counters.solutions += 1;
                self.counters.backtracks += 1;

                let solution = &self.rec_stack.frame(rec_depth).grid;

                // Record in SeenCandidateSet and enable pruning after 2 solutions.
                if let Some(ref mut s) = seen {
                    s.add_solution(solution);
                    if self.counters.solutions == 2 {
                        s.enabled = true;
                    }
                }

                on_solution(solution);

                // ── SOLUTION YIELD POINT ─────────────────────────────
                if step_mode {
                    if self.step_state.step >= step_target {
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
                    self.inc_step(step_target);
                }
                // ─────────────────────────────────────────────────────

                match mode {
                    RunMode::MaxSolutions { max_solutions } => {
                        if self.counters.solutions >= max_solutions {
                            // Save position so run() can continue from here.
                            self.rec_depth = rec_depth;
                            self.iteration_counter = iteration_counter;
                            self.state = SolverState::Resumable;
                            return;
                        }
                    }
                    RunMode::MaxBacktracks { .. } => {
                        // A solution is also a terminal backtrack event.
                        return;
                    }
                    RunMode::Exhaustive | RunMode::Step { .. } => {}
                }
                continue;
            }

            // Recurse: set up the next frame.
            self.counters.nodes_searched += 1;
            let frame = self.rec_stack.frame_mut(rec_depth);
            frame.cell_depth = next_depth;
            frame.new_node = true;
            frame.progress_remaining = progress_delta;
            frame.last_contradiction_cell = -1;
            rec_depth += 1;
        }

        // Search space exhausted.
        self.current_rec_depth = None;
        self.state = SolverState::Exhausted;

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
