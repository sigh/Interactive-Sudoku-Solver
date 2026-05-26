use solver_wasm::simple_solver::SimpleSolver;
use std::env;
use std::process;
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    match args[1].as_str() {
        "solve" => cmd_solve(&args[2..]),
        "count" => cmd_count(&args[2..]),
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
    eprintln!("  count <input> [--limit N]    Count solutions (0/unset = unlimited)");
    eprintln!("  all-possibilities <input> [--threshold N]");
    eprintln!("                               Find all possible values per cell");
    eprintln!("  bench <input> [--iterations N] [--warmups N]");
    eprintln!("                [--mode solution|count] [--json]");
    eprintln!();
    eprintln!("Input formats:");
    eprintln!("  81-character puzzle   '1'-'9' for givens, '.' for empty");
    eprintln!("  Constraint string     JS URL format: .~R1C1_5.Cage~15~R1C3~R1C4~R1C5");
    eprintln!("  Compact killer        81-char direction-pointer format");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --limit N      Maximum solutions to count (default/unset: unlimited)");
    eprintln!("  --threshold N   Candidate support threshold for all-possibilities (1-255)");
    eprintln!("  --iterations N  Number of benchmark iterations (default: 100)");
    eprintln!("  --warmups N     Number of untimed warmup iterations (default: 0)");
    eprintln!("  --mode MODE     Benchmark mode: solution or count (default: solution)");
    eprintln!("  --json          Emit benchmark output as JSON");
}

fn cmd_solve(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli solve <input>");
        process::exit(1);
    }

    let input = &args[0];
    let mut solver = SimpleSolver::new();

    let start = Instant::now();
    let solution = match solver.solution(input) {
        Ok(sol) => sol,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };
    let elapsed = start.elapsed();

    match solution {
        Some(sol) => {
            println!("Solution: {}", sol);
        }
        None => {
            println!("No solution found.");
        }
    }

    if let Some(counters) = solver.latest_counters() {
        println!();
        println!("Stats:");
        println!("  Time:          {:.3} ms", elapsed.as_secs_f64() * 1000.0);
        println!("  Solutions:     {}", counters.solutions);
        println!("  Guesses:       {}", counters.guesses);
        println!("  Backtracks:    {}", counters.backtracks);
        println!("  Values tried:  {}", counters.values_tried);
        println!("  Constraints:   {}", counters.constraints_processed);
    }
}

fn cmd_count(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli count <input> [--limit N]");
        process::exit(1);
    }

    let input = &args[0];
    let mut limit: Option<u64> = None;
    let mut i = 1;
    while i < args.len() {
        if let Some(inline_value) = option_value(args[i].as_str(), "--limit") {
            let value = take_option_value(args, &mut i, "--limit", inline_value);
            limit = Some(parse_u64_arg("--limit", value));
        } else {
            eprintln!("Error: unknown count option: {}", args[i]);
            process::exit(1);
        }
        i += 1;
    }

    let start = Instant::now();
    let mut solver = SimpleSolver::new();
    let count = match solver.count_solutions(input, limit) {
        Ok(count) => count,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };
    let elapsed = start.elapsed();

    println!("Solutions: {}", count);

    if let Some(counters) = solver.latest_counters() {
        println!();
        println!("Stats:");
        println!("  Time:          {:.3} ms", elapsed.as_secs_f64() * 1000.0);
        println!("  Setup:         {:.3} ms", solver.setup_time_ms());
        println!("  Runtime:       {:.3} ms", solver.runtime_ms());
        println!("  Guesses:       {}", counters.guesses);
        println!("  Backtracks:    {}", counters.backtracks);
        println!("  Values tried:  {}", counters.values_tried);
        println!("  Nodes:         {}", counters.nodes_searched);
        println!("  Constraints:   {}", counters.constraints_processed);
    }
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

    println!("Threshold: {}", threshold);

    let start = Instant::now();
    let mut solver = SimpleSolver::new();
    let tc = match solver.true_candidates(input, threshold) {
        Ok(tc) => tc,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };
    let elapsed = start.elapsed();

    match tc {
        Some(tc) => {
            println!();
            println!("Solutions found: {}", tc.witness_solutions().len());
            println!();

            // Display candidate counts as a grid of pencilmark sets.
            let shape = tc.shape();
            let num_values = shape.num_values as usize;
            let num_cols = shape.num_cols as usize;
            let num_rows = shape.num_cells / num_cols;
            let base_char = shape.base_char_code();
            for row in 0..num_rows {
                for col in 0..num_cols {
                    let cell = row * num_cols + col;
                    let mut vals = String::new();
                    for v in 0..num_values {
                        if tc.count_at(cell, (v + 1) as u8) >= threshold {
                            vals.push((base_char + v as u8) as char);
                        }
                    }
                    if vals.is_empty() {
                        vals = ".".to_string();
                    }
                    print!("{:<10}", vals);
                }
                println!();
            }
        }
        None => {
            println!("No solutions found.");
        }
    }

    if let Some(counters) = solver.latest_counters() {
        println!();
        println!("Stats:");
        println!("  Time:          {:.3} ms", elapsed.as_secs_f64() * 1000.0);
        println!("  Solutions:     {}", counters.solutions);
        println!("  Guesses:       {}", counters.guesses);
        println!("  Backtracks:    {}", counters.backtracks);
        println!("  Values tried:  {}", counters.values_tried);
        println!("  Constraints:   {}", counters.constraints_processed);
    }
}

