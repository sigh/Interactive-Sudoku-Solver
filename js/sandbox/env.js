import { SudokuConstraint } from '../sudoku_constraint.js';
import { GridShape, SHAPE_9x9, SHAPE_MAX } from '../grid_shape.js';
import { javascriptSpecToNFA, NFASerializer } from '../nfa_builder.js';

const HELP_TEXT = `
Available globals:
  SudokuConstraint  - Create constraint objects (Renban, Cage, Thermo, etc.)
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

Usage:
  Return a constraint object or string to generate the constraint.
  Use console.log() for debug output.

Examples: Use the "Load example..." dropdown to see working examples.
`;

function help() {
  console.log(HELP_TEXT.trim());
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
