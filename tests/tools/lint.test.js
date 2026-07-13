// Tests for the authoring lint tools (tools/dev/lint_*.js).
//
// The lint tools are guidance heuristics; these cases pin the rules most prone
// to false positives (name-based helper detection, adjacency-gated
// native-relation suggestions, per-key-group replacement) alongside one true
// positive each.
//
// The tools' CLI mains read their input from a file path, but the actual lint
// logic is pure: lintSource(source) for script source, lintConstraintText(text)
// for serialized constraints. We exercise those directly, so there is no temp
// file per case — just a string in, guidance items out. The --script path
// (run a sandbox script, lint its generated constraints) is reproduced by
// composing runSandboxToConstraint with lintConstraintText, exactly as the CLI
// main does internally.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import {
  main as lintScriptMain, lintSource, SOURCE_RULES,
} from '../../tools/dev/lint_sandbox_script.js';
import {
  main as lintConstraintsMain, lintConstraintText, OUTPUT_RULES,
} from '../../tools/dev/lint_constraints.js';
import { TIERS } from '../../tools/lib/lint_cli.js';
import { runSandboxToConstraint } from '../../tools/lib/sandbox_runner.js';

// Run a tool's CLI main in-process: capture stdout and the exit code it sets,
// without letting that exit code escape into this suite's own result.
const runCli = async (main, argv) => {
  const out = [];
  const { log } = console;
  const priorExitCode = process.exitCode;
  console.log = (...a) => out.push(a.join(' '));
  try {
    await main(['node', 'tool', ...argv]);
  } finally {
    console.log = log;
  }
  const exitCode = process.exitCode ?? 0;
  process.exitCode = priorExitCode;
  return { stdout: out.join('\n'), exitCode };
};

