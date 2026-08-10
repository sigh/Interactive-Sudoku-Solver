// lint_sandbox_script.js — targeted authoring guidance for ISS sandbox scripts.
//
// These suggestions surface places where sandbox idioms may have been missed:
// hand-built/parsing cell ids, local neighbour helpers that duplicate cellGraph(),
// numValues literals that disagree with the declared Shape, hand-assembled Sum
// coefficient strings, excess constraint-constructor arguments, and missing
// rules prose. The rules walk a parsed AST
// (comments come from the parser too), so code-shaped text inside strings and
// comments cannot masquerade as code. Every rule here is `heuristic` tier:
// structure narrows the candidates, but a human decides. They are advisory by
// default; pass --fail-on-guidance to use them as a CI gate. A script that
// does not parse is reported as a file error and is not linted.
//
// A rule that is deliberately not applicable to a line is silenced in the file
// itself: `// lint-ok: <code>[, <code>]` on the line, or on the line above it.
//
// This tool lints script *source* only. To lint the generated constraints
// (canonicalization, Replicate candidates, redundancy), run the output through
// tools/dev/lint_constraints.js.
//
// Usage:
//   node tools/dev/lint_sandbox_script.js [--fail-on-guidance] <script.js> [...]

import { parse } from 'acorn';

import { runAsCli } from '../lib/cli_entry.js';
import { dedupeGuidance, runLintCli } from '../lib/lint_cli.js';
import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';

ensureGlobalEnvironment();
const { SudokuConstraint, OutsideConstraintBase } =
  await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../js/cell_geometry.js' + self.VERSION_PARAM);

// Recursive walk over every AST node. ESTree nodes are plain objects with a
// string `type`; child nodes hang off properties directly or in arrays.
const walkAst = (node, visit, parent = null) => {
  visit(node, parent);
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') walkAst(child, visit, node);
      }
    } else if (value && typeof value.type === 'string') {
      walkAst(value, visit, node);
    }
  }
};

const subtreeHas = (node, predicate) => {
  let found = false;
  walkAst(node, (n) => { found ||= predicate(n); });
  return found;
};

const lazily = (fn) => {
  let value;
  let computed = false;
  return () => {
    if (!computed) {
      value = fn();
      computed = true;
    }
    return value;
  };
};

// The parsed source: its AST indexed by node type, comments, raw text access,
// and lazily-memoized facts that more than one rule needs. A script that does
// not parse is simply broken -- the syntax error is thrown and becomes the
// file's lint error; no guidance runs.
const makeSourceContext = (source) => {
  const comments = [];
  let ast;
  try {
    // Sandbox scripts are function bodies: top-level return/await are legal.
    ast = parse(source, {
      ecmaVersion: 'latest',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      locations: true,
      onComment: comments,
    });
  } catch (e) {
    throw new Error(`syntax error: ${e.message}`);
  }

  const byType = new Map();
  walkAst(ast, (node) => {
    let list = byType.get(node.type);
    if (!list) byType.set(node.type, list = []);
    list.push(node);
  });

  const ctx = {
    lines: source.split('\n'),
    comments,
    ast,
    nodesOfType: (type) => byType.get(type) ?? [],
    text: (node) => source.slice(node.start, node.end),
  };
  // Derived facts shared between rules, computed at most once per file.
  ctx.declaredShape = lazily(() => parseDeclaredShape(ctx));
  ctx.valueRangeCalls = lazily(() => findValueRangeCalls(ctx));
  ctx.overlayBindings = lazily(() => constBindings(ctx, (init) =>
    subtreeHas(init, (n) => isCallTo(n, 'makeOverlay'))));
  return ctx;
};

// A rule's check(ctx) reports findings as AST nodes (the rule summary is the
// message), or as { node | line, message? } when it has more to say; the code
// and defaults are stamped here so no rule spells the item shape.
const findingToItem = (rule, finding) => ({
  line: typeof finding.type === 'string'
    ? finding.loc.start.line
    : finding.node?.loc.start.line ?? finding.line,
  code: rule.code,
  message: finding.message ?? rule.summary,
});

// --- Node predicates shared across rules. ---

// The .property name of a non-computed member expression, else null.
const memberName = (node) =>
  node?.type === 'MemberExpression' && !node.computed
    && node.property.type === 'Identifier' ? node.property.name : null;

// The name a call/new expression is invoked as: `foo(...)` and `obj.foo(...)`
// both give 'foo'.
const calleeName = (node) =>
  node.callee.type === 'Identifier' ? node.callee.name : memberName(node.callee);

// AST equality without source positions or literal spelling. Used when two
// arguments must be the same expression, even if their whitespace or quote
// style differs.
const sameExpression = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, i) => sameExpression(value, b[i]));
  }
  const ignored = new Set(['start', 'end', 'loc', 'raw']);
  const aKeys = Object.keys(a).filter(key => !ignored.has(key));
  const bKeys = Object.keys(b).filter(key => !ignored.has(key));
  return aKeys.length === bKeys.length
    && aKeys.every((key, i) => key === bKeys[i]
      && sameExpression(a[key], b[key]));
};

const isCallTo = (node, name) =>
  node?.type === 'CallExpression' && calleeName(node) === name;

// The object name when `call` is `<name>.<method>(...)` with name in `names`,
// else null.
const methodCallOn = (call, method, names) =>
  memberName(call.callee) === method
    && call.callee.object.type === 'Identifier'
    && names.has(call.callee.object.name)
    ? call.callee.object.name : null;

const stringValue = (node) =>
  node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;

const numberValue = (node) =>
  node?.type === 'Literal' && typeof node.value === 'number' ? node.value : null;

// The template as a shape string: cooked quasi text with '\x00' marking each
// interpolation slot, e.g. `R${r}C${c}` -> 'R\x00C\x00'.
const templateShape = (node) => {
  let shape = '';
  node.quasis.forEach((quasi, i) => {
    shape += quasi.value.cooked ?? '';
    if (i < node.expressions.length) shape += '\x00';
  });
  return shape;
};

