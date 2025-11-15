const { SudokuConstraintHandler } = await import('./handlers.js' + self.VERSION_PARAM);
const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { memoize } = await import('../util.js' + self.VERSION_PARAM);

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


const createCharToMask = (numValues) => {
  return (char) => {
    const value = charToValue(char);
    if (value < 1 || value > numValues) {
      throw new Error(`Character '${char}' exceeds shape value count (${numValues})`);
    }
    return LookupTables.fromValue(value);
  };
};

class AstNode {
  static Empty = class { }

  static Literal = class {
    constructor(value) {
      this.value = value;
    }
  }

  static Wildcard = class { }

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

  static Star = class {
    constructor(child) {
      this.child = child;
    }
  }

  static Plus = class {
    constructor(child) {
      this.child = child;
    }
  }

  static Optional = class {
    constructor(child) {
      this.child = child;
    }
  }
}

// NOTE: The compiler currently supports literals, '.', character classes
// (with ranges and optional negation), grouping '()', alternation '|', and the
// quantifiers '*', '+', and '?'. Additional operators can be layered on once the
// solver needs them.
export const compileRegex = memoize((pattern, numValues) => {
  const parser = new RegexParser(pattern);
  const ast = parser.parse();
  const charToMask = createCharToMask(numValues);
  const nfaBuilder = new NFABuilder(charToMask, numValues);
  const { start, accept, states } = nfaBuilder.build(ast);
  const dfaBuilder = new DFABuilder(states, start, accept, numValues);
  return dfaBuilder.build();
});

