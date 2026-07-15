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
// One loop (not several) is ConnectedValues: degree-2 makes the on cells 2-regular
// under orthogonal adjacency, and a connected 2-regular graph is a single cycle.

const ON = 1;                  // loop-membership values, stored in the Var cells
const OFF = 2;

// Which entropic band a digit belongs to: {1,2} -> 0, {3,4} -> 1, {5,6} -> 2.
const bandOf = digit => (digit - 1) >> 1;
const ALL_BANDS = 0b111;

const graph = cellGraph('6x6');
const geometry = graph.gridGeometry();

// The loop-membership Var cell paired with each grid cell (VL1..VL36, in grid order).
const loop = graph.makeOverlay('VL');

const gridCells = graph.cells();

// --- Loop membership: every cell is on (1) or off (2); circles on, squares off.
const circles = ['R1C1', 'R1C4'];
const squares = ['R1C5', 'R4C5', 'R5C2'];
const originCell = loop.cells()[0];
const membership = [
  loop.makeReplicate(new Given(originCell, ON, OFF)),
  ...loop.at(circles).map(cell => new Given(cell, ON)),
  ...loop.at(squares).map(cell => new Given(cell, OFF)),
];

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
const degrees = gridCells.map(cell => new NFA(degreeMachine, 'degree',
  ...loop.at([cell, ...graph.neighbours(cell)])));

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
// Cells on the bottom/right edge start no 2x2 block.
const noDiagonalTouches = gridCells
  .map(cell => graph.block(cell, 2, 2))
  .filter(Boolean)
  .map(block => new NFA(noDiagonalTouchMachine, 'no-touch', ...loop.at(block)));

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
const entropics = gridCells.map(cell => new NFA(entropicMachine, 'entropic',
  loop.at(cell), cell,
  ...graph.neighbours(cell).flatMap(n => [loop.at(n), n])));

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
const visions = [...circles, ...squares].map(clue => new NFA(
  visionMachine, 'vision',
  [loop.at(clue), clue],
  // Each ray excludes the clue itself (slice(1)); drop rays that run off-grid.
  ...RAY_DIRS
    .map(([dR, dC]) => loop.at(graph.ray(clue, dR, dC).slice(1)))
    .filter(ray => ray.length)));

return [
  new Shape('6x6'),
  loop.toVar('loop'),
  ...membership,
  // Single loop: the on-loop cells form one orthogonally-connected region.
  new ConnectedValues('VL', ON),
  ...degrees,
  ...noDiagonalTouches,
  ...entropics,
  ...visions,
];