// Names bound by `const <name> = <init>` where the init satisfies `predicate`.
const constBindings = (ctx, predicate) => {
  const names = new Set();
  for (const decl of ctx.nodesOfType('VariableDeclarator')) {
    if (decl.id.type === 'Identifier' && decl.init && predicate(decl.init)) {
      names.add(decl.id.name);
    }
  }
  return names;
};

// --- num-values-mismatch / value-offset-dropped: the declared Shape and the
// --- calls that must agree with it.

// Numeric `const N = 15` bindings, for resolving named alphabets.
const numericConstants = (ctx) => {
  const consts = new Map();
  for (const decl of ctx.nodesOfType('VariableDeclarator')) {
    if (decl.id.type === 'Identifier' && numberValue(decl.init) !== null) {
      consts.set(decl.id.name, decl.init.value);
    }
  }
  return consts;
};

const isShapeCall = (node) => node?.type === 'NewExpression'
  && node.callee.type === 'Identifier' && node.callee.name === 'Shape';

// CellGeometry.RAW_GRID_TYPE. SudokuConstraintBase.boxRegions returns [] unless
// the grid type is Sudoku (js/sudoku_constraint.js:269), so graph.box(n) and
// graph.boxes() are empty by design on a Raw grid and hand-built blocks are the
// only way to get the standard tiling there.
const RAW_GRID_TYPE = 'Raw';

// Resolve the host Shape from the returned constraint array. Scripts may also
// construct smaller Shape objects solely as value-range descriptors for an NFA;
// lexical order cannot distinguish those from the Shape that defines the puzzle.
const returnedShapeCall = (ctx) => {
  const bindings = new Map(ctx.nodesOfType('VariableDeclarator')
    .filter((decl) => decl.id.type === 'Identifier' && decl.init)
    .map((decl) => [decl.id.name, decl.init]));
  const resolve = (node) => node?.type === 'Identifier' ? bindings.get(node.name) : node;

  for (const statement of ctx.ast.body) {
    if (statement.type !== 'ReturnStatement') continue;
    const returned = resolve(statement.argument);
    if (returned?.type !== 'ArrayExpression') continue;
    for (const element of returned.elements) {
      const constraint = resolve(element);
      if (isShapeCall(constraint)) return constraint;
    }
  }
  return null;
};

// The value range declared by the script's returned `new Shape(...)`: numValues and
// valueOffset, both null when the alphabet is set by an expression that cannot
// be resolved statically, and the whole result null when there is no valid
// Shape to check against. The spec string is rebuilt exactly as the Shape
// constructor does and handed to CellGeometry.fromShapeSpec, so the linter
// shares the app's alphabet grammar instead of reimplementing it. `const N =
// 15` alphabets are resolved, since naming the alphabet is the common way to
// widen it.
const shapeCall = (ctx) => returnedShapeCall(ctx)
  ?? ctx.nodesOfType('NewExpression').find(isShapeCall);

const parseDeclaredShape = (ctx) => {
  const call = shapeCall(ctx);
  const spec = stringValue(call?.arguments[0]);
  if (spec === null) return null;

  // The alphabet is the second argument, or the `~` suffix of the shape spec.
  const alphabet = call.arguments[1];
  let raw;         // how the script spells it, for messages
  let text = null; // statically resolved form: '12' or '0-8'
  if (alphabet) {
    raw = ctx.text(alphabet);
    if (alphabet.type === 'Literal') {
      text = String(alphabet.value);
    } else if (alphabet.type === 'Identifier') {
      const value = numericConstants(ctx).get(alphabet.name);
      if (value !== undefined) text = String(value);
    }
  } else {
    raw = /~(.+)$/.exec(spec)?.[1];
  }

  let geometry;
  try {
    geometry = CellGeometry.fromShapeSpec(
      alphabet && text !== null ? `${spec}~${text}` : spec);
  } catch {
    return null;  // Not a valid Shape declaration; nothing to check against.
  }
  if (alphabet && text === null) {
    return { numValues: null, valueOffset: null, raw };  // Widened by an unknown amount.
  }
  return { numValues: geometry.numValues, valueOffset: geometry.valueOffset, raw };
};

// Whether encodeSpec's opts argument passes valueOffset. Anything the walk
// cannot see into (a named opts object, a spread, a computed key) counts as
// passing it: unverifiable means silent, not flagged.
const hasValueOffsetOption = (opts) => {
  if (!opts) return false;
  if (opts.type !== 'ObjectExpression') return true;
  return opts.properties.some((p) =>
    p.type !== 'Property'
    || p.computed
    || (p.key.type === 'Identifier' ? p.key.name : p.key.value) === 'valueOffset');
};

// The NFA.encodeSpec / Pair.fnToKey calls that take a value range: the line,
// the second argument as a literal count and/or the bare-count text it was
// spelled as (a number literal or a `.numValues` read), and whether the call
// passes an explicit value offset (opts.valueOffset for encodeSpec, the
// positional third argument for fnToKey).
const findValueRangeCalls = (ctx) =>
  ctx.nodesOfType('CallExpression')
    .filter((n) => ['encodeSpec', 'fnToKey'].includes(calleeName(n)))
    .map((node) => {
      const args = node.arguments;
      const countArg = args[1];

      const literal = numberValue(countArg);
      let bareCountText = literal !== null ? String(literal) : null;
      if (countArg?.type === 'MemberExpression'
        && memberName(countArg) === 'numValues') {
        bareCountText = ctx.text(countArg);
      }

      return {
        node,
        literal,
        bareCountText,
        hasExplicitOffset: calleeName(node) === 'fnToKey'
          ? args.length >= 3
          : hasValueOffsetOption(args[2]),
      };
    });

// --- custom-neighbour-helper: what a candidate declaration must do. ---

