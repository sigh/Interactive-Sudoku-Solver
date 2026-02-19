use super::*;
use crate::constraint::{builder::SudokuBuilder, Constraint};
use crate::grid::Grid;
use crate::grid_shape::SHAPE_9X9;
use std::collections::HashMap;

/// Convert a cell index (0..80) into an "RxCy" cell ID string (9×9 grid).
fn cell_id(idx: u8) -> String {
    format!("R{}C{}", idx / 9 + 1, idx % 9 + 1)
}

/// Convert (cells, sum) cage tuples into `Constraint::Cage` values.
fn cages_to_constraints(cages: &[(Vec<u8>, i32)]) -> Vec<Constraint> {
    cages
        .iter()
        .map(|(cells, sum)| Constraint::Cage {
            cells: cells.iter().map(|&c| cell_id(c)).collect(),
            sum: *sum,
        })
        .collect()
}

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
    let mut solver = SudokuBuilder::build(EASY_PUZZLE, &[], SHAPE_9X9).unwrap();
    let result = solver.solve();
    assert!(result.solution.is_some());
    let sol_grid = Grid {
        cells: result.solution.unwrap(),
    };
    assert_eq!(sol_grid.to_puzzle_string(), EASY_SOLUTION);
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
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let result = solver.solve();
    assert!(result.solution.is_some());
    let sol_grid = Grid {
        cells: result.solution.unwrap(),
    };
    assert_eq!(sol_grid.to_puzzle_string(), HARD_SOLUTION);
}

#[test]
fn test_solve_impossible() {
    let mut solver = SudokuBuilder::build(IMPOSSIBLE_PUZZLE, &[], SHAPE_9X9).unwrap();
    let result = solver.solve();
    assert!(result.solution.is_none());
}

#[test]
fn test_count_solutions_unique() {
    let mut solver = SudokuBuilder::build(EASY_PUZZLE, &[], SHAPE_9X9).unwrap();
    let (count, _) = solver.count_solutions(0);
    assert_eq!(count, 1);
}

#[test]
fn test_count_solutions_empty_grid() {
    // An empty grid has many solutions.
    let empty = ".".repeat(81);
    let mut solver = SudokuBuilder::build(&empty, &[], SHAPE_9X9).unwrap();
    let (count, _) = solver.count_solutions(10);
    assert_eq!(count, 10, "Empty grid should have at least 10 solutions");
}

#[test]
fn test_counters_populated() {
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
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
    let constraints = cages_to_constraints(&cages);
    let mut solver = SudokuBuilder::build(&empty, &constraints, SHAPE_9X9).unwrap();
    let result = solver.solve();
    assert!(
        result.solution.is_some(),
        "Wikipedia killer should have a solution"
    );
    let sol_grid = Grid {
        cells: result.solution.unwrap(),
    };
    assert_eq!(sol_grid.to_puzzle_string(), KILLER_SOLUTION);
}

#[test]
fn test_killer_unique_solution() {
    let cages = wikipedia_killer_cages();
    let empty = ".".repeat(81);
    let constraints = cages_to_constraints(&cages);
    let mut solver = SudokuBuilder::build(&empty, &constraints, SHAPE_9X9).unwrap();
    let (count, _) = solver.count_solutions(2);
    assert_eq!(count, 1, "Wikipedia killer should have exactly 1 solution");
}

#[test]
fn test_killer_with_overlap() {
    // Same puzzle with an extra redundant cage.
    let mut cages = wikipedia_killer_cages();
    cages.push((vec![4, 13], 9)); // R1C5,R2C5 sum=9
    let empty = ".".repeat(81);
    let constraints = cages_to_constraints(&cages);
    let mut solver = SudokuBuilder::build(&empty, &constraints, SHAPE_9X9).unwrap();
    let result = solver.solve();
    assert!(result.solution.is_some());
    let sol_grid = Grid {
        cells: result.solution.unwrap(),
    };
    assert_eq!(sol_grid.to_puzzle_string(), KILLER_SOLUTION);
}

