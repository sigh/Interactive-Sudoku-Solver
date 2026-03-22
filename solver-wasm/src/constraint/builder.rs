//! Sudoku builder: converts high-level [`Constraint`]s into low-level
//! [`ConstraintHandler`]s for the solver engine.
//!
//! This module is the Rust equivalent of the JavaScript `SudokuBuilder`.
//! It creates the full set of handlers (houses + constraint-specific)
//! from a list of parsed constraints.
//!
//! Cell ID strings (e.g. "R1C1") in Constraint variants are resolved to
//! numeric indexes here, matching how JS's builder calls
//! `shape.parseCellId(c).cell` in each switch case.

use super::parser::ParsedConstraints;
use super::Constraint;
use crate::api::types::{CellIndex, Value};
use crate::grid_shape::{default_num_values, GridShape};
use crate::handlers::sum::Sum;
use crate::handlers::{
    AllDifferent, AllDifferentType, And, Between, BinaryConstraint, BinaryPairwise, BoxInfo,
    ConstraintHandler, CountingCircles, DoppelgangerZero, DutchFlatmateLine, EqualSizePartitions, FullRank,
    GivenCandidates, GivenValue, HiddenSkyscraper, Indexing, JigsawPiece, LocalSquishable2x2, Lockout,
    Lunchbox, NfaConstraint, Or, Priority, RankClue, Rellik, RequiredValues, SameValues,
    Skyscraper, SumLine, TieMode, ValueDependentUniqueValueExclusion, ValueIndexing,
};
use crate::nfa::{compress_nfa, regex_to_nfa_with_offset, NfaSerializer};
use crate::solver::debug::DebugOptions;
use crate::solver::Solver;

/// Builds a [`Solver`] from a puzzle string and a list of [`Constraint`]s.
pub struct SudokuBuilder;

/// Allocates state cells beyond the grid, used by constraints like Doppelganger.
/// Mirrors JS `StateCellAllocator` from sudoku_builder.js.
struct StateCellAllocator {
    next: usize,
    num_cells: usize,
}

impl StateCellAllocator {
    fn new(num_cells: usize) -> Self {
        StateCellAllocator {
            next: num_cells,
            num_cells,
        }
    }

    fn allocate(&mut self, count: usize) -> Vec<CellIndex> {
        let start = self.next;
        self.next += count;
        (start..self.next).map(|i| i as CellIndex).collect()
    }

    fn num_state_cells(&self) -> usize {
        self.next - self.num_cells
    }
}

impl SudokuBuilder {
    /// Build a solver from parsed constraints.
    ///
    /// Mirrors JS `SudokuBuilder.build(constraint, debugOptions)`.
    /// The debug options are passed through to the solver at construction
    /// time, matching JS where the `DebugLogger` is created in the
    /// `SudokuSolver` constructor and passed to `InternalSolver` and
    /// the optimizer.
    pub fn build(
        parsed: &ParsedConstraints,
        debug_options: Option<DebugOptions>,
    ) -> Result<Solver, String> {
        let shape = parsed.shape;
        let mut state_allocator = StateCellAllocator::new(shape.num_cells);
        let handlers = Self::create_handlers(&parsed.constraints, shape, &mut state_allocator)?;
        Solver::from_handlers(handlers, shape, state_allocator.num_state_cells(), debug_options)
    }

    /// Create all constraint handlers for the given constraints.
    fn create_handlers(
        constraints: &[Constraint],
        shape: GridShape,
        state_allocator: &mut StateCellAllocator,
    ) -> Result<Vec<Box<dyn ConstraintHandler>>, String> {
        let mut handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();

        // Standard houses: rows + columns.
        Self::add_row_col_handlers(&mut handlers, shape);

        // Boxes (unless NoBoxes is specified), respecting RegionSize.
        let has_no_boxes = constraints.iter().any(|c| matches!(c, Constraint::NoBoxes));
        let box_regions = if has_no_boxes {
            Vec::new()
        } else {
            Self::box_regions(shape, Self::get_effective_box_size(constraints))
        };

        // BoxInfo handler: tells the optimizer about box regions.
        handlers.push(Box::new(BoxInfo::new(box_regions.clone())));

        if !has_no_boxes {
            Self::add_box_handlers(&mut handlers, &box_regions);
        }

        // Constraint-specific handlers.
        for constraint in constraints {
            Self::constraint_handlers(constraint, constraints, &mut handlers, shape, state_allocator)?;
        }

        Ok(handlers)
    }

    /// Add AllDifferent handlers for rows and columns.
    fn add_row_col_handlers(handlers: &mut Vec<Box<dyn ConstraintHandler>>, shape: GridShape) {
        let nv = shape.num_values;
        // Rows: always use all num_cols cells per row.
        // Mirrors JS `SudokuConstraintBase.rowRegions(shape)` which generates
        // all rows unconditionally.
        for r in 0..shape.num_rows {
            let cells: Vec<CellIndex> = (0..shape.num_cols)
                .map(|c| shape.cell_index(r, c) as CellIndex)
                .collect();
            handlers.push(Box::new(AllDifferent::new(
                cells,
                AllDifferentType::WithExclusionCells,
            )));
        }
        // Cols: always use all num_rows cells per column.
        // Mirrors JS `SudokuConstraintBase.colRegions(shape)`.
        for c in 0..shape.num_cols {
            let cells: Vec<CellIndex> = (0..shape.num_rows)
                .map(|r| shape.cell_index(r, c) as CellIndex)
                .collect();
            handlers.push(Box::new(AllDifferent::new(
                cells,
                AllDifferentType::WithExclusionCells,
            )));
        }
        let _ = nv; // kept for documentation purposes
    }

    /// Add AllDifferent handlers for boxes.
    /// Mirrors JS `_boxHandlers(boxRegions)`: iterates pre-computed box regions.
    fn add_box_handlers(
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
        box_regions: &[Vec<CellIndex>],
    ) {
        for cells in box_regions {
            handlers.push(Box::new(AllDifferent::new(
                cells.clone(),
                AllDifferentType::WithExclusionCells,
            )));
        }
    }

    /// Convert a single constraint into one or more handlers.
    ///
    /// Cell ID strings are resolved to numeric indexes here, matching
    /// JS where each builder case calls `shape.parseCellId(c).cell`.
    fn constraint_handlers(
        constraint: &Constraint,
        all_constraints: &[Constraint],
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
        state_allocator: &mut StateCellAllocator,
    ) -> Result<(), String> {
        match constraint {
            Constraint::Given { cell, values } => {
                let cell = resolve_cell_id(cell, shape);
                let ext_values: Vec<i32> = values.iter().map(|&v| v as i32).collect();
                handlers.push(Box::new(GivenCandidates::new(vec![(cell, GivenValue::Multiple(ext_values))])));
            }

            Constraint::AllDifferent { cells } => {
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(AllDifferent::new(
                    cells,
                    AllDifferentType::WithExclusionCells,
                )));
            }

            Constraint::Cage { cells, sum } => {
                let cells = resolve_cells(cells, shape);
                if *sum != 0 {
                    handlers.push(Box::new(Sum::new_cage(cells.clone(), *sum)));
                }
                handlers.push(Box::new(AllDifferent::new(
                    cells,
                    AllDifferentType::WithExclusionCells,
                )));
            }

            Constraint::Diagonal { direction } => {
                if !shape.is_square() {
                    return Err("Diagonal requires a square grid".to_string());
                } else {
                    // Use actual grid dimensions, not num_values.
                    // Mirrors JS: for (let r = 0; r < shape.numRows; r++)
                    let nr = shape.num_rows as usize;
                    let nc = shape.num_cols as usize;
                    let cells: Vec<CellIndex> = (0..nr)
                        .map(|r| {
                            let c = if *direction > 0 { nc - 1 - r } else { r };
                            shape.cell_index(r as u8, c as u8) as CellIndex
                        })
                        .collect();
                    handlers.push(Box::new(AllDifferent::new(
                        cells,
                        AllDifferentType::WithExclusionCells,
                    )));
                }
            }

            Constraint::NoBoxes => {}

            Constraint::Doppelganger => {
                Self::add_doppelganger_handlers(handlers, shape, all_constraints, state_allocator)?;
            }

            Constraint::Sum { cells, sum, coeffs } => {
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(Sum::new(cells, *sum, coeffs.clone())));
            }

            Constraint::Arrow { cells } => {
                let cells = resolve_cells(cells, shape);
                if cells.len() >= 2 {
                    let mut coeffs = vec![1i32; cells.len()];
                    coeffs[0] = -1;
                    handlers.push(Box::new(Sum::new(cells, 0, Some(coeffs))));
                }
            }

            Constraint::DoubleArrow { cells } => {
                let cells = resolve_cells(cells, shape);
                if cells.len() >= 3 {
                    let mut coeffs = vec![-1i32; cells.len()];
                    coeffs[0] = 1;
                    coeffs[cells.len() - 1] = 1;
                    handlers.push(Box::new(Sum::new(cells, 0, Some(coeffs))));
                }
            }

            Constraint::LittleKiller { sum, arrow_cell } => {
                let cells = expand_little_killer_diagonal(arrow_cell, shape)?;
                if cells.len() >= 2 {
                    handlers.push(Box::new(Sum::new(cells, *sum, None)));
                }
            }

            Constraint::XClue { cells } => {
                let cells = resolve_cells(cells, shape);
                for pair in adjacent_cell_pairs(&cells, shape) {
                    handlers.push(Box::new(Sum::new(pair.to_vec(), 10, None)));
                }
            }

