use crate::candidate_selector::CandidateSelector;
use crate::cell_exclusions::CellExclusions;
use crate::grid::Grid;
use crate::handler::ConstraintHandler;
use crate::handler::{AllDifferent, AllDifferentType, UniqueValueExclusion};
use crate::handler_accumulator::HandlerAccumulator;
use crate::optimizer::HandlerKind;
use crate::optimizer::Optimizer;
use crate::recursion_stack::RecursionStack;
use crate::sum_handler::Sum;
use crate::util::NUM_CELLS;

/// Solver counters tracking search statistics.
#[derive(Clone, Default, Debug)]
pub struct SolverCounters {
    pub solutions: u64,
    pub backtracks: u64,
    pub guesses: u64,
    pub values_tried: u64,
    pub constraints_processed: u64,
    pub progress_ratio: f64,
}

/// Result of a solve operation.
#[derive(Debug)]
pub struct SolveResult {
    pub solution: Option<[u16; NUM_CELLS]>,
    pub counters: SolverCounters,
}

/// The core sudoku solver.
///
/// Mirrors JS `InternalSolver` from engine.js. Uses iterative
/// backtracking with constraint propagation, conflict-score-based
/// cell selection, and singleton priority processing.
pub struct Solver {
    /// The handler accumulator (owns all handlers + propagation queue).
    accumulator: HandlerAccumulator,

    /// Candidate selector for cell/value ordering.
    candidate_selector: CandidateSelector,

    /// Pre-allocated recursion stack.
    rec_stack: RecursionStack,

    /// Initial grid state (after handler initialization + initial propagation).
    initial_grid: [u16; NUM_CELLS],

    /// Whether the initial grid was found to be contradictory.
    initial_contradiction: bool,

    /// Bitmask for progress callback frequency (2^logFreq - 1).
    /// Callback fires when `iteration_counter & mask == 0`.
    progress_frequency_mask: u64,
}

impl Solver {
    /// Build a solver for a plain 9×9 sudoku puzzle.
    ///
    /// `puzzle`: 81-character string ('1'-'9' for givens, '.' or '0' for empty).
    pub fn new(puzzle: &str) -> Result<Self, String> {
        let grid = Grid::from_str(puzzle).map_err(|e| e.to_string())?;
        Self::build(grid, Vec::new())
    }

    /// Build a solver with additional constraint handlers.
    ///
    /// Used by killer sudoku to add Sum handlers.
    pub fn with_handlers(
        puzzle: &str,
        extra_handlers: Vec<Box<dyn ConstraintHandler>>,
    ) -> Result<Self, String> {
        let grid = Grid::from_str(puzzle).map_err(|e| e.to_string())?;
        Self::build(grid, extra_handlers)
    }

    /// Build a solver with killer cages.
    ///
    /// `cages`: list of (cells, sum) pairs.
    /// A sum of 0 means any sum is ok — i.e. the same as AllDifferent.
    pub fn with_cages(puzzle: &str, cages: &[(Vec<u8>, i32)]) -> Result<Self, String> {
        let mut handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        for (cells, sum) in cages {
            if *sum == 0 {
                // A sum of 0 means no sum constraint — just AllDifferent.
                let cell_bytes: Vec<u8> = cells.clone();
                handlers.push(Box::new(AllDifferent::new(
                    cell_bytes,
                    AllDifferentType::WithExclusionCells,
                )));
            } else {
                handlers.push(Box::new(Sum::new_cage(cells.clone(), *sum)));
            }
        }
        Self::with_handlers(puzzle, handlers)
    }

    /// Core builder: sets up handlers, exclusions, accumulator, and does
    /// initial constraint propagation.
    fn build(grid: Grid, extra_handlers: Vec<Box<dyn ConstraintHandler>>) -> Result<Self, String> {
        Self::build_inner(grid, extra_handlers, true)
    }

    /// Build without optimizer (for testing optimizer impact).
    #[cfg(test)]
    fn build_no_optimizer(
        grid: Grid,
        extra_handlers: Vec<Box<dyn ConstraintHandler>>,
    ) -> Result<Self, String> {
        Self::build_inner(grid, extra_handlers, false)
    }

