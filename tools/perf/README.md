# Benchmark & analysis tooling

Tools for measuring solver performance and reasoning about handler changes, plus
the methodology for using them. The tools and conventions come first; the
methodology — what to measure and the traps to avoid — is at the end.

## The tools

| Command | Purpose |
| --- | --- |
| `node tools/perf/benchmark_puzzles.js` | Run puzzles and report search counters (solutions, guesses, backtracks, nodes, wall time). The "did my change move the search / how hard is this" tool, with built-in ablation A/B. `--json` emits the same rows as a machine-readable array. |
| `node tools/perf/bench_vs_ref.js` | A/B the working tree against a baseline git revision (the cross-revision comparison the in-process ablation A/B can't do). Reports per puzzle the wall-time delta and any change in search counters. Add `--require-identical` to make it a behaviour-preserving gate that fails if any counter moved (a pure refactor); omit it when the counter change is intentional and you just want to see how search and time moved. |
| `node tools/perf/profile.js` | Per-method profile of one handler during a solve (call counts, false-returns, time). Find where a handler spends time and which rules fire. |
| `node tools/perf/estimator_lab.js` | Compare research solution-count *estimators* (Knuth sampling variants: lookahead, importance sampling, fixed-depth exact tails, prefix trees, budgeted DFS) against puzzles with exactly known counts: bias, spread, hit rate, tail share, and `cost10%ms` (wall time to a 10% standard error; unreliable on heavy tails, treat as indicative). Reporting only — its corpus is not representative and must not be used to choose constants; the production estimator's correctness is pinned by the exhaustive test in `tests/solver/engine.test.js` (see `js/solver/ESTIMATION.md`). Strategies live in `tools/lib/estimator_strategies.js`. |
| `node tools/perf/run_legacy_benchmarks.js` (`npm run bench`) | The legacy micro/registered benchmark runner — discovers and runs `*.bench.js` files (lookup tables, bitset ops, etc.). Not for full-solve analysis. |

For solution content (digit grids, var cells, solution verification) and step-by-step search inspection, see [`tools/debug/`](../debug/README.md).

Run `benchmark_puzzles.js` or `profile.js` with `--help` for full options.

## Two conventions that prevent footguns

- **An explicit backtrack limit is required.** `--max-backtracks <n|none>` has no
  default. Pass a number to cap the search, or `none` for unlimited — but say
  which. An unbounded run on a hard puzzle can hang; a run that hits the cap is
  reported as `status=capped`, an *incomplete* result you must not compare on the
  work it did before stopping.
- **The default is proof of uniqueness, not first solution.** `--solutions`
  defaults to `2`: the search runs until it finds a second solution or exhausts.
  For an expected-unique puzzle that means `status=unique` (completed, one
  solution) is success and `multiple` is a second solution found. `--solutions all`
  exhausts/counts everything. `--solutions 1` (first-solution only) is available
  but warns — first-solution timing/shape is **not** valid evidence for a handler
  optimization. For an **All possibilities** issue, also measure the actual
  candidate-support search; `--solutions all` enumerates solutions and is not
  that operation. See [`true_candidate_profile.js`](../debug/README.md#true_candidate_profilejs--diagnose-slow-all-possibilities-searches).

## Common recipes

```sh
# How hard is a puzzle (proof of uniqueness)?
node tools/perf/benchmark_puzzles.js --max-backtracks none --puzzles "Chaos Construction"

# A ladder of difficulties (capped, so a bad point can't hang the run). `ladder:`
# grades any solved puzzle by revealing solution givens; @counts is optional.
node tools/perf/benchmark_puzzles.js --max-backtracks 50000 --puzzles "ladder:Chaos Construction"
node tools/perf/benchmark_puzzles.js --max-backtracks 50000 --puzzles "ladder:Killer sudoku@25-15-5"

# Does an optimization actually reduce search? (baseline vs feature-off, node ratio)
node tools/perf/benchmark_puzzles.js --max-backtracks none --puzzles "Chaos Construction: killer" \
    --compare chaos-hidden-singles

# Where does a handler spend time on this puzzle?
node tools/perf/profile.js --max-backtracks 50000 --handler Sum --puzzles "Killer sudoku"

# A whole collections.js set (e.g. the sum-heavy TAREK_ALL killers, all 42),
# best-of-3 timing per puzzle.
node tools/perf/benchmark_puzzles.js --max-backtracks none --puzzles TAREK_ALL --repeat 3

# A raw constraint string instead of a named puzzle.
node tools/perf/benchmark_puzzles.js --max-backtracks none --input ".Cage~10~R1C1~R1C2~R1C3"

# Pin the baseline before editing; keep this SHA throughout the experiment.
benchmark_ref=$(git rev-parse HEAD)
node tools/perf/bench_vs_ref.js --ref "$benchmark_ref" \
    --max-backtracks none --puzzles TAREK_ALL --repeat 5

# As a behaviour-preserving gate for a pure refactor (fails if any counter moved).
node tools/perf/bench_vs_ref.js --ref "$benchmark_ref" --require-identical \
    --max-backtracks none --puzzles TAREK_ALL --repeat 5
```

**Two kinds of A/B, two tools.** `benchmark_puzzles --compare/--ablate` toggles a
feature *within one build* (it patches a prototype at runtime) — use it to ask
"is this optimization reducing search?", where the node count is *expected* to
move. Under `--compare` it appends a per-ablation summary block: total
guess/wall-time ratios over the pairs where both sides completed,
better/worse/flat counts, any status change (a `capped <-> unique` flip is often
the most important single result), any solution mismatch, and the top guess
movers. Add `--require-same-solutions` (with `--solutions all`) as the soundness
gate for a new mechanism: it byte-compares the full solution sets of baseline
and ablation on every puzzle and exits non-zero on any difference — a capped run
also fails it, as inconclusive.

**Experiment counters flow through automatically.** Code under test can add its
own counters to the engine's `counters` object (e.g. `counters.probes` from an
initialization hook); anything beyond the engine's standard set is passed
through by the tooling — `benchmark_puzzles` shows them as extra table columns,
`extra: {...}` in `--json` rows, and per-ablation totals in the compare summary;
`profile.js` appends them to its per-puzzle line; `bench_vs_ref` includes them
in its counter-identity check on the keys both revisions report (a counter only
one side knows is a code-version difference, not a behaviour change). This is
how an experiment attributes its own cost (work done at init vs search saved)
without touching the tools. `bench_vs_ref` compares *two git revisions in separate processes*. By
default it reports both how the counters moved and the wall-time delta; add
`--require-identical` for a pure refactor where the counters must **not** move (it
then fails on any change). When counters change intentionally the wall-time ratio
compares different work, so read total ms as the end-to-end number. It consumes
`benchmark_puzzles --json` (falling back to TSV for an older `--ref`) and needs
the baseline revision to contain the benchmark harness.

Puzzle selectors are puzzle names (use any name from the examples), a
`collections.js` set name (`TAREK_ALL`, `EXTREME_KILLERS`, ... — expands to every
puzzle in that exported array), a ladder selector
`ladder:<puzzle name>[@25-15-5]` (grades any solved puzzle by revealing solution
givens in spatially-balanced order; counts are dash-separated and default to
`25-20-15-10-5`, clamped to the grid), or `input:<constraint-string>` (the
`--input` flag is shorthand).

## Extending: `../lib/extensions/`

Puzzle/handler-specific knowledge lives in `tools/lib/extensions/*.js`, loaded
dynamically by `tools/lib/solver_analysis.js`. Add capabilities by dropping in a file — no
edits to the core scripts. An extension file may export either of:

- **`ablations`** — a map of `name → { description, apply() }`. `apply()` disables
  one optimization (typically by patching a handler prototype method) and returns
  a restore function. **Disabling must keep the solver sound** — it should still
  find the correct solution, just explore more. Exposed via `benchmark_puzzles.js --ablate`
  / `--compare` and `profile.js --ablate`; list them with `benchmark_puzzles.js --list-ablations`.

  ```js
  // tools/lib/extensions/my_handler.js
  const { MyHandler } = await import('../../../js/solver/handlers.js' + self.VERSION_PARAM);
  export const ablations = {
    'my-rule': {
      description: 'My optional propagation rule.',
      apply() {
        const proto = MyHandler.prototype;
        const orig = proto._myRule;
        proto._myRule = function () { return true; };   // safe no-op for this method
        return () => { proto._myRule = orig; };
      },
    },
  };
  ```

- **`handlerModules`** — an array of module namespaces. Every exported class with
  an `enforceConsistency` method becomes profilable (`profile.js --handler` /
  `--list-handlers`). See `tools/lib/extensions/handlers.js`.

`tools/lib/solver_analysis.js` holds the puzzle-agnostic core (puzzle resolution,
the capped solve, the ablation/handler registries) and is shared by both CLIs
(and by two of the debug tools).

## Methodology

For optimizing a handler (or similar propagation component) — not a generic
refactoring checklist. The goal is a *measured* change that preserves solver
semantics: the smallest production change that improves representative wall time
without weakening required correctness.

**Measure the requested operation.** Uniqueness proof is the default benchmark;
All possibilities needs its own candidate-support run. Finding a first solution,
enumerating all solutions, and finding every supported candidate have different
stopping conditions. A bounded prefix is useful for diagnosis, but performance
claims require completion of the requested operation. Report capped runs and
status changes separately; do not add partial work to completed-set totals.

**Workflow.**

1. *Identify what is hard to prove.* For a stall visible in seconds, start with a
   short bounded profile. Capture the branch, fixed values and candidate domains;
   identify the specific unsupported value or missing deduction keeping search
   alive. Time concentrated in a handler does not by itself explain why search
   is hard. A pause in candidate discovery does not prove all candidates have
   been found, and an unsupported value in one branch may be valid globally.
2. *Know the contract and callers.* Separate semantic obligations (conflicts
   it must reject, propagation required for correctness) from propagation that is
   only a search aid. Inspect existing helpers before adding another implementation.
   For a shared utility, audit every caller and verify which handlers the selected
   puzzles actually build. Check assumptions about input representation,
   mutability and lifetime before reusing logic.
3. *Record the baseline and workload.* Resolve the baseline to a commit SHA;
   branch names and `HEAD` can move. Record working-tree changes, operation,
   puzzle names, runtime version and caps. Include the reproduction and workloads
   covering the affected consumers. Verify that they exercise the changed code.
4. *Separate propagation from implementation cost.* Test one idea at a time,
   then combinations. Compare variants that retain the old deductions but change
   traversal or caching, and variants that change deductions. This distinguishes
   extra work per call from a different search tree. Stronger propagation can
   increase guesses; combining two individually useful rules can be worse than
   either alone. Reuse the benchmark and ablation tools before writing a harness.
5. *Check cost and representation before generalizing.* Avoid adding allocation,
   string keys or per-call setup to frequent paths without measured justification.
   Preserve efficient existing cases when extending a helper. Specialize on
   mathematical or representation preconditions, not puzzle identity. For a
   simplification, account for added bookkeeping and branches as well as removed
   code. A clearer prototype is useful for testing a deduction; its runtime is
   not evidence that every implementation of the idea has the same cost.
6. *Validate answers and measure finalists.* Compare solution contents, not only
   counts; compare complete candidate sets for All possibilities. Use small
   exhaustive or randomized assignment checks when pruning logic warrants them.
   Counter identity checks measure search preservation, not correctness. Measure
   the final shared implementation too: moving logic into a utility may change
   consumers the initial prototype never exercised.
7. *Decide from the whole comparison.* Report both runtime and guesses, including
   regressions. A tradeoff can be acceptable for the user's workload, but a win on
   one puzzle or aggregate is not a general improvement. Keep only the chosen
   production behavior and meaningful contract tests. Record rejected variants
   and their evidence so they need not be rediscovered.

**Timing discipline.** Run timed variants sequentially without competing
benchmarks. Use fresh processes for revision comparisons; repeat close results
in reversed order or interleave warmed variants to reduce order effects. State
the warmup and statistic: `benchmark_puzzles --repeat` reports best `ms` plus
median/max, and `bench_vs_ref` reports both best and median ratios. A sum of
per-puzzle medians is not the median of whole-batch runs. Both currently time
search after construction; measure initialization separately if changing tables
or caches. Remove profiling wrappers for final timing. Small deltas within the
observed spread are inconclusive, even if printed with many decimal places.

**Traps.**

- **"Logically redundant" ≠ search-neutral.** A deduction also made elsewhere can
  still fire forced cells at a *different time*, shifting candidate selection and
  the whole tree. Benchmark "no useful work" cleanups; the clean evidence is flat
  node/guess counts with lower wall time. Any node-count move is a heuristic side
  effect — confirm it's a net win across the workload, not one puzzle.
- **Verify "search-preserving", don't assume it.** A cache or incremental value
  must reproduce *every* output the original fed downstream, including incidental
  ones — a tiebreak, a lowest-index choice, or iteration order can flip an
  order-sensitive consumer. Pass condition: identical search counters across the
  workload; if a counter moves, inspect the changed ordering or deductions before
  attributing the timing difference to faster code. Identical valid answers can
  still produce different search counters. To localize fast, keep both
  implementations and assert equality in-run, then remove the scaffold before
  promoting.
- **Strong in ablation, weak in production** → suspect the trigger/scheduling model
  (e.g. a singleton-triggered handler fires only when the engine schedules fixed
  cells, not on every candidate change).
- Be skeptical of lookup-table / caching / allocation wins until they show up in
  the macro benchmark.
- Avoid special-casing specific constraint types or puzzles unless it's a robust,
  theory-backed optimization.

**Experiment log.** Keep exact commands and per-puzzle results. Name the contents
of a batch rather than referring only to its size. Summaries should show completed
totals per relevant set, improved/regressed/unchanged counts, significant individual
regressions, answer checks and capped statuses. Record the baseline SHA and enough
raw data to reproduce the decision; do not put experiment history in code comments.

```markdown
## <name>
Hypothesis: <what should improve and why>
Baseline: <SHA and working-tree changes>   Runtime: <version>
Command: <exact command>   Operation / workloads / caps / seeds: <...>
Timing: <warmup, repetitions, statistic, construction included or excluded>
| puzzle / set | variant | status | wall | guesses | backtracks | nodes | answers |
Decision: promote / reject / keep investigating
```
