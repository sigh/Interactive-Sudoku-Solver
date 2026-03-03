//! Core NFA data structure and optimization passes.
//!
//! Mirrors JS `NFA` class from `nfa_builder.js`.

use std::collections::{HashSet, VecDeque};

use crate::api::types::Value;

/// Sentinel for removed states in remap arrays.
const REMOVE_STATE: i32 = -1;

/// Maximum number of states to prevent unbounded growth.
/// Must be at most (1 << 16) to work with the compressed format.
const MAX_STATE_COUNT: usize = 1 << 12;

/// Public access to the state limit constant for other modules.
pub const MAX_STATE_COUNT_PUB: usize = MAX_STATE_COUNT;

/// Core NFA (Non-deterministic Finite Automaton).
///
/// States are identified by `usize` indices. Symbols are 1-based values
/// stored as `u8`; internally they are indexed by `symbol - 1`.
///
/// Transitions: `transitions[state_id][symbol_index] = Vec<target_state_id>`.
/// Epsilon transitions: `epsilon[state_id] = Vec<target_state_id>`.
pub struct Nfa {
    start_ids: HashSet<usize>,
    accept_ids: HashSet<usize>,
    /// `transitions[state][symbol_index] = targets`
    transitions: Vec<Vec<Vec<usize>>>,
    /// `epsilon[state] = targets`
    epsilon: Vec<Vec<usize>>,
    sealed: bool,
    state_limit: Option<usize>,
}

impl Nfa {
    pub fn new() -> Self {
        Self {
            start_ids: HashSet::new(),
            accept_ids: HashSet::new(),
            transitions: Vec::new(),
            epsilon: Vec::new(),
            sealed: false,
            state_limit: Some(MAX_STATE_COUNT),
        }
    }

    pub fn with_state_limit(limit: usize) -> Self {
        let mut nfa = Self::new();
        nfa.state_limit = Some(limit);
        nfa
    }

    pub fn without_state_limit() -> Self {
        let mut nfa = Self::new();
        nfa.state_limit = None;
        nfa
    }

    // ====================================================================
    // Construction (unsealed)
    // ====================================================================

    pub fn add_state(&mut self) -> usize {
        assert!(!self.sealed, "NFA has been sealed");
        if let Some(limit) = self.state_limit {
            assert!(
                self.transitions.len() < limit,
                "State limit of {} exceeded",
                limit
            );
        }
        let id = self.transitions.len();
        self.transitions.push(Vec::new());
        id
    }

    fn ensure_state_exists(&mut self, state_id: usize) {
        while self.transitions.len() <= state_id {
            self.add_state();
        }
    }

    pub fn add_start_id(&mut self, id: usize) {
        assert!(!self.sealed);
        self.ensure_state_exists(id);
        self.start_ids.insert(id);
    }

    pub fn add_accept_id(&mut self, id: usize) {
        assert!(!self.sealed);
        self.ensure_state_exists(id);
        self.accept_ids.insert(id);
    }

    /// Add transitions from `from` to `to` on each given symbol (1-based values).
    pub fn add_transition(&mut self, from: usize, to: usize, symbols: &[Value]) {
        assert!(!self.sealed);
        self.ensure_state_exists(from);
        self.ensure_state_exists(to);

        let state_trans = &mut self.transitions[from];
        for &sym in symbols {
            let idx = (sym - 1) as usize;
            // Extend sparse array if needed.
            if state_trans.len() <= idx {
                state_trans.resize_with(idx + 1, Vec::new);
            }
            if !state_trans[idx].contains(&to) {
                state_trans[idx].push(to);
            }
        }
    }

    pub fn add_epsilon(&mut self, from: usize, to: usize) {
        assert!(!self.sealed);
        self.ensure_state_exists(from);
        self.ensure_state_exists(to);

        if self.epsilon.len() <= from {
            self.epsilon.resize_with(from + 1, Vec::new);
        }
        self.epsilon[from].push(to);
    }

    pub fn seal(&mut self) {
        self.sealed = true;
    }

    // ====================================================================
    // Accessors (sealed)
    // ====================================================================

    pub fn num_states(&self) -> usize {
        self.transitions.len()
    }

    pub fn is_accepting(&self, state_id: usize) -> bool {
        self.accept_ids.contains(&state_id)
    }

    pub fn start_ids(&self) -> &HashSet<usize> {
        &self.start_ids
    }