    /// Inner builder with optional optimizer.
    fn build_inner(
        grid: Grid,
        extra_handlers: Vec<Box<dyn ConstraintHandler>>,
        use_optimizer: bool,
    ) -> Result<Self, String> {
        // Step 1: Create the standard constraint handlers.
        let mut handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

        // Add AllDifferent handlers for all 27 houses (9 rows + 9 cols + 9 boxes).
        // Like JS, we use AllDifferent (0 watched cells) rather than House directly.
        // The optimizer will promote these to House and append them at the end,
        // preserving the rows-cols-boxes ordering that JS produces.
        for house in Grid::all_houses() {
            let cells: Vec<u8> = house.iter().map(|&c| c as u8).collect();
            handlers.push(Box::new(AllDifferent::new(
                cells,
                AllDifferentType::WithExclusionCells,
            )));
        }

        // Add extra handlers (e.g., Sum handlers for killer cages).
        handlers.extend(extra_handlers);

        // Step 2: Build initial cell exclusions from all handlers' exclusion_cells.
        let mut cell_exclusions = CellExclusions::new();
        for handler in &handlers {
            let excl = handler.exclusion_cells();
            for i in 0..excl.len() {
                for j in (i + 1)..excl.len() {
                    cell_exclusions.add_mutual_exclusion(excl[i], excl[j]);
                }
            }
        }

        // Step 3: Sort handlers BEFORE optimizer (matching JS behavior).
        // JS sorts by (cells.length, constructor.name, cells.join(',')) before
        // the optimizer runs. The optimizer only appends new handlers at the end.
        handlers.sort_by(|a, b| {
            let len_cmp = a.cells().len().cmp(&b.cells().len());
            if len_cmp != std::cmp::Ordering::Equal {
                return len_cmp;
            }
            let name_cmp = a.handler_type_name().cmp(b.handler_type_name());
            if name_cmp != std::cmp::Ordering::Equal {
                return name_cmp;
            }
            // Tertiary: cells as comma-joined string (lexicographic).
            let a_cells: String = a
                .cells()
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let b_cells: String = b
                .cells()
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");
            a_cells.cmp(&b_cells)
        });

        // Step 4: Run the optimizer (if enabled).
        let (handlers, handler_essential, handler_kinds) = if use_optimizer {
            let optimized = Optimizer::optimize(handlers, &mut cell_exclusions);
            let mut hs: Vec<Box<dyn ConstraintHandler>> = Vec::new();
            let mut es: Vec<bool> = Vec::new();
            let mut ks: Vec<HandlerKind> = Vec::new();
            for (h, essential, kind) in optimized {
                hs.push(h);
                es.push(essential);
                ks.push(kind);
            }

            // Add cell exclusions from new ESSENTIAL handlers only.
            // Non-essential (optimizer-generated) handlers like sum intersection
            // handlers may have cells that are NOT pairwise distinct, so we must
            // not add their exclusion cells to the graph.
            for (handler, &essential) in hs.iter().zip(es.iter()) {
                if !essential {
                    continue;
                }
                let excl = handler.exclusion_cells();
                for i in 0..excl.len() {
                    for j in (i + 1)..excl.len() {
                        cell_exclusions.add_mutual_exclusion(excl[i], excl[j]);
                    }
                }
            }
            (hs, es, ks)
        } else {
            let es: Vec<bool> = handlers.iter().map(|h| h.is_essential()).collect();
            let ks: Vec<HandlerKind> = vec![HandlerKind::Ordinary; es.len()];
            (handlers, es, ks)
        };
        let mut handlers = handlers;

        // Step 5: Add UniqueValueExclusion singleton handlers.
        let mut singleton_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        for i in 0..NUM_CELLS {
            singleton_handlers.push(Box::new(UniqueValueExclusion::new(i as u8)));
        }

        // Step 6: Build handler index maps.
        // Combine all handlers: ordinary first, then singletons.
        let num_ordinary = handlers.len();
        let mut all_handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        all_handlers.append(&mut handlers);
        all_handlers.append(&mut singleton_handlers);

        // Build cell → handler index maps.
        let mut ordinary_map: Vec<Vec<u16>> = vec![Vec::new(); NUM_CELLS];
        let mut aux_map: Vec<Vec<u16>> = vec![Vec::new(); NUM_CELLS];
        let mut singleton_map: Vec<Vec<u16>> = vec![Vec::new(); NUM_CELLS];

        for (idx, handler) in all_handlers.iter().enumerate() {
            if handler.is_singleton() {
                for &cell in handler.cells() {
                    singleton_map[cell as usize].push(idx as u16);
                }
            } else if idx < num_ordinary && matches!(handler_kinds[idx], HandlerKind::Aux) {
                for &cell in handler.cells() {
                    aux_map[cell as usize].push(idx as u16);
                }
            } else {
                for &cell in handler.cells() {
                    ordinary_map[cell as usize].push(idx as u16);
                }
            }
        }

        // Build essential flags (ordinary handlers from optimizer + singletons are essential).
        let mut essential_flags: Vec<bool> = handler_essential;
        for h in all_handlers.iter().skip(essential_flags.len()) {
            essential_flags.push(h.is_essential());
        }

        // Step 7: Initialize all handlers.
        let mut initial_grid = grid.cells;
        let mut initial_contradiction = false;

        for handler in all_handlers.iter_mut() {
            if !handler.initialize(&mut initial_grid, &cell_exclusions) {
                initial_contradiction = true;
                // Zero out cells touched by the failing handler.
                for &cell in handler.cells() {
                    initial_grid[cell as usize] = 0;
                }
                if handler.cells().is_empty() {
                    initial_grid.fill(0);
                }
            }
        }

        // Step 8: Build cell priorities for candidate selection.
        let mut cell_priorities = [0i32; NUM_CELLS];
        for handler in all_handlers.iter() {
            let priority = handler.priority();
            for &cell in handler.cells() {
                cell_priorities[cell as usize] += priority;
            }
        }

        // Step 9: Create accumulator and candidate selector.
        let accumulator = HandlerAccumulator::new(
            all_handlers,
            singleton_map,
            ordinary_map,
            aux_map,
            essential_flags,
            cell_exclusions,
        );

        let candidate_selector = CandidateSelector::new(&cell_priorities);
        let rec_stack = RecursionStack::new();

        Ok(Solver {
            accumulator,
            candidate_selector,
            rec_stack,
            initial_grid,
            initial_contradiction,
            progress_frequency_mask: (1u64 << 13) - 1, // default: every 8192 iterations
        })
    }

