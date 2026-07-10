# Connected Values

This document specifies the constraint-propagation algorithm implemented by the
`ConnectedValues` handler in [connected_handler.js](../connected_handler.js). For
the solver engine that drives the handler, see
[SOLVER_ENGINE.md](../SOLVER_ENGINE.md); for the handler interface in general,
see [README.md](../README.md).

The presentation is self-contained and aimed at a reader comfortable with basic
graph traversal and bitmask manipulation. Each rule comes with an argument for
why its pruning is *sound* — why it never removes a candidate that takes part in
some valid solution. The handler is **not** a complete propagator (deciding all
consequences of connectivity is hard — it would subsume counting Steiner-like
obstructions), but every check and every forced move below is exact reasoning,
and the two rules it does apply run in linear time per pass.

## 1. Problem Statement

`ConnectedValues` takes a list of cells and a set of grid values `V`. The
constraint is:

```text
the cells whose value lies in V form a single non-empty
orthogonally-connected region within the constraint's cells.
```

A handler may hold several value sets over the same cells, each independently
forming its own region (§5); everything below describes one set's pass.

The cells must be a whole layer in order: the grid itself, or a var-cell
group with one cell per grid cell. Grid adjacency defines the connectivity
graph either way, and position `i`'s search cell is simply `cellOffset + i`,
so the handler stores one offset instead of a cell mapping.

`V` is held as a candidate bitmask `valueMask`, so per-cell classification is
two bitwise tests against the cell's current candidate mask `D`:

```text
D ∧ valueMask = ∅              EXCLUDED   (cannot be in the region)
∅ ≠ D ∧ valueMask ≠ D          UNDECIDED  (may be in or out)
∅ ≠ D ∧ valueMask = D          DECIDED    (certainly in the region)
```

"Possible" below means UNDECIDED or DECIDED. The **possible graph** is the
subgraph induced by the possible cells; the **decided subgraph** is the one
induced by the decided cells, and its connected components are called **blobs**.

## 2. Key Structure

### 2.1 The monotonicity lemma

Everything rests on one property of the search: candidate masks only ever
narrow along a search branch.

> **Lemma.** As search progresses down a branch, cells can move
> UNDECIDED → EXCLUDED and UNDECIDED → DECIDED, but never leave EXCLUDED or
> DECIDED. Hence the possible graph only loses vertices, so its connected
> components only ever split, never merge.

Two consequences drive the whole handler:

- **Permanent splits.** If two decided cells lie in different components of the
  possible graph *today*, they lie in different components in every completion
  of this branch — the constraint is already violated.
- **Dead components.** Once any decided cell exists, the (single) final region
  must lie inside that cell's possible component. A possible component with no
  decided cell can never host the region, so *every* cell in it can be excluded.

### 2.2 The zero-decided early-out

With no decided cell neither consequence applies: any non-empty possible
component could still host the region, so nothing can be checked or pruned
beyond non-emptiness. The pass returns immediately:

```text
if numDecided = 0: return numPossible ≠ 0
```

This skips the traversal entirely for the bulk of early-search wakes, when the
constraint has not yet committed to any region cell.

### 2.3 Top-level shape

```text
function enforceConsistency(grid):
    classify every cell into states[]; count numPossible, numDecided   # §1
    if numDecided = 0: return numPossible ≠ 0                          # §2.2

    BFS the possible graph from one decided seed                       # §3
    if some decided cell is unvisited: return CONFLICT
    exclude every unvisited possible cell
    if numPossible = numDecided: return OK        # region complete
    if numDecided = 1: return OK                  # a single blob never forces

    loop:                                         # §4.3
        forced ← forceDoors()                     # §4
        if forced = 0: return OK
        numDecided ← numDecided + forced
        if numPossible = numDecided: return OK
```

## 3. The Single-Traversal Check

All decided cells must end up in one region, so one BFS over the possible
graph, seeded at *any* decided cell, answers everything at once:

- **An unvisited decided cell** is in a different possible component from the
  seed — a permanent split (§2.1), so the pass fails.
- **An unvisited possible cell** (once the decided check has passed) is in a
  component containing no decided cell — a dead component (§2.1), so
  `valueMask` is stripped from it. Such a cell is necessarily UNDECIDED, so the
  strip cannot empty its domain.
- **Everything visited and fully decided** (`numPossible = numDecided`) means
  the region is complete and connected: a leaf accept.

The BFS counts visited possible and visited decided cells as it marks, so both
tests are counter comparisons; the prune loop only runs when the possible count
fell short, and stops after finding exactly the shortfall. Since nothing new
can be marked once every possible cell is visited, the scan also exits early at
that point — the common fully-connected case skips the whole tail of the queue.

