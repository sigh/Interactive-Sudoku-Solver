// lint_sandbox_script.js — targeted authoring guidance for ISS sandbox scripts.
//
// These suggestions surface places where sandbox idioms may have been missed:
// hand-built/parsing cell ids, local neighbour helpers that duplicate cellGraph(),
// numValues literals that disagree with the declared Shape, hand-assembled Sum
// coefficient strings, and missing rules prose. They are advisory by default;
// pass --fail-on-guidance to use them as a CI gate.
//
// This tool lints script *source* only. To lint the generated constraints
// (canonicalization, Replicate candidates, redundancy), run the output through
// tools/dev/lint_constraints.js.
//
// Usage:
//   node tools/dev/lint_sandbox_script.js [--fail-on-guidance] <script.js> [...]

import { readFileSync } from 'node:fs';
import { runAsCli } from '../lib/cli_entry.js';

const GUIDANCE_DEFS = [
  {
    code: 'manual-cell-id-regex',
    message: 'manual R/C cell-id parsing found; prefer cellGraph()/cellGeometry helpers',
    patterns: [
      /\/\^R\([^/]*\\d[^/]*\)C\([^/]*\\d[^/]*\)/g,
      /\.match\(\s*\/\^R/g,
      /\.exec\(\s*cell/g,
    ],
  },
  {
    code: 'manual-row-col-cast',
    message: 'manual row/column numeric conversion found; prefer graph helpers over parsing cell ids',
    patterns: [
      /Number\(\s*match\[[12]\]\s*\)/g,
      /parseInt\(\s*match\[[12]\]/g,
    ],
  },
  {
    code: 'manual-cell-id-builder',
    message: 'manual R/C cell-id template found; prefer makeCellId(row, col)',
    patterns: [
      /`R\$\{[^`]+C\$\{[^`]+`/g,
    ],
  },
  {
    code: 'local-file-reference',
    message: 'reference to a local working file or dev tool found; sandbox scripts are shared '
      + 'standalone (?code= links), so keep decode/provenance/validation notes in local files instead',
    patterns: [
      /\b(?:raw|decoded?|result)\.json\b/g,
      /\b(?:notes|description)\.md\b/g,
      /\bsummarize_(?:geometry|decode)\.js\b/g,
      /\b(?:verify_solution|benchmark_puzzles|run_sandbox|lint_sandbox_script)\b/g,
    ],
  },
  {
    code: 'custom-neighbour-helper',
    message: 'custom neighbour helper found; prefer cellGraph().neighbours/kingNeighbours when applicable',
    // King must start the name or a camelCase word ("kingMoves", "antiKing");
    // a bare [Kk]ing alternation also matches "Marking"/"checking". A helper
    // defined *on top of* the cell graph is idiomatic, not custom.
    patterns: [
      /\bfunction\s+(?:\w*(?:[Nn]eighbou?r|[Oo]rthogonal|King)\w*|king\w*)\s*\(/g,
      /\bconst\s+(?:\w*(?:[Nn]eighbou?r|[Oo]rthogonal|King)\w*|king\w*)\s*=/g,
    ],
    // Skip helpers built on the cell graph, and plain data tables whose
    // name merely contains the keyword (e.g. "orthogonalPinkLines = [").
    excludeLine: /\bcellGraph\(|\bgraph\.|\.step\(|\.neighbours\(|\.kingNeighbours\(|=\s*\[/,
  },
  {
    code: 'manual-cell-id-template',
    message: 'hand-built cell id template found; prefer makeCellId(row, col)',
    patterns: [
      /`R\$\{[^`]*\}C/g,
      /`R\d+C\$\{/g,
    ],
  },
  {
    code: 'manual-var-id-template',
    message: 'hand-built Var member id found; prefer Var .cells() / .cell(n)',
    patterns: [
      /`V[A-Z]*\$\{/g,
    ],
  },
  {
    code: 'manual-house-lookup',
    message: 'row/column built from a corner cell; prefer index-based graph.row(n) / graph.column(n)',
    patterns: [
      /\.row\(\s*makeCellId\(/g,
      /\.column\(\s*makeCellId\(/g,
    ],
  },
  {
    code: 'manual-box-arithmetic',
    message: 'manual box construction found; prefer graph.box(n) / graph.boxes()',
    // Box-cell construction only. Cell→box-index derivations
    // (Math.floor((row - 1) / 3) style) are not flagged: no box-index
    // helper exists, so that math is currently the only idiom.
    patterns: [
      /\bb[rc]\s*\*\s*\d/g,
      /'R1C1',\s*'R1C4',\s*'R1C7'/g,
      /\[1,\s*4,\s*7\]/g,
    ],
  },
  {
    code: 'sum-wire-format',
    message: 'hand-assembled Sum coefficient string found; prefer [cell, coeff] pairs (new Sum(0, cellA, [cellB, -1])) and run lint_constraints.js for canonical alternatives (EqualSum, plain Sum)',
    patterns: [
      /`[^`\n]*_=_/g,
      /['"]-?\d+_=_/g,
    ],
  },
  {
    code: 'zero-indexed-cell-math',
    // Only the both-arguments wrapper form: a single "+ 1" is usually
    // legitimate neighbour/offset stepping, not a 0-indexed data table.
    message: 'a makeCellId wrapper adding 1 to both row and column suggests 0-indexed data; prefer 1-indexed R/C data tables',
    patterns: [
      /=>\s*makeCellId\(\s*\w+\s*\+\s*1\s*,\s*\w+\s*\+\s*1\s*\)/g,
    ],
  },
];

const parseArgs = (argv) => {
  const args = { files: [], failOnGuidance: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h': case '--help': args.help = true; break;
      case '--fail-on-guidance': args.failOnGuidance = true; break;
      default: args.files.push(argv[i]); break;
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tools/dev/lint_sandbox_script.js [options] <script.js> [...]

Options:
  --fail-on-guidance  Exit non-zero when guidance is found.
  -h, --help          Print this help and exit.

Guidance is heuristic and advisory by default. It surfaces manual cell-id
parsing/building, custom neighbour helpers, box-index arithmetic, numValues
literals that disagree with the declared Shape, hand-assembled Sum coefficient
strings, and missing rules prose as prompts to reconsider the implementation.
Lint the generated constraints separately with tools/dev/lint_constraints.js.`);

const lineForIndex = (source, index) => source.slice(0, index).split('\n').length;

const findPatternGuidance = (source) => {
  const sourceLines = source.split('\n');
  const items = [];
  for (const def of GUIDANCE_DEFS) {
    for (const pattern of def.patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const line = lineForIndex(source, match.index);
        if (def.excludeLine?.test(sourceLines[line - 1])) continue;
        items.push({ line, code: def.code, message: def.message });
      }
    }
  }
  return items;
};

// Flag NFA.encodeSpec / fnToKey numValues literals that disagree with the
// script's own `new Shape(...)` declaration. Skipped when the shape (or its
// value count) can't be determined from a simple literal.
const findNumValuesGuidance = (source) => {
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
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const literal = Number(match[match.length - 1]);
      if (literal === numValues) continue;
      items.push({
        line: lineForIndex(source, match.index),
        code: 'num-values-mismatch',
        message: `numValues literal ${literal} does not match the declared `
          + `Shape's ${numValues} values; pass the Shape or cellGeometry() `
          + 'instead of a literal',
      });
    }
  }
  return items;
};

// Require some rule prose somewhere in the script: a comment line that is
// not a "Field: value" header line (Title/Author/Video/Source and similar).
const findMissingRulesGuidance = (source) => {
  const HEADER_FIELD = /^\/\/\s*[A-Z][a-zA-Z ]*:/;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('//') && !HEADER_FIELD.test(line)) return [];
  }
  return [{
    line: 1,
    code: 'missing-rules-comment',
    message: 'no rules prose found; state the rules being encoded '
      + '(and any omissions) after the header',
  }];
};

const lintSource = (source) => {
  const rawItems = [
    ...findPatternGuidance(source),
    ...findNumValuesGuidance(source),
    ...findMissingRulesGuidance(source),
  ];
  const seen = new Set();
  const items = rawItems.filter((item) => {
    const key = `${item.line}\0${item.code}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  items.sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
  return items;
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (!args.files.length) throw new Error('No scripts specified. Pass one or more .js files.');

  let total = 0;
  for (const file of args.files) {
    const source = readFileSync(file, 'utf8');
    const guidance = lintSource(source);
    if (!guidance.length) {
      console.log(`${file}: OK`);
      continue;
    }
    total += guidance.length;
    for (const item of guidance) {
      console.log(`${file}:${item.line}: guidance ${item.code}: ${item.message}`);
    }
  }

  if (total) {
    console.log(`\n${total} guidance item${total === 1 ? '' : 's'} found.`);
    if (args.failOnGuidance) process.exitCode = 1;
  }
};

runAsCli(import.meta.url, main);
