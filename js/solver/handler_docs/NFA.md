# Sequential Constraints via NFAs (regex / line constraints)

This document specifies the constraint-propagation algorithm implemented by the
`NFAConstraint` handler in [nfa_handler.js](../nfa_handler.js). For the solver
engine that drives the handler, see [SOLVER_ENGINE.md](../SOLVER_ENGINE.md); for
the handler interface in general, see [README.md](../README.md). The NFA itself is
built and reduced by [nfa_builder.js](../../nfa_builder.js).

The presentation is self-contained and aimed at a reader comfortable with finite
automata and bitmask manipulation. The handler achieves **generalized arc
consistency (GAC)**: for each cell it removes every value that cannot appear at
that position in *any* sequence the automaton accepts, given the other cells'
current candidates. This is the classic layered-graph `regular` propagator
, specialised to an NFA and to bitset-packed value sets.

## 1. Problem Statement

An `NFAConstraint` applies to an **ordered** list of cells `cell_0 … cell_{k-1}`.
Reading one value from each cell in order yields a sequence

```text
v_0 v_1 … v_{k-1}      with each v_i a value in 1 … numValues
```

and the constraint holds iff that sequence is **accepted** by a fixed
nondeterministic finite automaton (NFA) over the alphabet of grid values.

The goal is GAC pruning: keep a value `v` in `cell_i` iff some accepted sequence
puts `v` at position `i` while every other position stays inside its cell's
current candidate set.

## 2. From Constraint to NFA

The automaton is produced once, at construction, by
[nfa_builder.js](../../nfa_builder.js):

- `regexToNFA` parses a regex (literals, `.`, character classes, `()`, `|`, and
  the `*` `+` `?` `{n,m}` quantifiers) into an NFA by Thompson construction, which
  introduces ε-transitions.
- `javascriptSpecToNFA` builds an NFA from a `(startState, transition, accept)`
  state machine by breadth-first state exploration.
- `optimizeNFA` then **closes over ε-transitions**, **removes dead states** (those
  that cannot lie on any start→accept path within the cell count), and **merges
  simulation-equivalent states** (`reduceBySimulation`). Shrinking the state count
  here directly bounds the handler's per-call work (§6).

A **symbol** corresponds to a grid value: value `v` is symbol index `v − 1`, the
same bit position used in the solver's candidate bitsets. (Any `valueOffset` for
0-based grids is folded in during compilation, so the handler works in unshifted
value space.) `compressNFA` finally `seal`s the automaton and converts it to the
runtime representation below.

## 3. Representation: `CompressedNFA`

States are numbered `0 … numStates−1` (at most `2^16`, so a state id fits in 16
bits). The compressed form holds three things:

- `startingStates`, `acceptingStates` — `BitSet`s over the state space.
- `transitionLists[s]` — a `Uint32Array` of the outgoing transitions of state `s`,
  with the targets **grouped**: one entry per distinct target, carrying the
  combined set of symbols that lead there.

### 3.1 The packed transition entry

Each entry packs a target and a symbol mask into one 32-bit word:

```text
entry = (target << 16) | symbolMask
```

- the low 16 bits are a **symbol mask** — bit `v−1` is set iff value `v` labels a
  transition `s → target`;
- the high 16 bits are the **target** state.

Two lookups fall out for free, and they are the core trick of the inner loop:

- **Does this transition fire under the cell's candidates?** A candidate set
  `values` is itself a ≤16-bit mask, so `values & entry` keeps only the low 16
  bits (the target in the high bits is masked away because `values < 2^16`). The
  result is non-zero iff some still-possible value labels the transition, and the
  result *is* the set of such values.
- **What is the target?** `entry >>> 16`.

All states' transition lists are slices of a single flat `Uint32Array`
(`transitionBackingArray`) for locality.

### 3.2 State-set scratch (allocated once)

A propagation needs the reachable **set** of states at each of the `k+1` cell
boundaries. The constructor allocates that pool once with `BitSet.allocatePool`:
`statesList` is `k+1` `BitSet`s ("layers") backed by a single `Uint32Array`
(`_stateWords`). Because they share one buffer, the whole pool is cleared with one
`_stateWords.fill(0)` and reused on every call — propagation allocates nothing.

## 4. The Propagation Algorithm

Each call makes two sweeps over the layers. `layer[i]` denotes `statesList[i]`, the
set of NFA states the automaton might be in after reading the first `i` cells. Each
sweep is a double loop — over the states in a layer, and over each state's
transition list — so a call costs `O(k × |active states| × |transitions per
state|)` (§6). A transition `s → t` carries a set of `symbols` (the values that
take `s` to `t`); it **fires** at position `i` when `symbols` intersects
`cell_i`'s candidate set.

