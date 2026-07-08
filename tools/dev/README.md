# Dev tooling

Maintenance scripts for the repository's own data and generated artifacts, as
opposed to the solver-inspection CLIs in [`tools/debug/`](../debug/README.md) and
the performance CLIs in [`tools/perf/`](../perf/README.md).

## Tools

| Command | Purpose |
| --- | --- |
| `node tools/dev/fix_constraint_types.js` | Bring the `constraintTypes` declared on puzzle entries in [`data/collections.js`](../../data/collections.js) back in sync with what the app would tag them. `--dry-run` for a read-only report (non-zero exit if out of sync). |
| `node tools/dev/lint_sandbox_script.js` | Surface targeted sandbox-script authoring guidance. Advisory by default; `--fail-on-guidance` exits non-zero. |

Run any script with `--help` for the full option reference.

---

### `fix_constraint_types.js` — keep collection tags in sync

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
node tools/dev/fix_constraint_types.js

# Report what would change without writing (exits non-zero if anything is stale).
node tools/dev/fix_constraint_types.js --dry-run
```

An entry that resolves to no types is reported as a WARNING and left unchanged —
an empty result means a resolution gap, not that the puzzle has no constraints.

---

### `lint_sandbox_script.js` — surface sandbox authoring guidance

Sandbox scripts can often use helpers exposed by `js/sandbox/env.js` rather than
rebuilding common geometry by hand. This tool is intentionally advisory: it
surfaces regex parsing of `R#C#` ids, template-literal builders that should use
`makeCellId(row, col)`, and custom neighbour helpers that may duplicate
`cellGraph().neighbours()` / `cellGraph().kingNeighbours()`. It also runs the
script and reports when the generated constraint string is very long and contains
no `Replicate`, as a prompt to check whether repeated shifted constraints can be
compressed.

Treat each item as guidance, not a correctness finding. Adjust the script when
the suggestion applies, or keep the code when the local implementation is
intentional.

```sh
# Report targeted guidance for one or more sandbox scripts.
node tools/dev/lint_sandbox_script.js data/scripts/my_puzzle.js

# Use as a stricter gate.
node tools/dev/lint_sandbox_script.js --fail-on-guidance data/scripts/my_puzzle.js
```