fn cmd_bench(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: solver-cli bench <input> [--iterations N] [--warmups N] [--mode solution|count] [--json]");
        process::exit(1);
    }

    let input = &args[0];
    let options = parse_bench_options(&args[1..]);

    let mut solver = SimpleSolver::new();

    for _ in 0..options.warmups {
        if let Err(e) = run_bench_iteration(&mut solver, input, options.mode) {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    }

    let mut times = Vec::with_capacity(options.iterations);
    let mut setup_times = Vec::with_capacity(options.iterations);
    let mut runtime_times = Vec::with_capacity(options.iterations);
    let mut last_outcome = BenchOutcome::None;

    for _ in 0..options.iterations {
        let result = run_bench_iteration(&mut solver, input, options.mode).unwrap_or_else(|e| {
            eprintln!("Error: {}", e);
            process::exit(1);
        });
        times.push(result.elapsed);
        setup_times.push(result.setup_ms);
        runtime_times.push(result.runtime_ms);
        last_outcome = result.outcome;
    }

    let total = summarize_durations(&times);
    let setup = summarize_f64(&setup_times);
    let runtime = summarize_f64(&runtime_times);
    let counters = solver.latest_counters().map(|counters| CountersSnapshot {
        solutions: counters.solutions,
        guesses: counters.guesses,
        backtracks: counters.backtracks,
        values_tried: counters.values_tried,
        nodes_searched: counters.nodes_searched,
        branches_ignored: counters.branches_ignored,
        constraints_processed: counters.constraints_processed,
    });

    if options.json {
        print_bench_json(
            options,
            &last_outcome,
            &total,
            &setup,
            &runtime,
            counters.as_ref(),
        );
        return;
    }

    println!("Benchmarking: {} measured iteration(s)", options.iterations);
    println!("Mode: {}", options.mode.as_str());
    if options.warmups > 0 {
        println!("Warmups: {}", options.warmups);
    }

    println!();
    println!("Results ({} iterations):", options.iterations);
    print_duration_summary("Total", &total);
    print_f64_summary("Setup", &setup);
    print_f64_summary("Runtime", &runtime);

    println!();
    println!("Last result: {}", last_outcome.display());

    if let Some(counters) = solver.latest_counters() {
        println!();
        println!("Solver stats (last run):");
        println!("  Solutions:     {}", counters.solutions);
        println!("  Guesses:       {}", counters.guesses);
        println!("  Backtracks:    {}", counters.backtracks);
        println!("  Values tried:  {}", counters.values_tried);
        println!("  Nodes:         {}", counters.nodes_searched);
        println!("  Constraints:   {}", counters.constraints_processed);
    }
}

#[derive(Clone, Copy)]
enum BenchMode {
    Solution,
    Count,
}

impl BenchMode {
    fn as_str(self) -> &'static str {
        match self {
            BenchMode::Solution => "solution",
            BenchMode::Count => "count",
        }
    }
}

#[derive(Clone, Copy)]
struct BenchOptions {
    iterations: usize,
    warmups: usize,
    mode: BenchMode,
    json: bool,
}

enum BenchOutcome {
    None,
    Solution(Option<String>),
    Count(u64),
}

impl BenchOutcome {
    fn display(&self) -> String {
        match self {
            BenchOutcome::None => "none".to_string(),
            BenchOutcome::Solution(Some(solution)) => format!("solution={}", solution),
            BenchOutcome::Solution(None) => "solution=null".to_string(),
            BenchOutcome::Count(count) => format!("count={}", count),
        }
    }
}

