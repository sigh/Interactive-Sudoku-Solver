// Atrocious Destruction by NXTMaster
// https://sudokupad.app/ow89c0ugwr
//
// Standard irregular 8x8 sudoku, EXCEPT the given regions are "false": none may
// contain all of 1-8. The real regions (which do contain 1-8) must be deduced.
// A circle's digit counts how many cells of its 3x3 (including itself) lie in
// both the real and false region the circle belongs to.
//
// The real regions are chaos construction (CC cells). The false regions are
// fixed data, so each circle's candidate set -- the 3x3 cells sharing its false
// region -- is known up front; the digit is then just how many of those share
// the circle's real region, which is exactly a ChaosCount over that set.

const N = 8;
const cc = (r, c) => `CC${(r - 1) * N + c}`;   // real-region (chaos) cell id

// Fixed false-region id per cell, row-major R1..R8.
const FALSE = [
  [7, 1, 0, 0, 0, 0, 0, 0],
  [7, 1, 1, 1, 1, 1, 1, 0],
  [7, 7, 7, 7, 7, 7, 1, 0],
  [4, 4, 4, 4, 4, 4, 4, 5],
  [6, 6, 2, 4, 2, 2, 2, 5],
  [6, 3, 2, 2, 2, 2, 3, 5],
  [6, 3, 3, 3, 3, 3, 3, 5],
  [6, 6, 6, 6, 5, 5, 5, 5],
];
const falseAt = (r, c) => FALSE[r - 1][c - 1];

const givens = [
  ['R1C5', 8], ['R1C8', 7], ['R3C4', 5], ['R3C7', 1],
  ['R6C2', 1], ['R8C1', 6], ['R8C4', 7],
];
const circles = [
  'R2C2', 'R4C2', 'R6C2', 'R3C7', 'R5C7', 'R7C7', 'R8C2', 'R1C7',
  'R7C1', 'R8C3', 'R1C6', 'R2C8', 'R2C5', 'R7C4', 'R6C5',
];

const constraints = [
  new Shape('8x8'),
  new NoBoxes(),
  new ChaosConstruction(),
  new Var('D', 'distinct', N),   // a distinct-digit count per false region
];
for (const [cell, v] of givens) constraints.push(new Given(cell, v));

const falseCells = new Map();   // region id -> [cellId...]
for (let r = 1; r <= N; r++)
  for (let c = 1; c <= N; c++) {
    const f = falseAt(r, c);
    if (!falseCells.has(f)) falseCells.set(f, []);
    falseCells.get(f).push(makeCellId(r, c));
  }

// "Destroy" each false region: it must hold fewer than 8 distinct digits, so it
// can't be a full 1-8 set. CountDistinct ties a control cell to the distinct
// count; capping the control at 7 forbids a complete region.
for (const [f, cells] of falseCells) {
  const control = `VD${f + 1}`;
  constraints.push(new Given(control, 1, 2, 3, 4, 5, 6, 7));
  constraints.push(new CountDistinct(control, ...cells));
}

// Circle overlap counts. The candidate set is fixed (3x3 cells that share the
// circle's false region); ChaosCount then counts how many share its real region.
for (const circle of circles) {
  const { row: r, col: c } = parseCellId(circle);
  const fr = falseAt(r, c);
  const set = [cc(r, c)];   // the circle's own real-region cell is the reference
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 1 || nr > N || nc < 1 || nc > N) continue;
      if (falseAt(nr, nc) === fr) set.push(cc(nr, nc));
    }
  constraints.push(new ChaosCount(circle, 0, ...set));
}

return constraints;
