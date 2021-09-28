"use strict";

class SudokuConstraintHandler {
  constructor(cells) {
    // This constraint is enforced whenever these cells are touched.
    this.cells = new Uint8Array(cells || []);
  }

  enforceConsistency(grid) {
    return true;
  }

  conflictSet() {
    return [];
  }

  initialize(initialGrid, cellConflicts) {
    return;
  }
}

SudokuConstraintHandler.FixedCells = class extends SudokuConstraintHandler {
  constructor(valueMap) {
    super();
    this._valueMap = valueMap;
  }

  initialize(initialGrid) {
    for (const [cell, value] of this._valueMap) {
      initialGrid[cell] = 1 << (value-1);
    }
  }
}

SudokuConstraintHandler.AllDifferent = class extends SudokuConstraintHandler {
  constructor(conflictCells) {
    super();
    conflictCells.sort((a, b) => a - b);
    this._conflictCells = conflictCells;
  }

  conflictSet() {
    return this._conflictCells;
  }
}

SudokuConstraintHandler.Nonet = class extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
  }

  enforceConsistency(grid) {
    const cells = this.cells;

    let allValues = 0;
    let uniqueValues = 0;
    let fixedValues = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      const v = grid[cells[i]];
      uniqueValues = (uniqueValues&~v) | (v&~allValues);
      allValues |= v;
      fixedValues |= (!(v&(v-1)))*v;  // Better than branching.
    }

    if (allValues != ALL_VALUES) return false;
    if (fixedValues == ALL_VALUES) return true;

    uniqueValues &= ~fixedValues;
    if (uniqueValues) {
      // We have hidden singles. Find and constrain them.
      for (let i = 0; i < GRID_SIZE; i++) {
        let cell = cells[i];
        let value = grid[cell] & uniqueValues;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value&(value-1)) return false;
          grid[cell] = value;
          if (!(uniqueValues &= ~value)) break;
        }
      }
    }

    return true;
  }

  conflictSet() {
    return this.cells;
  }
}

SudokuConstraintHandler.BinaryConstraint = class extends SudokuConstraintHandler {
  constructor(cell1, cell2, fn) {
    super([cell1, cell2]);
    this._tables = [
      LookupTable.forBinaryFunction(fn),
      LookupTable.forBinaryFunction((a, b) => fn(b, a)),
    ];
  }

  enforceConsistency(grid) {
    return (
      (grid[this.cells[0]] &= this._tables[1][grid[this.cells[1]]]) &&
      (grid[this.cells[1]] &= this._tables[0][grid[this.cells[0]]]))
  }
}

class SumHandlerUtil {

  static findConflictSets(cells, cellConflicts) {
    let currentSet = [];
    let conflictSets = [currentSet];

    for (const cell of cells) {
      // Determine if this cell is in a conflict set with every cell in the
      // current set. Otherwise start a new set.
      for (const conflictCell of currentSet) {
        if (!cellConflicts[cell].has(conflictCell)) {
          currentSet = [];
          conflictSets.push(currentSet);
          break;
        }
      }
      currentSet.push(cell);
    }

    return conflictSets;
  }

  static restrictValueRange(grid, cells, sumMinusMin, maxMinusSum) {
    // Remove any values which aren't possible because they would cause the sum
    // to be too high.
    for (let i = 0; i < cells.length; i++) {
      let value = grid[cells[i]];
      // If there is a single value, then the range is always fine.
      if (!(value&(value-1))) continue;

      const minMax = LookupTable.MIN_MAX[value];
      const cellMin = minMax >> 7;
      const cellMax = minMax & 0x7f;
      const range = cellMax-cellMin;

      if (sumMinusMin < range) {
        const x = sumMinusMin + cellMin;
        // Remove any values GREATER than x. Even if all other squares
        // take their minimum values, these are too big.
        if (!(value &= ((1<<x)-1))) return false;
        grid[cells[i]] = value;
      }

      if (maxMinusSum < range) {
        // Remove any values LESS than x. Even if all other squares
        // take their maximum values, these are too small.
        const x = cellMax - maxMinusSum;
        if (!(value &= -(1<<(x-1)))) return false;
        grid[cells[i]] = value;
      }
    }

    return true;
  }

