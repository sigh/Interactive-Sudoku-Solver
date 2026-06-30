// 6x6 Loop Pack: Entropic Lines by gdc
// https://sudokupad.app/gdc/loop-pack/entropic
//
// 6x6 sudoku with a one-cell-wide closed loop (no diagonal self-touch). Circles
// are on the loop, squares are off it. A clue digit counts the cells of its own
// type (loop / non-loop) seen along its row and column, including itself, with
// the opposite type blocking vision. Every three consecutive loop cells span the
// entropic bands {1,2}, {3,4}, {5,6}.
//
// Loop membership is a Var cell per grid cell (1 = on, 2 = off; circles/squares
// fixed). Each rule becomes a state machine (NFA):
//   - one-cell-wide loop -> on cells form a 2-regular graph: degree 2 per on cell
//   - no diagonal touch  -> no 2x2 with only its diagonal on the loop
//   - entropic           -> the only three-in-a-row windows are a cell and its
//                           two loop neighbours, so each on cell must cover all
//                           three bands
//   - vision counting    -> count the same-type cells the clue can see along its
//                           row and column, stopping at the opposite type
// One loop (not several) is left to the other clues, which already force it here.

const SIZE = 6;
const ON = 1;                  // loop-membership values, stored in the Var cells
const OFF = 2;

// Which entropic band a digit belongs to: {1,2} -> 0, {3,4} -> 1, {5,6} -> 2.
const bandOf = digit => (digit - 1) >> 1;
const ALL_BANDS = 0b111;

const inGrid = (row, col) =>
  row >= 1 && row <= SIZE && col >= 1 && col <= SIZE;

// The membership Var cell for a grid cell. The `Var('L', ...)` below names them
// VL1..VL36 in row-major order.
const loopCell = (row, col) => `VL${(row - 1) * SIZE + col}`;

