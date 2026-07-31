# Interactive Sudoku Solver (ISS)

A fast web-based solver for Sudoku puzzles and variants. It prioritizes
raw speed over human-style solving techniques to allow exploration of complex
solution spaces.

It is hosted at <http://sigh.github.io/Interactive-Sudoku-Solver>

## Features

- **Sudoku Variants**: Supports a large number of constraints natively, and
  the ability to define custom constraints.
- **Non-Standard Grids**: Supports any grid size up to 16x16, including
  non-square grids.
- **Explore Solution Spaces**: Verifies uniqueness and provides solution
  counts, including estimates for large solution counts.
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

```bash
npm test
```

## Docs

For the main app and solver docs, see [js/README.md](js/README.md),
[js/solver/README.md](js/solver/README.md),
[js/solver/SOLVER_ENGINE.md](js/solver/SOLVER_ENGINE.md).

## AI Usage

The main application and solver has historically been hand-coded. More recently it uses AI-assistance with close review.

The development tooling and technical documentation are mostly AI-generated,
with oversight mainly to ensure correctness.

The tests are almost entirely AI-generated with little oversight. The exception
is the e2e test suite which is manually-curated.

## Contributions

Contributions are welcome including:

- New constraints/variants
- Solver optimizations
- UI improvements
- Bug fixes
- Code health and documentation
