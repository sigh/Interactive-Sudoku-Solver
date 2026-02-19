//! Taxicab optimizer phase.
//!
//! Builds per-value CellExclusions and creates
//! ValueDependentUniqueValueExclusionHouse handlers for each house.

use std::rc::Rc;

use super::OptimizerCtx;
use crate::api::types::CellIndex;
use crate::handlers::{
    ConstraintHandler, House, ValueDependentUniqueValueExclusion,
    ValueDependentUniqueValueExclusionHouse,
};
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::handler_set::HandlerSet;

/// Build per-value CellExclusions clones, create
/// ValueDependentUniqueValueExclusionHouse for each house.
///
/// Mirrors JS `_optimizeTaxicab`.
pub(super) fn optimize_taxicab(
    hs: &mut HandlerSet,
    cell_exclusions: &CellExclusions,
    ctx: &mut OptimizerCtx,
) {
    let taxicab_data: Vec<(CellIndex, Vec<Vec<CellIndex>>)> = hs
        .get_all_of_type::<ValueDependentUniqueValueExclusion>()
        .iter()
        .map(|&(_, h)| {
            let cell = h.cells()[0];
            let value_map: Vec<Vec<CellIndex>> = (1..=hs.shape.num_values)
                .map(|v| h.get_value_cell_exclusions(v).to_vec())
                .collect();
            (cell, value_map)
        })
        .collect();

    if taxicab_data.is_empty() {
        return;
    }

    // Create per-value CellExclusions (shared across all house handlers).
    // JS: `const valueCellExclusions = [];` — one array shared by all houses.
    let mut value_cell_exclusions: Vec<CellExclusions> = Vec::new();
    for value_index in 0..hs.shape.num_values as usize {
        let mut vce = cell_exclusions.clone_unsealed();
        for (cell, value_map) in &taxicab_data {
            for &other_cell in &value_map[value_index] {
                vce.add_mutual_exclusion(*cell, other_cell);
            }
        }
        value_cell_exclusions.push(vce);
    }

    // Seal all CellExclusions to enable caching.
    for vce in &value_cell_exclusions {
        vce.seal();
    }

    // Wrap in Rc so all house handlers share the same array (matching JS).
    let shared_vce = Rc::new(value_cell_exclusions);

    // Create house handlers.
    let house_cells: Vec<Vec<CellIndex>> = hs
        .get_all_of_type::<House>()
        .iter()
        .map(|&(_, h)| h.cells().to_vec())
        .collect();

    for cells in house_cells {
        // All houses share the same value_cell_exclusions (matching JS).
        let handler = ValueDependentUniqueValueExclusionHouse::new(cells, Rc::clone(&shared_vce));
        ctx.log_add_handler("_optimizeTaxicab", &handler, None, false);
        hs.add_essential(Box::new(handler));
    }
}
