import { SudokuConstraint } from '../sudoku_constraint.js';
import { GridShape, SHAPE_9x9, SHAPE_MAX } from '../grid_shape.js';
import { javascriptSpecToNFA, NFASerializer } from '../nfa_builder.js';

const HELP_TEXT = `
=== Constraint Sandbox Help ===

Return values:
  - A SudokuConstraint object (e.g. new SudokuConstraint.Cage(...))
  - A constraint string (e.g. ".Cage~12~R1C1_R1C2_R1C3")
  - An array of constraints or constraint strings

Available globals:
  SudokuConstraint  - Create constraint objects
  GridShape         - Define grid dimensions
  SHAPE_9x9         - Standard 9x9 grid shape
  SHAPE_MAX         - Maximum supported grid shape (16x16)
  javascriptSpecToNFA - Convert JS spec to NFA for custom constraints
  NFASerializer     - Serialize NFA for use in constraints

SudokuConstraint types:
  new SudokuConstraint.Renban(...cells)
  new SudokuConstraint.Thermo(...cells)
  new SudokuConstraint.Cage(sum, ...cells)
  new SudokuConstraint.Arrow(circleCell, ...lineCells)
  new SudokuConstraint.Killer(sum, ...cells)
  new SudokuConstraint.AntiKnight()
  new SudokuConstraint.AntiKing()
  new SudokuConstraint.DiagonalPlus()
  new SudokuConstraint.DiagonalMinus()
  new SudokuConstraint.Set(constraintsArray)
  new SudokuConstraint.NFA(encodedNFA, label, ...cells)
  ... and more

Cell format: 'R1C1' (row 1, column 1) through 'R9C9'

NFA spec format:
  {
    startState: <initial state>,
    transition: (state, value) => <new state or undefined to reject>,
    accept: (state) => <boolean>
  }

Use console.log() for debug output.
Use help() function to display this message.
`.trim();

function help() {
  console.log(HELP_TEXT);
}

// Export globals to window
Object.assign(window, {
  SudokuConstraint,
  GridShape,
  SHAPE_9x9,
  SHAPE_MAX,
  javascriptSpecToNFA,
  NFASerializer,
  help,
});
