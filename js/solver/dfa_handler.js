const { SudokuConstraintHandler } = await import('./handlers.js' + self.VERSION_PARAM);

class DFA {
  constructor(numStates, acceptingStates, startingState, transitionLists) {
    this.numStates = numStates;
    this.acceptingStates = acceptingStates;
    this.startingState = startingState;
    this.transitionLists = transitionLists;
  }
}

export const NFAToDFA = (nfa, numValues) => {
  const dfaBuilder = new DFABuilder(nfa, numValues);
  return dfaBuilder.build();
};

class DFABuilder {
  static RAW_DFA_START_STATE = 0;

  constructor(nfa, numSymbols) {
    this._nfa = nfa;
    this.numSymbols = numSymbols;
  }

  static _RawState = class {
    constructor(nfaStates, accepting, numSymbols) {
      this.nfaStates = nfaStates;
      this.accepting = accepting;
      this.transitions = new Array(numSymbols).fill(-1)
    }
  };

  build() {
    this._nfa.closeOverEpsilonTransitions();

    const rawDfaStates = this._constructDFA();
    const minimizedStates = this._minimize(rawDfaStates);
    return this._flattenStates(minimizedStates);
  }

  // Phase 1: Build the raw DFA data — a dense transition table and
  // an "accepting" bit for each state.
  _constructDFA() {
    const numSymbols = this.numSymbols;
    const rawDfaStates = [];
    const closureMap = new Map();

    const stateSetKey = (states) => [...states].sort((a, b) => a - b).join(',');

    const addRawDfaState = (stateSet) => {
      const key = stateSetKey(stateSet);
      const index = rawDfaStates.length;
      closureMap.set(key, index);
      const isAccepting = [...stateSet].some((stateId) =>
        this._nfa.acceptIds.has(stateId));
      const newRawState =
        new DFABuilder._RawState(
          stateSet,
          isAccepting,
          numSymbols);
      rawDfaStates.push(newRawState);
      return newRawState;
    };

    const startSet = new Set([this._nfa.startId]);
    const stack = [addRawDfaState(startSet)];

    while (stack.length) {
      const currentDfaState = stack.pop();
      const currentStateIds = currentDfaState.nfaStates;
      const currentTransitionRow = currentDfaState.transitions;

      for (let i = 0; i < numSymbols; i++) {
        const symbol = 1 << i;
        const moveSet = new Set();
        for (const currentStateId of currentStateIds) {
          const nfaState = this._nfa.states[currentStateId];
          for (const transition of nfaState.transitions) {
            if (transition.symbols & symbol) {
              moveSet.add(transition.state);
            }
          }
        }
        if (!moveSet.size) continue;

        const nextKey = stateSetKey(moveSet);
        if (!closureMap.has(nextKey)) {
          stack.push(addRawDfaState(moveSet));
        }
        currentTransitionRow[i] = closureMap.get(nextKey);
      }
    }

    return rawDfaStates;
  }

  // Phase 2: Minimize the DFA using Moore's partition-refinement algorithm.
  // 1. Split state indices into accepting vs. other states
  // 2. Repeatedly refine partitions so states with different successor partitions
  //    (for any symbol) move into separate blocks.
  // 3. Collapse each final partition into a single state, synthesizing their
  //    transition masks directly from the dense transition table.
  _minimize(rawDfaStates) {
    const numStates = rawDfaStates.length;
    const numSymbols = this.numSymbols;

    // Tracks which partition each state belongs to so we can compare successors.
    const partitions = [];
    const stateToPartition = new Array(numStates).fill(-1);
    const addPartition = (group, index = -1) => {
      if (group.length === 0) return;
      if (index === -1) {
        index = partitions.length;
        partitions.push(group);
      } else {
        partitions[index] = group;
      }
      for (const state of group) {
        stateToPartition[state] = index;
      }
    };

    // Initial partitions: accepting states vs everything else.
    const initialPartitions = [[], []];
    for (let i = 0; i < numStates; i++) {
      initialPartitions[rawDfaStates[i].accepting ? 0 : 1].push(i);
    }

    for (const p of initialPartitions) {
      addPartition(p);
    }

    // Refinement loop: split partitions until every state in a block has identical
    // transition signatures (i.e. leads to the same partitions for all symbols).
    let changed = true;
    while (changed) {
      changed = false;

      for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex++) {
        const group = partitions[partitionIndex];
        if (group.length <= 1) continue;

        const signatureMap = new Map();
        for (const state of group) {
          const signature = rawDfaStates[state].transitions
            .map((target) => (target === -1 ? -1 : stateToPartition[target]))
            .join(',');
          if (!signatureMap.has(signature)) signatureMap.set(signature, []);
          signatureMap.get(signature).push(state);
        }

        if (signatureMap.size > 1) {
          const groupsIterator = signatureMap.values();
          addPartition(groupsIterator.next().value, partitionIndex);
          for (let next = groupsIterator.next(); !next.done; next = groupsIterator.next()) {
            addPartition(next.value);
          }
          changed = true;
          break;
        }
      }
    }

