# js/debug/ — Debug Panel & Profiling

This directory provides the debug panel UI, solver benchmarking, and flame graph visualization. The debug panel is loaded lazily via the bottom drawer (see [../bottom_drawer.js](../bottom_drawer.js)) — modules are only imported when the user opens the debug tab.

## Files

| File | Purpose |
|------|---------|
| [debug.js](debug.js) | **Debug module core.** Loads test data (puzzle collections, layouts) and provides `loadInput(puzzleCfg)` to load puzzles into the constraint manager. `runAll(puzzles)` benchmarks a set of puzzles and returns solutions + stats. `progressBenchmarks()` logs solver performance metrics. |
| [debug_display.js](debug_display.js) | **Debug panel UI.** `DebugManager` renders the debug tab: solver logs, counters, puzzle selector dropdown, and debug option toggles. Processes real-time solver updates via `getCallback()`. `InfoOverlay` displays per-cell annotations with optional heatmap coloring. |
| [flame_graph.js](flame_graph.js) | **Flame graph visualization.** `DebugFlameGraphView` renders an SVG timeline of solver activity with interactive tooltips. `FlameGraphStore` accumulates timeline samples (pruned to max 1000 nodes). |

## Integration

The debug system connects to the solver through two mechanisms:

1. **Debug options** — `DebugManager.getOptions()` returns a config object passed to the solver via `SudokuBuilder.build()`. This controls what data the solver collects during execution.
2. **Update callback** — `DebugManager.getCallback()` returns a function that receives solver state updates (counters, logs, cell info) during and after solving.

Both are wired up in [../solution_controller.js](../solution_controller.js).

## Puzzle Loading

[debug.js](debug.js) can load puzzles from the collections in [../../data/collections.js](../../data/collections.js) and [../../data/example_puzzles.js](../../data/example_puzzles.js). The `runAll()` function iterates a puzzle set, solving each and collecting timing/correctness data for benchmarking.
