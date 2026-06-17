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
| `node tests/debug/step_analysis.js` | Walk the search step by step. Explain why a branch was chosen, show pencilmarks and var-cell candidates at any step. |

Run either script with `--help` for the full option reference.

---

### `solve.js` — display solution content

```sh
# Show the solution grid and region labels.
node tests/debug/solve.js --puzzle "Chaos Construction"

# Show all solutions for a raw constraint string.
node tests/debug/solve.js --input-file puzzle.txt --solutions all

# Verify a known solution is accepted (exits non-zero if rejected).
node tests/debug/solve.js --puzzle "Chaos Construction" --solution 123456789...
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
```

`--steps` controls the walk table range; `--at` controls the inspection point
for `--grid`, `--vars`, and `--explain`. They are independent: a wide `--steps`
gives overall search context while `--at` drills into a specific step.

#### Workflow: debugging a bad elimination

When a constraint is wrongly pruning a valid solution — the solver reports
no-solution on what should be a valid puzzle — the goal is to narrow it to a
concrete, 0-guess reproduction:

1. Use `debug/solve.js --solution <digits>` to confirm the solver rejects a
   known-good assignment. If it does, the bug is in a constraint, not the grid.

2. Remove constraints from the input one block at a time until the rejection
   disappears. The last removed block contains the culprit.

3. Add digit givens (`.~RrCc_v` appended to the constraint string) to reduce
   the guess count while keeping the rejection. Stop when `guesses=0` — you
   now have a concrete 0-guess reproduction.

4. At 0 guesses, `step_analysis.js --at 0 --vars` shows which var-cell
   candidates were pruned to empty after initial propagation.

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
