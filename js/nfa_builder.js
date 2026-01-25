const {
  Base64Codec,
  BitReader,
  BitSet,
  BitWriter,
  canonicalJSON,
  memoize,
  requiredBits,
  setPeek
} = await import('./util.js' + self.VERSION_PARAM);

// Convenience function to create a Symbol.
export const Symbol = (value) => new NFA.Symbol(value);

// Sentinel value for removed states in remap arrays.
// Using -1 keeps the array in packed SMI mode in V8.
const REMOVE_STATE = -1;

// Have a maximum state count to prevent unbounded state growth.
// This must be at most (1 << 16) to work with the constraint handler.
const MAX_STATE_COUNT = 1 << 12;

export class NFA {
  constructor({ stateLimit = null } = {}) {
    this._startIds = new Set();
    this._acceptIds = new Set();
    this._transitions = [];
    this._epsilon = [];
    this._sealed = false;
    this._stateLimit = stateLimit;
  }

  _assertUnsealed() {
    if (this._sealed) {
      throw new Error('NFA has been sealed and cannot be modified');
    }
  }

  _assertSealed() {
    if (!this._sealed) {
      throw new Error('NFA must be sealed before processing');
    }
  }

  _assertNoEpsilon() {
    if (this._epsilon.length) {
      throw new Error('Epsilon transitions must be closed first');
    }
  }

  seal() {
    this._sealed = true;
  }

  addStartId(startId) {
    this._assertUnsealed();
    this._ensureStateExists(startId);
    this._startIds.add(startId);
  }

  addAcceptId(acceptId) {
    this._assertUnsealed();
    this._ensureStateExists(acceptId);
    this._acceptIds.add(acceptId);
  }

  addState() {
    this._assertUnsealed();
    if (this._stateLimit !== null && this._transitions.length >= this._stateLimit) {
      throw new Error(
        `State limit of ${this._stateLimit} exceeded. ` +
        'Ensure the state machine is finite, or try setting maxDepth.');
    }
    this._transitions.push([]);
    return this._transitions.length - 1;
  }

  // Returns the single start ID. Throws if there are multiple start states.
  get startId() {
    if (this._startIds.size !== 1) {
      throw new Error(`Expected exactly one start state, but found ${this._startIds.size}`);
    }
    return setPeek(this._startIds);
  }

  _ensureStateExists(stateId) {
    while (this._transitions.length <= stateId) {
      this.addState();
    }
  }

  addTransition(fromStateId, toStateId, ...symbols) {
    this._assertUnsealed();
    this._ensureStateExists(fromStateId);
    this._ensureStateExists(toStateId);

    const stateTransitions = this._transitions[fromStateId];
    for (const symbol of symbols) {
      if (!(symbol instanceof NFA.Symbol)) {
        throw new Error('Transitions require NFA.Symbol objects');
      }
      const symbolIndex = symbol.index;
      if (!stateTransitions[symbolIndex]) {
        stateTransitions[symbolIndex] = [toStateId];
      } else if (!stateTransitions[symbolIndex].includes(toStateId)) {
        stateTransitions[symbolIndex].push(toStateId);
      }
    }
  }

  addEpsilon(fromStateId, toStateId) {
    this._assertUnsealed();
    this._ensureStateExists(fromStateId);
    this._ensureStateExists(toStateId);

    if (!this._epsilon[fromStateId]) {
      this._epsilon[fromStateId] = [];
    }
    this._epsilon[fromStateId].push(toStateId);
  }

  static Symbol = class Symbol {
    constructor(value) {
      this._value = value;
    }

    get index() {
      return this._value - 1;
    }

    get value() {
      return this._value;
    }

    // Returns a cached array of all symbols from 1 to numSymbols.
    static all = memoize((numSymbols) => {
      const symbols = [];
      for (let value = 1; value <= numSymbols; value++) {
        symbols.push(new NFA.Symbol(value));
      }
      return symbols;
    });
  };

  isAccepting(stateId) {
    return this._acceptIds.has(stateId);
  }

  getStartIds() {
    return this._startIds;
  }

  getAcceptIds() {
    return this._acceptIds;
  }

  // Returns the raw sparse array of transitions for a state.
  // transitions[symbolIndex] = [targetStates] or undefined
  getStateTransitions(stateId) {
    return this._transitions[stateId];
  }

  // Returns an iterable of {symbol, state} objects (convenience method).
  getTransitions(stateId) {
    const stateTransitions = this._transitions[stateId];
    const result = [];
    for (let symbolIndex = 0; symbolIndex < stateTransitions.length; symbolIndex++) {
      const targets = stateTransitions[symbolIndex];
      if (!targets) continue;
      const symbol = new NFA.Symbol(symbolIndex + 1);
      for (const targetState of targets) {
        result.push({ symbol, state: targetState });
      }
    }
    return result;
  }

  hasTransitions(stateId) {
    return this._transitions[stateId].length > 0;
  }

  // Direct access to transition targets for a specific symbol.
  getTransitionTargets(stateId, symbol) {
    return this._transitions[stateId][symbol.index] || [];
  }

  getEpsilons(stateId) {
    return this._epsilon[stateId] || [];
  }

  numStates() {
    return this._transitions.length;
  }

  // Returns the number of symbols used (max symbol index + 1), or 0 if no transitions.
  numSymbols() {
    let max = 0;
    for (const trans of this._transitions) {
      if (trans.length > max) {
        max = trans.length;
      }
    }
    return max;
  }

