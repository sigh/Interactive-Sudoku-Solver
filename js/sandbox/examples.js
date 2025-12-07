// Extract function body as string, removing wrapper and common indentation.
const fnToCode = (fn) => {
  const lines = fn.toString().split('\n').slice(1, -1);
  // Find minimum indentation (ignoring empty lines).
  const minIndent = lines
    .filter(line => line.trim())
    .reduce((min, line) => Math.min(min, line.match(/^\s*/)[0].length), Infinity);
  // Remove the common indentation.
  return lines.map(line => line.slice(minIndent)).join('\n');
};

const DEFAULT_CODE_FN = () => {
  // Create a miracle sudoku
  // (https://www.youtube.com/watch?v=yKf9aUIxdb4)
  const constraints = [
    new AntiKnight(),
    new AntiKing(),
    new AntiConsecutive(),
    new Given('R5C3', 1),
    new Given('R6C7', 2),
  ];

  console.log('Creating ', constraints.length, 'constraints', '\n');

  help();  // Usage instructions

  return constraints;
};

const SHAPE_FN = () => {
  // Create a 6x6 Sudoku
  return [
    new Shape('6x6'),
    new Given('R1C5', 4),
    new Given('R2C2', 1),
    new Given('R2C4', 3),
    new Given('R2C6', 5),
    new Given('R3C4', 2),
    new Given('R4C3', 3),
    new Given('R5C1', 6),
    new Given('R5C3', 2),
    new Given('R5C5', 5),
    new Given('R6C2', 5),
  ];
};

const COLUMN_CONSTRAINTS_FN = () => {
  // Puzzle: https://sudokupad.app/gdc/flat-pack/gw
  // Generate constraints for each column
  const columnConstraints = [];
  const gridSize = 6;

  // A constraint for each column.
  for (let column = 1; column <= gridSize; column++) {
    const cells = [];
    for (let row = 1; row <= gridSize; row++) {
      cells.push(makeCellId(row, column));
    }
    columnConstraints.push(new Regex('.*(12|24).*', ...cells));
  }

  return [
    ...columnConstraints,
    new Shape('6x6'),
    new Whisper(3, 'R1C1', 'R2C1', 'R3C1', 'R4C1', 'R5C1'),
    new Whisper(3, 'R6C3', 'R5C4', 'R6C5'),
    new Whisper(3, 'R2C4', 'R3C5', 'R4C4', 'R3C3', 'R2C4'),
  ];
};

const COMPOSITE_CONSTRAINT_FN = () => {
  // Composite constraint (https://sudokupad.app/1i71uad30f)

  const lines = ['R9', 'C9'];
  const orParts = [];
  for (let i = 1; i <= 9; i++) {
    const andParts = [];
    for (const line of lines) {
      andParts.push(new HiddenSkyscraper(line, i));
    }
    orParts.push(new And(andParts));
  }
  const orConstraint = new Or(orParts);

  // Example of just extra existing serialized constraints.
  // (For example, copied from the ISS UI).
  const base = '.HiddenSkyscraper~C4~8~.HiddenSkyscraper~C5~8~.HiddenSkyscraper~C6~8~.HiddenSkyscraper~C7~6~.HiddenSkyscraper~R2~2~2.HiddenSkyscraper~R7~~5.HiddenSkyscraper~C2~~6.HiddenSkyscraper~C3~~7.HiddenSkyscraper~R1~3~.HiddenSkyscraper~R3~1~.HiddenSkyscraper~R4~7~.HiddenSkyscraper~R5~7~.HiddenSkyscraper~R6~7~';

  return [base, orConstraint];
};