## 4. Door Forcing

The check in §3 only *rejects*; door forcing is the handler's one *deduction*
about undecided cells beyond dead components.

### 4.1 The rule

Call an UNDECIDED neighbour of a blob one of that blob's **doors**.

> **Rule.** If at least two blobs exist, and a blob has exactly one door, that
> door is forced into the region (its candidates are narrowed to `valueMask`).

*Soundness.* In every completion all blobs join into one region, so a blob must
connect to the others through at least one cell outside itself. Its neighbours
are decided (same blob, by maximality of components), excluded (never in the
region), or doors — so every path out passes through a door. With a single
door, that cell is in the region in every completion. ∎

The two-blob requirement is essential: the handler has no size or completion
information, so a lone blob might already *be* the finished region, and its
door need not be taken. A second blob is what proves the region is incomplete.

A blob with *no* door is impossible at this point: §3 established that all
decided cells share one possible component (and §4.3 shows forcing preserves
this), so a path towards any other blob exists inside the possible graph, and
its first off-blob cell is a door.

### 4.2 The snapshot requirement

One round of forcing traverses every blob, records each blob's door count (as
`door` / `MULTI_DOOR`), and only *then* forces the single-door blobs' doors.
The deferral is required for soundness, not just because the blob count must be
known first:

> Forcing a door mid-scan merges its blob with neighbouring blobs. A
> later-scanned blob adjacent to the forced cell would see it as decided rather
> than as a door, and could then count a single door while the merged region
> has other exits through the forced cell — forcing that door is unsound.

Concretely: blob `{A}` has sole door `d`; `d` is also adjacent to blob `{B}`
with doors `{d, e}`. Force `d` during the scan and `{B}`'s traversal counts
only `e` — but the true merged blob `{A, d, B}` may leave through `d`'s other
undecided neighbours, so `e` is not forced. All door sets must therefore come
from the pre-forcing snapshot. Forcing them together afterwards is sound
because each single-door inference was true of that snapshot, and true
inferences stay true (§2.1). Two blobs sharing the same single door force it
once; the second write is skipped.

### 4.3 Forcing to a fixed point, without re-traversal

Forced doors create new decided cells, which can leave another blob with a
single door, so forcing repeats until a round forces nothing. The main check
of §3 does **not** need to rerun between rounds:

> **Lemma.** Door forcing leaves the possible graph unchanged: a forced door's
> mask is narrowed to `valueMask`, so the cell stays possible, and no other
> cell's mask is touched.

After §3's prune, the possible graph is exactly one component containing every
decided cell. Since forcing preserves the graph, that remains true after every
round: a re-traversal could neither fail nor prune. Only the blob structure
evolves (blobs merge and grow), so each round costs one traversal of the
decided subgraph, not of the whole possible graph. The loop terminates because
each round decides at least one more cell.

## 5. Multiple Value Sets

A handler can enforce several **pairwise-disjoint single-value** sets over
the same cell list — each set's holders form their own single region. (A
multi-value set is only supported alone: there is no use case for merging
one, and the restriction keeps "decided into a set" an exact candidate-mask
match.) The optimizer merges `ConnectedValues` handlers that share a cell
list into one such multi-set handler (yin-yang is the canonical case: both
shades of one overlay are connected). Merging pays in two distinct ways: the
disjoint sets feed each other through the grid within one wake (excluding a
cell from one set can decide it for another), and — the substantive part —
the pair admits *joint* deductions, the crossing and border rules, that no
per-set reasoning can make.

### 5.1 Three handlers, not one phase loop

`ConnectedValues` enforces only connectivity: one pass over its sets per
wake (§2–§4), each set classified fresh from the grid into the shared scratch
states array (§6). Because the sets are disjoint they feed each other through
the grid itself — an exclusion written by one set's pass is seen by the
next's classification exactly as a freshly woken handler would see it — so a
single wake needs no more than one pass over the sets and no coherence
bookkeeping. (An earlier design classified all sets in one shared pass and
kept each set's states, `owners`, and counters coherent under every
elimination; that was soundness-critical — a cell decided into set `t` by a
sibling's prune but left marked undecided lets `t`'s prune delete `t`'s whole
region, whose component then has no *known* decided cell — and fresh per-set
classification, measured deduction-identical, removes both the per-set arrays
and that hazard.)

