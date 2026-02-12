use solver_wasm::grid::Grid;
use solver_wasm::solver::Solver;
use std::env;
use std::process;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: solver-cli <command> [args...]");
        eprintln!();
        eprintln!("Commands:");
        eprintln!("  solve <puzzle>     Solve an 81-character puzzle string");
        eprintln!("  bench <puzzle>     Benchmark solving (not yet implemented)");
        process::exit(1);
    }

    match args[1].as_str() {
        "solve" => cmd_solve(&args[2..]),
        "bench" => {
            eprintln!("bench not yet implemented");
            process::exit(1);
        }
        other => {
            eprintln!("Unknown command: {}", other);
            process::exit(1);
        }
    }
}

fn cmd_solve(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli solve <puzzle>");
        process::exit(1);
    }

    let puzzle = &args[0];
    let grid = match Grid::from_str(puzzle) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };

    println!("Input:");
    println!("{}", grid);

    let mut solver = match Solver::new(puzzle) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error building solver: {}", e);
            process::exit(1);
        }
    };

    let start = Instant::now();
    let result = solver.solve();
    let elapsed = start.elapsed();

    match result.solution {
        Some(sol) => {
            let sol_grid = Grid { cells: sol };
            println!("Solution:");
            println!("{}", sol_grid);
            println!("String: {}", sol_grid.to_string());
        }
        None => {
            println!("No solution found.");
        }
    }

    println!();
    println!("Stats:");
    println!("  Time:          {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    println!("  Solutions:     {}", result.counters.solutions);
    println!("  Guesses:       {}", result.counters.guesses);
    println!("  Backtracks:    {}", result.counters.backtracks);
    println!("  Values tried:  {}", result.counters.values_tried);
    println!("  Constraints:   {}", result.counters.constraints_processed);
}
