//! HandlerSet — mirrors JS `HandlerSet` from engine.js.
//!
//! Central data structure that owns the full list of constraint handlers
//! and maintains per-cell index maps for ordinary, aux, and singleton
//! handlers. Used by the optimizer (which mutates it) and consumed by
//! the `HandlerAccumulator` for propagation.

use std::collections::HashMap;

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::handlers::ConstraintHandler;

use super::cell_exclusions::CellExclusions;
use super::grid_state_allocator::GridStateAllocator;
use super::handler_accumulator::HandlerKind;

/// A set of handlers with type queries, cell-to-handler maps, and
/// deduplication. Mirrors JS `HandlerSet`.
///
/// Maintains three per-cell handler-index maps:
/// - **ordinary**: normal constraint handlers
/// - **aux**: auxiliary handlers (only triggered on fixed cells)
/// - **singleton**: one-cell handlers (`UniqueValueExclusion`)
pub(crate) struct HandlerSet {
    handlers: Vec<Option<Box<dyn ConstraintHandler>>>,
    /// Whether each handler is essential (vs. performance-only).
    essential: Vec<bool>,
    /// Handler kind (Ordinary vs Aux).
    kind: Vec<HandlerKind>,
    /// Per-cell ordinary handler indices.
    ordinary_map: Vec<Vec<usize>>,
    /// Per-cell aux handler indices.
    aux_map: Vec<Vec<usize>>,
    /// Per-cell singleton handler indices.
    singleton_map: Vec<Vec<usize>>,
    /// Seen id strings → handler index for deduplication.
    seen: HashMap<String, usize>,
    /// Cached id_str per handler index, matching JS pre-built `idStr`.
    id_str_cache: Vec<String>,
    /// Grid shape.
    pub shape: GridShape,
}

impl HandlerSet {
    /// Create from an initial list of handlers.
    ///
    /// All initial handlers are ordinary and essential by default.
    pub fn new(handlers: Vec<Box<dyn ConstraintHandler>>, shape: GridShape) -> Self {
        let num_cells = shape.num_cells;
        let mut ordinary_map = vec![Vec::new(); num_cells];
        let aux_map = vec![Vec::new(); num_cells];
        let mut singleton_map = vec![Vec::new(); num_cells];
        let mut seen = HashMap::new();
        let mut essential_flags = Vec::with_capacity(handlers.len());
        let mut kind_flags = Vec::with_capacity(handlers.len());
        let mut id_str_cache = Vec::with_capacity(handlers.len());

        let handlers: Vec<Option<Box<dyn ConstraintHandler>>> = handlers
            .into_iter()
            .enumerate()
            .map(|(idx, h)| {
                let id = h.id_str();
                seen.insert(id.clone(), idx);
                id_str_cache.push(id);
                // Mirrors JS: SINGLETON_HANDLER=true → singletonHandlerMap only.
                if h.is_singleton() {
                    for &c in h.cells() {
                        singleton_map[c as usize].push(idx);
                    }
                } else {
                    for &c in h.cells() {
                        ordinary_map[c as usize].push(idx);
                    }
                }
                essential_flags.push(h.is_essential());
                kind_flags.push(HandlerKind::Ordinary);
                Some(h)
            })
            .collect();

        HandlerSet {
            handlers,
            essential: essential_flags,
            kind: kind_flags,
            ordinary_map,
            aux_map,
            singleton_map,
            seen,
            id_str_cache,
            shape,
        }
    }

    // ========================================================================
    // Accessors
    // ========================================================================

    /// Get handler reference by index.
    pub fn get(&self, idx: usize) -> Option<&dyn ConstraintHandler> {
        self.handlers[idx].as_ref().map(|h| h.as_ref())
    }

    /// Get mutable handler reference by index.
    pub fn get_mut(&mut self, idx: usize) -> Option<&mut Box<dyn ConstraintHandler>> {
        self.handlers[idx].as_mut()
    }

    /// Iterate over all live (non-deleted) handlers.
    pub fn iter(&self) -> impl Iterator<Item = &dyn ConstraintHandler> {
        self.handlers.iter().filter_map(|h| h.as_deref())
    }

