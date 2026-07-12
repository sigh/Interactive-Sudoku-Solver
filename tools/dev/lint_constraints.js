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

// A cell's subgraph: the main grid, or a specific Var overlay (by prefix).
// Replicate shifts a template within one subgraph only, so a constraint whose
// cells span more than one (e.g. a grid cell together with a VS overlay cell)
// is structurally not Replicable however regular its offsets look.
const cellSubgraph = (cell) => {
  if (/^R[0-9a-z]+C[0-9a-z]+$/i.test(cell)) return 'grid';
  const m = /^(V[A-Za-z]*)/.exec(cell);
  return m ? m[1] : 'other';
};
const spansSubgraphs = (cells) => new Set(cells.map(cellSubgraph)).size > 1;

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

export const lintConstraintText = (text) => {
  const lines = text.split('\n');
  const root = SudokuParser.parseText(text);
  const leaves = collectLeaves(root, false, []);

  const shapeLeaf = leaves.find(({ constraint }) => constraint.type === 'Shape');
  const geometry = shapeLeaf
    ? CellGeometry.fromShapeSpec(shapeLeaf.constraint.shapeSpec)
    : CellGeometry.newDefault();
  const hasNoBoxes = leaves.some(({ constraint }) => constraint.type === 'NoBoxes');
  // collectLeaves flattens composites (including Replicate) into their children,
  // so a Replicate node never appears among the leaves; walk the tree for it.
  const treeHasType = (c, type) => c.type === type ||
    (Array.isArray(c.constraints) && c.constraints.some(ch => treeHasType(ch, type)));
  const hasReplicate = treeHasType(root, 'Replicate');
  const shapeIsExtended = geometry.numValues !==
    CellGeometry.defaultNumValues(geometry.numRows, geometry.numCols);

  const pairRelations = nativePairRelations(geometry);
  const houses = enforcedHouseSets(geometry, hasNoBoxes);

  // Equality / all-different Pair keys. Unlike the native relations above,
  // these need no adjacency, so they are matched on every Pair group.
  const binaryKey = (fn) => fnToBinaryKey(fn, geometry.numValues, geometry.valueOffset);
  const sameValuesKey = binaryKey((a, b) => a === b);
  const allDifferentKey = binaryKey((a, b) => a !== b);

  const items = [];
  const add = (line, code, message) => items.push({ line, code, message });

  const copiesByKey = new Map();
  const pairGroups = new Map();
  const nfaGroups = new Map();

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
      // Key by machine AND arity: Replicate stamps one fixed-shape template, so
      // instances of the same machine over different cell counts (e.g. a
      // degree check over 2/3/4 neighbours) can't share one Replicate.
      const copyKey = `NFA\0${constraint.encodedNFA}\0${cells.length}`;
      let copy = copiesByKey.get(copyKey);
      if (!copy) { copy = { count: 0, allCross: true }; copiesByKey.set(copyKey, copy); }
      copy.count++;
      copy.allCross &&= spansSubgraphs(cells);

      let nfaGroup = nfaGroups.get(constraint.encodedNFA);
      if (!nfaGroup) {
        nfaGroup = { count: 0, allTwoCell: true, line: line() };
        nfaGroups.set(constraint.encodedNFA, nfaGroup);
      }
      nfaGroup.count++;
      nfaGroup.allTwoCell &&= cells.length === 2;
    }

    // --- Given: redundant-full-range, else a stamped-copy candidate ---
    if (type === 'Given') {
      const values = constraint.values || [];
      const valueSet = new Set(values);
      let fullRange = valueSet.size === geometry.numValues && parseGridCell(constraint.cell);
      for (let v = geometry.minValue(); fullRange && v <= geometry.maxValue(); v++) {
        fullRange = valueSet.has(v);
      }
      if (inOr) {
        // Conditional givens (Or/And hypothesis branches) are not standalone
        // repeated facts, so they are neither redundant nor Replicate copies.
      } else if (!shapeIsExtended && fullRange) {
        add(line(), 'redundant-full-range-given',
          `Given on ${constraint.cell} allows every value the Shape already `
          + 'allows; it does nothing');
      } else {
        // Identical Givens (same value set) are Replicate candidates -- Replicate
        // shifts the cell and keeps the values -- even though they serialize onto
        // one line. Common as "restrict every cell to 1-N" on an extended Shape.
        // Key by subgraph too: one Replicate can't span the grid and a Var
        // overlay, so same-valued Givens in different subgraphs are separate.
        const valueSig = [...values].sort((a, b) => a - b).join('_');
        const copyKey = `Given\0${valueSig}\0${cellSubgraph(constraint.cell)}`;
        let copy = copiesByKey.get(copyKey);
        if (!copy) { copy = { count: 0, allCross: true }; copiesByKey.set(copyKey, copy); }
        copy.count++;
        copy.allCross &&= spansSubgraphs([constraint.cell]);
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
    const count = `${group.count} ${group.type} constraint${group.count === 1 ? '' : 's'}`;
    // A Pair keyed on == / != is a two-cell SameValues / AllDifferent expressed
    // as a custom binary function; the native class is the direct form. This
    // holds per pair (no adjacency, no clique, and inside an Or too), so it is
    // judged for every such group -- merging into one larger set is a separate,
    // optional step the author can take when the pairs form a clique.
    if (group.key === sameValuesKey) {
      add(group.line, 'pair-same-values',
        `${count} re-encode a two-cell equality; use SameValues`);
      continue;
    }
    if (group.key === allDifferentKey) {
      add(group.line, 'pair-all-different',
        `${count} re-encode a two-cell all-different; use AllDifferent`);
      continue;
    }
    if (!group.allReplaceable) continue;
    const relation = pairRelations.find(r => r.key === group.key);
    if (!relation) continue;
    add(group.line, 'pair-native-relation',
      `${count} re-encode ${relation.name} on adjacent cells; use the native constraint`);
  }

  // --- NFA machines applied only to 2-cell inputs (a binary relation) ---
  for (const group of nfaGroups.values()) {
    if (!group.allTwoCell) continue;
    add(group.line, 'nfa-two-cell-use-pair',
      `${group.count} NFA constraint${group.count === 1 ? '' : 's'} apply one `
      + 'machine to 2 cells; a 2-cell relation is a Pair — use Pair.fnToKey instead');
  }

  // --- Stamped copies that suggest Replicate ---
  if (!hasReplicate) {
    for (const [copyKey, copy] of copiesByKey) {
      if (copy.count < STAMPED_COPY_THRESHOLD) continue;
      // Every instance spans multiple cell subgraphs, so Replicate cannot
      // express them regardless of how uniform the offsets are.
      if (copy.allCross) continue;
      const type = copyKey.split('\0')[0];
      const shared = type === 'Given' ? 'value set' : 'machine';
      add(1, 'stamped-copies-without-replicate',
        `${copy.count} ${type} constraints share one ${shared}; if they are shifted `
        + 'copies, use Replicate to shorten the encoding');
    }
  }

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
