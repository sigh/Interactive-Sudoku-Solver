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

use std::str::FromStr;

use super::Constraint;
use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid::Grid;
use crate::grid_shape::GridShape;
use crate::handlers::sum::Sum;
use crate::handlers::{
    AllDifferent, AllDifferentType, Between, BinaryConstraint, BinaryPairwise, BoxInfo,
    ConstraintHandler, False, GivenCandidates, JigsawPiece, NfaConstraint,
    ValueDependentUniqueValueExclusion,
};
use crate::nfa::{compress_nfa, regex_to_nfa, NfaSerializer};
use crate::solver::Solver;

/// Builds a [`Solver`] from a puzzle string and a list of [`Constraint`]s.
pub struct SudokuBuilder;

impl SudokuBuilder {
    /// Build a solver from a puzzle string, constraints, and grid shape.
    ///
    /// The puzzle string has `shape.num_cells` characters.
    /// Constraints describe additional rules beyond standard Sudoku.
    pub fn build(
        puzzle: &str,
        constraints: &[Constraint],
        shape: GridShape,
    ) -> Result<Solver, String> {
        let grid = Grid::from_str(puzzle).map_err(|e| e.to_string())?;
        let handlers = Self::create_handlers(constraints, shape);
        Solver::from_handlers(grid, handlers, shape)
    }

    /// Create all constraint handlers for the given constraints.
    fn create_handlers(
        constraints: &[Constraint],
        shape: GridShape,
    ) -> Vec<Box<dyn ConstraintHandler>> {
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
            Self::constraint_handlers(constraint, constraints, &mut handlers, shape);
        }

