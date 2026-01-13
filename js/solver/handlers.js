"use strict";

const {
  memoize,
  countOnes16bit,
  isIterable,
  arrayIntersect,
  RandomIntGenerator,
  shuffleArray,
  MultiMap,
  BitSet
} = await import('../util.js' + self.VERSION_PARAM);
const { LookupTables } = await import('./lookup_tables.js' + self.VERSION_PARAM);
const { SHAPE_MAX } = await import('../grid_shape.js' + self.VERSION_PARAM);
const { SudokuConstraintBase, fnToBinaryKey } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { CandidateFinders } = await import('./candidate_selector.js' + self.VERSION_PARAM);

export class SudokuConstraintHandler {
  static SINGLETON_HANDLER = false;

  static _defaultId = 0;

  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
    // cells must not be written to. They can be updated during initialization,
    // but it must replace the array, not modify it.
    this.cells = new Uint8Array(cells || []);
    // By default all constraints are essential for correctness.
    // The optimizer may add non-essential constraints to improve performance.
    this.essential = true;

    const id = this.constructor._defaultId++;
    // By default every id is unique.
    this.idStr = this.constructor.name + '-' + id.toString();
  }

  // Enforce the constraint on the grid and return:
  // - `false` if the grid is invalid.
  // - `true` if the grid is valid.
  // - `true` if there are still unknown values and the grid
  //          might be valid.
  enforceConsistency(grid, handlerAccumulator) {
    return true;
  }

  // List of cells which must not have the same values as each other.
  exclusionCells() {
    return [];
  }

  // Initialize the grid before solving starts.
  // Return `false` if the grid is invalid, `true` otherwise.
  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return true;
  }

  // Run after all handlers have been initialized and initialGridCells is populated
  // and includes the full state.
  // readonlyGridState must not be written to! This will lead to incorrect
  // results if the handler is used from within an Or constraint.
  postInitialize(readonlyGridState) { }

  priority() {
    // By default, constraints which constrain more cells have higher priority.
    return this.cells.length;
  }

  candidateFinders(grid, shape) {
    return [];
  }

  debugName() {
    return this.constructor.name;
  }
}

export class NoBoxes extends SudokuConstraintHandler { }
// This handler purely exists to manually adjust the priorities of cells to
// adjust initial cell selection.
export class Priority extends SudokuConstraintHandler {
  constructor(cells, priority) {
    // Don't register cells, so that this handler doesn't get added to the cells
    // and is not invoked during solving or any other calculations.
    super();
    this._priorityCells = cells;
    this._priority = priority;
  }

  priority() {
    return this._priority;
  }

  priorityCells() {
    return this._priorityCells;
  }
}

export class True extends SudokuConstraintHandler {
}

export class False extends SudokuConstraintHandler {
  constructor(cells) {
    // The cells with which to associate the failure.
    super(cells);

    if (cells.length === 0) throw new Error('False needs cells to be effective.');
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return false;
  }
  enforceConsistency(grid, handlerAccumulator) { return false; }
}

export class And extends SudokuConstraintHandler {
  constructor(...handlers) {
    // Exclusion cells need special handlings since they can't be handled
    // directly by the engine.
    for (const h of handlers) {
      const exclusionCells = h.exclusionCells();
      if (exclusionCells.length) {
        handlers.push(
          new AllDifferent(
            exclusionCells,
            AllDifferent.PROPAGATE_WITH_ENFORCER));
      }
    }

    const cells = [...new Set(handlers.flatMap(h => [...h.cells]))];
    super(cells);

    this._handlers = handlers;

    this._debugName = `And(${handlers.map(h => h.debugName()).join(',')})`;
  }

  debugName() {
    return this._debugName;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    for (const h of this._handlers) {
      if (!h.initialize(initialGridCells, cellExclusions, shape, stateAllocator)) return false;
    }
    return true;
  }

  postInitialize(readonlyGridState) {
    for (const h of this._handlers) {
      h.postInitialize(readonlyGridState);
    }
  }

  enforceConsistency(grid, handlerAccumulator) {
    const handlers = this._handlers;
    for (let i = 0; i < handlers.length; i++) {
      if (!handlers[i].enforceConsistency(grid, handlerAccumulator)) return false;
    }
    return true;
  }
}

export class GivenCandidates extends SudokuConstraintHandler {
  constructor(valueMap) {
    super();
    this._valueMap = valueMap;
  }

  initialize(initialGridCells, stateAllocator) {
    for (const [cell, value] of this._valueMap) {
      if (isIterable(value)) {
        initialGridCells[cell] &= LookupTables.fromValuesArray(value);
      } else {
        initialGridCells[cell] &= LookupTables.fromValue(value);
      }
    }

    return true;
  }
}

export class AllDifferent extends SudokuConstraintHandler {
  static PROPAGATE_WITH_EXCLUSION_CELLS = 0;
  // Used by Or/And constraint to enforce when it can't be directly accessed by
  // the engine.
  static PROPAGATE_WITH_ENFORCER = 1;

  constructor(exclusionCells, enforcementType) {
    enforcementType ||= AllDifferent.PROPAGATE_WITH_EXCLUSION_CELLS;
    super(enforcementType === AllDifferent.PROPAGATE_WITH_ENFORCER
      ? exclusionCells : []);

    this._enforcementType = enforcementType;

    exclusionCells = Array.from(new Set(exclusionCells));
    exclusionCells.sort((a, b) => a - b);
    this._exclusionCells = exclusionCells;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return this._exclusionCells.length <= shape.numValues;
  }

  exclusionCells() {
    return this._enforcementType === this.constructor.PROPAGATE_WITH_EXCLUSION_CELLS
      ? this._exclusionCells : [];
  }

  enforceConsistency(grid, handlerAccumulator) {
    // NOTE: This is only called when enforcementType is
    // ENFORCE_WITH_PROPAGATION.
    // Currently a very simple, naive implementation.

    const cells = this.cells;
    const numCells = cells.length;
    for (let i = 0; i < numCells; i++) {
      const cell = cells[i];
      const v = grid[cell];
      if (v & (v - 1)) continue;
      for (let j = 0; j < numCells; j++) {
        if (i !== j && (!(grid[cells[j]] &= ~v))) return false;
      }
    }
    return true;
  }
}

// UniqueValueExclusion handles the case when a cell is set to a specific value.
// It removes that value from all cells which share an all-different constraint
// with this cell.
export class UniqueValueExclusion extends SudokuConstraintHandler {
  static SINGLETON_HANDLER = true;

  constructor(cell) {
    super([cell]);
    this._cell = cell;
    this._cellExclusions = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._cellExclusions = cellExclusions.getArray(this._cell);
    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const exclusionCells = this._cellExclusions;
    const numExclusions = exclusionCells.length;
    const value = grid[this._cell];

    for (let i = 0; i < numExclusions; i++) {
      const exclusionCell = exclusionCells[i];
      if (grid[exclusionCell] & value) {
        if (!(grid[exclusionCell] ^= value)) return false;
        handlerAccumulator.addForCell(exclusionCell);
      }
    }

    return true;
  }

  priority() {
    return 0;
  }
}

export class ValueDependentUniqueValueExclusion extends SudokuConstraintHandler {
  static SINGLETON_HANDLER = true;

  constructor(cell, valueToCellMap) {
    super([cell]);
    this._cell = cell;
    this._valueToCellMap = valueToCellMap;
  }

  getValueCellExclusions(value) {
    return this._valueToCellMap[value - 1];
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // Remove cellExclusions, as it would be redundant.
    const exclusions = new Set(cellExclusions.getArray(this._cell));
    for (let i = 0; i < shape.numValues; i++) {
      this._valueToCellMap[i] = new Uint8Array(
        this._valueToCellMap[i].filter(c => !exclusions.has(c)));
    }
    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const v = grid[this._cell];

    const index = LookupTables.toIndex(v);

    const exclusionCells = this._valueToCellMap[index];
    const numExclusions = exclusionCells.length;
    for (let i = 0; i < numExclusions; i++) {
      const exclusionCell = exclusionCells[i];
      if (grid[exclusionCell] & v) {
        if (!(grid[exclusionCell] ^= v)) return false;
        handlerAccumulator.addForCell(exclusionCell);
      }
    }

    return true;
  }

  priority() {
    return 0;
  }
}

export class ValueDependentUniqueValueExclusionHouse extends SudokuConstraintHandler {
  constructor(cells, valueCellExclusions) {
    super(cells);
    this._valueCellExclusions = valueCellExclusions;
  }

  _handleExactlyTwo(grid, v, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    let pairIndex = 0;
    for (let i = 0; i < numCells; i++) {
      if (grid[cells[i]] & v) {
        pairIndex = (pairIndex << 8) | cells[i];
      }
    }

    const index = LookupTables.toIndex(v);
    const exclusionCells = this._valueCellExclusions[index].getPairExclusions(
      pairIndex);

    if (exclusionCells.length > 0) {
      // Remove the value from the exclusion cells.
      for (let i = 0; i < exclusionCells.length; i++) {
        if (grid[exclusionCells[i]] & v) {
          if (!(grid[exclusionCells[i]] ^= v)) return false;
          handlerAccumulator.addForCell(exclusionCells[i]);
        }
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    let allValues = 0;
    let moreThanOne = 0;
    let moreThanTwo = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      moreThanTwo |= moreThanOne & v;
      moreThanOne |= allValues & v;
      allValues |= v;
    }

    let exactlyTwo = moreThanOne & ~moreThanTwo;
    while (exactlyTwo) {
      const v = exactlyTwo & -exactlyTwo;
      exactlyTwo ^= v;
      if (!this._handleExactlyTwo(grid, v, handlerAccumulator)) {
        return false;
      }
    }
    return true;
  }
}

export class HandlerUtil {
  static exposeHiddenSingles(grid, cells, hiddenSingles) {
    hiddenSingles = hiddenSingles | 0;
    const numCells = cells.length;
    for (let i = 0; i < numCells; i++) {
      const cell = cells[i];
      const value = grid[cell] & hiddenSingles;
      if (value) {
        // If there there is more than one value, then this cell has
        // has multiple hidden singles, which is a contradiction.
        if (value & (value - 1)) return false;
        grid[cell] = value;
      }
    }
    return true;
  }

  static enforceRequiredValueExclusions(grid, cells, values, cellExclusions, handlerAccumulator) {
    while (values) {
      const value = values & -values;
      values ^= value;

      // Loop through and find the location of the cells that contain `value`.
      // `pairIndex` is updated such that if there are exactly two locations
      // it will be the index of that pair into `cellExclusions`.
      let pairIndex = 0;
      let cellCount = 0;
      const numCells = cells.length;
      for (let i = 0; i < numCells; i++) {
        if (grid[cells[i]] & value) {
          pairIndex = (pairIndex << 8) | cells[i];
          cellCount++;
        }
      }

      // Lookup the exclusion cells.
      // If there are more than 2 we use the intersection of the entire list.
      const exclusionCells = (cellCount == 2)
        ? cellExclusions.getPairExclusions(pairIndex)
        : (cellCount == 1)
          ? cellExclusions.getArray(pairIndex)
          : cellExclusions.getListExclusions(cells);

      if (exclusionCells && exclusionCells.length) {
        if (!this.removeRequiredValueExclusions(
          grid, exclusionCells, value, handlerAccumulator)) {
          return false;
        }
      }
    }

    return true;
  }

  static removeRequiredValueExclusions(grid, exclusionCells, value, handlerAccumulator) {
    // Remove the value from the exclusion cells.
    for (let i = 0; i < exclusionCells.length; i++) {
      if (grid[exclusionCells[i]] & value) {
        if (!(grid[exclusionCells[i]] ^= value)) return false;
        if (handlerAccumulator) handlerAccumulator.addForCell(exclusionCells[i]);
      }
    }

    return true;
  }

  static findExclusionGroups(cells, cellExclusions) {
    const bitset = new BitSet(Math.max(...cells) + 1);

    let bestExclusionGroupData = this.findExclusionGroupsGreedy(
      cells, cellExclusions, this.GREEDY_STRATEGY_FIRST, bitset);

    if (cells.length < 4 || bestExclusionGroupData.groups.length == 1) {
      return bestExclusionGroupData;
    }

    {
      const data = this.findExclusionGroupsGreedy(
        cells, cellExclusions, this.GREEDY_STRATEGY_BEST, bitset);
      if (data.sumOfSquares > bestExclusionGroupData.sumOfSquares) {
        bestExclusionGroupData = data;
      }
    }

    let randomGen = new RandomIntGenerator(0);

    const NUM_TRIALS = 4;

    // Choose `NUM_TRIALS` random orderings of the cells and find the one that
    // generates the best exclusion groups.
    // NOTE: The first ordering is the original (sorted) ordering. This ordering
    //       should work well for little killers and other linear regions.
    //       This is computed above, so that why we start from i = 1 here.
    cells = cells.slice();
    for (let i = 2; i < NUM_TRIALS; i++) {
      shuffleArray(cells, randomGen);
      const data = this.findExclusionGroupsGreedy(
        cells, cellExclusions, this.GREEDY_STRATEGY_FIRST, bitset);

      // Score by sum-of-squares of group sizes.
      // Higher is better (it minimizes the implied sum-range).
      if (data.sumOfSquares > bestExclusionGroupData.sumOfSquares) {
        bestExclusionGroupData = data;
      }
    }

    return bestExclusionGroupData;
  }

  // Use sum-of-squares of group sizes as score for exclusion groups.
  // This favors fewer, larger groups over many smaller groups.
  // It also directly optimizes for minimizing the range of possible sums since:
  //    range = (numCells * numValues) - sumOfSquares.
  static _exclusionGroupScore(groups) {
    let sumOfSquares = 0;
    for (const g of groups) {
      const s = g.length;
      sumOfSquares += s * s;
    }

    return sumOfSquares;
  }

