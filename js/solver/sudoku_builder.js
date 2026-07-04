const { SudokuConstraint, SudokuConstraintBase, CellArgs } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuSolver } = await import('./engine.js' + self.VERSION_PARAM);
const { regexToNFA, NFASerializer } = await import('../nfa_builder.js' + self.VERSION_PARAM);
const { memoize } = await import('../util.js' + self.VERSION_PARAM);
const HandlerModule = await import('./handlers.js' + self.VERSION_PARAM);
const SumHandlerModule = await import('./sum_handler.js' + self.VERSION_PARAM);
const NFAHandlerModule = await import('./nfa_handler.js' + self.VERSION_PARAM);
const ChaosHandlerModule = await import('./chaos_handler.js' + self.VERSION_PARAM);

const { InvalidConstraintError } = HandlerModule;

export class SudokuBuilder {
  static build(constraint, debugOptions) {
    const geometry = constraint.getGeometry();
    const constraintMap = constraint.toMap();
    // The geometry enforces the cell-count limit here (throws if too many cells).
    geometry.addVarCellsForConstraints([].concat(...constraintMap.values()));

    const handlers = [...this._handlers(constraintMap, geometry)];

    return new SudokuSolver(handlers, geometry, debugOptions);
  }

  static resolveConstraint(constraint) {
    const cls = SudokuConstraint[constraint.type];
    const args = (constraint.args || []).slice();

    if (cls.IS_COMPOSITE) {
      args[0] = (constraint.constraints || []).map(c => this.resolveConstraint(c));
    }

    return new cls(...args);
  }

  static *_handlers(constraintMap, geometry) {
    yield* this._rowColHandlers(geometry);

    const boxRegions = this._getBoxRegions(geometry, constraintMap);
    yield new HandlerModule.BoxRegionInfo(boxRegions);
    yield* this._boxHandlers(boxRegions);

    yield* this._constraintHandlers(constraintMap, geometry);
  }

  // Get box regions, respecting NoBoxes and RegionSize constraints.
  static _getBoxRegions(geometry, constraintMap) {
    if (constraintMap.has('NoBoxes')) return [];

    const size = this._getEffectiveBoxSize(constraintMap);
    return SudokuConstraintBase.boxRegions(geometry, size);
  }

  // Get the effective box size from RegionSize constraint, or null for default.
  static _getEffectiveBoxSize(constraintMap) {
    const regionSizeConstraints = constraintMap.get('RegionSize');
    return regionSizeConstraints?.[0]?.size ?? null;
  }

  static *_rowColHandlers(geometry) {
    for (const cells of SudokuConstraintBase.rowRegions(geometry)) {
      yield new HandlerModule.AllDifferent(cells);
    }
    for (const cells of SudokuConstraintBase.colRegions(geometry)) {
      yield new HandlerModule.AllDifferent(cells);
    }
  }

  static *_boxHandlers(boxRegions) {
    for (const cells of boxRegions) {
      yield new HandlerModule.AllDifferent(cells);
    }
  }

  static *_strictAdjHandlers(constraints, geometry, fnKey) {
    const numCells = geometry.numGridCells;
    const intCmp = (a, b) => a - b;
    const pairId = p => p[0] + p[1] * numCells;

    // Find all the cell pairs that have constraints.
    const cellPairs = constraints
      .flatMap(c => c.adjacentPairs(geometry));
    cellPairs.forEach(p => p.sort(intCmp));
    const pairIds = new Set(cellPairs.map(pairId));

    // Add negative constraints for all other cell pairs.
    for (const p of this._allAdjacentCellPairs(geometry)) {
      p.sort(intCmp);
      if (pairIds.has(pairId(p))) continue;
      yield new HandlerModule.BinaryConstraint(
        p[0], p[1], fnKey);
    }
  }

  // Helper to create a given handler for a single cell/value pair.
  static _givenHandler(cell, value) {
    const givensMap = new Map();
    givensMap.set(cell, [value]);
    return new HandlerModule.GivenCandidates(givensMap);
  }

  static * _regionSumLineHandlers(cells, regions, geometry) {
    // Map cells to regions.
    const cellToRegion = new Map();
    for (const region of regions) {
      for (const cell of region) cellToRegion.set(cell, region);
    }

    // Split cells into sections of equal sum.
    const cellSets = [];
    let curSet = null;
    let curRegion = null;
    for (const cell of cells) {
      const newRegion = cellToRegion.get(cell);
      if (newRegion !== curRegion) {
        curRegion = newRegion;
        curSet = [];
        cellSets.push(curSet);
      }
      curSet.push(cell);
    }

    yield* this._equalSumHandlers(cellSets, geometry);
  }

