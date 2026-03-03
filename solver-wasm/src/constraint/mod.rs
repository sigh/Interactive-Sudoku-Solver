//! Constraint type definitions for the Sudoku solver.
//!
//! Each variant of [`Constraint`] represents a high-level constraint
//! specification parsed from the frontend's URL format. Cell references
//! are stored as raw cell ID strings (e.g. `"R1C1"`), matching how the
//! JavaScript frontend stores them. The builder resolves cell IDs to
//! numeric indexes using the grid shape.
//!
//! ## Adding a new constraint type
//!
//! 1. Add a variant to [`Constraint`] and a parse function + registry entry
//!    in [`parser`](crate::constraint::parser).
//! 2. Add handler creation in
//!    [`SudokuBuilder::constraint_handlers`](crate::constraint::builder::SudokuBuilder::constraint_handlers).

pub mod builder;
pub mod parser;

use crate::api::types::Value;

/// A high-level constraint specification.
///
/// These are the "what" — parsed from the frontend's constraint string.
/// The builder converts them into the "how" (solver handlers).
///
/// Cell references are raw cell ID strings (e.g. "R1C1") from the URL.
/// The builder resolves them to numeric indexes at build time.
#[derive(Debug, Clone)]
pub enum Constraint {
    /// A given (clue): a cell is fixed to specific candidate values.
    ///
    /// Single-value givens are typically encoded in the puzzle string itself,
    /// but pencilmark restrictions (multiple allowed values) use this variant.
    Given { cell: String, values: Vec<Value> },

    /// All cells must have different values.
    AllDifferent { cells: Vec<String> },

    /// Killer cage: cells must be all-different and sum to `sum`.
    /// A sum of 0 means any sum — equivalent to just AllDifferent.
    Cage { cells: Vec<String>, sum: i32 },

    /// Diagonal constraint: one of the two main diagonals.
    /// `direction`: +1 for top-left→bottom-right, −1 for top-right→bottom-left.
    Diagonal { direction: i32 },

    /// Suppress the default 3×3 box constraints.
    NoBoxes,

    /// Generic sum constraint (cells need not be all-different).
    Sum {
        cells: Vec<String>,
        sum: i32,
        coeffs: Option<Vec<i32>>,
    },

    /// Arrow: the value in the circle cell equals the sum of the shaft cells.
    /// `cells[0]` is the circle; `cells[1..]` are the shaft.
    Arrow { cells: Vec<String> },

    /// Double arrow: the sum of the endpoint cells equals the sum of the
    /// middle cells. `cells[0]` and `cells[last]` are endpoints.
    DoubleArrow { cells: Vec<String> },

    /// Little Killer: a diagonal whose values sum to a given total.
    /// `arrow_cell` is the cell ID on the grid edge identifying the diagonal.
    /// The builder expands this to the actual diagonal cells.
    LittleKiller { sum: i32, arrow_cell: String },

    /// X clue: adjacent cells sum to 10.
    /// The builder applies the constraint to all orthogonally adjacent pairs.
    XClue { cells: Vec<String> },

    /// V clue: adjacent cells sum to 5.
    /// The builder applies the constraint to all orthogonally adjacent pairs.
    VClue { cells: Vec<String> },

    /// Thermometer: values strictly increase along the path.
    Thermo { cells: Vec<String> },

    /// German whisper: consecutive cells differ by at least `difference`.
    Whisper { cells: Vec<String>, difference: i32 },

    /// Renban: cells form a consecutive set of values (in any order).
    Renban { cells: Vec<String> },

    /// Palindrome: mirrored cells must have the same value.
    Palindrome { cells: Vec<String> },

    /// Between line: values on the line are strictly between the endpoint values.
    Between { cells: Vec<String> },

    /// White dot (Kropki): adjacent cells differ by 1.
    /// The builder applies the constraint to all orthogonally adjacent pairs.
    WhiteDot { cells: Vec<String> },

    /// Black dot (Kropki): one cell is double the other.
    /// The builder applies the constraint to all orthogonally adjacent pairs.
    BlackDot { cells: Vec<String> },

    /// Greater-than: `cells[0] > cells[1]`.
    /// The builder applies the constraint to all orthogonally adjacent pairs.
    GreaterThan { cells: Vec<String> },

    /// Anti-knight: no two cells a knight's move apart share a value.
    AntiKnight,

    /// Anti-king: no two diagonally adjacent cells share a value.
    AntiKing,

    /// Anti-consecutive: no two orthogonally adjacent cells have consecutive values.
    AntiConsecutive,

    /// Pairwise binary: applies a binary relation between consecutive cell pairs.
    /// Like Thermo/Whisper but with an arbitrary relation specified by a Base64 key.
    Pair {
        /// Base64-encoded binary key specifying the relation.
        key: String,
        cells: Vec<String>,
    },