  // Restricts cell values to only combinations which could make one of the
  // provided sums. Assumes cells are all in the same conflict set.
  // Returns a mask for the valid sum values (thus 0 if none are possible).
  static restrictCellsSingleConflictSet(grid, baseSum, sumOffsets, cells, offset) {
    const numCells = cells.length;

    // Check that we can make the current sum with the unfixed values remaining.
    let fixedValues = 0;
    let allValues = 0;
    let uniqueValues = 0;
    for (let i = 0; i < numCells; i++) {
      const v = grid[cells[i]];
      uniqueValues &= ~v;
      uniqueValues |= (v&~allValues);
      allValues |= v;
      fixedValues |= (!(v&(v-1)))*v; // Better than branching.
    }
    const fixedSum = LookupTable.SUM[fixedValues]+offset;

    // Check if we have enough unique values.
    if (LookupTable.COUNT[allValues] < numCells) return 0;
    // Check if we have fixed all the values.
    if (allValues == fixedValues) {
      if (sumOffsets == 1 && fixedSum != baseSum) return 0;
      return 1<<(fixedSum-1);
    }

    const unfixedValues = allValues & ~fixedValues;
    let requiredUniques = uniqueValues;
    const numUnfixed = cells.length - LookupTable.COUNT[fixedValues];

    // For each possible targetSum, find the possible cell value settings.
    let possibilities = 0;
    const unfixedCageSums = SumHandlerUtil.KILLER_CAGE_SUMS[numUnfixed];
    let sumValue = 0;
    baseSum--;
    while (sumOffsets) {
      const v = sumOffsets & -sumOffsets;
      sumOffsets &= ~v;
      const sum = baseSum + LookupTable.VALUE[v];

      const sumOptions = unfixedCageSums[sum - fixedSum];
      if (!sumOptions) continue;

      let isPossible = 0;
      for (let j = 0; j < sumOptions.length; j++) {
        const option = sumOptions[j];
        // Branchlessly check that:
        // if ((option & unfixedValues) === option) {
        //   possibilities |= option;
        //   requiredUniques &= option;
        //   isPossible = true;
        // }
        const includeOption = -!(option & ~unfixedValues);
        possibilities |= option&includeOption;
        requiredUniques &= option|~includeOption;
        isPossible |= includeOption;
      }
      if (isPossible) sumValue |= 1<<(sum-1);
    }

    if (!possibilities) return 0;

    // Remove any values that aren't part of any solution.
    const valuesToRemove = unfixedValues & ~possibilities;
    if (valuesToRemove) {
      for (let i = 0; i < numCells; i++) {
        // Safe to apply to every cell, since we know that none of the
        // fixedValues are in unfixedValues.
        if (!(grid[cells[i]] &= ~valuesToRemove)) return 0;
      }
    }

    // requiredUniques are values that appear in all possible solutions AND
    // are unique. Thus, we can enforce these values.
    // NOTE: This is the same as the NonetHandler uniqueness check.
    if (requiredUniques) {
      for (let i = 0; i < numCells; i++) {
        let value = grid[cells[i]] & requiredUniques;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value&(value-1)) return 0;
          grid[cells[i]] = value;
        }
      }
    }

    return sumValue;
  }

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMins = new Uint16Array(GRID_SIZE);
  static _seenMaxs = new Uint16Array(GRID_SIZE);

  // Restricts cell values to only the ranges that are possible taking into
  // account uniqueness constraints between values.
  // Returns a mask for the valid sum values (thus 0 if none are possible).
  static restrictCellsMultiConflictSet(
        grid, minTargetSum, maxTargetSum, cells, conflictSets, offset) {
    const numSets = conflictSets.length;

    // Find a set of miniumum and maximum unique values which can be set,
    // taking into account uniqueness within constraint sets.
    // From this determine the minimum and maximum possible sums.

    let seenMins = this._seenMins;
    let seenMaxs = this._seenMaxs;
    let strictMin = 0;
    let strictMax = 0;

    for (let s = 0; s < numSets; s++) {
      let set = conflictSets[s];
      let seenMin = 0;
      let seenMax = 0;

      for (let i = 0; i < set.length; i++) {
        const minMax = LookupTable.MIN_MAX[grid[set[i]]];
        const min = minMax>>7;
        const max = minMax&0x7f;

        const minShift = min-1;
        const maxShift = GRID_SIZE - max;

        // Set the smallest unset value >= min.
        // i.e. Try to add min to seenMin, but it if already exists then find
        // the next smallest value.
        let x = ~(seenMin >> minShift);
        seenMin |= (x & -x) << minShift;
        // Set the largest unset value <= max.
        x = ~(seenMax >> maxShift);
        seenMax |= (x & -x) << maxShift;
      }

      if (seenMin > ALL_VALUES || seenMax > ALL_VALUES) return 0;

      seenMax = LookupTable.REVERSE[seenMax];
      strictMin += LookupTable.SUM[seenMin];
      strictMax += LookupTable.SUM[seenMax];

      seenMins[s] = seenMin;
      seenMaxs[s] = seenMax;
    }

    // Calculate degrees of freedom in the cell values.
    // i.e. How much leaway is there from the min and max value of each cell.
    let minDof = maxTargetSum - offset - strictMin;
    let maxDof = strictMax - minTargetSum + offset;
    if (minDof < 0 || maxDof < 0) return 0;
    if (minDof >= GRID_SIZE-1 && maxDof >= GRID_SIZE-1) return -1;

    // Restrict values based on the degrees of freedom.
    for (let s = 0; s < numSets; s++) {
      let seenMin = seenMins[s];
      let seenMax = seenMaxs[s];
      // If min and max are the same, then the values can't be constrained
      // anymore (and a positive dof guarentees that they are ok).
      if (seenMin == seenMax) continue;

      let valueMask = -1;

      if (minDof < GRID_SIZE-1) {
        for (let j = minDof; j--;) seenMin |= seenMin<<1;
        valueMask = seenMin;
      }

      if (maxDof < GRID_SIZE-1) {
        for (let j = maxDof; j--;) seenMax |= seenMax>>1;
        valueMask &= seenMax;
      }

      // If the value mask could potentially remove some values, then apply
      // the mask to the valeus in the set.
      if (~valueMask & ALL_VALUES) {
        let set = conflictSets[s];
        for (let i = 0; i < set.length; i++) {
          if (!(grid[set[i]] &= valueMask)) {
            return 0;
          }
        }
      }
    }

    // If we have a range of sums, then restrict the sum based on the degrees
    // of freedom.
    if (minTargetSum != maxTargetSum) {
      let sumMask = ALL_VALUES;
      if (minTargetSum > maxDof) {
        sumMask = ALL_VALUES << (minTargetSum-1-maxDof);
      }
      if (GRID_SIZE > maxTargetSum+minDof) {
        sumMask &= ALL_VALUES >> (GRID_SIZE-(maxTargetSum+minDof));
      }
      return sumMask;
    }

    // Return a permissive mask, since if there is there is only one target
    // sum then restricting it is moot. If the sum was invalid, this function
    // would already have returned 0.
    return -1;
  }

  static enforceThreeCellConsistency(grid, cells, sum, conflictMap) {
    let v0 = grid[cells[0]];
    let v1 = grid[cells[1]];
    let v2 = grid[cells[2]];

    // Find each set of pairwise sums.
    let sums2 = this._PAIRWISE_SUMS[(v0<<GRID_SIZE)|v1]<<2;
    let sums1 = this._PAIRWISE_SUMS[(v0<<GRID_SIZE)|v2]<<2;
    let sums0 = this._PAIRWISE_SUMS[(v1<<GRID_SIZE)|v2]<<2;

    // If the cell values are possibly repeated, then handle that.
    if (conflictMap !== null) {
      if (conflictMap[0] != conflictMap[1]) {
        sums2 |= this._DOUBLES[v0&v1];
      }
      if (conflictMap[0] != conflictMap[2]) {
        sums1 |= this._DOUBLES[v0&v2];
      }
      if (conflictMap[1] != conflictMap[2]) {
        sums0 |= this._DOUBLES[v1&v2];
      }
    }

    // Constrain each value based on the possible sums of the other two.
    // NOTE: We don't care if a value is reused in the result, as that will
    // be removed in one of the other two cases.
    const shift = sum-1;
    v2 &= LookupTable.REVERSE[((sums2 << GRID_SIZE)>>shift) & ALL_VALUES];
    v1 &= LookupTable.REVERSE[((sums1 << GRID_SIZE)>>shift) & ALL_VALUES];
    v0 &= LookupTable.REVERSE[((sums0 << GRID_SIZE)>>shift) & ALL_VALUES];

    if (!(v1 && v1 && v2)) return false;

    grid[cells[0]] = v0;
    grid[cells[1]] = v1;
    grid[cells[2]] = v2;

    return true;
  }

  // Precompute the sums for all pairs of cells. Assumes cells must be unique.
  //
  // For cell values a and b:
  // _PAIRWISE_SUMS[(a<<GRID_SIZE)|b] = sum>>2;
  // (The shift is so the result fits in 16 bits).
  static _PAIRWISE_SUMS = (() => {
    const table = new Uint16Array(COMBINATIONS*COMBINATIONS);

    for (let i = 0; i < COMBINATIONS; i++) {
      for (let j = i; j < COMBINATIONS; j++) {
        let result = 0;
        for (let k = 1; k <= GRID_SIZE; k++) {
          // Check if j contains k.
          const kInJ = (j>>(k-1))&1;
          if (kInJ) {
            // Add k to all values in i.
            let s = i<<k;
            // Remove 2*k, as we require the values to be unique.
            s &= ~(1<<(2*k-1));
            // Store s-2, so we don't overrun 16 bits.
            // (Note, we have an extra one from the sum already).
            s >>= 2;
            result |= s;
          }
        }
        table[(i<<GRID_SIZE)|j] = table[(j<<GRID_SIZE)|i] = result;
      }
    }

    return table;
  })();

  // Store the sum of a+a for all combinations of a.
  static _DOUBLES = (() => {
    const table = new Uint32Array(COMBINATIONS);

    for (let j = 0; j < COMBINATIONS; j++) {
      let result = 0;
      for (let k = 1; k <= GRID_SIZE; k++) {
        // Check if j contains k.
        const kInJ = (j>>(k-1))&1;
        if (kInJ) {
          const s = 1<<(2*k-1);
          result |= s;
        }
      }
      table[j] = result;
    }
    return table;
  })();

  static KILLER_CAGE_SUMS = (() => {
    let table = [];
    for (let n = 0; n < GRID_SIZE+1; n++) {
      let totals = [];
      table.push(totals);
      for (let i = 0; i < (GRID_SIZE*(GRID_SIZE+1)/2)+1; i++) {
        totals.push([]);
      }
    }

    let counts = LookupTable.COUNT;
    let sums = LookupTable.SUM;
    for (let i = 0; i < COMBINATIONS; i++) {
      table[counts[i]][sums[i]].push(i);
    }

    return table;
  })();
}

