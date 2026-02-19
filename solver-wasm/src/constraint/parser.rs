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
use crate::grid_shape::GridShape;
use crate::api::types::CellIndex;

/// Parsed constraint data: puzzle string + constraint list + grid shape.
#[derive(Debug, Clone)]
pub struct ParsedConstraints {
    /// Puzzle string (digits for givens, '.' for empty).
    /// Length equals `shape.num_cells`.
    pub puzzle: String,
    /// High-level constraints parsed from the input.
    pub constraints: Vec<Constraint>,
    /// Grid shape (dimensions and num_values).
    pub shape: GridShape,
}

/// Parse a constraint string in any supported format.
///
/// Returns the parsed puzzle string and constraint definitions.
pub fn parse(input: &str) -> Result<ParsedConstraints, String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Empty input".to_string());
    }

    // If it starts with '.', try verbose constraint string format.
    if input.starts_with('.') {
        return parse_verbose(input);
    }

    // Infer shape from input length (only square grids).
    let shape = GridShape::from_num_cells(input.len()).ok_or_else(|| {
        format!(
            "Unrecognized format: input length {} is not a perfect square \
             and does not start with '.'",
            input.len()
        )
    })?;

    // Check if it looks like compact killer (has direction chars).
    if is_compact_killer(input) {
        return parse_compact_killer(input, shape);
    }

    // Otherwise, treat as plain sudoku.
    Ok(ParsedConstraints {
        puzzle: input.to_string(),
        constraints: Vec::new(),
        shape,
    })
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
    // Legacy aliases for Pair/PairX with base64url key conversion.
    ConstraintDef {
        name: "Binary",
        parse: parse_binary,
    },
    ConstraintDef {
        name: "BinaryX",
        parse: parse_binary_x,
    },
];

