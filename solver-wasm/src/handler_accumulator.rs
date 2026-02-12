use crate::cell_exclusions::CellExclusions;
use crate::handler::ConstraintHandler;
use crate::util::NUM_CELLS;

/// Index-based intrusive linked-list propagation queue.
///
/// Mirrors JS `HandlerAccumulator` from engine.js. Manages a queue of
/// constraint handlers to process during propagation. Singleton handlers
/// (UniqueValueExclusion) are pushed to the front for priority processing.
///
/// The linked list uses handler indices into the `all_handlers` array.
/// Each entry in `linked_list` points to the next entry, with:
/// - `-1` = null pointer (end of list)
/// - `-2` = not in list
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

    /// Intrusive linked list: `linked_list[i]` = next index, -1 = tail, -2 = not in list.
    linked_list: Vec<i16>,

    /// Head of the queue (-1 = empty).
    head: i16,

    /// Tail of the queue.
    tail: i16,

    /// Index of the handler currently being processed (avoid re-adding).
    active_handler_index: i16,

    /// Cell exclusions data for use during enforcement.
    cell_exclusions: CellExclusions,

    /// When true, log every queue mutation (add_for_fixed_cell, add_for_cell,
    /// enqueue_one, push_front, take_next) to stderr. Controlled by the
    /// solver's `enforce_constraints_on_traced` function.
    #[cfg(feature = "trace")]
    pub trace_queue: bool,
}

