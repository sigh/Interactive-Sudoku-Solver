const { SudokuConstraint, SudokuConstraintBase, CellArgs } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { SudokuSolver } = await import('./engine.js' + self.VERSION_PARAM);
const { regexToNFA, NFASerializer } = await import('../nfa_parser.js' + self.VERSION_PARAM);
const { memoize } = await import('../util.js' + self.VERSION_PARAM);
const HandlerModule = await import('./handlers.js' + self.VERSION_PARAM);
const SumHandlerModule = await import('./sum_handler.js' + self.VERSION_PARAM);
const DFAHandlerModule = await import('./dfa_handler.js' + self.VERSION_PARAM);

export class SudokuBuilder {
  static build(constraint, debugOptions) {
    const shape = constraint.getShape();

    return new SudokuSolver(
      this._handlers(constraint, shape),
      shape,
      debugOptions);
  }

  static resolveConstraint(constraint) {
    const args = constraint.args;
    const cls = SudokuConstraint[constraint.type];

    if (cls.IS_COMPOSITE) {
      args[0] = constraint.args[0].map(a => this.resolveConstraint(a));
    }
    return new cls(...args);
  }

  static *_handlers(constraint, shape) {
    const constraintMap = constraint.toMap();

    yield* this._rowColHandlers(shape);
    if (constraintMap.has('NoBoxes')) {
      yield new HandlerModule.NoBoxes();
    } else {
      yield* this._boxHandlers(shape);
    }
    yield* this._constraintHandlers(constraintMap, shape);
  }

  static *_rowColHandlers(shape) {
    for (const cells of SudokuConstraintBase.rowRegions(shape)) {
      yield new HandlerModule.AllDifferent(cells);
    }
    for (const cells of SudokuConstraintBase.colRegions(shape)) {
      yield new HandlerModule.AllDifferent(cells);
    }
  }

  static *_boxHandlers(shape) {
    for (const cells of SudokuConstraintBase.boxRegions(shape)) {
      yield new HandlerModule.AllDifferent(cells);
    }
  }