  static exclusionGroupSumInfo(groups, numValues) {
    let range = 0;
    let min = 0;
    for (const g of groups) {
      const s = g.length;
      range += (numValues - s) * s;
      min += (s * (s + 1)) >> 1;
    }

    return { range, min, max: range + min };
  }

  // When choosing a candidate, pick the first in order.
  static GREEDY_STRATEGY_FIRST = 0;
  // When choosing a candidate, pick the best fitting (most exclusions).
  static GREEDY_STRATEGY_BEST = 1;

  static findExclusionGroupsGreedy(cells, cellExclusions, strategy = HandlerUtil.GREEDY_STRATEGY_BEST, bitset = null) {
    const unassigned = bitset || new BitSet(Math.max(...cells) + 1);
    unassigned.clear();
    for (const cell of cells) {
      unassigned.add(cell);
    }
    let numUnassigned = cells.length;

    const groups = [];
    while (numUnassigned > 0) {
      const candidates = unassigned.clone();
      let numCandidates = numUnassigned;
      const group = [];

      // Greedily grow the group into a clique
      while (numCandidates > 0) {
        let bestCell = -1;
        let bestScore = -1;
        if (strategy === this.GREEDY_STRATEGY_FIRST) {
          // Choose the first available cell in the order of `cells`.
          for (const cell of cells) {
            if (candidates.has(cell)) {
              bestCell = cell;
              break;
            }
          }
          if (bestCell !== -1) {
            bestScore = candidates.intersectCount(cellExclusions.getBitSet(bestCell));
          }
        } else {
          // Choose the cell which is mutually exclusive with the most candidates.
          candidates.forEachBit((cell) => {
            const score = candidates.intersectCount(cellExclusions.getBitSet(cell));
            if (score > bestScore || (score === bestScore && cell < bestCell)) {
              bestScore = score;
              bestCell = cell;

              // Can't do better than excluding all candidates.
              if (bestScore === numCandidates - 1) return false;
            }
          });
        }

        // This can only happen if there are self-exclusions.
        // In this case, just give up and add all remaining candidates to the group.
        if (bestCell === -1) {
          candidates.forEachBit((cell) => group.push(cell));
          break;
        }

        group.push(bestCell);
        candidates.remove(bestCell);
        if (bestScore !== numCandidates - 1) {
          candidates.intersect(cellExclusions.getBitSet(bestCell));
        }
        numCandidates = bestScore;
      }

      for (const cell of group) unassigned.remove(cell);
      numUnassigned -= group.length;

      groups.push(group);
    }

    return { groups, sumOfSquares: this._exclusionGroupScore(groups) };
  }

  static findMappedExclusionGroups(cells, cellExclusions) {
    const exclusionGroupsData = this.findExclusionGroups(
      cells, cellExclusions);

    const cellToIndex = new Map();
    for (let i = 0; i < cells.length; i++) cellToIndex.set(cells[i], i);

    exclusionGroupsData.groups = exclusionGroupsData.groups.map(group =>
      group.map(c => cellToIndex.get(c)));

    return exclusionGroupsData;
  }
}

export class House extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._allValues = 0;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._allValues = LookupTables.get(shape.numValues).allValues;

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    let allValues = 0;
    let atLeastTwo = 0;
    let fixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      atLeastTwo |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v;  // Avoid branching.
    }

    if (allValues != this._allValues) return false;
    if (fixedValues == this._allValues) return true;

    const hiddenSingles = allValues & ~atLeastTwo & ~fixedValues;
    if (hiddenSingles) {
      if (!HandlerUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
        return false;
      }
      fixedValues |= hiddenSingles;
    }

    return true;
  }

  exclusionCells() {
    return this.cells;
  }

  candidateFinders(grid, shape) {
    return [
      new CandidateFinders.House(this.cells, grid, -1)
    ];
  }
}

// Determine the number of times each value appears in the provided lines,
// (numCells / numLines), and ensure that each value appears exactly that many
// times.
// This is used for non-square grids where there aren't house constraints on
// each line to better constrain the values. Without it, the solver can easily
// get into a trap where the rest of the grid is not possible because we
// don't have the required values.
export class FullGridRequiredValues extends SudokuConstraintHandler {
  constructor(allCells, lines) {
    super(allCells);
    this._lines = lines;
    // Each value must appear in exactly _lineLength of the numValues lines.
    this._lineLength = lines[0].length;
    this._numValues = lines.length;

    // Scratch buffers to avoid allocations during propagation.
    this._lineFixedValues = new Uint16Array(lines.length);
    this._linePossibleValues = new Uint16Array(lines.length);
    this._linePossibleHiddenSingles = new Uint16Array(lines.length);
  }

  enforceConsistency(grid, handlerAccumulator) {
    const lines = this._lines;
    const numLines = lines.length;
    const lineLength = this._lineLength;
    const numValues = this._numValues;
    const lineFixedValues = this._lineFixedValues;
    const linePossibleValues = this._linePossibleValues;
    const linePossibleHiddenSingles = this._linePossibleHiddenSingles;

    // First pass per line: compute which values are fixed in the line, which
    // values are still possible in the line (excluding already-fixed values),
    // and which values are hidden singles (appear in exactly one cell).
    for (let li = 0; li < numLines; li++) {
      const line = lines[li];

      let allValues = 0;
      let atLeastTwo = 0;
      let fixedValues = 0;
      for (let j = 0; j < line.length; j++) {
        const v = grid[line[j]];
        atLeastTwo |= allValues & v;
        allValues |= v;
        fixedValues |= (!(v & (v - 1))) * v;  // Avoid branching.
      }
      lineFixedValues[li] = fixedValues;

      // For this handler, "possible" means "can still appear in this line"
      // and excludes values already fixed in the line.
      const possibleValues = allValues & ~fixedValues;
      linePossibleValues[li] = possibleValues;

      // Values which appear in exactly one cell in the line.
      linePossibleHiddenSingles[li] = allValues & ~atLeastTwo & ~fixedValues;
    }

    let requiredPossibleValues = 0;
    for (let valueIndex = 0; valueIndex < numValues; valueIndex++) {
      const valueMask = 1 << valueIndex;

      let satisfied = 0;
      let possible = 0;
      for (let li = 0; li < numLines; li++) {
        satisfied += lineFixedValues[li] & valueMask;
        possible += linePossibleValues[li] & valueMask;
      }
      satisfied >>>= valueIndex;
      possible >>>= valueIndex;

      if (satisfied > lineLength) return false;
      if (satisfied + possible < lineLength) return false;

      // If we've already placed the value in enough lines, forbid it elsewhere.
      if (satisfied === lineLength) {
        const invMask = ~valueMask;
        for (let li = 0; li < numLines; li++) {
          if (!(linePossibleValues[li] & valueMask)) continue;
          const line = lines[li];
          for (let i = 0; i < line.length; i++) {
            const cell = line[i];
            const v = grid[cell];
            const next = v & invMask;
            if (next !== v) {
              if (!(grid[cell] = next)) return false;
              handlerAccumulator.addForCell(cell);
            }
          }
        }
        continue;
      }

      // If all remaining possible lines must contain the value, we can enforce
      // hidden singles in those lines.
      if (satisfied + possible === lineLength) {
        requiredPossibleValues |= valueMask;
      }
    }

    if (requiredPossibleValues) {
      for (let li = 0; li < numLines; li++) {
        // Remove hidden singles.
        const hiddenSingles = linePossibleHiddenSingles[li] & requiredPossibleValues;
        if (hiddenSingles && !HandlerUtil.exposeHiddenSingles(grid, lines[li], hiddenSingles)) {
          return false;
        }
        // Determine if there all the remaining unfixed cells must take the
        // required values.
        const allRequiredValues =
          ((linePossibleValues[li] & requiredPossibleValues) | lineFixedValues[li]);
        const usedCellCount = countOnes16bit(allRequiredValues);
        if (usedCellCount > lineLength) return false;
        if (usedCellCount === lineLength) {
          // All the cells must take the required values.
          const removeValues = ~allRequiredValues;
          for (let j = 0; j < lines[li].length; j++) {
            const cell = lines[li][j];
            const v = grid[cell];
            if (v & removeValues) {
              if (!(grid[cell] &= allRequiredValues)) return false;
              handlerAccumulator.addForCell(cell);
            }
          }
        }
      }
    }

    return true;
  }
}

export class BinaryConstraint extends SudokuConstraintHandler {
  constructor(cell1, cell2, key) {
    super([cell1, cell2]);
    this._key = key;
    this._tables = [];

    // Ensure we dedupe binary constraints.
    this.idStr = [this.constructor.name, key, cell1, cell2].join('-');
  }

  key() {
    return this._key;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const lookupTables = LookupTables.get(shape.numValues);
    this._tables = lookupTables.forBinaryKey(this._key);
    this._cellExclusions = cellExclusions;

    this._exclusionsCellsForRequiredValues = null;

    // If the key is transitive, then there will never be required value.
    // This is a sufficient but not necessary condition. However, it is
    // enough to identify that Thermo can't be optimized this way.
    const isTransitive = lookupTables.binaryKeyIsTransitive(this._key);
    if (!isTransitive) {
      const pairIndex = (this.cells[0] << 8) | this.cells[1];
      const exclusionsCells = cellExclusions.getPairExclusions(pairIndex);
      if (exclusionsCells?.length) {
        this._exclusionsCellsForRequiredValues = exclusionsCells;
      }
    }

    // If no values are legal at the start, then this constraint is invalid.
    return this._tables[0][lookupTables.allValues] !== 0;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const v0 = grid[this.cells[0]];
    const v1 = grid[this.cells[1]];

    const v0New = grid[this.cells[0]] = v0 & this._tables[1][v1];
    const v1New = grid[this.cells[1]] = v1 & this._tables[0][v0];

    if (!(v0New && v1New)) return false;
    if (v0 != v0New) handlerAccumulator.addForCell(this.cells[0]);
    if (v1 != v1New) handlerAccumulator.addForCell(this.cells[1]);

    // If transitive, then required value exclusion is not possible.
    if (this._exclusionsCellsForRequiredValues === null) return true;

    // Require value exclusion is only needed if neither cell is fixed.
    if ((v0New & (v0New - 1)) === 0 || (v1New & (v1New - 1)) === 0) return true;

    // Check values that appear in both cells.
    let values = v0New & v1New;
    let requiredValues = 0;
    while (values) {
      const value = values & -values;
      values ^= value;

      // Check if this value is required if the other cell doesn't have it.
      // Checking in one direction is sufficient, since this proves that no
      // valid pair exists.
      if ((this._tables[0][v0New ^ value] & v1New) === value) {
        requiredValues |= value;
      }
    }

    // Remove required value exclusions.
    while (requiredValues) {
      const value = requiredValues & -requiredValues;
      requiredValues ^= value;
      if (!HandlerUtil.removeRequiredValueExclusions(
        grid, this._exclusionsCellsForRequiredValues, value, handlerAccumulator)) {
        return false;
      }
    }

    return true;
  }
}

export class BinaryPairwise extends SudokuConstraintHandler {
  constructor(key, ...cells) {
    super(cells);
    this._key = key;
    this._table = null;
    this._isAllDifferent = false;
    this._validCombinationInfo = null;
    this._cellExclusions = null;
    this._enableHiddenSingles = false;
    this._prefixCache = null;

    // Ensure we dedupe binary constraints.
    this.idStr = [this.constructor.name, key, ...cells].join('-');
  }

  key() {
    return this._key;
  }

  enableHiddenSingles() {
    this._enableHiddenSingles = true;
  }

  static _isKeySymmetric = memoize((key, numValues) => {
    const [table0, table1] = LookupTables.get(numValues).forBinaryKey(key);
    for (let i = 0; i < numValues; i++) {
      for (let j = i + 1; j < numValues; j++) {
        const v = 1 << i | 1 << j;
        if (table0[v] != table1[v]) return false;
      }
    }
    return true;
  });

  static _isAllDifferent(table, numValues) {
    for (let i = 0; i < numValues; i++) {
      const v = 1 << i;
      // Check if both cells having the same value is legal.
      if (table[v] & v) return false;
    }
    return true;
  }

  // _exactCombinationsTable says whether a combination is valid.
  //  - `key` must be an all-different constraint.
  //  - Rows with `n` bits set represent the n-cell constraints.
  //  - The values are only 1 or 0 to indicate validity.
  static _exactCombinationsTable = memoize((key, numValues) => {
    const table = LookupTables.get(numValues).forBinaryKey(key)[0];
    if (!this._isAllDifferent(table, numValues)) throw new Error('Not implemented');

    const combinations = 1 << numValues;
    const exactCombinations = new Uint8Array(combinations);
    // Seed the table with all valid pairs.
    for (let i = 0; i < combinations; i++) {
      for (let j = 0; j < numValues; j++) {
        const v = (1 << i) | (1 << j);
        if (table[v]) {
          exactCombinations[v] = 1;
        }
      }
    }

    // Build up the rest of the table.
    for (let i = 0; i < combinations; i++) {
      if (countOnes16bit(i) < 3) continue;
      let iMin = i & -i;
      let iRest = i ^ iMin;
      // If it's not valid with one less value, adding more cells won't help.
      if (!exactCombinations[iRest]) continue;
      // Ensure iBit is consistent with the rest.
      if (!(iRest & ~table[iMin])) {
        exactCombinations[i] = 1;
      }
    }

    return exactCombinations;
  });