// ====================================================================

// ===== nth_solution tests =====

#[test]
fn test_nth_solution_first() {
    // A unique puzzle: nth_solution(0) should return the same as solve().
    let puzzle =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
    let mut solver = SudokuBuilder::build(puzzle, &[], SHAPE_9X9).unwrap();
    let result = solver.nth_solution(0, &mut |_| {});
    assert!(result.solution.is_some());
    assert_eq!(result.counters.solutions, 1);
}

#[test]
fn test_nth_solution_sequential_forward() {
    // Empty grid has many solutions. Sequential forward should return
    // distinct solutions incrementally.
    let empty = ".".repeat(81);
    let mut solver = SudokuBuilder::build(&empty, &[], SHAPE_9X9).unwrap();

    let mut solutions = Vec::new();
    for i in 0..5u64 {
        let result = solver.nth_solution(i, &mut |_| {});
        assert!(
            result.solution.is_some(),
            "nth_solution({}) should find a solution",
            i
        );
        assert_eq!(
            result.counters.solutions,
            i + 1,
            "cumulative solution count after nth_solution({})",
            i
        );
        solutions.push(result.solution.unwrap());
    }

    // All solutions should be distinct.
    for i in 0..solutions.len() {
        for j in (i + 1)..solutions.len() {
            assert_ne!(
                solutions[i], solutions[j],
                "solutions {} and {} should differ",
                i, j
            );
        }
    }
}

#[test]
fn test_nth_solution_past_end() {
    // Unique puzzle: nth_solution(1) should return None.
    let puzzle =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
    let mut solver = SudokuBuilder::build(puzzle, &[], SHAPE_9X9).unwrap();
    let r0 = solver.nth_solution(0, &mut |_| {});
    assert!(r0.solution.is_some());
    let r1 = solver.nth_solution(1, &mut |_| {});
    assert!(r1.solution.is_none());
}

#[test]
fn test_nth_solution_repeated_past_end() {
    // After exhausting the search, repeatedly asking for a past-end
    // solution should always return None (not re-find earlier solutions).
    let puzzle =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
    let mut solver = SudokuBuilder::build(puzzle, &[], SHAPE_9X9).unwrap();

    let _ = solver.nth_solution(0, &mut |_| {});
    let r1 = solver.nth_solution(1, &mut |_| {});
    assert!(r1.solution.is_none(), "first past-end should be None");

    let r1b = solver.nth_solution(1, &mut |_| {});
    assert!(
        r1b.solution.is_none(),
        "repeated past-end should still be None"
    );

    let r5 = solver.nth_solution(5, &mut |_| {});
    assert!(r5.solution.is_none(), "far past-end should be None");
}

#[test]
fn test_nth_solution_after_solve() {
    // Calling solve() between nth_solution calls should not corrupt
    // the nth_solution sequence.
    let empty = ".".repeat(81);
    let mut solver = SudokuBuilder::build(&empty, &[], SHAPE_9X9).unwrap();

    let first = solver.nth_solution(0, &mut |_| {}).solution.unwrap();

    // Interleave with solve().
    let solve_result = solver.solve();
    assert!(solve_result.solution.is_some());

    // nth_solution should start fresh (solve cleared resume state).
    let again = solver.nth_solution(0, &mut |_| {}).solution.unwrap();
    assert_eq!(
        first, again,
        "nth_solution(0) should return same first solution"
    );
}

#[test]
fn test_nth_solution_backwards_resets() {
    // After finding solutions 0..4, going back to 0 should work.
    let empty = ".".repeat(81);
    let mut solver = SudokuBuilder::build(&empty, &[], SHAPE_9X9).unwrap();

    let first = solver.nth_solution(0, &mut |_| {}).solution.unwrap();
    let _ = solver.nth_solution(1, &mut |_| {});
    let _ = solver.nth_solution(2, &mut |_| {});

    // Go backwards.
    let again = solver.nth_solution(0, &mut |_| {}).solution.unwrap();
    assert_eq!(
        first, again,
        "going backwards should return the same solution"
    );
}

