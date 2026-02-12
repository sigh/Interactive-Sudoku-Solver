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

use crate::util::NUM_CELLS;

/// Parsed constraint data: givens grid + cage definitions.
#[derive(Debug, Clone)]
pub struct ParsedConstraints {
    /// 81-character puzzle string (digits for givens, '.' for empty).
    pub puzzle: String,
    /// Cage definitions: (cells as 0-indexed flat indices, sum).
    pub cages: Vec<(Vec<u8>, i32)>,
}

/// Parse a constraint string in any supported format.
///
/// Returns the parsed puzzle string and cage definitions.
pub fn parse(input: &str) -> Result<ParsedConstraints, String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Empty input".to_string());
    }

    // If it starts with '.', try verbose constraint string format.
    if input.starts_with('.') {
        return parse_verbose(input);
    }

    // If it's exactly 81 characters, try plain sudoku or compact killer.
    if input.len() == 81 {
        // Check if it looks like compact killer (has direction chars).
        if is_compact_killer(input) {
            return parse_compact_killer(input);
        }
        // Otherwise, treat as plain sudoku.
        return Ok(ParsedConstraints {
            puzzle: input.to_string(),
            cages: Vec::new(),
        });
    }

    Err(format!(
        "Unrecognized format: expected 81-char puzzle, compact killer, or verbose constraint string starting with '.'"
    ))
}

/// Check if an 81-char string looks like compact killer format.
///
/// Compact killer strings contain direction arrows and sum-encoding chars.
/// Plain sudoku strings contain only digits 0-9 and '.'.
fn is_compact_killer(input: &str) -> bool {
    input.chars().any(|c| matches!(c, '<' | '>' | '^' | 'v' | '`' | '\'' | ',' | 'A'..='Z' | 'a'..='j'))
}

/// Parse verbose constraint string format.
///
/// Format: `.Type~arg1~arg2...` tokens concatenated. Supports:
/// - `.~R1C1_5~R2C3_7` — Givens (empty type = Given)
/// - `.Cage~15~R1C3~R1C4~R1C5` — Killer cage
///
/// Other constraint types are silently ignored (we only support
/// standard sudoku + killer cages in the Rust solver).
fn parse_verbose(input: &str) -> Result<ParsedConstraints, String> {
    let mut puzzle = vec!['.'; 81];
    let mut cages: Vec<(Vec<u8>, i32)> = Vec::new();

    // Split on '.' — first element is empty (string starts with '.').
    let parts: Vec<&str> = input.split('.').collect();

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

        match constraint_type {
            "" => {
                // Given constraints: .~R1C1_5~R2C3_7
                for arg in args {
                    if arg.is_empty() {
                        continue;
                    }
                    let (cell_idx, value) = parse_given_arg(arg)?;
                    if cell_idx < 81 {
                        puzzle[cell_idx] = value;
                    }
                }
            }
            "Cage" => {
                // Cage: .Cage~sum~R1C1~R1C2~...
                if args.is_empty() {
                    return Err("Cage constraint missing sum".to_string());
                }
                let sum: i32 = args[0]
                    .parse()
                    .map_err(|_| format!("Invalid cage sum: {}", args[0]))?;
                let mut cells: Vec<u8> = Vec::new();
                for &cell_str in &args[1..] {
                    let idx = parse_cell_id(cell_str)?;
                    cells.push(idx);
                }
                if !cells.is_empty() {
                    cages.push((cells, sum));
                }
            }
            _ => {
                // Silently ignore unsupported constraint types.
                // The Rust solver only handles standard sudoku + killer cages.
            }
        }
    }

    Ok(ParsedConstraints {
        puzzle: puzzle.into_iter().collect(),
        cages,
    })
}

