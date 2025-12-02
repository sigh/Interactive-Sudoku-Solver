const { SudokuConstraintHandler } = await import('./handlers.js' + self.VERSION_PARAM);
const { BitSet } = await import('../util.js' + self.VERSION_PARAM);

class CompressedNFA {
  constructor(numStates, acceptingStates, startingStates, transitionLists) {
    this.numStates = numStates;
    this.acceptingStates = acceptingStates;
    this.startingStates = startingStates;
    this.transitionLists = transitionLists;
  }

  static makeTransitionEntry(mask, state) {
    // Transition entry layout: [state: 16 bits, mask: 16 bits]
    // This allows us to store the transitions compactly in a single Uint32Array.
    // The entry can be checked directly against a value since values are
    // also at most 16 bits.
    return (state << 16) | mask;
  }
}

export const compressNFA = (nfa) => {
  nfa.seal();
  nfa.closeOverEpsilonTransitions();

  const numStates = nfa.numStates();
  if (numStates > (1 << 16)) {
    throw new Error('NFA has too many states to represent');
  }

  const acceptingStates = new BitSet(numStates);
  const startingStates = new BitSet(numStates);

  for (const id of nfa.getStartIds()) {
    startingStates.add(id);
  }

  // Build transition lists with compressed entries.
  // For each state, group targets by state and combine symbol masks.
  const transitionListsRaw = [];
  let totalTransitions = 0;

  for (let stateId = 0; stateId < numStates; stateId++) {
    if (nfa.isAccepting(stateId)) {
      acceptingStates.add(stateId);
    }

    const stateTransitions = nfa.getStateTransitions(stateId);
    const targetMasks = new Map();

    for (let symbolIndex = 0; symbolIndex < stateTransitions.length; symbolIndex++) {
      const targets = stateTransitions[symbolIndex];
      if (!targets) continue;
      const mask = 1 << symbolIndex;
      for (const target of targets) {
        targetMasks.set(target, (targetMasks.get(target) || 0) | mask);
      }
    }

    const transitionList = [];
    for (const [target, mask] of targetMasks) {
      transitionList.push(CompressedNFA.makeTransitionEntry(mask, target));
    }
    transitionListsRaw.push(transitionList);
    totalTransitions += transitionList.length;
  }

  // Flatten into a single backing array for memory efficiency.
  const transitionBackingArray = new Uint32Array(totalTransitions);
  const transitionLists = [];
  let transitionOffset = 0;

  for (let i = 0; i < numStates; i++) {
    const rawList = transitionListsRaw[i];
    const numTransitions = rawList.length;
    const transitionList = transitionBackingArray.subarray(
      transitionOffset,
      transitionOffset + numTransitions);
    transitionOffset += numTransitions;
    transitionList.set(rawList);
    transitionLists.push(transitionList);
  }

  return new CompressedNFA(
    numStates,
    acceptingStates,
    startingStates,
    transitionLists,
  );
};

// Enforces a linear regex constraint by compiling the pattern into a DFA and
// propagating it across candidate sets to prune unsupported values.
export class DFALine extends SudokuConstraintHandler {
  constructor(cells, cnfa) {
    super(cells);
    this._cnfa = cnfa;

    const stateCapacity = this._cnfa.numStates;
    const slots = this.cells.length + 1;
    const { bitsets, words } = BitSet.allocatePool(stateCapacity, slots);
    this._stateWords = words;
    this._statesList = bitsets;
  }

  getNFA() {
    return this._cnfa;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const cnfa = this._cnfa;
    const transitionLists = cnfa.transitionLists;
    const statesList = this._statesList;

    // Clear all the states so we can reuse the bitsets without reallocating.
    this._stateWords.fill(0);

    // Forward pass: Find all states reachable from the start state.
    statesList[0].copyFrom(cnfa.startingStates);

    for (let i = 0; i < numCells; i++) {
      const nextStates = statesList[i + 1];
      const currentStatesWords = statesList[i].words;
      const values = grid[cells[i]];

      // Note: We operate directly on the bitset words for performance.
      // Encapsulating this in methods caused significant overhead.
      for (let wordIndex = 0; wordIndex < currentStatesWords.length; wordIndex++) {
        let word = currentStatesWords[wordIndex];
        while (word) {
          const lowestBit = word & -word;
          word ^= lowestBit;
          const stateIndex = BitSet.bitIndex(wordIndex, lowestBit);
          const transitionList = transitionLists[stateIndex];
          for (let j = 0; j < transitionList.length; j++) {
            const entry = transitionList[j];
            if (values & entry) {
              nextStates.add(entry >>> 16);
            }
          }
        }
      }

      if (nextStates.isEmpty()) return false;
    }

    // Backward pass: Filter down to only the states that can reach an accepting
    // state. Prune any unsupported values from the grid.
    const finalStates = statesList[numCells];
    finalStates.intersect(cnfa.acceptingStates);
    if (finalStates.isEmpty()) return false;

    for (let i = numCells - 1; i >= 0; i--) {
      const currentStatesWords = statesList[i].words;
      const nextStates = statesList[i + 1];
      const values = grid[cells[i]];
      let supportedValues = 0;

      // Note: We operate directly on the bitset words for performance.
      // Encapsulating this in methods caused significant overhead.
      for (let wordIndex = 0; wordIndex < currentStatesWords.length; wordIndex++) {
        let word = currentStatesWords[wordIndex];
        let keptWord = 0;
        while (word) {
          const lowestBit = word & -word;
          word ^= lowestBit;
          const stateIndex = BitSet.bitIndex(wordIndex, lowestBit);
          const transitionList = transitionLists[stateIndex];
          let stateSupportedValues = 0;
          for (let j = 0; j < transitionList.length; j++) {
            const entry = transitionList[j];
            const maskedValues = values & entry;
            if (maskedValues) {
              if (nextStates.has(entry >>> 16)) {
                stateSupportedValues |= maskedValues;
              }
            }
          }

          if (stateSupportedValues) {
            keptWord |= lowestBit;
            supportedValues |= stateSupportedValues;
          }
        }
        currentStatesWords[wordIndex] = keptWord;
      }

      if (!supportedValues) return false;

      if (values !== supportedValues) {
        grid[cells[i]] = supportedValues;
        handlerAccumulator.addForCell(cells[i]);
      }
    }

    return true;
  }
}
