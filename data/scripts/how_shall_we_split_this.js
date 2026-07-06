// Puzzle: How Shall We Split This?
// https://logic-masters.de/Raetselportal/Raetsel/zeigen.php?chlang=en&id=000MIE
//
// Each region is partitioned into one or more runs that share a common sum.
// The number of runs is given by the green-circle cell, which is read first to
// seed the state machine and then appears again in its place within the region
// (so it is listed twice per segment). MAX_SUM/MAX_VALUE bound the state machine;
// 20 and 5 are the smallest values that admit the true solution, and they already
// make it unique.

const MAX_SUM = 20;
const MAX_VALUE = 5;

const nfa = NFA.encodeSpec({
  // `splits` is null in the seed state, before the green circle sets the count.
  startState: { splits: null, current: 0, target: null },
  transition({ splits, current, target }, value) {
    if (splits === null) {
      if (value > MAX_VALUE) return [];
      return [{ splits: value, current, target }];
    }

    const newSum = current + value;
    if (newSum > MAX_SUM) return [];

    const nextStates = [];

    // Extend the current run, as long as it doesn't overshoot the shared sum.
    if (target === null || newSum <= target) {
      nextStates.push({ splits, current: newSum, target });
    }

    // Close the current run and start a new one. The first run sets the target;
    // later runs may only close once they match it.
    if (splits > 0 && (target === null || newSum === target)) {
      nextStates.push({ splits: splits - 1, current: 0, target: newSum });
    }

    return nextStates;
  },
  accept({ splits, current, target }) {
    return splits === 0 && current === target;
  },
}, 9);

// Each segment is the green-circle (split-count) cell followed by the ordered
// region path. The green circle is repeated where it sits within the region.
const segments = [
  ['R1C1', 'R1C1', 'R2C1', 'R3C1'],
  ['R1C2', 'R1C2', 'R1C3', 'R1C4', 'R1C5', 'R1C6', 'R1C7', 'R1C8', 'R1C9'],
  ['R2C2', 'R2C3', 'R2C2', 'R3C2', 'R4C2', 'R5C2', 'R6C2', 'R6C3', 'R5C3'],
  ['R2C4', 'R2C4', 'R3C4', 'R3C5', 'R2C5', 'R2C6', 'R3C6'],
  ['R2C9', 'R2C9', 'R3C9', 'R3C8', 'R2C8', 'R2C7', 'R3C7'],
  ['R8C1', 'R9C2', 'R9C1', 'R8C1', 'R7C1', 'R6C1', 'R5C1', 'R4C1'],
  ['R3C3', 'R3C3', 'R4C3', 'R5C4', 'R5C5'],
  ['R8C2', 'R9C3', 'R8C3', 'R8C2', 'R7C2', 'R7C3', 'R6C4', 'R6C5'],
  ['R6C6', 'R6C7', 'R6C6', 'R5C6', 'R5C7', 'R6C8', 'R6C9', 'R5C9', 'R4C9',
    'R4C8', 'R5C8', 'R4C7', 'R4C6', 'R4C5', 'R4C4'],
  ['R8C8', 'R8C8', 'R7C7', 'R7C8', 'R7C9', 'R8C9', 'R9C9', 'R9C8', 'R9C7',
    'R8C7', 'R9C6', 'R9C5', 'R8C5', 'R9C4', 'R8C4', 'R7C4', 'R7C5', 'R7C6', 'R8C6'],
];

return segments.map(seg => new NFA(nfa, '', ...seg));
