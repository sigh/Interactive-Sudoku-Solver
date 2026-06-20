# js/debug/ — Debug Panel & Profiling

This directory provides the debug panel UI, puzzle selector, raw-strings view, and flame graph visualization. Each is loaded lazily via the bottom drawer (see [../bottom_drawer.js](../bottom_drawer.js)) — modules are only imported when the user opens the corresponding tab.

## Files

| File | Purpose |
|------|---------|
| [debug_display.js](debug_display.js) | **Debug panel UI.** `DebugManager` renders the debug tab: solver logs, counters, and debug option toggles. Processes real-time solver updates via `getCallback()`. `InfoOverlay` displays per-cell annotations with optional heatmap coloring. |
| [puzzle_selector_panel.js](puzzle_selector_panel.js) | **Puzzle selector panel.** `PuzzleSelectorPanel` provides a searchable dropdown of example puzzles and benchmark collections; selecting one loads it into the constraint manager. Lazily loaded into its own bottom-drawer tab. |
| [flame_graph.js](flame_graph.js) | **Flame graph visualization.** `DebugFlameGraphView` renders an SVG timeline of solver activity with interactive tooltips. `FlameGraphStore` accumulates timeline samples (pruned to max 1000 nodes). |
| [raw_strings_panel.js](raw_strings_panel.js) | **Raw constraint strings panel.** `RawStringsPanel` lists the serialized string for each constraint, one per line, with composite constraints expanded and nested. Hovering a line highlights the constraint's cells on the grid. |

## Integration

The debug system connects to the solver through two mechanisms:

1. **Debug options** — `DebugManager.getOptions()` returns a config object passed to the solver via `SudokuBuilder.build()`. This controls what data the solver collects during execution.
2. **Update callback** — `DebugManager.getCallback()` returns a function that receives solver state updates (counters, logs, cell info) during and after solving.

Both are wired up in [../solution_controller.js](../solution_controller.js).

## Puzzle Loading

[puzzle_selector_panel.js](puzzle_selector_panel.js) builds its dropdown index from the example puzzles in [../../data/example_puzzles.js](../../data/example_puzzles.js) and the benchmark collections in [../../data/collections.js](../../data/collections.js). Selecting an entry resolves its config (fetching the input from a file path if needed) and loads it into the constraint manager.
