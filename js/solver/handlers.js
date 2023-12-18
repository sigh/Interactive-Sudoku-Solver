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

  enforceConsistency(grid, cellAccumulator) {
    return true;
  }

  conflictSet() {
    return [];
  }

  initialize(initialGrid, cellConflicts, shape) {
    return true;
  }

  priority() {
    // By default, constraints which constrain more cells have higher priority.
    return this.cells.length;
  }
}

SudokuConstraintHandler.NoBoxes = class NoBoxes extends SudokuConstraintHandler { }

SudokuConstraintHandler.False = class False extends SudokuConstraintHandler {
  constructor(cells) {
    // The cells with which to associate the failure.
    super(cells);

    if (cells.length === 0) throw 'False needs cells to be effective.';
  }

  initialize(initialGrid, cellConflicts, shape) {
    return false;
  }
  enforceConsistency(grid, cellAccumulator) { return false; }
}

SudokuConstraintHandler.FixedCells = class FixedCells extends SudokuConstraintHandler {
  constructor(valueMap) {
    super();
    this._valueMap = valueMap;
  }

  initialize(initialGrid) {
    for (const [cell, value] of this._valueMap) {
      initialGrid[cell] &= LookupTables.fromValue(value);
    }

    return true;
  }
}

SudokuConstraintHandler.AllDifferent = class AllDifferent extends SudokuConstraintHandler {
  constructor(conflictCells) {
    super();
    conflictCells.sort((a, b) => a - b);
    this._conflictCells = conflictCells;
  }

  initialize(initialGrid, cellConflicts, shape) {
    return this._conflictCells.length <= shape.numValues;
  }

  conflictSet() {
    return this._conflictCells;
  }
}

SudokuConstraintHandler.House = class House extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
  }

  initialize(initialGrid, cellConflicts, shape) {
    this._shape = shape;
    this._lookupTables = LookupTables.get(shape.numValues);

    return true;
  }

  enforceConsistency(grid) {
    const cells = this.cells;
    const gridSize = this._shape.gridSize;

    let allValues = 0;
    let nonUniqueValues = 0;
    let fixedValues = 0;
    for (let i = 0; i < gridSize; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v;  // Better than branching.
    }

    if (allValues != this._lookupTables.allValues) return false;
    if (fixedValues == this._lookupTables.allValues) return true;

    let uniqueValues = allValues & ~nonUniqueValues & ~fixedValues;
    if (uniqueValues) {
      // We have hidden singles. Find and constrain them.
      for (let i = 0; i < gridSize; i++) {
        let cell = cells[i];
        let value = grid[cell] & uniqueValues;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value & (value - 1)) return false;
          grid[cell] = value;
          if (!(uniqueValues &= ~value)) break;
        }
      }
    }

    // Check for naked pairs.

    // We won't have anything useful to do unless we have at least 2 free cells.
    if (gridSize - countOnes16bit(fixedValues) <= 2) return true;

    for (let i = 0; i < gridSize - 1; i++) {
      const v = grid[cells[i]];
      if (countOnes16bit(v) != 2) continue;
      for (let j = i + 1; j < gridSize; j++) {
        if (grid[cells[j]] !== v) continue;
        // Found a pair, remove it from all other entries.
        for (let k = 0; k < gridSize; k++) {
          if (k != i && k != j) {
            if (!(grid[cells[k]] &= ~v)) return false;
          }
        }
      }
    }

    return true;
  }

  conflictSet() {
    return this.cells;
  }
}

SudokuConstraintHandler.BinaryConstraint = class BinaryConstraint extends SudokuConstraintHandler {
  constructor(cell1, cell2, fn) {
    super([cell1, cell2]);
    this._fn = fn;
    this._tables = null;
  }

  initialize(initialGrid, cellConflicts, shape) {
    const lookupTables = LookupTables.get(shape.numValues);
    const fn = this._fn;
    this._fn = null;
    this._tables = [
      lookupTables.forBinaryFunction(fn),
      lookupTables.forBinaryFunction((a, b) => fn(b, a)),
    ];

    // If no values are legal at the start, then this constraint is invalid.
    return this._tables[0][lookupTables.allValues] !== 0;
  }

  enforceConsistency(grid, cellAccumulator) {
    const v0 = grid[this.cells[0]];
    const v1 = grid[this.cells[1]];

    const v0New = grid[this.cells[0]] = v0 & this._tables[1][v1];
    const v1New = grid[this.cells[1]] = v1 & this._tables[0][v0];

    if (!(v0New && v1New)) return false;
    if (v0 != v0New) cellAccumulator.add(this.cells[0]);
    if (v1 != v1New) cellAccumulator.add(this.cells[1]);
    return true;
  }
}

SudokuConstraintHandler.AllContiguous = class AllContiguous extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
  }

  conflictSet() {
    return this.cells;
  }

  enforceConsistency(grid, cellAccumulator) {
    const cells = this.cells;
    const numCells = cells.length;

    let values = 0;
    for (let i = 0; i < numCells; i++) {
      values |= grid[cells[i]];
    }

    // Find the possible starting values of contiguous ranges.
    let squishedValues = values;
    for (let i = 1; i < numCells; i++) {
      squishedValues &= values >> i;
    }
    if (!squishedValues) return false;

    // Expand out possible contiguous ranges.
    let mask = squishedValues;
    for (let i = 1; i < numCells; i++) {
      mask |= squishedValues << i;
    }

    if (values & ~mask) {
      // If there are values outside the mask, remove them.
      for (let i = 0; i < numCells; i++) {
        if (!(grid[cells[i]] &= mask)) {
          return false;
        }
        cellAccumulator.add(cells[i]);
      }
    }

    return true;
  }
}

