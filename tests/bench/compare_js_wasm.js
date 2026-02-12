#!/usr/bin/env node
// ============================================================================
// JS ↔ WASM Solver Comparison Harness
//
// Runs killer sudoku puzzles through both the JS SimpleSolver and the Rust
// WASM solver, reporting wall-clock time, backtracks, guesses, values-tried,
// and constraints-processed side-by-side. Flags backtrack divergence.
//
// Usage:
//   node tests/bench/compare_js_wasm.js [--iterations N] [--json]
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
// 2. Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let ITERATIONS = 5;
let JSON_OUTPUT = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--iterations' && args[i + 1]) {
    ITERATIONS = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--json') {
    JSON_OUTPUT = true;
  }
}

// ---------------------------------------------------------------------------
// 3. Import JS solver
// ---------------------------------------------------------------------------
const { SimpleSolver } = await import('../../js/sandbox/simple_solver.js');

// ---------------------------------------------------------------------------
// 4. Import and initialize WASM solver (fs.readFile shim for Node.js)
// ---------------------------------------------------------------------------
const wasmPkgPath = new URL(
  '../../solver-wasm/pkg/solver_wasm.js',
  import.meta.url,
);
const wasmModule = await import(wasmPkgPath.href);
const initWasm = wasmModule.default;
const { solve_sudoku, solve_sudoku_with_cages } = wasmModule;

const wasmBinaryPath = new URL(
  '../../solver-wasm/pkg/solver_wasm_bg.wasm',
  import.meta.url,
);
const wasmBytes = await readFile(wasmBinaryPath);
await initWasm({ module_or_path: wasmBytes });

// ---------------------------------------------------------------------------
// 5. Import constraint parser + builder for extracting cages
// ---------------------------------------------------------------------------
const { SudokuParser } = await import(
  '../../js/sudoku_parser.js'
);
const { SudokuBuilder } = await import(
  '../../js/solver/sudoku_builder.js'
);

// ---------------------------------------------------------------------------
// 6. Helper: extract givens + cages from a constraint string
// ---------------------------------------------------------------------------
function constraintToWasmInput(constraintStr) {
  const constraint = SudokuParser.parseText(constraintStr);
  const resolved = SudokuBuilder.resolveConstraint(constraint);
  const shape = resolved.getShape();

  // Extract givens
  const puzzle = new Array(shape.numCells).fill('.');
  const walkGivens = (c) => {
    if (c.type === 'Given') {
      const cellIndex = shape.parseCellId(c.cell).cell;
      if (c.values.length === 1) {
        puzzle[cellIndex] = String(c.values[0]);
      }
    }
    if (c.constraints) {
      for (const child of c.constraints) walkGivens(child);
    }
  };
  walkGivens(resolved);

  // Extract cages
  const cages = [];
  const walkCages = (c) => {
    if (c.type === 'Cage' && c.sum !== 0) {
      const cells = c.cells.map(cellId => shape.parseCellId(cellId).cell);
      cages.push({ cells, sum: c.sum });
    }
    if (c.constraints) {
      for (const child of c.constraints) walkCages(child);
    }
  };
  walkCages(resolved);

  return { puzzle: puzzle.join(''), cages };
}

