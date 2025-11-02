const { SudokuConstraintHandler } = await import('./handlers.js' + self.VERSION_PARAM);
const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);

// NOTE: The compiler below currently supports literals, '.', character classes
// (with ranges and optional negation), grouping '()', alternation '|', and the
// quantifiers '*', '+', and '?'. Additional operators can be layered on once the
// solver needs them.

const WILDCARD_SYMBOL = '__ANY__';

const DEFAULT_WILDCARD_ALPHABET = (() => {
  const chars = [];
  for (let i = 1; i <= 9; i++) chars.push(String(i));
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    chars.push(String.fromCharCode(code));
  }
  for (let code = 'a'.charCodeAt(0); code <= 'z'.charCodeAt(0); code++) {
    chars.push(String.fromCharCode(code));
  }
  return chars;
})();

class RegexCompiler {
  static compile(pattern) {
    const parser = new RegexParser(pattern);
    const ast = parser.parse();
    const nfaBuilder = new NFABuilder();
    const { start, accept, states, alphabet, usesWildcard, needsComplement } = nfaBuilder.build(ast);
    const alphabetSet = new Set(alphabet.length ? alphabet : DEFAULT_WILDCARD_ALPHABET);
    if (usesWildcard) {
      DEFAULT_WILDCARD_ALPHABET.forEach(ch => alphabetSet.add(ch));
    }
    if (needsComplement) {
      DEFAULT_WILDCARD_ALPHABET.forEach(ch => alphabetSet.add(ch));
    }
    const dfaBuilder = new DFABuilder(states, start, accept, alphabetSet, usesWildcard);
    return dfaBuilder.build();
  }

