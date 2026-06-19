# Puzzle: Inset
# https://sudokupad.app/nlmbdwt4wn
# Author: Michael Lefkowitz
#
# Five Latin squares (sizes 6,5,4,3,2) cascade down the diagonal, each sharing
# its top-left corner with the previous grid's bottom-right. Every grid is a
# Latin square with no boxes; each circle has an odd sum, each square an even sum.
#
# Grid A (6x6) is the native grid; cells of the smaller grids become Var cells
# (VB#, VC#, VD#, VE#) so the solution reads one square at a time. Their rows and
# columns are added as explicit AllDifferent, and each cell is restricted to
# 1..N of the smallest grid containing it. Odd/even-sum clues use a parity NFA.
# Coordinates below are 0-indexed staircase (r,c); grid A is r,c <= 5.
#
# Generated with the following sandbox script:
#
# const GRIDS = [
#   { N: 6, r0: 0, c0: 0 },
#   { N: 5, r0: 3, c0: 3 },
#   { N: 4, r0: 6, c0: 6 },
#   { N: 3, r0: 8, c0: 8 },
#   { N: 2, r0: 10, c0: 10 },
# ];
# const rect = (r0, r1, c0, c1) => {
#   const out = [];
#   for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([r, c]);
#   return out;
# };
# const ODD_SHAPES = [rect(3, 5, 0, 2), rect(3, 4, 6, 7), rect(7, 8, 7, 8), rect(9, 10, 9, 10)];
# const EVEN_SHAPES = [rect(6, 7, 5, 6), rect(0, 1, 1, 2)];
# const ODD_SINGLES = [[2, 3], [0, 3], [0, 5]];
# const EVEN_SINGLES = [[4, 5], [2, 1]];
# const LETTER = ['A', 'B', 'C', 'D', 'E'];
# const LABEL = ['6x6', '5x5', '4x4', '3x3', '2x2'];
# const key = (r, c) => `${r},${c}`;
# const ownerIndex = (r, c) =>
#   GRIDS.findIndex(g => r >= g.r0 && r < g.r0 + g.N && c >= g.c0 && c < g.c0 + g.N);
# const idOf = new Map();
# const varCounts = [0, 0, 0, 0, 0];
# for (const g of GRIDS)
#   for (let i = 0; i < g.N; i++)
#     for (let j = 0; j < g.N; j++) {
#       const k = key(g.r0 + i, g.c0 + j);
#       if (idOf.has(k)) continue;
#       const oi = ownerIndex(g.r0 + i, g.c0 + j);
#       idOf.set(k, oi === 0
#         ? `R${g.r0 + i + 1}C${g.c0 + j + 1}`
#         : `V${LETTER[oi]}${++varCounts[oi]}`);
#     }
# const cid = (r, c) => idOf.get(key(r, c));
# const minN = (r, c) => Math.min(...GRIDS
#   .filter(g => r >= g.r0 && r < g.r0 + g.N && c >= g.c0 && c < g.c0 + g.N)
#   .map(g => g.N));
# const parityNFA = (parity) => NFA.encodeSpec({
#   startState: 0,
#   transition: (sum, v) => (sum + v) % 2,
#   accept: (sum) => sum === parity,
# }, 6);
# const ODD = parityNFA(1);
# const EVEN = parityNFA(0);
# const constraints = [new Shape('6x6'), new NoBoxes()];
# for (let i = 1; i < GRIDS.length; i++) {
#   constraints.push(new Var(LETTER[i], LABEL[i], varCounts[i]));
# }
# const parityAt = new Map();
# for (const [r, c] of ODD_SINGLES) parityAt.set(key(r, c), 1);
# for (const [r, c] of EVEN_SINGLES) parityAt.set(key(r, c), 0);
# for (const [k, id] of idOf) {
#   const [r, c] = k.split(',').map(Number);
#   const hi = minN(r, c);
#   const par = parityAt.get(k);
#   const cands = [];
#   for (let v = 1; v <= hi; v++) if (par === undefined || v % 2 === par) cands.push(v);
#   if (hi < 6 || par !== undefined) constraints.push(new Given(id, ...cands));
# }
# for (const g of GRIDS) {
#   if (g.N === 6) continue;
#   for (let i = 0; i < g.N; i++) {
#     const row = []; for (let j = 0; j < g.N; j++) row.push(cid(g.r0 + i, g.c0 + j));
#     constraints.push(new AllDifferent(...row));
#   }
#   for (let j = 0; j < g.N; j++) {
#     const col = []; for (let i = 0; i < g.N; i++) col.push(cid(g.r0 + i, g.c0 + j));
#     constraints.push(new AllDifferent(...col));
#   }
# }
# for (const cells of ODD_SHAPES) constraints.push(new NFA(ODD, 'odd sum', ...cells.map(([r, c]) => cid(r, c))));
# for (const cells of EVEN_SHAPES) constraints.push(new NFA(EVEN, 'even sum', ...cells.map(([r, c]) => cid(r, c))));
# return constraints;

