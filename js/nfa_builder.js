const { LookupTables } = await import('./solver/lookup_tables.js' + self.VERSION_PARAM);
const {
  Base64Codec,
  BitReader,
  BitWriter,
  setPeek,
  countOnes16bit,
  requiredBits
} = await import('./util.js' + self.VERSION_PARAM);

export class NFA {
  constructor(startId, acceptIds, states) {
    this.startId = startId;
    this.acceptIds = new Set(acceptIds);
    this.states = states;
  }

  static Transition = class Transition {
    constructor(symbols, state) {
      this.symbols = symbols;
      this.state = state;
    }
  };

  static State = class State {
    constructor() {
      this.transitions = [];
      this.epsilon = [];
    }

    addTransition(symbols, state) {
      this.transitions.push(new NFA.Transition(symbols, state));
    }

    addEpsilon(state) {
      this.epsilon.push(state);
    }

    mergeTransitions() {
      // Compress transitions by merging those with the same target.
      const transitions = this.transitions;
      transitions.sort((a, b) => a.state - b.state);
      let writeIndex = 0;
      for (let j = 0; j < transitions.length;) {
        const targetState = transitions[j].state;
        let symbols = 0;
        while (j < transitions.length && transitions[j].state === targetState) {
          symbols |= transitions[j].symbols;
          j++;
        }
        transitions[writeIndex].symbols = symbols;
        transitions[writeIndex].state = targetState;
        writeIndex++;
      }
      transitions.length = writeIndex;
    }
  };

  closeOverEpsilonTransitions() {
    const numStates = this.states.length;
    for (let i = 0; i < numStates; i++) {
      const currentState = this.states[i];
      if (currentState.epsilon.length === 0) continue;

      // Find all states reachable via epsilon transitions.
      const visited = new Set();
      const stack = [i];
      while (stack.length) {
        const stateId = stack.pop();
        if (visited.has(stateId)) continue;
        visited.add(stateId);
        const state = this.states[stateId];
        for (const epsilonTarget of state.epsilon) {
          stack.push(epsilonTarget);
        }
      }

      visited.delete(i);  // Remove self

      // Find the closure, then remove epsilon transitions.
      for (const targetId of visited) {
        currentState.transitions.push(...this.states[targetId].transitions);
        if (this.acceptIds.has(targetId)) {
          this.acceptIds.add(i);
        }
      }

      currentState.epsilon = [];
      currentState.mergeTransitions();
    }
  }
}

