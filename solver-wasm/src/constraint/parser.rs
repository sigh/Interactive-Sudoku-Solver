//! Parser for JS-compatible constraint strings.
//!
//! Parses the URL-serialized constraint format used by the Interactive Sudoku
//! Solver's JavaScript frontend. This allows the CLI and WASM interface to
//! accept the same puzzle strings used in the web UI.
//!
//! ## Supported Formats
//!
//! **Plain sudoku:** 81-character string, digits 1-9 for givens, `.` or `0` for empty.
//!
//! **Verbose constraint string:** Dot-prefixed tokens separated by `.`:
//!   - `.~R1C1_5~R2C3_7` — Givens (empty type name)
//!   - `.Cage~15~R1C3~R1C4~R1C5` — Killer cage with sum
//!
//! **Compact killer format:** 81-character string with direction pointers.
//!   Head cells encode the cage sum (0-9, A-Z=10-35, a-j=36-45).
//!   Non-head cells are direction arrows: `<>^v` and diagonals `` ` ' , . ``
//!   pointing to the cage head (transitively).

use super::Constraint;
use crate::api::types::{CellIndex, Value};
use crate::grid_shape::GridShape;

/// Parsed constraint data: constraint list + grid shape.
///
/// Givens are represented as [`Constraint::Given`] entries in `constraints`,
/// matching the JS architecture where the parser produces `Given` AST nodes
/// and the builder converts them to `GivenCandidates` handlers.
#[derive(Debug, Clone)]
pub struct ParsedConstraints {
    /// High-level constraints parsed from the input (including givens).
    pub constraints: Vec<Constraint>,
    /// Grid shape (dimensions and num_values).
    pub shape: GridShape,
}

/// Convert puzzle characters into [`Constraint::Given`] entries.
///
/// Each non-empty character becomes a `Given` constraint with the cell ID
/// and decoded value. '.' and '0' are skipped (empty cells).
fn puzzle_chars_to_givens(
    chars: impl Iterator<Item = (usize, char)>,
    shape: GridShape,
    constraints: &mut Vec<Constraint>,
) -> Result<(), String> {
    let base = shape.base_char_code();
    for (i, ch) in chars {
        match ch {
            '0' | '.' => {}
            _ => {
                let b = ch as u8;
                if b >= base && b < base + shape.num_values {
                    let value = b - base + 1;
                    constraints.push(Constraint::Given {
                        cell: shape.cell_id_from_index(i),
                        values: vec![value],
                    });
                } else {
                    return Err(format!("invalid character '{}' at position {}", ch, i));
                }
            }
        }
    }
    Ok(())
}

/// Convert a solution (1-based values per cell) into a puzzle string.
///
/// Matches JS `toShortSolution()` in sudoku_parser.js. Solved cells are
/// written as their character (e.g. '1'-'9' for 9×9, 'A'-'P' for 16×16).
/// Unsolved cells (value 0) are written as '.'.
pub fn to_short_solution(solution: &[u8], shape: GridShape) -> String {
    let base = shape.base_char_code();
    solution
        .iter()
        .take(shape.num_cells)
        .map(|&v| {
            if v > 0 {
                char::from(base + v - 1)
            } else {
                '.'
            }
        })
        .collect()
}

/// Parse a constraint string in any supported format.
///
/// Returns the parsed constraints and shape.
pub fn parse(input: &str) -> Result<ParsedConstraints, String> {
    let input = input.trim();

    if input.is_empty() {
        // Empty input is valid — it represents a cleared grid with the
        // default shape (9×9) and no constraints. This matches the JS
        // behaviour where Shape.serialize() returns '' for the default
        // shape, so a cleared grid serializes to an empty string.
        return Ok(ParsedConstraints {
            constraints: vec![],
            shape: GridShape::default_9x9(),
        });
    }

    // Strip all whitespace (including internal newlines) for multi-line formats.
    let stripped: String = input.chars().filter(|c| !c.is_whitespace()).collect();

    // Try the Jigsaw combined format (grid values + layout, no ISS prefix).
    // Mirrors JS: `_parseJigsawToAst(text)` where text is whitespace-stripped.
    if let Ok(result) = try_parse_jigsaw_combined(&stripped) {
        return Ok(result);
    }

    // Try bare jigsaw layout (N chars, exactly numValues distinct chars
    // each appearing numValues times, no givens).
    // Mirrors JS: `_parseJigsawLayoutToAst(text)`.
    if let Ok(result) = try_parse_jigsaw_layout(&stripped) {
        return Ok(result);
    }

    // If it starts with '.', try verbose constraint string format (ISS).
    if stripped.starts_with('.') {
        return parse_verbose(&stripped);
    }

    // Infer shape from input length (only square grids).
    let shape = GridShape::from_num_cells(stripped.len()).ok_or_else(|| {
        format!(
            "Unrecognized format: input length {} is not a perfect square \
             and does not start with '.'",
            stripped.len()
        )
    })?;

    // Check if it looks like compact killer (has direction chars).
    if is_compact_killer(&stripped) {
        return parse_compact_killer(&stripped, shape);
    }

    // Otherwise, treat as plain sudoku.
    let mut constraints = Vec::new();
    puzzle_chars_to_givens(stripped.chars().enumerate(), shape, &mut constraints)?;
    Ok(ParsedConstraints { constraints, shape })
}

/// Try to parse the combined Jigsaw format: first N chars are grid values,
/// next N chars are the jigsaw region layout.
///
/// Mirrors JS `SudokuParser._parseJigsawToAst(text)`.
///
/// Returns `Ok(ParsedConstraints)` if the input matches this format exactly,
/// or `Err(())` if the format is not recognised (no message needed — the
/// caller falls through to other formats).
fn try_parse_jigsaw_combined(text: &str) -> Result<ParsedConstraints, ()> {
    let len = text.len();
    if len % 2 != 0 {
        return Err(());
    }
    let n = len / 2;
    let shape = GridShape::from_num_cells(n).ok_or(())?;
    let base = shape.base_char_code();
    let nv = shape.num_values;

    let grid_part = &text[..n];
    let layout_part = &text[n..];

    // Validate grid part: only '.' and the shape's value characters.
    if !grid_part
        .chars()
        .all(|c| c == '.' || (c as u8 >= base && (c as u8) < base + nv))
    {
        return Err(());
    }

    // Validate layout part: exactly `nv` distinct characters each appearing `nv` times.
    // Mirrors JS `_parseJigsawLayoutToAst`: `chars.size !== numValues` and
    // `Object.values(counter).some(c => c !== numValues)`.
    let mut counts: std::collections::BTreeMap<char, usize> = std::collections::BTreeMap::new();
    for ch in layout_part.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    if counts.len() != nv as usize {
        return Err(());
    }
    if counts.values().any(|&c| c != nv as usize) {
        return Err(());
    }

    // Build constraints: NoBoxes + givens from grid part + Jigsaw regions.
    //
    // Givens come before Jigsaw regions, matching JS where _parseJigsawToAst
    // returns AstNode.makeRoot(Shape, Given, ...Jigsaw).
    let mut constraints = vec![Constraint::NoBoxes];
    puzzle_chars_to_givens(grid_part.chars().enumerate(), shape, &mut constraints)
        .map_err(|_| ())?;

    // Build Jigsaw regions from layout.
    let mut regions: std::collections::BTreeMap<char, Vec<String>> =
        std::collections::BTreeMap::new();
    let nc = shape.num_cols as usize;
    for (i, ch) in layout_part.chars().enumerate() {
        let r = i / nc;
        let c = i % nc;
        regions
            .entry(ch)
            .or_default()
            .push(shape.make_cell_id(r as u8, c as u8));
    }
    let grid_spec = format!("{}x{}", shape.num_rows, shape.num_cols);
    for (_ch, cells) in regions {
        constraints.push(Constraint::Jigsaw {
            grid_spec: grid_spec.clone(),
            cells,
        });
    }

    Ok(ParsedConstraints { constraints, shape })
}

/// Try to parse a bare jigsaw layout: N chars defining region assignments.
///
/// Mirrors JS `SudokuParser._parseJigsawLayoutToAst(text)`. Validates that
/// the string has exactly `numValues` distinct characters, each appearing
/// exactly `numValues` times.
fn try_parse_jigsaw_layout(text: &str) -> Result<ParsedConstraints, ()> {
    let n = text.len();
    let shape = GridShape::from_num_cells(n).ok_or(())?;
    let nv = shape.num_values;

    // Validate: exactly nv distinct chars, each appearing nv times.
    let mut counts: std::collections::BTreeMap<char, usize> = std::collections::BTreeMap::new();
    for ch in text.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    if counts.len() != nv as usize {
        return Err(());
    }
    if counts.values().any(|&c| c != nv as usize) {
        return Err(());
    }

    // Build constraints: NoBoxes + Jigsaw regions (no givens).
    let mut constraints = vec![Constraint::NoBoxes];
    let nc = shape.num_cols as usize;
    let mut regions: std::collections::BTreeMap<char, Vec<String>> =
        std::collections::BTreeMap::new();
    for (i, ch) in text.chars().enumerate() {
        let r = i / nc;
        let c = i % nc;
        regions
            .entry(ch)
            .or_default()
            .push(shape.make_cell_id(r as u8, c as u8));
    }
    let grid_spec = format!("{}x{}", shape.num_rows, shape.num_cols);
    for (_ch, cells) in regions {
        constraints.push(Constraint::Jigsaw {
            grid_spec: grid_spec.clone(),
            cells,
        });
    }

    Ok(ParsedConstraints { constraints, shape })
}