```text
function enforceConsistency(grid):
    layer[0] ← startingStates

    # Forward pass: states reachable over a consistent prefix.
    for i in 0 … k-1:
        candidates ← grid[cell_i]
        layer[i+1] ← ∅
        for each state s in layer[i]:
            for each (target, symbols) in transitionLists[s]:
                if symbols ∩ candidates ≠ ∅:           # transition fires
                    add target to layer[i+1]
        if layer[i+1] is empty: return CONTRADICTION

    # Restrict the final layer to accepting states.
    layer[k] ← layer[k] ∩ acceptingStates
    if layer[k] is empty: return CONTRADICTION

    # Backward pass: drop states that lie on no accepting path; prune values.
    for i in k-1 … 0:
        candidates ← grid[cell_i]
        support ← ∅
        for each state s in layer[i]:
            kept ← false
            for each (target, symbols) in transitionLists[s]:
                fired ← symbols ∩ candidates
                if fired ≠ ∅ and target ∈ layer[i+1]:
                    support ← support ∪ fired
                    kept ← true
            if not kept: remove s from layer[i]
        if support is empty: return CONTRADICTION
        if support ≠ candidates:
            grid[cell_i] ← support                     # prune; notify accumulator
    return OK
```

The inner test `symbols ∩ candidates` and the membership test `target ∈ layer[i+1]`
are each a single bitwise operation at runtime — see §3.1 for the packing that makes
them so.

**What the layers mean.** After the forward pass, `layer[i]` is the set of states
reachable from a start state over some value sequence consistent with the first `i`
cells — the *prefix-feasible* states. The backward pass walks right-to-left and
overwrites each `layer[i]` in place, keeping a state only if one of its transitions
fires into the *already-pruned* `layer[i+1]`. Because the pass moves leftward,
`layer[i+1]` by then holds only states that can still reach an accepting state over
a consistent suffix. So afterwards `layer[i]` holds exactly the states that are both
reachable from the start and able to reach an accepting state.

## 5. Soundness and GAC

Consider value `v` kept in `cell_i`. It survives only as a support label: there is
a state `s ∈ layer[i]` with a transition `s → t` labelled by `v` where
`t ∈ layer[i+1]` (the pruned, accepting-path version). Unfolding the layer
meanings:

- `s ∈ layer[i]` ⇒ there is a start→`s` run on values consistent with cells
  `0 … i−1`;
- `t ∈ layer[i+1]` (post-prune) ⇒ there is a `t`→accept run on values consistent
  with cells `i+1 … k−1`;
- the edge `s →_v t` places `v` at position `i`.

Concatenating gives a full accepting sequence that uses `v` at position `i` with
every other position inside its domain — so `v` genuinely has support. Conversely,
any value with no such triple is in no cell's support and is removed. That is
exactly generalized arc consistency for the sequence constraint, and the
contradiction checks (an empty `layer[i+1]` in the forward pass, an empty accepting
intersection, or an empty support) fire precisely when no accepting sequence
remains.

Tracking reachable *sets* of states (an on-the-fly subset construction, one set per
layer) is what makes this correct for a *nondeterministic* automaton: ambiguity in
which state the machine is in never loses a supporting path, because every
reachable state is carried.

## 6. Implementation Notes

- **16-bit packing.** `(target << 16) | symbolMask` and the `values & entry` /
  `entry >>> 16` pair (§3.1) are the whole reason a transition test is two integer
  ops with no branches on symbols. It relies on candidate sets and symbol masks
  both fitting in the low 16 bits.
- **No per-call allocation.** Both the transition lists and the `k+1`-layer state
  pool are single flat `Uint32Array`s built once; each call only does one
  `fill(0)` and then reads/writes words.
- **Inlined hot loops.** The forward and backward passes operate directly on the
  bitsets' `.words` arrays — the bit iteration *and* the `add` / `has` / `bitIndex`
  operations are inlined rather than called as `BitSet` methods, because the method
  call overhead was significant. On NFA-heavy puzzles this handler is frequently
  the dominant cost in the whole solve, so the inner loop is kept as tight as
  possible.
- **Small automata.** The compile-time reductions in `optimizeNFA` (dead-state
  removal and simulation merging) keep `numStates` down, which bounds both the
  memory of the state pool and the work per layer.
- **Recomputed each call.** There is no incremental state between calls: a single
  call is `O(k × activeStates × avgTransitions)`, recomputing both passes from the
  current candidate sets every time the handler runs.