    /// Pairwise binary (all pairs): applies a binary relation between ALL pairs
    /// of cells, not just consecutive ones.
    PairX {
        /// Base64-encoded binary key specifying the relation.
        key: String,
        cells: Vec<String>,
    },

    /// Zipper line: cells equidistant from the center sum to the same value.
    /// For odd-length lines, the center cell equals each mirror-pair sum.
    /// For even-length, all mirror-pair sums are equal.
    Zipper { cells: Vec<String> },

    /// Strict Kropki: every adjacent pair WITHOUT an explicit BlackDot or
    /// WhiteDot must NOT satisfy the Kropki relationship.
    StrictKropki,

    /// Strict XV: every adjacent pair WITHOUT an explicit X or V clue
    /// must NOT sum to 5 or 10.
    StrictXV,

    /// Windoku: extra AllDifferent regions offset from the grid edges.
    Windoku,

    /// Disjoint sets: cells at the same position within each box must be
    /// all-different.
    DisjointSets,

    /// Pill arrow: first `pill_size` cells form a multi-digit number whose
    /// value equals the sum of the remaining cells.
    PillArrow { pill_size: u8, cells: Vec<String> },

    /// Region sum line: cells are split into segments by box/jigsaw region.
    /// All segments must have the same sum.
    RegionSumLine { cells: Vec<String> },

    /// Region size override: changes the effective box size used by
    /// Windoku, DisjointSets, etc. Parsed only — no handler.
    RegionSize { size: u8 },

    /// Regex constraint: cells must match a regular expression.
    /// The pattern is stored in decoded form (not Base64).
    Regex { pattern: String, cells: Vec<String> },

    /// NFA constraint: cells must be accepted by a serialized NFA.
    /// `encoded_nfa` is the Base64-encoded NFA definition.
    /// `name` is an optional display name.
    Nfa {
        encoded_nfa: String,
        name: String,
        cells: Vec<String>,
    },

    /// Entropic line: every 3 consecutive cells must have values from
    /// different entropy groups ({1,2,3}, {4,5,6}, {7,8,9}).
    Entropic { cells: Vec<String> },

    /// Modular line: cells in groups of `mod_value` must have different
    /// values mod `mod_value`, and cells at the same offset across groups
    /// must share the same value mod `mod_value`.
    Modular { mod_value: u8, cells: Vec<String> },

    /// Anti-taxicab: no two cells with the same digit can be at a taxicab
    /// distance equal to that digit.
    AntiTaxicab,

    /// Jigsaw region: an irregular group of cells that must contain all
    /// digits without repetition. `grid_spec` identifies the grid shape.
    Jigsaw {
        grid_spec: String,
        cells: Vec<String>,
    },

    /// Cells must contain at least the specified values (with multiplicity).
    /// Mirrors JS `ContainAtLeast` constraint.
    ContainAtLeast {
        cells: Vec<String>,
        values: Vec<Value>,
    },

    /// Cells must contain exactly the specified values (with multiplicity).
    /// Mirrors JS `ContainExact` constraint.
    ContainExact {
        cells: Vec<String>,
        values: Vec<Value>,
    },

    /// Quad: the four cells of a 2×2 square must collectively contain the
    /// given values. `top_left` is the top-left cell of the square.
    Quad {
        top_left: String,
        values: Vec<Value>,
    },

    /// Priority: overrides the solver's candidate-selection order for the
    /// specified cells. Higher priority = cells selected earlier.
    Priority { cells: Vec<String>, priority: i32 },

    /// Lockout line: endpoints must differ by at least `min_diff`; intermediate
    /// cells must not lie in the locked-out range between the endpoints.
    /// Mirrors JS `Lockout` constraint.
    Lockout { min_diff: u8, cells: Vec<String> },

    /// DutchFlatmates: every occurrence of the mid value (⌈numValues/2⌉) in
    /// each column must have value 1 directly above it or value `numValues`
    /// directly below it. Global constraint; no cells stored.
    /// Mirrors JS `DutchFlatmates` constraint.
    DutchFlatmates,

    /// ValueIndexing: an arrow pointing from a value cell. The control cell
    /// (second on the line) gives the 1-based index into the remaining cells
    /// that must contain the same value as the value cell.
    /// cells = [value_cell, control_cell, indexed_cells...]
    /// Mirrors JS `ValueIndexing` constraint.
    ValueIndexing { cells: Vec<String> },

    /// NumberedRoom outside clue: the clue value gives the digit that must
    /// appear in the N-th cell of the row/column from the outside, where N is
    /// the digit in the edge cell.
    /// `arrow_id` encodes the row/column and direction, e.g. `"R3,1"` or `"C5,-1"`.
    /// Mirrors JS `NumberedRoom` constraint (OutsideConstraintBase, CLUE_TYPE_DOUBLE_LINE).
    NumberedRoom { arrow_id: String, value: u8 },

