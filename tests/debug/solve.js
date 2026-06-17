// solve.js — run a puzzle and display the solution content.
//
// The "what did the solver find" tool: shows the digit grid and all var-cell
// groups (e.g. Chaos region labels) for each solution found. Optionally verify
// a known solution is accepted. Use tests/bench/benchmark_puzzles.js when you
// want search counters (guesses, backtracks, nodes) rather than solution content.
//
// Usage:
//   node tests/debug/solve.js [options]
//
// Puzzle source (pick one):
//   --puzzle <name>       Named puzzle from data/collections.js.
//   --input <string>      Raw constraint string.
//   --input-file <path>   Read the constraint string from a file.
//
// Options:
//   --solutions <n|all>   Number of solutions to find. Default 2 (proves
//                         uniqueness; reports "multiple" if a 2nd exists).
//   --solution <digits>   Verify a known solution: inject the digit string as
//                         givens and confirm the solver accepts it. Exits
//                         non-zero if the solver rejects it.
//   --list                List available named puzzles.
//   -h, --help            Print this help and exit.
//
// Examples:
//   node tests/debug/solve.js --puzzle "Chaos Construction"
//   node tests/debug/solve.js --input-file puzzle.txt --solutions all
//   node tests/debug/solve.js --puzzle "Chaos Construction" --solution 123456789...

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGlobalEnvironment } from '../helpers/test_env.js';

ensureGlobalEnvironment();

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { LookupTables } = await import('../../js/solver/lookup_tables.js' + self.VERSION_PARAM);

// ============================================================================
// Arg parsing
// ============================================================================