#[test]
fn test_nth_solution_then_solve_works() {
    // After using nth_solution, a regular solve() should still work
    // (starts fresh, not affected by resume state).
    let puzzle =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
    let mut solver = SudokuBuilder::build(puzzle, &[], SHAPE_9X9).unwrap();

    let _ = solver.nth_solution(0, &mut |_| {});
    let result = solver.solve();
    assert!(result.solution.is_some());
    assert_eq!(result.counters.solutions, 1);
}

#[test]
fn test_nth_solution_impossible() {
    // Two 1s in the same row → impossible.
    let mut puzzle = String::from("11");
    for _ in 0..79 {
        puzzle.push('.');
    }
    let mut solver = SudokuBuilder::build(&puzzle, &[], SHAPE_9X9).unwrap();
    let result = solver.nth_solution(0, &mut |_| {});
    assert!(result.solution.is_none());
}

// ===== nth_step tests =====

#[test]
fn test_nth_step_first() {
    // The hard puzzle requires guessing, so step 0 should exist.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let result = solver.nth_step(0, HashMap::new(), &mut |_| {});
    assert!(result.is_some(), "step 0 should exist for hard puzzle");
}

#[test]
fn test_nth_step_sequential() {
    // Sequential forward steps should return results.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let mut steps = Vec::new();
    for i in 0..5u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {});
        assert!(result.is_some(), "step {} should exist", i);
        steps.push(result.unwrap());
    }
    // Steps should be ordered (step types may vary).
    assert!(!steps.is_empty());
}

#[test]
fn test_nth_step_finds_solution() {
    // Stepping through the entire solve should eventually find a solution.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let mut found_solution = false;
    for i in 0..1000u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {});
        match result {
            Some(step) => {
                if step.step_type == StepType::Solution {
                    found_solution = true;
                    break;
                }
            }
            None => break,
        }
    }
    assert!(found_solution, "should find a solution by stepping");
}

#[test]
fn test_nth_step_finds_contradiction() {
    // Stepping through should encounter at least one contradiction
    // for a hard puzzle.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let mut found_contradiction = false;
    for i in 0..200u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {});
        match result {
            Some(step) => {
                if step.step_type == StepType::Contradiction {
                    found_contradiction = true;
                    break;
                }
            }
            None => break,
        }
    }
    assert!(
        found_contradiction,
        "should find a contradiction for hard puzzle"
    );
}

#[test]
fn test_nth_step_backward_resets() {
    // Going backwards should replay from the start.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let first = solver.nth_step(0, HashMap::new(), &mut |_| {}).unwrap();
    let _ = solver.nth_step(1, HashMap::new(), &mut |_| {});
    let _ = solver.nth_step(2, HashMap::new(), &mut |_| {});

    // Go backwards.
    let again = solver.nth_step(0, HashMap::new(), &mut |_| {}).unwrap();
    assert_eq!(
        first.step_type, again.step_type,
        "step type should match after reset"
    );
    assert_eq!(first.grid, again.grid, "grid should match after reset");
}

#[test]
fn test_nth_step_impossible_puzzle() {
    // Impossible puzzle (two 1s in the same row). The initial
    // contradiction is caught during propagation in run_impl, not
    // during build(). The solver may still yield some steps (e.g.
    // contradictions) but should NOT yield any solution steps.
    let mut puzzle = String::from("11");
    for _ in 0..79 {
        puzzle.push('.');
    }
    let mut solver = SudokuBuilder::build(&puzzle, &[], SHAPE_9X9).unwrap();
    for i in 0..100u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {});
        match result {
            Some(step) => {
                assert_ne!(
                    step.step_type,
                    StepType::Solution,
                    "impossible puzzle should never yield a solution step"
                );
            }
            None => break,
        }
    }
}

