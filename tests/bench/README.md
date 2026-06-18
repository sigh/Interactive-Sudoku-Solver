# Benchmark & analysis tooling

Tools for measuring solver performance and reasoning about handler changes, plus
the methodology for using them. The tools and conventions come first; the
methodology — what to measure and the traps to avoid — is at the end.

## The tools

| Command | Purpose |
| --- | --- |
| `node tests/bench/benchmark_puzzles.js` | Run puzzles and report search counters (solutions, guesses, backtracks, nodes, wall time). The "did my change move the search / how hard is this" tool, with built-in ablation A/B. `--json` emits the same rows as a machine-readable array. |
| `node tests/bench/bench_vs_ref.js` | A/B the working tree against a baseline git revision (the cross-revision comparison the in-process ablation A/B can't do). Reports per puzzle the wall-time delta and any change in search counters. Add `--require-identical` to make it a behaviour-preserving gate that fails if any counter moved (a pure refactor); omit it when the counter change is intentional and you just want to see how search and time moved. |
| `node tests/bench/profile.js` | Per-method profile of one handler during a solve (call counts, false-returns, time). Find where a handler spends time and which rules fire. |
| `node tests/bench/run_legacy_benchmarks.js` (`npm run bench`) | The legacy micro/registered benchmark runner — discovers and runs `*.bench.js` files (lookup tables, bitset ops, etc.). Not for full-solve analysis. |

For solution content (digit grids, var cells, solution verification) and step-by-step search inspection, see [`tests/debug/`](../debug/README.md).

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
  optimization.

## Common recipes

```sh
# How hard is a puzzle (proof of uniqueness)?
node tests/bench/benchmark_puzzles.js --max-backtracks none --puzzles "Chaos Construction"

# A ladder of difficulties (capped, so a bad point can't hang the run). `ladder:`
# grades any solved puzzle by revealing solution givens; @counts is optional.
node tests/bench/benchmark_puzzles.js --max-backtracks 50000 --puzzles "ladder:Chaos Construction"
node tests/bench/benchmark_puzzles.js --max-backtracks 50000 --puzzles "ladder:Killer sudoku@25-15-5"

# Does an optimization actually reduce search? (baseline vs feature-off, node ratio)
node tests/bench/benchmark_puzzles.js --max-backtracks none --puzzles "Chaos Construction: killer" \
    --compare chaos-hidden-singles

# Where does a handler spend time on this puzzle?
node tests/bench/profile.js --max-backtracks 50000 --handler Sum --puzzles "Killer sudoku"

# A whole collections.js set (e.g. the sum-heavy TAREK_ALL killers, ~1s for all 42),
# best-of-3 timing per puzzle.
node tests/bench/benchmark_puzzles.js --max-backtracks none --puzzles TAREK_ALL --repeat 3

# A raw constraint string instead of a named puzzle.
node tests/bench/benchmark_puzzles.js --max-backtracks none --input ".Cage~10~R1C1~R1C2~R1C3"

# How did the working tree change vs HEAD? (wall time + counter deltas per puzzle).
# Same workload flags as benchmark_puzzles.
node tests/bench/bench_vs_ref.js --max-backtracks none --puzzles TAREK_ALL --repeat 5

# As a behaviour-preserving gate for a pure refactor (fails if any counter moved).
node tests/bench/bench_vs_ref.js --require-identical --max-backtracks none --puzzles TAREK_ALL --repeat 5
```

**Two kinds of A/B, two tools.** `benchmark_puzzles --compare/--ablate` toggles a
feature *within one build* (it patches a prototype at runtime) — use it to ask
"is this optimization reducing search?", where the node count is *expected* to
move. `bench_vs_ref` compares *two git revisions in separate processes*. By
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

## Extending: `extensions/`

Puzzle/handler-specific knowledge lives in `tests/bench/extensions/*.js`, loaded
dynamically by `solver_analysis.js`. Add capabilities by dropping in a file — no
edits to the core scripts. An extension file may export either of:

- **`ablations`** — a map of `name → { description, apply() }`. `apply()` disables
  one optimization (typically by patching a handler prototype method) and returns
  a restore function. **Disabling must keep the solver sound** — it should still
  find the correct solution, just explore more. Exposed via `benchmark_puzzles.js --ablate`
  / `--compare` and `profile.js --ablate`; list them with `benchmark_puzzles.js --list-ablations`.

  ```js
  // extensions/my_handler.js
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
  `--list-handlers`). See `extensions/handlers.js`.

`solver_analysis.js` holds the puzzle-agnostic core (puzzle resolution, the capped
solve, the ablation/handler registries) and is shared by both CLIs.

## Methodology

For optimizing a handler (or similar propagation component) — not a generic
refactoring checklist. The goal is a *measured* change that preserves solver
semantics: the smallest production change that improves representative wall time
without weakening required correctness.

**Metric rule (non-negotiable).** Optimize for proof of uniqueness (see
Conventions), never first-solution behaviour — don't use first-solution timing,
guesses, or search shape as evidence, even as a quick diagnostic. Compare only
runs that complete the proof (`unique`); a `capped` run is an incomplete proof,
not a win/loss ranked by how much work it did.

**Workflow.**

1. *Know the contract.* Separate the handler's semantic obligations (contradictions
   it must reject, propagation required for correctness) from propagation that is
   only a search aid. Arc-consistency, hidden singles, Hall/distance/graph checks
   are usually optional aids; cheap contradiction checks that prune early usually
   earn their keep. Keep a correctness-required rule even if expensive — optimize
   its implementation, don't remove it.
2. *Measure before changing.* Use a fast correctness-sized case plus ≥1 realistic
   puzzle (or a calibrated ladder if the real one is too slow — keep the real one
   in the set too, and order ladder givens spatially rather than front-loaded).
   Record the cap with every result.
3. *Ablate one rule at a time* with `--ablate`/`--compare`. Prototype an expensive
   rule in its clearest form first; only invest in implementation tuning or gating
   once it's shown to help. Test combinations after singles — propagation effects
   are non-additive. Compare micro **and** macro: a faster single propagation that
   grows total search is a loss.
4. *Promote* only if it improves completed proof runs or turns capped runs into
   completed ones, without losing required contradictions. Keep experimental
   variants in `extensions/`; production holds only the chosen behaviour. Update
   tests to assert the contract (contradictions kept; propagation intentionally
   removed stays removed). Re-run finalist ablations afterwards — a new baseline can
   make other variants newly viable or newly risky.

**Traps.**

- **"Logically redundant" ≠ search-neutral.** A deduction also made elsewhere can
  still fire forced cells at a *different time*, shifting candidate selection and
  the whole tree. Benchmark "no useful work" cleanups; the clean evidence is flat
  node/guess counts with lower wall time. Any node-count move is a heuristic side
  effect — confirm it's a net win across the workload, not one puzzle.
- **Verify "behaviour-preserving", don't assume it.** A cache or incremental value
  must reproduce *every* output the original fed downstream, including incidental
  ones — a tiebreak, a lowest-index choice, or iteration order can flip an
  order-sensitive consumer. Pass condition: identical search counters across the
  workload; if any counter moves it isn't equivalent — find out why before judging
  speed. To localize fast, keep both implementations and assert equality in-run,
  then remove the scaffold before promoting.
- **Tiny case helps, representative case hurts** → don't promote.
- **Strong in ablation, weak in production** → suspect the trigger/scheduling model
  (e.g. a singleton-triggered handler fires only when the engine schedules fixed
  cells, not on every candidate change).
- Be skeptical of lookup-table / caching / allocation wins until they show up in
  the macro benchmark.
- Avoid special-casing specific constraint types or puzzles unless it's a robust,
  theory-backed optimization.

**Experiment log.** Keep a short note per experiment so rejected ideas (and why)
aren't rediscovered:

```markdown
## <name>
Hypothesis: <what should improve and why>
Command: <exact command>   Workloads: <puzzles, caps, seeds>
| variant | wall | guesses | backtracks | nodes | notes |
Decision: promote / reject / keep investigating
```
