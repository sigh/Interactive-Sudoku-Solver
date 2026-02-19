//! Non-square grid optimizer phase.

use super::OptimizerCtx;
use crate::api::types::CellIndex;
use crate::handlers::FullGridRequiredValues;
use crate::solver::handler_set::HandlerSet;

/// For non-square grids without boxes, add FullGridRequiredValues.
///
/// Mirrors JS `_optimizeNonSquareGrids`.
pub(super) fn optimize_non_square_grids(
    hs: &mut HandlerSet,
    box_regions: &[Vec<CellIndex>],
    ctx: &mut OptimizerCtx,
) {
    // Don't need this if there are boxes.
    if !box_regions.is_empty() {
        return;
    }

    let num_values = hs.shape.num_values as usize;
    let num_rows = hs.shape.num_rows as usize;
    let num_cols = hs.shape.num_cols as usize;

    // Determine the axis with numValues lines.
    let (lines, required_line_count) = if num_cols == num_values {
        // Columns: numValues lines, each with numRows cells.
        let cols: Vec<Vec<CellIndex>> = (0..num_values)
            .map(|c| {
                hs.shape
                    .col_cells(c)
                    .iter()
                    .map(|&x| x as CellIndex)
                    .collect()
            })
            .collect();
        (cols, num_rows)
    } else if num_rows == num_values {
        // Rows: numValues lines, each with numCols cells.
        let rows: Vec<Vec<CellIndex>> = (0..num_values)
            .map(|r| {
                hs.shape
                    .row_cells(r)
                    .iter()
                    .map(|&x| x as CellIndex)
                    .collect()
            })
            .collect();
        (rows, num_cols)
    } else {
        return;
    };

    // Minimal propagation for very small counts.
    if required_line_count <= 2 {
        return;
    }

    let all_cells: Vec<CellIndex> = (0..hs.shape.num_cells as CellIndex).collect();
    let handler = FullGridRequiredValues::new(all_cells, lines);
    ctx.log_add_handler("_optimizeNonSquareGrids", &handler, None, true);
    hs.add_aux(Box::new(handler));
}
