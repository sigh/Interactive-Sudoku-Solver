// Wendezäune by Dorlir
// https://sudokupad.app/uevzycz28t
// https://www.youtube.com/watch?v=bhKtKFEy0AM
//
// Standard 9x9 sudoku. Draw a single loop through cell centres that travels
// orthogonally and may go straight or turn within a cell, but never branches or
// crosses itself. The loop may run alongside itself, so two loop cells can be
// adjacent without being connected. Adjacent digits along the loop differ by at
// least 5. Each circle sits on a grid vertex; its digit is how many of the four
// cells around that vertex are turns of the loop, and at least one of those four
// cells holds that digit.
//
// Each cell has a "shape" Var recording which of its four edges the loop uses:
// off, a straight (horizontal/vertical), or one of four corners (turns). Edge
// agreement between neighbours makes the shapes join up into loops.
//
// ConnectedValues is deliberately NOT used here, unlike nordschleife.js. It tests
// *cell* adjacency, but this puzzle's loop may run alongside itself, so two
// disjoint loops can be cell-adjacent while sharing no used edge -- connectivity
// would not see them. Degree comes from each cell's own shape code rather than a
// neighbour count, so the "connected + 2-regular = one cycle" argument that closes
// nordschleife.js does not apply. Proving one loop here needs connectivity over
// the used-edge graph, which ISS does not have.

// Shape codes (the value stored in each VS cell).
const OFF = 1, HORIZ = 2, VERT = 3, UL = 4, UR = 5, DL = 6, DR = 7;
const usesUp = s => s === VERT || s === UL || s === UR;
const usesDown = s => s === VERT || s === DL || s === DR;
const usesLeft = s => s === HORIZ || s === UL || s === DL;
const usesRight = s => s === HORIZ || s === UR || s === DR;
const isTurn = s => s >= UL;   // the four corners

const graph = cellGraph('9x9');
const geometry = graph.gridGeometry();
const shape = graph.makeOverlay('VS');
const shapeCell = cell => shape.at(cell);
const gridCells = graph.cells();

// Each circle sits on a grid vertex, keyed by the top-left cell of the 2x2 it
// constrains; the value is the clue digit.
const circleClues = {
  R2C1: 4, R5C1: 3, R6C2: 2, R7C3: 4, R8C5: 1,
  R2C5: 2, R1C3: 2, R4C6: 2, R7C7: 2, R5C8: 1,
};

// --- Shape domains: a cell may use an edge only if the neighbour exists, so
// border cells can't take shapes that point off the grid.
const ALL_SHAPES = [OFF, HORIZ, VERT, UL, UR, DL, DR];
const shapeDomains = gridCells.map(cell => {
  const { row, col } = parseCellId(cell);
  const allowed = ALL_SHAPES.filter(s =>
    !(row === 1 && usesUp(s)) && !(row === geometry.numRows && usesDown(s)) &&
    !(col === 1 && usesLeft(s)) && !(col === geometry.numCols && usesRight(s)));
  return new Given(shapeCell(cell), ...allowed);
});

// --- Edge agreement: neighbours must agree on the shared edge. Reads the two
// cells' shapes; the first uses the edge towards the second iff the second uses
// the edge back. `toB`/`toA` say whether a shape uses that shared edge.
const edgeAgree = (toB, toA) => NFA.encodeSpec({
  startState: { aUses: null },
  transition: ({ aUses }, value) => aUses === null
    ? { aUses: toB(value) }
    : (aUses === toA(value) ? { done: true } : undefined),
  accept: ({ done }) => done === true,
}, geometry.numValues);

// --- Loop differences: two cells joined by a loop edge differ by at least 5.
// Reads [shapeA, digitA, digitB]; `toB` says whether A uses the edge to B (edge
// agreement guarantees B agrees), so we only constrain the digits when joined.
const diffEdge = (toB) => NFA.encodeSpec({
  startState: { phase: 'shape' },
  transition: (state, value) => {
    if (state.phase === 'shape') return { phase: 'digitA', joined: toB(value) };
    if (state.phase === 'digitA') return { phase: 'digitB', joined: state.joined, digitA: value };
    if (!state.joined) return { done: true };
    return Math.abs(state.digitA - value) >= 5 ? { done: true } : undefined;
  },
  accept: ({ done }) => done === true,
}, geometry.numValues);

// Apply both to every right and down neighbour pair, which covers each orthogonal
// pair once. The step falls off the grid at the last column/row.
const edgeRight = edgeAgree(usesRight, usesLeft), edgeDown = edgeAgree(usesDown, usesUp);
const diffRight = diffEdge(usesRight), diffDown = diffEdge(usesDown);
const pairRules = gridCells.flatMap(cell => {
  const right = graph.step(cell, 0, 1);
  const down = graph.step(cell, 1, 0);
  return [
    ...(right ? [
      new NFA(edgeRight, 'edge-h', shapeCell(cell), shapeCell(right)),
      new NFA(diffRight, 'diff-h', shapeCell(cell), cell, right),
    ] : []),
    ...(down ? [
      new NFA(edgeDown, 'edge-v', shapeCell(cell), shapeCell(down)),
      new NFA(diffDown, 'diff-v', shapeCell(cell), cell, down),
    ] : []),
  ];
});

// --- Circle clues. Each vertex's clue does two things: at least one of the four
// cells around it holds the clue digit (a Quad on that 2x2), and exactly that many
// of the four cells are turns of the loop (a count over their shapes).
const memo = (fn) => { const m = new Map(); return k => (m.has(k) ? m : m.set(k, fn(k))).get(k); };
const turnsExactly = memo((target) => NFA.encodeSpec({
  startState: { count: 0 },
  transition: ({ count }, value) => {
    const next = count + (isTurn(value) ? 1 : 0);
    return next > target ? [] : { count: next };
  },
  accept: ({ count }) => count === target,
}, geometry.numValues));
const circleRules = Object.entries(circleClues).flatMap(([topLeft, digit]) => [
  new Quad(topLeft, digit),
  new NFA(turnsExactly(digit), 'circle-turns',
    ...graph.block(topLeft, 2, 2).map(shapeCell)),
]);

return [
  new Shape('9x9'),
  new Given('R1C1', 6),
  shape.toVar('shape'),
  ...shapeDomains,
  ...pairRules,
  ...circleRules,
];