class SumHandlerUtil {

  static get = memoize((numValues) => {
    return new SumHandlerUtil(true, numValues);
  });

  static maxCageSum(numValues) {
    return numValues * (numValues + 1) / 2;
  }

  constructor(do_not_call, numValues) {
    if (!do_not_call) throw ('Use SumHandlerUtil.get(shape.numValues)');

    this._numValues = numValues;
    this._lookupTables = LookupTables.get(numValues);

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

  static findConflictSets(cells, cellConflicts) {
    let conflictSets = [];
    let unassignedCells = new Set(cells)

    while (unassignedCells.size > 0) {
      let currentSet = [];
      for (const unassignedCell of unassignedCells) {
        // Determine if this cell is in a conflict set with every cell in the
        // current set. If so, then add it to the current set.
        let addToCurrentSet = true;
        for (const conflictCell of currentSet) {
          if (!cellConflicts[unassignedCell].has(conflictCell)) {
            addToCurrentSet = false;
            break;
          }
        }
        if (addToCurrentSet) {
          currentSet.push(unassignedCell);
          unassignedCells.delete(unassignedCell);
        }
      }
      conflictSets.push(currentSet);
    }

    return conflictSets;
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

  restrictCellsSingleConflictSet(grid, sum, cells) {
    const numCells = cells.length;

    // Check that we can make the current sum with the unfixed values remaining.
    let fixedValues = 0;
    let allValues = 0;
    let nonUniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      nonUniqueValues |= allValues & v;
      allValues |= v;
      fixedValues |= (!(v & (v - 1))) * v; // Better than branching.
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
    let requiredUniques = allValues & ~nonUniqueValues;
    const numUnfixed = cells.length - countOnes16bit(fixedValues);

    let possibilities = 0;
    const options = this.killerCageSums[numUnfixed][sum - fixedSum];
    for (const o of options) {
      if ((o & unfixedValues) == o) {
        possibilities |= o;
        requiredUniques &= o;
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

    // requiredUniques are values that appear in all possible solutions AND
    // are unique. Thus, we can enforce these values.
    // NOTE: This is the same as the HouseHandler uniqueness check.
    if (requiredUniques) {
      for (let i = 0; i < numCells; i++) {
        let value = grid[cells[i]] & requiredUniques;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value & (value - 1)) return false;
          grid[cells[i]] = value;
        }
      }
    }

    return true;
  }

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMins = new Uint16Array(SHAPE_MAX.numValues);
  static _seenMaxs = new Uint16Array(SHAPE_MAX.numValues);

  // Restricts cell values to only the ranges that are possible taking into
  // account uniqueness constraints between values.
  restrictCellsMultiConflictSet(grid, sum, conflictSets) {
    const numSets = conflictSets.length;

    // Find a set of miniumum and maximum unique values which can be set,
    // taking into account uniqueness within constraint sets.
    // From this determine the minimum and maximum possible sums.

    let seenMins = SumHandlerUtil._seenMins;
    let seenMaxs = SumHandlerUtil._seenMaxs;
    let strictMin = 0;
    let strictMax = 0;

    const minMaxLookup = this._lookupTables.minMax8Bit;
    const numValues = this._numValues;
    const allValues = this._lookupTables.allValues;

    for (let s = 0; s < numSets; s++) {
      let set = conflictSets[s];
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
    // i.e. How much leaway is there from the min and max value of each cell.
    let minDof = sum - strictMin;
    let maxDof = strictMax - sum;
    if (minDof < 0 || maxDof < 0) return false;
    if (minDof >= numValues - 1 && maxDof >= numValues - 1) return true;

    // Restrict values based on the degrees of freedom.
    for (let s = 0; s < numSets; s++) {
      let seenMin = seenMins[s];
      let seenMax = seenMaxs[s];
      // If min and max are the same, then the values can't be constrained
      // anymore (and a positive dof guarentees that they are ok).
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
        const set = conflictSets[s];
        for (let i = 0; i < set.length; i++) {
          if (!(grid[set[i]] &= valueMask)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  _enforceThreeCellConsistency(grid, cells, sum, conflictMap) {
    const numValues = this._numValues;

    let v0 = grid[cells[0]];
    let v1 = grid[cells[1]];
    let v2 = grid[cells[2]];

    // Find each set of pairwise sums.
    let sums2 = this._pairwiseSums[(v0 << numValues) | v1] << 2;
    let sums1 = this._pairwiseSums[(v0 << numValues) | v2] << 2;
    let sums0 = this._pairwiseSums[(v1 << numValues) | v2] << 2;

    // If the cell values are possibly repeated, then handle that.
    if (conflictMap[0] !== conflictMap[1] || conflictMap[0] !== conflictMap[2]) {
      if (conflictMap[0] != conflictMap[1]) {
        sums2 |= this._doubles[v0 & v1];
      }
      if (conflictMap[0] != conflictMap[2]) {
        sums1 |= this._doubles[v0 & v2];
      }
      if (conflictMap[1] != conflictMap[2]) {
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
  static _conflictMapBuffer = new Uint8Array(SHAPE_MAX.numValues);
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
  enforceFewRemainingCells(grid, targetSum, numUnfixed, cells, conflictMap) {
    const cellBuffer = this.constructor._cellBuffer;
    const valueBuffer = this.constructor._valueBuffer;
    const conflictMapBuffer = this.constructor._conflictMapBuffer;

    const gridSize = this._numValues;

    let j = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      const v = grid[c];
      if (v & (v - 1)) {
        conflictMapBuffer[j] = conflictMap[i];
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

        // If the cells are in the same conflict set, also ensure the sum is
        // distict values.
        if ((targetSum & 1) == 0 &&
          conflictMapBuffer[0] === conflictMapBuffer[1]) {
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
          grid, cellBuffer, targetSum, conflictMapBuffer);
      }
    }
  }
}

SudokuConstraintHandler.Sum = class Sum extends SudokuConstraintHandler {
  _conflictSets;
  _conflictMap;
  _sum;
  _complementCells;
  _positiveCells = [];
  _negativeCells = [];

  constructor(cells, sum) {
    cells.sort();

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

  initialize(initialGrid, cellConflicts, shape) {
    this._shape = shape;

    this._lookupTables = LookupTables.get(shape.numValues);

    if (this.cells.length > this._lookupTables.MAX_CELLS_IN_SUM) {
      // This isn't an invalid grid,
      // we just can't handle it because rangeInfo might overflow.
      throw ('Number of cells in the sum' +
        `can't exceed ${this._lookupTables.MAX_CELLS_IN_SUM}`);
    }

    this._util = SumHandlerUtil.get(shape.numValues);

    this._conflictSets = SumHandlerUtil.findConflictSets(
      this._positiveCells, cellConflicts);
    if (this._negativeCells.length) {
      this._conflictSets.push(...SumHandlerUtil.findConflictSets(
        this._negativeCells, cellConflicts));
    }

    this._conflictMap = new Uint8Array(this.cells.length);
    this._conflictSets.forEach(
      (s, i) => s.forEach(
        c => this._conflictMap[this.cells.indexOf(c)] = i));

    // Ensure that _complementCells is null.
    // undefined is used by the optimizer to know that a value has not been
    // set yet.
    if (this._complementCells === undefined) {
      this._complementCells = null;
    }

    // Check for valid sums.
    const sum = this._sum;
    if (!Number.isInteger(sum) || sum < 0) return false;
    if (this._conflictSets.length == 1
      && sum > SumHandlerUtil.maxCageSum(shape.numValues)) {
      return false;
    }
    // Ensure each conflict set is not too large. This only matters if we remove
    // standard regions.
    for (const conflictSet of this._conflictSets) {
      if (conflictSet.length > shape.numValues) {
        // The UI should not allow users to create such sets, and the
        // optimizer should avoid them as well.
        throw ('Conflict set is too large.');
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

  enforceConsistency(grid) {
    const cells = this.cells;
    const numCells = cells.length;
    const sum = this._sum;
    const gridSize = this._shape.gridSize;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    const rangeInfo = this._lookupTables.rangeInfo;
    let rangeInfoSum = 0;
    for (let i = numCells - 1; i >= 0; i--) {
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
    // NOTE: Uniqueness constraint is already enforced by the solver via confictCells.
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
      if (!this._util.enforceFewRemainingCells(grid, targetSum, numUnfixed, this.cells, this._conflictMap)) {
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

    if (this._conflictSets.length == 1) {
      if (!this._util.restrictCellsSingleConflictSet(
        grid, this._sum, cells)) return false;
    } else {
      if (!this._util.restrictCellsMultiConflictSet(
        grid, sum, this._conflictSets, 0)) return false;
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
// Initial constraint is:
//   a1+a2+...+an - b = s
// If reverse the bitset for `b`, then we get the value:
//   B = G+1 - b where `G` is the gridSize (number of values).
// This gives a new constraint which is sum of positives:
//   a1+a2+...+an + B = s + G+1;
// Thus we can reverse `b` then use the Sum handler with the updated sum.
//
// Note that `B` is still a value in the same range as `b`, so the Sum handler
// does not need to be made more general.
SudokuConstraintHandler.SumWithNegative = class SumWithNegative extends SudokuConstraintHandler.Sum {
  constructor(positiveCells, negativeCell, sum) {
    positiveCells.sort();
    super([...positiveCells, negativeCell], sum);

    this._positiveCells = positiveCells;
    this._negativeCells = [negativeCell];
    this._negativeCell = negativeCell;
    this._conflictSets = null;

    // IMPORTANT: Complement cells don't work for this currently, because
    // we can't guarentee that reversed negativeCells is a unique value.
    // This will stop anyone adding them.
    this._complementCells = null;
  }

  initialize(initialGrid, cellConflicts, shape) {
    this._sum += shape.gridSize + 1;
    return super.initialize(initialGrid, cellConflicts, shape);
  }

  setComplementCells() { }

  enforceConsistency(grid) {
    const reverse = this._lookupTables.reverse;
    grid[this._negativeCell] = reverse[grid[this._negativeCell]];

    const result = super.enforceConsistency(grid);

    // Reverse the value back even if we fail to make the output and debugging
    // easier.
    grid[this._negativeCell] = reverse[grid[this._negativeCell]];

    return result;
  }
}

SudokuConstraintHandler.Sandwich = class Sandwich extends SudokuConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
  }

  initialize(initialGrid, cellConflicts, shape) {
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
    this._minMaxTable = lookupTables.minMax8Bit;

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

  // Possible combinations for values between the sentinals for each possible sum.
  // Grouped by distance.
  static _combinations = memoize((shape) => {
    const lookupTables = LookupTables.get(shape.numValues);
    const maxSum = this._maxSum(shape);
    const borderMask = this._borderMask(shape);

    let table = [];
    const maxD = shape.gridSize - 1;
    for (let i = 0; i <= maxSum; i++) {
      table[i] = new Array(maxD);
      for (let d = 0; d <= maxD; d++) table[i][d] = [];
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

  // Distance range between the sentinals for each possible sum.
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

  enforceConsistency(grid) {
    const cells = this.cells;
    const borderMask = this._borderMask;
    const gridSize = this._gridSize;

    // Cache the grid values for faster lookup.
    let values = SudokuConstraintHandler.Sandwich._cellValues;
    let numBorders = 0;
    for (let i = 0; i < gridSize; i++) {
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
        minMaxSum += this._minMaxTable[values[i]];
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

    // Iterate over each possible starting index for the first sentinal.
    // Check if the other values are consistant with the required sum.
    // Given that the values must form a house, this is sufficient to ensure
    // that the constraint is fully satisfied.
    const valueMask = this._valueMask;
    const [minDist, maxDist] = this._distances;
    const maxIndex = gridSize - minDist;
    const shift = gridSize - 1;
    let prefixValues = 0;
    let pPrefix = 0;
    for (let i = 0; i < maxIndex; i++) {
      let v = values[i];
      // If we don't have a sentinal, move onto the next index.
      if (!(v &= borderMask)) continue;
      // Determine what the matching sentinal value needs to be.
      const vRev = borderMask & ((v >> shift) | (v << shift));

      // For each possible gap:
      //  - Determine the currently possible values inside the gap.
      //  - Find every valid combination that can be made from these values.
      //  - Use them to determine the possible inside and outside values.
      let innerValues = 0;
      let pInner = i + 1;
      for (let j = i + minDist; j <= i + maxDist && j < gridSize; j++) {
        if (!(values[j] & vRev)) continue;

        while (pInner < j) innerValues |= values[pInner++];
        while (pPrefix < i) prefixValues |= values[pPrefix++];
        let outerValues = prefixValues;
        for (let k = pInner + 1; k < gridSize; k++) outerValues |= values[k];

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
          while (k < gridSize) validSettings[k++] |= outerPossibilities;
        }
      }
    }

    for (let i = 0; i < gridSize; i++) {
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
    cells0.sort();
    cells1.sort();
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

  enforceConsistency(grid) {
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

  initialize(initialGrid, cellConflicts, shape) {
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

    this._util = SumHandlerUtil.get(shape.numValues);
    const lookupTables = LookupTables.get(shape.numValues);
    this._minMaxTable = lookupTables.minMax8Bit;

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
        arrow.initialize(initialGrid, cellConflicts, shape);
        this._arrows.push(arrow);
      }
      this._multi = [];
    }

    return true;
  }

  _enforceSingles(grid, cellAccumulator) {
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

  _enforceMulti(grid, cellAccumulator) {

    const minMaxTable = this._minMaxTable;
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
        if (!this._util.restrictCellsSingleConflictSet(
          grid, globalMin, cells)) return false;
      }
    }

    return true;
  }

  enforceConsistency(grid, cellAccumulator) {
    if (this._singles.length > 1) {
      if (!this._enforceSingles(grid, cellAccumulator)) return false;
    }
    if (this._arrows.length > 0) {
      for (const arrow of this._arrows) {
        if (!arrow.enforceConsistency(grid, cellAccumulator)) return false;
      }
    }
    if (this._multi.length > 0) {
      if (!this._enforceMulti(grid, cellAccumulator)) return false;
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

  initialize(initialGrid, cellConflicts, shape) {
    this._minMaxTable = LookupTables.get(shape.numValues).minMax8Bit;

    const conflictSets = SumHandlerUtil.findConflictSets(
      this._mids, cellConflicts);
    const maxConflictSize = Math.max(0, ...conflictSets.map(a => a.length));
    const minEndsDelta = maxConflictSize ? maxConflictSize + 1 : 0;

    this._binaryConstraint = new SudokuConstraintHandler.BinaryConstraint(
      ...this._ends, (a, b) => Math.abs(a - b) >= minEndsDelta);
    return this._binaryConstraint.initialize(initialGrid, cellConflicts, shape);
  }

  conflictSet() {
    // The ends must be unique if there are any cells in the middle.
    return this._mids.length ? this._ends : [];
  }

  enforceConsistency(grid, cellAccumulator) {
    // Constrain the ends to be consistant with each other.
    if (!this._binaryConstraint.enforceConsistency(grid, cellAccumulator)) {
      return false;
    }

    const endsCombined = grid[this._ends[0]] | grid[this._ends[1]];
    let minMax = this._minMaxTable[endsCombined];
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
      minMax = this._minMaxTable[fixedValues];
      const cellMin = minMax >> 8;
      const cellMax = minMax & 0xff;
      mask = ~(((1 << (cellMax - cellMin + 1)) - 1) << (cellMin - 1));
      if (!(grid[this._ends[0]] &= mask)) return false;
      if (!(grid[this._ends[1]] &= mask)) return false;
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

    this._cellMap = new Array(shape.numCells);
    this._auxHandlerLookup = new Array(shape.numCells);
    for (let i = 0; i < shape.numCells; i++) {
      this._cellMap[i] = [];
      this._auxHandlerLookup[i] = [];
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

class SudokuConstraintOptimizer {
  // Maximum number of cells in some sums generated by the optimizers.
  static _MAX_SUM_SIZE = 6;

  static optimize(handlerSet, cellConflictSets, shape) {
    const hasBoxes = handlerSet.getAllofType(SudokuConstraintHandler.NoBoxes).length == 0;

    this._addHouseHandlers(handlerSet, shape);

    this._optimizeSums(handlerSet, cellConflictSets, hasBoxes, shape);

    this._addSumComplementCells(handlerSet);

    this._optimizeJigsaw(handlerSet, hasBoxes, shape);

    if (hasBoxes) {
      this._addHouseIntersections(handlerSet, shape);
    }
  }

  static _addHouseIntersections(handlerSet, shape) {
    const houseHandlers = handlerSet.getAllofType(SudokuConstraintHandler.House);
    const numHandlers = houseHandlers.length;
    for (let i = 1; i < numHandlers; i++) {
      for (let j = 0; j < i; j++) {
        const intersectionSize = arrayIntersectSize(
          houseHandlers[i].cells, houseHandlers[j].cells);
        if (intersectionSize !== shape.boxSize) continue;
        const newHandler = new SudokuConstraintHandler.SameValues(
          arrayDifference(houseHandlers[i].cells, houseHandlers[j].cells),
          arrayDifference(houseHandlers[j].cells, houseHandlers[i].cells),
          true);
        handlerSet.addAux(newHandler);
        if (ENABLE_DEBUG_LOGS) {
          debugLog({
            loc: '_addHouseIntersections',
            msg: `Add: ${newHandler.constructor.name} (aux)`,
            cells: newHandler.cells,
          });
        }
      }
    }
  }

  static _optimizeJigsaw(handlerSet, hasBoxes, shape) {
    const jigsawHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Jigsaw);
    if (jigsawHandlers.length == 0) return;
    if (jigsawHandlers.length > 1) throw ('Multiple jigsaw handlers');
    const jigsawHandler = jigsawHandlers[0];


    handlerSet.add(...this._makeJigsawIntersections(handlerSet));

    handlerSet.add(...this._makeJigsawLawOfLeftoverHandlers(jigsawHandler, hasBoxes, shape));
  }

  // Find a non-overlapping set of handlers.
  static _findNonOverlappingSubset(handlers, fullHandlerSet) {
    const handlerIndexes = new Set(
      handlers.map(h => fullHandlerSet.getIndex(h)));

    // Sort handers by number of overlapping handlers.
    const handlersByOverlaps = [];
    for (const h of handlers) {
      const overlapIndexes = fullHandlerSet.getIntersectingIndexes(h);
      const numOverlap = setIntersection(overlapIndexes, handlerIndexes);
      handlersByOverlaps.push([h, numOverlap]);
    }
    handlersByOverlaps.sort((a, b) => a[1] - b[1]);

    // Take non-conflicting handlers starting with the ones with least
    // overlaps.
    // This means that we avoid the ones which conflict with many cells.
    // i.e. greedy bin-packing.
    const cellsIncluded = new Set();
    const nonOverlappingHandlers = [];
    for (const [h, _] of handlersByOverlaps) {
      if (h.cells.some(c => cellsIncluded.has(c))) continue;
      nonOverlappingHandlers.push(h);
      h.cells.forEach(c => cellsIncluded.add(c));
    }

    return [nonOverlappingHandlers, cellsIncluded];
  }

  static _optimizeSums(handlerSet, cellConflictSets, hasBoxes, shape) {
    // TODO: Consider how this interacts with fixed cells.
    let sumHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Sum);
    if (sumHandlers.length == 0) return;

    let [filteredSumHandlers, sumCells] = this._findNonOverlappingSubset(sumHandlers, handlerSet);

    handlerSet.add(...this._fillInSumGap(filteredSumHandlers, sumCells, shape));

    handlerSet.add(...this._makeInnieOutieSumHandlers(filteredSumHandlers, hasBoxes, shape));

    handlerSet.add(...this._makeHiddenCageHandlers(handlerSet, sumHandlers, shape));

    this._replaceSizeSpecificSumHandlers(handlerSet, cellConflictSets);

    return;
  }

  static _addSumComplementCells(handlerSet) {
    const houseHandlers = (
      handlerSet.getAllofType(SudokuConstraintHandler.House).map(
        h => handlerSet.getIndex(h)));
    const cellMap = handlerSet.getCellMap();

    const findCommonHandler = (cells) => {
      let commonHandlers = houseHandlers;
      for (const c of cells) {
        commonHandlers = arrayIntersect(commonHandlers, cellMap[c]);
        if (commonHandlers.length == 0) return;
      }
      return handlerSet.getHandler(commonHandlers[0]);
    };

    const process = (type, cellsFn) => {
      for (const h of handlerSet.getAllofType(type)) {
        if (h.hasComplementCells()) continue;

        const cells = cellsFn(h);
        const commonHandler = findCommonHandler(cells);
        if (!commonHandler) continue;

        const complementCells = arrayDifference(commonHandler.cells, cells);
        h.setComplementCells(complementCells);
      }
    };

    process(SudokuConstraintHandler.Sum, h => h.cells);
  }

  static _fillInSumGap(sumHandlers, sumCells, shape) {
    // Fill in a gap if one remains.
    const numNonSumCells = shape.numCells - sumCells.size;
    if (numNonSumCells == 0 || numNonSumCells >= shape.gridSize) return [];

    const sumHandlersSum = sumHandlers.map(h => h.sum()).reduce((a, b) => a + b);
    const remainingSum = shape.gridSize * shape.maxSum - sumHandlersSum;

    const remainingCells = new Set(shape.allCells);
    sumHandlers.forEach(h => h.cells.forEach(c => remainingCells.delete(c)));
    const newHandler = new SudokuConstraintHandler.Sum(
      new Uint8Array(remainingCells), remainingSum);

    sumHandlers.push(newHandler);
    remainingCells.forEach(c => sumCells.add(c));

    if (ENABLE_DEBUG_LOGS) {
      debugLog({
        loc: '_fillInSumGap',
        msg: 'Add: ' + newHandler.constructor.name,
        args: { sum: remainingSum },
        cells: newHandler.cells,
      });
    }

    return [newHandler];
  }

  // Add house handlers for any AllDifferentHandler which have 9 cells.
  static _addHouseHandlers(handlerSet, shape) {
    for (const h of
      handlerSet.getAllofType(SudokuConstraintHandler.AllDifferent)) {
      const c = h.conflictSet();
      if (c.length == shape.gridSize) {
        handlerSet.add(new SudokuConstraintHandler.House(c));
      }
    }
  }

  // Find {1-3}-cell sum constraints and replace them dedicated handlers.
  static _replaceSizeSpecificSumHandlers(handlerSet, cellConflictSets) {
    const sumHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Sum);
    for (const h of sumHandlers) {
      let newHandler;
      switch (h.cells.length) {
        case 1:
          newHandler = new SudokuConstraintHandler.FixedCells(
            new Map([[h.cells[0], h.sum()]]));
          break;

        case 2:
          const hasConflict = cellConflictSets[h.cells[0]].has(h.cells[1]);
          newHandler = new SudokuConstraintHandler.BinaryConstraint(
            h.cells[0], h.cells[1],
            (a, b) => a + b == h.sum() && (!hasConflict || a != b));
          break;
      }

      if (newHandler) {
        handlerSet.replace(h, newHandler);
        if (ENABLE_DEBUG_LOGS) {
          debugLog({
            loc: '_replaceSizeSpecificSumHandlers',
            msg: 'Replace with: ' + newHandler.constructor.name,
            cells: newHandler.cells,
          });
        }
      }
    }
  }

  // Create a Sum handler out of all the cages sticking out of a house.
  static _addSumIntersectionHandler(
    houseHandler, intersectingSumHandlers, intersectingHouseHandlers,
    allHouseHandlers, shape) {
    const gridSize = shape.gridSize;

    let totalSum = 0;
    let cells = new Set();
    let uncoveredCells = new Set(houseHandler.cells);
    for (const h of intersectingSumHandlers) {
      totalSum += h.sum();
      h.cells.forEach(c => cells.add(c));
      h.cells.forEach(c => uncoveredCells.delete(c));
    }

    // If we haven't filled up the entire house then try to greedily fill the
    // holes with house handlers.
    let usedExtraHouses = false;
    if (uncoveredCells.size > 0) {
      for (const h of intersectingHouseHandlers) {
        // Ignore any houses which intersect with the existing cells.
        if (setIntersectSize(cells, h.cells) > 0) continue;
        // Ignore any houses which don't cover the uncovered cells.
        const intersectSize = setIntersectSize(uncoveredCells, h.cells);
        if (intersectSize == 0) continue;
        // Ignore handlers which only intersect in one square. This is likely
        // a row crossing a column, and is generally not useful.
        if (intersectSize == 1) continue;
        // Ensure the intersection only covers the uncovered cells.
        if (intersectSize != arrayIntersectSize(houseHandler.cells, h.cells)) {
          continue;
        }
        // This handler fills in an existing gap.
        totalSum += shape.maxSum;
        h.cells.forEach(c => cells.add(c));
        h.cells.forEach(c => uncoveredCells.delete(c));
        usedExtraHouses = true;
        if (uncoveredCells.size == 0) break;
      }
    }

    // If we still haven't covered all the cells, then give up.
    if (uncoveredCells.size > 0) return null;

    // Remove the current house cells, as we care about the cells outside the
    // house.
    houseHandler.cells.forEach(c => cells.delete(c));
    totalSum -= shape.maxSum;

    // While it's possible that there could be a house completely contained
    // within the cells, then try to find and remove them.
    // Note that houses used to construct the cells won't match as we have
    // already removed the cells in the current house.
    let removedExtraHouses = false;
    if (cells.size >= gridSize) {
      for (const h of allHouseHandlers) {
        // Ignore any houses which don't cover the cells.
        const intersectSize = setIntersectSize(cells, h.cells);
        if (intersectSize != gridSize) continue;
        // This house is completely contained within the cells.
        totalSum -= shape.maxSum;
        h.cells.forEach(c => cells.delete(c));
        removedExtraHouses = true;
        if (cells.size < gridSize) break;
      }
    }

    if (cells.size == 0) return null;

    // Can't have too many cells in the sum.
    if (cells.size > LookupTables.get(shape.numValues).MAX_CELLS_IN_SUM) {
      return null;
    }

    // NOTE: This restriction is here to avoid pessimising the performance of
    // TAREK_ALL and EXTREME_KILLERS puzzles.
    // Don't put too many cells in the sum as this adds a lot of constraints
    // which may be less useful.
    // An exception is made if we used extra houses to fill in gaps  as it
    // is more likely to have contained interesting interactions with
    // distant cells.
    if (!usedExtraHouses &&
      (cells.size > this._MAX_SUM_SIZE || removedExtraHouses)) {
      if (ENABLE_DEBUG_LOGS) {
        const cellsArray = Array.from(cells);
        const cellString = cellsArray.map(c => shape.makeCellId(c)).join('~');
        debugLog({
          loc: '_addSumIntersectionHandler',
          msg: 'Discarded inferred handler: ' +
            `.Sum~${totalSum}~${cellString}`,
          args: { sum: totalSum },
          cells: cellsArray
        });
      }
      return null;
    }

    const handler = new SudokuConstraintHandler.Sum(
      Array.from(cells), totalSum);

    if (ENABLE_DEBUG_LOGS) {
      let args = { sum: handler.sum() };
      if (usedExtraHouses) args.usedExtraHouses = usedExtraHouses;
      if (removedExtraHouses) args.removedExtraHouses = removedExtraHouses;
      debugLog({
        loc: '_addSumIntersectionHandler',
        msg: 'Add: ' + handler.constructor.name,
        args: args,
        cells: handler.cells
      });
    }

    return handler;
  }

  // Find sets of cells which we can infer have a known sum and unique values.
  static _makeHiddenCageHandlers(handlerSet, allSumHandlers, shape) {
    const houseHandlers = handlerSet.getAllofType(SudokuConstraintHandler.House);
    const newHandlers = [];

    const allSumHandlerIndexes = new Set(
      allSumHandlers.map(h => handlerSet.getIndex(h)));
    const houseHandlerIndexes = new Set(
      houseHandlers.map(h => handlerSet.getIndex(h)));

    for (const h of houseHandlers) {
      // Find sum constraints which overlap this house.
      let intersectingHandlers = handlerSet.getIntersectingIndexes(h);
      const currentHouseSumIndexes = setIntersection(
        intersectingHandlers, allSumHandlerIndexes);
      if (!currentHouseSumIndexes.size) continue;

      // For the sum intersection, we need to ensure that the sum handlers don't
      // overlap themselves.
      // We do this separately for each house so that we can don't have to
      // force the same handle to be used in every house it intersects.
      const [filteredSumHandlers, _] = this._findNonOverlappingSubset(
        Array.from(currentHouseSumIndexes).map(
          i => handlerSet.getHandler(i)),
        handlerSet);

      {
        const intersectingHouseHandlers = Array.from(
          setIntersection(intersectingHandlers, houseHandlerIndexes)).map(
            i => handlerSet.getHandler(i));
        const sumIntersectionHandler = this._addSumIntersectionHandler(
          h, filteredSumHandlers, intersectingHouseHandlers, houseHandlers,
          shape);
        if (sumIntersectionHandler) newHandlers.push(sumIntersectionHandler);
      }

      // Outies are cages which stick out of the house by 1 cell.
      const outies = [];
      // Constrained cells are those from cages which are fully contained within
      // the house.
      const constrainedCells = [];
      let constrainedSum = 0;
      for (const k of filteredSumHandlers) {
        const overlapSize = arrayIntersectSize(h.cells, k.cells);
        if (overlapSize == k.cells.length) {
          constrainedCells.push(...k.cells);
          constrainedSum += k.sum();
          k.setComplementCells(arrayDifference(h.cells, k.cells));
        } else if (k.cells.length - overlapSize == 1) {
          outies.push(k);
        }
      }

      // Short-circuit the common case where there is nothing special in the
      // house.
      if (outies.length == 0 && constrainedCells.length == 0) continue;

      const complementCells = arrayDifference(h.cells, constrainedCells);
      const complementSum = shape.maxSum - constrainedSum;

      // If a cage sticks out of a house by 1 cell, then we can form the
      // equivalent of an arrow sum (with offset). That is, the value of the
      // cell outside house is direct offset of the sum of the remaining
      // cells in the house outside the cage. The sum can be further reduced
      // by any other cages (i.e. known sums) in the house.
      for (const o of outies) {
        const remainingCells = arrayDifference(complementCells, o.cells);
        // Don't add sums with too many cells.
        if (remainingCells.length + 1 > this._MAX_SUM_SIZE) continue;

        const extraCells = arrayDifference(o.cells, h.cells);
        const remainingSum = complementSum - o.sum();
        const handler = new SudokuConstraintHandler.SumWithNegative(
          remainingCells, extraCells[0], remainingSum);
        newHandlers.push(handler);

        if (ENABLE_DEBUG_LOGS) {
          debugLog({
            loc: '_makeHiddenCageHandlers',
            msg: 'Add: ' + handler.constructor.name,
            args: { offset: remainingSum, negativeCells: [...extraCells] },
            cells: handler.cells
          });
        }
      }

      // No constraints within this house.
      if (constrainedCells.length == 0) continue;
      // The remaining 8-cell will already be constrained after the first
      // pass.
      if (constrainedCells.length == 1) continue;
      // Nothing left to constrain.
      if (constrainedCells.length == shape.gridSize) continue;

      const complementHandler = new SudokuConstraintHandler.Sum(
        complementCells, complementSum);
      complementHandler.setComplementCells(constrainedCells);
      newHandlers.push(complementHandler);
      if (ENABLE_DEBUG_LOGS) {
        debugLog({
          loc: '_makeHiddenCageHandlers',
          msg: 'Add: ' + complementHandler.constructor.name,
          args: { sum: complementSum },
          cells: complementCells
        });
      }
    }

    return newHandlers;
  }

  // Add same value handlers for the intersections between houses.
  static _makeJigsawIntersections(handlerSet) {
    const houseHandlers = handlerSet.getAllofType(SudokuConstraintHandler.House);
    const newHandlers = [];

    // Add constraints due to overlapping regions.
    for (const h0 of houseHandlers) {
      for (const h1 of houseHandlers) {
        if (h0 === h1) continue;

        const diff0 = arrayDifference(h0.cells, h1.cells);
        if (diff0.length > this._MAX_SUM_SIZE || diff0.length == 0) continue;

        // We have some overlapping cells!
        // This means diff0 and diff1 must contain the same values.
        const diff1 = arrayDifference(h1.cells, h0.cells);

        // TODO: Optimize the diff0.length == 1 case (and 2?).
        const handler = new SudokuConstraintHandler.SameValues(
          diff0, diff1, true);
        newHandlers.push(handler);
        if (ENABLE_DEBUG_LOGS) {
          debugLog({
            loc: '_makeJigsawIntersections',
            msg: 'Add: SameValues',
            cells: handler.cells,
          });
        }
      }
    }

    return newHandlers;
  }

  static _overlapRegions = memoize((shape) => {
    const rowRegions = SudokuConstraint.rowRegions(shape);
    const colRegions = SudokuConstraint.colRegions(shape);
    return [
      rowRegions,
      rowRegions.slice().reverse(),
      colRegions,
      colRegions.slice().reverse(),
    ];
  });

  static _overlapRegionsWithBox = memoize((shape) => {
    return [
      ...this._overlapRegions(shape),
      SudokuConstraint.boxRegions(shape),
    ];
  });

  static _generalRegionOverlapProcessor(regions, pieces, gridSize, callback) {
    const superRegion = new Set();
    const remainingPieces = new Set(pieces);
    const usedPieces = [];
    const piecesRegion = new Set();

    let i = 0;
    for (const r of regions) {
      i++;
      if (i == gridSize) break;

      // Add r to our super-region.
      r.forEach(e => superRegion.add(e));

      // Add any remaining pieces with enough overlap to our super-region.
      for (const p of remainingPieces) {
        const intersectionSize = setIntersectSize(superRegion, p);
        if (intersectionSize > p.length / 2) {
          remainingPieces.delete(p);
          for (const c of p) piecesRegion.add(c);
          usedPieces.push(p);
        }
      }

      // Don't process the first region, as that usually doubles up work from
      // elsewhere.
      if (i == 1) continue;

      callback(superRegion, piecesRegion, usedPieces);
    }
  }

  static _makeJigsawLawOfLeftoverHandlers(jigsawHandler, hasBoxes, shape) {
    const newHandlers = [];

    const handleOverlap = (superRegion, piecesRegion, usedPieces) => {
      // We can only match when regions are the same size.
      if (superRegion.size != piecesRegion.size) return;

      const diffA = setDifference(superRegion, piecesRegion);
      if (diffA.size == 0) return;
      const diffB = setDifference(piecesRegion, superRegion);
      // Ignore diff that too big, they are probably not very well
      // constrained.
      if (diffA.size >= shape.gridSize) return;

      // All values in the set differences must be the same.
      const newHandler = new SudokuConstraintHandler.SameValues(
        [...diffA], [...diffB], false);
      newHandlers.push(newHandler);
      if (ENABLE_DEBUG_LOGS) {
        debugLog({
          loc: '_makeJigsawLawOfLeftoverHandlers',
          msg: 'Add: ' + newHandler.constructor.name,
          cells: newHandler.cells,
        });
      }
    }

    const overlapRegions = (
      hasBoxes ? this._overlapRegionsWithBox(shape) : this._overlapRegions(shape));
    for (const r of overlapRegions) {
      this._generalRegionOverlapProcessor(
        r, jigsawHandler.regions, shape.gridSize, handleOverlap);
    }

    return newHandlers;
  }

  static _makeInnieOutieSumHandlers(sumHandlers, hasBoxes, shape) {
    const newHandlers = [];
    const gridSize = shape.gridSize;

    const pieces = sumHandlers.map(h => h.cells);
    const piecesMap = new Map(sumHandlers.map(h => [h.cells, h.sum()]));

    const cellsInSum = new Set();
    sumHandlers.forEach(h => h.cells.forEach(c => cellsInSum.add(c)));
    const hasCellsWithoutSum = (cells) => {
      for (const c of cells) {
        if (!cellsInSum.has(c)) return true;
      }
      return false;
    };

    const handleOverlap = (superRegion, piecesRegion, usedPieces) => {
      let diffA = setDifference(superRegion, piecesRegion);
      let diffB = setDifference(piecesRegion, superRegion);

      // No diff, no new constraints to add.
      if (diffA.size == 0 && diffB.size == 0) return;
      // Don't use this if the diff is too large.
      if (diffA.size + diffB.size > gridSize) return;

      // We can only do negative sum constraints when the diff is 1.
      // We can only do sum constraints when the diff is 0.
      if (diffA.size > 1 && diffB.size > 1) return;

      if (!(hasCellsWithoutSum(diffA) || hasCellsWithoutSum(diffB))) {
        // If all cells in the diff overalp with a piece, then limit the size of
        // the sum.
        if (diffA.size + diffB.size > this._MAX_SUM_SIZE) return;
        // Otherwise we are adding a sum constraint to a cell which doesn't
        // currently have one, so we'll take all the help we can get!
      }

      let sumDelta = -superRegion.size * shape.maxSum / gridSize;
      for (const p of usedPieces) sumDelta += piecesMap.get(p);

      // Ensure diffA is the smaller.
      if (diffA.size > diffB.size) {
        [diffA, diffB] = [diffB, diffA];
        sumDelta = -sumDelta;
      }

      let newHandler;
      let args;
      if (diffA.size == 0) {
        newHandler = new SudokuConstraintHandler.Sum([...diffB], sumDelta);
        args = { sum: sumDelta };
      } else {
        const negativeCell = [...diffA][0];
        newHandler = new SudokuConstraintHandler.SumWithNegative(
          [...diffB], negativeCell, sumDelta);
        args = { sum: sumDelta, negativeCell: negativeCell };
      }

      newHandlers.push(newHandler);
      if (ENABLE_DEBUG_LOGS) {
        debugLog({
          loc: '_makeInnieOutieSumHandlers',
          msg: 'Add: ' + newHandler.constructor.name,
          args: args,
          cells: newHandler.cells,
        });
      }
    };

    const overlapRegions = (
      hasBoxes ? this._overlapRegionsWithBox(shape) : this._overlapRegions(shape));
    for (const r of overlapRegions) {
      this._generalRegionOverlapProcessor(
        r, pieces, shape.gridSize, handleOverlap);
    }

    return newHandlers;
  }
}
