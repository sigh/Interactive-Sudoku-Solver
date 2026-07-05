# Developer tools

Command-line tools for solver development. Every CLI takes `--help`.

## Layout

| Directory | What's in it |
| --- | --- |
| [debug/](debug/README.md) | Inspection CLIs — *what* the solver found and *why*. |
| [perf/](perf/README.md) | Performance CLIs — *how much* search / *how fast*. |
| [bisect/](bisect/README.md) | `git bisect` helper for guess-count regressions. |
| `lib/` | Shared modules the CLIs import (never run directly): `cli_entry.js` (the `runAsCli` harness), `puzzle_runner.js`, `solver_analysis.js`, `ladder.js`, `micro_bench_harness.js`, and the ablation `extensions/`. |

The one shared piece that lives outside `tools/` is the headless-run bootstrap
`tests/helpers/test_env.js` (`ensureGlobalEnvironment`): the tests need it too, so
it stays there and the tools import it back.

## Which tool answers which question

| You want to… | Tool |
| --- | --- |
| See the solution grid + var-cell groups | [`debug/solve.js`](debug/README.md) |
| Check an encoding accepts a known answer (`ACCEPTED`/`REJECTED`) | [`debug/verify_solution.js`](debug/README.md) |
| Walk the search step by step (why it branched, what pruned) | [`debug/step_analysis.js`](debug/README.md) |
| See where the search concentrates (conflict/churn/branch heatmaps) | [`debug/search_hotspots.js`](debug/README.md) |
| Run a sandbox script headless → constraint string | [`debug/run_sandbox.js`](debug/README.md) |
| Measure search cost (guesses/backtracks/nodes) + in-build A/B | [`perf/benchmark_puzzles.js`](perf/README.md) |
| A/B the working tree against a baseline git revision | [`perf/bench_vs_ref.js`](perf/README.md) |
| Profile one handler during a solve | [`perf/profile.js`](perf/README.md) |
| Run the micro-benchmarks (`npm run bench`) | [`perf/run_legacy_benchmarks.js`](perf/README.md) |
| Bisect a guess-count regression across history | [`bisect/run-bisect.sh`](bisect/README.md) |

## Conventions

Each CLI exports `main(argv)` and ends with `runAsCli(import.meta.url, main)`, so
it runs as a program *and* is importable in-process (that's how
[`../tests/tools.test.js`](../tests/tools.test.js) smoke-tests them). Tools throw
on failure rather than calling `process.exit`, so a thrown error maps to a
non-zero exit via `cli_entry.js`. Solving/benchmarking CLIs require an explicit
`--max-backtracks <n|none>` so a run is never silently unbounded.
