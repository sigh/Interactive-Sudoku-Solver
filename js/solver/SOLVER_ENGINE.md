# Solver Engine

This document describes the solver engine architecture in detail. For a
higher-level overview of all solver files, see [README.md](README.md).

## Overview

The solver is a constraint-satisfaction problem (CSP) engine. It combines
**backtracking search** with **constraint propagation**: at each step it picks
a cell, tries a candidate value, and propagates the consequences through all
affected constraints until either a contradiction is found (triggering
backtracking) or a fixed point is reached (and the next cell is picked).

All solving happens inside a Web Worker to avoid blocking the UI.

## Entry Point

`SudokuBuilder.build(constraint, debugOptions)` (in
[sudoku_builder.js](sudoku_builder.js)) is the entry point. It maps each
constraint type to one or more handler instances and creates a `SudokuSolver`.

`SudokuSolver` (in [engine.js](engine.js)) is the public API. It wraps
`InternalSolver`, which contains the actual search loop.

## Initialization

The `SudokuSolver` constructor runs the following setup sequence before any
solving occurs:

1. **Sort handlers** deterministically.
2. **Build `CellExclusions`** — tracks which cell pairs must have distinct
   values, derived from handlers that report `exclusionCells()`.
3. **Run the optimizer** — `SudokuConstraintOptimizer.optimize()` (in
   [optimizer.js](optimizer.js)) analyzes the handler set and adds derived
   handlers that are logically implied by the existing ones. This doesn't
   change the solution set but makes propagation more effective.
4. **Add singleton value-exclusion handlers** — each search cell gets the
    fixed-value exclusion propagation used when a cell becomes known.
5. **Initialize all handlers** — each handler's `initialize()` method can
   modify the initial candidate bitmasks (e.g., a Given handler removes all
   but one candidate) and allocate extra state slots that will be
   saved/restored during backtracking.
6. **Run `postInitialize()` on all handlers** — handlers can inspect the full
   initialized state, but must not mutate it.
7. **Set up propagation, candidate selection, priorities, and the search
   stack** — these structures are reused across runs of the same solver.

## Cell Candidates as Bitmasks

Each cell's possible values are stored as a 16-bit integer where each bit
represents one value. By default (values 1–9), bit 0 is value 1, bit 1 is
value 2, and so on. In general, displayed value `v` maps to
`1 << (v - valueOffset - 1)`. For 1-based values, bit 0 is displayed value 1.
This enables fast set operations: AND to intersect, OR to union, popcount to
count remaining candidates.

`LookupTables` (in [lookup_tables.js](lookup_tables.js)) precomputes derived
values for every possible bitmask: `sum[mask]` gives the sum of values in a
bitmask, `rangeInfo[mask]` gives min/max/isFixed for a bitmask, and
`reverse[mask]` reflects values (e.g., 1↔9, 2↔8 in a 9-value grid).
Tables are created lazily per grid size via `LookupTables.get(numValues)`.

## Grid State

The full grid state is a `Uint16Array`. Indices 0 through
`numSearchCells - 1` hold cell candidate bitmasks; indices beyond that hold
handler-allocated state (see State Model below). All stack
frames share a single `ArrayBuffer`; each frame has a `Uint16Array` view into
its portion. When the engine recurses, it removes the tried value from the
branching cell in the current frame (so that value won't be retried on
backtrack), then copies the state into the next frame. When it backtracks, it
decrements the stack depth — the parent frame already has the tried value
removed, and all other cells are unchanged.

## Handlers

Every constraint is enforced by a handler — a subclass of
`SudokuConstraintHandler` (in [handlers.js](handlers.js)). The core
propagation loop is type-agnostic — it interacts with handlers through
this interface:

- **`enforceConsistency(grid, handlerAccumulator)`** — inspects the
  bitmasks for its cells, removes invalid candidates, and returns `false`
  if a contradiction is detected. When it changes a cell, it must call
  `handlerAccumulator.addForCell(cell)` so other handlers watching that cell
  are queued. The accumulator automatically skips re-queuing the
  currently-active handler for its own changes.
- **`initialize(initialGridCells, cellExclusions, shape, stateAllocator)`** —
  one-time setup before search begins. Can modify initial candidates and
  allocate per-branch state (see below). All handlers share the same mutable
  `initialGridCells` array, so changes from earlier handlers are visible to
  later ones. Return `false` if the constraint is provably impossible.
