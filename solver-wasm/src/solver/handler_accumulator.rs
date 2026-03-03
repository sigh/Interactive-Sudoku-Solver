use super::cell_exclusions::CellExclusions;
use crate::candidate_set::CandidateSet;
use crate::handlers::ConstraintHandler;
use crate::api::types::CellIndex;

/// Linked-list link type. Non-negative values are handler indices.
type LinkIndex = i16;
/// Null link: end of list / empty queue.
const NULL_LINK: LinkIndex = -1;
/// Marker: handler is not currently in the propagation queue.
const NOT_IN_LIST: LinkIndex = -2;

/// Classification of a handler for propagation queue routing.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HandlerKind {
    /// Normal handler — triggered on any cell change.
    Ordinary,
    /// Aux handler — only triggered when a cell is fixed (not on candidate removal).
    /// Mirrors JS `handlerSet.addAux()`. Used for house intersection handlers.
    Aux,
}

/// Index-based intrusive linked-list propagation queue.
///
/// Mirrors JS `HandlerAccumulator` from engine.js. Manages a queue of
/// constraint handlers to process during propagation. Singleton handlers
/// (UniqueValueExclusion) are pushed to the front for priority processing.
///
/// The linked list uses handler indices into the `all_handlers` array.
/// Each entry in `linked_list` points to the next entry, with:
/// - `NULL_LINK` (-1) = end of list
/// - `NOT_IN_LIST` (-2) = not in list
pub struct HandlerAccumulator {
    /// All handlers, indexed by their position in the array.
    all_handlers: Vec<Box<dyn ConstraintHandler>>,

    /// For each cell, the index of its singleton handler.
    singleton_handlers: Vec<u16>,

    /// For each cell, the list of ordinary handler indices.
    /// Two versions: [0] = all, [1] = essential-only.
    ordinary_handlers: [Vec<Vec<u16>>; 2],

    /// For each cell, the list of aux handler indices (e.g. house intersection).
    /// Aux handlers are only triggered for fixed cells, not candidate removal.
    /// Two versions: [0] = all, [1] = essential-only.
    aux_handlers: [Vec<Vec<u16>>; 2],

    /// Which ordinary_handlers version to use (0 = all, 1 = essential-only).
    skip_non_essential: usize,

    /// Intrusive linked list: `linked_list[i]` = next index.
    /// `NULL_LINK` = tail, `NOT_IN_LIST` = not in queue.
    linked_list: Vec<LinkIndex>,

    /// Head of the queue (`NULL_LINK` = empty).
    head: LinkIndex,

    /// Tail of the queue.
    tail: LinkIndex,

    /// Index of the handler currently being processed (avoid re-adding).
    active_handler_index: LinkIndex,

    /// Cell exclusions data for use during enforcement.
    cell_exclusions: CellExclusions,

    /// Reusable placeholder to avoid per-call allocation in `enforce_at`.
    placeholder: Option<Box<dyn ConstraintHandler>>,
}

impl HandlerAccumulator {
    /// Create a new accumulator from the handler data.
    ///
    /// `all_handlers`: the full handler array.
    /// `singleton_map`: for each cell, the list of singleton handler indices.
    /// `ordinary_map`: for each cell, the list of ordinary handler indices.
    /// `essential_flags`: for each handler index, whether it's essential.
    pub fn new(
        mut all_handlers: Vec<Box<dyn ConstraintHandler>>,
        singleton_map: Vec<Vec<u16>>,
        ordinary_map: Vec<Vec<u16>>,
        aux_map: Vec<Vec<u16>>,
        essential_flags: Vec<bool>,
        cell_exclusions: CellExclusions,
    ) -> Self {
        let n = all_handlers.len();

        // Build singleton handler map. When a cell has multiple singletons,
        // wrap them in an And handler (mirrors JS HandlerAccumulator constructor).
        let mut singleton_handlers = vec![u16::MAX; singleton_map.len()];
        for (cell, indices) in singleton_map.iter().enumerate() {
            if indices.is_empty() {
                continue;
            }
            if indices.len() == 1 {
                singleton_handlers[cell] = indices[0];
            } else {
                // Multiple singletons: combine into And, replace first slot.
                let sub: Vec<Box<dyn ConstraintHandler>> = indices
                    .iter()
                    .map(|&idx| {
                        std::mem::replace(
                            &mut all_handlers[idx as usize],
                            Box::new(crate::handlers::True),
                        )
                    })
                    .collect();
                all_handlers[indices[0] as usize] = Box::new(crate::handlers::And::new(sub));
                singleton_handlers[cell] = indices[0];
            }
        }

        // Build essential-only ordinary handler map.
        let essential_ordinary: Vec<Vec<u16>> = ordinary_map
            .iter()
            .map(|list| {
                list.iter()
                    .copied()
                    .filter(|&idx| essential_flags[idx as usize])
                    .collect()
            })
            .collect();

        // Build essential-only aux handler map.
        let essential_aux: Vec<Vec<u16>> = aux_map
            .iter()
            .map(|list| {
                list.iter()
                    .copied()
                    .filter(|&idx| essential_flags[idx as usize])
                    .collect()
            })
            .collect();

        let linked_list = vec![NOT_IN_LIST; n];

        HandlerAccumulator {
            all_handlers,
            singleton_handlers,
            ordinary_handlers: [ordinary_map, essential_ordinary],
            aux_handlers: [aux_map, essential_aux],
            skip_non_essential: 0,
            linked_list,
            head: NULL_LINK,
            tail: NULL_LINK,
            active_handler_index: NULL_LINK,
            cell_exclusions,
            placeholder: Some(Box::new(crate::handlers::Placeholder)),
        }
    }

