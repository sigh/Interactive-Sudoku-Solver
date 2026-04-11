# tests/ — Test Suite

Tests use Node.js with the native `assert/strict` module and a custom test runner. No external test framework.

## Running Tests

```sh
node tests/run_all_tests.js           # default: suite summaries only
node tests/run_all_tests.js --verbose  # also print each passing test name
```

## Interpreting Output

- Each file prints `▶ Running <path>` before execution.
- Each suite prints: `All <name> tests passed. (<N> tests in <ms>ms)`
- Final line: `✓ All tests passed. (<total> tests across <files> files in <ms>ms)`
- On failure: the runner continues all remaining files, then prints `✗ N file(s) failed:` with the file list and exits with code 1.

## Directories

| Directory | Purpose |
|-----------|---------|
| [handlers/](handlers/) | Per-handler tests. Each file tests one constraint handler in isolation. |
| [general/](general/) | Application-level tests. Utilities, NFA builder, parser, solver runner, grid shapes, sandbox environment, and the simple solver API. |
| [solver/](solver/) | Solver internals. Candidate selection, exclusion groups, conflict scores, lookup tables, optimizer, and builder. |
| [ui/](ui/) | UI component tests. Constraint input with a mock DOM. |
| [e2e/](e2e/) | End-to-end tests. Solves full puzzle collections and checks solutions. Runs last. |
| [helpers/](helpers/) | Test utilities (not tests). `test_runner.js` provides `runTest`/`logSuiteComplete`. `test_env.js` sets up globals. `grid_test_utils.js` provides grid/handler helpers. |
| [bench/](bench/) | Benchmarks (`*.bench.js`). |
| [bisect/](bisect/) | Git bisect helper for perf regressions. |

## Test Helpers

From `helpers/test_runner.js`:

- `runTest(name, fn)` — run a single test. Increments the suite counter. Prints name only with `--verbose`.
- `logSuiteComplete(suiteName, count?)` — log suite result. Uses internal counter by default; pass `count` to override (e.g. e2e bulk tests).
- `getTotalCount()` — aggregate count across all suites.

## Writing Tests

Each `*.test.js` file imports modules directly (ESM), calls `runTest(name, fn)` for each test, and ends with `logSuiteComplete('SuiteName')`.

### Handler Tests

Handler tests live in [handlers/](handlers/):

```js
import { GridTestContext, createAccumulator, valueMask }
  from '../helpers/grid_test_utils.js';

const context = new GridTestContext({ gridSize: [1, 4] });
const handler = new MyHandler([0, 1], someParam);
context.initializeHandler(handler);

const grid = context.grid;
grid[0] = valueMask(1, 2);
grid[1] = valueMask(1, 2, 3);

const acc = createAccumulator();
const result = handler.enforceConsistency(grid, acc);

assert.equal(result, true);
assert.equal(grid[1], valueMask(/* expected */));
assert.ok(acc.touched.has(1));
```

- `GridTestContext({ gridSize })` — creates grid with all-candidates bitmask. Use `[rows, cols]`.
- `context.initializeHandler(handler)` — calls `initialize` with defaults.
- `valueMask(1, 2, 3)` — bitmask for 1-indexed values.
- `createAccumulator()` — mock with `touched` set tracking modified cells.