/// Parse a given argument like "R1C1_5" into (cell_index, value_char).
///
/// Also handles pencilmark format "R1C1_2_4_6" but we only take the
/// first value if there's exactly one (treated as a given).
fn parse_given_arg(arg: &str) -> Result<(usize, char), String> {
    let parts: Vec<&str> = arg.split('_').collect();
    if parts.len() < 2 {
        return Err(format!("Invalid given format: {}", arg));
    }

    let cell_idx = parse_cell_id(parts[0])? as usize;

    if parts.len() == 2 {
        // Single value: R1C1_5
        let value = parts[1]
            .chars()
            .next()
            .ok_or_else(|| format!("Empty value in given: {}", arg))?;
        Ok((cell_idx, value))
    } else {
        // Pencilmark: R1C1_2_4_6 — skip for now (not a given).
        // We could represent this as candidates, but the solver
        // doesn't support that yet. Just leave the cell empty.
        Ok((cell_idx, '.'))
    }
}

/// Parse a cell ID like "R1C1" into a 0-indexed flat cell index.
///
/// Cell IDs are 1-indexed: R1C1 = row 0, col 0 = index 0.
fn parse_cell_id(cell_str: &str) -> Result<u8, String> {
    let cell_str = cell_str.trim();

    if !cell_str.starts_with('R') {
        return Err(format!("Invalid cell ID (must start with 'R'): {}", cell_str));
    }

    let rest = &cell_str[1..];
    let c_pos = rest
        .find('C')
        .ok_or_else(|| format!("Invalid cell ID (missing 'C'): {}", cell_str))?;

    let row: usize = rest[..c_pos]
        .parse()
        .map_err(|_| format!("Invalid row in cell ID: {}", cell_str))?;
    let col: usize = rest[c_pos + 1..]
        .parse()
        .map_err(|_| format!("Invalid col in cell ID: {}", cell_str))?;

    if row < 1 || row > 9 || col < 1 || col > 9 {
        return Err(format!(
            "Cell ID out of range (1-9): {}",
            cell_str
        ));
    }

    Ok(((row - 1) * 9 + (col - 1)) as u8)
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
fn parse_compact_killer(input: &str) -> Result<ParsedConstraints, String> {
    let chars: Vec<char> = input.chars().collect();
    if chars.len() != NUM_CELLS {
        return Err(format!(
            "Compact killer format requires exactly {} characters, got {}",
            NUM_CELLS,
            chars.len()
        ));
    }

    // First pass: decode direction offsets and sum values.
    let mut head_of: Vec<Option<usize>> = vec![None; NUM_CELLS]; // resolved cage head
    let mut sums: Vec<Option<i32>> = vec![None; NUM_CELLS]; // sum for head cells

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
    for i in 0..NUM_CELLS {
        if head_of[i].is_some() {
            continue; // Already a head.
        }
        let head = follow_pointers(i, &chars)?;
        head_of[i] = Some(head);
    }

    // Group cells by head.
    let mut cage_cells: std::collections::HashMap<usize, Vec<u8>> =
        std::collections::HashMap::new();
    for i in 0..NUM_CELLS {
        let head = head_of[i].unwrap();
        cage_cells.entry(head).or_default().push(i as u8);
    }

    // Build cages.
    let mut cages: Vec<(Vec<u8>, i32)> = Vec::new();
    for (head, cells) in &cage_cells {
        let sum = sums[*head].ok_or_else(|| {
            format!("Cell {} points to head {} which has no sum", cells[0], head)
        })?;
        cages.push((cells.clone(), sum));
    }

    // Sort cages by first cell for determinism.
    cages.sort_by_key(|(cells, _)| cells[0]);

    // Compact killer format has no givens — puzzle is all empty.
    Ok(ParsedConstraints {
        puzzle: ".".repeat(81),
        cages,
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
fn follow_pointers(start: usize, chars: &[char]) -> Result<usize, String> {
    let mut visited = vec![false; NUM_CELLS];
    let mut current = start;

    loop {
        if visited[current] {
            return Err(format!("Cycle detected in compact killer at cell {}", start));
        }
        visited[current] = true;

        let ch = chars[current];
        match decode_compact_char(ch) {
            CompactChar::Sum(_) => return Ok(current), // Reached a head.
            CompactChar::Direction((dr, dc)) => {
                let row = (current / 9) as i32 + dr;
                let col = (current % 9) as i32 + dc;
                if row < 0 || row >= 9 || col < 0 || col >= 9 {
                    return Err(format!(
                        "Direction pointer at cell {} goes out of bounds",
                        current
                    ));
                }
                current = (row * 9 + col) as usize;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cell_id() {
        assert_eq!(parse_cell_id("R1C1").unwrap(), 0);
        assert_eq!(parse_cell_id("R1C9").unwrap(), 8);
        assert_eq!(parse_cell_id("R9C1").unwrap(), 72);
        assert_eq!(parse_cell_id("R9C9").unwrap(), 80);
        assert_eq!(parse_cell_id("R5C5").unwrap(), 40); // (4*9 + 4)
        assert_eq!(parse_cell_id("R5C1").unwrap(), 36); // (4*9 + 0)
    }

    #[test]
    fn test_parse_plain_sudoku() {
        let puzzle = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let result = parse(puzzle).unwrap();
        assert_eq!(result.puzzle, puzzle);
        assert!(result.cages.is_empty());
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
        assert!(result.cages.len() == 1);
        assert_eq!(result.cages[0].1, 15); // sum
        assert_eq!(result.cages[0].0, vec![2, 3, 4]); // cells (0-indexed)
    }

    #[test]
    fn test_parse_mixed() {
        let input = ".~R1C1_5~R1C2_3.Cage~15~R1C3~R1C4~R1C5.Cage~3~R2C1~R2C2";
        let result = parse(input).unwrap();
        assert_eq!(result.puzzle.chars().nth(0), Some('5'));
        assert_eq!(result.puzzle.chars().nth(1), Some('3'));
        assert_eq!(result.cages.len(), 2);
        assert_eq!(result.cages[0].1, 15);
        assert_eq!(result.cages[1].1, 3);
    }

    #[test]
    fn test_compact_killer_basic() {
        // Mix of heads (digit sums) and direction arrows to trigger compact killer detection.
        // Cage 1: cell 0 = head sum 3, cell 1 points left.
        // Cage 2: cell 2 = head sum 5, cell 3 points left.
        // All other cells are single-cell cages with sum 0.
        let mut chars = vec!['0'; 81];
        chars[0] = '3';
        chars[1] = '<';
        chars[2] = '5';
        chars[3] = '<';
        let input: String = chars.into_iter().collect();
        let result = parse(&input).unwrap();
        // 2 two-cell cages + 77 single-cell cages = 79 cages.
        assert_eq!(result.cages.len(), 79);
        // Verify the two-cell cages.
        let cage_3 = result.cages.iter().find(|(_, sum)| *sum == 3).unwrap();
        assert_eq!(cage_3.0.len(), 2);
        let cage_5 = result.cages.iter().find(|(_, sum)| *sum == 5).unwrap();
        assert_eq!(cage_5.0.len(), 2);
    }

    #[test]
    fn test_compact_killer_direction() {
        // Two-cell cage: cell 0 has sum 3, cell 1 points left to cell 0.
        let mut chars = vec!['0'; 81];
        chars[0] = '3'; // Head with sum 3
        chars[1] = '<'; // Points left to cell 0
        let input: String = chars.into_iter().collect();
        let result = parse(&input).unwrap();
        // Should have 80 cages: one with 2 cells (sum 3) and 79 single-cell (sum 0).
        let two_cell = result.cages.iter().find(|(cells, _)| cells.len() == 2);
        assert!(two_cell.is_some());
        let (cells, sum) = two_cell.unwrap();
        assert_eq!(*sum, 3);
        assert!(cells.contains(&0));
        assert!(cells.contains(&1));
    }
}
