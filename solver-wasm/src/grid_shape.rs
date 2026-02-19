/// Grid shape — dimensions and derived constants for variable-size grids.
///
/// Equivalent to JS `GridShape` (`js/grid_shape.js`). Immutable value type,
/// cheap to copy. Created via factory methods.
///
/// ## Key invariants
/// - `1 <= num_rows, num_cols <= 16`
/// - `num_values >= max(num_rows, num_cols)` and `num_values <= 16`
/// - `num_cells = num_rows * num_cols`
/// - Cell indexes are row-major, 0-based: `cell = row * num_cols + col`
/// - Cell IDs: `"R1C1"` .. `"RGCG"` (1-indexed, base-17 digits)
use std::fmt;

use crate::api::types::CellIndex;

/// Minimum grid dimension.
pub const MIN_SIZE: u8 = 1;
/// Maximum grid dimension (matches JS `GridShape.MAX_SIZE`).
pub const MAX_SIZE: u8 = 16;

/// Parsed cell coordinate, equivalent to JS `{ cell, row, col }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellCoord {
    pub cell: usize,
    pub row: u8,
    pub col: u8,
}

/// Grid dimensions and derived constants.
///
/// Replaces the compile-time constants `NUM_VALUES`/`NUM_CELLS` with
/// runtime values so the solver can handle arbitrary grid sizes.
/// All derived values are pre-computed at construction time (matching JS
/// which pre-computes everything in the constructor then `Object.freeze`s).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GridShape {
    pub num_rows: u8,
    pub num_cols: u8,
    pub num_values: u8,
    /// Cached `num_rows * num_cols`.
    pub num_cells: usize,
    /// Cached `num_values * (num_values + 1) / 2`.
    pub max_sum: i32,
    /// Cached box dimensions, `None` if no standard boxes exist.
    pub box_dims: Option<(u8, u8)>,
}

impl GridShape {
    // ====================================================================
    // Factory methods
    // ====================================================================

    /// Create a shape from explicit dimensions, with default `num_values`.
    ///
    /// Returns `None` if dimensions are out of range.
    pub fn new(num_rows: u8, num_cols: u8) -> Option<Self> {
        if !is_valid_dimension(num_rows) || !is_valid_dimension(num_cols) {
            return None;
        }
        let num_values = default_num_values(num_rows, num_cols);
        Some(Self::build(num_rows, num_cols, num_values))
    }

    /// Constructor — all fields derived from the three core values.
    pub const fn build(num_rows: u8, num_cols: u8, num_values: u8) -> Self {
        let n = num_values as i32;
        Self {
            num_rows,
            num_cols,
            num_values,
            num_cells: num_rows as usize * num_cols as usize,
            max_sum: n * (n + 1) / 2,
            box_dims: Self::box_dims_for_size(num_rows, num_cols, num_values),
        }
    }

    /// Create a square shape: `size × size` with `num_values = size`.
    pub fn square(size: u8) -> Option<Self> {
        Self::new(size, size)
    }

    /// The standard 9×9 shape.
    pub fn default_9x9() -> Self {
        SHAPE_9X9
    }

    /// Infer a square shape from the total number of cells.
    ///
    /// Returns `None` if `n` is not a perfect square or the side length is
    /// out of range.
    ///
    /// JS: `GridShape.fromNumCells(n)`
    pub fn from_num_cells(n: usize) -> Option<Self> {
        let side = isqrt(n);
        if side * side != n {
            return None;
        }
        Self::square(side as u8)
    }

    /// Infer a square shape from the total number of pencilmarks.
    ///
    /// JS: `GridShape.fromNumPencilmarks(n)`
    pub fn from_num_pencilmarks(n: usize) -> Option<Self> {
        let side = icbrt(n);
        if side * side * side != n {
            return None;
        }
        Self::square(side as u8)
    }

