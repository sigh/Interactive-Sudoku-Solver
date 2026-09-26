const { SudokuConstraintHandler, InvalidConstraintError } = await import('./handlers.js' + self.VERSION_PARAM);
const { BitSet } = await import('../util.js' + self.VERSION_PARAM);

class CompressedNFA {
  constructor(numStates, acceptingStates, startingStates, transitionLists, numSymbols) {
    this.numStates = numStates;
    this.acceptingStates = acceptingStates;
    this.startingStates = startingStates;
    this.transitionLists = transitionLists;
    this.numSymbols = numSymbols;
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
    nfa.numSymbols(),
  );
};

// Enforces a sequential constraint (regex / line constraints) by propagating a
// compiled NFA across the cells' candidate sets to prune unsupported values.
// See handler_docs/nfa.md for the full algorithm.
export class NFAConstraint extends SudokuConstraintHandler {
  constructor(segments, cnfa) {
    super(segments.flat());
    this._cnfa = cnfa;
    this._segmentBreakMask = 0;

    // `steps` is the sequence the automaton actually consumes:
    // the real cells with a -1 boundary marker inserted between segments.
    // `this.cells` (from super) holds only the real cells.
    const steps = [];
    segments.forEach((segment, i) => {
      if (i > 0) steps.push(-1);
      for (const cell of segment) steps.push(cell);
    });
    this._steps = steps;

    const stateCapacity = this._cnfa.numStates;
    const slots = steps.length + 1;
    // One extra slot is scratch for the forward pass.
    const { bitsets } = BitSet.allocatePool(stateCapacity, slots + 1);
    this._scratchWords = bitsets.pop().words;
    this._statesList = bitsets;

    // Memo of the last successful call (handler_docs/nfa.md §8): each step's
    // values on return, for which `_statesList` holds the filtered layers.
    // Segment-break entries are never read, so 16 bits suffice. Lines that
    // visit a cell twice have no memo, as a pass there isn't idempotent.
    this._memoValues = new Set(this.cells).size === this.cells.length
      ? new Uint16Array(steps.length) : null;
    this._memoValid = false;
  }

  initialize(initialGridCells, cellExclusions, geometry, stateAllocator) {
    const isMultiSegment = this._steps.includes(-1);
    if (isMultiSegment && this._cnfa.numSymbols < geometry.numValues + 1) {
      throw new InvalidConstraintError(
        `NFA has ${this._cnfa.numSymbols} symbols but requires ` +
        `${geometry.numValues + 1} symbols. Ensure the NFA is compiled as multiSegment.`);
    }
    // The segment break is the symbol just past the real values (see nfa_builder's
    // segmentBreakSymbol), so its mask bit is numValues.
    this._segmentBreakMask = 1 << geometry.numValues;
    return true;
  }

  getNFA() {
    return this._cnfa;
  }

