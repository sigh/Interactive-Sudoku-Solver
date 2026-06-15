# Chaos Construction

This document specifies the constraint-propagation algorithms implemented in
[chaos_handler.js](../chaos_handler.js). For the solver engine that drives these
handlers, see [SOLVER_ENGINE.md](../SOLVER_ENGINE.md); for the handler interface in
general, see [README.md](../README.md).

The presentation is self-contained and aimed at a reader comfortable with basic
graph algorithms (BFS, union-find) and bitmask manipulation. Each algorithm is
given in pseudocode together with an argument for why its pruning is *sound* —
that is, why it never removes a candidate that participates in some valid
solution. Soundness is the only correctness property a propagator must have; it
is free to leave work undone, because the surrounding backtracking search will
resolve anything propagation misses.

## 1. Problem Statement

In a *chaos construction* puzzle the partition of the grid into regions (the
analogue of a Sudoku's nine boxes) is not given. Let the grid have `N` cells and
fix a *region size* `s` that divides `N`, giving `R = N / s` regions. A solution
must assign to every cell both a value and a region label `0 … R−1` such that:

1. **Value houses.** Rows, columns, and any other declared houses contain
   distinct values (enforced by the ordinary engine handlers).
2. **Region size.** Each region label is used by exactly `s` cells.
3. **Region houses.** The `s` cells of a region take `s` distinct values.
4. **Region connectivity.** The `s` cells of a region form a single
   orthogonally-connected (4-neighbour) component.

Properties 2–4 are what the `ChaosConstruction` handler enforces. Three smaller
handlers (`ChaosArrow`, `ChaosCount`, `ChaosFixedValueRegionExclusion`) enforce
auxiliary clues defined in terms of the same unknown regions.

## 2. Representation

### 2.1 Candidates as bitmasks

The engine stores every cell's possible values as a 16-bit integer, one bit per
value (see [SOLVER_ENGINE.md](SOLVER_ENGINE.md) §"Cell Candidates as Bitmasks").
Region labels are encoded the same way. Concretely, the grid state array holds
two parallel lanes:

```text
grid[i]                       value-candidate mask of cell i        (0 ≤ i < N)
grid[regionCellOffset + i]    region-label mask of cell i           (bit r set ⇒ cell i may be region r)
```

Reusing the value-mask encoding for region labels means every engine facility —
fast set intersection (`&`), union (`|`), population count, automatic
save/restore across backtracking — applies to region reasoning unchanged. The
handler's `cells` list contains both lanes, so the engine re-queues it whenever
either a value or a region candidate changes.

A cell is **fixed** to a region when its region mask is a single set bit. We
write `popcount(m)` for the number of set bits in `m`, and use "label" and
"region" interchangeably.

### 2.2 Shards

Reasoning cell-by-cell is wasteful, because many cells become provably
co-regional long before their actual region is known. A **shard** is a maximal
set of cells currently known to lie in the same (as-yet-unknown) region. Shards
are the unit of work for every phase below.

Shards are maintained as a **union-find** (disjoint-set) forest stored in branch
state, so a union performed deep in the search is automatically undone on
backtracking. Two design choices keep shards cheap to traverse:

- **Monotonic roots.** A union always redirects the *larger* cell index to the
  *smaller*, so a shard's root is its minimum-index member.
- **Member lists in cell order.** A single left-to-right pass over all cells can
  flatten the forest and thread each shard's members onto a singly-linked list,
  because by the time the pass reaches a non-root cell its parent has already
  been flattened to the true root.

```text
function FIND(roots, c):
    while roots[c] ≠ c:
        c ← roots[c]
    return c

function UNION(roots, a, b):              # returns true if a merge happened
    ra ← FIND(roots, a); rb ← FIND(roots, b)
    if ra = rb: return false
    if rb < ra: swap(ra, rb)              # keep the smaller index as the root
    roots[rb] ← ra
    return true
```

Sources of unions: explicit region-link clues at setup, the arrow/count handlers
(§9) when they prove cells co-regional, and — recomputed every propagation —
adjacent cells fixed to the same label (§5.1).

## 3. Architecture

`ChaosConstruction.enforceConsistency` runs four phases in a fixed order. The
order is deliberate: each phase consumes per-region summaries built by the
previous one, and the final (most expensive) phase must not run on stale input.

```text
function enforceConsistency(grid):
    dirtyRegions ← ∅
    if not enforceCanonicalOrder(grid):       return CONTRADICTION   # §4
    if not rebuildShards(grid):                return CONTRADICTION   # §5
    result ← enforceShardHouseRules(grid)                            # §6
    if result = CONTRADICTION:                 return CONTRADICTION
    if result = DEFER_CONNECTIVITY:            return OK             # re-enter later
    if not enforceConnectivity(grid):          return CONTRADICTION   # §7
    return OK
```

Phases 2–4 read and write through the shard summaries rebuilt in §5, namely, per
shard root: its size, the union of its members' value masks, and the set of
values its members have already fixed.

## 4. Phase 1 — Canonical Label Ordering

### 4.1 Motivation

Region labels are interchangeable names: given any solution, permuting the labels
`0 … R−1` yields another solution that is identical as a partition. Left
unbroken, this symmetry would cause the search to rediscover each partition up to
`R!` times. We remove it by admitting only the *canonical* labelling of each
partition.

The canonical labelling is defined by: **a label may appear for the first time
only in increasing order as cells are scanned in index order.** Equivalently, the
first cell of label `k` precedes the first cell of label `k+1`. To pin the
labelling down at the corners, a few well-separated, high-priority *anchor* cells
are pre-assigned labels `0, 1, 2, …` during initialization
(`selectPriorityAnchorCells`).

### 4.2 Algorithm

```text
function enforceCanonicalOrder(grid):
    # seedMask = bits of the pre-pinned anchor labels {0 … numAnchors−1}
    allowed ← ((seedMask << 1) | 1) ∧ regionMask     # seeded labels + the next one
    for each region cell rc in index order:
        if allowed = regionMask: break               # nothing left to restrict
        new ← grid[rc] ∧ allowed
        if new = 0: return false
        grid[rc] ← new
        allowed ← allowed | (new << 1)               # a newly usable label k enables k+1
    return true
```

### 4.3 Soundness

Maintain the invariant that, just before cell `i` is examined, `allowed` contains
every label that may legally appear at cell `i`: all labels already usable by
cells `< i`, plus exactly one new label (the next unused one). Intersecting with
`allowed` removes only labels that, if placed here, would introduce label `k`
before label `k−1` has appeared — precisely the non-canonical assignments. Any
partition excluded this way is a relabelling of one still permitted, so no
distinct solution is lost. Crucially the filter uses *possible* labels (the mask),
not fixed ones, so it stays valid at every point in the search.

## 5. Phase 2a — Shard Materialization

This phase converts freshly-discovered "same region" facts into shards and
rebuilds the summaries the later phases read.

### 5.1 Absorbing adjacent fixed cells

```text
function mergeAdjacentFixedRegions(grid):
    for each cell c with a fixed region label r:
        for nb in {right(c), down(c)}:               # right/down avoids double work
            if nb exists and grid[regionCell(nb)] = r:
                UNION(shardRoots, c, nb)
```

Two orthogonally adjacent cells fixed to the same label are necessarily part of
the same connected region, so merging them loses nothing.

### 5.2 Rebuilding shard summaries and the region intersection

A single index-order pass flattens the forest, threads member lists, accumulates
per-shard summaries, *and* tightens each shard's region label. Because all cells
of a shard share one region, their region masks must agree; the shared candidate
set is their intersection. Rather than a second member walk, the intersection is
accumulated **in place** at the root's region cell as each member is visited, and
any root that gets tightened is recorded for the write-back of §5.3. Single-cell
shards take the root branch only, so they add no work here.

```text
function rebuildShardSummaries(grid):
    constrained ← empty list
    for c in 0 … N−1:
        r ← shardRoots[c]
        if c = r:                                     # c is its own root
            initialize size[r], valueMask[r], fixedValueMask[r] ← 0
            memberListHead[r] ← c
        else:
            r ← shardRoots[r]                         # parent already flattened
            shardRoots[c] ← r                         # path-compress
            prepend c to memberList[r]
            # Fold the member into the shard's running region intersection, which
            # is kept directly in grid[regionCell(r)].
            if grid[regionCell(c)] ≠ grid[regionCell(r)]:    # member disagrees
                inter ← grid[regionCell(r)] ∧ grid[regionCell(c)]
                if inter ≠ grid[regionCell(r)]:              # it narrows the shard
                    if inter = 0: return CONTRADICTION
                    grid[regionCell(r)] ← inter
                append r to constrained                       # (skip if already the tail)
        size[r] ← size[r] + 1
        if size[r] > s: return CONTRADICTION          # region would overflow
        valueMask[r] ← valueMask[r] | grid[c]
        if grid[c] is a single value v:
            if v ∈ fixedValueMask[r]: return CONTRADICTION   # two cells fix the same value
            fixedValueMask[r] ← fixedValueMask[r] | v
    return constrained
```

A single forward pass yields the full intersection because members only ever
*narrow* it: a member that disagrees with the running intersection either has
fewer labels (narrowing it now) or extra labels (which the write-back trims), and
either way its root is recorded. Recording is deduplicated cheaply against the
list's tail, so a run of adjacent members of one shard collapses to one entry; a
rare straggler that slips through is harmless because the §5.3 write-back is
idempotent.

### 5.3 Propagating the shared region mask

```text
function applyShardRegionMasks(grid, constrained):
    for each root r in constrained:
        set grid[regionCell(m)] ← grid[regionCell(r)] for every member m
```

Only shards whose members disagreed are rewritten; shards already in agreement
(and all single-cell shards) are never visited. `rebuildShards` runs §5.1,
then the combined §5.2/§5.3.

## 6. Phase 2b — Shard / House Consistency

This phase repeatedly scans the shards, derives per-region summaries, and applies
four pruning rules plus a hidden-single rule, until a fixed point is reached. All
rules share one scan, `scanRegionCandidates`.

### 6.1 The region scan

For each region the scan accumulates three quantities, packed into one 32-bit
word per region (`_regionScanData`):

- **fixed weight** `F(region)` — number of cells in shards *fixed* to this region;
- **possible weight** `P(region)` — number of cells in shards that merely *may*
  be this region;
- **value mask** `V(region)` — union of value candidates over those shards;

and separately `fixedValueMask(region)`, the values already pinned inside the
region. The scan returns false on the spot if two shards fixed to the same region
share a fixed value, or if a region's fixed weight exceeds `s`.

```text
function scanRegionCandidates(grid):
    zero all per-region accumulators
    for each shard root with size > 0:
        m ← grid[regionCell(root)]
        if m = 0: return false
        if m is a single label r:
            F(r) ← F(r) + size[root];        if F(r) > s: return false
            V(r) ← V(r) | valueMask[root]
            if fixedValueMask(r) ∧ fixedValueMask[root] ≠ 0: return false
            fixedValueMask(r) ← fixedValueMask(r) | fixedValueMask[root]
        else:
            for each label r in m:
                V(r) ← V(r) | valueMask[root]
                P(r) ← P(r) + size[root]
    markDirtyRegionsWherePossibleWeightChanged()      # see §8
    return true
```

### 6.2 Per-region feasibility and rule selection

```text
for each region r:
    if F(r) > s  or  F(r) + P(r) < s: return false    # too full / cannot fill
    if popcount(V(r)) < s:            return false    # a house of s cells needs ≥ s values
    if F(r) = s and P(r) > 0:         mark r FULL      # exactly filled; reject extras
    if fixedValueMask(r) ≠ 0:         mark r FIXED_VALUE
    if 2·F(r) ≥ s and popcount(fixedValueMask(r)) < s: mark r HIDDEN  # half-fixed
```

### 6.3 The pruning pass

A single pass over shards applies the marked rules to each shard's region mask
`keep`:

```text
for each shard root with size > 0:
    keep ← grid[regionCell(root)]

    # Rule A — fixed-value conflict.
    # If the shard fixes value v, it cannot join a region that already fixes v.
    if fixedValueMask[root] ≠ 0 and keep is not a single label:
        for each label r in keep ∧ FIXED_VALUE_regions:
            if fixedValueMask(r) ∧ fixedValueMask[root] ≠ 0:
                keep ← keep \ {r}

    # Rule B — full region.
    # A region already holding s fixed cells has no room for an optional shard,
    # provided the shard has an alternative.
    if (keep ∧ FULL_regions) ≠ 0 and keep is not a single label:
        keep ← keep \ FULL_regions

    if keep = 0: return false
    if keep changed: write it back; mark "changed"
```

(The same pass also records, for each `HIDDEN` region and value, the first shard
seen to host that value — the witness used in §6.4.)

If anything changed, the phase loops back to §6.1, because the new fixings can
trigger further deductions. Only when a full scan makes no change does it attempt
the hidden single.

### 6.4 Hidden region value singles

A region is a house of `s` cells with distinct values, so it uses **exactly** `s`
distinct values. When the set of values still able to appear in region `r` has
size exactly `s`, every one of those values must appear once. If such a value has
only a single candidate cell, it is forced there, and that cell's shard is fixed
to `r`.

```text
function enforceHiddenSingles(grid, hiddenRegions):
    for each region r in hiddenRegions with popcount(activeValues(r)) = s:
        for each value v in activeValues(r) not already fixed/duplicated:
            scan the witness shard's members for cells whose mask contains v
            if exactly one such cell c:
                grid[c] ← v                          # place the value
                fix c's shard to region r            # place the region
                return APPLIED
    return NONE
```

If a hidden single fires, it has mutated value candidates, which can invalidate
the connectivity summaries about to be used. Rather than run connectivity on
stale data, `enforceShardConsistency` returns `DEFER_CONNECTIVITY`; the engine
will re-enter the handler and recompute from scratch.

The guard "`activeValues(r)` has size exactly `s`" is essential: if more than `s`
values were still possible we could not conclude that any particular value must
appear, and the deduction would be unsound.

## 7. Phase 3 — Connectivity

The remaining property is that each region is a single connected component of
exactly `s` cells. Connectivity is the costliest phase, so it runs only on
*dirty* regions (§8) and operates on the shard graph: vertices are shard roots,
and two shards are adjacent if any of their cells are orthogonally adjacent. The
"size" of a shard vertex is its cell count, and the phase works against a scratch
copy `shardMask[]` of the region candidates so that pruning is applied atomically.

### 7.1 Distance-bounded reachability (regions with a fixed core)

Let the **fixed core** be the union of shards fixed to region `r`, of total size
`fixedSize`. Every other cell of the region must connect to the core through
cells that are themselves in the region. Because shards are atomic, entering any
cell of an optional shard commits its entire size. The minimum number of extra
region-cells needed to attach an optional shard to the core is therefore at least
the total size of the shards along a connecting path. We compute this with a
BFS bucketed by accumulated cell-distance (a Dijkstra-style expansion where each
optional shard contributes its size to the path cost), with budget
`maxExtra = s − fixedSize`.

```text
function growComponentFromCore(grid, shardMask, r, fixedSize, coreRoot):
    budget ← s − fixedSize
    bucket[0] ← {coreRoot}; mark coreRoot visited
    reachedFixed ← size[coreRoot]; componentSize ← fixedSize
    for d in 0 … budget:
        for each shard u pulled from bucket[d]:
            for each shard w adjacent to u with r ∈ shardMask[w], w unvisited:
                if shardMask[w] = {r}:                # w is itself fixed to r
                    dist ← d                          # fixed cells cost nothing extra
                    reachedFixed ← reachedFixed + size[w]
                else:
                    dist ← d + size[w]
                    if dist > budget:                 # cannot fit — w is not in r
                        shardMask[w] ← shardMask[w] \ {r}
                        continue
                    componentSize ← componentSize + size[w]
                    record w as an optional member of the component
                mark w visited; add w to bucket[dist]
    if reachedFixed < fixedSize: return DISCONNECTED  # core not all in one component
    return componentSize
```

Then:

```text
componentSize ← growComponentFromCore(...)
if componentSize = DISCONNECTED or componentSize < s: return false
remove r from every shard not visited                 # unreachable ⇒ not in r
if componentSize > s: componentSize ← pruneValueInfeasibleShards(...)   # §7.3
if componentSize < s: return false
if componentSize = s: fix every visited optional shard to r       # region determined
```

**Soundness.** The path cost is a *lower bound* on the region-cells required to
include a shard, so pruning a shard whose bound exceeds the budget removes only
genuinely impossible options. When the reachable component has size exactly `s`,
it is the *only* set that is connected, contains the whole core, and has the
right size, so it is the region — forcing all of it is justified.

### 7.2 Viable-component check (regions with no fixed core)

If no shard is yet fixed to `r`, the region's location is undetermined and we
must not choose among the components that could host it. We only reject the
region if *no* component can, and prune components that are too small.

```text
for each maximal connected component C of shards with r in their mask:
    if size(C) < s:
        remove r from every shard in C
    else if pruneValueInfeasibleShards(C) still ≥ s:
        mark "a viable component exists"
    else:
        remove r from every shard in C
if no viable component exists: return false
```

### 7.3 Value-aware component pruning

A shard reachable by size may still be unplaceable because the region is also a
value-house: the shards filling it must hold `s` *distinct* fixed values. For a
candidate shard, we check whether some conflict-free selection of component
shards (no two sharing a fixed value, none clashing with the core's fixed values)
can reach size `s` while including it.

```text
function pruneValueInfeasibleShards(component, base):
    for each shard u in component that fixes some value:
        feasible ← size(base)
        for each shard w in component:
            if fixedValueMask[w] conflicts base's values: continue
            if w ≠ u and fixedValueMask[w] conflicts fixedValueMask[u]: continue
            feasible ← feasible + size[w]
            if feasible ≥ s: break
        if feasible < s: remove r from u            # u cannot be in a valid region r
```

This is a greedy over-approximation (it does not solve the full value packing),
so it only removes shards that cannot fit under any selection — sound, though not
complete.

### 7.4 Bottlenecks (forced articulation cells)

A fixed component smaller than `s` must still grow to `s` cells, and it can grow
only into neighbouring shards that still carry its label — its **doors**. If a
component has no door it is trapped (contradiction); if it has exactly one door,
every completion must use it, so that door is forced into the region.

```text
function forceComponentDoors(grid, shardMask, regions):
    for each region r in regions:
        for each maximal connected fixed component C of region r:
            if size(C) ≥ s: continue
            doors ← { shards adjacent to C whose mask ⊋ {r} but contains r }
            if doors = ∅: return false
            if |doors| = 1: fix that door's shard to r
    return true
```

The doors are computed over the *whole* connected fixed component, because an
individual fixed shard may appear to have one exit while the component as a whole
has several.

**Which regions are checked.** A bottleneck can only *add* information when the
region has at least two free cells (`s − fixedCount ≥ 2`): the forced door plus
at least one cell beyond it. With one free cell the door would be the last cell,
which §7.1 already forces whenever it is the unique reachable extension; with
zero free cells the region is complete. So regions with `fixedCount + 2 > s` are
excluded from the bottleneck pass entirely, even dirty ones — for a dirty region
any genuine "no door" contradiction is already reported by the size check in
§7.1. Among the remaining regions, dirty labels are always checked and clean
labels are checked once they are at least half fixed.

Only the **single-door** case is forced. A natural generalization — force any
door `d` when the cells reachable from the core *without* `d` fall below `s` (a
vertex-cut / "the other doors can't supply enough cells" argument, computable in
one articulation-point pass) — was prototyped and measured. It is sound and fires
often, and it cut search sharply on some puzzles (x-sums −43% nodes), but it
*tripled* the node count on the canonical Chaos Construction puzzle: the extra
sound forcing steers the conflict-score / MRV heuristic into a worse tree.

After all per-region work, the scratch `shardMask[]` is written back to the grid
wherever it differs, queuing the affected cells for downstream handlers.

## 8. Incrementality

Three mechanisms keep the cost proportional to what actually changed:

- **Branch-state union-find.** Shard merges live in saved/restored state, so the
  same merges are not recomputed after backtracking.
- **Dirty-region tracking.** Connectivity is skipped for regions whose
  *possible weight* `P(region)` is unchanged since the last completed scan. The
  previous value is cached per region in branch state; `scanRegionCandidates`
  marks a region dirty when its weight differs. Only dirty regions (plus
  half-fixed regions for the bottleneck check) are traversed in §7.
- **Carried-over fixed weights.** The per-region fixed weight `F(region)` and a
  seed root (the lowest-index fixed shard) are produced by the region scan (§6.1)
  and reused as the §7.1 starting point, instead of rescanning all shards per
  region. The connectivity pass itself fixes more shards as it runs — a forced
  shard, or a removal that leaves a single candidate, both newly fix a shard to
  some region — so these values are *maintained incrementally* as labels are set
  or removed, never snapshotted once. The seed is kept as the lowest index so the
  distance-bounded traversal explores in the same order an index scan would,
  which matters because its boundary pruning (§7.1) is order-sensitive.

## 9. Auxiliary Handlers

### 9.1 Offset convention

`ChaosArrow` and `ChaosCount` relate a control cell's value to a region run
length or count. A clue-level `offset ∈ {0, 1}`, combined with the grid's value
offset, gives an effective shift between the *displayed* control value and the
*internal* length. The combined shift may be negative, so the control mask is
shifted into internal space before matching and the supported result shifted back,
using a left shift for one sign and a right shift for the other.

### 9.2 `ChaosArrow`

The control value equals the length of the region run starting at a shared cell
and extending along one arm (or, for multi-arm arrows, the total run length over
all arms with the shared start counted once).

```text
function enforceArrow(grid):
    for each candidate region label r of the start cell:
        for each arm:
            lengths[arm] ← run lengths along arm that label r can support
        if single arm:   support control values in lengths[0]
        else:            support control values in (Σ arm minima … Σ arm maxima)
    intersect the control cell with the supported lengths
    map supported lengths back onto each arm's region candidates
    if a prefix is now forced and its run cells are contiguous:
        UNION those cells into one shard            # feeds §5–§7
```

A length is supportable for label `r` only if every prefix cell can be `r` and
the cell just past the end is not already fixed to `r` (otherwise the run would be
longer). Cells already in the same shard as the start are forced to share `r`,
which gives a cheap lower bound on the run length.

`initialize` also clamps the control to feasible run lengths `[minLength,
maxLength]`. Length 0 never occurs (the start is in its own region). And since
regions have size ≥ 2, the start shares its region with an orthogonal neighbour;
if every orthogonal neighbour is the first step of an arm (e.g. an arrow pointing
in all four directions), that neighbour lies on an arm, so the run length is ≥ 2
and length 1 is removed. This is geometric, hence a one-time static prune (unlike
the count case there is no per-cell growth to track dynamically).

### 9.3 `ChaosCount`

The control value counts how many listed cells share the *first* listed cell's
region.

```text
function enforceCount(grid):
    for each candidate label r of the first cell:
        minCount ← cells forced to r ; maxCount ← cells that may be r
        intersect control with [minCount … maxCount]
        # dropping the lowest count tells us whether an optional cell may match r;
        # dropping the highest tells us whether one may fail to.
        propagate those bounds to each listed cell's region candidates
    if the first cell's region becomes fixed:
        UNION listed cells proven to share it into one shard
```

`initialize` clamps the control to the feasible count range `[minCount, maxCount]`.
The first listed cell is always in its own region, so `minCount ≥ 1` (count 0 is
removed). Regions have size ≥ 2 (rejected at build otherwise), so the first cell
also shares its region with an orthogonal neighbour; if every neighbour is itself a
listed cell that neighbour is counted, giving `minCount = 2`. Both bounds are
geometric, so this is a one-time static prune (count `c` sits at control bit
`c − 1 − offset`).

### 9.4 `ChaosFixedValueRegionExclusion`

Once a cell has both a fixed value `v` and a fixed region `r`, it acts like a
house cell for region `r`:

```text
function enforce(grid, sourceCell):
    if value or region of sourceCell is not fixed: return OK
    let v, r be those fixed value and region
    for every other cell c:
        if grid[c] = v and r ∈ regionMask(c):   remove r from regionMask(c)
        if regionMask(c) = {r} and v ∈ grid[c]: remove v from grid[c]
    return OK
```

No other cell of region `r` may take value `v`, and no cell elsewhere holding `v`
may join region `r`. This is the chaos analogue of ordinary house elimination,
specialised to fire only once both coordinates of the source cell are known.

All three auxiliary handlers attach to the shared shard union-find, so any
co-regional facts they discover become visible to `ChaosConstruction`'s
consistency and connectivity phases.