The two joint deductions are **their own handlers**, added by the optimizer
when it merges a layer: `ConnectedCrossing` (§5.2), one per 2×2 block, and
`ConnectedBorder` (§5.3), one over the perimeter. Each reads owner tokens
straight from the grid and holds no scratch. The point of the split is
wake-up granularity: the propagation queue watches a handler's cells and
wakes it only when one changes, so a 2×2-block handler re-checks its
checkerboard exactly when one of its four corners moves — no grid-wide sweep,
and the deduction fires the instant *any* handler decides a corner rather
than waiting for the connectivity handler's next wake. This replaced a single
whole-grid crossing sweep run as a phase of `ConnectedValues`; measured on
the shading benchmarks it left the controls identical and cut reciprocals
from 454 to 305 backtracks (earlier propagation), at neutral wall. The
handlers are non-essential: they only prune what connectivity already
forbids, so correctness never depends on them.

### 5.2 The crossing rule

> **Theorem.** Two disjoint orthogonally-connected regions cannot occupy the
> two diagonals of a 2×2 block (a "checkerboard").

*Proof sketch.* Suppose cells NW, SE belong to connected region `A` and NE,
SW to disjoint region `B`. `A` contains an orthogonal path NW→SE and `B` one
NE→SW. The four endpoints interleave around the block's centre, so the two
paths must cross geometrically; axis-aligned unit segments between cell
centres can only cross at a cell centre, so the paths share a cell — which
would lie in both regions, contradicting disjointness. ∎

Neither set alone can see this: each region separately is perfectly
consistent with a checkerboard. The contrapositive gives the pruning rule:

```text
if a 2x2 block has one diagonal decided into set X and one cell of the
other diagonal decided into set Y ≠ X, the remaining cell cannot be in Y.
```

Stripping `Y`'s values from that cell is sound (any completion putting it in
`Y` completes the impossible checkerboard); if the cell was already decided
into `Y`, the strip empties it and the handler fails — the four-cell
checkerboard case. Each 2×2 block is its own `ConnectedCrossing` handler over
its four cells `[nw, ne, sw, se]` (§5.1): it reads the four owner tokens and
applies the rule once. Because the sets are single-value, a decided cell's
candidate mask *is* its owner token (a single bit inside the union of the set
masks) — and directly the mask to strip from the completing cell, so the
handler needs no set indices and no storage. It re-runs only when the
propagation queue reports one of its four corners changed, and each pass
makes at most one strip (the rule needs three decided corners, leaving one
target); a further deduction in the same block, if any, arrives on the wake
its own strip triggers.

The theorem needs only disjointness and orthogonal connectivity — not
complementarity, not 2-value domains, and not a hole-free cell set (the
regions' paths live wherever the regions do). In practice it is the classic
"emergent" yin-yang deduction, and it is measured to cut completed proofs
substantially on yin-yang-style puzzles (e.g. −75% and −46% backtracks on
the two shading benchmarks) while leaving puzzles whose encodings already
imply it (e.g. loop puzzles with no-diagonal-touch rules) untouched.

### 5.3 The border rule

The same path-crossing argument applies at grid scale along the perimeter:

> **Theorem.** Two disjoint orthogonally-connected regions cannot
> *interleave* on the grid perimeter — there are no four perimeter cells in
> cyclic order `x₁, y₁, x₂, y₂` with `x₁, x₂ ∈ X` and `y₁, y₂ ∈ Y`.

*Proof sketch.* `X` contains an orthogonal path `x₁→x₂` and `Y` one
`y₁→y₂`. Extending each endpoint from its cell centre to the grid boundary
(within its own cell) gives two curves inside the grid rectangle whose
endpoints interleave around its boundary, so the curves must cross; as in
§5.2, axis-aligned centre-to-centre segments can only cross at a cell
centre, giving a shared cell. ∎

The 2×2 rule cannot see this — the four cells can be arbitrarily far
apart. This is its own `ConnectedBorder` handler (§5.1), added only for
exactly two sets (the yin-yang case; with more sets, legal nestings like
`X..Y..Z..X` need per-pair analysis), whose cells are the perimeter in cyclic
order — so the propagation queue wakes it exactly when a border cell changes.
Non-interleaving means each set's decided border cells form at most one
cyclic arc. Enforcement is a search pass then an enforcement pass over the
perimeter (owner tokens re-derived from the grid as in §5.2):

- **Search:** count the cyclic transitions between consecutive decided
  cells' sets. Zero means at most one set on the border — nothing to do;
  more than two is an interleave — fail. The same walk ORs each gap's
  candidates and tests them against the flanking set, so it also decides
  exactly whether there is anything to strip.
- **Enforce:** walk the cycle from the first decided cell; an undecided
  cell in a gap whose two flanking decided cells match set `X` cannot
  belong to the other set — the two arcs between it and any of the other
  set's cells each contain a flanking `X`. (The other set is decided
  somewhere on the border since transitions ≥ 2; a set absent from the
  border could still legitimately reach it in the gap, and is not
  stripped.)

