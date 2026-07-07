// fix_constraint_types.js — update the constraintTypes declared on puzzle entries
// in data/collections.js so they match what the app would tag them with.
//
// The app tags un-declared puzzles automatically via extractConstraintTypes
// (js/debug/extract_constraint_types.js) over their constraint string. That fallback
// only works when the `input` *is* the constraint string; a `/…` path input
// (a `.iss` file, or a `.js` sandbox script) can't be parsed as-is, so those
// entries must declare constraintTypes explicitly. This tool keeps those
// declarations equal to what the automatic extraction would produce.
//
// Input is resolved exactly as the puzzle panel's _resolveInput does: a literal
// passes through, a `/…` path is read from disk, and a `.js` path is executed
// through the sandbox (like run_sandbox.js). Then extractConstraintTypes runs on
// the result. Entries whose declared set already matches are left untouched
// (order preserved, no churn).
//
// Usage:
//   node tools/dev/fix_constraint_types.js [--dry-run] [-h|--help]
//
//   (default)  Rewrite data/collections.js so declarations match the actual types.
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
const collections = await import('../../data/collections.js' + self.VERSION_PARAM);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const COLLECTIONS_PATH = resolve(ROOT, 'data/collections.js');

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

// The constraint types the app's automatic extraction would produce for this input.
const actualTypesFor = async (input) =>
  extractConstraintTypes(await resolveInput(input));

// Every object entry (across all exported collections) that carries an input.
const collectEntries = () => {
  const entries = [];
  for (const value of Object.values(collections)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === 'object' && typeof item.input === 'string') {
        entries.push(item);
      }
    }
  }
  return entries;
};

// Order-sensitive: the declaration should match the extractor output exactly,
// including its ordering (shape leading, named custom constraints trailing).
const sameTypes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Rewrite one entry's constraintTypes in the source text, keyed on its (unique,
// quote-free) input literal. Replaces an existing declaration or inserts one.
const rewriteEntry = (text, input, types) => {
  const literal = `[${types.map(t => `'${t}'`).join(', ')}]`;
  const at = text.indexOf(`'${input}'`);
  if (at === -1) throw new Error(`could not locate input in source: ${input}`);
  const end = text.indexOf('\n  }', at);
  if (end === -1) throw new Error(`could not find entry end for: ${input}`);

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

  (default)  Rewrite data/collections.js so declarations match the actual types.
  --dry-run  Report entries that would change without writing; exits non-zero if
             any are out of sync.`);

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }

  const problems = [];
  const warnings = [];
  let checked = 0;
  for (const item of collectEntries()) {
    const declared = item.constraintTypes;
    const isPath = item.input.startsWith('/');

    // Inline entries without a declaration are tagged automatically by the app,
    // so there is nothing to keep in sync. Everything else we resolve and check.
    if (!isPath && declared === undefined) continue;

    const actual = await actualTypesFor(item.input);

    if (declared === undefined) {
      // A path entry can't auto-tag; a non-empty result means it needs one.
      if (actual.length) problems.push({ item, actual, kind: 'missing' });
      continue;
    }

    checked++;
    if (sameTypes(declared, actual)) continue;
    // Never overwrite a real declaration with nothing: an empty result signals a
    // resolution/parse gap, not that the puzzle has no constraints.
    if (!actual.length) {
      warnings.push({ item, declared });
    } else {
      problems.push({ item, actual, declared, kind: 'mismatch' });
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
      + `Run without --dry-run to update data/collections.js.`);
    process.exitCode = 1;
    return;
  }

  if (!problems.length) {
    console.log(`No changes needed (${checked} declarations verified).`);
    return;
  }
  let text = readFileSync(COLLECTIONS_PATH, 'utf8');
  for (const p of problems) {
    text = rewriteEntry(text, p.item.input, p.actual);
    const verb = p.kind === 'missing' ? 'added' : 'updated';
    console.log(`${verb}: ${label(p.item)} -> [${p.actual.join(', ')}]`);
  }
  writeFileSync(COLLECTIONS_PATH, text);
  console.log(`\nFixed ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} in data/collections.js.`);
};

runAsCli(import.meta.url, main);