// What a cell-neighbour helper actually *does*: steps a row/column by a small
// offset, or builds the id of the cell it stepped to. A predicate over two
// digits does none of this, whatever it is called.
const computesAdjacency = (decl) => subtreeHas(decl, (n) =>
  // Offset pairs: [-1, 0], [0, 1].
  (n.type === 'ArrayExpression' && n.elements.length === 2
    && n.elements.every((el) => {
      const v = el?.type === 'UnaryExpression' && el.operator === '-'
        ? numberValue(el.argument) : numberValue(el);
      return v !== null && Math.abs(v) <= 1;
    }))
  // Named deltas.
  || (n.type === 'Identifier' && /^(?:d[rc]|dRow|dCol|dx|dy)$/.test(n.name))
  // row + 1, c - 1.
  || (n.type === 'BinaryExpression' && (n.operator === '+' || n.operator === '-')
    && n.left.type === 'Identifier' && /^(?:row|col|r|c)$/.test(n.left.name)
    && numberValue(n.right) !== null)
  // Building the stepped-to cell id, by helper or template.
  || isCallTo(n, 'makeCellId')
  || (n.type === 'TemplateLiteral' && /^R\x00/.test(templateShape(n))));

// A declaration that leans on the cell graph (or is a plain data table) is not
// a hand-rolled neighbour helper.
const usesCellGraph = (node) => subtreeHas(node, (n) =>
  isCallTo(n, 'cellGraph')
  || (n.type === 'MemberExpression'
    && n.object.type === 'Identifier' && n.object.name === 'graph')
  || ['step', 'neighbours', 'kingNeighbours'].includes(memberName(n)));

const NEIGHBOUR_NAME = /^(?:[\w$]*(?:[Nn]eighbou?r|[Oo]rthogonal|King)[\w$]*|king[\w$]*)$/;

// --- outside-clue-by-arrow-id: the classes with raw arrowId constructors,
// --- from the class hierarchy so a new subclass is covered automatically.

const OUTSIDE_CLUE_CLASSES = new Set(
  Object.entries(SudokuConstraint)
    .filter(([, cls]) =>
      typeof cls === 'function' && cls.prototype instanceof OutsideConstraintBase)
    .map(([name]) => name));

// --- constraint-constructor-arity: finite public constructor signatures. ---

// Most cell constraints deliberately end in `...cells` and have no maximum.
// Keep only constructors whose public API has a finite upper bound. The
// zero-argument entries inherit the permissive base constructor, but are
// configuration switches whose handlers do not consume arguments.
const CONSTRAINT_MAX_ARITY = new Map([
  ['Container', 1],
  ['Or', 1],
  ['And', 1],
  ['Replicate', 3],
  ['RegionSize', 1],
  ['Shape', 3],
  ['FullRankTies', 1],
  ['Diagonal', 1],
  ['ConnectedValues', 3],
  ['Var', 3],
  ...[...OUTSIDE_CLUE_CLASSES].map((name) => [name, 2]),
  ...[
    'End',
    'NoBoxes',
    'ChaosConstruction',
    'RegionSameValues',
    'StrictKropki',
    'StrictXV',
    'Windoku',
    'DisjointSets',
    'AntiKnight',
    'Doppelganger',
    'AntiKing',
    'AntiTaxicab',
    'AntiConsecutive',
    'GlobalEntropy',
    'GlobalMod',
    'DutchFlatmates',
  ].map((name) => [name, 0]),
]);

// --- overlay-map-use-array / overlay-at-make-cell-id: pass-through shapes. ---

// A one-parameter function whose entire body is `<overlay>.at(<param>)` /
// `.gridAt(<param>)` for a known overlay: the pass-through shape that
// overlay-map-use-array hunts, as a lambda or a single-return function.
const overlayPassThrough = (fn, overlays) => {
  if (fn.params.length !== 1 || fn.params[0].type !== 'Identifier') return null;
  let body = fn.body;
  if (body.type === 'BlockStatement') {
    if (body.body.length !== 1 || body.body[0].type !== 'ReturnStatement') return null;
    body = body.body[0].argument;
  }
  if (body?.type !== 'CallExpression') return null;
  const overlay = methodCallOn(body, 'at', overlays)
    ?? methodCallOn(body, 'gridAt', overlays);
  const arg = body.arguments[0];
  if (!overlay || body.arguments.length !== 1
    || arg.type !== 'Identifier' || arg.name !== fn.params[0].name) return null;
  return { overlay, method: memberName(body.callee) };
};

// --- local-file-reference: names that must not appear in a shared script. ---

// Over comments and string content.
const LOCAL_FILE_PATTERNS = [
  /\b(?:raw|decoded?|result)\.json\b/g,
  /\b(?:notes|description)\.md\b/g,
  /\bsummarize_(?:geometry|decode)\.js\b/g,
  /\b(?:verify_solution|benchmark_puzzles|run_sandbox|lint_sandbox_script)\b/g,
];
// Only the dev-tool names can survive identifier syntax (no dots).
const DEV_TOOL_IDENTIFIER =
  /^(?:verify_solution|benchmark_puzzles|run_sandbox|lint_sandbox_script)$/;

// --- zero-indexed-cell-math: the wrapped `<identifier> + 1` argument form. ---

const isPlusOne = (node) =>
  node?.type === 'BinaryExpression' && node.operator === '+'
  && node.left.type === 'Identifier' && numberValue(node.right) === 1;

// --- missing-rules-comment: what counts as a header rather than prose. ---

const HEADER_FIELD = /^\s*[A-Z][a-zA-Z ]*:/;