// ---------------------------------------------------------------------------
// 7. Puzzle suite
// ---------------------------------------------------------------------------
const PUZZLES = [
  {
    name: 'Classic easy (Wikipedia)',
    input: '.~R1C1_5~R1C2_3~R1C5_7~R2C1_6~R2C4_1~R2C5_9~R2C6_5~R3C2_9~R3C3_8~R3C8_6~R4C1_8~R4C5_6~R4C9_3~R5C1_4~R5C4_8~R5C6_3~R5C9_1~R6C1_7~R6C5_2~R6C9_6~R7C2_6~R7C7_2~R7C8_8~R8C4_4~R8C5_1~R8C6_9~R8C9_5~R9C5_8~R9C8_7~R9C9_9',
    expected: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
  },
  {
    name: 'Killer (Wikipedia)',
    input: '.Cage~3~R1C1~R1C2.Cage~15~R1C3~R1C4~R1C5.Cage~25~R2C1~R2C2~R3C1~R3C2.Cage~17~R2C3~R2C4.Cage~9~R3C3~R3C4~R4C4.Cage~22~R1C6~R2C5~R2C6~R3C5.Cage~4~R1C7~R2C7.Cage~16~R1C8~R2C8.Cage~15~R1C9~R2C9~R3C9~R4C9.Cage~20~R3C7~R3C8~R4C7.Cage~8~R3C6~R4C6~R5C6.Cage~17~R4C5~R5C5~R6C5.Cage~20~R5C4~R6C4~R7C4.Cage~14~R4C2~R4C3.Cage~6~R4C1~R5C1.Cage~13~R5C2~R5C3~R6C2.Cage~6~R6C3~R7C2~R7C3.Cage~17~R4C8~R5C7~R5C8.Cage~27~R6C1~R7C1~R8C1~R9C1.Cage~8~R8C2~R9C2.Cage~16~R8C3~R9C3.Cage~10~R7C5~R8C4~R8C5~R9C4.Cage~12~R5C9~R6C9.Cage~6~R6C7~R6C8.Cage~20~R6C6~R7C6~R7C7.Cage~15~R8C6~R8C7.Cage~14~R7C8~R7C9~R8C8~R8C9.Cage~13~R9C5~R9C6~R9C7.Cage~17~R9C8~R9C9',
    expected: '215647398368952174794381652586274931142593867973816425821739546659428713437165289',
  },
  {
    name: 'Killer hard (flowers)',
    input: 'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<',
    expected: '283197546967542813415368729591726384876439152324851967149275638752683491638914275',
  },
];

// ---------------------------------------------------------------------------
// 8. Benchmark runner
// ---------------------------------------------------------------------------

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(Math.floor(s.length * 0.95), s.length - 1)];
}

function runJS(constraintStr, iterations) {
  const solver = new SimpleSolver();
  const times = [];
  let lastStats = null;
  let solution = null;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const sol = solver.solution(constraintStr);
    const elapsed = performance.now() - start;
    times.push(elapsed);
    lastStats = solver.latestStats();
    if (sol) solution = sol.toString();
  }

  return {
    solution,
    medianMs: median(times),
    p95Ms: p95(times),
    counters: lastStats ? {
      backtracks: lastStats.backtracks,
      guesses: lastStats.guesses,
      valuesTried: lastStats.valuesTried,
      constraintsProcessed: lastStats.constraintsProcessed,
      solutions: lastStats.solutions,
    } : null,
  };
}

