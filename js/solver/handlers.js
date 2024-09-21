"use strict";

class SudokuConstraintHandler {
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
  postInitialize(initialGridState) { }

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

SudokuConstraintHandler.NoBoxes = class NoBoxes extends SudokuConstraintHandler { }

// This handler purely exists to manually adjust the priorities of cells to
// adjust initial cell selection.
SudokuConstraintHandler.Priority = class Priority extends SudokuConstraintHandler {
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

SudokuConstraintHandler.True = class True extends SudokuConstraintHandler {
}

SudokuConstraintHandler.False = class False extends SudokuConstraintHandler {
  constructor(cells) {
    // The cells with which to associate the failure.
    super(cells);

    if (cells.length === 0) throw 'False needs cells to be effective.';
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return false;
  }
  enforceConsistency(grid, handlerAccumulator) { return false; }
}

SudokuConstraintHandler.And = class And extends SudokuConstraintHandler {
  constructor(...handlers) {
    // Exclusion cells need special handlings since they can't be handled
    // directly by the engine.
    for (const h of handlers) {
      const exclusionCells = h.exclusionCells();
      if (exclusionCells.length) {
        handlers.push(
          new SudokuConstraintHandler.AllDifferentEnforcement(exclusionCells));
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

  postInitialize(initialGridState) {
    for (const h of this._handlers) {
      h.postInitialize(initialGridState);
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

SudokuConstraintHandler.GivenCandidates = class GivenCandidates extends SudokuConstraintHandler {
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

SudokuConstraintHandler.AllDifferent = class AllDifferent extends SudokuConstraintHandler {
  constructor(exclusionCells) {
    super();
    exclusionCells = Array.from(new Set(exclusionCells));
    exclusionCells.sort((a, b) => a - b);
    this._exclusionCells = exclusionCells;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return this._exclusionCells.length <= shape.numValues;
  }

  exclusionCells() {
    return this._exclusionCells;
  }
}

// Special handler for enforcing all-different constraints which are not
// top-level constraints.
SudokuConstraintHandler.AllDifferentEnforcement = class AllDifferentEnforcement extends SudokuConstraintHandler {
  constructor(exclusionCells) {
    exclusionCells = Array.from(new Set(exclusionCells));
    exclusionCells.sort((a, b) => a - b);
    super(exclusionCells);
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    return this.cells.length <= shape.numValues;
  }

  enforceConsistency(grid, handlerAccumulator) {
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
SudokuConstraintHandler.UniqueValueExclusion = class UniqueValueExclusion extends SudokuConstraintHandler {
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

SudokuConstraintHandler.ValueDependentUniqueValueExclusion = class ValueDependentUniqueValueExclusion extends SudokuConstraintHandler {
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

SudokuConstraintHandler.ValueDependentUniqueValueExclusionHouse = class ValueDependentUniqueValueExclusionHouse extends SudokuConstraintHandler {
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

SudokuConstraintHandler._CommonHandlerUtil = class _CommonHandlerUtil {
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
        // Remove the value from the exclusion cells.
        for (let i = 0; i < exclusionCells.length; i++) {
          if (grid[exclusionCells[i]] & value) {
            if (!(grid[exclusionCells[i]] ^= value)) return false;
            if (handlerAccumulator) handlerAccumulator.addForCell(exclusionCells[i]);
          }
        }
      }
    }

    return true;
  }

  // Partition the cells into groups where members are all unique.
  static findExclusionGroups(cells, cellExclusions) {
    let bestExclusionGroupsScore = 0;
    let bestExclusionGroups = [];
    let randomGen = new RandomIntGenerator(0);

    const NUM_TRIALS = 5;

    // Choose `NUM_TRIALS` random orderings of the cells and find the one that
    // generates the best exclusion groups.
    // NOTE: The first ordering is the original (sorted) ordering. This ordering
    //       should work well for little killers and other linear regions.
    cells = cells.slice();
    for (let i = 0; i < NUM_TRIALS; i++) {
      let exclusionGroups = this._findExclusionGroupsGreedy(cells, cellExclusions);
      // If there is only one exclusion group, then we can't do any better.
      if (exclusionGroups.length == 1) return exclusionGroups;

      // Optimize for the sum of triangle numbers.
      let exclusionGroupsScore = exclusionGroups.reduce(
        (acc, cs) => cs.length * (cs.length + 1) / 2 + acc, 0);
      if (exclusionGroupsScore > bestExclusionGroupsScore) {
        bestExclusionGroupsScore = exclusionGroupsScore;
        bestExclusionGroups = exclusionGroups;
      }

      shuffleArray(cells, randomGen);
    }

    return bestExclusionGroups;
  }

  // Partition the cells into groups where members are all unique.
  // Applies a greedy algorithm by, each iteration, choosing a cell and adding
  // as many remaining cells to it as possible to create the next group.
  static _findExclusionGroupsGreedy(cells, cellExclusions) {
    let exclusionGroups = [];
    let unassignedCells = cells;
    let remainingUnassignedCells = [];

    while (unassignedCells.length > 0) {
      let currentGroup = [];
      for (const unassignedCell of unassignedCells) {
        // Determine if this cell is mutually exclusive with every cell in the
        // current group. If so, then add it to the current group.
        let addToCurrentSet = true;
        for (const exclusionCell of currentGroup) {
          if (!cellExclusions.isMutuallyExclusive(unassignedCell, exclusionCell)) {
            addToCurrentSet = false;
            break;
          }
        }
        if (addToCurrentSet) {
          currentGroup.push(unassignedCell);
        } else {
          remainingUnassignedCells.push(unassignedCell);
        }
      }
      exclusionGroups.push(currentGroup);
      unassignedCells = remainingUnassignedCells;
      remainingUnassignedCells = [];
    }

    return exclusionGroups;
  }

}

SudokuConstraintHandler.House = class House extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._allValues = 0;
    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;
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
      if (!this._commonUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
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

SudokuConstraintHandler.BinaryConstraint = class BinaryConstraint extends SudokuConstraintHandler {
  constructor(cell1, cell2, key) {
    super([cell1, cell2]);
    this._key = key;
    this._tables = [];

    // Ensure we dedupe binary constraints.
    this.idStr = [this.constructor.name, key, cell1, cell2].join('-');
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const lookupTables = LookupTables.get(shape.numValues);
    this._tables = lookupTables.forBinaryKey(this._key);

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
    return true;
  }
}

SudokuConstraintHandler.BinaryPairwise = class BinaryPairwise extends SudokuConstraintHandler {
  constructor(key, ...cells) {
    super(cells);
    this._key = key;
    this._table = null;
    this._isAllDifferent = false;
    this._validCombinationInfo = null;
    this._cellExclusions = null;
    this._enableHiddenSingles = false;

    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;

    // Ensure we dedupe binary constraints.
    this.idStr = [this.constructor.name, key, ...cells].join('-');
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
    if (!this._isAllDifferent(table, numValues)) throw 'Not implemented';

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
      throw 'Function for BinaryPairwise must be symmetric. Key: ' + this._key;
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
        if (!this._commonUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
          return false;
        }
      }
    }

    // Enforce all the non-unique required values.
    // Exclude fixedValues, they will be handled by the main solver loop,
    // which will also propagate the changes.
    const nonUniqueRequired = requiredValues & nonUniqueValues & ~fixedValues;
    if (!this._commonUtil.enforceRequiredValueExclusions(
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

    // Naively enforce all pairs of constraints until we reach a fixed point.
    // The key must be symmetric, so we don't need to check both orders.
    let allChanged = 0;
    let newChanged = 1;
    while (newChanged) {
      newChanged = 0;
      for (let i = 0; i < numCells - 1; i++) {
        let v0 = grid[cells[i]];
        for (let j = i + 1; j < numCells; j++) {
          const v1 = grid[cells[j]];
          const v0New = v0 & table[v1];
          const v1New = v1 & table[v0];
          if (!(v0New && v1New)) return false;
          if (v0 != v0New) {
            newChanged |= 1 << i;
            v0 = v0New;
          }
          if (v1 != v1New) {
            newChanged |= 1 << j;
            grid[cells[j]] = v1New;
          }
        }
        grid[cells[i]] = v0;
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

SudokuConstraintHandler._SumHandlerUtil = class _SumHandlerUtil {

  static get = memoize((numValues) => {
    return new SudokuConstraintHandler._SumHandlerUtil(true, numValues);
  });

  static maxCageSum(numValues) {
    return numValues * (numValues + 1) / 2;
  }

  constructor(do_not_call, numValues) {
    if (!do_not_call) throw ('Use SumHandlerUtil.get(shape.numValues)');

    this._numValues = numValues;
    this._lookupTables = LookupTables.get(numValues);
    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;

    const combinations = this._lookupTables.combinations;
    const maxSum = this.constructor.maxCageSum(numValues);

    this.killerCageSums = (() => {
      let table = [];
      for (let n = 0; n < numValues + 1; n++) {
        let totals = [];
        table.push(totals);
        for (let i = 0; i < maxSum + 1; i++) {
          totals.push([]);
        }
      }

      const sums = this._lookupTables.sum;
      for (let i = 0; i < combinations; i++) {
        table[countOnes16bit(i)][sums[i]].push(i);
      }

      return table;
    })();

    // Precompute the sums for all pairs of cells. Assumes cells must be unique.
    //
    // For cell values a and b:
    // _pairwiseSums[(a<<numValues)|b] = sum>>2;
    // (The shift is so the result fits in 16 bits).
    this._pairwiseSums = (() => {
      if (numValues > SHAPE_9x9.numValues) return;
      const table = new Uint16Array(combinations * combinations);

      for (let i = 0; i < combinations; i++) {
        for (let j = i; j < combinations; j++) {
          let result = 0;
          for (let k = 1; k <= numValues; k++) {
            // Check if j contains k.
            const kInJ = (j >> (k - 1)) & 1;
            if (kInJ) {
              // Add k to all values in i.
              let s = i << k;
              // Remove 2*k, as we require the values to be unique.
              s &= ~(1 << (2 * k - 1));
              // Store s-2, so we don't overrun 16 bits.
              // (Note, we have an extra one from the sum already).
              s >>= 2;
              result |= s;
            }
          }
          table[(i << numValues) | j] = table[(j << numValues) | i] = result;
        }
      }

      return table;
    })();

    // Store the sum of a+a for all combinations of a.
    this._doubles = (() => {
      const table = new Uint32Array(combinations);

      for (let j = 0; j < combinations; j++) {
        let result = 0;
        for (let k = 1; k <= numValues; k++) {
          // Check if j contains k.
          const kInJ = (j >> (k - 1)) & 1;
          if (kInJ) {
            const s = 1 << (2 * k - 1);
            result |= s;
          }
        }
        table[j] = result;
      }
      return table;
    })();
  }

  restrictValueRange(grid, cells, sumMinusMin, maxMinusSum) {
    // Remove any values which aren't possible because they would cause the sum
    // to be too high.
    for (let i = 0; i < cells.length; i++) {
      let v = grid[cells[i]];
      // If there is a single value, then the range is always fine.
      if (!(v & (v - 1))) continue;

      // range = LookupTables.maxValue(v) - LookupTables.minValue(v);
      const clz32v = Math.clz32(v);
      const range = Math.clz32(v & -v) - clz32v;

      if (sumMinusMin < range) {
        // minValue(x) = sumMinusMin + LookupTables.minValue(v);
        const x = v << sumMinusMin;
        // Remove any values GREATER than x. Even if all other squares
        // take their minimum values, these are too big.
        if (!(v &= ((x & -x) << 1) - 1)) return false;
        grid[cells[i]] = v;
      }

      if (maxMinusSum < range) {
        // Remove any values LESS than x. Even if all other squares
        // take their maximum values, these are too small.
        //  where x = maxValue(v) - maxMinusSum;
        // NOTE: Inline calls since this is a heavily used function.
        // NOTE: -0x80000000 = -1 << 31
        if (!(v &= -0x80000000 >> (clz32v + maxMinusSum))) return false;
        grid[cells[i]] = v;
      }
    }

    return true;
  }

  restrictCellsSingleExclusionGroup(grid, sum, cells, cellExclusions, handlerAccumulator) {
    const numCells = cells.length;

    // Check that we can make the current sum with the unfixed values remaining.
    let fixedValues = 0;
    let allValues = 0;
    let nonUniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v; // Avoid branching.
    }
    const fixedSum = this._lookupTables.sum[fixedValues];
    // This should have been caught by the range checks, but we
    // could have restricted cells in the meantime.
    if (fixedSum > sum) return false;

    // Check if we have enough unique values.
    if (countOnes16bit(allValues) < numCells) return false
    // Check if we have fixed all the values.
    if (allValues == fixedValues) {
      return fixedSum == sum;
    }

    const unfixedValues = allValues & ~fixedValues;
    let requiredValues = allValues;
    const numUnfixed = cells.length - countOnes16bit(fixedValues);

    let possibilities = 0;
    const options = this.killerCageSums[numUnfixed][sum - fixedSum];
    for (let i = options.length - 1; i >= 0; i--) {
      const o = options[i];
      if ((o & unfixedValues) == o) {
        possibilities |= o;
        requiredValues &= o;
      }
    }
    if (!possibilities) return false;

    // Remove any values that aren't part of any solution.
    const valuesToRemove = unfixedValues & ~possibilities;
    if (valuesToRemove) {
      for (let i = 0; i < numCells; i++) {
        // Safe to apply to every cell, since we know that none of the
        // fixedValues are in unfixedValues.
        if (!(grid[cells[i]] &= ~valuesToRemove)) return false;
      }
    }

    // requiredValues are values that appear in all possible solutions.
    // Those that are unique are hidden singles.
    const hiddenSingles = requiredValues & ~nonUniqueValues & ~fixedValues;
    if (hiddenSingles) {
      if (!this._commonUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
        return false;
      }
    }

    // Only enforce required value exclusions if we have pairwise exclusions
    // passed in.
    if (!cellExclusions) return true;

    const nonUniqueRequired = requiredValues & nonUniqueValues & ~fixedValues;
    if (!this._commonUtil.enforceRequiredValueExclusions(
      grid, cells, nonUniqueRequired, cellExclusions, handlerAccumulator)) {
      return false;
    }

    return true;
  }

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMins = new Uint16Array(SHAPE_MAX.numCells);
  static _seenMaxs = new Uint16Array(SHAPE_MAX.numCells);

  // Restricts cell values to only the ranges that are possible taking into
  // account uniqueness constraints between values.
  restrictCellsMultiExclusionGroups(grid, sum, exclusionGroups) {
    const numSets = exclusionGroups.length;

    // Find a set of minimum and maximum unique values which can be set,
    // taking into account uniqueness within constraint sets.
    // From this determine the minimum and maximum possible sums.

    let seenMins = SudokuConstraintHandler._SumHandlerUtil._seenMins;
    let seenMaxs = SudokuConstraintHandler._SumHandlerUtil._seenMaxs;
    let strictMin = 0;
    let strictMax = 0;

    const numValues = this._numValues;
    const allValues = this._lookupTables.allValues;

    for (let s = 0; s < numSets; s++) {
      let set = exclusionGroups[s];
      let seenMin = 0;
      let seenMax = 0;

      for (let i = 0; i < set.length; i++) {
        const v = grid[set[i]];

        // Set the smallest unset value >= min.
        // i.e. Try to add min to seenMin, but it if already exists then find
        // the next smallest value.
        let x = ~(seenMin | ((v & -v) - 1));
        seenMin |= x & -x;
        // Set the largest unset value <= max.
        // NOTE: seenMax will be reversed.
        x = ~seenMax & ((-1 << (numValues - (32 - Math.clz32(v)))));
        seenMax |= x & -x;
      }

      if (seenMin > allValues || seenMax > allValues) return false;

      seenMax = this._lookupTables.reverse[seenMax];
      strictMin += this._lookupTables.sum[seenMin];
      strictMax += this._lookupTables.sum[seenMax];

      seenMins[s] = seenMin;
      seenMaxs[s] = seenMax;
    }

    // Calculate degrees of freedom in the cell values.
    // i.e. How much leeway is there from the min and max value of each cell.
    let minDof = sum - strictMin;
    let maxDof = strictMax - sum;
    if (minDof < 0 || maxDof < 0) return false;
    if (minDof >= numValues - 1 && maxDof >= numValues - 1) return true;

    // Restrict values based on the degrees of freedom.
    for (let s = 0; s < numSets; s++) {
      let seenMin = seenMins[s];
      let seenMax = seenMaxs[s];
      // If min and max are the same, then the values can't be constrained
      // anymore (and a positive dof guarantees that they are ok).
      if (seenMin == seenMax) continue;

      let valueMask = -1;

      if (minDof < numValues - 1) {
        for (let j = minDof; j--;) seenMin |= seenMin << 1;
        valueMask = seenMin;
      }

      if (maxDof < numValues - 1) {
        for (let j = maxDof; j--;) seenMax |= seenMax >> 1;
        valueMask &= seenMax;
      }

      // If the value mask could potentially remove some values, then apply
      // the mask to the values in the set.
      if (~valueMask & allValues) {
        const set = exclusionGroups[s];
        for (let i = 0; i < set.length; i++) {
          if (!(grid[set[i]] &= valueMask)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  _enforceThreeCellConsistency(grid, cells, sum, exclusionIndexes) {
    const numValues = this._numValues;

    let v0 = grid[cells[0]];
    let v1 = grid[cells[1]];
    let v2 = grid[cells[2]];

    // Find each set of pairwise sums.
    let sums2 = this._pairwiseSums[(v0 << numValues) | v1] << 2;
    let sums1 = this._pairwiseSums[(v0 << numValues) | v2] << 2;
    let sums0 = this._pairwiseSums[(v1 << numValues) | v2] << 2;

    // If the cell values are possibly repeated, then handle that.
    if (exclusionIndexes[0] !== exclusionIndexes[1] || exclusionIndexes[0] !== exclusionIndexes[2]) {
      if (exclusionIndexes[0] != exclusionIndexes[1]) {
        sums2 |= this._doubles[v0 & v1];
      }
      if (exclusionIndexes[0] != exclusionIndexes[2]) {
        sums1 |= this._doubles[v0 & v2];
      }
      if (exclusionIndexes[1] != exclusionIndexes[2]) {
        sums0 |= this._doubles[v1 & v2];
      }
    }

    // Constrain each value based on the possible sums of the other two.
    // NOTE: We don't care if a value is reused in the result, as that will
    // be removed in one of the other two cases.
    const shift = sum - 1;
    const allValues = this._lookupTables.allValues;
    const reverse = this._lookupTables.reverse;
    v2 &= reverse[((sums2 << numValues) >> shift) & allValues];
    v1 &= reverse[((sums1 << numValues) >> shift) & allValues];
    v0 &= reverse[((sums0 << numValues) >> shift) & allValues];

    if (!(v0 && v1 && v2)) return false;

    grid[cells[0]] = v0;
    grid[cells[1]] = v1;
    grid[cells[2]] = v2;

    return true;
  }

  static _valueBuffer = new Uint16Array(SHAPE_MAX.numValues);
  static _exclusionIndexesBuffer = new Uint8Array(SHAPE_MAX.numValues);
  // Create a cellBuffer for each possible number of unfixed cells that
  // enforceFewRemainingCells() can be called with.
  // This allows calls ot functions like restrictCellsSingleExclusionGroup()
  // to rely on the array length.
  static _cellBuffers = [...Array(4).keys()].map(i => new Uint8Array(i));

  // Determines if enforceFewRemainingCells() can be run.
  hasFewRemainingCells(numUnfixed) {
    return numUnfixed <= (this._pairwiseSums ? 3 : 2);
  }

  // Solve small cases exactly and efficiently.
  // Call hasFewRemainingCells() to determine if it can be run.
  // REQUIRES that:
  //  - The number of unfixed cells is accurate.
  //  - None of the values are zero.
  enforceFewRemainingCells(
    grid, targetSum, numUnfixed, cells, exclusionIndexes, cellExclusions) {
    const cellBuffer = this.constructor._cellBuffers[numUnfixed];
    const valueBuffer = this.constructor._valueBuffer;
    const exclusionIndexesBuffer = this.constructor._exclusionIndexesBuffer;

    const gridSize = this._numValues | 0;

    let j = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const v = grid[c];
      if (v & (v - 1)) {
        exclusionIndexesBuffer[j] = exclusionIndexes[i];
        cellBuffer[j] = c;
        valueBuffer[j] = v;
        j++;
      }
    }

    switch (numUnfixed) {
      case 1: {
        // Set value to the target sum exactly.
        const v = valueBuffer[0] & (1 << (targetSum - 1));
        return (grid[cellBuffer[0]] = v);
      }

      case 2: {
        let v0 = valueBuffer[0];
        let v1 = valueBuffer[1];

        // Remove any values which don't have their counterpart value to add to
        // targetSum.
        v1 &= (this._lookupTables.reverse[v0] << (targetSum - 1)) >> gridSize;
        v0 &= (this._lookupTables.reverse[v1] << (targetSum - 1)) >> gridSize;

        // If the cells are in the same exclusion group, also ensure the sum
        // uses distinct values.
        if ((targetSum & 1) == 0 &&
          exclusionIndexesBuffer[0] === exclusionIndexesBuffer[1]) {
          // targetSum/2 can't be valid value.
          const mask = ~(1 << ((targetSum >> 1) - 1));
          v0 &= mask;
          v1 &= mask;
        }

        if (!(v1 && v0)) return false;

        grid[cellBuffer[0]] = v0;
        grid[cellBuffer[1]] = v1;

        // If there are two remaining values, and they can be in either cell
        // (both cells have the same candidates) then they are both required
        // values.
        // NOTE: We can also do this for count == 1, but it results are slightly
        //       worse.
        if (cellExclusions && v0 === v1 && countOnes16bit(v0) == 2) {
          if (!this._commonUtil.enforceRequiredValueExclusions(
            grid, cellBuffer, v0, cellExclusions)) return false;
        }
        return true;
      }

      case 3: {
        return this._enforceThreeCellConsistency(
          grid, cellBuffer, targetSum, exclusionIndexesBuffer);
      }
    }
  }
}

SudokuConstraintHandler.Sum = class Sum extends SudokuConstraintHandler {
  _exclusionGroups = [];
  _exclusionIndexes = [];
  _cellExclusions = null;
  _sum = 0;
  _complementCells;
  _positiveCells = [];
  _negativeCells = [];
  _sumUtil = null;
  _shape = null;
  _lookupTables = null;

  constructor(cells, sum) {
    cells = cells.slice();
    cells.sort((a, b) => a - b);

    super(cells);
    this._sum = +sum;
    this._positiveCells = cells;

    this.idStr = [this.constructor.name, cells, sum].join('-');
  }

  setComplementCells(cells) {
    this._complementCells = cells;
  }

  hasComplementCells(cells) {
    this._complementCells !== undefined;
  }

  sum() {
    return this._sum;
  }

  priority() {
    // We want smaller cages to have higher priority, but we still want all sums
    // to have a high priority.
    return this._shape.gridSize * 2 - this.cells.length;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._shape = shape;

    this._lookupTables = LookupTables.get(shape.numValues);

    this._sumUtil = SudokuConstraintHandler._SumHandlerUtil.get(shape.numValues);

    this._exclusionGroups = (
      SudokuConstraintHandler._CommonHandlerUtil.findExclusionGroups(
        this._positiveCells, cellExclusions));
    if (this._negativeCells.length) {
      this._exclusionGroups.push(
        ...SudokuConstraintHandler._CommonHandlerUtil.findExclusionGroups(
          this._negativeCells, cellExclusions));
    }

    this._exclusionIndexes = new Uint8Array(this.cells.length);
    const nextIndex = new Map();
    this._exclusionGroups.forEach(
      (s, i) => s.forEach(
        c => {
          const index = this.cells.indexOf(c, nextIndex.get(c));
          this._exclusionIndexes[index] = i;
          nextIndex.set(c, index + 1);
        }));

    if (!this._negativeCells.length) {
      // We can't use cell exclusions because the cell values have been changed.
      // Thus it can't be used to exclude the value from other cells.
      // TODO: Find a robust way of handling this so that we still get the
      //       benefit for positive cells.
      this._cellExclusions = cellExclusions;
    }

    // Ensure that _complementCells is null.
    // undefined is used by the optimizer to know that a value has not been
    // set yet.
    if (this._complementCells === undefined) {
      this._complementCells = null;
    }

    // Check for valid sums.
    const sum = this._sum;
    if (!Number.isInteger(sum) || sum < 0) return false;
    if (this._exclusionGroups.length == 1
      && sum > SudokuConstraintHandler._SumHandlerUtil.maxCageSum(shape.numValues)) {
      return false;
    }
    // Ensure each exclusion group is not too large. This only matters if we
    // remove standard regions.
    for (const exclusionGroup of this._exclusionGroups) {
      if (exclusionGroup.length > shape.numValues) {
        // The UI should not allow users to create such groups, and the
        // optimizer should avoid them as well.
        throw ('Exclusion group is too large.');
      }
    }

    return true;
  }

  _enforceCombinationsWithComplement(grid, handlerAccumulator) {
    const set0 = this.cells;
    const set1 = this._complementCells;
    const sum = this._sum;

    let values0 = 0;
    for (let i = set0.length - 1; i >= 0; i--) {
      values0 |= grid[set0[i]];
    }
    let values1 = 0;
    for (let i = set1.length - 1; i >= 0; i--) {
      values1 |= grid[set1[i]];
    }

    // NOTE: The following have been left out as I couldn't get them to show
    // a measurable improvement.
    //   - Calculating the fixedSum and reduce the target some.
    //   - Short-circuiting this by checking if the sum has already been
    //     reached.

    const cageSums = this._sumUtil.killerCageSums[set0.length][sum];
    let possibilities0 = 0;
    let possibilities1 = 0;

    const allValues = this._lookupTables.allValues;
    for (let j = 0; j < cageSums.length; j++) {
      const option = cageSums[j];
      // Branchlessly check that the option is consistent with both set1 and
      // set0.
      const includeOption = -(!(option & ~values0) & !(~option & ~values1 & allValues));
      possibilities0 |= option & includeOption;
      possibilities1 |= ~option & includeOption;
    }
    if (!possibilities0) return false;

    // Remove any values that aren't part of any solution.
    // Same as for sum handler.
    const valuesToRemove0 = values0 & ~possibilities0;
    if (valuesToRemove0) {
      for (let i = 0; i < set0.length; i++) {
        if (grid[set0[i]] & valuesToRemove0) {
          if (!(grid[set0[i]] &= ~valuesToRemove0)) return false;
          handlerAccumulator.addForCell(set0[i]);
        }
      }
    }
    const valuesToRemove1 = values1 & ~possibilities1;
    if (valuesToRemove1) {
      for (let i = 0; i < set1.length; i++) {
        if (grid[set1[i]] & valuesToRemove1) {
          if (!(grid[set1[i]] &= ~valuesToRemove1)) return false;
          handlerAccumulator.addForCell(set1[i]);
        }
      }
    }

    // NOTE: Seems like require uniques doesn't help much here.

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum | 0;
    const gridSize = this._shape.gridSize | 0;

    // Calculate stats in batches of 15 since rangeInfo counts myst be stored
    // in 4 bits.
    let maxSum = 0;
    let minSum = 0;
    let numUnfixed = numCells;
    let fixedSum = 0;
    const rangeInfo = this._lookupTables.rangeInfo;
    for (let i = 0; i < numCells;) {
      let rangeInfoSum = 0;
      let lim = i + 15;
      if (lim > numCells) lim = numCells;
      for (; i < lim; i++) {
        rangeInfoSum += rangeInfo[grid[cells[i]]];
      }

      maxSum += rangeInfoSum & 0xff;
      minSum += (rangeInfoSum >> 8) & 0xff;
      numUnfixed -= rangeInfoSum >> 24;
      fixedSum += (rangeInfoSum >> 16) & 0xff;
    }

    // It is impossible to make the target sum.
    if (sum < minSum || maxSum < sum) return false;
    // We've reached the target sum exactly.
    // NOTE: Uniqueness constraint is already enforced by the solver via
    //       exclusionCells.
    if (minSum == maxSum) return true;

    // A large fixed value indicates a cell has a 0, hence is already
    // unsatisfiable.
    // If all cells were fixed, then we would have returned already - so this
    // can also only occur when there is a 0.
    if (numUnfixed <= 0) return false;

    const hasFewUnfixed = this._sumUtil.hasFewRemainingCells(numUnfixed);

    if (hasFewUnfixed) {
      // If there are few remaining cells then handle them explicitly.
      const targetSum = sum - fixedSum;
      if (!this._sumUtil.enforceFewRemainingCells(grid, targetSum, numUnfixed, this.cells, this._exclusionIndexes, this._cellExclusions)) {
        return false;
      }
    } else {
      // Restrict the possible range of values in each cell based on whether they
      // will cause the sum to be too large or too small.
      if (sum - minSum < gridSize || maxSum - sum < gridSize) {
        if (!this._sumUtil.restrictValueRange(grid, cells,
          sum - minSum, maxSum - sum)) {
          return false;
        }
      }
    }

    if (this._complementCells !== null) {
      return this._enforceCombinationsWithComplement(grid, handlerAccumulator);
    }

    // If enforceFewRemainingCells has run, then we've already done all we can.
    if (hasFewUnfixed) return true;

    if (this._exclusionGroups.length == 1) {
      if (!this._sumUtil.restrictCellsSingleExclusionGroup(
        grid, this._sum, cells, this._cellExclusions, handlerAccumulator)) return false;
    } else {
      if (!this._sumUtil.restrictCellsMultiExclusionGroups(
        grid, sum, this._exclusionGroups)) return false;
    }

    return true;
  }
}

// SumWithNegative allows cells in the sum to be negative.
//
// How this works
// --------------
// The initial constraint is:
//   a1+a2+...+an - b1-b2-...-bm = s
// If we reverse the bitset for the `b` cells, then we get the value:
//   Bx = N+1 - bx where `N` is the number of values.
// This gives a new constraint which is a sum of positives:
//   a1+a2+...+an + B1+B2+...+Bm = s + (N+1)*m;
// Thus we can reverse `b` then use the Sum handler with the updated sum.
//
// Note that `Bx` is still a value in the same range as `bx`, so the Sum handler
// does not need to be made more general.
SudokuConstraintHandler.SumWithNegative = class SumWithNegative extends SudokuConstraintHandler.Sum {
  constructor(positiveCells, negativeCells, sum) {
    positiveCells = positiveCells.slice();
    positiveCells.sort((a, b) => a - b);
    negativeCells = negativeCells.slice();
    negativeCells.sort((a, b) => a - b);
    super([...positiveCells, ...negativeCells], sum);

    this._positiveCells = positiveCells;
    this._negativeCells = negativeCells;
    this._offsetForNegative = 0;

    // IMPORTANT: Complement cells don't work for this, because
    // we can't guarantee that reversed negativeCells is a unique value.
    // This will stop anyone adding them.
    this._complementCells = null;

    this.idStr = [this.constructor.name, positiveCells, negativeCells, sum].join('-');
  }

  setSum(sum) {
    this._sum = sum + this._offsetForNegative;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._offsetForNegative = (shape.numValues + 1) * this._negativeCells.length;
    this._sum += this._offsetForNegative;
    return super.initialize(initialGridCells, cellExclusions, shape, stateAllocator);
  }

  setComplementCells() { }

  enforceConsistency(grid, handlerAccumulator) {
    const reverse = this._lookupTables.reverse;

    const negativeCells = this._negativeCells;
    const numNegCells = negativeCells.length;
    for (let i = 0; i < numNegCells; i++) {
      grid[negativeCells[i]] = reverse[grid[negativeCells[i]]];
    }

    const result = super.enforceConsistency(grid, handlerAccumulator);

    // Reverse the value back even if we fail to make the output and debugging
    // easier.
    for (let i = 0; i < numNegCells; i++) {
      grid[negativeCells[i]] = reverse[grid[negativeCells[i]]];
    }

    return result;
  }
}

SudokuConstraintHandler.PillArrow = class PillArrow extends SudokuConstraintHandler {
  constructor(pillCells, arrowCells) {
    super([...pillCells, ...arrowCells]);
    const pillSize = pillCells.length;
    const numControl = pillSize - 1;
    this._controlCells = pillCells.slice(0, numControl);
    this._internalSumHandler = new SudokuConstraintHandler.SumWithNegative(
      arrowCells, [pillCells[pillSize - 1]], 0);
    this._scratchGrid = null;
    this._resultGrid = null;
    this._remainingValuesStack = new Uint16Array(numControl);
    this._currentValueStack = new Uint16Array(numControl);
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._internalSumHandler.initialize(
      initialGridCells, cellExclusions, shape, stateAllocator);

    // Constrain the most significant digit of the control cells.
    const numControl = this._controlCells.length;
    const maxSum = (this.cells.length - numControl - 1) * shape.numValues;
    const maxControlUnit = Math.pow(10, numControl);
    const maxControlValue = Math.min(
      maxSum / maxControlUnit | 0, shape.numValues);
    initialGridCells[this._controlCells[0]] &= ((1 << maxControlValue) - 1);

    return maxControlValue > 0;
  }

  postInitialize(initialGridState) {
    this._scratchGrid = initialGridState.slice();
    this._resultGrid = initialGridState.slice();
  }

  enforceConsistency(grid, handlerAccumulator) {
    const sumHandler = this._internalSumHandler;
    const controlCells = this._controlCells;
    const numControlCells = controlCells.length;

    {
      // Check if there is a single control value, so we can just enforce the
      // sum directly.
      // Not necessary, but it improves performance.
      let isUnique = true;
      let controlSum = 0;
      for (let i = 0; i < numControlCells; i++) {
        const values = grid[controlCells[i]];
        if (values & (values - 1)) {
          isUnique = false;
          break;
        }
        controlSum = (controlSum + LookupTables.toValue(values)) * 10;
      }
      if (isUnique) {
        sumHandler.setSum(controlSum);
        return sumHandler.enforceConsistency(grid, handlerAccumulator);
      }
    }

    // For each possible value of the control cell, enforce the sum.
    // In practice there should only be a few value control values.
    // scratchGrid is where the enforcement will happen, and valid values
    // will be copied to the resultGrid.
    const scratchGrid = this._scratchGrid;
    const resultGrid = this._resultGrid;
    resultGrid.fill(0);

    const cells = this.cells;
    const remainingValuesStack = this._remainingValuesStack;
    const currentValueStack = this._currentValueStack;

    let controlSum = 0;
    let stackDepth = 0;
    remainingValuesStack[stackDepth] = grid[controlCells[stackDepth]];
    stackDepth++;
    while (stackDepth) {
      stackDepth--;
      let values = remainingValuesStack[stackDepth];
      if (!values) {
        controlSum = (controlSum / 10) | 0;
        continue;
      }

      const value = values & -values;
      remainingValuesStack[stackDepth] ^= value;
      currentValueStack[stackDepth] = value;

      controlSum = controlSum * 10 + LookupTables.toValue(value);

      if (stackDepth + 1 == numControlCells) {
        sumHandler.setSum(controlSum * 10);

        // NOTE: This can be optimized to use a smaller (cell.length size) grid.
        scratchGrid.set(grid);
        for (let i = 0; i < numControlCells; i++) {
          scratchGrid[controlCells[i]] = currentValueStack[i];
        }
        // NOTE: We shouldn't pass in handlerAccumulator as it will add cells
        // which haven't necessarily been constrained.
        if (sumHandler.enforceConsistency(scratchGrid, null)) {
          // This is a valid setting so add it to the possible candidates.
          for (let i = 0; i < cells.length; i++) {
            resultGrid[cells[i]] |= scratchGrid[cells[i]];
          }
        }
        controlSum = (controlSum / 10) | 0;
      } else {
        stackDepth++;
        remainingValuesStack[stackDepth] = grid[controlCells[stackDepth]];
      }
      stackDepth++;
    }

    // If there were no valid values then the result grid will still be empty.
    if (!resultGrid[cells[0]]) return false;

    // Copy over all the valid values to the real grid.
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      grid[cell] = resultGrid[cell];
    }

    return true;
  }
}

SudokuConstraintHandler.Skyscraper = class Skyscraper extends SudokuConstraintHandler {
  constructor(cells, numVisible) {
    super(cells);
    this._numVisible = +numVisible;
    this._forwardStates = null;
    this._backwardStates = null;
    this._allStates = null;

    if (0 >= this._numVisible) {
      throw ('Skyscraper visibility target must be > 0');
    }
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // We need this to avoid overflowing the buffer.
    if (this._numVisible > shape.numValues) return false;

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
    const maxValue = LookupTables.fromValue(numCells);

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

    // Set the final state to just the target visibility.
    // Final state must be our maximum height (e.g. 9 for a 9x9).
    // Updated states are collected into backwardStates.
    const backwardStates = this._backwardStates;
    {
      if (!(forwardStates[lastMaxHeightIndex][target - 1] & maxValue)) return false;
      backwardStates[lastMaxHeightIndex][target - 1] = maxValue;
    }

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

SudokuConstraintHandler.HiddenSkyscraper = class HiddenSkyscraper extends SudokuConstraintHandler {
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

SudokuConstraintHandler.Lunchbox = class Lunchbox extends SudokuConstraintHandler {
  _borderMask = 0;
  _valueMask = 0;
  _distances = null;
  _combinations = null;
  _isHouse = false;

  constructor(cells, sum) {
    super(cells);
    sum = +sum;
    if (!Number.isInteger(sum) || sum < 0) {
      throw ('Invalid sum for sandwich constraint: ' + sum);
    }

    this._sum = sum;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const sum = this._sum;
    this._isHouse = this.cells.length === shape.gridSize;

    const lookupTables = LookupTables.get(shape.numValues);

    this._borderMask = SudokuConstraintHandler.Lunchbox._borderMask(shape);
    this._valueMask = ~this._borderMask & lookupTables.allValues;

    this._distances = SudokuConstraintHandler.Lunchbox._distanceRange(shape)[sum];
    this._combinations = SudokuConstraintHandler.Lunchbox._combinations(shape)[sum];

    return true;
  }

  exclusionCells() {
    return this.cells;
  }

  static _borderMask(shape) {
    return 1 | LookupTables.fromValue(shape.gridSize);
  }

  // Max sum within the sandwich.
  static _maxSum(shape) {
    return (shape.gridSize * (shape.gridSize - 1) / 2) - 1;
  }

  // Possible combinations for values between the sentinels for each possible sum.
  // Grouped by distance.
  static _combinations = memoize((shape) => {
    const lookupTables = LookupTables.get(shape.numValues);
    const maxSum = this._maxSum(shape);
    const borderMask = this._borderMask(shape);

    let table = [];
    const maxD = shape.gridSize - 1;
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
  static _validSettings = new Uint16Array(SHAPE_MAX.gridSize);
  static _cellValues = new Uint16Array(SHAPE_MAX.gridSize);

  enforceConsistency(grid, handlerAccumulator) {
    const isHouse = this._isHouse;
    const cells = this.cells;
    const numCells = this.cells.length;
    const borderMask = this._borderMask;

    // Cache the grid values for faster lookup.
    const values = SudokuConstraintHandler.Lunchbox._cellValues;
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

    const allValuesUsed = countOnes16bit(allValues) == numCells;

    // Build up a set of valid cell values.
    const validSettings = SudokuConstraintHandler.Lunchbox._validSettings;
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

        let combinations = this._combinations[j - i];
        let innerPossibilities = 0;
        let outerPossibilities = 0;
        const innerValuesMask = ~(innerValues & valueMask);
        const outerValuesMask = ~outerValues & valueMask & allValues;
        let innerRanges = valueMask;
        for (let k = 0; k < combinations.length; k++) {
          let c = combinations[k];
          // Check if the inner values can create the combination.
          if (!((innerValuesMask & c))) {
            if (allValuesUsed) {
              // Check if the outer values can create the complement.
              if (!(outerValuesMask & ~c)) {
                innerPossibilities |= c;
                outerPossibilities |= ~c;
              }
            } else {
              // Check if there are enough outer values for all the outer cells.
              if (countOnes16bit(~c & outerValues) >= numOuterCells) {
                innerPossibilities |= c;
                outerPossibilities |= ~c;
                innerRanges &= LookupTables.valueRangeInclusive(c);
              }
            }
          }

          outerPossibilities &= outerValues;
          // If we have either innerPossibilities or outerPossibilities it means
          // we have at least one valid setting. Either maybe empty if there
          // are 0 cells in the inner or outer range.
          if (innerPossibilities || outerPossibilities) {
            let k = 0;
            while (k < i) validSettings[k++] |= outerPossibilities;
            validSettings[k++] |= vi & ~innerRanges;
            while (k < j) validSettings[k++] |= innerPossibilities;
            validSettings[k++] |= vj & ~innerRanges;
            while (k < numCells) validSettings[k++] |= outerPossibilities;
          }
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
SudokuConstraintHandler.Jigsaw = class Jigsaw extends SudokuConstraintHandler {
  constructor(regions) {
    super();
    this.regions = regions;
  }
}

SudokuConstraintHandler.SameValues = class SameValues extends SudokuConstraintHandler {
  constructor(cells0, cells1, isUnique) {
    if (cells0.length != cells1.length) {
      // Throw, because same values are only created by our code.
      throw ('SameValues must use sets of the same length.');
    }

    // NOTE: We must copy before sorting (to avoid messing up order for the caller).
    cells0 = new Uint8Array(cells0);
    cells1 = new Uint8Array(cells1);

    cells0.sort((a, b) => a - b);
    cells1.sort((a, b) => a - b);

    super([...cells0, ...cells1]);
    // TODO: Figure out automatically?
    this._isUnique = isUnique;
    this._cells0 = cells0;
    this._cells1 = cells1;

    this.idStr = [this.constructor.name, cells0, cells1].join('-');
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells0 = this._cells0;
    const cells1 = this._cells1;
    const numCells = cells0.length;

    let values0 = 0;
    let values1 = 0;
    for (let i = numCells - 1; i >= 0; i--) {
      values0 |= grid[cells0[i]];
      values1 |= grid[cells1[i]];
    }

    if (values1 === values0) return true;

    const values = values1 & values0;

    // Check if we have enough values.
    if (this._isUnique && countOnes16bit(values) < numCells) return false;

    // Enforce the constrained value set.
    if (values0 !== values) {
      for (let i = numCells - 1; i >= 0; i--) {
        if (grid[cells0[i]] & ~values) {
          if (!(grid[cells0[i]] &= values)) return false;
          handlerAccumulator.addForCell(cells0[i]);
        }
      }
    }
    if (values1 !== values) {
      for (let i = numCells - 1; i >= 0; i--) {
        if (grid[cells1[i]] & ~values) {
          if (!(grid[cells1[i]] &= values)) return false;
          handlerAccumulator.addForCell(cells1[i]);
        }
      }
    }

    return true;
  }

  priority() {
    return 0;
  }
}

SudokuConstraintHandler.RegionSumLine = class RegionSumLine extends SudokuConstraintHandler {
  constructor(cells, regions) {
    super(cells);
    this._sumUtil = null;
    this._singles = null;
    this._multi = null;
    this._minMaxCache = null;
    this._arrows = [];
    this._regions = regions;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // Map cells to regions.
    const cellToRegion = new Map();
    for (const region of this._regions) {
      for (const cell of region) cellToRegion.set(cell, region);
    }

    // Split cells into sections of equal sum.
    const cellSets = [];
    let curSet = null;
    let curRegion = null;
    for (const cell of this.cells) {
      const newRegion = cellToRegion.get(cell);
      if (newRegion !== curRegion) {
        curRegion = newRegion;
        curSet = [];
        cellSets.push(curSet);
      }
      curSet.push(cell);
    }

    this._sumUtil = SudokuConstraintHandler._SumHandlerUtil.get(shape.numValues);

    // Separate the single- and multi-cell sections.
    this._singles = cellSets.filter(s => s.length == 1).map(s => s[0]);
    this._multi = cellSets.filter(s => s.length > 1);
    this._minMaxCache = new Uint16Array(this._multi.length);

    if (this._singles.length > 0) {
      // If we have any singles then we can solve every multi-cell
      // area by treating it as the stem of an arrow.
      const single = this._singles[0];
      for (const cells of this._multi) {
        const arrow = new SudokuConstraintHandler.SumWithNegative(
          cells, [single], 0);
        arrow.initialize(initialGridCells, cellExclusions, shape, stateAllocator);
        this._arrows.push(arrow);
      }
      this._multi = [];
    }

    return true;
  }

  _enforceSingles(grid, handlerAccumulator) {
    const numSingles = this._singles.length;

    // Single values must all be the same, so only take values which
    // are legal in ALL cells.
    let valueSet = -1 >>> 1;
    for (let i = 0; i < numSingles; i++) {
      valueSet &= grid[this._singles[i]];
    }

    // No possible settings for the single values.
    if (valueSet == 0) return false;

    // Constrain the singles.
    for (let i = 0; i < numSingles; i++) {
      grid[this._singles[i]] = valueSet;
    }

    return true;
  }

  _enforceMulti(grid, handlerAccumulator) {

    const minMaxs = this._minMaxCache;

    // Determine the range of possible sums.
    let globalMin = 0;
    let globalMax = -1 >>> 1;
    for (let i = 0; i < this._multi.length; i++) {
      let minMax = 0;
      for (const cell of this._multi[i]) {
        minMax += LookupTables.minMax16bitValue(grid[cell]);
      }
      minMaxs[i] = minMax;
      const sumMin = minMax >> 16;
      const sumMax = minMax & 0xffff;
      globalMin = Math.max(sumMin, globalMin);
      globalMax = Math.min(sumMax, globalMax);
    }

    if (globalMin > globalMax) return false;

    // Constraint each set to the known range.
    for (let i = 0; i < this._multi.length; i++) {
      const cells = this._multi[i];
      const minMax = minMaxs[i];
      const sumMin = minMax >> 16;
      const sumMax = minMax & 0xffff;
      const sumMinusMin = globalMax - sumMin;
      const maxMinusSum = sumMax - globalMin;
      if (!this._sumUtil.restrictValueRange(grid, cells, sumMinusMin, maxMinusSum)) {
        return false;
      }

      if (globalMin == globalMax) {
        // We know the sum, and cells should always be in a single region
        // (by definition).
        if (!this._sumUtil.restrictCellsSingleExclusionGroup(
          grid, globalMin, cells, null, handlerAccumulator)) return false;
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    if (this._singles.length > 1) {
      if (!this._enforceSingles(grid, handlerAccumulator)) return false;
    }
    if (this._arrows.length > 0) {
      for (const arrow of this._arrows) {
        if (!arrow.enforceConsistency(grid, handlerAccumulator)) return false;
      }
    }
    if (this._multi.length > 0) {
      if (!this._enforceMulti(grid, handlerAccumulator)) return false;
    }

    return true;
  }
}

SudokuConstraintHandler.Between = class Between extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._ends = [cells[0], cells[cells.length - 1]]
    this._mids = cells.slice(1, cells.length - 1)
    this._binaryConstraint = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    const exclusionGroups = SudokuConstraintHandler._CommonHandlerUtil.findExclusionGroups(
      this._mids, cellExclusions);
    const maxGroupSize = Math.max(0, ...exclusionGroups.map(a => a.length));
    const minEndsDelta = maxGroupSize ? maxGroupSize + 1 : 0;

    this._binaryConstraint = new SudokuConstraintHandler.BinaryConstraint(
      ...this._ends,
      SudokuConstraint.Binary.fnToKey(
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

SudokuConstraintHandler.Lockout = class Lockout extends SudokuConstraintHandler {
  constructor(minDiff, cells) {
    super(cells);
    this._minDiff = +minDiff;
    this._ends = [cells[0], cells[cells.length - 1]]
    this._mids = cells.slice(1, cells.length - 1)
    this._binaryConstraint = null;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._binaryConstraint = new SudokuConstraintHandler.BinaryConstraint(
      ...this._ends,
      SudokuConstraint.Binary.fnToKey(
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

SudokuConstraintHandler.XSum = class XSum extends SudokuConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._controlCell = cells[0];
    this._internalSumHandler = new SudokuConstraintHandler.Sum(
      this.cells.slice(), this._sum);
    this._scratchGrid = null;
    this._resultGrid = null;
    this._cellArrays = [];
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    this._internalSumHandler.initialize(
      initialGridCells, cellExclusions, shape, stateAllocator);

    // Cache the partial cell arrays to make it easier to pass into the sumHandler.
    let array = [];
    for (let i = 0; i < shape.gridSize; i++) {
      array.push(this.cells.slice(0, i + 1));
    }
    this._cellArrays = array;
    return true;
  }

  postInitialize(initialGridState) {
    this._internalSumHandler.postInitialize(initialGridState);
    this._scratchGrid = initialGridState.slice();
    this._resultGrid = initialGridState.slice();
  }

  // Determine and restrict the range of acceptable values for the control cell.
  _restrictControlCell(grid) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum;
    const controlCell = this._controlCell;

    let minSum = 0;
    let maxSum = 0;

    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      minSum += LookupTables.minValue(v);
      maxSum += LookupTables.maxValue(v);

      if (minSum > sum || maxSum < sum) {
        // This count isn't possible, so remove it from the control.
        grid[controlCell] &= ~LookupTables.fromValue(i + 1);
        // minSum will never get lower.
        if (minSum > sum) break;
      }
    }

    return grid[controlCell] !== 0;
  }

  enforceConsistency(grid, handlerAccumulator) {
    if (!this._restrictControlCell(grid)) return false;

    const sumHandler = this._internalSumHandler;
    const cells = this.cells;
    const controlCell = this._controlCell;

    let values = grid[controlCell];
    const numControl = countOnes16bit(values);
    if (numControl == 1) {
      // There is a single value, so we can just enforce the sum directly.
      const index = LookupTables.toValue(values) - 1;
      sumHandler.cells = this._cellArrays[index];
      return sumHandler.enforceConsistency(grid, handlerAccumulator);
    }

    // For each possible value of the control cell, enforce the sum.
    // In practice there should only be a few value control values.
    const scratchGrid = this._scratchGrid;
    const resultGrid = this._resultGrid;
    resultGrid.fill(0);
    // Determine minControl, because we can only constraint this many cells.
    // Cells beyond that may have unconstrained values depending on the control.
    const minControl = LookupTables.minValue(values);
    while (values) {
      const value = values & -values;
      values ^= value;

      const index = LookupTables.toValue(value) - 1;
      sumHandler.cells = this._cellArrays[index];

      // NOTE: This can be optimized to use a smaller (cell.length size) grid.
      scratchGrid.set(grid);
      scratchGrid[controlCell] = value;
      // NOTE: We shouldn't pass in handlerAccumulator as it will add cells
      // which haven't necessarily been constrained.
      if (sumHandler.enforceConsistency(scratchGrid, null)) {
        // This is a valid setting so add it to the possible candidates.
        for (let j = 0; j < minControl; j++) {
          resultGrid[cells[j]] |= scratchGrid[cells[j]];
        }
      }
    }

    // Copy over all the valid values to the real grid.
    for (let j = 0; j < minControl; j++) {
      grid[cells[j]] = resultGrid[cells[j]];
    }

    return grid[controlCell] !== 0;
  }
}

// Enforce the "Global entropy" constraint for a single 2x2 region.
SudokuConstraintHandler.LocalEntropy = class LocalEntropy extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._cellExclusions = null;

    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;
  }

  static _valuesBuffer = new Uint16Array(SHAPE_MAX.numValues);
  static _SQUISHED_MASK = (
    LookupTables.fromValue(1) |
    LookupTables.fromValue(4) |
    LookupTables.fromValue(7));
  static _TRIADS = [
    LookupTables.fromValuesArray([1, 2, 3]),
    LookupTables.fromValuesArray([4, 5, 6]),
    LookupTables.fromValuesArray([7, 8, 9])];

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

    const triads = this.constructor._TRIADS;
    for (let i = 0; i < triads.length; i++) {
      const triadValue = triads[i] & allValues;
      // Skip triads which have more than one value, or which are already fixed.
      if ((triadValue & (triadValue - 1)) || (triadValue & fixedValues)) {
        continue;
      }
      // Now we know `triadValue` is a required value and is in multiple cells.
      if (!this._commonUtil.enforceRequiredValueExclusions(
        grid, cells, triadValue, this._cellExclusions, handlerAccumulator)) return false;
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = this.cells.length;
    const squishedMask = this.constructor._SQUISHED_MASK;
    const valuesBuffer = this.constructor._valuesBuffer;

    // This code is very similar to the House handler, but adjusted to
    // collapse the values into 3 sets.
    let allValues = 0;
    let atLeastTwo = 0;
    let atLeastThree = 0;
    let fixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      v |= (v >> 1) | (v >> 2);
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
          const unsquishedValue = value | (value << 1) | (value << 2);
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
            const unsquishedValue = v | (v << 1) | (v << 2);
            grid[cells[i]] &= unsquishedValue;
            grid[cells[j]] &= unsquishedValue;
          }
        }
      }
    }

    return this._enforceRequiredValues(grid, handlerAccumulator);
  }
}

SudokuConstraintHandler.RequiredValues = class RequiredValues extends SudokuConstraintHandler {
  constructor(cells, values, strict) {
    super(cells);
    this._values = values;
    this._strict = strict;

    this._valueCounts = new Map(values.map(v => [v, 0]));
    for (const v of values) {
      this._valueCounts.set(v, this._valueCounts.get(v) + 1);
    }

    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;
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
      if (!this._commonUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
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

SudokuConstraintHandler.SumLine = class SumLine extends SudokuConstraintHandler {
  constructor(cells, loop, sum) {
    super(cells);
    this._sum = +sum;

    if (this._sum > 30) {
      // A sum of 30 fits within a 32-bit state.
      throw ('SumLine sum must at most 30');
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

SudokuConstraintHandler.Indexing = class Indexing extends SudokuConstraintHandler {
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

SudokuConstraintHandler.CountingCircles = class CountingCircles extends SudokuConstraintHandler {
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

    const exclusionGroups = (
      SudokuConstraintHandler._CommonHandlerUtil.findExclusionGroups(
        this.cells, cellExclusions));

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

SudokuConstraintHandler.NumberedRoom = class NumberedRoom extends SudokuConstraintHandler {
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

SudokuConstraintHandler.FullRank = class FullRank extends SudokuConstraintHandler {
  constructor(numGridCells, clues) {
    const allCells = Uint8Array.from({ length: numGridCells }, (_, i) => i);
    super(allCells);

    this._uncluedEntries = [];
    this._rankSets = [];
    this._clues = clues;
  }

  clues() {
    return this._clues;
  }

  initialize(initialGridCells, cellExclusions, shape, stateAllocator) {
    // Initialize entries.
    const gridSize = shape.gridSize;
    const entries = [];
    for (let i = 0; i < gridSize; i++) {
      const row = Uint8Array.from(
        { length: gridSize }, (_, j) => i * gridSize + j);
      entries.push(row);
      entries.push(row.slice().reverse());
      const col = Uint8Array.from(
        { length: gridSize }, (_, j) => j * gridSize + i);
      entries.push(col);
      entries.push(col.slice().reverse());
    }

    // Group entries with the same initial values.
    // i.e. the same int((rank+3)/4)
    const rankMap = new Map();
    for (const clue of this._clues) {
      const value = LookupTables.fromValue((clue.rank + 3) >> 2);
      if (!rankMap.has(value)) {
        rankMap.set(value, []);
      }
      const entryIndex = entries.findIndex(
        e => e[0] === clue.line[0] && e[1] === clue.line[1]);
      rankMap.get(value).push({
        rankIndex: (clue.rank + 3) & 3,
        entry: entries.splice(entryIndex, 1)[0],
        requiredLess: 0,
        requiredGreater: 0,
      });
      if (!(initialGridCells[clue.line[0]] &= value)) {
        return false;
      }
    }
    this._uncluedEntries = entries;

    for (const [value, givens] of rankMap) {
      // Sort givens by rank.
      givens.sort((a, b) => a.rankIndex - b.rankIndex);
      // Determine the number of unclued entries required to be less and greater
      // than this given.
      const numGivens = givens.length;
      for (let i = 0; i < givens.length; i++) {
        const given = givens[i];
        const rankIndex = given.rankIndex;
        given.requiredLess = rankIndex - i;
        given.requiredGreater = (3 - rankIndex) - (numGivens - i - 1);
      }
      // Make the rankSet.
      this._rankSets.push({
        value: value,
        givens: givens,
      });
    }
    return true;
  }

  _viableEntriesBuffer = new Int16Array(SHAPE_MAX.gridSize * 4 + 1);
  _flagsBuffer = new Uint8Array(SHAPE_MAX.gridSize * 4);

  _enforceUncluedEntriesForGiven(
    grid, handlerAccumulator, viableEntries, numViableEntries, given) {
    const { entry, requiredLess, requiredGreater } = given;
    const entries = this._uncluedEntries;
    const initialV = grid[entry[0]];
    const entryLength = entry.length;

    const flagsBuffer = this._flagsBuffer;
    const IS_SET_FLAG = 1;
    const IS_LESS_FLAG = 2;
    const IS_GREATER_FLAG = 4;
    const IS_BOTH_FLAGS = IS_LESS_FLAG | IS_GREATER_FLAG;

    let maybeLessCount = 0;
    let maybeGreaterCount = 0;
    let fixedLessCount = 0;
    let fixedGreaterCount = 0;

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

        // Break if we've:
        //  - found both possibilities;
        //  -  or found that this cell forces a direction.
        if ((flags & IS_BOTH_FLAGS) === IS_BOTH_FLAGS) break;
        if (minE > maxEntry || maxE < minEntry) break;

        // If we are continuing then we are attempting to break a tie assuming
        // that the entries are equal.
        // There must be exactly one value in the intersection (otherwise
        // both the IS_LESS_FLAG and IS_GREATER_FLAG would be set).
        // Thus if we take the intersection, we know that value can't appear in
        // future cells.
        equalValuesMask &= ~(eV & entryV);
      }
      flagsBuffer[i] = flags;
      if (flags & IS_GREATER_FLAG) {
        maybeGreaterCount++;
        if (flags === (IS_GREATER_FLAG | IS_SET_FLAG)) {
          fixedGreaterCount++;
        }
      }
      if (flags & IS_LESS_FLAG) {
        maybeLessCount++;
        if (flags === (IS_LESS_FLAG | IS_SET_FLAG)) {
          fixedLessCount++;
        }
      }
    }

    // Check we have enough entries.
    if (maybeLessCount < requiredLess) return false;
    // Check if we have too many entries.
    if (fixedLessCount > requiredLess) return false;
    if (maybeLessCount == requiredLess && fixedLessCount < requiredLess) {
      // If all viable entries are required, then they are forced to be included.
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] & IS_LESS_FLAG) {
          const cell = entries[viableEntries[i]][0];
          grid[cell] = initialV;
          handlerAccumulator.addForCell(cell);
        }
      }
    } else if (fixedLessCount === requiredLess && maybeLessCount > requiredLess) {
      // If all viable set entries fill up the required slots, then any other
      // viable entries must be excluded.
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] === IS_LESS_FLAG) {
          // This entry only had the invalid direction, so we can exclude it.
          const cell = entries[viableEntries[i]][0];
          grid[cell] &= ~initialV;
          handlerAccumulator.addForCell(cell);
        } else if (flagsBuffer[i] === (IS_LESS_FLAG | IS_GREATER_FLAG | IS_SET_FLAG)) {
          // This entry must be included, but currently allows both directions.
          // Try to constraint it to just the valid direction.
          if (!this._enforceEntriesWithKnownOrder(grid, handlerAccumulator,
            entry, entries[viableEntries[i]])) {
            return false;
          }
        }
      }
    }

    // Repeat for the greater direction.
    if (maybeGreaterCount < requiredGreater) return false;
    if (fixedGreaterCount > requiredGreater) return false;
    if (maybeGreaterCount == requiredGreater && fixedGreaterCount < requiredGreater) {
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] & IS_GREATER_FLAG) {
          const cell = entries[viableEntries[i]][0];
          grid[cell] = initialV;
          handlerAccumulator.addForCell(cell);
        }
      }
    } else if (fixedGreaterCount === requiredGreater && maybeGreaterCount > requiredGreater) {
      for (let i = 0; i < numViableEntries; i++) {
        if (flagsBuffer[i] === IS_GREATER_FLAG) {
          const cell = entries[viableEntries[i]][0];
          grid[cell] &= ~initialV;
          handlerAccumulator.addForCell(cell);
        } else if (flagsBuffer[i] === (IS_LESS_FLAG | IS_GREATER_FLAG | IS_SET_FLAG)) {
          if (!this._enforceEntriesWithKnownOrder(grid, handlerAccumulator,
            entries[viableEntries[i]], entry)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  _enforceEntriesWithKnownOrder(grid, handlerAccumulator, lowEntry, highEntry) {
    // We know that lowEntry must be lower then highEntry, and are in the same
    // rank set.
    // Algorithm:
    //  - Keep iterating until we find the first cell where the entries could
    //    possibly differ, i.e. when are not equal fixed values.
    //  - For that cell only, filter out any values which would cause lowEntry
    //    to be higher than highEntry. Equal is ok, as ties may be broken by
    //    later cells.
    //  - Stop if the cells are still not equal fixed values.

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
      if (!(lowV === highV && !(lowV & (lowV - 1)))) break;
      equalValuesMask &= ~lowV;
    }
    return true;
  }

  _enforceSingleRankSet(grid, handlerAccumulator, rankSet) {
    const { value, givens } = rankSet;
    const numGivens = givens.length;

    // First constraint the clued ranks against each other.
    for (let i = 1; i < numGivens; i++) {
      if (!this._enforceEntriesWithKnownOrder(grid, handlerAccumulator,
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

    return true;
  }

  candidateFinders(grid, shape) {
    const finders = [];
    const gridSize = shape.gridSize;

    for (const rankSet of this._rankSets) {
      const value = rankSet.value;

      // Determine which edges don't have clues.
      const flags = [1, 1, 1, 1];
      for (const given of rankSet.givens) {
        const cell0 = given.entry[0];
        const [row, col] = shape.splitCellIndex(cell0);
        if (row === 0) flags[0] = 0;
        if (col === 0) flags[1] = 0;
        if (row === gridSize - 1) flags[2] = 0;
        if (col === gridSize - 1) flags[3] = 0;
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
        addFinder(SudokuConstraintBase.rowRegions(shape)[gridSize - 1]);
      }
      if (flags[3]) {
        addFinder(SudokuConstraintBase.colRegions(shape)[gridSize - 1]);
      }
    }

    return finders;
  }
}

SudokuConstraintHandler.Or = class Or extends SudokuConstraintHandler {
  constructor(...handlers) {
    // Exclusion cells need special handlings since they can't be handled
    // directly by the engine.
    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i];
      const exclusionCells = handler.exclusionCells();
      if (exclusionCells.length) {
        // The 'And' handler takes care of exclusion cells.
        handlers[i] = new SudokuConstraintHandler.And(handler);
      }
    }

    const cells = [...new Set(handlers.flatMap(h => [...h.cells]))];
    super(cells);

    this._scratchGrid = null;
    this._resultGrid = null;
    this._handlers = handlers;
    this._initializations = [];
    this._numGridCells = 0;
    this._stateAllocator = 0;
    this._dummyHandlerAccumulator = new SudokuSolver.DummyHandlerAccumulator();
  }

  _markAsInvalid(grid, handlerIndex) {
    grid[this._stateOffset + (handlerIndex >> 4)] |= 1 << (handlerIndex & 15);
  }

  _isInvalid(grid, handlerIndex) {
    return 0 !== (grid[this._stateOffset + (handlerIndex >> 4)] & (1 << (handlerIndex & 15)));
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
        this._markAsInvalid(grid, h);
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

    this._stateOffset = stateAllocator.allocate(
      new Array((this._handlers.length >> 4) + 1).fill(0));


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

  postInitialize(initialGridState) {
    for (const h of this._handlers) {
      h.postInitialize(initialGridState);
    }
    this._scratchGrid = initialGridState.slice();
    this._resultGrid = initialGridState.slice();
  }

  enforceConsistency(grid, handlerAccumulator) {
    const numGridCells = this._numGridCells;

    const resultGrid = this._resultGrid;
    const scratchGrid = this._scratchGrid;
    const dummyHandlerAccumulator = this._dummyHandlerAccumulator;
    resultGrid.fill(0);

    for (let i = 0; i < this._handlers.length; i++) {
      if (this._isInvalid(grid, i)) continue;

      const handler = this._handlers[i];
      const initialization = this._initializations[i];

      // Initialize the scratch grid.
      scratchGrid.set(grid);
      for (let j = 0; j < initialization.length; j += 2) {
        if (!(scratchGrid[initialization[j]] &= initialization[j + 1])) {
          this._markAsInvalid(grid, i);
          continue;
        }
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

class HandlerSet {
  constructor(handlers, shape) {
    this._allHandlers = [];
    this._seen = new Map();
    this._ordinaryIndexLookup = new Map();

    this._singletonHandlerMap = [];
    this._ordinaryHandlerMap = [];
    this._auxHandlerMap = [];
    for (let i = 0; i < shape.numCells; i++) {
      this._ordinaryHandlerMap.push([]);
      this._auxHandlerMap.push([]);
      this._singletonHandlerMap.push([]);
    }

    this.add(...handlers);
  }

  getAllofType(type) {
    return this._allHandlers.filter(h => h.constructor === type);
  }

  getAll() {
    return this._allHandlers;
  }

  getOrdinaryHandlerMap() {
    return this._ordinaryHandlerMap;
  }

  getAuxHandlerMap() {
    return this._auxHandlerMap;
  }

  getIntersectingIndexes(handler) {
    const handlerIndex = this._ordinaryIndexLookup.get(handler);
    const intersectingHandlers = new Set();
    for (const c of handler.cells) {
      this._ordinaryHandlerMap[c].forEach(i => intersectingHandlers.add(i));
    }
    intersectingHandlers.delete(handlerIndex);
    return intersectingHandlers;
  }

  getIndex(handler) {
    return this._ordinaryIndexLookup.get(handler);
  }

  getHandler(index) {
    return this._allHandlers[index];
  }

  getSingletonHandlerMap() {
    return this._singletonHandlerMap;
  }

  replace(oldHandler, newHandler) {
    newHandler.essential = oldHandler.essential;

    const index = this._allHandlers.indexOf(oldHandler);

    this._allHandlers[index] = newHandler;
    if (!arraysAreEqual(oldHandler.cells, newHandler.cells)) {
      this.updateCells(index, oldHandler.cells, newHandler.cells);
    }
  }

  updateCells(index, oldCells, newCells) {
    for (const c of oldCells) {
      const indexInMap = this._ordinaryHandlerMap[c].indexOf(index);
      this._ordinaryHandlerMap[c].splice(indexInMap, 1);
    }
    newCells.forEach(c => this._ordinaryHandlerMap[c].push(index));
  }

  delete(handler) {
    this.replace(handler, new SudokuConstraintHandler.True());
  }

  _addOrdinary(handler, index) {
    if (index === undefined) {
      index = this._addToAll(handler);
    } else {
      this._allHandlers[index] = handler;
    }

    handler.cells.forEach(c => this._ordinaryHandlerMap[c].push(index));
    this._ordinaryIndexLookup.set(handler, index);
  }

  add(...handlers) {
    for (const h of handlers) {
      if (h.constructor.SINGLETON_HANDLER) {
        this.addSingletonHandlers(h);
      } else {
        if (!this._addToSeen(h)) continue;
        this._addOrdinary(h);
      }
    }
  }

  addNonEssential(...handlers) {
    for (const h of handlers) {
      h.essential = false;
      if (!this._addToSeen(h)) continue;
      this._addOrdinary(h);
    }
  }

  addAux(...handlers) {
    for (const h of handlers) {
      h.essential = false;
      if (!this._addToSeen(h)) continue;
      this._addAux(h);
    }
  }

  addSingletonHandlers(...handlers) {
    for (const h of handlers) {
      if (!this._addToSeen(h)) {
        throw ('Singleton handlers must be unique');
      }

      const index = this._addToAll(h);
      this._singletonHandlerMap[h.cells[0]].push(index);
    }
  }

  // Return:
  //   true if we added it to see.
  //   false if it already existed.
  _addToSeen(h) {
    if (this._seen.has(h.idStr)) {
      // Make sure we mark the handler as essential if either
      // is essential.
      this._seen.get(h.idStr).essential ||= h.essential;
      return false;
    }
    this._seen.set(h.idStr, h);
    return true;
  }

  _addAux(handler) {
    const index = this._addToAll(handler);
    handler.cells.forEach(
      c => this._auxHandlerMap[c].push(index));
  }

  _addToAll(handler) {
    const index = this._allHandlers.length;
    this._allHandlers.push(handler);
    return index;
  }

  [Symbol.iterator]() {
    return this._allHandlers[Symbol.iterator]();
  }
}