# Dev tooling

Maintenance scripts for the repository's own data and generated artifacts, as
opposed to the solver-inspection CLIs in [`tools/debug/`](../debug/README.md) and
the performance CLIs in [`tools/perf/`](../perf/README.md).

## Tools

| Command | Purpose |
| --- | --- |
| `node tools/dev/sync_derived_puzzle_data.js` | Bring the `constraintTypes` declared on puzzle entries in [`data/collections.js`](../../data/collections.js) back in sync with what the app would tag them, and regenerate the [`data/scripts/*.iss`](../../data/scripts/) mirrors of the sandbox scripts. `--dry-run` for a read-only report (non-zero exit if out of sync). |
| `node tools/dev/lint_sandbox_script.js` | Surface targeted authoring guidance on sandbox-script *source*. Advisory by default; `--fail-on-guidance` exits non-zero. |
| `node tools/dev/lint_constraints.js` | Surface canonicalization and redundancy guidance on *generated constraints* (`.iss` files or stdin via `-`; with `--script`, sandbox scripts it runs itself). Advisory by default; `--fail-on-guidance` exits non-zero. |

Run any script with `--help` for the full option reference.

---

### `sync_derived_puzzle_data.js` — keep collection tags and `.iss` mirrors in sync

The puzzle selector tags each entry by its constraint types. For most entries
that is derived automatically (`SudokuParser.extractConstraintTypes` over the
`input`), but an entry whose `input` is a path — a `.iss` file or a `.js` sandbox
script — can't be parsed that way, so it must declare `constraintTypes`
explicitly. Those hand-written declarations drift as the puzzles change.

This tool resolves each entry's input exactly as the app does (read the file, run
a `.js` through the sandbox), runs the same extractor, and rewrites the
declarations so a path-entry is tagged identically to an equivalent inline
puzzle. Entries already in sync are left untouched (order preserved, no churn).

```sh
# Update data/collections.js in place.
node tools/dev/sync_derived_puzzle_data.js

# Report what would change without writing (exits non-zero if anything is stale).
node tools/dev/sync_derived_puzzle_data.js --dry-run
```

An entry that resolves to no types is reported as a WARNING and left unchanged —
an empty result means a resolution gap, not that the puzzle has no constraints.

The same run also regenerates the `.iss` mirrors under
[`data/scripts/`](../../data/scripts/). Each `foo.iss` is the pre-expanded,
canonicalized constraint string that
[`run_sandbox.js --output`](../debug/run_sandbox.js) produces from `foo.js`;
consumers that load the expanded form directly (e.g. the e2e puzzle that uses
`xin_yang_v2.iss` instead of running the sandbox) rely on it matching the
script. This tool rewrites any mirror that has drifted from its sibling `.js`
byte-for-byte; an `.iss` with no sibling script is hand-authored and left alone.

---

### `lint_sandbox_script.js` — surface sandbox authoring guidance

Sandbox scripts can often use helpers exposed by `js/sandbox/env.js` rather than
rebuilding common geometry by hand. This tool is intentionally advisory: it
surfaces regex parsing and template-literal building of `R#C#` ids (prefer
`makeCellId`) and Var member ids (prefer `Var.cells()` / `.cell(n)`), custom
neighbour helpers that may duplicate `cellGraph().neighbours()` /
`cellGraph().kingNeighbours()`, rows/columns/boxes built by hand where the
index-based `graph.row(n)` / `column(n)` / `box(n)` / `boxes()` apply,
`NFA.encodeSpec` / `Pair.fnToKey` numValues literals that disagree with the
script's own `new Shape(...)` declaration, hand-assembled `Sum` coefficient
strings (prefer `[cell, coeff]` pairs), 0-indexed cell-id wrappers, and
scripts with no rules prose at all.

This tool lints source only and never executes the script. To check the
generated constraints, pipe the run_sandbox output through
`lint_constraints.js` (below).

Treat each item as guidance, not a correctness finding. Adjust the script when
the suggestion applies, or keep the code when the local implementation is
intentional.

```sh
# Report targeted guidance for one or more sandbox scripts.
node tools/dev/lint_sandbox_script.js data/scripts/my_puzzle.js

# Use as a stricter gate.
node tools/dev/lint_sandbox_script.js --fail-on-guidance data/scripts/my_puzzle.js
```

---

### `lint_constraints.js` — surface generated-constraint guidance

Lints the serialized constraint form, so its checks are exact regardless of how
a script produced the output. It surfaces:

- coefficient `Sum`s that re-encode a native constraint: all-±1 zero-total
  forms that are `EqualSum` (or `SameValues` for the two-cell equality alias),
  and all-1 coefficient forms that are plain `Sum`/`Cage`;
- `Pair`/`PairX` keys whose decoded truth table matches a native relation
  (`WhiteDot`, `BlackDot`, `X`, `V`, `GreaterThan`) — suggested only when
  *every* constraint sharing that key is a 2-cell orthogonally-adjacent grid
  pair: the native classes require adjacency, and a partial replacement would
  split one drawn rule into two constraint types;
- NFA machines whose stored alphabet exceeds the Shape's value range (plus one
  for the multi-segment break symbol). The serializer trims trailing symbols
  with no transitions, so only this overshoot direction is checkable;
- Replicate candidates: many constraints sharing one NFA machine, and very
  long outputs with no `Replicate` at all;
- redundancy: full-range `Given`s on an unextended Shape, `AllDifferent`s
  duplicating an enforced row/column/box, duplicate constraint lines, and
  repeated cells inside all-different-semantics constraints.

```sh
# Lint stored constraint files.
node tools/dev/lint_constraints.js data/puzzles/example.iss

# Lint a sandbox script's generated output (the script is run in-process).
node tools/dev/lint_constraints.js --script my_puzzle.js

# Or lint any constraint text from stdin.
node tools/debug/run_sandbox.js --file my_puzzle.js | node tools/dev/lint_constraints.js -
```
