// lint_constraints.js — targeted guidance on serialized ISS constraints.
//
// Operates on the constraint output (an .iss file or run_sandbox output)
// rather than script source, so canonicalization and redundancy checks are
// exact regardless of how a script generated the constraints: coefficient
// Sums that re-encode EqualSum or plain Sum, Pair keys that re-encode a
// native relation (only where the native class's adjacency requirement is
// met), NFA alphabets that disagree with the Shape (segment-aware), stamped
// copies that suggest Replicate, and redundant Givens/AllDifferents.
// Guidance is advisory by default; pass --fail-on-guidance to gate on it.
//
// Usage:
//   node tools/dev/lint_constraints.js [--fail-on-guidance] <file.iss|-> [...]
//   node tools/dev/lint_constraints.js --script <script.js> [...]
//
// Inputs are constraint text (.iss files, or '-' for stdin). With --script,
// inputs are sandbox scripts: each is run and its generated constraints are
// linted.

import { readFileSync } from 'node:fs';
import { runAsCli } from '../lib/cli_entry.js';
import { runSandboxToConstraint } from '../lib/sandbox_runner.js';
import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';

ensureGlobalEnvironment();
const { fnToBinaryKey } = await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../js/cell_geometry.js' + self.VERSION_PARAM);
const { NFASerializer } = await import('../../js/nfa_builder.js' + self.VERSION_PARAM);

const LONG_CONSTRAINT_LINE_THRESHOLD = 180;
const STAMPED_COPY_THRESHOLD = 50;

const parseArgs = (argv) => {
  const args = { files: [], failOnGuidance: false, script: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h': case '--help': args.help = true; break;
      case '--fail-on-guidance': args.failOnGuidance = true; break;
      case '--script': args.script = true; break;
      default: args.files.push(argv[i]); break;
    }
  }
  return args;
};

const printUsage = () => console.log(`\
Usage: node tools/dev/lint_constraints.js [options] <file.iss|-> [...]
       node tools/dev/lint_constraints.js --script <script.js> [...]

Lints serialized constraints. Inputs are constraint text (.iss files, or '-'
for stdin). With --script, inputs are sandbox scripts: each is run and its
generated constraints are linted.

Options:
  --script            Treat inputs as sandbox scripts to run.
  --fail-on-guidance  Exit non-zero when guidance is found.
  -h, --help          Print this help and exit.

Guidance is advisory. It surfaces re-encodings of native constraints,
Shape/alphabet mismatches, Replicate candidates, and redundant constraints.`);

const parseGridCell = (cell) => {
  const match = /^R(\d+)C(\d+)$/.exec(cell);
  return match ? { row: +match[1], col: +match[2] } : null;
};

const isOrthAdjacent = (a, b) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

// Flatten the parsed tree. Composites (And/Or/Replicate) expose
// `.constraints`; leaves are everything else. `inOr` marks constraints that
// are alternatives rather than facts, where redundancy rules must not fire.
const collectLeaves = (constraint, inOr, out) => {
  if (Array.isArray(constraint.constraints)) {
    const branchOr = inOr || constraint.type === 'Or';
    for (const child of constraint.constraints) {
      collectLeaves(child, branchOr, out);
    }
    return out;
  }
  out.push({ constraint, inOr });
  return out;
};

// Native binary relations a Pair key can re-encode. All but GreaterThan are
// symmetric; GreaterThan is directed, so both orders are matched. The native
// classes require orthogonally-adjacent grid cells
// (VALIDATE_CELLS_FN = _hasAdjacentCells), which the group check enforces.
const nativePairRelations = (geometry) => {
  const { numValues, valueOffset } = geometry;
  const key = (fn) => fnToBinaryKey(fn, numValues, valueOffset);
  return [
    { name: 'WhiteDot', key: key((a, b) => a === b + 1 || a === b - 1) },
    { name: 'BlackDot', key: key((a, b) => a === b * 2 || b === a * 2) },
    { name: 'X', key: key((a, b) => a + b === 10) },
    { name: 'V', key: key((a, b) => a + b === 5) },
    { name: 'GreaterThan', key: key((a, b) => a > b) },
    { name: 'GreaterThan (reversed cells)', key: key((a, b) => a < b) },
  ];
};

