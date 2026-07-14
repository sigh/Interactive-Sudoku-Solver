// Title: Xin Yang v2
// Author: PuzzleTank
// Video: https://www.youtube.com/watch?v=_Q1fvtndpsA
// Source: https://sudokupad.app/qc37ejydvj

// Full encoding. Global Yin-Yang connectivity is one ConnectedValues
// constraint per shade over the shade overlay; local shading and clue rules
// are encoded below.

const SHADED = 1;
const UNSHADED = 2;

const graph = cellGraph('9x9');
const geometry = graph.gridGeometry();
const shade = graph.makeOverlay('VS');
const shadeCell = cell => shade.at(cell);
const gridCells = graph.cells();

// Every shade Var is either shaded or unshaded.
const firstShade = shade.cells()[0];
const shadeDomain = shade.makeReplicate(
  new Given(firstShade, SHADED, UNSHADED));

const dots = [
  ['R1C4', 'R2C4'],
  ['R4C3', 'R3C3'],
  ['R7C3', 'R7C4'],
  ['R7C7', 'R8C7'],
  ['R3C6', 'R3C7'],
];

// White dots mark consecutive digits, and their two cells take opposite
// shades (with two shades, "opposite" is just all-different).
const dotRules = dots.flatMap(([a, b]) => [
  new WhiteDot(a, b),
  new AllDifferent(shadeCell(a), shadeCell(b)),
]);

// No 2x2 block may be all shaded or all unshaded: one NFA on the top-left
// block, replicated to every block origin.
const noMono2x2Machine = NFA.encodeSpec({
  startState: { seen: [] },
  transition: ({ seen, done }, value) => {
    if (done === true) return { done: true };
    const next = [...seen, value];
    if (next.length < 4) return { seen: next };
    const allSame = next.every(v => v === next[0]);
    return allSame ? undefined : { done: true };
  },
  accept: ({ done }) => done === true,
}, geometry.numValues);
const blockOrigins = gridCells.filter(cell => graph.block(cell, 2, 2));
const noMono2x2 = shade.makeReplicate(
  new NFA(noMono2x2Machine, 'no-mono-2x2',
    ...graph.block(gridCells[0], 2, 2).map(shadeCell)),
  blockOrigins.map(shadeCell));

const arrows = [
  {
    pill: ['R1C4', 'R1C5'],
    line: ['R1C4', 'R1C3', 'R1C2', 'R1C1', 'R2C1', 'R3C1', 'R3C2', 'R3C3', 'R2C3', 'R2C2'],
  },
  {
    pill: ['R4C6', 'R4C7'],
    line: ['R4C6', 'R3C6', 'R3C7'],
  },
  {
    pill: ['R3C8', 'R3C9'],
    line: ['R3C9', 'R4C8', 'R4C9', 'R5C8', 'R6C8', 'R6C7'],
  },
  {
    pill: ['R9C2', 'R9C3'],
    line: ['R9C3', 'R9C4', 'R9C5', 'R9C6'],
  },
  {
    pill: ['R6C5', 'R6C6'],
    line: ['R6C6', 'R7C7', 'R7C8', 'R8C8'],
  },
  {
    pill: ['R5C1', 'R5C2'],
    line: ['R5C2', 'R6C3', 'R7C3'],
  },
];

const pillArrows = arrows.map(
  ({ pill, line }) => new PillArrow(2, ...pill, ...line.slice(1)));

// The clue sees an unbroken run of its own shade covering its own cell, bounded
// by the opposite shade (or the line's end). Enumerate every window [start..end]
// containing the clue: one And per window, pinning the digit to the window's
// length, the window to the target shade, and each in-line boundary to the
// blocker. Exactly one window is the true run, so the clue is their Or.
function sightCountConstraint(digitCell, lineCells, index, targetShade) {
  const blocker = targetShade === SHADED ? UNSHADED : SHADED;
  const starts = Array.from({ length: index + 1 }, (_, start) => start);
  const ends = Array.from(
    { length: lineCells.length - index }, (_, i) => index + i);

  return new Or(starts.flatMap(start => ends.map(end => new And([
    new Given(digitCell, end - start + 1),
    ...lineCells.slice(start, end + 1)
      .map(cell => new Given(shadeCell(cell), targetShade)),
    ...(start > 0
      ? [new Given(shadeCell(lineCells[start - 1]), blocker)] : []),
    ...(end + 1 < lineCells.length
      ? [new Given(shadeCell(lineCells[end + 1]), blocker)] : []),
  ]))));
}

// The pill's tens digit counts shaded cells seen along its row, the ones digit
// counts unshaded cells seen down its column; the index is the clue's own
// position in that line.
const sightCounts = arrows.flatMap(({ pill }) => [
  sightCountConstraint(
    pill[0], graph.row(pill[0]), parseCellId(pill[0]).col - 1, SHADED),
  sightCountConstraint(
    pill[1], graph.column(pill[1]), parseCellId(pill[1]).row - 1, UNSHADED),
]);

return [
  new Shape('9x9'),
  shade.toVar('shade'),
  new Given('R2C6', 6),
  new Given('R2C8', 8),
  new Given('R6C2', 7),
  new Given('R7C6', 5),
  shadeDomain,
  // Yin-Yang connectivity: each shade forms one orthogonally connected region.
  new ConnectedValues('VS', SHADED),
  new ConnectedValues('VS', UNSHADED),
  ...dotRules,
  noMono2x2,
  ...pillArrows,
  ...sightCounts,
];