  // Emit handlers enforcing that every cell set in `cellSets` has the same sum.
  static * _equalSumHandlers(cellSets, geometry) {
    const singles = cellSets.filter(s => s.length === 1).map(s => s[0]);
    const multis = cellSets.filter(s => s.length > 1);

    if (singles.length > 1) {
      const key = SudokuConstraint.SameValues.fnKey(
        geometry.numValues, geometry.valueOffset);
      yield new HandlerModule.BinaryPairwise(
        key, ...singles);
    }

    if (singles.length > 0) {
      // If there are any singles, then use it to constrain every
      // multi. The viable sums can propagate through any of the
      // singles.
      const singleCell = singles[0];
      for (let i = 0; i < multis.length; i++) {
        yield SumHandlerModule.Sum.makeEqual([singleCell], multis[i]);
      }
    } else {
      // Otherwise set up an equal sum constraint between every
      // pair of multis.
      for (let i = 1; i < multis.length; i++) {
        for (let j = 0; j < i; j++) {
          yield SumHandlerModule.Sum.makeEqual(multis[i], multis[j]);
        }
      }
    }
  }

  static _regionSize(constraintMap, geometry) {
    return constraintMap.get('RegionSize')?.[0]?.size
      ?? geometry.constructor.defaultNumValues(geometry.numRows, geometry.numCols);
  }

