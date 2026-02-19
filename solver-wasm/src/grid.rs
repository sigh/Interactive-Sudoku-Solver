use crate::candidate_set::CandidateSet;
use std::fmt;
use std::str::FromStr;

/// A Sudoku grid stored as candidate bitmasks.
///
/// Each cell contains a [`CandidateSet`] where bit `i` represents value `i+1`.
/// A solved cell has exactly one bit set. An empty cell starts with all
/// bits set (e.g. `CandidateSet::all(9)` for 9×9).
#[derive(Clone, Debug)]
pub struct Grid {
    pub cells: Vec<CandidateSet>,
}

impl Grid {
    /// Create an empty grid for an arbitrary grid size.
    ///
    /// `num_cells`: total number of cells (e.g. 81 for 9×9).
    /// `num_values`: number of candidate values (e.g. 9 for 9×9).
    pub fn empty_with_size(num_cells: usize, num_values: u8) -> Self {
        Grid {
            cells: vec![CandidateSet::all(num_values); num_cells],
        }
    }

    /// Serialize the grid to an 81-character solution string.
    ///
    /// Solved cells are written as their digit. Unsolved cells are written
    /// as `'.'`.
    pub fn to_puzzle_string(&self) -> String {
        self.cells
            .iter()
            .map(|&c| {
                if !c.is_empty() && c.is_single() {
                    char::from(b'0' + c.value())
                } else {
                    '.'
                }
            })
            .collect()
    }

    /// Check if every cell has exactly one candidate (the grid is solved).
    pub fn is_solved(&self) -> bool {
        self.cells.iter().all(|&c| !c.is_empty() && c.is_single())
    }
}

impl fmt::Display for Grid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Display is a best-effort 9×9 formatter.
        let nv = 9;
        for row in 0..nv {
            if row > 0 && row % 3 == 0 {
                writeln!(f, "------+-------+------")?;
            }
            for col in 0..nv {
                if col > 0 && col % 3 == 0 {
                    write!(f, " |")?;
                }
                let cell = row * nv + col;
                let c = self.cells[cell];
                if !c.is_empty() && c.is_single() {
                    write!(f, " {}", c.value())?;
                } else {
                    write!(f, " .")?;
                }
            }
            writeln!(f)?;
        }
        Ok(())
    }
}

/// Errors that can occur when parsing a grid.
#[derive(Debug)]
pub enum GridError {
    InvalidLength(usize),
    InvalidChar(char, usize),
}

impl fmt::Display for GridError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GridError::InvalidLength(len) => {
                write!(f, "expected 81 characters, got {}", len)
            }
            GridError::InvalidChar(ch, pos) => {
                write!(f, "invalid character '{}' at position {}", ch, pos)
            }
        }
    }
}

impl std::error::Error for GridError {}

impl FromStr for Grid {
    type Err = GridError;

    /// Parse a grid from an 81-character puzzle string (9×9 only).
    ///
    /// Each character is either:
    /// - `'1'`–`'9'`: a given value (cell is fixed to that candidate)
    /// - `'.'` or `'0'`: an empty cell (all candidates available)
    fn from_str(s: &str) -> Result<Self, GridError> {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() != 81 {
            return Err(GridError::InvalidLength(chars.len()));
        }

        let mut grid = Grid::empty_with_size(81, 9);
        for (i, &ch) in chars.iter().enumerate() {
            match ch {
                '1'..='9' => {
                    let value = (ch as u8 - b'0') as u8;
                    grid.cells[i] = CandidateSet::from_value(value);
                }
                '.' | '0' => {} // keep all candidates
                _ => return Err(GridError::InvalidChar(ch, i)),
            }
        }
        Ok(grid)
    }
}

impl PartialEq for Grid {
    fn eq(&self, other: &Self) -> bool {
        self.cells == other.cells
    }
}

impl Eq for Grid {}

#[cfg(test)]
mod tests {
    use super::*;

    const EASY_PUZZLE: &str =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";

    #[test]
    fn test_empty_grid() {
        let grid = Grid::empty_with_size(81, 9);
        assert_eq!(grid.cells[0], CandidateSet::all(9));
        assert!(!grid.is_solved());
    }

    #[test]
    fn test_from_str() {
        let grid = Grid::from_str(EASY_PUZZLE).unwrap();
        // Cell 0 = '5' → from_value(5)
        assert_eq!(grid.cells[0], CandidateSet::from_value(5));
        // Cell 2 = '.' → all(9)
        assert_eq!(grid.cells[2], CandidateSet::all(9));
    }

    #[test]
    fn test_from_str_invalid_length() {
        assert!(Grid::from_str("123").is_err());
    }

    #[test]
    fn test_from_str_invalid_char() {
        let bad =
            "X3..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
        assert!(Grid::from_str(bad).is_err());
    }

    #[test]
    fn test_to_string_roundtrip() {
        let grid: Grid = EASY_PUZZLE.parse().unwrap();
        assert_eq!(grid.to_puzzle_string(), EASY_PUZZLE);
    }

    #[test]
    fn test_display() {
        let grid = Grid::from_str(EASY_PUZZLE).unwrap();
        let display = format!("{}", grid);
        assert!(display.contains("5 3 ."));
        assert!(display.contains("------+-------+------"));
    }
}
