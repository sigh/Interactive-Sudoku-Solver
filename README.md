# Interactive Sudoku Solver (ISS)

A fast web-based solver for Sudoku puzzles and variants. It prioritizes
raw speed over human-style solving techniques to allow exploration of complex
solution spaces.

It is hosted at <http://sigh.github.io/Interactive-Sudoku-Solver>

## Features

- **Solution Analysis**: Verifies uniqueness, visualizes candidate densities
  and provides solution counts, including estimates for large solution spaces.
- **Extensive Variants**: Supports a large number of constraints found
  in Sudoku variants, with flexible tools for defining custom constraints.
- **Non-Standard Grids**: Supports any grid size up to 16x16, including
  non-square grids.
- **Scripting**: Provides a JavaScript Sandbox for programmatic puzzle
  generation and solving.

See the [help page](http://sigh.github.io/Interactive-Sudoku-Solver/help) for
more extensive documentation.

## Running locally

Run locally using [Jekyll](https://jekyllrb.com/), e.g.

```bash
jekyll serve --port=8080
```

## Tests

Execute the test suite with:

```bash
npm test
```

## Contributions

Contributions are welcome including:

- New constraints/variants
- Solver optimizations
- UI improvements
- Bug fixes
- Code health and documentation
