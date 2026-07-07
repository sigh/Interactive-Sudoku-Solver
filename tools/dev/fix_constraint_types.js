// fix_constraint_types.js — declare constraintTypes on the example puzzle
// entries (data/example_puzzles.js DISPLAYED_EXAMPLES and data/collections.js
// EXAMPLES) so the puzzle selector tags them the same way the app would.
//
// The app tags an un-declared puzzle automatically via extractConstraintTypes
// (js/debug/extract_constraint_types.js) over its raw `input`. That fallback only
// works when `input` is already the dotted constraint string; it yields nothing
// for a `/…` path input (a `.iss` file or `.js` sandbox script) or a non-native
// format (compact killer, SudokuMaker `3x3::k:`, pencilmark grids). Those entries
// need an explicit constraintTypes so the selector shows the right tags.
//
// For each entry we compute the true types by resolving the input exactly as the
// puzzle panel's _resolveInput does (literal passes through, `/…` path is read
// from disk, `.js` is executed through the sandbox) and then extracting. When the
// raw extraction is empty we canonicalize through SudokuParser first, so a
// non-native format tags the same as its dotted equivalent. An entry is declared
// only when the app's automatic tagging wouldn't already match — native inline
// puzzles keep tagging themselves and are left untouched (order preserved).
//
// Usage:
//   node tools/dev/fix_constraint_types.js [--dry-run] [-h|--help]
//
//   (default)  Rewrite the data files so declarations match the actual types.
//   --dry-run  Report the entries that would change without writing; exits
//              non-zero if any are out of sync (usable as a CI check).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';
import { runAsCli } from '../lib/cli_entry.js';

ensureGlobalEnvironment();

const env = await import('../../js/sandbox/env.js' + self.VERSION_PARAM);
const { extractConstraintTypes } = await import('../../js/debug/extract_constraint_types.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const collections = await import('../../data/collections.js' + self.VERSION_PARAM);
const examplePuzzles = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The example libraries the selector surfaces, each paired with its source file.
const SOURCES = [
  { path: resolve(ROOT, 'data/example_puzzles.js'), entries: examplePuzzles.DISPLAYED_EXAMPLES },
  { path: resolve(ROOT, 'data/collections.js'), entries: collections.EXAMPLES },
];

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

// Serialize a script's return value into a constraint string (mirrors run_sandbox.js).
const serialize = (value) => {
  const flatten = (v) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.flatMap(flatten);
    if (typeof v === 'string') return [v];
    if (typeof v.toString === 'function') return [v.toString()];
    return [];
  };
  return flatten(value).join('\n');
};

// Resolve an entry's input to its constraint string, mirroring the puzzle panel's
// _resolveInput: literals pass through, `/…` paths are read from disk, and a `.js`
// path is executed as a sandbox script.
const resolveInput = async (input) => {
  if (!input.startsWith('/')) return input;
  const text = readFileSync(resolve(ROOT, input.slice(1)), 'utf8');
  if (!input.endsWith('.js')) return text;
  const globals = { ...env.SANDBOX_GLOBALS, ...env.getSandboxExtraGlobals(null) };
  const fn = new AsyncFunction(...Object.keys(globals), text);
  return serialize(await fn(...Object.values(globals)));
};

// The true constraint types for an input. Extraction over the resolved
// constraint string is enough for native formats; when that comes back empty we
// canonicalize through SudokuParser so non-native formats (compact killer,
// SudokuMaker, pencilmark grids) tag the same as their dotted equivalent.
const actualTypesFor = async (input) => {
  const text = await resolveInput(input);
  const direct = extractConstraintTypes(text);
  if (direct.length) return direct;
  try {
    return extractConstraintTypes(SudokuParser.parseText(text).toString());
  } catch {
    return direct; // Unparseable (or genuinely no constraints): leave empty.
  }
};

// What the app tags automatically with no declaration: extraction over the raw,
// unresolved `input` — empty for path and non-native formats.
const autoTypesFor = (input) => extractConstraintTypes(input);

// Every named object entry across the example libraries, tagged with its file.
const collectEntries = () => {
  const entries = [];
  for (const { path, entries: list } of SOURCES) {
    for (const item of list) {
      if (item && typeof item === 'object' && typeof item.input === 'string') {
        entries.push({ item, path });
      }
    }
  }
  return entries;
};