// A temp directory with the given files, removed afterwards.
const withFiles = async (files, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-cli-'));
  const paths = {};
  for (const [name, content] of Object.entries(files)) {
    paths[name] = join(dir, name);
    writeFileSync(paths[name], content);
  }
  try {
    return await fn(paths, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Guidance items as one string, "code: message" per line, so a single
// assert.match can span a code and its message text (as the CLI output did).
const report = (items) => items.map((i) => `${i.code}: ${i.message}`).join('\n');

// Lint a sandbox script by generating its constraints, mirroring
// `lint_constraints.js --script`.
const lintScript = async (source) => lintConstraintText(await runSandboxToConstraint(source));

const SCRIPT_HEADER = `// Title: t\n// Author: a\n// Video: v\n// Source: s\n// Rules prose.\n`;

await runTest('lint_sandbox_script passes idiomatic helpers', () => {
  // "Marking" contains "king"; a graph.step alias contains "neighbour" —
  // neither is a custom helper.
  const items = lintSource(SCRIPT_HEADER
    + 'function wolfAwareMarking(cells) { return cells; }\n'
    + 'const leftNeighbour = graph.step(cell, 0, -1);\n'
    + "return [new Shape('6x6'), new Given('R1C1', 3)];\n");
  assert.equal(items.length, 0, report(items));
});

await runTest('lint_sandbox_script flags numValues/Shape mismatch and id templates', () => {
  const items = lintSource(SCRIPT_HEADER
    + 'const key = Pair.fnToKey((a, b) => a < b, 9);\n'
    + 'const cells = [1, 2, 3].map(r => `R${r}C1`);\n'
    + "return [new Shape('6x6'), new Pair(key, 'x', ...cells)];\n");
  assert.match(report(items), /num-values-mismatch/);
  assert.match(report(items), /manual-cell-id-template/);
});

await runTest('lint_sandbox_script flags idioms superseded by houses/Var APIs', () => {
  const items = lintSource(SCRIPT_HEADER
    + 'const wolf = b => `VW${b}`;\n'
    + 'const cells = graph.row(makeCellId(4, 1));\n'
    + 'const origins = [1, 4, 7];\n'
    + "return [new Shape('9x9')];\n");
  assert.match(report(items), /manual-var-id-template/);
  assert.match(report(items), /manual-house-lookup/);
  assert.match(report(items), /manual-box-arithmetic/);
});

await runTest('lint_sandbox_script flags outside-clue fromCells with a literal cell list', () => {
  const flagged = lintSource(SCRIPT_HEADER
    + "return [new Shape('9x9'),\n"
    + "  LittleKiller.fromCells(15, ['R1C4', 'R2C3', 'R3C2'], cellGeometry('9x9'))];\n");
  assert.match(report(flagged), /outside-clue-literal-cells/);

  // Deriving the cells from a graph helper is the idiomatic form, not flagged.
  const clean = lintSource(SCRIPT_HEADER
    + "const g = cellGraph('9x9');\n"
    + "return [new Shape('9x9'),\n"
    + "  LittleKiller.fromCells(15, g.ray('R1C4', 1, -1), cellGeometry('9x9'))];\n");
  assert.doesNotMatch(report(clean), /outside-clue-literal-cells/);
});

await runTest('lint_sandbox_script flags outside clues built by arrow id', () => {
  const flagged = lintSource(SCRIPT_HEADER
    + "return [new Shape('9x9'), new LittleKiller('R1C1', 30)];\n");
  assert.match(report(flagged), /outside-clue-by-arrow-id/);

  // The fromCells factory itself must not be flagged.
  const clean = lintSource(SCRIPT_HEADER
    + "return [new Shape('9x9'),\n"
    + "  LittleKiller.fromCells(30, ['R1C1', 'R2C2'], cellGeometry('9x9'))];\n");
  assert.doesNotMatch(report(clean), /outside-clue-by-arrow-id/);
});

await runTest('lint_constraints suggests native constraints per key group', () => {
  // The native suggestion fires only when EVERY Pair sharing the key is a
  // 2-cell adjacent pair — a partial replacement would split one drawn rule
  // into two constraint types.
  const consecutiveKey = 'CoAKgCoAKgCoAC';
  const allAdjacent = lintConstraintText(
    `.Pair~${consecutiveKey}~_a~R1C1~R1C2\n`
    + `.Pair~${consecutiveKey}~_b~R4C4~R5C4\n`
    + '.Sum~0_=_1_1_-1~R5C1~R5C2~R6C1\n');
  assert.match(report(allAdjacent), /pair-native-relation.*2 Pair constraints re-encode WhiteDot/);
  assert.match(report(allAdjacent), /sum-equal-sum/);

  const mixedGroup = lintConstraintText(
    `.Pair~${consecutiveKey}~_a~R1C1~R1C2\n`
    + `.Pair~${consecutiveKey}~_b~R1C1~R3C3\n`);
  assert.doesNotMatch(report(mixedGroup), /pair-native-relation/);
});

await runTest('lint_constraints --script runs inputs through the sandbox', async () => {
  const items = await lintScript(
    "return [new Shape('9x9'), new Sum('0_=_1_1_-1', 'R5C1', 'R5C2', 'R6C1')];\n");
  assert.match(report(items), /sum-equal-sum/);
});

await runTest('lint_constraints suggests EqualSum only for a whole coefficient family', () => {
  // EqualSum needs a target of 0, but the target varies *within* one authored
  // rule: the same linear expression stamped over different cells. Converting
  // only the members that happen to balance would split one rule across two
  // constraint types, so the whole family must qualify.
  const mixedFamily = lintConstraintText(
    '.Sum~0_=_1_1_-1_-1~R1C1~R1C2~R2C1~R2C2\n'
    + '.Sum~-3_=_1_1_-1_-1~R3C1~R3C2~R4C1~R4C2\n');
  assert.doesNotMatch(report(mixedFamily), /sum-equal-sum/);

  // Every member of the family balances, so the rule applies to all of them.
  const wholeFamily = lintConstraintText(
    '.Sum~0_=_1_1_-1_-1~R1C1~R1C2~R2C1~R2C2\n'
    + '.Sum~0_=_1_1_-1_-1~R3C1~R3C2~R4C1~R4C2\n');
  assert.match(report(wholeFamily), /sum-equal-sum.*2 coefficient Sums/);
});

await runTest('lint_constraints flags redundant houses', () => {
  const items = lintConstraintText(
    '.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n');
  assert.match(report(items), /redundant-all-different.*row 1/);
});

await runTest('lint_constraints flags Pairs that re-encode SameValues / AllDifferent', async () => {
  const items = await lintScript(
    "return [new Shape('9x9'),\n"
    + "  new Pair(Pair.fnToKey((a, b) => a === b, 9), 'eq', 'R4C1', 'R4C2'),\n"
    + "  new Pair(Pair.fnToKey((a, b) => a !== b, 9), 'ne', 'R5C1', 'R5C5')];\n");
  assert.match(report(items), /pair-same-values/);
  assert.match(report(items), /pair-all-different/);
});

await runTest('lint_constraints flags a 2-cell NFA as a Pair, but not a wider one', async () => {
  const spec = '{ startState: 0, transition: (s) => s >= 2 ? undefined : s + 1, accept: (s) => s === 2 }';
  const twoCell = await lintScript(
    `return [new Shape('9x9'),\n`
    + `  new NFA(NFA.encodeSpec(${spec}, 9), 'm', 'R1C1', 'R1C2')];\n`);
  assert.match(report(twoCell), /nfa-two-cell-use-pair/);

  const spec3 = '{ startState: 0, transition: (s) => s >= 3 ? undefined : s + 1, accept: (s) => s === 3 }';
  const threeCell = await lintScript(
    `return [new Shape('9x9'),\n`
    + `  new NFA(NFA.encodeSpec(${spec3}, 9), 'm', 'R1C1', 'R1C2', 'R1C3')];\n`);
  assert.doesNotMatch(report(threeCell), /nfa-two-cell-use-pair/);
});

await runTest('lint_constraints flags many identical Givens, but not conditional ones', async () => {
  // 55 identical range-restriction Givens on an extended Shape: a Replicate
  // candidate even though they serialize onto one line. The template is the
  // single cell, so they are shifted copies by construction.
  const gs = 'const gs = Array.from({ length: 55 }, (_, i) =>\n'
    + '  new Given(makeCellId(i % 9 + 1, Math.floor(i / 9) + 1), 1, 2));\n';
  const flagged = await lintScript(gs + "return [new Shape('9x9', 10), ...gs];\n");
  assert.match(report(flagged), /stamped-copies-without-replicate.*Given constraints share one value set/);

  // The same Givens inside an Or are conditional hypotheses, not repeated facts.
  const conditional = await lintScript(gs + "return [new Shape('9x9', 10), new Or(gs)];\n");
  assert.doesNotMatch(report(conditional), /stamped-copies-without-replicate/);
});

// The recommended way to write a group domain is to stamp it over the WHOLE cell
// group and let the clue Givens narrow it, rather than filtering the clue cells
// out of the domain. That is a source-level style point and is deliberately NOT
// linted here: Given's UNIQUENESS_KEY_FIELD is 'cell', so the clue replaces the
// domain's entry for its cell and BOTH spellings emit the identical constraint
// set. This test pins that equivalence, so no one re-adds an undecidable rule.
await runTest('a group domain and its filtered spelling emit identical constraints', async () => {
  const stamped = await runSandboxToConstraint(
    "return [new Shape('4x4'),\n"
    + "  ...cellGraph('4x4').cells().map(c => new Given(c, 1, 2, 3)),\n"
    + "  new Given('R1C1', 2)];\n");
  const filtered = await runSandboxToConstraint(
    "const cells = cellGraph('4x4').cells();\n"
    + "return [new Shape('4x4'),\n"
    + "  ...cells.filter(c => c !== 'R1C1').map(c => new Given(c, 1, 2, 3)),\n"
    + "  new Given('R1C1', 2)];\n");
  const givens = (text) => text.split('.').filter(c => c.startsWith('~'))
    .flatMap(c => c.split('~').slice(1)).sort();
  assert.deepEqual(givens(stamped), givens(filtered));
});

// Replicate stamps ONE template under a shift, within one cell group. Sharing a
// machine is not the same thing: the same machine run over every region of a
// grid has no single template to stamp. The rule has to check the offsets rather
// than hedge "if they are shifted copies".
await runTest('lint_constraints flags stamped NFA copies only when the offsets match', async () => {
  const spec = '{ startState: 0, transition: (s) => s >= 3 ? undefined : s + 1,'
    + ' accept: (s) => s === 3 }';
  // 63 copies of one 3-cell machine, every one with offsets (0,0) (0,1) (0,2).
  const shifted = await lintScript(
    `const nfa = NFA.encodeSpec(${spec}, 9);\n`
    + 'const cs = [];\n'
    + 'for (let r = 1; r <= 9; r++) for (let c = 1; c <= 7; c++)\n'
    + "  cs.push(new NFA(nfa, 'm', makeCellId(r, c), makeCellId(r, c + 1), makeCellId(r, c + 2)));\n"
    + "return [new Shape('9x9'), ...cs];\n");
  assert.match(report(shifted), /stamped-copies-without-replicate.*NFA constraints share one machine/);

  // Same machine, same count, but anchored at column 1 so each instance is a
  // different shape. No single template exists, so Replicate cannot express it.
  const noTemplate = await lintScript(
    `const nfa = NFA.encodeSpec(${spec}, 9);\n`
    + 'const cs = [];\n'
    + 'for (let r = 1; r <= 9; r++) for (let c = 1; c <= 7; c++)\n'
    + "  cs.push(new NFA(nfa, 'm', makeCellId(r, 1), makeCellId(r, c + 1), makeCellId(r, c + 2)));\n"
    + "return [new Shape('9x9'), ...cs];\n");
  assert.doesNotMatch(report(noTemplate), /stamped-copies-without-replicate/);
});

// The cases above test the pure lint logic directly. This one exercises the CLI
// main() end-to-end — arg parsing, reading the file off disk, and the
// `<file>:<line>: guidance <code>: <message>` output format plus the trailing
// count — the glue the pure-function tests bypass.
await runTest('lint_sandbox_script.js main() lints a file and formats output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-cli-'));
  const file = join(dir, 's.js');
  writeFileSync(file, SCRIPT_HEADER + "return [new Shape('9x9'), new LittleKiller('R1C1', 30)];\n");
  const out = [];
  const { log } = console;
  console.log = (...a) => out.push(a.join(' '));
  try {
    await lintScriptMain(['node', 'lint_sandbox_script.js', file]);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
  const stdout = out.join('\n');
  assert.match(stdout, new RegExp(`${file}:\\d+: guidance outside-clue-by-arrow-id:`));
  assert.match(stdout, /1 guidance item found\./);
});

// The accumulator pattern spread from the curated data/scripts/ into ~40% of
// downstream encodings before it was caught, so the lint has to see every shape
// of it -- including the `add()` helper it was most often copied as.
await runTest('lint_sandbox_script flags a mutable constraint accumulator', () => {
  const accumulator = lintSource(SCRIPT_HEADER
    + "const constraints = [new Shape('6x6')];\n"
    + "for (const cell of cells) constraints.push(new Given(cell, 3));\n"
    + 'return constraints;\n');
  assert.match(report(accumulator), /mutable-constraint-accumulator/);

  const addHelper = lintSource(SCRIPT_HEADER
    + "const constraints = [new Shape('6x6')];\n"
    + 'const add = (...items) => constraints.push(...items);\n'
    + "add(new Given('R1C1', 3));\n"
    + 'return constraints;\n');
  assert.match(report(addHelper), /mutable-constraint-accumulator/);

  // Renaming the accumulator must not evade the rule: returning a bare variable
  // is the tell, whatever it is called.
  const renamed = lintSource(SCRIPT_HEADER
    + "const cs = [new Shape('6x6')];\n"
    + 'for (const cell of cells) cs.push(new Given(cell, 3));\n'
    + 'return cs;\n');
  assert.match(report(renamed), /mutable-constraint-accumulator/);
});

await runTest('lint_sandbox_script passes a declaratively-built constraint list', () => {
  // Local accumulation that is not the constraint list -- here, collecting the
  // branches of one Or, and a helper returning its own bare local -- is not the
  // pattern and must not be flagged.
  const items = lintSource(SCRIPT_HEADER
    + 'function windows(values) {\n'
    + '  const out = [];\n'
    + '  for (const v of values) out.push(v);\n'
    + '  return out;\n'
    + '}\n'
    + 'const branches = [];\n'
    + 'for (const v of values) branches.push(new Given(cell, v));\n'
    + 'const givens = cells.map(cell => new Given(cell, 3));\n'
    + "return [new Shape('6x6'), ...givens, new Or(branches)];\n");
  assert.equal(items.length, 0, report(items));

  // A script may also return an expression rather than an array literal.
  const expression = lintSource(SCRIPT_HEADER
    + 'return segments.map(seg => new NFA(nfa, \'\', ...seg));\n');
  assert.equal(expression.length, 0, report(expression));
});

// Both tools run on one CLI shell (tools/lib/lint_cli.js), so this covers what
// the source linter's main() above does not: the error path. A file that cannot
// be linted is not guidance — it prints `error:`, stays out of the guidance
// total, and fails the run even without --fail-on-guidance (an unlintable file
// reporting success is how a broken puzzle used to pass the pipeline's checks).
await runTest('lint_constraints.js main() fails on an unlintable file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-cli-'));
  const broken = join(dir, 'broken.iss');
  const guidance = join(dir, 'guidance.iss');
  writeFileSync(broken, '.Bogus~R1C1\n');
  writeFileSync(guidance,
    '.Shape~9x9\n.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n');
  const out = [];
  const { log } = console;
  const priorExitCode = process.exitCode;
  console.log = (...a) => out.push(a.join(' '));
  try {
    await lintConstraintsMain(['node', 'lint_constraints.js', broken, guidance]);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
  const stdout = out.join('\n');
  assert.match(stdout, new RegExp(`${broken}:1: error: failed to lint constraints:`));
  assert.match(stdout, new RegExp(`${guidance}:\\d+: guidance redundant-all-different:`));
  // The error does not inflate the guidance count (the good file's one item)...
  assert.match(stdout, /1 guidance item found\./);
  // ...but the run still fails, with no --fail-on-guidance passed.
  assert.equal(process.exitCode, 1);
  process.exitCode = priorExitCode;
});