- **`cells`** — the cell indices this handler constrains. Passed to `super()`
  in the constructor. Controls when the engine queues the handler (it is
  queued whenever any of these cells change), but does not restrict what the
  handler can access — handlers can read and write any index in `grid`.
  Passing no cells means the handler is never triggered by propagation; this
  is used for information-only or initialize-only handlers (e.g.,
  `GivenCandidates`, `BoxInfo`).
- **`exclusionCells()`** — cells that must have distinct values. Used to build
  `CellExclusions` and by the optimizer.
- **`postInitialize(readonlyGridState)`** — optional hook after all handlers
  initialize. Do not write to `readonlyGridState`.
- **`candidateFinders(grid, shape)`** — optional hook for handlers that can
  nominate branch choices that are better than a single cell/value guess.
- **`idStr`** — stable identity used by `HandlerSet` to deduplicate handlers.
  Equivalent handlers should share an ID; unrelated handlers must not collide.
- **`essential`** — defaults to `true`. Optimizer-added performance handlers
  can be marked non-essential and skipped in some fixed-value propagation.

Handler classes are defined across [handlers.js](handlers.js),
[sum_handler.js](sum_handler.js), and [nfa_handler.js](nfa_handler.js).

### State Model

Fields on `this` are constant across all search branches — set during
construction or `initialize`, unchanged during search. If a handler needs
per-branch state (state that should be saved and restored during
backtracking), it allocates slots via `stateAllocator.allocate(state)`
during `initialize`. This returns an offset into the grid state array.
During `enforceConsistency`, the allocated state is accessed via
`grid[offset]` — it is saved and restored automatically as the engine
pushes and pops stack frames.

### Writing `enforceConsistency`

`enforceConsistency` is the hot loop of the solver — it runs millions of
times. Follow these rules:

- **No allocations.** Never create arrays, objects, or closures inside
  `enforceConsistency`. Pre-allocate all scratch buffers as `static` class
  fields (shared across instances) or instance fields set in
  constructor/`initialize`. Use typed arrays (`Uint16Array`, etc.).
- **Only call `addForCell` when the cell actually changed.** Gate every call.
  Unconditional `addForCell` causes cascading redundant handler invocations.
- **Use bitwise assignment to update and detect contradiction in one step.**
  `if (!(grid[c] &= mask)) return false;` for AND-restriction.
  `if (!(grid[c] ^= value)) return false;` for removing a known single value
  (only when `grid[c] & value` is true).
- **Exit early when already satisfied.** Check for trivially-met conditions
  before doing expensive work (e.g., all values fixed, sum already in range).
- **Use `LookupTables`** for anything derivable from a bitmask (sum, min/max,
  reverse). Index them directly with the bitmask — no loops needed.

### Reference Implementations

- `House` — general reference for a propagating handler with `exclusionCells`.
- `BinaryConstraint` — simplest non-trivial handler that reads and writes
  only its own cells.
- `GivenCandidates` — initialize-only handler (no `enforceConsistency`).

## Constraint Propagation

`HandlerAccumulator` (in [engine.js](engine.js)) is a linked-list queue of
handlers that need to run. When a cell's candidates change, the accumulator
enqueues all handlers that touch that cell. The propagation loop drains the
queue until it is empty (fixed point) or a handler returns `false`
(contradiction):

```
while queue is not empty:
    take next handler from queue
    call handler.enforceConsistency(gridState, accumulator)
    if contradiction: return false
return true
```

The search loop seeds the accumulator via `addForFixedCell`, which pushes
the cell's singleton handler (e.g., `UniqueValueExclusion`) to the **front**
of the queue, then enqueues aux and ordinary handlers to the back. During
propagation itself, handlers call `addForCell`, which only enqueues ordinary
handlers — singleton and aux handlers are not triggered by mid-propagation
changes.

## Search Loop

`InternalSolver` uses an explicit stack rather than recursion. Each stack frame
records:

- **`cellDepth`** — how many cells have been fixed so far.
- **`gridState`** — the `Uint16Array` view for this depth.
- **`lastContradictionCell`** — which cell caused a backtrack from a deeper
  frame (used as a hint by the candidate selector).
- **`newNode`** — whether this is a fresh node or a retry after backtracking.