  static * _constraintHandlers(constraintMap, geometry) {
    const constraints = [].concat(...constraintMap.values());

    for (const constraint of constraints) {
      // Validate constraint is compatible with the geometry.
      const validateShape = constraint.constructor.VALIDATE_SHAPE_FN;
      if (validateShape && !validateShape(geometry)) {
        throw new InvalidConstraintError(
          `${constraint.constructor.displayName()} is not compatible with ` +
          `grid ${geometry.name}.`);
      }

      let cells;
      switch (constraint.type) {
        case 'Doppelganger':
          yield* this._doppelgangerHandlers(geometry, constraintMap);
          break;

        case 'AntiKnight':
          yield* this._antiHandlers(geometry,
            (r, c) => [[r + 1, c + 2], [r + 2, c + 1], [r + 1, c - 2], [r + 2, c - 1]]);
          break;

        case 'AntiKing':
          yield* this._antiHandlers(geometry, (r, c) => [[r + 1, c + 1], [r + 1, c - 1]]);
          break;

        case 'AntiConsecutive':
          yield* this._antiConsecutiveHandlers(geometry);
          break;

        case 'AntiTaxicab':
          if (geometry.valueOffset !== 0) {
            throw new InvalidConstraintError(
              'Anti-Taxicab is incompatible with 0-based values.');
          }
          {
            for (let i = 0; i < geometry.numGridCells; i++) {
              const valueMap = [];
              for (let d = 1; d <= geometry.numValues; d++) {
                const [r, c] = geometry.splitCellIndex(i);
                valueMap.push(
                  SudokuConstraint.AntiTaxicab.taxicabCells(r, c, d, geometry));
              }
              yield new HandlerModule.ValueDependentUniqueValueExclusion(
                i, valueMap);
            }
          }
          break;

        case 'Jigsaw':
          {
            if (constraint.shapeSpec !== geometry.name) {
              throw new InvalidConstraintError(
                `Jigsaw shapeSpec ${constraint.shapeSpec} does not match ` +
                `puzzle geometry ${geometry.name}`);
            }
            cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
            const regionSize = this._regionSize(constraintMap, geometry);
            if (cells.length !== regionSize) {
              throw new InvalidConstraintError(
                `Jigsaw pieces must have ${regionSize} cells for the current geometry.`);
            }
            yield new HandlerModule.AllDifferent(cells);
            // Just to let the solver know that this is a jigsaw puzzle.
            yield new HandlerModule.JigsawPiece(cells);
          }
          break;

        case 'ChaosConstruction':
          {
            const regionSize = this._regionSize(constraintMap, geometry);
            if (regionSize < 2) {
              throw new InvalidConstraintError(
                'Chaos Construction requires a region size of at least 2.');
            }
            if (geometry.numGridCells % regionSize !== 0) {
              throw new InvalidConstraintError(
                'Chaos Construction requires grid cell count to be divisible by region size.');
            }
            const regionCells = geometry.varCellsForGroup('CC');
            if (!regionCells || regionCells.length !== geometry.numGridCells) {
              throw new InvalidConstraintError(
                'Chaos Construction requires one region cell for every grid cell.');
            }
            const regionCellOffset = regionCells[0];
            for (let i = 0; i < regionCells.length; i++) {
              if (regionCells[i] !== regionCellOffset + i) {
                throw new InvalidConstraintError(
                  'Chaos Construction requires contiguous region cells.');
              }
            }
            yield new ChaosHandlerModule.ChaosConstruction(geometry.numGridCells, regionCellOffset, regionSize);
          }
          break;

        case 'ChaosArrow':
          {
            const regionCells = geometry.varCellsForGroup('CC');
            if (!regionCells || regionCells.length !== geometry.numGridCells) {
              throw new InvalidConstraintError('ChaosArrow requires Chaos Construction.');
            }
            const controlCell = geometry.parseCellId(constraint.cells[0]).cell;
            const regionCellOffset = regionCells[0];
            const regionCellLimit = regionCellOffset + regionCells.length;
            const chaosArms = constraint.expandedArms(geometry)
              .map(arm => arm.map(cellId => geometry.parseCellId(cellId).cell));
            if (chaosArms.flat().some(c => c < regionCellOffset || c >= regionCellLimit)) {
              throw new InvalidConstraintError(
                'ChaosArrow cells after the control cell must be Chaos Construction region cells.');
            }
            const regionRunArms = chaosArms.map(arm => arm.map(c => c - regionCellOffset));
            yield new ChaosHandlerModule.ChaosArrow(
              controlCell, chaosArms, regionRunArms, constraint.offset);
          }
          break;

        case 'ChaosCount':
          {
            const regionCells = geometry.varCellsForGroup('CC');
            if (!regionCells || regionCells.length !== geometry.numGridCells) {
              throw new InvalidConstraintError('ChaosCount requires Chaos Construction.');
            }
            const controlCell = geometry.parseCellId(constraint.cells[0]).cell;
            const regionCellOffset = regionCells[0];
            const regionCellLimit = regionCellOffset + regionCells.length;
            const countCells = constraint.expandedRegionCells(geometry)
              .map(c => geometry.parseCellId(c).cell);
            if (countCells.some(c => c < regionCellOffset || c >= regionCellLimit)) {
              throw new InvalidConstraintError(
                'ChaosCount cells after the control cell must be Chaos Construction region cells.');
            }
            const regionRunCells = countCells.map(c => c - regionCellOffset);
            yield new ChaosHandlerModule.ChaosCount(
              controlCell, countCells, regionRunCells, constraint.offset);
          }
          break;

        case 'Diagonal':
          if (!geometry.isSquare()) {
            throw new InvalidConstraintError('Diagonal constraint requires a square grid');
          }
          cells = [];
          for (let r = 0; r < geometry.numRows; r++) {
            let c = constraint.direction > 0 ? geometry.numCols - r - 1 : r;
            cells.push(geometry.cellIndex(r, c));
          }
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'Arrow':
          {
            const cells = (
              constraint.cells.map(c => geometry.parseCellId(c).cell));
            yield SumHandlerModule.Sum.makeEqual(
              [cells[0]], cells.slice(1));
          }
          break;

        case 'DoubleArrow':
          {
            const cells = (
              constraint.cells.map(c => geometry.parseCellId(c).cell));

            const center = cells.splice(1, cells.length - 2);
            yield SumHandlerModule.Sum.makeEqual(cells, center);
          }
          break;

        case 'PillArrow':
          {
            const pillSize = constraint.pillSize;
            if (pillSize !== 2 && pillSize !== 3) {
              throw new InvalidConstraintError('Pill size must be 2 or 3');
            }
            const cells = (
              constraint.cells.map(c => geometry.parseCellId(c).cell));
            if (cells.length <= pillSize) {
              throw new InvalidConstraintError(
                'Pill Arrow must have more cells than the pill size');
            }

            const pillCells = cells.slice(0, pillSize);
            pillCells.sort((a, b) => a - b);

            cells.splice(0, pillSize, ...pillCells);
            const coeffs = cells.map(_ => 1);
            for (let i = 0; i < pillSize; i++) {
              cells[i] = pillCells[i];
              coeffs[i] = -Math.pow(10, pillSize - i - 1);
            }

            yield new SumHandlerModule.Sum(cells, 0, coeffs);

            if (geometry.numValues > 9) {
              // Limit pill values to 1-9, other than the first cell.
              const values = [...Array(9).keys()].map(i => i + 1);
              for (let i = 1; i < pillSize; i++) {
                yield this._givenHandler(pillCells[i], values);
              }
            }
          }
          break;

        case 'Cage':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          // A sum of 0 means any sum is ok - i.e. the same as AllDifferent.
          if (constraint.sum !== 0) {
            yield new SumHandlerModule.Sum(cells, constraint.sum);
          }
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'RellikCage':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Rellik(cells, constraint.sum);
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'EqualityCage':
          {
            cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
            const allValues = geometry.allValues();
            const half = allValues.length >> 1;
            yield new HandlerModule.AllDifferent(cells);
            // Odd-even partition.
            yield new HandlerModule.EqualSizePartitions(
              cells,
              allValues.filter(v => v % 2 === 0),
              allValues.filter(v => v % 2 === 1));
            // Low-high partition.
            yield new HandlerModule.EqualSizePartitions(
              cells,
              allValues.slice(0, half),
              allValues.slice(allValues.length - half));
          }
          break;

        case 'Sum':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new SumHandlerModule.Sum(
            cells, constraint.sum, constraint.coeffs || undefined);
          break;

        case 'Regex':
          {
            const cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
            const nfa = compileRegex(constraint.pattern, geometry.numValues, geometry.valueOffset);
            yield new NFAHandlerModule.NFAConstraint(cells, nfa);
          }
          break;

        case 'NFA':
          {
            const cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
            const nfa = compileNFA(constraint.encodedNFA, geometry.numValues);
            yield new NFAHandlerModule.NFAConstraint(cells, nfa);
          }
          break;

        case 'LittleKiller':
          cells = constraint.getCells(geometry)?.map(
            c => geometry.parseCellId(c).cell);
          if (!cells) throw new InvalidConstraintError('Invalid Little Killer line: ' + constraint.arrowId);
          yield new SumHandlerModule.Sum(
            cells, constraint.value);
          break;

        case 'XSum':
          {
            const cells = constraint.getCells(geometry).map(
              c => geometry.parseCellId(c).cell);
            const sum = constraint.value;
            const controlCell = cells[0];

            if (sum === 1) {
              yield this._givenHandler(controlCell, 1);
              break;
            }

            const branches = [];
            for (let i = 2; i <= cells.length; i++) {
              const sumRem = sum - i;
              if (sumRem < 0) break;
              branches.push([
                this._givenHandler(controlCell, i),
                new SumHandlerModule.Sum(
                  cells.slice(1, i), sumRem),
              ]);
            }
            yield* this._yieldOr(branches);
          }
          break;

        case 'Sandwich':
          cells = constraint.getCells(geometry).map(
            c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Lunchbox(cells, constraint.value);
          break;

        case 'Lunchbox':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Lunchbox(cells, constraint.sum);
          break;

        case 'Skyscraper':
          cells = constraint.getCells(geometry).map(
            c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Skyscraper(
            cells, constraint.value);
          break;

        case 'HiddenSkyscraper':
          cells = constraint.getCells(geometry).map(
            c => geometry.parseCellId(c).cell);
          yield new HandlerModule.HiddenSkyscraper(
            cells, constraint.value);
          break;

        case 'NumberedRoom':
          cells = constraint.getCells(geometry).map(
            c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Indexing(
            cells[0], cells, constraint.value);
          break;

        case 'AllDifferent':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'Given':
          {
            const cell = geometry.parseCellId(constraint.cell).cell;
            const valueMap = new Map();
            valueMap.set(cell, constraint.values);
            yield new HandlerModule.GivenCandidates(valueMap);
          }
          break;

        case 'Thermo':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          for (let i = 1; i < cells.length; i++) {
            yield new HandlerModule.BinaryConstraint(
              cells[i - 1], cells[i],
              SudokuConstraint.Thermo.fnKey(geometry.numValues, geometry.valueOffset));
          }
          break;

        case 'Whisper':
          let difference = constraint.difference;
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          for (let i = 1; i < cells.length; i++) {
            yield new HandlerModule.BinaryConstraint(
              cells[i - 1], cells[i],
              SudokuConstraint.Whisper.fnKey(difference, geometry.numValues, geometry.valueOffset));
          }
          break;

        case 'Renban':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          {
            const handler = new HandlerModule.BinaryPairwise(
              SudokuConstraint.Renban.fnKey(cells.length, geometry.numValues, geometry.valueOffset),
              ...cells);
            handler.enableHiddenSingles();
            yield handler;
          }
          break;

        case 'Modular':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          {
            const mod = constraint.mod;
            // First `mod` cells must all be different mod n.
            const firstCells = cells.slice(0, mod);
            const handler = new HandlerModule.BinaryPairwise(
              SudokuConstraint.Modular.neqFnKey(mod, geometry.numValues, geometry.valueOffset),
              ...firstCells);
            yield handler;
            // Cells at positions i, i+mod, i+2*mod, ... must all be equal mod n.
            const eqKey = SudokuConstraint.Modular.eqFnKey(mod, geometry.numValues, geometry.valueOffset);
            for (let i = 0; i < mod; i++) {
              const equalCells = [];
              for (let j = i; j < cells.length; j += mod) {
                equalCells.push(cells[j]);
              }
              if (equalCells.length > 1) {
                yield new HandlerModule.BinaryPairwise(eqKey, ...equalCells);
              }
            }
          }
          break;

        case 'Entropic':
          if (geometry.numValues !== 9 || geometry.valueOffset !== 0) {
            throw new InvalidConstraintError(
              'Entropic Line requires exactly 9 values (1-9)');
          }
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          if (cells.length < 3) {
            const handler = new HandlerModule.BinaryPairwise(
              SudokuConstraint.Entropic.fnKey(geometry.numValues),
              ...cells);
            yield handler;
          } else {
            for (let i = 3; i <= cells.length; i++) {
              const handler = new HandlerModule.BinaryPairwise(
                SudokuConstraint.Entropic.fnKey(geometry.numValues),
                ...cells.slice(i - 3, i));
              yield handler;
            }
          }
          break;


        case 'RegionSumLine':
          {
            if (constraintMap.has('ChaosConstruction')) {
              throw new InvalidConstraintError(
                'RegionSumLine is not supported with Chaos Construction.');
            }
            cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
            const boxRegions = this._getBoxRegions(geometry, constraintMap);
            if (boxRegions.length) {
              yield* this._regionSumLineHandlers(cells, boxRegions, geometry);
            } else if (constraintMap.has('Jigsaw')) {
              // If no boxes, try to use the jigsaw regions.
              const jigsawConstraints = constraintMap.get('Jigsaw');
              const regions = jigsawConstraints.map(
                c => c.cells.map(c => geometry.parseCellId(c).cell));
              yield* this._regionSumLineHandlers(cells, regions, geometry);
            } else {
              // There are no regions, so the constraint is trivially satisfied.
            }
          }
          break;

        case 'Between':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Between(cells);
          break;

        case 'Lockout':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new HandlerModule.Lockout(constraint.minDiff, cells);
          break;

        case 'Palindrome':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          const numCells = cells.length;
          for (let i = 0; i < numCells / 2; i++) {
            yield new HandlerModule.BinaryConstraint(
              cells[i], cells[numCells - 1 - i],
              SudokuConstraint.Palindrome.fnKey(geometry.numValues, geometry.valueOffset));
          }
          break;
        case 'Zipper':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          {
            const pairs = [];
            const numCells = cells.length;
            for (let i = 0; i < ((numCells / 2) | 0); i++) {
              pairs.push([cells[i], cells[numCells - 1 - i]]);
            }
            if (numCells % 2 === 1) {
              // If there are an odd numbers of cells, then treat this as a
              // set of arrows from the center cell to each pair.
              // We don't bother to also add constraints between each pair, as
              // the constraint on the total sum should propagate through the
              // center cell.
              const centerCell = [cells[(numCells / 2) | 0]];
              for (const pair of pairs) {
                yield SumHandlerModule.Sum.makeEqual(centerCell, pair);
              }
            } else {
              // Otherwise create an equal sum constraint between each pair.
              const numPairs = pairs.length;
              for (let i = 1; i < numPairs; i++) {
                for (let j = 0; j < i; j++) {
                  yield SumHandlerModule.Sum.makeEqual(pairs[i], pairs[j]);
                }
              }
            }
          }
          break;

        case 'SumLine':
          cells = new CellArgs(constraint.cells, constraint.type);
          yield new HandlerModule.SumLine(
            cells.cellIds(geometry), cells.isLoop(), constraint.sum);
          break;

        case 'WhiteDot':
          for (const [a, b] of constraint.adjacentPairs(geometry)) {
            yield new HandlerModule.BinaryConstraint(
              a, b,
              SudokuConstraint.WhiteDot.fnKey(geometry.numValues, geometry.valueOffset));
          }
          break;

        case 'BlackDot':
          for (const [a, b] of constraint.adjacentPairs(geometry)) {
            yield new HandlerModule.BinaryConstraint(
              a, b,
              SudokuConstraint.BlackDot.fnKey(geometry.numValues, geometry.valueOffset));
          }
          break;

        case 'X':
          for (const pair of constraint.adjacentPairs(geometry)) {
            yield new SumHandlerModule.Sum(pair, 10);
          }
          break;

        case 'V':
          for (const pair of constraint.adjacentPairs(geometry)) {
            yield new SumHandlerModule.Sum(pair, 5);
          }
          break;

        case 'GreaterThan': {
          const fn = SudokuConstraint.GreaterThan.fnKey(geometry.numValues, geometry.valueOffset);
          for (const [a, b] of constraint.adjacentPairs(geometry)) {
            yield new HandlerModule.BinaryConstraint(a, b, fn);
          }
          break;
        }

        case 'ValueIndexing':
          {
            const cells = constraint.cells.map(
              c => geometry.parseCellId(c).cell);
            yield new HandlerModule.ValueIndexing(...cells);
          }
          break;
        case 'Windoku':
          for (const cells of SudokuConstraint.Windoku.regions(
            geometry, this._getEffectiveBoxSize(constraintMap))) {
            yield new HandlerModule.AllDifferent(cells);
          }
          break;

        case 'DisjointSets':
          for (const cells of SudokuConstraintBase.disjointSetRegions(
            geometry, this._getEffectiveBoxSize(constraintMap))) {
            yield new HandlerModule.AllDifferent(cells);
          }
          break;

        case 'GlobalEntropy':
          if (geometry.numValues !== 9 || geometry.valueOffset !== 0) {
            throw new InvalidConstraintError(
              'Global Entropy requires exactly 9 values (1-9)');
          }
          for (const cells of SudokuConstraintBase.square2x2Regions(geometry)) {
            yield new HandlerModule.LocalEntropy(cells);
          }
          break;

        case 'GlobalMod':
          for (const cells of SudokuConstraintBase.square2x2Regions(geometry)) {
            yield new HandlerModule.LocalMod3(cells);
          }
          break;

        case 'FullRankTies':
          yield new HandlerModule.FullRank(
            geometry.numGridCells, [], fullRankTieMode(constraint));
          break;

        case 'DutchFlatmates':
          if (geometry.valueOffset !== 0) {
            throw new InvalidConstraintError(
              'Dutch Flatmates does not support shifted value ranges.');
          }
          for (const cells of SudokuConstraintBase.colRegions(geometry)) {
            yield new HandlerModule.DutchFlatmateLine(cells);
          }
          break;

        case 'ContainAtLeast':
          yield new HandlerModule.RequiredValues(
            constraint.cells.map(c => geometry.parseCellId(c).cell),
            constraint.values.split('_').map(v => +v),
            /* strict = */ false);
          break;

        case 'ContainExact':
          yield new HandlerModule.RequiredValues(
            constraint.cells.map(c => geometry.parseCellId(c).cell),
            constraint.values.split('_').map(v => +v),
            /* strict = */ true);
          break;

        case 'RegionSameValues':
          {
            const regions = [];

            if (constraintMap.has('Jigsaw')) {
              const jigsawConstraints = constraintMap.get('Jigsaw');
              const jigsawRegions = jigsawConstraints.map(
                c => c.cells.map(id => geometry.parseCellId(id).cell));

              regions.push(...jigsawRegions);
            }

            regions.push(...SudokuConstraintBase.rowRegions(geometry));
            regions.push(...SudokuConstraintBase.colRegions(geometry));
            regions.push(...this._getBoxRegions(geometry, constraintMap));

            // We only want the largest regions.
            const maxSize = Math.max(...regions.map(r => r.length));
            const filteredRegions = regions.filter(r => r.length === maxSize);

            if (maxSize !== geometry.numValues && filteredRegions.length >= 2) {
              yield new HandlerModule.SameValues(...filteredRegions);
            }
          }
          break;

        case 'SameValues':
          {
            if (constraint.numSets < constraint.cells.length) {
              let sets = constraint.splitCells();
              sets = sets.map(cells => cells.map(c => geometry.parseCellId(c).cell));
              yield new HandlerModule.SameValues(...sets);
            } else {
              // All cells must have the same value, use binary constraints.
              const cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
              const key = SudokuConstraint.SameValues.fnKey(geometry.numValues, geometry.valueOffset);
              yield new HandlerModule.BinaryPairwise(
                key, ...cells);
            }
          }
          break;

        case 'EqualSum':
          {
            const segments = constraint.segments.map(
              s => s.map(c => geometry.parseCellId(c).cell));
            yield* this._equalSumHandlers(segments, geometry);
          }
          break;

        case 'Quad':
          yield new HandlerModule.RequiredValues(
            SudokuConstraint.Quad.cells(
              constraint.topLeftCell, geometry).map(c => geometry.parseCellId(c).cell),
            constraint.values.map(v => +v),
            /* strict = */ false);
          break;

        case 'Pair':
          {
            cells = constraint.cells.map(c => c && geometry.parseCellId(c).cell);
            for (let i = 1; i < cells.length; i++) {
              yield new HandlerModule.BinaryConstraint(
                cells[i - 1], cells[i],
                constraint.key);
            }
          }
          break;

        case 'PairX':
          {
            cells = constraint.cells.map(c => c && geometry.parseCellId(c).cell);
            yield new HandlerModule.BinaryPairwise(
              constraint.key, ...cells);
          }
          break;

        case 'Indexing':
          for (let i = 0; i < constraint.cells.length; i++) {
            const controlCell = geometry.parseCellId(constraint.cells[i]);
            const value =
              constraint.indexType === SudokuConstraint.Indexing.ROW_INDEXING
                ? controlCell.row + 1 : controlCell.col + 1;

            const cells = [];
            const iterCount = constraint.indexType === SudokuConstraint.Indexing.ROW_INDEXING
              ? geometry.numRows : geometry.numCols;
            for (let i = 0; i < iterCount; i++) {
              if (constraint.indexType === SudokuConstraint.Indexing.ROW_INDEXING) {
                cells.push(geometry.cellIndex(i, controlCell.col));
              } else {
                cells.push(geometry.cellIndex(controlCell.row, i));
              }
            }

            yield new HandlerModule.Indexing(
              controlCell.cell, cells, value);
          }
          break;

        case 'FullRank':
          {
            const line = constraint.getCells(geometry).map(
              c => geometry.parseCellId(c).cell);

            yield new HandlerModule.FullRank(
              geometry.numGridCells,
              [{ rank: constraint.value, line }],
              fullRankTieMode(constraintMap.get('FullRankTies')?.[0]));
          }
          break;

        case 'CountingCircles':
          cells = new CellArgs(constraint.cells, constraint.type);
          yield new HandlerModule.CountingCircles(
            cells.cellIds(geometry));
          break;

        case 'CountDistinct':
          {
            const allCells = constraint.cells.map(c => geometry.parseCellId(c).cell);
            yield new HandlerModule.CountDistinct(allCells[0], allCells.slice(1));
          }
          break;

        case 'StrictKropki':
          {
            const types = ['BlackDot', 'WhiteDot'];
            yield* SudokuBuilder._strictAdjHandlers(
              types.flatMap(t => constraintMap.get(t) || []),
              geometry,
              SudokuConstraint.StrictKropki.fnKey(geometry.numValues, geometry.valueOffset));
          }
          break;

        case 'StrictXV':
          {
            const types = ['X', 'V'];
            yield* SudokuBuilder._strictAdjHandlers(
              types.flatMap(t => constraintMap.get(t) || []),
              geometry,
              SudokuConstraint.StrictXV.fnKey(geometry.numValues, geometry.valueOffset));
          }
          break;

        case 'SearchPriority':
          cells = constraint.cells.map(c => geometry.parseCellId(c).cell);
          yield new HandlerModule.SearchPriority(cells, constraint.priority);
          break;

        case 'Or':
          {
            const branches = constraint.constraints.map(
              c => [...this._constraintHandlers(c.toMap(), geometry)]);
            yield* this._yieldOr(branches);
          }
          break;

        case 'Replicate':
          {
            if (constraint.constraints.length === 0) break;

            const originIdx = geometry.parseCellId(constraint.origin).cell;
            const targets = SudokuConstraint.Replicate.decodeTargetCells(
              constraint.targetBitset, constraint.origin, geometry);

            if (targets.length === 0) break;

            const graph = geometry.cellGraph();
            const originPos = graph.cellPosition(originIdx);
            const originSubgraph = originPos[2];

            for (const targetCell of targets) {
              if (graph.cellPosition(targetCell)[2] !== originSubgraph) {
                throw new Error('All Replicate cells must be in the same cell group.');
              }
              const shiftFn = cellId => {
                const cell = geometry.parseCellId(cellId).cell;
                const cellPos = graph.cellPosition(cell);
                if (cellPos[2] !== originSubgraph) {
                  throw new Error('All Replicate constraints must be in the same cell group.');
                }
                const newCell = graph.traverse(
                  targetCell,
                  cellPos[0] - originPos[0],
                  cellPos[1] - originPos[1]);
                if (newCell === null) throw new Error('Shifted cell is out of bounds.');
                return geometry.makeCellIdFromIndex(newCell);
              };
              for (const child of constraint.constraints) {
                yield* this._constraintHandlers(child.makeShifted(shiftFn).toMap(), geometry);
              }
            }
          }
          break;

        case 'And':
          for (const c of constraint.constraints) {
            yield* this._constraintHandlers(c.toMap(), geometry);
          }

        case 'NoBoxes':
        case 'Shape':
        case 'RegionSize':
        case 'Var':
          // Nothing to do here.
          break;

        default:
          throw new InvalidConstraintError('Unknown constraint type: ' + constraint.type);
      }
    }
  }

  static _wrapAnd(handlers) {
    if (handlers.length === 1) return handlers[0];
    return new HandlerModule.And(...handlers);
  }

  static *_yieldOr(branches) {
    if (branches.length === 0) {
      yield new HandlerModule.False();
      return;
    }
    if (branches.length === 1) {
      yield* branches[0];
      return;
    }

    // If any branch is empty (logically true), the whole Or is true.
    if (branches.some(b => b.length === 0)) {
      return;
    }
    yield new HandlerModule.Or(
      ...branches.map(b => this._wrapAnd(b)));
  }

  static * _doppelgangerHandlers(geometry, constraintMap) {
    const regionSize = this._regionSize(constraintMap, geometry);
    const gridSize = geometry.numValues - 1;
    if (geometry.valueOffset !== -1
      || gridSize !== geometry.numRows
      || gridSize !== geometry.numCols
      || gridSize !== regionSize) {
      throw new InvalidConstraintError(
        'Doppelganger requires geometry with values 0-N '
        + '(e.g. 9x9~0-9 for a 9x9 grid).');
    }

    const rowRegions = SudokuConstraintBase.rowRegions(geometry);
    const colRegions = SudokuConstraintBase.colRegions(geometry);
    const boxRegions = this._getBoxRegions(geometry, constraintMap);

    const [zeroCell] = geometry.varCellsForGroup('DGZ');
    const colVarCells = geometry.varCellsForGroup('DGC');
    const rowVarCells = geometry.varCellsForGroup('DGR');
    const boxVarCells = geometry.varCellsForGroup('DGB');

    // Fix the zero cell to value 0. This propagates through the var cell
    // AllDifferent groups to prevent var cells from holding 0 (Rule 1).
    yield new HandlerModule.GivenCandidates(new Map([[zeroCell, [0]]]));

    // If there are no boxes, fix box var cells to 0 so they don't
    // participate in search.
    if (!boxRegions.length) {
      const fixedCells = new Map();
      for (const cell of boxVarCells) fixedCells.set(cell, [0]);
      yield new HandlerModule.GivenCandidates(fixedCells);
    }
    // 10-cell AllDifferent for each region + its var cell.
    // The optimizer will promote these to PerfectAllDifferent.
    for (let i = 0; i < gridSize; i++) {
      yield new HandlerModule.AllDifferent(
        [...rowRegions[i], colVarCells[i]]);
    }
    for (let i = 0; i < gridSize; i++) {
      yield new HandlerModule.AllDifferent(
        [...colRegions[i], rowVarCells[i]]);
    }
    for (let i = 0; i < boxRegions.length; i++) {
      yield new HandlerModule.AllDifferent(
        [...boxRegions[i], boxVarCells[i]]);
    }

    // Rule 2: No two rows/columns/boxes may be missing the same digit.
    // Adding zeroCell makes these N+1 cells with N+1 values, which the
    // optimizer promotes to PerfectAllDifferent.
    yield new HandlerModule.AllDifferent(
      [...colVarCells, zeroCell]);
    yield new HandlerModule.AllDifferent(
      [...rowVarCells, zeroCell]);
    if (boxRegions.length) {
      yield new HandlerModule.AllDifferent(
        [...boxVarCells, zeroCell]);
    }

    // Rule 3: For each 0 in the grid, the digits missing in its row, column,
    // and box must be three different digits.
    const NO_BOX = 255;
    const cellToBox = new Uint8Array(geometry.numGridCells).fill(NO_BOX);
    for (let b = 0; b < boxRegions.length; b++) {
      for (const cell of boxRegions[b]) {
        cellToBox[cell] = b;
      }
    }
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell = geometry.cellIndex(r, c);
        const varCells = [colVarCells[r], rowVarCells[c]];
        const boxIdx = cellToBox[cell];
        if (boxIdx !== NO_BOX) varCells.push(boxVarCells[boxIdx]);
        yield new HandlerModule.DoppelgangerZero(cell, varCells);
      }
    }
  }

  static * _antiHandlers(geometry, exclusionFn) {
    const numRows = geometry.numRows;
    const numCols = geometry.numCols;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const cell = geometry.cellIndex(r, c);
        // We only need half the constraints, as the other half will be
        // added by the corresponding exclusion cell.
        for (const [rr, cc] of exclusionFn(r, c)) {
          if (rr < 0 || rr >= numRows || cc < 0 || cc >= numCols) continue;
          const exclusionCell = geometry.cellIndex(rr, cc);
          yield new HandlerModule.AllDifferent([cell, exclusionCell]);
        }
      }
    }
  }

  static _allAdjacentCellPairs(geometry) {
    const pairs = [];

    const numRows = geometry.numRows;
    const numCols = geometry.numCols;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        let cell = geometry.cellIndex(r, c);
        // Only look at adjacent cells with larger indexes.
        for (const [rr, cc] of [[r + 1, c], [r, c + 1]]) {
          if (rr < 0 || rr >= numRows || cc < 0 || cc >= numCols) continue;
          pairs.push([cell, geometry.cellIndex(rr, cc)]);
        }
      }
    }

    return pairs;
  }

  static * _antiConsecutiveHandlers(geometry) {
    for (const [cell, exclusionCell] of this._allAdjacentCellPairs(geometry)) {
      yield new HandlerModule.BinaryConstraint(
        cell, exclusionCell,
        SudokuConstraint.AntiConsecutive.fnKey(geometry.numValues, geometry.valueOffset));
    }
  }
}

const fullRankTieMode = (fullRankTiesConstraint) => {
  const fullRankTies = fullRankTiesConstraint?.ties || null;
  if (fullRankTies === 'none') {
    return HandlerModule.FullRank.TIE_MODE.NONE;
  } else if (fullRankTies === 'any') {
    return HandlerModule.FullRank.TIE_MODE.ANY;
  } else {
    return HandlerModule.FullRank.TIE_MODE.ONLY_UNCLUED;
  }
};

export const compileRegex = memoize((pattern, numValues, valueOffset = 0) => {
  const nfa = regexToNFA(pattern, numValues, valueOffset);
  return NFAHandlerModule.compressNFA(nfa);
});

export const compileNFA = memoize((encodedNFA, numValues) => {
  const nfa = NFASerializer.deserialize(encodedNFA);
  return NFAHandlerModule.compressNFA(nfa);
});