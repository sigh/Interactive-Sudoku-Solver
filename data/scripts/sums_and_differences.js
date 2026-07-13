// Sums and differences by alarark50
// https://sudokupad.app/qj4kzxhp02
// https://www.youtube.com/watch?v=a-jajrZJXr0
//
// Navy-line rule: from the circled end (position 1), every nth cell is the SUM
// of its two line-neighbours and every mth their absolute DIFFERENCE; n and m are
// shared by both lines and must be deciphered.
//
// One multiSegment NFA per rule, run over both lines so its period carries across
// the SEGMENT_BREAK and stays shared.

const graph = cellGraph('9x9');
const geometry = cellGeometry('9x9');

const navyLines = [
  ['R2C2', 'R1C3', 'R2C4', 'R3C4', 'R4C3', 'R5C3', 'R6C2', 'R7C2', 'R8C3',
    'R9C4', 'R8C5', 'R8C6', 'R8C7', 'R7C7', 'R6C6', 'R5C6', 'R4C5', 'R3C6'],
  ['R2C9', 'R3C8', 'R4C9', 'R5C8', 'R6C8', 'R6C9'],
];

// Candidate periods: a line's first nth cell is at position = period,
// thus the period needs to land in the shorter line.
const shortestLineLen = Math.min(...navyLines.map(line => line.length));
const PERIODS = [];
for (let period = 2; period < shortestLineLen; period++) {
  PERIODS.push(period);
}

// One machine per rule; `relation(left, cell, right)` is what a designated cell
// must satisfy. State { period, phase, window }:
//   period - the shared period being tried
//   phase  - steps into the current period
//   window - the last two values read (a sliding window over the line)
const periodMachine = (relation) => NFA.encodeSpec({
  startState: PERIODS.map(period => ({ period, phase: 0, window: [] })),

  transition: ({ period, phase, window }, value) => {
    if (value === SEGMENT_BREAK) return { period, phase: 0, window: [] };
    window.push(value);
    if (phase === 0 && window.length === 3) {
      if (!relation(...window)) return undefined;
    }
    return {
      period,
      phase: (phase + 1) % period,
      window: window.slice(-2),
    };
  },

  accept: () => true,
}, 9, { multiSegment: true });

return [
  // Sums-and-differences: one shared sum period, one shared diff period.
  new NFA(
    periodMachine((left, cell, right) => cell === left + right),
    'sum-period', ...navyLines),
  new NFA(
    periodMachine((left, cell, right) => cell === Math.abs(left - right)),
    'diff-period', ...navyLines),

  new Thermo('R8C1', 'R7C1', 'R6C1', 'R5C1', 'R4C1', 'R4C2'),
  new Thermo('R8C3', 'R7C4', 'R6C3', 'R5C3', 'R4C3', 'R3C2'),
  new Thermo('R5C5', 'R4C5', 'R3C5'),

  new BlackDot('R2C4', 'R2C5'),
  new BlackDot('R2C5', 'R2C6'),
  new BlackDot('R3C8', 'R4C8'),
  new BlackDot('R4C7', 'R4C8'),
  new BlackDot('R4C9', 'R5C9'),

  LittleKiller.fromCells(14, graph.ray('R7C1', 1, 1), geometry),
  LittleKiller.fromCells(10, graph.ray('R2C9', -1, -1), geometry),
];
