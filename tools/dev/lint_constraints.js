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
const { fnToBinaryKey, SudokuConstraint } = await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../js/cell_geometry.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { NFASerializer, SEGMENT_BREAK } = await import('../../js/nfa_builder.js' + self.VERSION_PARAM);

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

// Position cells as [row, col, subgraph] in the cell graph -- the same space
// Replicate shifts in. Var overlay cells only become positionable once they are
// registered on the geometry, so resolve the constraint first; a bare
// CellGeometry throws on 'VQ1'. Returns null if the tree cannot be resolved.
// Returns { positionOf, geometry }, or null if the tree cannot be resolved.
const makeCellContext = (root) => {
  let geometry;
  let graph;
  try {
    const resolved = SudokuBuilder.resolveConstraint(root);
    geometry = resolved.getGeometry();
    geometry.addVarCellsForConstraints([].concat(...resolved.toMap().values()));
    graph = geometry.cellGraph();
  } catch (e) {
    return null;
  }
  const positionOf = (cell) => {
    // SEGMENT_BREAK separates multi-segment cell lists; it is not a cell.
    if (cell === SEGMENT_BREAK) return null;
    try {
      return graph.cellPosition(geometry.parseCellId(cell).cellIndex);
    } catch (e) {
      return null;
    }
  };
  return { positionOf, geometry };
};

// Can one Replicate stamp this whole group? Replicate shifts a template by
// graph.traverse(dRow, dCol) and requires the origin, every target, and every
// template cell to lie in ONE cell group (see SudokuBuilder's Replicate case).
// So the instances must all be the same shape up to a shift, and confined to a
// single subgraph. A single-cell template (a repeated Given) passes the shape
// test trivially, but still has to clear the one-cell-group requirement.
const isReplicableGroup = (instances, positionOf) => {
  if (!positionOf) return false;
  const shapes = new Set();
  const subgraphs = new Set();
  for (const cells of instances) {
    const positions = cells.map(positionOf);
    if (positions.some(p => p === null)) return false;
    for (const [, , subgraph] of positions) subgraphs.add(subgraph);
    if (subgraphs.size > 1) return false;
    const [baseRow, baseCol] = positions[0];
    shapes.add(JSON.stringify(
      positions.map(([row, col]) => [row - baseRow, col - baseCol])));
    if (shapes.size > 1) return false;
  }
  return true;
};

