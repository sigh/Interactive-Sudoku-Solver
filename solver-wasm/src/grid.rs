use crate::util::{self, ALL_VALUES, NUM_CELLS, NUM_VALUES};
use std::fmt;

/// A 9×9 Sudoku grid stored as candidate bitmasks.
///
/// Each cell contains a `u16` bitmask where bit `i` represents value `i+1`.
/// A solved cell has exactly one bit set. An empty cell starts with all
/// bits set (`ALL_VALUES`).
#[derive(Clone)]
pub struct Grid {
    pub cells: [u16; NUM_CELLS],
}

impl Grid {
    /// Create an empty grid with all candidates available in every cell.
    pub fn empty() -> Self {
        Grid {
            cells: [ALL_VALUES; NUM_CELLS],
        }
    }

    /// Parse a grid from an 81-character puzzle string.
    ///
    /// Each character is either:
    /// - `'1'`–`'9'`: a given value (cell is fixed to that candidate)
    /// - `'.'` or `'0'`: an empty cell (all candidates available)
    pub fn from_str(s: &str) -> Result<Self, GridError> {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() != NUM_CELLS {
            return Err(GridError::InvalidLength(chars.len()));
        }

        let mut grid = Grid::empty();
        for (i, &ch) in chars.iter().enumerate() {
            match ch {
                '1'..='9' => {
                    let value = ch as u16 - '0' as u16;
                    grid.cells[i] = util::value_bit(value);
                }
                '.' | '0' => {} // keep ALL_VALUES
                _ => return Err(GridError::InvalidChar(ch, i)),
            }
        }
        Ok(grid)
    }

    /// Serialize the grid to an 81-character solution string.
    ///
    /// Solved cells are written as their digit. Unsolved cells are written
    /// as `'.'`.
    pub fn to_string(&self) -> String {
        self.cells
            .iter()
            .map(|&c| {
                if util::is_single(c) {
                    char::from(b'0' + util::bit_value(c) as u8)
                } else {
                    '.'
                }
            })
            .collect()
    }

    /// Check if every cell has exactly one candidate (the grid is solved).
    pub fn is_solved(&self) -> bool {
        self.cells.iter().all(|&c| util::is_single(c))
    }

    // ========================================================================
    // Index helpers
    // ========================================================================

    /// Row index (0–8) for a cell index (0–80).
    #[inline(always)]
    pub fn row_of(cell: usize) -> usize {
        cell / NUM_VALUES
    }

    /// Column index (0–8) for a cell index (0–80).
    #[inline(always)]
    pub fn col_of(cell: usize) -> usize {
        cell % NUM_VALUES
    }

    /// Box index (0–8) for a cell index (0–80).
    /// Boxes are numbered left-to-right, top-to-bottom in 3×3 blocks.
    #[inline(always)]
    pub fn box_of(cell: usize) -> usize {
        (Self::row_of(cell) / 3) * 3 + Self::col_of(cell) / 3
    }

    /// All cell indices in a given row.
    pub fn row_cells(row: usize) -> [usize; NUM_VALUES] {
        let start = row * NUM_VALUES;
        std::array::from_fn(|i| start + i)
    }

    /// All cell indices in a given column.
    pub fn col_cells(col: usize) -> [usize; NUM_VALUES] {
        std::array::from_fn(|i| i * NUM_VALUES + col)
    }

    /// All cell indices in a given box.
    pub fn box_cells(box_idx: usize) -> [usize; NUM_VALUES] {
        let start_row = (box_idx / 3) * 3;
        let start_col = (box_idx % 3) * 3;
        let mut cells = [0usize; NUM_VALUES];
        let mut k = 0;
        for r in start_row..start_row + 3 {
            for c in start_col..start_col + 3 {
                cells[k] = r * NUM_VALUES + c;
                k += 1;
            }
        }
        cells
    }

    /// Get all 27 houses (9 rows + 9 columns + 9 boxes), each as an array
    /// of 9 cell indices.
    pub fn all_houses() -> Vec<[usize; NUM_VALUES]> {
        let mut houses = Vec::with_capacity(27);
        for i in 0..NUM_VALUES {
            houses.push(Self::row_cells(i));
            houses.push(Self::col_cells(i));
            houses.push(Self::box_cells(i));
        }
        houses
    }
}

impl fmt::Display for Grid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for row in 0..NUM_VALUES {
            if row > 0 && row % 3 == 0 {
                writeln!(f, "------+-------+------")?;
            }
            for col in 0..NUM_VALUES {
                if col > 0 && col % 3 == 0 {
                    write!(f, " |")?;
                }
                let cell = row * NUM_VALUES + col;
                let c = self.cells[cell];
                if util::is_single(c) {
                    write!(f, " {}", util::bit_value(c))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    const EASY_PUZZLE: &str =
        "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";

    #[test]
    fn test_empty_grid() {
        let grid = Grid::empty();
        assert_eq!(grid.cells[0], ALL_VALUES);
        assert!(!grid.is_solved());
    }

    #[test]
    fn test_from_str() {
        let grid = Grid::from_str(EASY_PUZZLE).unwrap();
        // Cell 0 = '5' → value_bit(5) = 0b10000
        assert_eq!(grid.cells[0], util::value_bit(5));
        // Cell 2 = '.' → ALL_VALUES
        assert_eq!(grid.cells[2], ALL_VALUES);
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
        let grid = Grid::from_str(EASY_PUZZLE).unwrap();
        assert_eq!(grid.to_string(), EASY_PUZZLE);
    }

    #[test]
    fn test_row_col_box() {
        // Cell 0 = row 0, col 0, box 0
        assert_eq!(Grid::row_of(0), 0);
        assert_eq!(Grid::col_of(0), 0);
        assert_eq!(Grid::box_of(0), 0);

        // Cell 80 = row 8, col 8, box 8
        assert_eq!(Grid::row_of(80), 8);
        assert_eq!(Grid::col_of(80), 8);
        assert_eq!(Grid::box_of(80), 8);

        // Cell 30 = row 3, col 3, box 4
        assert_eq!(Grid::row_of(30), 3);
        assert_eq!(Grid::col_of(30), 3);
        assert_eq!(Grid::box_of(30), 4);
    }

    #[test]
    fn test_row_cells() {
        let row0 = Grid::row_cells(0);
        assert_eq!(row0, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
        let row8 = Grid::row_cells(8);
        assert_eq!(row8, [72, 73, 74, 75, 76, 77, 78, 79, 80]);
    }

    #[test]
    fn test_col_cells() {
        let col0 = Grid::col_cells(0);
        assert_eq!(col0, [0, 9, 18, 27, 36, 45, 54, 63, 72]);
    }

    #[test]
    fn test_box_cells() {
        let box0 = Grid::box_cells(0);
        assert_eq!(box0, [0, 1, 2, 9, 10, 11, 18, 19, 20]);
        let box4 = Grid::box_cells(4);
        assert_eq!(box4, [30, 31, 32, 39, 40, 41, 48, 49, 50]);
    }

    #[test]
    fn test_all_houses() {
        let houses = Grid::all_houses();
        assert_eq!(houses.len(), 27);
        // Each house has 9 cells
        for house in &houses {
            assert_eq!(house.len(), 9);
        }
    }

    #[test]
    fn test_display() {
        let grid = Grid::from_str(EASY_PUZZLE).unwrap();
        let display = format!("{}", grid);
        assert!(display.contains("5 3 ."));
        assert!(display.contains("------+-------+------"));
    }
}
