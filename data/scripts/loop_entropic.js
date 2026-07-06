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

const graph = cellGraph('6x6');
const geometry = graph.gridGeometry();

// The loop-membership Var cell paired with each grid cell (VL1..VL36, in grid order).
const loop = graph.makeOverlay('VL');
const loopCell = cell => loop.at(cell);

const gridCells = graph.cells();

const constraints = [new Shape('6x6'), loop.toVar('loop')];
const add = (...newConstraints) => constraints.push(...newConstraints);

// --- Loop membership: every cell is on (1) or off (2); circles on, squares off.
const circles = ['R1C1', 'R1C4'];
const squares = ['R1C5', 'R4C5', 'R5C2'];
const originCell = loop.cells()[0];
add(new Replicate([new Given(originCell, ON, OFF)],
  Replicate.encodeTargetCells(loop.cells(), originCell, loop), originCell));
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
}, geometry.numValues);
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
}, geometry.numValues);
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
}, geometry.numValues);
for (const cell of gridCells) {
  const cells = [loopCell(cell), cell];
  for (const neighbour of graph.neighbours(cell)) cells.push(loopCell(neighbour), neighbour);
  add(new NFA(entropicMachine, 'entropic', ...cells));
}

// --- Vision: the clue counts same-type cells it sees along its row and column,
// itself included, with the opposite type blocking sight. Equivalently, it counts
// itself plus the four rays radiating from it, each an unbroken same-type run out
// to the first blocker, so the rays must total digit - 1.
// The cells are given as segments (SEGMENT_BREAK between): first the clue's own
// membership (which fixes the type it counts) and its digit, then one segment per
// ray, ordered outward from the clue. The machine tallies each ray's leading run
// of cells matching the clue's type.
const visionMachine = NFA.encodeSpec({
  startState: { type: null, need: null, seen: 0, blocked: false },
  transition: ({ type, need, seen, blocked }, value) => {
    // First two values are the clue: its membership (the type it counts), then
    // its digit (the rays must see digit - 1 same-type cells). Restricting the
    // type to ON/OFF keeps the builder from materialising a sub-machine per value.
    if (type === null) {
      return value === ON || value === OFF
        ? { type: value, need: null, seen: 0, blocked: false }
        : [];
    }
    if (need === null) return { type, need: value - 1, seen: 0, blocked: false };
    // A SEGMENT_BREAK starts the next ray, with sight cleared.
    if (value === SEGMENT_BREAK) return { type, need, seen, blocked: false };
    // A ray cell extends the run while unblocked and same-type.
    if (blocked || value !== type) return { type, need, seen, blocked: true };
    const next = seen + 1;
    return next > need ? [] : { type, need, seen: next, blocked: false };
  },
  accept: ({ need, seen }) => seen === need,
}, geometry.numValues, { multiSegment: true });

// Circles count loop cells, squares count non-loop; the machine reads the type
// from each clue's own membership.
const RAY_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
for (const clue of [...circles, ...squares]) {
  // Each ray excludes the clue itself (slice(1)); drop rays that run off-grid.
  const rays = RAY_DIRS
    .map(([dR, dC]) => graph.ray(clue, dR, dC).slice(1).map(loopCell))
    .filter(ray => ray.length);
  add(new NFA(visionMachine, 'vision', [loopCell(clue), clue], ...rays));
}

return constraints;
