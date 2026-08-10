// Homogenous by Marty Sears
// https://sudokupad.app/0htle6wxey
// (Cracking the Cryptic: https://www.youtube.com/watch?v=kM6Kwwkv3aM)
//
// ISOFILL: Divide the grid into 10 regions, each with 10 orthogonally
// connected cells. Every cell in a region contains the same digit, and all of
// the digits 0-9 appear. Digits along an arrow sum to the digit in the
// attached circle. Black dot: one digit is double the other. Green dot: the
// digits differ by at least 5.
//
// There are no sudoku rules, so the puzzle lives on a raw 0-9 grid. The
// regions are never named: a region is exactly "all cells of one digit", so
// the region rule is ten ConnectedValues with size 10 — one connected 10-cell
// area per digit, which also forces every digit to appear. The 0-0 black dot
// pair is legal (0 = 2*0); the plain ratio predicate already covers it.

const shape = new Shape('10x10', '0-9', 'Raw');
const at = (r, c) => makeCellId(r, c);

const regions = [];
for (let d = 0; d <= 9; d++) regions.push(new ConnectedValues('', d, 10));

// Circle first, then the cells along the arrow.
const arrows = [
  [[6, 2], [7, 2], [8, 2], [7, 3]],
  [[6, 6], [7, 5], [8, 6]],
  [[2, 6], [3, 6], [3, 5], [4, 4], [5, 3]],
  [[5, 5], [4, 6]],
  [[5, 6], [5, 7], [4, 7]],
].map(line => new Arrow(...line.map(rc => at(...rc))));

const doubleKey = Pair.fnToKey((a, b) => a === 2 * b || b === 2 * a, shape);
const gapKey = Pair.fnToKey((a, b) => Math.abs(a - b) >= 5, shape);
const dots = [
  ...[
    [[10, 9], [10, 10]], [[1, 1], [2, 1]], [[10, 3], [10, 4]],
    [[7, 10], [8, 10]], [[1, 9], [1, 10]],
  ].map(([a, b]) => new Pair(doubleKey, 'black dot', at(...a), at(...b))),
  ...[
    [[1, 2], [1, 3]], [[3, 1], [4, 1]], [[1, 10], [2, 10]], [[1, 8], [1, 9]],
  ].map(([a, b]) => new Pair(gapKey, 'green dot', at(...a), at(...b))),
];

return [shape, ...regions, ...arrows, ...dots];