    /// Parse a grid spec string like `"9x9"`, `"4x6"`, or `"9x9~9"`.
    ///
    /// JS: `GridShape.fromGridSpec(gridSpec)`
    pub fn from_grid_spec(spec: &str) -> Result<Self, String> {
        let tilde_parts: Vec<&str> = spec.split('~').collect();
        if tilde_parts.len() > 2 {
            return Err(format!("Invalid grid spec format: {}", spec));
        }

        let dims: Vec<&str> = tilde_parts[0].split('x').collect();
        if dims.len() != 2 {
            return Err(format!("Invalid grid spec format: {}", spec));
        }

        let num_rows: u8 = dims[0]
            .parse()
            .map_err(|_| format!("Invalid grid spec format: {}", spec))?;
        let num_cols: u8 = dims[1]
            .parse()
            .map_err(|_| format!("Invalid grid spec format: {}", spec))?;

        // Validate that parsing round-trips (no leading zeros, etc.)
        if num_rows.to_string() != dims[0] || num_cols.to_string() != dims[1] {
            return Err(format!("Invalid grid spec format: {}", spec));
        }

        let shape = Self::new(num_rows, num_cols)
            .ok_or_else(|| format!("Invalid grid dimensions: {}", spec))?;

        if tilde_parts.len() == 1 {
            return Ok(shape);
        }

        let num_values: u8 = tilde_parts[1]
            .parse()
            .map_err(|_| format!("Invalid grid spec format: {}", spec))?;
        if num_values.to_string() != tilde_parts[1] {
            return Err(format!("Invalid grid spec format: {}", spec));
        }

        shape
            .with_num_values(num_values)
            .ok_or_else(|| format!("Invalid numValues in grid spec: {}", spec))
    }

    /// Return a copy with a different `num_values`.
    ///
    /// Returns `None` if `num_values` is invalid (< default or > MAX_SIZE).
    ///
    /// JS: `shape.withNumValues(n)`
    pub fn with_num_values(self, num_values: u8) -> Option<Self> {
        if num_values == self.num_values {
            return Some(self);
        }
        let default = default_num_values(self.num_rows, self.num_cols);
        if num_values < default || num_values > MAX_SIZE {
            return None;
        }
        Some(Self::build(self.num_rows, self.num_cols, num_values))
    }

    // ====================================================================
    // Derived properties
    // ====================================================================

    /// Total number of pencilmarks: `num_cells * num_values`.
    #[inline(always)]
    pub fn num_pencilmarks(self) -> usize {
        self.num_cells * self.num_values as usize
    }

    /// Whether this is a square grid.
    #[inline(always)]
    pub fn is_square(self) -> bool {
        self.num_rows == self.num_cols
    }

    /// Whether `num_values` equals the default for these dimensions.
    #[inline(always)]
    pub fn is_default_num_values(self) -> bool {
        self.num_values == default_num_values(self.num_rows, self.num_cols)
    }

    // ====================================================================
    // Name / display
    // ====================================================================

    /// Short name like `"9x9"` or `"4x6~6"` (includes numValues suffix
    /// only when it differs from the default).
    ///
    /// JS: `GridShape.makeName(numRows, numCols, numValues)`
    pub fn name(self) -> String {
        if self.is_default_num_values() {
            format!("{}x{}", self.num_rows, self.num_cols)
        } else {
            format!("{}x{}~{}", self.num_rows, self.num_cols, self.num_values)
        }
    }

    /// Grid dimensions string: `"9x9"`.
    ///
    /// JS: `this.gridDimsStr`
    pub fn grid_dims_str(self) -> String {
        format!("{}x{}", self.num_rows, self.num_cols)
    }

    /// Full grid spec including numValues: `"9x9~9"`.
    ///
    /// JS: `this.fullGridSpec`
    pub fn full_grid_spec(self) -> String {
        format!("{}x{}~{}", self.num_rows, self.num_cols, self.num_values)
    }

    // ====================================================================
    // Cell coordinate conversions
    // ====================================================================

    /// Cell index from (row, col). Row-major order.
    ///
    /// JS: `this.cellIndex(row, col)`
    #[inline(always)]
    pub fn cell_index(self, row: u8, col: u8) -> usize {
        row as usize * self.num_cols as usize + col as usize
    }

    /// Row of a cell index.
    #[inline(always)]
    pub fn row_of(self, cell: usize) -> u8 {
        (cell / self.num_cols as usize) as u8
    }

    /// Column of a cell index.
    #[inline(always)]
    pub fn col_of(self, cell: usize) -> u8 {
        (cell % self.num_cols as usize) as u8
    }

    /// Split a cell index into `(row, col)`.
    ///
    /// JS: `this.splitCellIndex(cell)`
    #[inline(always)]
    pub fn split_cell_index(self, cell: usize) -> (u8, u8) {
        (self.row_of(cell), self.col_of(cell))
    }

    // ====================================================================
    // Cell ID string encoding / decoding
    // ====================================================================

