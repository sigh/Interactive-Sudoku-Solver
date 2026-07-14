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
// Because these rules read what was actually built, they are 'exact' tier:
// --fail-on=exact gates CI on them. `.iss` files are generated and so cannot
// carry inline suppressions -- a known, accepted set of findings is held with
// --baseline instead.
//
// Structure: lintConstraintText prepares a context (parse, leaves, geometry,
// houses, decoded keys, cell positions) and then runs the rule registry over
// it. Each rule is {code, tier, summary, docs, make()}, where make() returns
// `collect(leaf, ctx, add)` (called once per leaf, in file order) and/or
// `finalize(ctx, add)` (called once, after the leaves) closing over whatever
// state that one rule needs. Rules that judge a whole group -- one authored
// rule stamped over many cells -- accumulate in collect and judge in finalize.
//
// Usage:
//   node tools/dev/lint_constraints.js [--fail-on-guidance] <file.iss|-> [...]
//   node tools/dev/lint_constraints.js --script <script.js> [...]
//
// Inputs are constraint text (.iss files, or '-' for stdin). With --script,
// inputs are sandbox scripts: each is run and its generated constraints are
// linted.

import { runAsCli } from '../lib/cli_entry.js';
import { dedupeGuidance, runLintCli } from '../lib/lint_cli.js';
import { runSandboxToConstraint } from '../lib/sandbox_runner.js';
import { ensureGlobalEnvironment } from '../../tests/helpers/test_env.js';

