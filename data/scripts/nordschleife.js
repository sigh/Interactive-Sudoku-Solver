// Nordschleife by Qodec
// https://sudokupad.app/0pshsj5ykr
// https://www.youtube.com/watch?v=A8GBl5GGypA
//
// Standard 9x9 sudoku. Draw a single 1-cell-wide loop of orthogonally connected
// cells that does not branch or touch itself, not even diagonally. Circled cells
// are off the loop; a circle's digit counts how many of its up-to-8 king
// neighbours are on the loop. Along the loop, of each pair of adjacent digits the
// larger is an integer multiple of the smaller. The rectangle cell is on the loop.
//
// Loop membership is a Var cell per grid cell (1 = on, 2 = off), shaped into a
// loop by the same degree-2 + no-diagonal-touch NFAs as the other loop scripts.

const ON = 1;                  // loop-membership values, stored in the Var cells
const OFF = 2;

const gridShape = shape('9x9');
const graph = cellGraph(gridShape);

// The loop-membership Var cell paired with a grid cell (VL1..VL81, in grid order).
const loopCell = cell => `VL${gridShape.parseCellId(cell).cell + 1}`;

const gridCells = Array.from({ length: gridShape.numGridCells },
  (_, i) => gridShape.makeCellIdFromIndex(i));

const constraints = [new Shape('9x9'), new Var('L', 'loop', gridShape.numGridCells)];
const add = (...newConstraints) => constraints.push(...newConstraints);

const circles = ['R2C8', 'R1C2', 'R2C1', 'R1C6', 'R2C6', 'R4C2', 'R8C7', 'R9C4'];
const rectangle = 'R6C1';

// The eight king-move neighbours of a cell that lie on the grid.
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const kingNeighbours = cell =>
  KING.map(([dR, dC]) => graph.step(cell, dR, dC)).filter(Boolean);

// --- Loop membership: every cell is on (1) or off (2); circles off, rectangle on.
for (const cell of gridCells) add(new Given(loopCell(cell), ON, OFF));
for (const cell of circles) add(new Given(loopCell(cell), OFF));
add(new Given(loopCell(rectangle), ON));

// --- Degree 2: each on cell has exactly two on-loop orthogonal neighbours. ---
// Reads the membership of the cell, then of each neighbour. Off cells are free.
const degreeMachine = NFA.encodeSpec({
  startState: { phase: 'start' },
  transition: ({ phase, onNeighbours }, membership) => {
    if (phase === 'start') {
      return membership === ON ? { phase: 'on', onNeighbours: 0 } : { phase: 'off' };
    }
    if (phase === 'off') return { phase: 'off' };
    const count = onNeighbours + (membership === ON ? 1 : 0);
    return count > 2 ? undefined : { phase: 'on', onNeighbours: count };
  },
  accept: ({ phase, onNeighbours }) => phase === 'off' || onNeighbours === 2,
}, gridShape.numValues);
for (const cell of gridCells) {
  add(new NFA(degreeMachine, 'degree',
    loopCell(cell), ...graph.neighbours(cell).map(loopCell)));
}

// --- No diagonal self-touch: forbid a 2x2 whose only on cells are a diagonal. ---
// Reads the four membership cells of a 2x2 block, left-to-right, top-to-bottom.
const noDiagonalTouchMachine = NFA.encodeSpec({
  // `block` accumulates the 2x2's membership flags, and becomes null once the
  // block has passed the check (all further symbols are absorbed).
  startState: { block: [] },
  transition: ({ block }, membership) => {
    if (block === null) return { block: null };
    const next = [...block, membership === ON];
    if (next.length < 4) return { block: next };
    const [topLeft, topRight, bottomLeft, bottomRight] = next;
    const diagonalOnly =
      (topLeft && bottomRight && !topRight && !bottomLeft) ||
      (topRight && bottomLeft && !topLeft && !bottomRight);
    return diagonalOnly ? undefined : { block: null };
  },
  accept: ({ block }) => block === null,
}, gridShape.numValues);
for (const cell of gridCells) {
  const block = graph.block(cell, 2, 2);
  if (block) add(new NFA(noDiagonalTouchMachine, 'no-touch', ...block.map(loopCell)));
}

// --- Circle counts: the circle's digit equals the number of its king neighbours
// that are on the loop. Reads the digit, then each neighbour's membership.
const countMachine = NFA.encodeSpec({
  startState: { target: null, count: 0 },
  transition: ({ target, count }, value) => {
    if (target === null) return { target: value, count: 0 };   // the circle's digit
    const next = count + (value === ON ? 1 : 0);
    return next > target ? [] : { target, count: next };
  },
  accept: ({ target, count }) => target !== null && count === target,
}, gridShape.numValues);
for (const cell of circles) {
  add(new NFA(countMachine, 'count', cell, ...kingNeighbours(cell).map(loopCell)));
}

// --- Loop multiples: for two orthogonally adjacent on-loop cells, the larger
// digit must be a multiple of the smaller. Reads (membership, digit) for each
// cell; if either is off the loop the pair is unconstrained. Off cells' remaining
// values are absorbed by a skip countdown.
const multipleMachine = NFA.encodeSpec({
  startState: { phase: 'aOn' },
  transition: (state, value) => {
    switch (state.phase) {
      case 'aOn':
        return value === ON ? { phase: 'aDigit' } : { phase: 'skip', left: 3 };
      case 'aDigit':
        return { phase: 'bOn', aDigit: value };
      case 'bOn':
        return value === ON
          ? { phase: 'bDigit', aDigit: state.aDigit }
          : { phase: 'skip', left: 1 };
      case 'bDigit': {
        const a = state.aDigit, b = value;
        return a % b === 0 || b % a === 0 ? { phase: 'done' } : undefined;
      }
      case 'skip':
        return state.left > 1 ? { phase: 'skip', left: state.left - 1 } : { phase: 'done' };
    }
  },
  accept: ({ phase }) => phase === 'done',
}, gridShape.numValues);
for (const cell of gridCells) {
  for (const [dR, dC] of [[0, 1], [1, 0]]) {
    const other = graph.step(cell, dR, dC);
    if (other) {
      add(new NFA(multipleMachine, 'mult',
        loopCell(cell), cell, loopCell(other), other));
    }
  }
}

return constraints;