            Constraint::VClue { cells } => {
                let cells = resolve_cells(cells, shape);
                for pair in adjacent_cell_pairs(&cells, shape) {
                    handlers.push(Box::new(Sum::new(pair.to_vec(), 5, None)));
                }
            }

            Constraint::Thermo { cells } => {
                let cells = resolve_cells(cells, shape);
                for pair in cells.windows(2) {
                    let pred = |a: Value, b: Value| a < b;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        pair[0],
                        pair[1],
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::Whisper { cells, difference } => {
                let cells = resolve_cells(cells, shape);
                let diff = *difference;
                for pair in cells.windows(2) {
                    let pred = move |a: Value, b: Value| (a as i32 - b as i32).abs() >= diff;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        pair[0],
                        pair[1],
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::Renban { cells } => {
                let cells = resolve_cells(cells, shape);
                let n = cells.len() as i32;
                let key = crate::handlers::fn_to_binary_key_with_offset(
                    &move |a: Value, b: Value| a != b && (a as i32 - b as i32).abs() < n,
                    shape.num_values,
                    shape.value_offset,
                );
                let mut handler = BinaryPairwise::new(key, cells, shape.num_values);
                handler.enable_hidden_singles();
                handlers.push(Box::new(handler));
            }

            Constraint::Palindrome { cells } => {
                let cells = resolve_cells(cells, shape);
                let n = cells.len();
                for i in 0..n / 2 {
                    let pred = |a: Value, b: Value| a == b;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        cells[i],
                        cells[n - 1 - i],
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::Between { cells } => {
                let cells = resolve_cells(cells, shape);
                if cells.len() >= 3 {
                    handlers.push(Box::new(Between::new(cells)));
                }
            }

            Constraint::WhiteDot { cells } => {
                let cells = resolve_cells(cells, shape);
                for [a, b] in adjacent_cell_pairs(&cells, shape) {
                    let pred = |a: Value, b: Value| (a as i32 - b as i32).abs() == 1;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        a,
                        b,
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::BlackDot { cells } => {
                let cells = resolve_cells(cells, shape);
                for [a, b] in adjacent_cell_pairs(&cells, shape) {
                    let pred = |a: Value, b: Value| a == 2 * b || b == 2 * a;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        a,
                        b,
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::GreaterThan { cells } => {
                let cells = resolve_cells(cells, shape);
                for [a, b] in adjacent_cell_pairs(&cells, shape) {
                    let pred = |a: Value, b: Value| a > b;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        a,
                        b,
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::AntiKnight => {
                Self::add_anti_handlers(handlers, shape, &|r, c| {
                    vec![
                        (r + 1, c + 2),
                        (r + 2, c + 1),
                        (r + 1, c - 2),
                        (r + 2, c - 1),
                    ]
                });
            }

            Constraint::AntiKing => {
                Self::add_anti_handlers(handlers, shape, &|r, c| {
                    vec![(r + 1, c + 1), (r + 1, c - 1)]
                });
            }

            Constraint::AntiConsecutive => {
                for (cell, adj) in Self::all_adjacent_pairs(shape) {
                    let pred = |a: Value, b: Value| (a as i32 - b as i32).abs() != 1;
                    handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                        cell,
                        adj,
                        pred,
                        shape.num_values,
                        shape.value_offset,
                    )));
                }
            }

            Constraint::Pair { key, cells } => {
                let cells = resolve_cells(cells, shape);
                for pair in cells.windows(2) {
                    handlers.push(Box::new(BinaryConstraint::from_key(
                        pair[0],
                        pair[1],
                        key.clone(),
                        shape.num_values,
                    )));
                }
            }

            Constraint::PairX { key, cells } => {
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(BinaryPairwise::new(
                    key.clone(),
                    cells,
                    shape.num_values,
                )));
            }

            Constraint::Zipper { cells } => {
                let cells = resolve_cells(cells, shape);
                let n = cells.len();
                let mut pairs: Vec<[CellIndex; 2]> = Vec::new();
                for i in 0..(n / 2) {
                    pairs.push([cells[i], cells[n - 1 - i]]);
                }
                if n % 2 == 1 {
                    // Odd: center cell equals sum of each pair.
                    let center = &[cells[n / 2]];
                    for pair in &pairs {
                        handlers.push(Box::new(Sum::make_equal(center, pair)));
                    }
                } else {
                    // Even: all pairs have the same sum.
                    for i in 1..pairs.len() {
                        for j in 0..i {
                            handlers.push(Box::new(Sum::make_equal(&pairs[i], &pairs[j])));
                        }
                    }
                }
            }

            Constraint::StrictKropki => {
                Self::strict_adj_handlers(
                    handlers,
                    all_constraints,
                    shape,
                    &[
                        |c| matches!(c, Constraint::BlackDot { .. }),
                        |c| matches!(c, Constraint::WhiteDot { .. }),
                    ],
                    |a, b| a != 2 * b && b != 2 * a && b != a - 1 && b != a + 1,
                );
            }

            Constraint::StrictXV => {
                Self::strict_adj_handlers(
                    handlers,
                    all_constraints,
                    shape,
                    &[
                        |c| matches!(c, Constraint::XClue { .. }),
                        |c| matches!(c, Constraint::VClue { .. }),
                    ],
                    |a, b| a + b != 5 && a + b != 10,
                );
            }

            Constraint::Windoku => {
                if !shape.is_square() {
                    return Err("Windoku requires a square grid".to_string());
                }
                let effective_size = Self::get_effective_box_size(all_constraints);
                for cells in Self::windoku_regions(shape, effective_size) {
                    handlers.push(Box::new(AllDifferent::new(
                        cells,
                        AllDifferentType::WithExclusionCells,
                    )));
                }
            }

            Constraint::DisjointSets => {
                if !shape.is_square() {
                    return Err("Disjoint Sets requires a square grid".to_string());
                }
                let effective_size = Self::get_effective_box_size(all_constraints);
                for cells in Self::disjoint_set_regions(shape, effective_size) {
                    handlers.push(Box::new(AllDifferent::new(
                        cells,
                        AllDifferentType::WithExclusionCells,
                    )));
                }
            }

            Constraint::PillArrow { pill_size, cells } => {
                let pill_size = *pill_size as usize;
                if pill_size != 2 && pill_size != 3 {
                    return Err("Pill size must be 2 or 3".to_string());
                }
                let mut cells = resolve_cells(cells, shape);
                if cells.len() <= pill_size {
                    return Err("Pill Arrow must have more cells than the pill size".to_string());
                }

                // Sort pill cells (first N) by index for reading order.
                cells[..pill_size].sort();

                // Build coefficients: pill digits get negative powers of 10,
                // arrow cells get +1.
                let mut coeffs = vec![1i32; cells.len()];
                for i in 0..pill_size {
                    coeffs[i] = -(10i32.pow((pill_size - 1 - i) as u32));
                }
                handlers.push(Box::new(Sum::new(cells.clone(), 0, Some(coeffs))));

                // For grids with >9 values, limit non-leading pill digits to 1-9.
                if shape.num_values > 9 {
                    let values_1_to_9: Vec<i32> = (1..=9).collect();
                    for i in 1..pill_size {
                        handlers.push(Box::new(GivenCandidates::new(vec![(cells[i], GivenValue::Multiple(values_1_to_9.clone()))])));
                    }
                }
            }

            Constraint::RegionSumLine { cells } => {
                let cells = resolve_cells(cells, shape);
                let has_no_boxes = all_constraints
                    .iter()
                    .any(|c| matches!(c, Constraint::NoBoxes));
                let box_regions = if has_no_boxes {
                    Vec::new()
                } else {
                    Self::box_regions(shape, None)
                };
                if !box_regions.is_empty() {
                    Self::region_sum_line_handlers(&cells, &box_regions, shape, handlers);
                } else {
                    // Jigsaw region fallback: collect all Jigsaw regions.
                    let jigsaw_regions: Vec<Vec<CellIndex>> = all_constraints
                        .iter()
                        .filter_map(|c| match c {
                            Constraint::Jigsaw { cells, .. } => Some(resolve_cells(cells, shape)),
                            _ => None,
                        })
                        .collect();
                    if !jigsaw_regions.is_empty() {
                        Self::region_sum_line_handlers(&cells, &jigsaw_regions, shape, handlers);
                    }
                }
            }

            Constraint::Regex { pattern, cells } => {
                let cells = resolve_cells(cells, shape);
                if let Ok(mut nfa) = regex_to_nfa_with_offset(pattern, shape.num_values, shape.value_offset) {
                    let cnfa = compress_nfa(&mut nfa);
                    handlers.push(Box::new(NfaConstraint::new(cells, cnfa)));
                }
            }

            Constraint::Nfa {
                encoded_nfa, cells, ..
            } => {
                let cells = resolve_cells(cells, shape);
                if let Ok(mut nfa) = NfaSerializer::deserialize(encoded_nfa) {
                    let cnfa = compress_nfa(&mut nfa);
                    handlers.push(Box::new(NfaConstraint::new(cells, cnfa)));
                }
            }

            Constraint::Entropic { cells } => {
                if shape.num_values != 9 || shape.value_offset != 0 {
                    return Err("Entropic Line requires exactly 9 values (1-9)".to_string());
                }
                let cells = resolve_cells(cells, shape);
                let nv = shape.num_values;
                let key = crate::handlers::fn_to_binary_key_with_offset(
                    &|a: Value, b: Value| ((a - 1) / 3) != ((b - 1) / 3),
                    nv,
                    shape.value_offset,
                );
                if cells.len() < 3 {
                    handlers.push(Box::new(BinaryPairwise::new(key, cells, nv)));
                } else {
                    for i in 3..=cells.len() {
                        let window = cells[i - 3..i].to_vec();
                        handlers.push(Box::new(BinaryPairwise::new(key.clone(), window, nv)));
                    }
                }
            }

            Constraint::Modular { mod_value, cells } => {
                let cells = resolve_cells(cells, shape);
                let m = *mod_value;
                let nv = shape.num_values;
                // First `m` cells must all be different mod m.
                let neq_key = crate::handlers::fn_to_binary_key_with_offset(
                    &move |a: Value, b: Value| (a % m) != (b % m),
                    nv,
                    shape.value_offset,
                );
                let first_cells: Vec<CellIndex> = cells.iter().take(m as usize).cloned().collect();
                if first_cells.len() >= 2 {
                    handlers.push(Box::new(BinaryPairwise::new(neq_key, first_cells, nv)));
                }
                // Cells at positions i, i+m, i+2m, ... must be equal mod m.
                let eq_key = crate::handlers::fn_to_binary_key_with_offset(
                    &move |a: Value, b: Value| (a % m) == (b % m),
                    nv,
                    shape.value_offset,
                );
                for i in 0..m as usize {
                    let stride_cells: Vec<CellIndex> =
                        cells.iter().skip(i).step_by(m as usize).cloned().collect();
                    if stride_cells.len() > 1 {
                        handlers.push(Box::new(BinaryPairwise::new(
                            eq_key.clone(),
                            stride_cells,
                            nv,
                        )));
                    }
                }
            }

            Constraint::AntiTaxicab => {
                if shape.value_offset != 0 {
                    return Err("Anti-Taxicab is incompatible with 0-based values.".to_string());
                }
                let nr = shape.num_rows as i32;
                let nc = shape.num_cols as i32;
                let nv = shape.num_values;
                for r in 0..nr {
                    for c in 0..nc {
                        let cell = shape.cell_index(r as u8, c as u8) as CellIndex;
                        let mut value_map: Vec<Vec<CellIndex>> = Vec::with_capacity(nv as usize);
                        for d in 1..=nv as i32 {
                            let mut taxicab_cells = Vec::new();
                            for rr in 0..nr {
                                let r_dist = (rr - r).abs();
                                if r_dist == 0 || r_dist >= d {
                                    continue;
                                }
                                let c_dist = d - r_dist;
                                if c - c_dist >= 0 {
                                    taxicab_cells
                                        .push(shape.cell_index(rr as u8, (c - c_dist) as u8)
                                            as CellIndex);
                                }
                                if c + c_dist < nc {
                                    taxicab_cells
                                        .push(shape.cell_index(rr as u8, (c + c_dist) as u8)
                                            as CellIndex);
                                }
                            }
                            value_map.push(taxicab_cells);
                        }
                        handlers.push(Box::new(ValueDependentUniqueValueExclusion::new(
                            cell, value_map,
                        )));
                    }
                }
            }

            Constraint::Jigsaw { grid_spec, cells } => {
                let cells = resolve_cells(cells, shape);

                // Validate gridSpec matches the puzzle shape.
                if *grid_spec != shape.name() {
                    return Err(format!(
                        "Jigsaw grid spec '{}' does not match puzzle shape '{}'",
                        grid_spec,
                        shape.name()
                    ));
                }

                // Validate region size.
                let region_size = Self::region_size(all_constraints, shape) as usize;
                if cells.len() != region_size {
                    return Err(format!(
                        "Jigsaw pieces must have {} cells for the current shape",
                        region_size
                    ));
                }

                handlers.push(Box::new(AllDifferent::new(
                    cells.clone(),
                    AllDifferentType::WithExclusionCells,
                )));
                handlers.push(Box::new(JigsawPiece::new(cells)));
            }

            // No-op: parsed for metadata, no handler needed.
            Constraint::RegionSize { .. } => {}

            Constraint::ContainAtLeast { cells, values } => {
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(RequiredValues::new(cells, values.clone(), false)));
            }

            Constraint::ContainExact { cells, values } => {
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(RequiredValues::new(cells, values.clone(), true)));
            }

            Constraint::Quad { top_left, values } => {
                // Expand topLeftCell to the 2×2 square of cells.
                let coord = shape
                    .parse_cell_id(top_left)
                    .expect("Invalid Quad topLeftCell");
                let (r, c) = (coord.row, coord.col);
                let cells: Vec<CellIndex> = [(r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)]
                    .iter()
                    .filter_map(|&(row, col)| {
                        if row < shape.num_rows && col < shape.num_cols {
                            Some(shape.cell_index(row, col) as CellIndex)
                        } else {
                            None
                        }
                    })
                    .collect();
                if cells.len() == 4 {
                    handlers.push(Box::new(RequiredValues::new(cells, values.clone(), false)));
                }
            }

            Constraint::Priority { cells, priority } => {
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(Priority::new(cells, *priority)));
            }

            Constraint::Lockout { min_diff, cells } => {
                let cells = resolve_cells(cells, shape);
                if cells.len() >= 2 {
                    handlers.push(Box::new(Lockout::new(*min_diff, cells)));
                }
            }

            Constraint::DutchFlatmates => {
                if shape.value_offset != 0 {
                    return Err("Dutch Flatmates does not support shifted value ranges.".to_string());
                }
                // One DutchFlatmateLine handler per column, containing all cells
                // in that column from top to bottom.
                // Mirrors JS: `for (const cells of SudokuConstraintBase.colRegions(shape))`
                for c in 0..shape.num_cols {
                    let col_cells: Vec<CellIndex> = (0..shape.num_rows)
                        .map(|r| shape.cell_index(r, c) as CellIndex)
                        .collect();
                    handlers.push(Box::new(DutchFlatmateLine::new(col_cells)));
                }
            }

            Constraint::ValueIndexing { cells } => {
                let cells = resolve_cells(cells, shape);
                if cells.len() >= 3 {
                    handlers.push(Box::new(ValueIndexing::new(cells)));
                }
            }

            Constraint::NumberedRoom { arrow_id, value } => {
                // Expand the arrowId (e.g. "R3,1" or "C5,-1") to a cell list.
                // Mirrors JS: `constraint.getCells(shape).map(c => shape.parseCellId(c).cell)`
                // followed by `new HandlerModule.Indexing(cells[0], cells, constraint.value)`.
                if let Some(cells) = expand_outside_line(arrow_id, shape) {
                    if !cells.is_empty() {
                        handlers.push(Box::new(Indexing::new(cells[0], cells, *value)));
                    }
                }
            }

            Constraint::Indexing {
                index_type,
                cells: control_cells,
            } => {
                // For each control cell, build the full-row or full-column cell list
                // and create one Indexing handler.
                // Mirrors JS `case 'Indexing':` in sudoku_builder.js.
                let is_row_indexing = index_type == "R";
                for cell_id in control_cells {
                    if let Ok(coord) = shape.parse_cell_id(cell_id) {
                        let indexed_value = if is_row_indexing {
                            (coord.row + 1) as u8
                        } else {
                            (coord.col + 1) as u8
                        };
                        let iter_count = if is_row_indexing {
                            shape.num_rows
                        } else {
                            shape.num_cols
                        };
                        let indexed_cells: Vec<CellIndex> = (0..iter_count)
                            .map(|i| {
                                if is_row_indexing {
                                    shape.cell_index(i, coord.col) as CellIndex
                                } else {
                                    shape.cell_index(coord.row, i) as CellIndex
                                }
                            })
                            .collect();
                        handlers.push(Box::new(Indexing::new(
                            coord.cell as CellIndex,
                            indexed_cells,
                            indexed_value,
                        )));
                    }
                }
            }

            Constraint::GlobalEntropy => {
                if shape.num_values != 9 || shape.value_offset != 0 {
                    return Err("Global Entropy requires exactly 9 values (1-9)".to_string());
                }
                // One LocalEntropy handler per 2×2 region.
                // Mirrors JS: `for (const cells of SudokuConstraintBase.square2x2Regions(shape))`
                for cells in Self::square_2x2_regions(shape) {
                    handlers.push(Box::new(LocalSquishable2x2::entropy(cells)));
                }
            }

            Constraint::GlobalMod => {
                // One LocalMod3 handler per 2×2 region.
                for cells in Self::square_2x2_regions(shape) {
                    handlers.push(Box::new(LocalSquishable2x2::mod3(cells)));
                }
            }

            Constraint::SumLine {
                sum,
                is_loop,
                cells,
            } => {
                let cells = resolve_cells(cells, shape);
                if cells.len() >= 2 {
                    handlers.push(Box::new(SumLine::new(cells, *is_loop, *sum)));
                }
            }

            Constraint::CountingCircles { cells } => {
                let cells = resolve_cells(cells, shape);
                if !cells.is_empty() {
                    handlers.push(Box::new(CountingCircles::new(cells)));
                }
            }

            Constraint::SameValues { num_sets, cells } => {
                let cells = resolve_cells(cells, shape);
                let n = *num_sets as usize;
                if cells.is_empty() || n < 2 || cells.len() % n != 0 {
                    // Skip invalid configurations.
                } else if n == cells.len() {
                    // Every cell forms its own set: all must share the same value.
                    // Use BinaryPairwise with equality key.
                    // Mirrors JS: `yield new HandlerModule.BinaryPairwise(key, ...cells)`
                    let nv = shape.num_values;
                    let key = crate::handlers::fn_to_binary_key_with_offset(&|a: Value, b: Value| a == b, nv, shape.value_offset);
                    handlers.push(Box::new(BinaryPairwise::new(key, cells, nv)));
                } else {
                    let set_size = cells.len() / n;
                    let sets: Vec<Vec<CellIndex>> = (0..n)
                        .map(|i| cells[i * set_size..(i + 1) * set_size].to_vec())
                        .collect();
                    handlers.push(Box::new(SameValues::new(sets)));
                }
            }

            Constraint::RegionSameValues => {
                // Gather all standard regions (rows, cols, boxes, jigsaws).
                // Mirrors JS `case 'RegionSameValues':` with region gathering.
                let nv = shape.num_values as usize;
                let mut regions: Vec<Vec<CellIndex>> = Vec::new();

                // Jigsaw regions.
                for c in all_constraints {
                    if let Constraint::Jigsaw { cells, .. } = c {
                        regions.push(resolve_cells(cells, shape));
                    }
                }
                // Row regions — unconditional, mirrors JS `SudokuConstraintBase.rowRegions(shape)`.
                for r in 0..shape.num_rows {
                    let row: Vec<CellIndex> = (0..shape.num_cols)
                        .map(|c| shape.cell_index(r, c) as CellIndex)
                        .collect();
                    regions.push(row);
                }
                // Column regions — unconditional, mirrors JS `SudokuConstraintBase.colRegions(shape)`.
                for c in 0..shape.num_cols {
                    let col: Vec<CellIndex> = (0..shape.num_rows)
                        .map(|r| shape.cell_index(r, c) as CellIndex)
                        .collect();
                    regions.push(col);
                }
                // Box regions.
                let has_no_boxes = all_constraints
                    .iter()
                    .any(|c| matches!(c, Constraint::NoBoxes));
                if !has_no_boxes {
                    let box_size = Self::get_effective_box_size(all_constraints);
                    regions.extend(Self::box_regions(shape, box_size));
                }

                let max_size = regions.iter().map(|r| r.len()).max().unwrap_or(0);
                let filtered: Vec<Vec<CellIndex>> = regions
                    .into_iter()
                    .filter(|r| r.len() == max_size)
                    .collect();

                // Only emit a handler when max_size < nv (otherwise the
                // standard AllDifferent houses already cover everything).
                if max_size > 0 && max_size < nv && filtered.len() >= 2 {
                    handlers.push(Box::new(SameValues::new(filtered)));
                }
            }

            Constraint::Sandwich { arrow_id, value } => {
                // Single-line outside constraint: expand to full row/col.
                // Mirrors JS: `constraint.getCells(shape).map(c => shape.parseCellId(c).cell)`
                if let Some(cells) = expand_outside_line(arrow_id, shape) {
                    if !cells.is_empty() {
                        handlers.push(Box::new(Lunchbox::new(cells, *value)));
                    }
                }
            }

            Constraint::Lunchbox { sum, cells } => {
                let cells = resolve_cells(cells, shape);
                if !cells.is_empty() {
                    handlers.push(Box::new(Lunchbox::new(cells, *sum)));
                }
            }

            Constraint::Skyscraper { arrow_id, value } => {
                if let Some(cells) = expand_outside_line(arrow_id, shape) {
                    if !cells.is_empty() && *value >= 1 {
                        handlers.push(Box::new(Skyscraper::new(cells, *value as usize)));
                    }
                }
            }

            Constraint::HiddenSkyscraper { arrow_id, value } => {
                if let Some(cells) = expand_outside_line(arrow_id, shape) {
                    if !cells.is_empty() && *value >= 1 {
                        let v = *value as u8;
                        handlers.push(Box::new(HiddenSkyscraper::new(cells, v)));
                    }
                }
            }

            Constraint::RellikCage { sum, cells } => {
                // Mirrors JS: yield new Rellik(cells, sum); yield new AllDifferent(cells);
                let cells = resolve_cells(cells, shape);
                handlers.push(Box::new(Rellik::new(cells.clone(), *sum)));
                handlers.push(Box::new(AllDifferent::new(
                    cells,
                    AllDifferentType::WithExclusionCells,
                )));
            }

            Constraint::EqualityCage { cells } => {
                // Mirrors JS:
                //   yield new AllDifferent(cells);
                //   yield new EqualSizePartitions(cells, evenValues, oddValues);
                //   yield new EqualSizePartitions(cells, lowValues, highValues);
                let cells = resolve_cells(cells, shape);
                let all_values = shape.all_values();
                handlers.push(Box::new(AllDifferent::new(
                    cells.clone(),
                    AllDifferentType::WithExclusionCells,
                )));
                // Even/odd partition: JS allValues.filter(v => v%2===0) / odd.
                let even: Vec<i32> = all_values.iter().filter(|&&v| v % 2 == 0).copied().collect();
                let odd: Vec<i32> = all_values.iter().filter(|&&v| v % 2 != 0).copied().collect();
                handlers.push(Box::new(EqualSizePartitions::new(
                    cells.clone(),
                    &even,
                    &odd,
                )));
                // Low/high partition.
                let half = all_values.len() / 2;
                let low: Vec<i32> = all_values[..half].to_vec();
                let high: Vec<i32> = all_values[all_values.len() - half..].to_vec();
                if !low.is_empty() && !high.is_empty() {
                    handlers.push(Box::new(EqualSizePartitions::new(cells, &low, &high)));
                }
            }

            Constraint::XSum { arrow_id, value } => {
                // Mirrors JS XSum case in sudoku_builder.js.
                let sum = *value;
                if let Some(cells) = expand_outside_line(arrow_id, shape) {
                    if cells.is_empty() {
                        return Ok(());
                    }
                    let control = cells[0];

                    if sum == 1 {
                        // Special case: control cell must be 1 (external value).
                        handlers.push(Box::new(GivenCandidates::new(vec![(
                            control,
                            GivenValue::Single(1),
                        )])));
                        return Ok(());
                    }

                    let mut branches: Vec<Vec<Box<dyn ConstraintHandler>>> = Vec::new();
                    for i in 2..=cells.len() {
                        let sum_rem = sum as i64 - i as i64;
                        if sum_rem < 0 {
                            break;
                        }
                        let given: Box<dyn ConstraintHandler> = Box::new(GivenCandidates::new(
                            vec![(control, GivenValue::Single(i as i32))],
                        ));
                        let sum_handler: Box<dyn ConstraintHandler> =
                            Box::new(Sum::new_cage(cells[1..i].to_vec(), sum_rem as i32));
                        branches.push(vec![given, sum_handler]);
                    }
                    Self::yield_or(branches, handlers);
                }
            }

            Constraint::FullRank { arrow_id, value } => {
                if !shape.is_square() {
                    return Err("Full Rank requires a square grid".to_string());
                }
                // Mirrors JS `case 'FullRank'` in sudoku_builder.js.
                // Each FullRank constraint becomes a single-clue FullRank handler.
                // The optimizer's optimize_full_rank() merges all handlers into one.
                if let Some(cells) = expand_outside_line(arrow_id, shape) {
                    if cells.len() >= 2 {
                        let tie_mode = full_rank_tie_mode(all_constraints);
                        let line = [cells[0] as u8, cells[1] as u8];
                        handlers.push(Box::new(FullRank::new(
                            shape.num_cells,
                            vec![RankClue { rank: *value, line }],
                            tie_mode,
                        )));
                    }
                }
            }

            Constraint::FullRankTies { ties } => {
                if !shape.is_square() {
                    return Err("Full Rank requires a square grid".to_string());
                }
                // Mirrors JS `case 'FullRankTies'`: creates a FullRank handler
                // with no clues, just to carry the tie mode into the optimizer.
                let tie_mode = parse_tie_mode(ties);
                handlers.push(Box::new(FullRank::new(shape.num_cells, vec![], tie_mode)));
            }

            Constraint::Or { groups } => {
                // Each group is a list of constraints forming one alternative.
                // Mirrors JS `Or` composite: at least one group must be satisfiable.
                let mut branches: Vec<Vec<Box<dyn ConstraintHandler>>> = Vec::new();
                for group in groups {
                    let mut gh: Vec<Box<dyn ConstraintHandler>> = Vec::new();
                    for c in group {
                        Self::constraint_handlers(c, all_constraints, &mut gh, shape, state_allocator)?;
                    }
                    branches.push(gh);
                }
                Self::yield_or(branches, handlers);
            }

            Constraint::And { constraints: inner } => {
                // All inner constraints must be satisfied — just flatten them.
                for c in inner {
                    Self::constraint_handlers(c, all_constraints, handlers, shape, state_allocator)?;
                }
            }
        }
        Ok(())
    }

    /// Wrap multiple handlers in an And, or return the single handler directly.
    /// Mirrors JS `_wrapAnd(handlers)`.
    fn wrap_and(h: Vec<Box<dyn ConstraintHandler>>) -> Box<dyn ConstraintHandler> {
        if h.len() == 1 {
            h.into_iter().next().unwrap()
        } else {
            Box::new(And::new(h))
        }
    }

    /// Yield handlers from Or branches, eliding empty/single branches.
    /// Mirrors JS `*_yieldOr(branches)`.
    fn yield_or(
        branches: Vec<Vec<Box<dyn ConstraintHandler>>>,
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
    ) {
        let non_empty: Vec<Vec<Box<dyn ConstraintHandler>>> =
            branches.into_iter().filter(|b| !b.is_empty()).collect();
        if non_empty.is_empty() {
            return;
        }
        if non_empty.len() == 1 {
            handlers.extend(non_empty.into_iter().next().unwrap());
            return;
        }
        handlers.push(Box::new(Or::new(
            non_empty.into_iter().map(Self::wrap_and).collect(),
        )));
    }

    /// Row regions: Vec of cell-index vectors, one per row.
    /// Mirrors JS `SudokuConstraintBase.rowRegions(shape)`.
    fn row_regions(shape: GridShape) -> Vec<Vec<CellIndex>> {
        (0..shape.num_rows)
            .map(|r| {
                (0..shape.num_cols)
                    .map(|c| shape.cell_index(r, c) as CellIndex)
                    .collect()
            })
            .collect()
    }

    /// Column regions: Vec of cell-index vectors, one per column.
    /// Mirrors JS `SudokuConstraintBase.colRegions(shape)`.
    fn col_regions(shape: GridShape) -> Vec<Vec<CellIndex>> {
        (0..shape.num_cols)
            .map(|c| {
                (0..shape.num_rows)
                    .map(|r| shape.cell_index(r, c) as CellIndex)
                    .collect()
            })
            .collect()
    }

    /// Add handlers for the Doppelganger constraint.
    /// Mirrors JS `_doppelgangerHandlers(shape, constraintMap, stateAllocator)`.
    fn add_doppelganger_handlers(
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
        all_constraints: &[Constraint],
        state_allocator: &mut StateCellAllocator,
    ) -> Result<(), String> {
        let region_size = Self::region_size(all_constraints, shape);
        let grid_size = shape.num_values - 1;
        if shape.value_offset != -1
            || grid_size != shape.num_rows
            || grid_size != shape.num_cols
            || grid_size != region_size
        {
            return Err(
                "Doppelganger requires shape with values 0-N \
                 (e.g. 9x9~0-9 for a 9x9 grid)."
                    .to_string(),
            );
        }

        let row_regions = Self::row_regions(shape);
        let col_regions = Self::col_regions(shape);
        let has_no_boxes = all_constraints.iter().any(|c| matches!(c, Constraint::NoBoxes));
        let box_regions = if has_no_boxes {
            Vec::new()
        } else {
            Self::box_regions(shape, Self::get_effective_box_size(all_constraints))
        };

        let zero_cell = state_allocator.allocate(1);
        let row_state_cells = state_allocator.allocate(grid_size as usize);
        let col_state_cells = state_allocator.allocate(grid_size as usize);
        let box_state_cells = if !box_regions.is_empty() {
            state_allocator.allocate(box_regions.len())
        } else {
            Vec::new()
        };

        // Fix the zero cell to value 0. Propagates through state cell
        // AllDifferent groups to prevent state cells from holding 0 (Rule 1).
        handlers.push(Box::new(GivenCandidates::new(vec![(
            zero_cell[0],
            GivenValue::Single(0),
        )])));

        // N+1 cell AllDifferent for each region + its state cell.
        for i in 0..grid_size as usize {
            let mut cells = row_regions[i].clone();
            cells.push(row_state_cells[i]);
            handlers.push(Box::new(AllDifferent::new(
                cells,
                AllDifferentType::WithExclusionCells,
            )));
        }
        for i in 0..grid_size as usize {
            let mut cells = col_regions[i].clone();
            cells.push(col_state_cells[i]);
            handlers.push(Box::new(AllDifferent::new(
                cells,
                AllDifferentType::WithExclusionCells,
            )));
        }
        for i in 0..box_regions.len() {
            let mut cells = box_regions[i].clone();
            cells.push(box_state_cells[i]);
            handlers.push(Box::new(AllDifferent::new(
                cells,
                AllDifferentType::WithExclusionCells,
            )));
        }

        // Rule 2: No two rows/columns/boxes missing the same digit.
        // N+1 cells with N+1 values → optimizer promotes to House.
        let mut row_group: Vec<CellIndex> = row_state_cells.clone();
        row_group.push(zero_cell[0]);
        handlers.push(Box::new(AllDifferent::new(
            row_group,
            AllDifferentType::WithExclusionCells,
        )));

        let mut col_group: Vec<CellIndex> = col_state_cells.clone();
        col_group.push(zero_cell[0]);
        handlers.push(Box::new(AllDifferent::new(
            col_group,
            AllDifferentType::WithExclusionCells,
        )));

        if !box_state_cells.is_empty() {
            let mut box_group: Vec<CellIndex> = box_state_cells.clone();
            box_group.push(zero_cell[0]);
            handlers.push(Box::new(AllDifferent::new(
                box_group,
                AllDifferentType::WithExclusionCells,
            )));
        }

        // Rule 3: For each 0 in the grid, the digits missing in its row,
        // column, and box must be different.
        const NO_BOX: u8 = 255;
        let mut cell_to_box = vec![NO_BOX; shape.num_cells];
        for (b, region) in box_regions.iter().enumerate() {
            for &cell in region {
                cell_to_box[cell as usize] = b as u8;
            }
        }
        for r in 0..grid_size {
            for c in 0..grid_size {
                let cell = shape.cell_index(r, c) as CellIndex;
                let mut state_cells = vec![
                    row_state_cells[r as usize],
                    col_state_cells[c as usize],
                ];
                let box_idx = cell_to_box[cell as usize];
                if box_idx != NO_BOX {
                    state_cells.push(box_state_cells[box_idx as usize]);
                }
                handlers.push(Box::new(DoppelgangerZero::new(cell, state_cells)));
            }
        }

        Ok(())
    }

    /// Add AllDifferent handlers for pairs of cells related by an exclusion
    /// function (e.g., knight's move, king's move).
    fn add_anti_handlers(
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
        shape: GridShape,
        exclusion_fn: &dyn Fn(i32, i32) -> Vec<(i32, i32)>,
    ) {
        let nr = shape.num_rows as i32;
        let nc = shape.num_cols as i32;
        for r in 0..nr {
            for c in 0..nc {
                let cell = shape.cell_index(r as u8, c as u8) as CellIndex;
                for (rr, cc) in exclusion_fn(r, c) {
                    if rr >= 0 && rr < nr && cc >= 0 && cc < nc {
                        let excl_cell = shape.cell_index(rr as u8, cc as u8) as CellIndex;
                        handlers.push(Box::new(AllDifferent::new(
                            vec![cell, excl_cell],
                            AllDifferentType::WithExclusionCells,
                        )));
                    }
                }
            }
        }
    }

    /// All orthogonally adjacent cell pairs (each pair once, smaller index first).
    fn all_adjacent_pairs(shape: GridShape) -> Vec<(CellIndex, CellIndex)> {
        let mut pairs = Vec::new();
        let nr = shape.num_rows;
        let nc = shape.num_cols;
        for r in 0..nr {
            for c in 0..nc {
                let cell = shape.cell_index(r, c) as CellIndex;
                if c + 1 < nc {
                    pairs.push((cell, shape.cell_index(r, c + 1) as CellIndex));
                }
                if r + 1 < nr {
                    pairs.push((cell, shape.cell_index(r + 1, c) as CellIndex));
                }
            }
        }
        pairs
    }

    /// Add negative-constraint handlers for Strict* constraints.
    ///
    /// For every orthogonally adjacent pair that does NOT have an explicit
    /// constraint of the given types, add a `BinaryConstraint` with the
    /// given predicate. Mirrors JS `_strictAdjHandlers`.
    fn strict_adj_handlers(
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
        all_constraints: &[Constraint],
        shape: GridShape,
        type_filters: &[fn(&Constraint) -> bool],
        pred: fn(Value, Value) -> bool,
    ) {
        // Collect all cell pairs from matching constraint types.
        let mut marked_pairs: std::collections::HashSet<(CellIndex, CellIndex)> =
            std::collections::HashSet::new();
        for c in all_constraints {
            for filter in type_filters {
                if filter(c) {
                    let cells_opt = match c {
                        Constraint::BlackDot { cells }
                        | Constraint::WhiteDot { cells }
                        | Constraint::XClue { cells }
                        | Constraint::VClue { cells } => Some(cells),
                        _ => None,
                    };
                    if let Some(cells) = cells_opt {
                        let resolved = resolve_cells(cells, shape);
                        for pair in adjacent_cell_pairs(&resolved, shape) {
                            let (a, b) = if pair[0] < pair[1] {
                                (pair[0], pair[1])
                            } else {
                                (pair[1], pair[0])
                            };
                            marked_pairs.insert((a, b));
                        }
                    }
                }
            }
        }

        // For every adjacent pair NOT marked, add the negative constraint.
        for (cell_a, cell_b) in Self::all_adjacent_pairs(shape) {
            let (a, b) = if cell_a < cell_b {
                (cell_a, cell_b)
            } else {
                (cell_b, cell_a)
            };
            if !marked_pairs.contains(&(a, b)) {
                handlers.push(Box::new(BinaryConstraint::from_predicate_with_offset(
                    a,
                    b,
                    pred,
                    shape.num_values,
                    shape.value_offset,
                )));
            }
        }
    }

    /// Get the effective box size from a RegionSize constraint, if any.
    fn get_effective_box_size(constraints: &[Constraint]) -> Option<u8> {
        constraints.iter().find_map(|c| match c {
            Constraint::RegionSize { size } => Some(*size),
            _ => None,
        })
    }

    /// Get the region size, falling back to the default num_values for the
    /// grid dimensions. Mirrors JS `_regionSize(constraintMap, shape)`.
    fn region_size(constraints: &[Constraint], shape: GridShape) -> u8 {
        Self::get_effective_box_size(constraints)
            .unwrap_or_else(|| default_num_values(shape.num_rows, shape.num_cols))
    }

    /// All 2×2 overlapping regions of the grid.
    /// Mirrors JS `SudokuConstraintBase.square2x2Regions`.
    fn square_2x2_regions(shape: GridShape) -> Vec<Vec<CellIndex>> {
        let nr = shape.num_rows;
        let nc = shape.num_cols;
        let mut regions = Vec::new();
        for r in 0..nr.saturating_sub(1) {
            for c in 0..nc.saturating_sub(1) {
                regions.push(vec![
                    shape.cell_index(r, c) as CellIndex,
                    shape.cell_index(r, c + 1) as CellIndex,
                    shape.cell_index(r + 1, c) as CellIndex,
                    shape.cell_index(r + 1, c + 1) as CellIndex,
                ]);
            }
        }
        regions
    }

    /// Compute box regions as Vec<Vec<CellIndex>> (cell indexes per box).
    /// Mirrors JS `SudokuConstraintBase.boxRegions`.
    fn box_regions(shape: GridShape, effective_size: Option<u8>) -> Vec<Vec<CellIndex>> {
        let effective_size = effective_size.unwrap_or(shape.num_values);
        let (box_h, box_w) =
            match GridShape::box_dims_for_size(shape.num_rows, shape.num_cols, effective_size) {
                Some(dims) => dims,
                None => return Vec::new(),
            };

        let num_boxes = shape.num_cells / effective_size as usize;

        (0..num_boxes)
            .map(|b| {
                shape
                    .box_cells(b, box_h, box_w)
                    .iter()
                    .map(|&c| c as CellIndex)
                    .collect()
            })
            .collect()
    }

    /// Windoku extra regions. Mirrors JS `SudokuConstraint.Windoku.regions`.
    fn windoku_regions(shape: GridShape, effective_size: Option<u8>) -> Vec<Vec<CellIndex>> {
        let nr = shape.num_rows;
        let nc = shape.num_cols;
        let effective_size = effective_size.unwrap_or(shape.num_values);

        let (box_h, box_w) = match GridShape::box_dims_for_size(nr, nc, effective_size) {
            Some(dims) => dims,
            None => return Vec::new(),
        };

        let mut regions = Vec::new();
        let mut i = 1u8;
        while i + box_w < nc {
            let mut j = 1u8;
            while j + box_h < nr {
                let mut cells = Vec::with_capacity(effective_size as usize);
                for k in 0..effective_size {
                    let row = j + (k % box_h);
                    let col = i + (k / box_h);
                    cells.push(shape.cell_index(row, col) as CellIndex);
                }
                regions.push(cells);
                j += box_h + 1;
            }
            i += box_w + 1;
        }
        regions
    }

    /// Disjoint-set regions. Mirrors JS `SudokuConstraintBase.disjointSetRegions`.
    fn disjoint_set_regions(shape: GridShape, effective_size: Option<u8>) -> Vec<Vec<CellIndex>> {
        let nc = shape.num_cols;
        let effective_size = effective_size.unwrap_or(shape.num_values);

        let (box_h, box_w) = match GridShape::box_dims_for_size(shape.num_rows, nc, effective_size)
        {
            Some(dims) => dims,
            None => return Vec::new(),
        };

        let num_sets = effective_size;
        let num_boxes = (shape.num_cells / effective_size as usize) as u8;
        let boxes_per_row = nc / box_w;

        let mut regions = Vec::with_capacity(num_sets as usize);
        for r in 0..num_sets {
            let mut cells = Vec::with_capacity(num_boxes as usize);
            for i in 0..num_boxes {
                let box_row = i / boxes_per_row;
                let box_col = i % boxes_per_row;
                let pos_row = r / box_w;
                let pos_col = r % box_w;
                let row = box_row * box_h + pos_row;
                let col = box_col * box_w + pos_col;
                cells.push(shape.cell_index(row, col) as CellIndex);
            }
            regions.push(cells);
        }
        regions
    }

    /// Region sum line handlers. Mirrors JS `_regionSumLineHandlers`.
    ///
    /// Splits the line into segments by region, then constrains segments
    /// to have equal sums.
    fn region_sum_line_handlers(
        cells: &[CellIndex],
        regions: &[Vec<CellIndex>],
        shape: GridShape,
        handlers: &mut Vec<Box<dyn ConstraintHandler>>,
    ) {
        // Build cell→region index map.
        let num_cells = shape.num_cells;
        let mut cell_to_region = vec![usize::MAX; num_cells];
        for (i, region) in regions.iter().enumerate() {
            for &cell in region {
                cell_to_region[cell as usize] = i;
            }
        }

        // Walk line, splitting into segments where the region changes.
        let mut segments: Vec<Vec<CellIndex>> = Vec::new();
        let mut cur_region = usize::MAX;
        for &cell in cells {
            let region = cell_to_region[cell as usize];
            if region != cur_region {
                cur_region = region;
                segments.push(Vec::new());
            }
            segments.last_mut().unwrap().push(cell);
        }

        // Separate single-cell segments from multi-cell segments.
        let singles: Vec<CellIndex> = segments
            .iter()
            .filter(|s| s.len() == 1)
            .map(|s| s[0])
            .collect();
        let multis: Vec<&Vec<CellIndex>> = segments.iter().filter(|s| s.len() > 1).collect();

        // If multiple singles, they must all be equal (use BinaryPairwise).
        if singles.len() > 1 {
            let nv = shape.num_values;
            let key = crate::handlers::fn_to_binary_key_with_offset(&|a: u8, b: u8| a == b, nv, shape.value_offset);
            handlers.push(Box::new(BinaryPairwise::new(key, singles.clone(), nv)));
        }

        if !singles.is_empty() {
            // Singles constrain each multi (single cell = sum of multi).
            let single_cell = &[singles[0]];
            for multi in &multis {
                handlers.push(Box::new(Sum::make_equal(single_cell, multi)));
            }
        } else {
            // Pairwise equal-sum between all multi segments.
            for i in 1..multis.len() {
                for j in 0..i {
                    handlers.push(Box::new(Sum::make_equal(multis[i], multis[j])));
                }
            }
        }
    }
}

// ====================================================================
// Cell ID resolution helpers
// ====================================================================

/// Return the TieMode from the first FullRankTies constraint in the list,
/// defaulting to OnlyUnclued (mirrors JS `fullRankTieMode(undefined)`).
fn full_rank_tie_mode(constraints: &[Constraint]) -> TieMode {
    for c in constraints {
        if let Constraint::FullRankTies { ties } = c {
            return parse_tie_mode(ties);
        }
    }
    TieMode::OnlyUnclued
}

/// Parse a FullRankTies `ties` string into a TieMode.
fn parse_tie_mode(ties: &str) -> TieMode {
    match ties {
        "none" => TieMode::None,
        "any" => TieMode::Any,
        _ => TieMode::OnlyUnclued,
    }
}

/// Resolve a cell ID string (e.g. "R1C1") to a 0-indexed cell index.
fn resolve_cell_id(cell_str: &str, shape: GridShape) -> CellIndex {
    shape.parse_cell_id(cell_str).expect("Invalid cell ID").cell as CellIndex
}

/// Resolve a slice of cell ID strings to a Vec of cell indexes.
fn resolve_cells(cells: &[String], shape: GridShape) -> Vec<CellIndex> {
    cells.iter().map(|s| resolve_cell_id(s, shape)).collect()
}

/// Find all orthogonally adjacent cell pairs among the given cells.
fn adjacent_cell_pairs(cells: &[CellIndex], shape: GridShape) -> Vec<[CellIndex; 2]> {
    let mut pairs = Vec::new();
    for i in 0..cells.len() {
        let ri = shape.row_of(cells[i] as usize) as i32;
        let ci = shape.col_of(cells[i] as usize) as i32;
        for j in (i + 1)..cells.len() {
            let rj = shape.row_of(cells[j] as usize) as i32;
            let cj = shape.col_of(cells[j] as usize) as i32;
            if (ri - rj).abs() + (ci - cj).abs() == 1 {
                pairs.push([cells[i], cells[j]]);
            }
        }
    }
    pairs
}

/// Expand a LittleKiller arrow cell into the full diagonal cell list.
///
/// The arrow cell sits on an edge of the 9×9 grid. The diagonal direction
/// is inferred from which edge it is on:
/// - Left column (col 0): down-right (+1, +1)
/// - Right column (col 8): up-left (−1, −1)  (= same diagonal, other end)
/// - Top row (row 0): down-left (+1, −1)
/// - Bottom row (row 8): up-right (−1, +1)
///
/// Mirrors JS `LittleKiller.cellMap()`.
fn expand_little_killer_diagonal(
    arrow_cell: &str,
    shape: GridShape,
) -> Result<Vec<CellIndex>, String> {
    let coord = shape.parse_cell_id(arrow_cell)?;
    let row = coord.row as i32;
    let col = coord.col as i32;
    let last_row = (shape.num_rows - 1) as i32;
    let last_col = (shape.num_cols - 1) as i32;

    // Direction is inferred from which edge the arrow cell sits on.
    // Priority order matches JS `LittleKiller.cellMap()`:
    //   1. Left column (col == 0, row < last_row)          → down-right  (+1, +1)
    //   2. Right column (col == last_col, 0 < row < last_row) → up-left  (-1, -1)
    //   3. Top row (row == 0, col > 0)                     → down-left   (+1, -1)
    //   4. Bottom row (row == last_row, 0 < col < last_col)  → up-right  (-1, +1)
    let (dr, dc) = if col == 0 && row < last_row {
        (1, 1)
    } else if col == last_col && row > 0 && row < last_row {
        (-1, -1)
    } else if row == 0 && col > 0 {
        (1, -1)
    } else if row == last_row && col > 0 && col < last_col {
        (-1, 1)
    } else {
        return Err(format!(
            "LittleKiller arrow cell {} is not on the grid edge",
            arrow_cell
        ));
    };

    let mut cells = Vec::new();
    let mut r = row;
    let mut c = col;
    let nr = shape.num_rows as i32;
    let nc = shape.num_cols as i32;
    while r >= 0 && r < nr && c >= 0 && c < nc {
        cells.push(shape.cell_index(r as u8, c as u8) as CellIndex);
        r += dr;
        c += dc;
    }

    Ok(cells)
}

/// Expand a double-line outside constraint `arrow_id` (e.g. `"R3,1"` or
/// `"C5,-1"`) into the ordered list of cell indexes for that row/column.
///
/// The ID encodes: `R{row},{dir}` or `C{col},{dir}` where `dir` is `1`
/// (forward, from index 0 upward) or `-1` (backward, reversed).
///
/// Mirrors JS `OutsideConstraintBase.fullLineCellMap(shape).get(arrowId)`.
fn expand_outside_line(arrow_id: &str, shape: GridShape) -> Option<Vec<CellIndex>> {
    // arrow_id format: "R3,1", "R3,-1", "C5,1", "C5,-1"
    let (line_part, dir_str) = arrow_id.split_once(',')?;
    let dir: i32 = dir_str.parse().ok()?;
    let reversed = dir < 0;

    let (is_row, index) = if let Some(rest) = line_part.strip_prefix('R') {
        let idx: usize = rest.parse::<usize>().ok()?.checked_sub(1)?;
        (true, idx)
    } else if let Some(rest) = line_part.strip_prefix('C') {
        let idx: usize = rest.parse::<usize>().ok()?.checked_sub(1)?;
        (false, idx)
    } else {
        return None;
    };

    let mut cells: Vec<CellIndex> = if is_row {
        if index >= shape.num_rows as usize {
            return None;
        }
        (0..shape.num_cols)
            .map(|c| shape.cell_index(index as u8, c) as CellIndex)
            .collect()
    } else {
        if index >= shape.num_cols as usize {
            return None;
        }
        (0..shape.num_rows)
            .map(|r| shape.cell_index(r, index as u8) as CellIndex)
            .collect()
    };

    if reversed {
        cells.reverse();
    }
    Some(cells)
}
#[cfg(test)]
mod tests {
    use super::{StateCellAllocator, SudokuBuilder};
    use crate::constraint::parser::{self, ParsedConstraints};
    use crate::constraint::Constraint;
    use crate::grid_shape::SHAPE_9X9;
    use crate::handlers::{And, Or, True, GivenCandidates, ConstraintHandler};

    #[test]
    fn test_build_plain_sudoku() {
        let puzzle =
            "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let parsed = parser::parse(puzzle).unwrap();
        let mut solver = SudokuBuilder::build(&parsed, None).unwrap();
        let result = solver.nth_solution(0, &mut |_| {});
        assert!(result.solution.is_some());
    }

    #[test]
    fn test_build_with_cage() {
        // Cage on first 3 cells of row 1 summing to 12 (must be 5+3+4).
        let puzzle =
            "000070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let mut parsed = parser::parse(puzzle).unwrap();
        parsed.constraints.push(Constraint::Cage {
            cells: vec!["R1C1".to_string(), "R1C2".to_string(), "R1C3".to_string()],
            sum: 12,
        });
        let mut solver = SudokuBuilder::build(&parsed, None).unwrap();
        let result = solver.nth_solution(0, &mut |_| {});
        assert!(result.solution.is_some());
    }

    #[test]
    fn test_build_with_thermo() {
        // Simple thermo on a solvable puzzle.
        let puzzle =
            "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let mut parsed = parser::parse(puzzle).unwrap();
        parsed.constraints.push(Constraint::Thermo {
            cells: vec!["R1C1".to_string(), "R1C2".to_string(), "R1C3".to_string()],
        });
        let solver = SudokuBuilder::build(&parsed, None);
        assert!(solver.is_ok());
    }

    #[test]
    fn test_build_no_boxes() {
        let _puzzle =
            ".................................................................................";
        // Without NoBoxes: 28 handlers (9 rows + 9 cols + 9 boxes + 1 BoxInfo).
        let mut state_allocator = StateCellAllocator::new(SHAPE_9X9.num_cells);
        let handlers = SudokuBuilder::create_handlers(&[], SHAPE_9X9, &mut state_allocator).unwrap();
        assert_eq!(handlers.len(), 28);
        // With NoBoxes: 19 handlers (9 rows + 9 cols + 1 BoxInfo with empty regions).
        let handlers = SudokuBuilder::create_handlers(&[Constraint::NoBoxes], SHAPE_9X9, &mut state_allocator).unwrap();
        assert_eq!(handlers.len(), 19);
    }

    #[test]
    fn test_anti_knight_handler_count() {
        let mut state_allocator = StateCellAllocator::new(SHAPE_9X9.num_cells);
        let handlers =
            SudokuBuilder::create_handlers(&[Constraint::AntiKnight], SHAPE_9X9, &mut state_allocator).unwrap();
        // 27 house handlers + knight-move pairs.
        // Each cell has up to 8 knight-move neighbors; we add only half (4
        // offsets per cell that are one-directional). Not all cells have all 4
        // valid offsets (edges/corners).
        assert!(handlers.len() > 27);
    }

    #[test]
    fn test_solve_hailstone_puzzle() {
        // End-to-end: parse + build + solve the Hailstone little killer puzzle.
        let input = "..Cage~14~R5C3~R5C4~R6C4.Cage~19~R6C6~R6C5~R7C5\
            .Cage~14~R4C4~R4C5~R3C5.Cage~14~R4C6~R5C6~R5C7\
            .Diagonal~1.Diagonal~-1\
            .LittleKiller~47~R3C1.LittleKiller~49~R2C1\
            .LittleKiller~30~R8C9.LittleKiller~45~R7C9\
            .LittleKiller~43~R1C7.LittleKiller~44~R1C8\
            .LittleKiller~34~R9C2.LittleKiller~52~R9C3";
        let parsed = crate::constraint::parser::parse(input).unwrap();
        let mut solver = SudokuBuilder::build(&parsed, None).unwrap();
        let result = solver.nth_solution(0, &mut |_| {});
        assert!(
            result.solution.is_some(),
            "Hailstone puzzle should have a solution"
        );
        let sol_str =
            crate::constraint::parser::to_short_solution(&result.solution.unwrap(), parsed.shape);
        assert_eq!(
            sol_str,
            "815432976763918245942567318278351694154896732396274581437685129681729453529143867"
        );
    }

    #[test]
    fn test_xsum_parse_and_build() {
        // A minimal XSum test: parse a constraint string that includes an XSum
        // clue and verify that the builder produces a solver without error.
        // XSum format: .XSum~rowCol~fwdValue~bwdValue
        // Using R1,1 direction with value 10 (first X cells of row 1 sum to 10).
        let input = ".XSum~R1~10~";
        let parsed = crate::constraint::parser::parse(input).unwrap();
        assert_eq!(parsed.constraints.len(), 1);
        match &parsed.constraints[0] {
            crate::constraint::Constraint::XSum { arrow_id, value } => {
                assert_eq!(arrow_id, "R1,1");
                assert_eq!(*value, 10);
            }
            other => panic!("Expected XSum, got {:?}", other),
        }
        // Builder should not error.
        let result = SudokuBuilder::build(&parsed, None);
        assert!(result.is_ok(), "Builder should accept XSum constraint");
    }

    #[test]
    fn test_or_and_build() {
        // Verify that the Or/And Constraint variants are accepted by the builder.
        // Or with two single-cell Given alternatives: R1C1 = 1 OR R1C1 = 2.
        let constraints = vec![crate::constraint::Constraint::Or {
            groups: vec![
                vec![crate::constraint::Constraint::Given {
                    cell: "R1C1".to_string(),
                    values: vec![1],
                }],
                vec![crate::constraint::Constraint::Given {
                    cell: "R1C1".to_string(),
                    values: vec![2],
                }],
            ],
        }];
        let parsed = ParsedConstraints {
            constraints,
            shape: SHAPE_9X9,
        };
        let result = SudokuBuilder::build(&parsed, None);
        assert!(result.is_ok(), "Builder should accept Or constraint");
    }

    #[test]
    fn test_full_rank_parse_and_build() {
        // Verify that FullRank and FullRankTies constraints are accepted
        // by the parser and builder without error. Uses a 9x9 empty grid.
        let input = ".FullRank~R1~17~.FullRank~C1~10~23.FullRankTies~any";
        let parsed = crate::constraint::parser::parse(input).unwrap();
        // R1~17 (forward only) + C1~10 (forward) + C1~23 (backward) = 3 FullRank + 1 FullRankTies
        assert_eq!(
            parsed
                .constraints
                .iter()
                .filter(|c| matches!(c, Constraint::FullRank { .. }))
                .count(),
            3
        );
        assert_eq!(
            parsed
                .constraints
                .iter()
                .filter(|c| matches!(c, Constraint::FullRankTies { .. }))
                .count(),
            1
        );
        let result = SudokuBuilder::build(&parsed, None);
        assert!(result.is_ok(), "Builder should accept FullRank constraints");
    }

    // =========================================================================
    // wrap_and / yield_or tests — port of sudoku_builder_or_and.test.js
    // =========================================================================

    fn collect_handlers(constraint: Constraint) -> Vec<Box<dyn ConstraintHandler>> {
        let mut state_allocator = StateCellAllocator::new(SHAPE_9X9.num_cells);
        let mut handlers = Vec::new();
        SudokuBuilder::constraint_handlers(
            &constraint,
            &[],
            &mut handlers,
            SHAPE_9X9,
            &mut state_allocator,
        )
        .unwrap();
        handlers
    }

    #[test]
    fn test_wrap_and_single_handler_returns_directly() {
        let h: Box<dyn ConstraintHandler> = Box::new(True);
        let result = SudokuBuilder::wrap_and(vec![h]);
        assert_eq!(result.name(), "True");
        assert!(result.as_any().downcast_ref::<And>().is_none());
    }

    #[test]
    fn test_wrap_and_multiple_handlers_returns_and() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(True);
        let result = SudokuBuilder::wrap_and(vec![h1, h2]);
        assert!(result.as_any().downcast_ref::<And>().is_some());
    }

    #[test]
    fn test_yield_or_empty_branches_yields_nothing() {
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![], &mut out);
        assert_eq!(out.len(), 0);
    }

    #[test]
    fn test_yield_or_all_empty_branches_yields_nothing() {
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![vec![], vec![]], &mut out);
        assert_eq!(out.len(), 0);
    }