        handlers
    }

    /// Add AllDifferent handlers for rows and columns.
    fn add_row_col_handlers(handlers: &mut Vec<Box<dyn ConstraintHandler>>, shape: GridShape) {
        let nv = shape.num_values;
        // Rows are houses when the row length equals num_values.
        if shape.num_cols == nv {
            for r in 0..shape.num_rows {
                let cells: Vec<CellIndex> = (0..nv)
                    .map(|c| shape.cell_index(r, c) as CellIndex)
                    .collect();
                handlers.push(Box::new(AllDifferent::new(
                    cells,
                    AllDifferentType::WithExclusionCells,
                )));
            }
        }
        // Cols are houses when the column length equals num_values.
        if shape.num_rows == nv {
            for c in 0..shape.num_cols {
                let cells: Vec<CellIndex> = (0..nv)
                    .map(|r| shape.cell_index(r, c) as CellIndex)
                    .collect();
                handlers.push(Box::new(AllDifferent::new(
                    cells,
                    AllDifferentType::WithExclusionCells,
                )));
            }
        }
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
    ) {
        match constraint {
            Constraint::Given { cell, values } => {
                let cell = resolve_cell_id(cell, shape);
                let mask = values
                    .iter()
                    .fold(CandidateSet::EMPTY, |m, &v| m | CandidateSet::from_value(v));
                handlers.push(Box::new(GivenCandidates::new(vec![(cell, mask)])));
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
                    // JS throws InvalidConstraintError; in Rust, add a False
                    // handler so the puzzle correctly reports no solutions.
                    handlers.push(Box::new(False::new(vec![0])));
                } else {
                    let nv = shape.num_values as usize;
                    let cells: Vec<CellIndex> = (0..nv)
                        .map(|r| {
                            let c = if *direction > 0 { nv - 1 - r } else { r };
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
                if let Ok(cells) = expand_little_killer_diagonal(arrow_cell, shape) {
                    if cells.len() >= 2 {
                        handlers.push(Box::new(Sum::new(cells, *sum, None)));
                    }
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
                    let pred = |a: u8, b: u8| a < b;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        pair[0],
                        pair[1],
                        pred,
                        shape.num_values,
                    )));
                }
            }

            Constraint::Whisper { cells, difference } => {
                let cells = resolve_cells(cells, shape);
                let diff = *difference;
                for pair in cells.windows(2) {
                    let pred = move |a: u8, b: u8| (a as i32 - b as i32).abs() >= diff;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        pair[0],
                        pair[1],
                        pred,
                        shape.num_values,
                    )));
                }
            }

            Constraint::Renban { cells } => {
                let cells = resolve_cells(cells, shape);
                let n = cells.len() as i32;
                let key = crate::handlers::fn_to_binary_key(
                    &move |a: u8, b: u8| a != b && (a as i32 - b as i32).abs() < n,
                    shape.num_values,
                );
                let mut handler = BinaryPairwise::new(key, cells, shape.num_values);
                handler.enable_hidden_singles();
                handlers.push(Box::new(handler));
            }

            Constraint::Palindrome { cells } => {
                let cells = resolve_cells(cells, shape);
                let n = cells.len();
                for i in 0..n / 2 {
                    let pred = |a: u8, b: u8| a == b;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        cells[i],
                        cells[n - 1 - i],
                        pred,
                        shape.num_values,
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
                    let pred = |a: u8, b: u8| (a as i32 - b as i32).abs() == 1;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        a,
                        b,
                        pred,
                        shape.num_values,
                    )));
                }
            }

            Constraint::BlackDot { cells } => {
                let cells = resolve_cells(cells, shape);
                for [a, b] in adjacent_cell_pairs(&cells, shape) {
                    let pred = |a: u8, b: u8| a == 2 * b || b == 2 * a;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        a,
                        b,
                        pred,
                        shape.num_values,
                    )));
                }
            }

            Constraint::GreaterThan { cells } => {
                let cells = resolve_cells(cells, shape);
                for [a, b] in adjacent_cell_pairs(&cells, shape) {
                    let pred = |a: u8, b: u8| a > b;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        a,
                        b,
                        pred,
                        shape.num_values,
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
                    let pred = |a: u8, b: u8| (a as i32 - b as i32).abs() != 1;
                    handlers.push(Box::new(BinaryConstraint::from_predicate(
                        cell,
                        adj,
                        pred,
                        shape.num_values,
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
                let effective_size = Self::get_effective_box_size(all_constraints);
                for cells in Self::windoku_regions(shape, effective_size) {
                    handlers.push(Box::new(AllDifferent::new(
                        cells,
                        AllDifferentType::WithExclusionCells,
                    )));
                }
            }

            Constraint::DisjointSets => {
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
                    return; // Invalid pill size.
                }
                let mut cells = resolve_cells(cells, shape);
                if cells.len() <= pill_size {
                    return;
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
                    let values_1_to_9: Vec<u8> = (1..=9).collect();
                    let mask = values_1_to_9
                        .iter()
                        .fold(CandidateSet::EMPTY, |m, &v| m | CandidateSet::from_value(v));
                    for i in 1..pill_size {
                        handlers.push(Box::new(GivenCandidates::new(vec![(cells[i], mask)])));
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
                if let Ok(mut nfa) = regex_to_nfa(pattern, shape.num_values) {
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
                let cells = resolve_cells(cells, shape);
                let nv = shape.num_values;
                let key = crate::handlers::fn_to_binary_key(
                    &|a: u8, b: u8| ((a - 1) / 3) != ((b - 1) / 3),
                    nv,
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
                let neq_key =
                    crate::handlers::fn_to_binary_key(&move |a: u8, b: u8| (a % m) != (b % m), nv);
                let first_cells: Vec<CellIndex> = cells.iter().take(m as usize).cloned().collect();
                if first_cells.len() >= 2 {
                    handlers.push(Box::new(BinaryPairwise::new(neq_key, first_cells, nv)));
                }
                // Cells at positions i, i+m, i+2m, ... must be equal mod m.
                let eq_key =
                    crate::handlers::fn_to_binary_key(&move |a: u8, b: u8| (a % m) == (b % m), nv);
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
                    // JS throws InvalidConstraintError.
                    handlers.push(Box::new(False::new(vec![0])));
                    return;
                }

                // Validate region size.
                let region_size = Self::get_effective_box_size(all_constraints)
                    .unwrap_or(shape.num_values) as usize;
                if cells.len() != region_size {
                    // JS throws InvalidConstraintError.
                    handlers.push(Box::new(False::new(vec![0])));
                    return;
                }

                handlers.push(Box::new(AllDifferent::new(
                    cells.clone(),
                    AllDifferentType::WithExclusionCells,
                )));
                handlers.push(Box::new(JigsawPiece::new(cells)));
            }

            // No-op: parsed for metadata, no handler needed.
            Constraint::RegionSize { .. } => {}
        }
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
        pred: fn(u8, u8) -> bool,
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
                handlers.push(Box::new(BinaryConstraint::from_predicate(
                    a,
                    b,
                    pred,
                    shape.num_values,
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
            let key = crate::handlers::fn_to_binary_key(&|a: u8, b: u8| a == b, nv);
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

    let (dr, dc) = if col == 0 {
        (1, 1)
    } else if col == last_col {
        (-1, -1)
    } else if row == 0 {
        (1, -1)
    } else if row == last_row {
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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::grid_shape::SHAPE_9X9;

    #[test]
    fn test_build_plain_sudoku() {
        let puzzle =
            "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let mut solver = SudokuBuilder::build(puzzle, &[], SHAPE_9X9).unwrap();
        let result = solver.solve();
        assert!(result.solution.is_some());
    }

    #[test]
    fn test_build_with_cage() {
        // Cage on first 3 cells of row 1 summing to 12 (must be 5+3+4).
        let puzzle =
            "...070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let constraints = vec![Constraint::Cage {
            cells: vec!["R1C1".to_string(), "R1C2".to_string(), "R1C3".to_string()],
            sum: 12,
        }];
        let mut solver = SudokuBuilder::build(puzzle, &constraints, SHAPE_9X9).unwrap();
        let result = solver.solve();
        assert!(result.solution.is_some());
    }

    #[test]
    fn test_build_with_thermo() {
        // Simple thermo on a solvable puzzle.
        let puzzle =
            "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
        let constraints = vec![Constraint::Thermo {
            cells: vec!["R1C1".to_string(), "R1C2".to_string(), "R1C3".to_string()],
        }];
        let solver = SudokuBuilder::build(puzzle, &constraints, SHAPE_9X9);
        assert!(solver.is_ok());
    }

    #[test]
    fn test_build_no_boxes() {
        let _puzzle =
            ".................................................................................";
        // Without NoBoxes: 28 handlers (9 rows + 9 cols + 9 boxes + 1 BoxInfo).
        let handlers = SudokuBuilder::create_handlers(&[], SHAPE_9X9);
        assert_eq!(handlers.len(), 28);
        // With NoBoxes: 19 handlers (9 rows + 9 cols + 1 BoxInfo with empty regions).
        let handlers = SudokuBuilder::create_handlers(&[Constraint::NoBoxes], SHAPE_9X9);
        assert_eq!(handlers.len(), 19);
    }

    #[test]
    fn test_anti_knight_handler_count() {
        let handlers = SudokuBuilder::create_handlers(&[Constraint::AntiKnight], SHAPE_9X9);
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
        let mut solver =
            SudokuBuilder::build(&parsed.puzzle, &parsed.constraints, parsed.shape).unwrap();
        let result = solver.solve();
        assert!(
            result.solution.is_some(),
            "Hailstone puzzle should have a solution"
        );
        let sol_str = crate::grid::Grid {
            cells: result.solution.unwrap(),
        }
        .to_puzzle_string();
        assert_eq!(
            sol_str,
            "815432976763918245942567318278351694154896732396274581437685129681729453529143867"
        );
    }
}
