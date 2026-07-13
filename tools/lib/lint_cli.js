// lint_cli.js — the CLI shell shared by the lint tools.
//
// Both linters (tools/dev/lint_sandbox_script.js, tools/dev/lint_constraints.js)
// differ only in what they lint: a rule registry, and a pure
// `lintFile(path, raw, args)` returning guidance items. Everything around that
// -- arg parsing, reading each input, per-file error handling, dedupe/sort,
// rule selection, tiered gating, baselines, the output format, the totals line
// and the exit policy -- is this module, so the two tools cannot drift apart
// and a new flag lands once rather than twice.
//
// The text format is contractual: consumers (the iss-constraints skill, the
// index pipeline's checkers) match `<file>:<line>: guidance <code>: <message>`
// and `<file>:<line>: error: <message>` by regex. `--format=json` is the
// escape hatch for consumers that would rather not.
//
// A rule's metadata, in both registries:
//   { code, tier, summary, docs, ...tool-specific check/collect/finalize }
// Tiers:
//   exact      decided from an exact parse of what was built; no triaged false
//              positives, so this is the only tier safe to gate CI on.
//   heuristic  idiom/pattern guidance; a human decides. Advisory.
//   info       a note that a rule could not run. Never a finding about the code.

import { readFileSync, writeFileSync } from 'node:fs';

export const TIERS = ['exact', 'heuristic', 'info'];