#[test]
fn test_nth_step_easy_puzzle_solution_only() {
    // An easy puzzle (no guessing needed) should yield a solution step
    // as the first step (or no steps at all if pure propagation).
    let mut solver = SudokuBuilder::build(EASY_PUZZLE, &[], SHAPE_9X9).unwrap();
    let result = solver.nth_step(0, HashMap::new(), &mut |_| {});
    // Easy puzzle: either no steps (pure propagation, no guesses)
    // or the first step is a solution.
    match result {
        None => {} // Valid — pure propagation
        Some(step) => {
            assert_eq!(
                step.step_type,
                StepType::Solution,
                "easy puzzle first step should be solution"
            );
        }
    }
}

#[test]
fn test_nth_step_interleaves_with_nth_solution() {
    // Switching between nth_solution and nth_step should work correctly.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();

    // Use nth_solution first.
    let sol = solver.nth_solution(0, &mut |_| {});
    assert!(sol.solution.is_some());

    // Switch to nth_step — should work.
    let step = solver.nth_step(0, HashMap::new(), &mut |_| {});
    assert!(step.is_some(), "step should work after nth_solution");

    // Switch back to nth_solution — should work.
    let sol2 = solver.nth_solution(0, &mut |_| {});
    assert!(
        sol2.solution.is_some(),
        "nth_solution should work after nth_step"
    );
}

#[test]
fn test_nth_step_same_index_always_same_result() {
    // Core correctness property: the same step index must always
    // produce the same output, regardless of navigation history.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();

    // Get steps 0..5.
    let mut first_pass = Vec::new();
    for i in 0..5u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {}).unwrap();
        first_pass.push(result);
    }

    // Now go backwards and forwards in various orders.
    let indices = [4, 2, 0, 3, 1, 4, 0];
    for &i in &indices {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {}).unwrap();
        assert_eq!(
            first_pass[i as usize].step_type, result.step_type,
            "step {} type mismatch after navigation",
            i
        );
        assert_eq!(
            first_pass[i as usize].grid, result.grid,
            "step {} grid mismatch after navigation",
            i
        );
        assert_eq!(
            first_pass[i as usize].old_grid, result.old_grid,
            "step {} old_grid mismatch after navigation",
            i
        );
        assert_eq!(
            first_pass[i as usize].branch_cells, result.branch_cells,
            "step {} branch_cells mismatch after navigation",
            i
        );
    }
}

#[test]
fn test_nth_step_has_branch_cells() {
    // For guess steps, branch_cells should be non-empty.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let mut found_guess = false;
    for i in 0..100u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {});
        match result {
            Some(step) if step.step_type == StepType::Guess => {
                assert!(
                    !step.branch_cells.is_empty(),
                    "guess step should have branch cells"
                );
                assert!(
                    step.guess_depth >= 0,
                    "guess step should have valid guess_depth"
                );
                found_guess = true;
                break;
            }
            None => break,
            _ => {}
        }
    }
    assert!(found_guess, "should find a guess step for hard puzzle");
}

#[test]
fn test_nth_step_past_end() {
    // After the search is exhausted, further steps should return None.
    let mut solver = SudokuBuilder::build(HARD_PUZZLE, &[], SHAPE_9X9).unwrap();
    let mut last_step = 0u64;
    for i in 0..10000u64 {
        let result = solver.nth_step(i, HashMap::new(), &mut |_| {});
        if result.is_none() {
            last_step = i;
            break;
        }
    }
    assert!(
        last_step > 0,
        "should have found some steps before exhaustion"
    );
    // Further requests should also return None.
    let result = solver.nth_step(last_step + 1, HashMap::new(), &mut |_| {});
    assert!(result.is_none(), "past-end should return None");
}