// Solve 3-cell sums exactly with a 512 KB lookup table.
SudokuConstraintHandler.ThreeCellSum = class extends SudokuConstraintHandler {
  _sum = 0;
  _conflictMap = null;

  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
  }

  initialize(initialGrid, cellConflicts) {
    const conflictSets = SumHandlerUtil.findConflictSets(
      this.cells, cellConflicts);
    if (conflictSets.length > 1) {
      this._conflictMap = new Uint8Array(this.cells.length);

      conflictSets.forEach(
        (s,i) => s.forEach(
          c => this._conflictMap[this.cells.indexOf(c)] = i));
    }
  }

  enforceConsistency(grid) {
    return SumHandlerUtil.enforceThreeCellConsistency(
      grid, this.cells, this._sum, this._conflictMap);
  }

}

SudokuConstraintHandler.Sum = class extends SudokuConstraintHandler {
  _conflictSets;
  _conflictMap;
  _sum;
  _complementCells = null;

  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._sumCells = cells;
  }

  setComplementCells(cells) {
    this._complementCells = cells;
  }

  sum() {
    return this._sum;
  }

  initialize(initialGrid, cellConflicts) {
    this._conflictSets = SumHandlerUtil.findConflictSets(
      this._sumCells, cellConflicts);

    this._conflictMap = new Uint8Array(this._sumCells.length);
    this._conflictSets.forEach(
      (s,i) => s.forEach(
        c => this._conflictMap[this._sumCells.indexOf(c)] = i));
  }

  static _valueBuffer = new Uint16Array(GRID_SIZE);
  static _conflictMapBuffer = new Uint8Array(GRID_SIZE);
  static _cellBuffer = new Uint8Array(GRID_SIZE);

  // Optimize the {1-3}-cell case by solving it exactly and efficiently.
  // REQUIRES that:
  //  - The number of unfixed cells is accurate.
  //  - None of the values are zero.
  _enforceFewRemainingCells(grid, targetSum, numUnfixed) {
    const cells = this._sumCells;

    const cellBuffer = this.constructor._cellBuffer;
    const valueBuffer = this.constructor._valueBuffer;
    const conflictMapBuffer = this.constructor._conflictMapBuffer;

    let j = 0;
    for (let i = cells.length-1; i >= 0; i--) {
      const c = cells[i];
      const v = grid[c];
      if (v&(v-1)) {
        conflictMapBuffer[j] = this._conflictMap[i];
        cellBuffer[j] = c;
        valueBuffer[j] = v;
        j++;
      }
    }

    switch (numUnfixed) {
      case 1: {
        // Set value to the target sum exactly.
        const v = valueBuffer[0] & (1<<(targetSum-1));
        return (grid[cellBuffer[0]] = v);
      }

      case 2: {
        let v0 = valueBuffer[0];
        let v1 = valueBuffer[1];

        // Remove any values which don't have their counterpart value to add to
        // targetSum.
        v1 &= (LookupTable.REVERSE[v0] << (targetSum-1)) >> GRID_SIZE;
        v0 &= (LookupTable.REVERSE[v1] << (targetSum-1)) >> GRID_SIZE;

        // If the cells are in the same conflict set, also ensure the sum is
        // distict values.
        if ((targetSum&1) == 0 &&
            conflictMapBuffer[0] === conflictMapBuffer[1]) {
          // targetSum/2 can't be valid value.
          const mask = ~(1 << ((targetSum>>1)-1));
          v0 &= mask;
          v1 &= mask;
        }

        if (!(v1 && v0)) return false;

        grid[cellBuffer[0]] = v0;
        grid[cellBuffer[1]] = v1;
        return true;
      }

      case 3: {
        return SumHandlerUtil.enforceThreeCellConsistency(
          grid, cellBuffer, targetSum,
          this._conflictSets.length == 1 ? null : conflictMapBuffer);
      }
    }
  }

  _enforceCombinationsWithComplement(grid) {
    const set0 = this._sumCells;
    const set1 = this._complementCells;
    const sum = this._sum;

    let values0 = 0;
    for (let i = set0.length-1; i >= 0; i--) {
      values0 |= grid[set0[i]];
    }
    let values1 = 0;
    for (let i = set1.length-1; i >= 0; i--) {
      values1 |= grid[set1[i]];
    }

    // NOTE: The following have been left out as I couldn't get them to show
    // a measurable improvement.
    //   - Calculating the fixedSum and reduce the target some.
    //   - Short-circuiting this by checking if the sum has already been
    //     reached.

    const cageSums = SumHandlerUtil.KILLER_CAGE_SUMS[set0.length][sum];
    let possibilities0 = 0;
    let possibilities1 = 0;

    for (let j = 0; j < cageSums.length; j++) {
      const option = cageSums[j];
      // Branchlessly check that the option is consistent with both set1 and
      // set0.
      const includeOption = -(!(option & ~values0) & !(~option & ~values1 & ALL_VALUES));
      possibilities0 |= option&includeOption;
      possibilities1 |= ~option&includeOption;
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

    // NOTE: Seems like require unqiues doesn't help much here.

    return true;
  }

  enforceConsistency(grid) {
    const cells = this._sumCells;
    const numCells = cells.length;
    const sum = this._sum;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    let rangeInfoSum = 0;
    for (let i = numCells-1; i >= 0; i--) {
      rangeInfoSum += LookupTable.RANGE_INFO[grid[cells[i]]];
    }

    const maxSum = rangeInfoSum & 0x7f;
    const minSum = (rangeInfoSum>>7) & 0x7f;
    // It is impossible to make the target sum.
    if (sum < minSum || maxSum < sum) return false;
    // We've reached the target sum exactly.
    // NOTE: Uniqueness constraint is already enforced by the solver via confictCells.
    if (minSum == maxSum) return true;

    const numUnfixed = numCells - (rangeInfoSum>>21);
    // A large fixed value indicates a cell has a 0, hence is already
    // unsatisfiable.
    if (numUnfixed < 0) return false;

    if (numUnfixed <= 3) {
    // If there are few remaining cells then handle them explicitly.
      const fixedSum = (rangeInfoSum>>14) & 0x7f;
      const targetSum = sum - fixedSum;
      if (!this._enforceFewRemainingCells(grid, targetSum, numUnfixed)) {
        return false;
      }
    } else {
      // Restrict the possible range of values in each cell based on whether they
      // will cause the sum to be too large or too small.
      if (sum - minSum < GRID_SIZE || maxSum - sum < GRID_SIZE) {
        if (!SumHandlerUtil.restrictValueRange(grid, cells,
                                               sum - minSum, maxSum - sum)) {
          return false;
        }
      }
    }

    if (this._complementCells !== null) {
      return this._enforceCombinationsWithComplement(grid);
    }

    // If we have less then 3 unfixed cells, then we've already don't all
    // we can.
    if (numUnfixed <= 3) return true;

    if (this._conflictSets.length == 1) {
      if (0 === SumHandlerUtil.restrictCellsSingleConflictSet(
        grid, this._sum, 1, cells, 0)) return false;
    } else {
      if (0 === SumHandlerUtil.restrictCellsMultiConflictSet(
        grid, sum, sum, cells, this._conflictSets, 0)) return false;
    }

    return true;
  }
}

