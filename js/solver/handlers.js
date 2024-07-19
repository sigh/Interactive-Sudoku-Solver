"use strict";

class SudokuConstraintHandler {
  static _defaultId = 0;

  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
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
  initialize(initialGrid, cellExclusions, shape) {
    return true;
  }

  priority() {
    // By default, constraints which constrain more cells have higher priority.
    return this.cells.length;
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

  initialize(initialGrid, cellExclusions, shape) {
    return false;
  }
  enforceConsistency(grid, handlerAccumulator) { return false; }
}

SudokuConstraintHandler.GivenCandidates = class GivenCandidates extends SudokuConstraintHandler {
  constructor(valueMap) {
    super();
    this._valueMap = valueMap;
  }

  initialize(initialGrid) {
    for (const [cell, value] of this._valueMap) {
      if (isIterable(value)) {
        initialGrid[cell] &= LookupTables.fromValuesArray(value);
      } else {
        initialGrid[cell] &= LookupTables.fromValue(value);
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

  initialize(initialGrid, cellExclusions, shape) {
    return this._exclusionCells.length <= shape.numValues;
  }

  exclusionCells() {
    return this._exclusionCells;
  }
}

// UniqueValueExclusion handles the case when a cell is set to a specific value.
// It removes that value from all cells which share an all-different constraint
// with this cell.
SudokuConstraintHandler.UniqueValueExclusion = class UniqueValueExclusion extends SudokuConstraintHandler {
  constructor(cell) {
    super([cell]);
    this._cell = cell;
    this._cellExclusions = null;
  }

  initialize(initialGrid, cellExclusions, shape) {
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
}

SudokuConstraintHandler.House = class House extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._shape = null;
    this._lookupTables = null;
    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._shape = shape;
    this._lookupTables = LookupTables.get(shape.numValues);

    return true;
  }

  static _seenPairs = new Uint16Array(SHAPE_MAX.numValues);
  static _pairLocations = new Uint16Array(SHAPE_MAX.numValues);

  _enforceNakedPairs(grid, cells, handlerAccumulator) {
    const numCells = cells.length;

    let numPairs = 0 | 0;
    const seenPairs = this.constructor._seenPairs;
    const pairLocations = this.constructor._pairLocations;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      if (countOnes16bit(v) != 2) continue;
      seenPairs[numPairs] = v;
      pairLocations[numPairs] = i;
      numPairs++;
    }

    for (let i = 1; i < numPairs; i++) {
      const v = seenPairs[i];
      for (let j = 0; j < i; j++) {
        if (v !== seenPairs[j]) continue;

        // We found a matching pair.
        const pi = pairLocations[i];
        const pj = pairLocations[j];
        // Remove the pair from all other entries.
        for (let k = 0; k < numCells; k++) {
          if (k == pi || k == pj) continue;

          // If there is anything to remove, try to remove it.
          // If that eliminates this cell then return false.
          let kv = grid[cells[k]];
          if (!(kv & v)) continue;
          if (!(kv &= ~v)) return false;
          grid[cells[k]] = kv;
          handlerAccumulator.addForCell(cells[k]);

          // If removing values made this a naked pair then add it to the list.
          if (countOnes16bit(kv) == 2) {
            seenPairs[numPairs] = kv;
            pairLocations[numPairs] = k;
            numPairs++;
          }
        }

        // If we found a match for this pair, then we won't find another one
        // for the same pair.
        break;
      }
    }

    return true;
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    let allValues = 0;
    let nonUniqueValues = 0;
    let fixedValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v;  // Avoid branching.
    }

    if (allValues != this._lookupTables.allValues) return false;
    if (fixedValues == this._lookupTables.allValues) return true;

    const hiddenSingles = allValues & ~nonUniqueValues & ~fixedValues;
    if (hiddenSingles) {
      if (!this._commonUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
        return false;
      }
      fixedValues |= hiddenSingles;
    }

    // Check for naked pairs.
    // We won't have anything useful to do unless we have at least 2 free cells.
    if (numCells - countOnes16bit(fixedValues) <= 2) return true;

    return this._enforceNakedPairs(grid, cells, handlerAccumulator);
  }

  exclusionCells() {
    return this.cells;
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

  initialize(initialGrid, cellExclusions, shape) {
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

  initialize(initialGrid, cellExclusions, shape) {
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
      cellExclusions.cacheCellTuples(this.cells);
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
      let exclusionGroups = this.findExclusionGroupsGreedy(cells, cellExclusions);
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
  static findExclusionGroupsGreedy(cells, cellExclusions) {
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

  restrictValueRange(grid, cells, sumMinusMin, maxMinusSum) {
    const minMaxLookup = this._lookupTables.minMax8Bit;
    // Remove any values which aren't possible because they would cause the sum
    // to be too high.
    for (let i = 0; i < cells.length; i++) {
      let value = grid[cells[i]];
      // If there is a single value, then the range is always fine.
      if (!(value & (value - 1))) continue;

      const minMax = minMaxLookup[value];
      const cellMin = minMax >> 8;
      const cellMax = minMax & 0xff;
      const range = cellMax - cellMin;

      if (sumMinusMin < range) {
        const x = sumMinusMin + cellMin;
        // Remove any values GREATER than x. Even if all other squares
        // take their minimum values, these are too big.
        if (!(value &= ((1 << x) - 1))) return false;
        grid[cells[i]] = value;
      }

      if (maxMinusSum < range) {
        // Remove any values LESS than x. Even if all other squares
        // take their maximum values, these are too small.
        const x = cellMax - maxMinusSum;
        if (!(value &= -(1 << (x - 1)))) return false;
        grid[cells[i]] = value;
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

    const minMaxLookup = this._lookupTables.minMax8Bit;
    const numValues = this._numValues;
    const allValues = this._lookupTables.allValues;

    for (let s = 0; s < numSets; s++) {
      let set = exclusionGroups[s];
      let seenMin = 0;
      let seenMax = 0;

      for (let i = 0; i < set.length; i++) {
        const minMax = minMaxLookup[grid[set[i]]];
        const min = minMax >> 8;
        const max = minMax & 0xff;

        const minShift = min - 1;
        const maxShift = numValues - max;

        // Set the smallest unset value >= min.
        // i.e. Try to add min to seenMin, but it if already exists then find
        // the next smallest value.
        let x = ~(seenMin >> minShift);
        seenMin |= (x & -x) << minShift;
        // Set the largest unset value <= max.
        x = ~(seenMax >> maxShift);
        seenMax |= (x & -x) << maxShift;
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

  initialize(initialGrid, cellExclusions, shape) {
    this._shape = shape;

    this._lookupTables = LookupTables.get(shape.numValues);

    this._sumUtil = SudokuConstraintHandler._SumHandlerUtil.get(shape.numValues);

    this._exclusionGroups = (
      SudokuConstraintHandler._SumHandlerUtil.findExclusionGroups(
        this._positiveCells, cellExclusions));
    if (this._negativeCells.length) {
      this._exclusionGroups.push(
        ...SudokuConstraintHandler._SumHandlerUtil.findExclusionGroups(
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
      cellExclusions.cacheCellTuples(this.cells);
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

  initialize(initialGrid, cellExclusions, shape) {
    this._offsetForNegative = (shape.numValues + 1) * this._negativeCells.length;
    this._sum += this._offsetForNegative;
    return super.initialize(initialGrid, cellExclusions, shape);
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

  initialize(initialGrid, cellExclusions, shape) {
    this._internalSumHandler.initialize(
      initialGrid, cellExclusions, shape);

    // Constrain the most significant digit of the control cells.
    const numControl = this._controlCells.length;
    const maxSum = (this.cells.length - numControl - 1) * shape.numValues;
    const maxControlUnit = Math.pow(10, numControl);
    const maxControlValue = Math.min(
      maxSum / maxControlUnit | 0, shape.numValues);
    initialGrid[this._controlCells[0]] &= ((1 << maxControlValue) - 1);

    this._scratchGrid = initialGrid.slice();
    this._resultGrid = initialGrid.slice();

    return maxControlValue > 0;
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

  initialize(initialGrid, cellExclusions, shape) {
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

  initialize(initialGrid, cellExclusions, shape) {
    // If the hidden value is first it will always be visible.
    if (!(initialGrid[this.cells[0]] &= ~this._targetV)) return false;
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
  _minMax8Bit = null;
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

  initialize(initialGrid, cellExclusions, shape) {
    const sum = this._sum;
    this._isHouse = this.cells.length === shape.gridSize;

    const lookupTables = LookupTables.get(shape.numValues);

    this._borderMask = SudokuConstraintHandler.Lunchbox._borderMask(shape);
    this._valueMask = ~this._borderMask & lookupTables.allValues;
    this._minMax8Bit = lookupTables.minMax8Bit;

    this._distances = SudokuConstraintHandler.Lunchbox._distanceRange(shape)[sum];
    this._combinations = SudokuConstraintHandler.Lunchbox._combinations(shape)[sum];

    return true;
  }

  exclusionCells() {
    return this.cells;
  }

  static _borderMask(shape) {
    return 1 | (1 << (shape.gridSize - 1));
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
        let minMax8Bit = this._minMax8Bit;
        while (!(values[i++] & borderMask));
        while (!(values[i] & borderMask)) {
          // NOTE: 8 bits is fine here because we can have at most (numValues-2) cells.
          // For 16x16, 16*14 = 224 < 8 bits.
          minMaxSum += minMax8Bit[values[i]];
          i++;
        }

        const sum = this._sum;
        const minSum = minMaxSum >> 8;
        const maxSum = minMaxSum & 0xff;
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
  constructor(cells) {
    super(cells);
    this._sumUtil = null;
    this._minMax8Bit = null;
    this._singles = null;
    this._multi = null;
    this._minMaxCache = null;
    this._arrows = [];
  }

  initialize(initialGrid, cellExclusions, shape) {
    // Map cells to box regions.
    const cellToBox = new Map();
    for (const boxRegion of SudokuConstraintBase.boxRegions(shape)) {
      for (const cell of boxRegion) cellToBox.set(cell, boxRegion);
    }

    // Split cells into sections of equal sum.
    const cellSets = [];
    let curSet = null;
    let curBox = null;
    for (const cell of this.cells) {
      const newBox = cellToBox.get(cell);
      if (newBox !== curBox) {
        curBox = newBox;
        curSet = [];
        cellSets.push(curSet);
      }
      curSet.push(cell);
    }

    this._sumUtil = SudokuConstraintHandler._SumHandlerUtil.get(shape.numValues);
    const lookupTables = LookupTables.get(shape.numValues);
    this._minMax8Bit = lookupTables.minMax8Bit;

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
        arrow.initialize(initialGrid, cellExclusions, shape);
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

    const minMaxTable = this._minMax8Bit;
    const minMaxs = this._minMaxCache;

    // Determine the range of possible sums.
    let globalMin = 0;
    let globalMax = -1 >>> 1;
    for (let i = 0; i < this._multi.length; i++) {
      let minMax = 0;
      for (const cell of this._multi[i]) {
        minMax += minMaxTable[grid[cell]];
      }
      minMaxs[i] = minMax;
      const sumMin = minMax >> 8;
      const sumMax = minMax & 0xff;
      globalMin = Math.max(sumMin, globalMin);
      globalMax = Math.min(sumMax, globalMax);
    }

    if (globalMin > globalMax) return false;

    // Constraint each set to the known range.
    for (let i = 0; i < this._multi.length; i++) {
      const cells = this._multi[i];
      const minMax = minMaxs[i];
      const sumMin = minMax >> 8;
      const sumMax = minMax & 0xff;
      const sumMinusMin = globalMax - sumMin;
      const maxMinusSum = sumMax - globalMin;
      if (!this._sumUtil.restrictValueRange(grid, cells, sumMinusMin, maxMinusSum)) {
        return false;
      }

      if (globalMin == globalMax) {
        // We know the sum, and cells should always be in a single box
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

  initialize(initialGrid, cellExclusions, shape) {
    const exclusionGroups = SudokuConstraintHandler._SumHandlerUtil.findExclusionGroups(
      this._mids, cellExclusions);
    const maxGroupSize = Math.max(0, ...exclusionGroups.map(a => a.length));
    const minEndsDelta = maxGroupSize ? maxGroupSize + 1 : 0;

    this._binaryConstraint = new SudokuConstraintHandler.BinaryConstraint(
      ...this._ends,
      SudokuConstraint.Binary.fnToKey(
        (a, b) => Math.abs(a - b) >= minEndsDelta,
        shape.numValues));
    return this._binaryConstraint.initialize(initialGrid, cellExclusions, shape);
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
    this._lookupTables = null;
    this._binaryConstraint = null;
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._lookupTables = LookupTables.get(shape.numValues);

    this._binaryConstraint = new SudokuConstraintHandler.BinaryConstraint(
      ...this._ends,
      SudokuConstraint.Binary.fnToKey(
        (a, b) => Math.abs(a - b) >= this._minDiff,
        shape.numValues));
    return this._binaryConstraint.initialize(initialGrid, cellExclusions, shape);
  }

  exclusionCells() {
    return this._ends;
  }

  enforceConsistency(grid, handlerAccumulator) {
    // Constrain the ends to be consistent with each other.
    if (!this._binaryConstraint.enforceConsistency(grid, handlerAccumulator)) {
      return false;
    }
    const allValues = this._lookupTables.allValues;

    const minMax0 = this._lookupTables.minMax8Bit[
      grid[this._ends[0]]];
    const minMax1 = this._lookupTables.minMax8Bit[
      grid[this._ends[1]]];
    const min0 = minMax0 >> 8;
    const max0 = minMax0 & 0xff;
    const min1 = minMax1 >> 8;
    const max1 = minMax1 & 0xff;

    let mask = 0;
    if (min0 > max1) {
      // Case 1: cell 0 is the larger cell.
      mask |= ((1 << (max1 - 1)) - 1) | ~((1 << min0) - 1);
    } else if (min1 > max0) {
      // Case 2: cell 1 is the larger cell.
      mask |= ((1 << (max0 - 1)) - 1) | ~((1 << min1) - 1);
    } else {
      mask |= allValues;
    }
    // Constrain the mids by only allowing values that aren't locked out.
    if (allValues & ~mask) {
      for (let i = 0; i < this._mids.length; i++) {
        if (!(grid[this._mids[i]] &= mask)) return false;
      }
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
    this._lookupTables = null;
    this._cellArrays = [];
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._internalSumHandler.initialize(
      initialGrid, cellExclusions, shape);

    this._scratchGrid = initialGrid.slice();
    this._resultGrid = initialGrid.slice();
    this._lookupTables = LookupTables.get(shape.numValues);

    // Cache the partial cell arrays to make it easier to pass into the sumHandler.
    let array = [];
    for (let i = 0; i < shape.gridSize; i++) {
      array.push(this.cells.slice(0, i + 1));
      // Cache the cell lists so that the required values enforcer will find them.
      cellExclusions.cacheCellList(array[i]);
    }
    this._cellArrays = array;
    return true;
  }

  // Determine and restrict the range of acceptable values for the control cell.
  _restrictControlCell(grid) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum;
    const controlCell = this._controlCell;
    const minMaxLookup = this._lookupTables.minMax8Bit;

    let minSum = 0;
    let maxSum = 0;

    for (let i = 0; i < numCells; i++) {
      const minMax = minMaxLookup[grid[cells[i]]];
      minSum += minMax >> 8;
      maxSum += minMax & 0xff;

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

  initialize(initialGrid, cellExclusions, shape) {
    this._cellExclusions = cellExclusions;
    cellExclusions.cacheCellTuples(this.cells);

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

SudokuConstraintHandler.Quadruple = class Quadruple extends SudokuConstraintHandler {
  constructor(topLeftCell, gridSize, values) {
    // NOTE: Ordered so that the diagonals are next to each other.
    // This makes it easier to constraint repeated values (which must
    // lie on the diagonal).
    const cells = [
      topLeftCell,
      topLeftCell + gridSize + 1,
      topLeftCell + 1,
      topLeftCell + gridSize];
    super(cells);
    this.values = values;

    this.valueCounts = new Map(values.map(v => [v, 0]));
    for (const v of values) {
      this.valueCounts.set(v, this.valueCounts.get(v) + 1);
    }

    this._valueMask = LookupTables.fromValuesArray(values);
    // Repeated values is an array of masks [v_n, otherValues_n, ...]
    this._repeatedValues = [];
    for (const [value, count] of this.valueCounts) {
      if (count > 1) {
        this._repeatedValues.push(
          LookupTables.fromValue(value),
          this._valueMask & ~LookupTables.fromValue(value));
      }
    }

    this._commonUtil = SudokuConstraintHandler._CommonHandlerUtil;

    if (topLeftCell % gridSize + 1 == gridSize || topLeftCell >= gridSize * (gridSize - 1)) {
      throw ('Quadruple can not start on the last row or column.');
    }
  }

  _enforceRepeatedValues(grid, handlerAccumulator) {
    const repeatedValues = this._repeatedValues;
    const d1And = grid[this.cells[0]] & grid[this.cells[1]];
    const d2And = grid[this.cells[2]] & grid[this.cells[3]];
    for (let i = 0; i < repeatedValues.length; i += 2) {
      const value = repeatedValues[i];
      const otherValues = repeatedValues[i + 1];

      // A repeated value must lie on a diagonal.
      // If both cells in a diagonal don't contain the value, we can
      // constrain the cells.

      if (value & ~d1And) {
        const d1Or = grid[this.cells[0]] | grid[this.cells[1]];
        // Other values must be on this diagonal.
        if (otherValues & ~d1Or) return false;
        // value is not in d1. Then it must be in d2.
        if (!(grid[this.cells[2]] &= value)) return false;
        if (!(grid[this.cells[3]] &= value)) return false;
        // If the value is in one of the cells, remove it from the other.
        if (d1Or & value) {
          if (!(grid[this.cells[0]] &= ~value)) return false;
          if (!(grid[this.cells[1]] &= ~value)) return false;
        }
      } else if (value & ~d2And) {
        const d2Or = grid[this.cells[2]] | grid[this.cells[3]];
        // Other values must be on this diagonal.
        if (otherValues & ~d2Or) return false;
        // value is not in d2. Then it must be in d1.
        if (!(grid[this.cells[0]] &= value)) return false;
        if (!(grid[this.cells[1]] &= value)) return false;
        // If the value is in one of the cells, remove it from the other.
        if (d2Or & value) {
          if (!(grid[this.cells[2]] &= ~value)) return false;
          if (!(grid[this.cells[3]] &= ~value)) return false;
        }
      }
    }
  }

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;
    const valuesMask = this._valueMask;
    const hasRepeatedValues = this._repeatedValues.length > 0;

    if (hasRepeatedValues) {
      // NOTE: This must happen before the valueMask & ~fixedValues
      // check as that can return true even if all repeated values aren't
      // satisfied.
      this._enforceRepeatedValues(grid, handlerAccumulator);
    }

    let allValues = 0;
    let nonUniqueValues = 0;
    let fixedValues = 0;
    let numFixed = 0;
    for (let i = 0; i < numCells; i++) {
      let v = grid[cells[i]];
      if (!(v & (v - 1))) {
        fixedValues |= v;
        numFixed++;
      }
      nonUniqueValues |= allValues & v;
      allValues |= v;
    }

    if (valuesMask & ~allValues) return false;
    if (!(valuesMask & ~fixedValues)) return true;

    if (!hasRepeatedValues) {
      // Only check for hidden singles when we don't have a repeated value.
      const hiddenSingles = valuesMask & ~nonUniqueValues & ~fixedValues;
      if (hiddenSingles) {
        if (!this._commonUtil.exposeHiddenSingles(grid, cells, hiddenSingles)) {
          return false;
        }
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
    this._minMax8Bit = null;

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

  initialize(initialGrid, cellExclusions, shape) {
    this._minMax8Bit = LookupTables.get(shape.numValues).minMax8Bit;
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

    // Calculate stats in batches of 15 to avoid overflowing minMax8bit.
    let maxTotal = 0;
    let minTotal = 0;
    const minMax8Bit = this._minMax8Bit;
    for (let i = 0; i < numCells;) {
      let minMax = 0;
      let lim = i + 15;
      if (lim > numCells) lim = numCells;
      for (; i < lim; i++) {
        minMax += minMax8Bit[grid[cells[i]]];
      }

      maxTotal += minMax & 0xff;
      minTotal += minMax >> 8;
    }

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

  initialize(initialGrid, cellExclusions, shape) {
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
      if (!(initialGrid[clue.line[0]] &= value)) {
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
      const maxEntryV = LookupTables.maxValue(highV);
      if (LookupTables.maxValue(lowV) < maxEntryV) {
        const mask = (1 << maxEntryV) - 1;
        grid[lowEntry[i]] = (lowV &= mask & equalValuesMask);
        handlerAccumulator.addForCell(lowEntry[i]);
      }
      const minV = LookupTables.minValue(lowV);
      if (LookupTables.minValue(highV) < minV) {
        const mask = -(1 << (minV - 1));
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
}

class HandlerSet {
  constructor(handlers, shape) {
    this._allHandlers = [];
    this._seen = new Map();
    this._ordinaryIndexLookup = new Map();

    this._exclusionHandlerMap = [];
    this._ordinaryHandlerMap = [];
    this._auxHandlerMap = [];
    for (let i = 0; i < shape.numCells; i++) {
      this._ordinaryHandlerMap.push([]);
      this._auxHandlerMap.push([]);
      this._exclusionHandlerMap.push(-1);
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

  getExclusionHandlerMap() {
    return this._exclusionHandlerMap;
  }

  replace(oldHandler, newHandler) {
    newHandler.essential = oldHandler.essential;

    const index = this._allHandlers.indexOf(oldHandler);

    if (!arraysAreEqual(oldHandler.cells, newHandler.cells)) {
      this._removeOrdinary(index);
      this._addOrdinary(newHandler, index);
    } else {
      this._allHandlers[index] = newHandler;
    }
  }

  _removeOrdinary(index) {
    const handler = this._allHandlers[index];
    for (const c of handler.cells) {
      const indexInMap = this._ordinaryHandlerMap[c].indexOf(index);
      this._ordinaryHandlerMap[c].splice(indexInMap, 1);
    }
    this._allHandlers[index] = null;
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
      if (!this._addToSeen(h)) continue;
      this._addOrdinary(h);
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

  addExclusionHandlers(...handlers) {
    for (const h of handlers) {
      if (!this._addToSeen(h)) {
        throw ('Exclusion handlers must be unique');
      }

      const index = this._addToAll(h);
      this._exclusionHandlerMap[h.cells[0]] = index;
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