  // _validCombinationInfoTable gives information about valid combinations.
  //  - `key` must be an all-different constraint.
  //  - The lower 16 bits of each row are the valid values.
  //  - The higher 16 bits of each row are the required values.
  static _validCombinationInfoTable = memoize((key, numValues, numCells) => {
    const exactCombinations = this._exactCombinationsTable(key, numValues);

    const combinations = 1 << numValues;
    const validCombinationInfo = new Uint32Array(combinations);
    for (let i = 0; i < combinations; i++) {
      const count = countOnes16bit(i);
      // If we don't have enough cells we can't be valid.
      if (count < numCells) continue;
      // If we have the right number of cells then initialize the row.
      if (count == numCells) {
        if (exactCombinations[i]) {
          validCombinationInfo[i] = (i << 16) | i;
        }
        continue;
      }

      // Otherwise combine all the valid subsets.
      validCombinationInfo[i] = 0xffff << 16;
      let iBits = i;
      while (iBits) {
        const iBit = iBits & -iBits;
        iBits ^= iBit;
        if (validCombinationInfo[i ^ iBit]) {
          validCombinationInfo[i] |= validCombinationInfo[i ^ iBit] & 0xffff;
          validCombinationInfo[i] &= validCombinationInfo[i ^ iBit] | 0xffff;
        }
      }
      // Clear if there were no valid values.
      if (!validCombinationInfo[i] & 0xffff) validCombinationInfo[i] = 0;
    }

    return validCombinationInfo;
  });

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const lookupTables = LookupTables.get(shape.numValues);
    if (!this.constructor._isKeySymmetric(this._key, shape.numValues)) {
      throw new Error('Function for BinaryPairwise must be symmetric. Key: ' + this._key);
    }

    // The key must be symmetric, so we just need the one table.
    this._table = lookupTables.forBinaryKey(this._key)[0];
    this._isAllDifferent = this.constructor._isAllDifferent(
      this._table, shape.numValues);
    if (this._isAllDifferent) {
      // Only apply this for all-different constraints for now. Can generalize
      // in the future if required.
      this._validCombinationInfo = this.constructor._validCombinationInfoTable(
        this._key, shape.numValues, this.cells.length);

      this._cellExclusions = cellExclusions;
    }

    // Allocate prefix cache for O(n) pairwise constraint enforcement.
    this._prefixCache = new Uint16Array(this.cells.length + 1);
    this._prefixCache[0] = lookupTables.allValues;

    // If no values are legal at the start, then this constraint is invalid.
    return this._table[lookupTables.allValues] !== 0;
  }

  _enforceRequiredValues(grid, cells, requiredValues, handlerAccumulator) {
    const numCells = cells.length;

    // Calculate the information required to constraint requiredValues.
    let allValues = 0;
    let nonUniqueValues = 0;
    let fixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v;  // Avoid branching.
    }

    if (allValues == fixedValues) return true;

    // Run exposeHiddenSingles if we've been asked.
    // (At the moment this isn't a net win for all constraints).
    if (this._enableHiddenSingles) {
      const hiddenSingles = requiredValues & ~nonUniqueValues & ~fixedValues;
      if (hiddenSingles) {
        if (!HandlerUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
          return false;
        }
      }
    }

    // Enforce all the non-unique required values.
    // Exclude fixedValues, they will be handled by the main solver loop,
    // which will also propagate the changes.
    const nonUniqueRequired = requiredValues & nonUniqueValues & ~fixedValues;
    if (!HandlerUtil.enforceRequiredValueExclusions(
      grid, cells, nonUniqueRequired, this._cellExclusions, handlerAccumulator)) return false;

    return true;
  }

  // Check if unique values in a cell depend on unique values in the same
  // cell for support.
  _enforceCellUniqueValues(grid, cells, uniqueValues, allValues) {
    const numCells = cells.length;
    const validCombinationInfo = this._validCombinationInfo;

    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      // Find the unique values in this cell.
      const cellUniqueValues = v & uniqueValues;
      if (!(cellUniqueValues & (cellUniqueValues - 1))) continue;
      // We have multiple unique values, so we can check if each is valid.
      let values = cellUniqueValues;
      while (values) {
        const value = values & -values;
        values ^= value;
        // Since the unique values are mutually exclusive we can check the valid
        // combinations without the other cellUniqueValues.
        const info = validCombinationInfo[allValues ^ (cellUniqueValues ^ value)];
        // Check if the value is still part of a valid combination.
        if (!(info & value)) {
          if (!(grid[cells[i]] &= ~value)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    const table = this._table;

    // Use prefix cache to enforce all pairwise constraints in O(n) per iteration.
    // Forward pass: build prefix[i] = table[v0] & table[v1] & ... & table[v_{i-1}]
    // Backward pass: accumulate suffix while enforcing constraints.
    // For cell i, the valid values are: v_i & prefix[i] & suffix
    const prefix = this._prefixCache;

    let allChanged = 0;
    let newChanged = 1;
    while (newChanged) {
      const firstCell = LookupTables.toIndex(newChanged & -newChanged);
      newChanged = 0;

      // Forward pass: build prefix cache.
      for (let i = firstCell; i < numCells; i++) {
        prefix[i + 1] = prefix[i] & table[grid[cells[i]]];
      }

      // Backward pass: accumulate suffix and enforce constraints.
      let suffix = prefix[0];
      for (let i = numCells - 1; i >= 0; i--) {
        const v = grid[cells[i]];
        const vNew = v & prefix[i] & suffix;
        if (v !== vNew) {
          if (!(grid[cells[i]] = vNew)) {
            return false;
          }
          newChanged |= 1 << i;
        }
        suffix &= table[v];
      }
      allChanged |= newChanged;
    }

    // Add any changed cells to the accumulator.
    // This seems to help for the direct pass, but not the all-different
    // pass.
    while (allChanged) {
      const changed = allChanged & -allChanged;
      allChanged ^= changed;
      handlerAccumulator.addForCell(cells[
        LookupTables.toIndex(changed)]);
    }

    // The rest of the different is for when the values must be unique.
    if (!this._isAllDifferent) return true;

    let allValues = 0;
    let nonUniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
    }

    // Filter out values which aren't in any valid combination.
    const validCombinationInfo = this._validCombinationInfo[allValues];
    const validValues = validCombinationInfo & 0xffff;
    if (!validValues) return false;
    if (validValues != allValues) {
      for (let i = 0; i < numCells; i++) {
        if (grid[cells[i]] & ~validValues) {
          if (!(grid[cells[i]] &= validValues)) return false;
          handlerAccumulator.addForCell(cells[i]);
        }
      }
    }

    // Enforce any required values that exist (values in every valid
    // combination).
    const requiredValues = (validCombinationInfo >> 16) & 0xffff;
    if (requiredValues) {
      if (!this._enforceRequiredValues(grid, cells, requiredValues, handlerAccumulator)) {
        return false;
      }
    }

    // Check if unique values in a cell depend on unique values in the same
    // cell for support.
    const uniqueValues = validValues & ~nonUniqueValues;
    if (uniqueValues & (uniqueValues - 1)) {
      if (!this._enforceCellUniqueValues(grid, cells, uniqueValues, validValues)) {
        return false;
      }
    }

    return true;
  }
}

export class Skyscraper extends SudokuConstraintHandler {
  constructor(cells, numVisible) {
    super(cells);
    this._numVisible = +numVisible;
    this._numValues = 0;
    this._forwardStates = null;
    this._backwardStates = null;
    this._allStates = null;

    if (0 >= this._numVisible) {
      throw new Error('Skyscraper visibility target must be > 0');
    }
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._numValues = shape.numValues;
    // Can't see more buildings than exist.
    if (this._numVisible > this.cells.length) return false;

    // Terminal max height must be >= numCells (the minimum possible max
    // with numCells distinct values). For full rows this equals maxValue.
    const numCells = this.cells.length;
    this._terminalMask = (1 << shape.numValues) - (1 << (numCells - 1));

    [this._forwardStates, this._backwardStates, this._allStates] = (
      this.constructor._makeStateArrays(shape.numValues, this._numVisible));
    return true;
  }

  static _baseBuffer = new Uint16Array(
    (SHAPE_MAX.numValues * 2) * SHAPE_MAX.numValues);

  // The state arrays are all backed by a single buffer.
  // - We have two so that separate forward and backward states can be kept to
  //   avoid having to clear arrays in the middle of the algorithm.
  // - We also return a buffer covering all the states so that it can easily
  //   be cleared at the start of the algorithm.
  static _makeStateArrays(numValues, target) {
    const buffer = this._baseBuffer;
    const matrix0 = [];
    const matrix1 = [];
    for (let i = 0; i < numValues; i++) {
      matrix0.push(buffer.subarray(i * target, (i + 1) * target));
      matrix1.push(buffer.subarray(
        (numValues + i) * target, (numValues + i + 1) * target));
    }
    return [matrix0, matrix1, buffer.subarray(0, numValues * 2 * target)];
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const target = this._numVisible;
    const numCells = cells.length;
    const maxValue = LookupTables.fromValue(this._numValues);

    // This resets the states for both the forward and backward pass.
    this._allStates.fill(0);

    // forwardStates records the possible max heights at each visibility.
    // `forwardStates[i][vis] & (1 << (h-1)) == 1` means that:
    //   When vis cells are visible up to the ith cell, then h is a valid
    //   height for the current highest cell.
    // backwardStates is the same, but is used in the backward pass to avoid
    // having to have a temporary buffer and clear it each time.
    const forwardStates = this._forwardStates;

    // All the values in the first cell are valid for visibility == 1.
    forwardStates[0][0] = grid[cells[0]];

    // Forward pass to determine the possible heights for each visibility.
    let lastMaxHeightIndex = numCells - 1;
    for (let i = 1; i < numCells; i++) {
      const prevStates = forwardStates[i - 1];
      const currStates = forwardStates[i];

      const v = grid[cells[i]];
      const higherThanMinV = -(v & -v) << 1;

      {
        // Unroll j = 0, since only Case 1 applies.
        currStates[0] = prevStates[0] & higherThanMinV;
      }
      for (let j = 1; j <= i && j < target; j++) {
        // Case 1: cells[i] is not visible.
        //  - Visibility stays the same.
        //  - Only keep those states which are higher than our minimum value.
        let newState = prevStates[j] & higherThanMinV;

        // Case 2: cells[i] is visible.
        //  - Visibility increments.
        //  - The only valid values are those that are higher than the previous
        //    state.
        {
          const s = prevStates[j - 1];
          // NOTE: s == 0 => higherThanMinS == 0, so we don't need to special
          // case 0.
          const higherThanMinS = -(s & -s) << 1;
          newState |= v & higherThanMinS;
        }
        currStates[j] = newState;
      }

      // If the maxValue cell is known, then nothing afterwards matters.
      // This is an optimizations.
      if (v === maxValue) {
        lastMaxHeightIndex = i;
        break;
      }
    }

    // Anything after the first maxValue can't also be a maxValue.
    for (let i = lastMaxHeightIndex + 1; i < numCells; i++) {
      if (!(grid[cells[i]] &= ~maxValue)) return false;
    }

    // Set the final state to the valid terminal states.
    // Updated states are collected into backwardStates.
    const backwardStates = this._backwardStates;
    const terminalState = forwardStates[lastMaxHeightIndex][target - 1] & this._terminalMask;
    if (!terminalState) return false;
    backwardStates[lastMaxHeightIndex][target - 1] = terminalState;

    // Backward pass to constraint the states that we found based on our
    // knowledge of what the terminal state must be.
    for (let i = lastMaxHeightIndex; i > 0; i--) {
      // Each iteration determines the possible values for cells[i] while
      // calculating the states for backwardStates[i-1].
      const newStates = backwardStates[i - 1];
      const oldStates = forwardStates[i - 1];

      let valueMask = 0;
      for (let j = 0; j < target; j++) {
        const currentState = backwardStates[i][j];
        // Skip this state if it is not possible.
        if (!currentState) continue;

        // Case 1: cells[i] is not visible.
        //  - Visibility stays the same.
        //  - Keep those states which are the same as the current cell.
        //  - Grid values must below the maximum state.
        {
          const validStates = oldStates[j] & currentState;
          if (validStates) {
            newStates[j] |= validStates;
            // The grid value must be hidden.
            // We can only have grid values lower than the maximum state.
            const maxS = LookupTables.maxValue(validStates);
            valueMask |= (1 << (maxS - 1)) - 1;
          }
        }

        // Case 2: cells[i] is visible.
        //  - Visibility has incremented.
        //  - The current state must be one of the current grid values.
        //  - Previous states are only valid if they are lower than our maximum
        //    value.
        if (j > 0) {
          const visibleCurrentState = currentState & grid[cells[i]];
          const maxS = LookupTables.maxValue(visibleCurrentState);
          // NOTE: maxS == 0 => validStates == 0
          const validStates = oldStates[j - 1] & (((1 << maxS) - 1) >> 1);
          if (validStates) {
            newStates[j - 1] |= validStates;
            // This grid value must be visible.
            // The valid values are the current state.
            valueMask |= visibleCurrentState;
          }
        }
      }

      if (!(grid[cells[i]] &= valueMask)) return false;
    }

    // The first cell is all those values for which visibility == 1 is valid.
    if (!(grid[cells[0]] &= backwardStates[0][0])) return false;

    return true;
  }
}

export class HiddenSkyscraper extends SudokuConstraintHandler {
  constructor(cells, firstHiddenValue) {
    super(cells);
    this._targetV = LookupTables.fromValue(+firstHiddenValue);
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // If the hidden value is first it will always be visible.
    if (!(initialGridCells[this.cells[0]] &= ~this._targetV)) return false;
    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const targetV = this._targetV;
    const moreThanTarget = -targetV << 1;

    // The first cell is always visible.
    let allowedSkyscrapers = grid[cells[0]];
    let i = 1;
    let firstTargetIndex = 0;
    for (; i < numCells; i++) {
      const cell = cells[i];
      let v = grid[cell];
      const allowedMask = -(allowedSkyscrapers & -allowedSkyscrapers) << 1;

      if (!firstTargetIndex) {
        // If the this cell has the target, check if it is valid.
        // Otherwise remove it.
        if (v & targetV) {
          if ((allowedSkyscrapers & moreThanTarget)) {
            firstTargetIndex = i;
          } else {
            // We can't populate the target yet.
            v &= ~targetV;
          }
        }

        // The only valid values are those which are higher than the previous state.
        v &= allowedMask | targetV;
      }

      if (grid[cell] !== v) {
        if (!(grid[cell] = v)) return false;
        handlerAccumulator.addForCell(cell);
      }

      // Add any values which are higher than the previous state.
      allowedSkyscrapers = v & ~targetV & allowedMask;

      // We've reached the last valid target.
      if (!allowedSkyscrapers) break;
    }

    // If we never saw the target, the grid is invalid.
    if (!firstTargetIndex) return false;

    // Clear the target from all later cells.
    while (++i < numCells) {
      const cell = cells[i];
      if (grid[cell] & targetV) {
        if (!(grid[cell] &= ~targetV)) return false;
        handlerAccumulator.addForCell(cell);
      }
    }

    // Backward pass to filter out early values which are too large.
    // That is, skyscrapers which would force the height to increase
    // too fast to reach the target.
    allowedSkyscrapers = -1;
    for (let j = firstTargetIndex - 1; j >= 0; j--) {
      const v = grid[cells[j]];
      const newV = v & allowedSkyscrapers;
      if (newV !== v) {
        if (!(grid[cells[j]] = newV)) return false;
        handlerAccumulator.addForCell(cells[j]);
      }
      allowedSkyscrapers = (1 << (LookupTables.maxValue(newV) - 1)) - 1;
    }

    return true;
  }
}

export class Lunchbox extends SudokuConstraintHandler {
  _borderMask = 0;
  _valueMask = 0;
  _distances = null;
  _combinations = null;
  _isHouse = false;

  constructor(cells, sum) {
    super(cells);
    sum = +sum;
    if (!Number.isInteger(sum) || sum < 0) {
      throw new Error('Invalid sum for sandwich constraint: ' + sum);
    }

    this._sum = sum;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const sum = this._sum;
    this._isHouse = this.cells.length === shape.numValues;

    const lookupTables = LookupTables.get(shape.numValues);

    this._borderMask = Lunchbox._borderMask(shape);
    this._valueMask = ~this._borderMask & lookupTables.allValues;

    this._distances = Lunchbox._distanceRange(shape)[sum];
    this._combinations = Lunchbox._combinations(shape)[sum];

    return true;
  }

  exclusionCells() {
    return this.cells;
  }

  static _borderMask(shape) {
    return 1 | LookupTables.fromValue(shape.numValues);
  }

  // Max sum within the sandwich.
  static _maxSum(shape) {
    return (shape.numValues * (shape.numValues - 1) / 2) - 1;
  }

  // Possible combinations for values between the sentinels for each possible sum.
  // Grouped by distance.
  static _combinations = memoize((shape) => {
    const lookupTables = LookupTables.get(shape.numValues);
    const maxSum = this._maxSum(shape);
    const borderMask = this._borderMask(shape);

    let table = [];
    const maxD = shape.numValues - 1;
    for (let i = 0; i <= maxSum; i++) {
      const subtable = [];
      table.push(subtable);
      for (let d = 0; d <= maxD; d++) subtable.push([]);
    }

    for (let i = 0; i < lookupTables.combinations; i++) {
      if (i & borderMask) continue;
      let sum = lookupTables.sum[i];
      table[sum][countOnes16bit(i) + 1].push(i);
    }

    for (let i = 0; i <= maxSum; i++) {
      for (let d = 0; d <= maxD; d++) {
        table[i][d] = new Uint16Array(table[i][d]);
      }
    }

    return table;
  });

  // Distance range between the sentinels for each possible sum.
  // Map combination to [min, max].
  static _distanceRange = memoize((shape) => {
    const combinations = this._combinations(shape);
    const maxSum = this._maxSum(shape);

    let table = [];
    for (let i = 0; i <= maxSum; i++) {
      let row = combinations[i];

      let j = 0;
      while (j < row.length && !row[j].length) j++;
      let dMin = j;
      while (j < row.length && row[j].length) j++;
      let dMax = j - 1;

      table.push([dMin, dMax]);
    }
    return table;
  });

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _validSettings = new Uint16Array(SHAPE_MAX.numValues);
  static _cellValues = new Uint16Array(SHAPE_MAX.numValues);

  enforceConsistency(grid, handlerAccumulator) {
    const isHouse = this._isHouse;
    const cells = this.cells;
    const numCells = this.cells.length;
    const borderMask = this._borderMask;

    // Cache the grid values for faster lookup.
    const values = Lunchbox._cellValues;
    let allValues = 0;
    for (let i = 0; i < numCells; i++) {
      allValues |= (values[i] = grid[cells[i]]);
    }

    if (isHouse) {
      // We are using all the digits. This means we know the sentinels are the
      // extreme values, so we can do more aggressive checks.

      // Count the number of border cells.
      let numBorders = 0;
      for (let i = 0; i < numCells; i++) {
        if (values[i] & borderMask) numBorders++;
      }

      // If there are exactly two borders, then we know exactly which cells
      // form the sum. Perform a range check.
      // NOTE: This doesn't save any consistency checks, but does short-circuit
      // all the extra work below, so saves a small bit of time.
      if (numBorders < 2) return false;
      if (numBorders === 2) {
        let i = 0;
        let minMaxSum = 0;
        while (!(values[i++] & borderMask));
        while (!(values[i] & borderMask)) {
          minMaxSum += LookupTables.minMax16bitValue(values[i]);
          i++;
        }

        const sum = this._sum;
        const minSum = minMaxSum >> 16;
        const maxSum = minMaxSum & 0xffff;
        // It is impossible to make the target sum.
        if (sum < minSum || maxSum < sum) return false;
        // We've reached the target sum exactly.
        if (minSum == maxSum) return true;
      }
    }

    // Build up a set of valid cell values.
    const validSettings = Lunchbox._validSettings;
    validSettings.fill(0);

    // Iterate over each possible starting index for the first sentinel.
    // Check if the other values are consistent with the required sum.
    // Given that the values must form a house, this is sufficient to ensure
    // that the constraint is fully satisfied.
    let valueMask = this._valueMask;
    const [minDist, maxDist] = this._distances;
    const maxIndex = numCells - minDist;
    const shift = numCells - 1;
    let prefixValues = 0;
    let pPrefix = 0;
    let vRev = 0;
    for (let i = 0; i < maxIndex; i++) {
      let vi = values[i];
      if (isHouse) {
        // If we don't have a sentinel, move onto the next index.
        if (!(vi &= borderMask)) continue;
        // Determine what the matching sentinel value needs to be.
        vRev = borderMask & ((vi >> shift) | (vi << shift));
      }

      // For each possible gap:
      //  - Determine the currently possible values inside the gap.
      //  - Find every valid combination that can be made from these values.
      //  - Use them to determine the possible inside and outside values.
      let innerValues = 0;
      let pInner = i + 1;
      for (let j = i + minDist; j <= i + maxDist && j < numCells; j++) {
        let vj = values[j];
        if (isHouse) {
          if (!(vj &= vRev)) continue;
        } else {
          // Value mask for values that must be between the sentinels.
          valueMask = LookupTables.valueRangeExclusive(vi | vj);
        }

        while (pInner < j) innerValues |= values[pInner++];
        while (pPrefix < i) prefixValues |= values[pPrefix++];
        let outerValues = prefixValues;
        for (let k = pInner + 1; k < numCells; k++) outerValues |= values[k];
        outerValues &= valueMask;
        const numOuterCells = numCells - (j - i) - 1;

        const combinations = this._combinations[j - i];
        let innerPossibilities = 0;
        let outerPossibilities = 0;
        const disallowedInside = ~(innerValues & valueMask);

        let innerRanges = valueMask;
        let foundValidCombination = false;
        for (let k = 0; k < combinations.length; k++) {
          let c = combinations[k];
          // Check if the inner values can create the combination.
          if (!((disallowedInside & c))) {
            // Check if there are enough outer values for all the outer cells.
            if (countOnes16bit(~c & outerValues) >= numOuterCells) {
              innerPossibilities |= c;
              outerPossibilities |= ~c;
              innerRanges &= LookupTables.valueRangeInclusive(c);
              foundValidCombination = true;
            }
          }
        }

        outerPossibilities &= outerValues;
        // If we found a valid combination, populate validSettings.
        // Note: innerPossibilities or outerPossibilities may be 0 if there
        // are 0 inner or outer cells respectively, but we still need to
        // mark the border cells as valid.
        if (foundValidCombination) {
          let k = 0;
          while (k < i) validSettings[k++] |= outerPossibilities;
          validSettings[k++] |= vi & ~innerRanges;
          while (k < j) validSettings[k++] |= innerPossibilities;
          validSettings[k++] |= vj & ~innerRanges;
          while (k < numCells) validSettings[k++] |= outerPossibilities;
        }
      }
    }

    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      const newV = v & validSettings[i];
      if (!newV) return false;
      if (v !== newV) {
        grid[cells[i]] = newV;
        handlerAccumulator.addForCell(cells[i]);
      }
    }

    return true;
  }
}