// NOTE: The compiler currently supports literals, '.', character classes
// (with ranges and optional negation), grouping '()', alternation '|', and the
// quantifiers '*', '+', and '?'. Additional operators can be layered on once
// the solver needs them.
export const regexToNFA = (pattern, numSymbols) => {
  const parser = new RegexParser(pattern);
  const ast = parser.parse();
  const charToMask = createCharToMask(numSymbols);
  const builder = new RegexToNFABuilder(charToMask, numSymbols);
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
//     Plain format: sequences of (hasMore bit, symbols mask, target) ending with hasMore=0.
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
    const normalized = this._normalizeStates(nfa);
    const states = normalized.states;
    const remap = normalized.remap;
    const acceptCount = normalized.acceptCount;
    const startIsAccept = normalized.startIsAccept;
    const numStates = states.length;

    const symbolCount = this._findSymbolCount(states);
    if (symbolCount > this.MAX_SYMBOLS) {
      throw new Error(`NFA requires ${symbolCount} symbols but only ${this.MAX_SYMBOLS} are supported`);
    }
    const stateBits = Math.max(1, requiredBits(numStates - 1));
    if (stateBits > this.MAX_STATE_BITS) {
      throw new Error('NFA exceeds maximum supported state count (1024)');
    }

    const stateTransitions = states.map((state) => {
      const transitions = [];
      for (const { symbols, state: toState } of state.transitions) {
        if (!symbols) {
          throw new Error('NFA transition is missing symbols; use epsilon transitions instead');
        }
        const mapped = remap[toState];
        transitions.push({ symbols: symbols, target: mapped });
      }
      for (const epsilonTarget of state.epsilon) {
        const mapped = remap[epsilonTarget];
        transitions.push({ symbols: 0, target: mapped });
      }
      return transitions;
    });

    const formatChoice = this._chooseStateFormat(states, symbolCount, stateBits);

    const writer = new BitWriter();
    this._writeHeader(writer, formatChoice, symbolCount, stateBits, startIsAccept, acceptCount);
    if (formatChoice === this.FORMAT.PACKED) {
      this._writePackedBody(writer, stateTransitions, symbolCount, stateBits);
    } else {
      this._writePlainBody(writer, stateTransitions, symbolCount, stateBits);
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
    const expectPackedStates = format === this.FORMAT.PACKED;

    let states;
    let maxTargetSeen;
    if (expectPackedStates) {
      ({ states, maxTargetSeen } = this._readPackedBody(reader, symbolCount, stateBits));
    } else {
      ({ states, maxTargetSeen } = this._readPlainBody(reader, symbolCount, stateBits));
    }

    const minimumStates = Math.max(maxTargetSeen + 1, acceptCount + 1, 1);
    if (states.length < minimumStates) {
      throw new Error('Serialized NFA ended before all referenced states were defined');
    }
    if (states.length > minimumStates) {
      states.length = minimumStates;
    }

    reader.skipPadding();

    if (!states.length) {
      throw new Error('Serialized NFA does not contain any states');
    }

    const acceptIds = [];
    if (startIsAccept) acceptIds.push(0);
    for (let i = 1; i <= acceptCount; i++) {
      acceptIds.push(i);
    }

    return new NFA(0, acceptIds, states);
  }

  static _normalizeStates(nfa) {
    const states = nfa.states;
    const numStates = states.length;

    const acceptSet = new Set();
    const otherSet = new Set();
    const acceptTerminalSet = new Set();
    const rejectTerminalSet = new Set();
    for (let i = 0; i < numStates; i++) {
      if (i === nfa.startId) continue;

      const isTerminal = this._isTerminalState(states[i]);
      if (nfa.acceptIds.has(i)) {
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

    const order = [nfa.startId, ...acceptSet, ...otherSet];

    const remap = new Array(numStates);
    order.forEach((repIndex, newIndex) => {
      remap[repIndex] = newIndex;
    });
    for (const id of acceptTerminalSet) {
      remap[id] = remap[canonicalAcceptTerminal];
    }
    for (const id of rejectTerminalSet) {
      remap[id] = remap[canonicalRejectTerminal];
    }

    const orderedStates = order.map((idx) => states[idx]);
    const startIsAccept = nfa.acceptIds.has(nfa.startId);
    const acceptCount = acceptSet.size;
    return { states: orderedStates, remap, acceptCount, startIsAccept };
  }

  static _isTerminalState(state) {
    if (!state) return false;
    const transitionCount = state.transitions?.length ?? 0;
    const epsilonCount = state.epsilon?.length ?? 0;
    return transitionCount === 0 && epsilonCount === 0;
  }

  static _findSymbolCount(states) {
    let allBits = 0;
    for (const state of states) {
      for (const { symbols } of state.transitions) {
        allBits |= symbols;
      }
    }

    const maxBit = LookupTables.maxValue(allBits);

    return Math.max(maxBit, this.MIN_SYMBOLS);
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

  static _writePlainBody(writer, stateTransitions, symbolCount, stateBits) {
    for (const transitions of stateTransitions) {
      if (!transitions.length) {
        writer.writeBits(0, 1);
        continue;
      }

      for (const { symbols, target } of transitions) {
        writer.writeBits(1, 1);
        writer.writeBits(symbols, symbolCount);
        writer.writeBits(target, stateBits);
      }

      writer.writeBits(0, 1);
    }
  }

  static _writePackedBody(writer, stateTransitions, symbolCount, stateBits) {
    for (const transitions of stateTransitions) {
      const symbolTargets = new Map();
      let seenSymbols = 0;
      for (let { symbols, target } of transitions) {
        if (seenSymbols & symbols) {
          throw new Error('Cannot build packed format: overlapping symbols');
        }
        seenSymbols |= symbols;

        while (symbols) {
          const lowestBit = symbols & -symbols;
          symbols ^= lowestBit;
          symbolTargets.set(lowestBit, target);
        }
      }

      writer.writeBits(seenSymbols, symbolCount);
      while (seenSymbols) {
        const lowestBit = seenSymbols & -seenSymbols;
        seenSymbols ^= lowestBit;
        const target = symbolTargets.get(lowestBit);
        writer.writeBits(target, stateBits);
      }
    }
  }

  static _chooseStateFormat(states, symbolCount, stateBits) {
    let packedSizeEstimate = 0;
    let plainSizeEstimate = 0;
    for (const state of states) {
      if (state.epsilon.length > 0) return this.FORMAT.PLAIN;

      const transitions = state.transitions;
      plainSizeEstimate += 1; // terminator
      packedSizeEstimate += symbolCount;
      let seenSymbols = 0;
      for (const { symbols } of transitions) {
        // If any symbols overlap, we can't pack this state.
        if (symbols & seenSymbols) {
          return this.FORMAT.PLAIN;
        }
        seenSymbols |= symbols;
        plainSizeEstimate += symbolCount + stateBits + 1;  // +1 for hasMore bit
        packedSizeEstimate += countOnes16bit(symbols) * stateBits;
      }
    }

    return packedSizeEstimate < plainSizeEstimate
      ? this.FORMAT.PACKED
      : this.FORMAT.PLAIN;
  }

  static _isValidFormat(format) {
    return format === this.FORMAT.PLAIN || format === this.FORMAT.PACKED;
  }

  static _readPlainBody(reader, symbolCount, stateBits) {
    const states = [];
    let maxTargetSeen = 0;
    while (reader.remainingBits() > 0) {
      const state = new NFA.State();
      while (true) {
        if (reader.remainingBits() === 0) {
          throw new Error('Serialized NFA plain state is truncated');
        }
        const hasMore = reader.readBits(1);
        if (hasMore === 0) break;
        if (reader.remainingBits() < symbolCount + stateBits) {
          throw new Error('Serialized NFA plain state transition data is truncated');
        }
        const symbols = reader.readBits(symbolCount);
        const target = reader.readBits(stateBits);
        if (symbols === 0) {
          state.addEpsilon(target);
        } else {
          state.addTransition(symbols, target);
        }
        if (target > maxTargetSeen) maxTargetSeen = target;
      }
      states.push(state);
    }
    return { states, maxTargetSeen };
  }

  static _readPackedBody(reader, symbolCount, stateBits) {
    const states = [];
    let maxTargetSeen = 0;
    while (reader.remainingBits() >= symbolCount) {
      const state = new NFA.State();
      const activeMask = reader.readBits(symbolCount);
      let mask = activeMask;
      let symbolIndex = 1;
      while (mask) {
        if (mask & 1) {
          if (reader.remainingBits() < stateBits) {
            throw new Error('Serialized NFA packed state transition data is truncated');
          }
          const target = reader.readBits(stateBits);
          const symbolsMask = 1 << (symbolIndex - 1);
          state.addTransition(symbolsMask, target);
          if (target > maxTargetSeen) maxTargetSeen = target;
        }
        mask >>>= 1;
        symbolIndex++;
      }
      states.push(state);
    }
    return { states, maxTargetSeen };
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


const createCharToMask = (numValues) => {
  return (char) => {
    const value = charToValue(char);
    if (value < 1 || value > numValues) {
      throw new Error(`Character '${char}' exceeds shape value count (${numValues})`);
    }
    return LookupTables.fromValue(value);
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

  constructor(charToMask, numSymbols) {
    this.states = [];
    this._charToMask = charToMask;
    this._alphabet = LookupTables.get(numSymbols).allValues;
  }

  build(ast) {
    const fragment = this._buildNode(ast);
    return new NFA(
      fragment.startId,
      [fragment.acceptId],
      this.states,
    );
  }

  _newState() {
    const state = new NFA.State();
    const id = this.states.length;
    this.states.push(state);
    return id;
  }

  _newFragment(transitionSymbols = 0) {
    const acceptId = this._newState();
    const startId = this._newState();
    if (transitionSymbols) {
      this.states[startId].addTransition(transitionSymbols, acceptId);
    }
    return new RegexToNFABuilder._Fragment(startId, acceptId);
  }

  _addEpsilon(fromStateId, toStateId) {
    this.states[fromStateId].addEpsilon(toStateId);
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
    this._stateStrToIndex = new Map();
    this._states = [];
  }

  build() {
    const transitionFn = this._createTransitionFn(this._transitionBody);
    const acceptFn = this._createAcceptFn(this._acceptBody);

    const stack = [];

    const startStateStrs = this._generateStartStates(this._startExpression);
    if (startStateStrs.length === 1) {
      const startStateStr = startStateStrs[0];
      stack.push(this._addState(startStateStr, acceptFn(startStateStr)));
    } else {
      const startIndex = this._addState('COMBINED_START', false);
      const combinedStateRecord = this._states[startIndex];

      for (const startStateStr of startStateStrs) {
        const index = this._addState(startStateStr, acceptFn(startStateStr));
        stack.push(index);
        combinedStateRecord.epsilon.push(index);
      }
    }

    while (stack.length) {
      const index = stack.pop();
      const record = this._states[index];
      for (let value = 1; value <= this._numValues; value++) {
        const nextStateStrs = transitionFn(record.serialized, value);
        for (const nextStateStr of nextStateStrs) {
          if (!this._stateStrToIndex.has(nextStateStr)) {
            stack.push(this._addState(nextStateStr, acceptFn(nextStateStr)));
          }
          const targetIndex = this._stateStrToIndex.get(nextStateStr);
          const mask = record.transitions.get(targetIndex) || 0;
          record.transitions.set(targetIndex, mask | LookupTables.fromValue(value));
        }
      }
    }

    return this._toNFA();
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

  _addState(stateStr, accepting) {
    if (this._states.length >= JavascriptNFABuilder.MAX_STATE_COUNT) {
      throw new Error(
        `State machine produced more than ${JavascriptNFABuilder.MAX_STATE_COUNT} states`);
    }
    const record = {
      serialized: stateStr,
      transitions: new Map(),
      accepting,
      epsilon: [],
    };
    const index = this._states.length;
    this._states.push(record);
    this._stateStrToIndex.set(stateStr, index);
    return index;
  }

  _toNFA() {
    const nfaStates = this._states.map(() => new NFA.State());
    const acceptIds = [];
    this._states.forEach((record, index) => {
      if (record.accepting) acceptIds.push(index);
      for (const epsilonTarget of record.epsilon) {
        nfaStates[index].addEpsilon(epsilonTarget);
      }
      const nfaState = nfaStates[index];
      for (const [target, mask] of record.transitions.entries()) {
        if (mask) {
          nfaState.addTransition(mask, target);
        }
      }
    });
    return new NFA(0, acceptIds, nfaStates);
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