    /// Create a minimal stub for unit testing handlers in isolation.
    ///
    /// This accumulator has no handlers and just tracks cells that were
    /// signaled. Do not use in the solver.
    #[cfg(test)]
    pub fn new_stub() -> Self {
        Self::new_stub_with_num_cells(81)
    }

    /// Create a stub accumulator for a given grid size.
    #[cfg(test)]
    pub fn new_stub_with_num_cells(num_cells: usize) -> Self {
        Self::new_no_propagate(num_cells)
    }

    /// Create a no-propagation accumulator for the given grid size.
    ///
    /// `add_for_cell` calls are silently ignored (no handlers are registered).
    /// Used by the `Or` handler for scratch-grid evaluation of sub-handlers.
    ///
    /// Mirrors JS `DummyHandlerAccumulator`.
    pub fn new_no_propagate(num_cells: usize) -> Self {
        HandlerAccumulator {
            all_handlers: Vec::new(),
            singleton_handlers: vec![u16::MAX; num_cells],
            ordinary_handlers: [vec![Vec::new(); num_cells], vec![Vec::new(); num_cells]],
            aux_handlers: [vec![Vec::new(); num_cells], vec![Vec::new(); num_cells]],
            skip_non_essential: 0,
            linked_list: Vec::new(),
            head: NULL_LINK,
            tail: NULL_LINK,
            active_handler_index: NULL_LINK,
            cell_exclusions: CellExclusions::with_num_cells(num_cells),
            placeholder: Some(Box::new(crate::handlers::Placeholder)),
        }
    }

    /// Reset the accumulator for a new propagation cycle.
    ///
    /// `skip_non_essential`: if true, only essential handlers will be queued.
    /// This is used when all remaining cells are singletons.
    pub fn reset(&mut self, skip_non_essential: bool) {
        self.skip_non_essential = if skip_non_essential { 1 } else { 0 };
        self.clear();
        self.active_handler_index = NULL_LINK;
    }

    /// Get a mutable reference to cell exclusions.
    #[inline]
    pub fn cell_exclusions(&mut self) -> &mut CellExclusions {
        &mut self.cell_exclusions
    }

    /// Get a shared reference to cell exclusions.
    ///
    /// Uses interior mutability for cached lookups (`get_array`,
    /// `get_pair_exclusions`), so `&self` suffices for all read operations.
    #[inline]
    pub fn cell_exclusions_ref(&self) -> &CellExclusions {
        &self.cell_exclusions
    }

    /// Add handlers for a fixed cell (cell with a known/single value).
    ///
    /// Pushes the singleton handler (UniqueValueExclusion) to the front,
    /// then enqueues ordinary handlers to the back.
    pub fn add_for_fixed_cell(&mut self, cell: CellIndex) {
        // Push singleton to front.
        let singleton_idx = self.singleton_handlers[cell as usize];
        if singleton_idx != u16::MAX {
            self.push_front(singleton_idx as i16);
        }
        // Enqueue aux handlers (house intersections etc.).
        // JS order: singleton (front) → aux (back) → ordinary (back).
        let skip = self.skip_non_essential;
        let aux_len = self.aux_handlers[skip][cell as usize].len();
        for i in 0..aux_len {
            let idx = self.aux_handlers[skip][cell as usize][i] as i16;
            self.enqueue_one(idx, -1);
        }
        // Enqueue ordinary handlers.
        let len = self.ordinary_handlers[skip][cell as usize].len();
        for i in 0..len {
            let idx = self.ordinary_handlers[skip][cell as usize][i] as i16;
            self.enqueue_one(idx, -1);
        }
    }

