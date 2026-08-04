// lint_sandbox_script.js — targeted authoring guidance for ISS sandbox scripts.
//
// These suggestions surface places where sandbox idioms may have been missed:
// hand-built/parsing cell ids, local neighbour helpers that duplicate cellGraph(),
// numValues literals that disagree with the declared Shape, hand-assembled Sum
// coefficient strings, and missing rules prose. Every rule here is `heuristic`
// tier: it reads source text, so a human decides. They are advisory by default;
// pass --fail-on-guidance to use them as a CI gate.
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

import { runAsCli } from '../lib/cli_entry.js';
import { dedupeGuidance, runLintCli } from '../lib/lint_cli.js';

// Blank out comment bodies, preserving every offset and newline so line numbers
// and match indices still refer to the real source. Rules that look for code
// idioms run over this view, so prose describing a rule ("cells [1, 4, 7]",
// "the _=_ wire format") is not mistaken for the idiom itself.
//
// String and template-literal contents are deliberately KEPT: the idioms these
// rules hunt for -- `R${r}C${c}` ids, '_=_' coefficient strings -- live inside
// string literals. The scan tracks strings only so that a `//` inside one (a
// URL, say) does not start a comment.
const commentsBlanked = (source) => {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      // Skip the string body; only the quote state matters here.
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
    } else if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join('');
};

// The source in both views, its lines, and a line number for any index into it.
// The line lookup is a binary search over precomputed line starts: every pattern
// match needs one, and re-slicing the whole source per match is quadratic.
const makeSourceContext = (source) => {
  const lines = source.split('\n');
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  const lineAt = (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  // 'code' hides comments; 'all' sees the file as written.
  const views = { code: commentsBlanked(source), all: source };
  return { lines, lineAt, view: (scope) => views[scope] };
};

// The common rule shape: regexes over one view of the source, one item per
// match. `excludeLine` drops a match whose (raw) line disqualifies it.
const patternRule = ({ patterns, excludeLine, scope = 'code' }) =>
  function check(ctx) {
    const source = ctx.view(scope);
    const items = [];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const line = ctx.lineAt(match.index);
        if (excludeLine?.test(ctx.lines[line - 1])) continue;
        items.push({ line, code: this.code, message: this.summary });
      }
    }
    return items;
  };

// The text of the declaration starting at `start`: brace-matched when it has a
// block body, otherwise up to the end of the statement. Bounded, so an unclosed
// brace cannot drag the scan through the rest of the file.
const declarationBody = (source, start) => {
  const end = Math.min(source.length, start + 2000);
  const brace = source.indexOf('{', start);
  const semi = source.indexOf(';', start);
  if (brace !== -1 && brace < end && (semi === -1 || brace < semi)) {
    let depth = 0;
    for (let i = brace; i < end; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    return source.slice(start, end);
  }
  return source.slice(start, semi === -1 ? end : Math.min(semi + 1, end));
};

// Split a call's argument list at `openParen` into top-level args, tracking
// bracket depth and skipping string bodies so inline spec objects and lambdas
// stay within their own argument. Returns null on an unbalanced call.
const callArgsAt = (source, openParen) => {
  const args = [];
  let depth = 1;
  let argStart = openParen + 1;
  let i = argStart;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') i++;
        i++;
      }
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 1) {
      args.push(source.slice(argStart, i).trim());
      argStart = i + 1;
    }
    i++;
  }
  if (depth !== 0) return null;
  args.push(source.slice(argStart, i - 1).trim());
  return args;
};

// Every call matching `nameRe` (which must end with an escaped open paren),
// with its top-level argument texts.
const findCalls = (source, nameRe) => {
  const calls = [];
  for (const match of source.matchAll(nameRe)) {
    const args = callArgsAt(source, match.index + match[0].length - 1);
    if (args) calls.push({ index: match.index, name: match[1], args });
  }
  return calls;
};

