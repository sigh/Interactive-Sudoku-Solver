#!/usr/bin/env node
// Dump JS solver handler setup for a constraint string.
// Usage: node tests/bench/dump_js_handlers.js '<constraint_string>'

import { performance } from 'node:perf_hooks';

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

const constraintStr = process.argv[2];
if (!constraintStr) {
  console.error('Usage: node dump_js_handlers.js <constraint_string>');
  process.exit(1);
}

// Import JS solver internals
const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');

// Parse constraint
const constraint = SudokuParser.parseText(constraintStr);

// Build solver via SudokuBuilder
const solver = SudokuBuilder.build(constraint);

// Access internal solver's handler accumulator
const internalSolver = solver._internalSolver;
const acc = internalSolver._handlerAccumulator;
const handlers = acc._allHandlers;

console.log('=== JS Handler Dump ===');
console.log(`Total handlers: ${handlers.length}`);
console.log('');

// Dump handler info
console.log('--- Handler List (sorted order) ---');
for (let i = 0; i < handlers.length; i++) {
  const h = handlers[i];
  const name = h.constructor.name;
  const cells = Array.from(h.cells);
  const exclCells = h.exclusionCells ? Array.from(h.exclusionCells()) : [];
  const essential = h.essential !== false; // default true
  const singleton = h.isSingleton === true;
  const priority = h._PRIORITY !== undefined ? h._PRIORITY : (h.constructor._PRIORITY !== undefined ? h.constructor._PRIORITY : '?');

  let tag = '';
  if (singleton) tag += ' [singleton]';
  if (!essential) tag += ' [non-essential]';

  console.log(`  [${i}] ${name} cells=[${cells.join(',')}] exclCells=[${exclCells.join(',')}]${tag}`);
}

// Dump the ordinary handler map (cell -> handler indices)
console.log('');
console.log('--- Ordinary Handler Map (cell -> handler indices) ---');
const ordinaryMap = acc._ordinaryHandlersByEssential[0]; // all handlers
for (let cell = 0; cell < 81; cell++) {
  const indices = ordinaryMap[cell];
  if (indices && indices.length > 0) {
    console.log(`  cell ${cell}: [${Array.from(indices).join(',')}]`);
  }
}

// Dump aux handler map if it exists
console.log('');
console.log('--- Aux Handler Map (cell -> handler indices) ---');
const auxMap = acc._auxHandlers;
if (auxMap) {
  for (let cell = 0; cell < 81; cell++) {
    const indices = auxMap[cell];
    if (indices && indices.length > 0) {
      console.log(`  cell ${cell}: [${Array.from(indices).join(',')}]`);
    }
  }
}

// Dump singleton handler map
console.log('');
console.log('--- Singleton Handler Map (cell -> handler index) ---');
const singletonMap = acc._singletonHandlers;
if (singletonMap) {
  for (let cell = 0; cell < 81; cell++) {
    if (singletonMap[cell] !== undefined && singletonMap[cell] >= 0) {
      console.log(`  cell ${cell}: ${singletonMap[cell]}`);
    }
  }
}

// Now solve and dump counters
console.log('');
console.log('=== Running solver ===');
const result = solver.nthSolution(0);
console.log(`Solution found: ${result !== null}`);
const counters = internalSolver.counters;
console.log(`Counters: backtracks=${counters.backtracks} guesses=${counters.guesses} valuesTried=${counters.valuesTried} constraints=${counters.constraintsProcessed}`);