// Cell positions come from resolving the tree through SudokuBuilder, which can
// fail. When it does, the two Replicate rules cannot run — so say so rather than
// print OK with two rules silently disabled. Here 2000 Var cells exceed the
// geometry's cell limit.
await runTest('lint_constraints notes when cell positions are unavailable', () => {
  const degraded = lintConstraintText('.Shape~9x9\n.Var~Q~~2000\n');
  assert.match(report(degraded), /cell-context-unavailable/);

  const resolvable = lintConstraintText('.Shape~9x9\n.Given~R1C1~1\n');
  assert.doesNotMatch(report(resolvable), /cell-context-unavailable/);
});

// `R${r}C${c}` is one problem. It used to match two overlapping rules
// (manual-cell-id-builder and manual-cell-id-template), and their differing
// codes meant dedupe could not merge them: one line, two near-identical
// findings. They are one rule.
await runTest('lint_sandbox_script reports a cell-id template once', () => {
  const items = lintSource(SCRIPT_HEADER
    + 'const cells = rows.map(r => `R${r}C${c}`);\n'
    + "return [new Shape('9x9')];\n");
  assert.deepEqual(items.map((i) => i.code), ['manual-cell-id-template'], report(items));
});

// The registry is the ONLY description of a rule: --list-rules prints it, and
// neither the usage text nor tools/dev/README.md enumerates the rules. A rule
// with no docs is therefore an undocumented rule, so require them here rather
// than pinning a second copy of the prose somewhere it can drift.
await runTest('every rule carries a tier and its own docs', () => {
  for (const rule of [...SOURCE_RULES, ...OUTPUT_RULES]) {
    assert.ok(TIERS.includes(rule.tier), `${rule.code}: bad tier ${rule.tier}`);
    assert.ok(rule.summary && rule.docs, `${rule.code}: missing summary/docs`);
  }
});

