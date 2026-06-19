# Debug tooling

Tools for understanding *what* the solver found and *why* it did what it did
— solution content (digit grids, var cells), which cell it branches on, what
candidates a constraint has pruned, and whether a custom NFA spec accepts a
known solution. These complement the benchmarking tools in
[`tests/bench/`](../bench/README.md), which measure *how much* search a change
causes.

## Tools

| Command | Purpose |
| --- | --- |
| `node tests/debug/solve.js` | Run a puzzle and display solution content: digit grid plus all var-cell groups (e.g. Chaos region labels). Optionally verify a known solution is accepted. |
| `node tests/debug/step_analysis.js` | Walk the search step by step. Explain why a branch was chosen, show pencilmarks/var-cell candidates, the per-step propagation log (what each handler pruned + the refuter), and where an ablation makes the branching diverge. |
| `node tests/debug/search_hotspots.js` | Where the search concentrates over a (bounded) solve: the conflict heatmap, the cells re-guessed most (churn), and the branch-factor shape (grid vs var, MRV gap). The headless view of the debug UI's heatmap. |

Run either script with `--help` for the full option reference.

---

### `solve.js` — display solution content

`--max-backtracks <n|none>` is required (no default — "none" for unlimited), so
a run is never silently unbounded; a run that hits the cap reports `capped`.

```sh
# Show the solution grid and region labels.
node tests/debug/solve.js --max-backtracks none --puzzle "Chaos Construction"

# Show all solutions for a raw constraint string.
node tests/debug/solve.js --max-backtracks none --input-file puzzle.txt --solutions all

# Verify a known solution is accepted (exits non-zero if rejected).
node tests/debug/solve.js --max-backtracks 50000 --puzzle "Chaos Construction" --solution 123456789...
```

`--solution <digits>` injects the digit string as givens before solving. If the
solver reports no-solution, the puzzle's constraints reject that assignment —
useful for confirming a known-good solution after a constraint change, or for
narrowing which constraints cause a rejection (combine with manual constraint
removal in the input string).

---

### `step_analysis.js` — walk the search, inspect state

```sh
# Walk the first 10 steps.
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" --steps 10

# Explain why the solver branched the way it did at step 1.
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" --at first --explain

# Show pencilmarks and var-cell candidates at step 5 (--at applies to both).
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" --at 5 --grid --vars

# Walk 20 steps, and also explain a specific step within that window.
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" --steps 20 --at 5 --explain

# Steer the search to a specific branch and inspect from there.
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" \
    --at first --explain --guide 1:R7C9=5

# Read the constraint string from a file; show initial var-cell state.
node tests/debug/step_analysis.js --input-file puzzle.txt --at 0 --grid --vars

# Show what each handler pruned at a step, and (at a contradiction step) the
# handler that returned false — the "refuter" that killed the branch.
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" --at 2 --log

# Where do the branch decisions diverge once an ablation is applied?
node tests/debug/step_analysis.js --puzzle "Chaos Construction" --steps 20 --compare chaos-bottlenecks

# Dump the grid state at a step as a constraint string (re-feedable via --input).
node tests/debug/step_analysis.js --puzzle "Chaos Construction: The Fountain" --at 6 --dump-state
```

`--compare <ablation>` shows *where* the search first branches differently; for
the *node-count* impact of an ablation use `benchmark_puzzles.js --compare`. See
`benchmark_puzzles.js --list-ablations` for available ablation names.

`--steps` controls the walk table range; `--at` controls the inspection point
for `--grid`, `--vars`, and `--explain`. They are independent: a wide `--steps`
gives overall search context while `--at` drills into a specific step.

#### Workflow: debugging a bad elimination

When a constraint is wrongly pruning a valid solution — the solver reports
no-solution on what should be a valid puzzle — the goal is to narrow it to a
concrete, 0-guess reproduction:

1. Use `debug/solve.js --max-backtracks 50000 --solution <digits>` to confirm the
   solver rejects a known-good assignment. If it does, the bug is in a constraint,
   not the grid.

2. Remove constraints from the input one block at a time until the rejection
   disappears. The last removed block contains the culprit.

3. Add digit givens (`.~RrCc_v` appended to the constraint string) to reduce
   the guess count while keeping the rejection. Stop when `guesses=0` — you
   now have a concrete 0-guess reproduction.

4. At 0 guesses, `step_analysis.js --at 0 --vars` shows which var-cell
   candidates were pruned to empty after initial propagation.

#### Workflow: incremental vs full propagation

During search a node only runs *incremental* propagation (the handlers reachable
from the cells that just changed). To check whether a full sweep would derive
more from a node's state than the search did:

1. `step_analysis.js --at N --dump-state` — emits the state at step N as a
   constraint string (original puzzle + a `~Cell_v…` given per search-narrowed
   grid/var cell).

2. Feed it back: `step_analysis.js --input "<string>" --at 0 --grid --vars` shows
   the grid after *full* initial propagation from that state. If it is narrower
   than the step-N state (or `--log` reports a `returned false`), full propagation
   found something the node's incremental pass missed; if it is identical, the
   node was already at the full-propagation fixpoint.

#### Debugging a custom NFA spec

When the culprit is an NFA built from a user-defined state machine, the issue
is usually in the spec logic rather than the solver. Verify by feeding the spec
the token stream for a known solution and tracing state transitions — the spec
should accept; if it doesn't, the first diverging state shows where the logic
is wrong.

The practical approach: write a small standalone JS simulation. Build the
spec's `transition` and `accept` functions directly, construct the token
sequence from the known solution's assignments, and step through them logging
`(token, value, state-before, state-after)`. No solver infrastructure needed.

The natural future addition to `step_analysis.js` is `--trace-nfa <name>`,
which would feed a named NFA constraint's token stream through the spec at the
`--at` step and log the state transitions directly.

---

### `search_hotspots.js` — where the search concentrates

```sh
# Conflict heatmap + churn + branch-factor shape over a bounded solve.
node tests/debug/search_hotspots.js --max-backtracks none --puzzle "Chaos Construction"

# Cap a hard puzzle so the run is bounded (rankings reflect the work done).
node tests/debug/search_hotspots.js --max-backtracks 50000 --puzzle "Chaos Construction: The Fountain"
```

`--max-backtracks <n|none>` is required. Reports three rankings:

- **CONFLICT** — cells with the most accumulated backtrack conflict (the engine's
  conflict heatmap, otherwise only visible in the debug UI), with the share that
  is on var cells.
- **CHURN** — cells the search re-guesses the most distinct values on.
- **BRANCH FACTOR** — the branch-factor histogram split grid vs var, the fraction
  of branches on var cells, and the **MRV gap** (how far the heuristic strays from
  branching on the fewest-options cell).

A `capped` status means the run hit the backtrack limit, so the rankings reflect
only the work done so far.