/// Check if an 81-char string looks like compact killer format.
///
/// Compact killer strings contain direction arrows and sum-encoding chars.
/// Plain sudoku strings contain only digits 0-9 and '.'.
fn is_compact_killer(input: &str) -> bool {
    input
        .chars()
        .any(|c| matches!(c, '<' | '>' | '^' | 'v' | '`' | '\'' | ',' | 'A'..='Z' | 'a'..='j'))
}

/// Parse registry: maps constraint type names to parse functions.
struct ConstraintDef {
    name: &'static str,
    parse: fn(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String>,
}

/// All supported constraint types and their parse functions.
const CONSTRAINT_DEFS: &[ConstraintDef] = &[
    ConstraintDef {
        name: "Cage",
        parse: parse_cage,
    },
    ConstraintDef {
        name: "Sum",
        parse: parse_sum,
    },
    ConstraintDef {
        name: "AllDifferent",
        parse: parse_all_different,
    },
    ConstraintDef {
        name: "Thermo",
        parse: parse_thermo,
    },
    ConstraintDef {
        name: "Whisper",
        parse: parse_whisper,
    },
    ConstraintDef {
        name: "Renban",
        parse: parse_renban,
    },
    ConstraintDef {
        name: "Palindrome",
        parse: parse_palindrome,
    },
    ConstraintDef {
        name: "Arrow",
        parse: parse_arrow,
    },
    ConstraintDef {
        name: "DoubleArrow",
        parse: parse_double_arrow,
    },
    ConstraintDef {
        name: "Between",
        parse: parse_between,
    },
    ConstraintDef {
        name: "LittleKiller",
        parse: parse_little_killer,
    },
    ConstraintDef {
        name: "Diagonal",
        parse: parse_diagonal,
    },
    ConstraintDef {
        name: "WhiteDot",
        parse: parse_white_dot,
    },
    ConstraintDef {
        name: "BlackDot",
        parse: parse_black_dot,
    },
    ConstraintDef {
        name: "GreaterThan",
        parse: parse_greater_than,
    },
    ConstraintDef {
        name: "X",
        parse: parse_x,
    },
    ConstraintDef {
        name: "V",
        parse: parse_v,
    },
    ConstraintDef {
        name: "AntiKnight",
        parse: parse_anti_knight,
    },
    ConstraintDef {
        name: "AntiKing",
        parse: parse_anti_king,
    },
    ConstraintDef {
        name: "AntiConsecutive",
        parse: parse_anti_consecutive,
    },
    ConstraintDef {
        name: "NoBoxes",
        parse: parse_no_boxes,
    },
    ConstraintDef {
        name: "Pair",
        parse: parse_pair,
    },
    ConstraintDef {
        name: "PairX",
        parse: parse_pair_x,
    },
    ConstraintDef {
        name: "Zipper",
        parse: parse_zipper,
    },
    ConstraintDef {
        name: "StrictKropki",
        parse: parse_strict_kropki,
    },
    ConstraintDef {
        name: "StrictXV",
        parse: parse_strict_xv,
    },
    ConstraintDef {
        name: "Windoku",
        parse: parse_windoku,
    },
    ConstraintDef {
        name: "DisjointSets",
        parse: parse_disjoint_sets,
    },
    ConstraintDef {
        name: "PillArrow",
        parse: parse_pill_arrow,
    },
    ConstraintDef {
        name: "RegionSumLine",
        parse: parse_region_sum_line,
    },
    ConstraintDef {
        name: "RegionSize",
        parse: parse_region_size,
    },
    ConstraintDef {
        name: "Regex",
        parse: parse_regex,
    },
    ConstraintDef {
        name: "NFA",
        parse: parse_nfa,
    },
    ConstraintDef {
        name: "Entropic",
        parse: parse_entropic,
    },
    ConstraintDef {
        name: "Modular",
        parse: parse_modular,
    },
    ConstraintDef {
        name: "AntiTaxicab",
        parse: parse_anti_taxicab,
    },
    ConstraintDef {
        name: "Jigsaw",
        parse: parse_jigsaw,
    },
    // No-ops: parsed and ignored (no handler needed).
    ConstraintDef {
        name: "Container",
        parse: parse_noop,
    },
    ConstraintDef {
        name: "End",
        parse: parse_noop,
    },
    ConstraintDef {
        name: "FullRank",
        parse: parse_full_rank,
    },
    ConstraintDef {
        name: "FullRankTies",
        parse: parse_full_rank_ties,
    },
    // Legacy aliases for Pair/PairX with base64url key conversion.
    ConstraintDef {
        name: "Binary",
        parse: parse_binary,
    },
    ConstraintDef {
        name: "BinaryX",
        parse: parse_binary_x,
    },
    // Handlers wired to builder.
    ConstraintDef {
        name: "ContainAtLeast",
        parse: parse_contain_at_least,
    },
    ConstraintDef {
        name: "ContainExact",
        parse: parse_contain_exact,
    },
    ConstraintDef {
        name: "Quad",
        parse: parse_quad,
    },
    ConstraintDef {
        name: "Priority",
        parse: parse_priority,
    },
    // Newly wired handlers.
    ConstraintDef {
        name: "Lockout",
        parse: parse_lockout,
    },
    ConstraintDef {
        name: "DutchFlatmates",
        parse: parse_dutch_flatmates,
    },
    ConstraintDef {
        name: "ValueIndexing",
        parse: parse_value_indexing,
    },
    ConstraintDef {
        name: "NumberedRoom",
        parse: parse_numbered_room,
    },
    ConstraintDef {
        name: "Indexing",
        parse: parse_indexing,
    },
    ConstraintDef {
        name: "GlobalEntropy",
        parse: parse_global_entropy,
    },
    ConstraintDef {
        name: "GlobalMod",
        parse: parse_global_mod,
    },
    ConstraintDef {
        name: "SumLine",
        parse: parse_sum_line,
    },
    ConstraintDef {
        name: "CountingCircles",
        parse: parse_counting_circles,
    },
    ConstraintDef {
        name: "SameValues",
        parse: parse_same_values,
    },
    ConstraintDef {
        name: "RegionSameValues",
        parse: parse_region_same_values,
    },
    ConstraintDef {
        name: "Sandwich",
        parse: parse_sandwich,
    },
    ConstraintDef {
        name: "Lunchbox",
        parse: parse_lunchbox,
    },
    ConstraintDef {
        name: "Skyscraper",
        parse: parse_skyscraper,
    },
    ConstraintDef {
        name: "HiddenSkyscraper",
        parse: parse_hidden_skyscraper,
    },
    ConstraintDef {
        name: "RellikCage",
        parse: parse_rellik_cage,
    },
    ConstraintDef {
        name: "EqualityCage",
        parse: parse_equality_cage,
    },
    ConstraintDef {
        name: "XSum",
        parse: parse_xsum,
    },
];

/// Parse verbose constraint string format.
///
/// Format: `.Type~arg1~arg2...` tokens concatenated. Uses a registry
/// to dispatch each constraint type to its parse function.
///
/// Supports nested composite types: `.Or.InnerA~x.InnerB~y.End` and
/// `.And.InnerA~x.InnerB~y.End`.
fn parse_verbose(input: &str) -> Result<ParsedConstraints, String> {
    let parts: Vec<&str> = input.split('.').map(str::trim).collect();

    // First pass: scan for a `.Shape~NxM` token to determine grid shape.
    let mut shape = GridShape::default_9x9();
    for part in parts.iter().skip(1) {
        if part.is_empty() {
            continue;
        }
        let tokens: Vec<&str> = part.split('~').collect();
        if !tokens.is_empty() && tokens[0] == "Shape" {
            let spec = tokens[1..].join("~");
            shape = GridShape::from_grid_spec(&spec)?;
            break;
        }
    }

    let mut constraints: Vec<Constraint> = Vec::new();

    // Second pass: index-based to support consuming nested Or/And blocks.
    let mut idx = 1usize;
    while idx < parts.len() {
        let part = parts[idx];
        idx += 1;

        if part.is_empty() {
            continue;
        }

        let tokens: Vec<&str> = part.split('~').collect();
        if tokens.is_empty() {
            continue;
        }

        let constraint_type = tokens[0];
        let args = &tokens[1..];

        // Skip the Shape token (already consumed).
        if constraint_type == "Shape" {
            continue;
        }

        if constraint_type.is_empty() {
            parse_givens(args, &mut constraints, shape)?;
            continue;
        }

        // Composite types consume subsequent tokens up to a matching End.
        if constraint_type == "Or" || constraint_type == "And" {
            let (inner, consumed) = parse_nested_block(&parts[idx..], shape)?;
            idx += consumed;
            if constraint_type == "Or" {
                // Or branches are alternatives — do not merge across them.
                constraints.push(Constraint::Or {
                    groups: inner.into_iter().map(|c| vec![c]).collect(),
                });
            } else {
                // And: merge duplicates within the block.
                constraints.push(Constraint::And {
                    constraints: merge_by_uniqueness(inner),
                });
            }
            continue;
        }

        // Jigsaw needs the grid shape for correct cell ID generation.
        if constraint_type == "Jigsaw" {
            parse_jigsaw_with_shape(args, &mut constraints, shape)?;
            continue;
        }

        match CONSTRAINT_DEFS.iter().find(|d| d.name == constraint_type) {
            Some(def) => (def.parse)(args, &mut constraints)?,
            None => {
                return Err(format!(
                    "Unsupported constraint type: '{}'. \
                     The WASM solver does not handle this constraint.",
                    constraint_type
                ));
            }
        }
    }

    // Merge top-level constraints (mirrors JS `_mergeByUniqueness` in `_resolveNodes`).
    let constraints = merge_by_uniqueness(constraints);

    Ok(ParsedConstraints { constraints, shape })
}

/// Parse inner constraint parts of an `Or` or `And` block, stopping when an
/// unmatched `End` token is consumed (or the slice is exhausted).
///
/// Returns `(inner_constraints, number_of_parts_consumed)`.
/// The count *includes* the `End` token when found.
fn parse_nested_block(
    parts: &[&str],
    shape: GridShape,
) -> Result<(Vec<Constraint>, usize), String> {
    let mut constraints: Vec<Constraint> = Vec::new();
    let mut idx = 0usize;

    while idx < parts.len() {
        let part = parts[idx];
        idx += 1;

        if part.is_empty() {
            continue;
        }

        let tokens: Vec<&str> = part.split('~').collect();
        if tokens.is_empty() {
            continue;
        }

        let constraint_type = tokens[0];
        let args = &tokens[1..];

        // End terminates this block.
        if constraint_type == "End" {
            return Ok((constraints, idx));
        }

        if constraint_type == "Shape" {
            continue;
        }

        // Empty constraint type = given values inside a nested block.
        // Mirrors JS: `SudokuParser` converts "" type into `Given` constraints.
        if constraint_type.is_empty() {
            for &arg in args {
                if arg.is_empty() {
                    continue;
                }
                match parse_given_arg(arg, shape) {
                    Ok((cell_id, _, values)) => {
                        constraints.push(Constraint::Given {
                            cell: cell_id,
                            values,
                        });
                    }
                    Err(_) => {} // Skip invalid givens silently.
                }
            }
            continue;
        }

        // Nested composite: recurse.
        if constraint_type == "Or" || constraint_type == "And" {
            let (inner, consumed) = parse_nested_block(&parts[idx..], shape)?;
            idx += consumed;
            if constraint_type == "Or" {
                // Or branches are alternatives — do not merge across them.
                constraints.push(Constraint::Or {
                    groups: inner.into_iter().map(|c| vec![c]).collect(),
                });
            } else {
                // And: merge duplicates within the block.
                constraints.push(Constraint::And {
                    constraints: merge_by_uniqueness(inner),
                });
            }
            continue;
        }

        // Jigsaw needs the grid shape for correct cell ID generation.
        if constraint_type == "Jigsaw" {
            parse_jigsaw_with_shape(args, &mut constraints, shape)?;
            continue;
        }

        match CONSTRAINT_DEFS.iter().find(|d| d.name == constraint_type) {
            Some(def) => (def.parse)(args, &mut constraints)?,
            None => {
                return Err(format!(
                    "Unsupported constraint type in nested block: '{}'. \
                     The WASM solver does not handle this constraint.",
                    constraint_type
                ));
            }
        }
    }

    // No End found — reached end of input; return what we have.
    // Note: parse_nested_block is always called as the inner block of an Or or And.
    // The caller applies merge_by_uniqueness for And; Or skips merging.
    Ok((constraints, idx))
}

// ====================================================================
// Deduplication / merging (mirrors JS `_mergeByUniqueness`)
// ====================================================================

/// Deduplicate / merge a list of constraints by their uniqueness keys.
///
/// Mirrors JS `SudokuParser._mergeByUniqueness(constraints)`.
fn merge_by_uniqueness(constraints: Vec<Constraint>) -> Vec<Constraint> {
    use std::collections::HashMap;

    let mut key_to_index: HashMap<String, usize> = HashMap::new();
    // Use Option<Constraint> so we can take() without cloning.
    let mut result: Vec<Option<Constraint>> = Vec::with_capacity(constraints.len());

    for constraint in constraints {
        match constraint.uniqueness_key() {
            None => result.push(Some(constraint)),
            Some(key) => {
                if let Some(&idx) = key_to_index.get(&key) {
                    let existing = result[idx].take().unwrap();
                    result[idx] = Some(Constraint::merge(existing, constraint));
                } else {
                    key_to_index.insert(key, result.len());
                    result.push(Some(constraint));
                }
            }
        }
    }

    result.into_iter().flatten().collect()
}

// ====================================================================
// Givens (special case: also writes to puzzle string)
// ====================================================================

/// Parse given constraints (`.~R1C1_5~R2C3_7`).
///
/// All givens become [`Constraint::Given`] entries, matching the JS
/// architecture where `SudokuConstraint.Given.makeFromArgs` yields
/// individual `Given` instances for all value IDs.
fn parse_givens(
    args: &[&str],
    constraints: &mut Vec<Constraint>,
    shape: GridShape,
) -> Result<(), String> {
    for &arg in args {
        if arg.is_empty() {
            continue;
        }
        let (cell_id, cell_idx, values) = parse_given_arg(arg, shape)?;
        if cell_idx < shape.num_cells {
            constraints.push(Constraint::Given {
                cell: cell_id,
                values,
            });
        }
    }
    Ok(())
}

// ====================================================================
// Per-constraint parse functions
// ====================================================================

fn parse_cage(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Cage constraint missing sum".to_string());
    }
    let sum: i32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid cage sum: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::Cage { cells, sum });
    }
    Ok(())
}