    #[allow(dead_code)]
    pub fn accept_ids(&self) -> &HashSet<usize> {
        &self.accept_ids
    }

    /// Raw sparse-array transitions for a state.
    /// `result[symbol_index]` is the list of target states (may be empty).
    pub fn state_transitions(&self, state_id: usize) -> &[Vec<usize>] {
        &self.transitions[state_id]
    }

    /// Number of distinct symbols used (max symbol_index + 1).
    pub fn num_symbols(&self) -> usize {
        self.transitions.iter().map(|t| t.len()).max().unwrap_or(0)
    }

    // ====================================================================
    // Epsilon closure
    // ====================================================================

    /// Close over epsilon transitions: copy transitions from all
    /// epsilon-reachable states, mark accepting where appropriate,
    /// then remove all epsilon edges.
    pub fn close_over_epsilon_transitions(&mut self) {
        assert!(self.sealed);
        if self.epsilon.is_empty() {
            return;
        }

        let num_states = self.transitions.len();
        for i in 0..num_states {
            let eps = if i < self.epsilon.len() {
                &self.epsilon[i]
            } else {
                continue;
            };
            if eps.is_empty() {
                continue;
            }

            // DFS to find all epsilon-reachable states.
            let mut visited = HashSet::new();
            let mut stack: Vec<usize> = eps.clone();
            while let Some(s) = stack.pop() {
                if !visited.insert(s) {
                    continue;
                }
                if s < self.epsilon.len() {
                    for &t in &self.epsilon[s] {
                        stack.push(t);
                    }
                }
            }
            visited.remove(&i); // Remove self.

            let visited: Vec<usize> = visited.into_iter().collect();

            // Copy transitions and accepting status.
            // We need to collect first to avoid borrow issues.
            let mut new_transitions: Vec<(usize, Vec<usize>)> = Vec::new();
            let mut make_accepting = false;

            for &target_id in &visited {
                let target_trans = &self.transitions[target_id];
                for (sym_idx, targets) in target_trans.iter().enumerate() {
                    if !targets.is_empty() {
                        new_transitions.push((sym_idx, targets.clone()));
                    }
                }
                if self.accept_ids.contains(&target_id) {
                    make_accepting = true;
                }
            }

            // Apply collected transitions.
            let state_trans = &mut self.transitions[i];
            for (sym_idx, targets) in new_transitions {
                if state_trans.len() <= sym_idx {
                    state_trans.resize_with(sym_idx + 1, Vec::new);
                }
                state_trans[sym_idx].extend(targets);
            }

            if make_accepting {
                self.accept_ids.insert(i);
            }

            // Deduplicate targets.
            let state_trans = &mut self.transitions[i];
            for targets in state_trans.iter_mut() {
                if targets.len() > 1 {
                    targets.sort_unstable();
                    targets.dedup();
                }
            }
        }

        self.epsilon.clear();
    }

    // ====================================================================
    // State remapping
    // ====================================================================

    /// Remap states according to `remap[old] = new_index` (or REMOVE_STATE).
    /// When multiple old states map to the same new index, first one wins.
    pub fn remap_states(&mut self, remap: &[i32]) {
        assert!(self.sealed);
        assert!(self.epsilon.is_empty());

        let mut new_transitions: Vec<Option<Vec<Vec<usize>>>> = Vec::new();

        for (old_idx, &new_idx) in remap.iter().enumerate() {
            if new_idx == REMOVE_STATE {
                continue;
            }
            let new_idx = new_idx as usize;
            // Extend if needed.
            if new_transitions.len() <= new_idx {
                new_transitions.resize_with(new_idx + 1, || None);
            }
            // Skip if already processed (first old index wins on merge).
            if new_transitions[new_idx].is_some() {
                continue;
            }

            let state_trans = &mut self.transitions[old_idx];
            for targets in state_trans.iter_mut() {
                if targets.is_empty() {
                    continue;
                }
                // Remap targets in-place, filtering removals and deduplicating.
                let mut write = 0;
                for i in 0..targets.len() {
                    let mapped = remap[targets[i]];
                    if mapped == REMOVE_STATE {
                        continue;
                    }
                    let mapped = mapped as usize;
                    // Check for duplicate.
                    let mut dup = false;
                    for j in 0..write {
                        if targets[j] == mapped {
                            dup = true;
                            break;
                        }
                    }
                    if !dup {
                        targets[write] = mapped;
                        write += 1;
                    }
                }
                targets.truncate(write);
            }

            new_transitions[new_idx] = Some(std::mem::take(state_trans));
        }

        // Flatten: replace None with empty.
        self.transitions = new_transitions
            .into_iter()
            .map(|opt| opt.unwrap_or_default())
            .collect();

        // Remap start and accept IDs.
        let new_starts: HashSet<usize> = self
            .start_ids
            .iter()
            .filter_map(|&id| {
                let m = remap[id];
                if m != REMOVE_STATE {
                    Some(m as usize)
                } else {
                    None
                }
            })
            .collect();
        self.start_ids = new_starts;

        let new_accepts: HashSet<usize> = self
            .accept_ids
            .iter()
            .filter_map(|&id| {
                let m = remap[id];
                if m != REMOVE_STATE {
                    Some(m as usize)
                } else {
                    None
                }
            })
            .collect();
        self.accept_ids = new_accepts;
    }

