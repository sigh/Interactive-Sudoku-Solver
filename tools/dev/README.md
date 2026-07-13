# Dev tooling

Maintenance scripts for the repository's own data and generated artifacts, as
opposed to the solver-inspection CLIs in [`tools/debug/`](../debug/README.md) and
the performance CLIs in [`tools/perf/`](../perf/README.md).

## Tools

| Command | Purpose |
| --- | --- |
| `node tools/dev/sync_derived_puzzle_data.js` | Bring the `constraintTypes` declared on puzzle entries in [`data/collections.js`](../../data/collections.js) back in sync with what the app would tag them, and regenerate the [`data/scripts/*.iss`](../../data/scripts/) mirrors of the sandbox scripts. `--dry-run` for a read-only report (non-zero exit if out of sync). |
| `node tools/dev/lint_sandbox_script.js` | Surface targeted authoring guidance on sandbox-script *source*. Advisory by default; `--fail-on-guidance` exits non-zero. |
| `node tools/dev/lint_constraints.js` | Surface canonicalization and redundancy guidance on *generated constraints* (`.iss` files or stdin via `-`; with `--script`, sandbox scripts it runs itself). Advisory by default; `--fail-on-guidance` exits non-zero, as does an input that cannot be linted at all. |

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

### Shared behaviour: rules, tiers, selection, output

Both linters run a rule registry through one CLI shell
([`tools/lib/lint_cli.js`](../lib/lint_cli.js)), so they share their flags and
their output format. The registry is the only place a rule is described —
**`--list-rules` prints what every rule catches and when to ignore it**, so
this file does not repeat them. Every rule has a **tier**:

| Tier | Meaning |
| --- | --- |
| `exact` | Decided from an exact parse of what was built. No triaged false positives, so this is the only tier safe to gate CI on. |
| `heuristic` | Idiom/pattern guidance read off source text. A human decides. Advisory. |
| `info` | A note that a rule could not run — never a finding about the code. |

| Flag | Effect |
| --- | --- |
| `--list-rules` | Print the registry (code, tier, what each rule catches). `--format=json` for the machine-readable form. |
| `--only=<codes>` / `--ignore=<codes>` | Run a subset of rules. An unknown code is an error, not a silent no-op. |
| `--fail-on-guidance` | Exit non-zero on any finding. |
| `--fail-on=<tiers>` | Exit non-zero only for these tiers — `--fail-on=exact` gates CI on the zero-false-positive tier while heuristics stay advisory. |
| `--format=text\|json` | `text` (default) is `<file>:<line>: guidance <code>: <message>`. `json` emits `{items, errors, suppressed}` for consumers that would rather not regex it. |
| `--baseline=<file>` / `--write-baseline=<file>` | Hold a known, accepted set of findings at zero noise: write the counts once, then pass `--baseline` on later runs. Only findings *beyond* the recorded count per file per code are reported, so an accepted finding is silent but a new one still fails. |

An input that cannot be parsed or run is an *error*, not guidance: it prints
`<file>:1: error: ...`, is kept out of the guidance total, and always exits
non-zero, whatever the guidance policy is.

---

### `lint_sandbox_script.js` — surface sandbox authoring guidance

Sandbox scripts can often use helpers exposed by `js/sandbox/env.js` rather than
rebuilding common geometry by hand. This tool lints source only and never
executes the script — to check the generated constraints, pipe the run_sandbox
output through `lint_constraints.js` (below).

Every rule here reads source text, so all of them are `heuristic`: treat each
item as guidance, not a correctness finding. Adjust the script when the
suggestion applies, or keep the code when the local implementation is
intentional — and when it is, say so in the file with
`// lint-ok: <code>` on the offending line, or on the line directly above it.
That silences those codes for that one line.

It surfaces hand-built and hand-parsed cell ids, custom neighbour helpers,
rows/columns/boxes built by hand, `numValues` literals that disagree with the
declared `Shape`, hand-assembled `Sum` coefficient strings, mutable constraint
accumulators, and scripts with no rules prose. Run `--list-rules` for the
current set, with what each one catches.

Rules read a comment-stripped view of the source by default, so prose that
mentions an idiom (`[1, 4, 7]`, the `_=_` wire format) is not mistaken for the
idiom itself. String and template-literal contents are kept — that is where the
idioms live. `local-file-reference` deliberately reads comments too.

```sh
# Report targeted guidance for one or more sandbox scripts.
node tools/dev/lint_sandbox_script.js data/scripts/my_puzzle.js

# Use as a stricter gate.
node tools/dev/lint_sandbox_script.js --fail-on-guidance data/scripts/my_puzzle.js

# What does each rule catch?
node tools/dev/lint_sandbox_script.js --list-rules
```

---

### `lint_constraints.js` — surface generated-constraint guidance

Lints the serialized constraint form, so its checks are exact regardless of how
a script produced the output. That is why these rules are `exact` tier and
`lint_sandbox_script.js`'s are not — and why `--fail-on=exact` gates on this
tool alone.

It surfaces coefficient `Sum`s that re-encode `EqualSum`/`SameValues`/plain
`Sum`, `Pair` keys that re-encode a native relation, NFA alphabets that
disagree with the `Shape`, stamped copies that one `Replicate` could express,
and redundant `Given`s/`AllDifferent`s — plus an `info` note when the builder
cannot resolve the tree, since the two `Replicate` rules need cell positions.
Run `--list-rules` for the current set, with each rule's exact conditions.

Because `.iss` files are generated, they cannot carry `// lint-ok:` comments.
Use `--baseline` to hold an accepted set of findings instead.

```sh
# Lint stored constraint files.
node tools/dev/lint_constraints.js data/puzzles/example.iss

# Lint a sandbox script's generated output (the script is run in-process).
node tools/dev/lint_constraints.js --script my_puzzle.js

# Or lint any constraint text from stdin.
node tools/debug/run_sandbox.js --file my_puzzle.js | node tools/dev/lint_constraints.js -

# Gate CI on the exact tier, minus a known, accepted set of findings.
node tools/dev/lint_constraints.js --baseline=lint_baseline.json --fail-on=exact data/puzzles/*.iss
```