    /// Parse a cell ID like `"R1C1"` or `"RGCG"` into a `CellCoord`.
    ///
    /// Cell IDs use 1-indexed base-17 encoding:
    ///   - `'1'`–`'9'` → values 1–9
    ///   - `'a'`–`'g'` (case-insensitive) → values 10–16
    ///
    /// JS: `this.parseCellId(cellId)` — `parseInt(cellId[1], 17) - 1`
    pub fn parse_cell_id(self, cell_id: &str) -> Result<CellCoord, String> {
        let bytes = cell_id.as_bytes();
        if bytes.len() < 4 {
            return Err(format!("Invalid cell ID (too short): {}", cell_id));
        }
        if bytes[0] != b'R' {
            return Err(format!("Cell ID must start with 'R': {}", cell_id));
        }

        let row_char = bytes[1] as char;
        let row = parse_base17_digit(row_char)
            .ok_or_else(|| format!("Invalid row in cell ID: {}", cell_id))?;
        if row == 0 || row > self.num_rows {
            return Err(format!(
                "Row {} out of range for {}x{} grid: {}",
                row, self.num_rows, self.num_cols, cell_id
            ));
        }
        let row = row - 1; // Convert to 0-indexed.

        if bytes[2] != b'C' {
            return Err(format!("Expected 'C' in cell ID: {}", cell_id));
        }

        let col_char = bytes[3] as char;
        let col = parse_base17_digit(col_char)
            .ok_or_else(|| format!("Invalid col in cell ID: {}", cell_id))?;
        if col == 0 || col > self.num_cols {
            return Err(format!(
                "Col {} out of range for {}x{} grid: {}",
                col, self.num_rows, self.num_cols, cell_id
            ));
        }
        let col = col - 1; // Convert to 0-indexed.

        Ok(CellCoord {
            cell: self.cell_index(row, col),
            row,
            col,
        })
    }

    /// Create a cell ID string from (row, col), both 0-indexed.
    ///
    /// JS: `this.makeCellId(row, col)`
    pub fn make_cell_id(self, row: u8, col: u8) -> String {
        let r = to_base17_digit(row + 1);
        let c = to_base17_digit(col + 1);
        format!("R{}C{}", r, c)
    }

    /// Create a cell ID from a cell index.
    ///
    /// JS: `this.makeCellIdFromIndex(i)`
    pub fn cell_id_from_index(self, cell: usize) -> String {
        let (row, col) = self.split_cell_index(cell);
        self.make_cell_id(row, col)
    }

    /// Create a value ID like `"R1C1_5"`.
    ///
    /// JS: `this.makeValueId(cellIndex, n)`
    pub fn make_value_id(self, cell: usize, value: u8) -> String {
        format!("{}_{}", self.cell_id_from_index(cell), value)
    }

    // ====================================================================
    // Box dimensions
    // ====================================================================

    /// Compute box dimensions for a target region size.
    ///
    /// Returns `Some((box_height, box_width))` where
    /// `box_height * box_width == target_size`, the grid dimensions are
    /// evenly divisible, and `box_height <= box_width`.
    ///
    /// Returns `None` if no valid box dimensions exist.
    ///
    /// JS: `GridShape.boxDimsForSize(numRows, numCols, targetSize)`
    pub const fn box_dims_for_size(
        num_rows: u8,
        num_cols: u8,
        target_size: u8,
    ) -> Option<(u8, u8)> {
        // Compute floor(sqrt(target_size)) inline. target_size <= 16.
        let mut small = 1u8;
        while (small + 1) * (small + 1) <= target_size {
            small += 1;
        }
        while small >= 2 {
            if target_size % small == 0 {
                let large = target_size / small;

                // Try both orientations.
                if num_rows % small == 0 && num_cols % large == 0 {
                    return Some((small, large));
                }
                if large != small && num_rows % large == 0 && num_cols % small == 0 {
                    return Some((large, small));
                }
            }
            small -= 1;
        }
        None
    }

    /// Base character code for displaying values.
    ///
    /// Values < 10 use `'1'`-based digits; values >= 10 use `'A'`-based
    /// letters.
    ///
    /// JS: `GridShape.baseCharCode(shape)`
    pub fn base_char_code(self) -> u8 {
        if self.num_values < 10 {
            b'1'
        } else {
            b'A'
        }
    }

    // ====================================================================
    // House / region helpers
    // ====================================================================

    /// All cell indices in a given row.
    pub fn row_cells(self, row: usize) -> Vec<usize> {
        let start = row * self.num_cols as usize;
        (start..start + self.num_cols as usize).collect()
    }

