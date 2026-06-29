// Puzzle: Inset
// https://sudokupad.app/nlmbdwt4wn
// Author: Michael Lefkowitz
//
// Five Latin squares (sizes 6,5,4,3,2) cascade down the diagonal, each sharing
// its top-left corner with the previous grid's bottom-right. Every grid is a
// Latin square with no boxes; each circle has an odd sum, each square an even sum.
// Smaller grids' cells become Var cells (VB#/VC#/VD#/VE#) so each square reads
// independently. Odd/even-sum clues use a parity NFA.

const GRIDS = [
  { N: 6, r0: 0, c0: 0 },
  { N: 5, r0: 3, c0: 3 },
  { N: 4, r0: 6, c0: 6 },
  { N: 3, r0: 8, c0: 8 },
  { N: 2, r0: 10, c0: 10 },
];
const rect = (r0, r1, c0, c1) => {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([r, c]);
  return out;
};
const ODD_SHAPES = [rect(3, 5, 0, 2), rect(3, 4, 6, 7), rect(7, 8, 7, 8), rect(9, 10, 9, 10)];
const EVEN_SHAPES = [rect(6, 7, 5, 6), rect(0, 1, 1, 2)];
const ODD_SINGLES = [[2, 3], [0, 3], [0, 5]];
const EVEN_SINGLES = [[4, 5], [2, 1]];
const LETTER = ['A', 'B', 'C', 'D', 'E'];
const LABEL = ['6x6', '5x5', '4x4', '3x3', '2x2'];
const key = (r, c) => `${r},${c}`;
const ownerIndex = (r, c) =>
  GRIDS.findIndex(g => r >= g.r0 && r < g.r0 + g.N && c >= g.c0 && c < g.c0 + g.N);
const idOf = new Map();
const varCounts = [0, 0, 0, 0, 0];
for (const g of GRIDS)
  for (let i = 0; i < g.N; i++)
    for (let j = 0; j < g.N; j++) {
      const k = key(g.r0 + i, g.c0 + j);
      if (idOf.has(k)) continue;
      const oi = ownerIndex(g.r0 + i, g.c0 + j);
      idOf.set(k, oi === 0
        ? `R${g.r0 + i + 1}C${g.c0 + j + 1}`
        : `V${LETTER[oi]}${++varCounts[oi]}`);
    }
const cid = (r, c) => idOf.get(key(r, c));
const minN = (r, c) => Math.min(...GRIDS
  .filter(g => r >= g.r0 && r < g.r0 + g.N && c >= g.c0 && c < g.c0 + g.N)
  .map(g => g.N));
const parityNFA = (parity) => NFA.encodeSpec({
  startState: 0,
  transition: (sum, v) => (sum + v) % 2,
  accept: (sum) => sum === parity,
}, 6);
const ODD = parityNFA(1);
const EVEN = parityNFA(0);
const constraints = [new Shape('6x6'), new NoBoxes()];
for (let i = 1; i < GRIDS.length; i++) {
  constraints.push(new Var(LETTER[i], LABEL[i], varCounts[i]));
}
const parityAt = new Map();
for (const [r, c] of ODD_SINGLES) parityAt.set(key(r, c), 1);
for (const [r, c] of EVEN_SINGLES) parityAt.set(key(r, c), 0);
for (const [k, id] of idOf) {
  const [r, c] = k.split(',').map(Number);
  const hi = minN(r, c);
  const par = parityAt.get(k);
  const cands = [];
  for (let v = 1; v <= hi; v++) if (par === undefined || v % 2 === par) cands.push(v);
  if (hi < 6 || par !== undefined) constraints.push(new Given(id, ...cands));
}
for (const g of GRIDS) {
  if (g.N === 6) continue;
  for (let i = 0; i < g.N; i++) {
    const row = []; for (let j = 0; j < g.N; j++) row.push(cid(g.r0 + i, g.c0 + j));
    constraints.push(new AllDifferent(...row));
  }
  for (let j = 0; j < g.N; j++) {
    const col = []; for (let i = 0; i < g.N; i++) col.push(cid(g.r0 + i, g.c0 + j));
    constraints.push(new AllDifferent(...col));
  }
}
for (const cells of ODD_SHAPES) constraints.push(new NFA(ODD, 'odd sum', ...cells.map(([r, c]) => cid(r, c))));
for (const cells of EVEN_SHAPES) constraints.push(new NFA(EVEN, 'even sum', ...cells.map(([r, c]) => cid(r, c))));
return constraints;