/// Parse verbose constraint string format.
///
/// Format: `.Type~arg1~arg2...` tokens concatenated. Uses a registry
/// to dispatch each constraint type to its parse function.
fn parse_verbose(input: &str) -> Result<ParsedConstraints, String> {
    let parts: Vec<&str> = input.split('.').collect();

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

    let mut puzzle = vec!['.'; shape.num_cells];
    let mut constraints: Vec<Constraint> = Vec::new();

    // Second pass: parse all constraint tokens.
    for part in parts.iter().skip(1) {
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
            parse_givens(args, &mut puzzle, &mut constraints, shape)?;
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

    Ok(ParsedConstraints {
        puzzle: puzzle.into_iter().collect(),
        constraints,
        shape,
    })
}

// ====================================================================
// Givens (special case: also writes to puzzle string)
// ====================================================================

/// Parse given constraints (`.~R1C1_5~R2C3_7`).
///
/// Single values go into the puzzle string; pencilmarks become Given constraints.
fn parse_givens(
    args: &[&str],
    puzzle: &mut Vec<char>,
    constraints: &mut Vec<Constraint>,
    shape: GridShape,
) -> Result<(), String> {
    for &arg in args {
        if arg.is_empty() {
            continue;
        }
        let (cell_id, cell_idx, values) = parse_given_arg(arg, shape)?;
        if cell_idx < shape.num_cells {
            if values.len() == 1 {
                let base = shape.base_char_code();
                let ch = (base + values[0] - 1) as char;
                puzzle[cell_idx] = ch;
            } else {
                constraints.push(Constraint::Given {
                    cell: cell_id,
                    values,
                });
            }
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
        return Err("Whisper constraint missing difference".to_string());
    }
    let difference: i32 = args[0]
        .parse()
        .map_err(|_| format!("Invalid whisper difference: {}", args[0]))?;
    let cells = collect_cell_args(&args[1..]);
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

fn parse_pair(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Pair constraint missing key".to_string());
    }
    let key = args[0].to_string();
    let cell_start = if args.get(1).map_or(false, |a| a.starts_with('_')) {
        2
    } else {
        1
    };
    let cells = collect_cell_args(&args[cell_start..]);
    if cells.len() >= 2 {
        constraints.push(Constraint::Pair { key, cells });
    }
    Ok(())
}

fn parse_pair_x(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("PairX constraint missing key".to_string());
    }
    let key = args[0].to_string();
    let cell_start = if args.get(1).map_or(false, |a| a.starts_with('_')) {
        2
    } else {
        1
    };
    let cells = collect_cell_args(&args[cell_start..]);
    if cells.len() >= 2 {
        constraints.push(Constraint::PairX { key, cells });
    }
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

fn parse_jigsaw(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    // Format: .Jigsaw~<layout> or .Jigsaw~<gridSpec>~<layout>
    // Take the last argument as the layout string.
    if args.is_empty() || args.len() > 2 {
        return Err("Jigsaw constraint requires 1 or 2 arguments".to_string());
    }
    let layout = args[args.len() - 1];

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

    // Emit one Jigsaw constraint per region.
    // The grid_spec is approximated from the layout length.
    let grid_spec = format!("{}x{}", (layout.len() as f64).sqrt() as usize, (layout.len() as f64).sqrt() as usize);
    for (_ch, region) in &regions {
        let cells: Vec<String> = region
            .iter()
            .map(|&c| {
                let rows = (layout.len() as f64).sqrt() as usize;
                let cols = rows;
                let r = c as usize / cols;
                let col = c as usize % cols;
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

fn parse_noop(_args: &[&str], _constraints: &mut Vec<Constraint>) -> Result<(), String> {
    Ok(())
}

/// Legacy Binary: alias for Pair with base64url key conversion.
/// Swaps `-` ↔ `_` in the key to convert from base64url to standard base64.
fn parse_binary(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("Binary constraint missing key".to_string());
    }
    let key = convert_base64url_key(args[0]);
    let cell_start = if args.get(1).map_or(false, |a| a.starts_with('_')) {
        2
    } else {
        1
    };
    let cells = collect_cell_args(&args[cell_start..]);
    if cells.len() >= 2 {
        constraints.push(Constraint::Pair { key, cells });
    }
    Ok(())
}

/// Legacy BinaryX: alias for PairX with base64url key conversion.
fn parse_binary_x(args: &[&str], constraints: &mut Vec<Constraint>) -> Result<(), String> {
    if args.is_empty() {
        return Err("BinaryX constraint missing key".to_string());
    }
    let key = convert_base64url_key(args[0]);
    let cell_start = if args.get(1).map_or(false, |a| a.starts_with('_')) {
        2
    } else {
        1
    };
    let cells = collect_cell_args(&args[cell_start..]);
    if cells.len() >= 2 {
        constraints.push(Constraint::PairX { key, cells });
    }
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

/// Parse a given argument like "R1C1_5" into (cell_id, cell_index, values).
///
/// The cell_index is needed for puzzle string placement (positional encoding).
/// The cell_id string is stored in Given constraints for pencilmarks.
fn parse_given_arg(arg: &str, shape: GridShape) -> Result<(String, usize, Vec<u8>), String> {
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
    let values: Vec<u8> = parts[1..]
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
    Ok(ParsedConstraints {
        puzzle: ".".repeat(num_cells),
        constraints,
        shape,
    })
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

    #[test]
    fn test_parse_plain_sudoku() {
        let puzzle =
            "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let result = parse(puzzle).unwrap();
        assert_eq!(result.puzzle, puzzle);
        assert!(result.constraints.is_empty());
        assert_eq!(result.shape, SHAPE_9X9);
    }

    #[test]
    fn test_parse_givens() {
        let result = parse(".~R1C1_5~R1C2_3~R2C1_6").unwrap();
        assert_eq!(result.puzzle.chars().nth(0), Some('5'));
        assert_eq!(result.puzzle.chars().nth(1), Some('3'));
        assert_eq!(result.puzzle.chars().nth(9), Some('6'));
        // Rest should be '.'
        assert_eq!(result.puzzle.chars().nth(2), Some('.'));
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
        assert_eq!(result.puzzle.chars().nth(0), Some('5'));
        assert_eq!(result.puzzle.chars().nth(1), Some('3'));
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
        let result = parse(".Sandwich~15~R1");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unsupported constraint type"),
            "Error should mention unsupported type: {}",
            err
        );
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
}
