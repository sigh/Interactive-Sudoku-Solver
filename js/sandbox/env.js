import { SudokuConstraint } from '../sudoku_constraint.js';
import { SudokuParser } from '../sudoku_parser.js';
import { SudokuBuilder } from '../solver/sudoku_builder.js';
import { GridShape, SHAPE_9x9, SHAPE_MAX } from '../grid_shape.js';

const HELP_TEXT = `
=== Constraint Sandbox Help ===

ACCEPTED RETURN VALUES

  Your code should return one of the following:
    - A constraint object (e.g. new Cage(...))
    - A constraint string (e.g. ".Cage~12~R1C1_R1C2_R1C3")
    - An array of constraints or constraint strings

CELL IDENTIFIERS

  Cells are identified using 'R{row}C{col}' format, with rows and columns
  starting at 1.
  e.g. 'R1C1' is the top-left cell, 'R9C9' is the bottom-right cell in a 9x9 grid

  The following convenience functions are available for working with cell IDs:
    parseCellId('R3C4')  => { row: 3, col: 4 }
    makeCellId(3, 4)     => 'R3C4'

CONSTRAINT OBJECTS

  Constraint class names match their serialization names. For example:
    new Cage(sum, ...cells)
    new Thermo(...cells)

  The type of a constraint instance c can be found with c.type.

  parseConstraint(constraintString) can parse a constraint string into an array
  of constraint objects. e.g. parseConstraint('.Cage~10~R1C1~R1C2')  => [Cage]

  Use help('<ConstraintName>') for details on a specific constraint.

UTILITIES

  Use console.log() for debug output.
  Use help() function to display this message.
`.trim();

const getConstraintList = () => {
  const byCategory = {};
  for (const [name, cls] of Object.entries(SudokuConstraint)) {
    if (typeof cls !== 'function') continue;
    if (!cls.CATEGORY || cls.CATEGORY === 'Experimental') continue;
    (byCategory[cls.CATEGORY] ||= []).push(name);
  }

  let output = '\nCONSTRAINTS BY CATEGORY\n';
  for (const [category, names] of Object.entries(byCategory).sort()) {
    output += `\n  ${category}:\n`;
    output += '    ' + names.sort().join(', ') + '\n';
  }
  return output;
};

const getConstructorArgs = (cls) => {
  const match = String(cls).match(/constructor\s*\(([^)]*)\)/);
  return match?.[1]?.trim() || '';
};

const help = (arg) => {
  const cls = arg && SudokuConstraint[arg];
  if (cls) {
    const args = getConstructorArgs(cls);
    console.log(`${arg}${args ? `(${args})` : ''}`);
    if (cls.DESCRIPTION) {
      console.log('\n  ' + cls.DESCRIPTION.trim().replace(/\s+/g, ' '));
    }
    if (cls.CATEGORY) {
      console.log(`\n  Category: ${cls.CATEGORY}`);
    }
  } else {
    if (arg) {
      console.error(`Unknown constraint: '${arg}'\n`);
    }
    console.log(HELP_TEXT);
    console.log(getConstraintList());
  }
  console.log();
};

const parseCellId = (cellId) => {
  const parsed = SHAPE_MAX.parseCellId(cellId);
  return {
    row: parsed.row + 1,
    col: parsed.col + 1,
  };
};

const makeCellId = (row, col) => SHAPE_MAX.makeCellId(row - 1, col - 1);

const parseConstraint = (str) => {
  const parsed = SudokuParser.parseString(str);
  const resolved = SudokuBuilder.resolveConstraint(parsed);
  if (resolved.type === 'Set') return resolved.constraints;
  return [resolved];
};

export const SANDBOX_GLOBALS = {
  parseConstraint,
  parseCellId,
  makeCellId,
  help,
  SHAPE_9x9,
  SHAPE_MAX,
  GridShape,
  ...SudokuConstraint,
};