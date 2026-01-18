// Sandbox help text - no dependencies so it can be imported anywhere.

export const SANDBOX_HELP_TEXT = `
=== JavaScript Sandbox Help ===

  Write JavaScript to generate constraints and invoke the solver.

  The sandbox can be opened by clicking on the [JavaScript Sandbox] link or
  by the crtl+\` shortcut.

  console.log() will write to the output log. help() will display this message.

ACCEPTED RETURN VALUES

  The return value should be one of the following:
    - A constraint object (e.g. new Cage(...))
    - A constraint string (e.g. ".Cage~12~R1C1_R1C2_R1C3")
    - An array of constraints or constraint strings
    - Nothing (empty return)

  A returned constraint will be automatically loaded into the solver.

LOGGING

  console.log()         - Output to the console
  console.error()       - Output an error to the console
  console.warn()        - Output a warning to the console
  console.info()        - Update status display
  console.table(data)   - Render array of objects as a table
  solverLink(c, t)      - Pass into the console functions for link to the solver
                          c: constraint (string, object, or array)
                          t: optional link text (defaults to constraint string)

CONSTRAINT OBJECTS

  Constraint class names match their serialization names. For example:
    new Cage(sum, ...cells)
    new Thermo(...cells)

  The type of a constraint instance c can be found with c.type.

  WARNING: The APIs of these constraints may be unintuitive as they were not
           originally designed for general use. Invalid parameters may not be
           correctly handled.

  parseConstraint(constraintString) can parse a constraint string into an array
  of constraint objects. e.g. parseConstraint('.Cage~10~R1C1~R1C2')  => [Cage]

  Use help('list') to list all constraints.
  help(<constraint>) or help(<constraintClass>) will show details about those
  specific constraints.

CELL IDENTIFIERS

  Cells are identified using 'R{row}C{col}' format, with rows and columns
  starting at 1.
  e.g. 'R1C1' is the top-left cell, 'R9C9' is the bottom-right cell in a 9x9 grid

  The following convenience functions are available for working with cell IDs:
    parseCellId('R3C4')  => { row: 3, col: 4 }
    makeCellId(3, 4)     => 'R3C4'

SOLVER

  makeSolver provides programmatic access to the solver:

    const solver = await makeSolver();
    // Get the first solution, or null if none exist
    const solution = solver.solution(constraints);
    // Get the unique solution, or null if not unique
    const unique = solver.uniqueSolution(constraints);
    // Count the number of solutions, with optional limit
    const count = solver.countSolutions(constraints[, limit]);
    // Iterate over all solutions, with optional limit
    for (const s of solver.solutions(constraints[, limit])) { ... }
    // Get an array of solutions, with optional limit
    const solutions = solver.solutionArray(constraints[, limit]);

  Solution objects provide:
    solution.valueAt('R1C1')  // Get value at cell
    solution.valueAt(1, 1)    // Same, using row/col
    solution.toString()       // Short string (e.g. 81 digits for 9x9)
    for (const { cell, value } of solution) { ... }  // Iterate cells

  solver.latestStats() returns timing/counter info after each solve.

CURRENT CONSTRAINT

  currentConstraint()   - returns the current constraint in the UI.
  currentShape()        - returns the current shape in the UI.

HELP

  help()                - Display this message
  help('list')          - List all available constraint types
  help(constraintType)  - Display help for a specific constraint type
  help(constraint)      - Display help for types used in a constraint
`.trim();

export const SANDBOX_WARNING_TEXT = `
⚠️ The Sandbox API exposes internal solver details directly which were
   not originally designed for general use. There will be rough edges.
`.trim();