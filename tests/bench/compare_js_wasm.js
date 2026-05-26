#!/usr/bin/env node
// ============================================================================
// JS vs WASM Solver Comparison Harness
//
// Runs puzzles through both the JS SimpleSolver and the Rust WASM solver,
// reporting wall-clock time and solver counters side-by-side.
//
// Usage:
//   node tests/bench/compare_js_wasm.js [--iterations N] [--warmups N]
//     [--mode solution|count] [--input PUZZLE] [--name NAME]
//     [--expected SOLUTION] [--expected-count N] [--json]
//
// Prerequisites:
//   wasm-pack build --target web   (in solver-wasm/)
// ============================================================================

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// 1. Global environment setup (required by JS solver modules)
// ---------------------------------------------------------------------------
const g = globalThis;
if (!g.self) g.self = g;
if (typeof g.VERSION_PARAM === 'undefined') g.VERSION_PARAM = '';
if (!g.window) g.window = g;
if (typeof g.document === 'undefined') g.document = {};
if (!g.location) g.location = { search: '' };
if (typeof g.atob !== 'function') {
  g.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}
if (typeof g.btoa !== 'function') {
  g.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
}
if (!g.performance) g.performance = performance;

// ---------------------------------------------------------------------------
// 2. CLI args
// ---------------------------------------------------------------------------
const DEFAULT_OPTIONS = Object.freeze({
  iterations: 5,
  warmups: 0,
  mode: 'solution',
  json: false,
  input: null,
  name: 'Custom puzzle',
  expected: null,
  expectedCount: null,
});

function printUsage() {
  console.log('Usage: node tests/bench/compare_js_wasm.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --iterations N       Measured iterations (default: 5)');
  console.log('  --warmups N          Untimed warmup iterations (default: 0)');
  console.log('  --mode MODE          solution or count (default: solution)');
  console.log('  --input PUZZLE       Run a single custom constraint string');
  console.log('  --name NAME          Name for --input puzzle');
  console.log('  --expected SOLUTION  Expected solution for solution mode');
  console.log('  --expected-count N   Expected solution count for count mode');
  console.log('  --json               Emit full results as JSON after the table');
}

function parseNonNegativeInteger(flag, value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0 || String(n) !== String(value)) {
    console.error(`Error: ${flag} must be a non-negative integer`);
    process.exit(1);
  }
  return n;
}

function parsePositiveInteger(flag, value) {
  const n = parseNonNegativeInteger(flag, value);
  if (n === 0) {
    console.error(`Error: ${flag} must be greater than zero`);
    process.exit(1);
  }
  return n;
}