// House cell sets that the engine already enforces as all-different:
// every row and column, plus default boxes unless NoBoxes is present.
const enforcedHouseSets = (geometry, hasNoBoxes) => {
  const houses = new Map();
  const addHouse = (label, cells) => {
    houses.set(cells.map(c => `R${c.row}C${c.col}`).sort().join(','), label);
  };

  for (let r = 1; r <= geometry.numRows; r++) {
    addHouse(`row ${r}`, Array.from(
      { length: geometry.numCols }, (_, i) => ({ row: r, col: i + 1 })));
  }
  for (let c = 1; c <= geometry.numCols; c++) {
    addHouse(`column ${c}`, Array.from(
      { length: geometry.numRows }, (_, i) => ({ row: i + 1, col: c })));
  }

  if (!hasNoBoxes) {
    const [boxH, boxW] = CellGeometry.boxDimsForSize(
      geometry.numRows, geometry.numCols, geometry.numValues) || [null, null];
    if (boxH) {
      for (let r = 1; r <= geometry.numRows; r += boxH) {
        for (let c = 1; c <= geometry.numCols; c += boxW) {
          const cells = [];
          for (let dr = 0; dr < boxH; dr++) {
            for (let dc = 0; dc < boxW; dc++) {
              cells.push({ row: r + dr, col: c + dc });
            }
          }
          addHouse(`box at R${r}C${c}`, cells);
        }
      }
    }
  }
  return houses;
};

const nfaSymbolCount = (() => {
  const cache = new Map();
  return (encodedNFA) => {
    if (!cache.has(encodedNFA)) {
      cache.set(encodedNFA, NFASerializer.deserialize(encodedNFA).numSymbols());
    }
    return cache.get(encodedNFA);
  };
})();

// Best-effort line attribution: the first input line mentioning both the
// constraint's type tag and its first cell (or just the type tag).
const findLine = (lines, type, firstCell) => {
  const typeTag = `.${type}~`;
  let typeOnly = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(typeTag)) continue;
    if (!typeOnly) typeOnly = i + 1;
    if (!firstCell || lines[i].includes(firstCell)) return i + 1;
  }
  return typeOnly || 1;
};

const describeCells = (cells) =>
  cells.length <= 4 ? cells.join(' ') : `${cells.slice(0, 3).join(' ')} … (${cells.length} cells)`;