class RegexParser {
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
    return new AstNode.Alternate(alternatives);
  }

  _parseSequence() {
    const parts = [];
    while (!this._isEOF() && !this._isSequenceTerminator(this._peek())) {
      parts.push(this._parseQuantified());
    }
    if (!parts.length) return new AstNode.Empty();
    if (parts.length === 1) return parts[0];
    return new AstNode.Concat(parts);
  }

  _parseQuantified() {
    let node = this._parsePrimary();
    while (!this._isEOF()) {
      const ch = this._peek();
      if (ch === '*') {
        this._next();
        node = new AstNode.Star(node);
      } else if (ch === '+') {
        this._next();
        node = new AstNode.Plus(node);
      } else if (ch === '?') {
        this._next();
        node = new AstNode.Optional(node);
      } else {
        break;
      }
    }
    return node;
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
      return new AstNode.Wildcard();
    }
    if (ch === '\\') {
      this._next();
      const escaped = this._next();
      if (escaped === undefined) {
        throw new Error('Dangling escape at end of pattern');
      }
      return new AstNode.Literal(escaped);
    }
    if (ch === undefined) {
      throw new Error('Unexpected end of pattern');
    }
    if (this._isQuantifier(ch) || ch === '|' || ch === ')') {
      throw new Error(`Unexpected token '${ch}' at position ${this.pos}`);
    }
    this._next();
    return new AstNode.Literal(ch);
  }

  _parseCharClass() {
    this._expect('[');
    const isNegated = this._peek() === '^';
    if (isNegated) {
      this._next();
    }
    const chars = new Set();
    while (!this._isEOF() && this._peek() !== ']') {
      let start = this._consumeClassChar();
      if (this._peek() === '-' && this._lookAhead(1) !== ']') {
        this._next();
        const end = this._consumeClassChar();
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
    return new AstNode.Charset([...chars], isNegated);
  }

  _consumeClassChar() {
    let ch = this._next();
    if (ch === '\\') {
      ch = this._next();
      if (ch === undefined) throw new Error('Dangling escape in character class');
    }
    if (ch === undefined) throw new Error('Unexpected end of character class');
    return ch;
  }

  _isSequenceTerminator(ch) {
    return ch === '|' || ch === ')' || ch === undefined;
  }

  _isQuantifier(ch) {
    return ch === '*' || ch === '+' || ch === '?';
  }

  _expect(ch) {
    if (this._peek() !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos}`);
    }
    this._next();
  }

  _peek() {
    return this.pattern[this.pos];
  }

  _next() {
    if (this.pos >= this.pattern.length) return undefined;
    return this.pattern[this.pos++];
  }

  _lookAhead(offset) {
    return this.pattern[this.pos + offset];
  }

  _isEOF() {
    return this.pos >= this.pattern.length;
  }
}

class NFABuilder {
  static _Fragment = class {
    constructor(start, accept) {
      this.start = start;
      this.accept = accept;
    }
  };

  constructor(charToMask, numSymbols) {
    this.states = [];
    this._charToMask = charToMask;
    this._alphabet = LookupTables.get(numSymbols).allValues;
  }

  build(ast) {
    const fragment = this._buildNode(ast);
    return {
      start: fragment.start.id,
      accept: fragment.accept.id,
      states: this.states,
    };
  }

  static State = class {
    constructor(id, transitionSymbols = 0, transitionState = null) {
      this.id = id;
      this.transitionSymbols = transitionSymbols;
      this.transitionState = transitionState;
      this.epsilon = [];
    }
  }

  _newState(transitionSymbols = 0, transitionState = null) {
    const state = new NFABuilder.State(
      this.states.length,
      transitionSymbols,
      transitionState
    );
    this.states.push(state);
    return state;
  }

  _newFragment(transitionSymbols = 0) {
    const acceptState = this._newState();
    const startState = transitionSymbols
      ? this._newState(transitionSymbols, acceptState.id)
      : this._newState();
    return new NFABuilder._Fragment(startState, acceptState);
  }

  _addTransition(fragment, symbol) {
    const transitions = fragment.start.transitions;
    if (!transitions.has(symbol)) {
      transitions.set(symbol, new Set());
    }
    transitions.get(symbol).add(fragment.accept.id);
  }

  _addEpsilon(fromState, toState) {
    fromState.epsilon.push(toState.id);
  }

  _buildNode(node) {
    switch (node.constructor) {
      case AstNode.Empty:
        return this._buildEmpty();
      case AstNode.Literal:
        return this._buildLiteral(node.value);
      case AstNode.Wildcard:
        return this._buildWildcard();
      case AstNode.Charset:
        return this._buildCharset(node.chars, node.negated);
      case AstNode.Concat:
        return this._buildConcat(node.parts);
      case AstNode.Alternate:
        return this._buildAlternate(node.options);
      case AstNode.Star:
        return this._buildStar(node.child);
      case AstNode.Plus:
        return this._buildPlus(node.child);
      case AstNode.Optional:
        return this._buildOptional(node.child);
      default:
        throw new Error('Unknown AST node type');
    }
  }

  _buildEmpty() {
    const fragment = this._newFragment();
    this._addEpsilon(fragment.start, fragment.accept);
    return fragment;
  }

  _buildLiteral(char) {
    return this._newFragment(this._charToMask(char));
  }

  _buildWildcard() {
    return this._newFragment(this._alphabet);
  }

  _buildCharset(chars, negated = false) {
    let mask = 0;
    for (const char of chars) {
      mask |= this._charToMask(char);
    }
    if (negated) {
      mask = this._alphabet & ~mask;
    }
    return this._newFragment(mask);
  }

  _buildConcat(parts) {
    if (!parts.length) return this._buildEmpty();
    const first = this._buildNode(parts[0]);
    let currentStart = first.start;
    let currentAccept = first.accept;
    for (let i = 1; i < parts.length; i++) {
      const next = this._buildNode(parts[i]);
      this._addEpsilon(currentAccept, next.start);
      currentAccept = next.accept;
    }
    return new NFABuilder._Fragment(currentStart, currentAccept);
  }

  _buildAlternate(options) {
    const fragment = this._newFragment();
    for (const option of options) {
      const optionFragment = this._buildNode(option);
      this._addEpsilon(fragment.start, optionFragment.start);
      this._addEpsilon(optionFragment.accept, fragment.accept);
    }
    return fragment;
  }

  _buildStar(child) {
    const fragment = this._newFragment();
    const inner = this._buildNode(child);
    this._addEpsilon(fragment.start, inner.start);
    this._addEpsilon(fragment.start, fragment.accept);
    this._addEpsilon(inner.accept, fragment.accept);
    this._addEpsilon(inner.accept, inner.start);
    return fragment;
  }

  _buildPlus(child) {
    const fragment = this._buildNode(child);
    const starFragment = this._buildStar(child);
    this._addEpsilon(fragment.accept, starFragment.start);
    return new NFABuilder._Fragment(fragment.start, starFragment.accept);
  }

  _buildOptional(child) {
    const fragment = this._buildNode(child);
    const outer = this._newFragment();
    this._addEpsilon(outer.start, fragment.start);
    this._addEpsilon(outer.start, outer.accept);
    this._addEpsilon(fragment.accept, outer.accept);
    return outer;
  }
}

class DFABuilder {
  constructor(nfaStates, startId, acceptId, numSymbols) {
    this.nfaStates = nfaStates;
    this.startId = startId;
    this.acceptId = acceptId;
    this.numSymbols = numSymbols;
    this._singleStateClosures = new Map();
  }

  static _EpsilonClosure = class {
    constructor(states) {
      this.states = [...states].sort((a, b) => a - b);
      this.key = this.states.join(',');
    }
  };

  static _RawState = class {
    constructor(nfaStates, accepting, numSymbols) {
      this.nfaStates = nfaStates;
      this.accepting = accepting;
      this.transitions = new Array(numSymbols).fill(-1)
    }
  };

  static DFAState = class {
    constructor(accepting, transitionList) {
      this.accepting = accepting;
      this.transitionList = transitionList;
    }
  };

  _epsilonClosure(stateIds) {
    const combinedStates = new Set();
    for (const stateId of stateIds) {
      for (const id of this._stateEpsilonClosure(stateId)) {
        combinedStates.add(id);
      }
    }
    return new DFABuilder._EpsilonClosure(combinedStates);
  }

  _stateEpsilonClosure(stateId) {
    if (this._singleStateClosures.has(stateId)) {
      return this._singleStateClosures.get(stateId);
    }

    const stack = [stateId];
    const visited = new Set(stack);
    while (stack.length) {
      const id = stack.pop();
      const state = this.nfaStates[id];
      for (const nextId of state.epsilon) {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          stack.push(nextId);
        }
      }
    }
    this._singleStateClosures.set(stateId, visited);
    return visited;
  }

  build() {
    const rawDfaStates = this._constructDFA();
    return this._minimize(rawDfaStates);
  }

  // Phase 1: Build the raw DFA data — a dense transition table and
  // an "accepting" bit for each state.
  _constructDFA() {
    const numSymbols = this.numSymbols;
    const rawDfaStates = [];
    const closureMap = new Map();

    const addRawDfaState = (closure) => {
      const index = rawDfaStates.length;
      closureMap.set(closure.key, index);
      const newRawState =
        new DFABuilder._RawState(
          closure.states,
          closure.states.includes(this.acceptId),
          numSymbols);
      rawDfaStates.push(newRawState);
      return newRawState;
    };

    const startClosure = this._epsilonClosure([this.startId]);
    const stack = [addRawDfaState(startClosure)];

    while (stack.length) {
      const currentDfaState = stack.pop();
      const currentStateIds = currentDfaState.nfaStates;
      const currentTransitionRow = currentDfaState.transitions;

      for (let i = 0; i < numSymbols; i++) {
        const symbol = 1 << i;
        const moveSet = new Set();
        for (const currentStateId of currentStateIds) {
          const nfaState = this.nfaStates[currentStateId];
          if (nfaState.transitionSymbols & symbol) {
            moveSet.add(nfaState.transitionState);
          }
        }
        if (!moveSet.size) continue;

        const nextClosure = this._epsilonClosure(moveSet);
        if (!closureMap.has(nextClosure.key)) {
          stack.push(addRawDfaState(nextClosure));
        }
        currentTransitionRow[i] = closureMap.get(nextClosure.key);
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
        transitionList.push({ state: partitionIndex, mask });
      }

      // NOTE: We could also store a mask of all symbols that have transitions
      // to check if we can skip the entire state.
      // However, it would only trigger a small percentage of time at most.
      newStates.push(new DFABuilder.DFAState(
        rawDfaStates[representative].accepting,
        transitionList,
      ));
    }

    return {
      numSymbols,
      startState: stateToPartition[0],
      states: newStates,
    };
  }
}

// Enforces a linear regex constraint by compiling the pattern into a DFA and
// propagating it across candidate sets to prune unsupported values.
export class RegexLine extends SudokuConstraintHandler {
  constructor(cells, pattern) {
    super(cells);
    this._pattern = pattern;
    this._dfa = null;
    this._acceptingStates = null;
    this._statesList = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._dfa = compileRegex(this._pattern, shape.numValues);

    const stateCapacity = this._dfa.states.length;
    const acceptingStates = new BitSet(stateCapacity);
    this._dfa.states.forEach((state, index) => {
      if (state.accepting) acceptingStates.add(index);
    });
    this._acceptingStates = acceptingStates;
    const slots = this.cells.length + 1;
    const { bitsets, words } = BitSet.allocatePool(stateCapacity, slots);
    this._stateWords = words;
    this._statesList = bitsets;

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const dfaStates = this._dfa.states;
    const statesList = this._statesList;

    // Clear all the states so we can reuse the bitsets without reallocating.
    this._stateWords.fill(0);

    // Forward pass: Find all states reachable from the start state.
    statesList[0].add(this._dfa.startState);

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
          const transitionList = dfaStates[stateIndex].transitionList;
          for (let j = 0; j < transitionList.length; j++) {
            const entry = transitionList[j];
            if (values & entry.mask) {
              nextStates.add(entry.state);
            }
          }
        }
      }

      if (nextStates.isEmpty()) return false;
    }

    // Backward pass: Filter down to only the states that can reach an accepting
    // state. Prune any unsupported values from the grid.
    const finalStates = statesList[numCells];
    finalStates.intersect(this._acceptingStates);
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
          const transitionList = dfaStates[stateIndex].transitionList;
          let stateSupportedValues = 0;
          for (let j = 0; j < transitionList.length; j++) {
            const entry = transitionList[j];
            const maskedValues = entry.mask & values;
            if (maskedValues && nextStates.has(entry.state)) {
              stateSupportedValues |= maskedValues;
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

  static bitIndex(wordIndex, lowestBit) {
    const bitPosition = 31 - Math.clz32(lowestBit);
    return (wordIndex << 5) + bitPosition;
  }

  static _wordCountFor(capacity) {
    return Math.ceil(capacity / 32);
  }
}