  static matches(dfa, input) {
    let stateIndex = dfa.startState;
    for (const ch of input) {
      const state = dfa.states[stateIndex];
      if (!state) return false;
      const next = state.transitions.get(ch);
      if (next === undefined) {
        return false;
      }
      stateIndex = next;
    }
    const finalState = dfa.states[stateIndex];
    return !!finalState?.accepting;
  }
}

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
    let node = this._parseSequence();
    const alternatives = [node];
    while (this._peek() === '|') {
      this._next();
      alternatives.push(this._parseSequence());
    }
    if (alternatives.length === 1) return node;
    return { type: 'alternate', options: alternatives };
  }

  _parseSequence() {
    const parts = [];
    while (!this._isEOF() && !this._isSequenceTerminator(this._peek())) {
      parts.push(this._parseQuantified());
    }
    if (!parts.length) return { type: 'empty' };
    if (parts.length === 1) return parts[0];
    return { type: 'concat', parts };
  }

  _parseQuantified() {
    let node = this._parsePrimary();
    while (!this._isEOF()) {
      const ch = this._peek();
      if (ch === '*') {
        this._next();
        node = { type: 'star', child: node };
      } else if (ch === '+') {
        this._next();
        node = { type: 'plus', child: node };
      } else if (ch === '?') {
        this._next();
        node = { type: 'optional', child: node };
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
      return { type: 'wildcard' };
    }
    if (ch === '\\') {
      this._next();
      const escaped = this._next();
      if (escaped === undefined) {
        throw new Error('Dangling escape at end of pattern');
      }
      return { type: 'literal', value: escaped };
    }
    if (ch === undefined) {
      throw new Error('Unexpected end of pattern');
    }
    if (this._isQuantifier(ch) || ch === '|' || ch === ')') {
      throw new Error(`Unexpected token '${ch}' at position ${this.pos}`);
    }
    this._next();
    return { type: 'literal', value: ch };
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
    return { type: 'charset', chars: [...chars], negated: isNegated };
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
  constructor() {
    this.states = [];
    this.alphabet = new Set();
    this.usesWildcard = false;
    this.needsComplement = false;
  }

  build(ast) {
    const { start, accept } = this._buildNode(ast);
    return {
      start,
      accept,
      states: this.states,
      alphabet: [...this.alphabet],
      usesWildcard: this.usesWildcard,
      needsComplement: this.needsComplement,
    };
  }

  _newState() {
    const state = { id: this.states.length, transitions: new Map(), epsilon: new Set() };
    this.states.push(state);
    return state;
  }

  _addTransition(from, symbol, to) {
    const transitions = from.transitions;
    if (!transitions.has(symbol)) {
      transitions.set(symbol, new Set());
    }
    transitions.get(symbol).add(to.id);
  }

  _addEpsilon(from, to) {
    from.epsilon.add(to.id);
  }

  _registerChars(chars) {
    chars.forEach(ch => this.alphabet.add(ch));
  }

  _buildNode(node) {
    switch (node.type) {
      case 'empty':
        return this._buildEmpty();
      case 'literal':
        return this._buildLiteral(node.value);
      case 'wildcard':
        return this._buildWildcard();
      case 'charset':
        return this._buildCharset(node.chars, node.negated);
      case 'concat':
        return this._buildConcat(node.parts);
      case 'alternate':
        return this._buildAlternate(node.options);
      case 'star':
        return this._buildStar(node.child);
      case 'plus':
        return this._buildPlus(node.child);
      case 'optional':
        return this._buildOptional(node.child);
      default:
        throw new Error(`Unknown AST node: ${node.type}`);
    }
  }

  _buildEmpty() {
    const start = this._newState();
    const accept = this._newState();
    this._addEpsilon(start, accept);
    return { start: start.id, accept: accept.id };
  }

  _buildLiteral(char) {
    this._registerChars([char]);
    const start = this._newState();
    const accept = this._newState();
    this._addTransition(start, char, accept);
    return { start: start.id, accept: accept.id };
  }

  _buildWildcard() {
    this.usesWildcard = true;
    const start = this._newState();
    const accept = this._newState();
    this._addTransition(start, WILDCARD_SYMBOL, accept);
    return { start: start.id, accept: accept.id };
  }

  _buildCharset(chars, negated = false) {
    this._registerChars(chars);
    const start = this._newState();
    const accept = this._newState();
    if (negated) {
      this.needsComplement = true;
      this._addTransition(start, { type: 'negated', exclude: new Set(chars) }, accept);
    } else {
      chars.forEach(ch => this._addTransition(start, ch, accept));
    }
    return { start: start.id, accept: accept.id };
  }

  _buildConcat(parts) {
    if (!parts.length) return this._buildEmpty();
    const first = this._buildNode(parts[0]);
    let currentStart = first.start;
    let currentAccept = first.accept;
    for (let i = 1; i < parts.length; i++) {
      const next = this._buildNode(parts[i]);
      this._addEpsilon(this.states[currentAccept], this.states[next.start]);
      currentAccept = next.accept;
    }
    return { start: currentStart, accept: currentAccept };
  }

  _buildAlternate(options) {
    const startState = this._newState();
    const acceptState = this._newState();
    options.forEach(option => {
      const fragment = this._buildNode(option);
      this._addEpsilon(startState, this.states[fragment.start]);
      this._addEpsilon(this.states[fragment.accept], acceptState);
    });
    return { start: startState.id, accept: acceptState.id };
  }

  _buildStar(child) {
    const startState = this._newState();
    const acceptState = this._newState();
    const fragment = this._buildNode(child);
    this._addEpsilon(startState, this.states[fragment.start]);
    this._addEpsilon(startState, acceptState);
    this._addEpsilon(this.states[fragment.accept], acceptState);
    this._addEpsilon(this.states[fragment.accept], this.states[fragment.start]);
    return { start: startState.id, accept: acceptState.id };
  }

  _buildPlus(child) {
    const fragment = this._buildNode(child);
    const { start, accept } = this._buildStar(child);
    this._addEpsilon(this.states[fragment.accept], this.states[start]);
    return { start: fragment.start, accept: accept };
  }

  _buildOptional(child) {
    const fragment = this._buildNode(child);
    const startState = this._newState();
    const acceptState = this._newState();
    this._addEpsilon(startState, this.states[fragment.start]);
    this._addEpsilon(startState, acceptState);
    this._addEpsilon(this.states[fragment.accept], acceptState);
    return { start: startState.id, accept: acceptState.id };
  }
}

class DFABuilder {
  constructor(nfaStates, startId, acceptId, alphabetSet, usesWildcard) {
    this.nfaStates = nfaStates;
    this.startId = startId;
    this.acceptId = acceptId;
    this.alphabet = [...alphabetSet];
    this.usesWildcard = usesWildcard;
  }

  build() {
    const closureCache = new Map();
    const epsilonClosure = (stateIds) => {
      const key = stateIds.slice().sort((a, b) => a - b).join(',');
      if (closureCache.has(key)) return closureCache.get(key);
      const stack = [...stateIds];
      const visited = new Set(stateIds);
      while (stack.length) {
        const id = stack.pop();
        const state = this.nfaStates[id];
        state.epsilon.forEach(nextId => {
          if (!visited.has(nextId)) {
            visited.add(nextId);
            stack.push(nextId);
          }
        });
      }
      const closure = [...visited].sort((a, b) => a - b);
      closureCache.set(key, closure);
      return closure;
    };

    const startClosure = epsilonClosure([this.startId]);
    const dfaStates = [];
    const stateMap = new Map();
    const queue = [startClosure];
    stateMap.set(startClosure.join(','), 0);
    dfaStates.push(this._makeDFAState(startClosure));

    while (queue.length) {
      const currentClosure = queue.shift();
      const currentKey = currentClosure.join(',');
      const currentDFAState = dfaStates[stateMap.get(currentKey)];

      this.alphabet.forEach(symbol => {
        const moveSet = new Set();
        currentClosure.forEach(nfaId => {
          const nfaState = this.nfaStates[nfaId];
          nfaState.transitions.forEach((targets, key) => {
            if (key === symbol) {
              targets.forEach(id => moveSet.add(id));
              return;
            }
            if (key?.type === 'negated') {
              if (!key.exclude.has(symbol)) {
                targets.forEach(id => moveSet.add(id));
              }
              return;
            }
          });
          if (this.usesWildcard && nfaState.transitions.has(WILDCARD_SYMBOL)) {
            nfaState.transitions.get(WILDCARD_SYMBOL).forEach(id => moveSet.add(id));
          }
        });
        if (!moveSet.size) return;
        const nextClosure = epsilonClosure([...moveSet]);
        const key = nextClosure.join(',');
        if (!stateMap.has(key)) {
          stateMap.set(key, dfaStates.length);
          dfaStates.push(this._makeDFAState(nextClosure));
          queue.push(nextClosure);
        }
        currentDFAState.transitions.set(symbol, stateMap.get(key));
      });
    }

    return {
      alphabet: this.alphabet,
      usesWildcard: this.usesWildcard,
      startState: 0,
      states: dfaStates,
    };
  }

  _makeDFAState(nfaStateIds) {
    const isAccepting = nfaStateIds.includes(this.acceptId);
    return {
      id: null, // filled later if needed
      accepting: isAccepting,
      transitions: new Map(),
      nfaStates: nfaStateIds,
    };
  }
}

// Enforces a linear regex constraint by compiling the pattern into a DFA and
// propagating it across candidate sets to prune unsupported values.
export class RegexLine extends SudokuConstraintHandler {
  constructor(cells, pattern) {
    super(cells);
    this._pattern = pattern;
    this._dfa = RegexCompiler.compile(pattern);
    this._dfaMeta = null;
    this._numValues = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._numValues = shape?.numValues || null;
    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const numCells = this.cells.length;
    const cellChars = new Array(numCells);
    const cellCharMasks = new Array(numCells);

    for (let i = 0; i < numCells; i++) {
      const cellIndex = this.cells[i];
      let mask = grid[cellIndex];
      if (!mask) {
        return false;
      }

      const { chars, charToMask } = this._expandCellOptions(mask);
      if (!chars.length) {
        return false;
      }

      cellChars[i] = chars;
      cellCharMasks[i] = charToMask;
    }

    const dfa = this._dfa;
    const { reverseTransitions, acceptingStates } = this._getDfaMetadata();
    const dfaStates = dfa.states;

    const forward = new Array(numCells + 1);
    forward[0] = new Set([dfa.startState]);

    // Forward pass: compute every DFA state reachable given the current
    // prefix of candidate characters.
    for (let i = 0; i < numCells; i++) {
      const nextStates = new Set();
      const currentStates = forward[i];
      const chars = cellChars[i];
      if (!currentStates?.size) return false;

      for (const stateIndex of currentStates) {
        const transitions = dfaStates[stateIndex]?.transitions;
        if (!transitions) continue;
        for (const char of chars) {
          const dest = transitions.get(char);
          if (dest !== undefined) {
            nextStates.add(dest);
          }
        }
      }

      if (!nextStates.size) return false;
      forward[i + 1] = nextStates;
    }

    const finalStates = forward[numCells];
    let hasAccepting = false;
    for (const stateIndex of finalStates) {
      if (dfaStates[stateIndex]?.accepting) {
        hasAccepting = true;
        break;
      }
    }
    if (!hasAccepting) return false;

    const backward = new Array(numCells + 1);
    backward[numCells] = new Set(acceptingStates);

    // Backward pass: determine which DFA states can still reach an accepting
    // state, respecting the candidate characters at each position.
    for (let i = numCells - 1; i >= 0; i--) {
      const reachable = new Set();
      const nextStates = backward[i + 1];
      const chars = cellChars[i];
      if (!nextStates?.size) return false;

      for (const dest of nextStates) {
        const reverse = reverseTransitions[dest];
        if (!reverse) continue;
        for (const char of chars) {
          const sources = reverse.get(char);
          if (!sources) continue;
          for (const src of sources) {
            reachable.add(src);
          }
        }
      }

      if (!reachable.size) return false;
      backward[i] = reachable;
    }

    if (!backward[0].has(dfa.startState)) {
      return false;
    }

    for (let i = 0; i < numCells; i++) {
      const currentStates = forward[i];
      const nextStates = backward[i + 1];
      const chars = cellChars[i];
      const charToMask = cellCharMasks[i];
      const cellIndex = this.cells[i];
      let mask = grid[cellIndex];

      for (const char of chars) {
        const charMask = charToMask.get(char);
        if (!charMask) continue;

        let supported = false;
        for (const stateIndex of currentStates) {
          const transitions = dfaStates[stateIndex]?.transitions;
          if (!transitions) continue;
          const dest = transitions.get(char);
          if (dest !== undefined && nextStates.has(dest)) {
            supported = true;
            break;
          }
        }

        if (!supported) {
          mask &= ~charMask;
        }
      }

      if (!mask) return false;

      if (mask !== grid[cellIndex]) {
        grid[cellIndex] = mask;
        if (handlerAccumulator) {
          handlerAccumulator.addForCell(cellIndex);
        }
      }
    }

    return true;
  }

  _valueToChar(value) {
    if (value >= 1 && value <= 9) {
      return String(value);
    }

    const index = value - 10;
    if (index >= 0 && index < 26) {
      return String.fromCharCode('A'.charCodeAt(0) + index);
    }

    const lowerIndex = index - 26;
    if (lowerIndex >= 0 && lowerIndex < 26) {
      return String.fromCharCode('a'.charCodeAt(0) + lowerIndex);
    }

    // Fallback: use base-36 style encoding beyond supported range.
    return value.toString();
  }

  _expandCellOptions(mask) {
    const values = LookupTables.toValuesArray(mask);
    const chars = [];
    const charToMask = new Map();
    for (const value of values) {
      const char = this._valueToChar(value);
      const bit = LookupTables.fromValue(value);
      const existing = charToMask.get(char);
      if (existing === undefined) {
        chars.push(char);
        charToMask.set(char, bit);
      } else {
        charToMask.set(char, existing | bit);
      }
    }
    return { chars, charToMask };
  }

  _getDfaMetadata() {
    if (!this._dfaMeta) {
      const { states } = this._dfa;
      const reverseTransitions = Array.from({ length: states.length }, () => new Map());
      const acceptingStates = new Set();

      for (let fromIndex = 0; fromIndex < states.length; fromIndex++) {
        const transitions = states[fromIndex]?.transitions;
        if (!transitions) continue;
        transitions.forEach((toIndex, symbol) => {
          let sources = reverseTransitions[toIndex].get(symbol);
          if (!sources) {
            sources = new Set();
            reverseTransitions[toIndex].set(symbol, sources);
          }
          sources.add(fromIndex);
        });
        if (states[fromIndex]?.accepting) {
          acceptingStates.add(fromIndex);
        }
      }

      this._dfaMeta = { reverseTransitions, acceptingStates };
    }
    return this._dfaMeta;
  }
}