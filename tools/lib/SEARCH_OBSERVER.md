# Search observation

`observeSolver(solver, context => hooks, interventions?)` attaches instrumentation
to an existing solver and returns a disposer. Return it from `runSolve`'s setup
callback to restore instrumentation after success or an exception:

```js
runSolve(puzzle, budgets, solver => observeSolver(solver, context => ({
  afterSelection(selection) {
    console.log(selection.cells, context.counters());
  },
})));
```

No trace, solution collection, fingerprint or experiment policy is enabled by the
observer. Only requested event types are instrumented. Event callbacks run
synchronously; `context.grid` and `context.cellOrder` are live read-only views.
Use `snapshot()`, `scoreState()`, `counters()`, `valuePreference()` or
`ranking(depth)` for copies. Grid access is valid at selection and propagation
callbacks and the score updates following them. Snapshots include handler storage,
active frames and stored selection state, but are not restorable checkpoints or
captures of every handler's private fields.

| Hook | Timing and data |
|---|---|
| `branch(descriptor)` | Fresh multi-way branch, before assignment and any override. Uses the selector's decision hook; includes custom placement branches. |
| `beforeSelection({depth, fresh})` | Before selection and its score demotion. Return `{explain: true}` for this selection's ranking, placement search and demotions. |
| `afterSelection(selection, explanation)` | Actual selection, including retries and forced batches. Contains the complete ordered `cells`, chosen value/count and placement state. |
| `beforePropagation()` | Assignment already applied. Return `{eliminated: true}` to count removed candidates; `{reductions: true}` also copies changed domains; `{refuter: true}` identifies the failing handler. |
| `afterPropagation(event)` | Always includes `conflict`; requested measurements are optional fields. |
| `beforeIncrement({cell, value})` | Before conflict-score update. |
| `afterIncrement(event)` | Includes `applied`, `creditedCell`, `creditedValue`. Nested decay has already occurred. |
| `scoreChange(event)` | Demotion/decay with copied before/after scores and `applied`. |
| `solution()` | Before the solve's solution callback. |

Observation callbacks do not change decisions or scores. The separate
`interventions` object accepts `branch(descriptor)` returning a `{cell, value}`
override, `increment(event)` returning another score recipient or `false` to skip,
and `demote`/`decay` returning `false` to skip. Undefined preserves normal behavior.
Branch overrides use the selector's validation and are disabled by the solver in
step mode. A pre-existing decision hook is rejected instead of silently replaced.

`scoreCell` and `rankCells` share the diagnostic scoring formula with step analysis.
Detailed explanations observe the actual selector; diagnostic rankings alone do
not establish which placement branch wins.

# Comparing executions

`search_divergence.js` exports `compareSearches(puzzle, budgets, apply, {maxEvents})`.
`apply()` installs a variant and returns its restoration function. Reports contain
the first different selection, propagation outcome, conflict or solution event,
search counters, and comparison status. Both solves retain their own completion
status; digit solution sets are checked only when both exhaust. Auxiliary-cell
assignments are not part of that solution comparison.

The event limit bounds retained comparison events, not solve duration. Matching
events do not imply matching domains or scores. Alignment ends at divergence;
subsequent event indexes are not corresponding nodes. Instrumented elapsed times
are omitted; use the performance tools for runtime comparisons.
