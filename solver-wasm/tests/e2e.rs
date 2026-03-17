//! End-to-end integration tests — Rust port of tests/e2e/e2e.test.js.
//!
//! Test data is read directly from the JS data files in `data/` via
//! `include_str!`. A lightweight parser extracts `export const` values and
//! json5 handles single-quoted strings, trailing commas, and `//` comments.
//!
//! Two test categories mirror the JS suite:
//!
//! * **solve collections** — parse + build + solve each named puzzle and check
//!   the solution against the expected string (exact match, any, or none).
//! * **layout cases** — validate jigsaw/shape layouts by checking whether any
//!   solution exists (valid layouts) or none exists (invalid layouts).

use std::collections::HashMap;

use serde::Deserialize;
use solver_wasm::simple_solver::SimpleSolver;

// ---------------------------------------------------------------------------
// JS source parsing helpers
// ---------------------------------------------------------------------------

/// Pre-process JS source to convert template literals (backtick strings) into
/// single-quoted strings that json5 can parse. Lines inside template literals
/// are trimmed and concatenated (matching the JS runtime behaviour for these
/// data files). Single- and double-quoted strings are skipped so that backtick
/// characters inside them (e.g. TAREK_ALL entries) are not misinterpreted.
fn preprocess_template_literals(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            // Skip line comments — they may contain unmatched quotes.
            '/' if chars.peek() == Some(&'/') => {
                result.push('/');
                result.push(chars.next().unwrap()); // the second '/'
                for ch in chars.by_ref() {
                    result.push(ch);
                    if ch == '\n' {
                        break;
                    }
                }
            }
            // Skip block comments.
            '/' if chars.peek() == Some(&'*') => {
                result.push('/');
                result.push(chars.next().unwrap()); // the '*'
                let mut prev = ' ';
                for ch in chars.by_ref() {
                    result.push(ch);
                    if prev == '*' && ch == '/' {
                        break;
                    }
                    prev = ch;
                }
            }
            // Skip over single- or double-quoted strings verbatim.
            '\'' | '"' => {
                let quote = c;
                result.push(quote);
                loop {
                    match chars.next() {
                        Some('\\') => {
                            result.push('\\');
                            if let Some(esc) = chars.next() {
                                result.push(esc);
                            }
                        }
                        Some(ch) if ch == quote => {
                            result.push(quote);
                            break;
                        }
                        Some(ch) => result.push(ch),
                        None => break,
                    }
                }
            }
            // Convert template literal → single-quoted string.
            '`' => {
                let mut inner = String::new();
                for ch in chars.by_ref() {
                    if ch == '`' {
                        break;
                    }
                    inner.push(ch);
                }
                let processed: String =
                    inner.lines().map(|l| l.trim()).collect::<Vec<_>>().join("");
                result.push('\'');
                for ch in processed.chars() {
                    if ch == '\'' {
                        result.push('\\');
                    }
                    result.push(ch);
                }
                result.push('\'');
            }
            _ => result.push(c),
        }
    }
    result
}

/// Starting from an opening bracket (`[` or `{`), find the index *past* the
/// matching closing bracket — respecting nested brackets and string literals.
fn find_balanced_end(s: &str) -> usize {
    let bytes = s.as_bytes();
    let open = bytes[0];
    let close = match open {
        b'[' => b']',
        b'{' => b'}',
        _ => panic!("expected '[' or '{{', got {:?}", open as char),
    };
    let mut depth: usize = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b if b == open => {
                depth += 1;
                i += 1;
            }
            b if b == close => {
                depth -= 1;
                i += 1;
                if depth == 0 {
                    return i;
                }
            }
            // Skip single-quoted strings
            b'\'' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' {
                        i += 2;
                    } else if bytes[i] == b'\'' {
                        i += 1;
                        break;
                    } else {
                        i += 1;
                    }
                }
            }
            // Skip double-quoted strings
            b'"' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' {
                        i += 2;
                    } else if bytes[i] == b'"' {
                        i += 1;
                        break;
                    } else {
                        i += 1;
                    }
                }
            }
            // Skip line comments
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'/' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    panic!("unbalanced brackets");
}