fn parse_sum(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Sum constraint missing sum".to_string());
    }
    let sum: i32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid sum: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::Sum {
            cells,
            sum,
            coeffs: None,
        });
    }
    Ok(())
}

fn parse_all_different(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if !cells.is_empty() {
        constraints.push(Constraint::AllDifferent { cells });
    }
    Ok(())
}

fn parse_thermo(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Thermo { cells });
    }
    Ok(())
}

fn parse_whisper(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Whisper constraint missing cells".to_string());
    }
    // The difference is optional. German whisper lines omit it (default = 5).
    // If the first argument is a finite number, treat it as the difference;
    // otherwise default to 5 and treat all arguments as cells.
    let (difference, cell_args) = match args[0].parse::<i32>() {
        Ok(d) => (d, &args[1..]),
        Err(_) => (5, args),
    };
    let cells = collect_cell_args(cell_args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Whisper { cells, difference });
    }
    Ok(())
}

fn parse_renban(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Renban { cells });
    }
    Ok(())
}

fn parse_palindrome(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Palindrome { cells });
    }
    Ok(())
}

fn parse_arrow(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Arrow { cells });
    }
    Ok(())
}

fn parse_double_arrow(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 3 {
        constraints.push(Constraint::DoubleArrow { cells });
    }
    Ok(())
}

fn parse_between(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 3 {
        constraints.push(Constraint::Between { cells });
    }
    Ok(())
}

fn parse_little_killer(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Err("LittleKiller constraint requires sum and arrow cell".to_string());
    }
    let sum: i32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid LittleKiller sum: {}", args[0]))?;
    let arrow_cell = args[1].to_string();
    constraints.push(Constraint::LittleKiller { sum, arrow_cell });
    Ok(())
}

fn parse_diagonal(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let direction: i32 = if args.is_empty() {
        1
    } else {
        args[0]
            .parse()
            .map_err(|_| format!("Invalid diagonal direction: {}", args[0]))?
    };
    constraints.push(Constraint::Diagonal { direction });
    Ok(())
}

fn parse_white_dot(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::WhiteDot { cells });
    }
    Ok(())
}

fn parse_black_dot(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::BlackDot { cells });
    }
    Ok(())
}

fn parse_greater_than(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::GreaterThan { cells });
    }
    Ok(())
}

fn parse_x(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::XClue { cells });
    }
    Ok(())
}

fn parse_v(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::VClue { cells });
    }
    Ok(())
}

fn parse_anti_knight(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::AntiKnight);
    Ok(())
}

fn parse_anti_king(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::AntiKing);
    Ok(())
}

fn parse_anti_consecutive(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::AntiConsecutive);
    Ok(())
}

fn parse_no_boxes(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::NoBoxes);
    Ok(())
}

