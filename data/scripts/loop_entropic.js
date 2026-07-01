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

const ON = 1;                  // loop-membership values, stored in the Var cells
const OFF = 2;

// Which entropic band a digit belongs to: {1,2} -> 0, {3,4} -> 1, {5,6} -> 2.
const bandOf = digit => (digit - 1) >> 1;
const ALL_BANDS = 0b111;

const gridShape = shape('6x6');
const graph = cellGraph(gridShape);

// The loop-membership Var cell paired with a grid cell (VL1..VL36, in grid order).
const loopCell = cell => `VL${gridShape.parseCellId(cell).cell + 1}`;

const gridCells = Array.from({ length: gridShape.numGridCells },
  (_, i) => gridShape.makeCellIdFromIndex(i));

const constraints = [new Shape('6x6'), new Var('L', 'loop', gridShape.numGridCells)];
const add = (...newConstraints) => constraints.push(...newConstraints);

// --- Loop membership: every cell is on (1) or off (2); circles on, squares off.
const circles = ['R1C1', 'R1C4'];
const squares = ['R1C5', 'R4C5', 'R5C2'];
for (const cell of gridCells) add(new Given(loopCell(cell), ON, OFF));
for (const cell of circles) add(new Given(loopCell(cell), ON));
for (const cell of squares) add(new Given(loopCell(cell), OFF));

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

// --- Entropic loop: each on cell, with its two on-loop neighbours, must show one
// digit from each band. Reads (membership, digit) pairs for the cell, then for
// each neighbour, accumulating the bands seen on the cell and its on neighbours.
const entropicMachine = NFA.encodeSpec({
  startState: { phase: 'start' },
  transition: ({ phase, bands, neighbourOn }, value) => {
    // First value is the cell's own membership.
    if (phase === 'start') return { phase: value === ON ? 'ownDigit' : 'off' };
    if (phase === 'off') return { phase: 'off' };      // off cells are unconstrained
    // Second value is the cell's own digit; start the band set.
    if (phase === 'ownDigit') {
      return { phase: 'membership', bands: 1 << bandOf(value) };
    }
    // Then alternate: a neighbour's membership, then its digit.
    if (phase === 'membership') {
      return { phase: 'digit', bands, neighbourOn: value === ON };
    }
    return {
      phase: 'membership',
      bands: neighbourOn ? bands | (1 << bandOf(value)) : bands,
    };
  },
  accept: ({ phase, bands }) => phase === 'off' ||
    (phase === 'membership' && bands === ALL_BANDS),
}, gridShape.numValues);
for (const cell of gridCells) {
  const cells = [loopCell(cell), cell];
  for (const neighbour of graph.neighbours(cell)) cells.push(loopCell(neighbour), neighbour);
  add(new NFA(entropicMachine, 'entropic', ...cells));
}

// --- Vision: the clue counts same-type cells it sees along its row and column,
// itself included, with the opposite type blocking sight. What it "sees" in a
// line is the unbroken same-type run through the clue, so
//   digit = rowRun + colRun - 1   (the clue itself is in both runs).
// The clue's type and position are fixed per clue, so a machine is built for each.
// Reads the membership of the whole row, then the whole column, then the digit.
const visionMachine = (type, clueRow, clueCol) => {
  const LINE_START = { position: 1, runEndingHere: 0, runThroughClue: 0, blocked: false };

  // Walk one line one cell at a time, measuring the same-type run through the
  // clue's index. `runEndingHere` tracks the same-type streak up to the current
  // cell; once we pass the clue, `runThroughClue` only grows until a blocker.
  const walkLine = ({ position, runEndingHere, runThroughClue, blocked }, membership, clueIndex) => {
    const sameType = membership === type;
    const next = { position: position + 1, runEndingHere, runThroughClue, blocked };
    if (position < clueIndex) {
      next.runEndingHere = sameType ? runEndingHere + 1 : 0;
    } else if (position === clueIndex) {
      // The run through the clue starts as the same-type cells reaching it.
      next.runThroughClue = sameType ? runEndingHere + 1 : 0;
    } else if (blocked || !sameType) {
      next.blocked = true;
    } else {
      next.runThroughClue = runThroughClue + 1;
    }
    return next;
  };

  return NFA.encodeSpec({
    startState: { phase: 'row', ...LINE_START },
    transition: ({ phase, rowRun, visionCount, ...line }, value) => {
      if (phase === 'row') {
        const next = walkLine(line, value, clueCol);
        return next.position > gridShape.numCols
          ? { phase: 'column', ...LINE_START, rowRun: next.runThroughClue }
          : { phase: 'row', ...next };
      }
      if (phase === 'column') {
        const next = walkLine(line, value, clueRow);
        return next.position > gridShape.numRows
          ? { phase: 'digit', visionCount: rowRun + next.runThroughClue - 1 }
          : { phase: 'column', ...next, rowRun };
      }
      // Final value is the clue's digit; it must equal the vision count.
      return value === visionCount ? { phase: 'done' } : undefined;
    },
    accept: ({ phase }) => phase === 'done',
  }, gridShape.numValues);
};

// Each clue is [type, row, col]: circles see loop cells, squares see non-loop.
const clues = [
  [ON, 1, 1], [ON, 1, 4],
  [OFF, 1, 5], [OFF, 4, 5], [OFF, 5, 2],
];
for (const [type, clueRow, clueCol] of clues) {
  const clueCell = makeCellId(clueRow, clueCol);
  const cells = [
    ...graph.ray(makeCellId(clueRow, 1), 0, 1).map(loopCell),   // the clue's row
    ...graph.ray(makeCellId(1, clueCol), 1, 0).map(loopCell),   // the clue's column
    clueCell,                                             // the clue digit
  ];
  add(new NFA(visionMachine(type, clueRow, clueCol), 'vision', ...cells));
}

return constraints;
