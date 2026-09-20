# Estimating the Number of Solutions

Estimate mode samples the search tree when counting every solution would take
too long. It follows random guesses, then tries to count the remaining subtree
exactly. That subtree is called the **tail**.

The implementation is `InternalSolver.estimatedCountSolutions` in
[engine.js](engine.js), with random path selection in
[candidate_selector.js](candidate_selector.js).

## One sample

At each guess, choose one of the selected cell's candidates at random. Keep the
product of the candidate counts: this is the **path weight**. For example,
choosing among 3 candidates and then 2 gives a path weight of 6.

Previous samples suggest how many guesses are needed before exact counting
can fit the budget (see below). At that depth, save the grid and try to count
all remaining solutions. If that search reaches
its limit before finishing, discard its partial count and resume from the saved
state. Make one more random guess, then retry with half the previous budget,
rounded down. Once the budget reaches zero, continue sampling to a solution or
conflict.

Every sample returns:

    sample estimate = path weight × endpoint solution count

The endpoint count is 0 for a conflict, 1 for a solution, or the full count of
a completed tail search. A sample that makes no random guesses gives the exact
count for the whole puzzle, so the run stops.

## Why the sample estimates the count

With uniform random choices, a path with candidate counts 3 and 2 is selected
with probability 1/6 and has weight 6. Multiplying the two gives 1: each
solution contributes one to the expected estimate. Counting a tail includes
all its solutions at once, multiplied by the weight of the guesses made so far.
This is Knuth sampling with exact tails.

After an exact search runs out of budget, the next random guess is still
uniform. Discarding the partial count avoids counting those solutions twice.
Cell selection, tail depth, and budgets may depend on earlier work without
changing the expected value of the next sample.

This argument assumes uniform, independent choices and exact arithmetic; the
implementation uses a seeded pseudorandom generator and JavaScript numbers.

## Choosing the tail depth and budget

The solver records estimated search cost at each guess depth. A completed
sample records one for a solution or conflict, or the number of backtracks in
a completed tail search. Multiplying by the candidate counts at earlier guesses
estimates how much work exact counting would have taken from those points.

An exact search that runs out of budget needs at least that much work to finish.
Use the first such attempt to raise any lower cost estimates, multiplying by
candidate counts for earlier guesses as above. This helps avoid retrying exact
counting too early; it does not change the estimated solution count.

For the next sample, choose the shallowest depth whose mean recorded cost is
below the budget. If none qualifies, keep guessing until a solution or conflict.

The budget grows in groups of samples called **levels**:

    level = floor(completed samples / samples per level)
    tail budget = max(1, min(2^level, floor(work so far × work fraction)))

Work and budgets are measured in backtracks. The work cap prevents one tail
attempt from costing far more than the preceding samples. Retrying with halved
budgets spends less than twice the initial tail budget in total, plus the work
of following the random path. This bounds backtracks, not elapsed time.

As budgets grow, exact searches can start closer to the root. Once a root search
finishes, the result is exact. The time needed depends on the cost estimates
and the search tree; there is no fixed overhead relative to direct counting.

## Combining samples

Later levels receive more weight because their larger budgets allow more exact
search. For sample index `i`, starting at zero:

    level(i) = floor(i / samples per level)
    averaging weight(i) = 2^level(i)
    estimate = Σ(averaging weight(i) × sample estimate(i)) / Σ averaging weight(i)

These averaging weights are separate from each sample's path weight. They
depend only on the sample index, not on its result or actual search cost.

The code gives each new sample weight 1 and halves both accumulated sums every
64 samples. This produces the same mean without exponentially growing weights.

Under the sampling assumptions above, the weighted mean is unbiased at a
predetermined sample count if sampling continues to that count. Stopping based
on elapsed time, observed results, or early exact completion does not preserve
that guarantee across runs. Any result marked exact is the true count.

## Results and limitations

Every solver state snapshot during and after estimation contains
`estimate = { solutions, samples, tails, exact }`:

- `solutions`: the current estimate, or exact count.
- `samples`: the number of samples included in the weighted mean.
- `tails`: the number of samples ending in a completed tail search, including
  a final exact root search.
- `exact`: whether the whole puzzle's count is known. The display omits `~`
  only in this case.

The internal estimator owns and initializes this result for each run; state
snapshots copy it. `done` becomes true only when the whole count is exact.
Reaching a sample limit leaves it false, even if the last tail was fully counted.

Rare paths can lead to subtrees with many solutions. Until one is reached, an
estimate can stay low and look stable, then jump. Stability alone is not proof
of accuracy. No error bar is shown because sample-based errors can miss these
unvisited subtrees.

Exact tails reduce this problem by counting groups of solutions together.
They also add work, and the doubling weights keep roughly three levels' worth
of effective samples. On trees where plain sampling already works well, this
can give worse precision for the same runtime. More samples help when larger
budgets reduce the variation between samples; runtime alone is no guarantee.

## Settings

| Setting | Value | Purpose |
| --- | --- | --- |
| `ESTIMATE_SAMPLES_PER_LEVEL` | 64 | Samples per level. |
| `ESTIMATE_SAMPLE_WORK_FRACTION` | 1/16 | Fraction of backtracks so far available for the next sample's first exact search. |
| Random seed | 0 | Reproduces the same run for the same puzzle and sample limit. |

## Validation

`tests/solver/engine.test.js` enumerates every possible random choice on a small
tree and checks that the probability-weighted sample estimates equal its exact
count. Cases cover plain paths, completed tails, retries, and fallback to
sampling. Other tests cover level weighting, long-run overflow, exact results,
and deterministic seeds.

`tools/perf/estimator_lab.js` compares experimental strategies on puzzles with
known counts. To compare production behavior, call
`InternalSolver.estimatedCountSolutions(maxSamples, seed)` directly;
the lab does not currently expose it as a strategy. Earlier investigations are
in `_notes/roadmap/deep-dives/counting/`.