struct BenchIteration {
    elapsed: Duration,
    setup_ms: f64,
    runtime_ms: f64,
    outcome: BenchOutcome,
}

struct DurationSummary {
    min: Duration,
    median: Duration,
    mean: Duration,
    p95: Duration,
    max: Duration,
    total: Duration,
}

struct F64Summary {
    min: f64,
    median: f64,
    mean: f64,
    p95: f64,
    max: f64,
}

struct CountersSnapshot {
    solutions: u64,
    guesses: u64,
    backtracks: u64,
    values_tried: u64,
    nodes_searched: u64,
    branches_ignored: f64,
    constraints_processed: u64,
}

fn parse_bench_options(args: &[String]) -> BenchOptions {
    let mut options = BenchOptions {
        iterations: 100,
        warmups: 0,
        mode: BenchMode::Solution,
        json: false,
    };

    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if let Some(inline_value) = option_value(arg, "--iterations") {
            let value = take_option_value(args, &mut i, "--iterations", inline_value);
            options.iterations = parse_positive_usize_arg("--iterations", value);
        } else if let Some(inline_value) = option_value(arg, "--warmups") {
            let value = take_option_value(args, &mut i, "--warmups", inline_value);
            options.warmups = parse_usize_arg("--warmups", value);
        } else if let Some(inline_value) = option_value(arg, "--mode") {
            let value = take_option_value(args, &mut i, "--mode", inline_value);
            options.mode = parse_bench_mode(value);
        } else if arg == "--json" {
            options.json = true;
        } else {
            eprintln!("Error: unknown bench option: {}", arg);
            process::exit(1);
        }
        i += 1;
    }

    options
}

fn option_value<'a>(arg: &'a str, flag: &str) -> Option<Option<&'a str>> {
    if arg == flag {
        return Some(None);
    }
    arg.strip_prefix(flag)
        .and_then(|rest| rest.strip_prefix('='))
        .map(Some)
}

fn take_option_value<'a>(
    args: &'a [String],
    index: &mut usize,
    flag: &str,
    inline_value: Option<&'a str>,
) -> &'a str {
    if let Some(value) = inline_value {
        return value;
    }
    *index += 1;
    if *index >= args.len() {
        eprintln!("Error: {} requires a value", flag);
        process::exit(1);
    }
    &args[*index]
}

fn parse_bench_mode(value: &str) -> BenchMode {
    match value {
        "solution" | "solve" | "first" => BenchMode::Solution,
        "count" | "count-solutions" | "proof" => BenchMode::Count,
        other => {
            eprintln!("Error: unknown bench mode: {}", other);
            process::exit(1);
        }
    }
}

fn parse_usize_arg(flag: &str, value: &str) -> usize {
    match value.parse() {
        Ok(n) => n,
        Err(_) => {
            eprintln!("Error: {} value must be a non-negative integer", flag);
            process::exit(1);
        }
    }
}

fn parse_positive_usize_arg(flag: &str, value: &str) -> usize {
    let n = parse_usize_arg(flag, value);
    if n == 0 {
        eprintln!("Error: {} value must be greater than zero", flag);
        process::exit(1);
    }
    n
}

fn parse_u64_arg(flag: &str, value: &str) -> u64 {
    match value.parse() {
        Ok(n) => n,
        Err(_) => {
            eprintln!("Error: {} value must be a non-negative integer", flag);
            process::exit(1);
        }
    }
}

fn run_bench_iteration(
    solver: &mut SimpleSolver,
    input: &str,
    mode: BenchMode,
) -> Result<BenchIteration, String> {
    let start = Instant::now();
    let outcome = match mode {
        BenchMode::Solution => {
            BenchOutcome::Solution(solver.solution(input)?.map(|solution| solution.to_string()))
        }
        BenchMode::Count => BenchOutcome::Count(solver.count_solutions(input, None)?),
    };
    Ok(BenchIteration {
        elapsed: start.elapsed(),
        setup_ms: solver.setup_time_ms(),
        runtime_ms: solver.runtime_ms(),
        outcome,
    })
}

fn summarize_durations(times: &[Duration]) -> DurationSummary {
    let mut sorted = times.to_vec();
    sorted.sort();
    let total: Duration = times.iter().sum();
    let mean = total.div_f64(times.len() as f64);
    DurationSummary {
        min: sorted[0],
        median: median_duration(&sorted),
        mean,
        p95: sorted[p95_index(sorted.len())],
        max: sorted[sorted.len() - 1],
        total,
    }
}