    /// Get all handlers of a specific concrete type (by downcasting).
    pub fn get_all_of_type<T: 'static>(&self) -> Vec<(usize, &T)> {
        self.handlers
            .iter()
            .enumerate()
            .filter_map(|(idx, h)| {
                h.as_ref()
                    .and_then(|h| h.as_any().downcast_ref::<T>())
                    .map(|t| (idx, t))
            })
            .collect()
    }

    /// Per-cell ordinary handler index map, matching JS `getOrdinaryHandlerMap`.
    pub fn ordinary_map(&self) -> &[Vec<usize>] {
        &self.ordinary_map
    }

    /// Cached id string for the handler at `idx`, matching JS `idStr` property.
    pub fn get_id_str(&self, idx: usize) -> &str {
        &self.id_str_cache[idx]
    }

    /// Get handler indices that share any cell with the given handler.
    ///
    /// Only searches the ordinary map, matching JS `getIntersectingIndexes`.
    pub fn get_intersecting_indices(&self, handler_idx: usize) -> std::collections::HashSet<usize> {
        let mut result = std::collections::HashSet::new();
        if let Some(h) = &self.handlers[handler_idx] {
            for &c in h.cells() {
                for &idx in &self.ordinary_map[c as usize] {
                    if idx != handler_idx {
                        result.insert(idx);
                    }
                }
            }
        }
        result
    }

    // ========================================================================
    // Mutation (add / replace / delete)
    // ========================================================================

    /// Add an ordinary handler (essential). Deduplicates by id_str.
    pub fn add_essential(&mut self, handler: Box<dyn ConstraintHandler>) -> Option<usize> {
        let id = handler.id_str();
        if let Some(&existing_idx) = self.seen.get(&id) {
            // Upgrade essentialness if needed.
            self.essential[existing_idx] = true;
            return None;
        }

        let idx = self.handlers.len();
        self.seen.insert(id.clone(), idx);
        Self::append_to_map(&mut self.ordinary_map, handler.cells(), idx);
        self.essential.push(true);
        self.kind.push(HandlerKind::Ordinary);
        self.handlers.push(Some(handler));
        self.id_str_cache.push(id);
        Some(idx)
    }

    /// Add an ordinary handler (non-essential). Deduplicates by id_str.
    pub fn add_non_essential(&mut self, handler: Box<dyn ConstraintHandler>) -> Option<usize> {
        self.add_with_kind(handler, HandlerKind::Ordinary)
    }

    /// Add an aux handler (non-essential, only triggered on fixed cells).
    /// Mirrors JS `handlerSet.addAux()`.
    pub fn add_aux(&mut self, handler: Box<dyn ConstraintHandler>) -> Option<usize> {
        self.add_with_kind(handler, HandlerKind::Aux)
    }

    /// Add singleton handlers (one per cell, e.g. `UniqueValueExclusion`).
    /// Mirrors JS `handlerSet.addSingletonHandlers()`.
    pub fn add_singleton_handler(&mut self, handler: Box<dyn ConstraintHandler>) -> usize {
        let id = handler.id_str();
        debug_assert!(
            !self.seen.contains_key(&id),
            "Singleton handlers must be unique"
        );
        let idx = self.handlers.len();
        self.seen.insert(id.clone(), idx);
        Self::append_to_map(&mut self.singleton_map, handler.cells(), idx);
        self.essential.push(handler.is_essential());
        self.kind.push(HandlerKind::Ordinary);
        self.handlers.push(Some(handler));
        self.id_str_cache.push(id);
        idx
    }

    /// Replace a handler at the given index. Updates cell maps if cells changed.
    /// Mirrors JS `handlerSet.replace()`.
    pub fn replace(&mut self, idx: usize, new_handler: Box<dyn ConstraintHandler>) {
        if let Some(old) = &self.handlers[idx] {
            let old_cells: Vec<CellIndex> = old.cells().to_vec();
            let new_cells = new_handler.cells();
            if old_cells.as_slice() != new_cells {
                // Update the appropriate map based on handler kind.
                let map = self.map_for_kind(self.kind[idx]);
                for &c in &old_cells {
                    map[c as usize].retain(|&i| i != idx);
                }
                Self::append_to_map(map, new_cells, idx);
            }
        }
        self.handlers[idx] = Some(new_handler);
        // Update cached id_str to match the new handler.
        if let Some(h) = &self.handlers[idx] {
            self.id_str_cache[idx] = h.id_str();
        }
    }

    /// Delete a handler at the given index (remove from maps, set to None).
    /// Mirrors JS `handlerSet.delete()`.
    pub fn delete(&mut self, idx: usize) {
        if let Some(old) = &self.handlers[idx] {
            let old_cells: Vec<CellIndex> = old.cells().to_vec();
            let map = self.map_for_kind(self.kind[idx]);
            for &c in &old_cells {
                map[c as usize].retain(|&i| i != idx);
            }
        }
        self.handlers[idx] = None;
    }

    // ========================================================================
    // Initialization (mirrors JS _setUpHandlers handler init loop)
    // ========================================================================

    /// Initialize all handlers and build the grid state.
    ///
    /// Mirrors the JS handler initialization loop in `_setUpHandlers`.
    /// Returns `(initial_grid, grid_state_size, initial_contradiction, init_failures)`.
    pub fn initialize_handlers(
        &mut self,
        initial_cells: &[CandidateSet],
        cell_exclusions: &CellExclusions,
        state_allocator: &mut GridStateAllocator,
    ) -> (
        Vec<CandidateSet>,
        usize,
        bool,
        Vec<(String, Vec<CellIndex>)>,
    ) {
        let mut initial_grid = initial_cells.to_vec();
        let mut initial_contradiction = false;
        let mut init_failures: Vec<(String, Vec<CellIndex>)> = Vec::new();

        for i in 0..self.handlers.len() {
            let (old_cells, new_cells_changed) = {
                if let Some(ref mut handler) = self.handlers[i] {
                    let old_cells: Vec<CellIndex> = handler.cells().to_vec();

                    if !handler.initialize(
                        &mut initial_grid,
                        cell_exclusions,
                        self.shape,
                        state_allocator,
                    ) {
                        initial_contradiction = true;

                        // Mirror JS invalidateGrid: try handler.cells(),
                        // fall back to exclusion_cells(), then fill entire grid.
                        let mut cells = handler.cells();
                        if cells.is_empty() {
                            cells = handler.exclusion_cells();
                        }
                        init_failures.push((handler.name().to_string(), cells.to_vec()));
                        for &cell in cells {
                            initial_grid[cell as usize] = CandidateSet::EMPTY;
                        }
                        if cells.is_empty() {
                            initial_grid.fill(CandidateSet::EMPTY);
                        }
                    }

                    // Check if cells changed during init.
                    let new_cells = handler.cells();
                    if old_cells.as_slice() != new_cells {
                        let nc = new_cells.to_vec();
                        (old_cells, Some(nc))
                    } else {
                        (old_cells, None)
                    }
                } else {
                    continue;
                }
            };

            // Update cell map outside the handler borrow.
            if let Some(new_cells) = new_cells_changed {
                let map = self.map_for_kind(self.kind[i]);
                for &c in &old_cells {
                    map[c as usize].retain(|&idx| idx != i);
                }
                Self::append_to_map(map, &new_cells, i);
            }
        }

        // Build full grid state (cells + extra handler state).
        let initial_grid = state_allocator.make_grid_state(&initial_grid);
        let grid_state_size = initial_grid.len();

        // Post-initialize all handlers with the full grid state.
        for handler in self.handlers.iter_mut().flatten() {
            handler.post_initialize(&initial_grid);
        }

        (
            initial_grid,
            grid_state_size,
            initial_contradiction,
            init_failures,
        )
    }

    /// Build cell priorities from all live handlers.
    ///
    /// Mirrors JS `_initCellPriorities`.
    pub fn build_cell_priorities(&self) -> Vec<i32> {
        let num_cells = self.shape.num_cells;
        let mut priorities = vec![0i32; num_cells];

        for handler in self.handlers.iter().flatten() {
            let priority = handler.priority();
            for &cell in handler.cells() {
                priorities[cell as usize] += priority;
            }
        }

        // Priority handlers override (not add to) cell priorities.
        for handler in self.handlers.iter().flatten() {
            if let Some(ph) = handler.as_any().downcast_ref::<crate::handlers::Priority>() {
                for &cell in ph.priority_cells() {
                    priorities[cell as usize] = ph.priority_value();
                }
            }
        }

        priorities
    }

    /// Collect candidate finder descriptions from all live handlers.
    ///
    /// Mirrors JS `CandidateFinderSet.initialize()`.
    pub fn collect_candidate_finders(
        &self,
    ) -> Vec<crate::solver::candidate_selector::CandidateFinderDescription> {
        let mut finders = Vec::new();
        for handler in self.handlers.iter().flatten() {
            finders.extend(handler.candidate_finders(self.shape));
        }
        finders
    }

    // ========================================================================
    // Consumption — produce data for HandlerAccumulator
    // ========================================================================

    /// Consume the HandlerSet and return the data needed by HandlerAccumulator.
    ///
    /// Returns `(handlers, singleton_map, ordinary_map, aux_map, essential_flags)`.
    /// All maps use `u16` indices for the accumulator's compact representation.
    pub fn into_accumulator_parts(
        self,
    ) -> (
        Vec<Box<dyn ConstraintHandler>>,
        Vec<Vec<u16>>,
        Vec<Vec<u16>>,
        Vec<Vec<u16>>,
        Vec<bool>,
    ) {
        // Build a compaction map: old index → new index (skipping None entries).
        let mut index_map: Vec<Option<u16>> = vec![None; self.handlers.len()];
        let mut handlers: Vec<Box<dyn ConstraintHandler>> = Vec::new();
        let mut essential: Vec<bool> = Vec::new();
        let mut kind: Vec<HandlerKind> = Vec::new();

        for (old_idx, h) in self.handlers.into_iter().enumerate() {
            if let Some(handler) = h {
                let new_idx = handlers.len() as u16;
                index_map[old_idx] = Some(new_idx);
                handlers.push(handler);
                essential.push(self.essential[old_idx]);
                kind.push(self.kind[old_idx]);
            }
        }

        let remap = |map: Vec<Vec<usize>>| -> Vec<Vec<u16>> {
            map.into_iter()
                .map(|indices| indices.into_iter().filter_map(|i| index_map[i]).collect())
                .collect()
        };

        let singleton_map = remap(self.singleton_map);
        let ordinary_map = remap(self.ordinary_map);
        let aux_map = remap(self.aux_map);

        (handlers, singleton_map, ordinary_map, aux_map, essential)
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    /// Internal: add a handler with a given kind (non-essential).
    fn add_with_kind(
        &mut self,
        handler: Box<dyn ConstraintHandler>,
        hk: HandlerKind,
    ) -> Option<usize> {
        let id = handler.id_str();
        if let Some(&existing_idx) = self.seen.get(&id) {
            if handler.is_essential() {
                self.essential[existing_idx] = true;
            }
            return None;
        }

        let idx = self.handlers.len();
        self.seen.insert(id.clone(), idx);
        let map = self.map_for_kind(hk);
        Self::append_to_map(map, handler.cells(), idx);
        self.essential.push(false);
        self.kind.push(hk);
        self.handlers.push(Some(handler));
        self.id_str_cache.push(id);
        Some(idx)
    }

    /// Get the mutable cell map for the given handler kind.
    fn map_for_kind(&mut self, hk: HandlerKind) -> &mut Vec<Vec<usize>> {
        match hk {
            HandlerKind::Ordinary => &mut self.ordinary_map,
            HandlerKind::Aux => &mut self.aux_map,
        }
    }

    /// Append a handler index to each cell's list in the given map.
    fn append_to_map(map: &mut [Vec<usize>], cells: &[CellIndex], index: usize) {
        for &c in cells {
            let list = &mut map[c as usize];
            if list.last() != Some(&index) {
                list.push(index);
            }
        }
    }
}