function runWASM(constraintStr, iterations) {
  const wasmInput = constraintToWasmInput(constraintStr);
  const inputJson = JSON.stringify(wasmInput);
  const times = [];
  let lastCounters = null;
  let solution = null;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    let resultJson;
    if (wasmInput.cages.length > 0) {
      resultJson = solve_sudoku_with_cages(inputJson);
    } else {
      resultJson = solve_sudoku(inputJson);
    }
    const elapsed = performance.now() - start;
    times.push(elapsed);

    const result = JSON.parse(resultJson);
    if (result.success) solution = result.solution;
    lastCounters = result.counters;
  }

  return {
    solution,
    medianMs: median(times),
    p95Ms: p95(times),
    counters: lastCounters ? {
      backtracks: lastCounters.backtracks,
      guesses: lastCounters.guesses,
      valuesTried: lastCounters.valuesTried,
      constraintsProcessed: lastCounters.constraintsProcessed,
      solutions: lastCounters.solutions,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// 9. Main
// ---------------------------------------------------------------------------

const results = [];

console.log(`\nJS ↔ WASM Solver Comparison (${ITERATIONS} iterations each)\n`);
console.log('='.repeat(100));
console.log(
  'Puzzle'.padEnd(28),
  'JS med'.padStart(9),
  'WASM med'.padStart(9),
  'Ratio'.padStart(7),
  'JS bt'.padStart(8),
  'WASM bt'.padStart(8),
  'JS gss'.padStart(8),
  'WASM gss'.padStart(8),
  'Parity'.padStart(8),
);
console.log('-'.repeat(100));

let allPassed = true;

for (const puzzle of PUZZLES) {
  const js = runJS(puzzle.input, ITERATIONS);
  const wasm = runWASM(puzzle.input, ITERATIONS);

  const ratio = wasm.medianMs / Math.max(js.medianMs, 0.001);
  const jsBt = js.counters?.backtracks ?? 0;
  const wasmBt = wasm.counters?.backtracks ?? 0;
  let btParity;
  if (jsBt === wasmBt) {
    btParity = '✓';
  } else if (wasmBt < jsBt) {
    // WASM is more efficient — acceptable divergence.
    btParity = '✓ fewer';
  } else {
    // WASM has MORE backtracks — potential logic issue.
    btParity = '✗ MORE';
    allPassed = false;
  }

  // Verify solutions match
  let solMatch = true;
  if (js.solution && wasm.solution && js.solution !== wasm.solution) {
    solMatch = false;
    allPassed = false;
  }
  if (puzzle.expected) {
    if (js.solution !== puzzle.expected) {
      console.error(`  ✗ JS solution mismatch for "${puzzle.name}"`);
      console.error(`    Expected: ${puzzle.expected}`);
      console.error(`    Got:      ${js.solution}`);
      solMatch = false;
      allPassed = false;
    }
    if (wasm.solution !== puzzle.expected) {
      console.error(`  ✗ WASM solution mismatch for "${puzzle.name}"`);
      console.error(`    Expected: ${puzzle.expected}`);
      console.error(`    Got:      ${wasm.solution}`);
      solMatch = false;
      allPassed = false;
    }
  }

  const fmtMs = (v) => v < 1 ? v.toFixed(3) + 'ms' : v.toFixed(1) + 'ms';

  console.log(
    puzzle.name.padEnd(28),
    fmtMs(js.medianMs).padStart(9),
    fmtMs(wasm.medianMs).padStart(9),
    (ratio.toFixed(2) + '×').padStart(7),
    String(js.counters?.backtracks ?? '-').padStart(8),
    String(wasm.counters?.backtracks ?? '-').padStart(8),
    String(js.counters?.guesses ?? '-').padStart(8),
    String(wasm.counters?.guesses ?? '-').padStart(8),
    btParity.padStart(8),
  );

  results.push({
    name: puzzle.name,
    js: { medianMs: js.medianMs, p95Ms: js.p95Ms, counters: js.counters },
    wasm: { medianMs: wasm.medianMs, p95Ms: wasm.p95Ms, counters: wasm.counters },
    ratio,
    backtracksMatch: btParity.startsWith('✓'),
    solutionsMatch: solMatch,
  });
}

console.log('-'.repeat(100));

// Print detailed counter comparison
console.log('\nDetailed Counter Comparison:');
console.log('='.repeat(80));
for (const r of results) {
  console.log(`\n  ${r.name}:`);
  const fields = ['backtracks', 'guesses', 'valuesTried', 'constraintsProcessed', 'solutions'];
  for (const f of fields) {
    const jsVal = r.js.counters?.[f] ?? '-';
    const wasmVal = r.wasm.counters?.[f] ?? '-';
    const match = jsVal === wasmVal ? '' : '  ← DIFFERENT';
    console.log(`    ${f.padEnd(25)} JS: ${String(jsVal).padStart(10)}   WASM: ${String(wasmVal).padStart(10)}${match}`);
  }
  console.log(`    ${'medianMs'.padEnd(25)} JS: ${r.js.medianMs.toFixed(3).padStart(10)}   WASM: ${r.wasm.medianMs.toFixed(3).padStart(10)}`);
  console.log(`    ${'p95Ms'.padEnd(25)} JS: ${r.js.p95Ms.toFixed(3).padStart(10)}   WASM: ${r.wasm.p95Ms.toFixed(3).padStart(10)}`);
}

console.log('\n' + '='.repeat(80));

// Performance parity check
const ratios = results.map(r => r.ratio);
const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
console.log(`\nAverage WASM/JS ratio: ${avgRatio.toFixed(3)}×`);
if (avgRatio > 1.1) {
  console.log('⚠  WASM is >10% slower than JS on average — investigate.');
} else if (avgRatio < 0.8) {
  console.log('✓  WASM is significantly faster than JS.');
} else {
  console.log('✓  Performance is within parity range (0.8×–1.1×).');
}

if (!allPassed) {
  console.log('\n✗  Some checks FAILED (see above).');
  process.exitCode = 1;
} else {
  console.log('\n✓  All solution and backtrack parity checks passed.');
}

// JSON output
if (JSON_OUTPUT) {
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(results, null, 2));
}
