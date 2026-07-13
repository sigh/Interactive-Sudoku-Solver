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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTest, logSuiteComplete } from '../helpers/test_runner.js';
import { main as lintScriptMain, lintSource } from '../../tools/dev/lint_sandbox_script.js';
import { lintConstraintText } from '../../tools/dev/lint_constraints.js';
import { runSandboxToConstraint } from '../../tools/lib/sandbox_runner.js';

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

logSuiteComplete('Lint tools');