  // Remaps states according to `remap` array, where remap[oldIndex] = newIndex.
  // States with REMOVED_STATE (-1) remap values are removed (transitions to them are dropped).
  // When multiple old states map to the same new index (merging), one is chosen
  // arbitrarily to provide transitions - callers must ensure merged states have
  // identical transitions (or are terminal states with no transitions).
  remapStates(remap) {
    this._assertSealed();
    this._assertNoEpsilon();

    // Reorder and remap transitions (iterate in old order, populate out of order).
    const newTransitions = [];
    for (let oldIndex = 0; oldIndex < remap.length; oldIndex++) {
      const newIndex = remap[oldIndex];
      // Skip removed states.
      if (newIndex === REMOVE_STATE) continue;
      // Skip if already processed (when merging, first old index wins).
      if (newTransitions[newIndex] !== undefined) continue;

      const stateTrans = this._transitions[oldIndex];
      for (let symbolIndex = 0; symbolIndex < stateTrans.length; symbolIndex++) {
        const targets = stateTrans[symbolIndex];
        if (!targets) continue;

        // Remap in place, filtering out removed states and duplicates.
        let writeIndex = 0;
        if (targets.length === 1) {
          // The most common case is a single target, so special-case it.
          const mapped = remap[targets[0]];
          if (mapped !== REMOVE_STATE) targets[writeIndex++] = mapped;
        } else {
          targetLoop: for (let i = 0; i < targets.length; i++) {
            const mapped = remap[targets[i]];
            if (mapped === REMOVE_STATE) continue;
            // Check for duplicate (scan already-written portion).
            for (let j = 0; j < writeIndex; j++) {
              if (targets[j] === mapped) { continue targetLoop; }
            }
            targets[writeIndex++] = mapped;
          }
        }
        targets.length = writeIndex;

      }
      newTransitions[newIndex] = stateTrans;
    }
    this._transitions = newTransitions;

    // Remap start and accept IDs.
    const newStartIds = new Set();
    for (const id of this._startIds) {
      const mapped = remap[id];
      if (mapped !== REMOVE_STATE) newStartIds.add(mapped);
    }
    this._startIds = newStartIds;

    const newAcceptIds = new Set();
    for (const id of this._acceptIds) {
      const mapped = remap[id];
      if (mapped !== REMOVE_STATE) newAcceptIds.add(mapped);
    }
    this._acceptIds = newAcceptIds;
  }

  closeOverEpsilonTransitions() {
    this._assertSealed();
    if (!this._epsilon.length) return;

    const numStates = this._transitions.length;
    for (let i = 0; i < numStates; i++) {
      if (!this._epsilon[i]?.length) continue;
      const stateTransitions = this._transitions[i];

      // Find all states reachable via epsilon transitions.
      const visited = new Set();
      const stack = [i];
      while (stack.length) {
        const stateId = stack.pop();
        if (visited.has(stateId)) continue;
        visited.add(stateId);
        for (const epsilonTarget of this.getEpsilons(stateId)) {
          stack.push(epsilonTarget);
        }
      }

      visited.delete(i);  // Remove self

      // Copy transitions from all epsilon-reachable states.
      for (const targetId of visited) {
        const targetTransitions = this._transitions[targetId];
        for (let symbolIndex = 0; symbolIndex < targetTransitions.length; symbolIndex++) {
          const targets = targetTransitions[symbolIndex];
          if (!targets) continue;
          if (!stateTransitions[symbolIndex]) {
            stateTransitions[symbolIndex] = [];
          }
          stateTransitions[symbolIndex].push(...targets);
        }
        if (this._acceptIds.has(targetId)) {
          this._acceptIds.add(i);
        }
      }

      // Deduplicate target states for each symbol.
      for (let symbolIndex = 0; symbolIndex < stateTransitions.length; symbolIndex++) {
        const targets = stateTransitions[symbolIndex];
        if (targets && targets.length > 1) {
          stateTransitions[symbolIndex] = [...new Set(targets)];
        }
      }
    }

    this._epsilon = [];
  }

  // Creates a reversed NFA where all transitions point backwards.
  // The reversed NFA has accept states as starts and start states as accepts.
  _createReversed() {
    this._assertNoEpsilon();

    const numStates = this._transitions.length;
    const reversed = new NFA();

    // Create all states.
    for (let i = 0; i < numStates; i++) {
      reversed.addState();
    }

    // Reverse transitions.
    for (let stateId = 0; stateId < numStates; stateId++) {
      const transitions = this._transitions[stateId];
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (!targets) continue;
        for (const target of targets) {
          reversed.addTransition(target, stateId, new NFA.Symbol(symbolIndex + 1));
        }
      }
    }

    // Swap start and accept.
    for (const acceptId of this._acceptIds) {
      reversed.addStartId(acceptId);
    }
    for (const startId of this._startIds) {
      reversed.addAcceptId(startId);
    }

