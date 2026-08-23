// Title: Xin Yang v2
// Author: PuzzleTank
// Video: https://www.youtube.com/watch?v=_Q1fvtndpsA
// Source: https://sudokupad.app/qc37ejydvj

// Full encoding. The shading is the YinYang constraint's YY cell group;
// the clue rules over it are encoded below.

const SHADED = 1;
const UNSHADED = 2;

const graph = cellGraph('9x9');
const shade = graph.makeOverlay('YY');

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
  new AllDifferent(...shade.at([a, b])),
]);

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
    ...shade.at(lineCells.slice(start, end + 1))
      .map(cell => new Given(cell, targetShade)),
    ...(start > 0
      ? [new Given(shade.at(lineCells[start - 1]), blocker)] : []),
    ...(end + 1 < lineCells.length
      ? [new Given(shade.at(lineCells[end + 1]), blocker)] : []),
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
  new YinYang(),
  new Given('R2C6', 6),
  new Given('R2C8', 8),
  new Given('R6C2', 7),
  new Given('R7C6', 5),
  ...dotRules,
  ...pillArrows,
  ...sightCounts,
];
