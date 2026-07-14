// Sandbox help text - no dependencies so it can be imported anywhere.

export const SANDBOX_HELP_TEXT = `
=== JavaScript Sandbox Help ===

  Write JavaScript to generate constraints and invoke the solver.

  The sandbox can be opened from the settings menu in the top-right or
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

  Sum cells may be [cell, coeff] pairs (bare cells have coefficient 1):
    new Sum(0, 'R1C1', 'R1C2', ['VK1', -1])   => R1C1 + R1C2 - VK1 = 0

  A Var constraint exposes its member cell ids:
    new Var('F', 'flags', 23).cells()      => ['VF1', ..., 'VF23']
    new Var('F', 'flags', 23).cell(5)      => 'VF5'  (bare 'VF' when count is 1)

  Outside clues (LittleKiller, Sandwich, XSum, ...) take a canonical arrowId,
  often not the cell nearest the drawn clue. Build one from its line of cells:
    LittleKiller.fromCells(15, cellGraph('9x9').ray('R1C4', 1, 1), cellGeometry('9x9'))

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
    makeCellId({ row: 3, col: 4 }) => 'R3C4'
    makeCellId(parseCellId('R3C4')) => 'R3C4'

CELL GEOMETRY

  The cell geometry is configured by the Shape and Var constraints.

    cellGeometry('6x6')  => CellGeometry. Also accepts a grid size (cellGeometry(9),
                            cellGeometry(6, 9) = rows x cols), a Shape constraint, a
                            CellGeometry, or nothing for the default grid.
    cellGraph('6x6')     => cell graph for the geometry (same argument as cellGeometry()).
                            Most methods work in cell ids:
      .gridGeometry()          the underlying CellGeometry (numRows, numValues, ...)
      .cells()                 all cells of the main grid
      .neighbours(cell)        orthogonally-adjacent in-grid cells
      .kingNeighbours(cell)    the up-to-8 in-grid king-move neighbours
      .step(cell, dR, dC)      the cell (dR, dC) away, or null off-grid
      .ray(cell, dR, dC)       cells to the grid edge, inclusive of cell
      .row(n | cell)           the whole grid row, by 1-based index or through cell
      .column(n | cell)        the whole grid column, likewise
      .box(n[, size])          the nth box region (1-based, reading order)
      .rows() / .columns() / .boxes([size]) / .houses([size])  all such cell lists
                               size matches a RegionSize constraint
      .block(topLeft, h, w)    cells of an h x w block, or null if off-grid
      .connected(cells)        is the set one orthogonally-connected group?
      .makeReplicate(constraintOrArray[, cells])  build a Replicate using this
                            graph; cells defaults to .cells()
      .makeOverlay(prefix[, cells])  a cell graph over a var group (e.g. 'CC',
                            'VL'), connected as its paired grid cells are; adds
                            .at(cell) / .gridAt(varCell), each null if unpaired,
                            and .toVar(label) -> the matching Var (V-prefix only)

STATE MACHINES (NFA)

    NFA.encodeSpec(spec, numValues[, opts])  => compile a state machine to an NFA.
      spec                   { startState, transition, accept[, maxDepth] }
      numValues              a count, or a CellGeometry / Shape constraint
                             (which also supplies the default valueOffset);
                             Pair.fnToKey accepts the same forms
      opts.multiSegment      Compile with segments, with SEGMENT_BREAK passed into
                             transition
      opts.valueOffset       offset added to cell values before transition, e.g.
                             -1 for a 0-based grid. Default 0.
    new NFA(encoded, name, ...cells)         => apply over an ordered cell list.
    new NFA(encoded, name, ...cellArrays)    => apply over segments; encoded
                                                must have been compiled with
                                                opts.multiSegment must be set

    See help/custom-constraints.html for the full state-machine semantics.

REPLICATE

  Replicate stamps a template of child constraints onto many targets

    Replicate.encodeTargetCells(targets, origin, locator)  => target bitset
      locator: a cellGraph()/makeOverlay() (or CellGeometry) owning the cell ids;
               origin must not come after any target.

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
    const solutions = [...solver.solutions(constraints[, limit])];
    // Get true candidates (values appearing in valid solutions)
    const candidates = solver.trueCandidates(constraints[, limit]);

  Solution objects provide:
    solution.valueAt('R1C1')  // Get value at cell
    solution.valueAt(1, 1)    // Same, using row/col
    solution.toString()       // Short string (e.g. 81 digits for 9x9)
    for (const { cell, value } of solution) { ... }  // Iterate cells

  TrueCandidates objects provide:
    candidates.valuesAt('R1C1')    // Array of candidate values at cell
    candidates.countAt('R1C1', 5)  // Count for value 5 at cell (capped to limit)
    candidates.witnessSolutions    // Array of witness Solution objects
    for (const { cell, value, count } of candidates) { ... }  // Iterate

  solver.latestStats() returns timing/counter info after each solve.

CURRENT CONSTRAINT

  currentConstraint()   - returns the current constraint in the UI.
  currentCellGeometry() - returns the current geometry in the UI.

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