// The value range declared by the script's `new Shape(...)`: numValues and
// valueOffset, either of which is null when the alphabet is set by an
// expression that cannot be resolved statically. `const N = 15` declarations
// are resolved, since naming the alphabet is the common way to widen it.
const parseDeclaredShape = (source) => {
  const call = findCalls(source, /\bnew Shape\(/g)[0];
  const dims = /^['"](\d+)x(\d+)(?:~(\d+)(?:-(\d+))?)?['"]$/
    .exec(call?.args[0] ?? '');
  if (!dims) return null;

  const consts = new Map();
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/g)) {
    consts.set(m[1], Number(m[2]));
  }

  // The alphabet is the second argument, or the `~` suffix of the shape spec.
  const raw = call.args[1] ?? (dims[3] !== undefined
    ? dims[3] + (dims[4] !== undefined ? `-${dims[4]}` : '')
    : undefined);
  const range = raw === undefined
    ? null
    : /^['"]?(\d+)\s*-\s*(\d+)['"]?$/.exec(raw);

  if (raw === undefined) {
    return { numValues: Math.max(Number(dims[1]), Number(dims[2])), valueOffset: 0, raw };
  }
  if (range) {
    return {
      numValues: Number(range[2]) - Number(range[1]) + 1,
      valueOffset: Number(range[1]) - 1,
      raw,
    };
  }
  if (/^\d+$/.test(raw)) return { numValues: Number(raw), valueOffset: 0, raw };
  if (consts.has(raw)) return { numValues: consts.get(raw), valueOffset: 0, raw };
  return { numValues: null, valueOffset: null, raw };
};

// The NFA.encodeSpec / Pair.fnToKey calls that take a value range, with the
// call's explicit value offset when one is passed (opts.valueOffset for
// encodeSpec, the positional third argument for fnToKey).
const findValueRangeCalls = (source) =>
  findCalls(source, /\b(encodeSpec|fnToKey)\(/g).map((call) => ({
    ...call,
    hasExplicitOffset: call.name === 'encodeSpec'
      ? /\bvalueOffset\b/.test(call.args[2] ?? '')
      : call.args.length >= 3 && call.args[2] !== '',
  }));

// What a cell-neighbour helper actually *does*: steps a row/column by a small
// offset, or builds the id of the cell it stepped to. A predicate over two
// digits does none of this, whatever it is called.
const ADJACENCY_BEHAVIOUR = new RegExp([
  /\[\s*-?[01]\s*,\s*-?[01]\s*\]/,        // offset pairs: [-1, 0], [0, 1]
  /\b(?:d[rc]|dRow|dCol|dx|dy)\b/,        // named deltas
  /\b(?:row|col|r|c)\s*[+-]\s*\d/,        // row + 1, c - 1
  /makeCellId\s*\(/,                      // building the stepped-to cell id
  /`R\$\{/,                               // ... or its template form
].map((r) => r.source).join('|'));

export const SOURCE_RULES = [
  {
    code: 'manual-cell-id-regex',
    tier: 'heuristic',
    summary: 'manual R/C cell-id parsing found; prefer cellGraph()/cellGeometry helpers',
    docs: 'Cell ids are an encoding, not data: parsing them back out means the\n'
      + 'geometry was thrown away. Take the row/col from the graph helper that\n'
      + 'produced the cells instead.',
    check: patternRule({
      patterns: [
        /\/\^R\([^/]*\\d[^/]*\)C\([^/]*\\d[^/]*\)/g,
        /\.match\(\s*\/\^R/g,
        /\.exec\(\s*cell/g,
      ],
    }),
  },
  {
    code: 'manual-row-col-cast',
    tier: 'heuristic',
    summary: 'manual row/column numeric conversion found; prefer graph helpers over parsing cell ids',
    docs: 'The other half of manual-cell-id-regex: casting the captured groups\n'
      + 'back to numbers. Ignore only where the ids come from outside the script.',
    check: patternRule({
      patterns: [
        /Number\(\s*match\[[12]\]\s*\)/g,
        /parseInt\(\s*match\[[12]\]/g,
      ],
    }),
  },
  {
    code: 'local-file-reference',
    tier: 'heuristic',
    summary: 'reference to a local working file or dev tool found; sandbox scripts are shared '
      + 'standalone (?code= links), so keep decode/provenance/validation notes in local files instead',
    docs: 'Scans comments as well as code (scope: all): a shared script must make\n'
      + 'sense to a reader who has none of the author\'s local files.',
    check: patternRule({
      scope: 'all',
      patterns: [
        /\b(?:raw|decoded?|result)\.json\b/g,
        /\b(?:notes|description)\.md\b/g,
        /\bsummarize_(?:geometry|decode)\.js\b/g,
        /\b(?:verify_solution|benchmark_puzzles|run_sandbox|lint_sandbox_script)\b/g,
      ],
    }),
  },
  {
    code: 'custom-neighbour-helper',
    tier: 'heuristic',
    summary: 'custom neighbour helper found; prefer cellGraph().neighbours/kingNeighbours when applicable',
    docs: 'The name only nominates a candidate; the body decides. A declaration is\n'
      + 'reported only when it also *computes* adjacency -- steps a row/column by a\n'
      + 'small offset, or builds the id of the cell it stepped to. That keeps the\n'
      + 'rule off predicates that merely borrow the vocabulary: a Pair key function\n'
      + 'named `pickyNeighbors` compares two digits and never touches the grid.\n'
      + 'King must still start the name or a camelCase word ("kingMoves",\n'
      + '"antiKing"), since a bare [Kk]ing also matches "Marking". Helpers built ON\n'
      + 'the cell graph, and data tables, are excluded by line as before.',
    check: function check(ctx) {
      const source = ctx.view('code');
      const exclude = /\bcellGraph\(|\bgraph\.|\.step\(|\.neighbours\(|\.kingNeighbours\(|=\s*\[/;
      const patterns = [
        /\bfunction\s+(?:\w*(?:[Nn]eighbou?r|[Oo]rthogonal|King)\w*|king\w*)\s*\(/g,
        /\bconst\s+(?:\w*(?:[Nn]eighbou?r|[Oo]rthogonal|King)\w*|king\w*)\s*=/g,
      ];
      const items = [];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const line = ctx.lineAt(match.index);
          if (exclude.test(ctx.lines[line - 1])) continue;
          if (!ADJACENCY_BEHAVIOUR.test(declarationBody(source, match.index))) continue;
          items.push({ line, code: this.code, message: this.summary });
        }
      }
      return items;
    },
  },
  {
    code: 'manual-cell-id-template',
    tier: 'heuristic',
    summary: 'hand-built cell id template found; prefer makeCellId(row, col)',
    docs: 'One rule, three spellings of the same template: both parts interpolated,\n'
      + 'the row interpolated, the column interpolated. They overlap, which is why\n'
      + 'they must share a code -- two codes on one line are two findings that\n'
      + 'dedupe cannot merge.',
    check: patternRule({
      patterns: [
        /`R\$\{[^`]+C\$\{[^`]+`/g,
        /`R\$\{[^`]*\}C/g,
        /`R\d+C\$\{/g,
      ],
    }),
  },
  {
    code: 'manual-var-id-template',
    tier: 'heuristic',
    summary: 'hand-built Var member id found; prefer Var .cells() / .cell(n)',
    docs: 'The `V<prefix><n>` id format is internal; the Var instance hands out its\n'
      + 'own member ids, and knows when a single-cell Var drops the index.',
    check: patternRule({
      patterns: [/`V[A-Z]*\$\{/g],
    }),
  },
  {
    code: 'outside-clue-by-arrow-id',
    tier: 'heuristic',
    summary: 'outside clue built from a raw corner/arrow id; prefer '
      + 'Class.fromCells(value, cells, geometry) so the canonical corner and '
      + 'direction come from the cells',
    docs: 'The raw constructor takes an arrowId ("<id>[,<dir>]") -- an internal detail\n'
      + 'that is easy to get wrong: a bare corner id silently defaults the direction,\n'
      + 'picking one of the two lines through that corner. There is no good reason to\n'
      + 'write one by hand, so every direct construction is flagged.',
    check: patternRule({
      patterns: [
        /\bnew\s+(?:LittleKiller|Sandwich|XSum|Skyscraper|HiddenSkyscraper|NumberedRoom|FullRank)\s*\(/g,
      ],
    }),
  },
  {
    code: 'outside-clue-literal-cells',
    tier: 'heuristic',
    summary: 'outside-clue fromCells given a literal cell-list array; derive the '
      + 'line with graph.ray() (diagonals) or graph.row()/graph.column() instead '
      + 'of hand-listing cell ids',
    docs: 'Matches `.fromCells(<value>, [` -- a bare array literal as the second arg.\n'
      + 'A variable, or a graph.ray()/row()/column() call, does not match.',
    check: patternRule({
      patterns: [/\.fromCells\(\s*(?:[^,()[\]]|\([^()]*\))+,\s*\[/g],
    }),
  },
  {
    code: 'manual-house-lookup',
    tier: 'heuristic',
    summary: 'row/column built from a corner cell; prefer index-based graph.row(n) / graph.column(n)',
    docs: 'graph.row()/column() take an index. Passing makeCellId(n, 1) is a\n'
      + 'round trip through the id encoding to say "row n".',
    check: patternRule({
      patterns: [
        /\.row\(\s*makeCellId\(/g,
        /\.column\(\s*makeCellId\(/g,
      ],
    }),
  },
  {
    code: 'bare-replicate-constructor',
    tier: 'heuristic',
    summary: 'bare new Replicate found; prefer graph.makeReplicate() or overlay.makeReplicate()',
    docs: 'The graph or overlay already owns the cell ordering and locator needed\n'
      + 'to encode Replicate targets. Its makeReplicate() helper keeps that wire-format\n'
      + 'plumbing out of sandbox scripts.',
    check: patternRule({
      patterns: [/\bnew\s+Replicate\s*\(/g],
    }),
  },
  {
    code: 'overlay-map-use-array',
    tier: 'heuristic',
    summary: 'overlay at()/gridAt() mapped element-by-element; pass the array '
      + 'directly instead',
    docs: 'The overlay methods accept either one cell or an array. This catches\n'
      + '`.map(cell => overlay.at(cell))` / `.map(cell => overlay.gridAt(cell))`\n'
      + 'and pass-through helpers such as `const overlayCell = cell =>\n'
      + 'overlay.at(cell); cells.map(overlayCell)`. Only variables assigned from\n'
      + 'makeOverlay() are considered, so unrelated APIs with an at() method are\n'
      + 'left alone.',
    check(ctx) {
      const source = ctx.view('code');
      const overlays = new Set([...source.matchAll(
        /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*?\.makeOverlay\s*\(/g,
      )].map(match => match[1]));
      if (!overlays.size) return [];

      const items = [];
      const direct = /\.(?:map|flatMap)\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([A-Za-z_$][\w$]*)\.(at|gridAt)\(\s*\1\s*\)\s*\)/g;
      for (const match of source.matchAll(direct)) {
        const [, , overlay, method] = match;
        if (!overlays.has(overlay)) continue;
        items.push({
          line: ctx.lineAt(match.index),
          code: this.code,
          message: `${overlay}.${method}() accepts the array directly; use `
            + `${overlay}.${method}(cells) instead of mapping each element`,
        });
      }

      const helpers = new Map();
      const arrowHelper = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([A-Za-z_$][\w$]*)\.(at|gridAt)\(\s*\2\s*\)/g;
      for (const match of source.matchAll(arrowHelper)) {
        const [, helper, , overlay, method] = match;
        if (overlays.has(overlay)) helpers.set(helper, { overlay, method });
      }
      const functionHelper = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*return\s+([A-Za-z_$][\w$]*)\.(at|gridAt)\(\s*\2\s*\)\s*;?\s*\}/g;
      for (const match of source.matchAll(functionHelper)) {
        const [, helper, , overlay, method] = match;
        if (overlays.has(overlay)) helpers.set(helper, { overlay, method });
      }

      for (const [helper, { overlay, method }] of helpers) {
        const escaped = helper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const mappedHelper = new RegExp(
          `\\.(?:map|flatMap)\\(\\s*${escaped}\\s*\\)`, 'g');
        for (const match of source.matchAll(mappedHelper)) {
          items.push({
            line: ctx.lineAt(match.index),
            code: this.code,
            message: `${helper} is only ${overlay}.${method}(); pass the array to `
              + `${overlay}.${method}() directly`,
          });
        }
      }
      return items;
    },
  },
  {
    code: 'manual-box-arithmetic',
    tier: 'heuristic',
    summary: 'manual box construction found; prefer graph.box(n) / graph.boxes()',
    docs: 'Box-CELL construction only. Cell->box-index derivations\n'
      + '(Math.floor((row - 1) / 3) style) are not flagged: no box-index helper\n'
      + 'exists, so that math is currently the only idiom.',
    check: patternRule({
      patterns: [
        /\bb[rc]\s*\*\s*\d/g,
        /'R1C1',\s*'R1C4',\s*'R1C7'/g,
        /\[1,\s*4,\s*7\]/g,
      ],
    }),
  },
  {
    code: 'sum-wire-format',
    tier: 'heuristic',
    summary: 'hand-assembled Sum coefficient string found; prefer [cell, coeff] pairs (new Sum(0, cellA, [cellB, -1])) and run lint_constraints.js for canonical alternatives (EqualSum, plain Sum)',
    docs: 'The `<target>_=_<coeffs>` string is the wire format, not an API. The\n'
      + 'structured form is checked; the string is not.',
    check: patternRule({
      patterns: [
        /`[^`\n]*_=_/g,
        /['"]-?\d+_=_/g,
      ],
    }),
  },
  {
    code: 'mutable-constraint-accumulator',
    tier: 'heuristic',
    summary: 'constraint list built by mutation; return it declaratively instead — '
      + 'one `return [...]` of new Shape(...), the givens, and a named group per '
      + 'rule spread in (`...whispers`), building each group with .map()/.flatMap()',
    docs: 'The general tell is a top-level `return <variable>;` rather than an array\n'
      + 'literal or an expression -- anchored to column 0, so a helper\'s own indented\n'
      + '`return out;` is out of scope. Local accumulation that is not the constraint\n'
      + 'list (collecting the branches of one Or, say) is not the pattern.',
    check: patternRule({
      patterns: [
        // The `add()` helper, whatever the array is named.
        /\bconst\s+add\s*=\s*\([^)]*\)\s*=>\s*\w+\.push\(/g,
        /\bconstraints\.push\(/g,
        /^return\s+[A-Za-z_$][\w$]*\s*;/gm,
      ],
    }),
  },
  {
    code: 'zero-indexed-cell-math',
    tier: 'heuristic',
    summary: 'a makeCellId wrapper adding 1 to both row and column suggests 0-indexed data; prefer 1-indexed R/C data tables',
    docs: 'Only the both-arguments wrapper form: a single "+ 1" is usually legitimate\n'
      + 'neighbour/offset stepping, not a 0-indexed data table.',
    check: patternRule({
      patterns: [/=>\s*makeCellId\(\s*\w+\s*\+\s*1\s*,\s*\w+\s*\+\s*1\s*\)/g],
    }),
  },
  {
    code: 'overlay-at-make-cell-id',
    tier: 'heuristic',
    summary: 'at(makeCellId(...)) builds an id just to translate it; declare '
      + 'RxC dimensions on the Var and use cell(row, col)',
    docs: 'Matches <overlay>.at(makeCellId(...)) for variables assigned from\n'
      + 'makeOverlay(). Coordinate access belongs on the Var itself:\n'
      + 'cell(row, col) resolves against the declared dimensions with no id\n'
      + 'round-trip. Overlays remain the tool for graph structure (rows,\n'
      + 'neighbours, makeReplicate) keyed by real grid cells.',
    check(ctx) {
      const source = ctx.view('code');
      const overlays = new Set([...source.matchAll(
        /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*?\.makeOverlay\s*\(/g,
      )].map(match => match[1]));
      if (!overlays.size) return [];
      const items = [];
      const call = /\b([A-Za-z_$][\w$]*)\.at\(\s*makeCellId\s*\(/g;
      for (const match of source.matchAll(call)) {
        if (!overlays.has(match[1])) continue;
        items.push({
          line: ctx.lineAt(match.index),
          code: this.code,
          message: `${match[1]}.at(makeCellId(...)) round-trips through a cell `
            + `id; use the Var's cell(row, col) with declared dimensions`,
        });
      }
      return items;
    },
  },
  {
    code: 'manual-var-cell-arithmetic',
    tier: 'heuristic',
    summary: 'row-major arithmetic into a Var\'s .cell(); pair the group with '
      + 'makeOverlay()/at() instead',
    docs: 'Matches <var>.cell(<expr containing *>) where <var> was assigned from\n'
      + 'new Var(...). Hand-rolled row-major indexing is where a silent\n'
      + 'off-by-one encodes the wrong puzzle while still linting and solving;\n'
      + 'a grid-shaped Var group read through makeOverlay()/at() needs no index\n'
      + 'math. Literal and additive indices (cell(9), cell(i + 1)) are left\n'
      + 'alone: only multiplicative row/column folding is flagged.',
    check(ctx) {
      const source = ctx.view('code');
      const vars = new Set([...source.matchAll(
        /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:SudokuConstraint\.)?Var\s*\(/g,
      )].map(match => match[1]));
      if (!vars.size) return [];
      const items = [];
      const call = /\b([A-Za-z_$][\w$]*)\.cell\(\s*([^()]*\*[^()]*)\)/g;
      for (const match of source.matchAll(call)) {
        if (!vars.has(match[1])) continue;
        items.push({
          line: ctx.lineAt(match.index),
          code: this.code,
          message: `${match[1]}.cell(${match[2].trim()}) hand-rolls row-major `
            + `indexing; read the group through makeOverlay()/at() instead`,
        });
      }
      return items;
    },
  },
  {
    code: 'num-values-mismatch',
    tier: 'heuristic',
    summary: 'NFA.encodeSpec / Pair.fnToKey numValues literal disagrees with the declared Shape',
    docs: 'Cross-references the `new Shape(...)` alphabet against encodeSpec/fnToKey\n'
      + 'literals. The alphabet is read from a bare count (`12`), a string range\n'
      + "(`'0-15'`, also in the `'9x9~0-15'` spec form), or a named constant. When it\n"
      + 'is set by an expression the width is unknown but the shape is certainly\n'
      + 'widened, so any bare literal is reported as unverifiable rather than\n'
      + 'skipped -- that case is exactly where a narrow key silently misreads the\n'
      + 'wider domain. A machine compiled for the wrong alphabet is a real bug, but\n'
      + 'the Shape is read by regex, so this stays heuristic.',
    check(ctx) {
      const source = ctx.view('code');
      const shape = parseDeclaredShape(source);
      if (!shape) return [];

      const items = [];
      for (const call of findValueRangeCalls(source)) {
        const literal = /^\d+$/.test(call.args[1] ?? '') ? Number(call.args[1]) : null;
        if (literal === null) continue;
        if (shape.numValues !== null && literal === shape.numValues) continue;
        items.push({
          line: ctx.lineAt(call.index),
          code: this.code,
          message: shape.numValues === null
            ? `numValues literal ${literal} cannot be checked: the Shape's alphabet `
              + `is set by \`${shape.raw}\`, so it is widened by an unknown amount. `
              + 'Pass the Shape or the geometry itself, never a literal'
            : `numValues literal ${literal} does not match the declared `
              + `Shape's ${shape.numValues} values; pass the Shape or cellGeometry() `
              + 'instead of a literal',
        });
      }
      return items;
    },
  },
  {
    code: 'value-offset-dropped',
    tier: 'heuristic',
    summary: 'NFA.encodeSpec / Pair.fnToKey gets a bare count on an offset-alphabet Shape',
    docs: 'A bare count (a literal or `geometry.numValues`) leaves valueOffset at 0,\n'
      + 'so on a Shape whose alphabet does not start at 1 every value fed to the\n'
      + 'spec is mislabelled -- the machine compiles clean and then rejects grids it\n'
      + 'should accept. The compiled NFA carries no offset metadata, so nothing\n'
      + 'downstream can catch this; only the call site can. Fires when the declared\n'
      + 'alphabet has (or may have) a non-zero offset and the call neither passes\n'
      + 'the Shape/geometry object nor an explicit valueOffset.',
    check(ctx) {
      const source = ctx.view('code');
      const shape = parseDeclaredShape(source);
      if (!shape || shape.valueOffset === 0) return [];

      const items = [];
      for (const call of findValueRangeCalls(source)) {
        if (call.hasExplicitOffset) continue;
        const arg = call.args[1] ?? '';
        const isBareCount = /^\d+$/.test(arg) || /\.numValues$/.test(arg);
        if (!isBareCount) continue;
        // A wrong count is num-values-mismatch's finding; report one problem.
        if (/^\d+$/.test(arg) && shape.numValues !== null
          && Number(arg) !== shape.numValues) continue;
        items.push({
          line: ctx.lineAt(call.index),
          code: this.code,
          message: shape.valueOffset === null
            ? `the Shape's alphabet is set by \`${shape.raw}\`, so its value offset `
              + `cannot be verified; \`${arg}\` carries only a count. Pass the Shape `
              + 'or the geometry itself (or an explicit valueOffset)'
            : `the declared Shape's values start at ${shape.valueOffset + 1} `
              + `(valueOffset ${shape.valueOffset}) but \`${arg}\` carries only a `
              + 'count, leaving valueOffset at 0. Pass the Shape or the geometry '
              + 'itself (or an explicit valueOffset)',
        });
      }
      return items;
    },
  },
  {
    code: 'missing-rules-comment',
    tier: 'heuristic',
    summary: 'no rules prose found; state the rules being encoded '
      + '(and any omissions) after the header',
    docs: 'Reads comments, not code: it wants a comment line that is not a\n'
      + '"Field: value" header (Title/Author/Video/Source and similar). A script\n'
      + 'without its rules written down cannot be reviewed against them.',
    check(ctx) {
      const HEADER_FIELD = /^\/\/\s*[A-Z][a-zA-Z ]*:/;
      for (const rawLine of ctx.lines) {
        const line = rawLine.trim();
        if (line.startsWith('//') && !HEADER_FIELD.test(line)) return [];
      }
      return [{ line: 1, code: this.code, message: this.summary }];
    },
  },
];

// `// lint-ok: <code>[, <code>]` silences those codes on the line it excuses:
// its own line when it trails code, or the line below when it stands alone (so
// a suppression can sit above a long line). A standalone comment silences only
// the next line, never a whole block -- and codes must be named, because a
// blanket "lint-ok" would hide rules nobody considered.
const suppressionsByLine = (lines) => {
  const suppressed = new Map();
  lines.forEach((text, index) => {
    const match = /\/\/\s*lint-ok:\s*([\w-]+(?:\s*,\s*[\w-]+)*)/.exec(text);
    if (!match) return;
    const standalone = text.trim().startsWith('//');
    const line = standalone ? index + 2 : index + 1;
    if (!suppressed.has(line)) suppressed.set(line, new Set());
    for (const code of match[1].split(',')) suppressed.get(line).add(code.trim());
  });
  return suppressed;
};

export const lintSource = (source) => {
  const ctx = makeSourceContext(source);
  const items = SOURCE_RULES.flatMap(rule => rule.check(ctx));
  const suppressed = suppressionsByLine(ctx.lines);
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
  lintFile: (file, raw) => lintSource(raw),
});

runAsCli(import.meta.url, main);