    /// Indexing (UI constraint): for each control cell in `cells`, the cell's
    /// value V tells which position in the same row (`index_type = "R"`) or
    /// column (`index_type = "C"`) contains the value equal to the control
    /// cell's column or row number respectively.
    /// Mirrors JS `Indexing` constraint.
    Indexing {
        index_type: String,
        cells: Vec<String>,
    },

    /// Global entropy: every 2×2 region must contain one value from each of
    /// the triad groups {1,2,3}, {4,5,6}, {7,8,9}.
    /// Mirrors JS `GlobalEntropy` constraint.
    GlobalEntropy,

    /// Global mod 3: every 2×2 region must contain one value from each of
    /// the triad groups {1,4,7}, {2,5,8}, {3,6,9}.
    /// Mirrors JS `GlobalMod` constraint.
    GlobalMod,

    /// Sum line: the line can be divided into non-overlapping segments each
    /// summing to `sum`. If `is_loop`, the line is treated as a loop.
    /// Mirrors JS `SumLine` constraint.
    SumLine {
        sum: u32,
        is_loop: bool,
        cells: Vec<String>,
    },

    /// Counting circles: digit v must appear exactly v times in the set.
    /// Mirrors JS `CountingCircles` constraint.
    CountingCircles { cells: Vec<String> },

    /// SameValues: multiple cell-sets of equal size must contain the same
    /// multiset of values (including count enforcement).
    /// `num_sets` tells how many equal-sized subsets `cells` is divided into.
    /// Mirrors JS `SameValues` constraint.
    SameValues { num_sets: u32, cells: Vec<String> },

    /// RegionSameValues: all standard regions (rows, cols, boxes, jigsaws)
    /// must contain the same multiset of values.
    /// Mirrors JS `RegionSameValues` constraint.
    RegionSameValues,

    /// Sandwich: values between 1 and numValues (the sentinels) in the
    /// given row/column must sum to `value`.
    /// `arrow_id`: `"R3,1"` / `"C5,-1"` encoding — same as NumberedRoom.
    /// Mirrors JS `Sandwich` constraint.
    Sandwich { arrow_id: String, value: u32 },

    /// Lunchbox: values sandwiched between the smallest and largest
    /// elements of the given cell set must sum to `sum`.
    /// Mirrors JS `Lunchbox` constraint.
    Lunchbox { sum: u32, cells: Vec<String> },

    /// Skyscraper outside clue: exactly `value` skyscrapers are visible
    /// from the start of the row/column.
    /// `arrow_id`: `"R3,1"` / `"C5,-1"` encoding — same as NumberedRoom.
    /// Mirrors JS `Skyscraper` constraint.
    Skyscraper { arrow_id: String, value: u32 },

    /// HiddenSkyscraper outside clue: `value` is the first hidden
    /// skyscraper value in the given row/column direction.
    /// `arrow_id`: `"R3,1"` / `"C5,-1"` encoding.
    /// Mirrors JS `HiddenSkyscraper` constraint.
    HiddenSkyscraper { arrow_id: String, value: u32 },

    /// Anti-killer cage: no subset of cells may sum to `sum`.
    /// Cells must also be all-different.
    /// Mirrors JS `RellikCage` constraint.
    RellikCage { sum: u32, cells: Vec<String> },

    /// Equality cage: cells are split equally between even/odd values AND
    /// between low/high values. Cells must also be all-different.
    /// Mirrors JS `EqualityCage` constraint.
    EqualityCage { cells: Vec<String> },

    /// XSum outside clue: the first X cells in the row/column sum to `value`,
    /// where X equals the digit in the control (first) cell.
    /// Mirrors JS `XSum` constraint.
    XSum { arrow_id: String, value: u32 },

    /// FullRank outside clue: `value` is the 1-based rank of this row/column
    /// when all rows and columns read from the clue direction are sorted
    /// lexicographically. Uses `CLUE_TYPE_DOUBLE_LINE` format;
    /// `arrow_id` is `"R3,1"` / `"R3,-1"` / `"C5,1"` etc.
    /// Mirrors JS `FullRank` constraint.
    FullRank { arrow_id: String, value: u32 },

    /// Global tie-mode modifier for FullRank: controls whether lines with
    /// equal values may share a rank.
    /// `ties` is `"none"`, `"only-unclued"`, or `"any"`.
    /// Mirrors JS `FullRankTies` constraint.
    FullRankTies { ties: String },

    /// Disjunctive composite: at least one group of inner constraints must
    /// hold simultaneously.
    /// Mirrors JS `Or` constraint.
    Or { groups: Vec<Vec<Constraint>> },

    /// Conjunctive composite wrapper (used internally when building Or).
    /// Mirrors JS `And` constraint.
    And { constraints: Vec<Constraint> },
}
