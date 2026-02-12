#!/usr/bin/env node
// Compare handler maps between JS and Rust for a constraint string.
// Outputs normalized (handler-name, cells) for each cell's ordinary/aux map.

const g = globalThis;
if (!g.self) g.self = g;
if (typeof g.VERSION_PARAM === 'undefined') g.VERSION_PARAM = '';
if (!g.window) g.window = g;
if (typeof g.document === 'undefined') g.document = {};
if (!g.location) g.location = { search: '' };

const constraintStr = process.argv[2] || 'S<J<<O<<KJ^<<^<^>^^<N<<<J^Q^S^O>>^^^>^W^<<^>^^O^<<^T^J^^^>>>^>^>^ML<S<<^^>^<^<<^<';

const { SudokuParser } = await import('../../js/sudoku_parser.js');
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js');
const c = SudokuParser.parseText(constraintStr);
const solver = SudokuBuilder.build(c);
const is = solver._internalSolver;
const acc = is._handlerAccumulator;
const handlers = acc._allHandlers;

function handlerSig(h) {
  const name = h.constructor.name;
  const cells = Array.from(h.cells).sort((a, b) => a - b).join(',');
  return `${name}(${cells})`;
}

// For each cell, output the normalized ordinary handler signatures in order
console.log('=== JS Ordinary Map (normalized) ===');
const ordMap = acc._ordinaryHandlersByEssential[0];
for (let cell = 0; cell < 81; cell++) {
  const sigs = ordMap[cell].map(i => handlerSig(handlers[i]));
  console.log(`  cell ${cell}: ${sigs.join(' | ')}`);
}

console.log('');
console.log('=== JS Aux Map (normalized) ===');
const auxMap = acc._auxHandlers;
for (let cell = 0; cell < 81; cell++) {
  const sigs = auxMap[cell].map(i => handlerSig(handlers[i]));
  if (sigs.length > 0) {
    console.log(`  cell ${cell}: ${sigs.join(' | ')}`);
  }
}