fn summarize_f64(values: &[f64]) -> F64Summary {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let sum: f64 = values.iter().sum();
    F64Summary {
        min: sorted[0],
        median: median_f64(&sorted),
        mean: sum / values.len() as f64,
        p95: sorted[p95_index(sorted.len())],
        max: sorted[sorted.len() - 1],
    }
}

fn median_duration(sorted: &[Duration]) -> Duration {
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]).div_f64(2.0)
    }
}

fn median_f64(sorted: &[f64]) -> f64 {
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        sorted[mid]
    } else {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    }
}

fn p95_index(len: usize) -> usize {
    ((len as f64 * 0.95).floor() as usize).min(len - 1)
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn print_duration_summary(label: &str, summary: &DurationSummary) {
    println!("{}:", label);
    println!("  Min:     {:.3} ms", duration_ms(summary.min));
    println!("  Median:  {:.3} ms", duration_ms(summary.median));
    println!("  Mean:    {:.3} ms", duration_ms(summary.mean));
    println!("  P95:     {:.3} ms", duration_ms(summary.p95));
    println!("  Max:     {:.3} ms", duration_ms(summary.max));
    println!("  Total:   {:.3} ms", duration_ms(summary.total));
}

fn print_f64_summary(label: &str, summary: &F64Summary) {
    println!("{}:", label);
    println!("  Min:     {:.3} ms", summary.min);
    println!("  Median:  {:.3} ms", summary.median);
    println!("  Mean:    {:.3} ms", summary.mean);
    println!("  P95:     {:.3} ms", summary.p95);
    println!("  Max:     {:.3} ms", summary.max);
}

fn print_bench_json(
    options: BenchOptions,
    outcome: &BenchOutcome,
    total: &DurationSummary,
    setup: &F64Summary,
    runtime: &F64Summary,
    counters: Option<&CountersSnapshot>,
) {
    println!("{{");
    println!("  \"mode\": \"{}\",", options.mode.as_str());
    println!("  \"warmups\": {},", options.warmups);
    println!("  \"iterations\": {},", options.iterations);
    match outcome {
        BenchOutcome::None => println!("  \"result\": null,"),
        BenchOutcome::Solution(Some(solution)) => {
            println!(
                "  \"result\": {{ \"solution\": \"{}\" }},",
                json_escape(solution)
            );
        }
        BenchOutcome::Solution(None) => println!("  \"result\": {{ \"solution\": null }},"),
        BenchOutcome::Count(count) => println!("  \"result\": {{ \"count\": {} }},", count),
    }
    print_duration_summary_json("totalMs", total, true);
    print_f64_summary_json("setupMs", setup, true);
    print_f64_summary_json("runtimeMs", runtime, counters.is_some());
    if let Some(counters) = counters {
        println!("  \"counters\": {{");
        println!("    \"solutions\": {},", counters.solutions);
        println!("    \"guesses\": {},", counters.guesses);
        println!("    \"backtracks\": {},", counters.backtracks);
        println!("    \"valuesTried\": {},", counters.values_tried);
        println!("    \"nodesSearched\": {},", counters.nodes_searched);
        println!("    \"branchesIgnored\": {:.6},", counters.branches_ignored);
        println!(
            "    \"constraintsProcessed\": {}",
            counters.constraints_processed
        );
        println!("  }}");
    }
    println!("}}");
}

fn print_duration_summary_json(name: &str, summary: &DurationSummary, trailing_comma: bool) {
    let comma = if trailing_comma { "," } else { "" };
    println!(
        "  \"{}\": {{ \"min\": {:.6}, \"median\": {:.6}, \"mean\": {:.6}, \"p95\": {:.6}, \"max\": {:.6}, \"total\": {:.6} }}{}",
        name,
        duration_ms(summary.min),
        duration_ms(summary.median),
        duration_ms(summary.mean),
        duration_ms(summary.p95),
        duration_ms(summary.max),
        duration_ms(summary.total),
        comma,
    );
}

fn print_f64_summary_json(name: &str, summary: &F64Summary, trailing_comma: bool) {
    let comma = if trailing_comma { "," } else { "" };
    println!(
        "  \"{}\": {{ \"min\": {:.6}, \"median\": {:.6}, \"mean\": {:.6}, \"p95\": {:.6}, \"max\": {:.6} }}{}",
        name, summary.min, summary.median, summary.mean, summary.p95, summary.max, comma,
    );
}

fn json_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