function requireValue(args, index, flag) {
  if (index + 1 >= args.length) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return args[index + 1];
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = () => inlineValue ?? requireValue(args, i++, flag);

    switch (flag) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      case '--iterations':
        options.iterations = parsePositiveInteger(flag, value());
        break;
      case '--warmups':
        options.warmups = parseNonNegativeInteger(flag, value());
        break;
      case '--mode': {
        const mode = value();
        if (mode !== 'solution' && mode !== 'solve' && mode !== 'first' &&
          mode !== 'count' && mode !== 'count-solutions' && mode !== 'proof') {
          console.error(`Error: unknown mode: ${mode}`);
          process.exit(1);
        }
        options.mode = (mode === 'count' || mode === 'count-solutions' || mode === 'proof')
          ? 'count'
          : 'solution';
        break;
      }
      case '--input':
      case '--puzzle':
        options.input = value();
        break;
      case '--name':
        options.name = value();
        break;
      case '--expected':
        options.expected = value();
        break;
      case '--expected-count':
        options.expectedCount = parseNonNegativeInteger(flag, value());
        break;
      case '--json':
        options.json = true;
        break;
      default:
        console.error(`Error: unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

const OPTIONS = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// 3. Imports
// ---------------------------------------------------------------------------
const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js');
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');

const wasmPkgPath = new URL(
  '../../solver-wasm/pkg/solver_wasm.js',
  import.meta.url,
);
const wasmModule = await import(wasmPkgPath.href);
const initWasm = wasmModule.default;
const {
  init_solver,
  count_solutions_with_progress,
  nth_solution_with_progress,
} = wasmModule;

const wasmBinaryPath = new URL(
  '../../solver-wasm/pkg/solver_wasm_bg.wasm',
  import.meta.url,
);
const wasmBytes = await readFile(wasmBinaryPath);
await initWasm({ module_or_path: wasmBytes });

// ---------------------------------------------------------------------------
// 4. Puzzle suite
// ---------------------------------------------------------------------------
const DEFAULT_PUZZLES = Object.freeze([
  {
    name: 'Classic easy (Wikipedia)',
    input: '.~R1C1_5~R1C2_3~R1C5_7~R2C1_6~R2C4_1~R2C5_9~R2C6_5~R3C2_9~R3C3_8~R3C8_6~R4C1_8~R4C5_6~R4C9_3~R5C1_4~R5C4_8~R5C6_3~R5C9_1~R6C1_7~R6C5_2~R6C9_6~R7C2_6~R7C7_2~R7C8_8~R8C4_4~R8C5_1~R8C6_9~R8C9_5~R9C5_8~R9C8_7~R9C9_9',
    expected: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
    expectedCount: 1,
  },
  {
    name: 'Killer (Wikipedia)',
    input: '.Cage~3~R1C1~R1C2.Cage~15~R1C3~R1C4~R1C5.Cage~25~R2C1~R2C2~R3C1~R3C2.Cage~17~R2C3~R2C4.Cage~9~R3C3~R3C4~R4C4.Cage~22~R1C6~R2C5~R2C6~R3C5.Cage~4~R1C7~R2C7.Cage~16~R1C8~R2C8.Cage~15~R1C9~R2C9~R3C9~R4C9.Cage~20~R3C7~R3C8~R4C7.Cage~8~R3C6~R4C6~R5C6.Cage~17~R4C5~R5C5~R6C5.Cage~20~R5C4~R6C4~R7C4.Cage~14~R4C2~R4C3.Cage~6~R4C1~R5C1.Cage~13~R5C2~R5C3~R6C2.Cage~6~R6C3~R7C2~R7C3.Cage~17~R4C8~R5C7~R5C8.Cage~27~R6C1~R7C1~R8C1~R9C1.Cage~8~R8C2~R9C2.Cage~16~R8C3~R9C3.Cage~10~R7C5~R8C4~R8C5~R9C4.Cage~12~R5C9~R6C9.Cage~6~R6C7~R6C8.Cage~20~R6C6~R7C6~R7C7.Cage~15~R8C6~R8C7.Cage~14~R7C8~R7C9~R8C8~R8C9.Cage~13~R9C5~R9C6~R9C7.Cage~17~R9C8~R9C9',
    expected: '215647398368952174794381652586274931142593867973816425821739546659428713437165289',
    expectedCount: 1,
  },
  {
    name: 'Killer hard (flowers)',
    input: 'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<',
    expected: '283197546967542813415368729591726384876439152324851967149275638752683491638914275',
    expectedCount: 1,
  },
]);

const PUZZLES = OPTIONS.input
  ? [{
    name: OPTIONS.name,
    input: OPTIONS.input,
    expected: OPTIONS.expected,
    expectedCount: OPTIONS.expectedCount,
  }]
  : DEFAULT_PUZZLES;

// ---------------------------------------------------------------------------
// 5. Benchmark runner
// ---------------------------------------------------------------------------
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)];
  return {
    min: sorted[0],
    median,
    mean: sum / values.length,
    p95,
    max: sorted[sorted.length - 1],
  };
}

function toJsCounters(stats) {
  if (!stats) return null;
  return {
    solutions: stats.solutions,
    backtracks: stats.backtracks,
    guesses: stats.guesses,
    valuesTried: stats.valuesTried,
    constraintsProcessed: stats.constraintsProcessed,
    nodesSearched: stats.nodesSearched,
    branchesIgnored: stats.branchesIgnored,
  };
}

function toWasmCounters(counters) {
  if (!counters) return null;
  return {
    solutions: counters.solutions,
    backtracks: counters.backtracks,
    guesses: counters.guesses,
    valuesTried: counters.valuesTried,
    constraintsProcessed: counters.constraintsProcessed,
    nodesSearched: counters.nodesSearched,
    branchesIgnored: counters.branchesIgnored,
  };
}

function makeWasmInputJson(constraintStr) {
  const constraint = SudokuParser.parseText(constraintStr);
  const resolved = SudokuBuilder.resolveConstraint(constraint);
  return JSON.stringify({ constraintString: resolved.toString() });
}

function runJSOnce(constraintStr, mode) {
  const solver = new SimpleSolver();
  if (mode === 'count') {
    const count = solver.countSolutions(constraintStr);
    return { result: { count }, counters: toJsCounters(solver.latestStats()) };
  }

  const solution = solver.solution(constraintStr)?.toString() ?? null;
  return { result: { solution }, counters: toJsCounters(solver.latestStats()) };
}

function runWasmOnce(constraintStr, mode) {
  const inputJson = makeWasmInputJson(constraintStr);
  const buildError = init_solver(inputJson, 0);
  if (buildError) throw new Error(buildError);

  const noop = () => { };
  if (mode === 'count') {
    const result = JSON.parse(count_solutions_with_progress(noop, 0));
    if (result.error) throw new Error(result.error);
    return { result: { count: result.count }, counters: toWasmCounters(result.counters) };
  }

  const result = JSON.parse(nth_solution_with_progress(0, noop));
  if (result.error) throw new Error(result.error);
  return {
    result: { solution: result.success ? result.solution : null },
    counters: toWasmCounters(result.counters),
  };
}

function runMeasured(fn, constraintStr, mode, options) {
  for (let i = 0; i < options.warmups; i++) fn(constraintStr, mode);

  const times = [];
  let last = null;
  for (let i = 0; i < options.iterations; i++) {
    const start = performance.now();
    last = fn(constraintStr, mode);
    times.push(performance.now() - start);
  }

  const summary = summarize(times);
  return {
    ...last,
    summary,
    medianMs: summary.median,
    p95Ms: summary.p95,
  };
}

function resultMatchesExpected(puzzle, result, mode) {
  if (mode === 'count') {
    return puzzle.expectedCount == null || result.count === puzzle.expectedCount;
  }
  return !puzzle.expected || result.solution === puzzle.expected;
}

function resultMatchesOther(left, right, mode) {
  return mode === 'count'
    ? left.count === right.count
    : left.solution === right.solution;
}

function counterValue(run, field) {
  return run.counters?.[field] ?? 0;
}

function backtrackParity(js, wasm) {
  const jsBt = counterValue(js, 'backtracks');
  const wasmBt = counterValue(wasm, 'backtracks');
  if (jsBt === wasmBt) return 'match';
  if (wasmBt < jsBt) return 'fewer';
  return 'MORE';
}

function fmtMs(value) {
  return value < 1 ? `${value.toFixed(3)}ms` : `${value.toFixed(1)}ms`;
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------
const results = [];
let allPassed = true;

console.log(`\nJS vs WASM Solver Comparison (${OPTIONS.mode}, ${OPTIONS.iterations} measured iteration(s), ${OPTIONS.warmups} warmup(s))\n`);
console.log('='.repeat(112));
console.log(
  'Puzzle'.padEnd(30),
  'JS med'.padStart(9),
  'WASM med'.padStart(9),
  'Ratio'.padStart(7),
  'JS bt'.padStart(8),
  'WASM bt'.padStart(8),
  'JS gss'.padStart(8),
  'WASM gss'.padStart(8),
  'Parity'.padStart(8),
);
console.log('-'.repeat(112));

for (const puzzle of PUZZLES) {
  const js = runMeasured(runJSOnce, puzzle.input, OPTIONS.mode, OPTIONS);
  const wasm = runMeasured(runWasmOnce, puzzle.input, OPTIONS.mode, OPTIONS);
  const ratio = wasm.summary.median / Math.max(js.summary.median, 0.001);
  const parity = backtrackParity(js, wasm);
  const jsExpectedOk = resultMatchesExpected(puzzle, js.result, OPTIONS.mode);
  const wasmExpectedOk = resultMatchesExpected(puzzle, wasm.result, OPTIONS.mode);
  const resultParityOk = resultMatchesOther(js.result, wasm.result, OPTIONS.mode);

  if (!jsExpectedOk || !wasmExpectedOk || !resultParityOk || parity === 'MORE') {
    allPassed = false;
  }

  console.log(
    puzzle.name.padEnd(30),
    fmtMs(js.summary.median).padStart(9),
    fmtMs(wasm.summary.median).padStart(9),
    `${ratio.toFixed(2)}x`.padStart(7),
    String(counterValue(js, 'backtracks')).padStart(8),
    String(counterValue(wasm, 'backtracks')).padStart(8),
    String(counterValue(js, 'guesses')).padStart(8),
    String(counterValue(wasm, 'guesses')).padStart(8),
    parity.padStart(8),
  );

  results.push({
    name: puzzle.name,
    mode: OPTIONS.mode,
    js,
    wasm,
    ratio,
    backtrackParity: parity,
    resultsMatch: resultParityOk,
    expected: {
      js: jsExpectedOk,
      wasm: wasmExpectedOk,
    },
  });
}

console.log('-'.repeat(112));

console.log('\nDetailed Counter Comparison:');
console.log('='.repeat(80));
for (const r of results) {
  console.log(`\n  ${r.name}:`);
  const fields = [
    'solutions',
    'backtracks',
    'guesses',
    'valuesTried',
    'nodesSearched',
    'constraintsProcessed',
    'branchesIgnored',
  ];
  for (const field of fields) {
    const jsVal = r.js.counters?.[field] ?? '-';
    const wasmVal = r.wasm.counters?.[field] ?? '-';
    const match = jsVal === wasmVal ? '' : '  DIFFERENT';
    console.log(`    ${field.padEnd(25)} JS: ${String(jsVal).padStart(10)}   WASM: ${String(wasmVal).padStart(10)}${match}`);
  }
  console.log(`    ${'medianMs'.padEnd(25)} JS: ${r.js.summary.median.toFixed(3).padStart(10)}   WASM: ${r.wasm.summary.median.toFixed(3).padStart(10)}`);
  console.log(`    ${'meanMs'.padEnd(25)} JS: ${r.js.summary.mean.toFixed(3).padStart(10)}   WASM: ${r.wasm.summary.mean.toFixed(3).padStart(10)}`);
  console.log(`    ${'p95Ms'.padEnd(25)} JS: ${r.js.summary.p95.toFixed(3).padStart(10)}   WASM: ${r.wasm.summary.p95.toFixed(3).padStart(10)}`);
}

console.log('\n' + '='.repeat(80));
const ratios = results.map(r => r.ratio);
const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
console.log(`\nAverage WASM/JS ratio: ${avgRatio.toFixed(3)}x`);

if (!allPassed) {
  console.log('\nSome checks FAILED (see above).');
  process.exitCode = 1;
} else {
  console.log('\nAll result and backtrack checks passed.');
}

if (OPTIONS.json) {
  console.log('\n--- JSON ---');
  console.log(JSON.stringify({ options: OPTIONS, results }, null, 2));
}