SudokuConstraintHandler.CellDepedentSum = class extends SudokuConstraintHandler.Sum {
  constructor(cells, offset) {
    super(cells, 0);
    this._offset = offset || 0;
    [this._targetCell, ...this._sumCells] = cells;
    this._conflictSets = null;
  }

  // If there is only one value remaining in sum, then call the standard
  // sum handler.
  _callSuperEnforceConsistency(grid, sums) {
    this._sum = LookupTable.VALUE[sums] - this._offset;
    return super.enforceConsistency(grid);
  }

  enforceConsistency(grid) {
    let sums = grid[this._targetCell];

    if (!sums) return false;
    if (!(sums&(sums-1))) {
      return this._callSuperEnforceConsistency(grid, sums);
    }

    const arrowCells = this._sumCells;
    const numCells = arrowCells.length;
    const offset = this._offset;

    //  Determine sumMin and sumMax based on arrow.
    let minMaxSum = 0;
    for (let i = 0; i < numCells; i++) {
      minMaxSum += LookupTable.MIN_MAX[grid[arrowCells[i]]];
    }

    const sumMin = (minMaxSum>>7)+offset;
    const sumMax = (minMaxSum&0x7f)+offset;
    if (sumMax <= 0 || sumMin > GRID_SIZE) return false;

    // Constraint targetCell.

    // Remove any values GREATER than sumMax.
    if (sumMax < GRID_SIZE && !(sums &= ((1<<sumMax)-1))) return false;
    // Remove any values LESS than sumMin.
    if (sumMin > 0 && !(sums &= -(1<<(sumMin-1)))) return false;
    grid[this._targetCell] = sums;

    // We've reached the exact sum.
    if (sumMin == sumMax) return true;

    if (!(sums&(sums-1))) {
      return this._callSuperEnforceConsistency(grid, sums);
    }

    const minMaxTarget = LookupTable.MIN_MAX[sums];
    const minTarget = minMaxTarget>>7;
    const maxTarget = minMaxTarget&0x7f;

    // Determine how much headroom there is in the range between the extreme
    // values and the target sum.
    const sumMinusMin = maxTarget - sumMin;
    const maxMinusSum = -minTarget + sumMax;

    if (!SumHandlerUtil.restrictValueRange(grid, this._sumCells,
                                           sumMinusMin, maxMinusSum)) {
      return false;
    }

    if (this._conflictSets.length == 1) {
      // Restrict the sum and arrow cells values.
      grid[this._targetCell] &= SumHandlerUtil.restrictCellsSingleConflictSet(
        grid, 1, sums, this._sumCells, offset);
    } else {
      grid[this._targetCell] &= SumHandlerUtil.restrictCellsMultiConflictSet(
        grid, minTarget, maxTarget, this._sumCells,
        this._conflictSets, offset);
    }
    if (grid[this._targetCell] === 0) return false;

    return true;
  }
}