// This only exists to let the solver know this is a jigsaw puzzle, and
// optimize for it.
export class JigsawPiece extends SudokuConstraintHandler {
  constructor(cells) {
    super();
    this.cells = cells;
  }
}

export class SameValues extends SudokuConstraintHandler {
  constructor(...cellSets) {
    // Sort to canonicalize the order.
    // NOTE: We must copy before sorting (to avoid messing up order for the caller).
    cellSets = cellSets.map(s => [...s].sort((a, b) => a - b));

    const setLen = cellSets[0].length;
    if (!cellSets.every(s => s.length === setLen)) {
      throw new Error('SameValues must use sets of the same length.');
    }

    super(cellSets.flat());
    this._cellSets = cellSets;
    this._valuesAreDistinct = false;
    this._numExclusionSets = setLen;
    this._maxExclusionSize = 1;

    this.idStr = [this.constructor.name, ...cellSets].join('-');
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // Determine if the cell values much be unique.
    for (const set of this._cellSets) {
      if (cellExclusions.areMutuallyExclusive(set)) {
        this._numExclusionSets = 1;
        this._maxExclusionSize = set.length;
        return true;
      }
    }

    // If they are not unique, find the number of exclusion sets.
    for (const set of this._cellSets) {
      const exclusionGroups = HandlerUtil.findExclusionGroups(
        set, cellExclusions).groups;
      // The number of exclusion sets is the minimum for any set, since this
      // constraints all the other sets.
      if (exclusionGroups.length < this._numExclusionSets) {
        this._numExclusionSets = exclusionGroups.length;
      }
      const largestGroup = Math.max(...exclusionGroups.map(g => g.length));
      if (largestGroup > this._maxExclusionSize) {
        this._maxExclusionSize = largestGroup;
      }
    }

    return true;
  }

  static _buffer1 = new Uint16Array(SHAPE_MAX.numValues);
  static _buffer2 = new Uint16Array(SHAPE_MAX.numValues);

  enforceConsistency(grid, handlerAccumulator) {
    const numSets = this._cellSets.length;
    const setLen = this._cellSets[0].length;
    const valueBuffer = this.constructor._buffer1;

    // Determine the possible values for each set.
    for (let i = 0; i < numSets; i++) {
      const s = this._cellSets[i];
      let values = 0;
      for (let j = 0; j < setLen; j++) {
        values |= grid[s[j]];
      }
      valueBuffer[i] = values;
    }

    // Determine the intersection of all the values.
    let valueIntersection = valueBuffer[0];
    let diff = 0;
    for (let i = 1; i < numSets; i++) {
      const values = valueBuffer[i];
      diff |= values ^ valueIntersection;
      valueIntersection &= values;
    }

    // We need at least enough values to fill the largest exclusion set.
    if (countOnes16bit(valueIntersection) < this._maxExclusionSize) return false;

    // Enforce the constrained value set.
    if (diff) {
      for (let i = 0; i < numSets; i++) {
        if (valueBuffer[i] === valueIntersection) continue;
        const s = this._cellSets[i];
        for (let j = setLen - 1; j >= 0; j--) {
          if (grid[s[j]] & ~valueIntersection) {
            if (!(grid[s[j]] &= valueIntersection)) return false;
            handlerAccumulator.addForCell(s[j]);
          }
        }
      }
    }

    // If all values are distinct, then we can't do any more filtering.
    if (this._numExclusionSets === 1) return true;

    return this._enforceCounts(grid, handlerAccumulator, valueIntersection);
  }

  _enforceCounts(grid, handlerAccumulator, valueIntersection) {
    const numSets = this._cellSets.length;
    const setLen = this._cellSets[0].length;
    const countBuffer = this.constructor._buffer1;
    const requiredBuffer = this.constructor._buffer2;

    let minTotals = 0;

    // Check each value to see if the counts are consistent.
    while (valueIntersection) {
      const v = valueIntersection & -valueIntersection;
      valueIntersection ^= v;

      // Determine the count and number of required cells for the value.
      // (A value is required if it is fixed).
      let minCount = setLen;
      let maxRequired = 0;
      for (let i = 0; i < numSets; i++) {
        const s = this._cellSets[i];
        let count = 0;
        let numRequired = 0;
        for (let j = 0; j < setLen; j++) {
          const gv = grid[s[j]];
          count += (gv & v) !== 0;
          numRequired += gv === v;
        }
        if (count < minCount) minCount = count;
        if (numRequired > maxRequired) maxRequired = numRequired;
        countBuffer[i] = count;
        requiredBuffer[i] = numRequired;
      }

      if (maxRequired > this._numExclusionSets) return false;
      if (maxRequired > minCount) return false;

      // TODO: Also check (maxRequired === this._numExclusionSets)?
      //       Currently can't find puzzles where this has any impact, but don't
      //       have a proof that it is unnecessary.
      if (maxRequired === minCount) {
        // If minCount === maxRequired, then we have one set where all the
        // cells with this value are fixed, hence we know the exact count.
        for (let i = 0; i < numSets; i++) {
          const s = this._cellSets[i];
          if (requiredBuffer[i] === maxRequired && countBuffer[i] > maxRequired) {
            // Remove unfixed values from require is at the max.
            for (let j = 0; j < setLen; j++) {
              if ((grid[s[j]] & v) && grid[s[j]] !== v) {
                grid[s[j]] &= ~v;
                handlerAccumulator.addForCell(s[j]);
              }
            }
          } else if (countBuffer[i] === maxRequired && requiredBuffer[i] < maxRequired) {
            // Set fixed values when count is already equal to the maxRequired.
            for (let j = 0; j < setLen; j++) {
              if ((grid[s[j]] & v) && grid[s[j]] !== v) {
                grid[s[j]] = v;
                handlerAccumulator.addForCell(s[j]);
              }
            }
          }
        }
      }

      minTotals += minCount;
    }

    if (minTotals < setLen) return false;

    return true;
  }

