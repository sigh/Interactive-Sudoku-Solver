// Circus Maximus by Jeff Wajes
// https://sudokupad.app/cg5wlayzuj
// https://www.youtube.com/watch?v=DVy_zGc9UQI

// Rules:
// Normal sudoku rules apply.
// Digits along a pink line must form a non-repeating group of consecutive
// digits, but they may appear in any order along the line.
// Using red, green, and blue, colour all circles such that:
//   Orthogonally adjacent circles are different colours;
//   and the digit inside a circle appears that many times in circles of that colour.

// Sloooow without additionalHint
const includeHint = true;

const circles = `
G  ?  ?  ?  G  ?  ?  ?  G
?  ?  ?  ?  .  ?  ?  .  ?
?  ?  R  .  ?  ?  .  .  ?
?  .  ?  .  .  ?  ?  ?  ?
B  .  .  ?  ?  G  ?  .  G
?  ?  ?  .  .  ?  .  ?  ?
?  .  ?  ?  ?  .  .  ?  ?
?  ?  G  ?  .  .  ?  .  ?
G  ?  ?  ?  G  ?  ?  ?  G
`.replaceAll(/\s/g, ``);

const base = [
  `.Renban~R1C4~R1C3~R1C2~R1C1~R2C1~R3C1~R4C1`,
  `.Renban~R6C1~R7C1~R8C1~R9C1~R9C2~R9C3~R9C4`,
  `.Renban~R9C6~R9C7~R9C8~R9C9~R8C9~R7C9~R6C9`,
  `.Renban~R4C9~R3C9~R2C9~R1C9~R1C8~R1C7~R1C6`,
];
const additionalHint = `.~R1C3_1~R2C1_6~R3C1_7~R3C9_8~R7C1_9~R7C9_7~R8C1_5~R8C9_6~R9C2_6~R9C3_7~R9C7_4~R9C8_2`;

function* rangeI(from, to) {
  for (let i = from; i <= to; i++) {
    yield i;
  }
}

function colorCandidates(cell, i) {
  return new Given(color.at(cell), ...[
    ("RGB".indexOf(circles[circleIndices[i]]) + 1) || [1, 2, 3]
  ].flat());
}

const graph = cellGraph();
const allCells = graph.cells();

const circleIndices = circles.split('').flatMap((value, i) =>
  value == '.' ? [] : [i]);
const circleCells = circleIndices.map(i => allCells[i]);

// The Color Var cell paired with each circle (VC1.., in circle order).
const color = graph.makeOverlay('VC', circleCells);

// Each orthogonally-adjacent pair of circles, once: the horizontal and vertical
// dominoes starting at each circle whose other cell is also a circle.
const circleAdjacencies = () => circleCells
  .flatMap(cell => [graph.block(cell, 1, 2), graph.block(cell, 2, 1)])
  .filter(domino => domino?.every(c => color.at(c) !== null))
  .map(domino => domino.map(c => color.at(c)));

const allCircleEntries = circleCells.flatMap(cell => [cell, color.at(cell)]);

// `colorValue`, not `color`: `color` is the overlay above, and shadowing it here
// would hide the thing these NFAs are written against.
function colorDigitSpec(colorValue, digit) {
  return NFA.encodeSpec({
    startState: { count: 0 },
    transition: ({ count, digitMatch }, value) =>
      (digitMatch === undefined) ? { count, digitMatch: value == digit }
        : (digitMatch && value == colorValue) ? ((count == digit) ? [] : { count: count + 1 })
          : { count },
    accept: ({ count, digitMatch }) =>
      (digitMatch === undefined) && (count == 0 || count == digit),
  }, 9);
}

// One NFA per (colour, digit): of the circles of that colour, either none or
// exactly `digit` of them hold `digit`.
function colorDigitNFAs() {
  const colorNames = `RGB`;
  return [...rangeI(1, 3)].flatMap(colorValue =>
    [...rangeI(1, 9)].map(digit => new NFA(
      colorDigitSpec(colorValue, digit),
      `${colorNames[colorValue - 1]}${digit}`,
      ...allCircleEntries,
    )));
}

return [
  ...base,
  includeHint ? additionalHint : '',
  color.toVar("Color"),
  ...circleCells.map(colorCandidates),
  new And([
    ...circleAdjacencies().map(cells => new Pair(
      Pair.fnToKey((a, b) => a != b, 9),
      ``, ...cells
    ))
  ]),
  new And([...colorDigitNFAs()]),
];