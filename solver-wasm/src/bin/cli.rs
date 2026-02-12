use solver_wasm::grid::Grid;
use std::env;
use std::process;

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

    // TODO: Actually solve in Sprint 1
    println!("Solver not yet implemented.");
}