ensureGlobalEnvironment();
const { fnToBinaryKey, SudokuConstraint, SudokuConstraintBase } = await import('../../js/sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuParser } = await import('../../js/sudoku_parser.js' + self.VERSION_PARAM);
const { CellGeometry } = await import('../../js/cell_geometry.js' + self.VERSION_PARAM);
const { SudokuBuilder } = await import('../../js/solver/sudoku_builder.js' + self.VERSION_PARAM);
const { NFASerializer, SEGMENT_BREAK } = await import('../../js/nfa_builder.js' + self.VERSION_PARAM);

const STAMPED_COPY_THRESHOLD = 50;

const USAGE = `\
Usage: node tools/dev/lint_constraints.js [options] <file.iss|-> [...]
       node tools/dev/lint_constraints.js --script <script.js> [...]

Lints serialized constraints. Inputs are constraint text (.iss files, or '-'
for stdin). With --script, inputs are sandbox scripts: each is run and its
generated constraints are linted.

Options:
  --script            Treat inputs as sandbox scripts to run.
  --list-rules        Print the rules (code, tier, what each catches) and exit.
  --only=<codes>      Run only these rules (comma-separated).
  --ignore=<codes>    Run everything but these rules.
  --fail-on-guidance  Exit non-zero when any guidance is found.
  --fail-on=<tiers>   Exit non-zero only for these tiers (exact, heuristic, info).
  --format=text|json  Output format (default text).
  --baseline=<file>   Suppress the counts recorded in this baseline file.
  --write-baseline=<file>  Write the run's counts as a new baseline.
  -h, --help          Print this help and exit.

Guidance is advisory by default. It surfaces re-encodings of native
constraints, Shape/alphabet mismatches, Replicate candidates, and redundant
constraints; run --list-rules for what each rule catches. The rules read what
was built, not how it was written, so they are 'exact' tier: --fail-on=exact
gates on all of them. Hold a known, accepted set of findings at zero noise with
--write-baseline=<file> once, then --baseline=<file> on every later run.

An input that cannot be parsed or run is an error, not guidance: it is reported
as \`<file>:1: error: ...\` and always exits non-zero.`;

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

// The box size the engine will actually use: an explicit RegionSize, else the grid's
// default. See SudokuBuilder._getEffectiveBoxSize.
const boxSize = (geometry, regionSize) =>
  regionSize ?? CellGeometry.defaultNumValues(geometry.numRows, geometry.numCols);

// House cell sets that the engine already enforces as all-different:
// every row and column, plus default boxes unless NoBoxes is present.
const enforcedHouseSets = (geometry, hasNoBoxes, regionSize) => {
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
    // Mirror SudokuBuilder._getBoxRegions exactly: NoBoxes wins, then a RegionSize
    // constraint, and only then the grid's default. `numValues` is NOT the box size --
    // a widened alphabet (Shape 6x6~1-9) leaves the 2x3 boxes alone, so sizing houses
    // by it invents boxes the solver never enforces and every rule built on this set
    // then reasons about the wrong grid.
    const [boxH, boxW] = CellGeometry.boxDimsForSize(
      geometry.numRows, geometry.numCols, boxSize(geometry, regionSize)) || [null, null];
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

// ---------------------------------------------------------------------------
// Context: everything derived from the input that more than one rule needs, or
// that costs too much to redo per rule. Facts about the input only -- every
// judgement lives in a rule.
// ---------------------------------------------------------------------------

const makeContext = (text) => {
  const lines = text.split('\n');
  const root = SudokuParser.parseText(text);
  const leaves = collectLeaves(root, { inOr: false, inReplicate: false }, [])
    .map((leaf) => {
      const { type } = leaf.constraint;
      const cells = leaf.constraint.cells || [];
      let line = null;
      return {
        ...leaf,
        type,
        cells,
        // Attribution scans the file, so only pay for it when a rule reports.
        line: () => (line ??= findLine(lines, type, cells[0])),
      };
    });

  const shapeLeaf = leaves.find(({ type }) => type === 'Shape');
  const geometry = shapeLeaf
    ? CellGeometry.fromShapeSpec(shapeLeaf.constraint.shapeSpec)
    : CellGeometry.newDefault();
  const hasNoBoxes = leaves.some(({ type }) => type === 'NoBoxes');
  // The box size is a constraint, not a property of the Shape: RegionSize sets it.
  const regionSize =
    leaves.find(({ type }) => type === 'RegionSize')?.constraint?.size ?? null;
  const shapeIsExtended = geometry.numValues !==
    CellGeometry.defaultNumValues(geometry.numRows, geometry.numCols);

  // Equality / all-different Pair keys. Unlike the native relations, these need
  // no adjacency, so they are matched on every Pair group.
  const binaryKey = (fn) => fnToBinaryKey(fn, geometry.numValues, geometry.valueOffset);

  const replicateNodes = [];
  (function walk(c) {
    if (c.type === 'Replicate') replicateNodes.push(c);
    if (Array.isArray(c.constraints)) c.constraints.forEach(walk);
  })(root);

  // Pair/PairX leaves grouped by key: three rules judge these groups, and the
  // grouping itself is a fact about the input, not one of their judgements.
  const pairGroups = new Map();
  for (const leaf of leaves) {
    if (leaf.type !== 'Pair' && leaf.type !== 'PairX') continue;
    const gridCells = leaf.cells.map(parseGridCell);
    const replaceable = leaf.cells.length === 2 && gridCells[0] && gridCells[1]
      && isOrthAdjacent(gridCells[0], gridCells[1]);
    const groupKey = `${leaf.type}\0${leaf.constraint.key}`;
    if (!pairGroups.has(groupKey)) {
      pairGroups.set(groupKey, {
        type: leaf.type, key: leaf.constraint.key, line: leaf.line(),
        count: 0, allReplaceable: true,
      });
    }
    const group = pairGroups.get(groupKey);
    group.count++;
    group.allReplaceable &&= replaceable;
  }

  const cellContext = makeCellContext(root);

  return {
    lines,
    root,
    leaves,
    geometry,
    shapeIsExtended,
    regionSize,
    hasNoBoxes,
    houses: enforcedHouseSets(geometry, hasNoBoxes, regionSize),
    pairRelations: nativePairRelations(geometry),
    sameValuesKey: binaryKey((a, b) => a === b),
    allDifferentKey: binaryKey((a, b) => a !== b),
    pairGroups,
    replicateNodes,
    cellContext,
    positionOf: cellContext?.positionOf ?? null,
    findLine: (type, firstCell) => findLine(lines, type, firstCell),

    // What a Given is, which three rules key off: an Or-branch hypothesis, a
    // no-op that the Shape already allows, or a plain repeated fact.
    givenRole(leaf) {
      if (leaf.inOr) return 'conditional';
      const values = new Set(leaf.constraint.values || []);
      let fullRange = values.size === geometry.numValues
        && parseGridCell(leaf.constraint.cell);
      for (let v = geometry.minValue(); fullRange && v <= geometry.maxValue(); v++) {
        fullRange = values.has(v);
      }
      return (!shapeIsExtended && fullRange) ? 'redundant' : 'fact';
    },
  };
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const OUTPUT_RULES = [
  {
    code: 'sum-unit-coefficients',
    tier: 'exact',
    summary: 'coefficient Sum with all-1 coefficients; use the plain Sum form '
      + '(or Cage if values are also all-different)',
    docs: 'Decided by the coefficients alone, so it is judged per constraint\n'
      + 'rather than per family.',
    make: () => ({
      collect(leaf, ctx, add) {
        if (leaf.type !== 'Sum' || !leaf.constraint.coeffs) return;
        if (!leaf.constraint.coeffs.every(c => c === 1)) return;
        add(leaf.line(), 'coefficient Sum with all-1 coefficients; use the plain Sum form '
          + '(or Cage if values are also all-different)');
      },
    }),
  },
  {
    code: 'sum-equal-sum',
    tier: 'exact',
    summary: 'coefficient Sums that express two cell sets with equal sums; prefer EqualSum',
    docs: 'A coefficient family (the same all-±1 expression stamped over different\n'
      + 'cells) is one authored rule. EqualSum needs a target of 0, which varies\n'
      + 'within a family, so it is suggested only when EVERY member has target 0 --\n'
      + 'converting just the members that balance would split one rule in two.',
    make: () => {
      const groups = new Map();
      return {
        collect(leaf) {
          if (leaf.type !== 'Sum' || !leaf.constraint.coeffs) return;
          const coeffs = leaf.constraint.coeffs;
          if (!(coeffs.every(c => c === 1 || c === -1)
            && coeffs.some(c => c === 1) && coeffs.some(c => c === -1))) return;
          const groupKey = [...coeffs].sort((a, b) => a - b).join(',');
          if (!groups.has(groupKey)) {
            groups.set(groupKey, {
              line: leaf.line(), count: 0, allZeroTarget: true, twoCell: true,
            });
          }
          const group = groups.get(groupKey);
          group.count++;
          group.allZeroTarget &&= leaf.constraint.sum === 0;
          group.twoCell &&= leaf.cells.length === 2;
        },
        finalize(ctx, add) {
          for (const group of groups.values()) {
            if (!group.allZeroTarget) continue;
            const count = `${group.count} coefficient Sum${group.count === 1 ? '' : 's'}`;
            add(group.line, group.twoCell
              ? `${count} express cell equality; prefer SameValues (or EqualSum) `
                + 'with the cells as two segments'
              : `${count} express two cell sets with equal sums; prefer EqualSum `
                + 'with the cells as two segments');
          }
        },
      };
    },
  },
  {
    code: 'pair-same-values',
    tier: 'exact',
    summary: 'Pair constraints that re-encode a two-cell equality; use SameValues',
    docs: 'A Pair keyed on == is a two-cell SameValues expressed as a custom binary\n'
      + 'function. This holds per pair (no adjacency, no clique, and inside an Or\n'
      + 'too), so every such group is reported. Merging the pairs into one larger\n'
      + 'SameValues is a separate, optional step where they form a clique.',
    make: () => ({
      finalize(ctx, add) {
        for (const group of ctx.pairGroups.values()) {
          if (group.key !== ctx.sameValuesKey) continue;
          add(group.line, `${group.count} ${group.type} constraint`
            + `${group.count === 1 ? '' : 's'} re-encode a two-cell equality; use SameValues`);
        }
      },
    }),
  },
  {
    code: 'pair-all-different',
    tier: 'exact',
    summary: 'Pair constraints that re-encode a two-cell all-different; use AllDifferent',
    docs: 'The != twin of pair-same-values, with the same per-pair reasoning.',
    make: () => ({
      finalize(ctx, add) {
        for (const group of ctx.pairGroups.values()) {
          if (group.key !== ctx.allDifferentKey) continue;
          add(group.line, `${group.count} ${group.type} constraint`
            + `${group.count === 1 ? '' : 's'} re-encode a two-cell all-different; use AllDifferent`);
        }
      },
    }),
  },
  {
    code: 'pair-native-relation',
    tier: 'exact',
    summary: 'Pair key whose decoded truth table is a native relation '
      + '(WhiteDot, BlackDot, X, V, GreaterThan) on adjacent cells',
    docs: 'Suggested only when EVERY constraint sharing the key is a 2-cell\n'
      + 'orthogonally-adjacent grid pair: the native classes require adjacency, and a\n'
      + 'partial replacement would split one drawn rule into two constraint types and\n'
      + 'stop the pairs compressing together.',
    make: () => ({
      finalize(ctx, add) {
        for (const group of ctx.pairGroups.values()) {
          if (group.key === ctx.sameValuesKey || group.key === ctx.allDifferentKey) continue;
          if (!group.allReplaceable) continue;
          const relation = ctx.pairRelations.find(r => r.key === group.key);
          if (!relation) continue;
          add(group.line, `${group.count} ${group.type} constraint`
            + `${group.count === 1 ? '' : 's'} re-encode ${relation.name} on adjacent cells; `
            + 'use the native constraint');
        }
      },
    }),
  },
  {
    code: 'nfa-alphabet-mismatch',
    tier: 'exact',
    summary: 'NFA has transitions for more symbols than the grid has values; '
      + 'the machine was compiled for a larger Shape',
    docs: 'The serialized machine stores a trimmed symbol count (the highest symbol\n'
      + 'with any transition), so a count BELOW numValues is legitimate. Only\n'
      + 'overshoot is a definite mismatch, allowing one extra symbol for the\n'
      + 'multi-segment break.',
    make: () => ({
      collect(leaf, ctx, add) {
        if (leaf.type !== 'NFA') return;
        const numSymbols = nfaSymbolCount(leaf.constraint.encodedNFA);
        if (numSymbols <= ctx.geometry.numValues + 1) return;
        add(leaf.line(),
          `NFA has transitions for ${numSymbols} symbols but the grid has `
          + `${ctx.geometry.numValues} values (${ctx.geometry.numValues + 1} with a `
          + 'segment break); the machine was compiled for a larger Shape');
      },
    }),
  },
  {
    code: 'nfa-two-cell-use-pair',
    tier: 'exact',
    summary: 'one NFA machine applied only to 2-cell inputs; a 2-cell relation is a Pair',
    docs: 'Per machine, not per constraint: a machine used over both 2 and 3 cells is\n'
      + 'not a binary relation.',
    make: () => {
      const groups = new Map();
      return {
        collect(leaf) {
          if (leaf.type !== 'NFA') return;
          let group = groups.get(leaf.constraint.encodedNFA);
          if (!group) {
            group = { count: 0, allTwoCell: true, line: leaf.line() };
            groups.set(leaf.constraint.encodedNFA, group);
          }
          group.count++;
          group.allTwoCell &&= leaf.cells.length === 2;
        },
        finalize(ctx, add) {
          for (const group of groups.values()) {
            if (!group.allTwoCell) continue;
            add(group.line,
              `${group.count} NFA constraint${group.count === 1 ? '' : 's'} apply one `
              + 'machine to 2 cells; a 2-cell relation is a Pair — use Pair.fnToKey instead');
          }
        },
      };
    },
  },
  {
    code: 'redundant-full-range-given',
    tier: 'exact',
    summary: 'Given allows every value the Shape already allows; it does nothing',
    docs: 'Only on an unextended Shape, where the full range IS the default domain.\n'
      + 'On an extended Shape the same Given is the rule that restricts the cell.\n'
      + 'Or-branch givens are hypotheses, not facts, so they are skipped.',
    make: () => ({
      collect(leaf, ctx, add) {
        if (leaf.type !== 'Given') return;
        if (ctx.givenRole(leaf) !== 'redundant') return;
        add(leaf.line(),
          `Given on ${leaf.constraint.cell} allows every value the Shape already `
          + 'allows; it does nothing');
      },
    }),
  },
  {
    code: 'duplicate-cells',
    tier: 'exact',
    summary: 'an all-different constraint repeats a cell, making it unsatisfiable',
    docs: 'AllDifferent / Cage / Renban all carry all-different semantics, so a\n'
      + 'repeated cell cannot differ from itself. Always a bug in the cell list.',
    make: () => ({
      collect(leaf, ctx, add) {
        if (!['AllDifferent', 'Cage', 'Renban'].includes(leaf.type)) return;
        if (new Set(leaf.cells).size === leaf.cells.length) return;
        add(leaf.line(),
          `${leaf.type} on ${describeCells(leaf.cells)} repeats a cell, making it `
          + 'unsatisfiable under its all-different semantics');
      },
    }),
  },
  {
    code: 'redundant-all-different',
    tier: 'exact',
    summary: 'AllDifferent duplicates a row/column/box the engine already enforces',
    docs: 'Boxes count only when NoBoxes is absent. Or-branch constraints are\n'
      + 'alternatives, not facts, so they are skipped.',
    make: () => ({
      collect(leaf, ctx, add) {
        if (leaf.type !== 'AllDifferent' || leaf.inOr) return;
        const house = ctx.houses.get([...leaf.cells].sort().join(','));
        if (!house) return;
        add(leaf.line(),
          `AllDifferent duplicates ${house}, which the engine already enforces`);
      },
    }),
  },
  {
    code: 'handrolled-boxes',
    tier: 'exact',
    summary: 'NoBoxes plus AllDifferent groups that rebuild a tiling the engine can '
      + 'give you; drop them, or name it with RegionSize',
    docs: 'NoBoxes exists for a jigsaw -- regions the engine cannot derive. Rebuilding\n'
      + 'a tiling it *can* derive is dead weight that hides the real jigsaws, and it is\n'
      + 'usually written by an author unsure whether a widened alphabet moves the boxes\n'
      + '(it does not; only RegionSize does).\n'
      + 'Checked against every size the engine could tile this grid with, not just the\n'
      + 'default: a match on the default means delete both, a match on another size\n'
      + 'means say RegionSize~<n> instead. A tiling it cannot produce is a real jigsaw,\n'
      + 'and stays silent.',
    make: () => {
      const groups = [];
      let firstLine = null;
      return {
        collect(leaf) {
          if (leaf.type !== 'AllDifferent' || leaf.inOr) return;
          groups.push(new Set(leaf.cells));
          firstLine ??= leaf.line();
        },
        finalize(ctx, add) {
          if (!ctx.hasNoBoxes || !groups.length) return;
          const { geometry } = ctx;

          const covers = (boxes) => boxes.length && boxes.every(
            box => groups.some(group =>
              group.size === box.length && box.every(cell => group.has(cell))));

          const defaultSize = CellGeometry.defaultNumValues(
            geometry.numRows, geometry.numCols);

          // Every size the engine could actually tile this grid with. A size with no
          // valid dims yields no boxes at all, and a box larger than the alphabet
          // cannot be all-different -- neither is a tiling anyone could have meant.
          for (let size = 2; size <= geometry.numValues; size++) {
            if (geometry.numGridCells % size !== 0) continue;
            const boxes = SudokuConstraintBase.boxRegions(geometry, size)
              .map(cells => cells.map(index => geometry.makeCellIdFromIndex(index)));
            if (!covers(boxes)) continue;

            add(firstLine, size === defaultSize
              ? `NoBoxes plus ${boxes.length} AllDifferent groups that are exactly the `
                + 'default boxes; delete both -- a widened alphabet does not move the '
                + 'box tiling, only RegionSize does'
              : `NoBoxes plus ${boxes.length} AllDifferent groups that are exactly the `
                + `boxes for RegionSize~${size}; use RegionSize~${size} instead`);
            return;
          }
        },
      };
    },
  },
  {
    code: 'stamped-copies-without-replicate',
    tier: 'exact',
    summary: 'many constraints share one machine (or one Given value set) and are '
      + 'shifted copies of one template; use Replicate',
    docs: 'Decided, not guessed: the instances must really be one template under a\n'
      + 'shift, inside one cell group. Sharing a machine is not enough -- the same\n'
      + 'machine over differently-shaped cell sets has no single template to stamp.\n'
      + 'Judged per group, so a script already using Replicate for one rule can still\n'
      + 'be flagged for another it stamped by hand.',
    make: () => {
      const copiesByKey = new Map();
      const addCopy = (key, cells) => {
        if (!copiesByKey.has(key)) copiesByKey.set(key, []);
        copiesByKey.get(key).push(cells);
      };
      return {
        collect(leaf, ctx) {
          // A constraint inside a Replicate is already stamped: it is the
          // template, not an un-Replicated copy of one.
          if (leaf.inReplicate) return;
          if (leaf.type === 'NFA') {
            // Key by machine AND arity: Replicate stamps one fixed-shape template,
            // so instances of the same machine over different cell counts (a degree
            // check over 2/3/4 neighbours, say) cannot share one Replicate.
            addCopy(`NFA\0${leaf.constraint.encodedNFA}\0${leaf.cells.length}`, leaf.cells);
          } else if (leaf.type === 'Given' && ctx.givenRole(leaf) === 'fact') {
            // Identical Givens (same value set) are Replicate candidates -- Replicate
            // shifts the cell and keeps the values -- even though they serialize onto
            // one line. Common as "restrict every cell to 1-N" on an extended Shape.
            const valueSig = [...(leaf.constraint.values || [])]
              .sort((a, b) => a - b).join('_');
            addCopy(`Given\0${valueSig}`, [leaf.constraint.cell]);
          }
        },
        finalize(ctx, add) {
          for (const [copyKey, instances] of copiesByKey) {
            if (instances.length < STAMPED_COPY_THRESHOLD) continue;
            if (!isReplicableGroup(instances, ctx.positionOf)) continue;
            const type = copyKey.split('\0')[0];
            const shared = type === 'Given' ? 'one value set' : 'one machine';
            add(1, `${instances.length} ${type} constraints share ${shared} and are shifted `
              + 'copies of one template; use Replicate to shorten the encoding');
          }
        },
      };
    },
  },
  {
    code: 'replicated-domain-skips-clue-cells',
    tier: 'exact',
    summary: 'a Replicate stamps a Given domain over a cell group but skips cells '
      + 'a narrower Given already pins; stamp it over the whole group',
    docs: 'Two RAW Givens on a cell merge (Given\'s uniqueness key is the cell), so a\n'
      + 'hand-stamped domain and one that filtered its clue cells out serialize\n'
      + 'identically -- indistinguishable, hence not linted. A Given inside a\n'
      + 'Replicate does NOT merge with a raw one, so once the domain is Replicate\'d\n'
      + 'the skipped cells are visible, and skipping them is pointless: the two\n'
      + 'intersect, so the narrower clue still wins. Fires only when the clue is a\n'
      + 'strict subset of the domain -- a clue outside it would intersect to nothing.',
    make: () => {
      const givens = [];
      return {
        collect(leaf, ctx) {
          if (leaf.type !== 'Given' || ctx.givenRole(leaf) !== 'fact') return;
          givens.push({
            cell: leaf.constraint.cell,
            values: new Set(leaf.constraint.values || []),
          });
        },
        finalize(ctx, add) {
          if (!ctx.cellContext) return;
          for (const replicate of ctx.replicateNodes) {
            let targets;
            try {
              targets = new Set(SudokuConstraint.Replicate
                .decodeTargetCells(
                  replicate.targetBitset, replicate.origin, ctx.cellContext.geometry)
                .map(index => ctx.cellContext.geometry.makeCellIdFromIndex(index)));
            } catch (e) {
              continue;
            }
            for (const child of replicate.constraints) {
              if (child.type !== 'Given' || child.cell !== replicate.origin) continue;
              const domain = new Set(child.values || []);
              const subgraph = ctx.positionOf(replicate.origin)?.[2];
              if (subgraph === undefined) continue;
              // Raw Givens elsewhere in the same cell group. The template sits on the
              // origin, which is always a target, so it never appears here.
              const skipped = givens.filter(given =>
                !targets.has(given.cell)
                && ctx.positionOf(given.cell)?.[2] === subgraph
                && given.values.size < domain.size
                && [...given.values].every(value => domain.has(value)));
              if (!skipped.length) continue;
              add(ctx.findLine('Replicate', null),
                'a Replicate stamps a Given domain over this cell group but skips '
                + `${skipped.length} cell(s) that a narrower Given already pins; the two `
                + 'intersect, so stamp the domain over the whole group instead');
            }
          }
        },
      };
    },
  },
  {
    code: 'cell-context-unavailable',
    tier: 'info',
    summary: 'cell positions are unavailable, so the Replicate rules did not run',
    docs: 'Not a finding about the constraints: a coverage note. Cell positions come\n'
      + 'from resolving the tree through SudokuBuilder, and when that fails,\n'
      + 'stamped-copies-without-replicate and replicated-domain-skips-clue-cells\n'
      + 'cannot run. Silence would report the file as OK with two rules quietly off.',
    make: () => ({
      finalize(ctx, add) {
        if (ctx.cellContext) return;
        add(1, 'the builder could not resolve this constraint tree, so cell positions '
          + 'are unavailable; stamped-copies-without-replicate and '
          + 'replicated-domain-skips-clue-cells were not checked');
      },
    }),
  },
];

export const lintConstraintText = (text) => {
  const ctx = makeContext(text);
  const items = [];
  const rules = OUTPUT_RULES.map(
    rule => ({ code: rule.code, ...rule.make() }));
  const adder = (rule) =>
    (line, message) => items.push({ line, code: rule.code, message });

  // Leaves outer, rules inner: every rule sees the leaves in file order, which
  // is the order its findings are reported in.
  for (const leaf of ctx.leaves) {
    for (const rule of rules) rule.collect?.(leaf, ctx, adder(rule));
  }
  for (const rule of rules) rule.finalize?.(ctx, adder(rule));

  return dedupeGuidance(items);
};

export const main = async (argv) => runLintCli({
  argv,
  usage: USAGE,
  rules: OUTPUT_RULES,
  flags: { '--script': 'script' },
  noFilesError: 'No inputs specified. Pass .iss files, or - for stdin.',
  lintFile: async (file, raw, args) => {
    try {
      const text = args.script ? await runSandboxToConstraint(raw) : raw;
      return lintConstraintText(text);
    } catch (err) {
      // The shell reports this as `<file>:1: error:` and fails the run; say
      // which stage failed, since a bare parser message has no context.
      throw new Error(`failed to lint constraints: ${err.message}`);
    }
  },
});

runAsCli(import.meta.url, main);