  priority() {
    // Otherwise double the usual priority (seems helpful empirically).
    return super.priority() * 2;
  }
}

export class SameValuesIgnoreCount extends SameValues {
  priority() {
    // This version is only used by the optimizer, so ensure it doesn't inflate
    // the priority unnecessarily.
    return 0;
  }

  _enforceCounts(grid, handlerAccumulator, valueIntersection) {
    return true;
  }
}

export class Between extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._ends = [cells[0], cells[cells.length - 1]]
    this._mids = cells.slice(1, cells.length - 1)
    this._binaryConstraint = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const exclusionGroups = HandlerUtil.findExclusionGroups(
      this._mids, cellExclusions).groups;
    const maxGroupSize = Math.max(0, ...exclusionGroups.map(a => a.length));
    const minEndsDelta = maxGroupSize ? maxGroupSize + 1 : 0;

    this._binaryConstraint = new BinaryConstraint(
      ...this._ends,
      fnToBinaryKey(
        (a, b) => Math.abs(a - b) >= minEndsDelta,
        shape.numValues));
    return this._binaryConstraint.initialize(initialGridCells, cellExclusions, shape, stateAllocator);
  }

  exclusionCells() {
    // The ends must be unique if there are any cells in the middle.
    return this._mids.length ? this._ends : [];
  }

  enforceConsistency(grid, handlerAccumulator) {
    // Constrain the ends to be consistent with each other.
    if (!this._binaryConstraint.enforceConsistency(grid, handlerAccumulator)) {
      return false;
    }

    const endsCombined = grid[this._ends[0]] | grid[this._ends[1]];
    // Constrain the mids by masking out any values that can never be between
    // the ends.
    let mask = LookupTables.valueRangeExclusive(endsCombined);
    let fixedValues = 0;
    for (let i = 0; i < this._mids.length; i++) {
      const v = (grid[this._mids[i]] &= mask);
      if (!v) return false;
      fixedValues |= (!(v & (v - 1))) * v;
    }

    // Constrain the ends by masking out anything which rules out one of the
    // mids.
    if (fixedValues) {
      mask = ~LookupTables.valueRangeInclusive(fixedValues);
      if (!(grid[this._ends[0]] &= mask)) return false;
      if (!(grid[this._ends[1]] &= mask)) return false;
    }

    return true;
  }
}

export class Lockout extends SudokuConstraintHandler {
  constructor(minDiff, cells) {
    super(cells);
    this._minDiff = +minDiff;
    this._ends = [cells[0], cells[cells.length - 1]]
    this._mids = cells.slice(1, cells.length - 1)
    this._binaryConstraint = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._binaryConstraint = new BinaryConstraint(
      ...this._ends,
      fnToBinaryKey(
        (a, b) => Math.abs(a - b) >= this._minDiff,
        shape.numValues));
    return this._binaryConstraint.initialize(initialGridCells, cellExclusions, shape, stateAllocator);
  }

  exclusionCells() {
    return this._ends;
  }

  enforceConsistency(grid, handlerAccumulator) {
    // Constrain the ends to be consistent with each other.
    if (!this._binaryConstraint.enforceConsistency(grid, handlerAccumulator)) {
      return false;
    }

    const ve0 = grid[this._ends[0]];
    const ve1 = grid[this._ends[1]];
    const min0 = LookupTables.minValue(ve0);
    const max0 = LookupTables.maxValue(ve0);
    const min1 = LookupTables.minValue(ve1);
    const max1 = LookupTables.maxValue(ve1);

    let mask = 0;
    if (min0 > max1) {
      // Case 1: cell 0 is the larger cell.
      mask = ~(-1 << (max1 - 1)) | (-1 << min0);
    } else if (min1 > max0) {
      // Case 2: cell 1 is the larger cell.
      mask = ~(-1 << (max0 - 1)) | (-1 << min1);
    } else {
      // We can't constrain the values.
      return true;
    }

    // Constrain the mids by only allowing values that aren't locked out.
    for (let i = 0; i < this._mids.length; i++) {
      if (!(grid[this._mids[i]] &= mask)) return false;
    }

    return true;
  }
}

class _Squishable2x2 extends SudokuConstraintHandler {
  // Subclasses should override these.
  static SQUISHED_MASK = 0;
  static TRIADS = [];
  static SQUISH_OFFSET = 0;

  constructor(cells) {
    super(cells);
    this._cellExclusions = null;
  }

  static _valuesBuffer = new Uint16Array(SHAPE_MAX.numValues);

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._cellExclusions = cellExclusions;

    return true;
  }

  _enforceRequiredValues(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = this.cells.length;

    // Determine the unsquished allValues and fixedValues.
    let allValues = 0;
    let fixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v;  // Avoid branching.
    }

    if (allValues == fixedValues) return true;

    const triads = this.constructor.TRIADS;
    for (let i = 0; i < triads.length; i++) {
      const triadValue = triads[i] & allValues;
      // Skip triads which have more than one value, or which are already fixed.
      if ((triadValue & (triadValue - 1)) || (triadValue & fixedValues)) {
        continue;
      }
      // Now we know `triadValue` is a required value and is in multiple cells.
      if (!HandlerUtil.enforceRequiredValueExclusions(
        grid, cells, triadValue, this._cellExclusions, handlerAccumulator)) return false;
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = this.cells.length;
    const squishedMask = this.constructor.SQUISHED_MASK;
    const valuesBuffer = this.constructor._valuesBuffer;
    const squishOffset = this.constructor.SQUISH_OFFSET;
    const squishOffset2 = squishOffset << 1;

    // This code is very similar to the House handler, but adjusted to
    // collapse the values into 3 sets.
    let allValues = 0;
    let atLeastTwo = 0;
    let atLeastThree = 0;
    let fixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      v |= (v >> squishOffset) | (v >> squishOffset2);
      v &= squishedMask;
      valuesBuffer[i] = v;
      atLeastThree |= atLeastTwo & v;
      atLeastTwo |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v;  // Avoid branching.
    }

    if (allValues != squishedMask) return false;
    if (fixedValues == squishedMask) return true;

    let hiddenSquishedSingles = allValues & ~atLeastTwo & ~fixedValues;
    if (hiddenSquishedSingles) {
      // We have "hidden singles" equivalent. Find and constrain them.
      for (let i = 0; i < numCells; i++) {
        const value = valuesBuffer[i] & hiddenSquishedSingles;
        if (value) {
          // If there there is more than one value, then this cell has
          // has multiple hidden singles, which is a contradiction.
          if (value & (value - 1)) return false;
          // Unsquish the value.
          const unsquishedValue = value | (value << squishOffset) | (value << squishOffset2);
          const cell = cells[i];
          grid[cell] &= unsquishedValue;
          handlerAccumulator.addForCell(cell);
        }
      }
      fixedValues |= hiddenSquishedSingles;
    }

    // Look for hidden pairs if there are at least 2 values set in exactly
    // two places.
    const exactlyTwo = atLeastTwo & ~atLeastThree & ~fixedValues;
    if (exactlyTwo & (exactlyTwo - 1)) {
      for (let i = 0; i < numCells - 1; i++) {
        const v = valuesBuffer[i] & exactlyTwo;
        if (!(v & (v - 1))) continue;

        for (let j = i + 1; j < numCells; j++) {
          if (!(v & ~valuesBuffer[j])) {
            // The jth cell includes all the values in v. Thus we have a
            // pair.
            // Eliminate all other values from the pair in case it is a
            // hidden pair.
            const unsquishedValue = v | (v << squishOffset) | (v << squishOffset2);
            grid[cells[i]] &= unsquishedValue;
            grid[cells[j]] &= unsquishedValue;
          }
        }
      }
    }

    return this._enforceRequiredValues(grid, handlerAccumulator);
  }
}


// Enforce the "Global entropy" constraint for a single 2x2 region.
export class LocalEntropy extends _Squishable2x2 {
  static SQUISHED_MASK = LookupTables.fromValuesArray([1, 4, 7]);
  static TRIADS = [
    LookupTables.fromValuesArray([1, 2, 3]),
    LookupTables.fromValuesArray([4, 5, 6]),
    LookupTables.fromValuesArray([7, 8, 9])];
  static SQUISH_OFFSET = 1;
}

// Enforce the "Global mod 3" constraint for a single 2x2 region.
export class LocalMod3 extends _Squishable2x2 {
  static SQUISHED_MASK = LookupTables.fromValuesArray([1, 2, 3]);
  static TRIADS = [
    LookupTables.fromValuesArray([1, 4, 7]),
    LookupTables.fromValuesArray([2, 5, 8]),
    LookupTables.fromValuesArray([3, 6, 9])];
  static SQUISH_OFFSET = 3;
}

export class DutchFlatmateLine extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._mid = LookupTables.fromValue(Math.ceil(cells.length / 2));
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const target = this._mid;
    const above = 1;
    const below = LookupTables.fromValue(cells.length);

    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      if (!(v & target)) continue;

      // Check above and below.
      let ok = 0;
      if (i > 0 && grid[cells[i - 1]] & above) ok |= 1;
      if (i < numCells - 1 && grid[cells[i + 1]] & below) ok |= 2;

      if (!ok) {
        // Not a valid cell for the target.
        if (!(grid[cells[i]] &= ~target)) return false;
      } else if (v == target) {
        // Only one valid flatmate (either above or below).
        if (ok === 1) {
          grid[cells[i - 1]] = above;
        } else if (ok === 2) {
          grid[cells[i + 1]] = below;
        }
      }
    }

    return true;
  }
}

export class RequiredValues extends SudokuConstraintHandler {
  constructor(cells, values, strict) {
    super(cells);
    this._values = values;
    this._strict = strict;

    this._valueCounts = new Map(values.map(v => [v, 0]));
    for (const v of values) {
      this._valueCounts.set(v, this._valueCounts.get(v) + 1);
    }
  }

  valueCounts() {
    return this._valueCounts;
  }

  values() {
    return this._values;
  }

  exclusionCells() {
    // If there are as many values as cells, then each cell must be different.
    if (this._valueCounts.size == this.cells.length) {
      return this.cells;
    }
    return [];
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._cellExclusions = cellExclusions;
    const cells = this.cells;

    this._valueMask = LookupTables.fromValuesArray(this._values);
    this._singleValues = LookupTables.fromValuesArray(
      this._values.filter(v => this._valueCounts.get(v) == 1));
    // Repeated values is an array of masks [v_n, otherValues_n, ...]
    this._repeatedValues = [];
    for (const [value, count] of this._valueCounts) {
      if (count > 1) {
        const v = LookupTables.fromValue(value);
        this._repeatedValues.push(v, count, this._valueMask & ~v);
      }
    }

    // If the size is exact, then there can be no other values in the cells.
    if (this._values.length == this.cells.length) {
      for (const cell of this.cells) {
        if (!(initialGridCells[cell] &= this._valueMask)) return false;
      }
    }

    // Find any cells which are mutually exclusive with the entire
    // constraint and remove the values from them.
    let commonExclusions = cellExclusions.getArray(cells[0]);
    for (let i = 0; i < cells.length; i++) {
      commonExclusions = arrayIntersect(
        commonExclusions, cellExclusions.getArray(cells[i]));
    }
    for (const cell of commonExclusions) {
      if (!(initialGridCells[cell] &= ~this._valueMask)) return false;
    }

    // Find the maximum valid count for any repeated value, based on the
    // exclusions.
    const exclusionGroups = HandlerUtil.findExclusionGroups(
      this.cells, cellExclusions).groups;
    const maxCount = exclusionGroups.length;
    for (const count of this._valueCounts.values()) {
      if (count > maxCount) {
        return false;
      }
    }

    return true;
  }

