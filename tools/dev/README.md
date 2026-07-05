# Dev tooling

Maintenance scripts for the repository's own data and generated artifacts, as
opposed to the solver-inspection CLIs in [`tools/debug/`](../debug/README.md) and
the performance CLIs in [`tools/perf/`](../perf/README.md).

## Tools

| Command | Purpose |
| --- | --- |
| `node tools/dev/fix_constraint_types.js` | Bring the `constraintTypes` declared on puzzle entries in [`data/collections.js`](../../data/collections.js) back in sync with what the app would tag them. `--dry-run` for a read-only report (non-zero exit if out of sync). |

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