    reversed.seal();
    return reversed;
  }

  // Returns the set of states reachable from start states.
  _reachableFromStart() {
    this._assertNoEpsilon();

    const reachable = new Set(this._startIds);
    const stack = [...this._startIds];

    while (stack.length) {
      const stateId = stack.pop();
      const transitions = this._transitions[stateId];
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (!targets) continue;
        for (const target of targets) {
          if (!reachable.has(target)) {
            reachable.add(target);
            stack.push(target);
          }
        }
      }
    }

    return reachable;
  }

  // BFS from start states, returns array where [i] = min depth from start (Infinity if unreachable).
  _computeDepthsFromStart() {
    const numStates = this._transitions.length;
    const depths = new Array(numStates).fill(Infinity);
    let currentLevel = [...this._startIds];

    for (const id of currentLevel) depths[id] = 0;

    for (let depth = 0; currentLevel.length; depth++) {
      const nextLevel = [];
      for (const stateId of currentLevel) {
        const transitions = this._transitions[stateId];
        for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
          const targets = transitions[symbolIndex];
          if (!targets) continue;
          for (const target of targets) {
            if (depths[target] === Infinity) {
              depths[target] = depth + 1;
              nextLevel.push(target);
            }
          }
        }
      }
      currentLevel = nextLevel;
    }
    return depths;
  }

  // Removes dead states - states that can't be part of a valid path within maxDepth.
  // A state is dead if: depthFromStart + distanceToAccept > maxDepth
  // Must be called after epsilon transitions have been closed over.
  removeDeadStates({ maxDepth = Infinity, allStatesAreReachable = false } = {}) {
    this._assertSealed();
    this._assertNoEpsilon();

    const numStates = this.numStates();
    if (numStates === 0) return;

    // Maximum valid path length is 2*(numStates-1): start to some state, then to accept.
    // Any maxDepth beyond this is equivalent to unbounded.
    const maxValidPath = 2 * numStates - 2;
    const effectiveMaxDepth = Math.min(maxDepth, maxValidPath);

    // Always compute backward distances. Reversed NFA has accept states as
    // starts - BFS from those gives distances to accept.
    const distToAccept = this._createReversed()._computeDepthsFromStart();

    // Compute forward depths only if needed:
    // - When !allStatesAreReachable: need to detect unreachable states
    // - When effectiveMaxDepth < maxValidPath: the sum check might filter reachable states
    const depths = (!allStatesAreReachable || effectiveMaxDepth < maxValidPath)
      ? this._computeDepthsFromStart()
      : null;

    // Find dead states: d + distToAccept > effectiveMaxDepth
    // Works with Infinity because effectiveMaxDepth is always finite.
    const deadStates = new Set();
    for (let i = 0; i < numStates; i++) {
      const d = depths ? depths[i] : 0;
      if (d + distToAccept[i] > effectiveMaxDepth) {
        deadStates.add(i);
      }
    }

    if (deadStates.size === 0) return;

    // Build remap: liveStates in order become 0, 1, 2, ...
    const remap = new Array(numStates).fill(REMOVE_STATE);
    let newIndex = 0;
    for (let i = 0; i < numStates; i++) {
      if (!deadStates.has(i)) {
        remap[i] = newIndex++;
      }
    }

    this.remapStates(remap);
  }

  // Reduces the NFA using forward simulation.
  // State A simulates state B if A accepts a superset of strings that B accepts.
  // When A simulates B, transitions to B can be redirected to A.
  // Must be called after epsilon transitions have been closed over.
  reduceBySimulation() {
    this._assertSealed();
    this._assertNoEpsilon();

    const numStates = this._transitions.length;
    if (numStates <= 1) return;

    const numSymbols = this.numSymbols();
    if (numSymbols === 0) return;

    // sim[a] is a BitSet where sim[a].has(b) means "a simulates b" (a ≥ b).
    // Initialize: a simulates b if accept(b) implies accept(a).
    const sim = new Array(numStates);
    for (let a = 0; a < numStates; a++) {
      sim[a] = new BitSet(numStates);
      const aAccepts = this._acceptIds.has(a);
      for (let b = 0; b < numStates; b++) {
        // a can simulate b only if: b accepting => a accepting
        if (!this._acceptIds.has(b) || aAccepts) {
          sim[a].add(b);
        }
      }
    }

    // Iteratively refine: remove pairs that violate simulation conditions.
    // a simulates b requires: for all symbols s and all b' in delta(b,s),
    // there exists a' in delta(a,s) such that a' simulates b'.
    const transitions = this._transitions;
    let changed = true;
    while (changed) {
      changed = false;
      for (let a = 0; a < numStates; a++) {
        const simA = sim[a];
        const aTrans = transitions[a];

        for (let b = 0; b < numStates; b++) {
          if (a === b || !simA.has(b)) continue;

          // Check if a still simulates b.
          const bTrans = transitions[b];

          for (let s = 0; s < numSymbols; s++) {
            const bTargets = bTrans[s];
            if (!bTargets || !bTargets.length) continue;

            const aTargets = aTrans[s];

            if (!aTargets || !aTargets.length) {
              // b has transition on s, but a doesn't - a cannot simulate b.
              simA.remove(b);
              changed = true;
              break;
            }

            // For each b' in bTargets, there must exist a' in aTargets
            // such that sim[a'].has(b').
            if (aTargets.length === 1 && bTargets.length === 1) {
              // Common case: single targets on both sides.
              if (!sim[aTargets[0]].has(bTargets[0])) {
                simA.remove(b);
                changed = true;
                break;
              }
            } else if (!bTargets.every(
              bPrime => aTargets.some(aPrime => sim[aPrime].has(bPrime)))) {
              simA.remove(b);
              changed = true;
              break;
            }
          }
        }
      }
    }

    // Prune dominated transitions: if A simulates B (but not vice versa),
    // remove B from target sets. For mutual simulation, keep the smaller index.
    const dominated = (b, targets) => {
      const simB = sim[b];
      for (const a of targets) {
        if (sim[a].has(b) && (a < b || !simB.has(a))) return true;
      }
    };
    for (let state = 0; state < numStates; state++) {
      const trans = transitions[state];
      for (let s = 0; s < numSymbols; s++) {
        const targets = trans[s];
        if (!targets || targets.length <= 1) continue;
        for (let i = targets.length - 1; i >= 0; i--) {
          if (dominated(targets[i], targets)) {
            targets.splice(i, 1);
          }
        }
      }
    }

    // Build remap: for each state, find the smallest state that simulates it
    // and is simulated by it (i.e., they are simulation-equivalent).
    // Canonical states map to contiguous indices; others map to their canonical.
    const remap = new Array(numStates);
    let nextIndex = 0;
    for (let b = 0; b < numStates; b++) {
      // Find smallest equivalent state (could be self).
      let canonical = b;
      for (let a = 0; a < b; a++) {
        if (sim[a].has(b) && sim[b].has(a)) {
          canonical = a;
          break;
        }
      }
      if (canonical === b) {
        // This is a canonical representative.
        remap[b] = nextIndex++;
      } else {
        // Map to canonical's index (already assigned since canonical < b).
        remap[b] = remap[canonical];
      }
    }

    if (nextIndex === numStates) return;  // No merging happened.

    this.remapStates(remap);
  }
}