// Only the exact tier is safe to gate on, so the gate has to be per-tier: an
// `exact` finding fails the run while a `heuristic` or `info` one does not.
// This is what lets the pipeline gate on the output linter at all.
await runTest('--fail-on=exact gates on the exact tier only', async () => {
  await withFiles({
    // A redundant AllDifferent (exact) and, separately, a tree the builder
    // cannot resolve, which yields only the info-tier coverage note.
    'exact.iss': '.Shape~9x9\n.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n',
    'info.iss': '.Shape~9x9\n.Var~Q~~2000\n',
  }, async ({ 'exact.iss': exact, 'info.iss': info }) => {
    const gated = await runCli(lintConstraintsMain, ['--fail-on=exact', exact]);
    assert.match(gated.stdout, /guidance redundant-all-different:/);
    assert.equal(gated.exitCode, 1);

    // The note is reported, but it is not a finding about the constraints.
    const noted = await runCli(lintConstraintsMain, ['--fail-on=exact', info]);
    assert.match(noted.stdout, /guidance cell-context-unavailable:/);
    assert.equal(noted.exitCode, 0);

    // Every source rule is heuristic, so this tool never trips an exact gate.
    const advisory = await runCli(lintConstraintsMain, ['--fail-on=heuristic', exact]);
    assert.equal(advisory.exitCode, 0);
  });
});

