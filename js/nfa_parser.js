const { LookupTables } = await import('./solver/lookup_tables.js' + self.VERSION_PARAM);

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
  };
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