// The compiler currently supports literals, '.', character classes
// (with ranges and optional negation), grouping '()', alternation '|', and the
// quantifiers '*', '+', '?', and '{n}', '{n,}', '{n,m}'.
export const regexToNFA = (pattern, numSymbols) => {
  try {
    const parser = new RegexParser(pattern);
    const ast = parser.parse();
    const charToSymbol = createCharToSymbol(numSymbols);
    const builder = new RegexToNFABuilder(charToSymbol, numSymbols);
    const nfa = builder.build(ast);
    optimizeNFA(nfa);
    return nfa;
  } catch (e) {
    throw new Error(`Regex "${pattern}" could not be compiled: ${e.message}`);
  }
};

export const javascriptSpecToNFA = (config, numSymbols) => {
  const builder = new JavascriptNFABuilder(config, numSymbols);
  const nfa = builder.build();

  // Javascript NFA builder never generates states unreachable from the start.
  optimizeNFA(nfa, {
    allStatesAreReachable: true,
    maxDepth: config.maxDepth ?? Infinity,
  });

  return nfa;
}

// Convert an NFA back to JavaScript code (unified format).
// This generates code equivalent to the original, but not necessarily identical.
export const nfaToJavascriptSpec = (nfa) => {
  const maybeArrayToString = (arr) => {
    return arr.length === 1 ? `${arr[0]}` : `[${arr.join(', ')}]`;
  }

  // Build transition table entries.
  const transitionEntries = [];
  for (let stateId = 0; stateId < nfa.numStates(); stateId++) {
    const stateTransitions = nfa.getStateTransitions(stateId);
    const valueEntries = [];
    for (let symbolIndex = 0; symbolIndex < stateTransitions.length; symbolIndex++) {
      const targets = stateTransitions[symbolIndex];
      if (targets?.length) {
        const value = symbolIndex + 1;
        valueEntries.push(`${value}: ${maybeArrayToString(targets)}`);
      }
    }
    if (valueEntries.length) {
      transitionEntries.push(`    ${stateId}: {${valueEntries.join(', ')}},`);
    }
  }

  const acceptIds = [...nfa.getAcceptIds()];
  const acceptExpr = (
    acceptIds.length === 0 ? 'false'
      : acceptIds.length === nfa.numStates() ? 'true'
        : acceptIds.length === 1 ? `state === ${acceptIds[0]}`
          : `[${acceptIds.join(', ')}].includes(state)`);

  return `startState = ${maybeArrayToString([...nfa.getStartIds()])};

function transition(state, value) {
  const transitions = {
${transitionEntries.join('\n')}
  };
  return transitions[state]?.[value];
}

function accept(state) {
  return ${acceptExpr};
}`;
};

export const optimizeNFA = (nfa, { allStatesAreReachable = false, maxDepth = Infinity } = {}) => {
  nfa.closeOverEpsilonTransitions();
  nfa.removeDeadStates({ maxDepth, allStatesAreReachable });
  nfa.reduceBySimulation();
}

// Serialization format overview:
//   Header (written once):
//     * format: 2 bits (plain or packed state encoding, see FORMAT enum)
//     * stateBitsMinusOne: 4 bits storing (state bit width - 1)
//     * symbolCountMinusOne: 4 bits storing (alphabet size - 1)
//     * startCount: stateBits bits storing number of start states
//     * acceptCount: stateBits bits storing number of additional (non-start) accepts
//     * startIsAccept: startCount bits (1 bit per start state, in order)
//     * (if plain format) transitionCountBits: 4 bits storing bits per transition count
//   Body (streamed per state until data ends):
//     Plain format: for each state, transitionCount (transitionCountBits) followed by
//                   (symbolIndex, target) pairs.
//     Packed format: a bitmask of active symbols followed by state IDs for each set bit.
// States are ordered with start states first (in order), then non-start accept states,
// then all other states.
// The decoder keeps reading states until the bitstream ends, then trims any
// trailing padding as long as all referenced targets and accept slots are present.
export class NFASerializer {
  static MIN_SYMBOLS = 1;
  static SYMBOL_COUNT_FIELD_BITS = 4;
  static MAX_SYMBOLS = 1 << this.SYMBOL_COUNT_FIELD_BITS;
  static STATE_BITS_FIELD_BITS = 4;
  static MIN_STATE_BITS = 1;
  static MAX_STATE_BITS = 1 << this.STATE_BITS_FIELD_BITS;
  static FORMAT = Object.freeze({
    PLAIN: 0,
    PACKED: 1,
  });
  static HEADER_FORMAT_BITS = 2;

  static serialize(nfa) {
    if (!nfa.numStates()) {
      return '';
    }

    this._normalizeStates(nfa);

    const numStates = nfa.numStates();
    const startCount = nfa.getStartIds().size;

    // Build startIsAccept bitmask: bit i is set if start state i is accepting.
    // After normalization, start states are 0..startCount-1 in order.
    let startIsAccept = 0;
    let acceptCount = nfa.getAcceptIds().size;
    for (let i = 0; i < startCount; i++) {
      if (nfa.isAccepting(i)) {
        startIsAccept |= (1 << i);
        acceptCount--;
      }
    }

    const symbolCount = Math.max(nfa.numSymbols(), this.MIN_SYMBOLS);
    if (symbolCount > this.MAX_SYMBOLS) {
      throw new Error(`NFA requires ${symbolCount} symbols but only ${this.MAX_SYMBOLS} are supported`);
    }
    const stateBits = Math.max(1, requiredBits(numStates - 1));
    if (stateBits > this.MAX_STATE_BITS) {
      throw new Error(`NFA exceeds maximum supported state count (${1 << this.MAX_STATE_BITS})`);
    }
    const symbolBits = requiredBits(symbolCount - 1);

    const { format, transitionCountBits } = this._chooseStateFormat(nfa, symbolCount, symbolBits, stateBits);

    const writer = new BitWriter();
    this._writeHeader(writer, { format, symbolCount, stateBits, startCount, startIsAccept, acceptCount, transitionCountBits });
    if (format === this.FORMAT.PACKED) {
      this._writePackedBody(writer, nfa, symbolCount, stateBits);
    } else {
      this._writePlainBody(writer, nfa, transitionCountBits, symbolBits, stateBits);
    }

    return this._encodeBytes(writer.toUint8Array());
  }