    #[test]
    fn test_yield_or_single_branch_one_handler_yields_directly() {
        let h: Box<dyn ConstraintHandler> = Box::new(True);
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![vec![h]], &mut out);
        assert_eq!(out.len(), 1);
        assert!(out[0].as_any().downcast_ref::<Or>().is_none());
        assert!(out[0].as_any().downcast_ref::<And>().is_none());
    }

    #[test]
    fn test_yield_or_single_branch_multiple_handlers_yields_all_unwrapped() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(True);
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![vec![h1, h2]], &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name(), "True");
        assert_eq!(out[1].name(), "True");
    }

    #[test]
    fn test_yield_or_multiple_branches_yields_single_or() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(True);
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![vec![h1], vec![h2]], &mut out);
        assert_eq!(out.len(), 1);
        assert!(out[0].as_any().downcast_ref::<Or>().is_some());
    }

    #[test]
    fn test_yield_or_multiple_branches_wraps_multi_handler_in_and() {
        let h1: Box<dyn ConstraintHandler> = Box::new(True);
        let h2: Box<dyn ConstraintHandler> = Box::new(True);
        let h3: Box<dyn ConstraintHandler> = Box::new(True);
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![vec![h1, h2], vec![h3]], &mut out);
        assert_eq!(out.len(), 1);
        assert!(out[0].as_any().downcast_ref::<Or>().is_some());
    }

    #[test]
    fn test_yield_or_skips_empty_branches_among_nonempty() {
        let h: Box<dyn ConstraintHandler> = Box::new(True);
        let mut out = Vec::new();
        SudokuBuilder::yield_or(vec![vec![], vec![h], vec![]], &mut out);
        // Single non-empty branch -> yield directly.
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name(), "True");
    }

    // -- Integration: Or constraint via constraint_handlers --

    #[test]
    fn test_or_single_sub_yields_unwrapped() {
        // Or with a single Given inside should not produce an Or or And handler.
        let or = Constraint::Or {
            groups: vec![vec![Constraint::Given {
                cell: "R1C1".to_string(),
                values: vec![5],
            }]],
        };
        let handlers = collect_handlers(or);
        assert!(!handlers.is_empty());
        for h in &handlers {
            assert!(h.as_any().downcast_ref::<Or>().is_none(), "should not yield Or");
            assert!(h.as_any().downcast_ref::<And>().is_none(), "should not yield And");
        }
        assert!(handlers.iter().any(|h| h.as_any().downcast_ref::<GivenCandidates>().is_some()));
    }

    #[test]
    fn test_or_multiple_subs_yields_or() {
        let or = Constraint::Or {
            groups: vec![
                vec![Constraint::Given {
                    cell: "R1C1".to_string(),
                    values: vec![5],
                }],
                vec![Constraint::Given {
                    cell: "R1C1".to_string(),
                    values: vec![3],
                }],
            ],
        };
        let handlers = collect_handlers(or);
        assert_eq!(handlers.len(), 1);
        assert!(handlers[0].as_any().downcast_ref::<Or>().is_some());
    }

    #[test]
    fn test_or_multi_handler_sub_wraps_in_and() {
        // Cage yields Sum + AllDifferent (2 handlers), so each branch is And.
        let or = Constraint::Or {
            groups: vec![
                vec![Constraint::Cage {
                    cells: vec!["R1C1".to_string(), "R1C2".to_string(), "R1C3".to_string()],
                    sum: 10,
                }],
                vec![Constraint::Cage {
                    cells: vec!["R2C1".to_string(), "R2C2".to_string(), "R2C3".to_string()],
                    sum: 15,
                }],
            ],
        };
        let handlers = collect_handlers(or);
        assert_eq!(handlers.len(), 1);
        assert!(handlers[0].as_any().downcast_ref::<Or>().is_some());
    }

    #[test]
    fn test_or_single_multi_handler_sub_yields_all_unwrapped() {
        // Single branch Cage yields Sum + AllDifferent directly.
        let or = Constraint::Or {
            groups: vec![vec![Constraint::Cage {
                cells: vec!["R1C1".to_string(), "R1C2".to_string(), "R1C3".to_string()],
                sum: 10,
            }]],
        };
        let handlers = collect_handlers(or);
        assert_eq!(handlers.len(), 2);
        for h in &handlers {
            assert!(h.as_any().downcast_ref::<Or>().is_none(), "should not yield Or");
            assert!(h.as_any().downcast_ref::<And>().is_none(), "should not yield And");
        }
    }

    #[test]
    fn test_or_nested_or_in_or_is_unnested() {
        // Or(Or(Given1, Given2)) — outer Or should be elided.
        let or = Constraint::Or {
            groups: vec![vec![Constraint::Or {
                groups: vec![
                    vec![Constraint::Given {
                        cell: "R1C1".to_string(),
                        values: vec![5],
                    }],
                    vec![Constraint::Given {
                        cell: "R1C1".to_string(),
                        values: vec![3],
                    }],
                ],
            }]],
        };
        let handlers = collect_handlers(or);
        // Should yield a single Or (the inner one).
        assert_eq!(handlers.len(), 1);
        assert!(handlers[0].as_any().downcast_ref::<Or>().is_some());
    }

    #[test]
    fn test_or_nested_or_in_and_in_or_is_unnested() {
        // Or(And(Or(Given1, Given2))) — outer Or + And elided.
        let or = Constraint::Or {
            groups: vec![vec![Constraint::And {
                constraints: vec![Constraint::Or {
                    groups: vec![
                        vec![Constraint::Given {
                            cell: "R1C1".to_string(),
                            values: vec![5],
                        }],
                        vec![Constraint::Given {
                            cell: "R1C1".to_string(),
                            values: vec![3],
                        }],
                    ],
                }],
            }]],
        };
        let handlers = collect_handlers(or);
        assert_eq!(handlers.len(), 1);
        assert!(handlers[0].as_any().downcast_ref::<Or>().is_some());
    }

    #[test]
    fn test_elided_and_and_or() {
        // And(Given) and Or(Given): both should be elided.
        let and = Constraint::And {
            constraints: vec![Constraint::Given {
                cell: "R1C1".to_string(),
                values: vec![5],
            }],
        };
        let handlers = collect_handlers(and);
        assert!(!handlers.is_empty());
        for h in &handlers {
            assert!(h.as_any().downcast_ref::<And>().is_none());
        }
    }

    #[test]
    fn test_full_rank_4x4_solve() {
        // Two cases from the JS handler tests (full_rank.test.js):
        // 1. A solvable puzzle — constraint must not over-reject.
        // 2. An unsolvable puzzle — constraint must correctly reject it.

        // Case 1: should have at least one solution.
        {
            let input =
                ".Shape~4x4.FullRank~C1~10~.FullRank~C2~15~.FullRank~R4~5~.FullRankTies~any";
            let parsed = crate::constraint::parser::parse(input).unwrap();
            let mut solver =
                SudokuBuilder::build(&parsed, None).expect("Builder should accept 4x4 FullRank puzzle");
            let result = solver.nth_solution(0, &mut |_| {});
            assert!(
                result.solution.is_some(),
                "FullRank 4x4 solvable puzzle should have a solution"
            );
        }

        // Case 2: contradictory rank clues with FullRankTies~none → no solution.
        // Confirmed by JS test 'FullRank 4x4 regression: provided constraint string has no solutions'.
        {
            let input = ".Shape~4x4.FullRankTies~none.FullRank~C1~10~.FullRank~C2~15~.FullRank~C4~3~.FullRank~C3~~4.";
            let parsed = crate::constraint::parser::parse(input).unwrap();
            let mut solver2 =
                SudokuBuilder::build(&parsed, None).expect("Builder should accept 4x4 FullRank puzzle");
            let (count, _) = solver2.count_solutions(1, &mut |_| {});
            assert_eq!(
                count, 0,
                "Contradictory FullRank puzzle should have no solution"
            );
        }
    }
}
