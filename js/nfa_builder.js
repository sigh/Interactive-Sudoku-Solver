const {
  Base64Codec,
  BitReader,
  BitWriter,
  memoize,
  setPeek,
  requiredBits
} = await import('./util.js' + self.VERSION_PARAM);

// Convenience function to create a Symbol.
export const Symbol = (value) => new NFA.Symbol(value);

export class NFA {
  constructor() {
    this._startIds = new Set();
    this._acceptIds = new Set();
    this._transitions = [];
    this._epsilon = [];
    this._sealed = false;
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

  seal() {
    this._sealed = true;
  }

  addStartId(startId) {
    this._assertUnsealed();
    this._startIds.add(startId);
  }

  addAcceptId(acceptId) {
    this._assertUnsealed();
    this._acceptIds.add(acceptId);
  }

  addState() {
    this._assertUnsealed();
    this._transitions.push([]);
    return this._transitions.length - 1;
  }

  // Reduces multiple start states to a single start state by creating
  // a new state with epsilon transitions to all current start states.
  reduceStartStates() {
    this._assertSealed();
    if (this._startIds.size <= 1) return;

    // Temporarily unseal to add the new start state.
    this._sealed = false;
    const newStartId = this.addState();
    for (const startId of this._startIds) {
      this.addEpsilon(newStartId, startId);
    }
    this._sealed = true;

    this._startIds.clear();
    this._startIds.add(newStartId);
  }

  // Returns the single start ID. Throws if there are multiple start states.
  get startId() {
    if (this._startIds.size !== 1) {
      throw new Error(`Expected exactly one start state, but found ${this._startIds.size}`);
    }
    return this._startIds.values().next().value;
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

  // Remaps states according to `remap` array, where remap[oldIndex] = newIndex.
  // Multiple old states can map to the same new index (merging).
  // The `order` array specifies which old state provides the transitions for each new state.
  remapStates(remap, order) {
    this._assertSealed();

    // Reorder and remap transitions.
    const newTransitions = order.map((oldIndex) => {
      const oldTrans = this._transitions[oldIndex];
      const newTrans = [];
      for (let symbolIndex = 0; symbolIndex < oldTrans.length; symbolIndex++) {
        const targets = oldTrans[symbolIndex];
        if (!targets) continue;
        // Remap and deduplicate targets.
        newTrans[symbolIndex] = [...new Set(targets.map(t => remap[t]))];
      }
      return newTrans;
    });
    this._transitions = newTransitions;

    // Reorder and remap epsilon transitions.
    const newEpsilon = order.map((oldIndex) => {
      const eps = this._epsilon[oldIndex];
      return eps ? eps.map(t => remap[t]) : undefined;
    });
    this._epsilon = newEpsilon;

    // Remap start and accept IDs.
    this._startIds = new Set([...this._startIds].map(id => remap[id]));
    this._acceptIds = new Set([...this._acceptIds].map(id => remap[id]));
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
}

// NOTE: The compiler currently supports literals, '.', character classes
// (with ranges and optional negation), grouping '()', alternation '|', and the
// quantifiers '*', '+', and '?'. Additional operators can be layered on once
// the solver needs them.
export const regexToNFA = (pattern, numSymbols) => {
  const parser = new RegexParser(pattern);
  const ast = parser.parse();
  const charToSymbol = createCharToSymbol(numSymbols);
  const builder = new RegexToNFABuilder(charToSymbol, numSymbols);
  return builder.build(ast);
};

// Serialization format overview:
//   Header (written once):
//     * format: 2 bits (plain or packed state encoding, see FORMAT enum)
//     * stateBitsMinusOne: 4 bits storing (state bit width - 1)
//     * symbolCountMinusOne: 4 bits storing (alphabet size - 1)
//     * startIsAccept: 1 bit (1 if state 0 is accepting)
//     * acceptCount: stateBits bits storing the number of additional accepts
//   Body (streamed per state until data ends):
//     Plain format: for each state, transitionCount followed by (symbolIndex, target) pairs.
//     Packed format: a bitmask of active symbols followed by state IDs for each set bit.
// States are ordered with the start state coming first, then all accept states,
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
    nfa.reduceStartStates();
    nfa.closeOverEpsilonTransitions();
    const { acceptCount, startIsAccept } = this._normalizeStates(nfa);
    const numStates = nfa.numStates();

    const symbolCount = this._findSymbolCount(nfa);
    if (symbolCount > this.MAX_SYMBOLS) {
      throw new Error(`NFA requires ${symbolCount} symbols but only ${this.MAX_SYMBOLS} are supported`);
    }
    const stateBits = Math.max(1, requiredBits(numStates - 1));
    if (stateBits > this.MAX_STATE_BITS) {
      throw new Error('NFA exceeds maximum supported state count (1024)');
    }
    const symbolBits = requiredBits(symbolCount - 1);

    const formatChoice = this._chooseStateFormat(nfa, symbolCount, stateBits);

    const writer = new BitWriter();
    this._writeHeader(writer, formatChoice, symbolCount, stateBits, startIsAccept, acceptCount);
    if (formatChoice === this.FORMAT.PACKED) {
      this._writePackedBody(writer, nfa, symbolCount, stateBits);
    } else {
      this._writePlainBody(writer, nfa, symbolBits, stateBits);
    }

    return this._encodeBytes(writer.toUint8Array());
  }

  static deserialize(serialized) {
    const bytes = this._decodeBytes(serialized);
    if (!bytes.length) {
      throw new Error('Serialized NFA is empty');
    }

    const reader = new BitReader(bytes);
    const { format, symbolCount, stateBits, startIsAccept, acceptCount } = this._readHeader(reader);
    const symbolBits = requiredBits(symbolCount - 1);

    const nfa = new NFA();
    if (format === this.FORMAT.PACKED) {
      this._readPackedBody(nfa, reader, symbolCount, stateBits);
    } else {
      this._readPlainBody(nfa, reader, symbolBits, stateBits);
    }

    reader.skipPadding();

    if (!nfa.numStates()) {
      throw new Error('Serialized NFA does not contain any states');
    }

    nfa.addStartId(0);
    if (startIsAccept) nfa.addAcceptId(0);
    for (let i = 1; i <= acceptCount; i++) {
      nfa.addAcceptId(i);
    }

    nfa.seal();
    return nfa;
  }

  static _normalizeStates(nfa) {
    const numStates = nfa.numStates();

    const acceptSet = new Set();
    const otherSet = new Set();
    const acceptTerminalSet = new Set();
    const rejectTerminalSet = new Set();
    for (let i = 0; i < numStates; i++) {
      if (i === nfa.startId) continue;

      const isTerminal = this._isTerminalState(nfa, i);
      if (nfa.isAccepting(i)) {
        (isTerminal ? acceptTerminalSet : acceptSet).add(i);
      } else {
        (isTerminal ? rejectTerminalSet : otherSet).add(i);
      }
    }

    const canonicalAcceptTerminal = setPeek(acceptTerminalSet);
    if (canonicalAcceptTerminal !== null) {
      acceptSet.add(canonicalAcceptTerminal);
    }
    const canonicalRejectTerminal = setPeek(rejectTerminalSet);
    if (canonicalRejectTerminal !== null) {
      otherSet.add(canonicalRejectTerminal);
    }

    // order[newIndex] = oldIndex (which state provides transitions)
    const order = [nfa.startId, ...acceptSet, ...otherSet];

    // remap[oldIndex] = newIndex (handles merging terminal states)
    const remap = new Array(numStates);
    order.forEach((oldIndex, newIndex) => {
      remap[oldIndex] = newIndex;
    });
    for (const id of acceptTerminalSet) {
      remap[id] = remap[canonicalAcceptTerminal];
    }
    for (const id of rejectTerminalSet) {
      remap[id] = remap[canonicalRejectTerminal];
    }

    const startIsAccept = nfa.isAccepting(nfa.startId);
    const acceptCount = acceptSet.size;

    nfa.remapStates(remap, order);

    return { acceptCount, startIsAccept };
  }

  static _isTerminalState(nfa, stateId) {
    return !nfa.hasTransitions(stateId) && !nfa.getEpsilons(stateId).length;
  }

  static _findSymbolCount(nfa) {
    let maxSymbolIndex = -1;
    for (let stateId = 0; stateId < nfa.numStates(); stateId++) {
      const transitions = nfa.getStateTransitions(stateId);
      for (let i = transitions.length - 1; i >= 0; i--) {
        if (transitions[i]?.length) {
          maxSymbolIndex = Math.max(maxSymbolIndex, i);
          break;
        }
      }
    }
    // symbolIndex is 0-based, value is 1-based
    return Math.max(maxSymbolIndex + 1, this.MIN_SYMBOLS);
  }

  static _writeHeader(writer, format, symbolCount, stateBits, startIsAccept, acceptCount) {
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
    writer.writeBits(format, this.HEADER_FORMAT_BITS);
    writer.writeBits(stateBits - 1, this.STATE_BITS_FIELD_BITS);
    writer.writeBits(symbolCount - 1, this.SYMBOL_COUNT_FIELD_BITS);
    writer.writeBits(startIsAccept ? 1 : 0, 1);
    writer.writeBits(acceptCount, stateBits);
  }

  static _readHeader(reader) {
    const format = reader.readBits(this.HEADER_FORMAT_BITS);
    if (!this._isValidFormat(format)) {
      throw new Error('Serialized NFA uses an unknown format');
    }
    const stateBits = reader.readBits(this.STATE_BITS_FIELD_BITS) + 1;
    const symbolCount = reader.readBits(this.SYMBOL_COUNT_FIELD_BITS) + 1;
    const startIsAccept = reader.readBits(1) === 1;
    const acceptCount = reader.readBits(stateBits);
    if (stateBits < this.MIN_STATE_BITS || stateBits > this.MAX_STATE_BITS) {
      throw new Error('State bit width is out of range for header decoding');
    }
    if (symbolCount < this.MIN_SYMBOLS || symbolCount > this.MAX_SYMBOLS) {
      throw new Error('Symbol count is out of range for header decoding');
    }
    return { format, symbolCount, stateBits, startIsAccept, acceptCount };
  }

  static _writePlainBody(writer, nfa, symbolBits, stateBits) {
    for (let stateId = 0; stateId < nfa.numStates(); stateId++) {
      const transitions = nfa.getStateTransitions(stateId);
      // Count transitions first.
      let transitionCount = 0;
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (targets) transitionCount += targets.length;
      }
      writer.writeBits(transitionCount, symbolBits + stateBits);
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

  static _chooseStateFormat(nfa, symbolCount, stateBits) {
    const symbolBits = requiredBits(symbolCount - 1);
    let packedSizeEstimate = 0;
    let plainSizeEstimate = 0;
    for (let stateId = 0; stateId < nfa.numStates(); stateId++) {
      const transitions = nfa.getStateTransitions(stateId);
      plainSizeEstimate += symbolBits + stateBits; // transition count
      packedSizeEstimate += symbolCount;
      let transitionCount = 0;
      for (let symbolIndex = 0; symbolIndex < transitions.length; symbolIndex++) {
        const targets = transitions[symbolIndex];
        if (!targets) continue;
        // If multiple targets per symbol, we can't pack this state.
        if (targets.length > 1) {
          return this.FORMAT.PLAIN;
        }
        transitionCount++;
      }
      plainSizeEstimate += transitionCount * (symbolBits + stateBits);
      packedSizeEstimate += transitionCount * stateBits;
    }

    return packedSizeEstimate < plainSizeEstimate
      ? this.FORMAT.PACKED
      : this.FORMAT.PLAIN;
  }

  static _isValidFormat(format) {
    return format === this.FORMAT.PLAIN || format === this.FORMAT.PACKED;
  }

  static _readPlainBody(nfa, reader, symbolBits, stateBits) {
    const countBits = symbolBits + stateBits;
    for (let stateId = 0; reader.remainingBits() >= countBits; stateId++) {
      const transitionCount = reader.readBits(countBits);
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

export class RegexParser {
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
    while (!this._isEOF() && !this._isSequenceTerminator(this._peek())) {
      parts.push(this._parseQuantified());
    }
    if (!parts.length) return new RegexAstNode.Empty();
    if (parts.length === 1) return parts[0];
    return new RegexAstNode.Concat(parts);
  }

  _parseQuantified() {
    let node = this._parsePrimary();
    while (!this._isEOF()) {
      const ch = this._peek();
      if (ch === '*') {
        this._next();
        node = new RegexAstNode.Star(node);
      } else if (ch === '+') {
        this._next();
        node = new RegexAstNode.Plus(node);
      } else if (ch === '?') {
        this._next();
        node = new RegexAstNode.Optional(node);
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
      return new RegexAstNode.Wildcard();
    }
    if (ch === '\\') {
      this._next();
      const escaped = this._next();
      if (escaped === undefined) {
        throw new Error('Dangling escape at end of pattern');
      }
      return new RegexAstNode.Literal(escaped);
    }
    if (ch === undefined) {
      throw new Error('Unexpected end of pattern');
    }
    if (this._isQuantifier(ch) || ch === '|' || ch === ')') {
      throw new Error(`Unexpected token '${ch}' at position ${this.pos}`);
    }
    this._next();
    return new RegexAstNode.Literal(ch);
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
    return new RegexAstNode.Charset([...chars], isNegated);
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

class RegexToNFABuilder {
  static _Fragment = class {
    constructor(startId, acceptId) {
      this.startId = startId;
      this.acceptId = acceptId;
    }
  };

  constructor(charToSymbol, numSymbols) {
    this._nfa = new NFA();
    this._charToSymbol = charToSymbol;
    this._numSymbols = numSymbols;
  }

  build(ast) {
    const fragment = this._buildNode(ast);
    this._nfa.addStartId(fragment.startId);
    this._nfa.addAcceptId(fragment.acceptId);
    this._nfa.seal();
    return this._nfa;
  }

  _newState() {
    return this._nfa.addState();
  }

  _newFragment(symbols = null) {
    const acceptId = this._newState();
    const startId = this._newState();
    if (symbols && symbols.length) {
      this._nfa.addTransition(startId, acceptId, ...symbols);
    }
    return new RegexToNFABuilder._Fragment(startId, acceptId);
  }

  _addEpsilon(fromStateId, toStateId) {
    this._nfa.addEpsilon(fromStateId, toStateId);
  }

  _buildNode(node) {
    switch (node.constructor) {
      case RegexAstNode.Empty:
        return this._buildEmpty();
      case RegexAstNode.Literal:
        return this._buildLiteral(node.value);
      case RegexAstNode.Wildcard:
        return this._buildWildcard();
      case RegexAstNode.Charset:
        return this._buildCharset(node.chars, node.negated);
      case RegexAstNode.Concat:
        return this._buildConcat(node.parts);
      case RegexAstNode.Alternate:
        return this._buildAlternate(node.options);
      case RegexAstNode.Star:
        return this._buildStar(node.child);
      case RegexAstNode.Plus:
        return this._buildPlus(node.child);
      case RegexAstNode.Optional:
        return this._buildOptional(node.child);
      default:
        throw new Error('Unknown AST node type');
    }
  }

  _buildEmpty() {
    const fragment = this._newFragment();
    this._addEpsilon(fragment.startId, fragment.acceptId);
    return fragment;
  }

  _buildLiteral(char) {
    return this._newFragment([this._charToSymbol(char)]);
  }

  _buildWildcard() {
    return this._newFragment(NFA.Symbol.all(this._numSymbols));
  }

  _buildCharset(chars, negated = false) {
    const charSymbolSet = new Set();
    for (const char of chars) {
      charSymbolSet.add(this._charToSymbol(char).index);
    }
    const symbols = [];
    for (const symbol of NFA.Symbol.all(this._numSymbols)) {
      const inSet = charSymbolSet.has(symbol.index);
      if (negated ? !inSet : inSet) {
        symbols.push(symbol);
      }
    }
    return this._newFragment(symbols);
  }

  _buildConcat(parts) {
    if (!parts.length) return this._buildEmpty();
    const first = this._buildNode(parts[0]);
    let currentStartId = first.startId;
    let currentAcceptId = first.acceptId;
    for (let i = 1; i < parts.length; i++) {
      const next = this._buildNode(parts[i]);
      this._addEpsilon(currentAcceptId, next.startId);
      currentAcceptId = next.acceptId;
    }
    return new RegexToNFABuilder._Fragment(currentStartId, currentAcceptId);
  }

  _buildAlternate(options) {
    const fragment = this._newFragment();
    for (const option of options) {
      const optionFragment = this._buildNode(option);
      this._addEpsilon(fragment.startId, optionFragment.startId);
      this._addEpsilon(optionFragment.acceptId, fragment.acceptId);
    }
    return fragment;
  }

  _buildStar(child) {
    const fragment = this._newFragment();
    const inner = this._buildNode(child);
    this._addEpsilon(fragment.startId, inner.startId);
    this._addEpsilon(fragment.startId, fragment.acceptId);
    this._addEpsilon(inner.acceptId, fragment.acceptId);
    this._addEpsilon(inner.acceptId, inner.startId);
    return fragment;
  }

  _buildPlus(child) {
    const fragment = this._buildNode(child);
    const starFragment = this._buildStar(child);
    this._addEpsilon(fragment.acceptId, starFragment.startId);
    return new RegexToNFABuilder._Fragment(fragment.startId, starFragment.acceptId);
  }

  _buildOptional(child) {
    const fragment = this._buildNode(child);
    const outer = this._newFragment();
    this._addEpsilon(outer.startId, fragment.startId);
    this._addEpsilon(outer.startId, outer.acceptId);
    this._addEpsilon(fragment.acceptId, outer.acceptId);
    return outer;
  }
}

export class JavascriptNFABuilder {
  static MAX_STATE_COUNT = 1024;

  constructor(definition, numValues) {
    const { startExpression, transitionBody, acceptBody } = definition;
    this._startExpression = startExpression;
    this._transitionBody = transitionBody;
    this._acceptBody = acceptBody;
    this._numValues = numValues;
  }

  build() {
    const nfa = new NFA();
    const stateStrToIndex = new Map();
    const indexToStateStr = [];

    const addState = (stateStr, accepting) => {
      if (nfa.numStates() >= JavascriptNFABuilder.MAX_STATE_COUNT) {
        throw new Error(
          `State machine produced more than ${JavascriptNFABuilder.MAX_STATE_COUNT} states`);
      }
      const index = nfa.addState();
      stateStrToIndex.set(stateStr, index);
      indexToStateStr.push(stateStr);
      if (accepting) nfa.addAcceptId(index);
      return index;
    };

    const transitionFn = this._createTransitionFn(this._transitionBody);
    const acceptFn = this._createAcceptFn(this._acceptBody);

    const stack = [];

    const startStateStrs = this._generateStartStates(this._startExpression);
    for (const startStateStr of startStateStrs) {
      const index = addState(startStateStr, acceptFn(startStateStr));
      stack.push(index);
      nfa.addStartId(index);
    }

    while (stack.length) {
      const index = stack.pop();
      const stateStr = indexToStateStr[index];
      for (let value = 1; value <= this._numValues; value++) {
        const nextStateStrs = transitionFn(stateStr, value);
        for (const nextStateStr of nextStateStrs) {
          if (!stateStrToIndex.has(nextStateStr)) {
            stack.push(addState(nextStateStr, acceptFn(nextStateStr)));
          }
          const targetIndex = stateStrToIndex.get(nextStateStr);
          nfa.addTransition(index, targetIndex, new NFA.Symbol(value));
        }
      }
    }

    nfa.seal();
    return nfa;
  }

  _fnResultToStateArray(result) {
    if (Array.isArray(result)) return result;
    if (result !== undefined) return [result];
    return [];
  }

  _generateStartStates(startExpression) {
    if (!startExpression) {
      throw new Error('Start state is empty');
    }

    try {
      const result = Function('"use strict"; return (' + startExpression + ');')();
      const states = this._fnResultToStateArray(result);
      return states.map(item => this._stringifyState(item));
    } catch (err) {
      throw new Error(`Start state expression threw: ${err?.message || err}`);
    }
  }

  _createTransitionFn(transitionBody) {
    try {
      const fn = Function('state', 'value', transitionBody);
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
    } catch (err) {
      throw new Error(`Transition function is invalid: ${err?.message || err}`);
    }
  }

  _createAcceptFn(acceptBody) {
    try {
      const fn = Function('state', acceptBody);
      return (stateStr) => {
        const stateValue = this._deserializeState(stateStr);
        try {
          return !!fn(stateValue);
        } catch (err) {
          throw new Error(
            `Accept function threw for input ${stateStr}: ${err?.message || err}`);
        }
      };
    } catch (err) {
      throw new Error(`Accept function is invalid: ${err?.message || err}`);
    }
  }

  _stringifyState(state) {
    if (Array.isArray(state)) {
      throw new Error('State must not be an array');
    }

    try {
      const serialized = JSON.stringify(state);
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