  static *_strictAdjHandlers(constraints, shape, fnKey) {
    const numCells = shape.numCells;
    const intCmp = (a, b) => a - b;
    const pairId = p => p[0] + p[1] * numCells;

    // Find all the cell pairs that have constraints.
    const cellPairs = constraints
      .flatMap(c => c.adjacentPairs(shape));
    cellPairs.forEach(p => p.sort(intCmp));
    const pairIds = new Set(cellPairs.map(pairId));

    // Add negative constraints for all other cell pairs.
    for (const p of this._allAdjacentCellPairs(shape)) {
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

  static * _regionSumLineHandlers(cells, regions, numValues) {
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

    const singles = cellSets.filter(s => s.length == 1).map(s => s[0]);
    const multis = cellSets.filter(s => s.length > 1);

    if (singles.length > 1) {
      const key = SudokuConstraint.SameValues.fnKey(numValues);
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

  static * _constraintHandlers(constraintMap, shape) {
    const gridSize = shape.gridSize;

    const constraints = [].concat(...constraintMap.values());

    for (const constraint of constraints) {
      let cells;
      switch (constraint.type) {
        case 'AntiKnight':
          yield* this._antiHandlers(shape,
            (r, c) => [[r + 1, c + 2], [r + 2, c + 1], [r + 1, c - 2], [r + 2, c - 1]]);
          break;

        case 'AntiKing':
          yield* this._antiHandlers(shape, (r, c) => [[r + 1, c + 1], [r + 1, c - 1]]);
          break;

        case 'AntiConsecutive':
          yield* this._antiConsecutiveHandlers(shape);
          break;

        case 'AntiTaxicab':
          {
            for (let i = 0; i < shape.numCells; i++) {
              const valueMap = [];
              for (let d = 1; d <= shape.numValues; d++) {
                const [r, c] = shape.splitCellIndex(i);
                valueMap.push(
                  SudokuConstraint.AntiTaxicab.taxicabCells(r, c, d, shape));
              }
              yield new HandlerModule.ValueDependentUniqueValueExclusion(
                i, valueMap);
            }
          }
          break;

        case 'Jigsaw':
          {
            cells = constraint.cells.map(c => shape.parseCellId(c).cell);
            yield new HandlerModule.AllDifferent(cells);
            // Just to let the solver know that this is a jigsaw puzzle.
            yield new HandlerModule.JigsawPiece(cells);
          }
          break;

        case 'Diagonal':
          cells = [];
          for (let r = 0; r < gridSize; r++) {
            let c = constraint.direction > 0 ? gridSize - r - 1 : r;
            cells.push(shape.cellIndex(r, c));
          }
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'Arrow':
          {
            const cells = (
              constraint.cells.map(c => shape.parseCellId(c).cell));
            yield SumHandlerModule.Sum.makeEqual(
              [cells[0]], cells.slice(1));
          }
          break;

        case 'DoubleArrow':
          {
            const cells = (
              constraint.cells.map(c => shape.parseCellId(c).cell));

            const center = cells.splice(1, cells.length - 2);
            yield SumHandlerModule.Sum.makeEqual(cells, center);
          }
          break;

        case 'PillArrow':
          {
            const pillSize = constraint.pillSize;
            if (pillSize != 2 && pillSize != 3) {
              throw ('Pill size must be 2 or 3');
            }
            const cells = (
              constraint.cells.map(c => shape.parseCellId(c).cell));

            const pillCells = cells.slice(0, pillSize);
            pillCells.sort((a, b) => a - b);

            cells.splice(0, pillSize, ...pillCells);
            const coeffs = cells.map(_ => 1);
            for (let i = 0; i < pillSize; i++) {
              cells[i] = pillCells[i];
              coeffs[i] = -Math.pow(10, pillSize - i - 1);
            }

            yield new SumHandlerModule.Sum(cells, 0, coeffs);

            if (shape.numValues > 9) {
              // Limit pill values to 1-9, other than the first cell.
              const values = [...Array(9).keys()].map(i => i + 1);
              for (let i = 1; i < pillSize; i++) {
                yield this._givenHandler(pillCells[i], values);
              }
            }
          }
          break;

        case 'Cage':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          // A sum of 0 means any sum is ok - i.e. the same as AllDifferent.
          if (constraint.sum != 0) {
            yield new SumHandlerModule.Sum(cells, constraint.sum);
          }
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'RellikCage':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new HandlerModule.Rellik(cells, constraint.sum);
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'EqualityCage':
          {
            cells = constraint.cells.map(c => shape.parseCellId(c).cell);
            const numValues = constraint.getShape().numValues;
            const allValues = [...Array(numValues).keys()].map(i => i + 1);
            yield new HandlerModule.AllDifferent(cells);
            // Odd-even partition.
            yield new HandlerModule.EqualSizePartitions(
              cells,
              allValues.filter(v => v % 2 === 0),
              allValues.filter(v => v % 2 === 1));
            // Low-high partition.
            yield new HandlerModule.EqualSizePartitions(
              cells,
              allValues.filter(v => v <= numValues / 2),
              allValues.filter(v => v >= numValues / 2 + 1));
          }
          break;

        case 'Sum':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new SumHandlerModule.Sum(cells, constraint.sum);
          break;

        case 'Regex':
          {
            const cells = constraint.cells.map(c => shape.parseCellId(c).cell);
            const dfa = compileRegex(constraint.pattern, shape.numValues);
            yield new DFAHandlerModule.DFALine(cells, dfa);
          }
          break;

        case 'NFA':
          {
            const cells = constraint.cells.map(c => shape.parseCellId(c).cell);
            const encodedNFA = constraint.encodedNFA;
            const dfa = compileNFA(encodedNFA, shape.numValues);
            yield new DFAHandlerModule.DFALine(cells, dfa);
          }
          break;

        case 'LittleKiller':
          cells = constraint.getCells(shape).map(
            c => shape.parseCellId(c).cell);
          yield new SumHandlerModule.Sum(
            cells, constraint.value);
          break;

        case 'XSum':
          {
            const cells = constraint.getCells(shape).map(
              c => shape.parseCellId(c).cell);
            const sum = constraint.value;

            const controlCell = cells[0];

            if (sum === 1) {
              yield this._givenHandler(controlCell, 1);
              break;
            }

            const handlers = [];
            for (let i = 2; i <= cells.length; i++) {
              const sumRem = sum - i;
              if (sumRem <= 0) break;
              handlers.push(new HandlerModule.And(
                this._givenHandler(controlCell, i),
                new SumHandlerModule.Sum(cells.slice(1, i), sumRem)));
            }
            yield new HandlerModule.Or(...handlers);
          }
          break;

        case 'Sandwich':
          cells = constraint.getCells(shape).map(
            c => shape.parseCellId(c).cell);
          yield new HandlerModule.Lunchbox(cells, constraint.value);
          break;

        case 'Lunchbox':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new HandlerModule.Lunchbox(cells, constraint.sum);
          break;

        case 'Skyscraper':
          cells = constraint.getCells(shape).map(
            c => shape.parseCellId(c).cell);
          yield new HandlerModule.Skyscraper(
            cells, constraint.value);
          break;

        case 'HiddenSkyscraper':
          cells = constraint.getCells(shape).map(
            c => shape.parseCellId(c).cell);
          yield new HandlerModule.HiddenSkyscraper(
            cells, constraint.value);
          break;

        case 'NumberedRoom':
          cells = constraint.getCells(shape).map(
            c => shape.parseCellId(c).cell);
          yield new HandlerModule.NumberedRoom(
            cells, constraint.value);
          break;

        case 'AllDifferent':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new HandlerModule.AllDifferent(cells);
          break;

        case 'Given':
          {
            const cell = shape.parseCellId(constraint.cell).cell;
            const valueMap = new Map();
            valueMap.set(cell, constraint.values);
            yield new HandlerModule.GivenCandidates(valueMap);
          }
          break;

        case 'Thermo':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          for (let i = 1; i < cells.length; i++) {
            yield new HandlerModule.BinaryConstraint(
              cells[i - 1], cells[i],
              SudokuConstraint.Thermo.fnKey(shape.numValues));
          }
          break;

        case 'Whisper':
          let difference = constraint.difference;
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          for (let i = 1; i < cells.length; i++) {
            yield new HandlerModule.BinaryConstraint(
              cells[i - 1], cells[i],
              SudokuConstraint.Whisper.fnKey(difference, shape.numValues));
          }
          break;

        case 'Renban':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          {
            const handler = new HandlerModule.BinaryPairwise(
              SudokuConstraint.Renban.fnKey(cells.length, shape.numValues),
              ...cells);
            handler.enableHiddenSingles();
            yield handler;
          }
          break;

        case 'Modular':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          if (cells.length < constraint.mod) {
            const handler = new HandlerModule.BinaryPairwise(
              SudokuConstraint.Modular.fnKey(constraint.mod, shape.numValues),
              ...cells);
            yield handler;
          } else {
            for (let i = constraint.mod; i <= cells.length; i++) {
              const handler = new HandlerModule.BinaryPairwise(
                SudokuConstraint.Modular.fnKey(constraint.mod, shape.numValues),
                ...cells.slice(i - constraint.mod, i));
              yield handler;
            }
          }
          break;

        case 'Entropic':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          if (cells.length < 3) {
            const handler = new HandlerModule.BinaryPairwise(
              SudokuConstraint.Entropic.fnKey(shape.numValues),
              ...cells);
            yield handler;
          } else {
            for (let i = 3; i <= cells.length; i++) {
              const handler = new HandlerModule.BinaryPairwise(
                SudokuConstraint.Entropic.fnKey(shape.numValues),
                ...cells.slice(i - 3, i));
              yield handler;
            }
          }
          break;


        case 'RegionSumLine':
          {
            cells = constraint.cells.map(c => shape.parseCellId(c).cell);
            if (!constraintMap.has('NoBoxes') && !shape.noDefaultBoxes) {
              // Default boxes.
              const regions = SudokuConstraintBase.boxRegions(shape);
              yield* this._regionSumLineHandlers(cells, regions, shape.numValues);
            } else if (constraintMap.has('Jigsaw')) {
              // If no boxes is set, try to use the jigsaw regions.
              const jigsawConstraints = constraintMap.get('Jigsaw');
              const regions = jigsawConstraints.map(
                c => c.cells.map(c => shape.parseCellId(c).cell));
              yield* this._regionSumLineHandlers(cells, regions, shape.numValues);
            } else {
              // There are no regions, so the constraint is trivially satisfied.
            }
          }
          break;

        case 'Between':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new HandlerModule.Between(cells);
          break;

        case 'Lockout':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new HandlerModule.Lockout(constraint.minDiff, cells);
          break;

        case 'Palindrome':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          const numCells = cells.length;
          for (let i = 0; i < numCells / 2; i++) {
            yield new HandlerModule.BinaryConstraint(
              cells[i], cells[numCells - 1 - i],
              SudokuConstraint.Palindrome.fnKey(shape.numValues));
          }
          break;
        case 'Zipper':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          {
            const pairs = [];
            const numCells = cells.length;
            for (let i = 0; i < ((numCells / 2) | 0); i++) {
              pairs.push([cells[i], cells[numCells - 1 - i]]);
            }
            if (numCells % 2 == 1) {
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
            cells.cellIds(shape), cells.isLoop(), constraint.sum);
          break;

        case 'WhiteDot':
          for (const [a, b] of constraint.adjacentPairs(shape)) {
            yield new HandlerModule.BinaryConstraint(
              a, b,
              SudokuConstraint.WhiteDot.fnKey(shape.numValues));
          }
          break;

        case 'BlackDot':
          for (const [a, b] of constraint.adjacentPairs(shape)) {
            yield new HandlerModule.BinaryConstraint(
              a, b,
              SudokuConstraint.BlackDot.fnKey(shape.numValues));
          }
          break;

        case 'X':
          for (const pair of constraint.adjacentPairs(shape)) {
            yield new SumHandlerModule.Sum(pair, 10);
          }
          break;

        case 'V':
          for (const pair of constraint.adjacentPairs(shape)) {
            yield new SumHandlerModule.Sum(pair, 5);
          }
          break;

        case 'GreaterThan': {
          const fn = SudokuConstraint.GreaterThan.fnKey(shape.numValues);
          for (const [a, b] of constraint.adjacentPairs(shape)) {
            yield new HandlerModule.BinaryConstraint(a, b, fn);
          }
          break;
        }

        case 'ValueIndexing':
          {
            const cells = constraint.cells.map(
              c => shape.parseCellId(c).cell);
            yield new HandlerModule.ValueIndexing(...cells);
          }
          break;
        case 'Windoku':
          for (const cells of SudokuConstraint.Windoku.regions(shape)) {
            yield new HandlerModule.AllDifferent(cells);
          }
          break;

        case 'DisjointSets':
          for (const cells of SudokuConstraintBase.disjointSetRegions(shape)) {
            yield new HandlerModule.AllDifferent(cells);
          }
          break;

        case 'GlobalEntropy':
          for (const cells of SudokuConstraintBase.square2x2Regions(shape)) {
            yield new HandlerModule.LocalEntropy(cells);
          }
          break;

        case 'GlobalMod':
          for (const cells of SudokuConstraintBase.square2x2Regions(shape)) {
            yield new HandlerModule.LocalMod3(cells);
          }
          break;

        case 'DutchFlatmates':
          for (const cells of SudokuConstraintBase.colRegions(shape)) {
            yield new HandlerModule.DutchFlatmateLine(cells);
          }
          break;

        case 'ContainAtLeast':
          yield new HandlerModule.RequiredValues(
            constraint.cells.map(c => shape.parseCellId(c).cell),
            constraint.values.split('_').map(v => +v),
            /* strict = */ false);
          break;

        case 'ContainExact':
          yield new HandlerModule.RequiredValues(
            constraint.cells.map(c => shape.parseCellId(c).cell),
            constraint.values.split('_').map(v => +v),
            /* strict = */ true);
          break;

        case 'SameValues':
          {
            if (constraint.numSets < constraint.cells.length) {
              let sets = constraint.splitCells();
              sets = sets.map(cells => cells.map(c => shape.parseCellId(c).cell));
              yield new HandlerModule.SameValues(...sets);
            } else {
              // All cells must have the same value, use binary constraints.
              const cells = constraint.cells.map(c => shape.parseCellId(c).cell);
              const key = SudokuConstraint.SameValues.fnKey(shape.numValues);
              yield new HandlerModule.BinaryPairwise(
                key, ...cells);
            }
          }
          break;

        case 'Quad':
          yield new HandlerModule.RequiredValues(
            SudokuConstraint.Quad.cells(
              constraint.topLeftCell).map(c => shape.parseCellId(c).cell),
            constraint.values.map(v => +v),
            /* strict = */ false);
          break;

        case 'Binary':
          {
            cells = constraint.cells.map(c => c && shape.parseCellId(c).cell);
            for (let i = 1; i < cells.length; i++) {
              yield new HandlerModule.BinaryConstraint(
                cells[i - 1], cells[i],
                constraint.key);
            }
          }
          break;

        case 'BinaryX':
          {
            cells = constraint.cells.map(c => c && shape.parseCellId(c).cell);
            yield new HandlerModule.BinaryPairwise(
              constraint.key, ...cells);
          }
          break;

        case 'Indexing':
          for (let i = 0; i < constraint.cells.length; i++) {
            const controlCell = shape.parseCellId(constraint.cells[i]);
            const value =
              constraint.indexType == SudokuConstraint.Indexing.ROW_INDEXING
                ? controlCell.row + 1 : controlCell.col + 1;

            const cells = [];
            for (let i = 0; i < shape.gridSize; i++) {
              if (constraint.indexType == SudokuConstraint.Indexing.ROW_INDEXING) {
                cells.push(shape.cellIndex(i, controlCell.col));
              } else {
                cells.push(shape.cellIndex(controlCell.row, i));
              }
            }

            yield new HandlerModule.Indexing(
              controlCell.cell, cells, value);
          }
          break;

        case 'FullRank':
          {
            const line = constraint.getCells(shape).map(
              c => shape.parseCellId(c).cell);
            yield new HandlerModule.FullRank(
              shape.numCells, [{ rank: constraint.value, line }]);
          }
          break;

        case 'CountingCircles':
          cells = new CellArgs(constraint.cells, constraint.type);
          yield new HandlerModule.CountingCircles(
            cells.cellIds(shape));
          break;

        case 'StrictKropki':
          {
            const types = ['BlackDot', 'WhiteDot'];
            yield* SudokuBuilder._strictAdjHandlers(
              types.flatMap(t => constraintMap.get(t) || []),
              shape,
              SudokuConstraint.StrictKropki.fnKey(shape.numValues));
          }
          break;

        case 'StrictXV':
          {
            const types = ['X', 'V'];
            yield* SudokuBuilder._strictAdjHandlers(
              types.flatMap(t => constraintMap.get(t) || []),
              shape,
              SudokuConstraint.StrictXV.fnKey(shape.numValues));
          }
          break;

        case 'Priority':
          cells = constraint.cells.map(c => shape.parseCellId(c).cell);
          yield new HandlerModule.Priority(cells, constraint.priority);
          break;

        case 'Or':
          {
            const handlers = [];
            for (const c of constraint.constraints) {
              const cHandlers = [...this._constraintHandlers(c.toMap(), shape)];
              handlers.push(new HandlerModule.And(...cHandlers));
            }
            yield new HandlerModule.Or(...handlers);
          }
          break;

        case 'And':
          for (const c of constraint.constraints) {
            yield* this._constraintHandlers(c.toMap(), shape);
          }

        case 'NoBoxes':
        case 'Shape':
          // Nothing to do here.
          break;

        default:
          throw ('Unknown constraint type: ' + constraint.type);
      }
    }
  }

  static * _antiHandlers(shape, exclusionFn) {
    const gridSize = shape.gridSize;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell = shape.cellIndex(r, c);
        // We only need half the constraints, as the other half will be
        // added by the corresponding exclusion cell.
        for (const [rr, cc] of exclusionFn(r, c)) {
          if (rr < 0 || rr >= gridSize || cc < 0 || cc >= gridSize) continue;
          const exclusionCell = shape.cellIndex(rr, cc);
          yield new HandlerModule.AllDifferent([cell, exclusionCell]);
        }
      }
    }
  }

  static _allAdjacentCellPairs(shape) {
    const pairs = [];

    const gridSize = shape.gridSize;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        let cell = shape.cellIndex(r, c);
        // Only look at adjacent cells with larger indexes.
        for (const [rr, cc] of [[r + 1, c], [r, c + 1]]) {
          if (rr < 0 || rr >= gridSize || cc < 0 || cc >= gridSize) continue;
          pairs.push([cell, shape.cellIndex(rr, cc)]);
        }
      }
    }

    return pairs;
  }

  static * _antiConsecutiveHandlers(shape) {
    for (const [cell, exclusionCell] of this._allAdjacentCellPairs(shape)) {
      yield new HandlerModule.BinaryConstraint(
        cell, exclusionCell,
        SudokuConstraint.AntiConsecutive.fnKey(shape.numValues));
    }
  }
}

export const compileRegex = memoize((pattern, numValues) => {
  const nfa = regexToNFA(pattern, numValues);
  return DFAHandlerModule.NFAToDFA(nfa, numValues);
});

export const compileNFA = memoize((encodedNFA, numValues) => {
  const nfa = NFASerializer.deserialize(encodedNFA);
  return DFAHandlerModule.NFAToDFA(nfa, numValues);
});