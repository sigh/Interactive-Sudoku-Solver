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
