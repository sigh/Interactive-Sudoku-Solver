// Odd Blockade Runners by Jeff Wajes
// https://sudokupad.app/bq8jTQjhMd
// https://www.youtube.com/watch?v=yNeV4kcQQ0M

// Rules:
// Normal sudoku rules apply.
// Digits in a circle must appear at least once in the four cells touching the
// circle.
// Around each circle, at most one cell can contain an odd digit.
// All cells containing odd digits form a single orthogonally-connected region.

// Each circle sits on a grid corner, identified here by the top-left cell of
// the 2x2 it touches, with the digits it contains.
const circles = [
  ['R2C3', [4, 6, 7]],
  ['R4C6', [5, 8]],
  ['R5C2', [3, 4, 8]],
  ['R5C5', [2, 4, 5]],
  ['R6C1', [2, 6, 8]],
  ['R6C8', [2, 4, 6]],
  ['R7C4', [1, 2, 8]],
  ['R7C7', [4, 6, 7]],
  ['R8C3', [5, 6, 8]],
];

const ODD = [1, 3, 5, 7, 9];
const EVEN = [2, 4, 6, 8];

const graph = cellGraph('9x9');

// At most one of the four cells is odd: evens, with at most one odd among them.
const charClass = (values) => `[${values.join('')}]`;
const atMostOneOdd =
  `${charClass(EVEN)}*${charClass(ODD)}?${charClass(EVEN)}*`;

const circleRules = circles.flatMap(([topLeft, values]) => [
  new Quad(topLeft, ...values),
  new Regex(atMostOneOdd, ...graph.block(topLeft, 2, 2)),
]);

return [
  new Shape('9x9'),
  ...circleRules,
  new ConnectedValues('', ODD),
];