One enforcement lap reaches the fixed point: a strip can only decide a
cell into the set already flanking it, which never changes the arc
structure. It is the global yin-yang border deduction, and it dominates the
local one where it applies: measured on the two shading benchmarks it took
completed proofs from 62 to 1 and from 6,578 to 454 backtracks on top of
§5.2, again leaving no-diagonal-touch loop encodings and single-set puzzles
untouched.

## 6. Implementation Notes

- **Position-indexed neighbour table, memoized by layer shape.** The layer's
  adjacency depends only on `(numCells, numCols)` — the cell count and the
  layer's own column count (a var-cell group's `columns`, or the grid's), which
  need not match the grid — so `layerNeighborTable` builds it once per shape and
  shares it across handlers. Neighbours are positions `0..numCells-1`, and a
  position's search cell is `cellOffset + position`, with no cell-array
  indirection in the hot loops. Missing neighbours store the sentinel
  `numCells`; entry `numCells` of the states array is permanently EXCLUDED, so
  the traversals need no edge checks — the sentinel classifies as "skip" like
  any excluded cell.
- **The states byte is a fusion, and the fusion is load-bearing.** Every
  neighbour test in every traversal asks two questions — already visited? and
  possible/decided? — and the states byte answers both with a single load.
  That fusion, not classification storage, is the array's job: classification
  itself is trivially re-derivable from the grid (`value ∧ valueMask` = may be
  in the region, `value ∧ ¬valueMask = 0` = certainly is, for any size of
  value set), but the grid cannot carry visited marks, so any design that
  reads classification from the grid *inside the traversals* needs a second
  marks structure and pays a second load on the handler's hottest lines.
  (Re-deriving it once per set pass, as §5.1 does, is the cheap use; the
  in-loop read is the expensive one.) This was measured, not assumed:
  grid-direct variants (separate marks as a byte array or bitset, with or
  without direct grid indexing) and a bitboard rewrite all lost 4–10% of
  solve time on door-forcing-heavy puzzles, and caching classification for
  the forcing rounds alone did not recover it.
- **The byte layout.** The state codes are chosen as bits — bit 0 "may be in
  the region", bit 1 "certainly is" (EXCLUDED = 0, UNDECIDED = 1, DECIDED = 3)
  — and traversal marks fold in as a VISITED bit (4). The states array is
  rebuilt by classification each pass, so marks never need resetting. The BFS
  inner test is a single load and mask-compare: unvisited-possible is
  `state ∧ 5 = 1`, and `state ≫ 1` counts the decided cells among them.
- **Mark polarity in forcing rounds.** After §3 every surviving cell has
  VISITED set, and every blob traversal visits every decided cell, so forcing
  rounds reuse the byte by alternating which polarity of the decided cells'
  VISITED bit means "unvisited" — round 1 marks by clearing it, round 2 by
  setting it, and so on. Undecided cells stay at `UNDECIDED | VISITED`
  throughout; freshly forced doors are stamped with the finished round's
  visited polarity so the whole decided set flips together. This is what
  extends the one-load fusion into the forcing rounds: no per-round mark
  resets and no second marks structure.
- **One queue, doors banked in seed slots.** Blob `b`'s traversal queue starts
  at `queue[numBlobs]`, and when the blob completes, its door value overwrites
  its own dead seed slot: the banked doors form a prefix that later traversals
  start past, so doors and the live queue are disjoint by construction. The
  traversals stay in bounds because banked blobs hold one slot each and every
  blob has at least one cell, so `numBlobs + size(blob) ≤ numDecided ≤
  numCells`.
- **Door sentinels.** `NO_CELL` (0xffff, "no door seen") and `MULTI_DOOR`
  (0xfffe, "several doors") both sort above any real cell-list index, so
  "nothing to force" is the single comparison `door ≥ MULTI_DOOR`.
- **Blob scan order is load-bearing.** The blob scan starts at cell-list index
  0 every round. A forced door can sit below the first classified decided
  cell and seed a blob in a later round; changing the scan start would reorder
  blob enumeration and hence the order of propagation-queue events, perturbing
  the search.
- **Stateless across passes.** The handler recomputes everything from the grid
  on every wake and keeps no cross-pass or per-branch state, which is what
  makes it safe to nest under composite handlers (e.g. `Or`). Incremental
  connectivity was considered and rejected: per-branch state would be O(cells)
  and is copied per search node, which costs the same order as the single BFS
  it would save.