    // Collapse each partition to a representative state.
    const newStates = [];

    for (const group of partitions) {
      const representative = group[0];
      const transitionRow = rawDfaStates[representative].transitions;
      const partitionMasks = new Map();

      for (let symbol = 0; symbol < numSymbols; symbol++) {
        const target = transitionRow[symbol];
        if (target === -1) continue;
        const partition = stateToPartition[target];
        const mask = 1 << symbol;
        partitionMasks.set(partition, (partitionMasks.get(partition) || 0) | mask);
      }

      const transitionList = [];
      for (const [partitionIndex, mask] of partitionMasks) {
        transitionList.push(
          DFABuilder._makeTransitionEntry(mask, partitionIndex));
      }

      // NOTE: We could also store a mask of all symbols that have transitions
      // to check if we can skip the entire state.
      // However, it would only trigger a small percentage of time at most.
      newStates.push({
        accepting: rawDfaStates[representative].accepting,
        starting: group.includes(DFABuilder.RAW_DFA_START_STATE),
        transitionList,
      });
    }

    return newStates;
  }

  static _makeTransitionEntry(mask, state) {
    // Transition entry layout: [mask: 16 bits, state: 16 bits]
    // This allows us to store the transitions compactly in a single Uint32Array.
    // The entry can be checked directly against a value since values are
    // also at most 16 bits.
    return mask | (state << 16);
  }

  _flattenStates(states) {
    const numStates = states.length;
    if (numStates > (1 << 16)) {
      throw new Error('Regex DFA has too many states to represent');
    }

    const acceptingStates = new BitSet(numStates);
    const startingState = new BitSet(numStates);
    const totalTransitions = states.reduce(
      (acc, state) => acc + state.transitionList.length, 0);

    const transitionBackingArray = new Uint32Array(totalTransitions);
    const transitionLists = [];
    let transitionOffset = 0;

    for (let i = 0; i < numStates; i++) {
      const state = states[i];
      if (state.accepting) acceptingStates.add(i);
      if (state.starting) startingState.add(i);

      const numTransitions = state.transitionList.length;
      const transitionList = transitionBackingArray.subarray(
        transitionOffset,
        transitionOffset + numTransitions);
      transitionOffset += numTransitions;
      transitionList.set(state.transitionList);
      transitionLists.push(transitionList);
    }

    return new DFA(
      numStates,
      acceptingStates,
      startingState,
      transitionLists,
    );
  }
}

// Enforces a linear regex constraint by compiling the pattern into a DFA and
// propagating it across candidate sets to prune unsupported values.
export class DFALine extends SudokuConstraintHandler {
  constructor(cells, dfa) {
    super(cells);
    this._dfa = dfa;

    const stateCapacity = this._dfa.numStates;
    const slots = this.cells.length + 1;
    const { bitsets, words } = BitSet.allocatePool(stateCapacity, slots);
    this._stateWords = words;
    this._statesList = bitsets;
  }

  getDFA() {
    return this._dfa;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const dfa = this._dfa;
    const transitionLists = dfa.transitionLists;
    const statesList = this._statesList;

    // Clear all the states so we can reuse the bitsets without reallocating.
    this._stateWords.fill(0);

    // Forward pass: Find all states reachable from the start state.
    statesList[0].copyFrom(dfa.startingState);

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
    finalStates.intersect(dfa.acceptingStates);
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

// Minimal bitset implementation for tracking DFA states.
class BitSet {
  static allocatePool(capacity, count) {
    const wordsPerSet = BitSet._wordCountFor(capacity);
    const words = new Uint32Array(wordsPerSet * count);
    const bitsets = new Array(count);
    for (let i = 0; i < count; i++) {
      const offset = i * wordsPerSet;
      bitsets[i] = new BitSet(capacity, words.subarray(offset, offset + wordsPerSet));
    }
    return { bitsets, words };
  }

  constructor(capacity, words = null) {
    this.words = words || new Uint32Array(BitSet._wordCountFor(capacity));
  }

  add(bitIndex) {
    const wordIndex = bitIndex >>> 5;
    const mask = 1 << (bitIndex & 31);
    this.words[wordIndex] |= mask;
  }

  has(bitIndex) {
    const wordIndex = bitIndex >>> 5;
    const mask = 1 << (bitIndex & 31);
    return (this.words[wordIndex] & mask) !== 0;
  }

  clear() {
    this.words.fill(0);
  }

  isEmpty() {
    for (let i = 0; i < this.words.length; i++) {
      if (this.words[i]) return false;
    }
    return true;
  }

  intersect(other) {
    for (let i = 0; i < this.words.length; i++) {
      this.words[i] &= other.words[i];
    }
  }

  copyFrom(other) {
    this.words.set(other.words);
  }

  static bitIndex(wordIndex, lowestBit) {
    const bitPosition = 31 - Math.clz32(lowestBit);
    return (wordIndex << 5) + bitPosition;
  }

  static _wordCountFor(capacity) {
    return Math.ceil(capacity / 32);
  }
}
