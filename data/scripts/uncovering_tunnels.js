// Uncovering tunnels by Vythic
// https://sudokupad.app/y323plq5im
//
// Chaos construction with parity-count arrows (NFA), orange whisper lines whose
// endpoints lie in different regions, and per-row distinct-count circles.

const ARROW_DEFS = [
  { origin: 'R6C1', arm: ['CC46', 'CC37', 'CC28', 'CC19', 'CC10', 'CC1'] },
  { origin: 'R3C2', arm: ['CC20', 'CC29', 'CC38', 'CC47', 'CC56', 'CC65', 'CC74'] },
  { origin: 'R3C3', arm: ['CC21', 'CC30', 'CC39', 'CC48', 'CC57', 'CC66', 'CC75'] },
  { origin: 'R1C3', arm: ['CC3', 'CC4', 'CC5', 'CC6', 'CC7', 'CC8', 'CC9'] },
  { origin: 'R1C4', arm: ['CC4', 'CC12', 'CC20', 'CC28'] },
  { origin: 'R3C5', arm: ['CC23', 'CC14', 'CC5'] },
  { origin: 'R3C5', arm: ['CC23', 'CC15', 'CC7'] },
  { origin: 'R2C8', arm: ['CC17', 'CC16', 'CC15', 'CC14', 'CC13', 'CC12', 'CC11', 'CC10'] },
  { origin: 'R4C7', arm: ['CC34', 'CC33', 'CC32', 'CC31', 'CC30', 'CC29', 'CC28'] },
  { origin: 'R5C4', arm: ['CC40', 'CC49', 'CC58', 'CC67', 'CC76'] },
  { origin: 'R7C5', arm: ['CC59', 'CC68', 'CC77'] },
  { origin: 'R7C5', arm: ['CC59', 'CC67', 'CC75'] },
  { origin: 'R8C7', arm: ['CC70', 'CC71', 'CC72'] },
  { origin: 'R7C9', arm: ['CC63', 'CC54', 'CC45', 'CC36', 'CC27', 'CC18', 'CC9'] },
  { origin: 'R6C6', arm: ['CC51', 'CC52', 'CC53', 'CC54'] },
];

const ORANGE_LINE_PAIRS = [
  ['R6C1', 'R6C2'],
  ['R2C7', 'R3C7'],
  ['R3C6', 'R4C6'],
  ['R4C7', 'R5C6'],
  ['R4C9', 'R5C8'],
  ['R6C5', 'R7C6'],
  ['R7C7', 'R7C8'],
  ['R7C3', 'R8C3'],
];

const CIRCLE_CELLS = [
  'R1C2', 'R2C8', 'R3C6', 'R4C7', 'R5C3', 'R6C4', 'R7C4', 'R8C8', 'R9C6',
];

// NFA: Opposite-parity count (arrow cells, over digit values only)
// Cell sequence: [arrow_cell, dir_cell_1, dir_cell_2, ...]
const parityCountSpec = {
  startState: null,
  transition(state, value) {
    if (state === null) return { target: value, count: 0 };
    const newCount = state.count + ((value % 2) !== (state.target % 2) ? 1 : 0);
    if (newCount > state.target) return undefined;
    return { target: state.target, count: newCount };
  },
  accept: (state) => state !== null && state.count === state.target,
};

const parityCountNFA = NFA.encodeSpec(parityCountSpec, 9);

// Helpers

const ccToGrid = (ccId) => {
  const n = +ccId.slice(2) - 1;
  return `R${Math.floor(n / 9) + 1}C${(n % 9) + 1}`;
};

const gridToCC = (cellId) => {
  const r = +cellId.match(/R(\d+)/)[1];
  const c = +cellId.match(/C(\d+)/)[1];
  return `CC${(r - 1) * 9 + c}`;
};

const rowCC = (row) => Array.from({ length: 9 }, (_, i) => `CC${(row - 1) * 9 + i + 1}`);

// Build constraints

const chaosArrows = ARROW_DEFS.map(({ origin, arm }) => new ChaosArrow(origin, 1, ...arm));

const parityCounts = ARROW_DEFS.map(({ origin, arm }) =>
  new NFA(parityCountNFA, 'ParityCount', origin, ...arm.slice(1).map(ccToGrid))
);

const orangeLines = ORANGE_LINE_PAIRS.flatMap(([a, b]) => [
  new Whisper(4, a, b),
  new AllDifferent(gridToCC(a), gridToCC(b)),
]);

const circles = CIRCLE_CELLS.map(cell => {
  const row = +cell.match(/R(\d+)/)[1];
  return new CountDistinct(cell, ...rowCC(row));
});

return [
  new Shape('9x9'),
  new ChaosConstruction(),
  new NoBoxes(),
  ...chaosArrows,
  ...parityCounts,
  ...orangeLines,
  ...circles,
];
