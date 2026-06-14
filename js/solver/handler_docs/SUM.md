# Weighted Sums (Killer Cages)

This document specifies the constraint-propagation algorithm implemented by the
`Sum` handler in [sum_handler.js](../sum_handler.js). For the solver engine that
drives the handler, see [SOLVER_ENGINE.md](../SOLVER_ENGINE.md); for the handler
interface in general, see [README.md](../README.md).

The presentation is self-contained and aimed at a reader comfortable with bitmask
manipulation and basic interval reasoning. Each rule is given with an argument for
why its pruning is *sound* — why it never removes a candidate that takes part in
some valid solution. Most of the handler achieves **bounds consistency** (it
reasons about the smallest and largest reachable totals); the special cases —
small cell counts and pure killer cages — are filtered **exactly** (GAC). We are
explicit below about which is which.

## 1. Problem Statement

A `Sum` handler enforces one linear equation over the cells' values:

```text
Σ_i  coeff_i · value(cell_i)  =  sum
```

The coefficients are integers with `|coeff| ≤ 100`; cells with coefficient zero,
and duplicate cells (whose coefficients are combined), are removed at
construction. The familiar special cases are:

- a **killer cage** — every coefficient is `+1` and all cells are mutually
  exclusive (must be distinct), so the cage is "these `k` distinct values sum to
  `sum`";
- an **arithmetic sum / equality** — `makeEqual(A, B)` encodes `ΣA = ΣB` as a
  single constraint with `+1` coefficients on `A` and `−1` on `B`.

Two structural facts are exploited throughout:

- **Value offset.** If the grid's values are shifted by `valueOffset` (e.g. a
  0-based grid), the target is corrected once in `initialize`:
  `sum −= valueOffset · Σ coeff·|cells|`. Everything afterwards works in
  unshifted value space.
- **Exclusion groups.** Within the cells sharing one coefficient, the engine's
  mutual-exclusion data is used to find maximal sets of cells that must all take
  *distinct* values (`HandlerUtil.findExclusionGroups`). These groups let the
  bound reasoning use "distinct values" rather than "any values", which is much
  tighter (§5, §7).

The goal is sound pruning. Unlike a constraint such as AllDifferent, a general
weighted sum is not cheaply made GAC, so the handler is deliberately layered: a
fast bounds pass always runs, and exact filters run only where they are
affordable.

## 2. Representation

### 2.1 Coefficient groups and exclusion groups

Cells are bucketed by coefficient into **coefficient groups**, and each group is
partitioned into **exclusion groups** of pairwise-distinct cells. Groups are
sorted by `|coeff|` descending, because larger coefficients are the most
restrictive and let later loops stop early once the remaining slack exceeds what a
small coefficient can ever remove.

A per-cell `_exclusionGroupIds` array packs, for each cell, its coefficient-group
index, its exclusion-group index, and flag bits recording whether the coefficient
is `1`, `±1`, or negative — so the inner loops can branch on coefficient shape
with a single mask test. To keep the aggregate arithmetic of §2.2 inside 8-bit
lanes, no coefficient group exceeds **15 cells** (larger ones are split, keeping
exclusion groups intact).

### 2.2 `rangeInfo`: four aggregates in one addition

The central trick is a lookup table `rangeInfo[mask]` that packs a cell's range
statistics into one 32-bit word, laid out so that **summing the words across cells
sums each statistic independently**:

```text
rangeInfo[mask] = (isFixed << 24) | (fixedValue << 16) | (minValue << 8) | maxValue
```

- `maxValue`, `minValue` — the largest / smallest value still possible in the cell;
- `fixedValue` — the cell's value if it is fixed, else 0;
- `isFixed` — 1 if the cell is fixed, else 0.

Because each field is ≤ 8 bits and a group has ≤ 15 cells (15·16 = 240 < 256), the
lanes never overflow into one another. So a single running total over a group
yields, in one word:

```text
numFixed  = Σ rangeInfo >> 24
fixedSum  = Σ (rangeInfo >> 16) & 0xff
minSum    = Σ (rangeInfo >>  8) & 0xff      # sum of per-cell minima
maxSum    = Σ  rangeInfo        & 0xff      # sum of per-cell maxima
```

An empty cell mask maps to `numValues << 24`, so an unsatisfiable cell inflates
`numFixed` beyond the cell count and is caught as `numUnfixed ≤ 0` after summing.
For a negative coefficient the group's min and max swap roles before scaling.

### 2.3 Other precomputed tables

All tables live in `SumData`, memoized per `numValues` (so all sum handlers on one
grid share them):

- `sum[mask]` — the arithmetic sum of the values in `mask`.
- `reverse[mask]` — `mask` with each value `v` replaced by `numValues + 1 − v`
  (a reflection of value space). It turns "the complement that reaches a target"
  and "a negative coefficient" into ordinary lookups (§6).
- `killerCageSums[k][s]` — every value mask of exactly `k` distinct values summing
  to `s`. The basis of exact cage filtering (§7).