const RULES = [
  {
    code: 'manual-cell-id-regex',
    summary: 'manual R/C cell-id parsing found; prefer cellGraph()/cellGeometry helpers',
    docs: 'Cell ids are an encoding, not data: parsing them back out means the\n'
      + 'geometry was thrown away. Take the row/col from the graph helper that\n'
      + 'produced the cells instead.',
    check(ctx) {
      const findings = ctx.nodesOfType('Literal').filter((lit) =>
        lit.regex && /^\^R\(.*\\d.*\)C\(.*\\d.*\)/.test(lit.regex.pattern));
      for (const call of ctx.nodesOfType('CallExpression')) {
        const name = memberName(call.callee);
        const arg = call.arguments[0];
        if (name === 'match' && arg?.regex?.pattern.startsWith('^R')) findings.push(call);
        if (name === 'exec' && arg?.type === 'Identifier'
          && arg.name.startsWith('cell')) findings.push(call);
      }
      return findings;
    },
  },
  {
    code: 'manual-row-col-cast',
    summary: 'manual row/column numeric conversion found; prefer graph helpers over parsing cell ids',
    docs: 'The other half of manual-cell-id-regex: casting the captured groups\n'
      + 'back to numbers. Ignore only where the ids come from outside the script.',
    check(ctx) {
      return ctx.nodesOfType('CallExpression').filter((call) => {
        if (call.callee.type !== 'Identifier'
          || !['Number', 'parseInt'].includes(call.callee.name)) return false;
        const arg = call.arguments[0];
        return arg?.type === 'MemberExpression' && arg.computed
          && arg.object.type === 'Identifier' && arg.object.name === 'match'
          && [1, 2].includes(numberValue(arg.property));
      });
    },
  },
  {
    code: 'local-file-reference',
    summary: 'reference to a local working file or dev tool found; sandbox scripts are shared '
      + 'standalone (?code= links), so keep decode/provenance/validation notes in local files instead',
    docs: 'Scans comments, string literals, and identifiers: a shared script must\n'
      + 'make sense to a reader who has none of the author\'s local files.',
    check(ctx) {
      const findings = [];
      const scan = (text, baseLine) => {
        for (const pattern of LOCAL_FILE_PATTERNS) {
          for (const match of text.matchAll(pattern)) {
            const offset = (text.slice(0, match.index).match(/\n/g) ?? []).length;
            findings.push({ line: baseLine + offset });
          }
        }
      };
      for (const comment of ctx.comments) scan(comment.value, comment.loc.start.line);
      for (const lit of ctx.nodesOfType('Literal')) {
        const value = stringValue(lit);
        if (value !== null) scan(value, lit.loc.start.line);
      }
      for (const tmpl of ctx.nodesOfType('TemplateLiteral')) {
        for (const quasi of tmpl.quasis) {
          scan(quasi.value.cooked ?? '', quasi.loc.start.line);
        }
      }
      return findings.concat(ctx.nodesOfType('Identifier')
        .filter((id) => DEV_TOOL_IDENTIFIER.test(id.name)));
    },
  },
  {
    code: 'custom-neighbour-helper',
    summary: 'custom neighbour helper found; prefer cellGraph().neighbours/kingNeighbours when applicable',
    docs: 'The name only nominates a candidate; the body decides. A declaration is\n'
      + 'reported only when it also *computes* adjacency -- steps a row/column by a\n'
      + 'small offset, or builds the id of the cell it stepped to. That keeps the\n'
      + 'rule off predicates that merely borrow the vocabulary: a Pair key function\n'
      + 'named `pickyNeighbors` compares two digits and never touches the grid.\n'
      + 'King must still start the name or a camelCase word ("kingMoves",\n'
      + '"antiKing"), since a bare [Kk]ing also matches "Marking". Declarations\n'
      + 'that lean on the cell graph, and plain data tables, are excluded.',
    check(ctx) {
      return [
        ...ctx.nodesOfType('FunctionDeclaration')
          .filter((fn) => fn.id && NEIGHBOUR_NAME.test(fn.id.name)),
        ...ctx.nodesOfType('VariableDeclarator')
          .filter((decl) => decl.id.type === 'Identifier'
            && NEIGHBOUR_NAME.test(decl.id.name) && decl.init
            && decl.init.type !== 'ArrayExpression'),
      ].filter((decl) => !usesCellGraph(decl) && computesAdjacency(decl));
    },
  },
  {
    code: 'manual-cell-id-template',
    summary: 'hand-built cell id template found; prefer makeCellId(row, col)',
    docs: 'Flags templates shaped like a cell id with an interpolated row or\n'
      + 'column (`R${r}C${c}`, `R${r}C1`, `R3C${c}`). The spellings overlap, which\n'
      + 'is why they share a code -- two codes on one line are two findings that\n'
      + 'dedupe cannot merge.',
    check(ctx) {
      return ctx.nodesOfType('TemplateLiteral')
        .filter((tmpl) => /^R(?:\x00C|\d+C\x00)/.test(templateShape(tmpl)));
    },
  },
  {
    code: 'manual-var-id-template',
    summary: 'hand-built Var member id found; prefer Var .cells() / .cell(n)',
    docs: 'The `V<prefix><n>` id format is internal; the Var instance hands out its\n'
      + 'own member ids, and knows when a single-cell Var drops the index.',
    check(ctx) {
      return ctx.nodesOfType('TemplateLiteral')
        .filter((tmpl) => /^V[A-Z]*\x00/.test(templateShape(tmpl)));
    },
  },
  {
    code: 'outside-clue-by-arrow-id',
    summary: 'outside clue built from a raw corner/arrow id; prefer '
      + 'Class.fromCells(value, cells, geometry) so the canonical corner and '
      + 'direction come from the cells',
    docs: 'The raw constructor takes an arrowId ("<id>[,<dir>]") -- an internal detail\n'
      + 'that is easy to get wrong: a bare corner id silently defaults the direction,\n'
      + 'picking one of the two lines through that corner. There is no good reason to\n'
      + 'write one by hand, so every direct construction is flagged.',
    check(ctx) {
      return ctx.nodesOfType('NewExpression')
        .filter((n) => OUTSIDE_CLUE_CLASSES.has(calleeName(n)));
    },
  },
  {
    code: 'outside-clue-literal-cells',
    summary: 'outside-clue fromCells given a literal cell-list array; derive the '
      + 'line with graph.ray() (diagonals) or graph.row()/graph.column() instead '
      + 'of hand-listing cell ids',
    docs: 'Matches fromCells(...) with an array literal as the second argument.\n'
      + 'A variable, or a graph.ray()/row()/column() call, does not match.',
    check(ctx) {
      return ctx.nodesOfType('CallExpression')
        .filter((call) => memberName(call.callee) === 'fromCells'
          && call.arguments[1]?.type === 'ArrayExpression');
    },
  },
  {
    code: 'manual-house-lookup',
    summary: 'row/column built from a corner cell; prefer index-based graph.row(n) / graph.column(n)',
    docs: 'graph.row()/column() take an index. Passing makeCellId(n, 1) is a\n'
      + 'round trip through the id encoding to say "row n".',
    check(ctx) {
      return ctx.nodesOfType('CallExpression')
        .filter((call) => ['row', 'column'].includes(memberName(call.callee))
          && isCallTo(call.arguments[0], 'makeCellId'));
    },
  },
  {
    code: 'bare-replicate-constructor',
    summary: 'bare new Replicate found; prefer graph.makeReplicate() or overlay.makeReplicate()',
    docs: 'The graph or overlay already owns the cell ordering and locator needed\n'
      + 'to encode Replicate targets. Its makeReplicate() helper keeps that wire-format\n'
      + 'plumbing out of sandbox scripts. A direct constructor is accepted only for\n'
      + 'the custom-origin form the helpers cannot express: exactly three arguments,\n'
      + 'with Replicate.encodeTargetCells(targets, origin, locator) feeding the\n'
      + 'bitset and the same origin expression passed to the constructor. R1C1 is\n'
      + 'still the graph helper\'s ordinary origin and does not need this exception.',
    check(ctx) {
      return ctx.nodesOfType('NewExpression')
        .filter((n) => {
          if (calleeName(n) !== 'Replicate') return false;
          if (n.arguments.length !== 3 || stringValue(n.arguments[2]) === 'R1C1') {
            return true;
          }
          const encoded = n.arguments[1];
          return !(encoded.type === 'CallExpression'
            && encoded.callee.type === 'MemberExpression'
            && !encoded.callee.computed
            && encoded.callee.object.type === 'Identifier'
            && encoded.callee.object.name === 'Replicate'
            && memberName(encoded.callee) === 'encodeTargetCells'
            && encoded.arguments.length === 3
            && sameExpression(encoded.arguments[1], n.arguments[2]));
        });
    },
  },
  {
    code: 'overlay-map-use-array',
    summary: 'overlay at()/gridAt() mapped element-by-element; pass the array '
      + 'directly instead',
    docs: 'The overlay methods accept either one cell or an array. This catches\n'
      + '`.map(cell => overlay.at(cell))` / `.map(cell => overlay.gridAt(cell))`\n'
      + 'and pass-through helpers such as `const overlayCell = cell =>\n'
      + 'overlay.at(cell); cells.map(overlayCell)`. Only variables assigned from\n'
      + 'makeOverlay() are considered, so unrelated APIs with an at() method are\n'
      + 'left alone.',
    check(ctx) {
      const overlays = ctx.overlayBindings();
      if (!overlays.size) return [];

      const helpers = new Map();
      const candidates = [
        ...ctx.nodesOfType('VariableDeclarator')
          .filter((decl) => decl.id.type === 'Identifier'
            && decl.init?.type === 'ArrowFunctionExpression')
          .map((decl) => [decl.id.name, decl.init]),
        ...ctx.nodesOfType('FunctionDeclaration')
          .filter((fn) => fn.id)
          .map((fn) => [fn.id.name, fn]),
      ];
      for (const [name, fn] of candidates) {
        const helper = overlayPassThrough(fn, overlays);
        if (helper) helpers.set(name, helper);
      }

      const findings = [];
      for (const call of ctx.nodesOfType('CallExpression')) {
        if (!['map', 'flatMap'].includes(memberName(call.callee))) continue;
        const arg = call.arguments[0];
        if (!arg) continue;
        const isInline = arg.type === 'ArrowFunctionExpression'
          || arg.type === 'FunctionExpression';
        const helper = isInline
          ? overlayPassThrough(arg, overlays)
          : arg.type === 'Identifier' && helpers.get(arg.name);
        if (!helper) continue;
        const { overlay, method } = helper;
        findings.push({
          node: call,
          message: isInline
            ? `${overlay}.${method}() accepts the array directly; use `
              + `${overlay}.${method}(cells) instead of mapping each element`
            : `${arg.name} is only ${overlay}.${method}(); pass the array `
              + `to ${overlay}.${method}() directly`,
        });
      }
      return findings;
    },
  },
  {
    code: 'manual-box-arithmetic',
    summary: 'manual box construction found; prefer graph.box(n) / graph.boxes()',
    docs: 'Box-CELL construction only. Cell->box-index derivations\n'
      + '(Math.floor((row - 1) / 3) style) are not flagged: no box-index helper\n'
      + 'exists, so that math is currently the only idiom. One base triple is\n'
      + 'never flagged -- a row whose cells happen to sit at 1, 4, 7 is not box\n'
      + 'construction. Numeric [1, 4, 7] needs two base uses (a row base and a\n'
      + 'column base), each one reached as a sequence rather than merely stored:\n'
      + 'a clue table listing candidate digits is data, not geometry. Corner\n'
      + 'strings need consecutive R{r}C1,R{r}C4,R{r}C7 runs for two or more base\n'
      + 'rows r. A Raw grid is skipped entirely: graph.boxes() is empty there.',
    check(ctx) {
      if (stringValue(shapeCall(ctx)?.arguments[2]) === RAW_GRID_TYPE) return [];
      const findings = ctx.nodesOfType('BinaryExpression').filter((bin) =>
        bin.operator === '*' && bin.left.type === 'Identifier'
        && /^b[rc]$/.test(bin.left.name) && numberValue(bin.right) !== null);
      const cornerRuns = (elements) => {
        const runs = new Map();
        for (const r of [1, 4, 7]) {
          const el = elements.find((e, i) =>
            stringValue(e) === `R${r}C1`
            && stringValue(elements[i + 1]) === `R${r}C4`
            && stringValue(elements[i + 2]) === `R${r}C7`);
          if (el) runs.set(r, el);
        }
        return runs.size >= 2 ? runs.values().next().value : null;
      };
      for (const arr of ctx.nodesOfType('ArrayExpression')) {
        const el = cornerRuns(arr.elements);
        if (el) findings.push(el);
      }
      for (const call of ctx.nodesOfType('CallExpression')) {
        const el = cornerRuns(call.arguments);
        if (el) findings.push(el);
      }
      // Box cells need a row base AND a column base, so a numeric [1, 4, 7]
      // is the pattern only where base triples are reached at least twice:
      // each use of a literal counts once, and so does each use of a name bound
      // to one. A lone `const cols = [1, 4, 7]` is one reach, not boxes.
      //
      // A reach is the elements actually being taken out -- iterated, spread, or
      // subscripted. A triple merely stored is data: MAL2QLszGjE's clue table
      // gives each circle its three candidate digits, and three of those rows
      // read [1, 4, 7], which is a digit set and names no cell at all.
      const consumed = new Set();
      walkAst(ctx.ast, (node, parent) => {
        if (!parent) return;
        if (parent.type === 'MemberExpression' && parent.object === node) consumed.add(node);
        if (parent.type === 'ForOfStatement' && parent.right === node) consumed.add(node);
        if (parent.type === 'SpreadElement') consumed.add(node);
      });
      const triples = ctx.nodesOfType('ArrayExpression').filter((arr) =>
        arr.elements.length === 3
        && [1, 4, 7].every((v, i) => numberValue(arr.elements[i]) === v));
      const bound = new Set();
      for (const decl of ctx.nodesOfType('VariableDeclarator')) {
        if (decl.id.type === 'Identifier' && triples.includes(decl.init)) {
          bound.add(decl.id.name);
        }
      }
      const reaches = triples.filter((arr) => consumed.has(arr)).length
        + ctx.nodesOfType('Identifier')
          .filter((id) => bound.has(id.name) && consumed.has(id)).length;
      if (reaches >= 2) findings.push(...triples);
      return findings;
    },
  },
  {
    code: 'sum-wire-format',
    summary: 'hand-assembled Sum coefficient string found; prefer [cell, coeff] pairs (new Sum(0, cellA, [cellB, -1])) and run lint_constraints.js for canonical alternatives (EqualSum, plain Sum)',
    docs: 'The `<target>_=_<coeffs>` string is the wire format, not an API. The\n'
      + 'structured form is checked; the string is not.',
    check(ctx) {
      return [
        ...ctx.nodesOfType('Literal')
          .filter((lit) => /^-?\d+_=_/.test(stringValue(lit) ?? '')),
        ...ctx.nodesOfType('TemplateLiteral')
          .filter((tmpl) =>
            tmpl.quasis.some((q) => (q.value.cooked ?? '').includes('_=_'))),
      ];
    },
  },
  {
    code: 'mutable-constraint-accumulator',
    summary: 'constraint list built by mutation; return it declaratively instead — '
      + 'one `return [...]` of new Shape(...), the givens, and a named group per '
      + 'rule spread in (`...whispers`), building each group with .map()/.flatMap()',
    docs: 'The general tell is a top-level `return <variable>;` rather than an array\n'
      + 'literal or an expression -- read from the Program body directly, so a\n'
      + 'helper\'s own `return out;` is out of scope. Local accumulation that is not\n'
      + 'the constraint list (collecting the branches of one Or, say) is not the\n'
      + 'pattern.',
    check(ctx) {
      const findings = [];
      // The `add()` helper, whatever the array is named.
      for (const decl of ctx.nodesOfType('VariableDeclarator')) {
        if (decl.id.type === 'Identifier' && decl.id.name === 'add'
          && decl.init?.type === 'ArrowFunctionExpression'
          && decl.init.body.type === 'CallExpression'
          && memberName(decl.init.body.callee) === 'push') {
          findings.push(decl);
        }
      }
      for (const call of ctx.nodesOfType('CallExpression')) {
        if (memberName(call.callee) === 'push'
          && call.callee.object.type === 'Identifier'
          && call.callee.object.name === 'constraints') {
          findings.push(call);
        }
      }
      for (const statement of ctx.ast.body) {
        if (statement.type === 'ReturnStatement'
          && statement.argument?.type === 'Identifier') {
          findings.push(statement);
        }
      }
      return findings;
    },
  },
  {
    code: 'zero-indexed-cell-math',
    summary: 'a makeCellId wrapper adding 1 to both row and column suggests 0-indexed data; prefer 1-indexed R/C data tables',
    docs: 'Only the both-arguments wrapper form (a lambda or return of\n'
      + 'makeCellId(r + 1, c + 1)): a single "+ 1" is usually legitimate\n'
      + 'neighbour/offset stepping, not a 0-indexed data table.',
    check(ctx) {
      const findings = [];
      walkAst(ctx.ast, (node, parent) => {
        if (node.type === 'CallExpression' && calleeName(node) === 'makeCellId'
          && node.arguments.length === 2 && node.arguments.every(isPlusOne)
          && (parent?.type === 'ArrowFunctionExpression'
            || parent?.type === 'ReturnStatement')) {
          findings.push(node);
        }
      });
      return findings;
    },
  },
  {
    code: 'overlay-at-make-cell-id',
    summary: 'at(makeCellId(...)) builds an id just to translate it; declare '
      + 'RxC dimensions on the Var and use cell(row, col)',
    docs: 'Matches <overlay>.at(makeCellId(...)) for variables assigned from\n'
      + 'makeOverlay(). Coordinate access belongs on the Var itself:\n'
      + 'cell(row, col) resolves against the declared dimensions with no id\n'
      + 'round-trip. Overlays remain the tool for graph structure (rows,\n'
      + 'neighbours, makeReplicate) keyed by real grid cells.',
    check(ctx) {
      const overlays = ctx.overlayBindings();
      if (!overlays.size) return [];
      const findings = [];
      for (const call of ctx.nodesOfType('CallExpression')) {
        const overlay = methodCallOn(call, 'at', overlays);
        if (!overlay || !isCallTo(call.arguments[0], 'makeCellId')) continue;
        findings.push({
          node: call,
          message: `${overlay}.at(makeCellId(...)) round-trips through a cell `
            + 'id; use the Var\'s cell(row, col) with declared dimensions',
        });
      }
      return findings;
    },
  },
  {
    code: 'manual-var-cell-arithmetic',
    summary: 'row-major arithmetic into a Var\'s .cell(); pair the group with '
      + 'makeOverlay()/at() instead',
    docs: 'Matches <var>.cell(<expr containing *>) where <var> was assigned from\n'
      + 'new Var(...). Hand-rolled row-major indexing is where a silent\n'
      + 'off-by-one encodes the wrong puzzle while still linting and solving;\n'
      + 'a grid-shaped Var group read through makeOverlay()/at() needs no index\n'
      + 'math. Literal and additive indices (cell(9), cell(i + 1)) are left\n'
      + 'alone: only multiplicative row/column folding is flagged.',
    check(ctx) {
      const vars = constBindings(ctx, (init) =>
        init.type === 'NewExpression' && calleeName(init) === 'Var');
      if (!vars.size) return [];
      const findings = [];
      for (const call of ctx.nodesOfType('CallExpression')) {
        const varName = methodCallOn(call, 'cell', vars);
        const index = call.arguments[0];
        if (!varName || !index || !subtreeHas(index, (n) =>
          n.type === 'BinaryExpression' && n.operator === '*')) continue;
        findings.push({
          node: call,
          message: `${varName}.cell(${ctx.text(index)}) hand-rolls `
            + 'row-major indexing; read the group through makeOverlay()/at() instead',
        });
      }
      return findings;
    },
  },
  {
    code: 'constraint-constructor-arity',
    summary: 'constraint constructor has excess arguments that its public API does not consume',
    docs: 'Checks every constraint constructor with a finite maximum: fixed-arity\n'
      + 'constructors, Shape (dimensions plus one optional value range), all\n'
      + 'outside-clue constructors, and argument-free configuration switches.\n'
      + 'Genuinely variadic cell constraints are excluded. Calls containing a\n'
      + 'spread are left alone because their final arity is not statically known.\n'
      + 'Only excess arguments are reported: several constructors intentionally\n'
      + 'default omitted arguments. In particular, RegionSize takes one cell-count\n'
      + 'argument, not separate row and column dimensions.',
    check(ctx) {
      const findings = [];
      for (const expr of ctx.nodesOfType('NewExpression')) {
        const name = calleeName(expr);
        const maxArity = CONSTRAINT_MAX_ARITY.get(name);
        if (maxArity === undefined
          || expr.arguments.some((arg) => arg.type === 'SpreadElement')
          || expr.arguments.length <= maxArity) continue;

        const supplied = expr.arguments.length;
        const message = name === 'RegionSize'
          ? `RegionSize accepts 1 argument: the region cell count. ${supplied} `
            + 'arguments were supplied; use RegionSize(rows * columns), or omit '
            + 'it to use the Shape\'s default boxes'
          : maxArity === 0
            ? `${name} accepts no arguments; ${supplied} `
              + `${supplied === 1 ? 'was' : 'were'} supplied, so they cannot `
              + 'affect the intended constraint'
            : `${name} accepts at most ${maxArity} argument${maxArity === 1 ? '' : 's'}; `
            + `${supplied} were supplied, so the trailing `
            + `${supplied - maxArity} cannot affect the intended constraint`;
        findings.push({ node: expr, message });
      }
      return findings;
    },
  },
  {
    code: 'num-values-mismatch',
    summary: 'NFA.encodeSpec / Pair.fnToKey numValues literal disagrees with the declared Shape',
    docs: 'Cross-references the `new Shape(...)` alphabet against encodeSpec/fnToKey\n'
      + 'literals. The alphabet is read from a bare count (`12`), a string range\n'
      + "(`'0-15'`, also in the `'9x9~0-15'` spec form), or a named constant. When it\n"
      + 'is set by an expression the width is unknown but the shape is certainly\n'
      + 'widened, so any bare literal is reported as unverifiable rather than\n'
      + 'skipped -- that case is exactly where a narrow key silently misreads the\n'
      + 'wider domain. A machine compiled for the wrong alphabet is a real bug, but\n'
      + 'values that flow through helpers stay unresolvable, so this stays heuristic.',
    check(ctx) {
      const shape = ctx.declaredShape();
      if (!shape) return [];

      const findings = [];
      for (const call of ctx.valueRangeCalls()) {
        if (call.literal === null) continue;
        if (shape.numValues !== null && call.literal === shape.numValues) continue;
        findings.push({
          node: call.node,
          message: shape.numValues === null
            ? `numValues literal ${call.literal} cannot be checked: the Shape's `
              + `alphabet is set by \`${shape.raw}\`, so it is widened by an unknown `
              + 'amount. Pass the Shape or the geometry itself, never a literal'
            : `numValues literal ${call.literal} does not match the declared `
              + `Shape's ${shape.numValues} values; pass the Shape or cellGeometry() `
              + 'instead of a literal',
        });
      }
      return findings;
    },
  },
  {
    code: 'value-offset-dropped',
    summary: 'NFA.encodeSpec / Pair.fnToKey gets a bare count on an offset-alphabet Shape',
    docs: 'A bare count (a literal or `geometry.numValues`) leaves valueOffset at 0,\n'
      + 'so on a Shape whose alphabet does not start at 1 every value fed to the\n'
      + 'spec is mislabelled -- the machine compiles clean and then rejects grids it\n'
      + 'should accept. The compiled NFA carries no offset metadata, so nothing\n'
      + 'downstream can catch this; only the call site can. Fires when the declared\n'
      + 'alphabet has (or may have) a non-zero offset and the call neither passes\n'
      + 'the Shape/geometry object nor an explicit valueOffset. Opts the walk cannot\n'
      + 'see into (a named object, a spread) are assumed to carry the offset.',
    check(ctx) {
      const shape = ctx.declaredShape();
      if (!shape || shape.valueOffset === 0) return [];

      const findings = [];
      for (const call of ctx.valueRangeCalls()) {
        if (call.hasExplicitOffset) continue;
        if (call.bareCountText === null) continue;
        // A wrong count is num-values-mismatch's finding; report one problem.
        if (call.literal !== null && shape.numValues !== null
          && call.literal !== shape.numValues) continue;
        findings.push({
          node: call.node,
          message: shape.valueOffset === null
            ? `the Shape's alphabet is set by \`${shape.raw}\`, so its value offset `
              + `cannot be verified; \`${call.bareCountText}\` carries only a count. `
              + 'Pass the Shape or the geometry itself (or an explicit valueOffset)'
            : `the declared Shape's values start at ${shape.valueOffset + 1} `
              + `(valueOffset ${shape.valueOffset}) but \`${call.bareCountText}\` `
              + 'carries only a count, leaving valueOffset at 0. Pass the Shape or '
              + 'the geometry itself (or an explicit valueOffset)',
        });
      }
      return findings;
    },
  },
  {
    code: 'missing-rules-comment',
    summary: 'no rules prose found; state the rules being encoded '
      + '(and any omissions) after the header',
    docs: 'Reads comments, not code: it wants a comment that is not a\n'
      + '"Field: value" header (Title/Author/Video/Source and similar). A script\n'
      + 'without its rules written down cannot be reviewed against them.',
    check(ctx) {
      const hasProse = ctx.comments.some((comment) =>
        comment.type === 'Block' || !HEADER_FIELD.test(comment.value));
      return hasProse ? [] : [{ line: 1 }];
    },
  },
];