The loop:

1. `CandidateSelector.selectNextCandidate()` picks the next cell and value
   to try. Cells are ranked by conflict score divided by candidate count;
   when all scores are zero it falls back to minimum remaining values (MRV).
2. The value is set in the grid, and the `HandlerAccumulator` is seeded with
   all handlers touching that cell.
3. Constraint propagation runs to a fixed point.
4. If a contradiction is found, `ConflictScores` records it (for future
   ordering), and the loop continues at the same stack depth to try the next
   value. If no values remain, the stack depth is decremented (backtrack).
5. If all cells are solved, a solution is yielded.
6. Otherwise the grid state is copied to the next frame and the stack depth
   is incremented (recurse).

## Conflict Scores

`ConflictScores` (in [candidate_selector.js](candidate_selector.js)) is a
history heuristic. When a cell/value assignment leads to a contradiction, its
score is incremented. The candidate selector ranks cells by
`conflictScore / candidateCount`, so cells with high scores relative to their
size are explored first. When all scores are zero (e.g., early in the solve),
selection falls back to minimum remaining values (MRV).

## Optimization

`SudokuConstraintOptimizer` (in [optimizer.js](optimizer.js)) runs during
initialization. It inspects the existing handlers and adds derived handlers
that tighten propagation. Examples include:

- Adding an optimized `House` handler alongside `AllDifferent` handlers that
  cover a full row/column/box.
- Adding innie/outie sum handlers when a cage partially overlaps a house.
- Merging adjacent sum handlers into combined sums.
- Sharing exclusion sets between cells linked by equality constraints
  (if A=B and A≠C, then B≠C).

Derived handlers are marked as non-essential and can be disabled for debugging.

## Public API

`SudokuSolver` exposes these methods (called from
[solver_worker.js](../solver_worker.js) in response to worker messages):

| Method | Purpose |
|--------|---------|
| `countSolutions(limit)` | Count solutions up to `limit`. |
| `estimatedCountSolutions(maxSamples)` | Estimate solution count using random sampling. If `maxSamples` is omitted, sampling continues until the caller aborts. |
| `nthSolution(n)` | Return the nth solution grid, or `null`. |
| `nthStep(n, stepGuides)` | Return the state at the nth branching point (for step-by-step UI). |
| `solveAllPossibilities(threshold)` | Find all candidate values that appear in at least `threshold` solutions. |
| `validateLayout()` | Check whether the layout constraints alone are solvable. |
| `state()` | Return current counters, elapsed time, and whether solving is done. |

Progress is reported via a callback set with `setProgressCallback(callback, logFrequency)`.
The callback fires every `2^logFrequency` iterations; the caller reads
`state()` to get current counters.

## Key Classes by File

| Class | File | Role |
|-------|------|------|
| `SudokuSolver` | [engine.js](engine.js) | Public API; wraps `InternalSolver`. |
| `InternalSolver` | [engine.js](engine.js) | Search loop, propagation, backtracking. |
| `HandlerAccumulator` | [engine.js](engine.js) | Linked-list queue for constraint propagation. |
| `HandlerSet` | [engine.js](engine.js) | Maps cells to their handlers; manages add/remove/replace. |
| `CellExclusions` | [engine.js](engine.js) | Tracks which cell pairs must differ. |
| `GridStateAllocator` | [engine.js](engine.js) | Manages the initial grid state buffer and extra handler state. |
| `SudokuConstraintHandler` | [handlers.js](handlers.js) | Base class for all constraint handlers. |
| `SudokuBuilder` | [sudoku_builder.js](sudoku_builder.js) | Maps constraint types to handlers; creates `SudokuSolver`. |
| `SudokuConstraintOptimizer` | [optimizer.js](optimizer.js) | Derives additional handlers during initialization. |
| `CandidateSelector` | [candidate_selector.js](candidate_selector.js) | Cell/value ordering (conflict score per candidate, MRV fallback). |
| `ConflictScores` | [candidate_selector.js](candidate_selector.js) | History heuristic for backtrack-aware ordering. |
| `SeenCandidateSet` | [candidate_selector.js](candidate_selector.js) | Tracks candidates across solutions for `solveAllPossibilities`. |
| `LookupTables` | [lookup_tables.js](lookup_tables.js) | Precomputed bitmask tables (sum, range, reverse). |