    // ====================================================================
    // Dead state removal
    // ====================================================================

    /// BFS from start states, returns `depths[i]` = min depth from start
    /// (usize::MAX if unreachable).
    fn compute_depths_from_start(&self) -> Vec<usize> {
        let num_states = self.transitions.len();
        let mut depths = vec![usize::MAX; num_states];
        let mut queue: VecDeque<usize> = VecDeque::new();

        for &id in &self.start_ids {
            depths[id] = 0;
            queue.push_back(id);
        }

        while let Some(state_id) = queue.pop_front() {
            let next_depth = depths[state_id] + 1;
            for targets in &self.transitions[state_id] {
                for &target in targets {
                    if depths[target] == usize::MAX {
                        depths[target] = next_depth;
                        queue.push_back(target);
                    }
                }
            }
        }

        depths
    }

    /// Create a reversed NFA (all transitions reversed, start ↔ accept swapped).
    fn create_reversed(&self) -> Nfa {
        let num_states = self.transitions.len();
        let mut reversed = Nfa::without_state_limit();

        for _ in 0..num_states {
            reversed.add_state();
        }

        for (state_id, trans) in self.transitions.iter().enumerate() {
            for (sym_idx, targets) in trans.iter().enumerate() {
                let sym = (sym_idx + 1) as u8;
                for &target in targets {
                    reversed.add_transition(target, state_id, &[sym]);
                }
            }
        }

        for &accept_id in &self.accept_ids {
            reversed.add_start_id(accept_id);
        }
        for &start_id in &self.start_ids {
            reversed.add_accept_id(start_id);
        }

        reversed.seal();
        reversed
    }

    /// Remove states that cannot be part of a valid path within `max_depth`.
    /// A state is dead if `depth_from_start + dist_to_accept > max_depth`.
    pub fn remove_dead_states(&mut self, max_depth: usize, all_states_reachable: bool) {
        assert!(self.sealed);
        assert!(self.epsilon.is_empty());

        let num_states = self.num_states();
        if num_states == 0 {
            return;
        }

        let max_valid_path = 2 * num_states.saturating_sub(1);
        let effective_max_depth = max_depth.min(max_valid_path);

        // Backward distances: reversed NFA BFS gives dist to accept.
        let dist_to_accept = self.create_reversed().compute_depths_from_start();

        // Forward depths (only if needed).
        let depths = if !all_states_reachable || effective_max_depth < max_valid_path {
            Some(self.compute_depths_from_start())
        } else {
            None
        };

        // Find dead states.
        let mut dead_count = 0;
        let mut remap = vec![REMOVE_STATE; num_states];
        let mut new_index: i32 = 0;

        for i in 0..num_states {
            let d = depths.as_ref().map_or(0, |ds| ds[i]);
            let dist = dist_to_accept[i];
            if d.saturating_add(dist) > effective_max_depth {
                dead_count += 1;
            } else {
                remap[i] = new_index;
                new_index += 1;
            }
        }

        if dead_count == 0 {
            return;
        }

        self.remap_states(&remap);
    }

    // ====================================================================
    // Simulation-based reduction
    // ====================================================================