  enforceConsistency(grid, pQueue) {
    const steps = this._steps;
    const numSteps = steps.length;
    const segmentBreakMask = this._segmentBreakMask;
    const cnfa = this._cnfa;
    const transitionLists = cnfa.transitionLists;
    const statesList = this._statesList;
    const memoValues = this._memoValues;
    const scratchWords = this._scratchWords;

    // The memo is reusable if no cell gained a value since (e.g. by a
    // backtrack). Otherwise, do a full pass.
    let reuse = this._memoValid;
    for (let i = 0; reuse && i < numSteps; i++) {
      if (steps[i] >= 0 && (grid[steps[i]] & ~memoValues[i])) reuse = false;
    }
    if (!reuse) statesList[0].copyFrom(cnfa.startingStates);
    this._memoValid = false;

    // Forward pass: Find all states reachable from the start state.
    // A step whose values and incoming layer are unchanged since the memo
    // leaves its outgoing layer unchanged, so it's skipped. Recomputed layers
    // are intersected with the stored ones, which can't lose a state on an
    // accepted path while the line only narrows.
    let start = -1;  // The first and one past the last recomputed step.
    let end = 0;
    let layerChanged = false;
    for (let i = 0; i < numSteps; i++) {
      const step = steps[i];
      const values = step < 0 ? segmentBreakMask : grid[step];
      if (reuse && !layerChanged && (step < 0 || values === memoValues[i])) continue;
      if (start < 0) start = i;
      end = i + 1;

      // Cheaper than `fill` for the typical one or two words.
      for (let w = 0; w < scratchWords.length; w++) scratchWords[w] = 0;
      const currentStatesWords = statesList[i].words;

      // Note: We operate directly on the bitset words for performance.
      // Encapsulating this in methods caused significant overhead, so the bit
      // iteration and the `add`/`bitIndex` calls are all inlined here.
      for (let wordIndex = 0; wordIndex < currentStatesWords.length; wordIndex++) {
        let word = currentStatesWords[wordIndex];
        const stateIndexBase = (wordIndex << 5) + 31;
        while (word) {
          const clz = Math.clz32(word);
          word ^= 0x80000000 >>> clz;
          const transitionList = transitionLists[stateIndexBase - clz];
          const len = transitionList.length;
          for (let j = 0; j < len; j++) {
            const entry = transitionList[j];
            if (values & entry) {
              scratchWords[entry >>> 21] |= 1 << (entry >>> 16);
            }
          }
        }
      }

      // Store the new layer, intersected with the stored one if reusing it.
      const nextWords = statesList[i + 1].words;
      let anyState = 0;
      layerChanged = false;
      for (let w = 0; w < nextWords.length; w++) {
        const word = reuse ? nextWords[w] & scratchWords[w] : scratchWords[w];
        if (word !== nextWords[w]) {
          nextWords[w] = word;
          layerChanged = true;
        }
        anyState |= word;
      }
      if (!anyState) return false;
    }

    if (start < 0) {  // Unchanged: already at a fixpoint.
      this._memoValid = true;
      return true;
    }

    // Backward pass: Filter down to only the states that can reach an accepting
    // state. Prune any unsupported values from the grid.
    const finalStates = statesList[numSteps];
    finalStates.intersect(cnfa.acceptingStates);
    if (finalStates.isEmpty()) return false;

    // Steps from `end` on are unchanged, so they filter to themselves.
    for (let i = end - 1; i >= 0; i--) {
      const currentStatesWords = statesList[i].words;
      const nextWords = statesList[i + 1].words;
      const step = steps[i];
      const values = step < 0 ? segmentBreakMask : grid[step];
      let supportedValues = 0;
      layerChanged = false;

      // Note: We operate directly on the bitset words for performance.
      // Encapsulating this in methods caused significant overhead, so the bit
      // iteration and the `has`/`bitIndex` calls are all inlined here.
      for (let wordIndex = 0; wordIndex < currentStatesWords.length; wordIndex++) {
        let word = currentStatesWords[wordIndex];
        let keptWord = 0;
        const wordBase = wordIndex << 5;
        while (word) {
          const lowestBit = word & -word;
          word ^= lowestBit;
          const stateIndex = wordBase + (31 - Math.clz32(lowestBit));
          const transitionList = transitionLists[stateIndex];
          const len = transitionList.length;
          let stateSupportedValues = 0;
          for (let j = 0; j < len; j++) {
            const entry = transitionList[j];
            const maskedValues = values & entry;
            if (maskedValues) {
              if (nextWords[entry >>> 21] & (1 << (entry >>> 16))) {
                stateSupportedValues |= maskedValues;
              }
            }
          }

          if (stateSupportedValues) {
            keptWord |= lowestBit;
            supportedValues |= stateSupportedValues;
          }
        }
        if (keptWord !== currentStatesWords[wordIndex]) layerChanged = true;
        currentStatesWords[wordIndex] = keptWord;
      }

      if (!supportedValues) return false;

      if (step >= 0 && values !== supportedValues) {
        grid[step] = supportedValues;
        pQueue.addForCell(step);
      }
      if (memoValues) memoValues[i] = supportedValues;

      // Left of `start`, the steps are unchanged: once a layer is too, every
      // layer further left is.
      if (i < start && !layerChanged) break;
    }

    this._memoValid = memoValues !== null;
    return true;
  }
}