const neighbours = (row, col) =>
  [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
    .filter(([r, c]) => inGrid(r, c));

const allCells = [];
for (let row = 1; row <= SIZE; row++) {
  for (let col = 1; col <= SIZE; col++) {
    allCells.push([row, col]);
  }
}

const constraints = [new Shape('6x6'), new Var('L', 'loop', SIZE * SIZE)];
const add = (...newConstraints) => constraints.push(...newConstraints);

// --- Loop membership: every cell is on (1) or off (2); circles on, squares off.
const circles = [[1, 1], [1, 4]];
const squares = [[1, 5], [4, 5], [5, 2]];
for (const [row, col] of allCells) add(new Given(loopCell(row, col), ON, OFF));
for (const [row, col] of circles) add(new Given(loopCell(row, col), ON));
for (const [row, col] of squares) add(new Given(loopCell(row, col), OFF));

// --- Degree 2: each on cell has exactly two on-loop orthogonal neighbours. ---
// Reads the membership of the cell, then of each neighbour. Off cells are free.
const degreeMachine = NFA.encodeSpec({
  startState: 'start',
  transition: (state, membership) => {
    if (state === 'start') {
      return membership === ON ? { onNeighbours: 0 } : 'off';
    }
    if (state === 'off') return 'off';
    const onNeighbours = state.onNeighbours + (membership === ON ? 1 : 0);
    return onNeighbours > 2 ? undefined : { onNeighbours };
  },
  accept: state => state === 'off' || state.onNeighbours === 2,
}, SIZE);
for (const [row, col] of allCells) {
  const cells = [
    loopCell(row, col),
    ...neighbours(row, col).map(([r, c]) => loopCell(r, c)),
  ];
  add(new NFA(degreeMachine, 'degree', ...cells));
}

// --- No diagonal self-touch: forbid a 2x2 whose only on cells are a diagonal. ---
// Reads the four membership cells of a 2x2 block, left-to-right, top-to-bottom.
const noDiagonalTouchMachine = NFA.encodeSpec({
  startState: { block: [] },
  transition: (state, membership) => {
    if (state === 'ok') return 'ok';
    const block = [...state.block, membership === ON];
    if (block.length < 4) return { block };
    const [topLeft, topRight, bottomLeft, bottomRight] = block;
    const diagonalOnly =
      (topLeft && bottomRight && !topRight && !bottomLeft) ||
      (topRight && bottomLeft && !topLeft && !bottomRight);
    return diagonalOnly ? undefined : 'ok';
  },
  accept: state => state === 'ok',
}, SIZE);
for (let row = 1; row < SIZE; row++) {
  for (let col = 1; col < SIZE; col++) {
    add(new NFA(noDiagonalTouchMachine, 'no-touch',
      loopCell(row, col), loopCell(row, col + 1),
      loopCell(row + 1, col), loopCell(row + 1, col + 1)));
  }
}

// --- Entropic loop: each on cell, with its two on-loop neighbours, must show one
// digit from each band. Reads (membership, digit) pairs for the cell, then for
// each neighbour, accumulating the bands seen on the cell and its on neighbours.
const entropicMachine = NFA.encodeSpec({
  startState: 'start',
  transition: (state, value) => {
    // First value is the cell's own membership.
    if (state === 'start') return value === ON ? 'awaitOwnDigit' : 'off';
    if (state === 'off') return 'off';                 // off cells are unconstrained
    // Second value is the cell's own digit; start the band set.
    if (state === 'awaitOwnDigit') {
      return { bands: 1 << bandOf(value), awaiting: 'membership' };
    }
    // Then alternate: a neighbour's membership, then its digit.
    if (state.awaiting === 'membership') {
      return { bands: state.bands, neighbourOn: value === ON, awaiting: 'digit' };
    }
    const bands = state.neighbourOn
      ? state.bands | (1 << bandOf(value))
      : state.bands;
    return { bands, awaiting: 'membership' };
  },
  accept: state => state === 'off' ||
    (state.awaiting === 'membership' && state.bands === ALL_BANDS),
}, SIZE);
for (const [row, col] of allCells) {
  const cells = [loopCell(row, col), makeCellId(row, col)];
  for (const [r, c] of neighbours(row, col)) {
    cells.push(loopCell(r, c), makeCellId(r, c));
  }
  add(new NFA(entropicMachine, 'entropic', ...cells));
}

// --- Vision: the clue counts same-type cells it sees along its row and column,
// itself included, with the opposite type blocking sight. What it "sees" in a
// line is the unbroken same-type run through the clue, so
//   digit = rowRun + colRun - 1   (the clue itself is in both runs).
// The clue's type and position are fixed per clue, so a machine is built for each.
// Reads the membership of the whole row, then the whole column, then the digit.
const visionMachine = (type, clueRow, clueCol) => {
  // Walk one line one cell at a time, measuring the same-type run through the
  // clue's index. `runEndingHere` tracks the same-type streak up to the current
  // cell; once we pass the clue, `runThroughClue` only grows until a blocker.
  const walkLine = (state, membership, clueIndex) => {
    const sameType = membership === type;
    if (state.position < clueIndex) {
      const runEndingHere = sameType ? state.runEndingHere + 1 : 0;
      return { ...state, position: state.position + 1, runEndingHere };
    }
    if (state.position === clueIndex) {
      // The run through the clue starts as the same-type cells reaching it.
      const runThroughClue = sameType ? state.runEndingHere + 1 : 0;
      return { ...state, position: state.position + 1, runThroughClue };
    }
    if (state.blocked || !sameType) {
      return { ...state, position: state.position + 1, blocked: true };
    }
    return { ...state, position: state.position + 1,
      runThroughClue: state.runThroughClue + 1 };
  };
  const lineStart = phase =>
    ({ phase, position: 1, runEndingHere: 0, runThroughClue: 0, blocked: false });

  return NFA.encodeSpec({
    startState: lineStart('row'),
    transition: (state, value) => {
      if (state.phase === 'row') {
        const next = walkLine(state, value, clueCol);
        if (next.position > SIZE) {
          return { ...lineStart('column'), rowRun: next.runThroughClue };
        }
        return next;
      }
      if (state.phase === 'column') {
        const next = walkLine(state, value, clueRow);
        if (next.position > SIZE) {
          const visionCount = state.rowRun + next.runThroughClue - 1;
          return { phase: 'digit', visionCount };
        }
        return next;
      }
      // Final value is the clue's digit; it must equal the vision count.
      return value === state.visionCount ? 'ok' : undefined;
    },
    accept: state => state === 'ok',
  }, SIZE);
};

// Each clue is [type, row, col]: circles see loop cells, squares see non-loop.
const clues = [
  [ON, 1, 1], [ON, 1, 4],
  [OFF, 1, 5], [OFF, 4, 5], [OFF, 5, 2],
];
for (const [type, clueRow, clueCol] of clues) {
  const cells = [];
  for (let col = 1; col <= SIZE; col++) cells.push(loopCell(clueRow, col));
  for (let row = 1; row <= SIZE; row++) cells.push(loopCell(row, clueCol));
  cells.push(makeCellId(clueRow, clueCol));
  add(new NFA(visionMachine(type, clueRow, clueCol), 'vision', ...cells));
}

return constraints;