  static deserialize(serialized) {
    if (!serialized) {
      // Empty NFA - no states, rejects everything.
      const nfa = new NFA();
      nfa.seal();
      return nfa;
    }

    const bytes = this._decodeBytes(serialized);
    if (!bytes.length) {
      throw new Error('Serialized NFA is empty');
    }

    const reader = new BitReader(bytes);
    const { format, symbolCount, stateBits, startCount, startIsAccept, acceptCount, transitionCountBits } = this._readHeader(reader);
    const symbolBits = requiredBits(symbolCount - 1);

    const nfa = new NFA();
    if (format === this.FORMAT.PACKED) {
      this._readPackedBody(nfa, reader, symbolCount, stateBits);
    } else {
      this._readPlainBody(nfa, reader, transitionCountBits, symbolBits, stateBits);
    }

    reader.skipPadding();

    for (let i = 0; i < startCount; i++) {
      nfa.addStartId(i);
      if (startIsAccept & (1 << i)) {
        nfa.addAcceptId(i);
      }
    }
    for (let i = 0; i < acceptCount; i++) {
      nfa.addAcceptId(startCount + i);
    }

    nfa.seal();
    return nfa;
  }

  static _normalizeStates(nfa) {
    const numStates = nfa.numStates();
    const startSet = nfa.getStartIds();

    const acceptIds = [];
    const otherIds = [];
    for (let i = 0; i < numStates; i++) {
      if (startSet.has(i)) continue;

      if (nfa.isAccepting(i)) {
        acceptIds.push(i);
      } else {
        otherIds.push(i);
      }
    }

    // remap[oldIndex] = newIndex
    // Order: start states first (in order), then non-start accept states, then others.
    const remap = new Array(numStates);
    let nextIndex = 0;
    for (const id of startSet) {
      remap[id] = nextIndex++;
    }
    for (const id of acceptIds) {
      remap[id] = nextIndex++;
    }
    for (const id of otherIds) {
      remap[id] = nextIndex++;
    }

    nfa.remapStates(remap);
  }

  static _isTerminalState(nfa, stateId) {
    return !nfa.hasTransitions(stateId) && !nfa.getEpsilons(stateId).length;
  }

  static _writeHeader(writer, { format, symbolCount, stateBits, startCount, startIsAccept, acceptCount, transitionCountBits }) {
    if (!this._isValidFormat(format)) {
      throw new Error('NFA serialization format is unsupported');
    }
    if (symbolCount < this.MIN_SYMBOLS || symbolCount > this.MAX_SYMBOLS) {
      throw new Error('Symbol count is out of range for header encoding');
    }
    if (stateBits < this.MIN_STATE_BITS || stateBits > this.MAX_STATE_BITS) {
      throw new Error('State bit width is out of range for header encoding');
    }
    if (acceptCount >= (1 << stateBits)) {
      throw new Error('Accept state count exceeds encodable range for header');
    }
    if (startCount < 1 || startCount >= (1 << stateBits)) {
      throw new Error('Start state count exceeds encodable range for header');
    }
    writer.writeBits(format, this.HEADER_FORMAT_BITS);
    writer.writeBits(stateBits - 1, this.STATE_BITS_FIELD_BITS);
    writer.writeBits(symbolCount - 1, this.SYMBOL_COUNT_FIELD_BITS);
    writer.writeBits(startCount, stateBits);
    writer.writeBits(acceptCount, stateBits);
    writer.writeBits(startIsAccept, startCount);
    if (format === this.FORMAT.PLAIN) {
      writer.writeBits(transitionCountBits, this.SYMBOL_COUNT_FIELD_BITS);
    }
  }

  static _readHeader(reader) {
    const format = reader.readBits(this.HEADER_FORMAT_BITS);
    if (!this._isValidFormat(format)) {
      throw new Error('Serialized NFA uses an unknown format');
    }
    const stateBits = reader.readBits(this.STATE_BITS_FIELD_BITS) + 1;
    const symbolCount = reader.readBits(this.SYMBOL_COUNT_FIELD_BITS) + 1;
    if (stateBits < this.MIN_STATE_BITS || stateBits > this.MAX_STATE_BITS) {
      throw new Error('State bit width is out of range for header decoding');
    }
    if (symbolCount < this.MIN_SYMBOLS || symbolCount > this.MAX_SYMBOLS) {
      throw new Error('Symbol count is out of range for header decoding');
    }
    const startCount = reader.readBits(stateBits);
    const acceptCount = reader.readBits(stateBits);
    const startIsAccept = reader.readBits(startCount);
    const transitionCountBits = format === this.FORMAT.PLAIN
      ? reader.readBits(this.SYMBOL_COUNT_FIELD_BITS)
      : 0;
    return { format, symbolCount, stateBits, startCount, startIsAccept, acceptCount, transitionCountBits };
  }