    /// All cell indices in a given column.
    pub fn col_cells(self, col: usize) -> Vec<usize> {
        (0..self.num_rows as usize)
            .map(|r| r * self.num_cols as usize + col)
            .collect()
    }

    /// Box index for a cell.
    ///
    /// Returns `None` if no standard boxes exist for this shape.
    pub fn box_of(self, cell: usize) -> Option<usize> {
        let (bh, bw) = self.box_dims?;
        let r = cell / self.num_cols as usize;
        let c = cell % self.num_cols as usize;
        let box_row = r / bh as usize;
        let box_col = c / bw as usize;
        let boxes_per_row = self.num_cols as usize / bw as usize;
        Some(box_row * boxes_per_row + box_col)
    }

    /// All cell indices in a given box, given box dimensions.
    pub fn box_cells(self, box_idx: usize, box_height: u8, box_width: u8) -> Vec<usize> {
        let boxes_per_row = self.num_cols as usize / box_width as usize;
        let start_row = (box_idx / boxes_per_row) * box_height as usize;
        let start_col = (box_idx % boxes_per_row) * box_width as usize;
        let mut cells = Vec::with_capacity(box_height as usize * box_width as usize);
        for r in start_row..start_row + box_height as usize {
            for c in start_col..start_col + box_width as usize {
                cells.push(r * self.num_cols as usize + c);
            }
        }
        cells
    }

    /// Compute box regions as `Vec<Vec<CellIndex>>`.
    /// Returns empty vec if no standard boxes exist.
    pub fn box_regions(self) -> Vec<Vec<CellIndex>> {
        if let Some((bh, bw)) = self.box_dims {
            let num_boxes =
                (self.num_rows as usize / bh as usize) * (self.num_cols as usize / bw as usize);
            (0..num_boxes)
                .map(|b| {
                    self.box_cells(b, bh, bw)
                        .iter()
                        .map(|&c| c as CellIndex)
                        .collect()
                })
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Get all houses (rows + columns + boxes if applicable).
    ///
    /// Rows are included when `num_cols == num_values`.
    /// Columns are included when `num_rows == num_values`.
    /// Boxes are included when standard box dimensions exist.
    ///
    /// Order matches JS: all rows, then all columns, then all boxes.
    pub fn all_houses(self) -> Vec<Vec<usize>> {
        let mut houses = Vec::new();
        // Rows are houses when row length == num_values.
        if self.num_cols == self.num_values {
            for r in 0..self.num_rows as usize {
                houses.push(self.row_cells(r));
            }
        }
        // Columns are houses when column length == num_values.
        if self.num_rows == self.num_values {
            for c in 0..self.num_cols as usize {
                houses.push(self.col_cells(c));
            }
        }
        // Standard boxes.
        if let Some((bh, bw)) = self.box_dims {
            let num_boxes =
                (self.num_rows as usize / bh as usize) * (self.num_cols as usize / bw as usize);
            for b in 0..num_boxes {
                houses.push(self.box_cells(b, bh, bw));
            }
        }
        houses
    }
}

impl fmt::Display for GridShape {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name())
    }
}

// ========================================================================
// Free functions
// ========================================================================

/// Default number of values for a grid of the given dimensions.
///
/// JS: `GridShape.defaultNumValues(numRows, numCols)`
#[inline]
pub fn default_num_values(num_rows: u8, num_cols: u8) -> u8 {
    num_rows.max(num_cols)
}

fn is_valid_dimension(dim: u8) -> bool {
    dim >= MIN_SIZE && dim <= MAX_SIZE
}

/// Integer square root (floor).
fn isqrt(n: usize) -> usize {
    (n as f64).sqrt() as usize
}

/// Integer cube root (floor).
fn icbrt(n: usize) -> usize {
    (n as f64).cbrt().round() as usize
}

/// Parse a single base-17 digit character. Returns 0–16 on success.
///
/// - `'0'` → 0, `'1'`–`'9'` → 1–9, `'a'`–`'g'` (case-insensitive) → 10–16
fn parse_base17_digit(ch: char) -> Option<u8> {
    match ch {
        '0'..='9' => Some(ch as u8 - b'0'),
        'a'..='g' => Some(ch as u8 - b'a' + 10),
        'A'..='G' => Some(ch as u8 - b'A' + 10),
        _ => None,
    }
}

/// Convert a value 0–16 to its base-17 digit character (lowercase).
fn to_base17_digit(v: u8) -> char {
    if v <= 9 {
        (b'0' + v) as char
    } else {
        (b'a' + v - 10) as char
    }
}

