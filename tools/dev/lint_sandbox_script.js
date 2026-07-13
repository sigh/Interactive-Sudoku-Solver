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
    docs: 'Name-based, so it is the most false-positive-prone rule here: King must\n'
      + 'start the name or a camelCase word ("kingMoves", "antiKing"), since a bare\n'
      + '[Kk]ing also matches "Marking". Helpers built ON the cell graph, and data\n'
      + 'tables whose name merely contains the keyword, are excluded.',
    check: patternRule({
      patterns: [
        /\bfunction\s+(?:\w*(?:[Nn]eighbou?r|[Oo]rthogonal|King)\w*|king\w*)\s*\(/g,
        /\bconst\s+(?:\w*(?:[Nn]eighbou?r|[Oo]rthogonal|King)\w*|king\w*)\s*=/g,
      ],
      excludeLine: /\bcellGraph\(|\bgraph\.|\.step\(|\.neighbours\(|\.kingNeighbours\(|=\s*\[/,
    }),
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
    code: 'num-values-mismatch',
    tier: 'heuristic',
    summary: 'NFA.encodeSpec / Pair.fnToKey numValues literal disagrees with the declared Shape',
    docs: 'Cross-references the `new Shape(...)` literal against encodeSpec/fnToKey\n'
      + 'literals. Skipped when the shape (or its value count) cannot be read from a\n'
      + 'simple literal. A machine compiled for the wrong alphabet is a real bug, but\n'
      + 'the Shape is read by regex, so this stays heuristic.',
    check(ctx) {
      const source = ctx.view('code');
      const shapeMatch = /new Shape\(\s*['"](\d+)x(\d+)['"]\s*(?:,\s*(\d+)\s*)?\)/.exec(source);
      if (!shapeMatch) return [];
      const numValues = shapeMatch[3]
        ? Number(shapeMatch[3])
        : Math.max(Number(shapeMatch[1]), Number(shapeMatch[2]));

      const items = [];
      const patterns = [
        /encodeSpec\(\s*[^,()]+,\s*(\d+)/g,
        /fnToKey\(([^()]|\([^()]*\))*,\s*(\d+)\s*\)/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const literal = Number(match[match.length - 1]);
          if (literal === numValues) continue;
          items.push({
            line: ctx.lineAt(match.index),
            code: this.code,
            message: `numValues literal ${literal} does not match the declared `
              + `Shape's ${numValues} values; pass the Shape or cellGeometry() `
              + 'instead of a literal',
          });
        }
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
