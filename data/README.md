# data/ — Puzzle Data & Layouts

Static data files used by the UI and tests: example puzzles, puzzle collections for benchmarking, and jigsaw region layouts.

## Files

| File | Purpose |
| --- | --- |
| [example_puzzles.js](example_puzzles.js) | Puzzle definitions for the UI example selector. Exports `PUZZLE_INDEX` (lookup by ID) and `DISPLAYED_EXAMPLES` (showcase list). Each entry has `name`, `input` (constraint string), `solution`, and optional `src` (attribution link). Covers 40+ variants (classic, thermo, killer, arrow, jigsaw, whisper, etc.). |
| [collections.js](collections.js) | Puzzle collections for benchmarking and testing. Used by the debug panel's benchmark runner and by end-to-end tests. Path-input entries (`.iss`/`.js`) carry an explicit `constraintTypes` tag list; [`tools/dev/fix_constraint_types.js`](../tools/dev/README.md) keeps it in sync. |
| [jigsaw_layouts.js](jigsaw_layouts.js) | Valid and easily-invalid jigsaw region layouts for 9×9 grids. Each layout is an 81-character string where each character is a region ID. |
| [jigsaw_box_layouts.js](jigsaw_box_layouts.js) | Additional valid jigsaw layouts using box-based region assignments. |
| [invalid_jigsaw_layouts.js](invalid_jigsaw_layouts.js) | 26+ intentionally invalid jigsaw layouts. Used by tests to verify the solver correctly rejects unsolvable configurations. |
| [scripts/](scripts/) | Sandbox scripts (`.js`) referenced as puzzle inputs. Loaded by running them through the sandbox to generate the constraint, rather than reading a pre-expanded string. |

## Formats

**Puzzle entry** (the objects in `example_puzzles.js` and `collections.js`):

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Display name; also the lookup key in `PUZZLE_INDEX`. Prefer the puzzle's real (source) title. When an entry is a deliberate **variant** of another puzzle, suffix a `[label]` — see "Variant naming" below. |
| `input` | yes | The puzzle: a constraint string (see below), **or** a `/…` path to a `.iss` file or a `.js` sandbox script under [scripts/](scripts/). Path inputs are resolved at load time (a `.js` is executed to produce its constraints). |
| `solution` | recommended | 81-char row-major digit string; used by tests and `verify_solution.js`. |
| `src` | optional | Attribution link(s) — a single URL or an **array**. Ideally provide two: a machine-decodable puzzle link (SudokuPad / f-puzzles / Penpa, extractable by the decode tooling) and a step-by-step solution (usually a YouTube solve). Put the **YouTube link first** — the UI surfaces only the first source, and the walkthrough is the more useful one to open. |
| `constraintTypes` | only for path inputs | Constraint-type tags for the selector. Derived automatically via `SudokuParser.extractConstraintTypes(input)` for inline constraint strings, but a `.iss`/`.js` path can't be parsed that way, so those entries must list them explicitly — kept equal to the extractor's output by [`tools/dev/fix_constraint_types.js`](../tools/dev/README.md) (`--dry-run` to check). |
| `comment` | optional | Free-text note about the entry — why it is a variant/re-encoding, what solver feature it exercises, or any caveat. Not parsed; for humans. |

**Variant naming**: when an entry is a modified or re-encoded version of a puzzle
(so its `name` would otherwise collide with, or misrepresent itself as, the
faithful puzzle), keep the source title as the base and append a single
`[label]` suffix — e.g. `Event Horizon [simplified]`, `Regex Line [0-indexed]`.
The label is free-form (aim for consistency: `easier`, `simplified`,
`0-indexed`, …) and is purely a convention to keep names unique and readable —
nothing parses it. Faithful re-encodings (same puzzle and solution, only the ISS
encoding differs) take the plain source title and put the encoding note in
`comment`.

**Constraint strings** (in `input` fields): The same `.Type~arg1~cell1~cell2` serialization format described in [js/README.md](../js/README.md).

**Jigsaw layout strings**: 81 characters for a 9×9 grid, read left-to-right top-to-bottom. Each character is a region identifier (digit or letter).

**.iss files**: Pre-generated puzzle definitions containing serialized NFA state machines as constraint strings. Generated via sandbox scripts and stored for use as test fixtures and examples.

**.js sandbox scripts** (in `scripts/`): JavaScript that the sandbox executes to generate a constraint, the same code you would type into the sandbox editor (it `return`s an array of constraints). Referenced from a puzzle's `input` like an `.iss` path; the loader detects the `.js` extension and runs it instead of parsing it as a constraint string.
