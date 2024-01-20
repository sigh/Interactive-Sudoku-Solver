"use strict";

class SudokuConstraintHandler {
  static _defaultId = 0;

  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
    this.cells = new Uint8Array(cells || []);

    const id = this.constructor._defaultId++;
    // By default every id is unique.
    this.idStr = this.constructor.name + '-' + id.toString();
  }

  enforceConsistency(grid, handlerAccumulator) {
    return true;
  }

  exclusionCells() {
    return [];
  }

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
    exclusionCells = exclusionCells.slice();
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

  static enforceRequiredValueExclusions(grid, cells, value, cellExclusions) {
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
        if (!(grid[exclusionCells[i]] &= ~value)) return false;
      }
    }

    return true;
  }
}

SudokuConstraintHandler.House = class House extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._exposeHiddenSingles = SudokuConstraintHandler._CommonHandlerUtil.exposeHiddenSingles;
    this._shape = null;
    this._lookupTables = null;
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._shape = shape;
    this._lookupTables = LookupTables.get(shape.numValues);

    return true;
  }

  static _seenPairs = new Uint16Array(SHAPE_MAX.numValues);
  static _pairLocations = new Uint16Array(SHAPE_MAX.numValues);

  _enforceNakedPairs(grid, cells) {
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
      if (!this._exposeHiddenSingles(grid, cells, hiddenSingles)) {
        return false;
      }
      fixedValues |= hiddenSingles;
    }

    // Check for naked pairs.
    // We won't have anything useful to do unless we have at least 2 free cells.
    if (numCells - countOnes16bit(fixedValues) <= 2) return true;

    return this._enforceNakedPairs(grid, cells);
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
    this._exposeHiddenSingles = null;
    this._cellExclusions = null;

    this._enforceRequiredValueExclusions = (
      SudokuConstraintHandler._CommonHandlerUtil.enforceRequiredValueExclusions);

    // Ensure we dedupe binary constraints.
    this.idStr = [this.constructor.name, key, ...cells].join('-');
  }

  enableHiddenSingles() {
    this._exposeHiddenSingles = SudokuConstraintHandler._CommonHandlerUtil.exposeHiddenSingles;
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

  _enforceRequiredValues(grid, cells, requiredValues) {
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
    if (this._exposeHiddenSingles) {
      const hiddenSingles = requiredValues & ~nonUniqueValues & ~fixedValues;
      if (hiddenSingles) {
        if (!this._exposeHiddenSingles(grid, cells, hiddenSingles)) {
          return false;
        }
      }
    }

    // Loop through and enforce all the non-unique required values.
    let nonUniqueRequired = requiredValues & nonUniqueValues;
    while (nonUniqueRequired) {
      let v = nonUniqueRequired & -nonUniqueRequired;
      nonUniqueRequired ^= v;
      if (!this._enforceRequiredValueExclusions(
        grid, cells, v, this._cellExclusions)) return false;
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
    for (let i = 0; i < numCells; i++) {
      allValues |= grid[cells[i]];
    }

    // Filter out values which aren't in any valid combination.
    const validCombinationInfo = this._validCombinationInfo[allValues];
    const validValues = validCombinationInfo & 0xffff;
    if (!validValues) return false;
    if (validValues != allValues) {
      for (let i = 0; i < numCells; i++) {
        if (!(grid[cells[i]] &= validValues)) return false;
      }
    }

    // Enforce any required values that exist (values in every valid
    // combination).
    const requiredValues = (validCombinationInfo >> 16) & 0xffff;
    if (requiredValues) {
      if (!this._enforceRequiredValues(grid, cells, requiredValues)) {
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
    this._exposeHiddenSingles = SudokuConstraintHandler._CommonHandlerUtil.exposeHiddenSingles;

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
    let unassignedCells = new Set(cells)

    while (unassignedCells.size > 0) {
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
          unassignedCells.delete(unassignedCell);
        }
      }
      exclusionGroups.push(currentGroup);
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

  restrictCellsSingleExclusionGroup(grid, sum, cells, cellExclusions) {
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
      if (!this._exposeHiddenSingles(grid, cells, hiddenSingles)) {
        return false;
      }
    }

    // Only enforce required value exclusions if we have pairwise exclusions
    // passed in.
    if (!cellExclusions) return true;

    let nonUniqueRequired = requiredValues & nonUniqueValues;
    while (nonUniqueRequired) {
      let v = nonUniqueRequired & -nonUniqueRequired;
      nonUniqueRequired ^= v;
      if (!SudokuConstraintHandler._CommonHandlerUtil.enforceRequiredValueExclusions(
        grid, cells, v, cellExclusions)) {
        return false;
      }
    }

    return true;
  }

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMins = new Uint16Array(SHAPE_MAX.numValues);
  static _seenMaxs = new Uint16Array(SHAPE_MAX.numValues);

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
  static _cellBuffer = new Uint8Array(SHAPE_MAX.numValues);

  // Determines if enforceFewRemainingCells() can be run.
  hasFewRemainingCells(numUnfixed) {
    return numUnfixed <= (this._pairwiseSums ? 3 : 2);
  }

  // Solve small cases exactly and efficiently.
  // Call hasFewRemainingCells() to determine if it can be run.
  // REQUIRES that:
  //  - The number of unfixed cells is accurate.
  //  - None of the values are zero.
  enforceFewRemainingCells(grid, targetSum, numUnfixed, cells, exclusionIndexes) {
    const cellBuffer = this.constructor._cellBuffer;
    const valueBuffer = this.constructor._valueBuffer;
    const exclusionIndexesBuffer = this.constructor._exclusionIndexesBuffer;

    const gridSize = this._numValues | 0;

    let j = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
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
  _exclusionGroups;
  _exclusionIndexes;
  _cellExclusions = null;
  _sum;
  _complementCells;
  _positiveCells = [];
  _negativeCells = [];

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

    if (this.cells.length > this._lookupTables.MAX_CELLS_IN_SUM) {
      // This isn't an invalid grid,
      // we just can't handle it because rangeInfo might overflow.
      throw ('Number of cells in the sum' +
        `can't exceed ${this._lookupTables.MAX_CELLS_IN_SUM}`);
    }

    this._util = SudokuConstraintHandler._SumHandlerUtil.get(shape.numValues);

    this._exclusionGroups = (
      SudokuConstraintHandler._SumHandlerUtil.findExclusionGroups(
        this._positiveCells, cellExclusions));
    if (this._negativeCells.length) {
      this._exclusionGroups.push(
        ...SudokuConstraintHandler._SumHandlerUtil.findExclusionGroups(
          this._negativeCells, cellExclusions));
    }

    this._exclusionIndexes = new Uint8Array(this.cells.length);
    this._exclusionGroups.forEach(
      (s, i) => s.forEach(
        c => this._exclusionIndexes[this.cells.indexOf(c)] = i));

    if (!this._negativeCells.length) {
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

  _enforceCombinationsWithComplement(grid) {
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

    const cageSums = this._util.killerCageSums[set0.length][sum];
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
        if (!(grid[set0[i]] &= ~valuesToRemove0)) return false;
      }
    }
    const valuesToRemove1 = values1 & ~possibilities1;
    if (valuesToRemove1) {
      for (let i = 0; i < set1.length; i++) {
        if (!(grid[set1[i]] &= ~valuesToRemove1)) return false;
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

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    const rangeInfo = this._lookupTables.rangeInfo;
    let rangeInfoSum = 0;
    for (let i = 0; i < numCells; i++) {
      rangeInfoSum += rangeInfo[grid[cells[i]]];
    }

    let maxSum = rangeInfoSum & 0xff;
    let minSum = (rangeInfoSum >> 8) & 0xff;

    if (maxSum === 0) {
      // This can only happen if there are 16 16s. This is rare, so special
      // handling is fine.
      maxSum = 1 << 8;
      minSum -= 1;
      // If both minSum and maxSum are 0, then we have a fixed list of 16s.
      // So just return if the sum is equal.
      if (minSum == 0) return sum === 1 << 8;
    }

    // It is impossible to make the target sum.
    if (sum < minSum || maxSum < sum) return false;
    // We've reached the target sum exactly.
    // NOTE: Uniqueness constraint is already enforced by the solver via
    //       exclusionCells.
    if (minSum == maxSum) return true;

    const numUnfixed = numCells - (rangeInfoSum >> 24);
    // A large fixed value indicates a cell has a 0, hence is already
    // unsatisfiable.
    if (numUnfixed < 0) return false;

    const hasFewUnfixed = this._util.hasFewRemainingCells(numUnfixed);

    if (hasFewUnfixed) {
      // If there are few remaining cells then handle them explicitly.
      const fixedSum = (rangeInfoSum >> 16) & 0xff;
      const targetSum = sum - fixedSum;
      if (!this._util.enforceFewRemainingCells(grid, targetSum, numUnfixed, this.cells, this._exclusionIndexes)) {
        return false;
      }
    } else {
      // Restrict the possible range of values in each cell based on whether they
      // will cause the sum to be too large or too small.
      if (sum - minSum < gridSize || maxSum - sum < gridSize) {
        if (!this._util.restrictValueRange(grid, cells,
          sum - minSum, maxSum - sum)) {
          return false;
        }
      }
    }

    if (this._complementCells !== null) {
      return this._enforceCombinationsWithComplement(grid);
    }

    // If enforceFewRemainingCells has run, then we've already done all we can.
    if (hasFewUnfixed) return true;

    if (this._exclusionGroups.length == 1) {
      if (!this._util.restrictCellsSingleExclusionGroup(
        grid, this._sum, cells, this._cellExclusions)) return false;
    } else {
      if (!this._util.restrictCellsMultiExclusionGroups(
        grid, sum, this._exclusionGroups, 0)) return false;
    }

    return true;
  }
}

// SumWithNegative allows one cell in the sum to be negative.
// We can easily extend this class to multiple cells, but it hasn't shown to
// provide any benefit.
//
// How this works
// --------------
// The initial constraint is:
//   a1+a2+...+an - b = s
// If we reverse the bitset for `b`, then we get the value:
//   B = N+1 - b where `N` is the number of values.
// This gives a new constraint which is a sum of positives:
//   a1+a2+...+an + B = s + N+1;
// Thus we can reverse `b` then use the Sum handler with the updated sum.
//
// Note that `B` is still a value in the same range as `b`, so the Sum handler
// does not need to be made more general.
SudokuConstraintHandler.SumWithNegative = class SumWithNegative extends SudokuConstraintHandler.Sum {
  constructor(positiveCells, negativeCell, sum) {
    positiveCells = positiveCells.slice();
    positiveCells.sort((a, b) => a - b);
    super([...positiveCells, negativeCell], sum);

    this._positiveCells = positiveCells;
    this._negativeCells = [negativeCell];
    this._negativeCell = negativeCell;
    this._exclusionGroups = null;

    // IMPORTANT: Complement cells don't work for this currently, because
    // we can't guarantee that reversed negativeCells is a unique value.
    // This will stop anyone adding them.
    this._complementCells = null;
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._sum += shape.numValues + 1;
    return super.initialize(initialGrid, cellExclusions, shape);
  }

  setComplementCells() { }

  enforceConsistency(grid, handlerAccumulator) {
    const reverse = this._lookupTables.reverse;
    grid[this._negativeCell] = reverse[grid[this._negativeCell]];

    const result = super.enforceConsistency(grid, handlerAccumulator);

    // Reverse the value back even if we fail to make the output and debugging
    // easier.
    grid[this._negativeCell] = reverse[grid[this._negativeCell]];

    return result;
  }
}

SudokuConstraintHandler.Skyscraper = class Skyscraper extends SudokuConstraintHandler {
  constructor(cells, numVisible) {
    super(cells);
    this._numVisible = +numVisible;

    if (0 >= this._numVisible) {
      throw ('Skyscraper visibility target must be > 0');
    }
  }

  initialize(initialGrid, cellExclusions, shape) {
    const cells = this.cells;
    const lookupTables = LookupTables.get(shape.numValues);
    this._lookupTables = lookupTables;
    this._maxHeight = shape.numValues;

    // Check that all cells are unique.
    for (let i = 0; i < cells.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!cellExclusions.isMutuallyExclusive(cells[i], cells[j])) {
          throw ('Skyscraper handler requires all cells to be distinct.');
        }
      }
    }

    return true;
  }

  // Set up temporary storage for states.
  static _statesBuffer = (() => {
    let states = [];
    for (let i = 0; i < SHAPE_MAX.numValues; i++) {
      states.push({
        minVisible: 0,
        maxVisible: 0,
        currentHeightForMin: 0,
        currentHeightForMax: 0,
      });
    }
    return states;
  })();

  enforceConsistency(grid, handlerAccumulator) {
    const cells = this.cells;
    const maxHeight = this._maxHeight;
    const maxHeightValue = LookupTables.fromValue(maxHeight);
    const target = this._numVisible;
    const states = this.constructor._statesBuffer;

    // Pass 1a (forward pass - part a)
    //  - Calculate min/max visibility state at each index.
    //  - Constraint values which would cause minVisibility to be too high.
    // It continues until we reach the first viable max-height cell.
    let currentHeightForMax = 0;
    let currentHeightForMin = 0;
    // Track whether there are cells with small values which might be pruned.
    // This is used to determine if we should run the backward pass.
    let hasSmallerValues = 0;
    // Start minVisible and maxVisible at 1, to avoid explicitly counting
    // the max-height cell.
    let maxVisible = 1;
    let minVisible = 1;
    let index = 0;
    let startAllFixed = true;
    for (; index < cells.length; index++) {
      let v = grid[cells[index]];

      if (v & maxHeightValue) {
        v ^= maxHeightValue;
        // We found our first max-height cell.
        if (maxVisible >= target) {
          if (v) hasSmallerValues = true;
          break;
        }

        // Otherwise max-height is not a valid value.
        if (!(grid[cells[index]] = v)) {
          return false;
        }
      }

      // If we are already at the target for minVisible then we can't increase
      // it anymore.
      if (minVisible === target) {
        const mask = LookupTables.fromValue(currentHeightForMin) - 1;
        if (!(grid[cells[index]] &= mask)) {
          return false;
        }
      }

      const minMax = this._lookupTables.minMax8Bit[grid[cells[index]]];
      const min = minMax >> 8;
      const max = minMax & 0xff;
      if (min != max) startAllFixed = false;

      // If there are any values larger than currentHeightForMax then we can use
      // this cell to increase visibility.
      if (max > currentHeightForMax) {
        maxVisible++;
        if (min > currentHeightForMax) {
          // If the min is larger, then visibility forced anyway, and the min
          // leaves us with the most leeway.
          currentHeightForMax = min;
        } else {
          // If min is not larger, then we can only increment
          // currentHeightForMax.
          // A previous or future cell to be used to get a lower height than
          // the values just in this cell.
          currentHeightForMax++;
          hasSmallerValues = true;
        }
      }

      // currentHeightForMin is the max of all values that we've seen.
      // If the min is greater than currentHeightForMin then this cell must be
      // visible. Even if min is equal, then we must still use this cell
      // as it must be distinct from the previous currentHeightForMin.
      if (min >= currentHeightForMin) minVisible++;
      // Even if we don't use this cell, we must update the currentHeightForMin
      // because it may be the case that we could have used this cell rather
      // than the previous max.
      if (max > currentHeightForMin) currentHeightForMin = max;

      {
        // Save the states for the backward pass.
        const state = states[index];
        state.minVisible = minVisible;
        state.maxVisible = maxVisible;
        state.currentHeightForMin = currentHeightForMin;
        state.currentHeightForMax = currentHeightForMax;
      }
    }

    // If we didn't find any max-height cells, then the constraint is not valid.
    // Similarly if minVisible was already too high when we reached the target.
    if (index == cells.length || minVisible > target) return false;

    // Pass 1b (forward pass - part b)
    //  - Find all valid max-height cells and remove the max-height value from
    //    the rest.
    const firstMaxHeightIndex = index;
    let lastMaxHeightIndex = index;
    for (; index < cells.length; index++) {
      // If minVisible is already too high, then just keep clearing the
      // max-height value without any other processing.
      if (minVisible > target) {
        if (!(grid[cells[index]] &= ~maxHeightValue)) return false;
        continue;
      }

      const v = grid[cells[index]];
      const minMax = this._lookupTables.minMax8Bit[v];
      const min = minMax >> 8;
      let max = minMax & 0xff;

      if (max == maxHeight) {
        lastMaxHeightIndex = index;
        // If this max-height is the only valid value then the rest of the cells
        // can't be max-height.
        if (min == maxHeight) break;
        // Exclude the max-height from the minVisible calculation.
        max = LookupTables.maxValue(v ^ maxHeightValue);
      }

      // Update minVisible as in the first part of the forward pass.
      if (min >= currentHeightForMin) minVisible++;
      if (max > currentHeightForMin) currentHeightForMin = max;
    }

    // If all the initial values are fixed don't both running anymore passes.
    if (startAllFixed) return true;

    // Pass 2 (backward pass)
    // Given knowledge of the last max-height cell, restrict the maximum values
    // of cells if they don't leave enough space to reach the target.
    // NOTE: This covers the naive initialization of the constraint where
    // high values are removed from the first cells.
    {
      // `valuesUntilLastMaxHeight` tells us which values are available to help
      // increase the visibility.
      let valuesUntilLastMaxHeight = 0;
      for (index = lastMaxHeightIndex - 1; index >= firstMaxHeightIndex; index--) {
        valuesUntilLastMaxHeight |= grid[cells[index]];
      }
      valuesUntilLastMaxHeight &= ~maxHeightValue;

      // These variables are incrementally updated to ensure the
      // calculation is linear-time.
      // - `minForbiddenValue` is the smallest value which is forbidden as it
      // prevent us reaching the target visibility.
      // - `forbiddenCount` is the number of values which are forbidden.
      let minForbiddenValue = maxHeightValue;
      let forbiddenCount = 0;

      for (; index >= 0; index--) {
        const state = states[index];

        let shortfall = target - state.maxVisible;
        if (shortfall > 0) {
          // Accumulate forbidden values until we have enough to cover the
          // shortfall.
          while (forbiddenCount < shortfall && minForbiddenValue > 1) {
            minForbiddenValue >>= 1;
            if (valuesUntilLastMaxHeight & minForbiddenValue) {
              forbiddenCount++;
            }
          }

          // `minForbiddenValue - 1` creates a mask of all values below
          // the forbidden value.
          if (!(grid[cells[index]] &= minForbiddenValue - 1)) {
            return false;
          }
        }
        valuesUntilLastMaxHeight |= grid[cells[index]];
      }
    }

    // We only need to do the backward pass if the cells which must be visible
    // had smaller values which might be constrained.
    if (!hasSmallerValues) return true;

    // Pass 3 (backward pass)
    // Determines which cells *must* be visible, and we can remove values
    // which would prevent that.
    //  - Attempts to reduce the checks to sub-problems when we know
    //    a cell is forced to be visible.
    //  - Constrains the minimum values of cells, unlike the forward pass
    //    which constrained the maximum values.
    //  - Only constrains up to the first max-height cell because after
    //    that the cells could potentially take any value.
    //  - Still constrains the first max-height cell, because it is either
    //    max-height or it must be valid for a later max-height.
    //  - Doesn't constrain the first cell because its minimum is never
    //    restricted.
    let subMaxHeight = maxHeight;
    let lastSubMaxHeightIndex = lastMaxHeightIndex;
    let subTarget = target;
    for (let i = firstMaxHeightIndex; i > 0; i--) {
      const state = states[i - 1];

      // Check if we any leeway to reach the current subTarget before we
      // reach the sub-max-height cell.
      // If not then we must force this cell to be visible.
      const cellsRemaining = lastSubMaxHeightIndex - i;
      const visRemaining = subTarget - state.maxVisible;
      if (visRemaining == cellsRemaining) {
        // Constrain this cell to be above the current minimum height for
        // maximum visibility.
        const minHeight = state.currentHeightForMax;
        const mask = ~(LookupTables.fromValue(minHeight + 1) - 1);
        if (!(grid[cells[i]] &= mask)) {
          return false;
        }
      }

      // Check if this cell is always visible.
      // If so then we can make this the new subTarget.
      const v = grid[cells[i]];
      const cellMin = LookupTables.minValue(v);
      if (cellMin > state.currentHeightForMin) {
        // We need to err on the side of reducing subTarget by at least as much
        // as required (err on the side of smaller subTarget).
        // However, we can take the minimum of two conservative estimates:
        //  - The number of cells since the last subTarget
        //    (assuming all of them would be visible).
        //  - The number of heights to to the last subTarget
        //    (assuming all of them are used). We must use cellMin, since this
        //    is the worst case.
        const heightDelta = subMaxHeight - cellMin;
        const indexDelta = lastSubMaxHeightIndex - i;
        const targetReduction = (
          heightDelta < indexDelta ? heightDelta : indexDelta);
        subTarget -= targetReduction;
        if (subTarget < 0) break;

        const cellMax = LookupTables.maxValue(v);
        subMaxHeight = cellMax;
        lastSubMaxHeightIndex = i;
      }
    }

    return true;
  }
}

SudokuConstraintHandler.Sandwich = class Sandwich extends SudokuConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
  }

  initialize(initialGrid, cellExclusions, shape) {
    // Sanity check.
    if (this.cells.length != shape.numValues) return false;
    // Check that the sum is feasible.
    const sum = this._sum;
    if (!Number.isInteger(sum) || sum < 0 || sum > this.constructor._maxSum(shape)) {
      return false;
    }

    const lookupTables = LookupTables.get(shape.numValues);

    this._gridSize = shape.gridSize;
    this._borderMask = SudokuConstraintHandler.Sandwich._borderMask(shape);
    this._valueMask = ~this._borderMask & lookupTables.allValues;
    this._minMax8Bit = lookupTables.minMax8Bit;

    this._distances = SudokuConstraintHandler.Sandwich._distanceRange(shape)[sum];
    this._combinations = SudokuConstraintHandler.Sandwich._combinations(shape)[sum];

    return true;
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
    const cells = this.cells;
    const borderMask = this._borderMask | 0;
    const numCells = this.cells.length;

    // Cache the grid values for faster lookup.
    let values = SudokuConstraintHandler.Sandwich._cellValues;
    let numBorders = 0;
    for (let i = 0; i < numCells; i++) {
      let v = values[i] = grid[cells[i]];
      if (v & borderMask) numBorders++;
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
        // NOTE: 8 bits is fine here because we can have at most (numValues-2) cells.
        // For 16x16, 16*14 = 224 < 8 bits.
        minMaxSum += this._minMax8Bit[values[i]];
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

    // Build up a set of valid cell values.
    let validSettings = SudokuConstraintHandler.Sandwich._validSettings;
    validSettings.fill(0);

    // Iterate over each possible starting index for the first sentinel.
    // Check if the other values are consistent with the required sum.
    // Given that the values must form a house, this is sufficient to ensure
    // that the constraint is fully satisfied.
    const valueMask = this._valueMask;
    const [minDist, maxDist] = this._distances;
    const maxIndex = numCells - minDist;
    const shift = numCells - 1;
    let prefixValues = 0;
    let pPrefix = 0;
    for (let i = 0; i < maxIndex; i++) {
      let v = values[i];
      // If we don't have a sentinel, move onto the next index.
      if (!(v &= borderMask)) continue;
      // Determine what the matching sentinel value needs to be.
      const vRev = borderMask & ((v >> shift) | (v << shift));

      // For each possible gap:
      //  - Determine the currently possible values inside the gap.
      //  - Find every valid combination that can be made from these values.
      //  - Use them to determine the possible inside and outside values.
      let innerValues = 0;
      let pInner = i + 1;
      for (let j = i + minDist; j <= i + maxDist && j < numCells; j++) {
        if (!(values[j] & vRev)) continue;

        while (pInner < j) innerValues |= values[pInner++];
        while (pPrefix < i) prefixValues |= values[pPrefix++];
        let outerValues = prefixValues;
        for (let k = pInner + 1; k < numCells; k++) outerValues |= values[k];

        let combinations = this._combinations[j - i];
        let innerPossibilities = 0;
        let outerPossibilities = 0;
        for (let k = 0; k < combinations.length; k++) {
          let c = combinations[k];
          // Check if the inner values can create the combination, and the
          // outer values can create the complement.
          if (!((~innerValues & c) | (~outerValues & ~c & valueMask))) {
            innerPossibilities |= c;
            outerPossibilities |= ~c;
          }
        }
        outerPossibilities &= valueMask;
        // If we have either innerPossibilities or outerPossibilities it means
        // we have at least one valid setting. Either maybe empty if there
        // are 0 cells in the inner or outer range.
        if (innerPossibilities || outerPossibilities) {
          let k = 0;
          while (k < i) validSettings[k++] |= outerPossibilities;
          validSettings[k++] |= v;
          while (k < j) validSettings[k++] |= innerPossibilities;
          validSettings[k++] |= vRev;
          while (k < numCells) validSettings[k++] |= outerPossibilities;
        }
      }
    }

    for (let i = 0; i < numCells; i++) {
      if (!(grid[cells[i]] &= validSettings[i])) return false;
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
    cells0 = cells0.slice();
    cells1 = cells1.slice();

    cells0.sort((a, b) => a - b);
    cells1.sort((a, b) => a - b);
    super([...cells0, ...cells1]);
    if (cells0.length != cells1.length) {
      // Throw, because same values are only created by our code.
      throw ('SameValues must use sets of the same length.');
    }

    this._cells0 = new Uint8Array(cells0);
    this._cells1 = new Uint8Array(cells1);
    // TODO: Figure out automatically.
    this._isUnique = isUnique;

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
        if (!(grid[cells0[i]] &= values)) return false;
      }
    }
    if (values1 !== values) {
      for (let i = numCells - 1; i >= 0; i--) {
        if (!(grid[cells1[i]] &= values)) return false;
      }
    }

    return true;
  }
}