// Every source rule is advisory pattern guidance; stamping the tier here keeps
// the USAGE promise ("--fail-on=exact never gates on this tool") structural.
export const SOURCE_RULES = RULES.map((rule) => ({ ...rule, tier: 'heuristic' }));

// `// lint-ok: <code>[, <code>]` silences those codes on the line it excuses:
// its own line when it trails code, or the line below when it stands alone (so
// a suppression can sit above a long line). A standalone comment silences only
// the next line, never a whole block -- and codes must be named, because a
// blanket "lint-ok" would hide rules nobody considered. Only real comments
// count: the parser supplies them, so a string containing "lint-ok" is inert.
const suppressionsByLine = (ctx) => {
  const suppressed = new Map();
  for (const comment of ctx.comments) {
    if (comment.type !== 'Line') continue;
    const match = /^\s*lint-ok:\s*([\w-]+(?:\s*,\s*[\w-]+)*)/.exec(comment.value);
    if (!match) continue;
    const { line, column } = comment.loc.start;
    const standalone = ctx.lines[line - 1].slice(0, column).trim() === '';
    const target = standalone ? line + 1 : line;
    if (!suppressed.has(target)) suppressed.set(target, new Set());
    for (const code of match[1].split(',')) suppressed.get(target).add(code.trim());
  }
  return suppressed;
};