    /// Dump handler setup info for debugging parity with the JS solver.
    pub fn dump_handlers(&self) {
        let acc = &self.accumulator;
        let handlers = acc.handlers();
        println!("=== Rust Handler Dump ===");
        println!("Total handlers: {}", handlers.len());
        println!();
        println!("--- Handler List (setup order) ---");
        for (i, h) in handlers.iter().enumerate() {
            let name = h.debug_name();
            let cells = h.cells();
            let excl = h.exclusion_cells();
            let singleton = h.is_singleton();
            let essential = h.is_essential();
            let mut tag = String::new();
            if singleton {
                tag.push_str(" [singleton]");
            }
            if !essential {
                tag.push_str(" [non-essential]");
            }
            println!(
                "  [{}] {} cells=[{}] exclCells=[{}]{}",
                i,
                name,
                cells
                    .iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(","),
                excl.iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(","),
                tag,
            );
        }
        // Dump handler maps
        acc.dump_maps();
    }

    /// Solve and return the first solution found (if any).
    pub fn solve(&mut self) -> SolveResult {
        self.solve_with_progress(&mut |_| {})
    }

    /// Solve with a progress callback.
    ///
    /// The callback receives `&SolverCounters` periodically during search.
    /// The frequency is controlled by `set_progress_frequency`.
    pub fn solve_with_progress(
        &mut self,
        progress: &mut dyn FnMut(&SolverCounters),
    ) -> SolveResult {
        let mut counters = SolverCounters::default();

        if self.initial_contradiction {
            return SolveResult {
                solution: None,
                counters,
            };
        }

        let solution = self.run(&mut counters, 1, progress);

        SolveResult {
            solution: solution.first().copied(),
            counters,
        }
    }