/// Pre-defined shape constants, matching JS exports.
pub const SHAPE_9X9: GridShape = GridShape::build(9, 9, 9);
pub const SHAPE_MAX: GridShape = GridShape::build(MAX_SIZE, MAX_SIZE, MAX_SIZE);

// ========================================================================
// Tests
// ========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_valid() {
        let s = GridShape::new(9, 9).unwrap();
        assert_eq!(s.num_rows, 9);
        assert_eq!(s.num_cols, 9);
        assert_eq!(s.num_values, 9);
        assert_eq!(s.num_cells, 81);
        assert_eq!(s.max_sum, 45);
        assert!(s.is_square());
    }

    #[test]
    fn test_new_rectangular() {
        let s = GridShape::new(4, 6).unwrap();
        assert_eq!(s.num_values, 6); // max(4, 6)
        assert_eq!(s.num_cells, 24);
        assert!(!s.is_square());
    }

    #[test]
    fn test_new_out_of_range() {
        assert!(GridShape::new(0, 9).is_none());
        assert!(GridShape::new(9, 0).is_none());
        assert!(GridShape::new(17, 9).is_none());
        assert!(GridShape::new(9, 17).is_none());
    }

    #[test]
    fn test_from_num_cells() {
        let s = GridShape::from_num_cells(81).unwrap();
        assert_eq!(s.num_rows, 9);
        assert_eq!(s.num_cols, 9);

        let s4 = GridShape::from_num_cells(16).unwrap();
        assert_eq!(s4.num_rows, 4);

        // Not a perfect square.
        assert!(GridShape::from_num_cells(80).is_none());
        // Side too large.
        assert!(GridShape::from_num_cells(17 * 17).is_none());
    }

    #[test]
    fn test_from_num_pencilmarks() {
        let s = GridShape::from_num_pencilmarks(729).unwrap();
        assert_eq!(s.num_rows, 9);
        assert_eq!(s.num_cols, 9);
        assert_eq!(s.num_values, 9);
    }

    #[test]
    fn test_from_grid_spec() {
        let s = GridShape::from_grid_spec("9x9").unwrap();
        assert_eq!(s, SHAPE_9X9);

        let s2 = GridShape::from_grid_spec("4x6").unwrap();
        assert_eq!(s2.num_rows, 4);
        assert_eq!(s2.num_cols, 6);
        assert_eq!(s2.num_values, 6);

        let s3 = GridShape::from_grid_spec("9x9~9").unwrap();
        assert_eq!(s3, SHAPE_9X9);

        // Invalid specs.
        assert!(GridShape::from_grid_spec("99").is_err());
        assert!(GridShape::from_grid_spec("9x9~0").is_err());
        assert!(GridShape::from_grid_spec("9x9~17").is_err());
        assert!(GridShape::from_grid_spec("9x9~8").is_err()); // < default
    }

    #[test]
    fn test_with_num_values() {
        let s = SHAPE_9X9;
        // Same value → returns self.
        assert_eq!(s.with_num_values(9), Some(s));
        // Larger value.
        let s2 = s.with_num_values(12).unwrap();
        assert_eq!(s2.num_values, 12);
        // Too small.
        assert!(s.with_num_values(8).is_none());
        // Too large.
        assert!(s.with_num_values(17).is_none());
    }

    #[test]
    fn test_cell_index_conversions() {
        let s = SHAPE_9X9;
        assert_eq!(s.cell_index(0, 0), 0);
        assert_eq!(s.cell_index(8, 8), 80);
        assert_eq!(s.cell_index(3, 3), 30);

        assert_eq!(s.row_of(0), 0);
        assert_eq!(s.col_of(0), 0);
        assert_eq!(s.row_of(80), 8);
        assert_eq!(s.col_of(80), 8);
        assert_eq!(s.row_of(30), 3);
        assert_eq!(s.col_of(30), 3);

        assert_eq!(s.split_cell_index(30), (3, 3));
    }

    #[test]
    fn test_cell_id_roundtrip_9x9() {
        let s = SHAPE_9X9;
        for cell in 0..81 {
            let id = s.cell_id_from_index(cell);
            let coord = s.parse_cell_id(&id).unwrap();
            assert_eq!(coord.cell, cell, "roundtrip failed for cell {}", cell);
        }
    }

    #[test]
    fn test_cell_id_roundtrip_16x16() {
        let s = SHAPE_MAX;
        for cell in 0..256 {
            let id = s.cell_id_from_index(cell);
            let coord = s.parse_cell_id(&id).unwrap();
            assert_eq!(coord.cell, cell, "roundtrip failed for cell {}", cell);
        }
    }

    #[test]
    fn test_parse_cell_id_specific() {
        let s = SHAPE_9X9;
        let c = s.parse_cell_id("R1C1").unwrap();
        assert_eq!(c.row, 0);
        assert_eq!(c.col, 0);
        assert_eq!(c.cell, 0);

        let c = s.parse_cell_id("R9C9").unwrap();
        assert_eq!(c.row, 8);
        assert_eq!(c.col, 8);
        assert_eq!(c.cell, 80);
    }

    #[test]
    fn test_parse_cell_id_16x16() {
        let s = SHAPE_MAX;
        // Last cell: row 16, col 16 → R(g)C(g) in base-17
        let c = s.parse_cell_id("RgCg").unwrap();
        assert_eq!(c.row, 15);
        assert_eq!(c.col, 15);
        assert_eq!(c.cell, 255);

        // Case-insensitive.
        let c2 = s.parse_cell_id("RGCG").unwrap();
        assert_eq!(c2, c);
    }

    #[test]
    fn test_parse_cell_id_errors() {
        let s = SHAPE_9X9;
        assert!(s.parse_cell_id("R0C1").is_err()); // row 0 invalid (1-indexed)
        assert!(s.parse_cell_id("R1C0").is_err()); // col 0 invalid
        assert!(s.parse_cell_id("RaC1").is_err()); // row 10 out of range for 9x9
        assert!(s.parse_cell_id("XYZ").is_err()); // too short / wrong format
    }

    #[test]
    fn test_make_cell_id() {
        let s = SHAPE_9X9;
        assert_eq!(s.make_cell_id(0, 0), "R1C1");
        assert_eq!(s.make_cell_id(8, 8), "R9C9");

        let s16 = SHAPE_MAX;
        assert_eq!(s16.make_cell_id(15, 15), "RgCg");
        assert_eq!(s16.make_cell_id(9, 9), "RaCa");
    }

    #[test]
    fn test_make_value_id() {
        let s = SHAPE_9X9;
        assert_eq!(s.make_value_id(0, 5), "R1C1_5");
    }

    #[test]
    fn test_box_dims() {
        // 9x9 → 3x3 boxes
        assert_eq!(SHAPE_9X9.box_dims, Some((3, 3)));

        // 16x16 → 4x4 boxes
        assert_eq!(SHAPE_MAX.box_dims, Some((4, 4)));

        // 4x4 → 2x2 boxes
        let s4 = GridShape::square(4).unwrap();
        assert_eq!(s4.box_dims, Some((2, 2)));

        // 6x6 → 2x3 boxes
        let s6 = GridShape::square(6).unwrap();
        assert_eq!(s6.box_dims, Some((2, 3)));

        // 4x6 with num_values=6 → 2x3 boxes
        let s46 = GridShape::new(4, 6).unwrap();
        assert_eq!(s46.box_dims, Some((2, 3)));
    }

    #[test]
    fn test_name() {
        assert_eq!(SHAPE_9X9.name(), "9x9");
        assert_eq!(SHAPE_MAX.name(), "16x16");
        let s = SHAPE_9X9.with_num_values(12).unwrap();
        assert_eq!(s.name(), "9x9~12");
    }

    #[test]
    fn test_full_grid_spec() {
        assert_eq!(SHAPE_9X9.full_grid_spec(), "9x9~9");
    }

    #[test]
    fn test_num_pencilmarks() {
        assert_eq!(SHAPE_9X9.num_pencilmarks(), 729);
    }

    #[test]
    fn test_is_default_num_values() {
        assert!(SHAPE_9X9.is_default_num_values());
        let s = SHAPE_9X9.with_num_values(12).unwrap();
        assert!(!s.is_default_num_values());
    }

    #[test]
    fn test_base_char_code() {
        assert_eq!(SHAPE_9X9.base_char_code(), b'1');
        assert_eq!(SHAPE_MAX.base_char_code(), b'A');
    }

    #[test]
    fn test_display() {
        assert_eq!(format!("{}", SHAPE_9X9), "9x9");
    }

    #[test]
    fn test_constants() {
        assert_eq!(SHAPE_9X9, GridShape::default_9x9());
        assert_eq!(SHAPE_MAX.num_rows, 16);
        assert_eq!(SHAPE_MAX.num_cols, 16);
        assert_eq!(SHAPE_MAX.num_values, 16);
    }
}
