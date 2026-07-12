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
  // candidate even though they serialize onto one line.
  const gs = 'const gs = Array.from({ length: 55 }, (_, i) =>\n'
    + '  new Given(makeCellId(i % 9 + 1, Math.floor(i / 9) + 1), 1, 2));\n';
  const flagged = await lintScript(gs + "return [new Shape('9x9', 10), ...gs];\n");
  assert.match(report(flagged), /stamped-copies-without-replicate.*Given constraints share one value set/);

  // The same Givens inside an Or are conditional hypotheses, not repeated facts.
  const conditional = await lintScript(gs + "return [new Shape('9x9', 10), new Or(gs)];\n");
  assert.doesNotMatch(report(conditional), /stamped-copies-without-replicate/);
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

logSuiteComplete('Lint tools');