- `pairwiseSums`, `doubles` — for three-cell exact filtering (§6): the set of
  sums reachable by one value from each of two cells (distinct), and the set of
  doubled values `2v` used to add back the equal-value case when two cells may
  coincide.

## 3. Aggregate Bounds and Dispatch

Every call begins with one pass that accumulates the §2.2 aggregates, scaled by
each group's coefficient, then dispatches.

```text
function enforceConsistency(grid):
    minSum, maxSum, fixedSum, numUnfixed ← aggregate over all groups   # §2.2
    if sum < minSum or maxSum < sum: return CONTRADICTION              # unreachable
    if minSum = maxSum:              return OK     # every cell fixed; already exact
    if numUnfixed ≤ 0:               return CONTRADICTION   # some cell is empty

    if few unfixed cells:            enforce them exactly             # §6
    else:                            restrict value ranges by slack   # §4

    if a complement set is attached: enforce cage/complement          # §8; return
    if few unfixed cells:            return OK            # nothing more to add
    if pure cage:                    exact cage filtering              # §7
    else:                            uniqueness-aware tightening       # §5
    return OK
```

"Few unfixed cells" means at most 2 (or 3 when `numValues ≤ 9`, where the
`pairwiseSums` table exists) for unit-magnitude coefficients, or exactly 1 for
general coefficients — the cases §6 can solve outright.

The `sum < minSum or maxSum < sum` test is the basic feasibility check: the total
is achievable only if it lies in the reachable interval `[minSum, maxSum]`. The
`minSum = maxSum` early-out covers the case where every cell is fixed, so the
total is determined and (already-checked) correct.

## 4. Bounds Consistency by Degrees of Freedom

This is the workhorse, run whenever the cell count is too large for exact methods.

Define the two **slacks**:

```text
sumMinusMin = sum − minSum     # how far the total may rise above its minimum
maxMinusSum = maxSum − sum     # how far it may fall below its maximum
```

Each unfixed cell may raise its own value above its minimum, but the *combined*
rise of all cells is exactly `sumMinusMin`. Hence no single cell may exceed
`minValue(cell) + sumMinusMin`: if it did, the total would overshoot `sum` even
with every other cell at its minimum. Symmetrically no cell may fall below
`maxValue(cell) − maxMinusSum`.

```text
function restrictValueRange(grid, cells, coeff, sumMinusMin, maxMinusSum):
    if coeff ≠ 1: divide both slacks by |coeff| (floor); swap them if coeff < 0
    for each unfixed cell with mask v:
        range ← maxValue(v) − minValue(v)
        if sumMinusMin < range:  remove values > minValue(v) + sumMinusMin
        if maxMinusSum < range:  remove values < maxValue(v) − maxMinusSum
```

Both removals are implemented as single bitmask shifts: shifting the mask up by
`sumMinusMin` places the cell's minimum at the cutoff bit, and a mask of all lower
bits keeps exactly the admissible values (the high-side cut is the mirror image).
For a coefficient `c`, a change of one in the cell's *value* moves the total by
`c`, so the admissible value-slack is `slack / |c|` rounded down; a negative
coefficient flips which end is the minimum, hence the swap.

**Soundness.** The cut keeps every value that could appear in some assignment
reaching `sum` (each kept value can be completed by putting the other cells inside
their own ranges to make up the difference) and removes only values that violate
the interval bound for *every* completion. This achieves bounds consistency on the
equation. The early `break` in the dispatcher — stop once both slacks exceed
`numValues · |coeff|` — is valid because past that point the cell's whole range
fits within the slack and nothing can be removed; the descending coefficient order
guarantees all later groups also clear the bound.

## 5. Uniqueness-Aware Tightening

Plain bounds consistency treats the cells of an exclusion group as independent,
but they must take *distinct* values, which tightens both ends. The minimum sum of
a `t`-cell exclusion group is not `t · (group minimum)` but the sum of the `t`
smallest *distinct* values its cells can jointly take, and likewise for the
maximum.

```text
function restrictCellsWithCoefficients(grid, sum, coeffGroups):
    for each exclusion group:
        seenMin ← the t smallest distinct values the group can realise
        seenMax ← the t largest  distinct values the group can realise
        accumulate coeff·sum(seenMin) into strictMin, coeff·sum(seenMax) into strictMax
    minDof ← sum − strictMin;  maxDof ← strictMax − sum
    if minDof < 0 or maxDof < 0: return CONTRADICTION
    for each exclusion group (largest |coeff| first, stopping once slack is loose):
        build a value mask from seenMin grown up by minDof and seenMax grown down by maxDof
        intersect every cell of the group with that mask
```

`seenMin` is built greedily: start from the smallest candidate, and each further
cell contributes the smallest still-unused value at or above its own minimum;
`seenMax` is the mirror image (built in reversed value space). If either runs past
the value range, the group cannot supply `t` distinct values and the constraint
fails on the spot.

