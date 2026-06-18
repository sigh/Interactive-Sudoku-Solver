# Count Distinct

This document specifies the constraint-propagation algorithm implemented by the
`CountDistinct` handler in [handlers.js](../handlers.js). For the solver engine that
drives the handler, see [SOLVER_ENGINE.md](../SOLVER_ENGINE.md); for the handler
interface in general, see [README.md](../README.md).

The presentation is self-contained and aimed at a reader comfortable with basic
graph algorithms (bipartite matching, strongly connected components) and bitmask
manipulation. Each step is given in pseudocode with an argument for why its
pruning is *sound* — why it never removes a candidate that takes part in some
valid solution. Unusually for a propagator, the value-reasoning here is split into
a **complete** half and an **approximate** half, and we are careful below about
which is which:

- The reasoning about the *largest* achievable distinct count is **exact** — it
  achieves generalized arc consistency (GAC), removing every value that has no
  support whatsoever.
- The reasoning about the *smallest* achievable count is a deliberate sound
  **under**-approximation, because the exact version is NP-hard. It prunes less
  than GAC but never unsoundly.

## 1. Problem Statement

`CountDistinct` enforces the **NValue** constraint. There is one *control* cell
and a list of *counted* cells, and the constraint is

```text
value(control) = number of distinct values taken by the counted cells.
```

Write the counted cells' candidate sets (domains) as bitmasks `D_1 … D_m`, one bit
per value, and the control's domain as `C`. A satisfying assignment picks
`x_i ∈ D_i` for each counted cell and requires `value(control) = |{x_1,…,x_m}|`.

The goal is GAC: from each cell remove any candidate that appears in no satisfying
assignment. As elsewhere in the engine, candidates are 16-bit masks and grids are
at most 16×16, so every value set fits in a machine word and every set operation
is a single bitwise instruction.

### 1.1 Offset convention

A distinct *count* `k` is itself stored in the control cell as a value bit. With
the grid's value offset `o`, count `k` occupies bit `k − o − 1` (so the smallest
count, 1, is the lowest representable value). All the count↔mask conversions below
use this shift; it is the only place the offset appears.

## 2. Key Structure

The whole algorithm rests on three facts about distinct counts.

### 2.1 The achievable counts form an interval

> **Lemma.** The set of achievable distinct counts,
> `{ |{x_1,…,x_m}| : x_i ∈ D_i }`, is a contiguous integer interval `[minD, maxD]`.

*Proof.* Take any two assignments, `A` with `a` distinct values and `B` with `b`,
`a < b`. Walk from `A` to `B` by changing one cell at a time from its `A`-value to
its `B`-value. Each single change removes at most one value (its old one, if no
other cell still holds it) and adds at most one (its new one, if absent), so the
distinct count moves by at most 1 per step. A quantity that starts at `a`, ends at
`b`, and changes by at most 1 each step takes every integer value in `[a, b]`.
Every intermediate assignment is legal, since each cell sits on either its `A`- or
its `B`-value, both in its domain. ∎

Consequently the control cell is GAC simply by intersecting it with the interval
`[minD, maxD]` — there are no interior holes to worry about.

### 2.2 Fixed values, and bounds on the interval

A counted cell whose domain is a single bit is **fixed**: its value is already
forced. Split the counted cells into the fixed ones and the rest:

```text
fixedMask   = OR of the fixed cells' values
fixedCount  = popcount(fixedMask)          # distinct values they already contribute
unfixed     = the remaining cells, domains D_c
```

Every fixed value is present in every solution, so the bounds decompose as

```text
maxD = fixedCount + (most new distinct values the unfixed cells can add)
minD = fixedCount + (fewest new distinct values the unfixed cells can add)
```

where "new" means *not already in `fixedMask`* (reusing a fixed value adds
nothing). The two unfixed terms are computed in §3 and §4 respectively.

### 2.3 Counted cells are only prunable at the extremes

The interval lemma has a second, less obvious consequence that makes the whole
handler cheap.

> **Lemma.** Fix one unfixed cell `j` to a value `v`. The counts still achievable
> form a sub-interval `[minD(j←v), maxD(j←v)]` that always contains
> `[minD+1, maxD−1]`.

*Proof.* Pinning a single cell changes each bound by at most one (the same
one-cell-at-a-time argument as §2.1, applied to the unpinned cells): a forced
value can raise the minimum by at most 1 and lower the maximum by at most 1. So
`minD(j←v) ≤ minD+1` and `maxD(j←v) ≥ maxD−1`. ∎