const parseArgs = (argv) => {
  const args = {
    puzzle: null, input: null, inputFile: null,
    maxSolutions: 2, solution: null,
    list: false, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split(/=(.*)/s);
    const next = () => inlineValue ?? argv[++i];
    switch (key) {
      case '-h': case '--help': args.help = true; break;
      case '--list': args.list = true; break;
      case '--puzzle': args.puzzle = next(); break;
      case '--input': args.input = next(); break;
      case '--input-file': args.inputFile = next(); break;
      case '--solution': args.solution = next(); break;
      case '--solutions': {
        const v = next();
        args.maxSolutions = v === 'all' ? 0 : +v;
        break;
      }
      default: throw new Error(`Unknown argument: ${argv[i]}\nRun with --help for usage.`);
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tests/debug/solve.js [options]

Puzzle source (pick one):
  --puzzle <name>       Named puzzle from data/collections.js.
  --input <string>      Raw constraint string.
  --input-file <path>   Read the constraint string from a file.

Options:
  --solutions <n|all>   Solutions to find. Default 2 (proves uniqueness).
  --solution <digits>   Verify a known solution is accepted by the solver.
  --list                List available named puzzles.
  -h, --help            Print this help and exit.`);

// ============================================================================
// Puzzle loading
// ============================================================================

const Collections = await import('../../data/collections.js' + self.VERSION_PARAM);

const allPuzzles = () => {
  const seen = new Set();
  const puzzles = [];
  for (const value of Object.values(Collections)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!entry || typeof entry.input !== 'string' || typeof entry.name !== 'string') continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      puzzles.push({ name: entry.name, input: entry.input });
    }
  }
  return puzzles;
};

const findPuzzle = (query) => {
  const puzzles = allPuzzles();
  const exact = puzzles.find(p => p.name === query);
  if (exact) return exact;
  const lower = query.toLowerCase();
  const matches = puzzles.filter(p => p.name.toLowerCase().includes(lower));
  if (matches.length === 0) throw new Error(`No puzzle matches "${query}". Use --list to see names.`);
  if (matches.length > 1) {
    console.error(`"${query}" matched ${matches.length} puzzles; using "${matches[0].name}".`);
    console.error(`  (others: ${matches.slice(1, 6).map(m => m.name).join(', ')}${matches.length > 6 ? ', ...' : ''})`);
  }
  return matches[0];
};

const resolveInput = (input) =>
  input.startsWith('/') ? readFileSync(join(PROJECT_ROOT, input), 'utf8') : input;

const loadPuzzle = (args) => {
  if (args.input !== null) return { name: 'custom', input: resolveInput(args.input) };
  if (args.inputFile !== null) return { name: args.inputFile, input: readFileSync(args.inputFile, 'utf8') };
  if (args.puzzle !== null) {
    const p = findPuzzle(args.puzzle);
    return { ...p, input: resolveInput(p.input) };
  }
  throw new Error('No puzzle specified. Use --puzzle, --input, or --input-file (or --list).');
};

// ============================================================================
// Grid rendering
// ============================================================================

const decode = (mask, offset) =>
  (mask && !(mask & (mask - 1))) ? String(LookupTables.toOffsetValue(mask, offset)) : '?';

const printDigitGrid = (shape, grid) => {
  for (let r = 0; r < shape.numRows; r++) {
    const row = [];
    for (let c = 0; c < shape.numCols; c++) {
      row.push(decode(grid[r * shape.numCols + c], shape.valueOffset).padStart(2));
    }
    console.log(row.join(' '));
  }
};

const printVarGrid = (shape, grid, cells, columns) => {
  const numRows = Math.ceil(cells.length / columns);
  for (let r = 0; r < numRows; r++) {
    const row = [];
    for (let c = 0; c < columns; c++) {
      const idx = r * columns + c;
      if (idx >= cells.length) break;
      row.push(decode(grid[cells[idx]], 0).padStart(2));
    }
    console.log(row.join(' '));
  }
};

const printSolution = (shape, grid, solutionNum) => {
  console.log(`\n=== Solution ${solutionNum} ===`);
  printDigitGrid(shape, grid);

  for (const group of shape.varCellGroups()) {
    if (group.hidden) continue;
    console.log(`\n[${group.prefix}] ${group.label}:`);
    if (group.columns) {
      printVarGrid(shape, grid, group.cells, group.columns);
    } else {
      for (const cell of group.cells) {
        const id = shape.makeCellIdFromIndex(cell);
        console.log(`  ${id} = ${decode(grid[cell], 0)}`);
      }
    }
  }
};

// ============================================================================
// Solving
// ============================================================================

const injectSolutionGivens = (input, digits) => {
  // Parse the digit string into .~RrCc_v given constraints.
  const D = Math.round(Math.sqrt(digits.length));
  if (D * D !== digits.length) throw new Error(`--solution must be a perfect-square digit string (got length ${digits.length})`);
  let givens = '';
  for (let i = 0; i < digits.length; i++) {
    const r = Math.floor(i / D) + 1;
    const c = (i % D) + 1;
    givens += `.~R${r}C${c}_${digits[i]}`;
  }
  return input + givens;
};

const main = () => {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); return; }
  if (args.list) { for (const p of allPuzzles()) console.log(p.name); return; }

  let puzzle = loadPuzzle(args);

  if (args.solution !== null) {
    puzzle = { ...puzzle, input: injectSolutionGivens(puzzle.input, args.solution) };
  }

  const constraint = SudokuParser.parseText(puzzle.input);
  const resolved = SudokuBuilder.resolveConstraint(constraint);
  const solver = SudokuBuilder.build(resolved);
  const internal = solver._internalSolver;
  const shape = internal._shape;

  const mode = args.maxSolutions > 0 ? { maxSolutions: args.maxSolutions } : null;

  let count = 0;
  const grids = [];
  internal.run(mode, (grid) => {
    count++;
    grids.push(grid.slice());
  });

  const exhausted = internal.state === internal.constructor.STATE_EXHAUSTED;

  console.log(`Puzzle: ${puzzle.name}`);
  if (args.solution !== null) console.log(`Verifying solution: ${args.solution}`);

  if (count === 0) {
    console.log('Result: no solution');
    if (args.solution !== null) process.exit(1);
    return;
  }

  const status = !exhausted ? 'first-only' : count > 1 ? 'multiple solutions' : 'unique';
  console.log(`Result: ${status} (${count} found)`);

  for (let i = 0; i < grids.length; i++) {
    printSolution(shape, grids[i], i + 1);
  }
};

main();