/// Parse Pair/PairX/Binary/BinaryX grouped cell lists.
///
/// Items can be:
/// - Empty string `""`: group separator (same key, new group)
/// - Starting with `_`: name marker (group label, skipped)
/// - Starting with `R` or `r`: cell ID
///
/// Mirrors JS `SudokuConstraint.Pair.makeFromArgs`.
fn parse_pair_groups(key: &str, items: &[&str], pairwise: bool, constraints: &mut Vec<Constraint>) {
    let mut current_cells: Vec<String> = Vec::new();
    for &item in items {
        if !item.is_empty() && item.as_bytes()[0].to_ascii_uppercase() == b'R' {
            current_cells.push(item.to_string());
        } else {
            if current_cells.len() >= 2 {
                if pairwise {
                    constraints.push(Constraint::PairX {
                        key: key.to_string(),
                        cells: current_cells.clone(),
                    });
                } else {
                    constraints.push(Constraint::Pair {
                        key: key.to_string(),
                        cells: current_cells.clone(),
                    });
                }
            }
            current_cells.clear();
        }
    }
    if current_cells.len() >= 2 {
        if pairwise {
            constraints.push(Constraint::PairX {
                key: key.to_string(),
                cells: current_cells,
            });
        } else {
            constraints.push(Constraint::Pair {
                key: key.to_string(),
                cells: current_cells,
            });
        }
    }
}

fn parse_pair(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Pair constraint missing key".to_string());
    }
    parse_pair_groups(args[0], &args[1..], false, constraints);
    Ok(())
}

fn parse_pair_x(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("PairX constraint missing key".to_string());
    }
    parse_pair_groups(args[0], &args[1..], true, constraints);
    Ok(())
}

fn parse_zipper(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Zipper { cells });
    }
    Ok(())
}

fn parse_strict_kropki(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::StrictKropki);
    Ok(())
}

fn parse_strict_xv(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::StrictXV);
    Ok(())
}

fn parse_windoku(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::Windoku);
    Ok(())
}

fn parse_disjoint_sets(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::DisjointSets);
    Ok(())
}

fn parse_pill_arrow(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("PillArrow constraint missing pill size".to_string());
    }
    let pill_size: u8 = args[0]
        .parse()
        .map_err(|_| format!("Invalid pill size: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if cells.len() > pill_size as usize {
        constraints.push(Constraint::PillArrow { pill_size, cells });
    }
    Ok(())
}

fn parse_region_sum_line(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::RegionSumLine { cells });
    }
    Ok(())
}

fn parse_region_size(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("RegionSize constraint missing size".to_string());
    }
    let size: u8 = args[0]
        .parse()
        .map_err(|_| format!("Invalid region size: {}", args[0]))?;
    constraints.push(Constraint::RegionSize { size });
    Ok(())
}

/// Decode a Base64-encoded regex pattern.
///
/// Matches JS `Regex.decodePattern`: if the encoded string contains `%` or `.`,
/// it's treated as a legacy URL-encoded pattern (percent-decoded); otherwise
/// it's decoded as standard Base64.
fn decode_regex_pattern(encoded: &str) -> Result<String, String> {
    if encoded.contains('%') || encoded.contains('.') {
        // Legacy URL-encoded format.
        percent_decode(encoded)
    } else {
        base64_decode_string(encoded)
    }
}

/// Simple percent-decoding for legacy URL-encoded patterns.
fn percent_decode(input: &str) -> Result<String, String> {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1])
                .ok_or_else(|| format!("Invalid percent encoding in: {}", input))?;
            let lo = hex_val(bytes[i + 2])
                .ok_or_else(|| format!("Invalid percent encoding in: {}", input))?;
            result.push(hi << 4 | lo);
            i += 3;
        } else {
            result.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(result).map_err(|e| format!("Invalid UTF-8 in decoded pattern: {}", e))
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Decode a standard Base64 string to a UTF-8 string.
fn base64_decode_string(input: &str) -> Result<String, String> {
    const LOOKUP: [u8; 128] = {
        let mut t = [255u8; 128];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < chars.len() {
            t[chars[i] as usize] = i as u8;
            i += 1;
        }
        t
    };

    let bytes: Vec<u8> = input
        .bytes()
        .filter(|&b| b != b'=' && b != b'\n' && b != b'\r')
        .map(|b| {
            if (b as usize) < 128 {
                LOOKUP[b as usize]
            } else {
                255
            }
        })
        .collect();

    let mut result = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut i = 0;
    while i + 1 < bytes.len() {
        let remaining = bytes.len() - i;
        if remaining >= 4 {
            let n = ((bytes[i] as u32) << 18)
                | ((bytes[i + 1] as u32) << 12)
                | ((bytes[i + 2] as u32) << 6)
                | (bytes[i + 3] as u32);
            result.push((n >> 16) as u8);
            result.push((n >> 8) as u8);
            result.push(n as u8);
            i += 4;
        } else if remaining == 3 {
            let n = ((bytes[i] as u32) << 18)
                | ((bytes[i + 1] as u32) << 12)
                | ((bytes[i + 2] as u32) << 6);
            result.push((n >> 16) as u8);
            result.push((n >> 8) as u8);
            i += 3;
        } else {
            let n = ((bytes[i] as u32) << 18) | ((bytes[i + 1] as u32) << 12);
            result.push((n >> 16) as u8);
            i += 2;
        }
    }

    String::from_utf8(result).map_err(|e| format!("Invalid UTF-8 in Base64 decoded string: {}", e))
}

/// Parse Regex constraint.
///
/// Format: `.Regex~<encodedPattern>~R1C1~R1C2~...~R2C1~R2C2~...`
/// Multiple cell groups share the same pattern, separated by empty args.
/// Matches JS `Regex.makeFromArgs`.
fn parse_regex(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Regex constraint missing pattern".to_string());
    }
    let pattern = decode_regex_pattern(args[0])?;

    let mut cells: Vec<String> = Vec::new();
    for &arg in &args[1..] {
        if arg.is_empty() {
            // Empty separator: flush current group.
            if cells.len() >= 1 {
                constraints.push(Constraint::Regex {
                    pattern: pattern.clone(),
                    cells: std::mem::take(&mut cells),
                });
            }
            continue;
        }
        cells.push(arg.to_string());
    }
    // Flush last group.
    if cells.len() >= 1 {
        constraints.push(Constraint::Regex {
            pattern: pattern.clone(),
            cells,
        });
    }
    Ok(())
}

/// Parse NFA constraint.
///
/// Format: `.NFA~<encodedNFA>~_<name>~R1C1~R2C2~...~_<name2>~R3C3~...`
/// The encoded NFA is the first arg. Names are prefixed with `_` (using Pair
/// name encoding). Cell groups are separated by empty args or new name tokens.
/// Matches JS `NFA.makeFromArgs`.
fn parse_nfa(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("NFA constraint missing encoded NFA".to_string());
    }
    let encoded_nfa = args[0].to_string();

    let mut current_name = String::new();
    let mut current_cells: Vec<String> = Vec::new();

    for &arg in &args[1..] {
        // Cell IDs start with R (case-insensitive).
        if !arg.is_empty() && arg.as_bytes()[0].to_ascii_uppercase() == b'R' {
            current_cells.push(arg.to_string());
            continue;
        }

        // Non-cell token: flush current group.
        if !current_cells.is_empty() {
            constraints.push(Constraint::Nfa {
                encoded_nfa: encoded_nfa.clone(),
                name: current_name.clone(),
                cells: std::mem::take(&mut current_cells),
            });
        }

        // Parse name token (prefixed with `_`, using Pair name encoding).
        if !arg.is_empty() {
            current_name = decode_nfa_name(&arg[1..]);
        }
    }

    // Flush last group.
    if !current_cells.is_empty() {
        constraints.push(Constraint::Nfa {
            encoded_nfa,
            name: current_name,
            cells: current_cells,
        });
    }
    Ok(())
}

/// Decode an NFA name using the same encoding as Pair names.
///
/// Matches JS `SudokuConstraint.Pair.decodeName`. The encoding uses
/// substitution for URL-unfriendly characters.
fn decode_nfa_name(encoded: &str) -> String {
    encoded
        .chars()
        .map(|c| match c {
            '-' => ' ',
            _ => c,
        })
        .collect()
}

fn parse_entropic(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::Entropic { cells });
    }
    Ok(())
}

fn parse_modular(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Modular constraint requires mod value".to_string());
    }
    let mod_value: u8 = args[0]
        .parse()
        .map_err(|_| format!("Invalid Modular mod value: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if cells.len() >= 2 {
        constraints.push(Constraint::Modular { mod_value, cells });
    }
    Ok(())
}

fn parse_anti_taxicab(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::AntiTaxicab);
    Ok(())
}

fn parse_contain_at_least(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("ContainAtLeast requires values arg".to_string());
    }
    let values = parse_underscore_values(args[0])?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() && !values.is_empty() {
        constraints.push(Constraint::ContainAtLeast { cells, values });
    }
    Ok(())
}