Therefore, **if the control still allows any count strictly between `minD` and
`maxD`, every counted candidate is supported** (its sub-interval meets the allowed
set), and no counted cell can be pruned at all. Counted-cell pruning is attempted
only once the control has been pinned to an *extreme* — only `minD`, only `maxD`,
or only `{minD, maxD}` remain. This is the `interiorMask` early-out, and it means
the expensive per-cell work in §3.2 and §4.2 runs rarely.

At an extreme, a value `v` in cell `j` survives iff fixing `x_j = v` keeps an
allowed count reachable:

```text
maxD allowed:  keep v iff fixing x_j = v can still reach maxD distinct values
minD allowed:  keep v iff fixing x_j = v can still reach minD distinct values
```

### 2.4 Top-level shape

```text
function enforceConsistency(grid):
    split counted cells into fixedMask and the unfixed list   # §2.2
    if any counted domain is empty: return CONTRADICTION

    maxD = fixedCount + maxMatching(unfixed, ~fixedMask)       # §3.1
    minD = fixedCount + packing(unfixed, seed = fixedMask)     # §4.1
    intersect control with [minD, maxD]                        # §2.1; fail if empty

    if the control still allows a count in (minD, maxD): return OK   # §2.3
    if maxD is allowed: reginPrep()                            # §3.2
    if minD is allowed: supported ← minSupport()              # §4.2 (one pass)
    for each unfixed cell j:
        keep ← (maxSup_j, §3.2) ∨ (supported, §4.2)           # whichever sides apply
        write back keep ∧ D_j; fail if empty
    return OK
```

## 3. The Maximum (exact / GAC)

### 3.1 maxD as a bipartite matching

The most distinct values the unfixed cells can add is the largest set of values
they can cover, each value represented by a distinct cell that contains it. That
is exactly a **maximum bipartite matching** between the unfixed cells and the
*non-fixed* values (a cell may match a value `v` iff `v ∈ D_cell` and
`v ∉ fixedMask`). Its size is the added distinct count, so
`maxD = fixedCount + |matching|`.

The matching is computed by Kuhn's augmenting-path algorithm, but written entirely
with bitmasks. Unmatched ("free") values are tracked in a single mask `freeMask`,
so an augmenting search can grab one in one bitwise step.

```text
function maxMatching(excludeVal):                 # excludeVal = fixedMask
    owner[*] ← none                               # value bit -> cell
    freeMask ← all values
    size ← 0
    for each unfixed cell i:
        b ← augment(i, excludeVal, freeMask)
        if b ≠ none: freeMask ← freeMask \ {b};  size ← size + 1
    return size

function augment(startCell, excludeVal, freeMask):
    seen ← ∅;  push startCell
    while stack non-empty:
        avail ← D[top cell] \ excludeVal \ seen   # unseen, usable values here
        if avail ∧ freeMask ≠ ∅:                  # a free value is directly reachable
            commit it as this frame's value
            assign owner along the whole stack    # flip the augmenting path
            return that value bit
        if avail ≠ ∅:
            v ← lowest bit of avail
            seen ← seen ∪ {v}
            push owner[v]                          # try to relocate v's current owner
        else:
            pop                                    # dead end, backtrack
    return none
```

`owner` is left holding the final matching, which §3.2 reuses. A standard fact
about Kuhn's algorithm is that the result is a *maximum* matching, so
`fixedCount + size` is exactly `maxD`.

### 3.2 Régin filtering on the value graph

When the control is pinned so that `maxD` is allowed, a value `v` in unfixed cell
`j` survives only if fixing `x_j = v` can still reach `maxD` distinct values.
Naively this is one matching recomputation per `(cell, value)` pair. Régin's
theorem lets us classify *all* pairs from a *single* maximum matching, in one pass.

The trick is the **value graph**: contract each matched cell into the value it is
matched to, leaving a graph whose nodes are values only (≤ 16, so every node set
is a bitmask). Write `cellMatch[c]` for the value cell `c` is matched to (or
`none` if the matching left `c` unmatched — a **free cell**), and call a non-fixed
value that is present but unmatched a **free value**.

```text
edge  u → w   iff   some cell matched to w also has u in its (non-fixed) domain
```

Reading `u → w` operationally: the cell currently using `w` could give it up and
take `u` instead — one step of an alternating path. Let `reach[u]` be the
transitive closure (values reachable from `u`, including `u`), computed by a
Warshall closure over the ≤16 nodes.