await runTest('--only / --ignore select rules, and reject unknown codes', async () => {
  await withFiles({
    'p.iss': '.Shape~9x9\n.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n',
  }, async ({ 'p.iss': file }) => {
    const ignored = await runCli(lintConstraintsMain, ['--ignore=redundant-all-different', file]);
    assert.match(ignored.stdout, /: OK$/m);

    const only = await runCli(lintConstraintsMain, ['--only=redundant-all-different', file]);
    assert.match(only.stdout, /guidance redundant-all-different:/);

    // A typo'd code must not silently select nothing.
    await assert.rejects(
      () => runCli(lintConstraintsMain, ['--only=redundant-alldifferent', file]),
      /no such rule/);
  });
});

await runTest('--format=json emits the items, errors and tiers', async () => {
  await withFiles({
    'p.iss': '.Shape~9x9\n.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n',
    'broken.iss': '.Bogus~R1C1\n',
  }, async ({ 'p.iss': file, 'broken.iss': broken }) => {
    const { stdout, exitCode } = await runCli(
      lintConstraintsMain, ['--format=json', file, broken]);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.items.map(i => [i.code, i.tier, i.file]),
      [['redundant-all-different', 'exact', file]]);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].file, broken);
    assert.equal(exitCode, 1);
  });
});