// Guidance items are {line, code, message}. One finding can be reached by more
// than one pattern (or one leaf by more than one rule), so collapse identical
// items and order by line, then code, for a stable report.
export const dedupeGuidance = (items) => {
  const seen = new Set();
  const deduped = items.filter((item) => {
    const key = `${item.line}\0${item.code}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
  return deduped;
};

const VALUE_FLAGS = {
  '--only': 'only',
  '--ignore': 'ignore',
  '--fail-on': 'failOn',
  '--format': 'format',
  '--baseline': 'baseline',
  '--write-baseline': 'writeBaseline',
};

const splitCodes = (value) => value.split(',').map(s => s.trim()).filter(Boolean);

// Common flags, plus each tool's extras as { '--flag': 'argsProperty' }.
const parseArgs = (argv, flags, rules) => {
  const args = {
    files: [], help: false, listRules: false, format: 'text',
    failOnGuidance: false, failOn: null, only: null, ignore: null,
    baseline: null, writeBaseline: null,
  };
  for (const name of Object.values(flags)) args[name] = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const [name, value] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, null];

    if (name === '-h' || name === '--help') args.help = true;
    else if (name === '--list-rules') args.listRules = true;
    else if (name === '--fail-on-guidance') args.failOnGuidance = true;
    else if (flags[name]) args[flags[name]] = true;
    else if (VALUE_FLAGS[name]) {
      // `--flag=value` only: a space-separated value would be ambiguous with a
      // file name, and every one of these flags takes a value.
      if (value === null) throw new Error(`${name} needs a value (${name}=...)`);
      args[VALUE_FLAGS[name]] = value;
    } else if (name.startsWith('-') && name !== '-') {
      throw new Error(`unknown option: ${arg}`);
    } else {
      args.files.push(arg);
    }
  }

  const codes = new Set(rules.map(r => r.code));
  for (const key of ['only', 'ignore']) {
    if (args[key] === null) continue;
    const selected = splitCodes(args[key]);
    for (const code of selected) {
      if (!codes.has(code)) {
        throw new Error(`--${key}: no such rule: ${code} (see --list-rules)`);
      }
    }
    args[key] = new Set(selected);
  }
  if (args.failOn !== null) {
    const tiers = splitCodes(args.failOn);
    for (const tier of tiers) {
      if (!TIERS.includes(tier)) {
        throw new Error(`--fail-on: no such tier: ${tier} (${TIERS.join(', ')})`);
      }
    }
    args.failOn = new Set(tiers);
  }
  if (!['text', 'json'].includes(args.format)) {
    throw new Error(`--format: expected text or json, got: ${args.format}`);
  }
  return args;
};

const printRules = (rules, format) => {
  if (format === 'json') {
    console.log(JSON.stringify(
      rules.map(({ code, tier, summary, docs }) => ({ code, tier, summary, docs })), null, 2));
    return;
  }
  for (const rule of rules) {
    console.log(`${rule.code} [${rule.tier}]`);
    console.log(`  ${rule.summary}`);
    for (const line of rule.docs.split('\n')) console.log(`  ${line}`);
    console.log('');
  }
};

// Expected counts per file per code: findings that are known, accepted, and a
// regression only if they grow. The generated .iss files cannot carry inline
// suppressions, so a baseline is the only way to hold a known set at zero-noise.
const applyBaseline = (file, items, baseline) => {
  const expected = { ...(baseline?.[file] || {}) };
  const kept = [];
  let suppressed = 0;
  for (const item of items) {
    if (expected[item.code] > 0) {
      expected[item.code]--;
      suppressed++;
      continue;
    }
    kept.push(item);
  }
  return { kept, suppressed };
};

// Run one lint tool's main. `lintFile(path, raw, args)` returns guidance items
// (or a promise of them) and throws if the input cannot be linted at all.
export const runLintCli = async ({
  argv, usage, rules, flags = {}, noFilesError, lintFile,
}) => {
  const args = parseArgs(argv, flags, rules);
  if (args.help) { console.log(usage); return; }
  if (args.listRules) { printRules(rules, args.format); return; }
  if (!args.files.length) throw new Error(noFilesError);

  const tierOf = new Map(rules.map(r => [r.code, r.tier]));
  const baseline = args.baseline
    ? JSON.parse(readFileSync(args.baseline, 'utf8'))
    : null;
  const selected = (item) =>
    (!args.only || args.only.has(item.code))
    && !(args.ignore && args.ignore.has(item.code));

  // Text output streams per file, in the order the files were given; JSON and
  // --write-baseline need the whole run, so everything is accumulated too.
  const streaming = args.format === 'text' && !args.writeBaseline;
  const reported = [];
  const errors = [];
  const counts = {};
  let suppressed = 0;

  for (const file of args.files) {
    let items;
    try {
      // '-' reads stdin; only lint_constraints documents it, but the read is
      // the same either way.
      const raw = readFileSync(file === '-' ? 0 : file, 'utf8');
      items = dedupeGuidance(await lintFile(file, raw, args)).filter(selected);
    } catch (e) {
      errors.push({ file, line: 1, message: e.message });
      if (streaming) console.log(`${file}:1: error: ${e.message}`);
      continue;
    }
    counts[file] = {};
    for (const item of items) {
      counts[file][item.code] = (counts[file][item.code] || 0) + 1;
    }
    const { kept, suppressed: hidden } = applyBaseline(file, items, baseline);
    suppressed += hidden;
    for (const item of kept) {
      reported.push({ file, ...item, tier: tierOf.get(item.code) });
      if (streaming) {
        console.log(`${file}:${item.line}: guidance ${item.code}: ${item.message}`);
      }
    }
    if (!kept.length && streaming) console.log(`${file}: OK`);
  }

  if (args.writeBaseline) {
    // Baseline the run as it stands: every file's current counts become the
    // accepted set. Written from the pre-baseline counts, so re-running with
    // --baseline is silent by construction.
    for (const file of Object.keys(counts)) {
      if (!Object.keys(counts[file]).length) delete counts[file];
    }
    writeFileSync(args.writeBaseline, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(
      `Wrote baseline for ${Object.keys(counts).length} file(s) to ${args.writeBaseline}.`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (args.format === 'json') {
    console.log(JSON.stringify({ items: reported, errors, suppressed }, null, 2));
  } else if (reported.length) {
    const suffix = suppressed ? ` (${suppressed} suppressed by baseline)` : '';
    console.log(
      `\n${reported.length} guidance item${reported.length === 1 ? '' : 's'} found${suffix}.`);
  }

  if (reported.length) {
    if (args.failOnGuidance) process.exitCode = 1;
    if (args.failOn && reported.some(item => args.failOn.has(item.tier))) {
      process.exitCode = 1;
    }
  }
  // An unlintable file is a failure, not guidance: it never counts towards the
  // guidance total, and it fails the run whatever the guidance policy is --
  // otherwise a file that could not be parsed at all would report success.
  if (errors.length) process.exitCode = 1;
};