```text
function reginPrep(fixedMask):
    cellMatch ← invert owner            # cell -> value, or none
    reach[u]  ← 0 for all values
    for each unfixed cell c:
        e ← D_c \ fixedMask
        w ← cellMatch[c]
        if w = none:  freeCellDom ← freeCellDom ∪ e;  continue
        for each u in e with u ≠ w:  reach[u] ← reach[u] ∪ {w}     # build edges
    reach ← transitive closure of reach (Warshall); add self loops
    reachA ← ⋃ { reach[f] : f a free value }      # reachable from a free value
    return (reachA, freeCellDom)
```

Two derived quantities drive the test: `reachA` (values reachable from a free
value) and `freeCellDom` (the union of the free cells' domains). With them, the
surviving values of an unfixed cell `c` matched to `w` are:

```text
if c is a free cell, or reach[w] ∧ freeCellDom ≠ ∅:
    maxSup[c] ← D_c                                  # keep everything
else:
    maxSup[c] ← (D_c \ fixedMask) ∧ (reach[w] ∨ reachA)
```

**Why this is exactly the support set.** Fixing `x_j = v` reaches `maxD` in two
ways, matching the two cases:

- *`v` is a non-fixed value.* Then `v` becomes a new distinct value, and the rest
  must still attain `|matching| − 1`; equivalently the edge `(j, v)` lies in *some*
  maximum matching. By matching theory that holds iff `v` is `c`'s own match, or
  `c` and `v` lie on a common alternating cycle (`v ∈ reach[w]`, using the
  always-present back-edge `v → c → w`), or `v` lies on an alternating path from a
  free value (`v ∈ reachA`). These are the three terms of `reach[w] ∨ reachA`,
  intersected with `c`'s non-fixed candidates.
- *`v` is a fixed value.* Then pinning `c` to `v` adds nothing new, so the rest
  must reach `maxD` *without* `c` — i.e. `c` can be left unmatched in some maximum
  matching. That holds iff `c` is already free, or `c` can reach a free cell along
  an alternating path (`reach[w] ∧ freeCellDom ≠ ∅`). Only then are `c`'s fixed
  candidates kept (the "keep everything" branch).

The one subtlety worth flagging — and the bug this formulation is easy to get
wrong — is that reaching a free *value* does **not** let a matched cell be left
unmatched; only reaching a free *cell* does. So `reachA` appears in the value test
but must *not* appear in the "keep everything" condition.

This pass is exact: it keeps precisely the values with maximum-side support, so the
max half of the handler is full GAC.

## 4. The Minimum (sound approximation)

### 4.1 minD as a disjoint packing

The fewest new distinct values the unfixed cells need is the minimum number of
values that *hit* every unfixed domain (a value assigned to each cell, minimizing
how many distinct ones are used). That is a minimum hitting set, which is NP-hard,
so we settle for a sound *lower* bound and accept weaker pruning.

The bound is a **greedy disjoint-domain packing**: if `k` unfixed domains are
pairwise disjoint (and disjoint from the already-reserved values), then they must
take `k` distinct new values, so `k` is a lower bound. Greedily:

```text
function packing(seed = fixedMask):     # the picked cells are those it counts
    used ← seed;  count ← 0
    for each unfixed cell c:
        if D_c ∧ used = 0:              # disjoint from everything reserved so far
            count ← count + 1           # c is "picked"
            used ← used ∪ D_c
    return count                         # leaves packUsed = used
```

Writing `packBase = packing()`, we have `minD = fixedCount + packBase`. Because
the packing never *over*counts, `minD` is a true lower bound on the real minimum,
so intersecting the control with
`[minD, maxD]` (§2.1) is **sound**: the kept low counts are a superset of the
achievable ones, so no achievable control value is ever removed. (Seeding `used`
with `fixedMask` first is what makes the bound tight in practice: it reserves the
forced values before any unfixed domain can claim them, e.g. it packs
`{1,2},{1},{2}` to 2 rather than 1.)

The same pass records what §4.2 needs: the final `used` (call it `packUsed` —
`fixedMask` plus the picked domains), and `ownerDom`, mapping each value in a
picked domain to that whole domain (and every other value to `0`). The picked
domains are pairwise disjoint by construction.

### 4.2 Min-side counted pruning

When the control is pinned so that `minD` is allowed, value `v` in cell `j`
survives only if fixing `x_j = v` can still reach `minD`. We answer this for
*every* value in a single pass, reusing the packing of §4.1 — its `packBase`
pairwise-disjoint **picked** domains, with union `packUsed`.

> **Prune rule.** If some `packBase`-sized disjoint packing of unfixed domains
> *avoids* `v` (and avoids `fixedMask`), then `v` is unsupportable at `minD`, so
> remove it.

*Soundness.* Such a packing forces `packBase` distinct values, none equal to a
fixed value or to `v`. Any assignment with some `x = v` then contributes one more
distinct value, so its count is at least `fixedCount + packBase + 1 = minD + 1`.
Hence no assignment with `x_j = v` reaches `minD`, and removing `v` is sound. ∎

We look for an avoiding packing with a **single swap**. A value `v ∈ packUsed`
lies in exactly one picked domain (they are disjoint) — its **owner** `od`.
Replacing that owner cell with a different unfixed cell `q` gives another
`packBase` packing iff `q` avoids the rest of the packing,
`D_q ∧ (packUsed \ od) = ∅`; the swap avoids `v` iff `v ∉ D_q`. So a stand-in `q`
for `od` rules out exactly the owner values it omits, and

> `v ∈ od` survives the min side iff *every* stand-in for `od` contains `v` —
> i.e. `od`'s survivors are `od ∧ (⋀ stand-in D_q)`, all of `od` if it has none.

This is a deliberate **under**-approximation: it tries only single swaps, not
multi-cell rearrangements, so it can keep a value a fuller search would prune. It
is sound (every removal exhibits a real avoiding packing) but, like the
hitting-set bound it builds on, prunes less than GAC. (It is therefore *not*
comparable to the per-value-packing test it replaces: each rules out cases the
other misses; both are sound.)

```text
function minSupport():                       # picked domains + packUsed + ownerDom from §4.1
    supported ← packUsed                      # every covered value, fixed included
    for each unfixed cell q:
        b  ← D_q ∧ packUsed                   # q's footprint on the packed values
        od ← ownerDom[highest bit of b]       # candidate owner (0 if none)
        if b ⊆ od:                            # q is a stand-in for od's owner
            supported ← supported ∧ (b ∨ ¬od) # intersect od's bits with b, others untouched
    return supported
```

Two facts collapse this to one branchless loop with no per-owner storage:

- **One accumulator for all owners.** The picked domains occupy disjoint bit
  ranges, so `supported ∧ (b ∨ ¬od)` narrows only `od`'s bits and leaves every
  other owner alone.
- **`od = 0` self-handles everything that is not a stand-in.** A footprint whose
  highest bit is fixed or free maps to `od = 0`, and `b ⊆ od` then fails, so the
  cell contributes nothing. Fixed values likewise have `od = 0`, so they are
  never narrowed and stay supported — exactly "a fixed value adds nothing, so it
  is always min-supported". The owner cell maps to its own domain, a no-op.

A value survives the min side iff it is in `supported`; the per-cell `keep` is
`maxSup_j ∨ supported` intersected with `D_j` (§2.4).

## 5. A Static Lower Bound from Exclusions

One extra deduction is applied once, at `initialize`, that the value-domain
reasoning above cannot make. If several counted cells are pairwise
*mutually exclusive* — they share a row, column, or box, so the engine already
forbids them from being equal — then they are guaranteed to take different values,
so the distinct count is at least the size of the largest such group. The handler
finds these groups with `HandlerUtil.findExclusionGroups` and raises the control's
initial lower bound accordingly. This is sound (mutually exclusive cells really
must differ) and is strictly extra information, because the NValue constraint by
itself does not know that two counted cells cannot be equal. Domains only shrink
during search, so the bound, applied once, never needs revisiting.

## 6. Implementation Notes

- **Shared scratch.** All working arrays (`_unfixedDoms`, `_cellMatch`, the
  augmenting-path stacks, `_valueOwner`, `_reach`, `_packOwnerDom`, …) are
  *static* members of `CountDistinct`, grown on demand by `_ensureScratch`. The
  solver enforces one handler at a time, so there is never concurrent use, and a
  single set of buffers sized to the largest constraint serves every instance.
  Only the constraint definition and a few per-call scalars live on the instance.
- **16-bit storage.** Cell indices (≤ 256) and value masks (≤ 16 bits) both fit in
  16 bits, so the buffers are `Uint16Array` / `Int16Array`.
- **No allocation, no recursion, no per-value loops on the hot path.** The
  matching is iterative Kuhn over the explicit stacks; the value-graph closure is
  an iterative Warshall over ≤16 nodes; the packing and the min-side support
  (§4.2) are each a single pass over the unfixed cells — the min side needs no
  per-value packing recomputation. `enforceConsistency` allocates nothing.
- **Work is over unfixed cells only.** Splitting out the fixed cells once (§2.2)
  keeps the matching, packing, and Régin pass small — they never touch the fixed
  cells, which contribute only the constant `fixedCount` and the reserved
  `fixedMask`.

```