    /// Count solutions up to a given limit (0 = unlimited).
    pub fn count_solutions(&mut self, limit: u64) -> (u64, SolverCounters) {
        self.count_solutions_with_progress(limit, &mut |_| {})
    }

    /// Count solutions with a progress callback.
    pub fn count_solutions_with_progress(
        &mut self,
        limit: u64,
        progress: &mut dyn FnMut(&SolverCounters),
    ) -> (u64, SolverCounters) {
        let mut counters = SolverCounters::default();

        if self.initial_contradiction {
            return (0, counters);
        }

        let solutions = self.run(&mut counters, limit, progress);
        (solutions.len() as u64, counters)
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

    /// Core iterative backtracking solver.
    ///
    /// Mirrors JS `InternalSolver.run()`. Returns collected solutions.
    ///
    /// `max_solutions`: stop after finding this many solutions (0 = unlimited).
    fn run(
        &mut self,
        counters: &mut SolverCounters,
        max_solutions: u64,
        progress: &mut dyn FnMut(&SolverCounters),
    ) -> Vec<[u16; NUM_CELLS]> {
        let mut solutions = Vec::new();
        let mut iteration_counter: u64 = 0;
        let progress_mask = self.progress_frequency_mask;

        // Reset candidate selector.
        self.candidate_selector.reset();

        // Set up initial recursion frame.
        let mut rec_depth: usize = 0;
        {
            let frame = self.rec_stack.frame_mut(rec_depth);
            frame.grid = self.initial_grid;
            frame.cell_depth = 0;
            frame.last_contradiction_cell = -1;
            frame.progress_remaining = 1.0;
            frame.new_node = true;

            // Initial constraint propagation: enqueue all cells.
            self.accumulator.reset(false);
            for i in 0..NUM_CELLS {
                self.accumulator.add_for_cell(i as u8);
            }

            if !enforce_constraints_on(&mut frame.grid, &mut self.accumulator, counters) {
                // Initial grid is contradictory.
                if !frame.grid.contains(&0) {
                    frame.grid.fill(0);
                }
            }

            #[cfg(feature = "trace")]
            {
                let vals: Vec<String> = frame.grid.iter().map(|v| v.to_string()).collect();
                eprintln!("A init r=1 {}", vals.join(" "));
            }
        }

        rec_depth += 1;

        #[cfg(feature = "trace")]
        let mut branch_count: u64 = 0;

        while rec_depth > 0 {
            rec_depth -= 1;

            let cell_depth;
            let progress_remaining;
            let last_contradiction_cell;
            let is_new_node;

            // Read frame data.
            {
                let frame = self.rec_stack.frame(rec_depth);
                cell_depth = frame.cell_depth;
                progress_remaining = frame.progress_remaining;
                last_contradiction_cell = frame.last_contradiction_cell;
                is_new_node = frame.new_node;
            }

            // Select next candidate.
            let selection = {
                let grid = &self.rec_stack.frame(rec_depth).grid;
                self.candidate_selector
                    .select_next_candidate(cell_depth, grid, is_new_node)
            };

            // Mark this node as visited.
            self.rec_stack.frame_mut(rec_depth).new_node = false;

            let next_depth = selection.next_depth;
            let value = selection.value;
            let count = selection.count;

            if count == 0 {
                continue;
            }

            // Trace branch decisions (enabled by TRACE_BRANCHES env var at compile time).
            #[cfg(feature = "trace")]
            {
                let val_index = value.trailing_zeros() + 1;
                eprintln!(
                    "branch={} cell={} val={} count={} depth={} nextDepth={}",
                    branch_count,
                    self.candidate_selector.get_cell_at_depth(cell_depth),
                    val_index,
                    count,
                    cell_depth,
                    next_depth
                );
                // Dump grid for branches 0..1008 for comparison — MOVED BELOW
                branch_count += 1;
            }

            // Progress tracking.
            let progress_delta = progress_remaining / count as f64;
            self.rec_stack.frame_mut(rec_depth).progress_remaining -= progress_delta;

            // Count values tried (all singletons up to the guess cell).
            counters.values_tried += (next_depth - cell_depth) as u64;

            // Set up constraint propagation.
            #[cfg(feature = "trace")]
            {
                let dump_branch = branch_count.wrapping_sub(1);
                if dump_branch >= 738 && dump_branch <= 741 {
                    eprintln!("=== Branch {} cellOrder dump ===", dump_branch);
                    eprintln!(
                        "  cellDepth={} nextDepth={} count={}",
                        cell_depth, next_depth, count
                    );
                    let cell_at_depth = self.candidate_selector.get_cell_at_depth(cell_depth);
                    eprintln!("  cell={} (branch cell)", cell_at_depth);
                    let co: Vec<u8> = (cell_depth..next_depth.min(cell_depth + 20))
                        .map(|i| self.candidate_selector.get_cell_at_depth(i))
                        .collect();
                    eprintln!("  cellOrder[{}..{}]= {:?}", cell_depth, next_depth, co);
                }
                if dump_branch == 739 {
                    eprintln!("=== Branch {} queue setup ===", dump_branch);
                    self.accumulator.trace_queue = true;
                }
            }
            self.accumulator.reset(next_depth == NUM_CELLS);
            for i in cell_depth..next_depth {
                self.accumulator
                    .add_for_fixed_cell(self.candidate_selector.get_cell_at_depth(i));
            }

            // Queue constraints for the last contradiction cell.
            if last_contradiction_cell >= 0 {
                self.accumulator.add_for_cell(last_contradiction_cell as u8);
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

            // Dump grid for comparison (after cell is set)
            #[cfg(feature = "trace")]
            {
                let dump_branch = branch_count.wrapping_sub(1);
                let grid = &self.rec_stack.frame(rec_depth).grid;
                let vals: Vec<String> = grid.iter().map(|v| v.to_string()).collect();
                eprintln!("B {} {}", dump_branch, vals.join(" "));
            }

            // Progress callback (every 2^logFreq iterations).
            iteration_counter += 1;
            if (iteration_counter & progress_mask) == 0 {
                progress(counters);
                iteration_counter &= (1 << 30) - 1;
            }

            // Propagate constraints.
            let has_contradiction = {
                let grid = &mut self.rec_stack.frame_mut(rec_depth).grid;
                #[cfg(feature = "trace")]
                {
                    !enforce_constraints_on_traced(
                        grid,
                        &mut self.accumulator,
                        counters,
                        branch_count.wrapping_sub(1),
                    )
                }
                #[cfg(not(feature = "trace"))]
                {
                    !enforce_constraints_on(grid, &mut self.accumulator, counters)
                }
            };

            // Dump grid AFTER propagation
            #[cfg(feature = "trace")]
            {
                let dump_branch = branch_count.wrapping_sub(1);
                let r = if has_contradiction { 0 } else { 1 };
                let grid = &self.rec_stack.frame(rec_depth).grid;
                let vals: Vec<String> = grid.iter().map(|v| v.to_string()).collect();
                eprintln!("A {} r={} {}", dump_branch, r, vals.join(" "));
            }

            if has_contradiction {
                // Record contradiction cell for parent frame.
                if rec_depth > 0 {
                    self.rec_stack
                        .frame_mut(rec_depth - 1)
                        .last_contradiction_cell = cell as i8;
                }
                counters.progress_ratio += progress_delta;
                counters.backtracks += 1;
                self.candidate_selector
                    .conflict_scores_mut()
                    .increment(cell, value);
                continue;
            }

            // Check if we've found a solution.
            if next_depth == NUM_CELLS {
                counters.progress_ratio += progress_delta;
                counters.solutions += 1;
                counters.backtracks += 1;

                let solution = self.rec_stack.frame(rec_depth).grid;
                solutions.push(solution);

                if max_solutions > 0 && counters.solutions >= max_solutions {
                    break;
                }
                continue;
            }

            // Recurse: set up the next frame.
            let frame = self.rec_stack.frame_mut(rec_depth);
            frame.cell_depth = next_depth;
            frame.new_node = true;
            frame.progress_remaining = progress_delta;
            frame.last_contradiction_cell = -1;
            rec_depth += 1;
        }

        solutions
    }
}

/// Run constraint propagation until no more handlers fire.
///
/// Free function to avoid borrow conflicts: the accumulator owns the
/// handlers but we need `&mut` access to both the queue state and
/// the handler's `enforce_consistency` method. By calling `enforce_at`
/// which borrows handler and queue separately, this works.
///
/// Returns `false` if a contradiction was found.
fn enforce_constraints_on(
    grid: &mut [u16],
    accumulator: &mut HandlerAccumulator,
    counters: &mut SolverCounters,
) -> bool {
    while !accumulator.is_empty() {
        let idx = accumulator.take_next();
        counters.constraints_processed += 1;
        if !accumulator.enforce_at(idx, grid) {
            return false;
        }
    }
    true
}

#[cfg(feature = "trace")]
fn enforce_constraints_on_traced(
    grid: &mut [u16],
    accumulator: &mut HandlerAccumulator,
    counters: &mut SolverCounters,
    branch: u64,
) -> bool {
    let trace_this = branch == 739;
    let mut handler_num = 0u32;
    // Enable queue tracing for this branch.
    accumulator.trace_queue = trace_this;
    if trace_this {
        eprintln!("=== Branch {} enforceConstraints start ===", branch);
    }
    while !accumulator.is_empty() {
        let idx = accumulator.take_next();
        counters.constraints_processed += 1;
        handler_num += 1;

        if trace_this {
            let before: Vec<u16> = grid[..81].to_vec();
            let result = accumulator.enforce_at(idx, grid);
            let handler = accumulator.get_handler(idx);
            let mut changes = Vec::new();
            for i in 0..81 {
                if grid[i] != before[i] {
                    changes.push(format!("c{}:{:#b}→{:#b}", i, before[i], grid[i]));
                }
            }
            let status = if !result {
                "CONTRADICTION"
            } else if changes.is_empty() {
                "no-change"
            } else {
                &changes.join(", ")
            };
            eprintln!(
                "  RH#{} idx={} {} {:?}: {}",
                handler_num,
                idx,
                handler.handler_type_name(),
                handler.cells(),
                status
            );
            if !result {
                accumulator.trace_queue = false;
                return false;
            }
        } else {
            if !accumulator.enforce_at(idx, grid) {
                accumulator.trace_queue = false;
                return false;
            }
        }
    }
    accumulator.trace_queue = false;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    const EASY_PUZZLE: &str =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";

    const EASY_SOLUTION: &str =
        "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

    const HARD_PUZZLE: &str =
        "800000000003600000070090200050007000000045700000100030001000068008500010090000400";

    const HARD_SOLUTION: &str =
        "812753649943682175675491283154237896369845721287169534521974368438526917796318452";

    // A puzzle with no solution.
    const IMPOSSIBLE_PUZZLE: &str =
        "11..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";

    #[test]
    fn test_solve_easy() {
        let mut solver = Solver::new(EASY_PUZZLE).unwrap();
        let result = solver.solve();
        assert!(result.solution.is_some());
        let sol_grid = Grid {
            cells: result.solution.unwrap(),
        };
        assert_eq!(sol_grid.to_string(), EASY_SOLUTION);
        // Easy puzzles should require zero backtracks (pure propagation).
        // Note: backtracks includes the final "solution found" increment,
        // so we check guesses instead.
        assert_eq!(
            result.counters.guesses, 0,
            "Easy puzzle should need no guesses"
        );
    }

    #[test]
    fn test_solve_hard() {
        let mut solver = Solver::new(HARD_PUZZLE).unwrap();
        let result = solver.solve();
        assert!(result.solution.is_some());
        let sol_grid = Grid {
            cells: result.solution.unwrap(),
        };
        assert_eq!(sol_grid.to_string(), HARD_SOLUTION);
    }

    #[test]
    fn test_solve_impossible() {
        let mut solver = Solver::new(IMPOSSIBLE_PUZZLE).unwrap();
        let result = solver.solve();
        assert!(result.solution.is_none());
    }

    #[test]
    fn test_count_solutions_unique() {
        let mut solver = Solver::new(EASY_PUZZLE).unwrap();
        let (count, _) = solver.count_solutions(0);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_count_solutions_empty_grid() {
        // An empty grid has many solutions.
        let empty = ".".repeat(81);
        let mut solver = Solver::new(&empty).unwrap();
        let (count, _) = solver.count_solutions(10);
        assert_eq!(count, 10, "Empty grid should have at least 10 solutions");
    }

    #[test]
    fn test_counters_populated() {
        let mut solver = Solver::new(HARD_PUZZLE).unwrap();
        let result = solver.solve();
        assert!(result.counters.constraints_processed > 0);
        assert!(result.counters.values_tried > 0);
    }

    // ====================================================================
    // Killer sudoku tests
    // ====================================================================

    /// Wikipedia killer sudoku puzzle cages.
    /// <https://en.wikipedia.org/wiki/Killer_sudoku>
    fn wikipedia_killer_cages() -> Vec<(Vec<u8>, i32)> {
        vec![
            (vec![0, 1], 3),            // R1C1,R1C2
            (vec![2, 3, 4], 15),        // R1C3,R1C4,R1C5
            (vec![9, 10, 18, 19], 25),  // R2C1,R2C2,R3C1,R3C2
            (vec![11, 12], 17),         // R2C3,R2C4
            (vec![20, 21, 30], 9),      // R3C3,R3C4,R4C4
            (vec![5, 13, 14, 22], 22),  // R1C6,R2C5,R2C6,R3C5
            (vec![6, 15], 4),           // R1C7,R2C7
            (vec![7, 16], 16),          // R1C8,R2C8
            (vec![8, 17, 26, 35], 15),  // R1C9,R2C9,R3C9,R4C9
            (vec![24, 25, 33], 20),     // R3C7,R3C8,R4C7
            (vec![23, 32, 41], 8),      // R3C6,R4C6,R5C6
            (vec![31, 40, 49], 17),     // R4C5,R5C5,R6C5
            (vec![39, 48, 57], 20),     // R5C4,R6C4,R7C4
            (vec![28, 29], 14),         // R4C2,R4C3
            (vec![27, 36], 6),          // R4C1,R5C1
            (vec![37, 38, 46], 13),     // R5C2,R5C3,R6C2
            (vec![47, 55, 56], 6),      // R6C3,R7C2,R7C3
            (vec![34, 42, 43], 17),     // R4C8,R5C7,R5C8
            (vec![45, 54, 63, 72], 27), // R6C1,R7C1,R8C1,R9C1
            (vec![64, 73], 8),          // R8C2,R9C2
            (vec![65, 74], 16),         // R8C3,R9C3
            (vec![58, 66, 67, 75], 10), // R7C5,R8C4,R8C5,R9C4
            (vec![44, 53], 12),         // R5C9,R6C9
            (vec![51, 52], 6),          // R6C7,R6C8
            (vec![50, 59, 60], 20),     // R6C6,R7C6,R7C7
            (vec![68, 69], 15),         // R8C6,R8C7
            (vec![61, 62, 70, 71], 14), // R7C8,R7C9,R8C8,R8C9
            (vec![76, 77, 78], 13),     // R9C5,R9C6,R9C7
            (vec![79, 80], 17),         // R9C8,R9C9
        ]
    }

    const KILLER_SOLUTION: &str =
        "215647398368952174794381652586274931142593867973816425821739546659428713437165289";

    #[test]
    fn test_killer_wikipedia() {
        let cages = wikipedia_killer_cages();
        let empty = ".".repeat(81);
        let mut solver = Solver::with_cages(&empty, &cages).unwrap();
        let result = solver.solve();
        assert!(
            result.solution.is_some(),
            "Wikipedia killer should have a solution"
        );
        let sol_grid = Grid {
            cells: result.solution.unwrap(),
        };
        assert_eq!(sol_grid.to_string(), KILLER_SOLUTION);
    }

    #[test]
    fn test_killer_unique_solution() {
        let cages = wikipedia_killer_cages();
        let empty = ".".repeat(81);
        let mut solver = Solver::with_cages(&empty, &cages).unwrap();
        let (count, _) = solver.count_solutions(2);
        assert_eq!(count, 1, "Wikipedia killer should have exactly 1 solution");
    }

    #[test]
    fn test_killer_with_overlap() {
        // Same puzzle with an extra redundant cage.
        let mut cages = wikipedia_killer_cages();
        cages.push((vec![4, 13], 9)); // R1C5,R2C5 sum=9
        let empty = ".".repeat(81);
        let mut solver = Solver::with_cages(&empty, &cages).unwrap();
        let result = solver.solve();
        assert!(result.solution.is_some());
        let sol_grid = Grid {
            cells: result.solution.unwrap(),
        };
        assert_eq!(sol_grid.to_string(), KILLER_SOLUTION);
    }

    // ====================================================================
    // Optimizer impact tests
    // ====================================================================

    /// Helper: build a solver for the Wikipedia killer puzzle without the optimizer.
    fn solve_killer_no_optimizer() -> SolveResult {
        let cages = wikipedia_killer_cages();
        let empty = ".".repeat(81);
        let grid = Grid::from_str(&empty).unwrap();
        let mut extra: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        for (cells, sum) in &cages {
            extra.push(Box::new(Sum::new_cage(cells.clone(), *sum)));
        }
        let mut solver = Solver::build_no_optimizer(grid, extra).unwrap();
        solver.solve()
    }

    #[test]
    fn test_optimizer_impact_killer() {
        // Solve with optimizer.
        let cages = wikipedia_killer_cages();
        let empty = ".".repeat(81);
        let mut solver = Solver::with_cages(&empty, &cages).unwrap();
        let result_opt = solver.solve();
        assert!(result_opt.solution.is_some());
        assert_eq!(
            Grid {
                cells: result_opt.solution.unwrap()
            }
            .to_string(),
            KILLER_SOLUTION,
        );

        // Solve without optimizer.
        let result_no_opt = solve_killer_no_optimizer();
        assert!(result_no_opt.solution.is_some());
        assert_eq!(
            Grid {
                cells: result_no_opt.solution.unwrap()
            }
            .to_string(),
            KILLER_SOLUTION,
        );

        // The optimizer should reduce backtracks.
        eprintln!(
            "Optimizer impact: backtracks {} -> {} (guesses {} -> {})",
            result_no_opt.counters.backtracks,
            result_opt.counters.backtracks,
            result_no_opt.counters.guesses,
            result_opt.counters.guesses,
        );

        assert!(
            result_opt.counters.backtracks <= result_no_opt.counters.backtracks,
            "Optimizer should not increase backtracks: {} (with) vs {} (without)",
            result_opt.counters.backtracks,
            result_no_opt.counters.backtracks,
        );
    }

    #[test]
    fn test_optimizer_reduces_guesses() {
        let cages = wikipedia_killer_cages();
        let empty = ".".repeat(81);
        let mut solver = Solver::with_cages(&empty, &cages).unwrap();
        let result_opt = solver.solve();

        let result_no_opt = solve_killer_no_optimizer();

        // For the Wikipedia killer, the optimizer should significantly
        // reduce guesses (typically from hundreds to single digits or zero).
        eprintln!(
            "Guesses: without optimizer = {}, with optimizer = {}",
            result_no_opt.counters.guesses, result_opt.counters.guesses,
        );

        // The optimizer must do at least as well.
        assert!(
            result_opt.counters.guesses <= result_no_opt.counters.guesses,
            "Optimizer should not increase guesses",
        );
    }
}