// Flatten the parsed tree. Composites (And/Or/Replicate) expose
// `.constraints`; leaves are everything else. `inOr` marks constraints that
// are alternatives rather than facts, where redundancy rules must not fire.
// `inReplicate` marks a Replicate's template children -- already stamped, so
// they must not themselves be counted as un-Replicated stamped copies.
const collectLeaves = (constraint, flags, out) => {
  if (Array.isArray(constraint.constraints)) {
    const childFlags = {
      inOr: flags.inOr || constraint.type === 'Or',
      inReplicate: flags.inReplicate || constraint.type === 'Replicate',
    };
    for (const child of constraint.constraints) {
      collectLeaves(child, childFlags, out);
    }
    return out;
  }
  out.push({ constraint, ...flags });
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
  const leaves = collectLeaves(root, { inOr: false, inReplicate: false }, []);

  const shapeLeaf = leaves.find(({ constraint }) => constraint.type === 'Shape');
  const geometry = shapeLeaf
    ? CellGeometry.fromShapeSpec(shapeLeaf.constraint.shapeSpec)
    : CellGeometry.newDefault();
  const hasNoBoxes = leaves.some(({ constraint }) => constraint.type === 'NoBoxes');
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

  const cellContext = makeCellContext(root);
  const positionOf = cellContext?.positionOf ?? null;
  const givenLeaves = [];
  const replicateNodes = [];
  (function walk(c) {
    if (c.type === 'Replicate') replicateNodes.push(c);
    if (Array.isArray(c.constraints)) c.constraints.forEach(walk);
  })(root);
  const copiesByKey = new Map();
  const pairGroups = new Map();
  const nfaGroups = new Map();
  const sumGroups = new Map();

  for (const { constraint, inOr, inReplicate } of leaves) {
    const type = constraint.type;
    const cells = constraint.cells || [];
    const line = () => findLine(lines, type, cells[0]);

    // --- Sum canonicalization (collected; judged per coefficient group) ---
    // All-1 coefficients are decided by the coefficients alone, so they can be
    // judged here. EqualSum additionally needs a target of 0, which varies
    // *within* a coefficient family -- so it is judged per group below.
    if (type === 'Sum' && constraint.coeffs) {
      const coeffs = constraint.coeffs;
      if (coeffs.every(c => c === 1)) {
        add(line(), 'sum-unit-coefficients',
          'coefficient Sum with all-1 coefficients; use the plain Sum form '
          + '(or Cage if values are also all-different)');
      } else if (coeffs.every(c => c === 1 || c === -1)
        && coeffs.some(c => c === 1) && coeffs.some(c => c === -1)) {
        const groupKey = [...coeffs].sort((a, b) => a - b).join(',');
        if (!sumGroups.has(groupKey)) {
          sumGroups.set(groupKey, {
            line: line(), count: 0, allZeroTarget: true, twoCell: true,
          });
        }
        const group = sumGroups.get(groupKey);
        group.count++;
        group.allZeroTarget &&= constraint.sum === 0;
        group.twoCell &&= cells.length === 2;
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
      if (!copiesByKey.has(copyKey)) copiesByKey.set(copyKey, []);
      copiesByKey.get(copyKey).push(cells);

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
        // The single cell is the template; isReplicableGroup still has to confirm
        // they all sit in one cell group, since Replicate cannot span the grid
        // and a Var overlay.
        const valueSig = [...values].sort((a, b) => a - b).join('_');
        const copyKey = `Given\0${valueSig}`;
        if (!copiesByKey.has(copyKey)) copiesByKey.set(copyKey, []);
        copiesByKey.get(copyKey).push([constraint.cell]);
        givenLeaves.push({ cell: constraint.cell, values: valueSet, line: line() });
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

  // --- Sum groups that fully re-encode EqualSum ---
  // A coefficient family is one authored rule: the same linear expression
  // stamped over different cells. EqualSum needs a target of 0, which varies
  // within a family, so it is suggested only when EVERY member has target 0 --
  // converting just the members that happen to balance would split one rule
  // across two constraint types.
  for (const group of sumGroups.values()) {
    if (!group.allZeroTarget) continue;
    const count = `${group.count} coefficient Sum${group.count === 1 ? '' : 's'}`;
    add(group.line, 'sum-equal-sum',
      group.twoCell
        ? `${count} express cell equality; prefer SameValues (or EqualSum) `
        + 'with the cells as two segments'
        : `${count} express two cell sets with equal sums; prefer EqualSum `
        + 'with the cells as two segments');
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

  // --- A Replicate'd domain that skips the cells its own clues pin ---
  // Two RAW Givens on a cell merge (Given's uniqueness key is the cell), so a
  // hand-stamped domain and one that filtered its clue cells out serialize
  // identically -- indistinguishable, hence not linted. But a Given inside a
  // Replicate does NOT merge with a raw Given: both survive. So once the domain
  // is Replicate'd, the cells it skips are visible, and skipping them is pointless
  // -- the two constraints intersect, so the narrower clue still wins. Extend the
  // targets over the whole group and drop the filtering.
  //
  // Only fires when the clue is a strict subset of the domain: a clue outside it
  // (a placeholder range, an out-of-set marker) would intersect to nothing.
  for (const replicate of replicateNodes) {
    if (!cellContext) break;
    let targets;
    try {
      targets = new Set(SudokuConstraint.Replicate
        .decodeTargetCells(replicate.targetBitset, replicate.origin, cellContext.geometry)
        .map(index => cellContext.geometry.makeCellIdFromIndex(index)));
    } catch (e) {
      continue;
    }
    for (const child of replicate.constraints) {
      if (child.type !== 'Given' || child.cell !== replicate.origin) continue;
      const domain = new Set(child.values || []);
      const subgraph = positionOf(replicate.origin)?.[2];
      if (subgraph === undefined) continue;
      // Raw Givens elsewhere in the same cell group. The template itself sits on
      // the origin, which is always a target, so it can never appear here.
      const skipped = givenLeaves.filter(given =>
        !targets.has(given.cell)
        && positionOf(given.cell)?.[2] === subgraph
        && given.values.size < domain.size
        && [...given.values].every(value => domain.has(value)));
      if (!skipped.length) continue;
      add(findLine(lines, 'Replicate', null), 'replicated-domain-skips-clue-cells',
        `a Replicate stamps a Given domain over this cell group but skips `
        + `${skipped.length} cell(s) that a narrower Given already pins; the two `
        + 'intersect, so stamp the domain over the whole group instead');
    }
  }

  // --- Stamped copies that suggest Replicate ---
  // Decided, not guessed: isReplicableGroup checks that the instances really are
  // one template under a shift, in one cell group. Sharing a machine is not
  // enough -- the same machine applied to many differently-shaped cell sets (a
  // rule run over every region, say) has no single template to stamp.
  // Judged per group, not per script: a script that already uses Replicate for
  // one rule can still stamp another group by hand. Constraints already inside a
  // Replicate are excluded when the groups are collected, so they never appear.
  for (const [copyKey, instances] of copiesByKey) {
    if (instances.length < STAMPED_COPY_THRESHOLD) continue;
    if (!isReplicableGroup(instances, positionOf)) continue;
    const type = copyKey.split('\0')[0];
    const shared = type === 'Given' ? 'one value set' : 'one machine';
    add(1, 'stamped-copies-without-replicate',
      `${instances.length} ${type} constraints share ${shared} and are shifted `
      + 'copies of one template; use Replicate to shorten the encoding');
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
