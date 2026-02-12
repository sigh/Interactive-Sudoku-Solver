use solver_wasm::constraint_parser;
use solver_wasm::grid::Grid;
use solver_wasm::solver::Solver;
use solver_wasm::CageInput;
use std::env;
use std::fs;
use std::process;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    match args[1].as_str() {
        "solve" => cmd_solve(&args[2..]),
        "bench" => cmd_bench(&args[2..]),
        "dump" => cmd_dump(&args[2..]),
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
    eprintln!("  solve <input> [--cages <file.json>]   Solve a puzzle");
    eprintln!("  bench <input> [--cages <file.json>] [--iterations N]   Benchmark");
    eprintln!("  dump <input> [--cages <file.json>]    Dump handler setup (debug)");
    eprintln!();
    eprintln!("Input formats:");
    eprintln!("  81-character puzzle   '1'-'9' for givens, '.' for empty");
    eprintln!("  Constraint string     JS URL format: .~R1C1_5.Cage~15~R1C3~R1C4~R1C5");
    eprintln!("  Compact killer        81-char direction-pointer format");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --cages <file>  JSON file with cage definitions:");
    eprintln!("                  [{{\"cells\": [0,1], \"sum\": 3}}, ...]");
    eprintln!("  --iterations N  Number of benchmark iterations (default: 100)");
}

/// Parse --cages <file.json> from args, returning cage data and remaining args.
fn parse_cages(args: &[String]) -> (Vec<(Vec<u8>, i32)>, Vec<String>) {
    let mut cages = Vec::new();
    let mut remaining = Vec::new();
    let mut i = 0;

    while i < args.len() {
        if args[i] == "--cages" {
            i += 1;
            if i >= args.len() {
                eprintln!("Error: --cages requires a file argument");
                process::exit(1);
            }
            let path = &args[i];
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error reading {}: {}", path, e);
                    process::exit(1);
                }
            };
            let cage_inputs: Vec<CageInput> = match serde_json::from_str(&content) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error parsing cages from {}: {}", path, e);
                    process::exit(1);
                }
            };
            for cage in &cage_inputs {
                let cells: Vec<u8> = cage.cells.iter().map(|&c| c as u8).collect();
                cages.push((cells, cage.sum));
            }
        } else {
            remaining.push(args[i].clone());
        }
        i += 1;
    }

    (cages, remaining)
}

/// Parse the input string and any --cages flag into a puzzle + cages pair.
fn parse_input(puzzle_str: &str, extra_cages: &[(Vec<u8>, i32)]) -> (String, Vec<(Vec<u8>, i32)>) {
    // Try the constraint parser first.
    match constraint_parser::parse(puzzle_str) {
        Ok(parsed) => {
            let mut cages = parsed.cages;
            cages.extend(extra_cages.iter().cloned());
            (parsed.puzzle, cages)
        }
        Err(e) => {
            eprintln!("Error parsing input: {}", e);
            process::exit(1);
        }
    }
}

fn cmd_solve(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli solve <input> [--cages <file.json>]");
        process::exit(1);
    }

    let input = &args[0];
    let (extra_cages, _remaining) = parse_cages(&args[1..]);
    let (puzzle, cages) = parse_input(input, &extra_cages);

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
    if !cages.is_empty() {
        println!("Cages: {}", cages.len());
    }

    let start = Instant::now();

    let (result, counters) = if cages.is_empty() {
        let mut solver = match Solver::new(&puzzle) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Error building solver: {}", e);
                process::exit(1);
            }
        };
        let r = solver.solve();
        let c = r.counters.clone();
        (r, c)
    } else {
        let mut solver = match Solver::with_cages(&puzzle, &cages) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Error building solver: {}", e);
                process::exit(1);
            }
        };
        let r = solver.solve();
        let c = r.counters.clone();
        (r, c)
    };

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
    println!("  Solutions:     {}", counters.solutions);
    println!("  Guesses:       {}", counters.guesses);
    println!("  Backtracks:    {}", counters.backtracks);
    println!("  Values tried:  {}", counters.values_tried);
    println!("  Constraints:   {}", counters.constraints_processed);
}

fn cmd_bench(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli bench <input> [--cages <file.json>] [--iterations N]");
        process::exit(1);
    }

    let input = &args[0];
    let (extra_cages, remaining) = parse_cages(&args[1..]);

    // Parse --iterations.
    let mut iterations: usize = 100;
    let mut i = 0;
    while i < remaining.len() {
        if remaining[i] == "--iterations" {
            i += 1;
            if i >= remaining.len() {
                eprintln!("Error: --iterations requires a number");
                process::exit(1);
            }
            iterations = match remaining[i].parse() {
                Ok(n) => n,
                Err(_) => {
                    eprintln!("Error: --iterations value must be a positive integer");
                    process::exit(1);
                }
            };
        }
        i += 1;
    }

    let (puzzle, cages) = parse_input(input, &extra_cages);

    // Validate puzzle.
    if let Err(e) = Grid::from_str(&puzzle) {
        eprintln!("Error: {}", e);
        process::exit(1);
    }

    println!(
        "Benchmarking: {} iterations{}",
        iterations,
        if cages.is_empty() {
            "".to_string()
        } else {
            format!(" ({} cages)", cages.len())
        }
    );

    let mut times = Vec::with_capacity(iterations);
    let mut last_counters = None;

    for _ in 0..iterations {
        let start = Instant::now();

        let counters = if cages.is_empty() {
            let mut solver = Solver::new(&puzzle).unwrap();
            let r = solver.solve();
            r.counters
        } else {
            let mut solver = Solver::with_cages(&puzzle, &cages).unwrap();
            let r = solver.solve();
            r.counters
        };

        times.push(start.elapsed());
        last_counters = Some(counters);
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

fn cmd_dump(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli dump <input> [--cages <file.json>]");
        process::exit(1);
    }

    let input = &args[0];
    let (extra_cages, _remaining) = parse_cages(&args[1..]);
    let (puzzle, cages) = parse_input(input, &extra_cages);

    let mut solver = if cages.is_empty() {
        Solver::new(&puzzle).unwrap_or_else(|e| {
            eprintln!("Error: {}", e);
            process::exit(1);
        })
    } else {
        Solver::with_cages(&puzzle, &cages).unwrap_or_else(|e| {
            eprintln!("Error: {}", e);
            process::exit(1);
        })
    };

    solver.dump_handlers();

    // Also solve and print counters
    println!();
    println!("=== Running solver ===");
    let result = solver.solve();
    println!("Solution found: {}", result.solution.is_some());
    println!(
        "Counters: backtracks={} guesses={} valuesTried={} constraints={}",
        result.counters.backtracks,
        result.counters.guesses,
        result.counters.values_tried,
        result.counters.constraints_processed,
    );
}