fn parse_contain_exact(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("ContainExact requires values arg".to_string());
    }
    let values = parse_underscore_values(args[0])?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() && !values.is_empty() {
        constraints.push(Constraint::ContainExact { cells, values });
    }
    Ok(())
}

fn parse_quad(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Quad requires topLeftCell arg".to_string());
    }
    let top_left = args[0].to_string();
    let values: Vec<Value> = args[1..]
        .iter()
        .filter_map(|s| s.parse::<Value>().ok())
        .filter(|&v| v >= 1)
        .collect();
    if !values.is_empty() {
        constraints.push(Constraint::Quad { top_left, values });
    }
    Ok(())
}

fn parse_priority(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Priority requires priority value arg".to_string());
    }
    let priority: i32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid priority value: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::Priority { cells, priority });
    }
    Ok(())
}

fn parse_jigsaw(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    // Format: .Jigsaw~<layout> or .Jigsaw~<gridSpec>~<layout>
    // Take the last argument as the layout string.
    if args.is_empty() || args.len() > 2 {
        return Err("Jigsaw constraint requires 1 or 2 arguments".to_string());
    }
    let layout = args[args.len() - 1];

    // Approximate a square shape from the layout length (fallback when shape
    // context is unavailable). See parse_jigsaw_with_shape for the preferred path.
    let side = (layout.len() as f64).sqrt() as u8;
    let shape = GridShape::square(side).unwrap_or_else(GridShape::default_9x9);
    parse_jigsaw_layout(layout, shape, constraints)
}

/// Parse a Jigsaw layout string given the known grid shape.
/// Mirrors JS `SudokuConstraint.Jigsaw.makeFromArgs(args, shape)`.
fn parse_jigsaw_layout(
    layout: &str,
    shape: GridShape,
    constraints: &mut Vec<Constraint>,
) -> Result<(), String> {
    // Group cells by their region character.
    let mut regions: std::collections::BTreeMap<char, Vec<CellIndex>> =
        std::collections::BTreeMap::new();
    for (i, ch) in layout.chars().enumerate() {
        regions.entry(ch).or_default().push(i as CellIndex);
    }

    // If all cells are in one region, no constraint needed.
    if regions.len() <= 1 {
        return Ok(());
    }

    let grid_spec = shape.name();
    let num_cols = shape.num_cols as usize;
    for (_ch, region) in &regions {
        let cells: Vec<String> = region
            .iter()
            .map(|&c| {
                let r = c as usize / num_cols;
                let col = c as usize % num_cols;
                format!("R{}C{}", r + 1, col + 1)
            })
            .collect();
        constraints.push(Constraint::Jigsaw {
            grid_spec: grid_spec.clone(),
            cells,
        });
    }

    Ok(())
}

/// Parse a Jigsaw constraint when the grid shape is already known.
fn parse_jigsaw_with_shape(
    args: &[&str],
    constraints: &mut Vec<Constraint>,
    shape: GridShape,
) -> Result<(), String> {
    if args.is_empty() || args.len() > 2 {
        return Err("Jigsaw constraint requires 1 or 2 arguments".to_string());
    }
    let layout = args[args.len() - 1];
    parse_jigsaw_layout(layout, shape, constraints)
}

/// Parse FullRank constraint (double-line outside clue).
///
/// Format: `.FullRank~rowCol~fwdValue~bwdValue`
/// Same structure as NumberedRoom / Skyscraper.
/// Each direction (forward/backward) with a non-empty value becomes a
/// separate `Constraint::FullRank` with the `arrow_id` carrying the direction.
fn parse_full_rank(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Ok(());
    }
    let row_col = args[0];
    if let Some(fwd) = args.get(1).filter(|s| !s.is_empty()) {
        if let Ok(value) = fwd.parse::<u32>() {
            constraints.push(Constraint::FullRank {
                arrow_id: format!("{},1", row_col),
                value,
            });
        }
    }
    if let Some(bwd) = args.get(2).filter(|s| !s.is_empty()) {
        if let Ok(value) = bwd.parse::<u32>() {
            constraints.push(Constraint::FullRank {
                arrow_id: format!("{},-1", row_col),
                value,
            });
        }
    }
    Ok(())
}

/// Parse FullRankTies constraint.
///
/// Format: `.FullRankTies~ties` where `ties` is `"none"`, `"only-unclued"`, or `"any"`.
fn parse_full_rank_ties(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let ties = args.first().copied().unwrap_or("only-unclued").to_string();
    constraints.push(Constraint::FullRankTies { ties });
    Ok(())
}

fn parse_noop(_args: &[&str], _constraints: &mut Vec<Constraint>) -> Result<(), String> {
    Ok(())
}

fn parse_lockout(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Lockout constraint missing min_diff".to_string());
    }
    let min_diff: u8 = args[0]
        .parse()
        .map_err(|_| format!("Invalid Lockout min_diff: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if cells.len() >= 2 {
        constraints.push(Constraint::Lockout { min_diff, cells });
    }
    Ok(())
}

fn parse_dutch_flatmates(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::DutchFlatmates);
    Ok(())
}

fn parse_value_indexing(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 3 {
        constraints.push(Constraint::ValueIndexing { cells });
    }
    Ok(())
}

/// Parse NumberedRoom constraint.
///
/// `NumberedRoom` uses the `OutsideConstraintBase` double-line URL format:
///   `.NumberedRoom~R1~forward_value~backward_value`
/// where `R1` is a row/column ID and the values are the clue numbers.
fn parse_numbered_room(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Ok(()); // Not enough args — skip silently.
    }
    let row_col = args[0];
    // Forward clue (dir=1): cells go from outside inward.
    if let Some(fwd) = args.get(1).filter(|s| !s.is_empty()) {
        if let Ok(value) = fwd.parse::<u8>() {
            constraints.push(Constraint::NumberedRoom {
                arrow_id: format!("{},1", row_col),
                value,
            });
        }
    }
    // Backward clue (dir=-1): cells go from outside inward in reverse.
    if let Some(bwd) = args.get(2).filter(|s| !s.is_empty()) {
        if let Ok(value) = bwd.parse::<u8>() {
            constraints.push(Constraint::NumberedRoom {
                arrow_id: format!("{},-1", row_col),
                value,
            });
        }
    }
    Ok(())
}

/// Parse Indexing constraint.
///
/// Format: `.Indexing~R~R1C1~R2C3~...` (row indexing) or `.Indexing~C~...` (col).
/// The first arg is the index type ("R" for row, "C" for column).
fn parse_indexing(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Indexing constraint missing index type".to_string());
    }
    let index_type = args[0].to_string();
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::Indexing { index_type, cells });
    }
    Ok(())
}

fn parse_global_entropy(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::GlobalEntropy);
    Ok(())
}

fn parse_global_mod(_args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    constraints.push(Constraint::GlobalMod);
    Ok(())
}

fn parse_sum_line(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("SumLine constraint missing sum argument".to_string());
    }
    let sum: u32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid SumLine sum: {}", args[0]))?;
    // Strip trailing LOOP token (mirrors JS CellArgs).
    let rest = &args[1..];
    let (is_loop, cell_args) = if rest.last() == Some(&"LOOP") {
        (true, &rest[..rest.len() - 1])
    } else {
        (false, rest)
    };
    let cells = collect_cell_args(cell_args);
    if cells.len() >= 2 {
        constraints.push(Constraint::SumLine {
            sum,
            is_loop,
            cells,
        });
    }
    Ok(())
}

fn parse_counting_circles(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if cells.len() >= 2 {
        constraints.push(Constraint::CountingCircles { cells });
    }
    Ok(())
}

/// Parse SameValues constraint.
///
/// Format: `.SameValues~numSets~cell1~cell2~...`
/// `numSets` is the number of equal-sized subsets to split `cells` into.
fn parse_same_values(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("SameValues constraint missing numSets argument".to_string());
    }
    let num_sets: u32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid SameValues numSets: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::SameValues { num_sets, cells });
    }
    Ok(())
}

fn parse_region_same_values(
    _args: &[&str],
    constraints: &mut Vec<Constraint>,
) -> Result<(), String> {
    constraints.push(Constraint::RegionSameValues);
    Ok(())
}

/// Parse Sandwich constraint (single-line outside clue).
///
/// Format: `.Sandwich~value~rowCol`
/// e.g. `.Sandwich~15~R1` means row 1 sandwich sum = 15.
/// Direction is always forward (,1).
fn parse_sandwich(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Ok(()); // Not enough args — skip silently.
    }
    let value: u32 = match args[0].parse() {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let row_col = args[1];
    constraints.push(Constraint::Sandwich {
        arrow_id: format!("{},1", row_col),
        value,
    });
    Ok(())
}

/// Parse Lunchbox constraint.
///
/// Format: `.Lunchbox~sum~cell1~cell2~...`
fn parse_lunchbox(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Lunchbox constraint missing sum argument".to_string());
    }
    let sum: u32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid Lunchbox sum: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::Lunchbox { sum, cells });
    }
    Ok(())
}