.Shape~6x6
.NoBoxes
.Var~B~5x5~16
.Var~C~4x4~12
.Var~D~3x3~5
.Var~E~2x2~3
.~R1C4_1_3_5
.~R1C6_1_3_5
.~R3C2_2_4_6
.~R3C4_1_3_5
.~R4C4_1_2_3_4_5
.~R4C5_1_2_3_4_5
.~R4C6_1_2_3_4_5
.~R5C4_1_2_3_4_5
.~R5C5_1_2_3_4_5
.~R5C6_2_4
.~R6C4_1_2_3_4_5
.~R6C5_1_2_3_4_5
.~R6C6_1_2_3_4_5
.~VB1_1_2_3_4_5
.~VB2_1_2_3_4_5
.~VB3_1_2_3_4_5
.~VB4_1_2_3_4_5
.~VB5_1_2_3_4_5
.~VB6_1_2_3_4_5
.~VB7_1_2_3_4_5
.~VB8_1_2_3_4_5
.~VB9_1_2_3_4_5
.~VB10_1_2_3_4
.~VB11_1_2_3_4
.~VB12_1_2_3_4_5
.~VB13_1_2_3_4_5
.~VB14_1_2_3_4_5
.~VB15_1_2_3_4
.~VB16_1_2_3_4
.~VC1_1_2_3_4
.~VC2_1_2_3_4
.~VC3_1_2_3_4
.~VC4_1_2_3_4
.~VC5_1_2_3_4
.~VC6_1_2_3_4
.~VC7_1_2_3
.~VC8_1_2_3
.~VC9_1_2_3_4
.~VC10_1_2_3_4
.~VC11_1_2_3
.~VC12_1_2_3
.~VD1_1_2_3
.~VD2_1_2_3
.~VD3_1_2_3
.~VD4_1_2_3
.~VD5_1_2
.~VE1_1_2
.~VE2_1_2
.~VE3_1_2
.AllDifferent~R4C4~R4C5~R4C6~VB1~VB2
.AllDifferent~R5C4~R5C5~R5C6~VB3~VB4
.AllDifferent~R6C4~R6C5~R6C6~VB5~VB6
.AllDifferent~VB7~VB8~VB9~VB10~VB11
.AllDifferent~VB12~VB13~VB14~VB15~VB16
.AllDifferent~R4C4~R5C4~R6C4~VB7~VB12
.AllDifferent~R4C5~R5C5~R6C5~VB8~VB13
.AllDifferent~R4C6~R5C6~R6C6~VB9~VB14
.AllDifferent~VB1~VB3~VB5~VB10~VB15
.AllDifferent~VB2~VB4~VB6~VB11~VB16
.AllDifferent~VB10~VB11~VC1~VC2
.AllDifferent~VB15~VB16~VC3~VC4
.AllDifferent~VC5~VC6~VC7~VC8
.AllDifferent~VC9~VC10~VC11~VC12
.AllDifferent~VB10~VB15~VC5~VC9
.AllDifferent~VB11~VB16~VC6~VC10
.AllDifferent~VC1~VC3~VC7~VC11
.AllDifferent~VC2~VC4~VC8~VC12
.AllDifferent~VC7~VC8~VD1
.AllDifferent~VC11~VC12~VD2
.AllDifferent~VD3~VD4~VD5
.AllDifferent~VC7~VC11~VD3
.AllDifferent~VC8~VC12~VD4
.AllDifferent~VD1~VD2~VD5
.AllDifferent~VD5~VE1
.AllDifferent~VE2~VE3
.AllDifferent~VD5~VE2
.AllDifferent~VE1~VE3
.NFA~QXf1fqg~_odd%20sum~R4C1~R4C2~R4C3~R5C1~R5C2~R5C3~R6C1~R6C2~R6C3
.NFA~QXf1fqg~_odd%20sum~VB1~VB2~VB3~VB4
.NFA~QXf1fqg~_odd%20sum~VB16~VC3~VC6~VC7
.NFA~QXf1fqg~_odd%20sum~VC12~VD2~VD4~VD5
.NFA~QW_1fqg~_even%20sum~VB9~VB10~VB14~VB15
.NFA~QW_1fqg~_even%20sum~R1C2~R1C3~R2C2~R2C3