SudokuConstraintHandler.RegionSumLine = class RegionSumLine extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
  }

  initialize(initialGrid, cellExclusions, shape) {
    // Map cells to box regions.
    const cellToBox = new Map();
    for (const boxRegion of SudokuConstraint.boxRegions(shape)) {
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

    this._util = SudokuConstraintHandler._SumHandlerUtil.get(shape.numValues);
    const lookupTables = LookupTables.get(shape.numValues);
    this._minMax8Bit = lookupTables.minMax8Bit;

    // Separate the single- and multi-cell sections.
    this._singles = cellSets.filter(s => s.length == 1).map(s => s[0]);
    this._multi = cellSets.filter(s => s.length > 1);
    this._minMaxCache = new Uint16Array(this._multi.length);

    this._arrows = [];
    if (this._singles.length > 0) {
      // If we have any singles then we can solve every multi-cell
      // area by treating it as the stem of an arrow.
      const single = this._singles[0];
      for (const cells of this._multi) {
        const arrow = new SudokuConstraintHandler.SumWithNegative(
          cells, single, 0);
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
      if (!this._util.restrictValueRange(grid, cells, sumMinusMin, maxMinusSum)) {
        return false;
      }

      if (globalMin == globalMax) {
        // We know the sum, and cells should always be in a single box
        // (by definition).
        if (!this._util.restrictCellsSingleExclusionGroup(
          grid, globalMin, cells, null)) return false;
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
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._minMax8Bit = LookupTables.get(shape.numValues).minMax8Bit;

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
    let minMax = this._minMax8Bit[endsCombined];
    const endsMin = minMax >> 8;
    const endsMax = minMax & 0xff;
    const delta = endsMax - endsMin;

    // Constrain the mids by masking out any values that can never be between
    // the ends.
    let mask = ((1 << (delta - 1)) - 1) << endsMin;
    let fixedValues = 0;
    for (let i = 0; i < this._mids.length; i++) {
      const v = (grid[this._mids[i]] &= mask);
      if (!v) return false;
      fixedValues |= (!(v & (v - 1))) * v;
    }

    // Constrain the ends by masking out anything which rules out one of the
    // mids.
    if (fixedValues) {
      minMax = this._minMax8Bit[fixedValues];
      const cellMin = minMax >> 8;
      const cellMax = minMax & 0xff;
      mask = ~(((1 << (cellMax - cellMin + 1)) - 1) << (cellMin - 1));
      if (!(grid[this._ends[0]] &= mask)) return false;
      if (!(grid[this._ends[1]] &= mask)) return false;
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
  }

  initialize(initialGrid, cellExclusions, shape) {
    this._internalSumHandler.initialize(
      initialGrid, cellExclusions, shape);
    // X-Sum messes with the cell-length, so _pairwiseExclusions won't be accurate.
    // TODO: Make this robust and less error-prone.
    this._internalSumHandler._pairwiseExclusions = null;

    this._scratchGrid = initialGrid.slice();
    this._resultGrid = initialGrid.slice();
    this._lookupTables = LookupTables.get(shape.numValues);

    // Cache the partial cell arrays to make it easier to pass into the sumHandler.
    let array = [];
    for (let i = 0; i < shape.gridSize; i++) {
      array.push(this.cells.slice(0, i + 1));
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
      // NOTE: We can uniqueness to restrict this even more.

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
      if (sumHandler.enforceConsistency(scratchGrid, handlerAccumulator)) {
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

    this._enforceRequiredValueExclusions = (
      SudokuConstraintHandler._CommonHandlerUtil.enforceRequiredValueExclusions);
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

  _enforceRequiredValues(grid) {
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
      if (!this._enforceRequiredValueExclusions(
        grid, cells, triadValue, this._cellExclusions)) return false;
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

    return this._enforceRequiredValues(grid);
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

    this._exposeHiddenSingles = SudokuConstraintHandler._CommonHandlerUtil.exposeHiddenSingles;

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
        if (!this._exposeHiddenSingles(grid, cells, hiddenSingles)) {
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

class HandlerSet {
  constructor(handlers, shape) {
    this._handlers = [];
    this._seen = new Set();
    this._indexLookup = new Map();

    this._auxHandlers = [];

    this._cellMap = [];
    this._auxHandlerLookup = [];
    for (let i = 0; i < shape.numCells; i++) {
      this._cellMap.push([]);
      this._auxHandlerLookup.push([]);
    }

    this.add(...handlers);
  }

  getAllofType(type) {
    return this._handlers.filter(h => h.constructor === type);
  }

  getAll() {
    return this._handlers;
  }

  getAux() {
    return this._auxHandlers;
  }

  lookupAux(cell) {
    return this._auxHandlerLookup[cell];
  }

  getCellMap() {
    return this._cellMap;
  }

  getIntersectingIndexes(handler) {
    const handlerIndex = this._indexLookup.get(handler);
    const intersectingHandlers = new Set();
    for (const c of handler.cells) {
      this._cellMap[c].forEach(i => intersectingHandlers.add(i));
    }
    intersectingHandlers.delete(handlerIndex);
    return intersectingHandlers;
  }

  getIndex(handler) {
    return this._indexLookup.get(handler);
  }

  getHandler(index) {
    return this._handlers[index];
  }

  replace(oldHandler, newHandler) {
    const index = this._handlers.indexOf(oldHandler);

    if (!arraysAreEqual(oldHandler.cells, newHandler.cells)) {
      this._remove(index);
      this._add(newHandler, index);
    } else {
      this._handlers[index] = newHandler;
    }
  }

  _remove(index) {
    const handler = this._handlers[index];
    for (const c of handler.cells) {
      const indexInMap = this._cellMap[c].indexOf(index);
      this._cellMap[c].splice(indexInMap, 1);
    }
    this._handlers[index] = null;
  }

  _add(handler, index) {
    handler.cells.forEach(c => this._cellMap[c].push(index));
    this._handlers[index] = handler;
    this._indexLookup.set(handler, index);
  }

  add(...handlers) {
    for (const h of handlers) {
      // Don't add duplicate handlers.
      if (this._seen.has(h.idStr)) {
        continue;
      }
      this._seen.add(h.idStr);

      this._add(h, this._handlers.length);
    }
  }

  addAux(...handlers) {
    for (const h of handlers) {
      // Don't add duplicate handlers.
      if (this._seen.has(h.idStr)) {
        continue;
      }
      this._seen.add(h.idStr);

      this._addAux(h);
    }
  }

  _addAux(handler) {
    this._auxHandlers.push(handler);
    handler.cells.forEach(
      c => this._auxHandlerLookup[c].push(handler));
  }

  [Symbol.iterator]() {
    return this._handlers[Symbol.iterator]();
  }
}