const STATE_MACHINE_FN = () => {
  // Arithmetic progression NFA
  // All differences between consecutive cells must be equal
  const spec = {
    startState: { lastVal: null, diff: null },
    transition: (state, value) => {
      if (state.lastVal === null) {
        return { lastVal: value, diff: null };
      }
      const diff = value - state.lastVal;
      if (state.diff === null || state.diff === diff) {
        return { lastVal: value, diff: diff };
      }
      // Invalid - difference doesn't match
      return undefined;
    },
    accept: (state) => true,
  };

  const encodedNFA = NFA.encodeSpec(spec, /* numValues= */ 9);
  return [
    new NFA(encodedNFA, 'AP', 'R7C4', 'R8C4', 'R9C4', 'R9C5', 'R9C6', 'R8C6', 'R7C6', 'R7C7'),
    new NFA(encodedNFA, 'AP', 'R1C5', 'R2C4', 'R3C3', 'R3C4'),
    new NFA(encodedNFA, 'AP', 'R4C3', 'R5C2', 'R5C3', 'R6C2', 'R7C1', 'R7C2'),
    new NFA(encodedNFA, 'AP', 'R3C5', 'R4C5', 'R5C5', 'R6C5'),
    new NFA(encodedNFA, 'AP', 'R4C7', 'R5C8', 'R5C7'),
    new NFA(encodedNFA, 'AP', 'R6C8', 'R7C9', 'R7C8'),
    new NFA(encodedNFA, 'AP', 'R2C6', 'R3C7', 'R3C6'),
    new Given('R7C5', 1),
    new Given('R8C5', 9),
    new Given('R3C1', 1),
    new Given('R3C2', 2),
    new Given('R5C9', 2),
    new Given('R6C9', 4),
  ];
};

const MODIFYING_CONSTRAINTS_FN = () => {
  // Parse existing constraints and modify them.

  // This example creates "Ambiguous Arrows" for https://sudokupad.app/i20kqjopap
  // In this puzzle, the bulb of the arrow can appear in any location.

  // First we create the puzzle in the UI, as if it had normal Arrow constraints.
  const base = '.~R1C2_6~R1C3_2~R4C4_7~R6C6_3~R6C3_1~R7C4_4~R8C2_2~R8C1_1~R7C1_5~R9C7_2~R9C8_4~R4C7_5~R3C6_9~R2C8_6~R2C9_5~R3C9_1.Arrow~R1C1~R1C2~R1C3~R1C4.Arrow~R1C8~R2C8~R3C8.Arrow~R1C9~R2C9~R3C9~R4C9.Arrow~R2C7~R3C7~R4C7.Arrow~R4C3~R4C4~R4C5.Arrow~R6C3~R7C3~R8C3.Arrow~R7C2~R8C2~R9C2.Arrow~R6C1~R7C1~R8C1~R9C1.Arrow~R9C6~R9C7~R9C8~R9C9.Arrow~R6C5~R6C6~R6C7';

  const result = [];

  // Then we parse the constraints, and update them to create the ambiguous
  // versions.
  for (const c of parseConstraint(base)) {
    if (c.type === 'Arrow') {
      // Create a rotated version of the arrow for each cell.
      const cells = [...c.cells];
      const group = [];
      for (let i = 0; i < cells.length; i++) {
        group.push(new Arrow(...cells));
        cells.push(cells.shift());
      }
      result.push(new Or(group));
    } else {
      // Keep other constraints as-is.
      result.push(c);
    }
  }

  return result;
};

const CHECKERBOARD_FN = () => {
  // Generate a checkerboard min/max grid.
  // Cells alternate between local minima and maxima.
  // Note: This grid has no solutions.

  const size = 5;
  const constraints = [new Shape('5x5')];

  for (let row = 1; row <= size; row++) {
    for (let col = 1; col <= size; col++) {
      // On even squares, cell is greater than neighbors.
      // On odd squares, cell is less than neighbors.
      const isMax = (row + col) % 2 === 0;
      const cell = makeCellId(row, col);

      if (col < size) {
        const neighbor = makeCellId(row, col + 1);
        constraints.push(new GreaterThan(isMax ? cell : neighbor, isMax ? neighbor : cell));
      }
      if (row < size) {
        const neighbor = makeCellId(row + 1, col);
        constraints.push(new GreaterThan(isMax ? cell : neighbor, isMax ? neighbor : cell));
      }
    }
  }

  return constraints;
};

export const DEFAULT_CODE = fnToCode(DEFAULT_CODE_FN);

export const EXAMPLES = {
  'Default Template': DEFAULT_CODE,
  'Shape': fnToCode(SHAPE_FN),
  'Column constraints': fnToCode(COLUMN_CONSTRAINTS_FN),
  'Composite constraint': fnToCode(COMPOSITE_CONSTRAINT_FN),
  'State machine': fnToCode(STATE_MACHINE_FN),
  'Modifying constraints': fnToCode(MODIFYING_CONSTRAINTS_FN),
  'Checkerboard min/max': fnToCode(CHECKERBOARD_FN),
};