const lintConstraintText = (text) => {
  const lines = text.split('\n');
  const root = SudokuParser.parseText(text);
  const leaves = collectLeaves(root, false, []);

  const shapeLeaf = leaves.find(({ constraint }) => constraint.type === 'Shape');
  const geometry = shapeLeaf
    ? CellGeometry.fromShapeSpec(shapeLeaf.constraint.shapeSpec)
    : CellGeometry.newDefault();
  const hasNoBoxes = leaves.some(({ constraint }) => constraint.type === 'NoBoxes');
  const hasReplicate = leaves.some(({ constraint }) => constraint.type === 'Replicate');
  const shapeIsExtended = geometry.numValues !==
    CellGeometry.defaultNumValues(geometry.numRows, geometry.numCols);

  const pairRelations = nativePairRelations(geometry);
  const houses = enforcedHouseSets(geometry, hasNoBoxes);

  const items = [];
  const add = (line, code, message) => items.push({ line, code, message });

  const copiesByKey = new Map();
  const pairGroups = new Map();

  for (const { constraint, inOr } of leaves) {
    const type = constraint.type;
    const cells = constraint.cells || [];
    const line = () => findLine(lines, type, cells[0]);

    // --- Sum canonicalization ---
    if (type === 'Sum' && constraint.coeffs) {
      const coeffs = constraint.coeffs;
      if (coeffs.every(c => c === 1)) {
        add(line(), 'sum-unit-coefficients',
          'coefficient Sum with all-1 coefficients; use the plain Sum form '
          + '(or Cage if values are also all-different)');
      } else if (constraint.sum === 0 && coeffs.every(c => c === 1 || c === -1)
        && coeffs.some(c => c === 1) && coeffs.some(c => c === -1)) {
        add(line(), 'sum-equal-sum',
          cells.length === 2
            ? 'coefficient Sum expresses cell equality; prefer SameValues '
            + '(or EqualSum) with the cells as two segments'
            : 'coefficient Sum expresses two cell sets with equal sums; '
            + 'prefer EqualSum with the cells as two segments');
      }
    }

    // --- Pair key vs native relation (collected; judged per key group) ---
    if (type === 'Pair' || type === 'PairX') {
      const gridCells = cells.map(parseGridCell);
      const replaceable = cells.length === 2 && gridCells[0] && gridCells[1]
        && isOrthAdjacent(gridCells[0], gridCells[1]);
      const groupKey = `${type}\0${constraint.key}`;
      if (!pairGroups.has(groupKey)) {
        pairGroups.set(groupKey, { type, key: constraint.key, line: line(), count: 0, allReplaceable: true });
      }
      const group = pairGroups.get(groupKey);
      group.count++;
      group.allReplaceable &&= replaceable;
    }

    // --- NFA alphabet vs Shape ---
    // The serialized machine stores a trimmed symbol count (highest symbol
    // with any transition), so a count below numValues is legitimate. Only
    // overshoot is a definite mismatch, allowing one extra symbol for the
    // multi-segment break.
    if (type === 'NFA') {
      const numSymbols = nfaSymbolCount(constraint.encodedNFA);
      if (numSymbols > geometry.numValues + 1) {
        add(line(), 'nfa-alphabet-mismatch',
          `NFA has transitions for ${numSymbols} symbols but the grid has `
          + `${geometry.numValues} values (${geometry.numValues + 1} with a `
          + 'segment break); the machine was compiled for a larger Shape');
      }
      const copyKey = `NFA\0${constraint.encodedNFA}`;
      copiesByKey.set(copyKey, (copiesByKey.get(copyKey) || 0) + 1);
    }

    // --- Redundant full-range Given on an unextended Shape ---
    if (type === 'Given' && !inOr && !shapeIsExtended && parseGridCell(constraint.cell)) {
      const values = new Set(constraint.values);
      let fullRange = values.size === geometry.numValues;
      for (let v = geometry.minValue(); fullRange && v <= geometry.maxValue(); v++) {
        fullRange = values.has(v);
      }
      if (fullRange) {
        add(line(), 'redundant-full-range-given',
          `Given on ${constraint.cell} allows every value the Shape already `
          + 'allows; it does nothing');
      }
    }

    // --- Duplicate cells within an all-different constraint ---
    if (['AllDifferent', 'Cage', 'Renban'].includes(type)
      && new Set(cells).size !== cells.length) {
      add(line(), 'duplicate-cells',
        `${type} on ${describeCells(cells)} repeats a cell, making it `
        + 'unsatisfiable under its all-different semantics');
    }

    // --- AllDifferent duplicating an enforced house ---
    if (type === 'AllDifferent' && !inOr) {
      const house = houses.get([...cells].sort().join(','));
      if (house) {
        add(line(), 'redundant-all-different',
          `AllDifferent duplicates ${house}, which the engine already enforces`);
      }
    }
  }

  // --- Pair groups that fully re-encode a native relation ---
  // Suggested only when EVERY constraint sharing the key is a 2-cell
  // adjacent grid pair: a partial replacement would split one drawn rule
  // into two constraint types and stop the pairs compressing together.
  for (const group of pairGroups.values()) {
    if (!group.allReplaceable) continue;
    const relation = pairRelations.find(r => r.key === group.key);
    if (!relation) continue;
    add(group.line, 'pair-native-relation',
      `${group.count} ${group.type} constraint${group.count === 1 ? '' : 's'} `
      + `re-encode ${relation.name} on adjacent cells; use the native constraint`);
  }

  // --- Stamped copies that suggest Replicate ---
  if (!hasReplicate) {
    for (const [copyKey, count] of copiesByKey) {
      if (count < STAMPED_COPY_THRESHOLD) continue;
      const type = copyKey.split('\0')[0];
      add(1, 'stamped-copies-without-replicate',
        `${count} ${type} constraints share one machine; if they are shifted `
        + 'copies, use Replicate to shorten the encoding');
    }
  }

  // --- Long output without Replicate (migrated from lint_sandbox_script) ---
  const constraintLineCount = lines.filter(l => l.trim().startsWith('.')).length;
  if (constraintLineCount >= LONG_CONSTRAINT_LINE_THRESHOLD && !hasReplicate) {
    add(1, 'long-output-without-replicate',
      `${constraintLineCount} constraint lines and no Replicate; if many `
      + 'constraints are shifted copies, use Replicate to shorten the string');
  }

  // --- Duplicate constraint lines (text-level, exact) ---
  const seenLines = new Map();
  lines.forEach((rawLine, i) => {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('.')) return;
    if (seenLines.has(trimmed)) {
      add(i + 1, 'duplicate-constraint',
        `identical to line ${seenLines.get(trimmed)}`);
    } else {
      seenLines.set(trimmed, i + 1);
    }
  });

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

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) { printUsage(); return; }
  if (!args.files.length) {
    throw new Error('No inputs specified. Pass .iss files, or - for stdin.');
  }

  let total = 0;
  for (const file of args.files) {
    const raw = readFileSync(file === '-' ? 0 : file, 'utf8');
    let guidance;
    try {
      const text = args.script ? await runSandboxToConstraint(raw) : raw;
      guidance = lintConstraintText(text);
    } catch (err) {
      console.log(`${file}:1: error: failed to lint constraints: ${err.message}`);
      total += 1;
      continue;
    }
    if (!guidance.length) {
      console.log(`${file}: OK`);
      continue;
    }
    total += guidance.length;
    for (const item of guidance) {
      console.log(`${file}:${item.line}: guidance ${item.code}: ${item.message}`);
    }
  }

  if (total) {
    console.log(`\n${total} guidance item${total === 1 ? '' : 's'} found.`);
    if (args.failOnGuidance) process.exitCode = 1;
  }
};

runAsCli(import.meta.url, main);
