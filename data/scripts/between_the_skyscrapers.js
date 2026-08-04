// Between The Skyscrapers by Klausku
// https://www.youtube.com/watch?v=bi0sC74nPuU
//
// Between lines: interior cells are strictly between the circled endpoint
// values. Each circled cell's digit is also a skyscraper-visibility clue for
// its whole row (from the left) and its whole column (from the top): reading
// digits as building heights, the count of visible buildings from that edge
// equals the circled digit. Plus one inequality: R9C5 < R9C6.

const graph = cellGraph('9x9');

// Between-line paths, first/last cell circled, walked in drawn order.
const betweenLines = [
  ['R3C3', 'R3C4', 'R3C5', 'R4C5'],
  ['R4C5', 'R4C4', 'R5C4', 'R6C4', 'R7C4'],
  ['R2C1', 'R1C1', 'R1C2'],
  ['R9C9', 'R9C8', 'R8C7'],
  ['R8C7', 'R7C6', 'R7C5', 'R7C4'],
  ['R6C8', 'R7C8', 'R8C7'],
];

// The circled cells (the de-duplicated between-line endpoints).
const circledCells = [
  'R3C3', 'R4C5', 'R7C4', 'R2C1', 'R1C2', 'R9C9', 'R8C7', 'R6C8',
];

// Skyscraper visibility over one full row or column, with the circled cell's
// own value as the clue. Each line is fed as three segments
// (before / circled / after), so the segment breaks locate the circled cell:
// `phase` counts the breaks seen and the value read in phase 1 is the clue.
// When the circled cell is first in its line, the leading segment is empty.
const spec = NFA.encodeSpec({
  startState: { phase: 0, tallest: 0, visible: 0, target: null },
  transition: ({ phase, tallest, visible, target }, value) => {
    if (value === SEGMENT_BREAK) {
      return phase === 2 ? [] : { phase: phase + 1, tallest, visible, target };
    }
    return {
      phase,
      tallest: Math.max(tallest, value),
      visible: visible + (value > tallest ? 1 : 0),
      target: phase === 1 ? value : target,
    };
  },
  accept: ({ phase, visible, target }) => phase === 2 && visible === target,
  maxDepth: 11,  // 9 cells + 2 segment breaks
}, 9, { multiSegment: true });

const skyscraperConstraints = circledCells.flatMap(cell =>
  [graph.row(cell), graph.column(cell)].map(cells => {
    const idx = cells.indexOf(cell);
    return new NFA(spec, 'sky', cells.slice(0, idx), [cell], cells.slice(idx + 1));
  }));

return [
  new Shape('9x9'),
  new Given('R4C7', 5),
  new Given('R7C6', 5),
  ...betweenLines.map(cells => new Between(...cells)),
  ...skyscraperConstraints,
  new GreaterThan('R9C6', 'R9C5'),
];