// `.iss` files are generated, so they cannot carry inline suppressions. A
// baseline is how a known, accepted set of findings (the corpus triage's
// deferred items) stays silent while a NEW one still fails the run.
await runTest('--baseline suppresses recorded findings but not new ones', async () => {
  const oneRow = '.AllDifferent~R1C1~R1C2~R1C3~R1C4~R1C5~R1C6~R1C7~R1C8~R1C9\n';
  const twoRows = oneRow + '.AllDifferent~R2C1~R2C2~R2C3~R2C4~R2C5~R2C6~R2C7~R2C8~R2C9\n';
  await withFiles({
    'p.iss': `.Shape~9x9\n${oneRow}`,
    'base.json': '',
  }, async ({ 'p.iss': file, 'base.json': base }) => {
    await runCli(lintConstraintsMain, [`--write-baseline=${base}`, file]);
    assert.deepEqual(JSON.parse(readFileSync(base, 'utf8')),
      { [file]: { 'redundant-all-different': 1 } });

    const accepted = await runCli(
      lintConstraintsMain, [`--baseline=${base}`, '--fail-on=exact', file]);
    assert.match(accepted.stdout, /: OK$/m);
    assert.equal(accepted.exitCode, 0);

    // A second redundant AllDifferent is one more than the baseline allows.
    writeFileSync(file, `.Shape~9x9\n${twoRows}`);
    const regressed = await runCli(
      lintConstraintsMain, [`--baseline=${base}`, '--fail-on=exact', file]);
    assert.match(regressed.stdout, /guidance redundant-all-different: .*row 2/);
    assert.match(regressed.stdout, /1 guidance item found \(1 suppressed by baseline\)\./);
    assert.equal(regressed.exitCode, 1);
  });
});

// Source rules read a comment-stripped view, so prose ABOUT an idiom is not the
// idiom. String and template-literal bodies are kept: that is where the idioms
// being hunted (`R${r}C${c}` ids, the `_=_` wire format) actually live.
await runTest('source rules see code, not comments', () => {
  const prose = lintSource('// Title: t\n'
    + '// The box origins are [1, 4, 7], and the Sum wire format is `0_=_1_1`.\n'
    + "return [new Shape('9x9')];\n");
  assert.equal(prose.length, 0, report(prose));

  // The same idioms in code still fire.
  const code = lintSource(SCRIPT_HEADER
    + 'const origins = [1, 4, 7];\n'
    + "const sum = new Sum('0_=_1_1', 'R1C1', 'R1C2');\n"
    + "return [new Shape('9x9'), sum];\n");
  assert.match(report(code), /manual-box-arithmetic/);
  assert.match(report(code), /sum-wire-format/);
});

// An intentional local implementation is documented in the file itself, rather
// than being re-litigated on every run.
await runTest('// lint-ok silences one code on one line', () => {
  const trailing = lintSource(SCRIPT_HEADER
    + 'const origins = [1, 4, 7]; // lint-ok: manual-box-arithmetic\n'
    + 'const others = [1, 4, 7];\n'
    + "return [new Shape('9x9')];\n");
  // The trailing comment excuses its own line, and only its own line.
  assert.deepEqual(trailing.map(i => i.line), [7], report(trailing));

  const standalone = lintSource(SCRIPT_HEADER
    + '// lint-ok: manual-box-arithmetic\n'
    + 'const origins = [1, 4, 7];\n'
    + "return [new Shape('9x9')];\n");
  assert.equal(standalone.length, 0, report(standalone));

  // It silences the named code, not the line.
  const otherCode = lintSource(SCRIPT_HEADER
    + 'const origins = [1, 4, 7]; // lint-ok: manual-house-lookup\n'
    + "return [new Shape('9x9')];\n");
  assert.match(report(otherCode), /manual-box-arithmetic/);
});

logSuiteComplete('Lint tools');
