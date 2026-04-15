# data/ — Puzzle Data & Layouts

Static data files used by the UI and tests: example puzzles, puzzle collections for benchmarking, and jigsaw region layouts.

## Files

| File | Purpose |
|------|---------|
| [example_puzzles.js](example_puzzles.js) | Puzzle definitions for the UI example selector. Exports `PUZZLE_INDEX` (lookup by ID) and `DISPLAYED_EXAMPLES` (showcase list). Each entry has `name`, `input` (constraint string), `solution`, and optional `src` (attribution link). Covers 40+ variants (classic, thermo, killer, arrow, jigsaw, whisper, etc.). |
| [collections.js](collections.js) | Puzzle collections for benchmarking and testing. Used by the debug panel's benchmark runner and by end-to-end tests. |
| [jigsaw_layouts.js](jigsaw_layouts.js) | Valid and easily-invalid jigsaw region layouts for 9×9 grids. Each layout is an 81-character string where each character is a region ID. |
| [jigsaw_box_layouts.js](jigsaw_box_layouts.js) | Additional valid jigsaw layouts using box-based region assignments. |
| [invalid_jigsaw_layouts.js](invalid_jigsaw_layouts.js) | 26+ intentionally invalid jigsaw layouts. Used by tests to verify the solver correctly rejects unsolvable configurations. |
| [factorial_cages.iss](factorial_cages.iss) | Pre-generated puzzle with complex NFA-encoded constraints (factorial cage rules). |
| [large_state_machine.iss](large_state_machine.iss) | Pre-generated puzzle with a large NFA state machine (30 states tracking running sums). |

## Formats

**Constraint strings** (in `input` fields): The same `.Type~arg1~cell1~cell2` serialization format described in [js/README.md](../js/README.md).

**Jigsaw layout strings**: 81 characters for a 9×9 grid, read left-to-right top-to-bottom. Each character is a region identifier (digit or letter).

**.iss files**: Pre-generated puzzle definitions containing serialized NFA state machines as constraint strings. Generated via sandbox scripts and stored for use as test fixtures and examples.
