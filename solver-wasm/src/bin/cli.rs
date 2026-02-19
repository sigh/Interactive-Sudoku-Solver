use solver_wasm::constraint::builder::SudokuBuilder;
use solver_wasm::constraint::parser as constraint_parser;
use solver_wasm::grid::Grid;
use solver_wasm::grid_shape::GridShape;
use std::env;
use std::process;
use std::str::FromStr;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    match args[1].as_str() {
        "solve" => cmd_solve(&args[2..]),
        "all-possibilities" => cmd_all_possibilities(&args[2..]),
        "bench" => cmd_bench(&args[2..]),
        "help" | "--help" | "-h" => print_usage(),
        other => {
            eprintln!("Unknown command: {}", other);
            eprintln!();
            print_usage();
            process::exit(1);
        }
    }
}

fn print_usage() {
    eprintln!("Usage: solver-cli <command> [args...]");
    eprintln!();
    eprintln!("Commands:");
    eprintln!("  solve <input>                Solve a puzzle");
    eprintln!("  all-possibilities <input> [--threshold N]");
    eprintln!("                               Find all possible values per cell");
    eprintln!("  bench <input> [--iterations N]   Benchmark");
    eprintln!();
    eprintln!("Input formats:");
    eprintln!("  81-character puzzle   '1'-'9' for givens, '.' for empty");
    eprintln!("  Constraint string     JS URL format: .~R1C1_5.Cage~15~R1C3~R1C4~R1C5");
    eprintln!("  Compact killer        81-char direction-pointer format");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --threshold N   Candidate support threshold for all-possibilities (1-255)");
    eprintln!("  --iterations N  Number of benchmark iterations (default: 100)");
}

/// Parse the input string into a puzzle + constraints pair.
fn parse_input(input_str: &str) -> (String, Vec<solver_wasm::constraint::Constraint>, GridShape) {
    match constraint_parser::parse(input_str) {
        Ok(parsed) => (parsed.puzzle, parsed.constraints, parsed.shape),
        Err(e) => {
            eprintln!("Error parsing input: {}", e);
            process::exit(1);
        }
    }
}

fn cmd_solve(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli solve <input>");
        process::exit(1);
    }

    let input = &args[0];
    let (puzzle, constraints, shape) = parse_input(input);

    // Validate puzzle.
    let grid = match Grid::from_str(&puzzle) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };

    println!("Input:");
    println!("{}", grid);
    if !constraints.is_empty() {
        println!("Constraints: {}", constraints.len());
    }

    let start = Instant::now();

    let mut solver = match SudokuBuilder::build(&puzzle, &constraints, shape) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error building solver: {}", e);
            process::exit(1);
        }
    };
    let result = solver.solve();
    let counters = result.counters.clone();

    let elapsed = start.elapsed();

    match result.solution {
        Some(sol) => {
            let sol_grid = Grid { cells: sol };
            println!("Solution:");
            println!("{}", sol_grid);
            println!("String: {}", sol_grid.to_puzzle_string());
        }
        None => {
            println!("No solution found.");
        }
    }

    println!();
    println!("Stats:");
    println!("  Time:          {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    println!("  Solutions:     {}", counters.solutions);
    println!("  Guesses:       {}", counters.guesses);
    println!("  Backtracks:    {}", counters.backtracks);
    println!("  Values tried:  {}", counters.values_tried);
    println!("  Constraints:   {}", counters.constraints_processed);
}

fn cmd_all_possibilities(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli all-possibilities <input> [--threshold N]");
        process::exit(1);
    }

    let input = &args[0];

    // Parse --threshold.
    let mut threshold: u8 = 1;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--threshold" {
            i += 1;
            if i >= args.len() {
                eprintln!("Error: --threshold requires a number (1-255)");
                process::exit(1);
            }
            threshold = match args[i].parse() {
                Ok(n) if n >= 1 => n,
                _ => {
                    eprintln!("Error: --threshold value must be 1-255");
                    process::exit(1);
                }
            };
        }
        i += 1;
    }

    let (puzzle, constraints, shape) = parse_input(input);

    // Validate puzzle.
    let grid = match Grid::from_str(&puzzle) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };

    println!("Input:");
    println!("{}", grid);
    if !constraints.is_empty() {
        println!("Constraints: {}", constraints.len());
    }
    println!("Threshold: {}", threshold);

    let start = Instant::now();

    let mut solver = SudokuBuilder::build(&puzzle, &constraints, shape).unwrap_or_else(|e| {
        eprintln!("Error building solver: {}", e);
        process::exit(1);
    });

    let result = solver.solve_all_possibilities(threshold, &mut |_| {});

    let elapsed = start.elapsed();

    println!();
    println!("Solutions found: {}", result.counters.solutions);
    println!();

    // Display candidate counts as a 9x9 grid of pencilmark sets.
    let counts = &result.candidate_counts;
    println!("Candidate counts (per cell, per value):");
    for row in 0..9 {
        for col in 0..9 {
            let cell = row * 9 + col;
            let mut vals = String::new();
            for v in 0..9 {
                let count = counts[cell * 9 + v];
                if count >= threshold {
                    vals.push((b'1' + v as u8) as char);
                }
            }
            if vals.is_empty() {
                vals = ".".to_string();
            }
            print!("{:<10}", vals);
        }
        println!();
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

fn cmd_bench(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli bench <input> [--iterations N]");
        process::exit(1);
    }

    let input = &args[0];

    // Parse --iterations.
    let mut iterations: usize = 100;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--iterations" {
            i += 1;
            if i >= args.len() {
                eprintln!("Error: --iterations requires a number");
                process::exit(1);
            }
            iterations = match args[i].parse() {
                Ok(n) => n,
                Err(_) => {
                    eprintln!("Error: --iterations value must be a positive integer");
                    process::exit(1);
                }
            };
        }
        i += 1;
    }

    let (puzzle, constraints, shape) = parse_input(input);

    // Validate puzzle.
    if let Err(e) = Grid::from_str(&puzzle) {
        eprintln!("Error: {}", e);
        process::exit(1);
    }

    println!(
        "Benchmarking: {} iterations{}",
        iterations,
        if constraints.is_empty() {
            "".to_string()
        } else {
            format!(" ({} constraints)", constraints.len())
        }
    );

    let mut times = Vec::with_capacity(iterations);
    let mut last_counters = None;

    for _ in 0..iterations {
        let start = Instant::now();

        let mut solver = SudokuBuilder::build(&puzzle, &constraints, shape).unwrap();
        let r = solver.solve();

        times.push(start.elapsed());
        last_counters = Some(r.counters);
    }

    // Sort for percentile calculations.
    times.sort();
    let to_ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;

    let min = to_ms(times[0]);
    let median = to_ms(times[iterations / 2]);
    let p95 = to_ms(times[(iterations as f64 * 0.95) as usize]);
    let total: std::time::Duration = times.iter().sum();
    let mean = to_ms(total) / iterations as f64;

    println!();
    println!("Results ({} iterations):", iterations);
    println!("  Min:     {:.3} ms", min);
    println!("  Median:  {:.3} ms", median);
    println!("  Mean:    {:.3} ms", mean);
    println!("  P95:     {:.3} ms", p95);
    println!("  Total:   {:.3} ms", to_ms(total));

    if let Some(counters) = last_counters {
        println!();
        println!("Solver stats (last run):");
        println!("  Solutions:     {}", counters.solutions);
        println!("  Guesses:       {}", counters.guesses);
        println!("  Backtracks:    {}", counters.backtracks);
        println!("  Values tried:  {}", counters.values_tried);
        println!("  Constraints:   {}", counters.constraints_processed);
    }
}
