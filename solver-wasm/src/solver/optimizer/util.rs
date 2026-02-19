//! Utility functions shared across optimizer phases.

use std::collections::HashSet;

use crate::api::types::CellIndex;
use crate::grid_shape::GridShape;
use crate::handlers::sum::Sum;
use crate::handlers::ConstraintHandler;

/// Get overlap regions for the grid.
///
/// Only includes rows if numCols == numValues (rows are houses),
/// and cols if numRows == numValues (cols are houses).
/// Includes boxes if box_regions are provided and sized numValues.
///
/// Mirrors JS `_overlapRegions`.
pub(super) fn overlap_regions(
    shape: GridShape,
    box_regions: &[Vec<CellIndex>],
) -> Vec<Vec<Vec<CellIndex>>> {
    let mut regions = Vec::new();
    let num_values = shape.num_values as usize;

    // Rows are houses if numCols == numValues.
    if shape.num_cols as usize == num_values {
        let rows: Vec<Vec<CellIndex>> = (0..shape.num_rows as usize)
            .map(|r| shape.row_cells(r).iter().map(|&c| c as CellIndex).collect())
            .collect();
        regions.push(rows.clone());
        let mut rows_rev = rows;
        rows_rev.reverse();
        regions.push(rows_rev);
    }

    // Cols are houses if numRows == numValues.
    if shape.num_rows as usize == num_values {
        let cols: Vec<Vec<CellIndex>> = (0..shape.num_cols as usize)
            .map(|c| shape.col_cells(c).iter().map(|&c| c as CellIndex).collect())
            .collect();
        regions.push(cols.clone());
        let mut cols_rev = cols;
        cols_rev.reverse();
        regions.push(cols_rev);
    }

    // Boxes (if sized numValues).
    if !box_regions.is_empty() && box_regions[0].len() == num_values {
        regions.push(box_regions.to_vec());
    }

    regions
}

/// Elementary symmetric sum of `values` taken `k` at a time.
/// Used for complexity estimation in `_findKnownRequiredValues`.
pub(super) fn elementary_symmetric_sum(values: &[usize], k: usize) -> f64 {
    let mut dp = vec![0.0f64; k + 1];
    dp[0] = 1.0;
    for &v in values {
        for i in (1..=k).rev() {
            dp[i] += dp[i - 1] * v as f64;
        }
    }
    dp[k]
}

/// General region overlap processor.
///
/// Accumulates regions one at a time, greedily adding "pieces" (sum handler
/// cells) that overlap more than half with the growing super-region.
/// After each region addition (starting from the 2nd), calls the callback
/// with the super-region, pieces-region, and used pieces.
///
/// Mirrors JS `_generalRegionOverlapProcessor`.
pub(super) fn general_region_overlap_processor(
    regions: &[Vec<CellIndex>],
    pieces: &[(Vec<CellIndex>, i32)],
    num_values: usize,
    mut callback: impl FnMut(&HashSet<CellIndex>, &HashSet<CellIndex>, &[(&Vec<CellIndex>, i32)]),
) {
    let mut super_region: HashSet<CellIndex> = HashSet::new();
    let mut remaining_pieces: HashSet<usize> = (0..pieces.len()).collect();
    let mut used_pieces: Vec<(&Vec<CellIndex>, i32)> = Vec::new();
    let mut pieces_region: HashSet<CellIndex> = HashSet::new();

    let mut count = 0;
    for region in regions {
        count += 1;
        if count >= num_values {
            break;
        }

        // Add region to super-region.
        for &c in region {
            super_region.insert(c);
        }

        // Add pieces with enough overlap.
        let remaining_copy: Vec<usize> = remaining_pieces.iter().copied().collect();
        for p_idx in remaining_copy {
            let (ref p_cells, p_sum) = pieces[p_idx];
            let intersection_size = p_cells.iter().filter(|c| super_region.contains(c)).count();
            if intersection_size > p_cells.len() / 2 {
                remaining_pieces.remove(&p_idx);
                for &c in p_cells.iter() {
                    pieces_region.insert(c);
                }
                used_pieces.push((p_cells, p_sum));
            }
        }

        // Skip the first region.
        if count == 1 {
            continue;
        }

        callback(&super_region, &pieces_region, &used_pieces);
    }
}

impl Sum {
    /// Get cells as a Vec (for optimizer use).
    pub fn cells_vec(&self) -> Vec<CellIndex> {
        self.cells().to_vec()
    }
}