SudokuConstraintHandler.Sandwich = class extends SudokuConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._distances = SudokuConstraintHandler.Sandwich._DISTANCE_RANGE[+sum];
    this._combinations = SudokuConstraintHandler.Sandwich._COMBINATIONS[+sum];
  }

  static _BORDER_MASK = 1 | (1 << (GRID_SIZE-1));
  static _MAX_SUM = 35;
  static _VALUE_MASK = ~this._BORDER_MASK & ALL_VALUES;

  // Possible combinations for values between the 1 and 9 for each possible sum.
  // Grouped by distance.
  static _COMBINATIONS = (() => {
    let table = [];
    const maxD = GRID_SIZE-1;
    for (let i = 0; i <= this._MAX_SUM; i++) {
      table[i] = new Array(maxD);
      for (let d = 0; d <= maxD; d++) table[i][d] = [];
    }

    for (let i = 0; i < COMBINATIONS; i++) {
      if (i & this._BORDER_MASK) continue;
      let sum = LookupTable.SUM[i];
      table[sum][LookupTable.COUNT[i]+1].push(i);
    }

    for (let i = 0; i <= this._MAX_SUM; i++) {
      for (let d = 0; d <= maxD; d++) {
        table[i][d] = new Uint16Array(table[i][d]);
      }
    }

    return table;
  })();

  // Distance range between the 1 and 9 for each possible sum.
  // Map combination to [min, max].
  static _DISTANCE_RANGE = (() => {
    let table = [];
    for (let i = 0; i <= this._MAX_SUM; i++) {
      let row = this._COMBINATIONS[i];

      let j = 0;
      while (j < row.length && !row[j].length) j++;
      let dMin = j;
      while (j < row.length && row[j].length) j++;
      let dMax = j-1;

      table.push([dMin, dMax]);
    }
    return table;
  })();

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _validSettings = new Uint16Array(GRID_SIZE);
  static _cellValues = new Uint16Array(GRID_SIZE);

  enforceConsistency(grid) {
    const cells = this.cells;
    const borderMask = SudokuConstraintHandler.Sandwich._BORDER_MASK;

    // Cache the grid values for faster lookup.
    let values = SudokuConstraintHandler.Sandwich._cellValues;
    let numBorders = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
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
        minMaxSum += LookupTable.MIN_MAX[values[i]];
        i++;
      }

      const sum = this._sum;
      const minSum = minMaxSum>>7;
      const maxSum = minMaxSum&0x7f;
      // It is impossible to make the target sum.
      if (sum < minSum || maxSum < sum) return false;
      // We've reached the target sum exactly.
      if (minSum == maxSum) return true;
    }

    // Build up a set of valid cell values.
    let validSettings = SudokuConstraintHandler.Sandwich._validSettings;
    validSettings.fill(0);

    // Iterate over each possible starting index for the first 1 or 9.
    // Check if the other values are consistant with the required sum.
    // Given that the values must form a nonet, this is sufficient to ensure
    // that the constraint is fully satisfied.
    const valueMask = SudokuConstraintHandler.Sandwich._VALUE_MASK;
    const [minDist, maxDist] = this._distances;
    const maxIndex = GRID_SIZE - minDist;
    let prefixValues = 0;
    let pPrefix = 0;
    for (let i = 0; i < maxIndex; i++) {
      let v = values[i];
      // If we don't have a 1 or 9, move onto the next index.
      if (!(v &= borderMask)) continue;
      // Determine what the matching 1 or 9 value needs to be.
      const vRev = borderMask & ((v>>8) | (v<<8));

      // For each possible gap:
      //  - Determine the currently possible values inside the gap.
      //  - Find every valid combination that can be made from these values.
      //  - Use them to determine the possible inside and outside values.
      let innerValues = 0;
      let pInner = i+1;
      for (let j = i+minDist; j <= i+maxDist && j < GRID_SIZE; j++) {
        if (!(values[j] & vRev)) continue;

        while (pInner < j) innerValues |= values[pInner++];
        while (pPrefix < i) prefixValues |= values[pPrefix++];
        let outerValues = prefixValues;
        for (let k=pInner+1; k < GRID_SIZE; k++) outerValues |= values[k];

        let combinations = this._combinations[j-i];
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
          while (k < GRID_SIZE) validSettings[k++] |= outerPossibilities;
        }
      }
    }

    for (let i = 0; i < GRID_SIZE; i++) {
      if (!(grid[cells[i]] &= validSettings[i])) return false;
    }

    return true;
  }
}