impl HandlerAccumulator {
    /// Create a new accumulator from the handler data.
    ///
    /// `all_handlers`: the full handler array.
    /// `singleton_map`: for each cell, the list of singleton handler indices.
    /// `ordinary_map`: for each cell, the list of ordinary handler indices.
    /// `essential_flags`: for each handler index, whether it's essential.
    pub fn new(
        all_handlers: Vec<Box<dyn ConstraintHandler>>,
        singleton_map: Vec<Vec<u16>>,
        ordinary_map: Vec<Vec<u16>>,
        aux_map: Vec<Vec<u16>>,
        essential_flags: Vec<bool>,
        cell_exclusions: CellExclusions,
    ) -> Self {
        let n = all_handlers.len();

        // Build singleton handler map: for cells with multiple singletons,
        // we could combine them, but for now just use the first.
        let mut singleton_handlers = vec![u16::MAX; NUM_CELLS];
        for (cell, indices) in singleton_map.iter().enumerate() {
            if !indices.is_empty() {
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

        let linked_list = vec![-2i16; n];

        HandlerAccumulator {
            all_handlers,
            singleton_handlers,
            ordinary_handlers: [ordinary_map, essential_ordinary],
            aux_handlers: [aux_map, essential_aux],
            skip_non_essential: 0,
            linked_list,
            head: -1,
            tail: -1,
            active_handler_index: -1,
            cell_exclusions,
            #[cfg(feature = "trace")]
            trace_queue: false,
        }
    }

    /// Create a minimal stub for unit testing handlers in isolation.
    ///
    /// This accumulator has no handlers and just tracks cells that were
    /// signaled. Do not use in the solver.
    pub fn new_stub() -> Self {
        HandlerAccumulator {
            all_handlers: Vec::new(),
            singleton_handlers: vec![u16::MAX; NUM_CELLS],
            ordinary_handlers: [vec![Vec::new(); NUM_CELLS], vec![Vec::new(); NUM_CELLS]],
            aux_handlers: [vec![Vec::new(); NUM_CELLS], vec![Vec::new(); NUM_CELLS]],
            skip_non_essential: 0,
            linked_list: Vec::new(),
            head: -1,
            tail: -1,
            active_handler_index: -1,
            cell_exclusions: CellExclusions::new(),
            #[cfg(feature = "trace")]
            trace_queue: false,
        }
    }

    /// Reset the accumulator for a new propagation cycle.
    ///
    /// `skip_non_essential`: if true, only essential handlers will be queued.
    /// This is used when all remaining cells are singletons.
    pub fn reset(&mut self, skip_non_essential: bool) {
        self.skip_non_essential = if skip_non_essential { 1 } else { 0 };
        self.clear();
        self.active_handler_index = -1;
        #[cfg(feature = "trace")]
        if self.trace_queue {
            eprintln!("reset(skipNonEssential={})", skip_non_essential);
        }
    }

    /// Get a mutable reference to cell exclusions.
    pub fn cell_exclusions(&mut self) -> &mut CellExclusions {
        &mut self.cell_exclusions
    }

    /// Add handlers for a fixed cell (cell with a known/single value).
    ///
    /// Pushes the singleton handler (UniqueValueExclusion) to the front,
    /// then enqueues ordinary handlers to the back.
    pub fn add_for_fixed_cell(&mut self, cell: u8) {
        #[cfg(feature = "trace")]
        if self.trace_queue {
            eprintln!("addForFixedCell({})", cell);
        }
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
    pub fn add_for_cell(&mut self, cell: u8) {
        #[cfg(feature = "trace")]
        if self.trace_queue {
            let active = self.active_handler_index;
            let active_name = if active >= 0 {
                let h = &self.all_handlers[active as usize];
                let mut cells = h.cells().to_vec();
                cells.sort();
                format!(
                    "{}[{}]",
                    h.handler_type_name(),
                    cells
                        .iter()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                )
            } else {
                "none".to_string()
            };
            eprintln!("addForCell({}) active={} {}", cell, active, active_name);
        }
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
        self.head == -1
    }

    /// Take the next handler from the queue.
    ///
    /// Returns the handler index. The caller should use `get_handler()`
    /// to get the actual handler reference.
    pub fn take_next(&mut self) -> usize {
        debug_assert!(self.head >= 0);
        let old_head = self.head;
        self.head = self.linked_list[old_head as usize];
        self.linked_list[old_head as usize] = -2;
        self.active_handler_index = old_head;
        #[cfg(feature = "trace")]
        if self.trace_queue {
            let h = &self.all_handlers[old_head as usize];
            let mut cells = h.cells().to_vec();
            cells.sort();
            eprintln!(
                "takeNext -> idx={} {}[{}]",
                old_head,
                h.handler_type_name(),
                cells
                    .iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
        }
        old_head as usize
    }

    /// Get a reference to a handler by index.
    #[inline(always)]
    pub fn get_handler(&self, index: usize) -> &dyn ConstraintHandler {
        self.all_handlers[index].as_ref()
    }

    /// Enforce consistency for the handler at `index`, passing `self` as
    /// the accumulator. This safely splits the borrow: the handler is
    /// temporarily taken out of the vec, enforce_consistency runs with
    /// `&mut self`, and then the handler is put back.
    ///
    /// This avoids the borrow conflict between `get_handler()` (immutable)
    /// and `enforce_consistency(..., &mut self)` (mutable).
    pub fn enforce_at(&mut self, index: usize, grid: &mut [u16]) -> bool {
        // Temporarily take the handler out to avoid aliased borrows.
        // We use a swap with a placeholder.
        let handler = std::mem::replace(
            &mut self.all_handlers[index],
            Box::new(crate::handler::Placeholder),
        );
        let result = handler.enforce_consistency(grid, self);
        self.all_handlers[index] = handler;
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

    /// Dump handler maps for debugging.
    pub fn dump_maps(&self) {
        println!();
        println!("--- Ordinary Handler Map (cell -> handler indices) ---");
        for (cell, indices) in self.ordinary_handlers[0].iter().enumerate() {
            if !indices.is_empty() {
                println!(
                    "  cell {}: [{}]",
                    cell,
                    indices
                        .iter()
                        .map(|i| i.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );
            }
        }
        println!();
        println!("--- Aux Handler Map (cell -> handler indices) ---");
        for (cell, indices) in self.aux_handlers[0].iter().enumerate() {
            if !indices.is_empty() {
                println!(
                    "  cell {}: [{}]",
                    cell,
                    indices
                        .iter()
                        .map(|i| i.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );
            }
        }
        println!();
        println!("--- Singleton Handler Map (cell -> handler index) ---");
        for (cell, &idx) in self.singleton_handlers.iter().enumerate() {
            if idx != u16::MAX {
                println!("  cell {}: {}", cell, idx);
            }
        }

        // Normalized maps: resolve handler indices to (type, sorted_cells) signatures
        println!();
        println!("=== Rust Ordinary Map (normalized) ===");
        for (cell, indices) in self.ordinary_handlers[0].iter().enumerate() {
            let sigs: Vec<String> = indices
                .iter()
                .map(|&idx| {
                    let h = &self.all_handlers[idx as usize];
                    let mut cells = h.cells().to_vec();
                    cells.sort();
                    let type_name = h.handler_type_name();
                    format!(
                        "{}({})",
                        type_name,
                        cells
                            .iter()
                            .map(|c| c.to_string())
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                })
                .collect();
            println!("  cell {}: {}", cell, sigs.join(" | "));
        }
        println!();
        println!("=== Rust Aux Map (normalized) ===");
        for (cell, indices) in self.aux_handlers[0].iter().enumerate() {
            if !indices.is_empty() {
                let sigs: Vec<String> = indices
                    .iter()
                    .map(|&idx| {
                        let h = &self.all_handlers[idx as usize];
                        let mut cells = h.cells().to_vec();
                        cells.sort();
                        let type_name = h.handler_type_name();
                        format!(
                            "{}({})",
                            type_name,
                            cells
                                .iter()
                                .map(|c| c.to_string())
                                .collect::<Vec<_>>()
                                .join(",")
                        )
                    })
                    .collect();
                println!("  cell {}: {}", cell, sigs.join(" | "));
            }
        }
    }

    /// Dump handler maps for specific cells (for debugging).
    pub fn dump_cell_maps(&self, cells: &[u8]) {
        for &cell in cells {
            let c = cell as usize;
            eprintln!("\n=== Rust Cell {} ===", cell);
            let sh = self.singleton_handlers[c];
            if sh != u16::MAX {
                let h = &self.all_handlers[sh as usize];
                eprintln!(
                    "  singleton: idx={} type={} cells={:?}",
                    sh,
                    h.handler_type_name(),
                    h.cells()
                );
            }
            let aux = &self.aux_handlers[0][c];
            if !aux.is_empty() {
                eprintln!("  aux ({}):", aux.len());
                for &idx in aux {
                    let h = &self.all_handlers[idx as usize];
                    eprintln!(
                        "    idx={} type={} cells={:?}",
                        idx,
                        h.handler_type_name(),
                        &h.cells()[..h.cells().len().min(8)]
                    );
                }
            }
            let ord = &self.ordinary_handlers[0][c];
            if !ord.is_empty() {
                eprintln!("  ordinary ({}):", ord.len());
                for &idx in ord {
                    let h = &self.all_handlers[idx as usize];
                    eprintln!(
                        "    idx={} type={} cells={:?}",
                        idx,
                        h.handler_type_name(),
                        &h.cells()[..h.cells().len().min(8)]
                    );
                }
            }
        }
    }

    // ========================================================================
    // Private methods
    // ========================================================================

    /// Clear the queue, resetting all linked list entries.
    fn clear(&mut self) {
        let mut head = self.head;
        while head >= 0 {
            let next = self.linked_list[head as usize];
            self.linked_list[head as usize] = -2;
            head = next;
        }
        self.head = -1;
    }

    /// Enqueue a single handler index to the back of the queue.
    ///
    /// Skips `ignore` index and any index already in the list.
    #[inline(always)]
    fn enqueue_one(&mut self, i: i16, ignore: i16) {
        if i == ignore {
            #[cfg(feature = "trace")]
            if self.trace_queue {
                let h = &self.all_handlers[i as usize];
                let mut cells = h.cells().to_vec();
                cells.sort();
                eprintln!(
                    "  enq idx={} skip:active {}[{}]",
                    i,
                    h.handler_type_name(),
                    cells
                        .iter()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );
            }
            return;
        }
        if self.linked_list[i as usize] != -2 {
            #[cfg(feature = "trace")]
            if self.trace_queue {
                let h = &self.all_handlers[i as usize];
                let mut cells = h.cells().to_vec();
                cells.sort();
                eprintln!(
                    "  enq idx={} skip:inqueue {}[{}]",
                    i,
                    h.handler_type_name(),
                    cells
                        .iter()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );
            }
            return;
        }
        #[cfg(feature = "trace")]
        if self.trace_queue {
            let h = &self.all_handlers[i as usize];
            let mut cells = h.cells().to_vec();
            cells.sort();
            eprintln!(
                "  enq idx={} ENQUEUED {}[{}]",
                i,
                h.handler_type_name(),
                cells
                    .iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
        }
        if self.head == -1 {
            self.head = i;
        } else {
            self.linked_list[self.tail as usize] = i;
        }
        self.tail = i;
        self.linked_list[i as usize] = -1;
    }

    /// Push an index to the front of the queue.
    fn push_front(&mut self, index: i16) {
        if self.linked_list[index as usize] < -1 {
            // Not in list — add to front.
            #[cfg(feature = "trace")]
            if self.trace_queue {
                let h = &self.all_handlers[index as usize];
                let mut cells = h.cells().to_vec();
                cells.sort();
                eprintln!(
                    "  push idx={} PUSHED-FRONT {}[{}]",
                    index,
                    h.handler_type_name(),
                    cells
                        .iter()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );
            }
            if self.head == -1 {
                self.tail = index;
            }
            self.linked_list[index as usize] = self.head;
            self.head = index;
        } else {
            #[cfg(feature = "trace")]
            if self.trace_queue {
                let h = &self.all_handlers[index as usize];
                let mut cells = h.cells().to_vec();
                cells.sort();
                eprintln!(
                    "  push idx={} skip:inqueue {}[{}]",
                    index,
                    h.handler_type_name(),
                    cells
                        .iter()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );
            }
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
