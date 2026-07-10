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

const constraints = [
  new Shape('9x9'),
  shade.toVar('shade'),
  new Given('R2C6', 6),
  new Given('R2C8', 8),
  new Given('R6C2', 7),
  new Given('R7C6', 5),
];
const add = (...items) => constraints.push(...items);

// Every shade Var is either shaded or unshaded.
const firstShade = shade.cells()[0];
add(new Replicate([new Given(firstShade, SHADED, UNSHADED)],
  Replicate.encodeTargetCells(shade.cells(), firstShade, shade), firstShade));

// Yin-Yang connectivity: each shade forms one orthogonally connected region.
add(new ConnectedValues('VS', String(SHADED)));
add(new ConnectedValues('VS', String(UNSHADED)));

const dots = [
  ['R1C4', 'R2C4'],
  ['R4C3', 'R3C3'],
  ['R7C3', 'R7C4'],
  ['R7C7', 'R8C7'],
  ['R3C6', 'R3C7'],
];

// White dots mark consecutive digits, and their two cells take opposite
// shades (with two shades, "opposite" is just all-different).
for (const [a, b] of dots) {
  add(new WhiteDot(a, b), new AllDifferent(shadeCell(a), shadeCell(b)));
}

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
add(new Replicate(
  [new NFA(noMono2x2Machine, 'no-mono-2x2',
    ...graph.block(gridCells[0], 2, 2).map(shadeCell))],
  Replicate.encodeTargetCells(blockOrigins.map(shadeCell), firstShade, shade),
  firstShade));

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

for (const { pill, line } of arrows) {
  add(new PillArrow(2, ...pill, ...line.slice(1)));
}

function sightCountConstraint(digitCell, lineCells, index, targetShade) {
  const blocker = targetShade === SHADED ? UNSHADED : SHADED;
  const branches = [];
  for (let start = 0; start <= index; start++) {
    for (let end = index; end < lineCells.length; end++) {
      const length = end - start + 1;
      const branch = [new Given(digitCell, length)];
      for (let i = start; i <= end; i++) {
        branch.push(new Given(shadeCell(lineCells[i]), targetShade));
      }
      if (start > 0) branch.push(new Given(shadeCell(lineCells[start - 1]), blocker));
      if (end + 1 < lineCells.length) branch.push(new Given(shadeCell(lineCells[end + 1]), blocker));
      branches.push(new And(branch));
    }
  }
  return new Or(branches);
}

for (const { pill } of arrows) {
  const tens = parseCellId(pill[0]);
  const ones = parseCellId(pill[1]);
  add(sightCountConstraint(pill[0], graph.row(pill[0]), tens.col - 1, SHADED));
  add(sightCountConstraint(pill[1], graph.column(pill[1]), ones.row - 1, UNSHADED));
}

return constraints;