class SudokuConstraintOptimizer {
  static _NONET_SUM = GRID_SIZE*(GRID_SIZE+1)/2;

  static optimize(handlers, cellConflictSets) {
    handlers = this._addNonetHandlers(handlers);

    handlers = this._findHiddenCages(handlers);

    handlers = this._sizeSpecificSumHandlers(handlers, cellConflictSets);

    return handlers;
  }

  // Add nonet handlers for any AllDifferentHandler which have 9 cells.
  static _addNonetHandlers(handlers) {
    for (const h of handlers) {
      if (h instanceof SudokuConstraintHandler.AllDifferent) {
        const c = h.conflictSet();
        if (c.length == GRID_SIZE) {
          handlers.push(new SudokuConstraintHandler.Nonet(c));
        }
      }
    }

    return handlers;
  }

  // Find {1-3}-cell sum constraints and replace them dedicated handlers.
  static _sizeSpecificSumHandlers(handlers, cellConflictSets) {
    for (let i = 0; i < handlers.length; i++) {
      const h = handlers[i];
      if (!(h instanceof SudokuConstraintHandler.Sum)) continue;
      if (h.sum() == 0) continue;

      switch (h.cells.length) {
        case 1:
          handlers[i] = new SudokuConstraintHandler.FixedCells(
            new Map([[h.cells[0], h.sum()]]));
          break;

        case 2:
          const hasConflict = cellConflictSets[h.cells[0]].has(h.cells[1]);
          handlers[i] = new SudokuConstraintHandler.BinaryConstraint(
            h.cells[0], h.cells[1],
            (a, b) => a+b == h.sum() && (!hasConflict || a != b));
          break;

        case 3:
          handlers[i] = new SudokuConstraintHandler.ThreeCellSum(h.cells, h.sum());
          break;
      }
    }

    return handlers;
  }

