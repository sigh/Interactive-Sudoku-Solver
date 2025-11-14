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
  const alphabet = LookupTables.get(numValues).allValues;
  const nfaBuilder = new NFABuilder(charToMask, alphabet);
  const { start, accept, states } = nfaBuilder.build(ast);
  const dfaBuilder = new DFABuilder(states, start, accept, alphabet);
  const dfa = dfaBuilder.build();
  return collapseZeroTransitionStates(dfa);
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

  constructor(charToMask, alphabet) {
    this.states = [];
    this._charToMask = charToMask;
    this._alphabet = alphabet;
  }

  build(ast) {
    const fragment = this._buildNode(ast);
    return {
      start: fragment.start.id,
      accept: fragment.accept.id,
      states: this.states,
    };
  }

  _newState(transitionSymbols = 0, transitionState = null) {
    const state = {
      id: this.states.length,
      transitionSymbols,
      transitionState,
      epsilon: []
    };
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
  constructor(nfaStates, startId, acceptId, alphabet) {
    this.nfaStates = nfaStates;
    this.startId = startId;
    this.acceptId = acceptId;
    this.alphabet = alphabet;
    this._singleStateClosures = new Map();
  }

  static _EpsilonClosure = class {
    constructor(states) {
      this.states = [...states].sort((a, b) => a - b);
      this.key = this.states.join(',');
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
    const dfaStates = [];
    const stateMap = new Map();
    const addState = (closure) => {
      const index = dfaStates.length;
      stateMap.set(closure.key, index);
      dfaStates.push(this._makeDFAState(closure.states));
    }

    const startClosure = this._epsilonClosure([this.startId]);
    addState(startClosure);
    const stack = [startClosure];

    while (stack.length) {
      const currentClosure = stack.pop();
      const currentStates = currentClosure.states;
      const currentDFAState = dfaStates[stateMap.get(currentClosure.key)];
      const transitionMap = new Map();

      for (let symbol = 1; symbol < this.alphabet; symbol <<= 1) {
        const moveSet = new Set();
        for (const currentStateId of currentStates) {
          const nfaState = this.nfaStates[currentStateId];
          if (nfaState.transitionSymbols & symbol) {
            moveSet.add(nfaState.transitionState);
          }
        }
        if (!moveSet.size) continue;

        const nextClosure = this._epsilonClosure(moveSet);
        if (!stateMap.has(nextClosure.key)) {
          addState(nextClosure);
          stack.push(nextClosure);
        }
        const nextStateId = stateMap.get(nextClosure.key);
        transitionMap.set(nextStateId,
          transitionMap.get(nextStateId) | symbol);
      }

      for (const [nextStateId, mask] of transitionMap.entries()) {
        currentDFAState.transitionList.push({
          state: nextStateId,
          mask: mask,
        });
      }
    }

    return {
      alphabet: this.alphabet,
      startState: 0,
      states: dfaStates,
    };
  }

  _makeDFAState(nfaStateIds) {
    const isAccepting = nfaStateIds.includes(this.acceptId);
    return {
      accepting: isAccepting,
      transitionList: [],
    };
  }
}

const collapseZeroTransitionStates = (dfa) => {
  const states = dfa.states;

  const acceptingSinks = [];

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (state.accepting && !state.transitionList.length) {
      acceptingSinks.push(i);
    }
  }

  if (acceptingSinks.length <= 1) return dfa;

  const canonicalAccepting = acceptingSinks[0];
  const nonCanonical = new Set();
  for (let i = 1; i < acceptingSinks.length; i++) {
    nonCanonical.add(acceptingSinks[i]);
  }

  const newStates = [];
  const oldToNew = new Map();

  for (let i = 0; i < states.length; i++) {
    if (nonCanonical.has(i)) continue;
    oldToNew.set(i, newStates.length);
    newStates.push({
      accepting: states[i].accepting,
      transitionList: [],
    });
  }

  for (let i = 0; i < states.length; i++) {
    if (nonCanonical.has(i)) continue;
    const merged = new Map();
    for (const entry of states[i].transitionList) {
      const target = nonCanonical.has(entry.state) ? canonicalAccepting : entry.state;
      const newIndex = oldToNew.get(target);
      merged.set(newIndex, (merged.get(newIndex) || 0) | entry.mask);
    }
    const state = newStates[oldToNew.get(i)];
    for (const [stateIndex, mask] of merged) {
      state.transitionList.push({ state: stateIndex, mask });
    }
  }

  const startState = oldToNew.get(
    nonCanonical.has(dfa.startState) ? canonicalAccepting : dfa.startState);

  return {
    alphabet: dfa.alphabet,
    startState,
    states: newStates,
  };
};

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

    const acceptingStates = new Set();
    this._dfa.states.forEach((state, index) => {
      if (state.accepting) acceptingStates.add(index);
    });
    this._acceptingStates = acceptingStates;
    const slots = this.cells.length + 1;
    this._statesList = Array.from({ length: slots }, () => new Set());

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const dfa = this._dfa;
    const dfaStates = dfa.states;
    const statesList = this._statesList;

    // Clear all the states. Setting it to an empty set has better performance
    // than clearing the existing set.
    for (let i = 0; i < statesList.length; i++) statesList[i] = new Set();

    // Forward pass: Find all states reachable from the start state.
    statesList[0].add(dfa.startState);

    for (let i = 0; i < numCells; i++) {
      const nextStates = statesList[i + 1];
      const currentStates = statesList[i];
      const values = grid[cells[i]];

      for (const stateIndex of currentStates) {
        const transitionList = dfaStates[stateIndex].transitionList;
        for (let j = 0; j < transitionList.length; j++) {
          const entry = transitionList[j];
          if (values & entry.mask) {
            nextStates.add(entry.state);
          }
        }
      }

      if (!nextStates.size) return false;
    }

    // Backward pass: Filter down to only the states that can reach an accepting
    // state. Prune any unsupported values from the grid.
    const finalStates = statesList[numCells];
    for (const state of finalStates) {
      if (!this._acceptingStates.has(state)) finalStates.delete(state);
    }
    if (!finalStates.size) return false;

    for (let i = numCells - 1; i >= 0; i--) {
      const currentStates = statesList[i];
      const nextStates = statesList[i + 1];
      const cell = this.cells[i];
      const values = grid[cell];
      let supportedValues = 0;

      for (const stateIndex of currentStates) {
        const transitionList = dfaStates[stateIndex].transitionList;
        let stateSupportedValues = 0;
        for (let j = 0; j < transitionList.length; j++) {
          const entry = transitionList[j];
          const maskedValues = entry.mask & values;
          if (maskedValues && nextStates.has(entry.state)) {
            stateSupportedValues |= maskedValues;
          }
        }

        if (!stateSupportedValues) currentStates.delete(stateIndex);
        supportedValues |= stateSupportedValues;
      }

      if (!supportedValues) return false;

      if (values !== supportedValues) {
        grid[cell] = supportedValues;
        handlerAccumulator.addForCell(cell);
      }
    }

    return true;
  }
}