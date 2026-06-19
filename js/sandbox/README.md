# js/sandbox/ — User Code Sandbox

This directory implements the sandbox environment where users can write and execute JavaScript to create constraints, run the solver, and analyze puzzles programmatically. Accessed via [../../sandbox.html](../../sandbox.html).

## Architecture

User code executes in a Web Worker ([../user_script_worker.js](../user_script_worker.js)) to isolate it from the main thread. The worker has access to sandbox globals defined in [env.js](env.js) (constraint classes, parsing utilities, solver API). The return value determines what happens:

- **Array of constraints** → loaded into the solver UI
- **Constraint string** → parsed and loaded
- **Other values** → displayed as output

## Files

| File | Purpose |
|------|---------|
| [embedded_sandbox.js](embedded_sandbox.js) | **Main sandbox UI.** `EmbeddedSandbox` manages the CodeJar code editor (with Prism syntax highlighting), code execution, output rendering (text, tables, constraint links), shareable link generation (Base64-encoded URL), example loading, and auto-save to localStorage. |
| [env.js](env.js) | **Sandbox environment.** Defines `SANDBOX_GLOBALS` — all functions and classes available to user code: `parseConstraint()`, `makeCellId()`, `parseCellId()`, `solverLink()`, `makeSolver()`, `help()`, `SolverStats`, all `GridShape` instances, and all `SudokuConstraint.*` classes. `createSandboxConsole()` provides custom `console.log/error/warn/table` that capture output for display. |
| [simple_solver.js](simple_solver.js) | **Synchronous solver API.** `SimpleSolver` wraps the solver engine for use in user scripts. Methods: `solution()`, `uniqueSolution()`, `solutions()`, `countSolutions()`, `trueCandidates()`, `validateLayout()`. Returns `Solution` objects (with `valueAt()`, iteration, `toString()`) and `TrueCandidates` objects (with `valuesAt()`, `countAt()`, witness solutions). |
| [solver_stats.js](solver_stats.js) | **Solver metrics.** `SolverStats` is a lightweight immutable snapshot of solver performance: `setupTimeMs`, `runtimeMs`, `solutions`, `guesses`, `backtracks`, `nodesSearched`, `constraintsProcessed`, `valuesTried`, `branchesIgnored`. Supports `add()` for aggregation and `pick()` for selective display. |
| [examples.js](examples.js) | **Example code snippets.** `DEFAULT_CODE` creates a Miracle Sudoku. `EXAMPLES` object contains 11+ examples demonstrating: shape configuration, composite constraints, state machines, constraint modification, solver invocation, puzzle generation, grid rotation, and benchmarking. |
| [help_text.js](help_text.js) | **Help text.** `SANDBOX_HELP_TEXT` documents accepted return values, console methods, constraint API, cell ID format (`R{row}C{col}`), and the `SimpleSolver` API. Displayed in the sandbox output area on startup. |

## Key Concepts

### Sandbox Globals

User code has access to everything in `SANDBOX_GLOBALS` (defined in [env.js](env.js)) without needing imports. This includes all constraint classes (`SudokuConstraint.Cage`, `SudokuConstraint.Thermo`, etc.), grid shapes, parsing utilities, and the solver.

### SimpleSolver

[simple_solver.js](simple_solver.js) provides `makeSolver(constraints)` which accepts a constraint object, array, or string. It builds and runs the solver synchronously, returning results through a clean API:

- `solver.solution()` — first solution (or `null`)
- `solver.uniqueSolution()` — solution if exactly one exists
- `solver.countSolutions(limit)` — count up to limit
- `solver.trueCandidates()` — all values that appear in any solution

### Code Sharing

Code is encoded as Base64 in the URL `?code=` parameter, enabling shareable sandbox links. The editor also auto-saves to localStorage on every change.

## Encoding puzzles

The script API (return values, console methods, cell ids, the solver interface) is documented in [help_text.js](help_text.js). See [sudoku_constraint.js](../sudoku_constraint.js)
for the full list of built-in constraint classes.

See [examples.js](examples.js) for runnable scripts demonstrating these patterns.
To run a script outside the browser — e.g. to generate a puzzle file — use
[`tests/debug/run_sandbox.js`](../../tests/debug/run_sandbox.js), which executes
it against these same globals and prints the resulting constraints.

### What the engine always enforces

Every grid has the same baseline, applied automatically:

- Each row and each column is all-different.
- Each box is all-different, unless you add `NoBoxes` (or change them with `RegionSize`).
- Every cell draws from one value range (e.g. `1–9`), set by `Shape`.

Everything else is built by adding constraints on top of this baseline.

### A rule with no dedicated constraint

Most "custom" rules reduce to one of these shapes, using a constraint class from [sudoku_constraint.js](../sudoku_constraint.js):

| Rule is about… | Use |
| --- | --- |
| a set or sum of cells | `Cage`, `Sum`, `AllDifferent` |
| the digits along an ordered list of cells | `Regex`, `NFA` |
| a relation between adjacent/paired cells | `Pair`, `PairX` |
| one of several alternatives holding | `Or`, `And` |

A rule with no constraint of its own is often a regular language in disguise — e.g. a parity-of-sum rule is a parity-of-count rule over odd/even digits, which `Regex`/`NFA` express directly. Note their alphabet is the grid's value range, so a pattern can only reference in-range digits.

### Structure the grid model doesn't support

For variables outside the grid, regions the shape can't describe, or multiple/overlapping sub-grids, add cells with `Var` (addressed `VA1`, `VA2`, …). Var cells are *not* part of the automatic row/column/box groups, so you define their behaviour yourself: restrict their values with givens, and form regions with explicit `AllDifferent`. Combined with `NoBoxes`, this expresses geometries the built-in shape cannot.