  // Find sets of cells which we can infer have a known sum and unique values.
  static _findHiddenCages(handlers) {
    // TODO: Consider how this interactions with fixed cells.
    const sumHandlers = handlers.filter(h => (h instanceof SudokuConstraintHandler.Sum) && h.sum() > 0);
    if (sumHandlers.length == 0) return handlers;

    const nonetHandlers = handlers.filter(h => h instanceof SudokuConstraintHandler.Nonet);

    // For now assume that sum constraints don't overlap.
    const cellMap = new Array(NUM_CELLS);
    for (const h of sumHandlers) {
      for (const c of h.cells) {
        cellMap[c] = h;
      }
    }

    for (const h of nonetHandlers) {
      const constraintMap = new Map();
      // Map from constraints to cell.
      for (const c of h.cells) {
        const k = cellMap[c];
        if (k) {
          if (constraintMap.has(k)) {
            constraintMap.get(k).push(c);
          } else {
            constraintMap.set(k, [c])
          }
        }
      }
      if (!constraintMap.size) continue;


      // Find contraints which have cells entirely (or mostly) within
      // this nonet.
      const outies = [];
      const constrainedCells = [];
      let constrainedSum = 0;
      for (const [k, cells] of constraintMap) {
        if (k.cells.length == cells.length) {
          constrainedCells.push(...cells);
          constrainedSum += k.sum();
          k.setComplementCells(setDifference(h.cells, k.cells));
        } else if (k.cells.length == cells.length+1) {
          outies.push(k);
        }
      }

      // Short-circuit the common case where there is nothing special in the
      // nonet.
      if (outies.length == 0 && constrainedCells.length == 0) continue;

      const complementCells = setDifference(h.cells, constrainedCells);
      const complementSum = this._NONET_SUM - constrainedSum;

      // If a cage sticks out of a nonet by 1 cell, then we can form the
      // equivalent of an arrow sum (with offset). That is, the value of the
      // cell outside nonet is direct offset of the sum of the remaining
      // cells in the nonet outside the cage. The sum can be further reduced
      // by any other cages (i.e. known sums) in the nonet.
      for (const o of outies) {
        const remainingCells = setDifference(complementCells, o.cells);
        // This may be worth tuning better.
        // In general a higher number means more constraining, but it
        // takes longer.
        if (remainingCells.length > 5) continue;

        const extraCell = setDifference(o.cells, h.cells);
        const remainingSum = o.sum() - complementSum;
        const handler = new SudokuConstraintHandler.CellDepedentSum(
          [extraCell[0], ...remainingCells], remainingSum);
        handler.setComplementCells(setDifference(h.cells, remainingCells));
        handlers.push(handler);
      }

      // No constraints within this nonet.
      if (constrainedCells.length == 0) continue;
      // The remaining 8-cell will already be constrained after the first
      // pass.
      if (constrainedCells.length == 1) continue;
      // Nothing left to constrain.
      if (constrainedCells.length == GRID_SIZE) continue;

      const complementHandler = new SudokuConstraintHandler.Sum(
        complementCells, complementSum);
      complementHandler.setComplementCells(constrainedCells);
      handlers.push(complementHandler);
    }

    return handlers;
  }
}
