# data/scripts/ — Sandbox Puzzle Scripts

JavaScript scripts that the sandbox executes to generate a constraint, instead of
storing a pre-expanded constraint string. Each file is the same code you would type
into the sandbox editor: it `return`s an array of constraints (or a constraint
string).

## Writing scripts

Scripts run against the sandbox globals (all constraint classes, grid shapes, cell
id helpers, and the solver) with no imports needed. The API is documented in:

- [../../js/sandbox/README.md](../../js/sandbox/README.md) — the sandbox environment and its globals.
- [../../js/sandbox/help_text.js](../../js/sandbox/help_text.js) — accepted return values, console methods, cell id format, and the `SimpleSolver` API.
- [../../js/sandbox/examples.js](../../js/sandbox/examples.js) — runnable example snippets covering the common patterns.
- [../../js/sudoku_constraint.js](../../js/sudoku_constraint.js) — the full list of built-in constraint classes.

The easiest way to author a new script is interactively in the sandbox, then
save the code here.

## Running scripts

Outside the sandbox, run it through [../../tests/debug/run_sandbox.js](../../tests/debug/run_sandbox.js), which executes the script against the same sandbox globals and prints the resulting constraints — useful for generating a puzzle file or checking a script in CI.