  _enforceRepeatedValues(grid, handlerAccumulator) {
    const repeatedValues = this._repeatedValues;
    const cells = this.cells;
    const numCells = cells.length;
    const strict = this._strict;

    for (let i = 0; i < repeatedValues.length; i += 3) {
      const target = repeatedValues[i];
      const targetCount = repeatedValues[i + 1];

      let count = 0;
      let fixedCount = 0;
      for (let j = 0; j < numCells; j++) {
        const v = grid[cells[j]];
        count += !!(v & target);
        fixedCount += v === target;
      }

      if (count < targetCount) return false;
      if (strict && fixedCount > targetCount) return false;
      if (count == targetCount && fixedCount !== targetCount) {
        for (let j = 0; j < numCells; j++) {
          if (grid[cells[j]] & target) {
            grid[cells[j]] = target;
          }
        }
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const hasRepeatedValues = this._repeatedValues.length > 0;

    if (hasRepeatedValues) {
      // NOTE: This must happen before the valueMask & ~fixedValues
      // check as that can return true even if all repeated values aren't
      // satisfied.
      if (!this._enforceRepeatedValues(grid, handlerAccumulator)) return false;
    }

    let allValues = 0;
    let nonUniqueValues = 0;
    let fixedValues = 0;
    let numFixed = 0;
    let fixedNonUniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      if (!(v & (v - 1))) {
        fixedNonUniqueValues |= fixedValues & v;
        fixedValues |= v;
        numFixed++;
      }
      nonUniqueValues |= allValues & v;
      allValues |= v;
    }

    const valuesMask = this._valueMask;
    if (valuesMask & ~allValues) return false;
    if (this._strict && (fixedNonUniqueValues & this._singleValues)) return false;
    if (!(valuesMask & ~fixedValues)) return true;

    // Only check for hidden singles when we don't have a repeated value.
    const hiddenSingles = this._singleValues & ~nonUniqueValues & ~fixedValues;
    if (hiddenSingles) {
      if (!HandlerUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
        return false;
      }
      fixedValues |= hiddenSingles;
      numFixed += countOnes16bit(hiddenSingles);
    }

    const remainingValues = valuesMask & ~fixedValues;
    const numRemainingCells = numCells - numFixed;
    if (countOnes16bit(remainingValues) == numRemainingCells) {
      // The number of remaining cell is exactly the number of remaining values.
      // We can constrain the remaining cells to the remaining values.
      for (let i = 0; i < numCells; i++) {
        const v = grid[cells[i]];
        // If this cell is fixed, skip it.
        if (!(v & ~fixedValues)) continue;
        // Otherwise if there are unwanted values, remove them.
        if (v & ~remainingValues) {
          if (!(grid[cells[i]] = v & remainingValues)) return false;
        }
      }
    }

    return true;
  }
}

export class SumLine extends SudokuConstraintHandler {
  constructor(cells, loop, sum) {
    super(cells);
    this._sum = +sum;

    if (this._sum > 30) {
      // A sum of 30 fits within a 32-bit state.
      throw new Error('SumLine sum must at most 30');
    }

    // Each state is a mask that represents the possible partial sums of a
    // segment at a particular point. The i-th state corresponds to the
    // cell boundary before the i-th cell.
    this._states = new Uint32Array(this.cells.length + 1);

    // In a loop, all partial sums are valid initial states.
    // In a line, the partial sum must start at 0.
    this._initialState = loop ? (1 << sum) - 1 : 1;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return true;
  }

  _singlePass(grid) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum;
    const states = this._states;

    // Forward pass to determine the possible partial sums at each cell
    // boundary, based on what came before on the line.
    for (let i = 0; i < numCells; i++) {
      let nextState = 0;

      let values = grid[cells[i]];
      while (values) {
        const v = values & -values;
        values ^= v;
        nextState |= states[i] << LookupTables.toValue(v);
      }

      nextState |= (nextState >> sum) & 1;
      states[i + 1] = nextState;
    }

    states[0] = (states[numCells] &= states[0]);

    // Backward pass to determine the possible partial sums at each cell
    // boundary, based on what came after on the line. Simultaneously,
    // eliminate cell values that are inconsistent with the possible partial
    // sums at either boundary.
    for (let i = numCells - 1; i >= 0; i--) {
      let newBefore = 0;

      let values = grid[cells[i]];
      let possibleValues = 0;
      while (values) {
        const v = values & -values;
        values ^= v;

        const afterState = states[i + 1];
        const possibleBefore = (afterState | ((afterState & 1) << sum)) >> LookupTables.toValue(v);
        newBefore |= possibleBefore;
        if ((possibleBefore & states[i])) {
          possibleValues |= v;
        }
      }
      if (!possibleValues) return false;
      grid[cells[i]] = possibleValues;

      states[i] &= newBefore;
    }

    return true;
  }

  _checkTotalSum(grid) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum;

    // Check that the totalSum == 0 (mod sum), which is equivalent
    // to checking that the partialSum is the same at the start and the end
    // (because partialSums are all distinct modulo sum).

    let minMax = 0;
    for (let i = 0; i < numCells; i++) {
      minMax += LookupTables.minMax16bitValue(grid[cells[i]]);
    }

    const maxTotal = minMax & 0xffff;
    const minTotal = minMax >> 16;

    // Check if it possible to reach the sum.
    if (maxTotal < sum) return false;
    // If the maximum sum is a multiple of the sum, then we know this is valid.
    const maxRemainder = maxTotal % sum;
    if (maxRemainder == 0) return true;

    // Otherwise for the total to be a multiple of sum, the min and max must be
    // different integers when divided by sum.
    return minTotal < maxTotal - maxRemainder;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const states = this._states;
    const numCells = this.cells.length;

    states[0] = this._initialState;
    // Initialize final state to be different from initial state.
    states[numCells] = 0;

    // Keep iterating while the final state is not consistent with the initial
    // state. This means that the backward pass eliminated some possibilities
    // thus another iteration is needed.
    while (states[0] != states[numCells]) {
      if (!this._singlePass(grid)) return false;
    }

    const partialSums = states[0];
    // If partialSum is unique, this must have a valid solution.
    if (!(partialSums & (partialSums - 1))) {
      return true;
    }

    // If there are multiple possible partial sums, then initial and final
    // states may be inconsistent. In this case, check that the total is
    // a multiple of sum.
    return this._checkTotalSum(grid);
  }
}

export class ValueIndexing extends SudokuConstraintHandler {
  constructor(valueCell, controlCell, ...indexedCells) {
    super([valueCell, controlCell, ...indexedCells]);
    this._controlCell = controlCell;
    this._valueCell = valueCell;
    this._indexedCells = indexedCells;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const numCells = this._indexedCells.length;
    const mask = (1 << numCells) - 1;
    initialGridCells[this._controlCell] &= mask;

    return !!initialGridCells[this._valueCell];
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this._indexedCells;
    const controlCell = this._controlCell
    const numCells = cells.length;
    const valueCell = this._valueCell;

    const originalControl = grid[controlCell];
    const originalValues = grid[valueCell];

    let possibleValues = 0;
    let possibleControl = 0;
    for (let i = 0, v = 1; i < numCells; i++, v <<= 1) {
      if ((originalControl & v) && (grid[cells[i]] & originalValues)) {
        possibleValues |= grid[cells[i]] & originalValues;
        possibleControl |= v;
      }
    }

    // If there is a single control value then we can constrain the indexed
    // cell.
    if (!(possibleControl & (possibleControl - 1))) {
      const index = LookupTables.toIndex(possibleControl);
      const cell = cells[index];
      grid[cell] = (possibleValues &= grid[cell]);
      if (grid[cell] === 0) return false;
    }

    if (originalValues !== possibleValues) {
      if (!(grid[valueCell] = possibleValues)) return false;
      handlerAccumulator.addForCell(valueCell);
    }

    if (possibleControl !== originalControl) {
      if (!(grid[controlCell] = possibleControl)) return false;
      handlerAccumulator.addForCell(controlCell);
    }

    return true;
  }
}

export class Indexing extends SudokuConstraintHandler {
  constructor(controlCell, indexedCells, indexedValue) {
    super([controlCell]);
    this._controlCell = controlCell;
    this._indexedCells = indexedCells;
    this._indexedValue = LookupTables.fromValue(+indexedValue);
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this._indexedCells;
    const controlCell = this._controlCell
    const numCells = cells.length;
    const indexedValue = this._indexedValue;

    let controlValue = grid[controlCell];
    for (let i = 0, v = 1; i < numCells; i++, v <<= 1) {
      if (controlValue & v) {
        // If the control cell has can take this value, then the corresponding
        // indexed cell must have the indexed value.
        if (!(grid[cells[i]] & indexedValue)) {
          controlValue &= ~v;
        }
      } else {
        // If the control cell can't take this value, then the corresponding
        // indexed cell must not have the indexed value.
        if (grid[cells[i]] & indexedValue) {
          if (!(grid[cells[i]] &= ~indexedValue)) return false;
          handlerAccumulator.addForCell(cells[i]);
        }
      }
    }

    if (controlValue !== grid[controlCell]) {
      if (!(grid[controlCell] = controlValue)) return false;
      handlerAccumulator.addForCell(controlCell);
    }

    return true;
  }
}

export class CountingCircles extends SudokuConstraintHandler {
  constructor(cells) {
    // Ensure that cells are sorted:
    // - Makes sure that the constraint performance is independent of the sort
    //   order of the cells.
    // - Required for exclusion grouping to work optimally.
    cells = cells.slice();
    cells.sort((a, b) => a - b);
    super(cells);
  }

  static _sumCombinations = memoize((shape) => {
    const maxSum = shape.maxSum;
    const lookupTables = LookupTables.get(shape.numValues);

    const combinations = [];
    for (let i = 0; i < maxSum + 1; i++) combinations.push([]);

    for (let i = 0; i < lookupTables.combinations; i++) {
      combinations[lookupTables.sum[i]].push(i);
    }

    return combinations;
  });

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const numCells = this.cells.length;
    const combinations = this.constructor._sumCombinations(shape)[numCells];
    if (!combinations) return false;

    const exclusionGroups = HandlerUtil.findExclusionGroups(
      this.cells, cellExclusions).groups;

    // Restrict values to the possible sums.
    // We can't have more values than exclusion groups.
    let allowedValues = combinations.reduce((a, b) => a | b, 0);
    allowedValues &= (1 << exclusionGroups.length) - 1;

    for (let i = 0; i < numCells; i++) {
      if (!(initialGridCells[this.cells[i]] &= allowedValues)) return false;
    }
    this._combinations = new Uint16Array(combinations);
    this._numValues = shape.numValues;

    this._exclusionMap = new Uint16Array(this.cells.length);
    this._exclusionGroups = exclusionGroups;
    for (let i = 0; i < exclusionGroups.length; i++) {
      for (const cell of exclusionGroups[i]) {
        this._exclusionMap[this.cells.indexOf(cell)] = 1 << i;
      }
    }

    // Complements to the exclusions groups.
    this._exclusionComplements = exclusionGroups.map(
      g => cellExclusions.getListExclusions(g));

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    // Find all the current values.
    let allValues = 0;
    let fixedValues = 0;
    let unfixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      allValues |= v;
      if (!(v & (v - 1))) {
        fixedValues |= v;
      } else {
        unfixedValues |= v;
      }
    }

    // Find which combinations are valid.
    let requiredValues = allValues;
    let allowedValues = 0;
    {
      const combinations = this._combinations;
      const numCombinations = combinations.length;
      for (let i = 0; i < numCombinations; i++) {
        const c = combinations[i];
        // If c doesn't contain all fixed values or contains any values not
        // in allValues, then it can't be a valid combination.
        if (fixedValues & ~c) continue;
        if (c & ~allValues) continue;
        allowedValues |= c;
        requiredValues &= c;
      }
      if (!allowedValues) return false;
    }

    // Restrict values to be valid if required.
    if (allowedValues !== allValues) {
      for (let i = 0; i < numCells; i++) {
        if (!(grid[cells[i]] &= allowedValues)) return false;
      }
    }

    // Count each possible value and restrict cells.
    const numValues = this._numValues;
    const exclusionMap = this._exclusionMap;
    // Iterate in reverse order as larger numbers are more constrained.
    for (let j = numValues; j > 0; j--) {
      const v = LookupTables.fromValue(j);
      if (!(v & allowedValues)) continue;

      let totalCount = 0;
      let fixedCount = 0;
      let vExclusionGroups = 0;
      for (let i = 0; i < numCells; i++) {
        if (grid[cells[i]] & v) {
          totalCount++;
          fixedCount += (grid[cells[i]] === v);
          vExclusionGroups |= exclusionMap[i];
        }
      }
      const numExclusionGroups = countOnes16bit(vExclusionGroups);

      if (fixedCount > j) {
        // There are too many fixed values.
        return false;
      }
      if (numExclusionGroups < j) {
        // If there are too few exclusion groups, then we can't have this value.
        // If the value is required, then this is a conflict.
        if (v & requiredValues) {
          return false;
        } else {
          for (let i = 0; i < numCells; i++) {
            if (!(grid[cells[i]] &= ~v)) return false;
          }
        }
      } else if (totalCount === j) {
        // If we have the exact count and the value is required,
        // then we can fix the values.
        if (v & requiredValues & unfixedValues) {
          for (let i = 0; i < numCells; i++) {
            if (grid[cells[i]] & v) {
              grid[cells[i]] = v;
            }
          }
        }
      } else if (numExclusionGroups === j && (v & requiredValues & unfixedValues)) {
        // If there is an exact number of exclusion groups, then check if
        // any have just a single cell and hence can be fixed.
        while (vExclusionGroups) {
          const vGroup = vExclusionGroups & -vExclusionGroups;
          vExclusionGroups ^= vGroup;
          const groupIndex = LookupTables.toIndex(vGroup);
          const group = this._exclusionGroups[groupIndex];
          let uniqueCell = 0;
          let count = 0;
          for (let k = 0; k < group.length; k++) {
            const cell = group[k];
            if (grid[cell] & v) {
              if (++count > 1) break;
              uniqueCell = cell;
            }
          }

          if (count === 1) {
            // If it's unique, then we can fix the value.
            grid[uniqueCell] = v;
          } else {
            // Otherwise remove it from complement groups.
            const complement = this._exclusionComplements[groupIndex];
            for (let k = 0; k < complement.length; k++) {
              if (!(grid[complement[k]] &= ~v)) return false;
            }
          }
        }
      }
    }

    return true;
  }
}

export class NumberedRoom extends SudokuConstraintHandler {
  constructor(cells, value) {
    super([cells[0]]);
    this._cells = new Uint8Array(cells);
    this._value = LookupTables.fromValue(+value);
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this._cells;
    const numCells = cells.length;
    const clueValue = this._value;

    let controlV = grid[this.cells[0]];
    for (let i = 0, iv = 1; i < numCells; i++, iv <<= 1) {
      const v = grid[cells[i]];
      if (v & clueValue) {
        if (!(controlV & iv)) {
          // This cell can't have the clue value because the control
          // cell is not set.
          if (!(grid[cells[i]] &= ~clueValue)) return false;
        }
      } else {
        // The control value can't have this index because the cell doesn't
        // allow the clue value.
        if (!(controlV &= ~iv)) return false;
      }
    }

    grid[cells[0]] = controlV;

    return true;
  }
}