  static _writePlainBody(writer, nfa, transitionCountBits, symbolBits, stateBits) {
    for (let stateId = 0; stateId < nfa.numStates(); stateId++) {
      const transitions = nfa.getStateTransitions(stateId);
      // Count transitions first.
      let transitionCount = 0;
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (targets) transitionCount += targets.length;
      }
      writer.writeBits(transitionCount, transitionCountBits);
      // Write each (symbolIndex, target) pair.
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (!targets) continue;
        for (const target of targets) {
          writer.writeBits(symbolIndex, symbolBits);
          writer.writeBits(target, stateBits);
        }
      }
    }
  }

  static _writePackedBody(writer, nfa, symbolCount, stateBits) {
    for (let stateId = 0; stateId < nfa.numStates(); stateId++) {
      const transitions = nfa.getStateTransitions(stateId);
      let symbolMask = 0;
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        if (transitions[symbolIndex]?.length) {
          symbolMask |= 1 << symbolIndex;
        }
      }
      writer.writeBits(symbolMask, symbolCount);
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (targets?.length) {
          writer.writeBits(targets[0], stateBits);
        }
      }
    }
  }

  static _chooseStateFormat(nfa, symbolCount, symbolBits, stateBits) {
    const numStates = nfa.numStates();

    // First pass: check if packed is possible and find max transitions.
    let maxTransitions = 0;
    let totalTransitions = 0;
    let canPack = true;
    for (let stateId = 0; stateId < numStates; stateId++) {
      const transitions = nfa.getStateTransitions(stateId);
      let transitionCount = 0;
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (!targets) continue;
        // If multiple targets per symbol, we can't pack.
        if (targets.length > 1) canPack = false;
        transitionCount += targets.length;
      }
      if (transitionCount > maxTransitions) maxTransitions = transitionCount;
      totalTransitions += transitionCount;
    }

    const transitionCountBits = requiredBits(maxTransitions);

    if (!canPack) {
      return { format: this.FORMAT.PLAIN, transitionCountBits };
    }

    // Compare sizes.
    const plainSizeEstimate = numStates * transitionCountBits + totalTransitions * (symbolBits + stateBits);
    const packedSizeEstimate = numStates * symbolCount + totalTransitions * stateBits;

    const format = packedSizeEstimate < plainSizeEstimate
      ? this.FORMAT.PACKED
      : this.FORMAT.PLAIN;
    return { format, transitionCountBits };
  }

  static _isValidFormat(format) {
    return format === this.FORMAT.PLAIN || format === this.FORMAT.PACKED;
  }

  static _readPlainBody(nfa, reader, transitionCountBits, symbolBits, stateBits) {
    if (transitionCountBits === 0) return;
    for (let stateId = 0; reader.remainingBits() >= transitionCountBits; stateId++) {
      const transitionCount = reader.readBits(transitionCountBits);
      for (let i = 0; i < transitionCount; i++) {
        if (reader.remainingBits() < symbolBits + stateBits) {
          throw new Error('Serialized NFA plain state transition data is truncated');
        }
        const symbolIndex = reader.readBits(symbolBits);
        const target = reader.readBits(stateBits);
        nfa.addTransition(stateId, target, new NFA.Symbol(symbolIndex + 1));
      }
    }
  }

  static _readPackedBody(nfa, reader, symbolCount, stateBits) {
    if (symbolCount < 1) throw new Error('symbolCount must be at least 1');
    for (let stateId = 0; reader.remainingBits() >= symbolCount; stateId++) {
      const activeMask = reader.readBits(symbolCount);
      for (let mask = activeMask, value = 1; mask; mask >>>= 1, value++) {
        if (mask & 1) {
          if (reader.remainingBits() < stateBits) {
            throw new Error('Serialized NFA packed state transition data is truncated');
          }
          const target = reader.readBits(stateBits);
          nfa.addTransition(stateId, target, new NFA.Symbol(value));
        }
      }
    }
  }

  static _encodeBytes(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return Base64Codec.encodeString(binary);
  }

  static _decodeBytes(str) {
    const binary = Base64Codec.decodeToString(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

const charToValue = (char) => {
  if (char >= '1' && char <= '9') {
    return char.charCodeAt(0) - '0'.charCodeAt(0);
  }
  if (char >= 'A' && char <= 'Z') {
    return char.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
  }
  if (char >= 'a' && char <= 'z') {
    return char.charCodeAt(0) - 'a'.charCodeAt(0) + 10;
  }
  throw new Error(`Unsupported character '${char}' in regex constraint`);
};


const createCharToSymbol = (numValues) => {
  return (char) => {
    const value = charToValue(char);
    if (value < 1 || value > numValues) {
      throw new Error(`Character '${char}' exceeds shape value count (${numValues})`);
    }
    return new NFA.Symbol(value);
  };
};

class RegexAstNode {
  static Charset = class {
    constructor(chars, negated = false) {
      this.chars = chars;
      this.negated = negated;
    }
  }

  static Concat = class {
    constructor(parts) {
      this.parts = parts;
    }
  }
  static Alternate = class {
    constructor(options) {
      this.options = options;
    }
  }

  // Quantifier: {n}, {n,}, {n,m}, and also *, +, ?
  static Quantifier = class {
    constructor(child, min, max) {
      this.child = child;
      this.min = min;       // minimum repetitions
      this.max = max;       // maximum repetitions (null = unbounded)
    }
  }
}

export class RegexParser {
  static SEQUENCE_TERMINATORS = "|)";
  static QUANTIFIERS = "*+?{";

  constructor(pattern) {
    this.pattern = pattern;
    this.pos = 0;
  }

  parse() {
    const expr = this._parseExpression();
    if (!this._isEOF()) {
      throw new Error(`Unexpected token at position ${this.pos}`);
    }
    return expr;
  }

  _parseExpression() {
    const node = this._parseSequence();
    const alternatives = [node];
    while (this._peek() === '|') {
      this._next();
      alternatives.push(this._parseSequence());
    }
    if (alternatives.length === 1) return node;
    return new RegexAstNode.Alternate(alternatives);
  }

  _parseSequence() {
    const parts = [];
    while (!this._isEOF() && !RegexParser.SEQUENCE_TERMINATORS.includes(this._peek())) {
      parts.push(this._parseQuantified());
    }
    if (parts.length === 1) return parts[0];
    return new RegexAstNode.Concat(parts);
  }

  _parseQuantified() {
    let node = this._parsePrimary();
    while (!this._isEOF()) {
      const ch = this._peek();
      if (ch === '*') {
        this._next();
        node = new RegexAstNode.Quantifier(node, 0, null);
      } else if (ch === '+') {
        this._next();
        node = new RegexAstNode.Quantifier(node, 1, null);
      } else if (ch === '?') {
        this._next();
        node = new RegexAstNode.Quantifier(node, 0, 1);
      } else if (ch === '{') {
        node = this._parseBraceQuantifier(node);
      } else {
        break;
      }
    }
    return node;
  }

  _parseBraceQuantifier(node) {
    const startPos = this.pos;
    this._expect('{');

    const min = this._parseNumber();
    if (min === null) {
      throw new Error(`Expected number after '{' at position ${startPos}`);
    }

    let max = min;
    if (this._peek() === ',') {
      this._next();
      max = this._peek() === '}' ? null : this._parseNumber();
      if (max === undefined) {
        throw new Error(`Expected number or '}' after ',' at position ${this.pos}`);
      }
      if (max !== null && max < min) {
        throw new Error(`Invalid quantifier: max (${max}) < min (${min}) at position ${startPos}`);
      }
    }

    this._expect('}');

    return new RegexAstNode.Quantifier(node, min, max);
  }

  _parseNumber() {
    let numStr = '';
    while (this._peek() >= '0' && this._peek() <= '9') {
      numStr += this._next();
    }
    if (!numStr) return null;
    return parseInt(numStr, 10);
  }

  _parsePrimary() {
    const ch = this._peek();
    if (ch === '(') {
      this._next();
      const expr = this._parseExpression();
      if (this._peek() !== ')') {
        throw new Error(`Unclosed group at position ${this.pos}`);
      }
      this._next();
      return expr;
    }
    if (ch === '[') {
      return this._parseCharClass();
    }
    if (ch === '.') {
      this._next();
      return new RegexAstNode.Charset([], true);  // Negated empty = all symbols
    }
    if (ch === undefined) {
      throw new Error('Unexpected end of pattern');
    }
    if (RegexParser.QUANTIFIERS.includes(ch) || RegexParser.SEQUENCE_TERMINATORS.includes(ch)) {
      throw new Error(`Unexpected token '${ch}' at position ${this.pos}`);
    }
    this._next();
    return new RegexAstNode.Charset([ch]);
  }

  _parseCharClass() {
    this._expect('[');
    const isNegated = this._peek() === '^';
    if (isNegated) {
      this._next();
    }
    const chars = new Set();
    while (!this._isEOF() && this._peek() !== ']') {
      const start = this._next();
      if (this._peek() === '-') {
        this._next();
        const end = this._next();
        const startCode = start.charCodeAt(0);
        const endCode = end.charCodeAt(0);
        if (endCode < startCode) {
          throw new Error('Invalid character range in class');
        }
        for (let code = startCode; code <= endCode; code++) {
          chars.add(String.fromCharCode(code));
        }
      } else {
        chars.add(start);
      }
    }
    this._expect(']');
    if (!chars.size) {
      throw new Error('Empty character class');
    }
    return new RegexAstNode.Charset([...chars], isNegated);
  }

  _expect(ch) {
    if (this._next() !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos - 1}`);
    }
  }

  _peek() {
    return this.pattern[this.pos];
  }

  _next() {
    if (this.pos >= this.pattern.length) return undefined;
    return this.pattern[this.pos++];
  }

  _isEOF() {
    return this.pos >= this.pattern.length;
  }
}

class RegexToNFABuilder {
  constructor(charToSymbol, numSymbols) {
    this._nfa = new NFA({ stateLimit: MAX_STATE_COUNT });
    this._charToSymbol = charToSymbol;
    this._numSymbols = numSymbols;
  }

  static _Fragment = class {
    constructor(startId, acceptId) {
      this.startId = startId;
      this.acceptId = acceptId;
    }
  };

  _newFragment(startId, acceptId) {
    return new RegexToNFABuilder._Fragment(startId, acceptId);
  }

  build(ast) {
    const fragment = this._buildNode(ast);
    this._nfa.addStartId(fragment.startId);
    this._nfa.addAcceptId(fragment.acceptId);
    this._nfa.seal();
    return this._nfa;
  }

  _buildNode(node) {
    switch (node.constructor) {
      case RegexAstNode.Charset:
        return this._buildCharset(node.chars, node.negated);
      case RegexAstNode.Concat:
        return this._buildConcat(node.parts);
      case RegexAstNode.Alternate:
        return this._buildAlternate(node.options);
      case RegexAstNode.Quantifier:
        return this._buildQuantifier(node.child, node.min, node.max);
      default:
        throw new Error('Unknown AST node type');
    }
  }

  _buildEmpty() {
    const stateId = this._nfa.addState();
    return this._newFragment(stateId, stateId);
  }

  _buildCharset(chars, negated = false) {
    const startId = this._nfa.addState();
    const acceptId = this._nfa.addState();
    let symbols;
    if (negated) {
      const excludeIndices = new Set(chars.map(c => this._charToSymbol(c).index));
      symbols = NFA.Symbol.all(this._numSymbols).filter(s => !excludeIndices.has(s.index));
    } else {
      symbols = chars.map(c => this._charToSymbol(c));
    }
    this._nfa.addTransition(startId, acceptId, ...symbols);
    return this._newFragment(startId, acceptId);
  }

  _buildConcat(parts) {
    if (!parts.length) return this._buildEmpty();
    const first = this._buildNode(parts[0]);
    let acceptId = first.acceptId;
    for (let i = 1; i < parts.length; i++) {
      const next = this._buildNode(parts[i]);
      this._nfa.addEpsilon(acceptId, next.startId);
      acceptId = next.acceptId;
    }
    return this._newFragment(first.startId, acceptId);
  }

  _buildAlternate(options) {
    const startId = this._nfa.addState();
    const acceptId = this._nfa.addState();
    for (const option of options) {
      const optionFragment = this._buildNode(option);
      this._nfa.addEpsilon(startId, optionFragment.startId);
      this._nfa.addEpsilon(optionFragment.acceptId, acceptId);
    }
    return this._newFragment(startId, acceptId);
  }

  _buildQuantifier(child, min, max) {
    // Start with an empty fragment if min is 0, otherwise build first required copy.
    let result = min === 0 ? this._buildEmpty() : this._buildNode(child);

    // Build remaining required copies (indices 1 to min-1).
    for (let i = 1; i < min; i++) {
      const next = this._buildNode(child);
      this._nfa.addEpsilon(result.acceptId, next.startId);
      result = this._newFragment(result.startId, next.acceptId);
    }

    if (max === null) {
      // Unbounded: can optionally match more copies with a self-loop.
      const inner = this._buildNode(child);
      this._nfa.addEpsilon(result.acceptId, inner.startId);  // Optionally enter loop
      this._nfa.addEpsilon(inner.acceptId, inner.startId);   // Loop for more
      this._nfa.addEpsilon(inner.acceptId, result.acceptId); // Exit loop back to accept
    } else {
      // Bounded: append (max - min) optional copies.
      for (let i = min; i < max; i++) {
        const inner = this._buildNode(child);
        this._nfa.addEpsilon(result.acceptId, inner.startId);
        this._nfa.addEpsilon(result.acceptId, inner.acceptId);  // Skip (optional)
        result = this._newFragment(result.startId, inner.acceptId);
      }
    }

    return result;
  }
}

export class JavascriptNFABuilder {
  constructor(definition, numValues) {
    const { startState, transition, accept, maxDepth } = definition;
    this._startState = startState;
    this._transitionFn = transition;
    this._acceptFn = accept;
    this._numValues = numValues;
    this._maxDepth = maxDepth ?? Infinity;
  }

  build() {
    const nfa = new NFA({ stateLimit: MAX_STATE_COUNT });
    const stateStrToIndex = new Map();
    const indexToStateStr = [];

    const addState = (stateStr, accepting) => {
      const index = nfa.addState();
      stateStrToIndex.set(stateStr, index);
      indexToStateStr.push(stateStr);
      if (accepting) nfa.addAcceptId(index);
      return index;
    };

    const transitionFn = this._wrapTransitionFn(this._transitionFn);
    const acceptFn = this._wrapAcceptFn(this._acceptFn);

    // BFS by processing all states at each progressive depth level.
    let currentLevel = [];
    let depth = 0;

    const startStateStrs = this._generateStartStatesFromValue(this._startState);
    for (const startStateStr of startStateStrs) {
      const index = addState(startStateStr, acceptFn(startStateStr));
      currentLevel.push(index);
      nfa.addStartId(index);
    }

    while (currentLevel.length) {
      let nextLevel = [];
      for (const index of currentLevel) {
        const stateStr = indexToStateStr[index];
        for (let value = 1; value <= this._numValues; value++) {
          const nextStateStrs = transitionFn(stateStr, value);
          for (const nextStateStr of nextStateStrs) {
            let targetIndex = stateStrToIndex.get(nextStateStr);
            if (targetIndex === undefined) {
              // New state: only add if we haven't reached maxDepth
              if (depth >= this._maxDepth) continue;
              targetIndex = addState(nextStateStr, acceptFn(nextStateStr));
              nextLevel.push(targetIndex);
            }
            nfa.addTransition(index, targetIndex, new NFA.Symbol(value));
          }
        }
      }
      currentLevel = nextLevel;
      depth++;
    }

    nfa.seal();

    return nfa;
  }

  _fnResultToStateArray(result) {
    if (Array.isArray(result)) return result;
    if (result !== undefined) return [result];
    return [];
  }

  _generateStartStatesFromValue(startState) {
    const states = this._fnResultToStateArray(startState);
    return states.map(item => this._stringifyState(item));
  }

  _wrapTransitionFn(fn) {
    return (stateStr, value) => {
      const stateValue = this._deserializeState(stateStr);
      try {
        const result = fn(stateValue, value);
        const nextStates = this._fnResultToStateArray(result);
        return nextStates.map(item => this._stringifyState(item));
      } catch (err) {
        throw new Error(
          `Transition function threw for input (${stateStr}, ${value}): ${err?.message || err}`);
      }
    };
  }

  _wrapAcceptFn(fn) {
    return (stateStr) => {
      const stateValue = this._deserializeState(stateStr);
      try {
        return !!fn(stateValue);
      } catch (err) {
        throw new Error(
          `Accept function threw for input ${stateStr}: ${err?.message || err}`);
      }
    };
  }

  _stringifyState(state) {
    if (Array.isArray(state)) {
      throw new Error('State must not be an array');
    }

    try {
      const serialized = canonicalJSON(state);
      if (serialized === undefined) {
        throw new Error('Could not JSON-serialize');
      }
      return serialized;
    } catch (err) {
      throw new Error(`Invalid state: ${err?.message || err}`);
    }
  }

  _deserializeState(serialized) {
    return JSON.parse(serialized);
  }
}