/// Extract and deserialize `export const NAME = [...]` or `export const NAME = {{...}}`
/// from a JS source string. Handles template literals, single-quoted strings,
/// trailing commas, and `//` comments via pre-processing + json5.
fn parse_js_export<T: for<'de> Deserialize<'de>>(source: &str, export_name: &str) -> T {
    let preprocessed = preprocess_template_literals(source);
    let marker = format!("export const {} = ", export_name);
    let start = preprocessed
        .find(&marker)
        .unwrap_or_else(|| panic!("export '{}' not found", export_name))
        + marker.len();
    let rest = &preprocessed[start..];
    let end = find_balanced_end(rest);
    let literal = &rest[..end];
    json5::from_str(literal).unwrap_or_else(|e| {
        panic!(
            "failed to parse export '{}': {}\nfirst 200 chars: {:?}",
            export_name,
            e,
            &literal[..literal.len().min(200)]
        )
    })
}

/// Extract the inner string array from a JS helper-wrapped export like
/// `export const NAME = withHelper(arg, [...]);`
/// Returns the deserialized `Vec<String>` of the inner array.
fn parse_layout_strings(source: &str, export_name: &str) -> Vec<String> {
    let preprocessed = preprocess_template_literals(source);
    let marker = format!("export const {} = ", export_name);
    let start = preprocessed
        .find(&marker)
        .unwrap_or_else(|| panic!("export '{}' not found", export_name))
        + marker.len();
    let rest = &preprocessed[start..];
    // Find the first '[' (the inner array argument to the helper function).
    let arr_offset = rest
        .find('[')
        .unwrap_or_else(|| panic!("no '[' found in export '{}'", export_name));
    let arr_rest = &rest[arr_offset..];
    let end = find_balanced_end(arr_rest);
    let literal = &arr_rest[..end];
    json5::from_str(literal)
        .unwrap_or_else(|e| panic!("failed to parse layout array for '{}': {}", export_name, e))
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct Puzzle {
    name: Option<String>,
    input: String,
    #[serde(default)]
    solution: Option<String>,
}

struct TestCase {
    name: String,
    input: String,
    /// "any" — any solution is acceptable;
    /// "none" — no solution expected;
    /// anything else — exact solution string.
    expected: String,
}

// ---------------------------------------------------------------------------
// Data loading — reads JS data files directly via include_str!
// ---------------------------------------------------------------------------

fn load_puzzle_index() -> HashMap<String, Puzzle> {
    let example_src = include_str!("../../data/example_puzzles.js");
    let collection_src = include_str!("../../data/collections.js");

    let examples: Vec<Puzzle> = parse_js_export(example_src, "DISPLAYED_EXAMPLES");
    let collections: Vec<Puzzle> = parse_js_export(collection_src, "EXAMPLES");

    let mut map = HashMap::new();
    for p in examples.into_iter().chain(collections) {
        if let Some(ref name) = p.name {
            map.insert(name.clone(), p);
        }
    }
    map
}

fn build_solve_cases(index: &HashMap<String, Puzzle>) -> Vec<TestCase> {
    let names: &[&str] = &[
        // 9x9
        "Thermosudoku",
        "Classic sudoku",
        "Classic sudoku, hard",
        "Anti-knights move",
        "Killer sudoku",
        "Killer sudoku, with overlap",
        "Killer sudoku, with gaps",
        "Killer sudoku, with 0 cage",
        "Killer sudoku, with alldiff",
        "Sudoku X",
        "Anti-knight Anti-king",
        "Anti-knight Anti-consecutive",
        "Arrow sudoku",
        "Double arrow",
        "Pill arrow",
        "3-digit pill arrow",
        "Arrow killer sudoku",
        "Kropki sudoku",
        "Little killer",
        "Little killer - Sum",
        "Little killer 2",
        "Sandwich sudoku",
        "German whispers",
        "International whispers",
        "Renban",
        "Between lines",
        "Lockout lines",
        "Palindromes",
        "Modular lines",
        "Entropic connections",
        "Jigsaw",
        "Jigsaw boxes, disconnected",
        "Windoku",
        "X-Windoku",
        "Region sum lines",
        "XV-sudoku",
        "XV-kropki",
        "Strict kropki",
        "Strict XV",
        "Hailstone (easier) - little killer",
        "X-Sum little killer",
        "Skyscraper",
        "Skyscraper - all 6",
        "Global entropy",
        "Global mod 3",
        "Odd even",
        "Quadruple X",
        "Quadruple - repeated values",
        "Odd-even thermo",
        "Nabner thermo - easy",
        "Knight-arrows",
        "Zipper lines - tutorial",
        "Sum lines",
        "Sum lines, with loop",
        "Sum lines - long loop",
        "Long sums 3",
        "Indexing",
        "2D 1-5-9",
        "Full rank",
        "Duplicate cell sums",
        "Lunchbox",
        "Killer lunchboxes, resolved",
        "Hidden skyscrapers",
        "Unbidden First Hidden",
        "Look-and-say",
        "Counting circles",
        "Bubble Tornado",
        "Anti-taxicab",
        "Dutch Flatmates",
        "Fortress sudoku",
        "Equality cages",
        "Regex line",
        "Sequence sudoku",
        "NFA: Equal sum parition",
        "Full rank - 6 clue snipe",
        "Irregular region sum line",
        "Embedded Squishdoku",
        "Force non-unit coeff",
        "Event horizon",
        "Copycat, easy",
        "Clone sudoku",
        "Slingshot sudoku",
        "Numbered Rooms vs X-Sums",
        "Or with Givens",
        "And with AllDifferent",
        "Or with AllDifferent",
        "Elided And and Or",
        "Contain At Least",
        // 16x16
        "16x16",
        "16x16: Sudoku X",
        "16x16: Sudoku X, hard",
        "16x16: Jigsaw",
        // Other sizes
        "6x6",
        "6x6: Numbered rooms",
        "6x6: Between Odd and Even",
        "6x6: Little Killer",
        "4x4: Counting circles",
        "6x6: Rellik cages",
        "6x6: Successor Arrows",
        "6x6: Full rank",
        "4x4: Full Rank - no ties",
        "4x4: Full Rank - with ties",
        "4x4: Full Rank - unclued ties",
        "4x4: Full Rank - tied clues",
        // Non-square grids
        "6x8: Plain",
        "5x10: Killer Sudoku",
        "6x9: Postcard",
        "4x7: Jigsaw",
        "4x6: Skyscraper",
        "9x8: Plain boxless",
        "5x5: Squishtroquadri",
        "7x7: Killer Squishdoku",
        "6x6: Con-set-cutive",
        "7x7: Skyscraper Squishdoku",
        "7x7: Numbered Rooms Squishdoku",
        "6x6: Hidden Hostility",
        "6x6: Order from Chaos",
        "6x6: Irregular Quadro Quadri",
        "7x7: Dutch Flat Mate Squishdoku",
        "7x7: Buggy NR Squishdoku",
        "6x6: 9-value disjoint sets",
        // 0-indexed
        "0-indexed: Classic sudoku",
        "0-indexed: Sudoku X",
        "0-indexed: Anti-knight Anti-king",
        "0-indexed: Jigsaw",
        "0-indexed: Windoku",
        "0-indexed: Odd even",
        "0-indexed: 6x6",
        "0-indexed: 4x4 Full Rank",
        "0-indexed: 6x8 Plain",
        "0-indexed: 4x7 Jigsaw",
        "0-indexed: 9x8 Plain boxless",
        "0-indexed: 6x6 9-value disjoint sets",
        "0-indexed: Thermo SameValues",
        "0-indexed: Whisper GreaterThan",
        "0-indexed: 0-sensitive pairwise",
        "0-indexed: 0-8 Killer",
        "0-indexed: Killer sudoku, with 0 cage, hard",
        "0-indexed: Region sum lines",
        "0-indexed: A very full quiver",
        "0-indexed: Lets build a snowman",
        "0-indexed: +-Information",
        "0-indexed: Hidden skyscrapers",
        "0-indexed: Quadruple X",
        "0-indexed: Look-and-say",
        "0-indexed: Equality cages",
        "0-indexed: Skyscraper",
        "0-indexed: Counting circles",
        "0-indexed: Sequence sudoku",
        "0-indexed: Regex line",
        "0-indexed: Sums and indexing",
    ];

    names
        .iter()
        .map(|&name| {
            let puzzle = index
                .get(name)
                .unwrap_or_else(|| panic!("puzzle '{}' not found in data", name));
            let expected = match &puzzle.solution {
                Some(sol) => sol.clone(),
                None => "any".to_string(),
            };
            TestCase {
                name: name.to_string(),
                input: puzzle.input.clone(),
                expected,
            }
        })
        .collect()
}

fn build_layout_cases() -> Vec<TestCase> {
    let jigsaw_src = include_str!("../../data/jigsaw_layouts.js");
    let box_src = include_str!("../../data/jigsaw_box_layouts.js");

    let valid: Vec<String> = parse_layout_strings(jigsaw_src, "VALID_JIGSAW_LAYOUTS");
    let easy_invalid: Vec<String> = parse_layout_strings(jigsaw_src, "EASY_INVALID_JIGSAW_LAYOUTS");
    let fast_invalid: Vec<String> = parse_layout_strings(jigsaw_src, "FAST_INVALID_JIGSAW_LAYOUTS");
    let valid_box: Vec<String> = parse_layout_strings(box_src, "VALID_JIGSAW_BOX_LAYOUTS");

    let mut cases = Vec::new();

    // VALID_JIGSAW_LAYOUTS.slice(0, 20)
    // Bare jigsaw layout strings are passed directly, matching JS which
    // parses them via `_parseJigsawLayoutToAst`.
    for (i, raw) in valid.iter().take(20).enumerate() {
        cases.push(TestCase {
            name: format!("VALID_JIGSAW_LAYOUTS[{}]", i),
            input: raw.clone(),
            expected: "any".to_string(),
        });
    }

    // All EASY_INVALID_JIGSAW_LAYOUTS
    for (i, raw) in easy_invalid.iter().enumerate() {
        cases.push(TestCase {
            name: format!("EASY_INVALID_JIGSAW_LAYOUTS[{}]", i),
            input: raw.clone(),
            expected: "none".to_string(),
        });
    }

    // FAST_INVALID_JIGSAW_LAYOUTS.slice(0, 20)
    for (i, raw) in fast_invalid.iter().take(20).enumerate() {
        cases.push(TestCase {
            name: format!("FAST_INVALID_JIGSAW_LAYOUTS[{}]", i),
            input: raw.clone(),
            expected: "none".to_string(),
        });
    }

    // VALID_JIGSAW_BOX_LAYOUTS.slice(0, 10)
    for (i, raw) in valid_box.iter().take(10).enumerate() {
        cases.push(TestCase {
            name: format!("VALID_JIGSAW_BOX_LAYOUTS[{}]", i),
            input: format!(".Jigsaw~{}", raw),
            expected: "any".to_string(),
        });
    }

    // Non-standard grid Shape tests (hardcoded, matching JS e2e test).
    for (input, name) in [
        (".Shape~7x7", "Shape_7x7"),
        (".Shape~6x6~9", "Shape_6x6_9"),
        (".Shape~6x6~9.NoBoxes", "Shape_6x6_9_NoBoxes"),
        (".Shape~6x6~9.RegionSize~6", "Shape_6x6_9_RegionSize6"),
        (".Shape~7x6~9", "Shape_7x6_9"),
        (".Shape~7x6~9.RegionSize~7", "Shape_7x6_9_RegionSize7"),
    ] {
        cases.push(TestCase {
            name: name.to_string(),
            input: input.to_string(),
            expected: "any".to_string(),
        });
    }

    cases
}

// ---------------------------------------------------------------------------
// Helper: run one case and assert the expected outcome.
// ---------------------------------------------------------------------------

fn assert_case(case: &TestCase, result: Result<Option<String>, String>) {
    let result =
        result.unwrap_or_else(|e| panic!("Puzzle '{}' failed to build/parse: {}", case.name, e));

    match case.expected.as_str() {
        "none" => {
            assert!(
                result.is_none(),
                "Puzzle '{}': expected no solution but got {}",
                case.name,
                result.unwrap_or_default()
            );
        }
        "any" => {
            assert!(
                result.is_some(),
                "Puzzle '{}': expected a solution but got none",
                case.name
            );
        }
        expected_str => {
            let got = result.unwrap_or_else(|| {
                panic!(
                    "Puzzle '{}': expected solution {} but got none",
                    case.name, expected_str
                )
            });
            assert_eq!(got, expected_str, "Puzzle '{}': wrong solution", case.name);
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Solve all named puzzles from the four JS collections (9×9, 16×16,
/// Other sizes, Non-square grids) and verify each solution.
///
/// Mirrors JS: `solver.solutions(input, 2)` → take first.
#[test]
fn test_solve_collections() {
    let index = load_puzzle_index();
    let cases = build_solve_cases(&index);
    let mut solver = SimpleSolver::new();
    for case in &cases {
        eprintln!("Testing: {}", case.name);
        let result = solver
            .solutions(&case.input, Some(2))
            .map(|sols| sols.into_iter().next().map(|s| s.to_string()));
        assert_case(case, result);
    }
}

/// Validate jigsaw / shape layout inputs: valid layouts must yield a
/// solution; invalid layouts must yield none.
///
/// Mirrors JS: `solver.validateLayout(input)`.
#[test]
fn test_layout_cases() {
    let cases = build_layout_cases();
    let mut solver = SimpleSolver::new();
    for case in &cases {
        eprintln!("Testing: {}", case.name);
        let result = solver
            .validate_layout(&case.input)
            .map(|opt| opt.map(|s| s.to_string()));
        assert_case(case, result);
    }
}