/// Parse Skyscraper constraint (double-line outside clue).
///
/// Format: `.Skyscraper~rowCol~fwdValue~bwdValue`
/// Same format as NumberedRoom.
fn parse_skyscraper(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Ok(());
    }
    let row_col = args[0];
    if let Some(fwd) = args.get(1).filter(|s| !s.is_empty()) {
        if let Ok(value) = fwd.parse::<u32>() {
            constraints.push(Constraint::Skyscraper {
                arrow_id: format!("{},1", row_col),
                value,
            });
        }
    }
    if let Some(bwd) = args.get(2).filter(|s| !s.is_empty()) {
        if let Ok(value) = bwd.parse::<u32>() {
            constraints.push(Constraint::Skyscraper {
                arrow_id: format!("{},-1", row_col),
                value,
            });
        }
    }
    Ok(())
}

/// Parse HiddenSkyscraper constraint (double-line outside clue).
///
/// Format: `.HiddenSkyscraper~rowCol~fwdValue~bwdValue`
fn parse_hidden_skyscraper(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Ok(());
    }
    let row_col = args[0];
    if let Some(fwd) = args.get(1).filter(|s| !s.is_empty()) {
        if let Ok(value) = fwd.parse::<u32>() {
            constraints.push(Constraint::HiddenSkyscraper {
                arrow_id: format!("{},1", row_col),
                value,
            });
        }
    }
    if let Some(bwd) = args.get(2).filter(|s| !s.is_empty()) {
        if let Ok(value) = bwd.parse::<u32>() {
            constraints.push(Constraint::HiddenSkyscraper {
                arrow_id: format!("{},-1", row_col),
                value,
            });
        }
    }
    Ok(())
}

/// Parse XSum constraint (double-line outside clue).
///
/// Format: `.XSum~rowCol~fwdValue~bwdValue`
/// X is the digit in the first cell; the first X cells must sum to `value`.
/// Mirrors JS `XSum` which uses `CLUE_TYPE_DOUBLE_LINE` (same format as Skyscraper).
fn parse_xsum(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.len() < 2 {
        return Ok(());
    }
    let row_col = args[0];
    if let Some(fwd) = args.get(1).filter(|s| !s.is_empty()) {
        if let Ok(value) = fwd.parse::<u32>() {
            constraints.push(Constraint::XSum {
                arrow_id: format!("{},1", row_col),
                value,
            });
        }
    }
    if let Some(bwd) = args.get(2).filter(|s| !s.is_empty()) {
        if let Ok(value) = bwd.parse::<u32>() {
            constraints.push(Constraint::XSum {
                arrow_id: format!("{},-1", row_col),
                value,
            });
        }
    }
    Ok(())
}

/// Parse RellikCage constraint.
///
/// Format: `.RellikCage~sum~cell1~cell2~...`
fn parse_rellik_cage(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("RellikCage constraint missing sum argument".to_string());
    }
    let sum: u32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid RellikCage sum: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
    if !cells.is_empty() {
        constraints.push(Constraint::RellikCage { sum, cells });
    }
    Ok(())
}

/// Parse EqualityCage constraint.
///
/// Format: `.EqualityCage~cell1~cell2~...`
fn parse_equality_cage(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    let cells = collect_cell_args(args);
    if !cells.is_empty() {
        constraints.push(Constraint::EqualityCage { cells });
    }
    Ok(())
}

/// Swaps `-` ↔ `_` in the key to convert from base64url to standard base64.
fn parse_binary(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Binary constraint missing key".to_string());
    }
    let key = convert_base64url_key(args[0]);
    parse_pair_groups(&key, &args[1..], false, constraints);
    Ok(())
}

/// Legacy BinaryX: alias for PairX with base64url key conversion.
fn parse_binary_x(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("BinaryX constraint missing key".to_string());
    }
    let key = convert_base64url_key(args[0]);
    parse_pair_groups(&key, &args[1..], true, constraints);
    Ok(())
}

/// Convert base64url encoding: swap `-` and `_`.
fn convert_base64url_key(key: &str) -> String {
    key.chars()
        .map(|c| match c {
            '-' => '_',
            '_' => '-',
            _ => c,
        })
        .collect()
}

// ====================================================================
// Helpers
// ====================================================================

/// Collect cell ID arguments as raw strings (no index resolution).
fn collect_cell_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

/// Parse an underscore-separated value list (e.g. "1_2_3" → [1, 2, 3]).
fn parse_underscore_values(s: &str) -> Result<Vec<Value>, String> {
    s.split('_')
        .filter(|p| !p.is_empty())
        .map(|p| {
            p.parse::<Value>()
                .map_err(|_| format!("Invalid value in list: {}", p))
        })
        .collect()
}

/// Parse a given argument like "R1C1_5" into (cell_id, cell_index, values).
///
/// The cell_index is needed for puzzle string placement (positional encoding).
/// The cell_id string is stored in Given constraints for pencilmarks.
fn parse_given_arg(arg: &str, shape: GridShape) -> Result<(String, usize, Vec<Value>), String> {
    let parts: Vec<&str> = arg.split('_').collect();
    if parts.len() < 2 {
        return Err(format!("Invalid given format: {}", arg));
    }

    let cell_id = parts[0].to_string();
    let coord = shape
        .parse_cell_id(parts[0])
        .map_err(|e| format!("Invalid given cell ID: {}", e))?;
    let cell_idx = coord.cell;

    let nv = shape.num_values;
    let values: Vec<Value> = parts[1..]
        .iter()
        .filter_map(|s| s.parse::<u8>().ok())
        .filter(|&v| v >= 1 && v <= nv)
        .collect();

    if values.is_empty() {
        return Err(format!("No valid values in given: {}", arg));
    }

    Ok((cell_id, cell_idx, values))
}

/// Parse compact killer format (81-character direction-pointer string).
///
/// Each character is either:
/// - A sum-encoding char (cage head): 0-9, A-Z (10-35), a-j (36-45)
/// - A direction arrow (points to cage head):
///   `<` left, `>` right, `^` up, `v` down,
///   `` ` `` up-left, `'` up-right, `,` down-left, `.` down-right
///
/// All cells follow pointers transitively to find their cage head.
/// Cells sharing the same head form a cage.
fn parse_compact_killer(input: &str, shape: GridShape) -> Result<ParsedConstraints, String> {
    let num_cells = shape.num_cells;
    let chars: Vec<char> = input.chars().collect();
    if chars.len() != num_cells {
        return Err(format!(
            "Compact killer format requires exactly {} characters, got {}",
            num_cells,
            chars.len()
        ));
    }

    // First pass: decode direction offsets and sum values.
    let mut head_of: Vec<Option<usize>> = vec![None; num_cells]; // resolved cage head
    let mut sums: Vec<Option<i32>> = vec![None; num_cells]; // sum for head cells

    // Identify head cells (those with a sum value, not a direction).
    for (i, &ch) in chars.iter().enumerate() {
        match decode_compact_char(ch) {
            CompactChar::Sum(s) => {
                head_of[i] = Some(i);
                sums[i] = Some(s);
            }
            CompactChar::Direction(_) => {}
        }
    }

    // Resolve direction pointers: follow until we reach a head.
    for (i, slot) in head_of.iter_mut().enumerate() {
        if slot.is_some() {
            continue; // Already a head.
        }
        let head = follow_pointers(i, &chars, shape)?;
        *slot = Some(head);
    }

    // Group cells by head.
    let mut cage_cells: std::collections::HashMap<usize, Vec<CellIndex>> =
        std::collections::HashMap::new();
    for (i, slot) in head_of.iter().enumerate() {
        let head = slot.unwrap();
        cage_cells.entry(head).or_default().push(i as CellIndex);
    }

    // Build cage constraints.
    let mut constraints: Vec<Constraint> = Vec::new();
    let mut cage_list: Vec<(Vec<String>, i32)> = Vec::new();
    for (head, cells) in &cage_cells {
        let sum = sums[*head]
            .ok_or_else(|| format!("Cell {} points to head {} which has no sum", cells[0], head))?;
        let cell_ids: Vec<String> = cells
            .iter()
            .map(|&c| shape.cell_id_from_index(c as usize))
            .collect();
        cage_list.push((cell_ids, sum));
    }
    cage_list.sort_by_key(|(cells, _)| cells[0].clone());
    for (cells, sum) in cage_list {
        constraints.push(Constraint::Cage { cells, sum });
    }

    // Compact killer format has no givens — puzzle is all empty.
    Ok(ParsedConstraints { constraints, shape })
}

enum CompactChar {
    Sum(i32),
    Direction((i32, i32)), // (row_delta, col_delta)
}

fn decode_compact_char(ch: char) -> CompactChar {
    match ch {
        '0'..='9' => CompactChar::Sum((ch as i32) - ('0' as i32)),
        'A'..='Z' => CompactChar::Sum((ch as i32) - ('A' as i32) + 10),
        'a'..='j' => CompactChar::Sum((ch as i32) - ('a' as i32) + 36),
        '<' => CompactChar::Direction((0, -1)),
        '>' => CompactChar::Direction((0, 1)),
        '^' => CompactChar::Direction((-1, 0)),
        'v' => CompactChar::Direction((1, 0)),
        '`' => CompactChar::Direction((-1, -1)),
        '\'' => CompactChar::Direction((-1, 1)),
        ',' => CompactChar::Direction((1, -1)),
        '.' => CompactChar::Direction((1, 1)),
        _ => CompactChar::Sum(0), // Unknown char → treat as sum 0.
    }
}