// `only`/`ignore` take Sets of rule codes (as the CLI parses them) so
// deselected rules are skipped entirely, not run and filtered.
export const lintSource = (source, { only = null, ignore = null } = {}) => {
  const ctx = makeSourceContext(source);
  const rules = SOURCE_RULES.filter((rule) =>
    (!only || only.has(rule.code)) && !ignore?.has(rule.code));
  const items = rules.flatMap((rule) =>
    rule.check(ctx).map((finding) => findingToItem(rule, finding)));
  const suppressed = suppressionsByLine(ctx);
  return dedupeGuidance(
    items.filter(item => !suppressed.get(item.line)?.has(item.code)));
};

const USAGE = `\
Usage: node tools/dev/lint_sandbox_script.js [options] <script.js> [...]

Options:
  --list-rules        Print the rules (code, tier, what each catches) and exit.
  --only=<codes>      Run only these rules (comma-separated).
  --ignore=<codes>    Run everything but these rules.
  --fail-on-guidance  Exit non-zero when any guidance is found.
  --fail-on=<tiers>   Exit non-zero only for these tiers (exact, heuristic, info).
  --format=text|json  Output format (default text).
  --baseline=<file>   Suppress the counts recorded in this baseline file.
  --write-baseline=<file>  Write the run's counts as a new baseline.
  -h, --help          Print this help and exit.

Guidance is heuristic and advisory by default: it surfaces authoring idioms as
prompts to reconsider the implementation, and every rule here is 'heuristic'
tier, so --fail-on=exact never gates on this tool. Run --list-rules for what
each rule catches. Silence a rule in the file itself with
\`// lint-ok: <code>\` on, or directly above, the line.

Lint the generated constraints separately with tools/dev/lint_constraints.js.`;

export const main = async (argv) => runLintCli({
  argv,
  usage: USAGE,
  rules: SOURCE_RULES,
  noFilesError: 'No scripts specified. Pass one or more .js files.',
  lintFile: (file, raw, args) =>
    lintSource(raw, { only: args.only, ignore: args.ignore }),
});

runAsCli(import.meta.url, main);
