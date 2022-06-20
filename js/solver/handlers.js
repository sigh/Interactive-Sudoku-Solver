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

  enforceConsistency(grid) {
    return true;
  }

  conflictSet() {
    return [];
  }

  initialize(initialGrid, cellConflicts) {
    return;
  }

  priority() {
    // By default, constraints which constrain more cells have higher priority.
    return this.cells.length;
  }
}

SudokuConstraintHandler.NoBoxes = class NoBoxes extends SudokuConstraintHandler {}

SudokuConstraintHandler.False = class False extends SudokuConstraintHandler {
  enforceConsistency() { return false; }
}

SudokuConstraintHandler.FixedCells = class FixedCells extends SudokuConstraintHandler {
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

SudokuConstraintHandler.AllDifferent = class AllDifferent extends SudokuConstraintHandler {
  constructor(conflictCells) {
    super();
    conflictCells.sort((a, b) => a - b);
    this._conflictCells = conflictCells;
  }

  conflictSet() {
    return this._conflictCells;
  }
}

SudokuConstraintHandler.Nonet = class Nonet extends SudokuConstraintHandler {
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

    // Check for naked pairs.

    // We won't have anything useful to do unless we have at least 2 free cells.
    if (GRID_SIZE-LookupTable.COUNT[fixedValues] <= 2) return true;

    for (let i = 0; i < GRID_SIZE-1; i++) {
      const v = grid[cells[i]];
      if (LookupTable.COUNT[v] != 2) continue;
      for (let j = i+1; j < GRID_SIZE; j++) {
        if (grid[cells[j]] !== v) continue;
        // Found a pair, remove it from all other entries.
        for (let k = 0; k < GRID_SIZE; k++) {
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
    this._tables = [
      LookupTable.forBinaryFunction(fn),
      LookupTable.forBinaryFunction((a, b) => fn(b, a)),
    ];
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

  static restrictCellsSingleConflictSet(grid, sum, cells) {
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
    const fixedSum = LookupTable.SUM[fixedValues]

    // Check if we have enough unique values.
    if (LookupTable.COUNT[allValues] < numCells) return false
    // Check if we have fixed all the values.
    if (allValues == fixedValues) {
      return fixedSum == sum;
    }

    const unfixedValues = allValues & ~fixedValues;
    let requiredUniques = uniqueValues;
    const numUnfixed = cells.length - LookupTable.COUNT[fixedValues];
    const sumLookup = SumHandlerUtil.KILLER_CAGE_INFO[unfixedValues][numUnfixed];

    let possibilities = 0;

    // Handle the common case where we only have one sum.
    possibilities = sumLookup[sum-fixedSum];
    if (!possibilities) return false;
    if (possibilities) {
      requiredUniques &= possibilities >> GRID_SIZE;
    }

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
    // NOTE: This is the same as the NonetHandler uniqueness check.
    if (requiredUniques) {
      for (let i = 0; i < numCells; i++) {
        let value = grid[cells[i]] & requiredUniques;
        if (value) {
          // If we have more value that means a single cell holds more than
          // one unique value.
          if (value&(value-1)) return false;
          grid[cells[i]] = value;
        }
      }
    }

    return true;
  }

  // Scratch buffers for reuse so we don't have to create arrays at runtime.
  static _seenMins = new Uint16Array(GRID_SIZE);
  static _seenMaxs = new Uint16Array(GRID_SIZE);

  // Restricts cell values to only the ranges that are possible taking into
  // account uniqueness constraints between values.
  static restrictCellsMultiConflictSet(grid, sum, cells, conflictSets) {
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

      if (seenMin > ALL_VALUES || seenMax > ALL_VALUES) return false;

      seenMax = LookupTable.REVERSE[seenMax];
      strictMin += LookupTable.SUM[seenMin];
      strictMax += LookupTable.SUM[seenMax];

      seenMins[s] = seenMin;
      seenMaxs[s] = seenMax;
    }

    // Calculate degrees of freedom in the cell values.
    // i.e. How much leaway is there from the min and max value of each cell.
    let minDof = sum - strictMin;
    let maxDof = strictMax - sum;
    if (minDof < 0 || maxDof < 0) return false;
    if (minDof >= GRID_SIZE-1 && maxDof >= GRID_SIZE-1) return true;

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
      // the mask to the values in the set.
      if (~valueMask & ALL_VALUES) {
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
    if (BOX_SIZE > DEFAULT_BOX_SIZE) return;
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

  static _MAX_SUM = (GRID_SIZE*(GRID_SIZE+1)/2);

  static KILLER_CAGE_SUMS = (() => {
    let table = [];
    for (let n = 0; n < GRID_SIZE+1; n++) {
      let totals = [];
      table.push(totals);
      for (let i = 0; i < this._MAX_SUM+1; i++) {
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

  // KILLER_CAGE_INFO[values][numCells][sum] = v
  // v = [requiredUniques: 9 bits, possibilities: 9 bits]
  //
  // possibilities: values which are in any solution.
  // requiredUniques: values which are a required part of any solution.
  static KILLER_CAGE_INFO = (() => {
    if (BOX_SIZE > DEFAULT_BOX_SIZE) return;
    const table = [];
    let count = 0;
    for (let i = 0; i < COMBINATIONS; i++) {
      const valueTable = [new Uint32Array()];
      table.push(valueTable);

      const maxCount = LookupTable.COUNT[i];
      for (let j = 1; j < maxCount+1; j++) {
        const countTable = new Uint32Array(this._MAX_SUM+1);
        valueTable.push(countTable);

        const sums = SumHandlerUtil.KILLER_CAGE_SUMS[j];
        for (let s = 1; s < sums.length; s++) {
          const options = sums[s];
          let possibilities = 0;
          let required = ALL_VALUES;
          for (const o of options) {
            if ((o & i) == o) {
              possibilities |= o;
              required &= o;
            }
          }
          if (possibilities) {
            countTable[s] = possibilities | (required << GRID_SIZE);
          }
        }
      }
    }

    return table;
  })();

}

SudokuConstraintHandler.Sum = class Sum extends SudokuConstraintHandler {
  _conflictSets;
  _conflictMap;
  _sum;
  _complementCells;
  _positiveCells = [];
  _negativeCells = [];

  constructor(cells, sum) {
    if (cells.length > GRID_SIZE) throw('Too many cells');

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
    return GRID_SIZE*2-this.cells.length;
  }

  initialize(initialGrid, cellConflicts) {
    this._conflictSets = SumHandlerUtil.findConflictSets(
      this._positiveCells, cellConflicts);
    if (this._negativeCells.length) {
      this._conflictSets.push(...SumHandlerUtil.findConflictSets(
        this._negativeCells, cellConflicts));
    }

    this._conflictMap = new Uint8Array(this.cells.length);
    this._conflictSets.forEach(
      (s,i) => s.forEach(
        c => this._conflictMap[this.cells.indexOf(c)] = i));

    // Ensure that _complementCells is null.
    // undefined is used by the optimizer to know that a value has not been
    // set yet.
    if (this._complementCells === undefined) {
      this._complementCells = null;
    }
  }

  static _valueBuffer = new Uint16Array(GRID_SIZE);
  static _conflictMapBuffer = new Uint8Array(GRID_SIZE);
  static _cellBuffer = new Uint8Array(GRID_SIZE);

  // Optimize the {1-3}-cell case by solving it exactly and efficiently.
  // REQUIRES that:
  //  - The number of unfixed cells is accurate.
  //  - None of the values are zero.
  _enforceFewRemainingCells(grid, targetSum, numUnfixed) {
    const cells = this.cells;

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
    const set0 = this.cells;
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
    const cells = this.cells;
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
      if (!SumHandlerUtil.restrictCellsSingleConflictSet(
        grid, this._sum, cells)) return false;
    } else {
      if (!SumHandlerUtil.restrictCellsMultiConflictSet(
        grid, sum, cells, this._conflictSets, 0)) return false;
    }

    return true;
  }
}

// SumWithNegative allows one cell in the sum to be negative.
// We can easily extend this class to multiple cells, but it hasn't shown to
// provide any benefit.
SudokuConstraintHandler.SumWithNegative = class SumWithNegative extends SudokuConstraintHandler.Sum {
  constructor(positiveCells, negativeCell, sum) {
    positiveCells.sort();
    sum += GRID_SIZE+1;
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

  setComplementCells() {}

  enforceConsistency(grid) {
    grid[this._negativeCell] = LookupTable.REVERSE[grid[this._negativeCell]];

    const result = super.enforceConsistency(grid);

    // Reverse the value back even if we fail to make the output and debugging
    // easier.
    grid[this._negativeCell] = LookupTable.REVERSE[grid[this._negativeCell]];

    return result;
  }
}

SudokuConstraintHandler.Sandwich = class Sandwich extends SudokuConstraintHandler {
  constructor(cells, sum) {
    super(cells);
    this._sum = +sum;
    this._distances = SudokuConstraintHandler.Sandwich._DISTANCE_RANGE[+sum];
    this._combinations = SudokuConstraintHandler.Sandwich._COMBINATIONS[+sum];
  }

  static _BORDER_MASK = 1 | (1 << (GRID_SIZE-1));
  static _MAX_SUM = (GRID_SIZE*(GRID_SIZE-1)/2)-1;
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
      throw('SameValues must use sets of the same length.');
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
    for (let i = numCells; i >= 0; i--) {
      values0 |= grid[cells0[i]];
      values1 |= grid[cells1[i]];
    }

    if (values1 == values0) return true;

    const values = values1 & values0;

    // Check if we have enough values.
    if (this._isUnique && LookupTable.COUNT[values] < numCells) return false;

    // Enforce the constrained value set.
    const cells = this.cells;
    for (let i = numCells*2-1; i >= 0; i--) {
      if (!(grid[cells[i]] &= values)) return false;
    }

    return true;
  }
}

SudokuConstraintHandler.Between = class Between extends SudokuConstraintHandler {
  constructor(cells) {
    super(cells);
    this._ends = [cells[0], cells[cells.length-1]]
    this._mids = cells.slice(1, cells.length-1)
  }

  enforceConsistency(grid) {
    const endsCombined = grid[this._ends[0]] | grid[this._ends[1]];
    let minMax = LookupTable.MIN_MAX[endsCombined];
    let cellMin = (minMax >> 7) + 1;
    let cellMax = (minMax & 0x7f) - 1;
    if (cellMin > cellMax) return false;

    // Constrain the mids by masking out any values that can never be between
    // the ends.
    let mask = ((1 << (cellMax-cellMin+1)) - 1) << (cellMin-1);
    let fixedValues = 0;
    for (let i = 0; i < this._mids.length; i++) {
      const v = (grid[this._mids[i]] &= mask);
      if (!v) return false;
      fixedValues |= (!(v&(v-1)))*v;
    }

    // Constrain the ends by masking out anything which rules out one of the
    // mids.
    if (fixedValues) {
      minMax = LookupTable.MIN_MAX[fixedValues];
      cellMin = (minMax >> 7);
      cellMax = (minMax & 0x7f);
      mask = ~(((1 << (cellMax-cellMin+1)) - 1) << (cellMin-1));
      if (!(grid[this._ends[0]] &= mask)) return false;
      if (!(grid[this._ends[1]] &= mask)) return false;
    }

    return true;
  }
}

class HandlerSet {
  constructor(handlers) {
    this._handlers = [];
    this._seen = new Set();
    this._indexLookup = new Map();

    this._cellMap = new Array(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) this._cellMap[i] = [];

    this.add(...handlers);
  }

  getAllofType(type) {
    return this._handlers.filter(h => h.constructor === type);
  }

  getAll() {
    return this._handlers;
  }

  getCellMap() {
    return this._cellMap;
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

  [Symbol.iterator]() {
    return this._handlers[Symbol.iterator]();
  }
}

class SudokuConstraintOptimizer {
  static _NONET_SUM = GRID_SIZE*(GRID_SIZE+1)/2;
  // Maximum number of cells in a sum generated by the optimizersize of s.
  static _MAX_SUM_SIZE = 6;

  static optimize(handlerSet, cellConflictSets) {
    const hasBoxes = handlerSet.getAllofType(SudokuConstraintHandler.NoBoxes).length == 0;

    this._addNonetHandlers(handlerSet);

    this._optimizeSums(handlerSet, cellConflictSets, hasBoxes);

    this._addSumComplementCells(handlerSet);

    this._optimizeJigsaw(handlerSet, hasBoxes);
  }

  static _optimizeJigsaw(handlerSet, hasBoxes) {
    const jigsawHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Jigsaw);
    if (jigsawHandlers.length == 0) return;
    if (jigsawHandlers.length > 1) throw('Multiple jigsaw handlers');
    const jigsawHandler = jigsawHandlers[0];


    handlerSet.add(...this._makeJigsawIntersections(handlerSet));

    handlerSet.add(...this._makeJigsawLawOfLeftoverHandlers(jigsawHandler, hasBoxes));
  }

  // Find a non-overlapping set of handlers.
  static _findNonOverlapping(handlers, fullHandlerSet) {
    const handlerIndexes = new Set(
      handlers.map(h => fullHandlerSet.getIndex(h)));
    const cellMap = fullHandlerSet.getCellMap();

    // Sort handers by number of overlapping handlers.
    const handlersByOverlaps = [];
    for (const h of handlers) {
      const overlapIndexes = [];
      for (const c of h.cells) {
        overlapIndexes.push(...cellMap[c]);
      }
      const numOverlap = setIntersection(overlapIndexes, handlerIndexes);
      handlersByOverlaps.push([h, numOverlap]);
    }
    handlersByOverlaps.sort((a,b) => a[1]-b[1]);

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

  static _optimizeSums(handlerSet, cellConflictSets, hasBoxes) {
    // TODO: Consider how this interactions with fixed cells.
    let sumHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Sum);
    if (sumHandlers.length == 0) return;

    let sumCells;
    [sumHandlers, sumCells] = this._findNonOverlapping(sumHandlers, handlerSet);

    handlerSet.add(...this._fillInSumGap(sumHandlers, sumCells));

    handlerSet.add(...this._makeInnieOutieSumHandlers(sumHandlers, hasBoxes));

    handlerSet.add(...this._makeHiddenCageHandlers(handlerSet, sumHandlers));

    this._replaceSizeSpecificSumHandlers(handlerSet, cellConflictSets);

    return;
  }

  static _addSumComplementCells(handlerSet) {
    const nonetHandlers = (
      handlerSet.getAllofType(SudokuConstraintHandler.Nonet).map(
        h => handlerSet.getIndex(h)));
    const cellMap = handlerSet.getCellMap();

    const findCommonHandler = (cells) => {
      let commonHandlers = nonetHandlers;
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

  static _fillInSumGap(sumHandlers, sumCells) {
    // Fill in a gap if one remains.
    const numNonSumCells = NUM_CELLS - sumCells.size;
    if (numNonSumCells == 0 || numNonSumCells >= GRID_SIZE) return [];

    const sumHandlersSum = sumHandlers.map(h => h.sum()).reduce((a,b)=>a+b);
    const remainingSum = GRID_SIZE*this._NONET_SUM - sumHandlersSum;

    const remainingCells = new Set(ALL_CELLS);
    sumHandlers.forEach(h => h.cells.forEach(c => remainingCells.delete(c)));
    const newHandler = new SudokuConstraintHandler.Sum(
      new Uint8Array(remainingCells), remainingSum);

    sumHandlers.push(newHandler);
    remainingCells.forEach(c => sumCells.add(c));

    if (ENABLE_DEBUG_LOGS) {
      debugLog({
        loc: '_fillInSumGap',
        msg: 'Add: ' + newHandler.constructor.name,
        args: {sum: remainingSum},
        cells: newHandler.cells,
      });
    }

    return [newHandler];
  }

  // Add nonet handlers for any AllDifferentHandler which have 9 cells.
  static _addNonetHandlers(handlerSet) {
    for (const h of
         handlerSet.getAllofType(SudokuConstraintHandler.AllDifferent)) {
      const c = h.conflictSet();
      if (c.length == GRID_SIZE) {
        handlerSet.add(new SudokuConstraintHandler.Nonet(c));
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
            (a, b) => a+b == h.sum() && (!hasConflict || a != b));
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

  // Create a Sum handler out of all the cages sticking out of a nonet.
  static _addSumIntersectionHandler(
      handlerSet, nonetHandler, overlappingHandlerIndexes) {

    let totalSum = 0;
    let cells = [];
    for (const i of overlappingHandlerIndexes) {
      const k = handlerSet.getHandler(i);
      totalSum += k.sum();
      cells.push(...k.cells);
    }
    // These cells would never cover the entire nonet.
    if (cells.length <= GRID_SIZE) return null;
    // We don't want too many cells in the new sum.
    if (cells.length > GRID_SIZE + this._MAX_SUM_SIZE) return null;

    const overlap = arrayIntersect(nonetHandler.cells, cells);
    // We need all cells in the nonet to be covered.
    if (overlap.length != GRID_SIZE) return null;

    const outsideCells = arrayDifference(cells, nonetHandler.cells);
    const outsideSum = totalSum - this._NONET_SUM;
    const handler = new SudokuConstraintHandler.Sum(outsideCells, outsideSum);

    if (ENABLE_DEBUG_LOGS) {
      debugLog({
        loc: '_addSumIntersectionHandler',
        msg: 'Add: ' + handler.constructor.name,
        args: {sum: handler.sum()},
        cells: handler.cells
      });
    }

    return handler;
  }

  // Find sets of cells which we can infer have a known sum and unique values.
  static _makeHiddenCageHandlers(handlerSet, sumHandlers) {
    const nonetHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Nonet);
    const newHandlers = [];

    const sumHandlerIndexes = new Set(
      sumHandlers.map(h => handlerSet.getIndex(h)));

    const cellMap = handlerSet.getCellMap();

    for (const h of nonetHandlers) {
      // Find sum contraints which overlap this nonet.
      let overlappingHandlerIndexes = new Set();
      for (const c of h.cells) {
        cellMap[c].forEach(i => overlappingHandlerIndexes.add(i));
      }
      overlappingHandlerIndexes = setIntersection(
        overlappingHandlerIndexes, sumHandlerIndexes);
      if (!overlappingHandlerIndexes.size) continue;

      {
        const sumIntersectionHandler = this._addSumIntersectionHandler(
            handlerSet, h, overlappingHandlerIndexes);
        if (sumIntersectionHandler) newHandlers.push(sumIntersectionHandler);
      }

      const outies = [];
      const constrainedCells = [];
      let constrainedSum = 0;
      for (const i of overlappingHandlerIndexes) {
        const k = handlerSet.getHandler(i);
        const overlap = arrayIntersect(h.cells, k.cells);
        if (overlap.length == k.cells.length) {
          constrainedCells.push(...overlap);
          constrainedSum += k.sum();
          k.setComplementCells(arrayDifference(h.cells, k.cells));
        } else if (k.cells.length - overlap.length == 1) {
          outies.push(k);
        }
      }

      // Short-circuit the common case where there is nothing special in the
      // nonet.
      if (outies.length == 0 && constrainedCells.length == 0) continue;

      const complementCells = arrayDifference(h.cells, constrainedCells);
      const complementSum = this._NONET_SUM - constrainedSum;

      // If a cage sticks out of a nonet by 1 cell, then we can form the
      // equivalent of an arrow sum (with offset). That is, the value of the
      // cell outside nonet is direct offset of the sum of the remaining
      // cells in the nonet outside the cage. The sum can be further reduced
      // by any other cages (i.e. known sums) in the nonet.
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
            args: {offset: remainingSum, negativeCells: [...extraCells]},
            cells: handler.cells
          });
        }
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
      newHandlers.push(complementHandler);
      if (ENABLE_DEBUG_LOGS) {
        debugLog({
          loc: '_makeHiddenCageHandlers',
          msg: 'Add: ' + complementHandler.constructor.name,
          args: {sum: complementSum},
          cells: complementCells
        });
      }
    }

    return newHandlers;
  }

  // Add same value handlers for the intersections between nonets.
  static _makeJigsawIntersections(handlerSet) {
    const nonetHandlers = handlerSet.getAllofType(SudokuConstraintHandler.Nonet);
    const newHandlers = [];

    // Add constraints due to overlapping regions.
    for (const h0 of nonetHandlers) {
      for (const h1 of nonetHandlers) {
        if (h0 === h1) continue;

        const diff0 = arrayDifference(h0.cells, h1.cells);
        if (diff0.length > this._MAX_SUM_SIZE || diff0.length == 0) continue;

        // We have some overlapping cells!
        // This means diff0 and diff1 must contain the same values.
        const diff1 = arrayDifference(h1.cells, h0.cells);

        // TODO: Optmize the diff0.length == 1 case (and 2?).
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

  static _makeRegions(fn) {
    let regions = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      let region = [];
      for (let i = 0; i < GRID_SIZE; i++) {
        region.push(fn(r, i));
      }
      regions.push(region);
    }
    return regions;
  }

  static _ROW_REGIONS = this._makeRegions((r, i) => r*GRID_SIZE+i);
  static _COL_REGIONS = this._makeRegions((c, i) => i*GRID_SIZE+c);
  static _OVERLAP_REGIONS = [
    this._ROW_REGIONS,
    this._ROW_REGIONS.slice().reverse(),
    this._COL_REGIONS,
    this._COL_REGIONS.slice().reverse(),
  ];
  static _BOX_REGIONS = this._makeRegions(
    (r, i) => ((r/BOX_SIZE|0)*BOX_SIZE+(i%BOX_SIZE|0))*GRID_SIZE
              +(r%BOX_SIZE|0)*BOX_SIZE+(i/BOX_SIZE|0));
  static _OVERLAP_REGIONS_WITH_BOX = [
    ...this._OVERLAP_REGIONS,
    this._BOX_REGIONS,
  ];

  static _generalRegionOverlapProcessor(regions, pieces, callback) {
    const superRegion = new Set();
    const remainingPieces = new Set(pieces);
    const usedPieces = [];
    const piecesRegion = new Set();

    let i=0;
    for (const r of regions) {
      i++;
      if (i == GRID_SIZE) break;

      // Add r to our super-region.
      r.forEach(e => superRegion.add(e));

      // Add any remaining pieces with enough overlap to our super-region.
      for (const p of remainingPieces) {
        const intersection = setIntersection(p, superRegion);
        if (intersection.size > p.length/2) {
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

  static _makeJigsawLawOfLeftoverHandlers(jigsawHandler, hasBoxes) {
    const newHandlers = [];

    const handleOverlap = (superRegion, piecesRegion, usedPieces) => {
      // We can only match when regions are the same size.
      if (superRegion.size != piecesRegion.size) return;

      const diffA = setDifference(superRegion, piecesRegion);
      if (diffA.size == 0) return;
      const diffB = setDifference(piecesRegion, superRegion);
      // Ignore diff that too big, they are probably not very well
      // constrained.
      if (diffA.size >= GRID_SIZE) return;

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
      hasBoxes ? this._OVERLAP_REGIONS_WITH_BOX : this._OVERLAP_REGIONS);
    for (const r of overlapRegions) {
      this._generalRegionOverlapProcessor(
        r, jigsawHandler.regions, handleOverlap);
    }

    return newHandlers;
  }

  static _makeInnieOutieSumHandlers(sumHandlers, hasBoxes) {
    const newHandlers = [];

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
      if (diffA.size + diffB.size > GRID_SIZE) return;

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

      let sumDelta = -superRegion.size*this._NONET_SUM/GRID_SIZE;
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
        args = {sum: sumDelta};
      } else {
        const negativeCell = [...diffA][0];
        newHandler = new SudokuConstraintHandler.SumWithNegative(
          [...diffB], negativeCell, sumDelta);
        args = {sum: sumDelta, negativeCell: negativeCell};
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
      hasBoxes ? this._OVERLAP_REGIONS_WITH_BOX : this._OVERLAP_REGIONS);
    for (const r of overlapRegions) {
      this._generalRegionOverlapProcessor(
        r, pieces, handleOverlap);
    }

    return newHandlers;
  }
}
