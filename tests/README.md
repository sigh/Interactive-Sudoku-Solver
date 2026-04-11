# tests/ — Test Suite

Tests use Node.js with the native `assert/strict` module and a custom test runner. There is no external test framework dependency.

## Running Tests

```sh
node tests/run_all_tests.js
```

[run_all_tests.js](run_all_tests.js) discovers all `*.test.js` files recursively and runs them in order, with the end-to-end tests last (they are slower).

## Directories

| Directory | Purpose |
|-----------|---------|
| [handlers/](handlers/) | Per-handler tests (~30 files). Each file tests one constraint handler in isolation (e.g., Sum, AllDifferent, BinaryConstraint, Skyscraper, etc.). |
| [general/](general/) | Application-level tests (~11 files). Covers utilities, NFA builder, parser, solver runner, grid shapes, sandbox environment, and the simple solver API. |
| [solver/](solver/) | Solver internals (~9 files). Tests for candidate selection, exclusion groups, conflict scores, lookup tables, optimizer invariants, and builder patterns. |
| [ui/](ui/) | UI component tests (1 file). Tests constraint input with a mock DOM. |
| [e2e/](e2e/) | End-to-end tests (1 file). Solves full puzzle collections from [../data/](../data/) and checks solutions. Runs last due to cost. |
| [helpers/](helpers/) | Test utilities (not tests themselves). `test_runner.js` provides the `runTest(name, fn)` harness. `test_env.js` sets up the global environment. `grid_test_utils.js` provides helpers for creating grids and setting candidates. |
| [bench/](bench/) | Benchmarks. `run_all_benchmarks.js` runs `*.bench.js` files for performance measurement (util, lookup tables, exclusion groups). |
| [bisect/](bisect/) | Git bisect helper script for identifying performance regressions. |

## Patterns

- Tests import modules directly (ES modules) and call `runTest(name, async fn)`.
- `GridTestContext` (from [helpers/grid_test_utils.js](helpers/grid_test_utils.js)) sets up a solver grid with a given size for handler tests.
- Handler tests typically: create a grid, add the handler under test, run `enforceConsistency`, and assert that candidates were correctly pruned.
