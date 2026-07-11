// lint_sandbox_script.js — targeted authoring guidance for ISS sandbox scripts.
//
// These suggestions surface places where sandbox idioms may have been missed:
// hand-built/parsing cell ids, local neighbour helpers that duplicate cellGraph(),
// and very long generated constraint strings that do not use Replicate.
// They are advisory by default; pass --fail-on-guidance to use them as a CI gate.
//
// Usage:
//   node tools/dev/lint_sandbox_script.js [--fail-on-guidance] <script.js> [...]

import { readFileSync } from 'node:fs';
import { runAsCli } from '../lib/cli_entry.js';
import { runSandboxToConstraint } from '../lib/sandbox_runner.js';

const LONG_CONSTRAINT_LINE_THRESHOLD = 180;

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
    patterns: [
      /\bfunction\s+\w*(?:[Nn]eighbou?r|[Oo]rthogonal|[Kk]ing)\w*\s*\(/g,
      /\bconst\s+\w*(?:[Nn]eighbou?r|[Oo]rthogonal|[Kk]ing)\w*\s*=/g,
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
parsing/building, custom neighbour helpers, and very long generated strings
without Replicate as prompts to reconsider the implementation.`);

const lineForIndex = (source, index) => source.slice(0, index).split('\n').length;

const findPatternGuidance = (source) => {
  const items = [];
  for (const def of GUIDANCE_DEFS) {
    for (const pattern of def.patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        items.push({
          line: lineForIndex(source, match.index),
          code: def.code,
          message: def.message,
        });
      }
    }
  }
  return items;
};

const lintSource = (source) => {
  const rawItems = [
    ...findPatternGuidance(source),
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

const constraintType = (line) => {
  const match = /^\s*\.([^~\s]+)/.exec(line);
  return match?.[1] || null;
};

const findGeneratedGuidance = async (source) => {
  const text = await runSandboxToConstraint(source);
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < LONG_CONSTRAINT_LINE_THRESHOLD) return [];
  if (lines.some(line => constraintType(line) === 'Replicate')) return [];
  return [{
    line: 1,
    code: 'long-output-without-replicate',
    message: `generated ${lines.length} constraint lines and no Replicate; `
      + 'if many constraints are shifted copies, use Replicate to shorten the string',
  }];
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (!args.files.length) throw new Error('No scripts specified. Pass one or more .js files.');

  let total = 0;
  for (const file of args.files) {
    const source = readFileSync(file, 'utf8');
    const guidance = [
      ...lintSource(source),
      ...await findGeneratedGuidance(source),
    ];
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
