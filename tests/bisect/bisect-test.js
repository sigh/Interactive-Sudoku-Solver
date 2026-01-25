#!/usr/bin/env node
// bisect-test.js - Standalone script for git bisect
//
// Usage: See run-bisect.sh for the recommended way to run this.
//
// Exit codes:
//   0 = within tolerance
//   1 = outside tolerance (changed in either direction)
//   125 = skip (script failed to run)
//
// This script handles both:
//   - Old code (pre-2025): global scripts loaded via vm module
//   - New code (2025+): ES modules with dynamic imports

import { existsSync, readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { join } from 'path';

// The repo root is passed as an argument, or defaults to cwd
const REPO_ROOT = process.argv[2] || process.cwd();

// Configuration - override via environment variables
const PUZZLE = process.env.BISECT_PUZZLE;
const EXPECTED_GUESSES = parseInt(process.env.BISECT_EXPECTED_GUESSES || '0', 10);
const TOLERANCE = parseFloat(process.env.BISECT_TOLERANCE || '1.5');

// Validate required configuration
if (!PUZZLE) {
  console.error('ERROR: BISECT_PUZZLE environment variable is required');
  process.exit(125);
}
if (!EXPECTED_GUESSES) {
  console.error('ERROR: BISECT_EXPECTED_GUESSES environment variable is required');
  process.exit(125);
}

// Check if we're on old or new code based on file structure
const hasModules = existsSync(join(REPO_ROOT, 'js/solver/sudoku_builder.js'));

async function runWithModules() {
  // Node.js compatibility - define browser globals
  globalThis.self = globalThis;
  globalThis.VERSION_PARAM = '';

  const { SudokuBuilder } = await import(join(REPO_ROOT, 'js/solver/sudoku_builder.js'));
  const { SudokuParser } = await import(join(REPO_ROOT, 'js/sudoku_parser.js'));

  const constraint = SudokuParser.parseText(PUZZLE);
  const resolved = SudokuBuilder.resolveConstraint(constraint);
  const solver = SudokuBuilder.build(resolved);

  solver.solveAllPossibilities();
  return solver.state();
}

function runWithGlobals() {
  // Load old-style global scripts via vm module
  // Order matters - dependencies first (based on worker.js load order)
  // Some files may not exist in older commits, so we filter
  const allFiles = [
    'js/util.js',
    'js/sudoku_builder.js',
    'js/solver/candidate_selector.js',  // Added later
    'js/solver/engine.js',
    'js/solver/handlers.js',
    'js/solver/optimizer.js',  // Added later
  ];

  const files = allFiles.filter(f => existsSync(join(REPO_ROOT, f)));

  // Create sandbox context with browser-like globals
  const sandbox = {
    ...globalThis,
    ENABLE_DEBUG_LOGS: false,
    EXPORT_CONFLICT_HEATMAP: false,
  };

  const ctx = createContext(sandbox);

  for (const file of files) {
    const path = join(REPO_ROOT, file);
    const code = readFileSync(path, 'utf-8');
    runInContext(code, ctx, { filename: file });
  }

  // Now run our test in the same context
  // Try different API variations that existed over time
  const testCode = `
    let constraint;
    // Try different parsing APIs
    if (typeof SudokuParser !== 'undefined' && SudokuParser.parseText) {
      constraint = SudokuParser.parseText(${JSON.stringify(PUZZLE)});
    } else if (SudokuConstraint.fromText) {
      constraint = SudokuConstraint.fromText(${JSON.stringify(PUZZLE)});
    } else {
      throw new Error('No constraint parsing API found');
    }
    // Try different builder APIs
    let solver;
    if (SudokuBuilder.resolveConstraint) {
      constraint = SudokuBuilder.resolveConstraint(constraint);
    }
    solver = SudokuBuilder.build(constraint);
    solver.solveAllPossibilities();
    solver.state();
  `;

  return runInContext(testCode, ctx, { filename: 'bisect-test.js' });
}

try {
  let state;
  if (hasModules) {
    state = await runWithModules();
  } else {
    state = runWithGlobals();
  }

  const c = state.counters;
  const ratio = c.guesses / EXPECTED_GUESSES;

  // Concise stats output - all info on one line
  console.log([
    `time=${state.timeMs}ms`,
    `solutions=${c.solutions}`,
    `guesses=${c.guesses}`,
    `backtracks=${c.backtracks}`,
    `nodes=${c.nodesSearched}`,
    `constraints=${c.constraintsProcessed}`,
    `values=${c.valuesTried}`,
    `ignored=${c.branchesIgnored}`,
    `ratio=${ratio.toFixed(2)}x`,
  ].join(' | '));

  // Detect change in either direction
  if (ratio > TOLERANCE || ratio < 1 / TOLERANCE) {
    console.log(`CHANGED (outside ${(1 / TOLERANCE).toFixed(2)}x - ${TOLERANCE}x range)`);
    process.exit(1);
  } else {
    console.log(`OK`);
    process.exit(0);
  }
} catch (e) {
  console.error('SKIP:', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(125);
}