/// Follow direction pointers from a cell until we reach a head cell.
fn follow_pointers(start: usize, chars: &[char], shape: GridShape) -> Result<usize, String> {
    let num_cells = shape.num_cells;
    let mut visited = vec![false; num_cells];
    let mut current = start;

    loop {
        if visited[current] {
            return Err(format!(
                "Cycle detected in compact killer at cell {}",
                start
            ));
        }
        visited[current] = true;

        let ch = chars[current];
        match decode_compact_char(ch) {
            CompactChar::Sum(_) => return Ok(current), // Reached a head.
            CompactChar::Direction((dr, dc)) => {
                let row = shape.row_of(current) as i32 + dr;
                let col = shape.col_of(current) as i32 + dc;
                let nr = shape.num_rows as i32;
                let nc = shape.num_cols as i32;
                if row < 0 || row >= nr || col < 0 || col >= nc {
                    return Err(format!(
                        "Direction pointer at cell {} goes out of bounds",
                        current
                    ));
                }
                current = shape.cell_index(row as u8, col as u8);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::grid_shape::SHAPE_9X9;

    /// Helper: extract Given constraints and build a puzzle string from them.
    /// Single-value Givens are placed at their cell index; multi-value
    /// Givens (pencilmarks) are ignored for puzzle string comparison.
    fn givens_to_puzzle_string(constraints: &[Constraint], shape: GridShape) -> String {
        let mut puzzle = vec!['.'; shape.num_cells];
        let base = shape.base_char_code();
        for c in constraints {
            if let Constraint::Given { cell, values } = c {
                if values.len() == 1 {
                    if let Ok(coord) = shape.parse_cell_id(cell) {
                        puzzle[coord.cell] = (base + values[0] - 1) as char;
                    }
                }
            }
        }
        puzzle.into_iter().collect()
    }

    #[test]
    fn test_parse_empty_input() {
        // Empty input represents a cleared grid with default 9×9 shape.
        let result = parse("").unwrap();
        assert_eq!(result.shape, SHAPE_9X9);
        assert!(result.constraints.is_empty());

        // Whitespace-only is also treated as empty.
        let result = parse("   ").unwrap();
        assert_eq!(result.shape, SHAPE_9X9);
        assert!(result.constraints.is_empty());
    }

    #[test]
    fn test_parse_plain_sudoku() {
        let puzzle =
            "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let result = parse(puzzle).unwrap();
        // All non-zero characters become Given constraints.
        let expected = puzzle.replace('0', ".");
        assert_eq!(
            givens_to_puzzle_string(&result.constraints, result.shape),
            expected
        );
        // Only Given constraints for plain sudoku.
        assert!(result
            .constraints
            .iter()
            .all(|c| matches!(c, Constraint::Given { .. })));
        assert_eq!(result.shape, SHAPE_9X9);
    }

    #[test]
    fn test_parse_givens() {
        let result = parse(".~R1C1_5~R1C2_3~R2C1_6").unwrap();
        let puzzle_str = givens_to_puzzle_string(&result.constraints, result.shape);
        assert_eq!(puzzle_str.chars().nth(0), Some('5'));
        assert_eq!(puzzle_str.chars().nth(1), Some('3'));
        assert_eq!(puzzle_str.chars().nth(9), Some('6'));
        // Rest should be '.'
        assert_eq!(puzzle_str.chars().nth(2), Some('.'));
    }

    #[test]
    fn test_parse_cage() {
        let result = parse(".Cage~15~R1C3~R1C4~R1C5").unwrap();
        assert_eq!(result.constraints.len(), 1);
        match &result.constraints[0] {
            Constraint::Cage { cells, sum } => {
                assert_eq!(*sum, 15);
                assert_eq!(
                    *cells,
                    vec!["R1C3".to_string(), "R1C4".to_string(), "R1C5".to_string()]
                );
            }
            _ => panic!("Expected Cage constraint"),
        }
    }

    #[test]
    fn test_parse_mixed() {
        let input = ".~R1C1_5~R1C2_3.Cage~15~R1C3~R1C4~R1C5.Cage~3~R2C1~R2C2";
        let result = parse(input).unwrap();
        let puzzle_str = givens_to_puzzle_string(&result.constraints, result.shape);
        assert_eq!(puzzle_str.chars().nth(0), Some('5'));
        assert_eq!(puzzle_str.chars().nth(1), Some('3'));
        let cages: Vec<_> = result
            .constraints
            .iter()
            .filter(|c| matches!(c, Constraint::Cage { .. }))
            .collect();
        assert_eq!(cages.len(), 2);
    }

    #[test]
    fn test_compact_killer_basic() {
        // Mix of heads (digit sums) and direction arrows to trigger compact killer detection.
        let mut chars = vec!['0'; 81];
        chars[0] = '3';
        chars[1] = '<';
        chars[2] = '5';
        chars[3] = '<';
        let input: String = chars.into_iter().collect();
        let result = parse(&input).unwrap();
        let cage_count = result
            .constraints
            .iter()
            .filter(|c| matches!(c, Constraint::Cage { .. }))
            .count();
        assert_eq!(cage_count, 79);
        // Verify the two-cell cages.
        let cage_3 = result
            .constraints
            .iter()
            .find(|c| matches!(c, Constraint::Cage { sum: 3, .. }));
        assert!(cage_3.is_some());
        let cage_5 = result
            .constraints
            .iter()
            .find(|c| matches!(c, Constraint::Cage { sum: 5, .. }));
        assert!(cage_5.is_some());
    }

    #[test]
    fn test_compact_killer_direction() {
        let mut chars = vec!['0'; 81];
        chars[0] = '3';
        chars[1] = '<';
        let input: String = chars.into_iter().collect();
        let result = parse(&input).unwrap();
        let two_cell = result
            .constraints
            .iter()
            .find(|c| matches!(c, Constraint::Cage { cells, .. } if cells.len() == 2));
        assert!(two_cell.is_some());
        match two_cell.unwrap() {
            Constraint::Cage { cells, sum } => {
                assert_eq!(*sum, 3);
                assert!(cells.contains(&"R1C1".to_string()));
                assert!(cells.contains(&"R1C2".to_string()));
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn test_parse_thermo() {
        let result = parse(".Thermo~R1C1~R1C2~R1C3").unwrap();
        assert_eq!(result.constraints.len(), 1);
        assert!(matches!(&result.constraints[0], Constraint::Thermo { cells } if cells.len() == 3));
    }

    #[test]
    fn test_parse_anti_knight() {
        let result = parse(".AntiKnight").unwrap();
        assert_eq!(result.constraints.len(), 1);
        assert!(matches!(&result.constraints[0], Constraint::AntiKnight));
    }

    #[test]
    fn test_parse_pencilmarks() {
        let result = parse(".~R1C1_2_4_6").unwrap();
        // Should create a Given constraint (pencilmarks), not modify puzzle string.
        assert_eq!(result.constraints.len(), 1);
        match &result.constraints[0] {
            Constraint::Given { cell, values } => {
                assert_eq!(*cell, "R1C1");
                assert_eq!(*values, vec![2, 4, 6]);
            }
            _ => panic!("Expected Given constraint"),
        }
    }

    #[test]
    fn test_parse_little_killer_stores_arrow_cell() {
        // .LittleKiller~47~R3C1 → stores raw arrow cell, no expansion
        let result = parse(".LittleKiller~47~R3C1").unwrap();
        assert_eq!(result.constraints.len(), 1);
        match &result.constraints[0] {
            Constraint::LittleKiller { sum, arrow_cell } => {
                assert_eq!(*sum, 47);
                assert_eq!(*arrow_cell, "R3C1");
            }
            _ => panic!("Expected LittleKiller constraint"),
        }
    }

    #[test]
    fn test_parse_little_killer_top_edge() {
        // Arrow at R1C7 (top edge)
        let result = parse(".LittleKiller~43~R1C7").unwrap();
        match &result.constraints[0] {
            Constraint::LittleKiller { sum, arrow_cell } => {
                assert_eq!(*sum, 43);
                assert_eq!(*arrow_cell, "R1C7");
            }
            _ => panic!("Expected LittleKiller"),
        }
    }

    #[test]
    fn test_parse_little_killer_right_edge() {
        // Arrow at R8C9 (right edge)
        let result = parse(".LittleKiller~30~R8C9").unwrap();
        match &result.constraints[0] {
            Constraint::LittleKiller { sum, arrow_cell } => {
                assert_eq!(*sum, 30);
                assert_eq!(*arrow_cell, "R8C9");
            }
            _ => panic!("Expected LittleKiller"),
        }
    }

    #[test]
    fn test_parse_little_killer_bottom_edge() {
        // Arrow at R9C2 (bottom edge)
        let result = parse(".LittleKiller~34~R9C2").unwrap();
        match &result.constraints[0] {
            Constraint::LittleKiller { sum, arrow_cell } => {
                assert_eq!(*sum, 34);
                assert_eq!(*arrow_cell, "R9C2");
            }
            _ => panic!("Expected LittleKiller"),
        }
    }

    #[test]
    fn test_parse_unknown_constraint_errors() {
        let result = parse(".UnknownConstraintXYZ~15~R1");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unsupported constraint type"),
            "Error should mention unsupported type: {}",
            err
        );
    }

    #[test]
    fn test_parse_sandwich() {
        let result = parse(".Sandwich~15~R1").unwrap();
        assert_eq!(result.constraints.len(), 1);
        match &result.constraints[0] {
            Constraint::Sandwich { arrow_id, value } => {
                assert_eq!(*value, 15);
                assert_eq!(*arrow_id, "R1,1");
            }
            _ => panic!("Expected Sandwich constraint"),
        }
    }

    #[test]
    fn test_parse_hailstone_puzzle() {
        // The Hailstone puzzle uses Cage, Diagonal, and LittleKiller.
        let input = "..Cage~14~R5C3~R5C4~R6C4.Cage~19~R6C6~R6C5~R7C5\
            .Cage~14~R4C4~R4C5~R3C5.Cage~14~R4C6~R5C6~R5C7\
            .Diagonal~1.Diagonal~-1\
            .LittleKiller~47~R3C1.LittleKiller~49~R2C1\
            .LittleKiller~30~R8C9.LittleKiller~45~R7C9\
            .LittleKiller~43~R1C7.LittleKiller~44~R1C8\
            .LittleKiller~34~R9C2.LittleKiller~52~R9C3";
        let result = parse(input).unwrap();
        // 4 cages + 2 diagonals + 8 little killers = 14 constraints
        assert_eq!(result.constraints.len(), 14);
        let lk_count = result
            .constraints
            .iter()
            .filter(|c| matches!(c, Constraint::LittleKiller { .. }))
            .count();
        assert_eq!(lk_count, 8);
        // Each LittleKiller should store an arrow_cell string.
        for c in &result.constraints {
            if let Constraint::LittleKiller { arrow_cell, .. } = c {
                assert!(
                    arrow_cell.starts_with('R'),
                    "arrow_cell should be a cell ID, got: {}",
                    arrow_cell
                );
            }
        }
    }

    #[test]
    fn test_parse_full_rank_forward_only() {
        let result = parse(".FullRank~C2~26~").unwrap();
        assert_eq!(result.constraints.len(), 1);
        match &result.constraints[0] {
            Constraint::FullRank { arrow_id, value } => {
                assert_eq!(arrow_id, "C2,1");
                assert_eq!(*value, 26);
            }
            _ => panic!("Expected FullRank constraint"),
        }
    }

    #[test]
    fn test_parse_full_rank_backward_only() {
        // .FullRank~C3~~12 → no forward value, backward value = 12
        let result = parse(".FullRank~C3~~12").unwrap();
        assert_eq!(result.constraints.len(), 1);
        match &result.constraints[0] {
            Constraint::FullRank { arrow_id, value } => {
                assert_eq!(arrow_id, "C3,-1");
                assert_eq!(*value, 12);
            }
            _ => panic!("Expected FullRank constraint"),
        }
    }

    #[test]
    fn test_parse_full_rank_both_directions() {
        // .FullRank~C1~6~20 → forward=6, backward=20
        let result = parse(".FullRank~C1~6~20").unwrap();
        assert_eq!(result.constraints.len(), 2);
        let fwd = result.constraints.iter().find(
            |c| matches!(c, Constraint::FullRank { arrow_id, .. } if arrow_id.ends_with(",1")),
        );
        let bwd = result.constraints.iter().find(
            |c| matches!(c, Constraint::FullRank { arrow_id, .. } if arrow_id.ends_with(",-1")),
        );
        assert!(fwd.is_some(), "Expected forward FullRank");
        assert!(bwd.is_some(), "Expected backward FullRank");
        if let Some(Constraint::FullRank { value, .. }) = fwd {
            assert_eq!(*value, 6);
        }
        if let Some(Constraint::FullRank { value, .. }) = bwd {
            assert_eq!(*value, 20);
        }
    }

    #[test]
    fn test_parse_full_rank_ties() {
        let result_any = parse(".FullRankTies~any").unwrap();
        assert_eq!(result_any.constraints.len(), 1);
        match &result_any.constraints[0] {
            Constraint::FullRankTies { ties } => assert_eq!(ties, "any"),
            _ => panic!("Expected FullRankTies"),
        }

        let result_none = parse(".FullRankTies~none").unwrap();
        match &result_none.constraints[0] {
            Constraint::FullRankTies { ties } => assert_eq!(ties, "none"),
            _ => panic!("Expected FullRankTies"),
        }

        let result_default = parse(".FullRankTies~only-unclued").unwrap();
        match &result_default.constraints[0] {
            Constraint::FullRankTies { ties } => assert_eq!(ties, "only-unclued"),
            _ => panic!("Expected FullRankTies"),
        }
    }

    // ---------------------------------------------------------------
    // merge_by_uniqueness tests (mirrors JS sudoku_parser.test.js)
    // ---------------------------------------------------------------

    #[test]
    fn test_identical_givens_for_same_cell_merge_to_same_value() {
        // Two Given tokens for R1C1 with overlapping values → intersection.
        let result = parse(".~R1C1_1_2_3.~R1C1_2_3_4").unwrap();
        let given = result.constraints.iter().find_map(|c| {
            if let Constraint::Given { cell, values } = c {
                if cell == "R1C1" {
                    Some(values.clone())
                } else {
                    None
                }
            } else {
                None
            }
        });
        let mut v = given.expect("Expected Given for R1C1");
        v.sort();
        assert_eq!(
            v,
            vec![2, 3],
            "Intersection of [1,2,3] and [2,3,4] should be [2,3]"
        );
        // Only one Given for R1C1 should remain.
        let count = result
            .constraints
            .iter()
            .filter(|c| matches!(c, Constraint::Given { cell, .. } if cell == "R1C1"))
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_givens_for_different_cells_are_not_merged() {
        let result = parse(".~R1C1_1_2.~R1C2_3_4").unwrap();
        let count = result
            .constraints
            .iter()
            .filter(|c| matches!(c, Constraint::Given { .. }))
            .count();
        assert_eq!(
            count, 2,
            "Given constraints for different cells must not be merged"
        );
    }

    #[test]
    fn test_givens_inside_or_branches_are_not_merged() {
        // Or(Given(R1C1,[1,2]), Given(R1C1,[3,4])) — each is a separate Or branch.
        let result = parse(".Or.~R1C1_1_2.~R1C1_3_4.End").unwrap();
        assert_eq!(result.constraints.len(), 1);
        let or_groups = match &result.constraints[0] {
            Constraint::Or { groups } => groups,
            _ => panic!("Expected Or constraint"),
        };
        // Two separate branches, each holding one Given.
        assert_eq!(or_groups.len(), 2);
    }

    #[test]
    fn test_givens_inside_and_are_merged() {
        // Rust parser wraps the And block in Constraint::And (not auto-absorbed).
        // The merged Given should be inside it.
        let result = parse(".And.~R1C1_1_2.~R1C1_2_3.End").unwrap();
        assert_eq!(result.constraints.len(), 1);
        let and_inner = match &result.constraints[0] {
            Constraint::And { constraints } => constraints,
            _ => panic!("Expected And constraint"),
        };
        let given = and_inner.iter().find_map(|c| {
            if let Constraint::Given { cell, values } = c {
                if cell == "R1C1" {
                    Some(values.clone())
                } else {
                    None
                }
            } else {
                None
            }
        });
        let mut v = given.expect("Expected merged Given for R1C1 inside And");
        v.sort();
        assert_eq!(v, vec![2], "Intersection of [1,2] and [2,3] should be [2]");
    }

    #[test]
    fn test_duplicate_singleton_constraints_deduped() {
        // Two AntiKnight tokens → only one should remain.
        let result = parse(".AntiKnight.AntiKnight").unwrap();
        let count = result
            .constraints
            .iter()
            .filter(|c| matches!(c, Constraint::AntiKnight))
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_duplicate_outside_clue_last_wins() {
        // Two Sandwich clues for the same row → last one wins.
        // Format: `.Sandwich~value~rowCol` where rowCol is e.g. "R1";
        // the parser synthesises arrow_id as "R1,1".
        let result = parse(".Sandwich~10~R1.Sandwich~20~R1").unwrap();
        let sandwiches: Vec<_> = result
            .constraints
            .iter()
            .filter_map(|c| {
                if let Constraint::Sandwich { arrow_id, value } = c {
                    if arrow_id == "R1,1" {
                        Some(*value)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(
            sandwiches,
            vec![20],
            "Second Sandwich for same arrow_id should win"
        );
    }
}