    /// Add handlers for an ordinary cell update.
    ///
    /// Enqueues ordinary handlers, skipping the currently active handler.
    pub fn add_for_cell(&mut self, cell: CellIndex) {
        let skip = self.skip_non_essential;
        let active = self.active_handler_index;
        let len = self.ordinary_handlers[skip][cell as usize].len();
        for i in 0..len {
            let idx = self.ordinary_handlers[skip][cell as usize][i] as i16;
            self.enqueue_one(idx, active);
        }
    }

    /// Check if the queue is empty.
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.head == NULL_LINK
    }

    /// Take the next handler from the queue.
    ///
    /// Returns the handler index.
    #[inline]
    pub fn take_next(&mut self) -> usize {
        debug_assert!(self.head >= 0);
        let old_head = self.head;
        self.head = self.linked_list[old_head as usize];
        self.linked_list[old_head as usize] = NOT_IN_LIST;
        self.active_handler_index = old_head;
        old_head as usize
    }

    /// Enforce consistency for the handler at `index`, passing `self` as
    /// the accumulator. This safely splits the borrow: the handler is
    /// temporarily taken out of the vec, enforce_consistency runs with
    /// `&mut self`, and then the handler is put back.
    ///
    /// This avoids the borrow conflict between `get_handler()` (immutable)
    /// and `enforce_consistency(..., &mut self)` (mutable).
    #[inline]
    pub fn enforce_at(&mut self, index: usize, grid: &mut [CandidateSet]) -> bool {
        // Temporarily swap the handler out using a reusable placeholder
        // to avoid aliased borrows without per-call allocation.
        let placeholder = self.placeholder.take().unwrap();
        let handler = std::mem::replace(&mut self.all_handlers[index], placeholder);
        let result = handler.enforce_consistency(grid, self);
        self.placeholder = Some(std::mem::replace(&mut self.all_handlers[index], handler));
        result
    }

    /// Get a mutable reference to the handler array (for initialization).
    pub fn handlers_mut(&mut self) -> &mut Vec<Box<dyn ConstraintHandler>> {
        &mut self.all_handlers
    }

    /// Get a reference to the handler array.
    pub fn handlers(&self) -> &[Box<dyn ConstraintHandler>] {
        &self.all_handlers
    }

    /// Number of handlers.
    pub fn handler_count(&self) -> usize {
        self.all_handlers.len()
    }

    // ========================================================================
    // Private methods
    // ========================================================================

    /// Clear the queue, resetting all linked list entries.
    fn clear(&mut self) {
        let mut head = self.head;
        while head != NULL_LINK {
            let next = self.linked_list[head as usize];
            self.linked_list[head as usize] = NOT_IN_LIST;
            head = next;
        }
        self.head = NULL_LINK;
    }

    /// Enqueue a single handler index to the back of the queue.
    ///
    /// Skips `ignore` index and any index already in the list.
    #[inline(always)]
    fn enqueue_one(&mut self, i: LinkIndex, ignore: LinkIndex) {
        if i == ignore {
            return;
        }
        if self.linked_list[i as usize] != NOT_IN_LIST {
            return;
        }
        if self.head == NULL_LINK {
            self.head = i;
        } else {
            self.linked_list[self.tail as usize] = i;
        }
        self.tail = i;
        self.linked_list[i as usize] = NULL_LINK;
    }

    /// Push an index to the front of the queue.
    fn push_front(&mut self, index: LinkIndex) {
        if self.linked_list[index as usize] == NOT_IN_LIST {
            // Not in list — add to front.
            if self.head == NULL_LINK {
                self.tail = index;
            }
            self.linked_list[index as usize] = self.head;
            self.head = index;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_accumulator() {
        let mut acc = HandlerAccumulator::new_stub();
        assert!(acc.is_empty());
        // add_for_cell should be a no-op on stub.
        acc.add_for_cell(5);
        assert!(acc.is_empty());
    }
}
