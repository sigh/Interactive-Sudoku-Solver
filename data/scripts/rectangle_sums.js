// Rectangle Sums by FIT7Y
// https://www.youtube.com/watch?v=T03vUTiJBjk
//
// Script by curlingclips.
// Each clue is the sum of a rectangle whose top-left corner is
// fixed and whose bottom-right corner is one of the marked cells. A Var per
// clue picks which bottom-right corner is used, and all the choices differ.

let topLefts = [
  ["R1C1", 81], ["R1C2", 170], ["R1C3", 74], ["R1C4", 150], ["R1C5", 141],
  ["R1C6", 65], ["R1C7", 111], ["R1C8", 62], ["R2C1", 120], ["R3C1", 188],
  ["R4C1", 241], ["R5C1", 175], ["R6C1", 116], ["R7C1", 34], ["R8C1", 26],
];

let bottomRights = [
  'R2C9', 'R3C9', 'R4C4', 'R4C9', 'R5C9',
  'R6C9', 'R7C9', 'R8C9', 'R9C2', 'R9C3',
  'R9C4', 'R9C5', 'R9C6', 'R9C7', 'R9C8',
];

let K = topLefts.length;

function* rangeI(from, to) {
  for (let i = from; i <= to; i++) {
    yield i;
  }
}

const graph = cellGraph("9x9");
const rectangle = (topLeft, bottomRight) => {
  let [rc1, rc2] = [topLeft, bottomRight].map(parseCellId);
  return graph.block(topLeft, rc2.row - rc1.row + 1, rc2.col - rc1.col + 1);
};

return [
  new Shape("9x9", K),
  ...rectangle("R1C1", "R9C9").map(cell =>
    new Given(cell, ...rangeI(1, 9))
  ),
  new Var("R", "Rectangle", K),
  new AllDifferent(...rangeI(1, K).map(i => `VR${i}`)),
  ...topLefts.map(([topLeft, sum], i) => new Or(
    bottomRights.map((bottomRight, j) => new And([
      new Sum(sum, ...rectangle(topLeft, bottomRight)),
      new Given(`VR${i + 1}`, j + 1)
    ])).filter(option =>
      option.constraints[0].cells.length > 0
    )
  ))
];