The per-cell mask uses the now-tighter group degrees of freedom `minDof`/`maxDof`
(scaled by the coefficient as in §4) to keep only the values that fit between the
group's distinct-aware minimum and maximum. **Soundness** is the same slack
argument as §4, applied to the group's distinct-value envelope, which is a valid
(tighter) bound because every real assignment of the group uses distinct values.

## 6. Exact Small Cases

When only one, two, or three cells remain unfixed, the handler solves the residual
equation exactly against the *target* `targetSum = sum − fixedSum`.

- **One cell.** The cell must equal `targetSum / coeff` (rejecting a non-integer
  quotient or a non-positive result); intersect its mask with that single value.
- **Two cells** (`x + y = targetSum`). A value `v` survives in the first cell iff
  `targetSum − v` survives in the second. The whole filter is one `reverse`-table
  lookup: `reverse` reflects value space, so a shift selects exactly the
  complementary values that pair to `targetSum`. If the two cells are in the same
  exclusion group, the value `targetSum/2` (which would force `x = y`) is also
  removed.
- **Three cells.** For each cell, the other two must supply `targetSum − value`.
  The set of sums two cells can make is read from `pairwiseSums`; the third cell is
  then intersected with the values that complete each such sum. When two of the
  cells may coincide (different exclusion groups), `doubles` adds back the
  equal-value sums that `pairwiseSums` (which assumes distinctness) omits.

**Negative coefficients** are handled uniformly by reflection: a cell with a
`−1` coefficient has its mask replaced by `reverse[mask]` and the target raised by
`numValues + 1`. Since `−v + (numValues+1) = (numValues+1−v)`, the reflected cell
behaves exactly like a positive one, and the cells are un-reflected afterwards.
These cases are GAC for the residual equation: every kept value has an explicit
completing assignment, and every removed value has none.

## 7. Exact Killer-Cage Filtering

A pure cage — unit coefficients, a single exclusion group of distinct cells — is
filtered exactly by enumerating value combinations.

```text
function restrictCellsSingleExclusionGroup(grid, sum, cells):
    fixedValues, allValues ← OR of fixed / of all candidates
    if popcount(allValues) < numCells:        return CONTRADICTION   # too few values
    if allValues = fixedValues:               return fixedSum = sum  # fully fixed
    target ← sum − sum(fixedValues)
    possibilities ← 0;  required ← unfixedValues
    for each option in killerCageSums[numUnfixed][target]:
        if option ⊆ unfixedValues:            # a feasible distinct combination
            possibilities |= option
            required      &= option            # values common to all options
    if possibilities = 0:                      return CONTRADICTION
    remove unfixedValues \ possibilities from every cell        # GAC pruning
    expose hidden singles among required values                 # value in exactly one cell
    enforce required-value exclusions for the rest
```

`killerCageSums[k][s]` lists every set of `k` distinct values summing to `s`, so
`possibilities` is the union of all combinations the cage can still take. Removing
the values outside it is GAC: a value survives iff it belongs to some valid
combination. `required` (the intersection of all feasible combinations) holds
values that must appear; a required value with a single candidate cell is a hidden
single and is placed, and the others drive ordinary house-style eliminations
elsewhere.

## 8. Complement Optimization

A cage that exactly fills the *remaining* cells of a house has a dual: the rest of
the house (its **complement**) must hold the house's other values and sum to the
house total minus `sum`. `setComplementCells` attaches that complement (only for
unit coefficients), and the two are filtered together.

```text
function enforceCombinationsWithComplement(grid):
    values0 ← OR of cage candidates;  values1 ← OR of complement candidates
    for each option in killerCageSums[cageSize][sum]:
        if option ⊆ values0 and the complement (within the house's value space)
                ⊆ values1:                       # both sides can realise it
            possibilities0 |= option
            possibilities1 |= complement(option)
    remove values0 \ possibilities0 from the cage cells
    remove values1 \ possibilities1 from the complement cells
```

The check is done branchlessly over the precomputed combinations. Reasoning about
both halves at once prunes more than the cage alone, because a combination is
viable only if its *complement* can also be placed in the remaining house cells.

## 9. Implementation Notes

- **Shared, memoized tables.** All lookup tables are in `SumData`, fetched by
  `SumData.get(numValues)` and memoized, so every sum handler on a grid shares one
  copy. Scratch buffers (`_seenMinMaxs`, the small fixed-size cell/exclusion
  buffers for §6) are static and grown as needed.
- **15-cell groups.** Splitting oversized coefficient groups (keeping exclusion
  groups together) is what keeps the §2.2 lane arithmetic valid; it is a
  representation detail, not a semantic one.
- **Coefficient ordering and early exit.** Sorting groups by `|coeff|` descending
  lets both §4 and §5 stop as soon as the remaining slack provably cannot remove
  anything from any smaller-coefficient group.
- **Layering.** The cheap aggregate bounds (§3) run every call and resolve the
  common cases; the exact filters (§6–§8) run only when the structure makes them
  affordable, so the handler stays fast on large cages while still reaching GAC
  where it matters.

```
