# js/help/ — Constraint Reference Documentation

This directory contains the code that generates the interactive help/reference page for all supported constraint types.

## Files

| File | Purpose |
|------|---------|
| [help.js](help.js) | **Help page renderer.** `renderHelpPage()` auto-generates the constraint reference from metadata on each `SudokuConstraintBase` subclass (`CATEGORY`, `DESCRIPTION`, `DISPLAY_CONFIG`). Groups constraints into 10 categories defined in `CATEGORY_CONFIGS`. Renders category overviews with anchor links, individual constraint sections, and adds copy buttons to code examples. |

## How It Works

The help page is entirely auto-generated from the constraint type definitions in [../sudoku_constraint.js](../sudoku_constraint.js). Each constraint class declares metadata that the help renderer reads:

- `CATEGORY` — Which group the constraint belongs to (e.g., `LinesAndSets`, `Pairwise`, `OutsideClues`).
- `DESCRIPTION` — Human-readable description (supports HTML).
- `DISPLAY_CONFIG` — How the constraint renders on the grid (used to generate preview icons).

Adding a new constraint type with these fields automatically adds it to the help page — no manual documentation needed.

The rendered output populates the `#categories-content` and `#constraints-content` DOM elements in [../../help/index.html](../../help/index.html).