    /// Reduce using forward simulation. State A simulates state B if A
    /// accepts a superset of strings that B accepts. When A simulates B,
    /// transitions to B can be redirected to A (or B can be merged with A
    /// when they mutually simulate each other).
    pub fn reduce_by_simulation(&mut self) {
        assert!(self.sealed);
        assert!(self.epsilon.is_empty());

        let num_states = self.transitions.len();
        if num_states <= 1 {
            return;
        }

        let num_symbols = self.num_symbols();
        if num_symbols == 0 {
            return;
        }

        // sim[a] is a set of states that a simulates.
        // Initialize: a simulates b if accept(b) implies accept(a).
        let mut sim: Vec<Vec<bool>> = Vec::with_capacity(num_states);
        for a in 0..num_states {
            let a_accepts = self.accept_ids.contains(&a);
            let mut row = Vec::with_capacity(num_states);
            for b in 0..num_states {
                let b_accepts = self.accept_ids.contains(&b);
                // a can simulate b only if: b accepting => a accepting
                row.push(!b_accepts || a_accepts);
            }
            sim.push(row);
        }

        // Iteratively refine.
        let mut changed = true;
        while changed {
            changed = false;
            for a in 0..num_states {
                for b in 0..num_states {
                    if a == b || !sim[a][b] {
                        continue;
                    }

                    // Check if a still simulates b.
                    let mut still_simulates = true;
                    for s in 0..num_symbols {
                        let b_targets = self.get_targets(b, s);
                        if b_targets.is_empty() {
                            continue;
                        }

                        let a_targets = self.get_targets(a, s);
                        if a_targets.is_empty() {
                            still_simulates = false;
                            break;
                        }

                        // For each b' in b_targets, there must exist a' in
                        // a_targets such that sim[a'][b'] is true.
                        let ok = b_targets.iter().all(|&b_prime| {
                            a_targets.iter().any(|&a_prime| sim[a_prime][b_prime])
                        });
                        if !ok {
                            still_simulates = false;
                            break;
                        }
                    }

                    if !still_simulates {
                        sim[a][b] = false;
                        changed = true;
                    }
                }
            }
        }

        // Prune dominated transitions.
        for state in 0..num_states {
            for s in 0..num_symbols {
                let targets = self.get_targets(state, s).to_vec();
                if targets.len() <= 1 {
                    continue;
                }
                // A target b is dominated if there exists another target a in
                // targets where a simulates b (and either a < b or b doesn't
                // simulate a, i.e., strict domination or canonical preference).
                let mut keep = vec![true; targets.len()];
                for (i, &b) in targets.iter().enumerate() {
                    for (j, &a) in targets.iter().enumerate() {
                        if i == j {
                            continue;
                        }
                        if sim[a][b] && (a < b || !sim[b][a]) {
                            keep[i] = false;
                            break;
                        }
                    }
                }
                // Apply pruning.
                if keep.iter().any(|&k| !k) {
                    let new_targets: Vec<usize> = targets
                        .iter()
                        .zip(keep.iter())
                        .filter(|(_, &k)| k)
                        .map(|(&t, _)| t)
                        .collect();
                    self.set_targets(state, s, new_targets);
                }
            }
        }

        // Build remap: merge simulation-equivalent states.
        let mut remap = vec![REMOVE_STATE; num_states];
        let mut next_index: i32 = 0;
        for b in 0..num_states {
            // Find the smallest canonical equivalent.
            let mut canonical = b;
            for a in 0..b {
                if sim[a][b] && sim[b][a] {
                    canonical = a;
                    break;
                }
            }
            if canonical == b {
                remap[b] = next_index;
                next_index += 1;
            } else {
                remap[b] = remap[canonical];
            }
        }

        if next_index as usize == num_states {
            return; // No merging happened.
        }

        self.remap_states(&remap);
    }

    // ====================================================================
    // Helpers
    // ====================================================================

    fn get_targets(&self, state: usize, sym_idx: usize) -> &[usize] {
        let trans = &self.transitions[state];
        if sym_idx < trans.len() {
            &trans[sym_idx]
        } else {
            &[]
        }
    }

    fn set_targets(&mut self, state: usize, sym_idx: usize, targets: Vec<usize>) {
        let trans = &mut self.transitions[state];
        if trans.len() <= sym_idx {
            trans.resize_with(sym_idx + 1, Vec::new);
        }
        trans[sym_idx] = targets;
    }
}

/// Run the standard NFA optimization pipeline:
/// 1. Close over epsilon transitions
/// 2. Remove dead states
/// 3. Reduce by simulation
pub fn optimize_nfa(nfa: &mut Nfa, max_depth: usize, all_states_reachable: bool) {
    nfa.close_over_epsilon_transitions();
    nfa.remove_dead_states(max_depth, all_states_reachable);
    nfa.reduce_by_simulation();
}