// Order-sensitive: the declaration should match the extractor output exactly,
// including its ordering (shape leading, named custom constraints trailing).
const sameTypes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Rewrite one entry's constraintTypes in the source text, keyed on its unique
// `name` (so it works regardless of the input's quote style). Replaces an
// existing declaration or inserts one.
const rewriteEntry = (text, name, types) => {
  const literal = `[${types.map(t => `'${t}'`).join(', ')}]`;
  const at = text.indexOf(`name: '${name}'`);
  if (at === -1) throw new Error(`could not locate entry by name: ${name}`);
  const end = text.indexOf('\n  }', at);
  if (end === -1) throw new Error(`could not find entry end for: ${name}`);

  const region = text.slice(at, end);
  const declRe = /constraintTypes:\s*\[[^\]]*\]/;
  if (declRe.test(region)) {
    return text.slice(0, at) + region.replace(declRe, `constraintTypes: ${literal}`)
      + text.slice(end);
  }
  // No declaration yet: insert after the last field, adding a comma if needed.
  let j = end - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  const comma = text[j] === ',' ? '' : ',';
  return text.slice(0, j + 1) + `${comma}\n    constraintTypes: ${literal},` + text.slice(j + 1);
};

const parseArgs = (argv) => {
  const args = { dryRun: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h': case '--help': args.help = true; break;
      case '--dry-run': args.dryRun = true; break;
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tools/dev/fix_constraint_types.js [--dry-run]

  (default)  Rewrite the data files so declarations match the actual types.
  --dry-run  Report entries that would change without writing; exits non-zero if
             any are out of sync.`);

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }

  const problems = [];
  const warnings = [];
  let checked = 0;
  for (const { item, path } of collectEntries()) {
    const declared = item.constraintTypes;
    const actual = await actualTypesFor(item.input);

    if (declared === undefined) {
      // No declaration: fine as long as the app's automatic tagging (raw
      // extraction over the stored input) already produces the right types.
      // Otherwise the entry needs an explicit declaration.
      if (!sameTypes(autoTypesFor(item.input), actual) && actual.length) {
        problems.push({ item, path, actual, kind: 'missing' });
      }
      continue;
    }

    checked++;
    if (sameTypes(declared, actual)) continue;
    // Never overwrite a real declaration with nothing: an empty result signals a
    // resolution/parse gap, not that the puzzle has no constraints.
    if (!actual.length) {
      warnings.push({ item, declared });
    } else {
      problems.push({ item, path, actual, declared, kind: 'mismatch' });
    }
  }

  const label = (item) => item.name || item.input;
  for (const w of warnings) {
    console.log(`WARNING  ${label(w.item)}: resolved to no types; leaving `
      + `declaration [${w.declared.join(', ')}] unchanged.`);
  }

  if (args.dryRun) {
    if (!problems.length) {
      console.log(`OK: all ${checked} constraintTypes declarations match.`);
      return;
    }
    for (const p of problems) {
      if (p.kind === 'missing') {
        console.log(`MISSING  ${label(p.item)}\n         needs: [${p.actual.join(', ')}]`);
      } else {
        console.log(`MISMATCH ${label(p.item)}\n         declared: [${p.declared.join(', ')}]`
          + `\n         actual:   [${p.actual.join(', ')}]`);
      }
    }
    console.log(`\n${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} out of sync. `
      + `Run without --dry-run to update the data files.`);
    process.exitCode = 1;
    return;
  }

  if (!problems.length) {
    console.log(`No changes needed (${checked} declarations verified).`);
    return;
  }
  // Apply per file so a single run can touch both example libraries.
  const byPath = new Map();
  for (const p of problems) {
    if (!byPath.has(p.path)) byPath.set(p.path, []);
    byPath.get(p.path).push(p);
  }
  for (const [path, ps] of byPath) {
    let text = readFileSync(path, 'utf8');
    for (const p of ps) {
      text = rewriteEntry(text, p.item.name, p.actual);
      const verb = p.kind === 'missing' ? 'added' : 'updated';
      console.log(`${verb}: ${label(p.item)} -> [${p.actual.join(', ')}]`);
    }
    writeFileSync(path, text);
  }
  console.log(`\nFixed ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} across `
    + `${byPath.size} file${byPath.size === 1 ? '' : 's'}.`);
};

runAsCli(import.meta.url, main);