export class FullRank extends SudokuConstraintHandler {
  static TIE_MODE = Object.freeze({
    NONE: 0,
    ONLY_UNCLUED: 1,
    ANY: 2,
  });

  static buildEntries(shape) {
    const numRows = shape.numRows;
    const numCols = shape.numCols;
    const entries = [];
    for (let i = 0; i < numRows; i++) {
      const row = Uint8Array.from(
        { length: numCols }, (_, j) => i * numCols + j);
      entries.push(row);
      entries.push(row.slice().reverse());
    }
    for (let i = 0; i < numCols; i++) {
      const col = Uint8Array.from(
        { length: numRows }, (_, j) => j * numCols + i);
      entries.push(col);
      entries.push(col.slice().reverse());
    }
    return entries;
  }

  static entryFromClue(entries, clue) {
    return entries.find(
      e => e[0] === clue.line[0] && e[1] === clue.line[1]);
  }

  constructor(numGridCells, clues, tieMode = FullRank.TIE_MODE.ONLY_UNCLUED) {
    const allCells = Uint8Array.from({ length: numGridCells }, (_, i) => i);
    super(allCells);

    // FullRank clues must have unique ranks (The builder/optimizer should
    // insert same-values checks if the cells need to be the same).
    const seenRanks = new Set();
    for (const clue of clues) {
      if (seenRanks.has(clue.rank)) {
        throw new Error(`FullRank clue rank ${clue.rank} is not unique`);
      }
      seenRanks.add(clue.rank);
    }

    this._tieMode = tieMode;
    this._uncluedEntries = [];
    this._allEntries = [];
    this._rankSets = [];
    this._clues = clues;
    this._pairBitSetsBuffer = null;
    this._seenPairsBuffer = null;
  }

  clues() {
    return this._clues;
  }

  tieMode() {
    return this._tieMode;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // FullRank requires square grids.
    if (!shape.isSquare()) {
      throw new Error('FullRank requires a square grid');
    }
    // Initialize entries.
    const entries = FullRank.buildEntries(shape);

    this._allEntries = entries;

    // Buffers used by _rejectFixedTies(). Allocate once per shape so they can
    // be reused and sorting works naturally.
    this._seenPairsBuffer = new Uint32Array(shape.numValues * 4);
    this._pairBitSetsBuffer = new Uint16Array(shape.numValues);

    // Group entries with the same initial values.
    // i.e. the same int((rank+3)/4)
    const isClued = new Set();
    const rankMap = new MultiMap();
    for (const clue of this._clues) {
      const value = LookupTables.fromValue((clue.rank + 3) >> 2);
      const entry = FullRank.entryFromClue(entries, clue);
      if (!entry) return false;
      isClued.add(entry);
      rankMap.add(value, {
        rankIndex: (clue.rank + 3) & 3,
        entry,
        numRanksBelow: 0,
        numRanksAbove: 0,
      });
      if (!(initialGridCells[clue.line[0]] &= value)) {
        return false;
      }
    }

    // Unclued entries are all entries not referenced by any clue.
    this._uncluedEntries = entries.filter(entry => !isClued.has(entry));

    for (const [value, givens] of rankMap) {
      // Sort givens by rank.
      givens.sort((a, b) => a.rankIndex - b.rankIndex);
      // Determine the number of unclued entries required to be less and greater
      // than this given.
      const numGivens = givens.length;
      for (let i = 0; i < givens.length; i++) {
        const given = givens[i];
        const rankIndex = given.rankIndex;
        given.numRanksBelow = rankIndex - i;
        given.numRanksAbove = (3 - rankIndex) - (numGivens - i - 1);
      }
      // Make the rankSet.
      this._rankSets.push({
        value: value,
        givens: givens,
      });
    }
    return true;
  }

  _enforceUniqueRanks(grid) {
    // Whole-grid tie-check. Only checks fixed values.

    // For each entry, if the first and last cell is fixed to some value, then
    // look for duplicates, and do a full comparison if required.
    // *every* cell in the entry is fixed, reject if another fully-fixed entry
    // with the same first value has identical digits.

    const allEntries = this._allEntries;
    const lastIndex = allEntries[0].length - 1;
    const midIndex = lastIndex >> 1;

    const pairBitSets = this._pairBitSetsBuffer;
    pairBitSets.fill(0);
    const seenPairs = this._seenPairsBuffer;
    seenPairs.fill(0);

    let hasDuplicatePair = false;

    // Go two-by-two since we can process the forward and reverse entries
    // together.
    for (let i = 0; i < allEntries.length; i += 2) {
      const entry = allEntries[i];

      // Ensure the first and last values are fixed.
      let firstV = grid[entry[0]];
      if ((firstV & (firstV - 1)) !== 0) continue;
      let lastV = grid[entry[lastIndex]];
      if ((lastV & (lastV - 1)) !== 0) continue;

      // We check midIndex as a quick way to skip non-fully-fixed entries.
      // The endpoint are more likely to be filled in first so they will lead
      // to many false positives.
      let midV = grid[entry[midIndex]];
      if ((midV & (midV - 1)) !== 0) continue;

      let index = i;
      if (firstV > lastV) {
        [firstV, lastV] = [lastV, firstV];
        index = i + 1;
      }
      const valueIndex = LookupTables.toIndex(firstV);

      if (pairBitSets[valueIndex] & lastV) {
        hasDuplicatePair = true;
      } else {
        pairBitSets[valueIndex] |= lastV;
      }

      seenPairs[index] = ((firstV | lastV) << 16) | index;
    }

    if (!hasDuplicatePair) return true;

    seenPairs.sort(); // Numeric sort on typed array.

    // For each duplicated endpoint-pair, compare fully fixed entries.
    // Sorting puts unused (0) entries at the start.
    // Iterate backwards over the valid entries and stop once we hit 0.
    for (let end = seenPairs.length; end > 0;) {
      const key = seenPairs[end - 1] >>> 16;
      if (key === 0) break;
      let start = end - 1;
      while (start > 0 && (seenPairs[start - 1] >>> 16) === key) start--;

      if (end - start > 1) {
        for (let a = start + 1; a < end; a++) {
          const entryA = allEntries[seenPairs[a] & 0xffff];
          for (let b = start; b < a; b++) {
            const entryB = allEntries[seenPairs[b] & 0xffff];

            let isTie = true;
            // Endpoints are already fixed (or this pair wouldn't be in seenPairs).
            // Reject only if every interior digit is fixed and equal.
            for (let j = 1; j < lastIndex; j++) {
              const vA = grid[entryA[j]];
              const vB = grid[entryB[j]];
              // Fixed-only: only reject when every digit is fixed and equal.
              if (vA !== vB || (vA & (vA - 1)) !== 0) {
                isTie = false;
                break;
              }
            }

            if (isTie) return false;
          }
        }
      }

      end = start;
    }

    return true;
  }

  _viableEntriesBuffer = new Int16Array(SHAPE_MAX.numValues * 4 + 1);
  _flagsBuffer = new Uint8Array(SHAPE_MAX.numValues * 4);

  _enforceUncluedEntriesForGiven(
    grid, handlerAccumulator, viableEntries, numViableEntries, given) {
    const { entry, numRanksBelow, numRanksAbove } = given;
    const permissiveClues = this._tieMode === FullRank.TIE_MODE.ANY;
    const entries = this._uncluedEntries;
    const initialV = grid[entry[0]];
    const entryLength = entry.length;

    const flagsBuffer = this._flagsBuffer;
    const IS_SET_FLAG = 1;
    const IS_LESS_FLAG = 2;
    const IS_GREATER_FLAG = 4;
    const IS_NOT_EQUAL = 8;
    const IS_EITHER_SIDE = IS_LESS_FLAG | IS_GREATER_FLAG;

    let maybeLessCount = 0;
    let maybeGreaterCount = 0;
    let fixedLessCount = 0;
    let fixedGreaterCount = 0;

    // Permissive clues need to explicitly track the not-equal state
    // to determine if entries are strictly less/greater.
    const fixedBaseFlags = IS_SET_FLAG | (permissiveClues ? IS_NOT_EQUAL : 0);

    for (let i = 0; i < numViableEntries; i++) {
      const e = entries[viableEntries[i]];

      let flags = grid[e[0]] === initialV ? IS_SET_FLAG : 0;

      // Mask out values which are assumed to be fixed (equal) in the preceding
      // cells. At each iteration, we are assuming that all previous values
      // are equal between the two entries, and the current cell is a
      // tie-breaker.
      let equalValuesMask = ~initialV;
      for (let j = 1; j < entryLength; j++) {
        const eV = grid[e[j]] & equalValuesMask;
        const entryV = grid[entry[j]] & equalValuesMask;

        const minE = LookupTables.minValue(eV);
        const maxE = LookupTables.maxValue(eV);
        const minEntry = LookupTables.minValue(entryV);
        const maxEntry = LookupTables.maxValue(entryV);

        if (maxE > minEntry) flags |= IS_GREATER_FLAG;
        if (minE < maxEntry) flags |= IS_LESS_FLAG;
        if ((entryV & eV) === 0) flags |= IS_NOT_EQUAL;

        // Break if we've:
        //  - found both possibilities;
        //  -  or found that this cell forces a direction.
        if ((flags & IS_EITHER_SIDE) === IS_EITHER_SIDE) break;
        if (minE > maxEntry || maxE < minEntry) break;

        // If we are continuing then we are attempting to break a tie assuming
        // that the entries are equal.
        // There must be exactly one value in the intersection (otherwise
        // both the IS_LESS_FLAG and IS_GREATER_FLAG would be set).
        // Thus if we take the intersection, we know that value can't appear in
        // future cells.
        equalValuesMask &= ~(eV & entryV);
      }

      // In non-permissive modes (i.e. not TIE_MODE.ANY), entries must not tie a
      // clued entry. If an entry is set into this rank set but is neither
      // provably <, >, nor provably != the clued entry, then it is a forced
      // whole-entry tie candidate, which would imply the clued rank is tied.
      if (!permissiveClues) {
        if (flags === IS_SET_FLAG) {
          // (IS_LESS_FLAG | IS_GREATER_FLAG | IS_NOT_EQUAL) === 0
          return false;
        }

        // TODO: We can utilize IS_NOT_EQUAL better, but for now this is
        // to ensure that the non-permissive clues work correctly.
        flags |= IS_NOT_EQUAL;
      }

      flagsBuffer[i] = flags;

      const hasLess = (flags & IS_LESS_FLAG) !== 0;
      const hasGreater = (flags & IS_GREATER_FLAG) !== 0;

      if (hasGreater) {
        maybeGreaterCount++;
        if (!hasLess && (~flags & fixedBaseFlags) === 0) fixedGreaterCount++;
      }
      if (hasLess) {
        maybeLessCount++;
        if (!hasGreater && (~flags & fixedBaseFlags) === 0) fixedLessCount++;
      }
    }

    // Check we have enough entries.
    if (maybeLessCount < numRanksBelow) return false;
    // Check if we have too many entries.
    if (fixedLessCount > numRanksBelow) return false;
    if (maybeLessCount == numRanksBelow && fixedLessCount < numRanksBelow) {
      // If all viable entries are required, then they are forced to be included.
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] & IS_LESS_FLAG) {
          const cell = entries[viableEntries[i]][0];
          grid[cell] = initialV;
          handlerAccumulator.addForCell(cell);
        }
      }
    } else if (fixedLessCount === numRanksBelow && maybeLessCount > numRanksBelow) {
      // If all viable set entries fill up the required slots, then any other
      // viable entries must be excluded.
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] === (IS_LESS_FLAG | IS_NOT_EQUAL)) {
          // This entry only had the invalid direction, so we can exclude it.
          const cell = entries[viableEntries[i]][0];
          grid[cell] &= ~initialV;
          handlerAccumulator.addForCell(cell);
        } else if (flagsBuffer[i] === (IS_LESS_FLAG | IS_GREATER_FLAG | IS_SET_FLAG | IS_NOT_EQUAL)) {
          // This entry must be included, but currently allows both directions.
          // Try to constraint it to just the valid direction.
          if (!this._enforceOrderedEntryPair(grid, handlerAccumulator,
            entry, entries[viableEntries[i]])) {
            return false;
          }
        }
      }
    }

    // Repeat for the greater direction.
    if (fixedGreaterCount > numRanksAbove) return false;
    if (!permissiveClues && maybeGreaterCount < numRanksAbove) return false;
    if (!permissiveClues && maybeGreaterCount == numRanksAbove && fixedGreaterCount < numRanksAbove) {
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] & IS_GREATER_FLAG) {
          const cell = entries[viableEntries[i]][0];
          grid[cell] = initialV;
          handlerAccumulator.addForCell(cell);
        }
      }
    } else if (fixedGreaterCount === numRanksAbove && maybeGreaterCount > numRanksAbove) {
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] === (IS_GREATER_FLAG | IS_NOT_EQUAL)) {
          const cell = entries[viableEntries[i]][0];
          grid[cell] &= ~initialV;
          handlerAccumulator.addForCell(cell);
        } else if (flagsBuffer[i] === (IS_LESS_FLAG | IS_GREATER_FLAG | IS_SET_FLAG | IS_NOT_EQUAL)) {
          if (!this._enforceOrderedEntryPair(grid, handlerAccumulator,
            entries[viableEntries[i]], entry)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  _enforceOrderedEntryPair(grid, handlerAccumulator, lowEntry, highEntry) {
    // We know that lowEntry must be lower then highEntry, and are in the same
    // rank set.
    // Algorithm:
    //  - Keep iterating until we find the first cell where the entries could
    //    possibly differ, i.e. when are not equal fixed values.
    //  - For that cell only, filter out any values which would cause lowEntry
    //    to be higher than highEntry.
    //  - Stop if the cells are still not equal fixed values.
    //
    // NOTE: This ordering is strict. If the entries are forced to be equal in
    // every compared cell, then the ordering constraint is violated.

    // Keep track of which fixed values we've seen. These can be removed from
    // future cells.
    let equalValuesMask = ~(grid[lowEntry[0]] & grid[highEntry[0]]);
    const entryLength = lowEntry.length;
    for (let i = 1; i < entryLength; i++) {
      let lowV = grid[lowEntry[i]] & equalValuesMask;
      let highV = grid[highEntry[i]] & equalValuesMask;
      // If both are set, and equal, then keep looking.
      if (lowV === highV && !(lowV & (lowV - 1))) {
        equalValuesMask &= ~lowV;
        continue;
      }
      const maxHighV = LookupTables.maxValue(highV);
      if (LookupTables.maxValue(lowV) > maxHighV) {
        const mask = (1 << maxHighV) - 1;
        grid[lowEntry[i]] = (lowV &= mask & equalValuesMask);
        handlerAccumulator.addForCell(lowEntry[i]);
      }
      const minLowV = LookupTables.minValue(lowV);
      if (LookupTables.minValue(highV) < minLowV) {
        const mask = -1 << (minLowV - 1);
        grid[highEntry[i]] = (highV &= mask & equalValuesMask);
        handlerAccumulator.addForCell(highEntry[i]);
      }
      if (!lowV || !highV) return false;
      // If the cells are now equal and fixed, then we can keep constraining.
      if (!(lowV === highV && !(lowV & (lowV - 1)))) {
        return true;
      }
      equalValuesMask &= ~lowV;
    }

    // If we got through the entire entry without finding a non-equal fixed
    // position, then the two entries are equal and hence violate the ordering.
    return false;
  }

  _enforceSingleRankSet(grid, handlerAccumulator, rankSet) {
    const { value, givens } = rankSet;
    const numGivens = givens.length;

    // First constraint the clued ranks against each other.
    for (let i = 1; i < numGivens; i++) {
      if (!this._enforceOrderedEntryPair(grid, handlerAccumulator,
        givens[i - 1].entry, givens[i].entry)) {
        return false;
      }
    }

    // If all ranks are clued, then we are done.
    if (numGivens == 4) return true;

    // Find all unclued entries that are viable.
    const entries = this._uncluedEntries;
    let numViableEntries = 0;
    const viableEntries = this._viableEntriesBuffer;
    for (let i = 0; i < entries.length; i++) {
      if (grid[entries[i][0]] & value) {
        viableEntries[numViableEntries++] = i;
      }
    }

    // Return false if we don't have enough viable entries.
    if (numViableEntries < 4 - numGivens) return false;

    // Enforce the unclued entries.
    for (let i = 0; i < numGivens; i++) {
      if (!this._enforceUncluedEntriesForGiven(
        grid, handlerAccumulator, viableEntries, numViableEntries, givens[i])) {
        return false;
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    for (let i = 0; i < this._rankSets.length; i++) {
      if (!this._enforceSingleRankSet(
        grid, handlerAccumulator, this._rankSets[i])) {
        return false;
      }
    }

    return this._tieMode === FullRank.TIE_MODE.NONE ? this._enforceUniqueRanks(grid) : true;
  }

  candidateFinders(grid, shape) {
    const finders = [];
    const numRows = shape.numRows;
    const numCols = shape.numCols;

    for (const rankSet of this._rankSets) {
      const value = rankSet.value;

      // Determine which edges don't have clues.
      const flags = [1, 1, 1, 1];
      for (const given of rankSet.givens) {
        const cell0 = given.entry[0];
        const [row, col] = shape.splitCellIndex(cell0);
        if (row === 0) flags[0] = 0;
        if (col === 0) flags[1] = 0;
        if (row === numRows - 1) flags[2] = 0;
        if (col === numCols - 1) flags[3] = 0;
      }

      // Create a multiplier than prioritizes rankSets which have more clues.
      const multiplier = 4 - (flags[0] + flags[1] + flags[2] + flags[3]);

      const addFinder = (cells) => {
        finders.push(new CandidateFinders.RequiredValue(
          CandidateFinders.filterCellsByValue(cells, grid, value),
          value, multiplier));
      };

      // Add a candidate finder for each remaining edge.
      if (flags[0]) {
        addFinder(SudokuConstraintBase.rowRegions(shape)[0]);
      }
      if (flags[1]) {
        addFinder(SudokuConstraintBase.colRegions(shape)[0]);
      }
      if (flags[2]) {
        addFinder(SudokuConstraintBase.rowRegions(shape)[numRows - 1]);
      }
      if (flags[3]) {
        addFinder(SudokuConstraintBase.colRegions(shape)[numCols - 1]);
      }
    }

    return finders;
  }
}

export class Rellik extends SudokuConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    // Use bigints to handle sums larger than 31.
    // We could optimize for the small sum case if needed.
    this.sumMask = 1n << BigInt(sum);
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    // Combine the results of optionally subtracting fixed values from the sum.
    let remainders = this.sumMask;
    let fixedValues = 0;
    let unfixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      if (!(v & (v - 1))) {
        remainders |= remainders >> BigInt(LookupTables.toValue(v));
        fixedValues |= v;
      } else {
        unfixedValues |= v;
      }
    }

    // Fail remainder of 0 is possible.
    if (remainders & 1n) return false;

    // Check if any of the unfixed values exactly match the possible remainders.
    const smallRemainders = Number(BigInt.asUintN(32, remainders)) >> 1;
    const valuesToRemove = unfixedValues & smallRemainders & ~fixedValues;
    if (valuesToRemove === 0) return true;

    for (let i = 0; i < numCells; i++) {
      const cell = cells[i];
      if (grid[cell] & valuesToRemove) {
        if (!(grid[cell] &= ~valuesToRemove)) return false;
        handlerAccumulator.addForCell(cell);
      }
    }

    return true;
  }
}

export class EqualSizePartitions extends SudokuConstraintHandler {
  constructor(cells, partition1, partition2) {
    if (cells.length % 2 !== 0) {
      throw new Error("EqualSizePartitions: 'cells' must have an even number of elements.");
    }
    super(cells);

    this._mask1 = LookupTables.fromValuesArray(partition1);
    this._mask2 = LookupTables.fromValuesArray(partition2);
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const cells = this.cells;
    const excludeValues = ~(this._mask1 | this._mask2);
    if (excludeValues) {
      for (const cell of cells) {
        if (!(initialGridCells[cell] &= ~excludeValues)) return false;
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const mask1 = this._mask1;
    const mask2 = this._mask2;

    let partition1Count = 0;
    let partition2Count = 0;
    let bothCount = 0;
    for (let i = 0; i < numCells; i += 1) {
      const cell = cells[i];
      const v = grid[cell];
      const in1 = v & mask1;
      const in2 = v & mask2;
      if (in1 && in2) {
        bothCount += 1;
      } else if (in1) {
        partition1Count += 1;
      } else if (in2) {
        partition2Count += 1;
      }
    }

    // The only way we know this constraint is violated is if one partition
    // has more cells than the target count.
    const targetCount = numCells >> 1;
    if (partition1Count > targetCount || partition2Count > targetCount) {
      return false;
    }

    // If there is no ambiguity, then we are done.
    if (bothCount == 0) return true;

    // If one partition has the target count, then all the other cells must
    // be in the other partition.
    if (partition1Count === targetCount || partition2Count === targetCount) {
      const [maskToKeep, maskToRemove] = partition1Count === targetCount ?
        [mask2, mask1] : [mask1, mask2];
      for (let i = 0; i < numCells; i += 1) {
        const cell = cells[i];
        const v = grid[cell];
        if (v & maskToKeep) {
          grid[cell] &= ~maskToRemove;
          if (v & maskToRemove) handlerAccumulator.addForCell(cell);
        }
      }
    }

    return true;
  }
}

class DummyHandlerAccumulator {
  addForCell(cell) { }
}

export class Or extends SudokuConstraintHandler {
  constructor(...handlers) {
    // Exclusion cells need special handlings since they can't be handled
    // directly by the engine.
    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i];
      const exclusionCells = handler.exclusionCells();
      if (exclusionCells.length) {
        // The 'And' handler takes care of exclusion cells.
        handlers[i] = new And(handler);
      }
    }

    const cells = [...new Set(handlers.flatMap(h => [...h.cells]))];
    super(cells);

    this._scratchGrid = null;
    this._resultGrid = null;
    this._handlers = handlers;
    this._initializations = [];
    this._numGridCells = 0;
    this._stateOffset = 0;
    this._numHandlerStates = 0;
    this._dummyHandlerAccumulator = new DummyHandlerAccumulator();
  }

  _markAsInvalid(grid, handlerIndex) {
    const offset = this._stateOffset;
    grid[offset + 1 + (handlerIndex >> 4)] &= ~(1 << (handlerIndex & 15));
    if ((--grid[offset]) === 1) {
      this._setFinalHandler(grid, offset);
    }
  }

  static _FLAG_FINAL = 1 << 15;

  _setFinalHandler(state, offset) {
    // We've reached the final handler.
    // Mark the state as final.
    state[offset] = this.constructor._FLAG_FINAL;
    // Find the final handler.
    const numHandlerStates = this._numHandlerStates;
    for (let i = 0; i < numHandlerStates; i++) {
      const flags = state[offset + 1 + i];
      if (flags) {
        const handlerIndex = i * 16 + LookupTables.toIndex(flags);
        state[offset] |= handlerIndex;
        return;
      }
    }

    throw new Error('Fatal error in Or constraint handler.');
  }

  _isInvalid(grid, handlerIndex) {
    return 0 === (grid[this._stateOffset + 1 + (handlerIndex >> 4)] & (1 << (handlerIndex & 15)));
  }

  _assignInitializations(grid, handlerIndex) {
    const initialization = this._initializations[handlerIndex];
    for (let i = 0; i < initialization.length; i += 2) {
      if (!(grid[initialization[i]] &= initialization[i + 1])) {
        return false;
      }
    }
    return true;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const scratchGrid = initialGridCells.slice();

    // Initialize each handler and store any initialization changes that it
    // makes.
    const initializationCells = new Set();
    const validHandlers = [];
    for (let h = 0; h < this._handlers.length; h++) {
      const handler = this._handlers[h];

      scratchGrid.set(initialGridCells);
      if (!handler.initialize(scratchGrid, cellExclusions, shape, stateAllocator)) {
        continue;
      }

      const initialization = [];
      for (let i = 0; i < shape.numCells; i++) {
        if (scratchGrid[i] !== initialGridCells[i]) {
          initialization.push(i, scratchGrid[i]);
          initializationCells.add(i);
        }
      }

      validHandlers.push(handler);
      this._initializations.push(initialization);
    }

    if (validHandlers.length == 0) return false;

    this._handlers = validHandlers;
    this._numGridCells = shape.numCells;

    // state = [finalHandlerIndex|numRemainingHandlers, ...handlerStates]
    // For state[0] The 16th bit is a flag which determine if we are counting
    // handlers or if we've reached the final handler.
    // THe handlerStates show which handlers are still valid.
    this._numHandlerStates = (this._handlers.length + 15) >> 4;
    const state = new Array(1 + this._numHandlerStates).fill(0);
    for (let i = 0; i < this._handlers.length; i++) {
      state[1 + (i >> 4)] |= 1 << (i & 15);
    }
    if (this._handlers.length === 1) {
      this._setFinalHandler(state, 0);
    } else {
      state[0] = this._handlers.length;
    }
    this._stateOffset = stateAllocator.allocate(state);

    // If initialization changed any cells we may need to updated the watched
    // cells.
    if (initializationCells.size) {
      const watchedCells = initializationCells;
      for (const cell of this.cells) {
        watchedCells.add(cell);
      }

      this.cells = this.cells.constructor.from(watchedCells);
    }

    return true;
  }

  postInitialize(readonlyGridState) {
    for (const h of this._handlers) {
      h.postInitialize(readonlyGridState);
    }
    this._scratchGrid = readonlyGridState.slice();
    this._resultGrid = readonlyGridState.slice();
  }

  enforceConsistency(grid, handlerAccumulator) {
    // Check if we only have one handler left, and if so, enforce it directly.
    if ((grid[this._stateOffset] & this.constructor._FLAG_FINAL)) {
      const handlerIndex = grid[this._stateOffset] & ~this.constructor._FLAG_FINAL;

      // Initialization is needed because we might be in an Or handler which
      // means that it is not persistent.
      if (!this._assignInitializations(grid, handlerIndex)) return false;

      return this._handlers[handlerIndex].enforceConsistency(
        grid, handlerAccumulator);
    }

    const numGridCells = this._numGridCells;

    const resultGrid = this._resultGrid;
    const scratchGrid = this._scratchGrid;
    const dummyHandlerAccumulator = this._dummyHandlerAccumulator;
    resultGrid.fill(0);

    for (let i = 0; i < this._handlers.length; i++) {
      if (this._isInvalid(grid, i)) continue;

      const handler = this._handlers[i];

      // Initialize the scratch grid.
      scratchGrid.set(grid);
      if (!this._assignInitializations(scratchGrid, i)) {
        this._markAsInvalid(grid, i);
        continue;
      }
      // Enforce consistency on the scratch grid.
      if (!handler.enforceConsistency(scratchGrid, dummyHandlerAccumulator)) {
        this._markAsInvalid(grid, i);
        continue;
      }

      for (let j = 0; j < numGridCells; j++) {
        resultGrid[j] |= scratchGrid[j];
      }
      // Extra state is written directly to the grid.
      for (let j = numGridCells; j < grid.length; j++) {
        grid[j] = scratchGrid[j];
      }
    }

    // Quickly check if there were no valid handlers.
    if (resultGrid[0] === 0) return false;

    // Only copy the cells. The state has already been directly copied.
    for (let j = 0; j < numGridCells; j++) {
      grid[j] = resultGrid[j];
    }
    return true;
  }
}
